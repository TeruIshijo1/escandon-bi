'use strict';

const { pool } = require('../config/pg-db');
const sapInventoryService = require('./sapInventory.service');

let isSyncingML = false;

/**
 * Genera y sincroniza la tabla 'ml_dataset_reorden_sku' en PostgreSQL
 */
async function syncMLDataset() {
  if (isSyncingML) {
    console.log('[ML Dataset] Sincronización de ML ya en progreso. Omitiendo ejecución concurrente.');
    return;
  }
  isSyncingML = true;

  console.log('[ML Dataset] Iniciando generación del dataset analítico...');

  // 1. Asegurar que el caché de inventario SAP esté cargado (SAP en vivo o snapshot PostgreSQL)
  await sapInventoryService.ensureInventoryData();
  const inventoryMap = sapInventoryService.getInventoryMap();

    const operationalWarehouses = new Set(['FAR', 'QX', 'QXCR']);

    // Stock operativo por artículo: Farmacia, Quirófano y Carro Rojo.
    const stockBySku = new Map();
    sapInventoryService.getInventoryCache().forEach(row => {
      const prev = stockBySku.get(row.ItemCode) || { far: 0, qx: 0, qxcr: 0, total: 0, hospitalTotal: 0 };
      const qty = Number(row.QuantityOnStock || row.OnHand || 0);
      prev.hospitalTotal += qty;
      if (row.WhsCode === 'FAR') prev.far += qty;
      if (row.WhsCode === 'QX') prev.qx += qty;
      if (row.WhsCode === 'QXCR') prev.qxcr += qty;
      if (operationalWarehouses.has(row.WhsCode)) prev.total += qty;
      stockBySku.set(row.ItemCode, prev);
    });
    const getStock = (itemCode) => {
      const s = stockBySku.get(itemCode);
      if (!s) return 0;
      return s.total > 0 ? s.total : s.hospitalTotal;
    };

    // 2. Obtener Universo de SKUs (dw_sap_reorder_settings) con deduplicación por itemcode
    const pgResSettings = await pool.query(`
      SELECT DISTINCT ON (UPPER(TRIM(itemcode))) 
        itemcode, itemdescription, minstock, maxstock 
      FROM dw_sap_reorder_settings
      ORDER BY UPPER(TRIM(itemcode)), lastupdated DESC NULLS LAST
    `);
    const skus = pgResSettings.rows;
    if (skus.length === 0) {
      console.log('[ML Dataset] No hay registros en dw_sap_reorder_settings. Sincronización cancelada.');
      return 0;
    }

  // 3. Obtener Pedidos Abiertos (dw_sap_pedidos) y sumar openQuantity por ItemCode
  const openOrdersMap = new Map();
  const pgResPedidos = await pool.query(`
    SELECT itemsjson 
    FROM dw_sap_pedidos 
    WHERE docstatus = 'bost_Open'
  `);
  pgResPedidos.rows.forEach(p => {
    let itemsList = [];
    try {
      itemsList = JSON.parse(p.itemsjson || '[]');
    } catch (e) {
      // Ignorar errores de parseo
    }
    itemsList.forEach(l => {
      const code = l.itemCode || l.ItemCode;
      const openQty = Number(l.openQuantity || l.OpenQuantity || 0);
      if (code && openQty > 0) {
        openOrdersMap.set(code, (openOrdersMap.get(code) || 0) + openQty);
      }
    });
  });

  // 4. Obtener Última fecha de movimiento del Kardex (dw_sap_kardex)
  const lastMovementMap = new Map();
  const pgResKardex = await pool.query(`
    SELECT codigo, MAX(fecha) as max_fecha 
    FROM dw_sap_kardex 
    GROUP BY codigo
  `);
  pgResKardex.rows.forEach(row => {
    lastMovementMap.set(row.codigo, row.max_fecha);
  });

  // 4b. Obtener movimientos del Kardex para calcular la fecha exacta en la que cada
  // SKU llegó a stock 0 (solo es relevante para los que ya están en desabasto)
  const kardexMovementsMap = new Map();
  const pgResKardexMov = await pool.query(`
    SELECT codigo, fecha, movimiento
    FROM dw_sap_kardex
    WHERE movimiento <> 0
    ORDER BY codigo, fecha ASC
  `);
  pgResKardexMov.rows.forEach(row => {
    if (!kardexMovementsMap.has(row.codigo)) {
      kardexMovementsMap.set(row.codigo, []);
    }
    kardexMovementsMap.get(row.codigo).push({
      fecha: row.fecha,
      movimiento: Number(row.movimiento || 0)
    });
  });

  // 5. Obtener consumo diario de los últimos 30 días
  // Agrupado por SKU y día para poder calcular consumo en ventanas y la desviación estándar
  const pgResConsumos = await pool.query(`
    SELECT 
      codigo, 
      fechacargo::date as fecha, 
      SUM(cantidad) as total_qty
    FROM dw_cirrus_consumo
    WHERE fechacargo >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY codigo, fechacargo::date
  `);
  
  // Agrupar consumos en un mapa de itemcode -> { [fechaStr]: cantidad }
  const consumptionBySku = new Map();
  pgResConsumos.rows.forEach(row => {
    if (!row.codigo) return;
    const dateStr = new Date(row.fecha).toISOString().split('T')[0];
    if (!consumptionBySku.has(row.codigo)) {
      consumptionBySku.set(row.codigo, {});
    }
    consumptionBySku.get(row.codigo)[dateStr] = Number(row.total_qty || 0);
  });

  // Generar array con los strings de fechas de los últimos 30 días (del hoy-29 al hoy)
  const dateList = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dateList.push(d.toISOString().split('T')[0]);
  }

  const dataset = [];

  // 6. Calcular métricas para cada SKU del catálogo
  for (const item of skus) {
    const itemCode = item.itemcode;
    
    // A. Stock Actual (prioriza almacén Farmacia; fallback total entre almacenes)
    const sapItem = inventoryMap.get(itemCode);
    const stockActual = getStock(itemCode);

    // B. Mínimos / Máximos
    const minStock = Number(item.minstock || 0);
    const maxStock = Number(item.maxstock || 0);

    // C. Pedidos abiertos
    const pedidosAbiertos = openOrdersMap.get(itemCode) || 0;

    // D. Último Movimiento
    const fechaUltimoMovimiento = lastMovementMap.get(itemCode) || null;

    // D2. Fecha en la que el SKU se agotó (solo si ya está en desabasto):
    // recorrer el kardex con balance acumulado (stock actual + movimientos futuros)
    // hasta encontrar el movimiento que dejó el balance en 0
    let fechaDesabasto = null;
    if (stockActual <= 0) {
      const movs = kardexMovementsMap.get(itemCode) || [];
      if (movs.length > 0) {
        let balance = stockActual - movs.reduce((sum, m) => sum + m.movimiento, 0);
        for (const m of movs) {
          balance += m.movimiento;
          if (balance <= 0) {
            fechaDesabasto = m.fecha;
            break;
          }
        }
      }
    }

    // E. Ventanas de consumo
    const skuConsumptions = consumptionBySku.get(itemCode) || {};
    
    // Mapear los consumos a los últimos 30 días cronológicos
    const dailyQuantities = dateList.map(dateStr => skuConsumptions[dateStr] || 0);

    // Sumas por ventanas (7d = últimos 7 elementos, 15d = últimos 15, 30d = los 30)
    const consumo7d = dailyQuantities.slice(23).reduce((sum, val) => sum + val, 0);
    const consumo15d = dailyQuantities.slice(15).reduce((sum, val) => sum + val, 0);
    const consumo30d = dailyQuantities.reduce((sum, val) => sum + val, 0);

    // Promedio diario (basado en ventana de 30 días)
    const consumoPromedioDiario = consumo30d / 30.0;

    // Variabilidad del consumo (Desviación estándar poblacional sobre los 30 días)
    let variabilidadConsumo = 0;
    if (consumo30d > 0) {
      const sumSquaredDiffs = dailyQuantities.reduce((sum, val) => sum + Math.pow(val - consumoPromedioDiario, 2), 0);
      variabilidadConsumo = Math.sqrt(sumSquaredDiffs / 30.0);
    }

    // F. Días de stock restante y clasificación de riesgo
    let diasStockRestante = 9999; // Representa stock virtualmente infinito si el consumo es 0
    let riesgoBase = 'BAJO';

    if (consumoPromedioDiario > 0) {
      diasStockRestante = stockActual / consumoPromedioDiario;
    } else if (stockActual === 0) {
      diasStockRestante = 0;
    }

    // Regla base del negocio:
    // si stock es 0, es crítico de forma inmediata
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

    dataset.push({
      itemcode: itemCode,
      itemdescription: item.itemdescription || (sapItem ? sapItem.ItemName : 'Insumo Médico'),
      stock_actual: stockActual,
      consumo_7d: consumo7d,
      consumo_15d: consumo15d,
      consumo_30d: consumo30d,
      consumo_promedio_diario: consumoPromedioDiario,
      variabilidad_consumo: variabilidadConsumo,
      minstock: minStock,
      maxstock: maxStock,
      pedidos_abiertos: pedidosAbiertos,
      fecha_ultimo_movimiento: fechaUltimoMovimiento,
      fecha_desabasto: fechaDesabasto,
      dias_stock_restante: diasStockRestante,
      riesgo_base: riesgoBase
    });
  }

  // 7. Escribir dataset en PostgreSQL mediante transacción
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Limpiamos la tabla para tener un snapshot fresco y consistente
    await client.query('DELETE FROM ml_dataset_reorden_sku');

    console.log(`[ML Dataset] Guardando ${dataset.length} registros calculados en PostgreSQL...`);

    for (const item of dataset) {
      // A. Guardar en la tabla de tiempo real (Dashboard) - con ON CONFLICT para evitar colisiones
      await client.query(`
        INSERT INTO ml_dataset_reorden_sku (
          itemcode, itemdescription, stock_actual, consumo_7d, consumo_15d, consumo_30d, 
          consumo_promedio_diario, variabilidad_consumo, minstock, maxstock, 
          pedidos_abiertos, fecha_ultimo_movimiento, fecha_desabasto, dias_stock_restante, riesgo_base, fecha_calculo
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP)
        ON CONFLICT (itemcode) DO UPDATE SET
          itemdescription = EXCLUDED.itemdescription,
          stock_actual = EXCLUDED.stock_actual,
          consumo_7d = EXCLUDED.consumo_7d,
          consumo_15d = EXCLUDED.consumo_15d,
          consumo_30d = EXCLUDED.consumo_30d,
          consumo_promedio_diario = EXCLUDED.consumo_promedio_diario,
          variabilidad_consumo = EXCLUDED.variabilidad_consumo,
          minstock = EXCLUDED.minstock,
          maxstock = EXCLUDED.maxstock,
          pedidos_abiertos = EXCLUDED.pedidos_abiertos,
          fecha_ultimo_movimiento = EXCLUDED.fecha_ultimo_movimiento,
          fecha_desabasto = EXCLUDED.fecha_desabasto,
          dias_stock_restante = EXCLUDED.dias_stock_restante,
          riesgo_base = EXCLUDED.riesgo_base,
          fecha_calculo = CURRENT_TIMESTAMP
      `, [
        item.itemcode,
        item.itemdescription,
        item.stock_actual,
        item.consumo_7d,
        item.consumo_15d,
        item.consumo_30d,
        item.consumo_promedio_diario,
        item.variabilidad_consumo,
        item.minstock,
        item.maxstock,
        item.pedidos_abiertos,
        item.fecha_ultimo_movimiento,
        item.fecha_desabasto,
        item.dias_stock_restante,
        item.riesgo_base
      ]);

      // B. Guardar en la tabla histórica (Entrenamiento de ML) - Control de duplicados por día
      await client.query(`
        INSERT INTO ml_dataset_reorden_sku_history (
          snapshot_date, itemcode, itemdescription, stock_actual, consumo_7d, consumo_15d, consumo_30d, 
          consumo_promedio_diario, variabilidad_consumo, minstock, maxstock, 
          pedidos_abiertos, fecha_ultimo_movimiento, fecha_desabasto, dias_stock_restante, riesgo_base, fecha_calculo
        ) VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP)
        ON CONFLICT (snapshot_date, itemcode) DO UPDATE SET
          itemdescription = EXCLUDED.itemdescription,
          stock_actual = EXCLUDED.stock_actual,
          consumo_7d = EXCLUDED.consumo_7d,
          consumo_15d = EXCLUDED.consumo_15d,
          consumo_30d = EXCLUDED.consumo_30d,
          consumo_promedio_diario = EXCLUDED.consumo_promedio_diario,
          variabilidad_consumo = EXCLUDED.variabilidad_consumo,
          minstock = EXCLUDED.minstock,
          maxstock = EXCLUDED.maxstock,
          pedidos_abiertos = EXCLUDED.pedidos_abiertos,
          fecha_ultimo_movimiento = EXCLUDED.fecha_ultimo_movimiento,
          fecha_desabasto = EXCLUDED.fecha_desabasto,
          dias_stock_restante = EXCLUDED.dias_stock_restante,
          riesgo_base = EXCLUDED.riesgo_base,
          fecha_calculo = CURRENT_TIMESTAMP
      `, [
        item.itemcode,
        item.itemdescription,
        item.stock_actual,
        item.consumo_7d,
        item.consumo_15d,
        item.consumo_30d,
        item.consumo_promedio_diario,
        item.variabilidad_consumo,
        item.minstock,
        item.maxstock,
        item.pedidos_abiertos,
        item.fecha_ultimo_movimiento,
        item.fecha_desabasto,
        item.dias_stock_restante,
        item.riesgo_base
      ]);
    }

    // 8. Retroetiquetado de desabastos pasados (Calcular targets de 7d y 15d retrospectivamente)
    console.log('[ML Dataset] Recalculando targets de desabasto en el historial...');
    await client.query(`
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

    await client.query(`
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

    await client.query('COMMIT');
    console.log('✅ [ML Dataset] Sincronización analítica y cálculo de targets completado.');
    return dataset.length;
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    console.error('❌ [ML Dataset] Error al guardar dataset analítico:', err);
    throw err;
  } finally {
    if (client) client.release();
    isSyncingML = false;
  }
}

module.exports = {
  syncMLDataset
};
