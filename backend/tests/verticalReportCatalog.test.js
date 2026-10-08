'use strict';

jest.mock('../config/remote-db', () => ({ connectRemoteDB: jest.fn(), sql: require('mssql') }));
const { connectRemoteDB, sql } = require('../config/remote-db');
const { catalog, execute } = require('../services/verticalReportCatalog.service');

let request;
beforeEach(() => {
  jest.clearAllMocks();
  request = { input: jest.fn().mockReturnThis(), query: jest.fn().mockResolvedValue({ recordset: [] }) };
  connectRemoteDB.mockResolvedValue({ request: () => request });
});
const period = { fechaDesde: '2026-09-01', fechaHasta: '2026-09-30', limit: 25 };

test('all report metadata exposes a clear grain and only actual selectable and summary columns', async () => {
  expect(Object.keys(catalog)).toHaveLength(25);
  for (const [id, entity] of Object.entries(catalog)) {
    expect(entity).toMatchObject({ id, source: 'Vertical', filters: id === 'vertical_surgeries' ? ['estatusDoc'] : [] });
    expect(entity.grain.length).toBeGreaterThan(15);
    const keys = entity.fields.map(column => column.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of entity.defaultFields) expect(keys).toContain(key);
    for (const key of [entity.summary.amountField, entity.summary.quantityField, entity.summary.openKey].filter(Boolean)) {
      expect(keys).toContain(key);
    }
    await execute(id, period);
    const query = request.query.mock.calls.at(-1)[0];
    for (const key of keys) expect(query).toContain(`AS [${key}]`);
    expect(query).toMatch(/^SELECT TOP \(@rowLimit\)/);
    expect(query).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|EXEC|CREATE)\b/i);
    expect(query).not.toMatch(/SELECT\s+\*/i);
    expect(query).toContain('ORDER BY');
    if (entity.requiresDateFilter) {
      expect(query).toContain('>= CAST(@fechaDesde AS date)');
      expect(query).toContain('< DATEADD(day, 1, CAST(@fechaHasta AS date))');
    }
  }
});

test('the last calendar day is inclusive and dates and cap remain SQL parameters', async () => {
  await execute('vertical_accounts', period);
  expect(request.input).toHaveBeenCalledWith('rowLimit', sql.Int, 26);
  expect(request.input).toHaveBeenCalledWith('fechaDesde', sql.VarChar(10), '2026-09-01');
  expect(request.input).toHaveBeenCalledWith('fechaHasta', sql.VarChar(10), '2026-09-30');
  const query = request.query.mock.calls[0][0];
  expect(query).not.toContain('2026-09-01');
  expect(query).not.toContain('2026-09-30');
});

test('directories are bounded without inventing a date requirement', async () => {
  await execute('vertical_physicians', { limit: 3 });
  expect(request.input.mock.calls).toEqual([['rowLimit', sql.Int, 4]]);
  expect(request.query.mock.calls[0][0]).toContain("v.Role = 'P'");
  expect(request.query.mock.calls[0][0]).not.toContain('@fechaDesde');
});

test('one extra row detects truncation while the exact cap remains complete', async () => {
  request.query.mockResolvedValue({ recordset: [{ PCNum: 1 }, { PCNum: 2 }, { PCNum: 3 }] });
  const result = await execute('vertical_accounts', { ...period, limit: 2 });
  expect(result.truncated).toBe(true);
  expect(result.rows.map(row => row.PCNum)).toEqual([1, 2]);
  request.query.mockResolvedValue({ recordset: [{ PCNum: 1 }, { PCNum: 2 }] });
  expect((await execute('vertical_accounts', { ...period, limit: 2 })).truncated).toBe(false);
});

test('late civil timestamps keep their original hospital date with useUTC:false', async () => {
  const late = new Date(2026, 8, 30, 23, 45, 6);
  request.query.mockResolvedValue({ recordset: [{ PCNum: 1, Fecha: late, MedicalDischargeDate: null, Total: null, PC_ST: 'OP' }] });
  const result = await execute('vertical_accounts', period);
  expect(result.rows[0]).toMatchObject({ Fecha: '2026-09-30T23:45:06', MedicalDischargeDate: null, Total: null, PC_ST: 'OP' });
});

