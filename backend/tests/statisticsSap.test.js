'use strict';

jest.mock('../services/sap.service', () => ({ get: jest.fn() }));
jest.mock('../config/sap.config', () => ({ baseUrl: 'https://sap.example.test/b1s/v2' }));
const sap = require('../services/sap.service');
const { getFinancialStatistics, _testing } = require('../services/statisticsSap.service');
const range = { startDate: '2026-09-01', endDate: '2026-09-30' };
const items = [
  { ItemCode: 'LAB', ItemName: 'Estudio', ItemsGroupCode: 101 },
  { ItemCode: 'IMA', ItemName: 'Imagen', ItemsGroupCode: 117 },
  { ItemCode: 'PLAB', ItemName: 'Paquete', ItemsGroupCode: 121 },
  { ItemCode: 'US', ItemName: 'Ultrasonido', ItemsGroupCode: 130 }
];
function document(overrides = {}) {
  return { DocEntry: 1, DocNum: 101, DocDate: '2026-09-02T00:00:00Z', TaxDate: '2026-09-01T00:00:00Z',
    DocCurrency: 'MXN', DocTotal: 100, VatSum: 0, TotalDiscount: 0, DiscountPercent: 0,
    Cancelled: 'tNO', DocumentStatus: 'bost_Close', CardCode: 'C1', U_PCNum: 25, U_PCType: 'IP', U_PRNum: 5, U_PRName: 'Médico A',
    DocumentLines: [{ LineNum: 0, ItemCode: 'LAB', ItemDescription: 'Estudio', Quantity: 1, LineTotal: 100, TaxTotal: 0 }], ...overrides };
}
beforeEach(() => { sap.get.mockReset(); _testing.resetCache(); });

test('paginates without $top, uses the workbook document date, and preserves open and closed orders', async () => {
  sap.get.mockImplementation(async (endpoint, headers, options) => {
    expect(endpoint).not.toContain('$top=');
    expect(headers.Prefer).toBe('odata.maxpagesize=200');
    expect(options.timeoutMs).toBeGreaterThan(0);
    if (endpoint.startsWith('/Items?')) return { data: { value: items } };
    if (endpoint.includes('$skip=200')) return { data: { value: [document({ DocEntry: 2, DocNum: 102, DocumentStatus: 'bost_Open' })] } };
    expect(decodeURIComponent(endpoint)).toContain("TaxDate ge '2026-09-01' and TaxDate lt '2026-10-01'");
    expect(decodeURIComponent(endpoint)).toContain("Cancelled eq 'tNO'");
    expect(endpoint).not.toContain('DocumentStatus eq');
    return { data: { value: [document()], '@odata.nextLink': '/b1s/v2/Orders?$skip=200' } };
  });
  const result = await getFinancialStatistics(range);
  expect(result.rows).toHaveLength(2);
  expect(result.rows[0].Fecha).toBe('2026-09-01');
  expect(result.summary).toMatchObject({ orderCount: 2, totalOrders: 200, netAmount: 200 });
  expect(result.documents[0]).toMatchObject({ TotalOrdenVenta: 100, NumeroMedico: 5 });
});

test('allocates a header discount once, separates VAT, and counts the header only once', () => {
  const doc = document({ DocTotal: 313.2, VatSum: 43.2, DiscountPercent: 10, TotalDiscount: 30,
    DocumentLines: [
      { LineNum: 0, ItemCode: 'LAB', Quantity: 1, LineTotal: 100, TaxTotal: 16 },
      { LineNum: 1, ItemCode: 'IMA', Quantity: 2, LineTotal: 200, TaxTotal: 32 }
    ] });
  const result = _testing.flattenDocuments([doc], 'Orders', items);
  expect(result.rows.map(row => row.IngresoNeto)).toEqual([90, 180]);
  expect(result.rows.map(row => row.IVA)).toEqual([14.4, 28.8]);
  expect(result.documents).toHaveLength(1);
  expect(result.documents[0].TotalOrdenVenta).toBe(313.2);
  expect(result.documents[0].DiferenciaSinDistribuir).toBe(0);
});

