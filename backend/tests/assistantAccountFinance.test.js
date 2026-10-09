'use strict';
jest.mock('../config/remote-db', () => ({ connectRemoteDB: jest.fn(), sql: { Int: 'int', VarChar: jest.fn(), NVarChar: jest.fn() } }));
jest.mock('../services/sap.service', () => ({ get: jest.fn(), post: jest.fn() }));
const { connectRemoteDB } = require('../config/remote-db');
const sap = require('../services/sap.service');
const { execute } = require('../services/assistantAccountFinance.service');
const id = 'assistant_account_billing_collections';
const options = { fechaDesde: '2026-09-01', fechaHasta: '2026-09-30', limit: 100 };
let accounts, invoices, payments, request;
const invoice = (key, account, extra = {}) => ({ DocEntry: key, DocNum: key + 100, U_PCNum: account, DocumentLines: [{ U_PCNum: account }], Cancelled: 'tNO', DocCurrency: 'MXN', DocTotal: 100, PaidToDate: 0, ...extra });
const payment = (key, document, amount, extra = {}) => ({ DocEntry: key, DocNum: key + 200, Cancelled: 'tNO', PaymentInvoices: [{ DocEntry: document, InvoiceType: 'it_Invoice', SumApplied: amount }], ...extra });
beforeEach(() => {
  jest.clearAllMocks();
  accounts = [{ PCNum: 1, PatientName: 'Paciente ficticio', AttentionDate: new Date(2026, 8, 1, 8), AccountStatus: 'CL', AccountBalance: 0 }];
  invoices = []; payments = [];
  request = { input: jest.fn().mockReturnThis(), query: jest.fn().mockImplementation(async () => ({ recordset: accounts })) };
  connectRemoteDB.mockResolvedValue({ request: () => request });
  sap.post.mockResolvedValue({ data: { LocalCurrency: 'MXN' } });
  sap.get.mockImplementation(async path => {
    const url = new URL(path, 'https://test.invalid');
    const filter = url.searchParams.get('$filter');
    const numbers = field => [...filter.matchAll(new RegExp(`${field} eq (\\d+)`, 'g'))].map(match => Number(match[1]));
    let value;
    if (url.pathname === '/Invoices') value = filter.includes('U_PCNum')
      ? invoices.filter(doc => numbers('U_PCNum').includes(doc.U_PCNum)).map(doc => ({ DocEntry: doc.DocEntry }))
      : invoices.filter(doc => numbers('DocEntry').includes(doc.DocEntry));
    else if (url.pathname.startsWith('/$crossjoin(Invoices,')) value = invoices.filter(doc => doc.DocumentLines.some(line => numbers('U_PCNum').includes(line.U_PCNum))).map(doc => ({ Invoices: { DocEntry: doc.DocEntry } }));
    else if (url.pathname.startsWith('/$crossjoin(IncomingPayments,')) value = payments.filter(doc => doc.PaymentInvoices.some(line => line.InvoiceType === 'it_Invoice' && numbers('DocEntry').includes(line.DocEntry))).map(doc => ({ IncomingPayments: { DocEntry: doc.DocEntry } }));
    else if (url.pathname === '/IncomingPayments') value = payments.filter(doc => numbers('DocEntry').includes(doc.DocEntry));
    else throw new Error(`Unexpected test endpoint ${url.pathname}`);
    return { data: { value } };
  });
});
test('a closed account without invoices is not paid, and no payment or company query is performed', async () => {
  const result = await execute(id, options);
  expect(result.rows[0]).toMatchObject({ AccountStatus: 'Cerrada', InvoiceCount: 0, CollectionStatus: 'Sin facturación vigente' });
  expect(sap.post).not.toHaveBeenCalled();
  expect(sap.get.mock.calls.some(([path]) => path.includes('IncomingPayments'))).toBe(false);
});

