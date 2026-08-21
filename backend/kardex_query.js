const { pool } = require('./config/pg-db.js');
async function queryKardex() {
  try {
    const res = await pool.query(
      `SELECT * FROM dw_sap_kardex WHERE codigo = 'FAR0366' ORDER BY fecha DESC LIMIT 15`
    );
    console.log(res.rows);
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
queryKardex();
