'use strict';

const ExcelJS = require('exceljs');
const { SECTIONS } = require('./statisticsCatalog');
const { roundMoney } = require('./statisticsCommon');
const { attachLineCharts } = require('./statisticsChartXml');

const BRAND = {
  azulOscuro:   'FF004687',  
  azulClaro:    'FF0088C9',  
  blanco:       'FFFFFFFF',
  grisFila:     'FFF8FAFC',  
  grisInfo:     'FFF1F5F9',  
  grisTexto:    'FF475569',
  azulTotales:  'FFE0EAF4',  
  verdeMoneda:  'FF15803D',
  ambarAviso:   'FFB45309',
  amarilloFondo:'FFFEF3C7',
  amarilloTxt:  'FF92400E',
  bordeHair:    'FFCBD5E1',  
  bordeHeader:  'FF003366',
  textoOscuro:  'FF1E293B',
  textoMuted:   'FF64748B'
};

const CURRENCY = '"$"#,##0.00;[Red]("$"#,##0.00);"$"0.00';
const HEADER_ROW = 5;
const NUMBER = '#,##0;[Red](#,##0);0';
const DECIMAL = '#,##0.00;[Red](#,##0.00);0.00';
const numericFormat = value => Number.isInteger(value) ? NUMBER : DECIMAL;

const LABELS = {
  FolioAtencion: 'Folio de atención',
  NoPaciente: 'No. Paciente',
  Paciente: 'Nombre del paciente',
  Medico: 'Médico tratante',
  NumeroMedico: 'Identificador del médico',
  NumeroCita: 'No. Cita',
  Especialidad: 'Especialidad',
  EstadoCita: 'Estado de la cita',
  EstadoOrdenVenta: 'Estado de la orden de venta',
  Ejecutada: 'Ejecutada',
  Fecha: 'Fecha',
  Hora: 'Hora de consulta',
  FechaNacimiento: 'Fecha de nacimiento',
  FechaCreacion: 'Fecha de registro',
  FechaIngreso: 'Fecha de ingreso',
  FechaEgreso: 'Fecha de egreso / alta',
  FechaCargo: 'Fecha del cargo',
  FechaUltimoCargo: 'Último cargo del periodo',
  FechaInicioBitacora: 'Inicio en bitácora',
  FechaFinBitacora: 'Término en bitácora',
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
  Cantidad: 'Unidades',
  CantidadTotal: 'Cantidad de servicios',
  UnidadServicio: 'Unidad de servicio',
  AreaLaboratorio: 'Área',
  Quirofano: 'Quirófano',
  FolioEstancia: 'No. Asignación / Estancia',
  EstanciasQuirofano: 'Estancias en quirófano',
  ProcedimientoBitacora: 'Procedimiento en bitácora',
  EstadoRegistro: 'Vínculo con bitácora',
  CargosCQX: 'Registros de cargo en CQX',
  UnidadesCargo: 'Unidades de cargo',
  Documento: 'No. Documento / Factura',
  TipoDocumento: 'Tipo de documento',
  EstadoDocumento: 'Estado del documento',
  Ordenes: 'Órdenes de venta',
  Cuentas: 'Atenciones distintas',
  Ranking: 'Posición',
  ImporteLinea: 'Importe antes de descuento, sin IVA',
  IngresoNeto: 'Importe neto sin IVA',
  TotalOrdenVenta: 'Total orden con IVA ($ MXN)',
  IngresoTotal: 'Importe con IVA',
  IVA: 'IVA',
  ImporteTotal: 'Importe con IVA',
  Total: 'Importe ($ MXN)',
  TipoAtencion: 'Tipo de atención',
  AtencionesMultiples: 'Atenciones múltiples',
  Observaciones: 'Observaciones',
  Indicador: 'Indicador',
  Resultado: 'Total',
  Unidad: 'Unidad de medida',
  Criterio: 'Criterio metodológico',
  Manual: 'Cifra manual de referencia',
  Generado: 'Cifra generada por BI',
  Diferencia: 'Diferencia (BI - Manual)',
  Referencia: 'Archivo / Fuente de referencia',
  Tema: 'Área o indicador',
  Estado: 'Resultado de comparación',
  Motivo: 'Observación de la referencia',
  Tipo: 'Tipo de atención',
  OrdenesManual: 'Órdenes en Excel base',
  OrdenesGenerado: 'Órdenes en BI',
  DiferenciaOrdenes: 'Diferencia de órdenes',
  AlcanceRanking: 'Alcance del ranking',
  CantidadManual: 'Unidades en Excel base',
  CantidadGenerada: 'Unidades en BI',
  DiferenciaCantidad: 'Diferencia de unidades',
  Registros: 'Registros',
  Periodo: 'Mes de la referencia',
  Complemento: 'Detalle complementario'
};

