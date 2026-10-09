'use strict';
jest.mock('../services/sap.service', () => ({ get: jest.fn() }));
jest.mock('../services/assistantVerticalSources.service', () => ({ catalog: {
  assistant_patient_accounts: { id: 'assistant_patient_accounts', title: 'Estados de cuenta y convenios', source: 'Vertical',
    assistantOnly: true, requiredPermissions: ['vertical_accounts', 'assistant_commercial_agreements'],
    fields: [{ key: 'PCNum', label: 'Folio de atención', type: 'number' }, { key: 'BPCode', label: 'Código de pagador' },
      { key: 'AccountBalance', label: 'Saldo de cuenta', type: 'money' }], defaultFields: ['PCNum', 'AccountBalance'],
    filters: [], requiresDateFilter: true, grain: 'Una fila por convenio de cuenta.' }
}, execute: jest.fn() }));
const sources = require('../services/assistantVerticalSources.service');
const sap = require('../services/sapReportCatalog.service');
const composition = require('../services/assistantReportComposition.service');
const { checkSapModuleAccess } = require('../utils/reportAccess');
const catalog = composition.createCatalog({});
const entity = 'assistant_join__assistant_patient_accounts__customers';
const options = { fechaDesde: '2026-09-01', fechaHasta: '2026-09-30', limit: 100,
  selectedFields: ['PCNum', 'AccountBalance', 'sap_customers_CardName', 'sap_customers_CurrentAccountBalance'] };
beforeEach(() => { jest.clearAllMocks(); sources.execute.mockResolvedValue({ rows: [
  { PCNum: 1, BPCode: 'A', AccountBalance: 10 }, { PCNum: 1, BPCode: 'A', AccountBalance: 10 },
  { PCNum: 2, BPCode: 'B', AccountBalance: -5 }, { PCNum: 3, BPCode: null, AccountBalance: null }
], truncated: false }); });
afterEach(() => jest.restoreAllMocks());

test('hidden combinations require every origin permission, even with a direct combination grant', () => {
  expect(catalog[entity]).toMatchObject({ assistantOnly: true, source: 'SAP + Vertical' });
  for (const permisos of [['sap-query-vertical_accounts', 'sap-query-customers'], [`sap-query-${entity}`]]) {
    expect(checkSapModuleAccess({ username: 'staff', permisos }, entity, catalog[entity])).toBe(false);
  }
  expect(checkSapModuleAccess({ username: 'staff', permisos: ['sap-query-vertical_accounts', 'sap-query-assistant_commercial_agreements', 'sap-query-customers'] }, entity, catalog[entity])).toBe(true);
});

test('joins only exact payer codes, preserves missing and repeated agreements without summing balances', async () => {
  jest.spyOn(sap, 'lookup').mockResolvedValue({ rows: [{ CardCode: 'A', CardName: 'Pagador ficticio', CurrentAccountBalance: 900 }], truncated: false });
  const result = await composition.execute(entity, options, catalog);
  expect(sap.lookup).toHaveBeenCalledWith('customers', 'CardCode', ['A', 'B']);
  expect(result.data).toHaveLength(4);
  expect(result.data[0]).toMatchObject({ AccountBalance: 10, sap_customers_CurrentAccountBalance: 900 });
  expect(result.data[2]).toMatchObject({ AccountBalance: -5, sap_customers_CardName: null, SAPLinkStatus: 'Sin vínculo en SAP' });
  expect(result.kpis).toHaveLength(1);
});

test('searches joined columns and reports incomplete underlying scans', async () => {
  sources.execute.mockResolvedValue({ rows: [{ PCNum: 1, BPCode: 'A', AccountBalance: 10 }], truncated: true });
  jest.spyOn(sap, 'lookup').mockResolvedValue({ rows: [{ CardCode: 'A', FederalTaxID: 'RFC-PRUEBA' }], truncated: false });
  const result = await composition.execute(entity, { ...options, busqueda: 'rfc-prueba' }, catalog);
  expect(result.data).toHaveLength(1);
  expect(result.truncated).toBe(true);
  expect(sources.execute).toHaveBeenCalledWith('assistant_patient_accounts', expect.objectContaining({ busqueda: '', limit: 10000 }));
});

