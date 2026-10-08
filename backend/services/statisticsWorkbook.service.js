'use strict';

// Generador de la aplicación: reutiliza ExcelJS, incluido en el despliegue.
const ExcelJS = require('exceljs');
const { SECTIONS } = require('./statisticsCatalog');

const BLUE = '004687';
const CURRENCY = '"$"#,##0.00;[Red]("$"#,##0.00);"$"0.00';
const NUMBER = '#,##0;[Red](#,##0);0';
const DECIMAL = '#,##0.00;[Red](#,##0.00);0.00';
const numericFormat = value => Number.isInteger(value) ? NUMBER : DECIMAL;
const LABELS = {
  FolioAtencion: 'Folio de atención', Fecha: 'Fecha', FechaCargo: 'Fecha del cargo',
  Codigo: 'Código', Servicio: 'Servicio', Cantidad: 'Cantidad neta', IngresoNeto: 'Importe sin IVA',
  IngresoOrden: 'Importe de orden sin IVA', Medico: 'Médico', NumeroMedico: 'Número de médico',
  TipoAtencion: 'Tipo de atención', TipoDocumento: 'Tipo de documento', Documento: 'Documento',
  Categoria: 'Categoría', Grupo: 'Grupo', Paciente: 'Paciente', Genero: 'Sexo',
  FechaIngreso: 'Ingreso', FechaEgreso: 'Egreso', NumeroCargo: 'Número de cargo',
  CantidadOriginal: 'Cantidad original', Devuelto: 'Devuelto', Ranking: 'Posición',
  Cuentas: 'Cuentas', Ordenes: 'Órdenes', Total: 'Importe', quantity: 'Cantidad',
  IngresoTotal: 'Importe total', NoPaciente: 'Número de paciente', FolioEstancia: 'Folio de estancia',
  UnidadServicio: 'Unidad de servicio', GrupoCodigo: 'Código de grupo', ClasificacionesCatalogo: 'Clasificaciones del catálogo',
  EstadoDocumento: 'Estado del documento', AtencionesMultiples: 'Atenciones múltiples', DocumentoId: 'Identificador de documento',
  CodigoCliente: 'Código de cliente', BaseAtribucion: 'Fuente de identificación', Linea: 'Línea',
  DiasEstancia: 'Días de estancia', Defuncion: 'Defunción', EstadoCuenta: 'Estado de cuenta', FechaFin: 'Fecha de término'
};

