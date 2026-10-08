'use strict';

jest.mock('../services/sap.service', () => ({ get: jest.fn(), post: jest.fn(), fetchAllPages: jest.fn() }));
jest.mock('../config/sap.config', () => ({ baseUrl: 'https://sap.example/b1s/v2' }));
const sap = require('../services/sap.service');
const service = require('../services/sapAccountReview.service');
const { readPages, readOrPages, documentStatus, ledgerStatus, accountNumber, SQL_QUERIES } = service._test;
const invoice = overrides => ({ DocEntry: 10, DocNum: 100, U_PCNum: 123, U_PTName: 'ANA PÉREZ',
  CardCode: 'C01', DocumentStatus: 'bost_Close', Cancelled: 'tNO', CancelStatus: 'csNo',
  TransNum: 1000, DocTotal: 100, PaidToDate: 100, DocumentLines: [], DocumentReferences: [], DownPaymentsToDraw: [], ...overrides });
const order = overrides => ({ ...invoice(), DocEntry: 20, DocNum: 200, TransNum: 0, ...overrides });
const closedLedger = overrides => ({ TransId: 1000, Line_ID: 0, ShortName: 'C01', TransType: 13, CreatedBy: 10, Closed: 'Y',
  BalDueDeb: 0, BalDueCred: 0, BalFcDeb: 0, BalFcCred: 0, BalScDeb: 0, BalScCred: 0, ...overrides });