test('internally loaded SAP relation fields cannot widen an explicitly scoped original search', async () => {
  sources.execute.mockResolvedValue({ rows: [{ PCNum: 1, BPCode: 'A', AccountBalance: 10 }], truncated: false });
  jest.spyOn(sap, 'lookup').mockResolvedValue({ rows: [{ CardCode: 'A', CardName: 'Only internal match' }], truncated: false });
  const result = await composition.execute(entity, { ...options, searchFields: ['PCNum'], busqueda: 'internal' }, catalog);
  expect(result.data).toEqual([]);
  expect(sources.execute).toHaveBeenCalledWith('assistant_patient_accounts', expect.objectContaining({ searchFields: ['PCNum'], busqueda: '' }));
  await expect(composition.execute(entity, { ...options, analysis: { measures: [{ op: 'count' }] } }, catalog)).rejects.toThrow(/configuración/);
});

test.each([{ complete: false }, { analysisScope: { complete: false } }])('incomplete base metadata survives combination and blocks any subsequent analysis: %j', async incomplete => {
  sources.execute.mockResolvedValue({ rows: [{ PCNum: 1, BPCode: 'A', AccountBalance: 10 }], truncated: false, ...incomplete });
  jest.spyOn(sap, 'lookup').mockResolvedValue({ rows: [{ CardCode: 'A', CardName: 'Pagador ficticio' }], truncated: false });
  const result = await composition.execute(entity, options, catalog);
  expect(result.truncated).toBe(true);
  const engine = require('../services/reportAnalysis.service');
  expect(() => engine.applyAnalysis(catalog[entity], result, { measures: [{ op: 'count' }] })).toThrow(/consulta completa/);
});

test.each([{ complete: false }, { analysisScope: { complete: false } }])('incomplete metadata on an uncombined hidden source survives projection: %j', async incomplete => {
  sources.execute.mockResolvedValue({ rows: [{ PCNum: 1, AccountBalance: 10 }], truncated: false, ...incomplete });
  const definition = catalog.assistant_patient_accounts;
  const result = await composition.execute(definition.id, { ...options, selectedFields: ['PCNum'] }, catalog);
  expect(result.truncated).toBe(true);
  expect(() => require('../services/reportAnalysis.service').applyAnalysis(definition, result, { predicates: [{ field: 'PCNum', op: 'eq', value: 1 }] })).toThrow(/consulta completa/);
});

test.each([{ complete: false }, { analysisScope: { complete: false } }])('incomplete enrichment metadata cannot be treated as missing SAP links: %j', async incomplete => {
  jest.spyOn(sap, 'lookup').mockResolvedValue({ rows: [], truncated: false, ...incomplete });
  await expect(composition.execute(entity, options, catalog)).rejects.toThrow(/completar la relación/);
});

test('refuses ambiguous or incomplete lookups and invented columns before querying', async () => {
  const lookup = jest.spyOn(sap, 'lookup').mockResolvedValue({ rows: [{ CardCode: 'A' }, { CardCode: 'A' }], truncated: false });
  await expect(composition.execute(entity, options, catalog)).rejects.toThrow(/más de un registro/);
  lookup.mockResolvedValue({ rows: [], truncated: true });
  await expect(composition.execute(entity, options, catalog)).rejects.toThrow(/completar/);
  sources.execute.mockClear();
  await expect(composition.execute(entity, { ...options, selectedFields: ['invented'] }, catalog)).rejects.toThrow(/columna/);
  expect(sources.execute).not.toHaveBeenCalled();
});

test('exact SAP lookup escapes quotes, reads pages and rejects unapproved keys', async () => {
  const transport = require('../services/sap.service');
  transport.get.mockResolvedValueOnce({ data: { value: [{ CardCode: "O'BRIEN", CardName: 'Prueba' }], 'odata.nextLink': 'BusinessPartners?$skip=1' } })
    .mockResolvedValueOnce({ data: { value: [] } });
  const result = await sap.lookup('customers', 'CardCode', ["O'BRIEN"]);
  expect(result.rows).toHaveLength(1);
  const url = new URL(transport.get.mock.calls[0][0], 'https://example.test');
  expect(url.searchParams.get('$filter')).toBe("(CardType eq 'cCustomer') and (CardCode eq 'O''BRIEN')");
  await expect(sap.lookup('customers', 'CardName', ['name'])).rejects.toThrow(/no es válida/);
});
test('long exact codes are split into SAP requests within the verified query size', async () => {
  const transport = require('../services/sap.service');
  transport.get.mockResolvedValue({ data:{ value:[] } });
  const values=Array.from({length:60},(_,index)=>`${index}-${'Á'.repeat(80)}`);
  await sap.lookup('customers','CardCode',values);
  expect(transport.get.mock.calls.length).toBeGreaterThan(2);
  expect(transport.get.mock.calls.every(([path])=>path.length<1800)).toBe(true);
});
