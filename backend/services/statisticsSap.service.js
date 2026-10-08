'use strict';

// Read-only Service Layer reports. Importing this module never registers SQLQueries.
const sap = require('./sap.service');
const sapConfig = require('../config/sap.config');

const SELECT = 'DocEntry,DocNum,DocType,DocDate,TaxDate,DocCurrency,DocTotal,VatSum,DiscountPercent,TotalDiscount,Cancelled,CancelStatus,DocumentStatus,CardCode,U_PCType,U_PCNum,U_PRNum,U_PRName,DocumentLines';
const CATEGORY_GROUPS = Object.freeze({ imagen: [117, 130], laboratorio: [101, 121] });
// Catalog verified through Items on 2026-10-07: specialty consultation fees in
// group 107. Excludes the generic outpatient fee SER0577 and general medicine
// SER0598, as well as supplies, drugs, tests and pre-consultations in that group.
const SPECIALTY_CONSULTATION_CODES = Object.freeze([
  'SER0578', 'SER0579', 'SER0580', 'SER0581', 'SER0582', 'SER0583', 'SER0584', 'SER0585',
  'SER0586', 'SER0587', 'SER0588', 'SER0589', 'SER0590', 'SER0591', 'SER0592', 'SER0593',
  'SER0594', 'SER0595', 'SER0596', 'SER0597', 'SER0599', 'SER0600', 'SER0601', 'SER0602',
  'SER0603', 'SER0604', 'SER0605', 'SER0606', 'SER0607', 'SER0608', 'SER0609', 'SER0610',
  'SER0611', 'SER0612', 'SER0613', 'SER0614', 'SER0615', 'SER0616', 'SER0617', 'SER0618',
  'SER0619', 'SER0620', 'SER0621', 'SER0622', 'SER0623'
]);
// Complete monthly reads were verified with 200 documents per page. Large
// hospital accounts make later pages much larger than an initial sample.
// Prefer controls page size; $top would truncate the report.
const PAGE_SIZE = 200;
const MAX_PAGES = 500;
const MAX_ROWS = 200000;
const REQUEST_TIMEOUT = 90000;
let itemCache;
let pendingItems;
let readInProgress = false;
const waitingReads = [];

function cancelledRead() {
  const error = new Error('La consulta del estadístico se canceló.');
  error.code = 'ABORT_ERR';
  return error;
}

// One shared read slot across exports and history consumers. SAP can otherwise
// queue several large document pages until the smaller catalog read times out.
function acquireRead(signal) {
  if (signal?.aborted) return Promise.reject(cancelledRead());
  return new Promise((resolve, reject) => {
    const waiting = {
      start() {
        signal?.removeEventListener('abort', abort);
        readInProgress = true;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          readInProgress = false;
          waitingReads.shift()?.start();
        });
      }
    };
    const abort = () => {
      const index = waitingReads.indexOf(waiting);
      if (index < 0) return;
      waitingReads.splice(index, 1);
      signal.removeEventListener('abort', abort);
      reject(cancelledRead());
    };
    if (readInProgress) {
      waitingReads.push(waiting);
      signal?.addEventListener('abort', abort, { once: true });
    } else waiting.start();
  });
}

async function readSap(endpoint, headers, options = {}) {
  const release = await acquireRead(options.signal);
  try {
    if (options.signal?.aborted) throw cancelledRead();
    return await sap.get(endpoint, headers, { timeoutMs: REQUEST_TIMEOUT,
      ...(options.signal ? { signal: options.signal } : {}) });
  } finally { release(); }
}

