'use strict';

const { validateAnalysis, getAnalysisCapabilities, requiredAnalysisFields, applyAnalysis, getPointLookup } = require('../services/reportAnalysis.service');
const entity = { id: 'accounts_receivable', grain: 'Una fila por factura.', defaultFields: ['CardName', 'Balance'], fields: [
  { key: 'DocEntry', label: 'Identificador' }, { key: 'CardName', label: 'Cliente', type: 'string' },
  { key: 'Balance', label: 'Saldo', type: 'money' }, { key: 'DocTotal', label: 'Total', type: 'money' },
  { key: 'Date', label: 'Fecha', type: 'datetime' }, { key: 'Currency', label: 'Moneda', type: 'string' },
  { key: 'Percent', label: 'Descuento', type: 'percent' }, { key: 'Price', label: 'Precio unitario', type: 'money' }
] };
const source = (data, extra = {}) => ({ data, truncated: false, columnas: entity.fields, kpis: [], ...extra });
const rows = [
  { DocEntry: 1, CardName: 'A', Balance: '10000.10', DocTotal: 12000, Date: '2026-09-01T22:30:00' },
  { DocEntry: 2, CardName: 'A', Balance: '-0.1', DocTotal: 5 },
  { DocEntry: 3, CardName: 'B', Balance: '20000.05', DocTotal: 25000 }
];