function source(fixtures = {}) {
  const docs = { ...fixtures, JournalEntries: [...(fixtures.JournalEntries || [])] };
  const defaultLedger = [];
  for (const [entity, rows] of Object.entries(fixtures)) {
    if (!Array.isArray(rows) || entity === 'ledger') continue;
    for (const doc of rows) {
      if (doc.TransNum > 0 && !docs.JournalEntries.some(journal => journal.JdtNum === doc.TransNum)) {
        docs.JournalEntries.push({ JdtNum: doc.TransNum, OriginalJournal: 'ttARInvoice', Original: doc.DocEntry,
          JournalEntryLines: [{ ShortName: doc.CardCode, AccountCode: '111' }] });
        defaultLedger.push(closedLedger({ TransId: doc.TransNum, ShortName: doc.CardCode, CreatedBy: doc.DocEntry }));
      }
    }
  }
  sap.get.mockImplementation(async raw => {
    const decoded = decodeURIComponent(raw);
    const sql = decoded.match(/^\/SQLQueries\('([^']+)'\)(\/List)?/);
    if (sql) {
      if (!sql[2]) return { data: { SqlCode: sql[1], SqlText: SQL_QUERIES[sql[1]]?.replace(/T0\.(\w+)/g, 'T0.[$1]') } };
      const type = decoded.match(/objectType='(\d+)'/)?.[1];
      const entry = decoded.match(/objectEntry='?(\d+)'?/)?.[1];
      const card = decoded.match(/cardCode='([^']+)'/)?.[1];
      const transId = decoded.match(/transId='?(\d+)'?/)?.[1];
      const account = decoded.match(/account='?(\d+)'?/)?.[1];
      if (account) {
        const entity = service._test.DOCUMENTS.find(def => def.accountQuery === sql[1])?.entity;
        return { data: { value: (docs[entity] || []).filter(row => Number(row.U_PCNum) === Number(account) || row.DocumentLines?.some(line => Number(line.U_PCNum) === Number(account))).map(({ DocEntry, DocNum, U_PCNum, U_PTName }) => ({ DocEntry, DocNum, U_PCNum, U_PTName })) } };
      }
      if (sql[1] === 'sq_bi_reopen_recon_v2') return { data: { value: (docs.InternalReconciliations || []).filter(row => row.InternalReconciliationRows?.some(line => String(line.SrcObjTyp) === type && String(line.SrcObjAbs) === entry)).map(row => ({ ReconNum: row.ReconNum })) } };
      const ledger = fixtures.ledger || defaultLedger;
      return { data: { value: ledger.filter(row => row.ShortName === card && (transId ? String(row.TransId) === transId : String(row.TransType) === type && String(row.CreatedBy) === entry)) } };
    }
    const cross = decoded.match(/^\/\$crossjoin\((\w+),\1\/(\w+)\)/);
    if (cross) {
      const [, entity, collection] = cross;
      const rows = docs[entity] || [];
      let matches = [];
      if (decoded.includes('/U_PCNum eq 123')) matches = rows.filter(doc => doc.DocumentLines?.some(line => Number(line.U_PCNum) === 123));
      else if (collection === 'DocumentLines') {
        matches = rows.filter(doc => doc.DocumentLines?.some(line => decoded.includes(`/BaseType eq ${line.BaseType} and ${entity}/DocumentLines/BaseEntry eq ${line.BaseEntry}`)));
      } else if (collection === 'DocumentReferences') {
        matches = rows.filter(doc => doc.DocumentReferences?.some(ref => decoded.includes(`/RefObjType eq '${ref.RefObjType}' and ${entity}/DocumentReferences/RefDocEntr eq ${ref.RefDocEntr}`)));
      } else if (collection === 'StockTransferLines') {
        matches = rows.filter(doc => doc.StockTransferLines?.some(line => decoded.includes(`/BaseType eq '${line.BaseType}' and ${entity}/StockTransferLines/BaseEntry eq ${line.BaseEntry}`)));
      } else if (collection === 'PaymentDocumentReferencesCollection') {
        matches = rows.filter(doc => doc.PaymentDocumentReferencesCollection?.some(ref => decoded.includes(`/ReferencedObjectType eq '${ref.ReferencedObjectType}' and ${entity}/PaymentDocumentReferencesCollection/ReferencedDocEntry eq ${ref.ReferencedDocEntry}`)));
      } else if (collection === 'PaymentInvoices') {
        matches = rows.filter(doc => doc.PaymentInvoices?.some(ref => decoded.includes(`/InvoiceType eq '${ref.InvoiceType}' and ${entity}/PaymentInvoices/DocEntry eq ${ref.DocEntry}`)));
      }
      return { data: { value: matches.map(doc => ({ [entity]: { DocEntry: doc.DocEntry } })) } };
    }
    const single = decoded.match(/^\/(\w+)\((\d+)\)$/);
    if (single) {
      const doc = (docs[single[1]] || []).find(row => Number(row.DocEntry ?? row.JdtNum ?? row.ReconNum) === Number(single[2]));
      if (!doc) throw new Error('Missing linked document');
      return { data: doc };
    }
    const entity = decoded.match(/^\/(\w+)/)?.[1];
    let rows = docs[entity] || [];
    if (decoded.includes('U_PCNum eq 123')) rows = rows.filter(doc => Number(doc.U_PCNum) === 123);
    else if (decoded.includes('contains(U_PTName,')) rows = rows.filter(doc => doc.U_PTName);
    else if (decoded.includes('BaseType eq ')) rows = rows.filter(doc =>
      (doc.BaseType != null && decoded.includes(`BaseType eq ${doc.BaseType} and BaseEntry eq ${doc.BaseEntry}`)) ||
      (doc.RelatedType != null && decoded.includes(`RelatedType eq ${doc.RelatedType} and RelatedEntry eq ${doc.RelatedEntry}`)));
    else if (decoded.includes('RelatedType eq ')) rows = rows.filter(doc => doc.RelatedType != null && decoded.includes(`RelatedType eq ${doc.RelatedType} and RelatedEntry eq ${doc.RelatedEntry}`));
    else if (decoded.includes('DocEntry eq ')) rows = rows.filter(doc => decoded.includes(`DocEntry eq ${doc.DocEntry}`));
    return { data: { value: rows } };
  });
}

beforeEach(() => { jest.clearAllMocks(); source(); });

