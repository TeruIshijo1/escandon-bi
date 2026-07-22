require('dotenv').config();
const { connectRemoteDB } = require('./config/remote-db');

async function testMedicos() {
  try {
    const pool = await connectRemoteDB();

    console.log("--- PROBANDO MÉDICOS POR INGRESOS EN UDR_CUENTAS_SERVICIOS ---");
    const res1 = await pool.request().query(`
      SELECT TOP 5
        Medico_Solicitante                                      AS Medico,
        COUNT(*)                                               AS TotalCargos,
        SUM(ISNULL(TOTAL_COBRADO, ISNULL(TOTAL_SIN_DESC, 0)))  AS IngresosGenerados
      FROM UDR_CUENTAS_SERVICIOS
      WHERE Medico_Solicitante IS NOT NULL AND Medico_Solicitante != ''
      GROUP BY Medico_Solicitante
      ORDER BY IngresosGenerados DESC
    `);
    console.log(res1.recordset);

    console.log("\n--- PROBANDO UDR_BI_PRODUCTIVIDAD_MEDICOS ---");
    try {
      const res2 = await pool.request().query(`SELECT TOP 5 * FROM UDR_BI_PRODUCTIVIDAD_MEDICOS`);
      console.log(res2.recordset);
    } catch(e) { console.log("UDR_BI_PRODUCTIVIDAD_MEDICOS error:", e.message); }

    process.exit(0);
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
}
testMedicos();
