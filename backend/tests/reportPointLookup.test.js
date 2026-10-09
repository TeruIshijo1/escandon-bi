'use strict';
jest.mock('../config/remote-db', () => ({ connectRemoteDB: jest.fn(), sql: require('mssql') }));
const { connectRemoteDB, sql } = require('../config/remote-db');
const vertical = require('../services/verticalReportCatalog.service');
const agreements = require('../services/assistantVerticalSources.service');
let request;
beforeEach(() => {
  jest.clearAllMocks();
  request = { input: jest.fn().mockReturnThis(), query: jest.fn().mockResolvedValue({ recordset: [] }) };
  connectRemoteDB.mockResolvedValue({ request: () => request });
});
test.each([
  [vertical, 'vertical_accounts', 'PCNum', 'v.[PCNum]'],
  [vertical, 'vertical_accounts', 'PTNum', 'v.[PTNum]'],
  [vertical, 'vertical_account_charges', 'PCNum', 'v.[PCNum]'],
  [vertical, 'vertical_service_orders', 'PCNum', 's.PCNum'],
  [vertical, 'vertical_sales_orders', 'PTNum', 'v.[PTNum]'],
  [vertical, 'vertical_receivables', 'PCNum', 'v.[PCNum]'],
  [agreements, 'assistant_patient_accounts', 'PCNum', 'pc.PCNum']
])('a verified identity narrows %s/%s/%s in SQL without guessing dates', async (service, entity, field, expression) => {
  request.query.mockResolvedValue({ recordset: [{ [field]: 123 }] });
  const result = await service.execute(entity, { pointLookup: { field, value: 123 } });
  expect(request.input).toHaveBeenCalledWith('pointIdentity', sql.Int, 123);
  expect(request.query.mock.calls[0][0]).toContain(`${expression} = @pointIdentity`);
  expect(request.input).not.toHaveBeenCalledWith('fechaDesde', expect.anything(), expect.anything());
  expect(result.truncated).toBe(false); expect(result.rows[0][field]).toBe(123);
});
test('explicit period remains an additional boundary on an identified account', async () => {
  await vertical.execute('vertical_accounts', { pointLookup: { field: 'PCNum', value: 123 }, fechaDesde: '2026-09-01', fechaHasta: '2026-09-30' });
  expect(request.query.mock.calls[0][0]).toContain('v.[Date] >= CAST(@fechaDesde AS date)');
  expect(request.query.mock.calls[0][0]).toContain('v.[PCNum] = @pointIdentity');
});
test.each([vertical, agreements])('foreign identity is refused rather than displayed: %s', async service => {
  request.query.mockResolvedValue({ recordset: [{ PCNum: 999 }] });
  await expect(service.execute(service === vertical ? 'vertical_accounts' : 'assistant_patient_accounts', { pointLookup: { field: 'PCNum', value: 123 } })).rejects.toThrow(/identidad/);
});
test.each([
  { pointLookup: { field: 'PCNum', value: '123' } },
  { pointLookup: { field: 'PCNum', value: 123.2 } },
  { pointLookup: { field: 'PCNum', value: 0 } },
  { pointLookup: { field: 'PCNum', value: 2147483648 } },
  { pointLookup: { field: 'Unknown OR 1=1', value: 123 } },
  { pointLookup: { field: 'PCNum', value: 123 }, fechaDesde: '2026-09-01' },
  { pointLookup: { field: 'PCNum', value: 123 }, fechaDesde: '2024-01-01', fechaHasta: '2026-09-30' }
])('invalid identity or partially supplied period cannot bypass date validation: %j', async options => {
  await expect(vertical.execute('vertical_accounts', options)).rejects.toThrow();
  expect(connectRemoteDB).not.toHaveBeenCalled();
});
test('a source without exact-identity metadata cannot broaden into an unlimited query', async () => {
  await expect(vertical.execute('vertical_surgeries', { pointLookup: { field: 'PCNum', value: 123 } })).rejects.toThrow();
  expect(connectRemoteDB).not.toHaveBeenCalled();
});
