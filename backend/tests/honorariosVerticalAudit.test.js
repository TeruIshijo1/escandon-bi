'use strict';
const { PassThrough } = require('stream');
const ExcelJS = require('exceljs');
const audit = require('../services/honorariosVerticalAudit.service');
const period = { startDate: '2026-09-01', endDate: '2026-09-30' };
const poolFor = result => {
  const requests = [];
  return { requests, request: () => {
    const inputs = {}; const request = { inputs, input: jest.fn((name, type, value) => { inputs[name] = value; return request; }),
      query: jest.fn().mockResolvedValue(result) };
    requests.push(request); return request;
  } };
};

test('rejects invalid dates, filters, pagination and arbitrary sorting before querying', () => {
  for (const change of [{ startDate: '2026-02-30' }, { endDate: '2026-08-31' }, { startDate: ['2026-09-01'] },
    { search: ['texto'] }, { doctor: 'a'.repeat(251) }, { page: '1.5' }, { pageSize: '500' },
    { status: 'APROBADO' }, { sort: 'IMPORTE; DROP TABLE PC' }, { direction: 'desc;--' }])
    expect(() => audit.validateFilters({ ...period, ...change })).toThrow();
});

test('filters stay parameterized and retain duplicate rows from clinical groups', async () => {
  const row = { PCDate: new Date(2026, 8, 2, 23, 40), CreatedOn: null, ItemGroupName: 'DENTAL',
    IMPORTE: null, Elegible_V_HON_PAGO: null, UDRKey: 'SO-123', PCNum: 123 };
  const summary = { total: 202, eligible: 10, excluded: 180, unknown: 12, referenceAmount: null };
  const pool = poolFor({ recordsets: [[summary], [row, row]] });
  const search = "O'Hara_%'; DROP TABLE PC;--";
  const result = await audit.readAudit(pool, { ...period, search, doctor: 'MÉDICO PRUEBA', group: 'DENTAL',
    source: 'SO', status: 'unknown', page: '3', pageSize: '100', sort: 'amount', direction: 'asc' });
  const request = pool.requests[0]; const query = request.query.mock.calls[0][0];
  expect(query).not.toContain(search);
  expect(request.inputs).toMatchObject({ search, doctor: 'MÉDICO PRUEBA', group: 'DENTAL', source: 'SO', offset: 200, pageSize: 100 });
  expect(query).toContain('CHARINDEX(@search');
  expect(query).toContain('a.Elegible_V_HON_PAGO IS NULL');
  expect(query).toContain('ORDER BY a.[IMPORTE] ASC');
  expect(query.split('ORDER BY')[1].match(/a\.\[IMPORTE\]/g)).toHaveLength(1);
  expect(query).not.toMatch(/JOIN |DISTINCT|a\.\[?ItemGroupName\]?\s+NOT IN|UDR_HON_PAGO p/);
  expect(result).toMatchObject({ summary, totalPages: 3, page: 3, pageSize: 100 });
  expect(result.rows).toHaveLength(2);
  expect(result.rows[0]).toMatchObject({ PCDate: '2026-09-02T23:40:00', IMPORTE: null, auditStatus: 'unknown',
    auditStatusLabel: 'Sin evaluar', PCNum: 123 });
});

test('inventory codes and groups are excluded before totals, pagination, every filter list and the complete Excel query', async () => {
  const pool = poolFor({ recordsets: [[{ total: 0 }], [], []], recordset: [] });
  await audit.readAudit(pool, period);
  await audit.readOptions(pool, period);
  await audit.readExport(pool, { ...period, group: 'FARMACIA', search: 'far' });
  const queries = pool.requests.map(request => request.query.mock.calls[0][0]);
  const exclusion = "LEFT(UPPER(LTRIM(RTRIM(COALESCE(a.ItemCode, '')))), 3) NOT IN ('FAR', 'ALM')";
  // Los dos SELECT del reporte y los tres de opciones deben filtrar en origen;
  // una exclusión posterior dejaría totales, páginas o listas inconsistentes.
  for (const [index, expected] of [2, 3, 1].entries()) {
    expect(queries[index].split(exclusion)).toHaveLength(expected + 1);
    expect(queries[index].split("COLLATE Latin1_General_CI_AI NOT LIKE '%ALMACEN%'")).toHaveLength(expected + 1);
    expect(queries[index].split("COLLATE Latin1_General_CI_AI NOT LIKE '%FARMACIA%'")).toHaveLength(expected + 1);
  }
  expect(queries[2]).toContain('a.[ItemGroupName] = @group');
  expect(queries[2]).toContain('CHARINDEX(@search');
  expect(pool.requests[2].inputs).toMatchObject({ group: 'FARMACIA', search: 'far' });
});