test('classifies package and structural ultrasound items and exposes missing classifications', () => {
  const result = _testing.flattenDocuments([document({ U_PCType: null, U_PRNum: null, U_PRName: null,
    DocTotal: 120, DocumentLines: [
      { LineNum: 0, ItemCode: 'PLAB', Quantity: 1, LineTotal: 40, TaxTotal: 0 },
      { LineNum: 1, ItemCode: 'US', Quantity: 1, LineTotal: 40, TaxTotal: 0 },
      { LineNum: 2, ItemCode: 'UNKNOWN', Quantity: 1, LineTotal: 40, TaxTotal: 0 }
    ] })], 'Orders', items);
  expect(result.rows.map(row => row.Categoria)).toEqual(['laboratorio', 'imagen', null]);
  expect(result.rows[0].Medico).toBe('Sin identificar');
  expect(result.issues).toMatchObject({ missingDoctor: 3, missingAccountType: 3, missingItems: 1 });
  expect(result.warnings).toHaveLength(3);
});

test('does not multiply a consolidated order or assign its header doctor to other accounts', () => {
  const result = _testing.flattenDocuments([document({ DocTotal: 200, DocumentLines: [
    { LineNum: 0, ItemCode: 'LAB', Quantity: 1, LineTotal: 100, TaxTotal: 0, U_PCNum: 25 },
    { LineNum: 1, ItemCode: 'IMA', Quantity: 1, LineTotal: 100, TaxTotal: 0, U_PCNum: 26 }
  ] })], 'Orders', items);
  expect(result.rows.map(row => row.FolioAtencion)).toEqual([25, 26]);
  expect(result.rows.every(row => row.NumeroMedico === null && row.TipoAtencion === null)).toBe(true);
  expect(result.documents).toHaveLength(1);
  expect(result.documents[0]).toMatchObject({ FolioAtencion: null, TotalOrdenVenta: 200, AtencionesMultiples: true });
  expect(result.issues.multiAccountDocuments).toBe(1);
  expect(result.warnings.some(warning => warning.includes('varias atenciones'))).toBe(true);
});

test('counts specialty consultation and shock services without counting supplies or general consultations', () => {
  const codes = ['SER0578', 'SER0598', 'SER0577', 'SER0628', 'SER0633', 'SER0634', 'SER0515', 'SER0533'];
  const catalog = codes.map(ItemCode => ({ ItemCode, ItemsGroupCode: ItemCode === 'SER0515' ? 131 : ItemCode === 'SER0533' ? 132 : 107 }));
  const result = _testing.flattenDocuments([document({ DocTotal: 800,
    DocumentLines: codes.map((ItemCode, LineNum) => ({ ItemCode, LineNum, LineTotal: 100, Quantity: 1, TaxTotal: 0 }))
  })], 'Orders', catalog);
  expect(result.rows.map(row => row.Categoria)).toEqual(['consulta', null, null, null, null, null, 'choque', 'choque']);
});

test('billing stays separate, signs credits negatively, and reads the referenced invoice outside the period', async () => {
  const credit = document({ DocEntry: 9, DocNum: 109, U_PCNum: null, U_PCType: null, U_PRNum: null, U_PRName: null,
    DocumentLines: [{ LineNum: 0, ItemCode: 'LAB', Quantity: 1, LineTotal: 100, TaxTotal: 0, BaseType: 13, BaseEntry: 7, BaseLine: 0 }] });
  sap.get.mockImplementation(async endpoint => {
    if (endpoint.startsWith('/Items?')) return { data: { value: items } };
    if (endpoint.startsWith('/Orders?')) return { data: { value: [document()] } };
    if (endpoint.startsWith('/Invoices(7)')) return { data: document({ DocEntry: 7, DocNum: 107, DocDate: '2026-08-20T00:00:00Z' }) };
    expect(decodeURIComponent(endpoint)).toContain("DocDate ge '2026-09-01'");
    if (endpoint.startsWith('/Invoices?')) return { data: { value: [document({ DocEntry: 8, DocNum: 108 })] } };
    if (endpoint.startsWith('/CreditNotes?')) return { data: { value: [credit] } };
    throw new Error('Unexpected read');
  });
  const result = await getFinancialStatistics({ ...range, includeBilling: true });
  expect(result.rows).toHaveLength(1);
  expect(result.billing.rows).toHaveLength(2);
  expect(result.billing.rows[1]).toMatchObject({ IngresoNeto: -100, Cantidad: -1, FolioAtencion: 25, TipoAtencion: 'IP', NumeroMedico: 5 });
  expect(result.billing.rows.reduce((sum, row) => sum + row.IngresoNeto, 0)).toBe(0);
});