test('original negative return quantities, amounts and native statuses stay unchanged', async () => {
  request.query.mockResolvedValue({ recordset: [{ Quantity: -2, LineTotal: -135.55 }] });
  expect((await execute('vertical_clinical_return_tickets', period)).rows[0])
    .toMatchObject({ Quantity: -2, LineTotal: -135.55 });
  request.query.mockResolvedValue({ recordset: [{ SO_ST: 'PR', SOLN_ST: 'CA', LineTotal: 200 }] });
  expect((await execute('vertical_service_orders', period)).rows[0])
    .toMatchObject({ SO_ST: 'PR', SOLN_ST: 'CA', LineTotal: 200 });
});

test('search applies before the bounded result with literal wildcards and no SQL interpolation', async () => {
  const text = "x%' OR 1=1; --_[\\";
  await execute('vertical_service_catalog', { busqueda: text, limit: 1 });
  const query = request.query.mock.calls[0][0];
  expect(query).not.toContain(text);
  expect(query).toContain("LIKE @busqueda ESCAPE '\\'");
  expect(query.indexOf('LIKE @busqueda')).toBeLessThan(query.indexOf('ORDER BY'));
  expect(request.input).toHaveBeenCalledWith('busqueda', sql.NVarChar(1002), `%${text.replace(/[\\%_[]/g, '\\$&')}%`);
});

test('calendar-date searches use ISO SQL formatting consistent with serialized civil dates', async () => {
  await execute('vertical_accounts', { ...period, busqueda: '2026-09-30' });
  expect(request.query.mock.calls[0][0]).toContain("CONVERT(nvarchar(4000), v.[Date], 126) LIKE @busqueda ESCAPE '\\'");
  expect(request.input).toHaveBeenCalledWith('busqueda', sql.NVarChar(1002), '%2026-09-30%');
});

test('native boolean flags preserve true and false values for clinical eligibility and directories', async () => {
  request.query.mockResolvedValue({ recordset: [{ PRNum: 7, FullName: 'Médico', Active: true, AllowAppointments: false }] });
  expect((await execute('vertical_physicians', { limit: 2 })).rows[0]).toMatchObject({ Active: true, AllowAppointments: false });
});

test('event timestamps retain hours while daily and monthly reporting fields stay dates', () => {
  for (const [id, key] of [
    ['vertical_surgeries', 'FechaInicio'], ['vertical_surgeries', 'FechaFin'], ['vertical_account_charges', 'ChargeDate'],
    ['vertical_receivables', 'FechaIngreso'], ['vertical_room_stays', 'ClosedOn'], ['vertical_prescriptions', 'F_INICIO']
  ]) expect(catalog[id].fields.find(column => column.key === key).type).toBe('datetime');
  for (const [id, key] of [['vertical_consultation_schedule', 'Fecha'], ['vertical_physician_productivity', 'Fecha'],
    ['vertical_returns_monthly', 'FechaPeriodo']]) {
    expect(catalog[id].fields.find(column => column.key === key).type).toBe('date');
  }
  expect(catalog.vertical_prescriptions.fields.find(column => column.key === 'Hours').type).toBe('string');
});

test.each([
  { fechaDesde: '2026-02-30', fechaHasta: '2026-09-30' },
  { fechaDesde: '2026-13-01', fechaHasta: '2026-09-30' },
  { fechaDesde: '2026-10-01', fechaHasta: '2026-09-30' },
  { fechaDesde: "2026-09-01'; DROP TABLE PC;--", fechaHasta: '2026-09-30' },
  { fechaDesde: '2026-09-01' }
])('rejects invalid calendar ranges before opening the remote connection (%j)', async options => {
  await expect(execute('vertical_accounts', options)).rejects.toMatchObject({ status: 400 });
  expect(connectRemoteDB).not.toHaveBeenCalled();
});

test.each([0, -1, 10001, 1.5, 'NaN'])('rejects invalid caps (%j)', async limit => {
  await expect(execute('vertical_accounts', { ...period, limit })).rejects.toMatchObject({ status: 400 });
  expect(connectRemoteDB).not.toHaveBeenCalled();
});

