'use strict';

const sap = require('./sap.service');
const sapConfig = require('../config/sap.config');
const { dateRange, hospitalToday, addDays, invalid, roundMoney } = require('./statisticsCommon');

const PAGE_SIZE = 1000;
const MAX_PAGES = 2000;
const MAX_LINES = 300000;
const REQUEST_TIMEOUT = 90000;
const HEADERS = ['DocEntry', 'DocNum', 'DocDate', 'DocType', 'DocumentStatus', 'Cancelled',
  'CancelStatus', 'DocCurrency', 'DocTotal', 'VatSum', 'TotalDiscount'];
const FIELDS = ['DocEntry', 'LineNum', 'ItemCode', 'ItemDescription', 'Quantity', 'InventoryQuantity',
  'LineTotal', 'TaxTotal', 'RemainingOpenQuantity', 'RemainingOpenInventoryQuantity', 'OpenAmount',
  'LineStatus', 'BaseType', 'BaseEntry', 'BaseLine'];
const FINANCIAL_FIELDS = ['DocEntry', 'LineNum', 'ItemCode', 'ItemDescription', 'Quantity', 'LineTotal', 'TaxTotal'];
const LINK_FIELDS = ['DocEntry', 'LineNum', 'BaseType', 'BaseEntry', 'BaseLine', 'Quantity', 'InventoryQuantity'];
const LINK_HEADERS = ['DocEntry', 'DocNum', 'DocDate', 'Cancelled', 'CancelStatus'];
const BLOOD_BANK = Object.freeze({ groupCode: 105, groupName: 'BANCO DE SANGRE' });
const key = (document, line) => `${document}:${line}`;
const isOpen = value => ['O', 'bost_Open'].includes(value);
const isClosed = value => ['C', 'bost_Close'].includes(value);
const isService = value => ['S', 'dDocument_Service'].includes(value);
const noCancel = doc => ['N', 'tNO', false].includes(doc.Cancelled) &&
  !['Y', 'C', 'csYes', 'csCancellation'].includes(doc.CancelStatus);
const text = value => String(value ?? '').trim();
function num(value, field) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) {
    throw new Error(`No se pudo comprobar el campo numérico ${field}.`);
  }
  return Number(value);
}
function cancelled() {
  return Object.assign(new Error('La consulta de ventas se canceló.'), { code: 'ABORT_ERR' });
}
function ensureActive(signal) { if (signal?.aborted) throw cancelled(); }
function reportRange(input, today = hospitalToday()) {
  const range = dateRange(input.startDate, input.endDate, { activeOnly: false, maxDays: 366 });
  if (range.endDate > today) throw invalid('La fecha final no puede ser posterior a hoy.');
  return range;
}
function monthsFor(range) {
  const result = [];
  for (let day = `${range.startDate.slice(0, 7)}-01`; day <= range.endDate;) {
    const date = new Date(`${day}T00:00:00Z`);
    const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
    const last = addDays(next, -1);
    const startDate = day < range.startDate ? range.startDate : day;
    const endDate = last > range.endDate ? range.endDate : last;
    result.push({ key: day.slice(0, 7), label: new Intl.DateTimeFormat('es-MX', {
      month: 'long', year: 'numeric', timeZone: 'UTC'
    }).format(date), startDate, endDate, partial: startDate !== day || endDate !== last });
    day = next;
  }
  return result;
}

