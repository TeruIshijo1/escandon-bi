'use strict';

/**
 * statisticsWorkbook.service.js — Generador del Estadístico Institucional Excel
 * Hospital Escandón BI Platform
 * Diseñado para personal médico, contable y directivo del hospital.
 */

const ExcelJS = require('exceljs');
const { SECTIONS } = require('./statisticsCatalog');

/* ══════════════════════════════════════════════════════════════
   ESTILO INSTITUCIONAL HOSPITAL ESCANDÓN
   Paleta corporativa armonizada con export.routes.js
══════════════════════════════════════════════════════════════ */
const BRAND = {
  azulOscuro:   'FF004687', // Azul marino institucional Hospital Escandón
  azulClaro:    'FF0088C9', // Azul cielo secundario
  blanco:       'FFFFFFFF',
  grisFila:     'FFF8FAFC', // Fondo alternado suave (zebra)
  grisInfo:     'FFF1F5F9', // Fondo de metadatos
  grisTexto:    'FF475569',
  azulTotales:  'FFE0EAF4', // Fondo institucional de totales y KPI
  verdeMoneda:  'FF15803D',
  ambarAviso:   'FFB45309',
  amarilloFondo:'FFFEF3C7',
  amarilloTxt:  'FF92400E',
  bordeHair:    'FFCBD5E1', // Borde hairline para celdas
  bordeHeader:  'FF003366',
  textoOscuro:  'FF1E293B',
  textoMuted:   'FF64748B'
};

const CURRENCY = '"$"#,##0.00;[Red]("$"#,##0.00);"$"0.00';
const NUMBER = '#,##0;[Red](#,##0);0';
const DECIMAL = '#,##0.00;[Red](#,##0.00);0.00';
const numericFormat = value => Number.isInteger(value) ? NUMBER : DECIMAL;

/* ══════════════════════════════════════════════════════════════
   ENCABEZADOS EN LENGUAJE CLÍNICO Y ADMINISTRATIVO
   Sin tecnicismos internos de bases de datos.
══════════════════════════════════════════════════════════════ */
const LABELS = {
  FolioAtencion: 'Folio de atención',
  NoPaciente: 'No. Paciente',
  Paciente: 'Nombre del paciente',
  Medico: 'Médico tratante',
  NumeroMedico: 'No. Médico / Cédula',
  Fecha: 'Fecha',
  FechaNacimiento: 'Fecha de nacimiento',
  FechaCreacion: 'Fecha de registro',
  FechaIngreso: 'Fecha de ingreso',
  FechaEgreso: 'Fecha de egreso / alta',
  FechaCargo: 'Fecha del cargo',
  FechaInicio: 'Fecha de inicio',
  FechaFin: 'Fecha de término',
  FechaContabilizacion: 'Fecha de contabilización',
  Genero: 'Sexo',
  Edad: 'Edad (años)',
  DiasEstancia: 'Días de estancia',
  Habitacion: 'Habitación / Cama',
  EstadoCuenta: 'Estado de cuenta',
  Defuncion: 'Defunción',
  VaSeguro: 'Convenio VaSeguro',
  ExpedienteAnterior: 'Expediente anterior',
  OrigenIdentificacion: 'Origen identificación',
  TipoIdentificacion: 'Tipo identificación',
  Identificacion: 'CURP / Identificación',
  Codigo: 'Código de servicio',
  Servicio: 'Descripción del servicio / procedimiento',
  CantidadOriginal: 'Cantidad solicitada',
  Devuelto: 'Devoluciones',
  Cantidad: 'Cantidad neta',
  CantidadTotal: 'Cantidad de servicios',
  UnidadServicio: 'Unidad de servicio',
  Quirofano: 'Quirófano',
  FolioEstancia: 'No. Asignación / Estancia',
  EstanciasQuirofano: 'Estancias en quirófano',
  Documento: 'No. Documento / Factura',
  TipoDocumento: 'Tipo de documento',
  EstadoDocumento: 'Estado del documento',
  Ordenes: 'Órdenes de venta',
  Cuentas: 'Cuentas atendidas',
  Ranking: 'Posición',
  IngresoNeto: 'Importe sin IVA ($ MXN)',
  TotalOrdenVenta: 'Total orden sin IVA ($ MXN)',
  IngresoTotal: 'Importe total ($ MXN)',
  IVA: 'IVA ($ MXN)',
  ImporteTotal: 'Importe con IVA ($ MXN)',
  Total: 'Importe ($ MXN)',
  TipoAtencion: 'Tipo de atención',
  AtencionesMultiples: 'Atenciones múltiples',
  Observaciones: 'Observaciones',
  Indicador: 'Indicador hospitalario',
  Resultado: 'Resultado',
  Unidad: 'Unidad de medida',
  Criterio: 'Criterio metodológico',
  Manual: 'Cifra manual de referencia',
  Generado: 'Cifra generada por BI',
  Diferencia: 'Diferencia (BI - Manual)',
  Referencia: 'Archivo / Fuente de referencia',
  Tema: 'Área o indicador'
};

