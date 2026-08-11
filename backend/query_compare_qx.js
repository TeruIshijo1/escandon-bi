require('dotenv').config();
const { connectRemoteDB } = require('./config/remote-db.js');

async function compare() {
  try {
    const pool = await connectRemoteDB();

    const sapInVerticalRes = await pool.request().query(`
      SELECT DISTINCT FOLIO_DE_ATENCION, NOMBRE_DEL_PACIENTE, FECHA_DE_CARGO, UNIDAD_DE_SERVICIO
      FROM UDR_CUENTAS_SERVICIOS
      WHERE UNIDAD_DE_SERVICIO = 'CQX'
        AND FECHA_DE_CARGO >= '2026-07-01' AND FECHA_DE_CARGO <= '2026-07-31'
    `);
    
    const sapCuentas = sapInVerticalRes.recordset;
    const sapPatients = [...new Set(sapCuentas.map(c => c.NOMBRE_DEL_PACIENTE))];

    const usoqxRes = await pool.request().query(`
      SELECT PCFRNum, Paciente, FechaInicio, FechaFin
      FROM UDR_USOQX
      WHERE FechaInicio >= '2026-06-30' AND FechaInicio < '2026-08-01'
    `);
    
    const usoqxCuentas = usoqxRes.recordset;
    const usoqxPatients = [...new Set(usoqxCuentas.map(u => u.Paciente))];

    // Cross match by Paciente name
    const missingInSap = usoqxPatients.filter(uName => {
      if (!uName) return false;
      const uParts = uName.toLowerCase().split(' ').filter(Boolean);
      return !sapCuentas.some(sap => {
        if (!sap.NOMBRE_DEL_PACIENTE) return false;
        const sapParts = sap.NOMBRE_DEL_PACIENTE.toLowerCase().split(' ').filter(Boolean);
        return sapParts.includes(uParts[0]) && (uParts.length > 1 ? sapParts.includes(uParts[1]) : true);
      });
    });

    console.log("Patients in USOQX (July) but NO CQX charge in UDR_CUENTAS_SERVICIOS:");
    console.log("Count:", missingInSap.length);
    console.log(missingInSap);

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

compare();