test('only whitelist definitions decide SQL, even if an entity object is supplied', async () => {
  await expect(execute('PC; DROP TABLE PC;', period)).rejects.toMatchObject({ status: 400 });
  expect(connectRemoteDB).not.toHaveBeenCalled();
  await execute({ id: 'vertical_accounts', fields: [{ key: 'bad', expression: 'secret' }], from: 'secret' }, period);
  expect(request.query.mock.calls[0][0]).toContain('FROM PC v');
  expect(request.query.mock.calls[0][0]).not.toContain('secret');
});

test('monthly aggregates label their period and never claim movement-level dates', async () => {
  for (const id of ['vertical_returns_monthly', 'vertical_physician_revenue_monthly']) {
    expect(catalog[id].dateFieldLabel).toContain('primer día del mes');
    await execute(id, period);
    expect(request.query.mock.calls.at(-1)[0]).toContain('DATEFROMPARTS(v.Anio, v.Mes, 1)');
  }
});

test('reference fees expose original sources including audit exclusions without inventing actual payments', async () => {
  await execute('vertical_fee_reference', period);
  const paymentQuery = request.query.mock.calls.at(-1)[0];
  expect(paymentQuery).toContain('FROM UDR_HON_PAGO v');
  expect(paymentQuery).not.toMatch(/Subtotal_PC|Total_PC|Neto_PC|RetISR_PC/);
  expect(catalog.vertical_fee_reference.description).toContain('no acreditan un pago aplicado');
  await execute('vertical_fee_audit', period);
  const auditQuery = request.query.mock.calls.at(-1)[0];
  expect(auditQuery).toContain('FROM UDR_HON_PAGO_Audit v');
  expect(auditQuery).not.toMatch(/NOT IN|Elegible_V_HON_PAGO\s*=|Pasa_Incluido_Honorarios\s*=/);
});

test('order lines avoid multiplying quantities by appointments or repeating header totals', async () => {
  await execute('vertical_service_orders', period);
  const query = request.query.mock.calls[0][0];
  expect(query).toContain('INNER JOIN SOLN');
  expect(query).not.toContain('JOIN PCAP');
  expect(query).not.toContain('s.Total');
  expect(query).toContain('MIN(i.ItemDescription)');
  expect(query).toContain('v.[LineTotal] AS [LineTotal]');
  expect(query).toContain('s.CreatedOn >= CAST(@fechaDesde AS date)');
  expect(query).not.toContain('s.UDF_FromDate >=');
});

test('all sales orders use only unique patient headers, including orders without service lines', async () => {
  request.query.mockResolvedValue({ recordset: [
    { SONum: 10, CreatedOn: null, PatientName: 'Paciente ficticio', PTNum: 77, PCNum: 1, SO_ST: 'PR', Total: 120 },
    { SONum: 11, CreatedOn: null, PatientName: null, PTNum: null, PCNum: null, SO_ST: 'CA', Total: 0 }
  ] });
  const result = await execute('vertical_sales_orders', { ...period, busqueda: 'Paciente ficticio' });
  const query = request.query.mock.calls[0][0];
  expect(query).toContain('FROM SO v LEFT JOIN PT patient ON patient.PTNum = v.PTNum');
  expect(query).not.toMatch(/\bSOLN\b|\bV_IT\b|\bINNER JOIN\b|\bEXISTS\b/);
  expect(query).toContain("NULLIF(LTRIM(RTRIM(patient.FullName)), '') AS [PatientName]");
  expect(query).toContain('v.[Total] AS [Total]');
  expect(query).toContain('v.CreatedOn >= CAST(@fechaDesde AS date)');
  expect(query).toContain("CONVERT(nvarchar(4000), NULLIF(LTRIM(RTRIM(patient.FullName)), '')) LIKE @busqueda");
  expect(query).not.toMatch(/SO_ST\s*=/);
  expect(result.rows).toHaveLength(2);
  expect(result.rows.map(row => row.SONum)).toEqual([10, 11]);
  expect(result.rows[1]).toMatchObject({ PatientName: null, SO_ST: 'CA', Total: 0 });
  expect(catalog.vertical_sales_orders).toMatchObject({ filters: [], summary: { amountField: 'Total' } });
});

