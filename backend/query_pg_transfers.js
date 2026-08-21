const { pool } = require('./config/pg-db.js');
async function run() {
  try {
    const res = await pool.query("SELECT * FROM dw_sap_traslados WHERE stocktransferlines LIKE '%FAR0366%' ORDER BY docdate DESC LIMIT 5");
    console.log('Transfers found:', res.rows.length);
    res.rows.forEach(r => {
      console.log(`DocNum: ${r.docnum}, Date: ${r.docdate}, From: ${r.fromwarehouse}, To: ${r.towarehouse}`);
    });
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
run();