test('verified medical discharge and account closure dates remain separate from payment and unknown dates stay unknown', async () => {
  accounts[0].MedicalDischargeDate = new Date(2026, 8, 2, 10, 20);
  accounts[0].ClosedOn = new Date(2026, 8, 3, 12, 30);
  const result = await execute(id, options);
  expect(result.rows[0]).toMatchObject({ MedicalDischargeDate: '2026-09-02T10:20:00', ClosedOn: '2026-09-03T12:30:00',
    AccountStatus: 'Cerrada', CollectionStatus: 'Sin facturación vigente' });
  expect(request.query.mock.calls[0][0]).toContain('pc.MedicalDischargeDate,pc.ClosedOn');
  accounts[0].MedicalDischargeDate = null; accounts[0].ClosedOn = null;
  expect((await execute(id, options)).rows[0]).toMatchObject({ MedicalDischargeDate: null, ClosedOn: null, AccountStatus: 'Cerrada' });
});

test.each(['PCNum', 'PTNum'])('an exact %s lookup is parameterized before SAP and works without dates', async field => {
  accounts[0].PTNum = 42;
  const value = field === 'PCNum' ? 1 : 42;
  const result = await execute(id, { pointLookup: { field, value }, limit: 1 });
  expect(result.rows).toHaveLength(1);
  expect(request.input).toHaveBeenCalledWith('pointLookupValue', 'int', value);
  expect(request.input.mock.calls.some(([key]) => key === 'fechaDesde')).toBe(false);
  expect(request.query.mock.calls[0][0]).toContain(`WHERE pc.${field}=@pointLookupValue`);
  expect(sap.get.mock.calls.every(([path]) => new URL(path, 'https://test.invalid').searchParams.get('$filter').includes('U_PCNum eq 1'))).toBe(true);
});

test('an exact identifier preserves an existing date range and refuses unrelated source rows before querying SAP', async () => {
  await execute(id, { ...options, pointLookup: { field: 'PCNum', value: 1 } });
  expect(request.query.mock.calls[0][0]).toContain('pc.[Date]>=CAST(@fechaDesde AS date)');
  expect(request.query.mock.calls[0][0]).toContain('pc.PCNum=@pointLookupValue');
  sap.get.mockClear();
  await expect(execute(id, { pointLookup: { field: 'PCNum', value: 2 } })).rejects.toThrow(/fuera del identificador/);
  expect(sap.get).not.toHaveBeenCalled();
});