const SECTION_COLUMNS = {
  shock: ['FolioAtencion', 'NoPaciente', 'Paciente', 'Fecha', 'Ordenes', 'CantidadTotal', 'ImporteTotal', 'Servicio'],
  births: ['NoPaciente', 'ExpedienteAnterior', 'Paciente', 'FechaNacimiento', 'Genero', 'FechaCreacion', 'Identificacion', 'TipoIdentificacion', 'OrigenIdentificacion'],
  hospital: ['FolioAtencion', 'NoPaciente', 'Paciente', 'Medico', 'Genero', 'Edad', 'FechaIngreso', 'FechaEgreso', 'DiasEstancia', 'EstadoCuenta'],
  emergencyAccounts: ['FolioAtencion', 'NoPaciente', 'Paciente', 'Medico', 'Genero', 'Edad', 'FechaIngreso', 'FechaEgreso', 'DiasEstancia', 'EstadoCuenta'],
  vasSeguro: ['FolioAtencion', 'NoPaciente', 'Paciente', 'Medico', 'Genero', 'Edad', 'FechaIngreso', 'FechaEgreso', 'DiasEstancia', 'EstadoCuenta'],
  emergencyConsultations: ['FolioAtencion', 'NoPaciente', 'Paciente', 'Medico', 'Fecha', 'Documento', 'TipoAtencion', 'Codigo', 'Servicio', 'CantidadOriginal', 'Devuelto', 'Cantidad', 'ImporteLinea', 'IngresoNeto', 'IVA', 'ImporteTotal', 'UnidadServicio'],
  stay: ['FolioAtencion', 'NoPaciente', 'Paciente', 'Medico', 'Fecha', 'Documento', 'TipoAtencion', 'Codigo', 'Servicio', 'CantidadOriginal', 'Devuelto', 'Cantidad', 'ImporteLinea', 'IngresoNeto', 'IVA', 'ImporteTotal', 'UnidadServicio'],
  intensive: ['FolioAtencion', 'NoPaciente', 'Paciente', 'Medico', 'Fecha', 'Documento', 'TipoAtencion', 'Codigo', 'Servicio', 'CantidadOriginal', 'Devuelto', 'Cantidad', 'ImporteLinea', 'IngresoNeto', 'IVA', 'ImporteTotal', 'UnidadServicio'],
  operatingRoom: ['FolioAtencion', 'NoPaciente', 'Paciente', 'Medico', 'FechaCargo', 'FechaUltimoCargo', 'Quirofano', 'ProcedimientoBitacora', 'FechaInicioBitacora', 'FechaFinBitacora', 'EstadoRegistro', 'CargosCQX', 'UnidadesCargo', 'Servicio'],
  ambulatory: ['FolioEstancia', 'FolioAtencion', 'NoPaciente', 'Paciente', 'Medico', 'Quirofano', 'Servicio', 'Fecha', 'FechaFin', 'EstadoCuenta'],
  specialty: ['Fecha', 'Hora', 'NumeroCita', 'NoPaciente', 'Paciente', 'Edad', 'Medico', 'Especialidad', 'Servicio', 'EstadoOrdenVenta'],
  image: ['Fecha', 'Documento', 'TipoDocumento', 'FolioAtencion', 'NoPaciente', 'Paciente', 'Medico', 'Codigo', 'Servicio', 'Cantidad', 'IngresoNeto'],
  imageIncome: ['Fecha', 'Documento', 'TipoDocumento', 'FolioAtencion', 'NoPaciente', 'Paciente', 'Medico', 'Codigo', 'Servicio', 'Cantidad', 'IngresoNeto', 'IVA', 'ImporteTotal'],
  lab: ['Fecha', 'Documento', 'TipoDocumento', 'FolioAtencion', 'NoPaciente', 'Paciente', 'Medico', 'Codigo', 'Servicio', 'AreaLaboratorio', 'Cantidad', 'IngresoNeto'],
  labIncome: ['Fecha', 'Documento', 'TipoDocumento', 'FolioAtencion', 'NoPaciente', 'Paciente', 'Medico', 'Codigo', 'Servicio', 'AreaLaboratorio', 'Cantidad', 'IngresoNeto', 'IVA', 'ImporteTotal'],
  surgeries: ['FolioEstancia', 'FolioAtencion', 'NoPaciente', 'Paciente', 'Quirofano', 'Medico', 'Servicio', 'Fecha', 'FechaFin', 'EstadoCuenta'],
  hospitalDoctors: ['Ranking', 'Medico', 'Ordenes', 'IngresoTotal', 'Cuentas'],
  emergencyDoctors: ['Ranking', 'Medico', 'Ordenes', 'IngresoTotal', 'Cuentas'],
  complementaryActivity: ['Complemento', 'FolioEstancia', 'FolioAtencion', 'NoPaciente', 'Paciente', 'Medico', 'Fecha', 'FechaFin', 'Documento', 'TipoDocumento', 'Quirofano', 'Codigo', 'Servicio', 'Cantidad', 'IngresoNeto', 'IVA', 'ImporteTotal', 'EstadoCuenta']
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
  if (key === 'Ranking') return 8;
  if (key === 'Medico') return 46;
  if (key === 'AreaLaboratorio') return 26;
  if (/^(NoPaciente|NumeroMedico|NumeroCita)$/.test(key)) return 18;
  if (isCurrencyKey(key) && !/^Fecha/.test(key)) return 24;
  if (/Paciente|Medico|Servicio|Criterio|Observaciones|Procedimiento/i.test(key)) return 38;
  if (/Fecha|Ingreso|Egreso|Inicio|Fin|Nacimiento|Creacion/i.test(key)) return 19;
  if (/Importe|IngresoNeto|Total|IVA|TotalOrden/i.test(key)) return 22;
  if (/Folio|NoPaciente|Documento|Codigo|Expediente|Identificacion/i.test(key)) return 18;
  if (/Genero|Edad|DiasEstancia|Ranking|Cantidad|Devuelto|Ordenes|Cuentas/i.test(key)) return 14;
  return 20;
}

