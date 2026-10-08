'use strict';

// Auditoría de lectura. No usa fetchAllPages: su caché y sus páginas parciales
// no permiten acreditar que el mapa de SAP está cerrado en este momento.
const sapService = require('./sap.service');
const sapConfig = require('../config/sap.config');
const { AsyncLocalStorage } = require('async_hooks');
const requestScope = new AsyncLocalStorage();
const sqlTableUnavailable = new Set();
const unavailableHeaderRelations = new Set();
let activeSapRequests = 0;
const sapRequestQueue = [];

const PAGE_SIZE = 200;
const MAX_PAGES = 100;
const MAX_NODES = 400;
const MAX_ROUNDS = 16;
const SEARCH_LIMIT = 100;
const REQUEST_BUDGET_MS = 120000;
const REVIEW_BUDGET_MS = 240000;
const SAP_CALL_TIMEOUT_MS = 30000;
const MAX_ENDPOINT_LENGTH = 1800;
const BALANCE_COLUMNS = 'T0.TransId, T0.Line_ID, T0.ShortName, T0.TransType, T0.CreatedBy, T0.Closed, T0.BalDueDeb, T0.BalDueCred, T0.BalFcDeb, T0.BalFcCred, T0.BalScDeb, T0.BalScCred';
const SQL_QUERIES = {
  sq_bi_reopen_balance_v2: `SELECT ${BALANCE_COLUMNS} FROM JDT1 T0 WHERE T0.ShortName = :cardCode AND T0.TransType = :objectType AND T0.CreatedBy = :objectEntry`,
  sq_bi_reopen_journal_v1: `SELECT ${BALANCE_COLUMNS} FROM JDT1 T0 WHERE T0.TransId = :transId AND T0.ShortName = :cardCode`,
  sq_bi_reopen_recon_v2: 'SELECT DISTINCT T0.ReconNum FROM ITR1 T0 WHERE T0.SrcObjTyp = :objectType AND T0.SrcObjAbs = :objectEntry',
};
const BALANCE_FIELDS = ['BalDueDeb', 'BalDueCred', 'BalFcDeb', 'BalFcCred', 'BalScDeb', 'BalScCred'];
const DOCUMENTS = [
  ['Invoices', 13, 'Factura', 'rot_SalesInvoice'],
  ['Orders', 17, 'Orden de venta', 'rot_SalesOrder'],
  ['Quotations', 23, 'Cotización', 'rot_SalesQuotation'],
  ['DeliveryNotes', 15, 'Entrega', 'rot_DeliveryNotes'],
  ['Returns', 16, 'Devolución', 'rot_Return'],
  ['CreditNotes', 14, 'Nota de crédito', 'rot_SalesCreditNote'],
  ['DownPayments', 203, 'Anticipo', 'rot_DownPaymentIncoming'],
  ['ReturnRequest', 234000031, 'Solicitud de devolución', 'rot_ReturnRequest'],
  ['PurchaseInvoices', 18, 'Factura de proveedor', 'rot_PurchaseInvoice'],
  ['PurchaseCreditNotes', 19, 'Nota de crédito de proveedor', 'rot_PurchaseCreditNote'],
  ['PurchaseDeliveryNotes', 20, 'Entrada de mercancía', 'rot_GoodsReceiptPO'],
  ['PurchaseReturns', 21, 'Devolución a proveedor', 'rot_GoodsReturn'],
  ['PurchaseOrders', 22, 'Orden de compra', 'rot_PurchaseOrder'],
  ['PurchaseQuotations', 540000006, 'Cotización de compra', 'rot_PurchaseQuotation'],
  ['PurchaseDownPayments', 204, 'Anticipo a proveedor', 'rot_DownPaymentOutgoing'],
  ['InventoryGenEntries', 59, 'Entrada de inventario', 'rot_GoodsReceipt'],
  ['InventoryGenExits', 60, 'Salida de inventario', 'rot_GoodsIssue'],
  ['PurchaseRequests', 1470000113, 'Solicitud de compra', 'rot_PurchaseRequest'],
  ['GoodsReturnRequest', 234000032, 'Solicitud de devolución a proveedor', 'rot_GoodsReturnRequest'],
].map(([entity, type, label, reference]) => ({ entity, type, label, reference, kind: 'document' }));
const FINANCIAL = [
  { entity: 'IncomingPayments', type: 24, label: 'Pago recibido', reference: 'rot_IncomingPayments', kind: 'payment' },
  { entity: 'VendorPayments', type: 46, label: 'Pago efectuado', reference: 'rot_OutgoingPayments', kind: 'payment' },
  { entity: 'JournalEntries', type: 30, label: 'Asiento contable', reference: 'rot_JournalEntry', kind: 'journal' },
  { entity: 'InternalReconciliations', type: 321, label: 'Conciliación interna', reference: 'rot_InternalReconciliation', kind: 'reconciliation' },
  { entity: 'StockTransfers', type: 67, label: 'Traslado de inventario', reference: 'rot_InventoryTransfer', kind: 'transfer' },
  { entity: 'InventoryTransferRequests', type: 1250000001, label: 'Solicitud de traslado', reference: 'rot_InventoryTransferRequest', kind: 'transfer' },
];
const TABLES = { Invoices: ['OINV', 'INV1'], Orders: ['ORDR', 'RDR1'], Quotations: ['OQUT', 'QUT1'],
  DeliveryNotes: ['ODLN', 'DLN1'], Returns: ['ORDN', 'RDN1'], CreditNotes: ['ORIN', 'RIN1'],
  DownPayments: ['ODPI', 'DPI1'], ReturnRequest: ['ORRR', 'RRR1'], PurchaseInvoices: ['OPCH', 'PCH1'],
  PurchaseCreditNotes: ['ORPC', 'RPC1'], PurchaseDeliveryNotes: ['OPDN', 'PDN1'], PurchaseReturns: ['ORPD', 'RPD1'],
  PurchaseOrders: ['OPOR', 'POR1'], PurchaseQuotations: ['OPQT', 'PQT1'], PurchaseDownPayments: ['ODPO', 'DPO1'],
  InventoryGenEntries: ['OIGN', 'IGN1'], InventoryGenExits: ['OIGE', 'IGE1'], PurchaseRequests: ['OPRQ', 'PRQ1'],
  GoodsReturnRequest: ['OPRR', 'PRR1'], StockTransfers: ['OWTR', 'WTR1'], InventoryTransferRequests: ['OWTQ', 'WTQ1'] };
