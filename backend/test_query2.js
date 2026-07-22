require('dotenv').config();
const { connectRemoteDB } = require('./config/remote-db');

async function test() {
  const pool = await connectRemoteDB();
  const res = await pool.request().query("SELECT TOP 1 * FROM PC");
  console.log(res.recordset[0]);
  pool.close();
}
test();