const money = value => Math.round((value + Number.EPSILON) * 100) / 100;
const text = value => String(value ?? '').trim();
const id = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
function number(value, label) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) {
    throw new Error(`No se pudo comprobar ${label} para el estadístico.`);
  }
  return Number(value);
}
function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
function period(input) {
  const { startDate, endDate } = input;
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) throw new Error('Selecciona un periodo de fechas válido.');
  const next = new Date(`${endDate}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { startDate, endDate, endExclusive: next.toISOString().slice(0, 10) };
}

function nextEndpoint(value, entity) {
  const base = new URL(sapConfig.baseUrl);
  const root = base.pathname.replace(/\/$/, '');
  const link = String(value);
  let result;
  if (link.startsWith(`/${entity}?`)) result = link;
  else {
    const parsed = new URL(link, `${base.origin}${root}/`);
    if (parsed.origin !== base.origin || !parsed.pathname.startsWith(`${root}/`)) {
      throw new Error('La fuente devolvió una página fuera de la consulta autorizada.');
    }
    result = parsed.pathname.slice(root.length) + parsed.search;
  }
  if (!result.startsWith(`/${entity}?`)) throw new Error('La fuente cambió la colección durante la consulta.');
  return result;
}

async function readPages(endpoint, entity, options = {}) {
  const rows = [];
  const seenPages = new Set();
  const seenRows = new Set();
  let next = endpoint;
  while (next) {
    if (seenPages.size >= (options.maxPages || MAX_PAGES) || seenPages.has(next)) {
      throw new Error('La consulta no pudo completarse: se alcanzó el límite de páginas o se repitió una página.');
    }
    seenPages.add(next);
    const response = await readSap(next, { Prefer: `odata.maxpagesize=${PAGE_SIZE}` }, options);
    if (!Array.isArray(response?.data?.value)) throw new Error('La fuente devolvió información incompleta para el estadístico.');
    for (const row of response.data.value) {
      const key = entity === 'Items' ? text(row.ItemCode) : id(row.DocEntry);
      if (!key || seenRows.has(key)) throw new Error('La fuente devolvió registros inválidos o repetidos; vuelve a generar el estadístico.');
      seenRows.add(key);
      rows.push(row);
    }
    if (rows.length > MAX_ROWS) throw new Error('El periodo supera el límite de registros. Selecciona un periodo menor.');
    const link = response.data['@odata.nextLink'] || response.data['odata.nextLink'];
    next = link ? nextEndpoint(link, entity) : null;
  }
  return rows;
}

async function getItems(options) {
  const signal = options?.signal;
  if (signal?.aborted) throw cancelledRead();
  if (itemCache && Date.now() - itemCache.at < 10 * 60 * 1000) return itemCache.rows;
  if (!pendingItems || pendingItems.controller.signal.aborted) {
    const entry = { controller: new AbortController(), consumers: 0, done: false, promise: null };
    pendingItems = entry;
    entry.promise = readPages('/Items?$select=ItemCode,ItemName,ItemsGroupCode&$orderby=ItemCode asc', 'Items', { signal: entry.controller.signal })
      .then(rows => { itemCache = { at: Date.now(), rows }; return rows; })
      .finally(() => {
        entry.done = true;
        if (pendingItems === entry) pendingItems = null;
      });
  }
  const entry = pendingItems;
  entry.consumers++;
  // Each report cancels its own wait. The shared read is cancelled only after
  // every consumer leaves, so closing one export cannot break another export.
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      entry.consumers--;
      if (!entry.consumers && !entry.done) entry.controller.abort();
      callback(value);
    };
    const abort = () => finish(reject, cancelledRead());
    signal?.addEventListener('abort', abort, { once: true });
    entry.promise.then(value => finish(resolve, value), error => finish(reject, error));
  });
}

function documentEndpoint(entity, range) {
  // The supplied monthly workbook calls TaxDate "FechaDocumento" for sales orders.
  const dateField = entity === 'Orders' ? 'TaxDate' : 'DocDate';
  const filter = `${dateField} ge '${range.startDate}' and ${dateField} lt '${range.endExclusive}' and Cancelled eq 'tNO'`;
  return `/${entity}?$select=${SELECT}&$filter=${encodeURIComponent(filter)}&$orderby=DocEntry asc`;
}

function distribute(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!weights.length) return [];
  if (sum === 0) {
    if (total !== 0) throw new Error('No se pudo distribuir un importe entre los servicios del documento.');
    return weights.map(() => 0);
  }
  let allocated = 0;
  return weights.map((weight, i) => {
    const amount = i === weights.length - 1 ? money(total - allocated) : money(total * weight / sum);
    allocated = money(allocated + amount);
    return amount;
  });
}

function category(group, code) {
  if (['SER0515', 'SER0533'].includes(code)) return 'choque';
  if (group === 107 && SPECIALTY_CONSULTATION_CODES.includes(code)) return 'consulta';
  return Object.keys(CATEGORY_GROUPS).find(key => CATEGORY_GROUPS[key].includes(group)) || null;
}

function flattenDocuments(documents, entity, items, origins = new Map()) {
  const itemMap = new Map(items.map(item => [text(item.ItemCode), item]));
  const rows = [];
  const headers = [];
  const issues = { missingAccountType: 0, missingDoctor: 0, missingItems: 0, unallocatedDocuments: 0, unlinkedCredits: 0, multiAccountDocuments: 0 };
  const sign = entity === 'CreditNotes' ? -1 : 1;
  const kind = entity === 'Orders' ? 'Orden de venta' : entity === 'Invoices' ? 'Factura' : 'Nota de crédito';
  for (const doc of documents) {
    if (['csYes', 'csCancellation'].includes(doc.CancelStatus)) continue;
    if (['tYES', 'Y', true].includes(doc.Cancelled)) continue;
    if (!['tNO', 'N', false].includes(doc.Cancelled)) throw new Error('No se pudo comprobar si un documento está cancelado.');
    if (!Array.isArray(doc.DocumentLines)) throw new Error('Un documento no incluyó el detalle de sus servicios.');
    const day = text(entity === 'Orders' ? doc.TaxDate : doc.DocDate).slice(0, 10);
    if (!validDate(day)) throw new Error('Un documento no incluyó una fecha válida.');
    const docTotal = number(doc.DocTotal, 'el total del documento');
    const vat = number(doc.VatSum, 'el impuesto del documento');
    const lineTotals = doc.DocumentLines.map(line => number(line.LineTotal, 'el importe de un servicio'));
    const subtotal = lineTotals.reduce((sum, amount) => sum + amount, 0);
    const discount = number(doc.TotalDiscount, 'el descuento del documento');
    const discounts = distribute(discount, lineTotals);
    const taxes = doc.DocumentLines.map(line => number(line.TaxTotal, 'el impuesto de un servicio'));
    const allocatedTaxes = distribute(vat, taxes.some(amount => amount !== 0) ? taxes : lineTotals);
    const difference = money(docTotal - vat - subtotal + discount);
    if (Math.abs(difference) > 0.02) issues.unallocatedDocuments++;
    const ownAccounts = new Set(doc.DocumentLines.map(line => id(line.U_PCNum)).filter(Boolean));
    const multiAccount = ownAccounts.size > 1;
    if (multiAccount) issues.multiAccountDocuments++;
    const headerAccount = id(doc.U_PCNum) || (ownAccounts.size === 1 ? [...ownAccounts][0] : null);
    const header = {
      Fecha: day, FechaContabilizacion: text(doc.DocDate).slice(0, 10), Documento: doc.DocNum,
      DocumentoId: doc.DocEntry, TipoDocumento: kind, EstadoDocumento: doc.DocumentStatus,
      CodigoCliente: text(doc.CardCode), FolioAtencion: multiAccount ? null : headerAccount,
      AtencionesMultiples: multiAccount,
      TipoAtencion: multiAccount ? null : text(doc.U_PCType) || null,
      NumeroMedico: multiAccount ? null : id(doc.U_PRNum),
      Medico: multiAccount ? 'Sin identificar' : text(doc.U_PRName) || 'Sin identificar',
      Moneda: 'MXN', MonedaDocumento: text(doc.DocCurrency),
      TotalOrdenVenta: entity === 'Orders' ? money(docTotal) : null,
      IngresoNeto: money(sign * (docTotal - vat)), IVA: money(sign * vat),
      ImporteTotal: money(sign * docTotal), DiferenciaSinDistribuir: money(sign * difference)
    };
    headers.push(header);
    const lineNumbers = new Set();
    for (const [i, line] of doc.DocumentLines.entries()) {
      if (!Number.isInteger(line.LineNum) || lineNumbers.has(line.LineNum)) throw new Error('El documento devolvió líneas repetidas o sin identificar.');
      lineNumbers.add(line.LineNum);
      const original = entity === 'CreditNotes' && Number(line.BaseType) === 13 ? origins.get(id(line.BaseEntry)) : null;
      const originalLine = original?.DocumentLines?.find(value => Number(value.LineNum) === Number(line.BaseLine));
      if (entity === 'CreditNotes' && !originalLine && (!id(doc.U_PCNum) || !doc.U_PCType)) issues.unlinkedCredits++;
      const account = id(line.U_PCNum) || id(doc.U_PCNum) || id(originalLine?.U_PCNum) || id(original?.U_PCNum);
      // A consolidated header cannot classify another account. Vertical enriches that row by its unique account.
      const canUseHeader = !multiAccount && (!id(line.U_PCNum) || !id(doc.U_PCNum) || id(line.U_PCNum) === id(doc.U_PCNum));
      const canUseOriginal = original && (!account || !id(original.U_PCNum) || account === id(original.U_PCNum));
      const accountType = (canUseHeader && text(doc.U_PCType)) || (canUseOriginal && text(original.U_PCType)) || null;
      const doctorNumber = (canUseHeader && id(doc.U_PRNum)) || (canUseOriginal && id(original.U_PRNum)) || null;
      const doctorName = (canUseHeader && text(doc.U_PRName)) || (canUseOriginal && text(original.U_PRName)) || 'Sin identificar';
      const code = text(line.ItemCode);
      const item = itemMap.get(code);
      const group = item ? number(item.ItemsGroupCode, 'el grupo del servicio') : null;
      if (account && !accountType) issues.missingAccountType++;
      if (account && (!doctorNumber || doctorName === 'Sin identificar')) issues.missingDoctor++;
      const serviceWithoutItem = !code && doc.DocType === 'dDocument_Service';
      if (!item && !serviceWithoutItem) issues.missingItems++;
      const net = money(sign * (lineTotals[i] - discounts[i]));
      if (rows.length >= MAX_ROWS) throw new Error('El periodo supera el límite de servicios. Selecciona un periodo menor.');
      rows.push({ Fecha: day, FolioAtencion: account, TipoAtencion: accountType, Medico: doctorName,
        NumeroMedico: doctorNumber, Codigo: code, Servicio: text(line.ItemDescription) || text(item?.ItemName),
        Grupo: group, Categoria: category(group, code), Documento: doc.DocNum, DocumentoId: doc.DocEntry,
        TipoDocumento: kind, EstadoDocumento: doc.DocumentStatus, CodigoCliente: text(doc.CardCode),
        Linea: line.LineNum, Cantidad: sign * number(line.Quantity, 'la cantidad de un servicio'),
        IngresoNeto: net, IngresoOrden: entity === 'Orders' ? net : null,
        IVA: money(sign * allocatedTaxes[i]), ImporteTotal: money(net + sign * allocatedTaxes[i]),
        Moneda: 'MXN', BaseAtribucion: canUseHeader ? 'Cabecera SAP' : canUseOriginal ? 'Factura de origen SAP' : 'Pendiente de clasificar',
        ServicioSinArticulo: serviceWithoutItem
      });
    }
  }
  const warnings = [];
  if (issues.missingAccountType) warnings.push(`${issues.missingAccountType} servicios con atención vinculada no tienen tipo de atención identificado.`);
  if (issues.missingDoctor) warnings.push(`${issues.missingDoctor} servicios con atención vinculada no tienen médico identificado.`);
  if (issues.missingItems) warnings.push(`${issues.missingItems} servicios no pudieron clasificarse en el catálogo de artículos.`);
  if (issues.unallocatedDocuments) warnings.push(`${issues.unallocatedDocuments} documentos tienen diferencias entre cabecera y servicios; consulta la diferencia sin distribuir.`);
  if (issues.unlinkedCredits) warnings.push(`${issues.unlinkedCredits} líneas de notas de crédito no tienen una factura de origen y atención verificables.`);
  if (issues.multiAccountDocuments) warnings.push(`${issues.multiAccountDocuments} documentos agrupan varias atenciones; su total no se asigna a un único médico y se conserva para conciliación.`);
  return { rows, documents: headers, warnings, issues };
}

async function getFinancialStatistics(input = {}) {
  const range = period(input);
  const options = { signal: input.signal };
  const includeOrders = input.includeOrders !== false;
  // Complete the shared catalog before requesting document pages. Sequential
  // stages also stop immediately on failure instead of leaving sibling queries
  // running after Promise.all has already rejected the report.
  const items = includeOrders || input.includeBilling ? await getItems(options) : [];
  const orders = includeOrders ? await readPages(documentEndpoint('Orders', range), 'Orders', options) : [];
  const result = flattenDocuments(orders, 'Orders', items);
  result.period = range;
  result.source = 'SAP Business One Service Layer';
  result.basis = 'Órdenes de venta vigentes por fecha de documento; servicios netos sin IVA. El total por médico utiliza una vez el total de cada orden, como el archivo mensual.';
  result.categoryGroups = CATEGORY_GROUPS;
  result.specialtyConsultationCodes = SPECIALTY_CONSULTATION_CODES;
  result.summary = {
    orderCount: result.documents.length, lineCount: result.rows.length,
    netAmount: money(result.rows.reduce((sum, row) => sum + row.IngresoNeto, 0)),
    totalOrders: money(result.documents.reduce((sum, row) => sum + row.TotalOrdenVenta, 0)),
    vat: money(result.documents.reduce((sum, row) => sum + row.IVA, 0)),
    unallocated: money(result.documents.reduce((sum, row) => sum + row.DiferenciaSinDistribuir, 0))
  };
  if (input.includeBilling) result.billing = await getBillingStatistics(input, items);
  return result;
}

async function getBillingStatistics(input = {}, existingItems) {
  const range = period(input);
  const options = { signal: input.signal };
  const items = await (existingItems || getItems(options));
  const invoices = await readPages(documentEndpoint('Invoices', range), 'Invoices', options);
  const billed = flattenDocuments(invoices, 'Invoices', items);
  const credits = await readPages(documentEndpoint('CreditNotes', range), 'CreditNotes', options);
  const origins = new Map(invoices.map(doc => [id(doc.DocEntry), doc]));
  const needed = new Set(credits.flatMap(doc => doc.DocumentLines || []).filter(line => Number(line.BaseType) === 13)
    .map(line => id(line.BaseEntry)).filter(value => value && !origins.has(value)));
  if (needed.size > 2000) throw new Error('Demasiadas facturas de origen para conciliar; selecciona un periodo menor.');
  for (const entry of needed) {
    const response = await readSap(`/Invoices(${entry})?$select=${SELECT}`, {}, options);
    if (id(response?.data?.DocEntry) !== entry || !Array.isArray(response.data.DocumentLines)) throw new Error('No se pudo verificar una factura de origen de las notas de crédito.');
    origins.set(entry, response.data);
  }
  const returned = flattenDocuments(credits, 'CreditNotes', items, origins);
  return { rows: [...billed.rows, ...returned.rows], documents: [...billed.documents, ...returned.documents],
    warnings: [...billed.warnings, ...returned.warnings], basis: 'Facturas menos notas de crédito vigentes por fecha de contabilización; importes netos sin IVA.' };
}

module.exports = { getFinancialStatistics, getBillingStatistics, CATEGORY_GROUPS, SPECIALTY_CONSULTATION_CODES,
  _testing: { readPages, nextEndpoint, flattenDocuments, distribute, resetCache: () => { itemCache = null; pendingItems = null; } } };