test('an account without invoices returns a definitive block without scanning the full graph', async () => {
  source({ Orders: [order({ DocumentStatus: 'bost_Open' })] });
  const result = await service.review('123');
  expect(result).toMatchObject({ eligible: false, status: 'blocked', complete: false, mapState: 'not_requested',
    patientName: 'ANA PÉREZ', invoices: [], edges: [] });
  expect(result.nodes).toEqual([expect.objectContaining({ id: 'Orders:20', status: 'open' })]);
  expect(result.reasons).toEqual(['La cuenta no tiene una factura localizada en SAP.']);
  expect(sap.get.mock.calls).toHaveLength(5);
  expect(sap.get.mock.calls.every(([url]) => !url.includes('$crossjoin') && !url.includes('recon') && !url.includes('balance'))).toBe(true);
  expect(sap.get.mock.calls.slice(2).every(([, , options]) => options.timeoutMs <= 10000)).toBe(true);
});

test('requesting the full map preserves relationship access even when there is no own invoice', async () => {
  source({ Orders: [order()] });
  const result = await service.review('123', { fullMap: true });
  expect(result).toMatchObject({ eligible: false, status: 'blocked', complete: true, mapState: 'complete', invoices: [] });
  expect(sap.get.mock.calls.some(([url]) => url.includes('$crossjoin'))).toBe(true);
});

test('a failed invoice lookup cannot become a definitive no-invoice shortcut', async () => {
  source({ Orders: [order()] });
  const original = sap.get.getMockImplementation();
  sap.get.mockImplementation((url, headers) => url.includes('sq_bi_reopen_invoice_keys_v1') && url.includes('/List')
    ? Promise.reject(new Error('invoice keys failed')) : original(url, headers));
  await expect(service.review('123')).rejects.toMatchObject({ status: 502 });
  expect(sap.get.mock.calls.some(([url]) => url.includes('sq_bi_reopen_keys_17_v1'))).toBe(false);
});

test('eligibility requires literally closed current invoices and a fully closed graph', async () => {
  source({ Invoices: [invoice({ DocumentLines: [{ BaseType: 17, BaseEntry: 20 }] })], Orders: [order()] });
  const result = await service.review('123');
  expect(result).toMatchObject({ account: '123', patientName: 'ANA PÉREZ', complete: true, eligible: true, status: 'eligible' });
  expect(result.nodes).toHaveLength(3);
  expect(result.nodes.find(node => node.id === 'JournalEntries:1000')).toMatchObject({ status: 'settled', statusBasis: 'ledger' });
  expect(result.edges).toContainEqual({ source: 'Orders:20', target: 'Invoices:10', label: 'Documento base' });
  expect(sap.fetchAllPages).not.toHaveBeenCalled();
  expect(sap.post).not.toHaveBeenCalled();
});

test('an open successor without an account UDF still blocks reopening through reverse base links', async () => {
  source({ Invoices: [invoice()], CreditNotes: [invoice({ DocEntry: 40, U_PCNum: null,
    DocumentStatus: 'bost_Open', DocumentLines: [{ BaseType: 13, BaseEntry: 10 }] })] });
  const result = await service.review('123');
  expect(result).toMatchObject({ complete: true, eligible: false, status: 'blocked' });
  expect(result.openDocuments.map(row => row.id)).toEqual(['CreditNotes:40']);
  expect(result.edges).toContainEqual({ source: 'Invoices:10', target: 'CreditNotes:40', label: 'Documento base' });
});

test('a zero balance or unexpected status never counts as closed', async () => {
  source({ Invoices: [invoice({ DocumentStatus: 'paid', DocTotal: 0, PaidToDate: 0 })] });
  expect(await service.review('123')).toMatchObject({ eligible: false, status: 'unverified' });
  expect(documentStatus(invoice({ DocumentStatus: null }))).toBe('unknown');
  expect(documentStatus(invoice({ DocStatus: 'O' }))).toBe('unknown');
  expect(documentStatus(invoice({ Cancelled: undefined, CancelStatus: undefined }))).toBe('unknown');
  expect(documentStatus(invoice({ DocumentStatus: undefined, DocStatus: 'C' }))).toBe('closed');
});

