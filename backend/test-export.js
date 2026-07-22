require('dotenv').config();
const { connectRemoteDB } = require('./config/remote-db.js');
const ExcelJS = require('exceljs');

async function main() {
  try {
    const pool = await connectRemoteDB();
    const request = pool.request();
    const query = `
        SELECT TOP 500
          CONVERT(varchar(10), PC.Date, 120) AS 'Fecha Admisión',
          LEFT(CONVERT(varchar, PC.Date, 108), 5) AS 'Hora Admisión',
          CONVERT(varchar(10), PC.MedicalDischargeDate, 120) AS 'Fecha Alta',
          LEFT(CONVERT(varchar, PC.MedicalDischargeDate, 108), 5) AS 'Hora Alta',
          PC.PCNum AS 'Cuenta',
          PT.FullName AS 'Paciente',
          CASE 
            WHEN PC.PC_ST = 'CL' THEN 'Alta'
            WHEN PC.PC_ST = 'OP' THEN 'En Piso'
            ELSE PC.PC_ST
          END AS 'Estatus',
          PC.Total AS 'Costo Total'
        FROM PC
        LEFT JOIN PT ON PC.PTNum = PT.PTNum
        WHERE PC.PCType = 'ER'
        ORDER BY PC.Date DESC
    `;
    const result = await request.query(query);
    const rows = result.recordset;

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Test');

    const fs = require('fs');
    const path = require('path');
    const logoPath = path.join(__dirname, '../frontend/public/logo-escandon.png');
    if (fs.existsSync(logoPath)) {
      const logoId = workbook.addImage({
        filename: logoPath,
        extension: 'png',
      });
      sheet.addImage(logoId, 'A1:B3');
    } else {
      console.log("Logo not found at", logoPath);
    }

    if (rows.length > 0) {
      const keys = Object.keys(rows[0]);
      
      const headerRow = sheet.getRow(5);
      keys.forEach((key, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = key;
      });

      rows.forEach((row, rowIndex) => {
        const excelRow = sheet.getRow(6 + rowIndex);
        keys.forEach((key, colIndex) => {
          const cell = excelRow.getCell(colIndex + 1);
          let val = row[key];
          cell.value = val;
        });
      });
    }

    await workbook.xlsx.writeFile('test.xlsx');
    console.log("Success writing excel!");
  } catch(e) {
    console.error("DB Error:", e);
  }
  process.exit(0);
}
main();