test('excludes cancelled documents and reports amounts that cannot be distributed to services', () => {
  const result = _testing.flattenDocuments([document({ Cancelled: 'tYES' }), document({ DocEntry: 2, DocTotal: 125 }),
    document({ DocEntry: 3, CancelStatus: 'csCancellation', Cancelled: undefined })], 'Orders', items);
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].IngresoNeto).toBe(100);
  expect(result.documents[0].DiferenciaSinDistribuir).toBe(25);
  expect(result.issues.unallocatedDocuments).toBe(1);
});

test('keeps non-item service invoices without classifying rent as a missing clinical item', () => {
  const result = _testing.flattenDocuments([document({ DocType: 'dDocument_Service', U_PCNum: null,
    DocumentLines: [{ LineNum: 0, ItemCode: null, ItemDescription: 'Renta', Quantity: 1, LineTotal: 100, TaxTotal: 0 }]
  })], 'Invoices', items);
  expect(result.rows[0]).toMatchObject({ Categoria: null, Grupo: null, IngresoNeto: 100, ServicioSinArticulo: true });
  expect(result.warnings).toEqual([]);
});

test('billing-only mode avoids reading orders while preserving the billing collection', async () => {
  sap.get.mockImplementation(async endpoint => {
    if (endpoint.startsWith('/Items?')) return { data: { value: items } };
    if (endpoint.startsWith('/Invoices?')) return { data: { value: [document()] } };
    if (endpoint.startsWith('/CreditNotes?')) return { data: { value: [] } };
    throw new Error(`Unexpected collection: ${endpoint}`);
  });
  const result = await getFinancialStatistics({ ...range, includeOrders: false, includeBilling: true });
  expect(result.rows).toEqual([]);
  expect(result.documents).toEqual([]);
  expect(result.summary.totalOrders).toBe(0);
  expect(result.billing.rows).toHaveLength(1);
  expect(sap.get.mock.calls.every(([endpoint]) => !endpoint.startsWith('/Orders'))).toBe(true);
});

test.each([
  ['outside origin', 'https://other.test/b1s/v2/Orders?$skip=1'],
  ['different entity', '/b1s/v2/Invoices?$skip=1'],
  ['repeated page', '/Orders?$skip=1']
])('rejects unsafe or incomplete pagination: %s', async (_label, link) => {
  sap.get.mockResolvedValue({ data: { value: [], '@odata.nextLink': link } });
  await expect(_testing.readPages('/Orders?$skip=1', 'Orders')).rejects.toThrow();
});

test('fails on a later page instead of returning a partial statistic', async () => {
  sap.get.mockImplementation(async endpoint => {
    if (endpoint.startsWith('/Items?')) return { data: { value: items } };
    if (endpoint.includes('$skip=200')) throw new Error('Request timeout');
    return { data: { value: [document()], 'odata.nextLink': 'Orders?$skip=200' } };
  });
  await expect(getFinancialStatistics(range)).rejects.toThrow('Request timeout');
});

test('rejects missing amounts, duplicate lines, duplicate documents and incomplete pages', async () => {
  expect(() => _testing.flattenDocuments([document({ DocTotal: null })], 'Orders', items)).toThrow();
  const duplicate = document(); duplicate.DocumentLines.push({ ...duplicate.DocumentLines[0] });
  expect(() => _testing.flattenDocuments([duplicate], 'Orders', items)).toThrow(/repetidas/);
  sap.get.mockImplementation(async endpoint => ({ data: { value: endpoint.startsWith('/Items?') ? items : [document(), document()] } }));
  await expect(getFinancialStatistics(range)).rejects.toThrow(/repetidos/);
  sap.get.mockResolvedValue({ data: {} });
  await expect(getFinancialStatistics(range)).rejects.toThrow(/incompleta/);
});

test('rejects impossible or reversed date ranges before accessing SAP', async () => {
  await expect(getFinancialStatistics({ startDate: '2026-02-30', endDate: '2026-03-01' })).rejects.toThrow();
  await expect(getFinancialStatistics({ startDate: '2026-10-01', endDate: '2026-09-30' })).rejects.toThrow();
  expect(sap.get).not.toHaveBeenCalled();
});