function isCurrencyKey(key) {
  return /Ingreso|Importe|Monto|TotalOrden|Precio|Saldo|IVA/i.test(key) && !/^Fecha|CantidadTotal|AtencionesMultiples|Folio/i.test(key);
}

function isCodeOrIdKey(key) {
  return /Folio|NoPaciente|Documento|NumeroMedico|NumeroCita|Ranking/i.test(key);
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

function periodLabel(period) {
  const date = value => new Date(`${value}T00:00:00Z`).toLocaleDateString('es-MX', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
  });
  return `${date(period.startDate)} al ${date(period.endDate)}`;
}

function styleSheet(sheet, title, report, columns) {
  const count = sheet.name === 'Resumen' ? columns.length : Math.max(columns.length, 4);
  sheet.properties.defaultRowHeight = 22;
  sheet.views = [{ state: 'frozen', ySplit: HEADER_ROW, xSplit: columns.length > 8 ? 2 : 0, showGridLines: false }];
  sheet.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    printTitlesRow: `1:${HEADER_ROW}`, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.15, footer: 0.15 } };
  sheet.headerFooter.oddFooter = '&LHospital Escandón&R&P / &N';
  sheet.columns = columns.map(key => ({ key, width: getColumnWidth(key) }));
  sheet.mergeCells(1, 1, 1, count);
  const titleCell = sheet.getCell('A1');
  titleCell.value = title;
  titleCell.font = { name: 'Calibri', size: 15, bold: true, color: { argb: BRAND.blanco } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.azulOscuro } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
  sheet.getRow(1).height = 32;
  sheet.mergeCells(2, 1, 2, count);
  sheet.getCell('A2').value = `${periodLabel(report.period)}${columns.some(isCurrencyKey) ? ' · MXN' : ''}`;
  sheet.getCell('A2').font = { name: 'Calibri', size: 10, color: { argb: BRAND.grisTexto } };
  sheet.getCell('A2').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  sheet.getRow(2).height = 22;
  sheet.getRow(3).height = 7;
  sheet.getRow(4).height = 30;
  const header = sheet.getRow(HEADER_ROW);
  header.values = columns.map(key => LABELS[key] || key.replace(/([a-záéíóúñ])([A-ZÁÉÍÓÚÑ])/g, '$1 $2'));
  header.height = 34;
  header.eachCell(cell => {
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: BRAND.azulOscuro } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.azulTotales } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: BRAND.bordeHair } } };
  });
}

function displayedValue(key, value) {
  if (key === 'Ejecutada') {
    if (value == null || value === '') return 'Sin registro';
    if (value === true || value === 1 || /^(?:s[ií]|1)$/i.test(String(value).trim())) return 'Sí';
    if (value === false || value === 0 || /^(?:no|0)$/i.test(String(value).trim())) return 'No';
  }
  if (key === 'EstadoCuenta') return ({ CL: 'Cerrada', OP: 'Abierta' })[value] || value;
  if (key === 'EstadoDocumento') return ({ bost_Close: 'Cerrado', bost_Open: 'Abierto' })[value] || value;
  if (key === 'TipoAtencion') return ({ IP: 'Hospitalización', ER: 'Urgencias' })[value] || value;
  return value;
}

