import ExcelJS from 'exceljs';
import { applySheetInstitutionalStyle, BRAND_COLORS } from './excelInstitutionalGenerator.js';

export const SALES_STATUS_LABELS = { FACTURADA: 'Facturada', NO_FACTURADA: 'No facturada' };
const MONEY_FORMAT = '"$"#,##0.00;[Red]("$"#,##0.00);"$"0.00';
const NUMBER_FORMAT = '#,##0.##;[Red](#,##0.##);0';
const statusStyles = {
  Facturada: { background: BRAND_COLORS.verdeFondo, color: BRAND_COLORS.verdeTxt },
  'No facturada': { background: BRAND_COLORS.rojoFondo, color: BRAND_COLORS.rojoTxt },
};
const sum = values => values.reduce((total, value) => total + Number(value || 0), 0);
const formula = (text, result) => ({ formula: text, result });

export function salesDefaultPeriod(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = key => parts.find(value => value.type === key).value;
  const endDate = `${part('year')}-${part('month')}-${part('day')}`;
  return { startDate: `${part('year')}-${Number(part('month')) >= 4 ? '04' : '01'}-01`, endDate };
}

export function salesDateLabel(value) {
  if (!value) return 'Sin fecha';
  const raw = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw.split('-').reverse().join('/') : 'Sin fecha';
}

export function salesDocumentLabel(row) {
  const kind = ({ Orders: 'Orden', DeliveryNotes: 'Entrega', Invoices: 'Factura', CreditNotes: 'Nota de crédito' })[row.entity] || 'Documento';
  const document = typeof row.document === 'object' ? row.document?.document || row.document?.docNum || row.document?.DocNum : row.document;
  return `${kind} ${document ?? 'sin número'}`;
}

export function linkedSalesInvoicesLabel(invoices = []) {
  return invoices.map(item => typeof item === 'object' ? `${item.document ?? item.documentId ?? 'sin número'}${item.date ? ` (${salesDateLabel(item.date)})` : ''}` : String(item)).join(', ');
}

export function filterSalesRows(rows, { status = 'ALL', search = '', bloodBank = false } = {}) {
  const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-MX');
  const term = normalized(search.trim());
  return rows.filter(row => (!bloodBank || row.isBloodBank === true)
    && (status === 'ALL' || row.status === status)
    && (!term || normalized(`${row.code} ${row.description}`).includes(term)));
}

function finishSheet(sheet, columns, notes = []) {
  const header = sheet.autoFilter.from.row;
  sheet.views = [{ state: 'frozen', xSplit: Math.min(2, columns.length - 1), ySplit: header, showGridLines: false }];
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, printTitlesRow: `${header}:${header}` };
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber < header) {
      row.getCell(1).alignment = { ...row.getCell(1).alignment, wrapText: true };
      row.height = Math.max(row.height || 20, rowNumber === 3 ? 32 : 26);
      return;
    }
    let lines = 1;
    row.eachCell((cell, columnNumber) => {
      const column = columns[columnNumber - 1];
      cell.alignment = { ...cell.alignment, wrapText: true, vertical: 'middle' };
      if (column?.type === 'currency') cell.numFmt = MONEY_FORMAT;
      if (column?.type === 'number') cell.numFmt = NUMBER_FORMAT;
      const content = typeof cell.value === 'object' ? '' : String(cell.value ?? '');
      lines = Math.max(lines, Math.ceil(content.length / Math.max(10, (column?.width || 18) - 3)));
    });
    row.height = Math.max(rowNumber === header ? 42 : 23, lines * 14);
  });
  for (const note of notes.filter(Boolean)) {
    const row = sheet.addRow([note]);
    sheet.mergeCells(row.number, 1, row.number, columns.length);
    row.getCell(1).font = { name: 'Calibri', size: 10, color: { argb: BRAND_COLORS.grisTexto } };
    row.getCell(1).alignment = { wrapText: true, vertical: 'middle' };
    row.height = 32;
  }
}