test('a cancelled invoice alone cannot satisfy the current invoice requirement', async () => {
  source({ Invoices: [invoice({ Cancelled: 'tYES', CancelStatus: 'csYes' })] });
  const result = await service.review('123');
  expect(result).toMatchObject({ complete: true, eligible: false, status: 'blocked' });
  expect(result.invoices[0].status).toBe('cancelled');
});

test('a closed related invoice from another account cannot replace a cancelled own invoice', async () => {
  source({ Invoices: [invoice({ Cancelled: 'tYES', CancelStatus: 'csYes',
    DocumentReferences: [{ RefObjType: 'rot_SalesInvoice', RefDocEntr: 11 }] }),
  invoice({ DocEntry: 11, U_PCNum: 456, TransNum: 1001 })] });
  const result = await service.review('123');
  expect(result).toMatchObject({ complete: true, eligible: false, status: 'blocked' });
  expect(result.invoices).toEqual([expect.objectContaining({ id: 'Invoices:10', status: 'cancelled' })]);
  expect(result.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'Invoices:11', status: 'closed' })]));
});

test('line-level account folios find consolidated invoices with an empty header folio', async () => {
  source({ Invoices: [invoice({ U_PCNum: null, DocumentLines: [{ U_PCNum: 123, BaseType: -1, BaseEntry: null }] })] });
  expect(await service.search({ mode: 'account', q: '00123' })).toEqual({ accounts: [{ account: '123', patientName: 'Sin nombre de paciente en SAP', invoiceCount: 1 }], truncated: false });
  expect(await service.review('123')).toMatchObject({ eligible: true, complete: true });
  expect(sap.get.mock.calls.some(([url]) => decodeURIComponent(url).includes('account=123'))).toBe(true);
  expect(sap.get.mock.calls.some(([url]) => decodeURIComponent(url).includes("U_PCNum eq '123'"))).toBe(false);
});

test('patient queries use the patient UDF with escaped apostrophes and case-insensitive SAP header', async () => {
  source({ Invoices: [invoice()] });
  await service.search({ mode: 'patient', q: "o'connor" });
  const calls = sap.get.mock.calls;
  expect(calls.some(([url, headers]) => decodeURIComponent(url).includes("contains(U_PTName,'o''connor')") && headers['B1S-CaseInsensitive'] === 'true')).toBe(true);
  expect(calls.every(([url]) => !url.includes('U_PRName'))).toBe(true);
});

test('invalid account input is rejected before any SAP request', async () => {
  for (const value of ['1 or 1 eq 1', "123'", '-1', '0', '2147483648', '123/Invoices']) {
    await expect(service.review(value)).rejects.toMatchObject({ status: 400 });
  }
  expect(sap.get).not.toHaveBeenCalled();
  expect(accountNumber('00123')).toBe('123');
});

test('unknown referenced types and missing linked documents fail closed', async () => {
  source({ Invoices: [invoice({ DocumentReferences: [{ RefObjType: 'rot_Unsupported', RefDocEntr: 44 }] })] });
  expect(await service.review('123')).toMatchObject({ complete: false, eligible: false, status: 'unverified' });
  source({ Invoices: [invoice({ DocumentLines: [{ BaseType: 17, BaseEntry: 999 }] })] });
  const result = await service.review('123');
  expect(result).toMatchObject({ complete: false, eligible: false, status: 'unverified' });
  expect(result.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'Orders:999', status: 'unknown' })]));
});

test('same customer never substitutes for a real document link', async () => {
  source({ Invoices: [invoice()], IncomingPayments: [{ DocEntry: 88, DocNum: 88, CardCode: 'C01',
    Cancelled: 'tNO', CancelStatus: 'csNo', PaymentInvoices: [{ InvoiceType: 'it_Invoice', DocEntry: 999 }], PaymentDocumentReferencesCollection: [] }] });
  const result = await service.review('123');
  expect(result.nodes.map(row => row.id)).toEqual(['Invoices:10', 'JournalEntries:1000']);
  expect(result.eligible).toBe(true);
});

