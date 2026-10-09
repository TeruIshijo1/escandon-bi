'use strict';

jest.mock('../services/sap.service', () => ({ get: jest.fn(), post: jest.fn(), _request: jest.fn() }));
jest.mock('../services/sapInventory.service', () => ({ ensureInventoryData: jest.fn(), getInventoryCache: jest.fn(() => []), getBatchesCache: jest.fn(() => []) }));
jest.mock('../config/pg-db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../services/assistantAccountFinance.service', () => ({ ...jest.requireActual('../services/assistantAccountFinance.service'), execute: jest.fn() }));
jest.mock('../services/verticalReportCatalog.service', () => ({ ...jest.requireActual('../services/verticalReportCatalog.service'), execute: jest.fn() }));

let service, sap, pool, finance;
const entity = 'assistant_resource_sap__BusinessPartners';
beforeEach(() => {
  jest.resetModules();
  service = require('../services/sapQueryBuilder.service');
  sap = require('../services/sap.service');
  pool = require('../config/pg-db').pool;
  finance = require('../services/assistantAccountFinance.service');
  sap.get.mockResolvedValue({ data: { value: [] } });
});

test('analysis reads complete detail before the requested output cap and searches only the original columns', async () => {
  sap.get.mockResolvedValue({ data: { value: [
    { CardCode: 'A', CardName: 'Target', GroupCode: 2 },
    { CardCode: 'B', CardName: 'Other', GroupCode: 2 },
    { CardCode: 'C', CardName: 'Target', GroupCode: 3 }
  ] } });
  const result = await service.executeQuery({ entity, selectedFields: ['CardName'], busqueda: 'target', limit: 1,
    analysis: { groupBy: ['GroupCode'], measures: [{ op: 'countDistinct', field: 'CardCode' }], orderBy: [{ field: 'GroupCode', direction: 'asc' }] } });
  expect(result.data).toEqual([{ GroupCode: 2, metric_0: 1 }]);
  expect(result.columnas.map(column => column.key)).toEqual(['GroupCode', 'metric_0']);
  expect(result.analysisScope).toMatchObject({ complete: true, sourceRows: 2, matchingRows: 2, groups: 2 });
  expect(result.truncated).toBe(true);
  expect(new URL(sap.get.mock.calls[0][0], 'https://test.invalid').searchParams.get('$select').split(',').sort()).toEqual(['CardCode', 'CardName', 'GroupCode']);
});

test('a hidden predicate or order field is loaded internally without changing text search or output columns', async () => {
  sap.get.mockResolvedValue({ data: { value: [
    { CardCode: 'Needle', CardName: 'Other', GroupCode: 3 },
    { CardCode: 'A', CardName: 'Needle', GroupCode: 2 },
    { CardCode: 'B', CardName: 'Needle', GroupCode: 1 }
  ] } });
  const result = await service.executeQuery({ entity, selectedFields: ['CardName'], busqueda: 'needle', limit: 1,
    analysis: { predicates: [{ field: 'GroupCode', op: 'gte', value: 1 }], orderBy: [{ field: 'GroupCode', direction: 'asc' }] } });
  expect(result.data).toEqual([{ CardName: 'Needle' }]);
  expect(result.analysisScope).toMatchObject({ complete: true, sourceRows: 2, matchingRows: 2 });
  expect(result.columnas.map(column => column.key)).toEqual(['CardName']);
});

test('incomplete source scans reject the entire analysis instead of calculating a partial total', async () => {
  sap.get.mockResolvedValue({ data: { value: Array.from({ length: 10001 }, (_, index) => ({ CardCode: String(index), CardName: 'Ficticio' })) } });
  await expect(service.executeQuery({ entity, selectedFields: ['CardName'], limit: 1,
    analysis: { measures: [{ op: 'count' }] } })).rejects.toMatchObject({ status: 400 });
});

test('invalid analysis fails before querying and catalog capabilities do not authorize untrusted sums', async () => {
  await expect(service.executeQuery({ entity, analysis: { predicates: [{ field: 'Unapproved', op: 'eq', value: 1 }] } })).rejects.toMatchObject({ status: 400 });
  expect(sap.get).not.toHaveBeenCalled();
  expect(service.getEntityDefinition(entity).analysisCapabilities.fields.find(field => field.key === 'CardName').sumAllowed).toBe(false);
});

test('saved filters contain the canonical analysis rather than an unvalidated query expression', async () => {
  pool.query.mockResolvedValue({ rows: [{ queryid: 7 }] });
  const result = await service.saveQuery({ id: 1, username: 'FICTICIO' }, { title: 'Reporte', entity, selectedFields: ['CardName'],
    filters: { analysis: { predicates: [{ field: 'GroupCode', op: 'gt', value: 2 }] } } });
  expect(result.id).toBe(7);
  expect(JSON.parse(pool.query.mock.calls[0][1][6]).analysis).toEqual({ predicates: [{ field: 'GroupCode', op: 'gt', value: '2' }], groupBy: [], measures: [], orderBy: [] });
});

