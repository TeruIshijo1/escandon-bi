require('dotenv').config();
const { connectRemoteDB } = require('./config/remote-db.js');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

async function testExport(dashboard) {
  try {
    const pool = await connectRemoteDB();
    const request = pool.request();
    let query = '';
    let sheetName = 'Export';
    let startDate = null, endDate = null, search = null;

    if (dashboard === 'financiero') {
      sheetName = 'Cuentas_Financiero';
      let whereClauses = ["1=1"];
      query = `
        SELECT TOP 500
          CONVERT(varchar(10), PC.MedicalDischargeDate, 120) AS 'Alta Médica',
          PC.PCNum AS 'Cuenta',
          PT.FullName AS 'Paciente',
          PC.Total AS 'Ingresos',
          PC.Profit AS 'Utilidad',
          PC.Balance AS 'Saldo'
        FROM PC
        LEFT JOIN PT ON PC.PTNum = PT.PTNum
        WHERE ${whereClauses.join(' AND ')}
        ORDER BY PC.Total DESC
      `;
    } else if (dashboard === 'eficacia') {
      sheetName = 'Consultas_Eficacia';
      query = `
        SELECT TOP 500
          CONVERT(varchar(10), Fecha, 120) AS 'Fecha',
          LEFT(CONVERT(varchar, Hora, 108), 5) AS 'Hora',
          Numero_Cita AS 'Num Cita',
          Paciente AS 'Paciente',
          Medico AS 'Médico',
          MSDescription_ES AS 'Especialidad',
          Estatus_Orden_Venta AS 'Estatus'
        FROM V_UDR_CONSULTA_DIA
        ORDER BY Fecha DESC, Hora DESC
      `;
    }

    if (!query) return console.log("No query for", dashboard);

    const result = await request.query(query);
    const rows = result.recordset;

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sheetName);

    const logoPath = path.join(__dirname, '../frontend/public/logo-escandon.png');
    if (fs.existsSync(logoPath)) {
      const logoId = workbook.addImage({ filename: logoPath, extension: 'png' });
      sheet.addImage(logoId, 'A1:B3');
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
          excelRow.getCell(colIndex + 1).value = row[key];
        });
      });
    }

    await workbook.xlsx.writeFile(`test_${dashboard}.xlsx`);
    console.log(`Success ${dashboard}! Rows: ${rows.length}`);
  } catch(e) {
    console.error(`Error in ${dashboard}:`, e);
  }
}

async function run() {
  await testExport('financiero');
  await testExport('eficacia');
  process.exit(0);
}
run();