function salesQueryMetadata(sheet, data, count, user) {
  const cutoff = new Date(data.period.asOf).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'short', timeStyle: 'short' });
  sheet.getCell('A3').value = `Periodo: ${salesDateLabel(data.period.startDate)} al ${salesDateLabel(data.period.endDate)}   |   Consulta: ${cutoff} (Ciudad de México)   |   Registros: ${count}${user ? `   |   Usuario: ${user}` : ''}`;
}

function addSalesSheet(workbook, name, rows, data, user) {
  const months = data.period.months;
  const columns = [
    { key: 'code', header: 'Artículo / código', width: 22 },
    { key: 'description', header: 'Descripción del artículo', width: 54 },
    { key: 'status', header: 'Estado', width: 20, statusStyles },
    ...months.flatMap(month => [
      { key: `${month.key}_quantity`, header: `${month.label}\nCantidad`, type: 'number', width: 19 },
      { key: `${month.key}_net`, header: `${month.label}\nMonto sin IVA`, type: 'currency', width: 22 },
    ]),
    { key: 'quantity', header: 'Acumulado\nCantidad', type: 'number', width: 19 },
    { key: 'netAmount', header: 'Acumulado\nMonto sin IVA', type: 'currency', width: 23 },
  ];
  const values = rows.map(row => ({ code: String(row.code ?? ''), description: row.description,
    status: SALES_STATUS_LABELS[row.status] || row.status,
    ...Object.fromEntries(months.flatMap(month => {
      const value = row.months.find(item => item.key === month.key);
      return [[`${month.key}_quantity`, Number(value?.quantity || 0)], [`${month.key}_net`, Number(value?.netAmount || 0)]];
    })), quantity: row.quantity, netAmount: row.netAmount,
  }));
  const sheet = workbook.addWorksheet(name);
  const period = `${salesDateLabel(data.period.startDate)} al ${salesDateLabel(data.period.endDate)}`;
  applySheetInstitutionalStyle(sheet, { titulo: 'HOSPITAL ESCANDÓN', subtitulo: `Ventas hospitalarias · ${name}`, periodo: period,
    meta: { usuario: user }, columnas: columns, filas: values,
    resumen: { 'Moneda': 'MXN sin IVA', 'Facturada': 'Verde', 'No facturada': 'Rojo' }, totales: { code: 'TOTAL' } });
  salesQueryMetadata(sheet, data, rows.length, user);
  const first = sheet.autoFilter.from.row + 1;
  const last = first + rows.length - 1;
  values.forEach((row, index) => {
    const excelRow = sheet.getRow(first + index);
    const references = suffix => months.map((_, monthIndex) => `${sheet.getColumn(4 + monthIndex * 2 + suffix).letter}${excelRow.number}`);
    excelRow.getCell(columns.length - 1).value = formula(`SUM(${references(0).join(',')})`, sum(months.map(month => row[`${month.key}_quantity`])));
    excelRow.getCell(columns.length).value = formula(`SUM(${references(1).join(',')})`, sum(months.map(month => row[`${month.key}_net`])));
    const color = rows[index].status === 'NO_FACTURADA' ? BRAND_COLORS.rojoTxt : BRAND_COLORS.verdeTxt;
    const background = rows[index].status === 'NO_FACTURADA' ? 'FFFFF1F2' : 'FFF0FDF4';
    excelRow.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: background } }; });
    columns.forEach((column, i) => {
      if (column.type === 'currency') excelRow.getCell(i + 1).font = { name: 'Calibri', size: 9, color: { argb: color } };
    });
     
    excelRow.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: statusStyles[row.status]?.background || background } };
  });
  columns.forEach((column, index) => {
    if (!['number', 'currency'].includes(column.type)) return;
    const letter = sheet.getColumn(index + 1).letter;
    sheet.getCell(last + 1, index + 1).value = formula(rows.length ? `SUBTOTAL(109,${letter}${first}:${letter}${last})` : '0', sum(values.map(row => row[column.key])));
  });
  finishSheet(sheet, columns, ['Facturadas: facturas menos notas de crédito. No facturadas: saldo abierto actual de órdenes y entregas del periodo.',
    'Banco de Sangre está incluido en General. Los importes por revisar se presentan separados y no se suman a las no facturadas.']);
  return { sheet, first, last, columns };
}