test('a payment bridging to another account brings its open invoice into the map', async () => {
  source({ Invoices: [invoice(), invoice({ DocEntry: 11, U_PCNum: 456, DocumentStatus: 'bost_Open' })],
    IncomingPayments: [{ DocEntry: 88, CardCode: 'C01', Cancelled: 'tNO', CancelStatus: 'csNo',
      PaymentInvoices: [{ InvoiceType: 'it_Invoice', DocEntry: 10 }, { InvoiceType: 'it_Invoice', DocEntry: 11 }], PaymentDocumentReferencesCollection: [] }] });
  const result = await service.review('123');
  expect(result.eligible).toBe(false);
  expect(result.openDocuments.map(row => row.id)).toEqual(['Invoices:11']);
  expect(result.invoices.map(row => row.id)).toEqual(['Invoices:10']);
  expect(result.nodes.find(row => row.id === 'IncomingPayments:88').status).toBe('unknown');
});

test('both OData pagination formats are followed fresh and page failures are not returned as partial success', async () => {
  sap.get.mockResolvedValueOnce({ data: { value: [{ DocEntry: 1 }], 'odata.nextLink': 'Invoices?$skip=1' } })
    .mockResolvedValueOnce({ data: { value: [{ DocEntry: 2 }], '@odata.nextLink': 'https://sap.example/b1s/v2/Invoices?$skip=2' } })
    .mockResolvedValueOnce({ data: { value: [{ DocEntry: 3 }] } });
  expect((await readPages('/Invoices')).rows).toHaveLength(3);
  expect(sap.get.mock.calls.map(([url]) => url)).toEqual(['/Invoices', '/Invoices?$skip=1', '/Invoices?$skip=2']);
  sap.get.mockReset().mockResolvedValueOnce({ data: { value: [invoice()], '@odata.nextLink': 'Invoices?$skip=1' } }).mockRejectedValueOnce(new Error('network failed'));
  await expect(readPages('/Invoices')).rejects.toThrow('network failed');
});

test('invalid pages, page caps, cycles and external pagination cannot prove an empty graph', async () => {
  sap.get.mockResolvedValue({ data: { value: [], '@odata.nextLink': 'Invoices?$skip=1' } });
  await expect(readPages('/Invoices', { maxPages: 1 })).rejects.toThrow('paginación');
  await expect(readPages('/Invoices')).rejects.toThrow('paginación');
  sap.get.mockResolvedValue({ data: {} });
  await expect(readPages('/Invoices')).rejects.toThrow('incompleta');
  sap.get.mockResolvedValue({ data: { value: [], '@odata.nextLink': 'https://attacker.example/b1s/v2/Invoices' } });
  await expect(readPages('/Invoices')).rejects.toThrow('fuera');
});

test('large reverse filters are fully split below the SAP URI limit and duplicate keys are deduplicated', async () => {
  const predicates = Array.from({ length: 80 }, (_, index) => `(DocEntry eq ${100000 + index} and CardCode eq 'INSURER')`);
  sap.get.mockResolvedValue({ data: { value: [{ DocEntry: 10 }, { DocEntry: 20 }] } });
  expect((await readOrPages('Invoices', { $select: 'DocEntry' }, predicates)).rows).toEqual([{ DocEntry: 10 }, { DocEntry: 20 }]);
  expect(sap.get.mock.calls.length).toBeGreaterThan(1);
  expect(sap.get.mock.calls.every(([url]) => url.length <= 1800)).toBe(true);
  for (const predicate of predicates) expect(sap.get.mock.calls.some(([url]) => decodeURIComponent(url).includes(predicate))).toBe(true);
});

test('one failed reverse-filter fragment rejects the entire verification instead of returning the first fragment', async () => {
  const predicates = Array.from({ length: 80 }, (_, index) => `(DocEntry eq ${100000 + index} and CardCode eq 'INSURER')`);
  sap.get.mockResolvedValueOnce({ data: { value: [{ DocEntry: 10 }] } }).mockRejectedValueOnce(new Error('second fragment failed'));
  await expect(readOrPages('Invoices', { $select: 'DocEntry' }, predicates)).rejects.toThrow('second fragment failed');
  expect(sap.get).toHaveBeenCalledTimes(2);
});

