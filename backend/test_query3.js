require('dotenv').config();
const { connectRemoteDB } = require('./config/remote-db');

async function test() {
  const pool = await connectRemoteDB();
  const res = await pool.request().query("SELECT PCNum, Total, Profit, SubtotalCost, ProfitMargin FROM PC WHERE Profit > Total");
  console.log(res.recordset);
  pool.close();
}
test();
