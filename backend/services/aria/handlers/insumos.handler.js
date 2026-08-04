'use strict';

const { getRemoteDb } = require('../../../config/remote-db');

async function queryInsumosMasGastados() {
  try {
    const pool = await getRemoteDb();
    const res = await pool.request().query(`
      SELECT TOP 7
        CODIGO                       AS Codigo,
        DESCRIPCION_DEL_ARTICULO     AS Insumo,
        SUM(CANTIDAD)                AS CantidadTotal,
        SUM(ISNULL(TOTAL_COBRADO, ISNULL(TOTAL_SIN_DESC, 0))) AS MontoGenerado
      FROM UDR_CUENTAS_SERVICIOS
      WHERE DESCRIPCION_DEL_ARTICULO IS NOT NULL
      GROUP BY CODIGO, DESCRIPCION_DEL_ARTICULO
      ORDER BY CantidadTotal DESC
    `);

    const rows = res.recordset || [];
    const topInsumo = rows[0] || {};

    return {
      topic: 'Top Insumos Más Utilizados',
      answer: `El insumo con mayor volumen de consumo registrado en el hospital es **${topInsumo.Insumo}** (Código: \`${topInsumo.Codigo}\`) con un total acumulado de **${topInsumo.CantidadTotal} unidades** surtidas.`,
      kpis: [
        { label: 'Insumo #1', value: topInsumo.Insumo },
        { label: 'Unidades Surtidas', value: topInsumo.CantidadTotal },
      ],
      table: {
        headers: ['Código', 'Descripción del Insumo', 'Unidades', 'Monto Cobrado ($)'],
        rows: rows.map(r => [
          r.Codigo,
          r.Insumo,
          r.CantidadTotal,
          `$${Math.abs(parseFloat(r.MontoGenerado || 0)).toLocaleString('es-MX')}`,
        ]),
      },
    };
  } catch (err) {
    return {
      topic: 'Insumos',
      answer: 'Consumo de insumos: ' + err.message,
    };
  }
}

module.exports = queryInsumosMasGastados;
