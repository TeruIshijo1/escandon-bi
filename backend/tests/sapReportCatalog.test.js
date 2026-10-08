'use strict';

jest.mock('../services/sap.service', () => ({
  get: jest.fn(), post: jest.fn(), patch: jest.fn(), _request: jest.fn()
}));

const sap = require('../services/sap.service');
const { catalog, execute } = require('../services/sapReportCatalog.service');
const options = { fechaDesde: '2026-09-01', fechaHasta: '2026-09-30', limit: 20 };
const response = (value, extra = {}) => ({ data: { value, ...extra } });
const invoice = (DocEntry, extra = {}) => ({
  DocEntry, DocNum: 1000 + DocEntry, DocDate: '2026-09-15T00:00:00Z',
  DocDueDate: '2026-10-15T00:00:00Z', DocCurrency: 'MXN',
  DocTotal: 120, PaidToDate: 20, DocumentStatus: 'bost_Open', ...extra
});
const order = (DocEntry, lines, extra = {}) => ({
  ...invoice(DocEntry), DocumentLines: lines, ...extra
});
const line = (LineNum, extra = {}) => ({
  LineNum, ItemCode: `ITEM-${LineNum}`, ItemDescription: `Artículo ${LineNum}`,
  Quantity: 2, RemainingOpenQuantity: 1, Price: 50, LineTotal: 100,
  WarehouseCode: 'FAR', ...extra
});

beforeEach(() => {
  jest.clearAllMocks();
  sap.get.mockReset();
});

test.each([
  ['odata.nextLink', 'Invoices?$skip=500'],
  ['@odata.nextLink', '/b1s/v1/Invoices?$skip=500'],
  ['odata.nextLink', 'https://sap.example.test/b1s/v2/Invoices?$skip=500']
])('reads the second OData page (%s) without losing documents', async (key, linkUrl) => {
  sap.get.mockResolvedValueOnce(response([invoice(1)], { [key]: linkUrl }))
    .mockResolvedValueOnce(response([invoice(2)]));

  const result = await execute('sales_invoice_summary', options);

  expect(result.rows.map(row => row.DocEntry)).toEqual([1, 2]);
  expect(result.truncated).toBe(false);
  expect(sap.get).toHaveBeenCalledTimes(2);
  expect(sap.get.mock.calls[1][0]).toBe('/Invoices?$skip=500');
  expect(sap.get.mock.calls[0][1]).toEqual({ Prefer: 'odata.maxpagesize=500' });
});

test('sends a fixed field selection, posting date period and open-document filter', async () => {
  sap.get.mockResolvedValue(response([invoice(1)]));

  const result = await execute('accounts_receivable', options);
  const query = new URL(sap.get.mock.calls[0][0], 'https://sap.example.test');
  const select = query.searchParams.get('$select').split(',');

  expect(query.pathname).toBe('/Invoices');
  expect(select).toEqual(expect.arrayContaining([
    'DocEntry', 'DocNum', 'DocCurrency', 'DocTotal', 'PaidToDate', 'DocumentStatus'
  ]));
  expect(query.searchParams.get('$filter')).toBe(
    "Cancelled eq 'tNO' and DocumentStatus eq 'bost_Open' and DocDate ge '2026-09-01' and DocDate le '2026-09-30'"
  );
  expect(query.searchParams.get('$orderby')).toBe('DocDate desc,DocEntry desc');
  expect(query.searchParams.has('$top')).toBe(false);
  expect(result.rows[0]).toMatchObject({ Balance: 100, DocDate: '2026-09-15' });
  expect(catalog.accounts_receivable.description).toMatch(/saldo.*actual|Saldo actual/);
});