function styleSheet(sheet, title, report, columns) {
  const count = Math.max(columns.length, 4);
  sheet.properties.defaultRowHeight = 21;
  sheet.views = [{ state: 'frozen', ySplit: 7, xSplit: 0 }];
  sheet.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:7' };
  sheet.headerFooter.oddFooter = 'Hospital Escandón &R Página &P de &N';
  sheet.columns = columns.map(key => ({ key, width: /Servicio|Medico|Criterio|Observacion|Descripción|Indicador/i.test(key) ? 46 : /Fecha|Ingreso|Importe|Total/i.test(key) ? 21 : 24 }));
  sheet.mergeCells(1, 1, 1, count);
  sheet.getCell('A1').value = title;
  sheet.getCell('A1').font = { name: 'Calibri', size: 17, bold: true, color: { argb: 'FFFFFF' } };
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
  sheet.getRow(1).height = 36;
  sheet.mergeCells(2, 1, 2, count);
  sheet.getCell('A2').value = `Hospital Escandón · Del ${report.period.startDate} al ${report.period.endDate} (ambos incluidos)`;
  sheet.getCell('A2').font = { name: 'Calibri', size: 11, color: { argb: BLUE } };
  sheet.getRow(2).height = 24;
  sheet.mergeCells(3, 1, 3, count);
  sheet.getCell('A3').value = `Consultado: ${new Date(report.generatedAt).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}. Importes en MXN.`;
  sheet.getCell('A3').font = { name: 'Calibri', size: 10, color: { argb: '475569' } };
  sheet.getRow(7).values = columns.map(key => LABELS[key] || key.replace(/([a-záéíóúñ])([A-ZÁÉÍÓÚÑ])/g, '$1 $2'));
  sheet.getRow(7).height = 32;
  sheet.getRow(7).eachCell(cell => {
    cell.font = { name: 'Calibri', bold: true, color: { argb: 'FFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    cell.alignment = { wrapText: true, vertical: 'middle' };
  });
}

function addTableRows(sheet, columns, rows) {
  for (const source of rows) {
    const row = sheet.addRow(columns.map(key => {
      const value = source[key] ?? null;
      // Excel almacena hora de pared, sin zona horaria. Preservar la hora local de Vertical.
      if (value instanceof Date) return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate(), value.getHours(), value.getMinutes(), value.getSeconds()));
      if (key.startsWith('Fecha') && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00Z`);
      return value === '' ? null : value;
    }));
    row.eachCell({ includeEmpty: true }, (cell, index) => {
      cell.font = { name: 'Calibri', size: 10 };
      cell.alignment = { vertical: 'top', wrapText: true };
      if (row.number % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F0F5FA' } };
      if (typeof cell.value === 'number') cell.numFmt = /Ingreso|Importe|Monto|TotalCuenta|Precio|Saldo|IVA/.test(columns[index - 1]) ? CURRENCY
        : /Folio|Numero|NoPaciente|Documento|GrupoCodigo|Ranking|Linea/.test(columns[index - 1]) ? '0' : numericFormat(cell.value);
      if (cell.value instanceof Date) cell.numFmt = 'dd/mm/yyyy hh:mm';
    });
    // Las descripciones extensas se leen sin recortar texto.
    row.height = Math.max(22, ...columns.map((key, index) => {
      const value = source[key];
      const length = value instanceof Date ? 16 : value && typeof value === 'object' && 'formula' in value ? String(value.result).length : String(value ?? '').length;
      return Math.ceil(length / Math.max(12, sheet.getColumn(index + 1).width - 3)) * 14 + 8;
    }));
  }
  sheet.autoFilter = { from: { row: 7, column: 1 }, to: { row: Math.max(7, sheet.rowCount), column: columns.length } };
  sheet.pageSetup.printArea = `A1:${sheet.getColumn(Math.max(columns.length, 4)).letter}${Math.max(8, sheet.rowCount)}`;
}

async function createStatisticsWorkbook(report) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Hospital Escandón';
  workbook.subject = 'Estadístico institucional por fechas';
  workbook.created = new Date(report.generatedAt);
  workbook.calcProperties.fullCalcOnLoad = true;
  const summary = workbook.addWorksheet('Resumen');
  const summaryColumns = ['Indicador', 'Resultado', 'Unidad', 'Criterio', 'Observaciones'];
  styleSheet(summary, 'Estadístico institucional', report, summaryColumns);
  summary.getCell('A4').value = report.warnings.length ? 'Hay observaciones que revisar antes de enviar.' : 'Periodo consultado completo.';
  summary.mergeCells('A4:E4');
  summary.getCell('A4').font = { bold: true, color: { argb: report.warnings.length ? '92400E' : BLUE } };
  const summaryRows = [];

  for (const definition of SECTIONS) {
    const section = report.sections[definition.key];
    const sheet = workbook.addWorksheet(definition.sheet);
    const rows = section.rows || [];
    const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
    if (!columns.length) columns.push('Observaciones');
    styleSheet(sheet, definition.label, report, columns);
    sheet.getCell('A4').value = 'Resultado';
    sheet.getCell('B4').value = section.quantity ?? 'No disponible';
    sheet.getCell('B4').numFmt = definition.unit === 'MXN' ? CURRENCY : numericFormat(section.quantity);
    sheet.getCell('C4').value = section.unit || definition.unit;
    sheet.getColumn(2).width = Math.max(sheet.getColumn(2).width || 0, 22);
    sheet.getColumn(3).width = Math.max(sheet.getColumn(3).width || 0, 30);
    sheet.getRow(4).height = 34;
    for (const column of [1, 2, 3]) sheet.getCell(4, column).alignment = { wrapText: true, vertical: 'middle' };
    sheet.mergeCells(5, 1, 5, Math.max(columns.length, 4));
    sheet.getCell('A5').value = section.criterion;
    sheet.getCell('A5').alignment = { wrapText: true, vertical: 'middle' };
    sheet.getRow(5).height = 42;
    sheet.mergeCells(6, 1, 6, Math.max(columns.length, 4));
    sheet.getCell('A6').value = (section.warnings || []).join(' ');
    sheet.getCell('A6').alignment = { wrapText: true, vertical: 'middle' };
    sheet.getCell('A6').font = { color: { argb: '92400E' }, size: 10 };
    sheet.getRow(6).height = section.warnings?.length ? 44 : 8;
    addTableRows(sheet, columns, rows.length ? rows : [{ Observaciones: section.quantity === null ? 'No se puede determinar este resultado con la información disponible.' : 'Sin registros en este periodo.' }]);
    summaryRows.push({
      Indicador: definition.label,
      Resultado: section.quantity === null ? 'No disponible' : { formula: `'${definition.sheet.replace(/'/g, "''")}'!B4`, result: section.quantity },
      Unidad: section.unit || definition.unit, Criterio: section.criterion,
      Observaciones: (section.warnings || []).join(' ')
    });
  }
  addTableRows(summary, summaryColumns, summaryRows);
  summary.getColumn(1).width = 48;
  summary.getColumn(2).width = 21;
  summary.getColumn(4).width = 70;
  summary.getColumn(5).width = 58;
  summaryRows.forEach((row, index) => { summary.getCell(index + 8, 2).numFmt = row.Unidad === 'MXN' ? CURRENCY : numericFormat(row.Resultado?.result); });
  const orders = workbook.addWorksheet('Órdenes por médico');
  const orderColumns = ['Fecha', 'Documento', 'FolioAtencion', 'TipoAtencion', 'Medico', 'NumeroMedico', 'IngresoTotal', 'IVA', 'EstadoDocumento', 'AtencionesMultiples'];
  styleSheet(orders, 'Órdenes que sustentan los Top 10', report, orderColumns);
  orders.mergeCells('A5:J5');
  orders.getCell('A5').value = 'Una fila por orden vigente. Incluye todos los médicos de hospitalización y urgencias para revisar la clasificación y el importe fuera del Top 10.';
  orders.getCell('A5').alignment = { wrapText: true };
  orders.getRow(5).height = 32;
  addTableRows(orders, orderColumns, report.doctorDocuments || []);
  const controls = workbook.addWorksheet('Conciliación manual');
  const controlColumns = ['Indicador', 'Manual', 'Generado', 'Diferencia', 'Unidad', 'Referencia'];
  styleSheet(controls, 'Comparación con el archivo manual', report, controlColumns);
  controls.mergeCells('A5:F5');
  controls.getCell('A5').value = report.controls?.length ? 'Referencias de los archivos base revisadas el 7 de octubre de 2026. La diferencia compara la consulta actual contra esa referencia.' : 'No hay un control manual cargado para este periodo exacto. No se afirma coincidencia con un archivo mensual.';
  controls.getCell('A5').alignment = { wrapText: true };
  controls.getRow(5).height = 34;
  controls.getColumn(6).width = 85;
  addTableRows(controls, controlColumns, (report.controls || []).map((row, index) => ({ ...row,
    Generado: row.Generado ?? 'No disponible',
    Diferencia: row.Diferencia === null ? 'No disponible' : { formula: `C${index + 8}-B${index + 8}`, result: row.Diferencia }
  })));
  (report.controls || []).forEach((row, index) => {
    for (const column of [2, 3, 4]) controls.getCell(index + 8, column).numFmt = row.Unidad === 'MXN' ? CURRENCY : NUMBER;
    if (row.Diferencia) controls.getCell(index + 8, 4).font = { bold: true, color: { argb: 'B45309' } };
  });
  const criteria = workbook.addWorksheet('Criterios y revisión');
  const reviewRows = [
    { Tema: 'Fecha de corte', Criterio: 'Cada fecha final incluye el día completo. No se prorratean los totales mensuales históricos.' },
    { Tema: 'Cantidades', Criterio: 'Se muestran servicios netos, atenciones o cuentas según la unidad de cada indicador. Una solicitud no demuestra por sí sola un estudio realizado.' },
    { Tema: 'Ingresos', Criterio: report.financialCriterion },
    { Tema: 'Top 10', Criterio: 'Dos clasificaciones independientes por importe: hospitalización y urgencias. El total de cada Top 10 comprende sólo los médicos mostrados. Las órdenes de todos los médicos están en Órdenes por médico. IP significa hospitalización; ER, urgencias.' },
    { Tema: 'Ambulatorios', Criterio: 'Procedimientos registrados en atenciones cerradas cuyo ingreso y egreso ocurrieron el mismo día. Se conservan ambas fechas. Varias técnicas dentro de una estancia no se presentan como pacientes distintos.' },
    { Tema: 'Estancia', Criterio: 'Los servicios de estancia pueden tener unidades distintas; el detalle conserva cada código. La cantidad de servicios no se etiqueta como días cama.' },
    { Tema: 'Nacimientos', Criterio: 'La edad y el ingreso a cunero no prueban que el nacimiento ocurrió en el hospital. Un resultado no verificable se conserva como No disponible.' },
    ...(report.reconciliation || []).map(item => ({ Tema: item.label, Criterio: item.description })),
    ...report.warnings.map(warning => ({ Tema: 'Observación', Criterio: warning }))
  ];
  styleSheet(criteria, 'Criterios de cálculo y revisión', report, ['Tema', 'Criterio']);
  criteria.getColumn(1).width = 32;
  criteria.getColumn(2).width = 105;
  addTableRows(criteria, ['Tema', 'Criterio'], reviewRows);
  return workbook.xlsx.writeBuffer();
}

module.exports = { createStatisticsWorkbook };