for (const def of [...DOCUMENTS, ...FINANCIAL.filter(item => item.kind === 'transfer')]) {
  def.accountQuery = def.entity === 'Invoices' ? 'sq_bi_reopen_invoice_keys_v1' : `sq_bi_reopen_keys_${def.type}_v1`;
  const [header, line] = TABLES[def.entity];
  SQL_QUERIES[def.accountQuery] = `SELECT DISTINCT T0.DocEntry, T0.DocNum, T0.U_PCNum, T0.U_PTName FROM ${header} T0 LEFT JOIN ${line} T1 ON T0.DocEntry = T1.DocEntry WHERE T0.U_PCNum = :account OR T1.U_PCNum = :account`;
}
const TYPES = new Map([...DOCUMENTS, ...FINANCIAL].map(def => [String(def.type), def]));
const REF_TYPES = new Map([...DOCUMENTS, ...FINANCIAL].map(def => [def.reference, def]));
const SEEDS = DOCUMENTS.slice(0, 8);
const PAYMENT_TYPES = { it_Invoice: 13, it_CredItnote: 14, it_TaxInvoice: 15,
  it_Return: 16, it_PurchaseInvoice: 18, it_PurchaseCreditNote: 19,
  it_PurchaseDeliveryNote: 20, it_PurchaseReturn: 21, it_Receipt: 24,
  it_JournalEntry: 30, it_PaymentAdvice: 46, it_DownPayment: 203, it_PurchaseDownPayment: 204 };
const JOURNAL_TYPES = { ttARInvoice: 13, ttARCredItnote: 14, ttDelivery: 15, ttReturn: 16,
  ttAPInvoice: 18, ttAPCreditNote: 19, ttPurchaseDeliveryNote: 20, ttPurchaseReturn: 21,
  ttReceipt: 24, ttVendorPayment: 46, ttDownPayment: 203, ttPurchaseDownPayment: 204 };
const TRANSFER_TYPES = { PurchaseDeliveryNotes: 20, InventoryGeneralEntry: 59, WarehouseTransfers: 67, InventoryTransferRequest: 1250000001 };
// SAP SDK database-table constraints: header BaseType is the India transfer
// association (67), not the generic line-copy link. RelatedTyp on these headers
// permits only the types below (the other marketing headers reserve -1).
const HEADER_RELATED_SOURCES = { Invoices: [24, 46], PurchaseInvoices: [24, 46], CreditNotes: [24, 46],
  PurchaseCreditNotes: [24, 46], ReturnRequest: [24, 46], GoodsReturnRequest: [24, 46], InventoryGenEntries: [59, 60], InventoryGenExits: [59, 60] };

function fail(message, status = 400) { return Object.assign(new Error(message), { status }); }
function cancelledRequest() { return Object.assign(fail('Consulta SAP cancelada.', 499), { name: 'AbortError', code: 'ABORT_ERR' }); }
function drainSapQueue() {
  while (activeSapRequests < 2 && sapRequestQueue.length) {
    const next = sapRequestQueue.shift();
    clearTimeout(next.timer);
    next.signal?.removeEventListener('abort', next.onAbort);
    if (next.signal?.aborted) next.reject(cancelledRequest());
    else if (Date.now() >= next.deadline) next.reject(fail('SAP excedió el tiempo disponible para verificar la cuenta.', 502));
    else { activeSapRequests += 1; next.resolve(); }
  }
}
async function transport(operation) {
  const signal = requestScope.getStore()?.signal;
  if (signal?.aborted) throw cancelledRequest();
  const deadline = requestScope.getStore()?.deadline ?? (Date.now() + REQUEST_BUDGET_MS);
  if (Date.now() >= deadline) throw fail('SAP excedió el tiempo disponible para verificar la cuenta.', 502);
  await new Promise((resolve, reject) => {
    const entry = { resolve, reject, deadline, signal };
    entry.onAbort = () => {
      const index = sapRequestQueue.indexOf(entry);
      if (index >= 0) sapRequestQueue.splice(index, 1);
      clearTimeout(entry.timer);
      signal?.removeEventListener('abort', entry.onAbort);
      reject(cancelledRequest());
    };
    entry.timer = setTimeout(() => {
      const index = sapRequestQueue.indexOf(entry);
      if (index >= 0) sapRequestQueue.splice(index, 1);
      signal?.removeEventListener('abort', entry.onAbort);
      reject(fail('SAP excedió el tiempo disponible para verificar la cuenta.', 502));
    }, deadline - Date.now());
    sapRequestQueue.push(entry);
    signal?.addEventListener('abort', entry.onAbort, { once: true });
    drainSapQueue();
  });
  const pending = Promise.resolve().then(operation);
  const release = () => { activeSapRequests -= 1; drainSapQueue(); };
  // Keep the permit until the actual socket promise settles, including aborts
  // and timeouts. Completing a response must never accumulate background SAP
  // work beyond these two transports.
  pending.then(release, release);
  return timedRequest(() => pending);
}
async function timedRequest(operation) {
  const remaining = (requestScope.getStore()?.deadline ?? (Date.now() + REQUEST_BUDGET_MS)) - Date.now();
  if (remaining <= 0) throw fail('SAP excedió el tiempo disponible para verificar la cuenta.', 502);
  let timer;
  try {
    return await Promise.race([operation().catch(error => {
      if (error.status !== 400) throw error;
      const wrapped = fail('SAP no pudo completar una consulta de lectura.', 502);
      wrapped.code = error.code;
      wrapped.sapMessage = String(error.message || '');
      throw wrapped;
    }), new Promise((_, reject) => {
      timer = setTimeout(() => reject(fail('SAP no respondió a tiempo; la verificación está incompleta.', 502)), Math.min(SAP_CALL_TIMEOUT_MS, remaining));
    })]);
  } finally { clearTimeout(timer); }
}
function requestOptions() {
  const scope = requestScope.getStore();
  return { signal: scope?.signal, timeoutMs: Math.max(1, Math.min(SAP_CALL_TIMEOUT_MS,
    (scope?.deadline ?? (Date.now() + REQUEST_BUDGET_MS)) - Date.now())) };
}
function get(endpoint, headers) { return transport(() => sapService.get(endpoint, headers, requestOptions())); }
function post(endpoint, body) { return transport(() => sapService.post(endpoint, body, {}, requestOptions())); }
function int(value) {
  if (value === null || value === undefined || value === '' || !/^\d+$/.test(String(value))) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= 2147483647 ? parsed : null;
}
function accountNumber(value) {
  const number = typeof value === 'string' ? int(value.trim()) : null;
  if (!number) throw fail('El número de cuenta debe contener sólo dígitos y ser mayor a cero.');
  return String(number);
}
function literal(value) { return `'${String(value).replace(/'/g, "''")}'`; }
async function parallel(tasks, concurrency = 2) {
  const results = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (next < tasks.length) {
      if (requestScope.getStore()?.signal?.aborted) throw cancelledRequest();
      const index = next++;
      try { results[index] = { status: 'fulfilled', value: await tasks[index]() }; }
      catch (reason) { results[index] = { status: 'rejected', reason }; }
    }
  }));
  return results;
}
function endpoint(entity, options) {
  return `/${entity}?${Object.entries(options).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')}`;
}
function nextEndpoint(link) {
  const base = new URL(sapConfig.baseUrl);
  const apiPath = base.pathname.replace(/\/$/, '');
  const resolved = new URL(String(link), `${base.origin}${apiPath}/`);
  if (resolved.origin !== base.origin || !resolved.pathname.startsWith(`${apiPath}/`)) {
    throw fail('SAP devolvió una paginación fuera de Service Layer.', 502);
  }
  return `${resolved.pathname.slice(apiPath.length)}${resolved.search}`;
}