export function buildHospitalSalesWorkbook(data, { user = '' } = {}) {
  if (data?.complete !== true || !Array.isArray(data?.rows) || !data?.period?.months?.length) throw new Error('Consulta nuevamente el periodo completo antes de descargar.');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Hospital Escandón';
  workbook.created = new Date(data.period.asOf || Date.now());
  workbook.calcProperties.fullCalcOnLoad = true;
  const general = addSalesSheet(workbook, 'General', data.rows, data, user);
  addSalesSheet(workbook, 'Banco de Sangre', data.rows.filter(row => row.isBloodBank === true), data, user);
  const period = `${salesDateLabel(data.period.startDate)} al ${salesDateLabel(data.period.endDate)}`;
  const monthlyColumns = [
    { key: 'month', header: 'Mes', width: 25 },
    { key: 'billedQuantity', header: 'Facturada\nCantidad', type: 'number', width: 17 },
    { key: 'billedNet', header: 'Facturada\nNeto sin IVA', type: 'currency', width: 22 },
    { key: 'pendingQuantity', header: 'No facturada\nCantidad', type: 'number', width: 18 },
    { key: 'pendingNet', header: 'No facturada\nNeto sin IVA', type: 'currency', width: 22 },
    { key: 'cumulativeBilled', header: 'Acumulado\nFacturada', type: 'currency', width: 23 },
    { key: 'cumulativePending', header: 'Acumulado\nNo facturada', type: 'currency', width: 23 },
    { key: 'headerNet', header: 'Venta documental\nNeta sin IVA', type: 'currency', width: 23 },
    { key: 'difference', header: 'Diferencia con\nventa documental', type: 'currency', width: 23 },
    { key: 'vat', header: 'IVA documental', type: 'currency', width: 21 },
    { key: 'total', header: 'Total documental\ncon IVA', type: 'currency', width: 23 },
    { key: 'invoices', header: 'Facturas', type: 'number', width: 16 },
    { key: 'creditNotes', header: 'Notas de crédito', type: 'number', width: 18 },
  ];
  const monthlyValues = data.period.months.map(month => ({ ...data.monthly.find(row => row.month === month.key), month: month.label }));
  const monthly = workbook.addWorksheet('Resumen mensual');
  applySheetInstitutionalStyle(monthly, { titulo: 'HOSPITAL ESCANDÓN', subtitulo: 'Ventas hospitalarias · Resumen mensual', periodo: period,
    columnas: monthlyColumns, filas: monthlyValues, resumen: { 'Moneda': 'MXN', 'Neto': 'Sin IVA' }, totales: { month: 'TOTAL' } });
  salesQueryMetadata(monthly, data, monthlyValues.length, user);
  const firstMonthly = monthly.autoFilter.from.row + 1;
  const generalRange = letter => `'General'!$${letter}$${general.first}:$${letter}$${general.last}`;
  monthlyValues.forEach((row, index) => {
    const rowNumber = firstMonthly + index;
    for (const [column, offset, status, key] of [[2, 0, 'Facturada', 'billedQuantity'], [3, 1, 'Facturada', 'billedNet'], [4, 0, 'No facturada', 'pendingQuantity'], [5, 1, 'No facturada', 'pendingNet']]) {
      const letter = general.sheet.getColumn(4 + index * 2 + offset).letter;
      monthly.getCell(rowNumber, column).value = formula(data.rows.length ? `SUMIF(${generalRange('C')},"${status}",${generalRange(letter)})` : '0', Number(row[key] || 0));
    }
    monthly.getCell(rowNumber, 6).value = formula(index ? `F${rowNumber - 1}+C${rowNumber}` : `C${rowNumber}`, Number(row.cumulativeBilled || 0));
    monthly.getCell(rowNumber, 7).value = formula(index ? `G${rowNumber - 1}+E${rowNumber}` : `E${rowNumber}`, Number(row.cumulativePending || 0));
    monthly.getCell(rowNumber, 9).value = formula(`C${rowNumber}-H${rowNumber}`, Number(row.billedNet || 0) - Number(row.headerNet || 0));
  });
  monthlyColumns.forEach((column, index) => {
    if (index === 0) return;
    const letter = monthly.getColumn(index + 1).letter;
    const last = firstMonthly + monthlyValues.length - 1;
    const isCumulative = index === 5 || index === 6;
    monthly.getCell(last + 1, index + 1).value = formula(isCumulative ? `${letter}${last}` : `SUM(${letter}${firstMonthly}:${letter}${last})`,
      isCumulative ? Number(monthlyValues.at(-1)?.[column.key] || 0) : sum(monthlyValues.map(row => row[column.key])));
  });
  finishSheet(monthly, monthlyColumns, ['La diferencia compara el detalle de artículos facturado neto con el neto documental. El IVA y total documental se muestran como controles separados.']);

  const reviewColumns = [
    { key: 'code', header: 'Artículo / código', width: 22 }, { key: 'description', header: 'Descripción del artículo', width: 52 },
    { key: 'date', header: 'Fecha', width: 16 }, { key: 'document', header: 'Documento de origen', width: 25 },
    { key: 'quantity', header: 'Cantidad', type: 'number', width: 16 }, { key: 'netAmount', header: 'Monto sin IVA', type: 'currency', width: 23 },
    { key: 'reason', header: 'Motivo de revisión', width: 65 }, { key: 'linkedInvoices', header: 'Facturas relacionadas', width: 60 },
  ];
  const reviewValues = (data.reviewRows || []).map(row => ({ ...row, code: String(row.code ?? ''), date: salesDateLabel(row.date), document: salesDocumentLabel(row), linkedInvoices: linkedSalesInvoicesLabel(row.linkedInvoices) }));
  const review = workbook.addWorksheet('Por revisar');
  applySheetInstitutionalStyle(review, { titulo: 'HOSPITAL ESCANDÓN', subtitulo: 'Ventas hospitalarias · Por revisar', periodo: period,
    columnas: reviewColumns, filas: reviewValues, resumen: { 'Tratamiento': 'Fuera de las no facturadas para evitar duplicidad' }, totales: { code: 'TOTAL' } });
  salesQueryMetadata(review, data, reviewValues.length, user);
  const reviewFirst = review.autoFilter.from.row + 1;
  for (const [index, key] of [[5, 'quantity'], [6, 'netAmount']]) {
    const letter = review.getColumn(index).letter;
    review.getCell(reviewFirst + reviewValues.length, index).value = formula(reviewValues.length ? `SUBTOTAL(109,${letter}${reviewFirst}:${letter}${reviewFirst + reviewValues.length - 1})` : '0', sum(reviewValues.map(row => row[key])));
  }
  reviewValues.forEach((_, index) => review.getRow(reviewFirst + index).eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_COLORS.amarilloFondo } }; }));
  finishSheet(review, reviewColumns, ['Estas partidas requieren conciliación. Su importe no se suma a las no facturadas.', ...(data.warnings || [])]);
  return workbook;
}

export async function downloadHospitalSalesWorkbook(data, options) {
  const workbook = buildHospitalSalesWorkbook(data, options);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Ventas_Hospital_${data.period.startDate}_al_${data.period.endDate}.xlsx`;
  document.body.appendChild(link);
  try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
