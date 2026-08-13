'use strict';

const { pool } = require('../../../config/pg-db');
const sapInventoryService = require('../../sapInventory.service');

/**
 * Handler 1: Inventario Exclusivo de Almacén General ('ALG', '01')
 */
async function queryInventarioAlmacenGeneral() {
  try {
    if (sapInventoryService.getInventoryCache().length === 0) {
      try {
        await Promise.race([
          sapInventoryService.syncInventoryCache(),
          new Promise(resolve => setTimeout(resolve, 3000))
        ]);
      } catch (e) {
        console.warn('[Almacén ARIA] SAP sync timeout/error:', e.message);
      }
    }

    const items = sapInventoryService.getInventoryCache().filter(i => i.WhsCode === 'ALG' || i.WhsCode === '01');

    if (items.length === 0) {
      return {
        topic: 'Almacén General: Inventario',
        answer: 'No se encontraron artículos con existencia activa en el Almacén General (ALG / 01).',
      };
    }

    let totalStock = 0;
    let valorTotal = 0;

    items.forEach(i => {
      const qty = Number(i.QuantityOnStock || 0);
      const price = Number(i.SalesPrice || 0);
      totalStock += qty;
      valorTotal += qty * price;
    });

    const sorted = [...items].sort((a, b) => (b.QuantityOnStock || 0) - (a.QuantityOnStock || 0));

    const tableRows = sorted.slice(0, 10).map(i => [
      i.ItemCode || '',
      i.ItemName || 'Articulo',
      i.WhsCode || 'ALG',
      Number(i.QuantityOnStock || 0).toLocaleString('es-MX'),
      `$${Number(i.SalesPrice || 0).toLocaleString('es-MX')}`
    ]);

    return {
      topic: 'Almacén General: Inventario Físico',
      answer: `El **Almacén General (ALG/01)** registra **${items.length} tipos de artículos**, con un total de **${totalStock.toLocaleString('es-MX')} unidades en existencia** y un valor total estimado de **$${Math.round(valorTotal).toLocaleString('es-MX')} MXN**.`,
      kpis: [
        { label: 'Tipos de Artículos', value: items.length, color: '#004687' },
        { label: 'Stock Total (Unidades)', value: totalStock.toLocaleString('es-MX'), color: '#0088C9' },
        { label: 'Valor Estimado', value: `$${Math.round(valorTotal).toLocaleString('es-MX')}`, color: '#16A34A' }
      ],
      table: {
        headers: ['Código', 'Descripción', 'Almacén', 'Stock Actual', 'Precio Unitario'],
        rows: tableRows
      }
    };
  } catch (err) {
    console.error('Error en queryInventarioAlmacenGeneral:', err);
    return {
      topic: 'Almacén General: Inventario',
      answer: 'Error al consultar el inventario del Almacén General: ' + err.message
    };
  }
}

/**
 * Handler 2: Solicitudes de Traslado de Almacén
 */
async function queryTrasladosAlmacen() {
  try {
    const pgRes = await pool.query(`
      SELECT 
        docnum AS "DocNum", docdate AS "DocDate", fromwarehouse AS "FromWarehouse", towarehouse AS "ToWarehouse", documentstatus AS "DocumentStatus", comments AS "Comments", requestername AS "RequesterName"
      FROM dw_sap_traslados
      ORDER BY docentry DESC
      LIMIT 15
    `);
    const rows = pgRes.rows;

    if (!rows || rows.length === 0) {
      return {
        topic: 'Almacén General: Traslados',
        answer: 'No hay registros de solicitudes de traslado en la base de datos local.',
      };
    }

    let cerrados = 0;
    let abiertos = 0;

    const tableRows = rows.map(r => {
      let fechaStr = r.DocDate ? new Date(r.DocDate).toISOString().slice(0, 10) : 'N/A';
      const status = String(r.DocumentStatus || 'bost_Open');
      const isClosed = status.toLowerCase().includes('close');

      if (isClosed) cerrados++;
      else abiertos++;

      return [
        r.DocNum || 'S/N',
        fechaStr,
        r.FromWarehouse || 'Almacén General',
        r.ToWarehouse || 'Servicio Hospitalario',
        r.RequesterName || 'Sistema',
        r.Comments || 'Traslado de insumos',
        isClosed ? 'COMPLETADO' : 'PENDIENTE'
      ];
    });

    return {
      topic: 'Almacén General: Solicitudes de Traslado',
      answer: `Se consultaron las últimas **${rows.length} solicitudes de traslado** registradas entre Almacén General y las sub-farmacias / servicios del hospital:`,
      kpis: [
        { label: 'Traslados Consultados', value: rows.length, color: '#004687' },
        { label: 'Completados / Cerrados', value: cerrados, color: '#16A34A' },
        { label: 'Pendientes / Abiertos', value: abiertos, color: '#DC2626' }
      ],
      table: {
        headers: ['Folio / DocNum', 'Fecha', 'Almacén Origen', 'Almacén Destino', 'Solicitante', 'Observaciones', 'Estado'],
        rows: tableRows
      }
    };
  } catch (err) {
    console.error('Error en queryTrasladosAlmacen:', err);
    return {
      topic: 'Almacén General: Traslados',
      answer: 'No se pudo consultar el historial de traslados: ' + err.message
    };
  }
}