/* ══════════════════════════════════════════════════════════════
   ORDEN DE COLUMNAS PREFERIDAS POR INDICADOR
   Alineado con los libros de control del Hospital Escandón
══════════════════════════════════════════════════════════════ */
const SECTION_COLUMNS = {
  shock: ['FolioAtencion', 'NoPaciente', 'Paciente', 'Fecha', 'Ordenes', 'CantidadTotal', 'ImporteTotal', 'Servicio'],
  births: ['NoPaciente', 'ExpedienteAnterior', 'Paciente', 'FechaNacimiento', 'Genero', 'FechaCreacion', 'Identificacion', 'TipoIdentificacion', 'OrigenIdentificacion'],
  hospital: ['FolioAtencion', 'NoPaciente', 'Paciente', 'Medico', 'Genero', 'Edad', 'FechaIngreso', 'FechaEgreso', 'DiasEstancia', 'EstadoCuenta'],
  emergencyAccounts: ['FolioAtencion', 'NoPaciente', 'Paciente', 'Medico', 'Genero', 'Edad', 'FechaIngreso', 'FechaEgreso', 'DiasEstancia', 'EstadoCuenta'],
  vasSeguro: ['FolioAtencion', 'NoPaciente', 'Paciente', 'Medico', 'Genero', 'Edad', 'FechaIngreso', 'FechaEgreso', 'DiasEstancia', 'EstadoCuenta'],
  emergencyConsultations: ['FolioAtencion', 'NoPaciente', 'Paciente', 'Medico', 'Fecha', 'Codigo', 'Servicio', 'CantidadOriginal', 'Devuelto', 'Cantidad', 'UnidadServicio'],
  stay: ['FolioAtencion', 'NoPaciente', 'Paciente', 'Medico', 'Fecha', 'Codigo', 'Servicio', 'CantidadOriginal', 'Devuelto', 'Cantidad', 'UnidadServicio'],
  intensive: ['FolioAtencion', 'NoPaciente', 'Paciente', 'Medico', 'Fecha', 'Codigo', 'Servicio', 'CantidadOriginal', 'Devuelto', 'Cantidad', 'UnidadServicio'],
  operatingRoom: ['FolioAtencion', 'NoPaciente', 'Paciente', 'Medico', 'Quirofano', 'Servicio', 'Fecha', 'FechaFin', 'EstanciasQuirofano', 'EstadoCuenta'],
  ambulatory: ['FolioAtencion', 'NoPaciente', 'Paciente', 'Medico', 'Quirofano', 'Servicio', 'Fecha', 'FechaFin', 'FechaIngreso', 'FechaEgreso', 'EstadoCuenta'],
  specialty: ['Fecha', 'Documento', 'FolioAtencion', 'NoPaciente', 'Paciente', 'Medico', 'Codigo', 'Servicio', 'Cantidad', 'IngresoNeto'],
  image: ['Fecha', 'Documento', 'TipoDocumento', 'FolioAtencion', 'NoPaciente', 'Paciente', 'Medico', 'Codigo', 'Servicio', 'Cantidad', 'IngresoNeto'],
  imageIncome: ['Fecha', 'Documento', 'TipoDocumento', 'FolioAtencion', 'NoPaciente', 'Paciente', 'Medico', 'Codigo', 'Servicio', 'Cantidad', 'IngresoNeto', 'IVA', 'ImporteTotal'],
  lab: ['Fecha', 'Documento', 'TipoDocumento', 'FolioAtencion', 'NoPaciente', 'Paciente', 'Medico', 'Codigo', 'Servicio', 'Cantidad', 'IngresoNeto'],
  labIncome: ['Fecha', 'Documento', 'TipoDocumento', 'FolioAtencion', 'NoPaciente', 'Paciente', 'Medico', 'Codigo', 'Servicio', 'Cantidad', 'IngresoNeto', 'IVA', 'ImporteTotal'],
  surgeries: ['FolioEstancia', 'FolioAtencion', 'NoPaciente', 'Paciente', 'Quirofano', 'Medico', 'Servicio', 'Fecha', 'FechaFin', 'EstadoCuenta'],
  hospitalDoctors: ['Ranking', 'Medico', 'NumeroMedico', 'IngresoTotal', 'Ordenes', 'Cuentas'],
  emergencyDoctors: ['Ranking', 'Medico', 'NumeroMedico', 'IngresoTotal', 'Ordenes', 'Cuentas']
};