async function readPages(initialEndpoint, { maxPages = MAX_PAGES, limit = Infinity, headers = {} } = {}) {
  const rows = [];
  const visited = new Set();
  let current = initialEndpoint;
  while (current) {
    if (visited.has(current) || visited.size >= maxPages) throw fail('No se pudo verificar toda la paginación SAP.', 502);
    visited.add(current);
    const response = await get(current, { Prefer: `odata.maxpagesize=${PAGE_SIZE}`, 'Cache-Control': 'no-cache', ...headers });
    if (!response?.data || !Array.isArray(response.data.value)) throw fail('SAP devolvió una colección incompleta.', 502);
    rows.push(...response.data.value);
    const next = response.data['@odata.nextLink'] || response.data['odata.nextLink'];
    if (rows.length > limit || (rows.length === limit && next)) return { rows: rows.slice(0, limit), truncated: true };
    current = next ? nextEndpoint(next) : null;
  }
  return { rows, truncated: false };
}

async function readOrPages(entity, options, predicates, join = '') {
  if (!predicates.length) return { rows: [], truncated: false };
  const build = parts => endpoint(entity, { ...options, $filter: join ? `${join} and (${parts.join(' or ')})` : parts.join(' or ') });
  const chunks = [];
  let parts = [];
  for (const predicate of predicates) {
    if (build([predicate]).length > MAX_ENDPOINT_LENGTH) throw fail('Un vínculo de SAP excede el tamaño verificable de consulta.', 502);
    if (parts.length && build([...parts, predicate]).length > MAX_ENDPOINT_LENGTH) { chunks.push(build(parts)); parts = []; }
    parts.push(predicate);
  }
  if (parts.length) chunks.push(build(parts));
  const rows = [];
  const seen = new Set();
  for (const chunk of chunks) {
    const page = await readPages(chunk);
    for (const row of page.rows) {
      const identity = JSON.stringify(row);
      if (!seen.has(identity)) { seen.add(identity); rows.push(row); }
    }
  }
  return { rows, truncated: false };
}