function addTableRows(sheet, columns, rows, isSummary = false, { headerRow = HEADER_ROW, totalLabel = 'Total', filter = true } = {}) {
  for (const source of rows) {
    const rowValues = columns.map(key => {
      const value = source[key] ?? null;
      return toExcelDate(displayedValue(key, value), /Fecha/i.test(key));
    });
    const row = sheet.addRow(rowValues);

    row.eachCell({ includeEmpty: true }, (cell, index) => {
      const key = columns[index - 1];
      cell.font = { name: 'Calibri', size: 9.5, color: { argb: BRAND.textoOscuro } };
      cell.border = hairBorder;
      cell.alignment = getAlignment(key, cell.value);

      if (row.number % 2 === 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.grisFila } };
      } else {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.blanco } };
      }

      if (typeof cell.value === 'number') {
        if (isCurrencyKey(key)) {
          cell.numFmt = CURRENCY;
          cell.font = { name: 'Calibri', size: 9.5, color: { argb: BRAND.textoOscuro } };
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

      const value = rowValues[index];
      const length = value instanceof Date ? 16 : value && typeof value === 'object' && 'formula' in value ? String(value.result).length : String(value ?? '').length;
      const colWidth = sheet.getColumn(index + 1).width || 20;
      return Math.ceil(length / Math.max(12, colWidth - 3)) * 14 + 6;
    }));
  }

  // Fila de totales para hojas de detalle
  const dataEndRow = sheet.rowCount;
  if (!isSummary && rows.length > 0 && dataEndRow > headerRow) {
    const summableCols = columns.filter(k =>
      /^(Cantidad|CantidadTotal|CantidadOriginal|Devuelto|Ordenes|ImporteLinea|IngresoNeto|IngresoTotal|IVA|ImporteTotal|TotalOrdenVenta|Total)$/.test(k)
    );
    if (summableCols.length > 0) {
      const totalValues = columns.map((key, idx) => {
        if (idx === 0) return totalLabel;
        if (summableCols.includes(key)) {
          const colLetter = sheet.getColumn(idx + 1).letter;
          const total = rows.reduce((sum, row) => sum + (typeof row[key] === 'number' ? row[key] : 0), 0);
          return { formula: isCurrencyKey(key) ? `ROUND(SUM(${colLetter}${headerRow + 1}:${colLetter}${dataEndRow}),2)` : `SUM(${colLetter}${headerRow + 1}:${colLetter}${dataEndRow})`, result: isCurrencyKey(key) ? roundMoney(total) : total };
        }
        return null;
      });
      const totalRow = sheet.addRow(totalValues);
      totalRow.height = 28;
      const firstSum = columns.findIndex(key => summableCols.includes(key));
      if (firstSum > 1) sheet.mergeCells(totalRow.number, 1, totalRow.number, firstSum);
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
          cell.numFmt = isCurrencyKey(key) ? CURRENCY : numericFormat(cell.value?.result);
        } else if (colNumber === 1) {
          cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        } else {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        }
      });

      if (filter) sheet.autoFilter = {
        from: { row: headerRow, column: 1 },
        to: { row: dataEndRow, column: columns.length }
      };
      return;
    }
  }

  if (filter) sheet.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: Math.max(headerRow, sheet.rowCount), column: columns.length }
  };
}

function addRanking(sheet, columns, section) {
  const all = section.exportAllRows !== false && Array.isArray(section.allRows);
  const rows = all ? section.allRows : section.rows || [];
  const limit = section.limit || 10;
  addTableRows(sheet, columns, rows, false, { totalLabel: all ? 'TOTAL TODOS' : `Total Top ${limit}` });
  for (let index = 0; index < Math.min(limit, section.rows?.length || 0, rows.length); index++) {
    sheet.getRow(HEADER_ROW + 1 + index).eachCell((cell, column) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F7FC' } };
      cell.font = { name: 'Calibri', size: 10, bold: column === 2 || column === 4, color: { argb: BRAND.azulOscuro } };
    });
  }
}

function resultStrip(sheet, section, columns, ranking = false) {
  const count = Math.max(columns.length, 4);
  if (columns.length < 4) {
    sheet.getColumn(2).width = 24;
    sheet.getColumn(3).width = 24;
  }
  sheet.getCell('A4').value = ranking ? `Top ${section.limit || 10}` : 'Total';
  sheet.getCell('B4').value = section.quantity ?? 'No disponible';
  sheet.getCell('B4').numFmt = section.unit === 'MXN' ? CURRENCY : numericFormat(section.quantity);
  sheet.getCell('C4').value = section.unit === 'registros de servicio' ? 'registros' : section.unit;
  if (count > 3) {
    sheet.mergeCells(4, 4, 4, count);
    sheet.getCell('D4').value = section.quantity == null ? section.scopeLabel || (ranking ? 'No disponible' : null) : section.measure === 'rowCount' && section.unitQuantity !== undefined
      ? `${section.unitQuantity} unidades` : ranking ? `${section.rows?.length || 0} médicos` : section.scopeLabel || null;
    sheet.getCell('D4').alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
  }
  for (let column = 1; column <= count; column++) {
    const cell = sheet.getCell(4, column);
    cell.font = { name: 'Calibri', size: column === 2 ? 14 : 10, bold: column < 3, color: { argb: BRAND.azulOscuro } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.grisInfo } };
    if (column < 4) cell.alignment = { vertical: 'middle', horizontal: column === 2 ? 'right' : 'left', wrapText: true };
  }
}

