const { pool } = require('./config/pg-db');
async function test() {
  const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'sap_incoming_payments'");
  console.log(res.rows.map(x=>x.column_name));
  process.exit(0);
}
test().catch(e=>console.error(e));
