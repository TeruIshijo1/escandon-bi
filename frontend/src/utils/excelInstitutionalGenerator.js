/**
 * excelInstitutionalGenerator.js — Generador de Reportes Excel con Estilo Institucional
 * Hospital Escandón BI Platform
 * 
 * Implementa el formato oficial de la Fundación María Ana Mier de Escandón, I.A.P.:
 * - Paleta institucional: Azul Escandón (#004687), Azul Cielo (#0088C9), Gris Fila (#F4F6F9), Azul Totales (#E0EAF4)
 * - Encabezados con metadatos, resumen financiero y KPIs
 * - Celdas con tipografía Calibri, bordes nítidos, formateo numérico de moneda ($#,##0.00) y porcentajes (0.00%)
 * - Píldoras de estado semánticas (Verde Aprobado, Rojo Excluido)
 * - Fila de totales institucionales y autofiltros nativos de Excel
 */
import ExcelJS from 'exceljs';

export const BRAND_COLORS = {
  azulOscuro:    'FF004687',
  azulClaro:     'FF0088C9',
  blanco:        'FFFFFFFF',
  grisFila:      'FFF4F6F9',
  grisTexto:     'FF475569',
  azulTotales:   'FFE0EAF4',
  verdeMoneda:   'FF15803D',
  ambarLote:     'FFB45309',
  rojoCrit:      'FF991B1B',
  rojoFondo:     'FFFEE2E2',
  rojoTxt:       'FF991B1B',
  amarilloFondo: 'FFFEF3C7',
  amarilloTxt:   'FF92400E',
  verdeFondo:    'FFD1FAE5',
  verdeTxt:      'FF065F46',
  bordeGris:     'FFD1D5DB',
  bordeHeader:   'FF003366'
};

/**
 * Aplica el diseño institucional a una hoja de cálculo
 */
