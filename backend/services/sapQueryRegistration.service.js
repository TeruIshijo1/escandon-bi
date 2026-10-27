'use strict';

const sapService = require('./sap.service');
const sapConfig = require('../config/sap.config');
const registered = new Map();
const pending = new Map();
let serial = Promise.resolve();
const configuredTtl = process.env.SAP_QUERY_DEFINITION_TTL_MS;
if (configuredTtl !== undefined && (!/^\d+$/.test(configuredTtl) || Number(configuredTtl) < 60000 || Number(configuredTtl) > 86400000)) {
  throw new Error('SAP_QUERY_DEFINITION_TTL_MS debe ser un entero entre 60000 y 86400000.');
}
const TTL = configuredTtl === undefined ? 3600000 : Number(configuredTtl);
const options = { timeoutMs: 30000, queueTimeoutMs: 60000, totalTimeoutMs: 120000, allowMissing: false, priority: 'high' };
const reserved = new Set(('ADD ALL ALTER AND ANY AS ASC AUTHORIZATION BACKUP BEGIN BETWEEN BREAK BROWSE BULK BY CASCADE CASE CHECK CHECKPOINT CLOSE CLUSTERED COALESCE COLLATE COLUMN COMMIT COMPUTE CONSTRAINT CONTAINS CONTAINSTABLE CONTINUE CONVERT CREATE CROSS CURRENT CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP CURRENT_USER CURSOR DATABASE DBCC DEALLOCATE DECLARE DEFAULT DELETE DENY DESC DISK DISTINCT DISTRIBUTED DOUBLE DROP DUMP ELSE END ERRLVL ESCAPE EXCEPT EXEC EXECUTE EXISTS EXIT EXTERNAL FETCH FILE FILLFACTOR FOR FOREIGN FREETEXT FREETEXTTABLE FROM FULL FUNCTION GOTO GRANT GROUP HAVING HOLDLOCK IDENTITY IDENTITY_INSERT IDENTITYCOL IF IN INDEX INNER INSERT INTERSECT INTO IS JOIN KEY KILL LEFT LIKE LINENO LOAD MERGE NATIONAL NOCHECK NONCLUSTERED NOT NULL NULLIF OF OFF OFFSETS ON OPEN OPENDATASOURCE OPENQUERY OPENROWSET OPENXML OPTION OR ORDER OUTER OVER PERCENT PIVOT PLAN PRECISION PRIMARY PRINT PROC PROCEDURE PUBLIC RAISERROR READ READTEXT RECONFIGURE REFERENCES REPLICATION RESTORE RESTRICT RETURN REVERT REVOKE RIGHT ROLLBACK ROWCOUNT ROWGUIDCOL RULE SAVE SCHEMA SECURITYAUDIT SELECT SEMANTICKEYPHRASETABLE SEMANTICSIMILARITYDETAILSTABLE SEMANTICSIMILARITYTABLE SESSION_USER SET SETUSER SHUTDOWN SOME STATISTICS SYSTEM_USER TABLE TABLESAMPLE TEXTSIZE THEN TO TOP TRAN TRANSACTION TRIGGER TRUNCATE TRY_CONVERT TSEQUAL UNION UNIQUE UNPIVOT UPDATE UPDATETEXT USE USER VALUES VARYING VIEW WAITFOR WHEN WHERE WHILE WITH WITHIN WRITETEXT').split(' '));
function normalized(text) {
  const sql = String(text || '');
  const tokens = [];
  const bareIdentifiers = new Set();
  let index = 0;
  while (index < sql.length) {
    const rest = sql.slice(index);
    const whitespace = rest.match(/^\s+/);
    if (whitespace) { index += whitespace[0].length; continue; }
    if (rest.startsWith('--')) {
      const end = rest.search(/[\r\n]/);
      index += end < 0 ? rest.length : end;
      continue;
    }
    if (rest.startsWith('/*')) {
      let end = index + 2;
      let depth = 1;
      while (end < sql.length && depth) {
        if (sql.startsWith('/*', end)) { depth += 1; end += 2; }
        else if (sql.startsWith('*/', end)) { depth -= 1; end += 2; }
        else end += 1;
      }
      if (depth) tokens.push(`invalid-comment:${sql.slice(index)}`);
      index = end;
      continue;
    }
    const first = sql[index];
    const unicodeLiteral = (first === 'N' || first === 'n') && sql[index + 1] === "'";
    if (first === "'" || first === '[' || first === '"' || unicodeLiteral) {
      const start = index;
      const opener = unicodeLiteral ? "'" : first;
      const closer = opener === '[' ? ']' : opener;
      index += unicodeLiteral ? 2 : 1;
      let closed = false;
      while (index < sql.length) {
        if (sql[index] !== closer) { index += 1; continue; }
        if (sql[index + 1] === closer) { index += 2; continue; }
        index += 1;
        closed = true;
        break;
      }
      const raw = sql.slice(start, index);
      // SAP changes simple identifier quoting; literal and identifier case stay significant.
      const simple = closed && (opener === '[' ? raw.match(/^\[([A-Za-z_][A-Za-z0-9_$#]*)\]$/)
        : opener === '"' ? raw.match(/^"([A-Za-z_][A-Za-z0-9_$#]*)"$/) : null);
      tokens.push(simple ? `identifier:${simple[1]}` : `quoted:${raw}`);
      continue;
    }
    const parameter = rest.match(/^(?::|@)[A-Za-z_][A-Za-z0-9_]*/);
    const identifier = rest.match(/^[A-Za-z_#][A-Za-z0-9_$#]*/);
    const number = rest.match(/^(?:0[xX][0-9A-Fa-f]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/);
    const operator = rest.match(/^(?:>=|<=|<>|!=|!<|!>|\|\||&&|\+=|-=|\*=|\/=|%=|&=|\^=|\|=)/);
    const token = parameter || identifier || number || operator;
    if (token) {
      const kind = parameter ? 'parameter' : identifier ? (reserved.has(token[0].toUpperCase()) ? 'keyword' : 'identifier') : number ? 'number' : 'operator';
      if (kind === 'identifier') bareIdentifiers.add(tokens.length);
      tokens.push(`${kind}:${token[0]}`);
      index += token[0].length;
    } else { tokens.push(`symbol:${first}`); index += 1; }
  }
  return JSON.stringify(tokens.map((token, position) => bareIdentifiers.has(position) && tokens[position + 1] === 'symbol:(' ? `call:${token.slice('identifier:'.length)}` : token));
}
const missing = error => !(Number(error?.status) >= 500) && (Number(error?.status) === 404 || ['-2028', 'SQLQuery404'].includes(String(error?.code)));
const missingPayload = definition => Array.isArray(definition?.value) && definition.value.length === 0 && !definition.SqlCode;
const uncertain = error => [409, 502, 503, 504].includes(Number(error?.status)) || ['SAP_READ_TIMEOUT', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', '-2035'].includes(String(error?.code));

async function definition(sqlCode) {
  try {
    const response = await sapService.get(`/SQLQueries('${sqlCode}')`, {}, options);
    const value = response?.data;
    if (value?.SqlCode !== sqlCode || typeof value.SqlText !== 'string') throw new Error(`No se pudo verificar la definición de la consulta ${sqlCode}.`);
    return value;
  } catch (error) { if (missing(error)) return null; throw error; }
}

function checkMutation(response, sqlCode, sqlText) {
  if (!response || ![200, 201, 204].includes(response.status) || missingPayload(response.data) ||
    (response.data?.SqlCode && (response.data.SqlCode !== sqlCode || normalized(response.data.SqlText) !== normalized(sqlText)))) {
    throw new Error(`No se confirmó el registro de la consulta ${sqlCode}.`);
  }
}

async function register(key, sqlCode, sqlText) {
  const current = await definition(sqlCode);
  if (current && normalized(current.SqlText) === normalized(sqlText)) return;
  registered.delete(key);
  try {
    const response = current
      ? await sapService.patch(`/SQLQueries('${sqlCode}')`, { SqlName: sqlCode, SqlText: sqlText }, {}, options)
      : await sapService.post('/SQLQueries', { SqlCode: sqlCode, SqlName: sqlCode, SqlText: sqlText }, {}, options);
    checkMutation(response, sqlCode, sqlText);
  } catch (error) {
    if (uncertain(error)) {
      // A timed-out mutation may already have committed. Verify its state;
      // never repeat POST or use PATCH as an opportunistic fallback.
      try { const confirmed = await definition(sqlCode); if (confirmed && normalized(confirmed.SqlText) === normalized(sqlText)) return; }
      catch { /* Preserve the original mutation failure. */ }
    }
    throw error;
  }
}

const cancelled = () => Object.assign(new Error('La consulta SAP se canceló.'), { code: 'ABORT_ERR' });
const checkSignal = signal => { if (signal?.aborted) throw cancelled(); };
const resourceKey = sqlCode => JSON.stringify([sapConfig.baseUrl, sapConfig.companyDb, sqlCode]);

// Cada consumidor puede cancelar su espera sin interrumpir una confirmación compartida.
function waitForConfirmation(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      callback(value);
    };
    const abort = () => finish(reject, cancelled());
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => finish(resolve, value), error => finish(reject, error));
    if (signal.aborted) abort();
  });
}

async function ensureRegistered(sqlCode, sqlText, signal, force = false) {
  checkSignal(signal);
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,99}$/.test(sqlCode) || typeof sqlText !== 'string' || !sqlText.trim()) throw new Error('La definición de la consulta SAP no es válida.');
  const key = resourceKey(sqlCode);
  const text = normalized(sqlText);
  const existing = pending.get(key);
  if (existing) {
    await waitForConfirmation(existing.promise, signal);
    checkSignal(signal);
    if (existing.text === text) return;
    return ensureRegistered(sqlCode, sqlText, signal, force);
  }
  const cached = registered.get(key);
  const age = cached ? Date.now() - cached.at : -1;
  if (!force && cached?.text === text && age >= 0 && age < TTL) return;
  const promise = serial.then(() => register(key, sqlCode, sqlText))
    .then(() => { registered.set(key, { text, at: Date.now() }); })
    .finally(() => { if (pending.get(key)?.promise === promise) pending.delete(key); });
  serial = promise.catch(() => {});
  pending.set(key, { text, promise });
  await waitForConfirmation(promise, signal);
}

async function ensureSapQuery(sqlCode, sqlText, { signal } = {}) {
  await ensureRegistered(sqlCode, sqlText, signal);
}

// Sólo una ausencia explícita permite verificar de nuevo y repetir la lectura una vez.
async function withSapQuery(sqlCode, sqlText, read, { signal } = {}) {
  if (typeof read !== 'function') throw new TypeError('La lectura SAP no es válida.');
  await ensureRegistered(sqlCode, sqlText, signal);
  const execute = () => {
    checkSignal(signal);
    return waitForConfirmation(Promise.resolve().then(() => { checkSignal(signal); return read(); }), signal);
  };
  try { return await execute(); }
  catch (error) {
    checkSignal(signal);
    if (!missing(error)) throw error;
    const key = resourceKey(sqlCode);
    if (registered.get(key)?.text === normalized(sqlText)) registered.delete(key);
    await ensureRegistered(sqlCode, sqlText, signal, true);
    return execute();
  }
}

module.exports = { ensureSapQuery, withSapQuery };