test('a rejected reverse-line query preserves known invoices but marks the map incomplete', async () => {
  source({ Invoices: [invoice()] });
  const implementation = sap.get.getMockImplementation();
  sap.get.mockImplementation((url, headers) => decodeURIComponent(url).includes('$crossjoin(Invoices,Invoices/DocumentLines)') ? Promise.reject(new Error('unsupported')) : implementation(url, headers));
  const result = await service.review('123');
  expect(result).toMatchObject({ complete: false, eligible: false, status: 'unverified' });
  expect(result.invoices).toHaveLength(1);
});

test('all six ledger residuals and the actual closure flag must confirm settlement', () => {
  expect(ledgerStatus([closedLedger()])).toBe('settled');
  for (const field of ['BalDueDeb', 'BalDueCred', 'BalFcDeb', 'BalFcCred', 'BalScDeb', 'BalScCred']) {
    expect(ledgerStatus([closedLedger({ [field]: 0.000001 })])).toBe('open');
    expect(ledgerStatus([closedLedger({ [field]: null })])).toBe('unknown');
  }
  expect(ledgerStatus([closedLedger({ Closed: 'N' })])).toBe('open');
  expect(ledgerStatus([])).toBe('unknown');
});

test('a system-currency-only accounting residual blocks a literally closed invoice', async () => {
  source({ Invoices: [invoice()], ledger: [closedLedger({ BalScCred: 0.25 })] });
  const result = await service.review('123');
  expect(result).toMatchObject({ complete: true, eligible: false, status: 'blocked' });
  expect(result.invoices[0].status).toBe('closed');
  expect(result.openDocuments).toEqual([expect.objectContaining({ id: 'JournalEntries:1000', statusBasis: 'ledger' })]);
});

test('scoped reconciliations discover payments on account and preserve verified financial settlement', async () => {
  source({ Invoices: [invoice()], IncomingPayments: [{ DocEntry: 88, CardCode: 'C01', Cancelled: 'tNO', CancelStatus: 'csNo', PaymentInvoices: [], PaymentDocumentReferencesCollection: [] }],
    InternalReconciliations: [{ ReconNum: 900, CancelAbs: 0, CardOrAccount: 'coaCard', InternalReconciliationRows: [
      { ShortName: 'C01', SrcObjTyp: '13', SrcObjAbs: 10 }, { ShortName: 'C01', SrcObjTyp: '24', SrcObjAbs: 88 },
    ] }], JournalEntries: [{ JdtNum: 2000, OriginalJournal: 'ttReceipt', Original: 88, JournalEntryLines: [{ ShortName: 'C01', AccountCode: '111' }] }],
    ledger: [closedLedger(), closedLedger({ TransId: 2000, TransType: 24, CreatedBy: 88 })] });
  const result = await service.review('123');
  expect(result).toMatchObject({ complete: true, eligible: true, status: 'eligible' });
  expect(result.nodes.find(node => node.id === 'IncomingPayments:88')).toMatchObject({ status: 'settled', statusBasis: 'ledger' });
  expect(result.nodes.find(node => node.id === 'InternalReconciliations:900')).toMatchObject({ status: 'settled', statusBasis: 'reconciliation-event' });
  expect(result.edges).toContainEqual({ source: 'IncomingPayments:88', target: 'JournalEntries:2000', label: 'Asiento contable' });
  expect(sap.get.mock.calls.some(([url]) => url.includes('sq_bi_reopen_recon_v2'))).toBe(true);
});