test('limits flattened lines, warns on an additional matching row and stops pagination', async () => {
  sap.get.mockResolvedValue(response([order(1, [line(0), line(1), line(2)])], {
    'odata.nextLink': 'Orders?$skip=500'
  }));

  const result = await execute('sales_orders', { ...options, limit: 2 });

  expect(result.rows.map(row => row.LineNum)).toEqual([0, 1]);
  expect(result.rows).toHaveLength(2);
  expect(result.truncated).toBe(true);
  expect(sap.get).toHaveBeenCalledTimes(1);
  expect(result.rows[0]).not.toHaveProperty('DocTotal');
});

test('does not mark an exact limit as truncated when the source is complete', async () => {
  sap.get.mockResolvedValue(response([order(1, [line(0), line(1)])]));

  const result = await execute('sales_orders', { ...options, limit: 2 });

  expect(result.rows).toHaveLength(2);
  expect(result.truncated).toBe(false);
});

test('sales orders select the registered patient without replacing it with the payer or losing lines', async () => {
  sap.get.mockResolvedValue(response([
    order(1, [line(0), line(1)], { CardName: 'Aseguradora de prueba',
      U_PTName: ' Paciente ficticio ', U_PTNum: 77, U_PCNum: 123 }),
    order(2, [line(0)], { CardName: 'Otro pagador', U_PTName: ' ', U_PTNum: null, U_PCNum: null })
  ]));

  const result = await execute('sales_orders', options);
  const query = new URL(sap.get.mock.calls[0][0], 'https://sap.example.test');
  expect(query.pathname).toBe('/Orders');
  expect(query.searchParams.get('$select').split(',')).toEqual(expect.arrayContaining([
    'U_PTName', 'U_PTNum', 'U_PCNum', 'CardName', 'DocumentLines'
  ]));
  expect(result.rows).toHaveLength(3);
  expect(result.rows.slice(0, 2)).toMatchObject([
    { DocEntry: 1, LineNum: 0, PatientName: 'Paciente ficticio', PTNum: 77, PCNum: 123, CardName: 'Aseguradora de prueba' },
    { DocEntry: 1, LineNum: 1, PatientName: 'Paciente ficticio', PTNum: 77, PCNum: 123, CardName: 'Aseguradora de prueba' }
  ]);
  expect(result.rows[2]).toMatchObject({ DocEntry: 2, PatientName: null, PTNum: null, PCNum: null, CardName: 'Otro pagador' });
  expect(catalog.sales_orders.defaultFields).toContain('PatientName');
  expect(catalog.sales_orders.fields.find(column => column.key === 'PatientName').label).toBe('Paciente');
});

test('patient fields are only requested for sales orders and missing patient names stay empty', async () => {
  sap.get.mockResolvedValue(response([order(1, [line(0)], { CardName: 'Pagador de prueba' })]));
  expect((await execute('sales_orders', options)).rows[0].PatientName).toBeNull();

  const result = await execute('sales_quotations', options);
  const select = new URL(sap.get.mock.calls.at(-1)[0], 'https://sap.example.test').searchParams.get('$select');
  expect(select).not.toMatch(/U_PTName|U_PTNum|U_PCNum/);
  expect(result.rows[0]).not.toHaveProperty('PatientName');
  expect(catalog.sales_quotations.fields.some(column => column.key === 'PatientName')).toBe(false);
});

