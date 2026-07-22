require('dotenv').config();
const { connectRemoteDB } = require('./config/remote-db');

async function test() {
  const pool = await connectRemoteDB();
  const res = await pool.request().query('SELECT TOP 10 Total, Profit, SubtotalCost FROM PC WHERE Total > 0');
  console.log(res.recordset);
  pool.close();
}
test();