function projectionEndpoint(entity, range, predicate = '', options = {}) {
  const lines = `${entity}/DocumentLines`;
  const upper = options.endExclusive || range.endExclusive;
  const params = new URLSearchParams({
    '$expand': `${entity}($select=${(options.headers || HEADERS).join(',')}),${lines}($select=${(options.fields || FIELDS).join(',')})`,
    '$filter': `${entity}/DocEntry eq ${lines}/DocEntry${options.noLowerBound ? '' : ` and ${entity}/DocDate ge '${range.startDate}'`} and ${entity}/DocDate lt '${upper}' and ${entity}/Cancelled eq 'tNO'${predicate ? ` and (${predicate})` : ''}`,
    '$orderby': `${entity}/DocEntry asc,${lines}/LineNum asc`
  });
  return `/$crossjoin(${entity},${lines})?${params}`;
}
function nextEndpoint(value, collection) {
  const base = new URL(sapConfig.baseUrl.replace(/\/$/, '') + '/');
  const link = String(value);
  let parsed;
  if (link.startsWith(`/${collection}?`)) parsed = new URL(link.slice(1), base);
  else parsed = new URL(link, base);
  if (parsed.origin !== base.origin || !parsed.pathname.startsWith(base.pathname)) {
    throw new Error('La fuente devolvió una página fuera de la consulta autorizada.');
  }
  const relative = decodeURIComponent(parsed.pathname.slice(base.pathname.length));
  if (relative !== collection) throw new Error('La fuente cambió la colección durante la consulta.');
  return '/' + relative + parsed.search;
}
async function readPages(endpoint, entity, options = {}) {
  const rows = [], seenRows = new Set(), seenPages = new Set();
  const collection = entity === 'Items' ? 'Items' : `$crossjoin(${entity},${entity}/DocumentLines)`;
  let next = endpoint;
  while (next) {
    ensureActive(options.signal);
    if (seenPages.size >= MAX_PAGES || seenPages.has(next)) throw new Error('La consulta no pudo completar todas sus páginas.');
    seenPages.add(next);
    const response = await sap.get(next, { Prefer: `odata.maxpagesize=${PAGE_SIZE}` }, {
      timeoutMs: REQUEST_TIMEOUT, ...(options.signal ? { signal: options.signal } : {})
    });
    ensureActive(options.signal);
    if (!Array.isArray(response?.data?.value)) throw new Error('La fuente devolvió una consulta incompleta.');
    for (const raw of response.data.value) {
      let identity, row;
      if (entity === 'Items') {
        identity = text(raw.ItemCode); row = raw;
        if (!identity || !Number.isSafeInteger(raw.ItemsGroupCode)) throw new Error('El catálogo devolvió un artículo sin identificar.');
      } else {
        const document = raw[entity], line = raw[`${entity}/DocumentLines`];
        if (!document || !line || !Number.isSafeInteger(document.DocEntry) || document.DocEntry < 1 ||
          !Number.isSafeInteger(line.LineNum) || line.LineNum < 0 || document.DocEntry !== line.DocEntry) {
          throw new Error('La fuente devolvió una línea sin identificar.');
        }
        const date = text(document.DocDate).slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) ||
          new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Un documento no incluyó una fecha válida.');
        if (!['N', 'tNO', false].includes(document.Cancelled)) throw new Error('No se pudo comprobar si el documento está vigente.');
        if (!noCancel(document)) continue;
        identity = key(document.DocEntry, line.LineNum);
        row = { document, line };
      }
      if (seenRows.has(identity)) throw new Error('La fuente repitió una línea; el reporte no está completo.');
      seenRows.add(identity); rows.push(row);
      if (rows.length > MAX_LINES) throw new Error('El periodo supera el límite de líneas. Selecciona un periodo menor.');
    }
    const link = response.data['@odata.nextLink'] || response.data['odata.nextLink'];
    next = link ? nextEndpoint(link, collection) : null;
  }
  return { entity, rows };
}
async function readProjection(entity, range, predicate, options = {}) {
  return readPages(projectionEndpoint(entity, range, predicate, options), entity, options);
}
function docTotals(rows) {
  const result = new Map();
  for (const { document, line } of rows) {
    if (!result.has(document.DocEntry)) result.set(document.DocEntry, { subtotal: 0, taxWeights: 0 });
    const value = result.get(document.DocEntry);
    value.subtotal += num(line.LineTotal, 'LineTotal');
    value.taxWeights += num(line.TaxTotal, 'TaxTotal');
  }
  return result;
}
function bounds(rows) {
  let min = Infinity, max = -Infinity;
  for (const row of rows) { min = Math.min(min, row.document.DocEntry); max = Math.max(max, row.document.DocEntry); }
  return rows.length ? { min, max } : null;
}
function inBounds(prefix, bound) {
  return bound ? `${prefix}/BaseEntry ge ${bound.min} and ${prefix}/BaseEntry le ${bound.max}` : 'false';
}
function sumAdd(map, id, value) { map.set(id, (map.get(id) || 0) + value); }

