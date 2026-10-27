'use strict';

const sapService = require('./sap.service');
const sapConfig = require('../config/sap.config');
const { getRemoteDb, sql } = require('../config/remote-db');

const PAGE_SIZE = 25;
const MAX_OFFSET = 3975;
const MAX_ACCOUNT_KEYS = 4000;
const BUDGET_MS = 45000;
const SELECT_ORDER = 'DocEntry,DocNum,DocDate,DocumentStatus,CardName,DocTotal,DocCurrency,U_PCNum,U_PTNum,U_PTName,DocumentLines';
const invalid = message => Object.assign(new Error(message), { status: 400 });
const sourceError = () => Object.assign(new Error('No se pudo completar la consulta de órdenes en SAP.'), { status: 502 });
const abortError = () => Object.assign(new Error('Consulta cancelada.'), { name: 'AbortError' });

function positiveId(value) {
  if (value === null || value === undefined || !/^\d+$/.test(String(value))) return null;
  const result = Number(value);
  return Number.isSafeInteger(result) && result > 0 && result <= 2147483647 ? result : null;
}

function parseInput({ mode, q, offset = '0' }, modes) {
  if (!modes.includes(mode)) throw invalid('Selecciona el tipo de búsqueda.');
  if (typeof q !== 'string' || q.length > 120 || /[\p{Cc}]/u.test(q)) throw invalid('El texto de búsqueda no es válido.');
  const query = q.trim().replace(/\s+/g, ' ');
  if (mode === 'patient' && query.length < 2) throw invalid('Escribe al menos dos caracteres del nombre del paciente.');
  if (mode !== 'patient' && !positiveId(query)) throw invalid('Escribe un número mayor a cero, sin letras ni símbolos.');
  if (!/^\d+$/.test(String(offset)) || Number(offset) > MAX_OFFSET) throw invalid('La página solicitada no es válida. Acota la búsqueda.');
  return { mode, query, offset: Number(offset) };
}

async function scoped(signal, operation) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) throw abortError();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, BUDGET_MS);
  try { return await operation(controller.signal); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort(); }
}

function page(rows, offset) {
  const truncated = rows.length > PAGE_SIZE && offset + PAGE_SIZE > MAX_OFFSET;
  const hasMore = rows.length > PAGE_SIZE && !truncated;
  return { rows: rows.slice(0, PAGE_SIZE), hasMore, nextOffset: hasMore ? offset + PAGE_SIZE : null,
    warnings: truncated ? ['Se alcanzó el límite de resultados. Escribe más palabras del nombre para acotar la búsqueda.'] : [] };
}

async function searchAccounts(input = {}, { signal } = {}) {
  const { mode, query, offset } = parseInput(input, ['account', 'patient']);
  return scoped(signal, async requestSignal => {
    const pool = await getRemoteDb();
    if (requestSignal.aborted) throw abortError();
    const request = pool.request();
    request.timeout = 30000;
    request.input('offset', sql.Int, offset);
    request.input('limit', sql.Int, PAGE_SIZE + 1);
    let filter;
    if (mode === 'account') {
      request.input('account', sql.Int, positiveId(query));
      filter = 'pc.PCNum = @account';
    } else {
      const tokens = query.split(' ');
      if (tokens.length > 10) throw invalid('Escribe hasta diez palabras del nombre.');
      filter = tokens.map((token, index) => {
        request.input(`name${index}`, sql.NVarChar(260), `%${token.replace(/[~%_[]/g, char => `~${char}`)}%`);
        return `pt.FullName COLLATE Latin1_General_CI_AI LIKE @name${index} ESCAPE N'~'`;
      }).join(' AND ');
    }
    const cancel = () => request.cancel();
    requestSignal.addEventListener('abort', cancel, { once: true });
    try {
      const result = await request.query(`SELECT pc.PCNum AS account, pt.FullName AS patientName, pc.PTNum AS patientNumber,
        pc.[Date] AS date, pc.PC_ST AS status
        FROM dbo.PC pc LEFT JOIN dbo.PT pt ON pt.PTNum = pc.PTNum
        WHERE ${filter} ORDER BY pc.PCNum DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`);
      if (requestSignal.aborted) throw abortError();
      if (!Array.isArray(result?.recordset)) throw sourceError();
      if (result.recordset.some(row => !positiveId(row.account) || (mode === 'account' && positiveId(row.account) !== positiveId(query)))) throw sourceError();
      return { ...page(result.recordset.map(row => ({ ...row, account: String(row.account) })), offset), source: 'Vertical' };
    } finally { requestSignal.removeEventListener('abort', cancel); }
  });
}

function endpoint(entity, options) {
  return `/${entity}?${Object.entries(options).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')}`;
}

function nextEndpoint(link) {
  const base = new URL(sapConfig.baseUrl);
  const path = base.pathname.replace(/\/$/, '');
  const next = new URL(String(link), `${base.origin}${path}/`);
  if (next.origin !== base.origin || !next.pathname.startsWith(`${path}/`)) throw sourceError();
  return `${next.pathname.slice(path.length)}${next.search}`;
}

