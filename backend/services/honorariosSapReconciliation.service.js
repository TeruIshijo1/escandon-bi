'use strict';

const sapService = require('./sap.service');
const sapConfig = require('../config/sap.config');

const IS_TEST = process.env.NODE_ENV === 'test';
const PAGE_SIZE = IS_TEST ? 200 : 500;
const MAX_PAGES = 500;
const MAX_SERVICE_PERIOD_DAYS = 93;
const SAP_LOOKAHEAD_DAYS = 30;
const DEFAULT_TOTAL_TIMEOUT_MS = IS_TEST ? 60 * 1000 : 120 * 1000;
const MAX_REQUEST_TIMEOUT_MS = IS_TEST ? 30 * 1000 : 60 * 1000;
const MASTERS_TTL_MS = 5 * 60 * 1000;
let mastersCache = null;
let mastersInFlight = null;

function sapTimeoutError() {
  return Object.assign(new Error('SAP tardó demasiado en responder. Vuelve a intentar en unos momentos.'), {
    status: 504, code: 'HONORARIOS_SAP_TIMEOUT'
  });
}

function positiveTimeout(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function createSapReadBudget(options = {}) {
  const totalTimeoutMs = positiveTimeout(options.totalTimeoutMs, DEFAULT_TOTAL_TIMEOUT_MS);
  const requestTimeoutMs = Math.min(positiveTimeout(options.requestTimeoutMs, MAX_REQUEST_TIMEOUT_MS), MAX_REQUEST_TIMEOUT_MS);
  const controller = new AbortController();
  const deadline = Date.now() + totalTimeoutMs;
  let failure;
  function abort(error) {
    if (!controller.signal.aborted) {
      failure = error?.code === 'SAP_READ_TIMEOUT' ? sapTimeoutError() : error;
      controller.abort(failure);
    }
    return failure;
  }
  function assertActive() {
    if (controller.signal.aborted) throw failure;
    if (Date.now() >= deadline) throw abort(sapTimeoutError());
  }
  const deadlineTimer = setTimeout(() => abort(sapTimeoutError()), totalTimeoutMs);
  function get(endpoint, headers = {}) {
    assertActive();
    const timeoutMs = Math.min(requestTimeoutMs, deadline - Date.now());

    return new Promise((resolve, reject) => {
      let settled = false;
      let requestTimer;
      const settle = (error, response) => {
        if (settled) return;
        settled = true;
        clearTimeout(requestTimer);
        controller.signal.removeEventListener('abort', onAbort);
        if (error) reject(error);
        else resolve(response);
      };
      const onAbort = () => settle(failure);
      controller.signal.addEventListener('abort', onAbort, { once: true });
      requestTimer = setTimeout(() => abort(sapTimeoutError()), timeoutMs);
      Promise.resolve().then(() => {
        assertActive();
        return sapService.get(endpoint, headers, { signal: controller.signal, timeoutMs });
      }).then(response => {
        try { assertActive(); settle(null, response); }
        catch (error) { settle(error); }
      }, error => settle(abort(error)));
    });
  }
  return { get, abort, assertActive, cleanup: () => clearTimeout(deadlineTimer) };
}

async function loadSapMasters(budget, includeGroups) {
  const [suppliers, withholdingCodes, groups] = await Promise.all([
    fetchAllPagesStrict(`/BusinessPartners?$select=CardCode,CardName,GroupCode,FederalTaxID,U_B1SYS_FiscRegime,SubjectToWithholdingTax,BPWithholdingTaxCollection&$filter=CardType eq 'cSupplier'&$orderby=CardCode asc`, MAX_PAGES, { readBudget: budget }),
    fetchAllPagesStrict('/WithholdingTaxCodes?$select=WTCode,WTName,Rate,BaseType,BaseAmount,Category,EffectiveFrom,Inactive', MAX_PAGES, { readBudget: budget }),
    includeGroups ? fetchAllPagesStrict('/BusinessPartnerGroups?$select=Code,Name', MAX_PAGES, { readBudget: budget }) : Promise.resolve([])
  ]);
  const masters = { suppliers, groups, withholdingCodes, groupsLoaded: includeGroups };
  if (!IS_TEST) mastersCache = { ...masters, expiresAt: Date.now() + MASTERS_TTL_MS };
  return masters;
}

function getSapMasters(budget, includeGroups) {
  if (!IS_TEST && mastersCache && mastersCache.expiresAt > Date.now() && (!includeGroups || mastersCache.groupsLoaded)) {
    return Promise.resolve(mastersCache);
  }
  if (!IS_TEST && mastersInFlight) {
    return mastersInFlight.then(masters => {
      if (!includeGroups || masters.groupsLoaded) return masters;
      return loadSapMasters(budget, true).then(fresh => { mastersCache = fresh; return fresh; });
    });
  }
  const pending = loadSapMasters(budget, includeGroups);
  if (IS_TEST) return pending;
  mastersInFlight = pending;
  return pending.finally(() => {
    if (mastersInFlight === pending) mastersInFlight = null;
  });
}

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function roundMoney(value) {
  return Math.round((asNumber(value) + Number.EPSILON) * 100) / 100;
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundOptional(value) {
  const number = optionalNumber(value);
  return number === null ? null : roundMoney(number);
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeProviderName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\b(DR|DRA|DOCTOR|DOCTORA|MEDICO|MEDICA|LIC|LICENCIADO|LICENCIADA|MTRO|MTRA)\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

function normalizeNextLink(nextLink) {
  const base = new URL(sapConfig.baseUrl);
  const apiPath = base.pathname.replace(/\/$/, '');
  const parsed = new URL(String(nextLink), `${base.origin}${apiPath}/`);
  if (parsed.origin !== base.origin || !(parsed.pathname === apiPath || parsed.pathname.startsWith(`${apiPath}/`))) {
    throw new Error('SAP devolvió un enlace de paginación fuera de Service Layer.');
  }
  const pathWithinApi = parsed.pathname.slice(apiPath.length) || '/';
  return `${pathWithinApi}${parsed.search}`;
}

async function fetchAllPagesStrict(initialEndpoint, maxPages = MAX_PAGES, options = {}) {
  const budget = options.readBudget || createSapReadBudget(options);
  const ownsBudget = !options.readBudget;
  try {
  const values = [];
  let currentEndpoint = initialEndpoint;
  let pageCount = 0;

  while (currentEndpoint) {
    if (pageCount >= maxPages) {
      throw new Error(`La consulta SAP excedió el límite seguro de ${maxPages} páginas.`);
    }
    pageCount += 1;

    const response = await budget.get(currentEndpoint, { Prefer: `odata.maxpagesize=${PAGE_SIZE}` });
    const body = response && response.data;
    if (!body || !Array.isArray(body.value)) {
      throw new Error('SAP devolvió una página incompleta o con formato inesperado; no se calculará como cero.');
    }
    values.push(...body.value);
    const nextLink = body['odata.nextLink'] || body['@odata.nextLink'];
    currentEndpoint = nextLink ? normalizeNextLink(nextLink) : null;
  }

  budget.assertActive();
  return values;
  } catch (error) {
    throw budget.abort(error);
  } finally {
    if (ownsBudget) budget.cleanup();
  }
}

function collectionValues(value) {
  return Array.isArray(value) ? value : [];
}

function optionalSapBoolean(value) {
  if (value === true || ['BOYES', 'TYES'].includes(String(value).toUpperCase())) return true;
  if (value === false || ['BONO', 'TNO'].includes(String(value).toUpperCase())) return false;
  return null;
}

function configuredWithholding(item, taxCodes) {
  const config = taxCodes.get(String(item.WTCode));
   
  // instalación: incluso algunas retenciones ISR están tipificadas como IVA
  const code = String(item.WTCode);
  const description = String(config?.WTName || '').toUpperCase();
  const rate = optionalNumber(config?.Rate);
  const fullBase = optionalNumber(config?.BaseAmount) === 100;
  let estimateRule = null;
  if (fullBase && config?.BaseType === 'wtcbt_Net' && /\bISR\b/.test(description)
    && ((['SER', '1I'].includes(code) && rate === 10) || (code === 'RES' && rate === 1.25))) {
    estimateRule = 'isr_on_fee';
  }
  if (fullBase && /\bIVA\b/.test(description)
    && ((code === 'SERI' && config?.BaseType === 'wtcbt_Net' && rate >= 10.66 && rate <= 10.667)
      || (code === '1V' && config?.BaseType === 'wtcbt_VAT' && rate >= 66.66 && rate <= 66.667))) {
    estimateRule = 'vat_two_thirds';
  }
  return {
    description: config?.WTName || 'Retención sin descripción en SAP',
    rate,
    estimateRule,
    calculationBase: ({ wtcbt_Net: 'base neta definida en SAP', wtcbt_VAT: 'IVA definido en SAP', wtcbt_Gross: 'importe bruto definido en SAP' })[config?.BaseType] || 'base no informada',
    basePercentage: optionalNumber(config?.BaseAmount),
    appliesAt: ({ wtcc_Invoice: 'factura', wtcc_Payment: 'pago' })[config?.Category] || 'momento no informado',
    codeEffectiveFrom: config?.EffectiveFrom || null,
    inactive: optionalSapBoolean(config?.Inactive)
  };
}

function withholdingRows(invoice, taxCodes) {
   
  const collections = collectionValues(invoice.WithholdingTaxDataWTXCollection).length
    ? collectionValues(invoice.WithholdingTaxDataWTXCollection)
    : collectionValues(invoice.WithholdingTaxDataCollection);
  return collections.map(row => {
    const code = String(row.WTCode || row.WTaxCode || row.Code || row.AbsEntry || 'SIN_CODIGO');
    const useForeign = invoice.DocCurrency && invoice.DocCurrency !== 'MXN' && row.WTAmountFC !== undefined && row.WTAmountFC !== null;
    const amount = useForeign
      ? optionalNumber(row.WTAmountFC)
      : optionalNumber(row.WTAmount ?? row.WTSum ?? row.TaxAmount ?? row.Amount);
    const rate = optionalNumber(row.Rate ?? row.WTRate);
    const taxableBase = useForeign
      ? optionalNumber(row.TaxableAmountFC)
      : optionalNumber(row.TaxableAmount ?? row.BaseAmount ?? row.BaseSum);
    const description = taxCodes.get(code)?.WTName || 'Retención sin descripción en SAP';
    return { code, description, amount: roundOptional(amount), rate, taxableBase: roundOptional(taxableBase) };
  });
}

function isCancelled(value) {
  return value === true || String(value || '').toUpperCase() === 'TYES';
}

function prepareProviderInputs(input) {
  if (!Array.isArray(input)) throw new Error('Se requiere una lista de médicos para conciliar SAP.');
  if (input.length > 500) throw new Error('La consulta excede el máximo de 500 médicos.');
  const uniqueNames = [...new Set(input.map(name => String(name || '').trim()).filter(Boolean))];
  if (uniqueNames.some(name => name.length > 160)) throw new Error('Se recibió un nombre de médico demasiado largo.');
  return uniqueNames;
}

async function getInvoices(cardCodes, startDate, endDate, budget) {

    const filter = `DocDate ge '${startDate}' and DocDate le '${endDate}'`;
    const select = [
      'DocEntry', 'DocNum', 'DocDate', 'TaxDate', 'DocDueDate', 'CardCode', 'CardName',
       
      'DocCurrency', 'DocTotal', 'DocTotalFc', 'VatSum', 'VatSumFc', 'PaidToDate', 'PaidToDateFC', 'DocumentStatus', 'Cancelled',
      'NumAtCard', 'Comments', 'U_UDF_UUID', 'WithholdingTaxDataCollection', 'WithholdingTaxDataWTXCollection', 'DocumentLines'
    ].join(',');
    const endpoint = `/PurchaseInvoices?$select=${select}&$filter=${encodeURIComponent(filter)}&$orderby=DocEntry asc`;
  const results = await fetchAllPagesStrict(endpoint, MAX_PAGES, { readBudget: budget });
  const codes = new Set(cardCodes);
  const byEntry = new Map();
  results.filter(invoice => codes.has(String(invoice.CardCode))).forEach(invoice => byEntry.set(String(invoice.DocEntry), invoice));
  return [...byEntry.values()];
}

async function getPayments(cardCodes, startDate, endDate, budget) {
    const filter = `DocDate ge '${startDate}' and DocDate le '${endDate}'`;
    const select = ['DocEntry', 'DocNum', 'DocDate', 'CardCode', 'CardName', 'DocCurrency', 'Cancelled', 'PaymentInvoices'].join(',');
    const endpoint = `/VendorPayments?$select=${select}&$filter=${encodeURIComponent(filter)}&$orderby=DocEntry asc`;
    const results = await fetchAllPagesStrict(endpoint, MAX_PAGES, { readBudget: budget });
    const codes = new Set(cardCodes);
    return results.filter(payment => codes.has(String(payment.CardCode)));
}

function addPaymentApplications(payments, invoicesByEntry) {
  const linked = new Map();
  const byCardCode = new Map();
  for (const payment of payments) {
    if (isCancelled(payment.Cancelled)) continue;
    for (const application of collectionValues(payment.PaymentInvoices)) {
      if (String(application.InvoiceType || '') !== 'it_PurchaseInvoice') continue;
      const invoice = invoicesByEntry.get(String(application.DocEntry));
      if (invoice && String(invoice.CardCode) !== String(payment.CardCode)) continue;

      const docCurrency = String(invoice?.DocCurrency || '');
      const hasForeignAmount = docCurrency && docCurrency !== 'MXN' && application.AppliedFC !== undefined && application.AppliedFC !== null;
      const applied = hasForeignAmount ? asNumber(application.AppliedFC) : asNumber(application.SumApplied);
      const applicationCurrency = docCurrency === 'MXN' || hasForeignAmount ? docCurrency : 'LCY';
      const record = {
        paymentDocEntry: payment.DocEntry,
        paymentDocNum: payment.DocNum,
        paymentDate: payment.DocDate,
        amount: roundMoney(applied),
        currency: applicationCurrency || 'LCY',
        currencyBasis: applicationCurrency === 'LCY' ? 'moneda local SAP' : 'moneda del documento aplicado',
        invoiceDocEntry: application.DocEntry,
        invoiceDocNum: application.DocNum || null
      };
      if (invoice) {
        const rows = linked.get(String(invoice.DocEntry)) || [];
        rows.push(record);
        linked.set(String(invoice.DocEntry), rows);
      }
      const providerRows = byCardCode.get(String(payment.CardCode)) || [];
      providerRows.push(record);
      byCardCode.set(String(payment.CardCode), providerRows);
    }
  }
  return { byInvoice: linked, byCardCode };
}

async function reconcileHonorariosWithSap({ startDate, endDate, doctors, clinicalDirectory = [], includeAdditional = false, scope = 'documents' }, options = {}) {
  if (!['fiscal', 'documents'].includes(scope)) throw Object.assign(new Error('El alcance de la consulta no es válido.'), { status: 400 });
  const documentsQueried = scope === 'documents';
  if (!documentsQueried) includeAdditional = false;
  if (!isValidDate(startDate) || !isValidDate(endDate) || startDate > endDate) {
    throw new Error('El periodo de servicios no es válido.');
  }
  const periodDays = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000 + 1;
  if (periodDays > MAX_SERVICE_PERIOD_DAYS) throw new Error(`El periodo de servicios no puede exceder ${MAX_SERVICE_PERIOD_DAYS} días.`);
   
  const sapEndDate = documentsQueried ? addDays(endDate, SAP_LOOKAHEAD_DAYS) : endDate;
  const period = {
    startDate, endDate: sapEndDate, serviceStartDate: startDate, serviceEndDate: endDate,
    lookaheadDays: documentsQueried ? SAP_LOOKAHEAD_DAYS : 0,
    dateBasis: documentsQueried ? 'fecha de contabilización de factura y fecha del pago' : 'fecha de servicios para la información fiscal'
  };
  const doctorNames = prepareProviderInputs(doctors);
  if (doctorNames.length === 0 && !includeAdditional) {
    return {
      ok: true,
      source: 'SAP Business One Service Layer',
      readOnly: true,
      documentsQueried,
      asOf: new Date().toISOString(),
      period,
      scope: 'Sin médicos en el reporte de honorarios para conciliar.',
      providers: {}
    };
  }

  const budget = createSapReadBudget(options);
  try {
   
  const masters = await getSapMasters(budget, documentsQueried);
  budget.assertActive();
  const { suppliers, groups, withholdingCodes } = masters;
  const groupNames = new Map(groups.map(group => [String(group.Code), group.Name]));
  const taxCodes = new Map(withholdingCodes.map(code => [String(code.WTCode), code]));
  const index = new Map();
  for (const supplier of suppliers) {
    const key = normalizeProviderName(supplier.CardName);
    if (!key) continue;
    const matches = index.get(key) || [];
    matches.push(supplier);
    index.set(key, matches);
  }

  const providerLinks = new Map();
  for (const name of doctorNames) {
    const candidates = index.get(normalizeProviderName(name)) || [];
    providerLinks.set(name, candidates);
  }
  const cardCodeOwners = new Map();
  for (const [name, candidates] of providerLinks) {
    if (candidates.length !== 1) continue;
    const cardCode = String(candidates[0].CardCode);
    const owners = cardCodeOwners.get(cardCode) || [];
    owners.push(name);
    cardCodeOwners.set(cardCode, owners);
  }
  const crossLinkedCodes = new Set([...cardCodeOwners.entries()].filter(([, owners]) => owners.length > 1).map(([code]) => code));

  const medicalNames = new Set(clinicalDirectory.map(row => normalizeProviderName(row.FullName)).filter(Boolean));
  const additionalLinks = new Map();
  if (includeAdditional) {
    for (const supplier of suppliers) {
      const code = String(supplier.CardCode);
      const group = String(groupNames.get(String(supplier.GroupCode)) || '').trim().toUpperCase();
      const medicalGroup = ['HMEDRES','HONMED','HONRESICO'].includes(group);
      const inClinicalDirectory = medicalNames.has(normalizeProviderName(supplier.CardName));
      const genericHonorarios = group === 'HONORARIOS';
      if (!medicalGroup && !inClinicalDirectory && !genericHonorarios) continue;
      if (cardCodeOwners.has(code) && !crossLinkedCodes.has(code)) continue;
      const key = `SAP:${code}`;
      additionalLinks.set(key, { supplier, discoveryBasis: medicalGroup ? 'Grupo médico de SAP' : inClinicalDirectory ? 'Catálogo de prestadores clínicos' : 'Grupo general de honorarios: confirmar que corresponde a servicios médicos' });
    }
  }
  for (const [key, item] of additionalLinks) providerLinks.set(key, [item.supplier]);
  const cardCodes = [...new Set([...providerLinks.entries()]
    .filter(([name, candidates]) => candidates.length === 1 && (additionalLinks.has(name) || !crossLinkedCodes.has(String(candidates[0].CardCode))))
    .map(([, candidates]) => String(candidates[0].CardCode))
    .filter(Boolean))];
  const [invoices, payments] = documentsQueried && cardCodes.length
    ? await Promise.all([getInvoices(cardCodes, startDate, sapEndDate, budget), getPayments(cardCodes, startDate, sapEndDate, budget)])
    : [[], []];
  const invoicesByEntry = new Map(invoices.map(invoice => [String(invoice.DocEntry), invoice]));

  for (const payment of payments) {
    if (isCancelled(payment.Cancelled)) continue;
    for (const application of collectionValues(payment.PaymentInvoices)) {
      if (application.InvoiceType !== 'it_PurchaseInvoice') continue;
      const id = String(application.DocEntry);
      if (invoicesByEntry.has(id)) continue;
      if (!/^\d+$/.test(id)) throw new Error('SAP devolvió un identificador de factura inválido.');
      const response = await budget.get(`/PurchaseInvoices(${id})`);
      const invoice = response?.data;
      if (String(invoice?.DocEntry) !== id || String(invoice?.CardCode) !== String(payment.CardCode)) {
        throw new Error('No se pudo verificar la factura aplicada a un pago de SAP.');
      }
      invoice.LocatedByPayment = true;
      invoicesByEntry.set(id, invoice);
      invoices.push(invoice);
    }
  }
  const paymentApplications = addPaymentApplications(payments, invoicesByEntry);

  const providers = {};
  const additionalProviders = [];
  for (const name of [...doctorNames, ...additionalLinks.keys()]) {
    const candidates = providerLinks.get(name) || [];
    const additional = additionalLinks.get(name);
    const crossLinked = !additional && candidates.length === 1 && crossLinkedCodes.has(String(candidates[0].CardCode));
    const status = candidates.length > 1 || crossLinked ? 'ambiguo' : candidates.length === 1 ? 'candidato_unico' : 'sin_coincidencia';
    const candidateCodes = new Set(candidates.map(row => String(row.CardCode)));
    const providerInvoices = status === 'candidato_unico' ? invoices
      .filter(invoice => candidateCodes.has(String(invoice.CardCode)))
      .sort((a, b) => String(a.DocDate || '').localeCompare(String(b.DocDate || '')) || asNumber(a.DocNum) - asNumber(b.DocNum))
      .map(invoice => ({
        docEntry: invoice.DocEntry,
        docNum: invoice.DocNum,
        locatedByPayment: invoice.LocatedByPayment === true,
        supplierReference: invoice.NumAtCard || '',
        comments: invoice.Comments || '',
        cfdiUuid: invoice.U_UDF_UUID || '',
        postingDate: invoice.DocDate,
        taxDate: invoice.TaxDate,
        dueDate: invoice.DocDueDate,
        cardCode: invoice.CardCode,
        cardName: invoice.CardName,
        currency: invoice.DocCurrency || 'LCY',
        documentTotal: roundOptional(invoice.DocCurrency && invoice.DocCurrency !== 'MXN' ? invoice.DocTotalFc : invoice.DocTotal),
        vatRecorded: roundOptional(invoice.DocCurrency && invoice.DocCurrency !== 'MXN' ? invoice.VatSumFc : invoice.VatSum),
        paidToDate: roundOptional(invoice.DocCurrency && invoice.DocCurrency !== 'MXN' ? invoice.PaidToDateFC : invoice.PaidToDate),
        openBalance: (() => {
          const documentTotal = optionalNumber(invoice.DocCurrency && invoice.DocCurrency !== 'MXN' ? invoice.DocTotalFc : invoice.DocTotal);
          const paidToDate = optionalNumber(invoice.DocCurrency && invoice.DocCurrency !== 'MXN' ? invoice.PaidToDateFC : invoice.PaidToDate);
          return documentTotal === null || paidToDate === null ? null : roundMoney(documentTotal - paidToDate);
        })(),
        cancelled: isCancelled(invoice.Cancelled),
        documentStatus: invoice.DocumentStatus || '',
        lines: collectionValues(invoice.DocumentLines).map(line => ({
          lineNumber: line.LineNum,
          description: line.ItemDescription || '',
          quantity: optionalNumber(line.Quantity),

          recordedAmount: roundOptional(invoice.DocCurrency && invoice.DocCurrency !== 'MXN' ? line.RowTotalFC : line.LineTotal)
        })),
        retentions: withholdingRows(invoice, taxCodes),
        paymentsInPeriod: paymentApplications.byInvoice.get(String(invoice.DocEntry)) || []
      })) : [];

    const totalsMap = new Map();
    for (const invoice of providerInvoices) {
      if (invoice.cancelled) continue;
      const currency = invoice.currency || 'MXN';
      if (!totalsMap.has(currency)) {
        totalsMap.set(currency, {
          currency, invoiceCount: 0, documentTotal: 0, paidToDate: 0, openBalance: 0,
          vatRecorded: 0, documentTotalComplete: true, paidToDateComplete: true,
          openBalanceComplete: true, vatRecordedComplete: true,
          periodAppliedPayments: 0, periodPaymentCount: 0, withholdingByCode: {}
        });
      }
      const total = totalsMap.get(currency);
      total.invoiceCount += 1;
      if (invoice.documentTotal === null) total.documentTotalComplete = false;
      else total.documentTotal += invoice.documentTotal;
      if (invoice.paidToDate === null) total.paidToDateComplete = false;
      else total.paidToDate += invoice.paidToDate;
      if (invoice.openBalance === null) total.openBalanceComplete = false;
      else total.openBalance += invoice.openBalance;
      if (invoice.vatRecorded === null) total.vatRecordedComplete = false;
      else total.vatRecorded += invoice.vatRecorded;
      for (const retention of invoice.retentions) {
        if (retention.amount !== null) total.withholdingByCode[retention.code] = (total.withholdingByCode[retention.code] || 0) + retention.amount;
      }
    }
    const providerPayments = status === 'candidato_unico'
      ? paymentApplications.byCardCode.get(String(candidates[0].CardCode)) || []
      : [];
    for (const payment of providerPayments) {
      if (!totalsMap.has(payment.currency)) {
        totalsMap.set(payment.currency, {
          currency: payment.currency, invoiceCount: 0, documentTotal: 0, paidToDate: 0, openBalance: 0,
          vatRecorded: 0, documentTotalComplete: true, paidToDateComplete: true,
          openBalanceComplete: true, vatRecordedComplete: true,
          periodAppliedPayments: 0, periodPaymentCount: 0, withholdingByCode: {}
        });
      }
      const total = totalsMap.get(payment.currency);
      total.periodAppliedPayments += payment.amount;
      total.periodPaymentCount += 1;
    }
    const totalsByCurrency = [...totalsMap.values()].map(total => ({
      currency: total.currency,
      invoiceCount: total.invoiceCount,
      documentTotal: total.invoiceCount > 0 && total.documentTotalComplete ? roundMoney(total.documentTotal) : null,
      vatRecorded: total.invoiceCount > 0 && total.vatRecordedComplete ? roundMoney(total.vatRecorded) : null,
      paidToDate: total.invoiceCount > 0 && total.paidToDateComplete ? roundMoney(total.paidToDate) : null,
      openBalance: total.invoiceCount > 0 && total.openBalanceComplete ? roundMoney(total.openBalance) : null,
      periodAppliedPayments: roundMoney(total.periodAppliedPayments),
      periodPaymentCount: total.periodPaymentCount,
      withholdingByCode: Object.fromEntries(Object.entries(total.withholdingByCode).map(([code, amount]) => [code, roundMoney(amount)])),
      withholdings: Object.entries(total.withholdingByCode).map(([code, amount]) => ({
        description: taxCodes.get(code)?.WTName || 'Retención sin descripción en SAP',
        amount: roundMoney(amount)
      }))
    }));

    providers[name] = {
      linkStatus: status,
      documentsQueried,
      candidates: candidates.map(row => ({
        cardCode: row.CardCode,
        cardName: row.CardName,
        groupCode: row.GroupCode,
        groupName: groupNames.get(String(row.GroupCode)) || 'Sin grupo informado',
        federalTaxId: String(row.FederalTaxID || '').trim(),
        fiscalRegime: String(row.U_B1SYS_FiscRegime || '').trim() || null,
        fiscalRegimeEffectiveDate: null,
        identityVerified: false,
        subjectToWithholding: optionalSapBoolean(row.SubjectToWithholdingTax),
        configuredWithholdings: collectionValues(row.BPWithholdingTaxCollection).map(item => configuredWithholding(item, taxCodes))
      })),
      ...(documentsQueried ? { invoices: providerInvoices, totalsByCurrency, paymentsInPeriod: providerPayments } : {})
    };
    if (additional) {
      if (providerInvoices.length || providerPayments.length) {
        additionalProviders.push({
          ...providers[name], linkStatus: 'solo_sap', cardCode: String(candidates[0].CardCode),
          medico: candidates[0].CardName, discoveryBasis: additional.discoveryBasis,
          clinicalLinkStatus: 'sin_servicios_vinculados',
          reason: crossLinkedCodes.has(String(candidates[0].CardCode))
            ? 'Documentos SAP con vínculo clínico ambiguo; no se asignan a una atención.'
            : 'Documentos de proveedor médico sin filas del reporte clínico para este periodo.'
        });
      }
      delete providers[name];
    }
  }

  budget.assertActive();
  return {
    ok: true,
    source: 'SAP Business One Service Layer',
    readOnly: true,
    documentsQueried,
    supplierCoverage: {
      count: suppliers.length,
      withFiscalRegime: suppliers.filter(row => String(row.U_B1SYS_FiscRegime || '').trim()).length,
      complete: true
    },
    asOf: new Date().toISOString(),
    period,
    scope: documentsQueried
      ? 'Conciliación a nivel proveedor/documento. El nombre solo propone una coincidencia; no hay vínculo comprobado a CFDI ni atención de Vertical.'
      : 'Consulta fiscal de proveedores y retenciones. No se consultaron facturas ni pagos de SAP.',
    providers,
    additionalProviders,
    discoveryCoverage: {
      enabled: includeAdditional, clinicalDirectoryCount: clinicalDirectory.length,
      additionalSuppliersQueried: additionalLinks.size, additionalSuppliersWithDocuments: additionalProviders.length,
      scope: 'Grupos médicos, catálogo clínico y grupo general Honorarios. Los candidatos requieren aprobación; el grupo general puede incluir servicios no médicos.'
    }
  };
  } catch (error) {
    throw budget.abort(error);
  } finally {
    budget.cleanup();
  }
}

module.exports = { reconcileHonorariosWithSap, fetchAllPagesStrict, normalizeProviderName, configuredWithholding, optionalSapBoolean };