test('a manual journal with another patient BP cannot hide its open residuals', async () => {
  source({ Invoices: [invoice()], JournalEntries: [{ JdtNum: 1000, JournalEntryLines: [
    { ShortName: 'C01', AccountCode: '111' }, { ShortName: 'C02', AccountCode: '111' }, { ShortName: '401', AccountCode: '401' },
  ] }], ledger: [closedLedger(), closedLedger({ ShortName: 'C02', Line_ID: 1, BalFcDeb: 12 })] });
  const result = await service.review('123');
  expect(result.eligible).toBe(false);
  expect(result.openDocuments[0].id).toBe('JournalEntries:1000');
  expect(sap.get.mock.calls.some(([url]) => decodeURIComponent(url).includes("transId=1000&cardCode='C02'"))).toBe(true);
  expect(sap.get.mock.calls.some(([url]) => decodeURIComponent(url).includes("cardCode='401'"))).toBe(false);
});

test('missing ledger rows for an actual second BP in a journal prevent settlement', async () => {
  source({ Invoices: [invoice()], JournalEntries: [{ JdtNum: 1000, JournalEntryLines: [
    { ShortName: 'C01', AccountCode: '111', Line_ID: 0 }, { ShortName: 'C02', AccountCode: '111', Line_ID: 1 },
  ] }], ledger: [closedLedger()] });
  expect(await service.review('123')).toMatchObject({ eligible: false, status: 'unverified' });
});

test('a closed transfer request cannot hide its open target transfer', async () => {
  source({ Invoices: [invoice({ DocumentReferences: [{ RefObjType: 'rot_InventoryTransferRequest', RefDocEntr: 77 }] })],
    InventoryTransferRequests: [{ DocEntry: 77, DocumentStatus: 'bost_Close', U_PCNum: null, StockTransferLines: [], DocumentReferences: [] }],
    StockTransfers: [{ DocEntry: 88, DocumentStatus: 'bost_Open', U_PCNum: null,
      StockTransferLines: [{ BaseType: 'InventoryTransferRequest', BaseEntry: 77 }], DocumentReferences: [] }] });
  const result = await service.review('123');
  expect(result).toMatchObject({ complete: true, eligible: false });
  expect(result.openDocuments[0].id).toBe('StockTransfers:88');
});

test('supported header payment associations discover an open invoice without any line base link', async () => {
  source({ Invoices: [invoice(), invoice({ DocEntry: 11, U_PCNum: null, TransNum: 1001, DocumentStatus: 'bost_Open', RelatedType: 24, RelatedEntry: 88 })],
    IncomingPayments: [{ DocEntry: 88, CardCode: 'C01', Cancelled: 'tNO', CancelStatus: 'csNo',
      PaymentInvoices: [{ InvoiceType: 'it_Invoice', DocEntry: 10 }], PaymentDocumentReferencesCollection: [] }] });
  const result = await service.review('123');
  expect(result.eligible).toBe(false);
  expect(result.openDocuments).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'Invoices:11' })]));
  expect(sap.get.mock.calls.some(([url]) => decodeURIComponent(url).includes('/Orders?') && decodeURIComponent(url).includes('BaseType eq'))).toBe(false);
});

test('conflicting cancellation flags and missing invoice accounting identity fail closed', async () => {
  expect(documentStatus(invoice({ Cancelled: 'tNO', CancelStatus: 'csYes' }))).toBe('unknown');
  expect(documentStatus(invoice({ Cancelled: 'tYES', CancelStatus: 'csYes', DocumentStatus: 'bost_Open' }))).toBe('unknown');
  source({ Invoices: [invoice({ TransNum: undefined })] });
  expect(await service.review('123')).toMatchObject({ complete: false, eligible: false, status: 'unverified' });
});

test('a mixed-account consolidated invoice never overrides the selected account patient name', async () => {
  source({ Invoices: [invoice({ U_PCNum: 456, U_PTName: 'PACIENTE OTRA CUENTA', DocumentLines: [{ U_PCNum: 123 }, { U_PCNum: 456 }] })],
    Orders: [order({ U_PTName: 'PACIENTE CORRECTO' })] });
  expect(await service.search({ mode: 'account', q: '123' })).toMatchObject({ accounts: [{ account: '123', patientName: 'PACIENTE CORRECTO', invoiceCount: 1 }] });
  expect(await service.review('123')).toMatchObject({ patientName: 'PACIENTE CORRECTO' });
});