test('options describe the whole period even when a doctor or status is selected', async () => {
  const pool = poolFor({}); let index = 0;
  pool.request = () => {
    const request = { input: jest.fn().mockReturnThis(), query: jest.fn().mockResolvedValue(index++ === 0
      ? { recordsets: [[{ total: 0 }], []] }
      : { recordsets: [[{ value: 'Médico' }], [{ value: 'Grupo' }], [{ value: 'CITA' }]] }) };
    pool.requests.push(request); return request;
  };
  const result = await audit.readAudit(pool, { ...period, doctor: 'Médico', status: 'eligible', includeOptions: 'true' });
  expect(pool.requests[0].input).toHaveBeenCalledWith('eligible', expect.anything(), true);
  expect(pool.requests[1].query.mock.calls[0][0]).not.toMatch(/@doctor|@eligible/);
  expect(result.options).toEqual({ doctors: ['Médico'], groups: ['Grupo'], sources: [{ value: 'CITA', label: 'Cita médica' }] });
});

test('filter lists load independently without reading patient rows or limiting options to the selected filters', async () => {
  const pool = poolFor({ recordsets: [[{ value: 'Médico' }], [{ value: 'Grupo' }], [{ value: 'CITA' }]] });
  await expect(audit.readOptions(pool, { ...period, startDate: '2026-02-30' })).rejects.toMatchObject({ status: 400 });
  expect(pool.requests).toHaveLength(0);
  const result = await audit.readOptions(pool, { ...period, doctor: 'Otro médico', group: 'Otro grupo', status: 'eligible', page: 3 });
  expect(result).toEqual({ doctors: ['Médico'], groups: ['Grupo'], sources: [{ value: 'CITA', label: 'Cita médica' }] });
  expect(pool.requests).toHaveLength(1);
  expect(Object.keys(pool.requests[0].inputs)).toEqual(['startDate', 'endDate']);
  const query = pool.requests[0].query.mock.calls[0][0];
  expect(query).not.toMatch(/PTName|IMPORTE|COUNT\(|OFFSET|FETCH|@doctor|@eligible/);
  expect(query.match(/SELECT DISTINCT/g)).toHaveLength(3);
});

test('export preserves all matching records independently of the screen page and refuses silent truncation', async () => {
  const rows = [{ PCNum: 1, Elegible_V_HON_PAGO: true }, { PCNum: 1, Elegible_V_HON_PAGO: false }];
  const pool = poolFor({ recordset: rows });
  const result = await audit.readExport(pool, { ...period, page: 3 });
  expect(result.rows).toHaveLength(2);
  expect(pool.requests[0].query.mock.calls[0][0]).not.toMatch(/OFFSET|FETCH/);
  const oversized = poolFor({ recordset: Array(50001).fill(rows[0]) });
  await expect(audit.readExport(oversized, period)).rejects.toMatchObject({ status: 400 });
});

test('the downloadable workbook contains typed amounts, all original fields, missing flags and literal user text', async () => {
  const stream = new PassThrough(); const chunks = [];
  stream.on('data', chunk => chunks.push(chunk));
  const rows = Array.from({ length: 125 }, (_, i) => audit.normalizeRow({ PCNum: i + 1, SONum: 900 + i,
    UDRKey: 'CITA-444', PCDate: '2026-09-02T23:40:00', PTName: '=HYPERLINK("unsafe")', IMPORTE: i === 0 ? null : 123.45,
    Pasa_PC_ST: null, Pasa_ItemType: false, Pasa_UT_Honorarios: true, Elegible_V_HON_PAGO: i === 0 ? null : true }));
  await audit.writeExcel(stream, { filters: audit.validateFilters(period), rows }, { nombre: 'REVISOR PRUEBA' });
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.concat(chunks));
  const sheet = workbook.getWorksheet('Auditoría');
  expect(sheet.rowCount).toBe(131);
  const headers = sheet.getRow(6).values;
  const cell = (row, label) => sheet.getRow(row).getCell(headers.indexOf(label));
  expect(headers).toContain('Folio de referencia');
  expect(headers).toContain('Folio de orden de venta');
  expect(headers).toHaveLength(32);
  expect(cell(7, 'Importe de referencia').value).toBeNull();
  expect(cell(8, 'Importe de referencia').value).toBe(123.45);
  expect(cell(7, 'Cumple estado de atención').value).toBe('Sin dato');
  expect(cell(7, 'Cumple tipo de servicio').value).toBe('No');
  expect(cell(7, 'Tiene referencia en catálogo').value).toBe('Sí');
  expect(cell(7, 'Resultado de revisión').value).toBe('Sin evaluar');
  expect(cell(7, 'Paciente').type).toBe(ExcelJS.ValueType.String);
  expect(sheet.views[0].ySplit).toBe(6);
  expect(sheet.autoFilter).toBe('A6:AE131');
});