test('sales order summary includes canceled and empty orders once with their own patient and header amount', async () => {
  sap.get.mockResolvedValue(response([
    invoice(1, { CardName: 'Aseguradora de prueba', Cancelled: 'tNO', U_PTName: 'Paciente ficticio', U_PTNum: 77, U_PCNum: 123, U_SONum: 30,
      DocumentLines: [line(0), line(1)] }),
    invoice(2, { CardName: 'Pagador de prueba', Cancelled: 'tYES', DocumentStatus: 'bost_Close', DocumentLines: [] })
  ]));
  const result = await execute('sales_order_summary', options);
  const query = new URL(sap.get.mock.calls[0][0], 'https://sap.example.test');
  expect(query.pathname).toBe('/Orders');
  expect(query.searchParams.get('$filter')).toBe("DocDate ge '2026-09-01' and DocDate le '2026-09-30'");
  expect(query.searchParams.get('$select').split(',')).toEqual(expect.arrayContaining([
    'U_PTName', 'U_PTNum', 'U_PCNum', 'U_SONum', 'DocumentStatus', 'Cancelled', 'DocTotal'
  ]));
  expect(query.searchParams.get('$select')).not.toContain('DocumentLines');
  expect(result.rows).toHaveLength(2);
  expect(result.rows[0]).toMatchObject({ DocEntry: 1, PatientName: 'Paciente ficticio', PTNum: 77, PCNum: 123,
    VerticalOrderNum: 30, DocTotal: 120, CardName: 'Aseguradora de prueba', Cancelled: 'No' });
  expect(result.rows[1]).toMatchObject({ DocEntry: 2, PatientName: null, DocStatus: 'Cerrada', Cancelled: 'Sí', DocTotal: 120 });
  expect(catalog.sales_order_summary.summary.amountField).toBe('DocTotal');
});

test('applies detail filters before the row limit, including later pages', async () => {
  sap.get.mockResolvedValueOnce(response([order(1, [line(0, { WarehouseCode: 'QX' })])], {
    'odata.nextLink': 'Orders?$skip=500'
  })).mockResolvedValueOnce(response([order(2, [
    line(1, { ItemDescription: 'Material descartado', WarehouseCode: 'QX' }),
    line(2, { ItemDescription: 'Insumo solicitado' }),
    line(3, { ItemDescription: 'Insumo solicitado adicional' })
  ])]));

  const result = await execute('sales_orders', {
    ...options, limit: 1, almacen: 'FAR', busqueda: 'solicitado', estatusDoc: 'OPEN'
  });

  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({ DocEntry: 2, LineNum: 2, WhsCode: 'FAR' });
  expect(result.truncated).toBe(true);
  expect(sap.get).toHaveBeenCalledTimes(2);
});

test('aggregates each payment once without multiplying checks and card collections', async () => {
  sap.get.mockResolvedValue(response([{
    DocEntry: 8, DocNum: 88, DocDate: '2026-09-05', DocCurrency: 'MXN',
    CashSum: 10, TransferSum: 20,
    PaymentCreditCards: [{ CreditSum: 30, CreditCur: 'MXN' }, { CreditSum: 40, CreditCur: 'MXN' }],
    PaymentChecks: [{ CheckSum: 50, Currency: 'MXN' }, { CheckSum: 60, Currency: 'MXN' }],
    PaymentInvoices: [{ DocEntry: 1, SumApplied: 100 }, { DocEntry: 2, SumApplied: 110 }]
  }]));

  const result = await execute('incoming_payments', options);
  const selected = new URL(sap.get.mock.calls[0][0], 'https://sap.example.test').searchParams.get('$select');

  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({
    DocEntry: 8, CashSum: 10, TransferSum: 20, CreditSum: 70, CheckSum: 110, PaymentTotal: 210
  });
  expect(selected.split(',')).toEqual(expect.arrayContaining(['DocCurrency', 'PaymentChecks', 'PaymentCreditCards']));
});

test('preserves zero-stock articles and real general minimum and maximum values', async () => {
  sap.get.mockResolvedValue(response([{
    ItemCode: 'ZERO', ItemName: 'Artículo sin existencias', QuantityOnStock: 0,
    ItemsGroupCode: 101, InventoryItem: 'tYES', PurchaseItem: 'tYES', SalesItem: 'tNO',
    MinInventory: 0, MaxInventory: 45, Valid: 'tYES', Frozen: 'tNO',
    U_CLASI_MED_1: 'CON', U_CLASI_MED_2: 'AR'
  }]));

  const result = await execute('item_master_data', options);
  const query = new URL(sap.get.mock.calls[0][0], 'https://sap.example.test');

  expect(query.searchParams.has('$filter')).toBe(false);
  expect(query.searchParams.get('$select').split(',')).toEqual(expect.arrayContaining([
    'MinInventory', 'MaxInventory', 'U_CLASI_MED_1', 'U_CLASI_MED_2'
  ]));
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({
    ItemCode: 'ZERO', MinStock: 0, MaxStock: 45, InventoryItem: 'Sí', SalesItem: 'No', ValidFor: 'Activo'
  });
});

