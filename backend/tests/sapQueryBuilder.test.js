'use strict';

jest.mock('../services/sap.service', () => ({ get: jest.fn(), post: jest.fn(), _request: jest.fn() }));
jest.mock('../services/sapInventory.service', () => ({ ensureInventoryData: jest.fn(), getInventoryCache: jest.fn(() => []), getBatchesCache: jest.fn(() => []) }));
jest.mock('../config/pg-db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../services/sapReportCatalog.service', () => ({ ...jest.requireActual('../services/sapReportCatalog.service'), execute: jest.fn() }));
jest.mock('../services/verticalReportCatalog.service', () => ({ ...jest.requireActual('../services/verticalReportCatalog.service'), execute: jest.fn() }));

let service, sapReports, verticalReports, sap, pool;
const period = { fechaDesde: '2026-09-01', fechaHasta: '2026-09-30' };
beforeEach(() => {
  jest.resetModules();
  service = require('../services/sapQueryBuilder.service');
  sapReports = require('../services/sapReportCatalog.service');
  verticalReports = require('../services/verticalReportCatalog.service');
  sap = require('../services/sap.service');
  pool = require('../config/pg-db').pool;
});

test('every SAP/Vertical module has assignable permissions, valid columns and defaults', () => {
  const permissions = require('../../frontend/src/utils/reportQueryPermissions.json');
  const catalog = service.getEntityCatalog();
  expect(catalog.length).toBeGreaterThan(40);
  expect(new Set(catalog.map(entity => entity.id)).size).toBe(catalog.length);
  const sourcePermissions = ['assistant_commercial_agreements', 'assistant_vertical_resources', 'assistant_sap_resources'];
  expect(permissions.filter(permission => !sourcePermissions.includes(permission.entity)).map(permission => permission.entity).sort()).toEqual(catalog.map(entity => entity.id).sort());
  expect(permissions.map(permission => permission.entity)).toEqual(expect.arrayContaining(sourcePermissions));
  for (const entity of catalog) {
    expect(['SAP', 'Vertical']).toContain(entity.source);
    expect(entity.grain).toBeTruthy();
    expect(entity.fields.length).toBeGreaterThan(0);
    expect(new Set(entity.fields.map(field => field.key)).size).toBe(entity.fields.length);
    expect(entity.defaultFields.every(key => entity.fields.some(field => field.key === key))).toBe(true);
    for (const key of [entity.summary?.amountField, entity.summary?.quantityField].filter(Boolean)) {
      expect(entity.fields.some(field => field.key === key)).toBe(true);
    }
  }
});

test('internal capabilities remain hidden from manual themes and can be saved by their stable identity', async () => {
  const capabilities = service.getAssistantCatalog().filter(entity => entity.assistantOnly);
  expect(capabilities.length).toBeGreaterThan(1);
  expect(service.getEntityCatalog().some(entity => entity.assistantOnly)).toBe(false);
  const entity = service.getEntityDefinition('assistant_patient_accounts');
  expect(entity.requiredPermissions).toEqual(['vertical_accounts', 'assistant_commercial_agreements']);
  pool.query.mockResolvedValue({ rows: [{ queryid: 9 }] });
  await service.saveQuery({ username: 'staff' }, { title: 'Cuenta con convenio', entity: entity.id, selectedFields: ['PatientName', 'AccountBalance'], filters: period });
  const parameters = pool.query.mock.calls[0][1];
  expect(parameters[4]).toBe(entity.id);
  expect(JSON.parse(parameters[5])).toEqual(['PatientName', 'AccountBalance']);
});

test.each(['2026-02-30', '2026-9-01', "2026-09-01' or 1=1", '2026-13-01'])('rejects invalid dates before querying: %s', async fechaDesde => {
  await expect(service.executeQuery({ entity: 'sales_orders', ...period, fechaDesde })).rejects.toThrow(/fechas/);
  expect(sapReports.execute).not.toHaveBeenCalled();
});
test('required, reversed and excessive periods are rejected before source access', async () => {
  for (const dates of [{}, { fechaDesde: '2026-10-01', fechaHasta: '2026-09-01' }, { fechaDesde: '2024-01-01', fechaHasta: '2026-09-01' }]) {
    await expect(service.executeQuery({ entity: 'vertical_accounts', ...dates })).rejects.toThrow();
  }
  expect(verticalReports.execute).not.toHaveBeenCalled();
});

