import ExcelJS from 'exceljs';
import { applySheetInstitutionalStyle } from './excelInstitutionalGenerator.js';

const MONEY_FORMAT = '"$"#,##0.00;[Red]("$"#,##0.00);"$"0.00';

function styleStatisticsSheet(sheet, definition) {
  applySheetInstitutionalStyle(sheet, { ...definition, freezeHeaders: true });
  sheet.views = [{ state: 'frozen', ySplit: sheet.autoFilter.from.row, xSplit: 1, showGridLines: false }];
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  sheet.pageSetup.printTitlesRow = `${sheet.autoFilter.from.row}:${sheet.autoFilter.from.row}`;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber < sheet.autoFilter.from.row) {
      row.getCell(1).alignment = { ...row.getCell(1).alignment, wrapText: true };
      row.height = Math.max(row.height || 20, rowNumber === 3 ? 30 : 26);
      return;
    }
    let lines = 1;
    row.eachCell((cell, columnNumber) => {
      const column = definition.columnas[columnNumber - 1];
      cell.alignment = { ...cell.alignment, wrapText: true, vertical: 'middle' };
      if (column?.type === 'currency') cell.numFmt = MONEY_FORMAT;
      if (column?.type === 'number') cell.numFmt = '#,##0.##';
      const content = String(cell.value ?? '');
      lines = Math.max(lines, content.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / Math.max(8, (column?.width || 18) - 3))), 0));
    });
    row.height = Math.max(rowNumber === sheet.autoFilter.from.row ? 32 : 22, lines * 15);
  });
}

export function buildStatisticsWorkbook({ sheetName, title, period, unit, scope, summary, columns, rows, totals, footnotes = [] }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Hospital Escandón';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(sheetName);
  styleStatisticsSheet(sheet, {
    titulo: 'HOSPITAL ESCANDÓN · ESTADÍSTICAS', subtitulo: title, periodo: period,
    columnas: columns, filas: rows, totales: totals, resumen: summary,
  });
  const context = [period && `Periodo: ${period}`, unit && `Unidad: ${unit}`, scope].filter(Boolean).join('   ·   ');
  sheet.getCell('A3').value = context;
  const availableWidth = Math.max(20, columns.reduce((total, column) => total + (column.width || 18), 0) * 0.8);
  sheet.getRow(3).height = Math.max(30, Math.ceil(context.length / availableWidth) * 15);
  const essentialNotes = [...new Set(footnotes.filter(Boolean))];
  if (essentialNotes.length) {
    sheet.addRow([]).height = 8;
    for (const note of essentialNotes) {
      const row = sheet.addRow([note]);
      sheet.mergeCells(row.number, 1, row.number, columns.length);
      row.getCell(1).font = { name: 'Calibri', size: 9, color: { argb: 'FF475569' } };
      row.getCell(1).alignment = { wrapText: true, vertical: 'middle' };
      row.height = Math.max(24, Math.ceil(String(note).length / availableWidth) * 15);
    }
  }
  return workbook;
}

export async function downloadStatisticsWorkbook({ filename, ...definition }) {
  const workbook = buildStatisticsWorkbook(definition);
  const bytes = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