async function sqlRows(code, parameters, validatedQueries = new Set()) {
  if (sqlTableUnavailable.has(code)) {
    const unavailable = fail('La tabla requerida no está accesible mediante SQLQueries.', 502);
    unavailable.code = '702';
    throw unavailable;
  }
  if (!validatedQueries.has(code)) {
    const sql = SQL_QUERIES[code];
    let queryDefinition = (await get(`/SQLQueries('${code}')`)).data;
    // sap.service converts SQLQuery404 to {value:[]}. Missing infrastructure
    // never proves an empty ledger. Create only our versioned SELECT template.
    if (!queryDefinition?.SqlCode && Array.isArray(queryDefinition?.value) && !queryDefinition.value.length) {
      let provisionError;
      try { await post('/SQLQueries', { SqlCode: code, SqlName: code, SqlText: sql }); }
      catch (error) { provisionError = error; /* A concurrent request may have created the same key. */ }
      queryDefinition = (await get(`/SQLQueries('${code}')`)).data;
      if (!queryDefinition?.SqlCode && String(provisionError?.code) === '702') {
        sqlTableUnavailable.add(code);
        throw provisionError;
      }
    }
    const normalize = text => String(text || '').replaceAll('[', '').replaceAll(']', '').replaceAll('"', '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (queryDefinition?.SqlCode !== code || normalize(queryDefinition?.SqlText) !== normalize(sql)) throw fail('No se pudo verificar la definición de la consulta de lectura SAP.', 502);
    validatedQueries.add(code);
  }
  const params = Object.entries(parameters).map(([name, parameter]) => `${name}=${typeof parameter === 'number' ? String(parameter) : encodeURIComponent(literal(parameter))}`).join('&');
  return (await readPages(`/SQLQueries('${code}')/List?${params}`)).rows;
}

function lineQuery(def, predicate) {
  const lines = `${def.entity}/${def.kind === 'transfer' ? 'StockTransferLines' : 'DocumentLines'}`;
  return endpoint(`$crossjoin(${def.entity},${lines})`, {
    $expand: `${def.entity}($select=DocEntry),${lines}($select=DocEntry,BaseType,BaseEntry,U_PCNum)`,
    $filter: `${def.entity}/DocEntry eq ${lines}/DocEntry and (${predicate})`,
  });
}
function lineLinks(def, predicates) {
  const lines = `${def.entity}/${def.kind === 'transfer' ? 'StockTransferLines' : 'DocumentLines'}`;
  return readOrPages(`$crossjoin(${def.entity},${lines})`, {
    $expand: `${def.entity}($select=DocEntry),${lines}($select=DocEntry,BaseType,BaseEntry,U_PCNum)`,
  }, predicates, `${def.entity}/DocEntry eq ${lines}/DocEntry`);
}

async function headerLinks(def, sources, relation) {
  const properties = relation === 'base' ? ['BaseType', 'BaseEntry'] : ['RelatedType', 'RelatedEntry'];
  const capability = `${def.entity}:${relation}`;
  if (unavailableHeaderRelations.has(capability)) return { rows: [] };
  try {
    return await readOrPages(def.entity, { $select: 'DocEntry' },
      sources.map(row => `(${properties[0]} eq ${row.def.type} and ${properties[1]} eq ${row.entry})`));
  } catch (error) {
    const message = error.sapMessage || '';
    // Shared Document metadata contains union properties. The installed SAP
    // explicitly rejects BaseType on most entity sets. Only a proven missing
    // property can disable this capability; timeouts/errors never imply empty.
    if (String(error.code) === '-1000' && /is invalid/i.test(message) && properties.some(property => message.includes(`Property '${property}'`) || message.includes(`Property "${property}"`))) {
      unavailableHeaderRelations.add(capability);
      return { rows: [] };
    }
    throw error;
  }
}
function cancellation(doc) {
  const flags = [doc.Cancelled, doc.CANCELED, doc.CancelStatus].filter(value => value !== undefined && value !== null);
  if (flags.length && flags.every(value => [true, 'tYES', 'Y', 'C', 'csYes', 'csCancellation'].includes(value))) return true;
  if (flags.length && flags.every(value => [false, 'tNO', 'N', 'csNo'].includes(value))) return false;
  return null;
}
function documentStatus(doc) {
  const cancelled = cancellation(doc);
  if (cancelled === true) return [doc.DocumentStatus, doc.DocStatus].some(value => ['bost_Open', 'O'].includes(value)) ? 'unknown' : 'cancelled';
  if (cancelled === null) return 'unknown';
  const states = [doc.DocumentStatus, doc.DocStatus].filter(value => value !== undefined && value !== null);
  if (states.length && states.every(value => ['bost_Close', 'C'].includes(value))) return 'closed';
  if (states.length && states.every(value => ['bost_Open', 'O'].includes(value))) return 'open';
  return 'unknown';
}
function ledgerStatus(rows) {
  if (!rows.length) return 'unknown';
  for (const row of rows) {
    if (!['Y', 'N'].includes(row.Closed) || BALANCE_FIELDS.some(field => row[field] == null || row[field] === '' || !Number.isFinite(Number(row[field])))) return 'unknown';
  }
  if (rows.some(row => row.Closed === 'N' || BALANCE_FIELDS.some(field => Number(row[field]) !== 0))) return 'open';
  return 'settled';
}
function key(def, entry) { return `${def.entity}:${entry}`; }
function identity(def, doc) { return int(def.kind === 'reconciliation' ? doc.ReconNum : def.kind === 'journal' ? doc.JdtNum : doc.DocEntry); }
function definition(type) { return TYPES.get(String(type)) || REF_TYPES.get(String(type)); }
function arrays(doc, field) {
  if (!Array.isArray(doc[field])) throw fail(`SAP no informó la colección ${field}.`, 502);
  return doc[field];
}

async function accountDocuments(account, onWarning, definitions = SEEDS, validatedQueries = new Set()) {
  const documents = new Map();
  const results = await parallel(definitions.map(def => async () => {
    let entries;
    try { entries = await sqlRows(def.accountQuery, { account: Number(account) }, validatedQueries); }
    catch (error) {
      if (String(error.code) !== '702') throw error;
      // SAP's SQL table allowlist does not include some inventory tables.
      // Native GET still exposes them. Verify both header and line folios;
      // rejection/timeout in either path remains an incomplete audit.
      const parts = await Promise.all([
        readPages(endpoint(def.entity, { $select: 'DocEntry', $filter: `U_PCNum eq ${account}`, $orderby: 'DocEntry desc' })),
        readPages(lineQuery(def, `${def.entity}/${def.kind === 'transfer' ? 'StockTransferLines' : 'DocumentLines'}/U_PCNum eq ${account}`)),
      ]);
      const ids = new Set([...parts[0].rows.map(row => int(row.DocEntry)), ...parts[1].rows.map(row => int(row[def.entity]?.DocEntry))]);
      if (ids.has(null)) throw fail('SAP devolvió un folio de cuenta sin identificador.', 502);
      entries = [...ids].map(DocEntry => ({ DocEntry }));
    }
    if (entries.length > MAX_NODES || entries.some(doc => int(doc.DocEntry) === null)) throw fail('No se pudieron verificar todos los documentos de la cuenta.', 502);
    const records = await parallel(entries.map(row => async () => {
      const doc = (await get(`/${def.entity}(${int(row.DocEntry)})`)).data;
      if (identity(def, doc) !== int(row.DocEntry)) throw fail('SAP devolvió un documento distinto al solicitado.', 502);
      return doc;
    }));
    const docs = [];
    for (const result of records) {
      if (result.status === 'rejected') {
        if (!onWarning) throw result.reason;
        onWarning(`No se pudieron verificar todos los folios de ${def.label.toLowerCase()} de la cuenta.`);
      } else docs.push(result.value);
    }
    return { def, docs };
  }));
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      if (result.reason?.name === 'AbortError') throw result.reason;
      if (!onWarning) throw fail(`No se pudo consultar ${definitions[index].label.toLowerCase()} en SAP.`, 502);
      onWarning(`No se pudo consultar ${definitions[index].label.toLowerCase()} de la cuenta.`);
    } else result.value.docs.forEach(doc => documents.set(key(result.value.def, identity(result.value.def, doc)), { def: result.value.def, doc }));
  });
  return [...documents.values()];
}

function patientNameForAccount(records, account) {
  const matchingHeader = records.find(row => row.doc.U_PTName && int(row.doc.U_PCNum) === Number(account));
  const singleAccount = records.find(row => {
    if (!row.doc.U_PTName || int(row.doc.U_PCNum)) return false;
    const accounts = new Set((row.doc.DocumentLines || []).map(line => int(line.U_PCNum)).filter(Boolean));
    return accounts.size === 1 && accounts.has(Number(account));
  });
  return matchingHeader?.doc.U_PTName || singleAccount?.doc.U_PTName || 'Sin nombre de paciente en SAP';
}

function documentNode({ def, doc }, status = documentStatus(doc)) {
  const entry = identity(def, doc);
  return { id: key(def, entry), entity: def.entity, docEntry: entry,
    docNum: doc.DocNum ?? doc.Number ?? doc.ReconNum ?? null, typeLabel: def.label,
    status, statusBasis: 'document', sapStatus: doc.DocumentStatus ?? doc.DocStatus ?? null, cancelled: cancellation(doc),
    date: doc.DocDate ?? doc.ReferenceDate ?? doc.ReconDate ?? null,
    total: doc.DocTotal == null ? null : doc.DocCurrency && doc.DocCurrency !== (process.env.SAP_LOCAL_CURRENCY || 'MXN') ? doc.DocTotalFc ?? null : doc.DocTotal,
    currency: doc.DocCurrency ?? null };
}

async function reviewWithoutInvoice(account, validatedQueries) {
  const warnings = ['Mapa completo no consultado: la cuenta no tiene factura y no cumple el requisito para reapertura.'];
  // Orders provide context only. They cannot change the already confirmed
  // failure of the invoice prerequisite, so never spend the graph budget here.
  const deadline = Math.min(requestScope.getStore()?.deadline ?? Infinity, Date.now() + 10000);
  const orders = await requestScope.run({ ...requestScope.getStore(), deadline }, () => accountDocuments(account,
    message => warnings.push(message), [DOCUMENTS[1]], validatedQueries));
  const nodes = orders.map(row => documentNode(row));
  return { account, patientName: patientNameForAccount(orders, account), checkedAt: new Date().toISOString(),
    complete: false, eligible: false, status: 'blocked', mapState: 'not_requested',
    reasons: ['La cuenta no tiene una factura localizada en SAP.'],
    invoices: [], nodes, edges: [], openDocuments: nodes.filter(node => node.status === 'open'), warnings };
}

