'use strict';

const { hospitalToday, dateRange, monthRange, ACTIVE_START } = require('./statisticsCommon');
const { createStatisticsDatabase } = require('./statisticsDatabase');
// La versión 6 conserva emisión y contraasiento en sus meses de contabilización.
// Las copias anteriores omitían cancelaciones entre meses; deben reconstruirse desde SAP.
const MODEL_VERSION = 6;
const LOCK_NAMESPACE = 72701;
const LOCK_KEY = 20261020;
const TABLE = 'bi_statistics_monthly_snapshots';
const JOBS = 'bi_statistics_snapshot_jobs';
const positiveMinutes = (value, fallback) => Number.isFinite(Number(value)) && Number(value) >= 1 ? Number(value) * 60000 : fallback;
const settings = () => ({ interval: positiveMinutes(process.env.STATISTICS_SYNC_MINUTES, 15 * 60000),
  closedInterval: positiveMinutes(process.env.STATISTICS_CLOSED_RECHECK_MINUTES, 24 * 60 * 60000),
  retryInterval: positiveMinutes(process.env.STATISTICS_FAILED_RETRY_MINUTES, 60 * 60000),
  budget: positiveMinutes(process.env.STATISTICS_MONTH_BUDGET_MINUTES, 10 * 60000) });

