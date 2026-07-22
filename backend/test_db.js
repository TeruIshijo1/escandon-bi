require('dotenv').config({ path: './.env' });
const { connectRemoteDB } = require('./config/remote-db.js');

async function test() {
  const pool = await connectRemoteDB();
  const final = await pool.request().query(`
    WITH CTE AS (
      SELECT 
        V.RoomCode, 
        V.FullName AS Paciente, 
        PR.FullName AS Medico,
        ROW_NUMBER() OVER(PARTITION BY PC.PTNum ORDER BY V.ControllerKey DESC) as rn
      FROM PC
      JOIN V_MRPT V ON PC.PTNum = V.PTNum AND V.RoomName LIKE '%CAMA%'
      LEFT JOIN PR ON PC.PRNum = PR.PRNum
      WHERE PC.PC_ST = 'OP' AND PC.PCType IN ('IP', 'ER')
        AND V.RoomCode IS NOT NULL
    )
    SELECT * FROM CTE WHERE rn = 1
  `);
  
  console.log('Occupied using ROW_NUMBER:');
  console.log('Total:', final.recordset.length);
  const in202 = final.recordset.filter(r => r.RoomCode === 'CAMA02PA');
  console.log('In 202:', in202);

  process.exit(0);
}
test().catch(console.error);