test('delivers bounded report data with columns only, and preserves truncation in cached results', async () => {
  verticalReports.execute.mockResolvedValue({ rows: [{ PCNum: 1, Total: 120.25, SecretJoinField: 'private' }], truncated: true });
  const options = { entity: 'vertical_accounts', ...period, selectedFields: ['PCNum', 'Total'], limit: 2 };
  const result = await service.executeQuery(options);
  expect(result).toMatchObject({ entity: 'vertical_accounts', source: 'Vertical', limit: 2, truncated: true, totalRegistros: 1 });
  expect(result.data[0].SecretJoinField).toBeUndefined();
  expect(result.columnas.map(column => column.key)).toEqual(['PCNum', 'Total']);
  expect(result.kpis.find(kpi => kpi.label === 'Total de cuentas ($)').value).toBe('120.25');
  const cached = await service.executeQuery(options);
  expect(cached).toEqual(result);
  expect(verticalReports.execute).toHaveBeenCalledTimes(1);
});

test('source-filtered searches are not discarded by a second different text conversion', async () => {
  verticalReports.execute.mockResolvedValue({ rows: [{ PCNum: 1, Total: 1000 }], truncated: false });
  const result = await service.executeQuery({ entity: 'vertical_accounts', ...period, busqueda: '1000.00' });
  expect(result.totalRegistros).toBe(1);
  expect(verticalReports.execute.mock.calls[0][1].busqueda).toBe('1000.00');
});

test('requested column order is preserved when a cached report uses the same columns in another order', async () => {
  verticalReports.execute.mockResolvedValue({ rows: [{ PCNum: 1, Total: 120.25 }], truncated: false });
  const query = { entity: 'vertical_accounts', ...period };
  const first = await service.executeQuery({ ...query, selectedFields: ['PCNum', 'Total'] });
  const reordered = await service.executeQuery({ ...query, selectedFields: ['Total', 'PCNum'] });
  expect(first.columnas.map(column => column.key)).toEqual(['PCNum', 'Total']);
  expect(reordered.columnas.map(column => column.key)).toEqual(['Total', 'PCNum']);
  expect(await service.executeQuery({ ...query, selectedFields: ['Total', 'PCNum'] })).toEqual(reordered);
  expect(verticalReports.execute).toHaveBeenCalledTimes(2);
});

test('changing supplier filters does not reuse another report cache entry', async () => {
  sapReports.execute.mockResolvedValueOnce({ rows: [{ CardName: 'Uno' }], truncated: false })
    .mockResolvedValueOnce({ rows: [{ CardName: 'Dos' }], truncated: false });
  const one = await service.executeQuery({ entity: 'suppliers', proveedor: 'Uno' });
  const two = await service.executeQuery({ entity: 'suppliers', proveedor: 'Dos' });
  expect(one.data[0].CardName).toBe('Uno');
  expect(two.data[0].CardName).toBe('Dos');
  expect(sapReports.execute).toHaveBeenCalledTimes(2);
});

test('clinical statuses reach Vertical and have separate cache entries even without a selected status column', async () => {
  verticalReports.execute.mockResolvedValue({ rows: [{ Paciente: 'Paciente ficticio', EstadoCuenta: 'Cerrada', AltaMedica: 'Sí' }], truncated: false });
  const query = { entity: 'vertical_surgeries', ...period, selectedFields: ['Paciente'] };
  for (const estatusDoc of ['CLOSED', 'MEDICAL_DISCHARGE', 'NO_MEDICAL_DISCHARGE']) {
    const result = await service.executeQuery({ ...query, estatusDoc });
    expect(verticalReports.execute.mock.calls.at(-1)[1].estatusDoc).toBe(estatusDoc);
    expect(result.data).toMatchObject([{ Paciente: 'Paciente ficticio', EstadoCuenta: 'Cerrada', AltaMedica: 'Sí' }]);
    expect(result.columnas.map(column => column.key)).toEqual(['Paciente']);
  }
  expect(verticalReports.execute).toHaveBeenCalledTimes(3);
  await service.executeQuery({ ...query, estatusDoc: 'CLOSED' });
  expect(verticalReports.execute).toHaveBeenCalledTimes(3);
});