/**
 * Handler 3: Entradas de Almacén / Facturas de Proveedores
 */
async function queryEntradasAlmacen() {
  try {
    const pgRes = await pool.query(`
      SELECT 
        fecha AS "Fecha", numeroentrada AS "NumeroEntrada", numerofactura AS "NumeroFactura", nombreproveedor AS "NombreProveedor",
        COUNT(DISTINCT codigo) AS "TiposArticulos",
        SUM(cantidadarticulos) AS "CantidadTotal",
        SUM(importefactura) AS "ImporteTotal"
      FROM dw_sap_entradas
      GROUP BY numeroentrada, numerofactura, nombreproveedor, fecha
      ORDER BY fecha DESC
      LIMIT 10
    `);
    const rows = pgRes.rows;

    if (!rows || rows.length === 0) {
      return {
        topic: 'Almacén General: Entradas',
        answer: 'No hay entradas de almacén registradas recientemente.',
      };
    }

    let sumaMonto = 0;
    let sumaCant = 0;

    const tableRows = rows.map(r => {
      const monto = Number(r.ImporteTotal || 0);
      const cant = Number(r.CantidadTotal || 0);
      sumaMonto += monto;
      sumaCant += cant;

      return [
        r.Fecha ? new Date(r.Fecha).toISOString().slice(0, 10) : 'N/A',
        r.NumeroEntrada || 'S/N',
        r.NumeroFactura || 'S/N',
        r.NombreProveedor || 'Proveedor',
        cant.toLocaleString('es-MX'),
        `$${monto.toLocaleString('es-MX')}`
      ];
    });

    return {
      topic: 'Almacén General: Entradas de Mercancía / Proveedores',
      answer: `Se registran **${rows.length} recepciones de facturas de compra** recientes en el Almacén General por un importe acumulado de **$${Math.round(sumaMonto).toLocaleString('es-MX')} MXN**:`,
      kpis: [
        { label: 'Entradas Registradas', value: rows.length, color: '#004687' },
        { label: 'Artículos Recibidos', value: sumaCant.toLocaleString('es-MX'), color: '#0088C9' },
        { label: 'Monto Total Facturado', value: `$${Math.round(sumaMonto).toLocaleString('es-MX')}`, color: '#16A34A' }
      ],
      table: {
        headers: ['Fecha', 'Nº Entrada', 'Nº Factura', 'Proveedor', 'Cantidad Recibida', 'Importe Factura'],
        rows: tableRows
      }
    };
  } catch (err) {
    console.error('Error en queryEntradasAlmacen:', err);
    return {
      topic: 'Almacén General: Entradas',
      answer: 'Error al consultar las entradas de mercancía: ' + err.message
    };
  }
}

/**
 * Handler 4: Kardex de Almacén
 */