test('missing or modified SQL definitions cannot masquerade as empty ledger/reconciliation results', async () => {
  source({ Invoices: [invoice()] });
  const original = sap.get.getMockImplementation();
  sap.get.mockImplementation((url, headers) => url.startsWith('/SQLQueries(') && !url.includes('/List') ? Promise.resolve({ data: { SqlCode: 'unexpected', SqlText: 'SELECT 1' } }) : original(url, headers));
  await expect(service.review('123')).rejects.toMatchObject({ status: 502 });
  expect(sap.post).not.toHaveBeenCalled();
});

test('a SQL table allowlist rejection uses both native account folios instead of silently dropping coverage', async () => {
  source({ Invoices: [invoice()] });
  const original = sap.get.getMockImplementation();
  sap.get.mockImplementation((url, headers) => url.includes("SQLQueries('sq_bi_reopen_keys_59_v1')") ? Promise.resolve({ data: { value: [] } }) : original(url, headers));
  sap.post.mockRejectedValue(Object.assign(new Error('Table not accessible'), { status: 400, code: '702' }));
  const result = await service.review('123');
  expect(result).toMatchObject({ complete: true, eligible: true });
  expect(sap.get.mock.calls.some(([url]) => decodeURIComponent(url).includes('/InventoryGenEntries?$select=DocEntry&$filter=U_PCNum eq 123'))).toBe(true);
  expect(sap.get.mock.calls.some(([url]) => decodeURIComponent(url).includes('$crossjoin(InventoryGenEntries,InventoryGenEntries/DocumentLines)'))).toBe(true);
});

test('a stalled SAP collection has a bounded verification deadline', async () => {
  jest.useFakeTimers();
  try {
    let finish;
    sap.get.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const assertion = expect(readPages('/Invoices')).rejects.toThrow('no respondió a tiempo');
    await jest.advanceTimersByTimeAsync(30000);
    await assertion;
    finish({ data: { value: [] } });
    await Promise.resolve();
  } finally { jest.useRealTimers(); }
});

test('nested audits cannot start more than two real SAP transports at once', async () => {
  const finishes = [];
  sap.get.mockImplementation(() => new Promise(resolve => { finishes.push(resolve); }));
  const calls = [readPages('/Invoices'), readPages('/Orders'), readPages('/DeliveryNotes')];
  await new Promise(resolve => setImmediate(resolve));
  expect(sap.get).toHaveBeenCalledTimes(2);
  finishes[0]({ data: { value: [] } });
  await calls[0];
  await new Promise(resolve => setImmediate(resolve));
  expect(sap.get).toHaveBeenCalledTimes(3);
  finishes[1]({ data: { value: [] } });
  finishes[2]({ data: { value: [] } });
  await Promise.all(calls);
});

test('cancelling a queued account audit prevents any later SAP transport from starting for it', async () => {
  const finishes = [];
  sap.get.mockImplementation(() => new Promise(resolve => { finishes.push(resolve); }));
  const occupying = [readPages('/Invoices'), readPages('/Orders')];
  await new Promise(resolve => setImmediate(resolve));
  const controller = new AbortController();
  const cancelled = expect(service.review('123', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await cancelled;
  finishes.forEach(resolve => resolve({ data: { value: [] } }));
  await Promise.all(occupying);
  expect(sap.get).toHaveBeenCalledTimes(2);
});

test('every fresh account SAP transport receives its cancellation signal and response timeout', async () => {
  source({ Invoices: [invoice()] });
  const controller = new AbortController();
  expect(await service.review('123', { signal: controller.signal })).toMatchObject({ eligible: true });
  for (const [, , options] of sap.get.mock.calls) {
    expect(options.signal).toBe(controller.signal);
    expect(options.timeoutMs).toBeGreaterThan(0);
    expect(options.timeoutMs).toBeLessThanOrEqual(30000);
  }
});
