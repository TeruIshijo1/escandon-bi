'use strict';
const sap = require('./sap.service');
const { pool } = require('../config/pg-db');
const { ensureSapQuery, withSapQuery } = require('./sapQueryRegistration.service');
const { createQuirofanoRevenueStore } = require('./quirofanoRevenueStore.service');
const { addDays, dateOnly } = require('./statisticsCommon');

const queries = [
  { type: 'TOTAL', code: 'sq_quirofano_ingresos_totales_group', sql: `
      SELECT
        T0.DocDate AS fecha,
        SUM(T1.LineTotal) AS ingresos
      FROM OINV T0
      INNER JOIN INV1 T1 ON T0.DocEntry = T1.DocEntry
      INNER JOIN OITM T2 ON T1.ItemCode = T2.ItemCode
      WHERE T2.ItmsGrpCod = 111
        AND T0.DocDate >= :startDate
        AND T0.DocDate <= :endDate
      GROUP BY T0.DocDate
    ` },
  { type: 'MEDICO', code: 'sq_quirofano_top_medicos_group', sql: `
      SELECT
        T0.DocDate AS fecha,
        T0.U_PRName AS nombre,
        SUM(T1.LineTotal) AS ingresos
      FROM OINV T0
      INNER JOIN INV1 T1 ON T0.DocEntry = T1.DocEntry
      INNER JOIN OITM T2 ON T1.ItemCode = T2.ItemCode
      WHERE T2.ItmsGrpCod = 111
        AND T0.DocDate >= :startDate
        AND T0.DocDate <= :endDate
        AND T0.U_PRName IS NOT NULL AND T0.U_PRName <> ''
      GROUP BY T0.DocDate, T0.U_PRName
    ` },
  { type: 'SERVICIO', code: 'sq_quirofano_top_servicios_group', sql: `
      SELECT
        T0.DocDate AS fecha,
        T1.Dscription AS nombre,
        SUM(T1.LineTotal) AS ingresos
      FROM OINV T0
      INNER JOIN INV1 T1 ON T0.DocEntry = T1.DocEntry
      INNER JOIN OITM T2 ON T1.ItemCode = T2.ItemCode
      WHERE T2.ItmsGrpCod = 111
        AND T0.DocDate >= :startDate
        AND T0.DocDate <= :endDate
      GROUP BY T0.DocDate, T1.Dscription
    ` },
];
const source = 'quirofanoIngresos';
const store = createQuirofanoRevenueStore({ pool });
let activeSync, activeController, continuationTimer, queuedFull;
let activeFull = false;
let stopped = false;
const invalid = code => Object.assign(new Error('SAP no confirmó una extracción completa de ingresos de Quirófano.'), { code });

function validatedRows(rows, type, startDate, endDate, seen) {
  if (!Array.isArray(rows)) throw invalid('SAP_QX_INVALID_RESPONSE');
  return rows.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw invalid('SAP_QX_INVALID_ROW');
    const value = String(row.fecha ?? '').slice(0, 10);
    const date = /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : value;
    try { dateOnly(date); } catch { throw invalid('SAP_QX_INVALID_DATE'); }
    if (date < startDate || date > endDate || row.ingresos == null || String(row.ingresos).trim() === ''
      || !['string', 'number'].includes(typeof row.ingresos) || !Number.isFinite(Number(row.ingresos))
      || (row.nombre != null && typeof row.nombre !== 'string')) throw invalid('SAP_QX_INVALID_ROW');
    const name = type === 'TOTAL' ? 'TOTAL' : String(row.nombre ?? '').trim();
    const key = JSON.stringify([type, name, date]);
    if (seen.has(key)) throw invalid('SAP_QX_DUPLICATE_ROW');
    seen.add(key);
    return [type, name, String(row.ingresos).trim(), date, date];
  });
}

/* Publica cada tramo completo y retoma los pendientes desde el registro local. */
async function synchronize({ fullSync = false } = {}) {
  return store.withLock(async client => {
    const plan = await store.plan(client, { fullSync, limit: 28 });
    const report = { source, status: 'complete', rows: 0, completedWindows: 0, failedWindows: [], startDate: null, errorCode: null };
    const controller = new AbortController();
    activeController = controller;
    const deadline = Date.now() + 300000;
    const timer = setTimeout(() => controller.abort(), 300000);
    timer.unref?.();
    try {
      let registered = false;
      for (const window of windowsFromDays(plan.days)) {
        if (controller.signal.aborted || Date.now() >= deadline) break;
        report.startDate ??= window.startDate;
        try {
          if (!registered) {
            for (const query of queries) await ensureSapQuery(query.code, query.sql, { signal: controller.signal });
            registered = true;
          }
          const records = await readWindow(window, controller, deadline);
          if (controller.signal.aborted || Date.now() >= deadline) throw invalid('SAP_QX_SYNC_TIMEOUT');
          await store.publish(client, { ...window, records });
          report.rows += records.length;
          report.completedWindows++;
          console.log('[Sync SAP Quirófano] Tramo guardado', { ...window, rows: records.length });
        } catch (error) {
          const errorCode = String(error.code || (error.status ? `SAP_HTTP_${error.status}` : 'SAP_QX_READ_FAILED'));
          await store.fail(client, { ...window, errorCode });
          report.failedWindows.push({ ...window, errorCode });
          report.errorCode ||= errorCode;
          console.warn('[Sync SAP Quirófano] Tramo pendiente; se conserva su copia anterior', { ...window, errorCode });
          if (!registered) break;
        }
      }
      const summary = await store.getStatus();
      report.pendingDays = summary.pendingDays;
      report.failedDays = summary.failedDays;
      report.errorCode ||= summary.errorCode || null;
      report.backfillPending = summary.backfillPending;
      report.pendingReason = report.failedWindows.length || summary.failedDays ? 'source_error'
        : summary.backfillPending ? 'history_pending' : summary.pendingDays ? 'refresh_pending' : null;
      report.status = report.failedWindows.length && !report.completedWindows ? 'error'
        : summary.pendingDays || summary.failedDays ? 'incomplete' : 'complete';
      return report;
    } finally { clearTimeout(timer); if (activeController === controller) activeController = null; }
  });
}