test.each(['MEDICAL_DISCHARGE', 'CANCELED', 'NO_MEDICAL_DISCHARGE'])('clinical states cannot be applied to SAP invoices: %s', async estatusDoc => {
  await expect(service.executeQuery({ entity: 'sales_orders', ...period, estatusDoc })).rejects.toThrow(/estado/);
  expect(sapReports.execute).not.toHaveBeenCalled();
});

test('clamps limits, computes KPIs over delivered rows, and counts each open document once', async () => {
  sapReports.execute.mockResolvedValue({ rows: [
    { DocEntry: 1, DocStatus: 'Abierta', Quantity: 0.5, LineTotal: 10 },
    { DocEntry: 1, DocStatus: 'Abierta', Quantity: 0.25, LineTotal: 5 },
    { DocEntry: 2, DocStatus: 'Abierta', Quantity: 2, LineTotal: 100 }
  ], truncated: false });
  const result = await service.executeQuery({ entity: 'sales_orders', ...period, limit: 2 });
  expect(result.totalRegistros).toBe(2);
  expect(result.truncated).toBe(true);
  expect(result.kpis.find(kpi => kpi.label === 'Subtotal en moneda local ($)').value).toBe('15.00');
  expect(result.kpis.find(kpi => kpi.label === 'Piezas / Cantidad Total').value).toBe('0.75');
  expect(result.kpis.find(kpi => kpi.label === 'Documentos Abiertos').value).toBe('1');
  await service.executeQuery({ entity: 'sales_orders', ...period, limit: 999999 });
  expect(sapReports.execute.mock.calls[1][1].limit).toBe(10000);
});

test('negative return quantities and amounts retain their sign', async () => {
  verticalReports.execute.mockResolvedValue({ rows: [{ LineTotal: -35.5, Quantity: -0.5 }], truncated: false });
  const result = await service.executeQuery({ entity: 'vertical_clinical_return_tickets', ...period });
  expect(result.kpis.some(kpi => kpi.value === '-35.50')).toBe(true);
  expect(result.kpis.some(kpi => kpi.value === '-0.5')).toBe(true);
});

test('does not advertise a partial monetary total when an amount needs currency review', async () => {
  sapReports.execute.mockResolvedValue({ rows: [{ PaymentTotal: 100 }, { PaymentTotal: null }], truncated: false });
  const result = await service.executeQuery({ entity: 'incoming_payments', ...period });
  expect(result.kpis).toHaveLength(1);
});

test('prototype names cannot select a module', async () => {
  for (const entity of ['__proto__', 'constructor', 'toString']) {
    expect(service.getEntityDefinition(entity)).toBeUndefined();
    await expect(service.executeQuery({ entity, ...period })).rejects.toThrow(/no reconocida/);
  }
  expect(sapReports.execute).not.toHaveBeenCalled();
});

test('legacy line summaries use line amounts and explicitly report a SAP pagination cap', async () => {
  sap.post.mockResolvedValue({});
  sap.get.mockResolvedValue({ data: { value: [{ DocNum: 1, LineTotal: 12.5, DocTotal: 200, Quantity: 0.5 }], 'odata.nextLink': 'next' } });
  const result = await service.executeQuery({ entity: 'purchase_invoices', ...period });
  expect(result.truncated).toBe(true);
  expect(result.kpis.find(kpi => kpi.label === 'Importe Total ($)').value).toBe('12.50');
});

test('saving an old template prunes retired columns and rejects invalid modules', async () => {
  pool.query.mockResolvedValue({ rows: [{ queryid: 1 }] });
  await service.saveQuery({ id: 1, username: 'tester' }, { title: 'Catálogo', entity: 'item_prices', selectedFields: ['OldField'], filters: {} });
  expect(JSON.parse(pool.query.mock.calls[0][1][5])).toEqual(service.getEntityDefinition('item_prices').defaultFields);
  await expect(service.saveQuery({ username: 'tester' }, { title: 'Invalido', entity: 'not_real', selectedFields: [] })).rejects.toThrow();
});