test.each([{ field: 'PatientName', value: 1 }, { field: 'PCNum', value: true }, { field: 'PCNum', value: '1 OR 1=1' }, { field: 'PCNum', value: 2147483648 }])('invalid point scope cannot cause a broad read', async pointLookup => {
  await expect(execute(id, { pointLookup })).rejects.toThrow(/identificador/);
  expect(connectRemoteDB).not.toHaveBeenCalled();
});
test.each([
  [0, [], 'Sin cobros recibidos registrados'],
  [100, [], 'Liquidada con otras aplicaciones; sin cobro recibido'],
  [30, [payment(4, 2, 30)], 'Cobro parcial registrado'],
  [100, [payment(4, 2, 100)], 'Facturas relacionadas pagadas mediante cobros SAP'],
  [0, [payment(4, 2, 100)], 'Cobro parcial registrado'],
  [100, [payment(4, 2, 100, { Cancelled: 'tYES' })], 'Liquidada con otras aplicaciones; sin cobro recibido'],
])('classifies only linked active cash evidence: PaidToDate=%s', async (paidToDate, receipts, expected) => {
  invoices = [invoice(2, 1, { PaidToDate: paidToDate })]; payments = receipts;
  const result = await execute(id, options);
  expect(result.rows[0]).toMatchObject({ InvoiceCount: 1, CollectionStatus: expected });
});
test('finds line-only account references and refuses to assign a shared invoice payment to each account', async () => {
  invoices = [invoice(2, null, { DocumentLines: [{ U_PCNum: 1 }, { U_PCNum: 5 }], PaidToDate: 100 })];
  payments = [payment(4, 2, 100)];
  const result = await execute(id, options);
  expect(result.rows[0]).toMatchObject({ InvoiceFolios: '102', CollectionStatus: 'Factura compartida; revisar cobro por cuenta' });
  expect(result.rows[0].Evidence).toMatch(/no se asigna completo/);
});
test.each([
  [{ DocCurrency: 'USD', PaidToDate: 100 }, {}],
  [{ Cancelled: null }, {}],
  [{ PaidToDate: 100 }, { Cancelled: null }],
  [{ PaidToDate: 100 }, { PaymentInvoices: [{ DocEntry: 2, InvoiceType: 'it_Invoice', SumApplied: 100, TotalDiscount: 5 }] }],
])('missing or incomparable evidence remains unverified', async (document, receipt) => {
  invoices = [invoice(2, 1, document)]; payments = [payment(4, 2, 100, receipt)];
  const result = await execute(id, options);
  expect(result.rows[0].CollectionStatus).toBe('Cobro por verificar');
});
test('canceled invoices and payment applications to another document type do not count as receipts', async () => {
  invoices = [invoice(2, 1), invoice(3, 1, { Cancelled: 'tYES' })];
  payments = [payment(4, 2, 100, { PaymentInvoices: [{ DocEntry: 2, InvoiceType: 'it_PurchaseInvoice', SumApplied: 100 }] })];
  const result = await execute(id, options);
  expect(result.rows[0]).toMatchObject({ InvoiceCount: 1, PaymentFolios: '', CollectionStatus: 'Sin cobros recibidos registrados' });
});
test('search, financial filters, and bounds remain explicit', async () => {
  invoices = [invoice(2, 1, { PaidToDate: 100 })]; payments = [payment(4, 2, 100)];
  expect((await execute(id, { ...options, estatusDoc: 'COLLECTED', busqueda: '102' })).rows).toHaveLength(1);
  expect((await execute(id, { ...options, estatusDoc: 'UNPAID' })).rows).toHaveLength(0);
  accounts = Array.from({ length: 201 }, (_, index) => ({ ...accounts[0], PCNum: index + 1 }));
  const bounded = await execute(id, { ...options, limit: 10000 });
  expect(bounded.rows).toHaveLength(201); expect(bounded.truncated).toBe(false);
  expect(request.input).toHaveBeenCalledWith('rowLimit', 'int', 10001);
  expect(request.query.mock.calls[0][0]).toContain('TOP (@rowLimit)');
  expect(request.input).toHaveBeenCalledWith('fechaDesde', undefined, '2026-09-01');
});
test('refuses invalid dates, repeated continuations, incomplete documents and unsafe continuations', async () => {
  await expect(execute(id, { ...options, fechaDesde: '2026-02-30' })).rejects.toThrow(/período/);
  sap.get.mockResolvedValue({ data: { value: [], 'odata.nextLink': 'Invoices?$skip=1' } });
  await expect(execute(id, options)).rejects.toThrow(/completar/);
  sap.get.mockResolvedValue({ data: { value: [], 'odata.nextLink': 'BusinessPartners?$skip=1' } });
  await expect(execute(id, options)).rejects.toThrow(/fuera de la consulta/);
});
test('large folios and many document links stay within the SAP query length limit', async () => {
  accounts=Array.from({length:61},(_,index)=>({...accounts[0],PCNum:2147480000+index}));
  invoices=accounts.map((account,index)=>invoice(2147480200+index,account.PCNum,{PaidToDate:100}));
  payments=invoices.map((doc,index)=>payment(2147480300+index,doc.DocEntry,100));
  const result=await execute(id,{...options,limit:1000});
  expect(result.rows).toHaveLength(61);
  expect(sap.get.mock.calls.every(([path])=>path.split('?')[1].length<2000)).toBe(true);
  expect(result.rows[0]).toMatchObject({InvoiceTotal:100,InvoiceBalance:0,ReceivedAppliedAmount:100,Currency:'MXN'});
});
