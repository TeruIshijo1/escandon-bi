'use strict';

const { getRemoteDb } = require('../../../config/remote-db');

async function queryPacientesMayorGasto() {
  try {
    const pool = await getRemoteDb();
    const res = await pool.request().query(`
      SELECT TOP 5
        NOMBRE_DEL_PACIENTE AS Paciente,
        UNIDAD_DE_SERVICIO  AS Area,
        COUNT(*)            AS TotalCargos,
        SUM(ISNULL(TOTAL_COBRADO, ISNULL(TOTAL_SIN_DESC, 0))) AS MontoTotal
      FROM UDR_CUENTAS_SERVICIOS
      WHERE NOMBRE_DEL_PACIENTE IS NOT NULL AND NOMBRE_DEL_PACIENTE != ''
      GROUP BY NOMBRE_DEL_PACIENTE, UNIDAD_DE_SERVICIO
      ORDER BY MontoTotal DESC
    `);

    const rows = res.recordset || [];
    const topPaciente = rows[0] || {};

    return {
      topic: 'Mayores Cuentas de Pacientes',
      answer: `El paciente con el mayor consumo acumulado en el hospital actualmente es **${topPaciente.Paciente || 'N/A'}** en la unidad **${topPaciente.Area || 'General'}** con un total de **$${Math.abs(parseFloat(topPaciente.MontoTotal || 0)).toLocaleString('es-MX')} MXN** distribuidos en ${topPaciente.TotalCargos} cargos registradas.`,
      kpis: [
        { label: 'Top Consumo Paciente', value: `$${Math.abs(parseFloat(topPaciente.MontoTotal || 0)).toLocaleString('es-MX')}` },
        { label: 'Cargos Registrados', value: topPaciente.TotalCargos || 0 },
      ],
      table: {
        headers: ['Nombre del Paciente', 'Área Hospitalaria', 'Total Cargos', 'Monto Acumulado ($)'],
        rows: rows.map(r => [
          r.Paciente,
          r.Area,
          r.TotalCargos,
          `$${Math.abs(parseFloat(r.MontoTotal || 0)).toLocaleString('es-MX')}`,
        ]),
      },
    };
  } catch (err) {
    return {
      topic: 'Pacientes Gasto',
      answer: 'Acumulado de cuentas de pacientes: ' + err.message,
    };
  }
}

module.exports = queryPacientesMayorGasto;
