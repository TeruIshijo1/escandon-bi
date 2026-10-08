'use strict';

const ExcelJS = require('exceljs');
const { sql } = require('../config/remote-db');

// Conserva los registros de honorarios y excluye códigos y grupos de inventarios.
const COLUMNS = [
  ['PCDate', 'Fecha del registro', 'date'], ['PCNum', 'Folio de referencia', 'number'],
  ['UDRKey', 'Referencia de origen'], ['SONum', 'Folio de orden de venta', 'number'],
  ['PTName', 'Paciente'], ['BPName', 'Cliente o aseguradora'], ['Medico', 'Médico'],
  ['Especialidad', 'Especialidad'], ['UDF_TIPO_MEDICO', 'Tipo de médico'],
  ['ItemGroupName', 'Grupo de servicio'], ['ItemCode', 'Código de servicio'],
  ['ItemDescription', 'Servicio'], ['ItemType', 'Tipo de servicio'],
  ['Quantity', 'Cantidad', 'number'], ['UnitPrice', 'Precio unitario al paciente', 'money'],
  ['IMPORTE', 'Importe de referencia', 'money'], ['IvaLinea', 'IVA registrado', 'money'],
  ['ISRRateRaw', 'Tasa ISR registrada', 'number'], ['TaxRateRaw', 'Tasa de impuesto registrada', 'number'],
  ['TaxCode', 'Clave de impuesto'], ['CreatedOn', 'Fecha de creación', 'date'],
  ['OrigenRenglon', 'Origen del registro'], ['PCAP_ST', 'Estado de cita'], ['SO_ST', 'Estado de orden'],
  ['Pasa_PC_ST', 'Cumple estado de atención', 'boolean'],
  ['Pasa_ItemType', 'Cumple tipo de servicio', 'boolean'],
  ['Pasa_UT_Honorarios', 'Tiene referencia en catálogo', 'boolean'],
  ['Pasa_Incluido_Honorarios', 'Cumple inclusión de honorarios', 'boolean'],
  ['Elegible_V_HON_PAGO', 'Cumple reglas de Vertical', 'boolean'], ['MotivoExclusion', 'Motivo de exclusión']
].map(([key, label, type = 'text']) => ({ key, label, type }));

const STATUS_LABELS = { eligible: 'Cumple reglas', excluded: 'Fuera de reglas', unknown: 'Sin evaluar' };
const SOURCE_LABELS = { PC: 'Atención hospitalaria', CITA: 'Cita médica', SO: 'Orden de venta',
  PCBL: 'Cargo clínico', PCIT: 'Cargo clínico', CARGO: 'Cargo clínico',
  ATENCION_MEDICA_PCBL: 'Atención médica', ORDEN_CITA_PCAP_SO: 'Orden con cita',
  ORDEN_SIN_CITA: 'Orden sin cita', PROCEDIMIENTO_PCFRCP: 'Procedimiento médico' };
const bitText = value => value == null ? 'Sin dato' : value === true || value === 1 ? 'Sí' : 'No';
const statusOf = row => row.Elegible_V_HON_PAGO == null ? 'unknown'
  : row.Elegible_V_HON_PAGO === true || row.Elegible_V_HON_PAGO === 1 ? 'eligible' : 'excluded';
