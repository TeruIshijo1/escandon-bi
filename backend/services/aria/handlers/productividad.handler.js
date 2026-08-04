'use strict';

const { getRemoteDb } = require('../../../config/remote-db');

async function queryMedicosMasIngresos() {
  try {
    const pool = await getRemoteDb();
    const res = await pool.request().query(`
      SELECT TOP 5
        Medico_Solicitante                                      AS Medico,
        COUNT(*)                                               AS TotalCargos,
        SUM(ISNULL(TOTAL_COBRADO, ISNULL(TOTAL_SIN_DESC, 0)))  AS IngresosGenerados
      FROM UDR_CUENTAS_SERVICIOS
      WHERE Medico_Solicitante IS NOT NULL AND Medico_Solicitante != ''
      GROUP BY Medico_Solicitante
      ORDER BY IngresosGenerados DESC
    `);

    const rows = res.recordset || [];
    const topMedico = rows[0] || {};
    const montoTop = Math.abs(parseFloat(topMedico.IngresosGenerados || 0));

    return {
      topic: 'Productividad e Ingresos por Médico',
      answer: `El médico que **más ingresos aporta al Hospital Escandón** es el **Dr. ${topMedico.Medico}** con una facturación acumulada de **$${montoTop.toLocaleString('es-MX')} MXN** generada en ${topMedico.TotalCargos} cargos/atenciones registradas.`,
      kpis: [
        { label: 'Médico #1 en Ingresos', value: `Dr. ${topMedico.Medico}` },
        { label: 'Ingreso Generado', value: `$${montoTop.toLocaleString('es-MX')}`, color: '#16A34A' },
        { label: 'Total Atenciones', value: topMedico.TotalCargos, color: '#004687' },
      ],
      table: {
        headers: ['Nombre del Médico', 'Total Cargos', 'Ingresos Generados ($)'],
        rows: rows.map(r => [
          `Dr. ${r.Medico}`,
          r.TotalCargos,
          `$${Math.abs(parseFloat(r.IngresosGenerados || 0)).toLocaleString('es-MX')}`,
        ]),
      },
    };
  } catch (err) {
    return {
      topic: 'Productividad Médica',
      answer: 'Error al obtener los ingresos por médico: ' + err.message,
    };
  }
}

module.exports = queryMedicosMasIngresos;
