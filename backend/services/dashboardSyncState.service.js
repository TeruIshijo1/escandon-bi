'use strict';

const { hospitalToday, addDays } = require('./statisticsCommon');

const STATE_TABLE = 'bi_dashboard_sync_state';
const identifier = /^[A-Za-z][A-Za-z0-9_]{0,62}$/;
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
const minutes = (value, fallback) => Number.isFinite(Number(value)) && Number(value) >= 1 ? Number(value) * 60000 : fallback;
const iso = value => value?.toISOString?.() || value || null;
const day = value => value?.toISOString?.().slice(0, 10) || value || null;

function validDate(value) {
  return typeof value === 'string' && dateOnly.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function failureCode(error) {
  const candidate = error?.code || (error?.status ? `SAP_HTTP_${error.status}` : 'DASHBOARD_SYNC_FAILED');
  return /^[A-Za-z0-9_]{1,64}$/.test(String(candidate)) ? String(candidate) : 'DASHBOARD_SYNC_FAILED';
}

function metadata(row) {
  if (!row) return null;
  return { source: row.source, status: row.status, lastSuccessAt: iso(row.last_success_at),
    lastReconciledAt: iso(row.last_reconciled_at), lastAttemptAt: iso(row.last_attempt_at),
    errorCode: row.last_error_code || null, rows: Number(row.rows || 0), startDate: day(row.start_date),
    coverageStartDate: day(row.coverage_start_date), throughDate: day(row.through_date), modelVersion: Number(row.model_version ?? 1) };
}

/* Planifica y publica cada fuente con su propio punto de control y una transacción. */
function createDashboardSyncState({ pool, sources, now = () => new Date(), today = hospitalToday }) {
  if (!pool?.query || !pool?.connect || !sources || typeof sources !== 'object') throw new TypeError('Configuración de sincronización inválida.');
  const definitions = Object.fromEntries(Object.entries(sources).map(([key, source]) => {
    if (!identifier.test(key) || !identifier.test(source?.table || '') || !validDate(source?.fullStart)
      || (source.modelVersion !== undefined && (!Number.isSafeInteger(source.modelVersion) || source.modelVersion < 1))) {
      throw new TypeError('Fuente de sincronización inválida.');
    }
    return [key, { ...source }];
  }));
  let initialized;
  const active = new Set();

  function definition(key) {
    if (!Object.hasOwn(definitions, key)) throw new TypeError('Fuente de sincronización desconocida.');
    return definitions[key];
  }

  async function initialize() {
    if (!initialized) initialized = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS ${STATE_TABLE} (
        source VARCHAR(63) PRIMARY KEY, last_success_at TIMESTAMPTZ, last_reconciled_at TIMESTAMPTZ,
        last_attempt_at TIMESTAMPTZ, status VARCHAR(20) NOT NULL, last_error_code VARCHAR(64),
        "rows" BIGINT NOT NULL DEFAULT 0, start_date DATE, coverage_start_date DATE, through_date DATE,
        model_version INTEGER NOT NULL DEFAULT 1
      )`);
      await pool.query(`ALTER TABLE ${STATE_TABLE} ADD COLUMN IF NOT EXISTS coverage_start_date DATE,
        ADD COLUMN IF NOT EXISTS through_date DATE, ADD COLUMN IF NOT EXISTS model_version INTEGER NOT NULL DEFAULT 1`);
    })().catch(error => { initialized = null; throw error; });
    await initialized;
  }

  async function read(key) {
    definition(key);
    await initialize();
    const result = await pool.query(`SELECT * FROM ${STATE_TABLE} WHERE source=$1`, [key]);
    return metadata(result.rows[0]);
  }

  async function run(key, work, { fullSync = false } = {}) {
    const source = definition(key);
    if (typeof work !== 'function') throw new TypeError('Falta el trabajo de sincronización.');
    const result = { source: key, status: 'skipped', startDate: null, reconciled: false, rows: 0, errorCode: null };
    if (active.has(key)) return { ...result, errorCode: 'DASHBOARD_SYNC_IN_PROGRESS' };
    active.add(key);
    let client;
    let transaction = false;
    let failure;
    let attemptedAt;
    try {
      attemptedAt = new Date(now());
      if (Number.isNaN(attemptedAt.getTime())) throw new Error('Fecha de sincronización inválida.');
      const endDate = today(attemptedAt);
      if (!validDate(endDate) || endDate < source.fullStart) throw new Error('Periodo de sincronización inválido.');
      await initialize();
      client = await pool.connect();
      const current = metadata((await client.query(`SELECT * FROM ${STATE_TABLE} WHERE source=$1`, [key])).rows[0]);
      const modelVersion = source.modelVersion ?? 1;
      const modelMismatch = source.modelVersion !== undefined && current?.modelVersion !== modelVersion;
      const retry = minutes(process.env.DASHBOARD_SYNC_RETRY_MINUTES, 15 * 60000);
      if (current?.status === 'error' && current.lastAttemptAt && attemptedAt - new Date(current.lastAttemptAt) < retry) {
        return { ...result, startDate: current.startDate, errorCode: current.errorCode };
      }
      if (!fullSync && !modelMismatch && current?.status === 'complete' && current.lastSuccessAt
        && attemptedAt - new Date(current.lastSuccessAt) < 15 * 60000) {
        return { ...result, startDate: current.startDate };
      }

      const populated = (await client.query(`SELECT EXISTS (SELECT 1 FROM "${source.table}" LIMIT 1) AS has_rows`)).rows[0]?.has_rows;
      const bootstrap = fullSync || modelMismatch || (!current?.lastSuccessAt && (!populated || source.fullOnFirstSync === true));
      const recheck = minutes(process.env.DASHBOARD_SYNC_RECHECK_MINUTES, 1440 * 60000);
      const reconciling = bootstrap || !current?.lastSuccessAt || !current.lastReconciledAt
        || attemptedAt - new Date(current.lastReconciledAt) >= recheck;
      const configuredDays = Number(process.env.DASHBOARD_SYNC_RECENT_DAYS);
      const recentDays = Number.isFinite(configuredDays) ? Math.max(2, Math.floor(configuredDays)) : 2;
      let startDate = bootstrap ? source.fullStart : addDays(endDate, reconciling ? -15 : -(recentDays - 1));
      // Un reinicio o una pausa larga no debe abrir un hueco entre dos extracciones.
      if (!bootstrap && current?.lastSuccessAt) {
        const overlap = addDays(today(new Date(current.lastSuccessAt)), -1);
        if (overlap < startDate) startDate = overlap;
      }
      if (startDate < source.fullStart) startDate = source.fullStart;
      result.startDate = startDate;
      await client.query('BEGIN');
      transaction = true;
      const count = await work({ startDate, endDate, client, fullSync: bootstrap, reconciling });
      if (!Number.isSafeInteger(count) || count < 0) {
        const error = new Error('La fuente no confirmó su número de registros.');
        error.code = 'DASHBOARD_SYNC_INVALID_COUNT';
        throw error;
      }
      if (source.allowEmpty === false && count === 0) {
        const error = new Error('La fuente no devolvió registros verificables.');
        error.code = 'DASHBOARD_SYNC_EMPTY_RESULT';
        throw error;
      }
      await client.query(`INSERT INTO ${STATE_TABLE}
        (source,last_success_at,last_reconciled_at,last_attempt_at,status,last_error_code,"rows",start_date,coverage_start_date,through_date,model_version)
        VALUES($1,$2,$3,$2,'complete',NULL,$4,$5,$5,$6,$7)
        ON CONFLICT(source) DO UPDATE SET last_success_at=EXCLUDED.last_success_at,
          last_reconciled_at=COALESCE(EXCLUDED.last_reconciled_at,${STATE_TABLE}.last_reconciled_at),
          last_attempt_at=EXCLUDED.last_attempt_at,status='complete',last_error_code=NULL,
          "rows"=EXCLUDED."rows",start_date=EXCLUDED.start_date,
          coverage_start_date=CASE WHEN ${STATE_TABLE}.model_version IS DISTINCT FROM EXCLUDED.model_version THEN EXCLUDED.coverage_start_date
            ELSE LEAST(COALESCE(${STATE_TABLE}.coverage_start_date,EXCLUDED.coverage_start_date),EXCLUDED.coverage_start_date) END,
          through_date=CASE WHEN ${STATE_TABLE}.model_version IS DISTINCT FROM EXCLUDED.model_version THEN EXCLUDED.through_date
            ELSE GREATEST(COALESCE(${STATE_TABLE}.through_date,EXCLUDED.through_date),EXCLUDED.through_date) END,
          model_version=EXCLUDED.model_version`,
      [key, attemptedAt, reconciling ? attemptedAt : null, count, startDate, endDate, modelVersion]);
      await client.query('COMMIT');
      transaction = false;
      return { ...result, status: 'complete', reconciled: reconciling, rows: count };
    } catch (error) {
      failure = error;
      if (transaction) {
        try { await client.query('ROLLBACK'); } catch (_) { /* Liberar también una conexión fallida. */ }
      }
    } finally {
      if (client) client.release();
      if (!failure) active.delete(key);
    }

    const errorCode = failureCode(failure);
    try {
      // Fuera de la transacción fallida; conserva las fechas y filas del último éxito.
      await initialize();
      await pool.query(`INSERT INTO ${STATE_TABLE}(source,last_attempt_at,status,last_error_code)
        VALUES($1,$2,'error',$3) ON CONFLICT(source) DO UPDATE SET
        last_attempt_at=EXCLUDED.last_attempt_at,status='error',last_error_code=EXCLUDED.last_error_code`,
      [key, attemptedAt || new Date(), errorCode]);
    } catch (_) { /* El fallo de conexión no debe convertirse en un éxito de fuente. */ }
    finally { active.delete(key); }
    return { ...result, status: 'error', errorCode };
  }

  return { run, read };
}

module.exports = { createDashboardSyncState };
