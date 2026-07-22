require('dotenv').config();
const { connectRemoteDB } = require('./config/remote-db.js');

async function main() {
  try {
    const pool = await connectRemoteDB();
    const request = pool.request();
    
    // Simulating exactly what urgencias-nativo does
    let whereClauses = ["PC.PCType = 'ER'"];
    whereClauses.push("PC.Date >= DATEADD(day, -30, GETDATE())");
    whereClauses.push("PC.Date <= GETDATE()");

    const queryStr = `
      SELECT TOP 500
        PC.PCNum,
        PC.Date as Ingreso,
        PC.MedicalDischargeDate as Egreso,
        PC.PC_ST as Estatus,
        PT.FullName as Paciente,
        DATEDIFF(minute, PC.Date, PC.MedicalDischargeDate) as MinutosEstancia
      FROM PC
      LEFT JOIN PT ON PC.PTNum = PT.PTNum
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY PC.Date DESC
    `;

    console.log("Query:", queryStr);
    const result = await request.query(queryStr);
    console.log("Data count:", result.recordset.length);
  } catch(e) {
    console.error("DB Error:", e);
  }
  process.exit(0);
}
main();