async function search({ mode = 'patient', q } = {}) {
  if (!['patient', 'account'].includes(mode)) throw fail('Selecciona búsqueda por paciente o cuenta.');
  if (typeof q !== 'string') throw fail('Escribe un nombre de paciente o número de cuenta.');
  const query = q.trim();
  if (query.length > 120 || [...query].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw fail('El texto de búsqueda no es válido.');
  const account = mode === 'account' ? accountNumber(query) : null;
  if (mode === 'patient' && query.length < 2) throw fail('Escribe al menos dos caracteres del nombre del paciente.');
  const found = new Map();
  const validatedQueries = new Set();
  let truncated = false;
  const matches = mode === 'account' ? (await Promise.all([DOCUMENTS[0], DOCUMENTS[1]].map(async def => {
    const entries = await sqlRows(def.accountQuery, { account: Number(account) }, validatedQueries);
    return entries.map(doc => ({ def, doc: { ...doc, _accountKeyOnly: true } }));
  }))).flat() : (await Promise.all([DOCUMENTS[0], DOCUMENTS[1]].map(async def => {
    const result = await readPages(endpoint(def.entity, { $select: 'DocEntry,U_PCNum,U_PTName,DocumentLines',
      $filter: `contains(U_PTName,${literal(query)})`, $orderby: 'DocEntry desc' }), { limit: 1000, headers: { 'B1S-CaseInsensitive': 'true' } });
    truncated ||= result.truncated;
    return result.rows.map(doc => ({ def, doc }));
  }))).flat();
  for (const { def, doc } of matches) {
    // U_PRName es el médico. U_PTName es el paciente. Las facturas consolidadas
    // también pueden llevar el folio U_PCNum en cada línea.
    const lineAccounts = new Set((doc.DocumentLines || []).map(line => int(line.U_PCNum)).filter(Boolean));
    const headerAccount = int(doc.U_PCNum);
    const namedAccount = headerAccount || (!doc._accountKeyOnly && lineAccounts.size === 1 ? [...lineAccounts][0] : null);
    const accounts = mode === 'patient' ? new Set(namedAccount ? [namedAccount] : []) : new Set([headerAccount, ...lineAccounts].filter(Boolean));
    if (mode === 'account') { accounts.clear(); accounts.add(Number(account)); }
    for (const value of accounts) {
      const id = String(value);
      const reliableName = namedAccount === value ? doc.U_PTName : null;
      const row = found.get(id) || { account: id, patientName: reliableName || 'Sin nombre de paciente en SAP', invoiceIds: new Set() };
      if (def.entity === 'Invoices') row.invoiceIds.add(int(doc.DocEntry));
      if (reliableName && row.patientName === 'Sin nombre de paciente en SAP') row.patientName = reliableName;
      found.set(id, row);
    }
  }
  const rows = [...found.values()].sort((a, b) => Number(b.account) - Number(a.account));
  if (mode === 'patient' && rows.length) {
    // A named order can have invoices with a blank/different header name.
    // Count by the actual account keys instead of reporting a misleading zero.
    const counts = await parallel(rows.slice(0, SEARCH_LIMIT).map(row => async () => {
      const matches = await sqlRows(DOCUMENTS[0].accountQuery, { account: Number(row.account) }, validatedQueries);
      if (matches.some(doc => int(doc.DocEntry) === null)) throw fail('SAP devolvió un conteo de facturas incompleto.', 502);
      return { row, ids: new Set(matches.map(doc => int(doc.DocEntry))) };
    }));
    for (const result of counts) {
      if (result.status === 'rejected') throw fail('No se pudo completar la búsqueda por paciente en SAP.', 502);
      result.value.row.invoiceIds = result.value.ids;
    }
  }
  return { accounts: rows.slice(0, SEARCH_LIMIT).map(({ invoiceIds, ...row }) => ({ ...row, invoiceCount: invoiceIds.size })),
    truncated: truncated || rows.length > SEARCH_LIMIT };
}

async function review(value, { fullMap = false } = {}) {
  const account = accountNumber(value);
  const validatedQueries = new Set();
  // Verify the mandatory invoice prerequisite first, using fresh, complete
  // account keys. Zero invoices makes reopening impossible without scanning
  // every document type and traversing a map for several minutes.
  const ownInvoices = await accountDocuments(account, null, [DOCUMENTS[0]], validatedQueries);
  if (!ownInvoices.length && !fullMap) return reviewWithoutInvoice(account, validatedQueries);
  const warnings = new Set();
  const records = new Map();
  const edges = new Map();
  const queried = new Set();
  const scannedFinancial = new Set();
  const scannedRecon = new Set();
  const scannedDraws = new Set();
  const accountInvoiceIds = new Set();
  let complete = true;
  const warn = message => { complete = false; warnings.add(message); };
  const add = (def, doc) => {
    const entry = identity(def, doc);
    if (entry === null) { warn('SAP devolvió un documento sin identificador válido.'); return null; }
    const id = key(def, entry);
    if (!records.has(id) && records.size >= MAX_NODES) { warn('El mapa excede el límite de documentos verificables.'); return null; }
    records.set(id, { def, doc, id, entry });
    return id;
  };
  const edge = (source, target, label) => {
    if (source && target && source !== target) edges.set(`${source}|${target}|${label}`, { source, target, label });
  };
  const missing = (type, entry, from, label, generated = false) => {
    const parsed = int(entry);
    if (parsed === null) { warn('SAP devolvió una relación sin identificador válido.'); return; }
    const def = definition(type);
    if (!def) {
      if (String(type) === '-1' || String(type) === 'rot_ExternalDocument') warn('Hay una referencia externa cuyo estado no puede verificarse en SAP.');
      else warn(`Hay un tipo de documento relacionado que no puede verificarse (${String(type)}).`);
      return;
    }
    const target = key(def, parsed);
    if (generated) edge(from, target, label);
    else edge(target, from, label);
    if (!records.has(target)) pending.set(target, { def, entry: parsed });
  };
  let pending = new Map();
  const otherDocuments = await accountDocuments(account, warn,
    [...DOCUMENTS.slice(1), ...FINANCIAL.filter(def => def.kind === 'transfer')], validatedQueries);
  for (const { def, doc } of [...ownInvoices, ...otherDocuments]) {
    const id = add(def, doc);
    if (id && def.entity === 'Invoices') accountInvoiceIds.add(id);
  }

  // Only typed application/reference/reconciliation keys create financial
  // edges. BP codes scope the ledger checks and never substitute for a link.
  const reviewSqlRows = (code, parameters) => sqlRows(code, parameters, validatedQueries);

  async function financialCandidates(cardCodes, sources) {
    const fresh = cardCodes.filter(code => !scannedFinancial.has(code));
    fresh.forEach(code => scannedFinancial.add(code));
    const results = await parallel([
      ...FINANCIAL.filter(def => def.kind === 'payment').map(def => async () => {
        const lines = `${def.entity}/PaymentInvoices`;
        const appliedTypes = Object.entries(PAYMENT_TYPES);
        const predicates = sources.flatMap(row => appliedTypes.filter(([, type]) => type === row.def.type).map(([type]) => `(${lines}/InvoiceType eq ${literal(type)} and ${lines}/DocEntry eq ${row.entry})`));
        if (!predicates.length) return { def, rows: [] };
        const linked = await readOrPages(`$crossjoin(${def.entity},${lines})`, {
          $expand: `${def.entity}($select=DocEntry),${lines}($select=DocNum,DocEntry,InvoiceType)`,
        }, predicates, `${def.entity}/DocEntry eq ${lines}/DocNum`);
        const ids = [...new Set(linked.rows.map(row => int(row[def.entity]?.DocEntry)).filter(id => id !== null))];
        if (ids.length > MAX_NODES) throw fail('Los pagos exceden el límite verificable.', 502);
        const docs = await parallel(ids.map(id => async () => (await get(`/${def.entity}(${id})`)).data));
        for (const result of docs) if (result.status === 'rejected') throw result.reason;
        return { def, rows: docs.map(result => result.value) };
      }),
      (async () => {
        const def = TYPES.get('321');
        const scan = sources.filter(row => !scannedRecon.has(row.id) && row.def.kind !== 'reconciliation');
        scan.forEach(row => scannedRecon.add(row.id));
        const lists = await parallel(scan.map(row => () => reviewSqlRows('sq_bi_reopen_recon_v2', { objectType: String(row.def.type), objectEntry: row.entry })));
        const ids = new Set();
        for (const result of lists) {
          if (result.status === 'rejected') throw result.reason;
          for (const item of result.value) {
            const id = int(item.ReconNum);
            if (id === null) throw fail('SAP devolvió una conciliación sin identificador.', 502);
            ids.add(id);
          }
        }
        if (ids.size > MAX_NODES) throw fail('Las conciliaciones exceden el límite de documentos verificables.', 502);
        const docs = await parallel([...ids].map(id => async () => (await get(`/InternalReconciliations(${id})`)).data));
        for (const result of docs) if (result.status === 'rejected') throw result.reason;
        return { def, rows: docs.map(result => result.value) };
      }),
    ]);
    const candidates = [];
    results.forEach((result, index) => {
      if (result.status === 'rejected') warn(index === 2 ? 'No se pudo verificar todas las conciliaciones internas.' : 'No se pudo verificar todos los pagos relacionados.');
      else result.value.rows.forEach(doc => candidates.push({ def: result.value.def, doc }));
    });
    return candidates;
  }

  const candidates = new Map();
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    if (requestScope.getStore()?.signal?.aborted) throw cancelledRequest();
    const fresh = [...records.values()].filter(row => !queried.has(row.id));
    if (!fresh.length && !pending.size) break;
    fresh.forEach(row => queried.add(row.id));
    for (const row of fresh) {
      const { def, doc, id } = row;
      try {
        if (def.kind === 'document' || def.kind === 'transfer') {
          for (const line of arrays(doc, def.kind === 'transfer' ? 'StockTransferLines' : 'DocumentLines')) {
            const baseType = def.kind === 'transfer' ? TRANSFER_TYPES[line.BaseType] : line.BaseType;
            if (Number(baseType) >= 0 && line.BaseEntry !== null && line.BaseEntry !== undefined) missing(baseType, line.BaseEntry, id, 'Documento base');
          }
          if (Number(doc.BaseType) >= 0 && doc.BaseEntry !== null && doc.BaseEntry !== undefined) missing(doc.BaseType, doc.BaseEntry, id, 'Documento base');
          if (Number(doc.RelatedType) > 0 && doc.RelatedEntry !== null && doc.RelatedEntry !== undefined) missing(doc.RelatedType, doc.RelatedEntry, id, 'Documento relacionado');
          if (int(doc.TransNum) > 0) missing(30, doc.TransNum, id, 'Asiento contable', true);
          else if (['Invoices', 'PurchaseInvoices'].includes(def.entity)) warn('SAP no informó el asiento contable de una factura; el mapa no puede certificarse completo.');
          for (const ref of arrays(doc, 'DocumentReferences')) missing(ref.RefObjType, ref.RefDocEntr, id, 'Referencia SAP');
          if (def.entity === 'Invoices' || def.entity === 'PurchaseInvoices') {
            for (const draw of arrays(doc, 'DownPaymentsToDraw')) missing(def.entity === 'Invoices' ? 203 : 204, draw.DocEntry, id, 'Anticipo aplicado');
          }
        } else if (def.kind === 'payment') {
          for (const applied of arrays(doc, 'PaymentInvoices')) missing(PAYMENT_TYPES[applied.InvoiceType] ?? applied.InvoiceType, applied.DocEntry, id, 'Pago aplicado');
          for (const ref of arrays(doc, 'PaymentDocumentReferencesCollection')) missing(ref.ReferencedObjectType, ref.ReferencedDocEntry, id, 'Referencia SAP');
          if (cancellation(doc) === false && doc.CardCode) {
            try {
              const ledger = await reviewSqlRows('sq_bi_reopen_balance_v2', { cardCode: doc.CardCode, objectType: String(def.type), objectEntry: row.entry });
              if (ledger.some(item => String(item.TransType) !== String(def.type) || int(item.CreatedBy) !== row.entry || item.ShortName !== doc.CardCode)) throw fail('Las partidas no corresponden al pago.', 502);
              for (const posting of ledger) if (int(posting.TransId) !== null) missing(30, posting.TransId, id, 'Asiento contable', true);
            } catch { warn('No se pudo verificar el asiento contable del pago.'); }
          }
        } else if (def.kind === 'reconciliation') {
          if (int(doc.CancelAbs) > 0) continue;
          for (const linked of arrays(doc, 'InternalReconciliationRows')) missing(linked.SrcObjTyp, linked.SrcObjAbs, id, 'Conciliación interna');
        } else if (def.kind === 'journal') {
          arrays(doc, 'JournalEntryLines');
          const sourceType = JOURNAL_TYPES[doc.OriginalJournal];
          if (sourceType && int(doc.Original) !== null) missing(sourceType, doc.Original, id, 'Origen del asiento');
        }
      } catch (error) { warn(error.message); }
    }

    const cards = [...new Set(fresh.flatMap(row => [row.doc.CardCode,
      ...(row.def.kind === 'reconciliation' ? row.doc.InternalReconciliationRows?.map(line => line.ShortName) || [] : []),
      ...(row.def.kind === 'journal' ? row.doc.JournalEntryLines?.filter(line => line.ShortName && line.ShortName !== line.AccountCode).map(line => line.ShortName) || [] : []),
    ]).filter(code => typeof code === 'string' && code.trim()))];
    for (const row of fresh) if (['Invoices', 'CreditNotes', 'DownPayments', 'IncomingPayments', 'VendorPayments'].includes(row.def.entity) && !row.doc.CardCode) warn('SAP no informó el socio de negocio requerido para verificar los vínculos contables.');
    for (const item of await financialCandidates(cards, fresh)) candidates.set(key(item.def, identity(item.def, item.doc)), item);

    // Reverse base/reference discovery is indispensable: Service Layer does not
    // expose target pointers in DocumentLines in this SAP installation.
    if (fresh.length) {
      const queries = [];
      for (const def of [...DOCUMENTS, ...FINANCIAL.filter(item => item.kind === 'transfer')]) {
        const prefix = `${def.entity}/${def.kind === 'transfer' ? 'StockTransferLines' : 'DocumentLines'}`;
        const baseChecks = fresh.flatMap(row => {
          const transferEnum = Object.keys(TRANSFER_TYPES).find(name => TRANSFER_TYPES[name] === row.def.type);
          if (def.kind === 'transfer' && !transferEnum) return [];
          return [`(${prefix}/BaseType eq ${def.kind === 'transfer' ? literal(transferEnum) : row.def.type} and ${prefix}/BaseEntry eq ${row.entry})`];
        });
        if (baseChecks.length) queries.push({ def, run: () => lineLinks(def, baseChecks) });
        const refs = `${def.entity}/DocumentReferences`;
        queries.push({ def, run: () => readOrPages(`$crossjoin(${def.entity},${refs})`, {
          $expand: `${def.entity}($select=DocEntry),${refs}($select=DocEntry,RefDocEntr,RefObjType)`,
        }, fresh.map(row => `(${refs}/RefObjType eq ${literal(row.def.reference)} and ${refs}/RefDocEntr eq ${row.entry})`), `${def.entity}/DocEntry eq ${refs}/DocEntry`) });
        if (def.kind === 'document') {
          const transfers = fresh.filter(row => row.def.type === 67);
          if (['Invoices', 'PurchaseInvoices'].includes(def.entity) && transfers.length) queries.push({ def, run: () => headerLinks(def, transfers, 'base') });
          const relatedTypes = HEADER_RELATED_SOURCES[def.entity] || [];
          const related = fresh.filter(row => relatedTypes.includes(row.def.type));
          if (related.length) queries.push({ def, run: () => headerLinks(def, related, 'related') });
        }
      }
      for (const def of FINANCIAL.filter(item => item.kind === 'payment')) {
        const refs = `${def.entity}/PaymentDocumentReferencesCollection`;
        queries.push({ def, run: () => readOrPages(`$crossjoin(${def.entity},${refs})`, {
          $expand: `${def.entity}($select=DocEntry),${refs}($select=DocEntry,ReferencedDocEntry,ReferencedObjectType)`,
        }, fresh.map(row => `(${refs}/ReferencedObjectType eq ${literal(row.def.reference)} and ${refs}/ReferencedDocEntry eq ${row.entry})`), `${def.entity}/DocEntry eq ${refs}/DocEntry`) });
      }
      const results = await parallel(queries.map(query => query.run));
      results.forEach((result, index) => {
        const { def } = queries[index];
        if (result.status === 'rejected') { warn(`No se pudieron verificar todos los vínculos de ${def.label.toLowerCase()}.`); return; }
        for (const doc of result.value.rows) {
          const entry = int(doc[def.entity]?.DocEntry ?? doc.DocEntry);
          if (entry === null) { warn('SAP devolvió un vínculo incompleto.'); continue; }
          const id = key(def, entry);
          if (!records.has(id)) pending.set(id, { def, entry });
        }
      });
      // An invoice can draw an advance without a BaseEntry. Scan all invoices
      // of its BP and inspect real DownPaymentsToDraw keys, never BP membership.
      const downCards = [...new Set(fresh.filter(row => [203, 204].includes(row.def.type)).map(row => row.doc.CardCode).filter(Boolean))].filter(code => !scannedDraws.has(code));
      downCards.forEach(code => scannedDraws.add(code));
      if (downCards.length) {
        const results = await Promise.allSettled(['Invoices', 'PurchaseInvoices'].map(async entity => {
          const def = DOCUMENTS.find(item => item.entity === entity);
          return { def, rows: (await readOrPages(entity, {}, downCards.map(code => `CardCode eq ${literal(code)}`))).rows };
        }));
        results.forEach(result => {
          if (result.status === 'rejected') warn('No se pudieron verificar todas las aplicaciones de anticipos.');
          else result.value.rows.forEach(doc => candidates.set(key(result.value.def, identity(result.value.def, doc)), { def: result.value.def, doc }));
        });
      }
    }

    // Keep only candidate documents that have a typed link to the current map.
    for (const [candidateId, { def, doc }] of candidates) {
      const connections = [];
      if (def.kind === 'payment') {
        if (!Array.isArray(doc.PaymentInvoices) || !Array.isArray(doc.PaymentDocumentReferencesCollection)) { warn('SAP devolvió los vínculos de un pago incompletos.'); continue; }
        doc.PaymentInvoices.forEach(applied => {
          const linked = definition(PAYMENT_TYPES[applied.InvoiceType] ?? applied.InvoiceType);
          if (linked) connections.push({ id: key(linked, int(applied.DocEntry)), label: 'Pago aplicado' });
        });
        doc.PaymentDocumentReferencesCollection.forEach(ref => {
          const linked = definition(ref.ReferencedObjectType);
          if (linked) connections.push({ id: key(linked, int(ref.ReferencedDocEntry)), label: 'Referencia SAP' });
        });
      } else if (def.kind === 'reconciliation') {
        if (int(doc.CancelAbs) > 0) continue;
        if (!Array.isArray(doc.InternalReconciliationRows)) { warn('SAP devolvió una conciliación incompleta.'); continue; }
        doc.InternalReconciliationRows.forEach(linked => {
          const source = definition(linked.SrcObjTyp);
          if (source) connections.push({ id: key(source, int(linked.SrcObjAbs)), label: 'Conciliación interna' });
        });
      } else {
        if (!Array.isArray(doc.DownPaymentsToDraw)) { warn('SAP devolvió aplicaciones de anticipos incompletas.'); continue; }
        doc.DownPaymentsToDraw.forEach(draw => connections.push({ id: key(TYPES.get(def.entity === 'Invoices' ? '203' : '204'), int(draw.DocEntry)), label: 'Anticipo aplicado' }));
      }
      if (connections.some(link => records.has(link.id))) {
        const added = add(def, doc);
        connections.filter(link => records.has(link.id)).forEach(link => edge(link.id, added, link.label));
        candidates.delete(candidateId);
      }
    }

    const needed = [...pending.values()];
    pending = new Map();
    const results = await parallel(needed.map(item => async () => ({ def: item.def, doc: (await get(`/${item.def.entity}(${item.entry})`, { 'Cache-Control': 'no-cache' })).data, entry: item.entry })));
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const item = needed[index];
        warn(`No se pudo verificar ${item.def.label.toLowerCase()} ${item.entry}.`);
        add(item.def, item.def.kind === 'journal' ? { JdtNum: item.entry } : item.def.kind === 'reconciliation' ? { ReconNum: item.entry } : { DocEntry: item.entry });
      } else if (identity(result.value.def, result.value.doc) !== result.value.entry) warn('SAP devolvió un documento diferente al vínculo solicitado.');
      else add(result.value.def, result.value.doc);
    });
    if (round === MAX_ROUNDS - 1 && [...records.keys()].some(id => !queried.has(id))) warn('No se pudo recorrer todo el mapa de relaciones.');
  }

  const financialStates = new Map();
  const results = await parallel([...records.values()].filter(row => ['payment', 'journal'].includes(row.def.kind)).map(row => async () => {
    if (cancellation(row.doc) === true) return { id: row.id, status: 'cancelled' };
    if (row.def.kind === 'payment' && cancellation(row.doc) !== false) return { id: row.id, status: 'unknown' };
    let rows;
    if (row.def.kind === 'payment') {
      if (!row.doc.CardCode) return { id: row.id, status: 'unknown' };
      rows = await reviewSqlRows('sq_bi_reopen_balance_v2', { cardCode: row.doc.CardCode, objectType: String(row.def.type), objectEntry: row.entry });
      if (rows.some(item => String(item.TransType) !== String(row.def.type) || int(item.CreatedBy) !== row.entry || item.ShortName !== row.doc.CardCode)) throw fail('La consulta devolvió partidas de un documento distinto.', 502);
    } else {
      const parts = await parallel([...scannedFinancial].map(cardCode => () => reviewSqlRows('sq_bi_reopen_journal_v1', { transId: row.entry, cardCode })));
      for (const part of parts) if (part.status === 'rejected') throw part.reason;
      rows = parts.flatMap(part => part.value);
      if (rows.some(item => int(item.TransId) !== row.entry || !scannedFinancial.has(item.ShortName))) throw fail('La consulta devolvió partidas de un asiento distinto.', 502);
      const required = row.doc.JournalEntryLines?.filter(line => line.ShortName && line.ShortName !== line.AccountCode) || [];
      if (!required.length || required.some(line => !rows.some(item => item.ShortName === line.ShortName && (line.Line_ID == null || int(item.Line_ID) === int(line.Line_ID))))) return { id: row.id, status: 'unknown' };
    }
    return { id: row.id, status: ledgerStatus(rows) };
  }));
  results.forEach(result => {
    if (result.status === 'rejected') warn('No se pudieron confirmar las partidas contables en moneda local, extranjera y de sistema.');
    else financialStates.set(result.value.id, result.value.status);
  });

  const nodes = [...records.values()].map(({ def, doc, id, entry }) => {
    let status = documentStatus(doc);
    let statusBasis = 'document';
    let sapStatus = doc.DocumentStatus ?? doc.DocStatus ?? null;
    let cancelled = cancellation(doc);
    if (def.kind === 'payment' || def.kind === 'journal') {
      status = financialStates.get(id) || 'unknown';
      statusBasis = 'ledger';
      sapStatus = status === 'settled' ? 'Sin partidas abiertas (ML, ME y MS)' : status === 'open' ? 'Partidas contables abiertas' : null;
    } else if (def.kind === 'reconciliation') {
      const cancelledBy = int(doc.CancelAbs);
      status = cancelledBy === null ? 'unknown' : cancelledBy > 0 ? 'cancelled' : 'settled';
      statusBasis = 'reconciliation-event';
      cancelled = cancelledBy === null ? null : cancelledBy > 0;
      sapStatus = cancelled ? 'Conciliación cancelada' : status === 'settled' ? 'Conciliación registrada' : null;
    } else if (def.kind === 'transfer') {
      // Transfers expose BoStatus but no cancellation flag in this metadata.
      const states = [doc.DocumentStatus, doc.DocStatus].filter(value => value != null);
      status = states.length && states.every(value => ['bost_Close', 'C'].includes(value)) ? 'closed' : states.length && states.every(value => ['bost_Open', 'O'].includes(value)) ? 'open' : 'unknown';
    }
    return { ...documentNode({ def, doc }, status), id, docEntry: entry, statusBasis, sapStatus, cancelled };
  });
  // A related invoice from another account remains in the map, but cannot
  // replace the selected account's own non-cancelled invoice requirement.
  const invoices = nodes.filter(node => accountInvoiceIds.has(node.id));
  const currentInvoices = invoices.filter(node => node.cancelled === false);
  const openDocuments = nodes.filter(node => node.status === 'open');
  const unknownDocuments = nodes.filter(node => node.status === 'unknown');
  const reasons = [];
  if (!invoices.length) reasons.push('La cuenta no tiene una factura localizada en SAP.');
  else if (!currentInvoices.length) reasons.push('No hay una factura vigente sin cancelar con cierre confirmado.');
  if (currentInvoices.some(node => node.status !== 'closed')) reasons.push('Todas las facturas vigentes deben indicar literalmente Cerrado en SAP.');
  if (openDocuments.length) reasons.push(`Hay ${openDocuments.length} documento(s) abierto(s) en el mapa de relación.`);
  if (unknownDocuments.length) reasons.push(`No se pudo confirmar el estado de ${unknownDocuments.length} documento(s) relacionado(s).`);
  if (!complete) reasons.push('La consulta del mapa está incompleta; no puede acreditar la reapertura.');
  const eligible = complete && currentInvoices.length > 0 && !openDocuments.length && !unknownDocuments.length && currentInvoices.every(node => node.status === 'closed');
  return { account, patientName: patientNameForAccount([...records.values()], account), checkedAt: new Date().toISOString(),
    complete, eligible, status: eligible ? 'eligible' : (!complete || unknownDocuments.length ? 'unverified' : 'blocked'),
    mapState: complete ? 'complete' : 'incomplete',
    reasons, invoices, nodes, edges: [...edges.values()].filter(item => records.has(item.source) && records.has(item.target)),
    openDocuments, warnings: [...warnings] };
}

const withBudget = (fn, budget = REQUEST_BUDGET_MS) => (...args) => requestScope.run({ deadline: Date.now() + budget, signal: args[1]?.signal }, () => fn(...args));
module.exports = { search: withBudget(search), review: withBudget(review, REVIEW_BUDGET_MS), _test: { readPages, readOrPages, documentStatus, ledgerStatus, accountNumber, literal, nextEndpoint, DOCUMENTS, SEEDS, SQL_QUERIES } };