async function readPages(initial, signal, maxRows = MAX_ACCOUNT_KEYS) {
  const rows = [];
  const visited = new Set();
  let current = initial;
  while (current) {
    if (signal.aborted) throw abortError();
    if (visited.has(current) || visited.size >= 80) throw sourceError();
    visited.add(current);
    const result = await sapService.get(current, { Prefer: 'odata.maxpagesize=200', 'Cache-Control': 'no-cache' }, { signal, timeoutMs: 30000 });
    if (!Array.isArray(result?.data?.value)) throw sourceError();
    rows.push(...result.data.value);
    if (rows.length > maxRows) throw Object.assign(sourceError(), { publicMessage: 'La cuenta tiene demasiadas referencias para esta consulta. Busca una orden específica.' });
    const next = result.data['@odata.nextLink'] || result.data['odata.nextLink'];
    current = next ? nextEndpoint(next) : null;
  }
  return rows;
}

function orderRow(doc) {
  if (!positiveId(doc.DocEntry) || !positiveId(doc.DocNum) || !Array.isArray(doc.DocumentLines)) throw sourceError();
  const accounts = [...new Set([doc.U_PCNum, ...doc.DocumentLines.map(line => line.U_PCNum)].map(positiveId).filter(Boolean))].sort((a, b) => a - b).map(String);
  return {
    docEntry: positiveId(doc.DocEntry), docNum: positiveId(doc.DocNum), entity: 'Orders',
    account: accounts.length === 1 ? accounts[0] : null, accounts,
    patientName: accounts.length <= 1 ? String(doc.U_PTName || '').trim() || null : null,
    patientNumber: accounts.length <= 1 ? positiveId(doc.U_PTNum) : null,
    date: doc.DocDate, status: doc.DocumentStatus, customerName: doc.CardName,
    total: doc.DocTotal, currency: doc.DocCurrency,
  };
}

async function searchOrders(input = {}, { signal } = {}) {
  const { mode, query, offset } = parseInput(input, ['account', 'order']);
  const id = positiveId(query);
  return scoped(signal, async requestSignal => {
    let documents;
    let hasMore = false;
    if (mode === 'order') {
      documents = await readPages(endpoint('Orders', { $select: SELECT_ORDER, $filter: `DocNum eq ${id}`, $orderby: 'DocEntry desc', $skip: offset, $top: PAGE_SIZE + 1 }), requestSignal, PAGE_SIZE + 1);
      if (documents.some(doc => positiveId(doc.DocNum) !== id)) throw sourceError();
      hasMore = documents.length > PAGE_SIZE;
    } else {

      const headers = await readPages(endpoint('Orders', { $select: 'DocEntry', $filter: `U_PCNum eq ${id}`, $orderby: 'DocEntry desc' }), requestSignal);
      const lines = await readPages(endpoint('$crossjoin(Orders,Orders/DocumentLines)', {
        $expand: 'Orders($select=DocEntry),Orders/DocumentLines($select=DocEntry,U_PCNum)',
        $filter: `Orders/DocEntry eq Orders/DocumentLines/DocEntry and Orders/DocumentLines/U_PCNum eq ${id}`,
      }), requestSignal);
      const keys = [...new Set([...headers.map(doc => positiveId(doc.DocEntry)), ...lines.map(row => positiveId(row.Orders?.DocEntry))])];
      if (keys.includes(null)) throw sourceError();
      keys.sort((a, b) => b - a);
      const selected = keys.slice(offset, offset + PAGE_SIZE);
      hasMore = keys.length > offset + PAGE_SIZE;
      if (!selected.length) documents = [];
      else {
        documents = await readPages(endpoint('Orders', { $select: SELECT_ORDER, $filter: selected.map(key => `DocEntry eq ${key}`).join(' or '), $orderby: 'DocEntry desc' }), requestSignal, PAGE_SIZE);
        const returned = new Set(documents.map(doc => positiveId(doc.DocEntry)));
        if (returned.size !== selected.length || selected.some(key => !returned.has(key))) throw sourceError();
      }
    }
    const rows = documents.slice(0, PAGE_SIZE).map(orderRow);
    if (mode === 'account' && rows.some(row => !row.accounts.includes(String(id)))) throw sourceError();
    const warnings = rows.some(row => row.accounts.length > 1) ? ['Una o más órdenes contienen varias cuentas; se muestran todas sus referencias sin atribuirles un solo paciente.'] : [];
    if (hasMore && offset + PAGE_SIZE > MAX_OFFSET) {
      hasMore = false;
      warnings.push('Se alcanzó el límite de resultados. Busca una orden específica para continuar.');
    }
    return { rows, hasMore, nextOffset: hasMore ? offset + PAGE_SIZE : null, source: 'SAP',
      warnings };
  });
}

module.exports = { searchAccounts, searchOrders, positiveId };