test.each(['PCNum', 'PTNum'])('a validated exact %s condition safely scopes the financial source without requiring dates', async field => {
  finance.execute.mockResolvedValue({ rows: [{ PCNum: 7, PTNum: 42, PatientName: 'Ficticio' }], truncated: false });
  const value = field === 'PCNum' ? 7 : 42;
  const result = await service.executeQuery({ entity: 'assistant_account_billing_collections', selectedFields: ['PatientName'],
    analysis: { predicates: [{ field, op: 'eq', value }] }, pointLookup: { field: 'PCNum', value: 999 } });
  expect(finance.execute.mock.calls[0][1]).toMatchObject({ pointLookup: { field, value }, limit: 10000, searchFields: ['PatientName'] });
  expect(finance.execute.mock.calls[0][1]).not.toHaveProperty('analysis');
  expect(result.data).toEqual([{ PatientName: 'Ficticio' }]);
});

test('a raw caller scope or non-equality condition cannot bypass the financial date requirement', async () => {
  for (const options of [{ pointLookup: { field: 'PCNum', value: 7 } }, { analysis: { predicates: [{ field: 'PCNum', op: 'gt', value: 7 }] } }]) {
    await expect(service.executeQuery({ entity: 'assistant_account_billing_collections', ...options })).rejects.toThrow(/rango de fechas/);
  }
  expect(finance.execute).not.toHaveBeenCalled();
});

test('a single exact-account report can return billing, current balance and several real charge fields together', async () => {
  finance.execute.mockResolvedValue({ rows: [{ PCNum: 7, PatientName: 'Ficticio', AccountBalance: 50, BillingStatus: 'Con factura' }], truncated: false });
  const vertical = require('../services/verticalReportCatalog.service');
  vertical.execute.mockResolvedValue({ rows: [{ PCNum: 7, PCITNum: 11, ItemCode: 'A', ItemDescription: 'Insumo FICTICIO', Quantity: 2, UnitPrice: 3 }], truncated: false });
  const selectedFields = ['PatientName', 'AccountBalance', 'BillingStatus', 'ItemDescription', 'Quantity', 'UnitPrice'];
  const result = await service.executeQuery({ entity: 'assistant_account_case', selectedFields,
    analysis: { predicates: [{ field: 'PCNum', op: 'eq', value: 7 }] } });
  expect(result.columnas.map(column => column.key)).toEqual(selectedFields);
  expect(result.data).toEqual([{ PatientName: 'Ficticio', AccountBalance: 50, BillingStatus: 'Con factura', ItemDescription: 'Insumo FICTICIO', Quantity: 2, UnitPrice: 3 }]);
  expect(result.analysisScope.complete).toBe(true);
  expect(vertical.execute.mock.calls[0][1]).toMatchObject({ pointLookup: { field: 'PCNum', value: 7 }, limit: 10000 });
  await expect(service.executeQuery({ entity: 'assistant_account_case' })).rejects.toThrow(/folio exacto/);
});

test('manual Vertical adapters receive only the exact identity derived by the analysis engine', async () => {
  const vertical = require('../services/verticalReportCatalog.service');
  vertical.execute.mockResolvedValue({ rows: [{ PCNum: 7, Total: 100 }], truncated: false });
  const result = await service.executeQuery({ entity: 'vertical_accounts', selectedFields: ['PCNum', 'Total'],
    analysis: { predicates: [{ field: 'PCNum', op: 'eq', value: 7 }] } });
  expect(vertical.execute.mock.calls[0][1]).toMatchObject({ pointLookup: { field: 'PCNum', value: 7 }, limit: 10000 });
  expect(result.data).toEqual([{ PCNum: 7, Total: 100 }]);
});

test.each([{ complete: false }, { analysisScope: { complete: false } }])('manual adapter incomplete metadata cannot be erased before filtering or summing: %j', async incomplete => {
  const vertical = require('../services/verticalReportCatalog.service');
  vertical.execute.mockResolvedValue({ rows: [{ PCNum: 7, Total: 100 }], truncated: false, ...incomplete });
  const period = { fechaDesde: '2026-09-01', fechaHasta: '2026-09-30' };
  for (const analysis of [{ measures: [{ op: 'sum', field: 'Total' }] }, { predicates: [{ field: 'Total', op: 'gt', value: 0 }] }]) {
    await expect(service.executeQuery({ entity: 'vertical_accounts', ...period, selectedFields: ['PCNum'], analysis })).rejects.toMatchObject({ status: 400 });
  }
});

test.each([{ complete: false }, { analysisScope: { complete: false } }])('an incomplete direct hidden financial adapter cannot produce an analysis: %j', async incomplete => {
  finance.execute.mockResolvedValue({ rows: [{ PCNum: 7, PatientName: 'FICTICIO' }], truncated: false, ...incomplete });
  await expect(service.executeQuery({ entity: 'assistant_account_billing_collections', selectedFields: ['PatientName'],
    analysis: { predicates: [{ field: 'PCNum', op: 'eq', value: 7 }], measures: [{ op: 'count' }] } })).rejects.toMatchObject({ status: 400 });
});

test.each([{ fechaDesde: '2026-09-01' }, { fechaHasta: '2026-09-30' }, { fechaDesde: '2026-10-01', fechaHasta: '2026-09-01' },
  { fechaDesde: '2024-01-01', fechaHasta: '2026-09-01' }])('an exact lookup preserves date validation before any source request or cache reuse: %j', async period => {
  await expect(service.executeQuery({ entity: 'assistant_account_billing_collections', ...period,
    analysis: { predicates: [{ field: 'PCNum', op: 'eq', value: 7 }] } })).rejects.toThrow(/fechas|Fecha|rango/);
  expect(finance.execute).not.toHaveBeenCalled();
});