function flattenBilling(source) {
  const totals = docTotals(source.rows), sign = source.entity === 'CreditNotes' ? -1 : 1;
  const rows = [], documents = [], seenHeaders = new Set();
  for (const { document: doc, line } of source.rows) {
    if (!noCancel(doc)) continue;
    const total = totals.get(doc.DocEntry), discount = num(doc.TotalDiscount, 'TotalDiscount');
    if (!total.subtotal && discount) throw new Error('No se pudo distribuir el descuento del documento.');
    const lineTotal = num(line.LineTotal, 'LineTotal');
    const netAmount = sign * (lineTotal - (total.subtotal ? discount * lineTotal / total.subtotal : 0));
    rows.push({ code: text(line.ItemCode), description: text(line.ItemDescription),
      month: text(doc.DocDate).slice(0, 7), quantity: sign * num(line.Quantity, 'Quantity'), netAmount });
    if (!seenHeaders.has(doc.DocEntry)) {
      seenHeaders.add(doc.DocEntry);
      const headerNet = sign * (num(doc.DocTotal, 'DocTotal') - num(doc.VatSum, 'VatSum'));
      documents.push({ month: text(doc.DocDate).slice(0, 7), headerNet,
        difference: headerNet - sign * (total.subtotal - discount), vat: sign * num(doc.VatSum, 'VatSum'),
        total: sign * num(doc.DocTotal, 'DocTotal'), currency: text(doc.DocCurrency),
        entity: source.entity, document: doc.DocNum });
    }
  }
  return { rows, documents };
}
function buildPending(orders, deliveries, invoices, returns, range) {
  const orderMap = new Map(orders.rows.map(r => [key(r.document.DocEntry, r.line.LineNum), r]));
  const deliveryMap = new Map(deliveries.rows.map(r => [key(r.document.DocEntry, r.line.LineNum), r]));
  const returnMap = new Map(returns.rows.map(r => [key(r.document.DocEntry, r.line.LineNum), r]));
  const deliveredByOrder = new Map(), invoicedOrder = new Map(), invoicedDelivery = new Map();
  const invoiceReferencesByOrder = new Map(), invoiceReferencesByDelivery = new Map();
  const returnedDelivery = new Map(), returnedOrder = new Map();
  const audit = { directInvoiceLines: 0, viaDeliveryInvoiceLines: 0, invoiceLinksOutsideSelection: 0,
    deliveryLinksOutsideSelection: 0, returnLines: 0, pendingOrderLines: 0, pendingDeliveryLines: 0,
    excludedClosedLines: 0, excludedReserveInvoiceDeliveryLines: 0, reserveInvoiceDeliveryControls: [],
    unusualDeliveryBaseLines: [], chainedDeliveryLines: 0, returnBasedDeliveryLines: 0,
    closedResiduals: [], openQuantityDifferences: [], nonMxDocuments: [], zeroQuantityAmountLines: [],
    quantityUnitDifferences: [], serviceOpenAmountLines: 0, serviceQuantityControlsNotApplicable: 0,
    sourceAmountReconciliation: {}, documentAmountDifferences: [],
    openQuantityOverlapControls: [],
    invoicesMatched: invoices.rows.length, sourceLines: { orders: orders.rows.length,
      deliveries: deliveries.rows.length, invoices: invoices.rows.length, returns: returns.rows.length } };
  for (const { document: d, line: l } of deliveries.rows) {
    if (Number(l.BaseType) !== 17) continue;
    const id = key(l.BaseEntry, l.BaseLine);
    if (orderMap.has(id)) sumAdd(deliveredByOrder, id, num(l.InventoryQuantity, 'delivery InventoryQuantity'));
    else audit.deliveryLinksOutsideSelection++;
  }
  for (const { document: d, line: l } of invoices.rows) {
    const id = key(l.BaseEntry, l.BaseLine), quantity = num(l.InventoryQuantity, 'invoice InventoryQuantity');
    const reference = { documentId: d.DocEntry, document: d.DocNum, date: d.DocDate, line: l.LineNum,
      quantity: l.Quantity, inventoryQuantity: l.InventoryQuantity };
    if (Number(l.BaseType) === 17 && orderMap.has(id)) {
      sumAdd(invoicedOrder, id, quantity); audit.directInvoiceLines++;
      if (!invoiceReferencesByOrder.has(id)) invoiceReferencesByOrder.set(id, []);
      invoiceReferencesByOrder.get(id).push(reference);
    }
    else if (Number(l.BaseType) === 15 && deliveryMap.has(id)) {
      sumAdd(invoicedDelivery, id, quantity); audit.viaDeliveryInvoiceLines++;
      if (!invoiceReferencesByDelivery.has(id)) invoiceReferencesByDelivery.set(id, []);
      invoiceReferencesByDelivery.get(id).push(reference);
    }
    else audit.invoiceLinksOutsideSelection++;
  }
  for (const { line: l } of returns.rows) {
    const id = key(l.BaseEntry, l.BaseLine);
    if (Number(l.BaseType) !== 15 || !deliveryMap.has(id)) continue;
    const amount = num(l.InventoryQuantity, 'return InventoryQuantity');
    sumAdd(returnedDelivery, id, amount);
    const source = deliveryMap.get(id).line;
    if (Number(source.BaseType) === 17 && orderMap.has(key(source.BaseEntry, source.BaseLine))) sumAdd(returnedOrder, key(source.BaseEntry, source.BaseLine), amount);
    audit.returnLines++;
  }
  function deliveryOrigin(line, chain = new Set()) {
    const baseType = Number(line.BaseType);
    if ([-1, 17, 23].includes(baseType)) return { kind: 'unbilled', ancestorBaseType: baseType };
    if (baseType === 13) return { kind: 'invoiced', invoiceId: line.BaseEntry, invoiceLine: line.BaseLine };
    if (![15, 16].includes(baseType)) return { kind: 'review', reason: `No se comprobó el tipo de documento de origen de esta entrega (tipo ${line.BaseType}).` };
    const id = `${baseType}:${key(line.BaseEntry, line.BaseLine)}`;
    if (chain.has(id)) return { kind: 'review', reason: 'La cadena de documentos se repite y no permite comprobar el origen de la entrega.' };
    const nextChain = new Set(chain); nextChain.add(id);
    const ancestor = (baseType === 15 ? deliveryMap : returnMap).get(key(line.BaseEntry, line.BaseLine));
    if (!ancestor) return { kind: 'review', reason: 'El documento de origen está fuera de la información consultada; falta comprobar si la entrega ya proviene de una factura.' };
    if (baseType === 16 && Number(ancestor.line.BaseType) !== 15) return { kind: 'review', reason: 'La entrega proviene de una devolución cuyo documento de origen requiere revisión.' };
    if (baseType === 16) {
      const original = deliveryMap.get(key(ancestor.line.BaseEntry, ancestor.line.BaseLine));
      if (!original) return { kind: 'review', reason: 'No se encontró la entrega original de la devolución para comprobar su facturación.' };
      return deliveryOrigin(original.line, nextChain);
    }
    return deliveryOrigin(ancestor.line, nextChain);
  }
  const rows = [], reviewRows = [], pendingDocumentIds = new Set();
  const currencies = new Map();
  for (const source of [orders, deliveries]) {
    const totals = docTotals(source.rows), entity = source.entity;
    const headers = new Map(source.rows.map(r => [r.document.DocEntry, r.document]));
    const moneyControl = { documents: headers.size, headerNet: 0, linesNet: 0, unallocated: 0, differentDocuments: 0 };
    for (const d of headers.values()) {
      const headerNet = num(d.DocTotal, 'DocTotal') - num(d.VatSum, 'VatSum');
      const linesNet = totals.get(d.DocEntry).subtotal - num(d.TotalDiscount, 'TotalDiscount');
      const difference = headerNet - linesNet;
      moneyControl.headerNet += headerNet; moneyControl.linesNet += linesNet; moneyControl.unallocated += difference;
      if (Math.abs(difference) > 0.02000001) {
        moneyControl.differentDocuments++;
        audit.documentAmountDifferences.push({ entity, documentId: d.DocEntry, document: d.DocNum, difference });
      }
    }
    audit.sourceAmountReconciliation[entity] = moneyControl;
    for (const { document: d, line: l } of source.rows) {
      const id = key(d.DocEntry, l.LineNum), q = num(l.Quantity, 'Quantity'), invQ = num(l.InventoryQuantity, 'InventoryQuantity');
      const open = num(l.RemainingOpenQuantity, 'RemainingOpenQuantity'), openInv = num(l.RemainingOpenInventoryQuantity, 'RemainingOpenInventoryQuantity');
      const openStatus = isOpen(l.LineStatus), closedStatus = isClosed(l.LineStatus);
      if (!openStatus && !closedStatus) throw new Error('Unknown line status.');
      const residual = entity === 'Orders'
        ? invQ - (invoicedOrder.get(id) || 0) - (deliveredByOrder.get(id) || 0) + (returnedOrder.get(id) || 0) - openInv
        : invQ - (invoicedDelivery.get(id) || 0) - (returnedDelivery.get(id) || 0) - openInv;
      if (isService(d.DocType)) audit.serviceQuantityControlsNotApplicable++;
      else if (Math.abs(residual) > 0.00001) {
        const issue = { entity, document: d.DocNum, documentId: d.DocEntry, line: l.LineNum, quantity: invQ,
          openQuantity: openInv, residual, sourceStatus: l.LineStatus };
        (closedStatus ? audit.closedResiduals : audit.openQuantityDifferences).push(issue);
      }
      if (closedStatus) { audit.excludedClosedLines++; continue; }
      if (!isOpen(d.DocumentStatus)) throw new Error('An open line was found inside a closed document.');
      if (String(d.DocDate).slice(0, 10) < range.startDate || String(d.DocDate).slice(0, 10) > range.endDate) continue;
      let sourceOrigin = { kind: 'unbilled' };
      if (entity === 'DeliveryNotes') {
        sourceOrigin = deliveryOrigin(l);
        if (Number(l.BaseType) === 15) audit.chainedDeliveryLines++;
        if (Number(l.BaseType) === 16) audit.returnBasedDeliveryLines++;
        if (sourceOrigin.kind === 'invoiced') {
          audit.excludedReserveInvoiceDeliveryLines++;
          audit.reserveInvoiceDeliveryControls.push({ documentId: d.DocEntry, line: l.LineNum, baseType: l.BaseType,
            invoiceId: sourceOrigin.invoiceId, invoiceLine: sourceOrigin.invoiceLine, openQuantity: open });
          continue;
        }
        if (sourceOrigin.kind === 'review') audit.unusualDeliveryBaseLines.push({ documentId: d.DocEntry,
          line: l.LineNum, baseType: l.BaseType, openQuantity: open, reason: sourceOrigin.reason });
      }
      const total = totals.get(d.DocEntry), lineTotal = num(l.LineTotal, 'LineTotal');
      let ratio = 0, pendingQuantity = open, pendingBase = 0;
      if (isService(d.DocType)) {
        audit.serviceOpenAmountLines++;
        pendingBase = num(l.OpenAmount, 'service OpenAmount');
        ratio = lineTotal ? pendingBase / lineTotal : (open > 0 ? 1 : 0);
        pendingQuantity = q * ratio;
      } else {
        if (!q && (open || lineTotal)) {
          audit.zeroQuantityAmountLines.push({ entity, documentId: d.DocEntry, line: l.LineNum, quantity: q, open, lineTotal });
          const discount = num(d.TotalDiscount, 'TotalDiscount');
          if (!total.subtotal && discount) throw new Error('No se pudo distribuir el descuento del documento.');
          reviewRows.push({ entity, documentId: d.DocEntry, line: l.LineNum, document: d.DocNum,
            date: String(d.DocDate).slice(0, 10), month: String(d.DocDate).slice(0, 7),
            code: text(l.ItemCode), description: text(l.ItemDescription), quantity: 0,
            netAmount: lineTotal - (total.subtotal ? discount * lineTotal / total.subtotal : 0),
            reason: 'La partida tiene importe con cantidad cero; requiere revisar el saldo antes de sumarla como no facturada.', linkedInvoices: [] });
          continue;
        }
        ratio = q ? open / q : 0;
        pendingBase = lineTotal * ratio;
      }
      if (Math.abs(openInv - invQ * ratio) > 0.00001 && !isService(d.DocType)) audit.quantityUnitDifferences.push({ entity, documentId: d.DocEntry, line: l.LineNum, quantity: q, invQ, open, openInv });
      if (ratio < -0.00001 || ratio > 1.00001) throw new Error('Pending quantity exceeds its source line.');
      if (Math.abs(pendingQuantity) <= 0.00000001 && Math.abs(pendingBase) <= 0.00000001) continue;
      const discount = num(d.TotalDiscount, 'TotalDiscount');
      if (!total.subtotal && discount) throw new Error('Cannot prorate document discount.');
      const pendingDiscount = total.subtotal ? discount * pendingBase / total.subtotal : 0;
      const taxWeight = total.taxWeights ? num(l.TaxTotal, 'TaxTotal') / total.taxWeights : total.subtotal ? lineTotal / total.subtotal : 0;
      const vat = num(d.VatSum, 'VatSum') * taxWeight * ratio;
      const netAmount = pendingBase - pendingDiscount;
      const output = { month: String(d.DocDate).slice(0, 7), date: String(d.DocDate).slice(0, 10),
        code: String(l.ItemCode || '').trim(), description: String(l.ItemDescription || '').trim(),
        quantity: pendingQuantity, netAmount, vat, total: netAmount + vat, currency: 'MXN',
        documentCurrency: d.DocCurrency, document: d.DocNum, documentId: d.DocEntry, line: l.LineNum,
        entity, sourceQuantity: q, openQuantity: open, sourceInventoryQuantity: invQ, openInventoryQuantity: openInv,
        baseType: l.BaseType, baseEntry: l.BaseEntry, baseLine: l.BaseLine,
        basis: entity === 'Orders' ? 'Saldo actual abierto de orden, aún no transferido a entrega/factura; fecha contable DocDate de orden.'
          : 'Saldo actual abierto de entrega pendiente de factura; fecha contable DocDate de entrega.' };
      if (!isService(d.DocType) && residual < -0.00001 && openInv > 0) {
        const capacityInv = Math.max(0, openInv + residual);
        const safeFraction = Math.min(1, capacityInv / openInv);
        const reviewFraction = 1 - safeFraction;
        const invoiceReferences = (entity === 'Orders' ? invoiceReferencesByOrder : invoiceReferencesByDelivery).get(id) || [];
        const scaled = (row, fraction) => ({ ...row, quantity: row.quantity * fraction,
          netAmount: row.netAmount * fraction, vat: row.vat * fraction, total: row.total * fraction });
        const reason = invoiceReferences.length
          ? 'SAP conserva un saldo abierto, pero existen facturas vigentes enlazadas que ya cubren esta cantidad. Se separa para revisar el estado de la orden y evitar sumarla también como no facturada.'
          : 'SAP conserva un saldo abierto mayor que la cantidad sin transferir a documentos posteriores. Se separa para revisar la cadena y evitar duplicar el remanente.';
        const review = { ...scaled(output, reviewFraction), reason, linkedInvoices: invoiceReferences,
          basis: 'Saldo abierto mostrado por SAP que se solapa con documentos posteriores; separado del total no facturado hasta revisar el estado.' };
        reviewRows.push(review);
        audit.openQuantityOverlapControls.push({ entity, documentId: d.DocEntry, document: d.DocNum, line: l.LineNum,
          reportedOpenInventoryQuantity: openInv, safeOpenInventoryQuantity: capacityInv,
          reviewQuantity: review.quantity, reviewNetAmount: review.netAmount, linkedInvoices: invoiceReferences });
        if (safeFraction <= 0.00000001) continue;
        Object.assign(output, scaled(output, safeFraction));
      }
      if (sourceOrigin.kind === 'review') {
        reviewRows.push({ ...output, reason: sourceOrigin.reason });
        continue;
      }
      rows.push(output);
      pendingDocumentIds.add(`${entity}:${d.DocEntry}`);
      currencies.set(`${entity}:${d.DocEntry}`, d.DocCurrency);
      if (entity === 'Orders') audit.pendingOrderLines++; else audit.pendingDeliveryLines++;
    }
  }
  for (const [document, currency] of currencies) if (currency !== 'MXN') audit.nonMxDocuments.push({ document, currency });
  const warnings = [
    'Los importes rojos son saldos abiertos actuales de órdenes y entregas, después de descuentos y sin IVA.',
    'La facturación verde se agrupa por fecha contable. Los saldos rojos se agrupan por la fecha contable de la orden o entrega de origen; son saldos actuales y no reconstruyen el cierre histórico de cada mes.',
    'Una nota de crédito no se transforma automáticamente en pendiente: el remanente depende del estado y cantidad abiertos que conserva SAP.',
    'No se infieren enlaces entre una factura independiente y una orden por coincidencia de artículo, descripción o paciente.'
  ];
  if (audit.closedResiduals.length) warnings.push(`${audit.closedResiduals.length} líneas cerradas conservan cantidades no explicadas por facturas/entregas/devoluciones enlazadas; quedan fuera del saldo activo y requieren revisar cierre manual u otros vínculos.`);
  if (audit.openQuantityDifferences.length) warnings.push(`${audit.openQuantityDifferences.length} partidas abiertas tienen diferencias de cantidades frente a sus documentos vinculados. Los saldos que se solapan con facturas o transferencias se separan en Por revisar, fuera del total no facturado.`);
  if (audit.unusualDeliveryBaseLines.length) warnings.push(`${audit.unusualDeliveryBaseLines.length} partidas de entregas abiertas tienen un origen sin comprobar. Se conservan en Por revisar y no se suman como no facturadas.`);
  if (audit.zeroQuantityAmountLines.length) warnings.push(`${audit.zeroQuantityAmountLines.length} partidas con cantidad cero e importe requieren revisar su saldo; se conservan en Por revisar.`);
  if (audit.quantityUnitDifferences.length) warnings.push(`${audit.quantityUnitDifferences.length} líneas presentan conversiones de cantidad que no coinciden proporcionalmente; revisar unidades.`);
  if (audit.documentAmountDifferences.length) warnings.push(`${audit.documentAmountDifferences.length} documentos de origen tienen diferencias monetarias entre cabecera y líneas; esas diferencias no se reparten a artículos.`);
  return { schemaVersion: 1, complete: true, startDate: range.startDate, endDate: range.endDate, extractedAt: new Date().toISOString(),
    source: 'SAP Business One Service Layer: Orders/DocumentLines, DeliveryNotes/DocumentLines, Invoices/DocumentLines, Returns/DocumentLines',
    basis: 'Saldo actual abierto por línea de orden o entrega vigente; filtro y mes por DocDate. Las entregas basadas en factura de reserva se excluyen. Importes locales MXN netos sin IVA.',
    rows, reviewRows, warnings, controls: { ...audit, requiresReview: reviewRows.length > 0 || audit.zeroQuantityAmountLines.length > 0,
      pendingDocuments: pendingDocumentIds.size, pendingLines: rows.length,
      reviewLines: reviewRows.length, reviewQuantity: reviewRows.reduce((s, r) => s + r.quantity, 0),
      reviewNetAmount: reviewRows.reduce((s, r) => s + r.netAmount, 0),
      pendingQuantity: rows.reduce((s, r) => s + r.quantity, 0), pendingNetAmount: rows.reduce((s, r) => s + r.netAmount, 0) } };
}