const complementaryLabel = key => ({
  operatingRoomAccounts: 'Atenciones con estancia en quirófano',
  operatingRoomChargeAccounts: 'Atenciones con cargos CQX vigentes',
  sameDayProcedures: 'Procedimientos con ingreso y alta el mismo día',
  structuralUltrasound: 'Ultrasonido estructural',
  laboratoryPackages: 'Paquetes de laboratorio'
})[key] || key.replace(/([a-z])([A-Z])/g, '$1 $2');
const readerCriterion = value => String(value || '')
  .replace(/,?\s*como (?:los pivotes generales del archivo base|los pivotes de los Excel base|el pivote de los Excel base|el pivote base|el Excel base)/gi, '')
  .replace(/,?\s*como Cuenta de Servicio en el pivote base/gi, '')
  .replace(/Su coincidencia con los Excel base se informa en la conciliación\.\s*/gi, '')
  .replace(/Excel base/gi, 'referencia institucional')
  .replace(/UDR_CONSULTAS_PROG/g, 'la agenda de especialidad')
  .replace(/V_UDR_CONSULTA_DIA/g, 'el registro de consultas');
const cutoffLabel = value => value && Number.isFinite(new Date(value).getTime())
  ? new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : null;

function unavailableAnnual(report) {
  return { rows: [], quantity: null, unit: 'MXN', limit: 20, exportAllRows: false, scopeLabel: 'Cobertura anual pendiente',
    period: { startDate: `${report.period.endDate.slice(0, 4)}-01-01`, endDate: report.period.endDate },
    criterion: 'Top 20 acumulado desde el 1 de enero hasta la fecha final del informe. No hay información anual completa para calcularlo.' };
}

const MONTH_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const SERIES_COLORS = ['C99A00', 'E53935', '7295D8', '244A80', '9B9B9B', '35A9D0', '4779C6', '004687'];

function addMonthlyComparison(workbook, report) {
  const comparison = report.monthlyComparison;
  if (!comparison?.sections || !Array.isArray(comparison.years) || !comparison.years.length) return [];
  const definitions = SECTIONS.filter(({ key }) => comparison.sections[key] && !['hospitalDoctors', 'emergencyDoctors'].includes(key));
  if (!definitions.length) return [];
  const sheet = workbook.addWorksheet('Comparativo mensual');
  sheet.properties.defaultRowHeight = 18;
  sheet.columns = [{ width: 15 }, ...MONTH_LABELS.map(() => ({ width: 15 }))];
  sheet.views = [{ state: 'frozen', ySplit: HEADER_ROW, showGridLines: false }];
  sheet.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    printTitlesRow: '1:4', margins: { left: 0.25, right: 0.25, top: 0.3, bottom: 0.3, header: 0.1, footer: 0.15 } };
  sheet.headerFooter.oddFooter = '&LHospital Escandón&R&P / &N';
  for (const row of [1, 2, 3]) sheet.mergeCells(row, 1, row, 13);
  sheet.getCell('A1').value = 'Hospital Escandón · Comparativo mensual';
  sheet.getCell('A1').font = { name: 'Calibri', size: 15, bold: true, color: { argb: BRAND.blanco } };
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.azulOscuro } };
  sheet.getCell('A1').alignment = { vertical: 'middle', indent: 1 };
  sheet.getRow(1).height = 32;
  sheet.getCell('A2').value = `${comparison.years[0]}–${comparison.years.at(-1)} · Evolución de los 16 indicadores`;
  sheet.getCell('A2').font = { name: 'Calibri', size: 11, color: { argb: BRAND.azulOscuro } };
  sheet.getCell('A2').alignment = { vertical: 'middle', indent: 1 };
  sheet.getRow(2).height = 23;
  const cuts = [...new Set((comparison.partialMonths || []).map(({ throughDate }) => throughDate))].sort();
  const shortDate = value => value.split('-').reverse().join('/');
  const approvedCut = /^\d{4}-(0[1-9]|1[0-2])$/.test(comparison.acceptedThroughMonth || '')
    ? new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(`${comparison.acceptedThroughMonth}-01T00:00:00Z`)) : '';
  const acceptedNote = comparison.coverage?.acceptedMonths?.length
    ? `Cierres institucionales aprobados${approvedCut ? ` hasta ${approvedCut}` : ''} para meses anteriores al periodo. Periodo seleccionado: plataforma. ` : '';
  sheet.getCell('A3').value = `${acceptedNote}Celdas vacías: información no disponible.${cuts.length ? ` * Mes parcial al ${cuts.map(shortDate).join(', ')}.` : ''}`;
  sheet.getCell('A3').font = { name: 'Calibri', size: 10, color: { argb: BRAND.grisTexto } };
  sheet.getCell('A3').alignment = { vertical: 'middle', indent: 1, wrapText: true };
  sheet.getRow(3).height = 27;
  sheet.getCell('A4').value = { text: 'Volver al resumen', hyperlink: "#'Resumen'!A1" };
  sheet.getCell('A4').font = { name: 'Calibri', size: 10, color: { argb: BRAND.azulOscuro }, underline: true };
  sheet.getRow(4).height = 20;
  sheet.getRow(5).height = 8;
  const charts = [];
  for (const [index, definition] of definitions.entries()) {
    const section = comparison.sections[definition.key];
    const start = 6 + index * 31;
    const headerRow = start + 20;
    const header = sheet.getRow(headerRow);
    header.values = ['Año', ...MONTH_LABELS];
    header.height = 23;
    header.eachCell(cell => {
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: BRAND.azulOscuro } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.azulTotales } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = hairBorder;
    });
    const series = section.series.map((entry, yearIndex) => {
      const rowNumber = headerRow + yearIndex + 1;
      const latest = entry.year === comparison.years.at(-1);
      const color = SERIES_COLORS[((entry.year - 2019) % SERIES_COLORS.length + SERIES_COLORS.length) % SERIES_COLORS.length];
      const row = sheet.getRow(rowNumber);
      row.height = 21;
      row.getCell(1).value = `${entry.year}${entry.partialMonths?.length ? '*' : ''}`;
      for (let month = 0; month < 12; month++) {
        const cell = row.getCell(month + 2);
        const value = entry.values[month];
        // The selected monthly point uses the same editable total as its detail sheet.
        cell.value = value == null ? null : entry.sources?.[month] === 'current-report'
          ? { formula: `'${definition.sheet.replace(/'/g, "''")}'!B4`, result: value } : value;
        cell.numFmt = section.unit === 'MXN' ? CURRENCY : numericFormat(value);
      }
      row.eachCell({ includeEmpty: true }, (cell, column) => {
        cell.font = { name: 'Calibri', size: 10, bold: latest, color: { argb: column === 1 ? `FF${color}` : BRAND.textoOscuro } };
        cell.alignment = { vertical: 'middle', horizontal: column === 1 ? 'center' : 'right' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: latest ? BRAND.azulTotales : yearIndex % 2 ? BRAND.grisFila : BRAND.blanco } };
        cell.border = hairBorder;
      });
      return { name: String(entry.year), color, values: entry.values,
        formula: `'Comparativo mensual'!$B$${rowNumber}:$M$${rowNumber}` };
    });
    const chartTitle = definition.key === 'births' ? 'Nacimientos' : definition.label;
    charts.push({ sheetIndex: workbook.worksheets.indexOf(sheet) + 1, title: chartTitle, unit: section.unit,
      categoryValues: MONTH_LABELS, categoriesFormula: `'Comparativo mensual'!$B$${headerRow}:$M$${headerRow}`,
      series, anchor: { from: { col: 0, row: start - 1 }, to: { col: 13, row: headerRow - 2 } } });
    if (index > 0) sheet.getRow(start - 1).addPageBreak();
  }
  sheet.pageSetup.printArea = `A1:M${6 + (definitions.length - 1) * 31 + 20 + comparison.years.length}`;
  return charts;
}

