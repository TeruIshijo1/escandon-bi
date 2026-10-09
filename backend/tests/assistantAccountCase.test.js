'use strict';

jest.mock('../services/sap.service', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('../services/assistantAccountFinance.service', () => ({ ...jest.requireActual('../services/assistantAccountFinance.service'), execute: jest.fn() }));
jest.mock('../services/verticalReportCatalog.service', () => ({ ...jest.requireActual('../services/verticalReportCatalog.service'), execute: jest.fn() }));
const finance = require('../services/assistantAccountFinance.service');
const vertical = require('../services/verticalReportCatalog.service');
const { catalog, execute } = require('../services/assistantAccountCase.service');
const { checkSapModuleAccess } = require('../utils/reportAccess');
const engine = require('../services/reportAnalysis.service');
const id = 'assistant_account_case';
const options = { pointLookup: { field: 'PCNum', value: 7 }, limit: 10000 };
beforeEach(() => {
  jest.clearAllMocks();
  finance.execute.mockResolvedValue({ rows: [{ PCNum: 7, PTNum: 42, PatientName: 'Paciente FICTICIO', AccountBalance: 200,
    BillingStatus: 'Con factura', InvoiceFolios: '123', CollectionStatus: 'Cobro parcial', InvoiceBalance: null }], truncated: false });
  vertical.execute.mockResolvedValue({ rows: [{ PCNum: 7, PCITNum: 10, ItemCode: 'A', ItemDescription: 'Artículo FICTICIO', Quantity: 2, UnitPrice: 4.5 },
    { PCNum: 7, PCITNum: 11, ItemCode: 'B', ItemDescription: null, Quantity: -1, UnitPrice: null }], truncated: false });
});

test('account case exposes finance and real charge fields with separate row semantics and no additive header', async () => {
  const result = await execute(id, options);
  expect(result.rows).toHaveLength(2);
  expect(result.rows[0]).toMatchObject({ PCNum: 7, PatientName: 'Paciente FICTICIO', AccountBalance: 200, InvoiceFolios: '123',
    ChargeNum: 10, ItemCode: 'A', ItemDescription: 'Artículo FICTICIO', Quantity: 2, UnitPrice: 4.5 });
  expect(result.rows[1]).toMatchObject({ ChargeNum: 11, AccountBalance: 200, ItemDescription: null, Quantity: -1, UnitPrice: null, InvoiceBalance: null });
  expect(finance.execute.mock.invocationCallOrder[0]).toBeLessThan(vertical.execute.mock.invocationCallOrder[0]);
  expect(vertical.execute).toHaveBeenCalledWith('vertical_account_charges', expect.objectContaining({ pointLookup: options.pointLookup, limit: 10000, busqueda: '' }));
  expect(catalog[id].nonAdditiveFields).toContain('AccountBalance');
  expect(engine.getAnalysisCapabilities(catalog[id]).fields.every(field => !field.sumAllowed)).toBe(true);
});

test('a period remains fixed in both sources and text search follows the complete combination using original fields', async () => {
  const result = await execute(id, { ...options, fechaDesde: '2026-09-01', fechaHasta: '2026-09-30', busqueda: 'artículo', searchFields: ['ItemDescription'] });
  expect(result.rows.map(row => row.ChargeNum)).toEqual([10]);
  for (const source of [finance, vertical]) expect(source.execute.mock.calls[0][1]).toMatchObject({ fechaDesde: '2026-09-01', fechaHasta: '2026-09-30', busqueda: '' });
  expect((await execute(id, { ...options, busqueda: 'artículo', searchFields: ['PatientName'] })).rows).toEqual([]);
});

test('a found account without charges preserves one row with unknown charge fields and no invented amount', async () => {
  vertical.execute.mockResolvedValue({ rows: [], truncated: false });
  const result = await execute(id, options);
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({ PCNum: 7, AccountBalance: 200, ChargeNum: null, ItemDescription: null, Quantity: null, UnitPrice: null });
  expect(result.rows[0]).not.toHaveProperty('ChargeTotal');
});

test('an absent account returns no rows and never reads its charges', async () => {
  finance.execute.mockResolvedValue({ rows: [], truncated: false });
  expect(await execute(id, options)).toEqual({ rows: [], truncated: false });
  expect(vertical.execute).not.toHaveBeenCalled();
});

test.each([{ field: 'PTNum', value: 42 }, { field: 'PCNum', value: 0 }, { field: 'PCNum', value: true }, undefined])('only a validated exact account folio permits reading any source', async pointLookup => {
  await expect(execute(id, { pointLookup })).rejects.toMatchObject({ status: 400 });
  expect(finance.execute).not.toHaveBeenCalled();
  expect(vertical.execute).not.toHaveBeenCalled();
});

test('incomplete or ambiguous financial source stops before reading charges', async () => {
  for (const result of [{ rows: [{ PCNum: 7 }], truncated: true }, { rows: [{ PCNum: 7 }], truncated: false, analysisScope: { complete: false } },
    { rows: [{ PCNum: 8 }], truncated: false }, { rows: [{ PCNum: 7 }, { PCNum: 7 }], truncated: false }]) {
    finance.execute.mockResolvedValue(result);
    await expect(execute(id, options)).rejects.toMatchObject({ status: 400 });
  }
  expect(vertical.execute).not.toHaveBeenCalled();
});

test('incomplete, foreign, duplicate or unidentified charge rows never produce a partial combined result', async () => {
  for (const result of [{ rows: [{ PCNum: 7, PCITNum: 10 }], truncated: true }, { rows: [{ PCNum: 8, PCITNum: 10 }], truncated: false },
    { rows: [{ PCNum: 7, PCITNum: 10 }], truncated: false, analysisScope: { complete: false } },
    { rows: [{ PCNum: 7, PCITNum: 10 }, { PCNum: 7, PCITNum: 10 }], truncated: false }, { rows: [{ PCNum: 7, PCITNum: null }], truncated: false }]) {
    vertical.execute.mockResolvedValue(result);
    await expect(execute(id, options)).rejects.toMatchObject({ status: 400 });
  }
});

test('output limits follow complete source verification and require every financial and charge permission', async () => {
  const result = await execute(id, { ...options, limit: 1 });
  expect(result).toMatchObject({ truncated: true });
  expect(result.rows).toHaveLength(1);
  expect(finance.execute.mock.calls[0][1].limit).toBe(10000);
  const permisos = catalog[id].requiredPermissions.map(key => `sap-query-${key}`);
  expect(checkSapModuleAccess({ username: 'FICTICIO', permisos }, id, catalog[id])).toBe(true);
  for (const denied of permisos) expect(checkSapModuleAccess({ username: 'FICTICIO', permisos: permisos.filter(permission => permission !== denied) }, id, catalog[id])).toBe(false);
  expect(checkSapModuleAccess({ username: 'FICTICIO', permisos: [`sap-query-${id}`] }, id, catalog[id])).toBe(false);
});