function compose(range, items, billed, credited, pending, asOf = new Date().toISOString()) {
  const months = monthsFor(range), catalog = new Map(items.rows.map(item => [text(item.ItemCode), item]));
  const rows = new Map();
  const monthly = months.map(month => ({ month: month.key, billedQuantity: 0, billedNet: 0,
    pendingQuantity: 0, pendingNet: 0, cumulativeBilled: 0, cumulativePending: 0,
    headerNet: 0, difference: 0, vat: 0, total: 0, invoices: 0, creditNotes: 0 }));
  const monthlyMap = new Map(monthly.map(month => [month.month, month]));
  const warnings = [...pending.warnings];
  let unknownCodes = 0;
  function add(line, status) {
    if (!monthlyMap.has(line.month)) throw new Error('La fuente devolvió una fecha fuera del periodo solicitado.');
    const item = catalog.get(line.code), description = text(item?.ItemName) || line.description || 'Concepto sin descripción';

    const id = JSON.stringify([line.code, line.code ? '' : description, status]);
    if (!rows.has(id)) {
      const groupCode = item ? item.ItemsGroupCode : null;
      if (line.code && !item) unknownCodes++;
      rows.set(id, { id, code: line.code, description, status, groupCode, isBloodBank: groupCode === BLOOD_BANK.groupCode,
        months: months.map(month => ({ key: month.key, quantity: 0, netAmount: 0 })), quantity: 0, netAmount: 0 });
    }
    const row = rows.get(id), value = row.months.find(month => month.key === line.month);
    value.quantity += line.quantity; value.netAmount += line.netAmount;
    row.quantity += line.quantity; row.netAmount += line.netAmount;
    const month = monthlyMap.get(line.month);
    if (status === 'FACTURADA') { month.billedQuantity += line.quantity; month.billedNet += line.netAmount; }
    else { month.pendingQuantity += line.quantity; month.pendingNet += line.netAmount; }
  }
  for (const line of [...billed.rows, ...credited.rows]) add(line, 'FACTURADA');
  for (const line of pending.rows) add(line, 'NO_FACTURADA');
  let differingDocuments = 0, foreignDocuments = 0;
  for (const document of [...billed.documents, ...credited.documents]) {
    const month = monthlyMap.get(document.month);
    if (!month) throw new Error('La fuente devolvió un documento fuera del periodo solicitado.');
    month.headerNet += document.headerNet; month.difference += document.difference;
    month.vat += document.vat; month.total += document.total;
    month[document.entity === 'Invoices' ? 'invoices' : 'creditNotes']++;
    if (Math.abs(roundMoney(document.difference)) > 0.02) differingDocuments++;
    if (document.currency !== 'MXN') foreignDocuments++;
  }
  if (differingDocuments) warnings.push(`${differingDocuments} documentos facturados tienen una diferencia entre cabecera y líneas. La diferencia se muestra en la conciliación mensual y no se asigna a artículos.`);
  if (foreignDocuments || pending.controls.nonMxDocuments.length) warnings.push('Hay documentos en moneda extranjera. El reporte utiliza los importes contables locales en MXN; no suma importes expresados en monedas distintas.');
  if (unknownCodes) warnings.push(`${unknownCodes} conceptos no pudieron clasificarse en el catálogo actual. Se conservan en el total general sin atribuirlos a Banco de Sangre.`);
  let cumulativeBilled = 0, cumulativePending = 0;
  for (const month of monthly) {
    cumulativeBilled += month.billedNet; cumulativePending += month.pendingNet;
    month.cumulativeBilled = cumulativeBilled; month.cumulativePending = cumulativePending;
  }
  const resultRows = [...rows.values()].sort((a, b) => a.code.localeCompare(b.code, 'es') ||
    a.description.localeCompare(b.description, 'es') || a.status.localeCompare(b.status));
  const reviewRows = pending.reviewRows.map((line, index) => {
    const item = catalog.get(line.code);
    return { id: `${line.entity}:${line.documentId}:${line.line}:${index}`, code: line.code,
      description: line.description || text(item?.ItemName) || 'Concepto sin descripción',
      date: line.date, month: line.month, quantity: line.quantity, netAmount: line.netAmount,
      document: line.document, entity: line.entity, reason: line.reason, linkedInvoices: line.linkedInvoices || [],
      groupCode: item?.ItemsGroupCode ?? null, isBloodBank: item?.ItemsGroupCode === BLOOD_BANK.groupCode };
  });
  return { complete: true,
    source: 'SAP Business One Service Layer: facturas y notas de crédito vigentes; órdenes y entregas abiertas; catálogo de artículos. Importes contables locales MXN sin IVA.',
    period: { startDate: range.startDate, endDate: range.endDate, asOf, months }, rows: resultRows,
    summary: {
      billedQuantity: monthly.reduce((sum, month) => sum + month.billedQuantity, 0),
      billedNet: monthly.reduce((sum, month) => sum + month.billedNet, 0),
      pendingQuantity: monthly.reduce((sum, month) => sum + month.pendingQuantity, 0),
      pendingNet: monthly.reduce((sum, month) => sum + month.pendingNet, 0),
      reviewQuantity: reviewRows.reduce((sum, row) => sum + row.quantity, 0),
      reviewNet: reviewRows.reduce((sum, row) => sum + row.netAmount, 0),
      itemCount: new Set(resultRows.map(row => JSON.stringify([row.code, row.code ? '' : row.description]))).size,
      rowCount: resultRows.length
    }, monthly, reviewRows, warnings: [...new Set(warnings)], bloodBank: BLOOD_BANK };
}