async function queryKardexAlmacen() {
  try {
    const pgRes = await pool.query(`
      SELECT 
        codigo AS "Codigo", descripcion AS "Descripcion", almacenorigen AS "AlmacenOrigen", almacendestino AS "AlmacenDestino", documentoref AS "DocumentoRef", existencias AS "Existencias", fecha AS "Fecha", servicio AS "Servicio", usuario AS "Usuario", movimiento AS "Movimiento", valoracumulado AS "ValorAcumulado"
      FROM dw_sap_kardex
      ORDER BY fecha DESC
      LIMIT 15
    `);
    const rows = pgRes.rows;

    if (!rows || rows.length === 0) {
      return {
        topic: 'Almacén General: Kardex',
        answer: 'No hay movimientos registrados en el Kardex de inventario.',
      };
    }

    const tableRows = rows.map(r => [
      r.Fecha ? new Date(r.Fecha).toISOString().slice(0, 16).replace('T', ' ') : 'N/A',
      r.Codigo || '',
      r.Descripcion || 'Movimiento',
      r.AlmacenOrigen || 'Origen',
      r.AlmacenDestino || 'Destino',
      Number(r.Movimiento || 0).toLocaleString('es-MX'),
      r.DocumentoRef || ''
    ]);

    return {
      topic: 'Kardex de Inventario Unificado',
      answer: `El Kardex unificado de Almacén reporta los **últimos ${rows.length} movimientos de entradas, traslados y salidas a servicio**:`,
      kpis: [
        { label: 'Movimientos Recientes', value: rows.length, color: '#004687' },
      ],
      table: {
        headers: ['Fecha y Hora', 'Código', 'Insumo / Concepto', 'Origen', 'Destino', 'Piezas Movidas', 'Documento Ref'],
        rows: tableRows
      }
    };
  } catch (err) {
    console.error('Error en queryKardexAlmacen:', err);
    return {
      topic: 'Kardex de Almacén',
      answer: 'No se pudo consultar el Kardex de inventario: ' + err.message
    };
  }
}

/**
 * Handler 5: Predicciones ML de Riesgo de Desabasto (Paso 7 DataScience)
 * Responde: qué insumos están en riesgo, cuáles comprar, por qué un SKU está en
 * riesgo, top de críticos y qué cambió desde ayer.
 */
async function queryRiesgoDesabasto(normalizedQuery = '') {
  try {
    // 1. ¿Preguntan por un SKU específico? (ej. "por qué ALG0013 está en riesgo")
    const skuMatch = normalizedQuery.match(/\b([A-Z]{2,6}\s?\d{3,8})\b/i);

    if (skuMatch) {
      return await explicarRiesgoSku(skuMatch[1].replace(/\s+/g, '').toUpperCase());
    }

    // 2. ¿Preguntan por cambios desde ayer?
    if (/ayer|cambio|diferencia|nuevo|empeor/.test(normalizedQuery)) {
      return await cambiosRiesgoDesdeAyer();
    }

    // 3. Resumen general de riesgo (default)
    return await resumenRiesgoDesabasto();
  } catch (err) {
    console.error('Error en queryRiesgoDesabasto:', err);
    return {
      topic: 'Predicciones ML: Riesgo de Desabasto',
      answer: 'Error al consultar las predicciones de desabasto: ' + err.message
    };
  }
}

