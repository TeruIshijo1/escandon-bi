'use strict';
jest.mock('../config/remote-db', () => ({ connectRemoteDB: jest.fn(), sql: { Int: 'int', VarChar: jest.fn(), NVarChar: jest.fn() } }));
jest.mock('../services/sap.service', () => ({ get: jest.fn() }));
const { connectRemoteDB } = require('../config/remote-db');
const sap = require('../services/sap.service');
const manifest = require('../config/assistant-report-resources.json');
const { catalog, execute } = require('../services/assistantResourceCatalog.service');
const options = { fechaDesde: '2026-09-01', fechaHasta: '2026-09-30', limit: 2 };
let request;
beforeEach(() => { jest.clearAllMocks(); request = { input: jest.fn().mockReturnThis(), query: jest.fn().mockResolvedValue({ recordset: [] }) }; connectRemoteDB.mockResolvedValue({ request: () => request }); });
test('schema has no credentials, every FK join preserves cardinality, and each relation has its own ID', () => {
  const unsafe = /password|passwd|token|login|credential|secret|privatekey|signature|firma|biometric|fingerprint/i;
  expect(manifest.resources.every(resource => resource.fields.every(field => !unsafe.test(field.key)))).toBe(true);
  for (const relation of manifest.relationships) {
    const target = manifest.resources.find(resource => resource.id === relation.target);
    expect(target.uniqueKeys.some(keys => keys.length === relation.columns.length && keys.every(key => relation.columns.some(pair => pair[1] === key)))).toBe(true);
    expect(catalog[`${relation.source}__related__${relation.name}`]).toBeDefined();
  }
  expect(Object.keys(catalog)).toHaveLength(manifest.resources.length + manifest.relationships.length);
  expect(Object.values(catalog).every(resource => resource.assistantOnly && resource.requiredPermissions.length === 1 && Object.keys(resource.summary).length === 0)).toBe(true);
  const unavailable = require('../config/assistant-sap-field-availability.json').unavailableFields;
  for (const resource of manifest.resources.filter(resource=>resource.source==='SAP')) expect(resource.fields.every(field=>!(unavailable[resource.endpoint]||[]).includes(field.key))).toBe(true);
});
test('only allowlisted identifiers reach SQL and search is literal, parameterized and before TOP', async () => {
  const id = 'assistant_resource_vertical__dbo__PC';
  request.query.mockResolvedValue({ recordset: [{ PCNum: 1 }, { PCNum: 2 }, { PCNum: 3 }] });
  const result = await execute(id, { ...options, selectedFields: ['PCNum'], busqueda: "x%'_[]" });
  expect(result).toMatchObject({ rows: [{ PCNum: 1 }, { PCNum: 2 }], truncated: true });
  expect(request.input.mock.calls.find(([key]) => key === 'busqueda')[2]).toBe("%x\\%'\\_\\[]%");
  expect(request.query.mock.calls[0][0]).toMatch(/TOP \(@rowLimit\).*v\.\[PCNum\]/s);
  expect(request.query.mock.calls[0][0]).not.toContain("x%'");
  request.query.mockClear();
  await expect(execute(id, { ...options, selectedFields: ['PCNum;DROP TABLE PC'] })).rejects.toThrow(/no pertenece/);
  expect(request.query).not.toHaveBeenCalled();
});
test('a declared relation is a LEFT JOIN on every key without inflating base rows', async () => {
  const relation = manifest.relationships[0];
  await execute(`${relation.source}__related__${relation.name}`, options);
  const query = request.query.mock.calls[0][0];
  expect(query).toContain('LEFT JOIN');
  for (const [source, target] of relation.columns) expect(query).toContain(`v.[${source}] = r.[${target}]`);
});

test('internal analysis fields are selected but do not widen the original SQL text search', async () => {
  await execute('assistant_resource_vertical__dbo__PC', { ...options, selectedFields: ['PCNum', 'PTNum'], searchFields: ['PCNum'], busqueda: '42' });
  const query = request.query.mock.calls[0][0];
  expect(query).toContain('v.[PTNum] AS [PTNum]');
  const where = query.slice(query.indexOf('WHERE'), query.indexOf('ORDER BY'));
  expect(where).toContain('CONVERT(nvarchar(4000),v.[PCNum],126) LIKE @busqueda');
  expect(where).not.toContain('v.[PTNum]');
  request.query.mockClear();
  await expect(execute('assistant_resource_vertical__dbo__PC', { ...options, selectedFields: ['PCNum'], searchFields: ['Unapproved'] })).rejects.toThrow(/búsqueda/);
  expect(request.query).not.toHaveBeenCalled();
});
test('SAP requests only selected scalar fields, uses pages, and applies search before output limit', async () => {
  const id = 'assistant_resource_sap__BusinessPartners';
  sap.get.mockResolvedValueOnce({ data: { value: [{ CardCode: 'A', CardName: 'Uno' }], 'odata.nextLink': 'BusinessPartners?$skip=1' } }).mockResolvedValueOnce({ data: { value: [{ CardCode: 'B', CardName: 'Dos' }] } });
  const result = await execute(id, { limit: 1, selectedFields: ['CardCode', 'CardName'], busqueda: 'dos' });
  expect(result).toEqual({ rows: [{ CardCode: 'B', CardName: 'Dos' }], truncated: false });
  expect(new URL(sap.get.mock.calls[0][0], 'https://test.invalid').searchParams.get('$select')).toBe('CardCode,CardName');
});
test('rejects invalid dates, invented resources and unexpected SAP pages without querying other endpoints', async () => {
  await expect(execute('assistant_resource_vertical__dbo__PC', { ...options, fechaDesde: '2026-02-30' })).rejects.toThrow(/período/);
  await expect(execute('arbitrary_sql', options)).rejects.toThrow(/no está disponible/);
  sap.get.mockResolvedValue({ data: { value: [], 'odata.nextLink': 'Invoices?$skip=1' } });
  await expect(execute('assistant_resource_sap__BusinessPartners', { selectedFields: ['CardCode'] })).rejects.toThrow(/continuación no válida/);
  expect(sap.get).toHaveBeenCalledTimes(1);
});
test('a selection exceeding the verified SAP query budget asks for fewer columns before contacting SAP', async () => {
  const id='assistant_resource_sap__Invoices';
  await expect(execute(id,{...options,selectedFields:catalog[id].fields.map(field=>field.key)})).rejects.toThrow(/Elige menos datos/);
  expect(sap.get).not.toHaveBeenCalled();
});
