'use strict';

const { pool } = require('../config/pg-db');
const sapInventoryService = require('./sapInventory.service');

let isSyncingML = false;

/* Genera y sincroniza la tabla 'ml_dataset_reorden_sku' en PostgreSQL */
async function syncMLDataset() {
  if (isSyncingML) {
    console.log('[ML Dataset] Sincronización de ML ya en progreso. Omitiendo ejecución concurrente.');
    return;
  }
  isSyncingML = true;

  console.log('[ML Dataset] Iniciando generación del dataset analítico...');

  await sapInventoryService.ensureInventoryData();
  const inventoryMap = sapInventoryService.getInventoryMap();

    const operationalWarehouses = new Set(['FAR', 'QX', 'QXCR']);

    // Stock operativo por artículo: Farmacia, Quirófano y Carro Rojo
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

    // Obtener Universo de SKUs: combinar inventario SAP con dw_sap_reorder_settings
    const sapItems = sapInventoryService.getInventoryCache();
    const skuMap = new Map();

    // Primero cargar todos los artículos de inventario SAP
    sapItems.forEach(item => {
      const code = (item.ItemCode || '').trim();
      if (code) {
        skuMap.set(code.toUpperCase(), {
          itemcode: code,
          itemdescription: item.ItemName || code,
          minstock: 0,
          maxstock: 0
        });
      }
    });

    const pgResSettings = await pool.query(`
      SELECT itemcode, itemdescription, minstock, maxstock 
      FROM dw_sap_reorder_settings
    `);
    pgResSettings.rows.forEach(r => {
      const code = (r.itemcode || '').trim().toUpperCase();
      if (code) {
        const existing = skuMap.get(code);
        if (existing) {
          existing.minstock = Number(r.minstock || 0);
          existing.maxstock = Number(r.maxstock || 0);
          if (r.itemdescription) existing.itemdescription = r.itemdescription;
        } else {
          skuMap.set(code, {
            itemcode: r.itemcode,
            itemdescription: r.itemdescription || r.itemcode,
            minstock: Number(r.minstock || 0),
            maxstock: Number(r.maxstock || 0)
          });
        }
      }
    });

    const skus = Array.from(skuMap.values());
    if (skus.length === 0) {
      console.log('[ML Dataset] No hay registros de SKUs en SAP ni en dw_sap_reorder_settings. Sincronización cancelada.');
      isSyncingML = false;
      return 0;
    }

  // Obtener Pedidos Abiertos (dw_sap_pedidos) y sumar openQuantity por ItemCode
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

  // Obtener Última fecha de movimiento del Kardex (dw_sap_kardex)
  const lastMovementMap = new Map();
  const pgResKardex = await pool.query(`
    SELECT codigo, MAX(fecha) as max_fecha 
    FROM dw_sap_kardex 
    GROUP BY codigo
  `);
  pgResKardex.rows.forEach(row => {
    lastMovementMap.set(row.codigo, row.max_fecha);
  });

  const zeroStockCodes = [];
  const zeroStockValues = [];
  for (const item of skus) {
    const stock = getStock(item.itemcode);
    if (stock <= 0) {
      zeroStockCodes.push(item.itemcode);
      zeroStockValues.push(Number(stock || 0));
    }
  }

  const desabastoMap = new Map();
  if (zeroStockCodes.length > 0) {
    const pgResKardexMov = await pool.query(`
      WITH zero_skus AS (
        SELECT * FROM UNNEST($1::text[], $2::numeric[]) AS z(codigo, stock_actual)
      ),
      movs AS (
        SELECT
          k.codigo,
          k.fecha,
          z.stock_actual
            - SUM(k.movimiento) OVER (PARTITION BY k.codigo)
            + SUM(k.movimiento) OVER (
                PARTITION BY k.codigo
                ORDER BY k.fecha ASC, k.idkardex ASC
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
              ) AS balance
        FROM dw_sap_kardex k
        INNER JOIN zero_skus z ON z.codigo = k.codigo
        WHERE k.movimiento <> 0
      )
      SELECT codigo, MIN(fecha) AS fecha_desabasto
      FROM movs
      WHERE balance <= 0
      GROUP BY codigo
    `, [zeroStockCodes, zeroStockValues]);
    pgResKardexMov.rows.forEach(row => {
      desabastoMap.set(row.codigo, row.fecha_desabasto);
    });
  }

  // Obtener consumo diario de los últimos 30 días
   
  const pgResConsumos = await pool.query(`
    SELECT 
      codigo, 
      fechacargo::date as fecha, 
      SUM(cantidad) as total_qty
    FROM dw_cirrus_consumo
    WHERE fechacargo >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY codigo, fechacargo::date
  `);

  const consumptionBySku = new Map();
  pgResConsumos.rows.forEach(row => {
    if (!row.codigo) return;
    const dateStr = new Date(row.fecha).toISOString().split('T')[0];
    if (!consumptionBySku.has(row.codigo)) {
      consumptionBySku.set(row.codigo, {});
    }
    consumptionBySku.get(row.codigo)[dateStr] = Number(row.total_qty || 0);
  });

  const dateList = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dateList.push(d.toISOString().split('T')[0]);
  }

  const dataset = [];

  // Calcular métricas para cada SKU del catálogo
  for (const item of skus) {
    const itemCode = item.itemcode;

    const sapItem = inventoryMap.get(itemCode);
    const stockActual = getStock(itemCode);

    // Mínimos / Máximos
    const minStock = Number(item.minstock || 0);
    const maxStock = Number(item.maxstock || 0);

    const pedidosAbiertos = openOrdersMap.get(itemCode) || 0;

    // Último Movimiento
    const fechaUltimoMovimiento = lastMovementMap.get(itemCode) || null;

    const fechaDesabasto = stockActual <= 0 ? (desabastoMap.get(itemCode) || null) : null;

    // Ventanas de consumo
    const skuConsumptions = consumptionBySku.get(itemCode) || {};
    
    // Mapear los consumos a los últimos 30 días cronológicos
    const dailyQuantities = dateList.map(dateStr => skuConsumptions[dateStr] || 0);

    const consumo7d = dailyQuantities.slice(23).reduce((sum, val) => sum + val, 0);
    const consumo15d = dailyQuantities.slice(15).reduce((sum, val) => sum + val, 0);
    const consumo30d = dailyQuantities.reduce((sum, val) => sum + val, 0);

    // Promedio diario (basado en ventana de 30 días)
    const consumoPromedioDiario = consumo30d / 30.0;

    let variabilidadConsumo = 0;
    if (consumo30d > 0) {
      const sumSquaredDiffs = dailyQuantities.reduce((sum, val) => sum + Math.pow(val - consumoPromedioDiario, 2), 0);
      variabilidadConsumo = Math.sqrt(sumSquaredDiffs / 30.0);
    }

    // Días de stock restante y clasificación de riesgo
    let diasStockRestante = 9999;  
    let riesgoBase = 'BAJO';

    if (consumoPromedioDiario > 0) {
      diasStockRestante = stockActual / consumoPromedioDiario;
    } else if (stockActual === 0) {
      diasStockRestante = 0;
    }

    // Regla base del negocio
     
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

  // Escribir dataset en PostgreSQL mediante transacción
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('DELETE FROM ml_dataset_reorden_sku');

    console.log(`[ML Dataset] Guardando ${dataset.length} registros calculados en PostgreSQL...`);

    const batchSize = 250;
    const colCount = 15;
    for (let i = 0; i < dataset.length; i += batchSize) {
      const chunk = dataset.slice(i, i + batchSize);
      const tuplesMain = [];
      const tuplesHist = [];
      const params = [];
      for (let r = 0; r < chunk.length; r++) {
        const item = chunk[r];
        const offset = r * colCount;
        const p = [];
        for (let c = 1; c <= colCount; c++) p.push(`$${offset + c}`);
        tuplesMain.push(`(${p.join(', ')}, CURRENT_TIMESTAMP)`);
        tuplesHist.push(`(CURRENT_DATE, ${p.join(', ')}, CURRENT_TIMESTAMP)`);
        params.push(
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
        );
      }

      await client.query(`
        INSERT INTO ml_dataset_reorden_sku (
          itemcode, itemdescription, stock_actual, consumo_7d, consumo_15d, consumo_30d, 
          consumo_promedio_diario, variabilidad_consumo, minstock, maxstock, 
          pedidos_abiertos, fecha_ultimo_movimiento, fecha_desabasto, dias_stock_restante, riesgo_base, fecha_calculo
        ) VALUES ${tuplesMain.join(', ')}
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
      `, params);

      await client.query(`
        INSERT INTO ml_dataset_reorden_sku_history (
          snapshot_date, itemcode, itemdescription, stock_actual, consumo_7d, consumo_15d, consumo_30d, 
          consumo_promedio_diario, variabilidad_consumo, minstock, maxstock, 
          pedidos_abiertos, fecha_ultimo_movimiento, fecha_desabasto, dias_stock_restante, riesgo_base, fecha_calculo
        ) VALUES ${tuplesHist.join(', ')}
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
      `, params);
    }

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
        AND h.target_desabasto_7d IS NULL
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
        AND h.target_desabasto_15d IS NULL
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
