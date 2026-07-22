require('dotenv').config();
const { connectRemoteDB, sql } = require('./config/remote-db');

async function test() {
  try {
    const pool = await connectRemoteDB();
    const res = await pool.request().query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'");
    const tables = res.recordset.map(r => r.TABLE_NAME);
    
    console.log("Matched Tables:");
    const keywords = ['almacen', 'orden', 'cargo', 'enfermer', 'inventar', 'pacient', 'insumo', 'item', 'doc', 'sale', 'bill', 'pt', 'us'];
    const matched = tables.filter(t => {
      const lower = t.toLowerCase();
      return keywords.some(k => lower.includes(k));
    });
    console.log(matched);

    process.exit(0);
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
}
test();