test('numeric predicates select the complete universe before grouping and output limit', () => {
  const analysis = { predicates: [{ field: 'Balance', op: 'gt', value: '10000' }], groupBy: ['CardName'],
    measures: [{ op: 'sum', field: 'Balance' }, { op: 'count' }], orderBy: [{ field: 'metric_0', direction: 'desc' }] };
  const result = applyAnalysis(entity, source(rows), analysis, { limit: 1 });
  expect(result.data).toEqual([{ CardName: 'B', metric_0: '20000.05', metric_1: 1 }]);
  expect(result.analysisScope).toMatchObject({ complete: true, sourceRows: 3, matchingRows: 2, groups: 2 });
  expect(result.truncated).toBe(true);
  expect(result.columnas.map(field => field.key)).toEqual(['CardName', 'metric_0', 'metric_1']);
});
test('six-decimal financial arithmetic retains signs and avoids binary rounding', () => {
  const result = applyAnalysis(entity, source([{ DocEntry: 1, Balance: '0.1' }, { DocEntry: 2, Balance: '0.2' }, { DocEntry: 3, Balance: '-0.05' }]), { measures: [{ op: 'sum', field: 'Balance' }] });
  expect(result.data).toEqual([{ metric_0: '0.25' }]);
  const large = applyAnalysis(entity, source([{ DocEntry: 1, Balance: '9007199254740993.123456' }, { DocEntry: 2, Balance: '0.000001' }]), { measures: [{ op: 'sum', field: 'Balance' }] });
  expect(large.data[0].metric_0).toBe('9007199254740993.123457');
});
test.each([null, '', 'NaN', Infinity, 'SER0718', '1,200.00'])('unknown amount %s leaves its group total unknown and visible', value => {
  const result = applyAnalysis(entity, source([{ DocEntry: 1, CardName: 'A', Balance: 10 }, { DocEntry: 2, CardName: 'A', Balance: value }]), { groupBy: ['CardName'], measures: [{ op: 'sum', field: 'Balance' }] });
  expect(result.data[0].metric_0).toBeNull(); expect(result.analysisScope.unknownValues).toBe(1);
  expect(result.analysisScope.note).toContain('no se sustituyen por cero');
});
test.each(['Price', 'Percent'])('prices and rates are not additive merely because numeric: %s', field => {
  expect(() => validateAnalysis(entity, { measures: [{ op: 'sum', field }] })).toThrow(/suma verificada/);
});
test('generic resources and repeated target balances deny sums but permit count and numeric filters', () => {
  const generic = { ...entity, id: 'assistant_resource_AG' };
  expect(getAnalysisCapabilities(generic).fields.every(field => !field.sumAllowed)).toBe(true);
  expect(() => validateAnalysis(generic, { measures: [{ op: 'sum', field: 'Balance' }] })).toThrow();
  expect(validateAnalysis(generic, { predicates: [{ field: 'Balance', op: 'gte', value: 5 }], groupBy: ['CardName'] }).measures).toEqual([{ op: 'count' }]);
  expect(() => validateAnalysis({ ...entity, nonAdditiveFields: ['Balance'] }, { measures: [{ op: 'sum', field: 'Balance' }] })).toThrow();
});
test('duplicate or missing financial owner cannot produce a sum even in different groups', () => {
  for (const data of [[{ DocEntry: 1, CardName: 'A', Balance: 10 }, { DocEntry: 1, CardName: 'B', Balance: 10 }],
    [{ DocEntry: 7, Balance: 10 }, { DocEntry: '7.0', Balance: 10 }], [{ DocEntry: 'invalid', Balance: 10 }], [{ CardName: 'A', Balance: 10 }]]) {
    expect(() => applyAnalysis(entity, source(data), { groupBy: ['CardName'], measures: [{ op: 'sum', field: 'Balance' }] })).toThrow();
  }
});
test('numeric group identities and distinct counts normalize number/string representations', () => {
  const account = { id: 'vertical_accounts', defaultFields: ['PCNum'], fields: [{ key: 'PCNum', label: 'Cuenta', type: 'number' }] };
  const data = [{ PCNum: 7 }, { PCNum: '7' }, { PCNum: '7.0' }, { PCNum: 'invalid' }, { PCNum: null }];
  const result = applyAnalysis(account, source(data), { measures: [{ op: 'countDistinct', field: 'PCNum' }] });
  expect(result.data).toEqual([{ metric_0: 1 }]); expect(result.analysisScope.unknownValues).toBe(2);
  const groups = applyAnalysis(account, source(data.slice(0, 3)), { groupBy: ['PCNum'], measures: [{ op: 'count' }] });
  expect(groups.data).toEqual([{ PCNum: 7, metric_0: 3 }]);
});
test.each([{ truncated: true }, { complete: false }, { analysisScope: { complete: false } }])('incomplete source cannot produce predicates, counts or totals: %j', incomplete => {
  expect(() => applyAnalysis(entity, source(rows, incomplete), { measures: [{ op: 'count' }] })).toThrow(/consulta completa/);
  expect(() => applyAnalysis(entity, source(rows, incomplete), { predicates: [{ field: 'Balance', op: 'gt', value: 10000 }] })).toThrow();
});
test('mixed invoice currencies require separate groups, unknown currency remains unknown', () => {
  const financial = { id: 'assistant_account_billing_collections', fields: [
    { key: 'PCNum', label: 'Cuenta', type: 'number' }, { key: 'InvoiceTotal', label: 'Facturas', type: 'money' }, { key: 'Currency', label: 'Moneda', type: 'string' }
  ], defaultFields: ['PCNum', 'InvoiceTotal'] };
  const data = [{ PCNum: 1, Currency: 'MXN', InvoiceTotal: 10 }, { PCNum: 2, Currency: 'USD', InvoiceTotal: 20 }, { PCNum: 3, Currency: null, InvoiceTotal: 30 }];
  expect(validateAnalysis(financial, { measures: [{ op: 'sum', field: 'InvoiceTotal' }] }).groupBy).toEqual(['Currency']);
  const result = applyAnalysis(financial, source(data), { groupBy: ['Currency'], measures: [{ op: 'sum', field: 'InvoiceTotal' }] });
  expect(result.data).toEqual([{ Currency: 'MXN', metric_0: '10' }, { Currency: 'USD', metric_0: '20' }, { Currency: null, metric_0: null }]);
});
test('case scope requires an exact trusted positive identity and rejects an arbitrary resource', () => {
  const account = { ...entity, pointLookupFields: ['DocEntry'] };
  expect(getPointLookup(account, { predicates: [{ field: 'DocEntry', op: 'eq', value: '123' }] })).toEqual({ field: 'DocEntry', value: 123 });
  for (const value of [0, -1, 1.2, '1 OR 1=1', 2147483648]) expect(getPointLookup(account, { predicates: [{ field: 'DocEntry', op: 'eq', value }] })).toBeNull();
  expect(getPointLookup(entity, { predicates: [{ field: 'DocEntry', op: 'eq', value: 123 }] })).toBeNull();
});
test('technical keys and operands are loaded but never exposed in a detailed result', () => {
  const analysis = { predicates: [{ field: 'Balance', op: 'gt', value: 10000 }], orderBy: [{ field: 'Balance', direction: 'desc' }] };
  expect(requiredAnalysisFields(entity, analysis)).toEqual(['Balance']);
  const result = applyAnalysis(entity, source(rows), analysis, { selectedFields: ['CardName'] });
  expect(result.data).toEqual([{ CardName: 'B' }, { CardName: 'A' }]);
  expect(requiredAnalysisFields(entity, { measures: [{ op: 'sum', field: 'Balance' }] })).toEqual(['Balance', 'DocEntry']);
});
test('zero is a known amount; distinct identities differ from row counts and skip absent identities', () => {
  expect(applyAnalysis(entity, source([{ DocEntry: 1, Balance: 0 }]), { measures: [{ op: 'sum', field: 'Balance' }] }).data[0].metric_0).toBe('0');
  const result = applyAnalysis(entity, source([{ DocEntry: 1 }, { DocEntry: 1 }, { DocEntry: null }]), { measures: [{ op: 'count' }, { op: 'countDistinct', field: 'DocEntry' }] });
  expect(result.data).toEqual([{ metric_0: 3, metric_1: 1 }]); expect(result.analysisScope.unknownValues).toBe(1);
});
test('date, text, between, and null predicates are typed and preserve literal wildcard text', () => {
  const result = applyAnalysis(entity, source(rows), { predicates: [{ field: 'Date', op: 'between', values: ['2026-09-01', '2026-09-30'] }, { field: 'CardName', op: 'contains', value: 'a' }] });
  expect(result.data).toHaveLength(1);
  expect(applyAnalysis(entity, source(rows), { predicates: [{ field: 'Date', op: 'isNull' }] }).data).toHaveLength(2);
  expect(() => validateAnalysis(entity, { predicates: [{ field: 'Date', op: 'eq', value: '2026-02-30' }] })).toThrow();
});
test.each([
  { sql: 'DROP TABLE x' }, { measures: [{ op: 'sum', field: 'Unknown' }] }, { groupBy: ['Unknown'] },
  { predicates: [{ field: 'Balance', op: 'contains', value: '10' }] },
  { predicates: [{ field: 'Balance', op: 'gt', value: '10;DROP TABLE' }] },
  { predicates: [{ field: 'Balance', op: 'between', values: [10, 1] }] },
  { predicates: Array.from({ length: 9 }, () => ({ field: 'Balance', op: 'isNull' })) },
  { measures: [{ op: 'avg', field: 'Balance' }] }, { measures: [{ op: 'count', field: 'DocEntry' }] },
  { groupBy: ['CardName'], orderBy: [{ field: 'Balance', direction: 'desc' }] }
])('invalid or unsupported analytics are refused before reading source: %j', analysis => expect(() => validateAnalysis(entity, analysis)).toThrow());