const INTERNAL_EXCLUDED_KEYS = new Set([
  'ClasificacionesCatalogo', 'GrupoCodigo', 'NumeroCargo',
  'ServicioSinArticulo', 'BaseAtribucion', 'GroupCount', 'Linea', 'DocumentoId',
  'Categoria', 'Grupo', 'Moneda', 'MonedaDocumento', 'DiferenciaSinDistribuir',
  'CodigoCliente', 'IngresoOrden'
]);

function getColumnsForSection(sectionKey, rows) {
  if (!rows || !rows.length) return ['Observaciones'];
  const preferred = SECTION_COLUMNS[sectionKey];
  const rowKeySet = new Set(rows.flatMap(r => Object.keys(r)));
  if (!rowKeySet.size) return ['Observaciones'];

  const excluded = new Set(INTERNAL_EXCLUDED_KEYS);
  if (sectionKey !== 'surgeries') excluded.add('FolioEstancia');

  if (preferred) {
    const adjusted = preferred.map(k => (k === 'FechaEgreso' && !rowKeySet.has('FechaEgreso') && rowKeySet.has('Fecha')) ? 'Fecha' : k);
    const cols = adjusted.filter(k => rowKeySet.has(k));
    if (cols.length > 0) return cols;
  }

  const fallback = [...rowKeySet].filter(k => !excluded.has(k));
  return fallback.length ? fallback : ['Observaciones'];
}

function getColumnWidth(key) {
  if (/Paciente|Medico|Servicio|Criterio|Observaciones|Procedimientos/i.test(key)) return 38;
  if (/Fecha|Ingreso|Egreso|Inicio|Fin|Nacimiento|Creacion/i.test(key)) return 19;
  if (/Importe|IngresoNeto|Total|IVA|TotalOrden/i.test(key)) return 22;
  if (/Folio|NoPaciente|Documento|Codigo|Expediente|Identificacion/i.test(key)) return 18;
  if (/Genero|Edad|DiasEstancia|Ranking|Cantidad|Devuelto|Ordenes|Cuentas/i.test(key)) return 14;
  return 20;
}

function isCurrencyKey(key) {
  return /Ingreso|Importe|Monto|TotalOrden|Precio|Saldo|IVA/i.test(key) && !/CantidadTotal|AtencionesMultiples|Folio/i.test(key);
}

function isCodeOrIdKey(key) {
  return /Folio|NoPaciente|Documento|NumeroMedico|Ranking/i.test(key);
}

function getAlignment(key, value) {
  if (isCurrencyKey(key) || (typeof value === 'number' && /Cantidad|Devuelto|Ordenes|Cuentas/i.test(key))) {
    return { vertical: 'middle', horizontal: 'right' };
  }
  if (/Fecha/i.test(key) || isCodeOrIdKey(key) || /Genero|Edad|DiasEstancia|Codigo/i.test(key)) {
    return { vertical: 'middle', horizontal: 'center' };
  }
  return { vertical: 'middle', horizontal: 'left', wrapText: true };
}