test('computes projected stock per warehouse and preserves negative availability', async () => {
  sap.get.mockResolvedValue(response([{
    ItemCode: 'STOCK', ItemName: 'Artículo', ItemWarehouseInfoCollection: [
      { WarehouseCode: 'FAR', InStock: 0, Committed: 5, Ordered: 2, MinimalStock: 3, MaximalStock: 10 },
      { WarehouseCode: 'QX', InStock: 4, Committed: 1, Ordered: 8, MinimalStock: 2, MaximalStock: 20 }
    ]
  }]));

  const result = await execute('stock_availability', options);

  expect(result.rows.map(row => [row.WhsCode, row.Available, row.MinStock, row.MaxStock])).toEqual([
    ['FAR', -3, 3, 10], ['QX', 11, 2, 20]
  ]);
  expect(decodeURIComponent(sap.get.mock.calls[0][0])).toContain("InventoryItem eq 'tYES'");
  expect(decodeURIComponent(sap.get.mock.calls[0][0])).not.toContain('QuantityOnStock gt');
});

test('enriches every price list, retains zero prices and reads the next list page', async () => {
  sap.get.mockImplementation(async endpoint => {
    if (endpoint.startsWith('/Items?')) return response([{
      ItemCode: 'ZERO', ItemName: 'Artículo', ItemPrices: [
        { PriceList: 1, Price: 0, Currency: 'MXN' }, { PriceList: 2, Price: 125, Currency: 'MXN' }
      ]
    }]);
    if (endpoint === '/PriceLists?$skip=500') return response([{ PriceListNo: 2, PriceListName: 'Hospitalización' }]);
    if (endpoint.startsWith('/PriceLists?')) return response([{ PriceListNo: 1, PriceListName: 'Público' }], {
      '@odata.nextLink': 'PriceLists?$skip=500'
    });
    throw new Error('Consulta inesperada en prueba');
  });

  const result = await execute('item_prices', options);

  expect(result.rows).toHaveLength(2);
  expect(result.rows).toMatchObject([
    { ItemCode: 'ZERO', ItemName: 'Artículo', PriceList: 1, Price: 0, Currency: 'MXN', PriceListName: 'Público' },
    { ItemCode: 'ZERO', ItemName: 'Artículo', PriceList: 2, Price: 125, Currency: 'MXN', PriceListName: 'Hospitalización' }
  ]);
});

test('filters medical classification from either sanitary classification field', async () => {
  sap.get.mockResolvedValue(response([
    { ItemCode: 'MATCH', ItemName: 'Artículo', U_CLASI_MED_1: 'AR', U_CLASI_MED_2: 'CON' },
    { ItemCode: 'OTHER', ItemName: 'Otro', U_CLASI_MED_1: 'AR', U_CLASI_MED_2: 'LASA' }
  ]));

  const result = await execute('item_master_data', { ...options, clasificacionMedica: 'CON' });

  expect(result.rows.map(row => row.ItemCode)).toEqual(['MATCH']);
});

test('uses accounting date and keeps debit and credit as separate line values', async () => {
  sap.get.mockResolvedValue(response([{
    JdtNum: 3, ReferenceDate: '2026-09-05', JournalEntryLines: [
      { Line_ID: 0, AccountCode: '1000', Debit: 120, Credit: 0 },
      { Line_ID: 1, AccountCode: '2000', Debit: 0, Credit: 120 }
    ]
  }]));

  const result = await execute('journal_entries', options);

  expect(decodeURIComponent(sap.get.mock.calls[0][0])).toContain("ReferenceDate ge '2026-09-01'");
  expect(result.rows.map(row => [row.Line_ID, row.Debit, row.Credit])).toEqual([[0, 120, 0], [1, 0, 120]]);
});