/* Libro institucional de resultados para consulta y entrega directiva */
async function createStatisticsWorkbook(report) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Hospital Escandón';
  workbook.subject = 'Estadístico institucional';
  workbook.created = new Date(report.generatedAt);
  workbook.calcProperties.fullCalcOnLoad = true;
  const summary = workbook.addWorksheet('Resumen');
  const summaryColumns = ['Indicador', 'Resultado', 'Unidad'];
  styleSheet(summary, 'Hospital Escandón · Estadístico institucional', report, summaryColumns);
  if (report.storage?.updatedAt) {
    const timestamp = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'short', timeStyle: 'short' }).format(new Date(report.storage.updatedAt));
    const pending = report.storage.pendingMonths?.length ? ' · actualización en curso' : report.storage.failedMonths?.length ? ' · última copia completa conservada' : '';
    summary.getCell('A2').value += `\nCorte de información: ${timestamp}${pending}`;
    summary.getCell('A2').alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
    summary.getRow(2).height = 40;
  }
  summary.getColumn(1).width = 50;
  summary.getColumn(2).width = 24;
  summary.getColumn(3).width = 24;
  summary.pageSetup.orientation = 'portrait';
  summary.pageSetup.fitToHeight = 1;
  summary.mergeCells('A4:C4');
  summary.getCell('A4').value = 'Resultados del periodo · Seleccione un indicador para abrir su detalle';
  summary.getCell('A4').font = { name: 'Calibri', size: 10, color: { argb: BRAND.grisTexto } };
  summary.getCell('A4').alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  const monthlyCharts = addMonthlyComparison(workbook, report);
  const summaryRows = [], criteriaEntries = [];
  const addPrimary = (definition, section, ranking = false, period = report.period) => {
    const rows = section.rows || [];
    const columns = ranking ? SECTION_COLUMNS.hospitalDoctors : getColumnsForSection(definition.key, rows);
    const sheet = workbook.addWorksheet(definition.sheet);
    styleSheet(sheet, definition.label, { ...report, period }, columns);
    resultStrip(sheet, section, columns, ranking);
    if (ranking) addRanking(sheet, columns, section);
    else addTableRows(sheet, columns, rows.length ? rows : [{ Observaciones: section.quantity == null ? 'Información no disponible.' : 'Sin registros en este periodo.' }], false);
    summaryRows.push({
      Indicador: { text: definition.label, hyperlink: `#'${definition.sheet.replace(/'/g, "''")}'!A1` },
      Resultado: section.quantity == null ? 'No disponible' : { formula: `'${definition.sheet.replace(/'/g, "''")}'!B4`, result: section.quantity },
      Unidad: section.unit || definition.unit
    });
    criteriaEntries.push({ label: definition.label, section });
    return sheet;
  };
  const doctorDefinitions = SECTIONS.filter(definition => ['hospitalDoctors', 'emergencyDoctors'].includes(definition.key));
  for (const definition of SECTIONS.filter(definition => !['hospitalDoctors', 'emergencyDoctors'].includes(definition.key))) {
    addPrimary(definition, report.sections[definition.key] || { rows: [], quantity: null, unit: definition.unit });
  }
  addPrimary({ sheet: '14 Médicos ingreso general', label: 'Top 10 médicos por ingreso general', unit: 'MXN' },
    { rows: [], quantity: null, ...report.doctorRankings?.general, limit: 10, exportAllRows: false, unit: 'MXN' }, true);
  const annual = { ...unavailableAnnual(report), ...report.annualDoctorRanking, limit: 20, exportAllRows: false, unit: 'MXN' };
  addPrimary({ sheet: '15 Médicos ingreso anual', label: 'Top 20 médicos por ingreso anual', unit: 'MXN' }, annual, true, annual.period);
  const doctorSheets = [];
  for (const definition of doctorDefinitions) {
    const section = report.sections[definition.key] || { rows: [], quantity: null, unit: definition.unit };
    const sheet = workbook.addWorksheet(definition.sheet);
    styleSheet(sheet, definition.label, report, SECTION_COLUMNS.hospitalDoctors);
    resultStrip(sheet, section, SECTION_COLUMNS.hospitalDoctors, true);
    addRanking(sheet, SECTION_COLUMNS.hospitalDoctors, section);
    doctorSheets.push(sheet);
    criteriaEntries.push({ label: definition.label, section });
  }
  addTableRows(summary, summaryColumns, summaryRows, true);
  summaryRows.forEach((row, index) => {
    const result = summary.getCell(index + HEADER_ROW + 1, 2);
    result.numFmt = row.Unidad === 'MXN' ? CURRENCY : numericFormat(row.Resultado?.result);
    result.font = { name: 'Calibri', size: 12, bold: true, color: { argb: BRAND.azulOscuro } };
    result.alignment = { vertical: 'middle', horizontal: 'right' };
    summary.getCell(index + HEADER_ROW + 1, 1).font = { name: 'Calibri', size: 10, color: { argb: BRAND.textoOscuro } };
  });
  const orders = workbook.addWorksheet('Órdenes por médico');
  const orderColumns = ['Fecha', 'Documento', 'FolioAtencion', 'TipoAtencion', 'Medico', 'NumeroMedico', 'IngresoTotal', 'IVA', 'EstadoDocumento', 'AtencionesMultiples', 'AlcanceRanking'];
  styleSheet(orders, 'Órdenes por médico', report, orderColumns);
  orders.mergeCells('A4:K4');
  orders.getCell('A4').value = `${report.doctorDocuments?.length || 0} órdenes · Hospitalización, urgencias y atención externa identificadas por tipo`;
  orders.getCell('A4').font = { name: 'Calibri', size: 10, color: { argb: BRAND.grisTexto } };
  orders.getCell('A4').alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  addTableRows(orders, orderColumns, report.doctorDocuments || []);
  const serviceSummaries = SECTIONS.flatMap(definition => (report.sections[definition.key]?.serviceSummary || []).map(row => ({ Indicador: definition.label, ...row })))
    .concat(Object.entries(report.complements || {}).flatMap(([key, section]) => (section.serviceSummary || []).map(row => ({ Indicador: `Complemento · ${complementaryLabel(key)}`, ...row }))));
  if (serviceSummaries.length) {
    const sheet = workbook.addWorksheet('Servicios por concepto');
    const columns = ['Indicador', 'Codigo', 'Servicio', 'Registros', 'Cantidad', 'ImporteLinea', 'IngresoNeto', 'IVA', 'ImporteTotal'];
    styleSheet(sheet, 'Servicios por concepto', report, columns);
    sheet.getColumn(1).width = 34;
    sheet.getColumn(3).width = 48;
    sheet.mergeCells('A4:I4');
    sheet.getCell('A4').value = 'Estancia y terapia se presentan por separado.';
    sheet.getCell('A4').font = { name: 'Calibri', size: 10, color: { argb: BRAND.grisTexto } };
    sheet.getCell('A4').alignment = { vertical: 'middle', horizontal: 'left' };
    addTableRows(sheet, columns, serviceSummaries, true);
  }
  const criteria = workbook.addWorksheet('Criterios');
  const criteriaColumns = ['Indicador', 'Resultado', 'Unidad', 'Criterio', 'Disponibilidad'];
  styleSheet(criteria, 'Criterios y disponibilidad de los indicadores', report, criteriaColumns);
  criteria.getColumn(1).width = 46;
  criteria.getColumn(4).width = 92;
  criteria.mergeCells('A4:E4');
  criteria.getCell('A4').value = 'Definición de cada indicador y datos pendientes de confirmar.';
  criteria.getCell('A4').font = { name: 'Calibri', size: 10, color: { argb: BRAND.grisTexto } };
  const complements = Object.entries(report.complements || {}).map(([key, section]) => ({ label: complementaryLabel(key), section }));
  const criteriaRows = [...criteriaEntries, ...complements].map(({ label, section }) => {
    const cut = section.coverage?.complete ? cutoffLabel(section.coverage.updatedAt) : null;
    const refreshing = section.coverage?.refreshStatus;
    return { Indicador: label, Resultado: section.quantity ?? 'No disponible', Unidad: section.unit || '',
      Criterio: readerCriterion([section.criterion, ...(section.quantity == null ? section.warnings || [] : []),
        ...(section.coverage?.complete ? [cut ? `Corte anual disponible: ${cut}` : 'Corte de actualización anual no confirmado.'] : [])].filter(Boolean).join(' ')),
      Disponibilidad: section.quantity == null ? 'Pendiente' : refreshing === 'refreshing' ? 'Disponible · actualización en curso'
        : refreshing === 'failed' ? 'Disponible · última copia conservada' : 'Disponible' };
  });
  if (monthlyCharts.length) criteriaRows.push({ Indicador: 'Comparativo mensual', Resultado: '', Unidad: '',
    Criterio: 'Los años anteriores a 2026 conservan los cierres históricos. Los cierres aprobados disponibles de 2026 se utilizan únicamente en meses anteriores al periodo seleccionado. Los meses seleccionados y los meses sin cierre aprobado utilizan la información verificada de la plataforma; sus definiciones o registros pueden diferir de los cierres anteriores. Cada punto corresponde a un mes; los parciales se marcan con asterisco y los meses sin información permanecen vacíos.',
    Disponibilidad: 'Consultar cobertura en las tablas del comparativo' });
  addTableRows(criteria, criteriaColumns, criteriaRows, true);
  criteriaRows.forEach((row, index) => { criteria.getCell(index + HEADER_ROW + 1, 2).numFmt = row.Unidad === 'MXN' ? CURRENCY : numericFormat(row.Resultado); });
  const complementaryRows = complements.flatMap(({ label, section }) => (section.rows || []).map(row => ({ Complemento: label, ...row })));
  const activity = workbook.addWorksheet('Datos complementarios');
  const activityColumns = getColumnsForSection('complementaryActivity', complementaryRows);
  styleSheet(activity, 'Detalle de actividad complementaria', report, activityColumns);
  activity.getColumn(1).width = 46;
  activity.mergeCells(4, 1, 4, Math.max(4, activityColumns.length));
  activity.getCell('A4').value = 'Los grupos de actividad se consultan por separado.';
  activity.getCell('A4').font = { name: 'Calibri', size: 10, color: { argb: BRAND.grisTexto } };
  addTableRows(activity, activityColumns, complementaryRows.length ? complementaryRows : [{ Observaciones: 'No hay detalle complementario disponible.' }], true);
  if (monthlyCharts.length) {
    const link = summary.addRow([{ text: 'Ver gráficos y comparativo mensual', hyperlink: "#'Comparativo mensual'!A1" }]);
    summary.mergeCells(link.number, 1, link.number, 3);
    link.height = 27;
    link.getCell(1).font = { name: 'Calibri', size: 11, bold: true, color: { argb: BRAND.azulOscuro }, underline: true };
  }
  const navigation = summary.addRow(['Detalle complementario']);
  summary.mergeCells(navigation.number, 1, navigation.number, 3);
  navigation.height = 26;
  navigation.getCell(1).font = { name: 'Calibri', size: 10, bold: true, color: { argb: BRAND.azulOscuro } };
  for (const sheet of [...doctorSheets, orders, workbook.getWorksheet('Servicios por concepto'), criteria, activity].filter(Boolean)) {
    const row = summary.addRow([{ text: sheet.name, hyperlink: `#'${sheet.name}'!A1` }]);
    row.height = 22;
    row.getCell(1).font = { name: 'Calibri', size: 10, color: { argb: BRAND.azulOscuro }, underline: true };
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return monthlyCharts.length ? attachLineCharts(buffer, monthlyCharts) : buffer;
}

module.exports = { createStatisticsWorkbook };