function toExcelDate(value, isDateColumn) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null;
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate(), value.getHours(), value.getMinutes(), value.getSeconds()));
  }
  if (typeof value === 'string' && isDateColumn) {
    const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (isoMatch) {
      const [, y, m, d, hh = 0, mm = 0, ss = 0] = isoMatch;
      return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)));
    }
  }
  return value === '' ? null : value;
}

const hairBorder = {
  top:    { style: 'hair', color: { argb: BRAND.bordeHair } },
  bottom: { style: 'hair', color: { argb: BRAND.bordeHair } },
  left:   { style: 'hair', color: { argb: BRAND.bordeHair } },
  right:  { style: 'hair', color: { argb: BRAND.bordeHair } }
};

/**
 * Aplica el banner institucional Hospital Escandón en filas 1 a 3
 * y prepara los encabezados en la fila 7 (con congelamiento y configuración de impresión).
 */
function styleSheet(sheet, title, report, columns) {
  const count = Math.max(columns.length, 4);
  sheet.properties.defaultRowHeight = 21;
  sheet.views = [{ state: 'frozen', ySplit: 7, xSplit: 0 }];
  sheet.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:7' };
  sheet.headerFooter.oddFooter = '&LHospital Escandón — BI Institucional&R Página &P de &N';

  sheet.columns = columns.map(key => ({
    key,
    width: getColumnWidth(key)
  }));

  // Fila 1: Título institucional
  sheet.mergeCells(1, 1, 1, count);
  sheet.getCell('A1').value = `HOSPITAL ESCANDÓN — ${title.toUpperCase()}`;
  sheet.getCell('A1').font = { name: 'Calibri', size: 14, bold: true, color: { argb: BRAND.blanco } };
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.azulOscuro } };
  sheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  sheet.getRow(1).height = 34;

  // Fila 2: Subtítulo con período
  sheet.mergeCells(2, 1, 2, count);
  sheet.getCell('A2').value = `Período: Del ${report.period.startDate} al ${report.period.endDate} (ambos inclusive)`;
  sheet.getCell('A2').font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: BRAND.blanco } };
  sheet.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.azulClaro } };
  sheet.getCell('A2').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  sheet.getRow(2).height = 22;

  // Fila 3: Metadatos y fecha de consulta
  sheet.mergeCells(3, 1, 3, count);
  const fechaConsulta = new Date(report.generatedAt).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
  sheet.getCell('A3').value = `Consultado: ${fechaConsulta} hrs   |   Moneda: MXN   |   Información oficial para uso médico, directivo y contable`;
  sheet.getCell('A3').font = { name: 'Calibri', size: 9, italic: true, color: { argb: BRAND.grisTexto } };
  sheet.getCell('A3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.grisInfo } };
  sheet.getCell('A3').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  sheet.getRow(3).height = 20;

  // Fila 7: Encabezados de tabla
  sheet.getRow(7).values = columns.map(key => LABELS[key] || key.replace(/([a-záéíóúñ])([A-ZÁÉÍÓÚÑ])/g, '$1 $2'));
  sheet.getRow(7).height = 30;
  sheet.getRow(7).eachCell((cell, colNumber) => {
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: BRAND.blanco } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.azulOscuro } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top:    { style: 'thin', color: { argb: BRAND.bordeHeader } },
      bottom: { style: 'thin', color: { argb: BRAND.bordeHeader } },
      left:   { style: 'thin', color: { argb: BRAND.bordeHeader } },
      right:  { style: 'thin', color: { argb: BRAND.bordeHeader } }
    };
  });
}

/**
 * Inserta las filas de datos con formato cebra, alineación tipada,
 * fila de totales contables y filtro automático.
 */
