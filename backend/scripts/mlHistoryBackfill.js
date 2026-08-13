require('dotenv').config();
const { pool, initPostgresDW } = require('../config/pg-db');
const sapInventoryService = require('../services/sapInventory.service');

async function runBackfill() {
  console.log('=== Iniciando Proceso de Backfill del Historial ML ===');

  try {
    console.log('[Backfill] Asegurando existencia de tablas DW...');
    await initPostgresDW();

    // 1. Inicializar e importar caché de inventario SAP
    console.log('[Backfill] Sincronizando caché actual de SAP...');
    await sapInventoryService.syncInventoryCache();
    const inventoryMap = sapInventoryService.getInventoryMap();

    // 2. Obtener SKUs configurados en dw_sap_reorder_settings
    console.log('[Backfill] Cargando configuración de reorden...');
    const pgResSettings = await pool.query('SELECT itemcode, itemdescription, minstock, maxstock FROM dw_sap_reorder_settings');
    const skus = pgResSettings.rows;
    if (skus.length === 0) {
      console.log('No hay SKUs en dw_sap_reorder_settings. Abortando.');
      return;
    }
    console.log(`[Backfill] Cargados ${skus.length} SKUs.`);

    // 3. Cargar todos los movimientos del Kardex para reconstrucción (últimos 60 días)
    console.log('[Backfill] Cargando movimientos del Kardex...');
    const pgResKardex = await pool.query(`
      SELECT codigo, fecha, movimiento 
      FROM dw_sap_kardex 
      WHERE fecha >= CURRENT_DATE - INTERVAL '60 days'
      ORDER BY fecha ASC
    `);
    const kardexMovements = pgResKardex.rows;
    
    // Agrupar movimientos por SKU
    const movementsBySku = new Map();
    kardexMovements.forEach(m => {
      if (!movementsBySku.has(m.codigo)) {
        movementsBySku.set(m.codigo, []);
      }
      movementsBySku.get(m.codigo).push(m);
    });

    // 4. Cargar consumos de los últimos 60 días para las ventanas
    console.log('[Backfill] Cargando consumos históricos...');
    const pgResConsumos = await pool.query(`
      SELECT codigo, fechacargo::date as fecha, SUM(cantidad) as total_qty
      FROM dw_cirrus_consumo
      WHERE fechacargo >= CURRENT_DATE - INTERVAL '60 days'
      GROUP BY codigo, fechacargo::date
    `);
    const consumptionMap = new Map(); // itemcode -> { [dateStr]: cantidad }
    pgResConsumos.rows.forEach(c => {
      if (!c.codigo) return;
      const dateStr = new Date(c.fecha).toISOString().split('T')[0];
      if (!consumptionMap.has(c.codigo)) {
        consumptionMap.set(c.codigo, {});
      }
      consumptionMap.get(c.codigo)[dateStr] = Number(c.total_qty || 0);
    });

    // 5. Generar lista de fechas a backfillar (últimos 30 días, excluyendo hoy)
    const dates = [];
    for (let i = 30; i >= 1; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().split('T')[0]);
    }
    console.log(`[Backfill] Se reconstruirá el historial para ${dates.length} fechas: desde ${dates[0]} hasta ${dates[dates.length - 1]}`);

    // 6. Reconstruir stock histórico para cada SKU
    console.log('[Backfill] Reconstruyendo stock histórico por SKU...');
    const skuStockHistory = new Map(); // itemcode -> { [dateStr]: stock }
    
    // Generar array de fechas desde hoy hacia atrás para la reconstrucción
    const reconstructionDates = [];
    for (let i = 0; i <= 30; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      reconstructionDates.push(d.toISOString().split('T')[0]);
    }

    for (const sku of skus) {
      const itemCode = sku.itemcode;
      const sapItem = inventoryMap.get(itemCode);
      const stockToday = sapItem ? Number(sapItem.QuantityOnStock ?? sapItem.OnHand ?? 0) : 0;
      
      const skuMovs = movementsBySku.get(itemCode) || [];
      // Agrupar movimientos por fecha para este SKU
      const movsByDate = {};
      skuMovs.forEach(m => {
        const dStr = new Date(m.fecha).toISOString().split('T')[0];
        movsByDate[dStr] = (movsByDate[dStr] || 0) + Number(m.movimiento || 0);
      });

      let tempStock = stockToday;
      const history = {};
      
      for (const dStr of reconstructionDates) {
        history[dStr] = tempStock;
        // Para el día anterior, restamos el movimiento de este día
        const movOnDay = movsByDate[dStr] || 0;
        tempStock = tempStock - movOnDay;
      }
      
      skuStockHistory.set(itemCode, history);
    }

    // 7. Calcular métricas e insertar snapshots en PostgreSQL
    console.log('[Backfill] Insertando snapshots en la base de datos...');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Limpiar historial previo para garantizar un backfill limpio y regeneración de targets
      await client.query('TRUNCATE TABLE ml_dataset_reorden_sku_history');
      
      let insertCount = 0;

      for (const dateStr of dates) {
        // Generar lista de los 30 días previos a dateStr para calcular consumos
        const prev30Days = [];
        const baseDate = new Date(dateStr + 'T12:00:00'); // usar mediodía para evitar zonas horarias
        for (let i = 29; i >= 0; i--) {
          const d = new Date(baseDate);
          d.setDate(d.getDate() - i);
          prev30Days.push(d.toISOString().split('T')[0]);
        }

        for (const sku of skus) {
          const itemCode = sku.itemcode;
          const minStock = Number(sku.minstock || 0);
          const maxStock = Number(sku.maxstock || 0);
          
          // Stock histórico para esa fecha
          const stockHistMap = skuStockHistory.get(itemCode) || {};
          const stockActual = stockHistMap[dateStr] ?? 0;

          // Consumos en ventanas respecto a dateStr
          const skuCons = consumptionMap.get(itemCode) || {};
          const dailyQuantities = prev30Days.map(d => skuCons[d] || 0);

          const consumo7d = dailyQuantities.slice(23).reduce((s, v) => s + v, 0);
          const consumo15d = dailyQuantities.slice(15).reduce((s, v) => s + v, 0);
          const consumo30d = dailyQuantities.reduce((s, v) => s + v, 0);
          const consumoPromedioDiario = consumo30d / 30.0;

          let variabilidadConsumo = 0;
          if (consumo30d > 0) {
            const sumSquaredDiffs = dailyQuantities.reduce((s, v) => s + Math.pow(v - consumoPromedioDiario, 2), 0);
            variabilidadConsumo = Math.sqrt(sumSquaredDiffs / 30.0);
          }

          // Días de stock restante y riesgo
          let diasStockRestante = 9999;
          let riesgoBase = 'BAJO';

          if (consumoPromedioDiario > 0) {
            diasStockRestante = stockActual / consumoPromedioDiario;
          } else if (stockActual === 0) {
            diasStockRestante = 0;
          }

          if (stockActual === 0 && minStock > 0) {
            riesgoBase = 'CRITICO';
          } else if (diasStockRestante <= 3) {
            riesgoBase = 'CRITICO';
          } else if (diasStockRestante <= 7) {
            riesgoBase = 'ALTO';
          } else if (diasStockRestante <= 15) {
            riesgoBase = 'MEDIO';
          } else {
            riesgoBase = 'BAJO';
          }

          // Determinar última fecha de movimiento antes o en dateStr
          const skuMovs = movementsBySku.get(itemCode) || [];
          const pastMovs = skuMovs.filter(m => new Date(m.fecha).toISOString().split('T')[0] <= dateStr);
          const fechaUltimoMovimiento = pastMovs.length > 0 ? pastMovs[pastMovs.length - 1].fecha : null;

          await client.query(`
            INSERT INTO ml_dataset_reorden_sku_history (
              snapshot_date, itemcode, itemdescription, stock_actual, consumo_7d, consumo_15d, consumo_30d, 
              consumo_promedio_diario, variabilidad_consumo, minstock, maxstock, 
              pedidos_abiertos, fecha_ultimo_movimiento, dias_stock_restante, riesgo_base, fecha_calculo
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, $12, $13, $14, CURRENT_TIMESTAMP)
            ON CONFLICT (snapshot_date, itemcode) DO NOTHING
          `, [
            dateStr,
            itemCode,
            sku.itemdescription || 'Insumo Médico',
            stockActual,
            consumo7d,
            consumo15d,
            consumo30d,
            consumoPromedioDiario,
            variabilidadConsumo,
            minStock,
            maxStock,
            fechaUltimoMovimiento,
            diasStockRestante,
            riesgoBase
          ]);

          insertCount++;
        }
      }

      await client.query('COMMIT');
      console.log(`[Backfill] Guardados exitosamente ${insertCount} snapshots históricos.`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // 8. Calcular targets de desabasto para todo el historial
    console.log('[Backfill] Ejecutando cálculo retrospectivo de targets...');
    const clientTargets = await pool.connect();
    try {
      await clientTargets.query('BEGIN');
      
      const res7 = await clientTargets.query(`
        UPDATE ml_dataset_reorden_sku_history h
        SET target_desabasto_7d = CASE 
          WHEN EXISTS (
            SELECT 1 
            FROM ml_dataset_reorden_sku_history future
            WHERE future.itemcode = h.itemcode
              AND future.snapshot_date > h.snapshot_date
              AND future.snapshot_date <= h.snapshot_date + INTERVAL '7 days'
              AND future.stock_actual <= 0
          ) THEN 1
          ELSE 0
        END
        WHERE h.snapshot_date <= CURRENT_DATE - INTERVAL '7 days'
      `);

      const res15 = await clientTargets.query(`
        UPDATE ml_dataset_reorden_sku_history h
        SET target_desabasto_15d = CASE 
          WHEN EXISTS (
            SELECT 1 
            FROM ml_dataset_reorden_sku_history future
            WHERE future.itemcode = h.itemcode
              AND future.snapshot_date > h.snapshot_date
              AND future.snapshot_date <= h.snapshot_date + INTERVAL '15 days'
              AND future.stock_actual <= 0
          ) THEN 1
          ELSE 0
        END
        WHERE h.snapshot_date <= CURRENT_DATE - INTERVAL '15 days'
      `);

      await clientTargets.query('COMMIT');
      console.log(`[Backfill] Targets de 7d actualizados: ${res7.rowCount} registros.`);
      console.log(`[Backfill] Targets de 15d actualizados: ${res15.rowCount} registros.`);
    } catch (err) {
      await clientTargets.query('ROLLBACK');
      throw err;
    } finally {
      clientTargets.release();
    }

    console.log('✅ === Proceso de Backfill ML completado con éxito ===');

  } catch (err) {
    console.error('❌ Error en el proceso de Backfill:', err);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

runBackfill();
