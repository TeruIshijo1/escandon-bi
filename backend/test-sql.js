require('dotenv').config();
const { connectRemoteDB } = require('./config/remote-db');

async function testQuery() {
  try {
    const pool = await connectRemoteDB();
    
    const result = await pool.request().query(`
      SELECT 
        Especialidad,
        SUM(TotalAtenciones) as Total,
        SUM(Primeras) as Primeras,
        SUM(Subsecuentes) as Subsecuentes
      FROM UDR_BI_PRODUCTIVIDAD_MEDICOS
      GROUP BY Especialidad
      ORDER BY Total DESC
    `);
    console.log("Top Especialidades:", result.recordset.slice(0, 5));

    const result2 = await pool.request().query(`
      SELECT Estatus_Orden_Venta, COUNT(*) as Count
      FROM V_UDR_CONSULTA_DIA
      GROUP BY Estatus_Orden_Venta
    `);
    console.log("Estatus Consultas:", result2.recordset);

    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

testQuery();