test.each([
  '/BusinessPartners?$skip=500',
  '/Invoices(1)?$skip=500',
  'https://sap.example.test/other/Invoices?$skip=500'
])('rejects a nextLink that does not belong to the selected collection: %s', async badLink => {
  sap.get.mockResolvedValue(response([invoice(1)], { 'odata.nextLink': badLink }));

  await expect(execute('sales_invoice_summary', options)).rejects.toThrow(/página no válida/);
  expect(sap.get).toHaveBeenCalledTimes(1);
});

test('rejects a repeated pagination link without issuing an endless request', async () => {
  sap.get.mockResolvedValueOnce(response([invoice(1)], { 'odata.nextLink': 'Invoices?$skip=500' }))
    .mockResolvedValueOnce(response([invoice(2)], { 'odata.nextLink': 'Invoices?$skip=500' }));

  await expect(execute('sales_invoice_summary', options)).rejects.toThrow(/repitió una página/);
  expect(sap.get).toHaveBeenCalledTimes(2);
});

test('follows an empty intermediate page when SAP still provides a continuation', async () => {
  sap.get.mockResolvedValueOnce(response([invoice(1)], { 'odata.nextLink': 'Invoices?$skip=500' }))
    .mockResolvedValueOnce(response([], { 'odata.nextLink': 'Invoices?$skip=1000' }))
    .mockResolvedValueOnce(response([invoice(2)]));
  const result = await execute('sales_invoice_summary', options);
  expect(result.rows.map(row => row.DocEntry)).toEqual([1, 2]);
  expect(result.truncated).toBe(false);
  expect(sap.get).toHaveBeenCalledTimes(3);
});

test('an endless sequence of empty continuation pages is bounded and marked incomplete', async () => {
  let page = 0;
  sap.get.mockImplementation(async () => response([], { 'odata.nextLink': `Invoices?$skip=${++page}` }));
  const result = await execute('sales_invoice_summary', options);
  expect(result).toEqual({ rows: [], truncated: true });
  expect(sap.get).toHaveBeenCalledTimes(100);
});

test('propagates an unavailable source and rejects malformed successful responses', async () => {
  const unavailable = new Error('Fuente SAP no disponible');
  sap.get.mockRejectedValueOnce(unavailable);
  await expect(execute('sales_orders', options)).rejects.toBe(unavailable);

  sap.get.mockResolvedValueOnce({ data: { value: null } });
  await expect(execute('sales_orders', options)).rejects.toThrow(/respuesta de SAP/);
});

test('every report operates through GET and never writes or registers SAP queries', async () => {
  sap.get.mockResolvedValue(response([]));

  for (const id of Object.keys(catalog)) await execute(id, options);

  expect(sap.get).toHaveBeenCalled();
  expect(sap.post).not.toHaveBeenCalled();
  expect(sap.patch).not.toHaveBeenCalled();
  expect(sap._request).not.toHaveBeenCalled();
  expect(sap.get.mock.calls.some(([endpoint]) => endpoint.includes('SQLQueries'))).toBe(false);
});

test('foreign or mixed payment means do not fabricate a comparable total', async () => {
  sap.get.mockResolvedValue(response([
    { DocCurrency: 'USD', CurrencyIsLocal: 'tNO', CashSum: 100, PaymentCreditCards: [{ CreditCur: 'USD', CreditSum: 20 }] },
    { DocCurrency: 'MXN', CurrencyIsLocal: 'tYES', CashSum: 100, PaymentChecks: [{ Currency: 'USD', CheckSum: 20 }] }
  ]));
  const result = await execute('incoming_payments', options);
  expect(result.rows.every(row => row.PaymentTotal === null && row.PaymentTotalNote)).toBe(true);
});