function addTableRows(sheet, columns, rows, isSummary = false) {
  for (const source of rows) {
    const rowValues = columns.map(key => {
      const value = source[key] ?? null;
      return toExcelDate(value, /Fecha/i.test(key));
    });
    const row = sheet.addRow(rowValues);

    row.eachCell({ includeEmpty: true }, (cell, index) => {
      const key = columns[index - 1];
      cell.font = { name: 'Calibri', size: 9.5, color: { argb: BRAND.textoOscuro } };
      cell.border = hairBorder;
      cell.alignment = getAlignment(key, cell.value);

      // Zebra striping
      if (row.number % 2 === 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.grisFila } };
      } else {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.blanco } };
      }

      if (typeof cell.value === 'number') {
        if (isCurrencyKey(key)) {
          cell.numFmt = CURRENCY;
          cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: BRAND.azulOscuro } };
        } else if (isCodeOrIdKey(key)) {
          cell.numFmt = '0';
        } else {
          cell.numFmt = numericFormat(cell.value);
        }
      } else if (cell.value instanceof Date) {
        if (cell.value.getUTCHours() === 0 && cell.value.getUTCMinutes() === 0 && cell.value.getUTCSeconds() === 0) {
          cell.numFmt = 'dd/mm/yyyy';
        } else {
          cell.numFmt = 'dd/mm/yyyy hh:mm';
        }
      }
    });

    row.height = Math.max(22, ...columns.map((key, index) => {
      const value = source[key];
      const length = value instanceof Date ? 16 : value && typeof value === 'object' && 'formula' in value ? String(value.result).length : String(value ?? '').length;
      const colWidth = sheet.getColumn(index + 1).width || 20;
      return Math.ceil(length / Math.max(12, colWidth - 3)) * 14 + 6;
    }));
  }

  // Fila de totales para hojas de detalle
  const dataEndRow = sheet.rowCount;
  if (!isSummary && rows.length > 0 && dataEndRow >= 8) {
    const summableCols = columns.filter(k =>
      /^(Cantidad|CantidadTotal|CantidadOriginal|Devuelto|Ordenes|Cuentas|IngresoNeto|IVA|ImporteTotal|TotalOrdenVenta|Total)$/.test(k)
    );
    if (summableCols.length > 0) {
      const totalValues = columns.map((key, idx) => {
        if (idx === 0) return 'TOTAL GENERAL';
        if (summableCols.includes(key)) {
          const colLetter = sheet.getColumn(idx + 1).letter;
          return { formula: `SUM(${colLetter}8:${colLetter}${dataEndRow})` };
        }
        return null;
      });
      const totalRow = sheet.addRow(totalValues);
      totalRow.height = 26;
      totalRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const key = columns[colNumber - 1];
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.azulTotales } };
        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: BRAND.azulOscuro } };
        cell.border = {
          top:    { style: 'thin', color: { argb: BRAND.azulOscuro } },
          bottom: { style: 'double', color: { argb: BRAND.azulOscuro } },
          left:   { style: 'hair', color: { argb: BRAND.bordeHair } },
          right:  { style: 'hair', color: { argb: BRAND.bordeHair } }
        };
        if (summableCols.includes(key)) {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.numFmt = isCurrencyKey(key) ? CURRENCY : NUMBER;
        } else if (colNumber === 1) {
          cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        } else {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        }
      });

      sheet.autoFilter = {
        from: { row: 7, column: 1 },
        to: { row: dataEndRow, column: columns.length }
      };
      return;
    }
  }

  sheet.autoFilter = {
    from: { row: 7, column: 1 },
    to: { row: Math.max(7, sheet.rowCount), column: columns.length }
  };
}

/**
 * Crea el libro completo de estadísticas institucionales.
 */
