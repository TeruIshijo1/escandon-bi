require('dotenv').config();
const { connectRemoteDB, sql } = require('./config/remote-db');

async function searchDB() {
  try {
    const pool = await connectRemoteDB();
    const query = `
      SELECT TABLE_NAME, COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE COLUMN_NAME LIKE '%almacen%'
         OR COLUMN_NAME LIKE '%cargo%'
         OR COLUMN_NAME LIKE '%inventario%'
         OR COLUMN_NAME LIKE '%enfermer%'
         OR TABLE_NAME LIKE '%almacen%'
         OR TABLE_NAME LIKE '%cargo%'
         OR TABLE_NAME LIKE '%inventario%'
         OR TABLE_NAME LIKE '%enfermer%'
      ORDER BY TABLE_NAME, COLUMN_NAME
    `;
    const res = await pool.request().query(query);
    
    const tables = {};
    for (const row of res.recordset) {
      if (!tables[row.TABLE_NAME]) tables[row.TABLE_NAME] = [];
      tables[row.TABLE_NAME].push(row.COLUMN_NAME);
    }
    
    console.log(JSON.stringify(tables, null, 2));
    process.exit(0);
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
}
searchDB();