function syncQuirofanoRevenues(options = {}) {
  stopped = false;
  if (options.fullSync && queuedFull) return queuedFull;
  if (activeSync) {
    if (options.fullSync && !activeFull) {
      const previous = activeSync;
      const queued = previous.catch(() => {}).then(() => stopped
        ? { source,status: 'skipped',errorCode: 'SAP_QX_SYNC_STOPPED' }
        : startRevenueSync({ ...options,fullSync: true }));
      const full = queued.finally(() => { if (queuedFull === full) queuedFull = null; });
      queuedFull = full;
      return full;
    }
    return activeSync;
  }
  if (queuedFull) return queuedFull;
  return startRevenueSync(options);
}

function startRevenueSync(options) {
  if (continuationTimer) { clearTimeout(continuationTimer); continuationTimer = null; }
  activeFull = Boolean(options.fullSync);
  activeSync = synchronize(options).then(result => {
    if (!stopped && result.completedWindows > 0 && result.pendingDays > 0) {
      continuationTimer = setTimeout(() => {
        continuationTimer = null;
        syncQuirofanoRevenues().catch(error => console.warn('[Sync SAP Quirófano] Continuación pendiente:', error.code || 'SAP_QX_SYNC_FAILED'));
      }, 60000);
      continuationTimer.unref?.();
    }
    return result;
  }).finally(() => { activeSync = null; activeFull = false; });
  return activeSync;
}

function stopQuirofanoRevenueSync() {
  stopped = true;
  if (continuationTimer) clearTimeout(continuationTimer);
  continuationTimer = null;
  activeController?.abort();
}

module.exports = { syncQuirofanoRevenues, getQuirofanoRevenueStatus: range => store.getStatus(range), stopQuirofanoRevenueSync };

function windowsFromDays(days) {
  const windows = [];
  for (const day of days) {
    const previous = windows.at(-1);
    if (previous && !day.failedBefore && !previous.failedBefore && previous.days < 7 && addDays(day.date, 1) === previous.startDate) {
      previous.startDate = day.date;
      previous.days++;
    } else windows.push({ startDate: day.date, endDate: day.date, days: 1, failedBefore: Boolean(day.failedBefore) });
  }
  return windows;
}

async function readWindow({ startDate, endDate }, controller, deadline) {
  const records = [], seen = new Set();
  for (const query of queries) {
    if (controller.signal.aborted || Date.now() >= deadline) throw invalid('SAP_QX_SYNC_TIMEOUT');
    const begin = Date.now();
    const endpoint = `/SQLQueries('${query.code}')/List?startDate='${startDate.replace(/-/g, '')}'&endDate='${endDate.replace(/-/g, '')}'`;
    const rows = await withSapQuery(query.code, query.sql, () => sap.fetchAllPages(endpoint, {}, {
      timeoutMs: Math.min(90000, deadline - Date.now()), queueTimeoutMs: 60000,
      totalTimeoutMs: Math.min(180000, deadline - Date.now()),
      cacheTtlMs: 0, signal: controller.signal
    }), { signal: controller.signal });
    const complete = validatedRows(rows, query.type, startDate, endDate, seen);
    for (const row of complete) records.push(row);
    console.log('[Sync SAP Quirófano] Lectura completa', { type: query.type, startDate, endDate,
      rows: complete.length, durationMs: Date.now() - begin });
    if (query.type === 'TOTAL' && complete.length === 0) break;
  }
  reconcileRecords(records);
  return records;
}

/* TOTAL y SERVICIO deben describir el mismo corte antes de publicarlo. */
function reconcileRecords(records) {
  const totals = new Map(), services = new Map();
  for (const [type, , amount, date] of records) {
    if (type === 'TOTAL') totals.set(date, decimal(amount));
    if (type === 'SERVICIO') services.set(date, addDecimal(services.get(date), decimal(amount)));
  }
  for (const date of new Set(records.map(row => row[3]))) {
    if (!totals.has(date) || !services.has(date)) throw invalid('SAP_QX_UNRECONCILED');
    const total = totals.get(date), detail = services.get(date);
    const scale = Math.max(total.scale, detail.scale, 4);
    const difference = total.value * 10n ** BigInt(scale - total.scale) - detail.value * 10n ** BigInt(scale - detail.scale);
    const absolute = difference < 0n ? -difference : difference;
    if (absolute > 10n ** BigInt(scale - 4)) throw invalid('SAP_QX_UNRECONCILED');
  }
}

function decimal(amount) {
  const match = String(amount).match(/^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/);
  const exponent = Number(match?.[4] || 0), fraction = match?.[3] || '';
  if (!match || !(match[2] || fraction) || Math.abs(exponent) > 308 || fraction.length > 308) throw invalid('SAP_QX_INVALID_ROW');
  return { value: BigInt((match[2] || '0') + fraction) * (match[1] === '-' ? -1n : 1n), scale: fraction.length - exponent };
}

function addDecimal(left, right) {
  if (!left) return right;
  const scale = Math.max(left.scale, right.scale);
  return { value: left.value * 10n ** BigInt(scale - left.scale) + right.value * 10n ** BigInt(scale - right.scale), scale };
}
