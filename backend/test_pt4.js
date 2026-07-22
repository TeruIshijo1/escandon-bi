require('dotenv').config();
const { connectRemoteDB } = require('./config/remote-db');

async function test() {
  try {
    const pool = await connectRemoteDB();
    
    // Group by StateCode in PT
    let res = await pool.request().query("SELECT StateCode, count(*) as c FROM PT GROUP BY StateCode ORDER BY c DESC");
    console.log(res.recordset);
    
    // Check City
    let res2 = await pool.request().query("SELECT City, count(*) as c FROM PT GROUP BY City ORDER BY c DESC");
    console.log(res2.recordset.slice(0,10));
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
test();