async function createStatisticsWorkbook(report) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Hospital Escandón';
  workbook.subject = 'Estadístico institucional por fechas';
  workbook.created = new Date(report.generatedAt);
  workbook.calcProperties.fullCalcOnLoad = true;

  // ── HOJA 1: RESUMEN EJECUTIVO ──
  const summary = workbook.addWorksheet('Resumen');
  const summaryColumns = ['Indicador', 'Resultado', 'Unidad', 'Criterio', 'Observaciones'];
  styleSheet(summary, 'Resumen ejecutivo de indicadores', report, summaryColumns);

  // Tarjeta de estado en fila 4
  summary.mergeCells('A4:E4');
  if (report.warnings && report.warnings.length > 0) {
    summary.getCell('A4').value = '⚠️ RESUMEN CON OBSERVACIONES: Existen notas de validación en el período. Revise la columna Observaciones antes de enviar.';
    summary.getCell('A4').font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: BRAND.amarilloTxt } };
    summary.getCell('A4').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.amarilloFondo } };
  } else {
    summary.getCell('A4').value = '✓ PERÍODO VALIDADO: Datos consolidados de Vertical y SAP Business One para dirección médica y contable.';
    summary.getCell('A4').font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: BRAND.azulOscuro } };
    summary.getCell('A4').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.azulTotales } };
  }
  summary.getCell('A4').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  summary.getRow(4).height = 32;

  // Fila 5: Explicación de uso
  summary.mergeCells('A5:E5');
  summary.getCell('A5').value = 'Este resumen consolida los 18 indicadores oficiales del Hospital Escandón. Cada resultado está vinculado a su hoja de detalle clínico o contable.';
  summary.getCell('A5').font = { name: 'Calibri', size: 9.5, italic: true, color: { argb: BRAND.grisTexto } };
  summary.getCell('A5').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  summary.getRow(5).height = 24;

  // Fila 6: Separador
  summary.getRow(6).height = 8;

  const summaryRows = [];

  // ── HOJAS DE DETALLE POR INDICADOR ──
  for (const definition of SECTIONS) {
    const section = report.sections[definition.key] || { rows: [], quantity: 0, unit: definition.unit, criterion: '', warnings: [] };
    const sheet = workbook.addWorksheet(definition.sheet);
    const rows = section.rows || [];
    const columns = getColumnsForSection(definition.key, rows);
    const colCount = Math.max(columns.length, 4);

    styleSheet(sheet, definition.label, report, columns);

    // Fila 4: Tarjeta ejecutiva de KPI (B4 contiene section.quantity para vínculos y pruebas)
    sheet.getCell('A4').value = `Total ${definition.label}:`;
    sheet.getCell('A4').font = { name: 'Calibri', size: 11, bold: true, color: { argb: BRAND.azulOscuro } };
    sheet.getCell('A4').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    sheet.getCell('B4').value = section.quantity ?? 'No disponible';
    sheet.getCell('B4').numFmt = definition.unit === 'MXN' ? CURRENCY : numericFormat(section.quantity);
    sheet.getCell('B4').font = { name: 'Calibri', size: 14, bold: true, color: { argb: BRAND.azulOscuro } };
    sheet.getCell('B4').alignment = { vertical: 'middle', horizontal: 'right' };

    sheet.getCell('C4').value = section.unit || definition.unit;
    sheet.getCell('C4').font = { name: 'Calibri', size: 10, bold: true, color: { argb: BRAND.azulClaro } };
    sheet.getCell('C4').alignment = { vertical: 'middle', horizontal: 'left' };

    if (colCount > 3) {
      sheet.mergeCells(4, 4, 4, colCount);
      const regCount = rows.length;
      sheet.getCell(4, 4).value = `Registros incluidos: ${regCount}`;
      sheet.getCell(4, 4).font = { name: 'Calibri', size: 9.5, italic: true, color: { argb: BRAND.grisTexto } };
      sheet.getCell(4, 4).alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
    }

    // Fondo y borde suave de la tarjeta en fila 4
    for (let c = 1; c <= colCount; c++) {
      const cell = sheet.getCell(4, c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.azulTotales } };
      cell.border = {
        top:    { style: 'thin', color: { argb: 'FF94A3B8' } },
        bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
        left:   c === 1 ? { style: 'thin', color: { argb: 'FF94A3B8' } } : undefined,
        right:  c === colCount ? { style: 'thin', color: { argb: 'FF94A3B8' } } : undefined
      };
    }
    sheet.getRow(4).height = 36;

    // Fila 5: Criterio clínico / administrativo explicado
    sheet.mergeCells(5, 1, 5, colCount);
    sheet.getCell('A5').value = `Criterio clínico/administrativo: ${section.criterion || 'Sin criterio registrado.'}`;
    sheet.getCell('A5').font = { name: 'Calibri', size: 9.5, color: { argb: BRAND.textoOscuro } };
    sheet.getCell('A5').alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
    sheet.getRow(5).height = 32;

    // Fila 6: Nota de revisión o separador
    if (section.warnings && section.warnings.length > 0) {
      sheet.mergeCells(6, 1, 6, colCount);
      sheet.getCell('A6').value = `⚠️ Nota para validación: ${section.warnings.join(' | ')}`;
      sheet.getCell('A6').font = { name: 'Calibri', size: 9, bold: true, color: { argb: BRAND.amarilloTxt } };
      sheet.getCell('A6').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.amarilloFondo } };
      sheet.getCell('A6').alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
      sheet.getRow(6).height = 28;
    } else {
      sheet.getRow(6).height = 8;
    }

    // Filas de datos
    addTableRows(sheet, columns, rows.length ? rows : [{ Observaciones: section.quantity === null ? 'No se puede determinar este resultado con la información disponible.' : 'Sin registros en este periodo.' }]);

    summaryRows.push({
      Indicador: definition.label,
      Resultado: section.quantity === null ? 'No disponible' : { formula: `'${definition.sheet.replace(/'/g, "''")}'!B4`, result: section.quantity },
      Unidad: section.unit || definition.unit,
      Criterio: section.criterion,
      Observaciones: (section.warnings || []).join(' ')
    });
  }

  // Poblar la tabla de Resumen
  addTableRows(summary, summaryColumns, summaryRows, true);
  summary.getColumn(1).width = 46;
  summary.getColumn(2).width = 22;
  summary.getColumn(3).width = 26;
  summary.getColumn(4).width = 65;
  summary.getColumn(5).width = 50;
  summaryRows.forEach((row, index) => {
    const resultCell = summary.getCell(index + 8, 2);
    resultCell.numFmt = row.Unidad === 'MXN' ? CURRENCY : numericFormat(row.Resultado?.result);
    resultCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: BRAND.azulOscuro } };
    summary.getCell(index + 8, 1).font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: BRAND.textoOscuro } };
  });

  // ── HOJA: ÓRDENES POR MÉDICO ──
  const orders = workbook.addWorksheet('Órdenes por médico');
  const orderColumns = ['Fecha', 'Documento', 'FolioAtencion', 'TipoAtencion', 'Medico', 'NumeroMedico', 'IngresoTotal', 'IVA', 'EstadoDocumento', 'AtencionesMultiples'];
  styleSheet(orders, 'Órdenes que sustentan los Top 10', report, orderColumns);
  orders.mergeCells('A4:J4');
  orders.getCell('A4').value = 'Auditoría y soporte de órdenes de venta: Detalle individual de cada orden vigente clasificada a médicos de hospitalización y urgencias.';
  orders.getCell('A4').font = { name: 'Calibri', size: 10, bold: true, color: { argb: BRAND.azulOscuro } };
  orders.getCell('A4').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.azulTotales } };
  orders.getCell('A4').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  orders.getRow(4).height = 30;

  orders.mergeCells('A5:J5');
  orders.getCell('A5').value = 'Una fila por orden de venta vigente en SAP. Permite a contabilidad y dirección médica verificar la clasificación de importes fuera del Top 10.';
  orders.getCell('A5').font = { name: 'Calibri', size: 9.5, italic: true, color: { argb: BRAND.grisTexto } };
  orders.getCell('A5').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  orders.getRow(5).height = 24;
  orders.getRow(6).height = 8;
  addTableRows(orders, orderColumns, report.doctorDocuments || []);

  // ── HOJA: CONCILIACIÓN MANUAL ──
  const controls = workbook.addWorksheet('Conciliación manual');
  const controlColumns = ['Indicador', 'Manual', 'Generado', 'Diferencia', 'Unidad', 'Referencia'];
  styleSheet(controls, 'Comparación con el archivo manual', report, controlColumns);
  controls.mergeCells('A4:F4');
  controls.getCell('A4').value = report.controls?.length
    ? 'Auditoría de consistencia: Comparativo de cifras generadas por la plataforma BI frente a los archivos manuales históricos.'
    : 'No hay un archivo manual de control registrado para este periodo exacto.';
  controls.getCell('A4').font = { name: 'Calibri', size: 10, bold: true, color: { argb: BRAND.azulOscuro } };
  controls.getCell('A4').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.azulTotales } };
  controls.getCell('A4').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  controls.getRow(4).height = 30;

  controls.mergeCells('A5:F5');
  controls.getCell('A5').value = report.controls?.length
    ? 'Referencias de los archivos base revisadas el 7 de octubre de 2026. La diferencia compara la consulta actual contra esa referencia.'
    : 'No hay un control manual cargado para este periodo exacto. No se afirma coincidencia con un archivo mensual.';
  controls.getCell('A5').font = { name: 'Calibri', size: 9.5, italic: true, color: { argb: BRAND.grisTexto } };
  controls.getCell('A5').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  controls.getRow(5).height = 24;
  controls.getRow(6).height = 8;
  controls.getColumn(6).width = 75;

  const controlRows = (report.controls || []).map((row, index) => ({
    ...row,
    Generado: row.Generado ?? 'No disponible',
    Diferencia: row.Diferencia === null ? 'No disponible' : { formula: `C${index + 8}-B${index + 8}`, result: row.Diferencia }
  }));
  addTableRows(controls, controlColumns, controlRows, true);
  (report.controls || []).forEach((row, index) => {
    for (const column of [2, 3, 4]) controls.getCell(index + 8, column).numFmt = row.Unidad === 'MXN' ? CURRENCY : NUMBER;
    if (row.Diferencia) controls.getCell(index + 8, 4).font = { bold: true, color: { argb: BRAND.ambarAviso } };
  });

  // ── HOJA: CRITERIOS Y REVISIÓN ──
  const criteria = workbook.addWorksheet('Criterios y revisión');
  const reviewRows = [
    { Tema: 'Período y corte', Criterio: 'Cada fecha final incluye el día completo (hasta las 23:59:59 hrs). No se prorratean los totales mensuales históricos.' },
    { Tema: 'Cantidades y unidades', Criterio: 'Se muestran servicios netos, atenciones o cuentas según la unidad clínica de cada indicador. Una solicitud o cargo no acredita por sí sola un estudio realizado.' },
    { Tema: 'Ingresos y facturación', Criterio: report.financialCriterion },
    { Tema: 'Top 10 médicos', Criterio: 'Dos clasificaciones independientes por importe: hospitalización (IP) y urgencias (ER). El total de cada Top 10 comprende sólo los médicos mostrados. Las órdenes de todos los médicos están en Órdenes por médico. IP significa hospitalización; ER, urgencias.' },
    { Tema: 'Ambulatorios', Criterio: 'Procedimientos registrados en atenciones cerradas cuyo ingreso y egreso ocurrieron el mismo día. Se conservan ambas fechas. Varias técnicas dentro de una estancia no se presentan como pacientes distintos.' },
    { Tema: 'Estancia', Criterio: 'Los servicios de estancia pueden tener unidades distintas; el detalle conserva cada código. La cantidad de servicios no se etiqueta como días cama.' },
    { Tema: 'Nacimientos', Criterio: 'Se cuenta una vez por paciente sólo cuando PT.CreatedOn (creación del expediente) y PT.BirthDate caen dentro del periodo y coinciden en fecha calendario. Un expediente creado después del nacimiento se excluye.' },
    ...(report.reconciliation || []).map(item => ({ Tema: item.label, Criterio: item.description })),
    ...report.warnings.map(warning => ({ Tema: 'Nota de revisión', Criterio: warning }))
  ];
  styleSheet(criteria, 'Criterios de cálculo y revisión', report, ['Tema', 'Criterio']);
  criteria.mergeCells('A4:B4');
  criteria.getCell('A4').value = 'Metodología institucional de cálculo y procedencia de datos (Vertical / SAP Business One).';
  criteria.getCell('A4').font = { name: 'Calibri', size: 10, bold: true, color: { argb: BRAND.azulOscuro } };
  criteria.getCell('A4').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.azulTotales } };
  criteria.getCell('A4').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  criteria.getRow(4).height = 30;

  criteria.mergeCells('A5:B5');
  criteria.getCell('A5').value = 'Definiciones oficiales aprobadas para la extracción, conciliación y auditoría de cifras hospitalarias.';
  criteria.getCell('A5').font = { name: 'Calibri', size: 9.5, italic: true, color: { argb: BRAND.grisTexto } };
  criteria.getCell('A5').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  criteria.getRow(5).height = 24;
  criteria.getRow(6).height = 8;
  criteria.getColumn(1).width = 30;
  criteria.getColumn(2).width = 105;
  addTableRows(criteria, ['Tema', 'Criterio'], reviewRows, true);

  return workbook.xlsx.writeBuffer();
}

module.exports = { createStatisticsWorkbook };
