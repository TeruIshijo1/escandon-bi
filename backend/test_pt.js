require('dotenv').config();
const { connectRemoteDB } = require('./config/remote-db');

async function test() {
  try {
    const pool = await connectRemoteDB();
    
    // Contar cuántos pacientes hay en la base de datos de Cirrus/Verical (SQL Server)
    // Usaremos la vista UDR_BI_PACIENTES porque parece ser la que crearon para BI
    // Y probaremos otras si están vacías
    let res = await pool.request().query("SELECT count(*) as Total FROM UDR_BI_PACIENTES");
    console.log("UDR_BI_PACIENTES count:", res.recordset[0].Total);

    let res2 = await pool.request().query("SELECT count(*) as Total FROM PT");
    console.log("PT count:", res2.recordset[0].Total);
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
test();