export function applySheetInstitutionalStyle(sheet, {
  titulo = 'HOSPITAL ESCANDÓN',
  subtitulo = 'Reporte de Inteligencia de Negocios — Plataforma BI',
  periodo = '',
  resumen = null,
  columnas = [],
  filas = [],
  totales = null,
  meta = null
}) {
  const numCols = columnas.length;
  if (numCols === 0) return;

  // ── Fila 1: Título Institucional (Azul Marino) ──
  const titleRow = sheet.addRow([titulo]);
  sheet.mergeCells(titleRow.number, 1, titleRow.number, numCols);
  titleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_COLORS.azulOscuro } };
  titleRow.getCell(1).font = { color: { argb: BRAND_COLORS.blanco }, bold: true, size: 13, name: 'Calibri' };
  titleRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  titleRow.height = 30;

  // ── Fila 2: Subtítulo (Azul Cielo) ──
  const subRow = sheet.addRow([subtitulo]);
  sheet.mergeCells(subRow.number, 1, subRow.number, numCols);
  subRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_COLORS.azulClaro } };
  subRow.getCell(1).font = { color: { argb: BRAND_COLORS.blanco }, bold: true, size: 10, name: 'Calibri' };
  subRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  subRow.height = 22;

  // ── Fila 3: Metadatos de Emisión ──
  const infoFragments = [];
  if (periodo) infoFragments.push(`Período: ${periodo}`);
  infoFragments.push(`Fecha de emisión: ${new Date().toLocaleString('es-MX')}`);
  infoFragments.push(`Total registros: ${filas.length}`);
  if (meta?.usuario) infoFragments.push(`Usuario: ${meta.usuario}`);
  
  const infoRow = sheet.addRow([infoFragments.join('   |   ')]);
  sheet.mergeCells(infoRow.number, 1, infoRow.number, numCols);
  infoRow.getCell(1).font = { color: { argb: BRAND_COLORS.grisTexto }, size: 9, name: 'Calibri', italic: true };
  infoRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  infoRow.height = 20;

  // ── Fila 4: Resumen Financiero / Operativo (si aplica) ──
  if (resumen && Object.keys(resumen).length > 0) {
    const resumenText = Object.entries(resumen).map(([k, v]) => `${k}: ${v}`).join('   |   ');
    const resRow = sheet.addRow([resumenText]);
    sheet.mergeCells(resRow.number, 1, resRow.number, numCols);
    resRow.getCell(1).font = { color: { argb: BRAND_COLORS.azulOscuro }, size: 9.5, name: 'Calibri', bold: true };
    resRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    resRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_COLORS.azulTotales } };
    resRow.height = 22;
  }

  // ── Separador ──
  const sepRow = sheet.addRow([]);
  sepRow.height = 6;

  // ── Encabezados de Columna ──
  const headerValues = columnas.map(c => c.header);
  const headerRow = sheet.addRow(headerValues);
  const headerRowNum = headerRow.number;
  headerRow.height = 28;

  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_COLORS.azulOscuro } };
    cell.font = { color: { argb: BRAND_COLORS.blanco }, bold: true, size: 9.5, name: 'Calibri' };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top:    { style: 'thin', color: { argb: BRAND_COLORS.bordeHeader } },
      bottom: { style: 'thin', color: { argb: BRAND_COLORS.bordeHeader } },
      left:   { style: 'thin', color: { argb: BRAND_COLORS.bordeHeader } },
      right:  { style: 'thin', color: { argb: BRAND_COLORS.bordeHeader } },
    };
  });

  // ── Configurar anchos de columna ──
  columnas.forEach((c, i) => {
    sheet.getColumn(i + 1).width = c.width || 18;
  });

  // ── Filas de Datos con Estilo Institucional ──
  const thinBorder = {
    top:    { style: 'hair', color: { argb: BRAND_COLORS.bordeGris } },
    bottom: { style: 'hair', color: { argb: BRAND_COLORS.bordeGris } },
    left:   { style: 'hair', color: { argb: BRAND_COLORS.bordeGris } },
    right:  { style: 'hair', color: { argb: BRAND_COLORS.bordeGris } },
  };

  filas.forEach((row, idx) => {
    const rowValues = columnas.map(c => {
      const val = row[c.key];
      return val !== undefined && val !== null ? val : '';
    });
    const excelRow = sheet.addRow(rowValues);
    excelRow.height = 20;

    excelRow.eachCell((cell, colNumber) => {
      const colDef = columnas[colNumber - 1];
      cell.font = { size: 9, name: 'Calibri', color: { argb: 'FF1E293B' } };
      cell.border = thinBorder;
      cell.alignment = { vertical: 'middle', horizontal: colDef.align || 'left' };

      // Fondo alternado
      if (idx % 2 === 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_COLORS.grisFila } };
      }

      // Formato numérico de moneda
      if (colDef.type === 'currency' || colDef.isCurrency) {
        cell.numFmt = '"$"#,##0.00;[Red]("$"#,##0.00);"-"';
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
        if (typeof cell.value === 'number' && cell.value > 0) {
          cell.font = { size: 9, name: 'Calibri', bold: true, color: { argb: BRAND_COLORS.verdeMoneda } };
        }
      }

      // Formato numérico entero o decimal
      if (colDef.type === 'number') {
        cell.numFmt = colDef.decimals ? '#,##0.00' : '#,##0';
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      }

      // Formato de porcentaje
      if (colDef.type === 'percent') {
        cell.numFmt = '0.00%';
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      }

      // Resaltado de estados de auditoría
      if (colDef.key === 'estado' || colDef.key === 'Estatus' || colDef.key === 'Elegibilidad') {
        const strVal = String(cell.value || '').toUpperCase();
        if (strVal.includes('APROBADO') || strVal.includes('INCLUIDO') || strVal.includes('ELEGIBLE') || strVal.includes('SÍ') || strVal.includes('SI')) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_COLORS.verdeFondo } };
          cell.font = { size: 9, name: 'Calibri', bold: true, color: { argb: BRAND_COLORS.verdeTxt } };
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        } else if (strVal.includes('EXCLUIDO') || strVal.includes('NO ELEGIBLE') || strVal.includes('NO')) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_COLORS.rojoFondo } };
          cell.font = { size: 9, name: 'Calibri', bold: true, color: { argb: BRAND_COLORS.rojoTxt } };
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        }
      }
    });
  });

  // ── Fila de Totales Institucionales (si aplica) ──
  if (totales) {
    const totalRowValues = columnas.map(c => totales[c.key] ?? '');
    const totalRow = sheet.addRow(totalRowValues);
    totalRow.height = 24;

    totalRow.eachCell((cell, colNumber) => {
      const colDef = columnas[colNumber - 1];
      cell.font = { bold: true, color: { argb: BRAND_COLORS.azulOscuro }, size: 9.5, name: 'Calibri' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_COLORS.azulTotales } };
      cell.alignment = { vertical: 'middle', horizontal: colDef.align || (colDef.type === 'currency' ? 'right' : 'center') };
      cell.border = {
        top:    { style: 'medium', color: { argb: BRAND_COLORS.azulOscuro } },
        bottom: { style: 'double', color: { argb: BRAND_COLORS.azulOscuro } },
      };

      if (colDef.type === 'currency' || colDef.isCurrency) {
        cell.numFmt = '"$"#,##0.00;[Red]("$"#,##0.00);"-"';
      } else if (colDef.type === 'number') {
        cell.numFmt = '#,##0';
      }
    });
  }

  // ── Autofilter en la fila de encabezados ──
  sheet.autoFilter = {
    from: { row: headerRowNum, column: 1 },
    to:   { row: headerRowNum, column: numCols },
  };
}

/**
 * Genera y descarga un libro Excel completo con formato institucional Escandón
 */
export async function downloadInstitutionalExcel({
  filename = 'Reporte_Hospital_Escandon.xlsx',
  sheets = []
}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Hospital Escandón — Plataforma BI';
  workbook.created = new Date();

  sheets.forEach(sheetDef => {
    const sheet = workbook.addWorksheet(sheetDef.name || 'Datos', {
      views: [{ showGridLines: true }]
    });
    applySheetInstitutionalStyle(sheet, sheetDef);
  });

  // Exportar y disparar descarga en el navegador
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