async function getHospitalSales(input = {}, options = {}) {
  const range = reportRange(input), readOptions = { signal: options.signal || input.signal };
  ensureActive(readOptions.signal);
  const items = await readPages('/Items?$select=ItemCode,ItemName,ItemsGroupCode&$orderby=ItemCode asc', 'Items', readOptions);
  const financial = { ...readOptions, fields: FINANCIAL_FIELDS };
  const billed = flattenBilling(await readProjection('Invoices', range, '', financial));
  const credited = flattenBilling(await readProjection('CreditNotes', range, '', financial));

  const orders = await readProjection('Orders', range, '', readOptions);
  const orderBounds = bounds(orders.rows), dl = 'DeliveryNotes/DocumentLines';
  const linkEnd = addDays(hospitalToday(), 1);
  const deliveries = await readProjection('DeliveryNotes', range,
    `(DeliveryNotes/DocDate ge '${range.startDate}' and DeliveryNotes/DocDate lt '${range.endExclusive}') or (${dl}/BaseType eq 17 and ${inBounds(dl, orderBounds)})`,
    { ...readOptions, noLowerBound: true, endExclusive: linkEnd });
  const deliveryBounds = bounds(deliveries.rows), il = 'Invoices/DocumentLines', rl = 'Returns/DocumentLines';
  const linkOptions = { ...readOptions, noLowerBound: true, endExclusive: linkEnd, fields: LINK_FIELDS, headers: LINK_HEADERS };
  const empty = entity => ({ entity, rows: [] });
  const invoiceLinks = orderBounds || deliveryBounds ? await readProjection('Invoices', range,
    `(${il}/BaseType eq 17 and ${inBounds(il, orderBounds)}) or (${il}/BaseType eq 15 and ${inBounds(il, deliveryBounds)})`, linkOptions) : empty('Invoices');
  const returns = deliveryBounds ? await readProjection('Returns', range,
    `${rl}/BaseType eq 15 and ${inBounds(rl, deliveryBounds)}`, linkOptions) : empty('Returns');
  const pending = buildPending(orders, deliveries, invoiceLinks, returns, range);
  ensureActive(readOptions.signal);
  return compose(range, items, billed, credited, pending);
}

module.exports = { getHospitalSales, _testing: { reportRange, monthsFor, projectionEndpoint,
  nextEndpoint, readPages, flattenBilling, buildPending, compose } };