test('finishes every catalog page before documents and stops before billing when orders fail', async () => {
  const calls = [];
  sap.get.mockImplementation(async endpoint => {
    calls.push(endpoint.split('?')[0]);
    if (endpoint.startsWith('/Items?') && !endpoint.includes('$skip=')) {
      return { data: { value: [items[0]], '@odata.nextLink': 'Items?$skip=200' } };
    }
    if (endpoint.startsWith('/Items?')) return { data: { value: items.slice(1) } };
    if (endpoint.startsWith('/Orders?')) throw new Error('SAP_READ_TIMEOUT');
    throw new Error('Billing should not start after a failed order read');
  });
  await expect(getFinancialStatistics({ ...range, includeBilling: true })).rejects.toThrow('SAP_READ_TIMEOUT');
  expect(calls).toEqual(['/Items', '/Items', '/Orders']);
});

test('failed catalog does not start document requests and is retried on the next request', async () => {
  sap.get.mockRejectedValueOnce(new Error('Catalog unavailable'));
  await expect(getFinancialStatistics({ ...range, includeBilling: true })).rejects.toThrow('Catalog unavailable');
  expect(sap.get).toHaveBeenCalledTimes(1);
  expect(sap.get.mock.calls[0][0]).toMatch(/^\/Items\?/);
  sap.get.mockImplementation(async endpoint => ({ data: { value: endpoint.startsWith('/Items?') ? items : [] } }));
  const result = await getFinancialStatistics(range);
  expect(result.documents).toEqual([]);
  expect(sap.get.mock.calls.filter(([endpoint]) => endpoint.startsWith('/Items?'))).toHaveLength(2);
});

test('concurrent report consumers share one catalog and never overlap SAP reads', async () => {
  let active = 0, maximum = 0;
  sap.get.mockImplementation(async endpoint => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    if (endpoint.startsWith('/Items?')) return { data: { value: items } };
    if (endpoint.includes('$skip=200')) return { data: { value: [document({ DocEntry: 2, DocNum: 102 })] } };
    return { data: { value: [document()], '@odata.nextLink': 'Orders?$skip=200' } };
  });
  const results = await Promise.all([getFinancialStatistics(range), getFinancialStatistics(range)]);
  expect(maximum).toBe(1);
  expect(sap.get.mock.calls.filter(([endpoint]) => endpoint.startsWith('/Items?'))).toHaveLength(1);
  expect(results.map(result => result.documents.length)).toEqual([2, 2]);
});

test('aborting a queued consumer prevents its request without interrupting the active read', async () => {
  let finishActive;
  sap.get.mockImplementation(() => new Promise(resolve => { finishActive = resolve; }));
  const first = _testing.readPages('/Orders?$skip=0', 'Orders');
  await new Promise(resolve => setImmediate(resolve));
  const controller = new AbortController();
  const second = _testing.readPages('/Invoices?$skip=0', 'Invoices', { signal: controller.signal });
  const rejected = expect(second).rejects.toMatchObject({ code: 'ABORT_ERR' });
  controller.abort();
  await rejected;
  finishActive({ data: { value: [] } });
  await expect(first).resolves.toEqual([]);
  expect(sap.get).toHaveBeenCalledTimes(1);
});

test('cancelling one consumer does not cancel the shared catalog needed by another report', async () => {
  let finishCatalog, catalogSignal;
  sap.get.mockImplementation(async (endpoint, _headers, options) => {
    if (endpoint.startsWith('/Items?')) {
      catalogSignal = options.signal;
      return new Promise(resolve => { finishCatalog = resolve; });
    }
    return { data: { value: [document()] } };
  });
  const controller = new AbortController();
  const cancelled = getFinancialStatistics({ ...range, signal: controller.signal });
  const surviving = getFinancialStatistics(range);
  const rejected = expect(cancelled).rejects.toMatchObject({ code: 'ABORT_ERR' });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await rejected;
  expect(catalogSignal.aborted).toBe(false);
  finishCatalog({ data: { value: items } });
  await expect(surviving).resolves.toMatchObject({ summary: { orderCount: 1 } });
  expect(sap.get.mock.calls.filter(([endpoint]) => endpoint.startsWith('/Items?'))).toHaveLength(1);
});

test('cancels the catalog request when its last consumer leaves and does not read orders', async () => {
  sap.get.mockImplementation((_endpoint, _headers, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('Cancelled'), { code: 'ABORT_ERR' })), { once: true });
  }));
  const controller = new AbortController();
  const report = getFinancialStatistics({ ...range, signal: controller.signal });
  const rejected = expect(report).rejects.toMatchObject({ code: 'ABORT_ERR' });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await rejected;
  await new Promise(resolve => setImmediate(resolve));
  expect(sap.get).toHaveBeenCalledTimes(1);
  expect(sap.get.mock.calls[0][0]).toMatch(/^\/Items\?/);
});
