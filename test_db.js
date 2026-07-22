require('dotenv').config({ path: './backend/.env' });
const { connectRemoteDB } = require('./backend/config/remote-db.js');

async function test() {
  const pool = await connectRemoteDB();
  const res = await pool.request().query(`
    SELECT TOP 10 
      PC.PTNum, PC.PC_ST, PC.PCType, 
      V.RoomCode, V.RoomName, V.FullName, V.ControllerName 
    FROM PC 
    JOIN V_MRPT V ON PC.PTNum = V.PTNum 
    WHERE V.RoomName LIKE '%202%' AND PC.PC_ST = 'OP'
  `);
  console.log('Occupied 202:');
  console.log(res.recordset);
  
  const res2 = await pool.request().query(`
    SELECT DISTINCT RoomCode, RoomName 
    FROM V_MRPT 
    WHERE RoomName LIKE '%202%'
  `);
  console.log('Master list 202:');
  console.log(res2.recordset);

  process.exit(0);
}
test().catch(console.error);
