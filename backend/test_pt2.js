require('dotenv').config();
const { connectRemoteDB } = require('./config/remote-db');

async function test() {
  try {
    const pool = await connectRemoteDB();
    
    // Group by State in PT
    let res = await pool.request().query("SELECT State, count(*) as c FROM PT GROUP BY State ORDER BY c DESC");
    console.log(res.recordset);
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
test();