const sourceLabel = value => SOURCE_LABELS[value] || (value ? 'Otro origen' : 'Sin origen');
const localDate = value => value instanceof Date
  ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}T${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}:${String(value.getSeconds()).padStart(2, '0')}`
  : value;
const badInput = message => Object.assign(new Error(message), { status: 400 });
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1753-01-01' || value > '9999-12-30') return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function validateFilters(input = {}) {
  if (!validDate(input.startDate) || !validDate(input.endDate) || input.startDate > input.endDate)
    throw badInput('Elige una fecha inicial y final válidas, en ese orden.');
  const filters = { startDate: input.startDate, endDate: input.endDate };
  for (const [key, limit] of [['doctor', 250], ['group', 250], ['source', 100], ['search', 200]]) {
    if (input[key] != null && (typeof input[key] !== 'string' || input[key].length > limit))
      throw badInput('Uno de los filtros es demasiado largo. Reduce el texto y vuelve a consultar.');
    filters[key] = (input[key] || '').trim();
  }
  filters.status = input.status || 'all';
  if (!['all', 'eligible', 'excluded', 'unknown'].includes(filters.status)) throw badInput('Elige un estado válido.');
  filters.sort = input.sort || 'date';
  if (!['date', 'doctor', 'patient', 'service', 'amount'].includes(filters.sort)) throw badInput('Elige un orden válido.');
  filters.direction = input.direction || 'desc';
  if (!['asc', 'desc'].includes(filters.direction)) throw badInput('Elige un orden válido.');
  filters.page = Number(input.page || 1);
  filters.pageSize = Number(input.pageSize || 50);
  if (!Number.isSafeInteger(filters.page) || filters.page < 1 || filters.page > 1000000
    || ![25, 50, 100].includes(filters.pageSize)) throw badInput('La página solicitada no es válida.');
  return filters;
}

const SELECT = COLUMNS.map(column => `a.[${column.key}]`).join(', ');
const ORDER_FIELDS = { date: 'a.PCDate', doctor: 'a.Medico', patient: 'a.PTName',
  service: 'a.ItemDescription', amount: 'a.IMPORTE' };
function buildQuery(pool, filters, periodOnly = false) {
  const request = pool.request();
  // useUTC:false en el pool: medianoche del calendario del hospital, sin depender de DATEFORMAT.
  request.input('startDate', sql.DateTime, new Date(`${filters.startDate}T00:00:00`));
  request.input('endDate', sql.DateTime, new Date(`${filters.endDate}T00:00:00`));
  const clauses = ['a.PCDate >= @startDate', 'a.PCDate < DATEADD(day, 1, @endDate)',
    "LEFT(UPPER(LTRIM(RTRIM(COALESCE(a.ItemCode, '')))), 3) NOT IN ('FAR', 'ALM')",
    "COALESCE(a.ItemGroupName, '') COLLATE Latin1_General_CI_AI NOT LIKE '%ALMACEN%'",
    "COALESCE(a.ItemGroupName, '') COLLATE Latin1_General_CI_AI NOT LIKE '%FARMACIA%'"];
  if (!periodOnly) {
    for (const [key, field] of [['doctor', 'Medico'], ['group', 'ItemGroupName'], ['source', 'OrigenRenglon']]) {
      if (filters[key]) { clauses.push(`a.[${field}] = @${key}`); request.input(key, sql.NVarChar(250), filters[key]); }
    }
    if (filters.status === 'unknown') clauses.push('a.Elegible_V_HON_PAGO IS NULL');
    else if (filters.status !== 'all') {
      clauses.push('a.Elegible_V_HON_PAGO = @eligible'); request.input('eligible', sql.Bit, filters.status === 'eligible');
    }
    if (filters.search) {
      // CHARINDEX mantiene %, _ y corchetes como texto literal, sin interpolar SQL.
      request.input('search', sql.NVarChar(200), filters.search);
      clauses.push(`(${['PTName', 'BPName', 'Medico', 'ItemDescription', 'ItemCode', 'UDRKey', 'MotivoExclusion']
        .map(field => `CHARINDEX(@search COLLATE Latin1_General_CI_AI, a.[${field}] COLLATE Latin1_General_CI_AI) > 0`)
        .concat(['CHARINDEX(@search, CONVERT(nvarchar(30), a.PCNum)) > 0', 'CHARINDEX(@search, CONVERT(nvarchar(30), a.SONum)) > 0']).join(' OR ')})`);
    }
  }
  return { request, from: `FROM UDR_HON_PAGO_Audit a WHERE ${clauses.join(' AND ')}` };
}
// Todas las columnas desempatan: se conservan incluso las filas originales repetidas.
const orderBy = filters => {
  const primary = ORDER_FIELDS[filters.sort].slice(2);
  return `ORDER BY a.[${primary}] ${filters.direction.toUpperCase()}, ${COLUMNS.filter(c => c.key !== primary).map(c => `a.[${c.key}]`).join(', ')}`;
};
const normalizeRow = row => ({ ...row, PCDate: localDate(row.PCDate), CreatedOn: localDate(row.CreatedOn),
  auditStatus: statusOf(row), auditStatusLabel: STATUS_LABELS[statusOf(row)], sourceLabel: sourceLabel(row.OrigenRenglon) });

async function readOptions(pool, input) {
  const filters = validateFilters(input);
  const period = buildQuery(pool, filters, true);
  const choices = await period.request.query(`
    SELECT DISTINCT a.Medico AS value ${period.from} AND NULLIF(LTRIM(RTRIM(a.Medico)), '') IS NOT NULL ORDER BY value;
    SELECT DISTINCT a.ItemGroupName AS value ${period.from} AND NULLIF(LTRIM(RTRIM(a.ItemGroupName)), '') IS NOT NULL ORDER BY value;
    SELECT DISTINCT a.OrigenRenglon AS value ${period.from} AND NULLIF(LTRIM(RTRIM(a.OrigenRenglon)), '') IS NOT NULL ORDER BY value;
  `);
  return { doctors: choices.recordsets[0].map(r => r.value), groups: choices.recordsets[1].map(r => r.value),
    sources: choices.recordsets[2].map(r => ({ value: r.value, label: sourceLabel(r.value) })) };
}

async function readAudit(pool, input) {
  const filters = validateFilters(input);
  const { request, from } = buildQuery(pool, filters);
  request.input('offset', sql.Int, (filters.page - 1) * filters.pageSize);
  request.input('pageSize', sql.Int, filters.pageSize);
  const result = await request.query(`
    SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN a.Elegible_V_HON_PAGO = 1 THEN 1 ELSE 0 END), 0) AS eligible,
      COALESCE(SUM(CASE WHEN a.Elegible_V_HON_PAGO = 0 THEN 1 ELSE 0 END), 0) AS excluded,
      COALESCE(SUM(CASE WHEN a.Elegible_V_HON_PAGO IS NULL THEN 1 ELSE 0 END), 0) AS unknown,
      SUM(a.IMPORTE) AS referenceAmount ${from};
    SELECT ${SELECT} ${from} ${orderBy(filters)} OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
  `);
  const summary = result.recordsets[0][0];
  const options = input.includeOptions === 'true' ? await readOptions(pool, filters) : undefined;
  return { rows: result.recordsets[1].map(normalizeRow), summary, page: filters.page, pageSize: filters.pageSize,
    totalPages: Math.ceil(summary.total / filters.pageSize), columns: COLUMNS, options };
}

const EXPORT_LIMIT = 50000;
async function readExport(pool, input) {
  const filters = validateFilters(input);
  const { request, from } = buildQuery(pool, filters);
  const result = await request.query(`SELECT TOP (${EXPORT_LIMIT + 1}) ${SELECT} ${from} ${orderBy(filters)}`);
  if (result.recordset.length > EXPORT_LIMIT)
    throw badInput('Hay más de 50,000 registros. Reduce las fechas o añade filtros para descargar el Excel completo.');
  return { filters, rows: result.recordset.map(normalizeRow) };
}
async function writeExcel(stream, { filters, rows }, user) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true });
  workbook.creator = 'Hospital Escandón';
  const sheet = workbook.addWorksheet('Auditoría', { views: [{ state: 'frozen', ySplit: 6 }] });
  const headers = [...COLUMNS, { key: 'auditStatusLabel', label: 'Resultado de revisión', type: 'text' }];
  sheet.columns = headers.map(c => ({ key: c.key, width: c.type === 'text' ? 30 : 23 }));
  sheet.addRow(['Hospital Escandón · Auditoría de honorarios']).commit();
  sheet.addRow([`Periodo: ${filters.startDate} al ${filters.endDate} · ${rows.length} registros`]).commit();
  sheet.addRow([`Filtros: médico ${filters.doctor || 'Todos'}; grupo ${filters.group || 'Todos'}; origen ${filters.source || 'Todos'}; estado ${STATUS_LABELS[filters.status] || 'Todos'}; búsqueda ${filters.search || 'Sin búsqueda'}`]).commit();
  sheet.addRow([`Generado por: ${user?.nombre || user?.username || 'Usuario'} · ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}`]).commit();
  sheet.addRow(['Importes de referencia y reglas originales de Vertical. Se excluyen farmacia y almacenes por grupo y por códigos FAR/ALM. El folio de referencia puede corresponder a atención, cita u orden según su origen.']).commit();
  const header = sheet.addRow(headers.map(c => c.label));
  header.height = 34;
  header.eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF004687' } };
    cell.alignment = { wrapText: true, vertical: 'middle' }; });
  header.commit();
  sheet.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6 + rows.length, column: headers.length } };
  for (const source of rows) {
    const row = sheet.addRow(headers.map(c => c.type === 'boolean' ? bitText(source[c.key])
      : source[c.key] == null ? '' : source[c.key]));
    headers.forEach((c, index) => {
      if (c.type === 'money') row.getCell(index + 1).numFmt = '"$"#,##0.00;[Red]-"$"#,##0.00';
      if (c.type === 'number') row.getCell(index + 1).numFmt = '#,##0.####';
    });
    row.commit();
  }
  sheet.commit();
  await workbook.commit();
}
module.exports = { readAudit, readOptions, readExport, writeExcel, validateFilters, COLUMNS, normalizeRow };