/** Resumen general: KPIs + top 10 críticos */
async function resumenRiesgoDesabasto() {
  const pgRes = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE riesgo_ml = 'YA EN DESABASTO') AS ya_desabasto,
      COUNT(*) FILTER (WHERE riesgo_ml = 'CRITICO') AS criticos,
      COUNT(*) FILTER (WHERE riesgo_ml = 'ALTO') AS alto,
      COUNT(*) FILTER (WHERE riesgo_ml = 'MEDIO') AS medio,
      ROUND(AVG(prob_desabasto_7d)::numeric, 4) AS prob_promedio,
      MAX(fecha_prediccion) AS ultima_prediccion,
      MAX(modelo_version) AS modelo_version
    FROM ml_predictions_reorden_sku
  `);
  const stats = pgRes.rows[0];

  const pgTop = await pool.query(`
    SELECT itemcode, itemdescription, stock_actual, dias_stock_restante,
           prob_desabasto_7d, riesgo_ml
    FROM ml_predictions_reorden_sku
    WHERE riesgo_ml IN ('YA EN DESABASTO', 'CRITICO', 'ALTO')
    ORDER BY prob_desabasto_7d DESC, itemcode ASC
    LIMIT 10
  `);
  const rows = pgTop.rows;

  if (!rows || rows.length === 0) {
    return {
      topic: 'Predicciones ML: Riesgo de Desabasto',
      answer: 'No hay insumos en riesgo de desabasto en las predicciones actuales del modelo.',
      kpis: [
        { label: 'Críticos + Sin Stock', value: 0, color: '#16A34A' },
        { label: 'Probabilidad Promedio', value: '0%', color: '#16A34A' }
      ]
    };
  }

  const probPromedio = Number(stats.prob_promedio || 0);
  const fechaPred = stats.ultima_prediccion ? new Date(stats.ultima_prediccion).toLocaleString('es-MX') : 'N/D';
  const totalRiesgo = Number(stats.ya_desabasto || 0) + Number(stats.criticos || 0) + Number(stats.alto || 0);

  const tableRows = rows.map(r => [
    r.itemcode,
    r.itemdescription || 'Insumo',
    Math.round(Number(r.stock_actual || 0)).toLocaleString('es-MX'),
    Number(r.dias_stock_restante) >= 9999 ? '∞' : Math.round(Number(r.dias_stock_restante)),
    (Number(r.prob_desabasto_7d) * 100).toFixed(1) + '%',
    r.riesgo_ml
  ]);

  return {
    topic: 'Predicciones ML: Insumos en Riesgo de Desabasto (próximos 7 días)',
    answer: `El modelo de riesgo detecta **${totalRiesgo} insumos en riesgo** (sin stock, críticos o alto riesgo). Los **10 más críticos** ordenados por probabilidad de desabasto son:`,
    kpis: [
      { label: 'Ya Sin Stock', value: Number(stats.ya_desabasto || 0), color: '#7F1D1D' },
      { label: 'Críticos ML', value: Number(stats.criticos || 0), color: '#DC2626' },
      { label: 'Alto Riesgo ML', value: Number(stats.alto || 0), color: '#EA580C' },
      { label: 'Prob. Promedio', value: (probPromedio * 100).toFixed(1) + '%', color: '#004687' },
      { label: 'Modelo', value: stats.modelo_version || 'N/D', color: '#64748B' },
      { label: 'Última Predicción', value: fechaPred, color: '#64748B' }
    ],
    table: {
      headers: ['Código', 'Descripción', 'Stock', 'Días Rest.', 'Prob. 7d', 'Riesgo ML'],
      rows: tableRows
    }
  };
}

/** Explicación individual por SKU: por qué está en riesgo */
async function explicarRiesgoSku(itemcode) {
  const pgRes = await pool.query(`
    SELECT itemcode, itemdescription, stock_actual, consumo_promedio_diario,
           dias_stock_restante, riesgo_base, prob_desabasto_7d, riesgo_ml,
           modelo_version, fecha_prediccion
    FROM ml_predictions_reorden_sku
    WHERE itemcode = $1
  `, [itemcode]);
  const row = pgRes.rows[0];

  if (!row) {
    return {
      topic: `Predicciones ML: ${itemcode}`,
      answer: `No encontré predicciones para el SKU **${itemcode}**. Verifica que el código exista en el catálogo de reorden o que ya se hayan generado predicciones (botón "Calcular Alertas de Desabasto").`
    };
  }

  const stock = Number(row.stock_actual || 0);
  const consumo = Number(row.consumo_promedio_diario || 0);
  const dias = Number(row.dias_stock_restante);
  const prob = Number(row.prob_desabasto_7d);

  const razones = [];
  if (stock <= 0) razones.push('el stock actual es 0 (ya está en desabasto)');
  if (consumo > 0 && dias > 0 && dias <= 3) razones.push(`solo quedan ~${Math.round(dias)} días de stock al consumo promedio actual`);
  if (consumo > 0 && dias > 3 && dias <= 7) razones.push(`quedan ~${Math.round(dias)} días de stock, dentro de la ventana de 7 días`);
  if (consumo > 0 && dias === 0) razones.push('no hay stock suficiente para cubrir el consumo diario');
  if (razones.length === 0) razones.push('el patrón histórico de este SKU presenta riesgo de agotamiento');

  return {
    topic: `Predicciones ML: ${row.itemcode} — ${(row.itemdescription || '').slice(0, 60)}`,
    answer: `**${row.itemcode}** (${row.itemdescription || 'Insumo'}) tiene probabilidad de desabasto de **${(prob * 100).toFixed(1)}%** en los próximos 7 días → **${row.riesgo_ml}**. Las razones: ${razones.join('; ')}. La regla base por stock lo clasifica como **${row.riesgo_base}**.`,
    kpis: [
      { label: 'Stock Actual', value: Math.round(stock).toLocaleString('es-MX'), color: stock <= 0 ? '#DC2626' : '#004687' },
      { label: 'Consumo Promedio/Día', value: consumo.toFixed(2), color: '#0088C9' },
      { label: 'Días de Stock Restante', value: dias >= 9999 ? '∞' : Math.round(dias), color: dias <= 7 ? '#DC2626' : '#16A34A' },
      { label: 'Prob. Desabasto 7d', value: (prob * 100).toFixed(1) + '%', color: '#EA580C' },
      { label: 'Riesgo ML', value: row.riesgo_ml, color: '#7F1D1D' }
    ]
  };
}

/** Compara las predicciones de hoy contra el snapshot de ayer (historial) */
async function cambiosRiesgoDesdeAyer() {
  const pgFechas = await pool.query(`
    SELECT DISTINCT snapshot_date
    FROM ml_dataset_reorden_sku_history
    ORDER BY snapshot_date DESC
    LIMIT 3
  `);
  const fechas = pgFechas.rows.map(r => r.snapshot_date);
  if (fechas.length < 2) {
    return {
      topic: 'Predicciones ML: Cambios',
      answer: 'Aún no hay suficiente historial de snapshots para comparar el cambio desde ayer (se necesitan al menos 2 días de historial).'
    };
  }
  const hoy = fechas[0];
  const ayer = fechas[1];

  const pgRes = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE hoy.stock_actual <= 0 AND ayer.stock_actual > 0) AS nuevos_desabastos,
      COUNT(*) FILTER (WHERE hoy.riesgo_base = 'CRITICO' AND ayer.riesgo_base NOT IN ('CRITICO')) AS nuevos_criticos,
      COUNT(*) FILTER (WHERE hoy.stock_actual > 0 AND ayer.stock_actual <= 0) AS recuperados,
      COUNT(*) FILTER (WHERE hoy.riesgo_base NOT IN ('CRITICO') AND ayer.riesgo_base = 'CRITICO') AS salieron_criticos
    FROM ml_dataset_reorden_sku_history hoy
    LEFT JOIN ml_dataset_reorden_sku_history ayer
      ON ayer.itemcode = hoy.itemcode AND ayer.snapshot_date = $2
    WHERE hoy.snapshot_date = $1
  `, [hoy, ayer]);
  const r = pgRes.rows[0];

  return {
    topic: 'Predicciones ML: Cambios vs Ayer',
    answer: `Comparando el snapshot de hoy (${hoy.toLocaleDateString('es-MX')}) contra ayer (${ayer.toLocaleDateString('es-MX')}): **${r.nuevos_desabastos} insumos cayeron en desabasto**, **${r.nuevos_criticos} pasaron a crítico**, mientras que **${r.recuperados} se recuperaron** y **${r.salieron_criticos} salieron de crítico**.`,
    kpis: [
      { label: 'Nuevos en Desabasto', value: Number(r.nuevos_desabastos), color: '#DC2626' },
      { label: 'Nuevos Críticos', value: Number(r.nuevos_criticos), color: '#EA580C' },
      { label: 'Recuperados', value: Number(r.recuperados), color: '#16A34A' },
      { label: 'Salieron de Crítico', value: Number(r.salieron_criticos), color: '#0088C9' }
    ]
  };
}

module.exports = {
  queryInventarioAlmacenGeneral,
  queryTrasladosAlmacen,
  queryEntradasAlmacen,
  queryKardexAlmacen,
  queryRiesgoDesabasto
};