function monthsFor(startDate, endDate) {
  const months = [];
  for (let cursor = startDate.slice(0, 7); `${cursor}-01` <= endDate;) {
    months.push(cursor);
    const [year, month] = cursor.split('-').map(Number);
    cursor = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
  }
  return months;
}
function monthPeriod(month, today) {
  const [year, number] = month.split('-');
  const range = monthRange(year, number);
  return dateRange(range.startDate, range.endDate > today ? today : range.endDate);
}
function serializable(value) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new Error('Fecha inválida en el estadístico.');
    const pad = n => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}.${String(value.getMilliseconds()).padStart(3, '0')}`;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Importe o cantidad no finita en el estadístico.');
  if (Array.isArray(value)) return value.map(serializable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializable(item)]));
  return value;
}
function validatePayload(payload) {
  if (!payload?.clinical?._raw || !payload?.financial || !Array.isArray(payload.financial.rows) ||
    !Array.isArray(payload.financial.documents) || !Array.isArray(payload.financial.billing?.rows) ||
    ['charges', 'accounts', 'surgeries', 'births', 'specialtyConsultations', 'specialtyAppointments', 'operatingRoomActivity'].some(key => !Array.isArray(payload.clinical._raw[key]))) {
    throw new Error('La extracción mensual no contiene todas las fuentes verificables.');
  }
  return serializable(payload);
}

function createSnapshotStore({ pool: sourcePool, loadMonth, legacyHistory = {}, today = hospitalToday, now = () => Date.now(), autoDrain = true } = {}) {
  const pool = createStatisticsDatabase(sourcePool);
  let initialized;
  let draining;
  let timer;
  let stopped = false;
  let activeController;
  let drainRequested = false;
  const initialize = () => {
    if (!initialized) initialized = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (
        month VARCHAR(7) PRIMARY KEY CHECK (month ~ '^\\d{4}-\\d{2}$'), model_version INTEGER NOT NULL,
        through_date DATE NOT NULL, payload JSONB NOT NULL, summary JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
      await pool.query(`ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS summary JSONB NOT NULL DEFAULT '{}'::jsonb`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ${JOBS} (
        month VARCHAR(7) PRIMARY KEY CHECK (month ~ '^\\d{4}-\\d{2}$'), status VARCHAR(12) NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0, requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ, last_error_code VARCHAR(64))`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_statistics_jobs_pending ON ${JOBS}(status, priority DESC, requested_at)`);
      await pool.query(`CREATE TABLE IF NOT EXISTS bi_statistics_legacy_history (
        section_id TEXT PRIMARY KEY, payload JSONB NOT NULL, source TEXT NOT NULL DEFAULT 'Excel histórico agregado',
        imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
      for (const [section, payload] of Object.entries(legacyHistory)) {
        const historical = Object.fromEntries(Object.entries(payload).filter(([year]) => Number(year) < 2026));
        await pool.query('INSERT INTO bi_statistics_legacy_history(section_id,payload) VALUES($1,$2::jsonb) ON CONFLICT(section_id) DO NOTHING', [section, JSON.stringify(historical)]);
      }
    })().catch(error => { initialized = null; throw error; });
    return initialized;
  };

  async function queue(months, { force = false, priority = 0 } = {}) {
    await initialize();
    for (const month of months) {
      if (!/^\d{4}-\d{2}$/.test(month) || month < ACTIVE_START.slice(0, 7) || month > today().slice(0, 7)) throw new Error('Mes estadístico inválido.');
      await pool.query(`INSERT INTO ${JOBS}(month,status,priority) VALUES($1,'queued',$2)
        ON CONFLICT(month) DO UPDATE SET
          status=CASE WHEN ${JOBS}.status IN ('queued','running') THEN ${JOBS}.status
            WHEN $3 OR NOT EXISTS (SELECT 1 FROM ${TABLE} s WHERE s.month=$1 AND s.model_version=$4) THEN 'queued' ELSE ${JOBS}.status END,
          requested_at=CASE WHEN ${JOBS}.status IN ('queued','running') THEN ${JOBS}.requested_at ELSE NOW() END,
          priority=GREATEST(${JOBS}.priority,$2)`, [month, priority, force, MODEL_VERSION]);
    }
    if (autoDrain && !stopped && months.length) {
      drainRequested = true;
      setImmediate(() => { drain().catch(() => {}); });
    }
  }

  async function state(months, { includePayload = false, documentsOnly = false } = {}) {
    await initialize();
    const result = await pool.query(`SELECT requested.month,s.model_version,s.through_date::text,s.updated_at,s.summary,
      s.month IS NOT NULL AS has_snapshot${documentsOnly ? ",jsonb_build_object('financial',jsonb_build_object('documents',s.payload->'financial'->'documents')) AS payload" : includePayload ? ',s.payload' : ''},
      j.status,j.last_error_code,j.finished_at FROM UNNEST($1::text[]) AS requested(month)
      LEFT JOIN ${TABLE} s ON s.month=requested.month LEFT JOIN ${JOBS} j ON j.month=requested.month ORDER BY requested.month`, [months]);
    const snapshots = result.rows.filter(row => row.model_version === MODEL_VERSION && row.has_snapshot);
    const entries = result.rows.map(row => ({ month: row.month, available: row.model_version === MODEL_VERSION && Boolean(row.has_snapshot),
      status: row.status || (row.has_snapshot ? 'completed' : 'missing'), updatedAt: row.updated_at?.toISOString?.() || row.updated_at || null,
      throughDate: row.through_date || null, lastAttemptAt: row.finished_at?.toISOString?.() || row.finished_at || null }));
    const missingMonths = entries.filter(row => !row.available).map(row => row.month);
    const pendingMonths = entries.filter(row => ['queued', 'running', 'missing'].includes(row.status)).map(row => row.month);
    const failedMonths = entries.filter(row => row.status === 'failed').map(row => row.month);
    const updated = entries.map(row => row.updatedAt).filter(Boolean).sort();
    return { snapshots, storage: { persisted: true, complete: missingMonths.length === 0, updatedAt: updated[0] || null,
      months: entries.map(row => ({ ...row, status: row.status === 'running' ? 'refreshing' : row.status })), missingMonths, pendingMonths, failedMonths },
    status: pendingMonths.length ? 'refreshing' : failedMonths.length ? 'failed' : 'complete' };
  }

  async function readRange(range, { refresh = false, includePayload = true } = {}) {
    const months = monthsFor(range.startDate, range.endDate);
    const current = await state(months);
    const required = current.storage.months.filter(row => !row.available || (row.month === today().slice(0, 7) && row.throughDate < today()));
     
    const missing = required.filter(row => row.status !== 'failed').map(row => row.month);
    await queue(refresh ? months : missing, { force: refresh || missing.length > 0, priority: 10 });
    return state(months, { includePayload });
  }

  async function readDoctorDocumentsRange(range) {
    return state(monthsFor(range.startDate, range.endDate), { documentsOnly: true });
  }

  async function drain() {
    if (draining) return draining;
    drainRequested = false;
    draining = (async () => {
      await initialize();
      const client = await pool.connect();
      let locked = false;
      let releaseError;
      try {
        locked = Boolean((await client.query('SELECT pg_try_advisory_lock($1,$2) AS locked', [LOCK_NAMESPACE, LOCK_KEY])).rows[0]?.locked);
        if (!locked) return;

        await client.query(`UPDATE ${JOBS} SET status='queued' WHERE status='running'`);
        while (!stopped) {
          const selected = await client.query(`UPDATE ${JOBS} SET status='running',started_at=NOW(),last_error_code=NULL
            WHERE month=(SELECT month FROM ${JOBS} WHERE status='queued' ORDER BY priority DESC,requested_at,month LIMIT 1) RETURNING month`);
          if (!selected.rows.length) break;
          const month = selected.rows[0].month;
          activeController = new AbortController();
          try {
            const range = monthPeriod(month, today());
            const { runExclusive } = require('./backgroundQueue.service');
            const payload = validatePayload(await runExclusive(async () => {
              const budget = setTimeout(() => activeController?.abort(), settings().budget);
              try { return await loadMonth(range, { signal: activeController.signal }); }
              finally { clearTimeout(budget); }
            }));
            const summary = payload.summary || {};
            delete payload.summary;
            if (activeController.signal.aborted) throw Object.assign(new Error('Extracción cancelada.'), { code: 'STATISTICS_SYNC_CANCELLED' });
            await client.query('BEGIN');
            try {
              await client.query(`INSERT INTO ${TABLE}(month,model_version,through_date,payload,summary,updated_at) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,NOW())
                ON CONFLICT(month) DO UPDATE SET model_version=EXCLUDED.model_version,through_date=EXCLUDED.through_date,payload=EXCLUDED.payload,summary=EXCLUDED.summary,updated_at=EXCLUDED.updated_at`,
              [month, MODEL_VERSION, range.endDate, JSON.stringify(payload), JSON.stringify(summary)]);
              await client.query(`UPDATE ${JOBS} SET status='completed',finished_at=NOW(),priority=0,last_error_code=NULL WHERE month=$1`, [month]);
              await client.query('COMMIT');
            } catch (error) {
              try { await client.query('ROLLBACK'); } catch { /* A timed-out connection has already been removed. */ }
              throw error;
            }
          } catch (error) {
            if (error?.code === 'STATISTICS_DB_TIMEOUT') {
              console.error('[statistics] Base local sin responder; se conserva la copia anterior', { month, code: error.code, phase: error.phase });
              releaseError = error;
              break;
            }
            await client.query(`UPDATE ${JOBS} SET status='failed',finished_at=NOW(),priority=0,last_error_code=$2 WHERE month=$1`,
              [month, error?.code === 'SAP_READ_TIMEOUT' ? 'SAP_READ_TIMEOUT' : 'STATISTICS_SOURCE_FAILED']);
            console.error('[statistics] Mes sin actualizar; se conserva la copia anterior', { month, code: error?.code === 'SAP_READ_TIMEOUT' ? 'SAP_READ_TIMEOUT' : 'STATISTICS_SOURCE_FAILED' }); if (error?.code === 'SAP_READ_TIMEOUT') break;
          } finally { activeController?.abort(); activeController = null; }
        }
      } finally {
        try { if (locked && !releaseError) await client.query('SELECT pg_advisory_unlock($1,$2)', [LOCK_NAMESPACE, LOCK_KEY]); }
        catch (error) { releaseError = error; }
        await client.release(releaseError);
      }
      if (releaseError) throw releaseError;
    })().finally(() => {
      draining = null;
      if (drainRequested && !stopped) setImmediate(() => { drain().catch(() => {}); });
    });
    return draining;
  }

  async function schedule({ retry = false } = {}) {
    const all = monthsFor(ACTIVE_START, today());
    const current = await state(all);
    const recent = all.slice(-2);
    const canRetry = row => retry || row.status !== 'failed' || !row.lastAttemptAt || now() - Date.parse(row.lastAttemptAt) >= settings().retryInterval;
    const due = current.storage.months.filter(row => canRetry(row) && recent.includes(row.month) && (retry || !row.updatedAt || now() - Date.parse(row.updatedAt) >= settings().interval));
    const closed = current.storage.months.filter(row => !recent.includes(row.month) && row.available &&
      canRetry(row) && (retry || !row.updatedAt || now() - Date.parse(row.updatedAt) >= settings().closedInterval)).sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)))[0];
    const missing = current.storage.months.filter(row => !row.available && canRetry(row)).map(row => row.month);
    await queue([...new Set([...due.map(row => row.month), ...(closed ? [closed.month] : []), ...missing])], { force: true, priority: retry ? 20 : 0 });
    return state(all);
  }

  async function start() {
    stopped = false;
    await schedule();
    if (!timer) { timer = setInterval(() => { schedule().catch(() => {}); drain().catch(() => {}); }, settings().interval); timer.unref?.(); }
  }
  async function stop() { stopped = true; clearInterval(timer); timer = null; activeController?.abort(); if (draining) await draining; }
  async function readLegacy(section) {
    await initialize();
    const result = await pool.query('SELECT payload FROM bi_statistics_legacy_history WHERE section_id=$1', [section]);
    return result.rows[0]?.payload || {};
  }
  return { initialize, queue, state, readRange, readDoctorDocumentsRange, drain, schedule, start, stop, readLegacy };
}

module.exports = { createSnapshotStore, monthsFor, monthPeriod, serializable, validatePayload, MODEL_VERSION };
