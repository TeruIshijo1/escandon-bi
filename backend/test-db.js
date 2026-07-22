require('dotenv').config();
const { connectRemoteDB } = require('./config/remote-db');

async function run() {
  try {
    const pool = await connectRemoteDB();
    const request = pool.request();
    const result = await request.query(`
      SELECT TOP 10 PCNum, Date, MedicalDischargeDate, PCType, PC_ST, Total, Profit, Balance 
      FROM PC 
      WHERE PCType = 'ER' 
      ORDER BY Date DESC
    `);
    console.log(result.recordset);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}
run();
