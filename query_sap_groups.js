const { pool } = require('./backend/config/pg-db.js');

async function run() {
  try {
    const res = await pool.query('SELECT itmsgrpcod, SUM(total) as t FROM dw_sap_ingresos_grupos GROUP BY itmsgrpcod ORDER BY t DESC');
    console.log(res.rows);
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
run();