test('order patient lookup keeps one row per service line and leaves ambiguous or absent names empty', async () => {
  request.query.mockResolvedValue({ recordset: [
    { SONum: 10, SOLNNum: 101, PTNum: 77, PatientName: 'Paciente ficticio', Quantity: 2, LineTotal: 100 },
    { SONum: 10, SOLNNum: 102, PTNum: 77, PatientName: 'Paciente ficticio', Quantity: 1, LineTotal: 50 },
    { SONum: 11, SOLNNum: 103, PTNum: 78, PatientName: null, Quantity: 1, LineTotal: 30 },
    { SONum: 12, SOLNNum: 104, PTNum: null, PatientName: null, Quantity: 1, LineTotal: 40 }
  ] });

  const result = await execute('vertical_service_orders', period);
  const query = request.query.mock.calls[0][0];
  expect(query).toContain("OUTER APPLY (SELECT CASE WHEN COUNT(DISTINCT NULLIF(LTRIM(RTRIM(pt.FullName)), '')) = 1");
  expect(query).toContain("THEN MIN(NULLIF(LTRIM(RTRIM(pt.FullName)), '')) END PatientName");
  expect(query).toContain('FROM PT pt WHERE pt.PTNum = s.PTNum) patient');
  expect(query).not.toMatch(/JOIN PT\b/);
  expect(query).toContain('patient.PatientName AS [PatientName]');
  expect(result.rows).toHaveLength(4);
  expect(result.rows.map(row => row.SOLNNum)).toEqual([101, 102, 103, 104]);
  expect(result.rows.map(row => row.PatientName)).toEqual(['Paciente ficticio', 'Paciente ficticio', null, null]);
  expect(result.rows.map(row => row.LineTotal)).toEqual([100, 50, 30, 40]);
  expect(catalog.vertical_service_orders.defaultFields).toContain('PatientName');
});

test.each([['OPEN', 'OP'], ['CLOSED', 'CL'], ['CANCELED', 'CA']])('surgery account states filter at the source before TOP and use SQL parameters: %s', async (state, code) => {
  await execute('vertical_surgeries', { ...period, estatusDoc: state });
  const query = request.query.mock.calls[0][0];
  expect(query).toContain('LEFT JOIN PCFR surgeryStay ON surgeryStay.PCFRNum = v.PCFRNum');
  expect(query).toContain('LEFT JOIN PC attention ON attention.PCNum = surgeryStay.PCNum');
  expect(query).toContain('attention.PC_ST = @estadoCuenta');
  expect(request.input).toHaveBeenCalledWith('estadoCuenta', sql.NVarChar(2), code);
  expect(query).toContain('AS [EstadoCuenta]');
  expect(query).toContain('AS [AltaMedica]');
  expect(query).not.toContain('INNER JOIN PC ');
});

test('medical discharge is independent of a closed account and does not infer it from the surgery end date', async () => {
  await execute('vertical_surgeries', { ...period, estatusDoc: 'MEDICAL_DISCHARGE' });
  const query = request.query.mock.calls[0][0];
  const where = query.slice(query.indexOf('WHERE'));
  expect(where).toContain('attention.MedicalDischargeDate IS NOT NULL');
  expect(where).not.toContain('attention.PC_ST');
  expect(where).not.toContain('FechaFin IS NOT NULL');
  expect(query).toContain('attention.MedicalDischargeDate AS [FechaAltaMedica]');
  expect(query).toContain('attention.ClosedOn AS [FechaCierreCuenta]');
  expect(catalog.vertical_surgeries.defaultFields).toEqual(expect.arrayContaining(['EstadoCuenta', 'AltaMedica']));
});

test.each(['CLOSED OR 1=1', {}, null, 'MEDICAL'])('invalid clinical states fail before a remote connection: %j', async state => {
  await expect(execute('vertical_surgeries', { ...period, estatusDoc: state })).rejects.toMatchObject({ status: 400 });
  expect(connectRemoteDB).not.toHaveBeenCalled();
});

test('without medical discharge excludes accounts with missing status information', async () => {
  await execute('vertical_surgeries', { ...period, estatusDoc: 'NO_MEDICAL_DISCHARGE' });
  const where = request.query.mock.calls[0][0].split('WHERE')[1];
  expect(where).toContain('attention.MedicalDischargeDate IS NULL');
  expect(where).toContain('attention.PC_ST IS NOT NULL');
});
