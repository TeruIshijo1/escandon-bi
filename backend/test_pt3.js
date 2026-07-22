require('dotenv').config();
const { connectRemoteDB } = require('./config/remote-db');

async function test() {
  try {
    const pool = await connectRemoteDB();
    
    // Group by State in PT
    let res = await pool.request().query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'PT'");
    console.log(res.recordset.map(c => c.COLUMN_NAME).join(', '));
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
test();
