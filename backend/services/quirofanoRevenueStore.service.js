'use strict';
const { createDashboardSyncState } = require('./dashboardSyncState.service');
const { createDashboardBatchWriter } = require('./dashboardBatchWriter.service');
const { hospitalToday, addDays, dateOnly } = require('./statisticsCommon');
const SOURCE = 'quirofanoIngresos', MODEL = 3;
const LEDGER = 'bi_quirofano_revenue_days';
const iso = value => value?.toISOString?.() || value || null;
const failure = code => Object.assign(new Error('No se pudo guardar una copia completa de ingresos de Quirófano.'), { code });

function createQuirofanoRevenueStore({ pool, now = () => new Date(), today = hospitalToday }) {
  if (!pool?.query || !pool?.connect) throw new TypeError('Falta la conexión local de ingresos de Quirófano.');
  const clock = () => { const value = new Date(now()); if (!Number.isFinite(value.getTime())) throw new TypeError('Fecha de actualización inválida.'); return value; };
  const horizon = () => { const endDate = dateOnly(today(clock())); return { startDate: addDays(endDate, -365), endDate }; };
  const range = options => {
    const period = options?.startDate === undefined && options?.endDate === undefined ? horizon() : options;
    const startDate = dateOnly(period?.startDate), endDate = dateOnly(period?.endDate);
    if (startDate > endDate || (Date.parse(endDate) - Date.parse(startDate)) / 86400000 > 3660) throw new TypeError('Periodo de ingresos de Quirófano inválido.');
    return { startDate, endDate };
  };
  const shared = createDashboardSyncState({ pool, sources: { [SOURCE]: { table: 'dw_sap_quirofano_analiticas', fullStart: horizon().startDate, modelVersion: MODEL } } });
  let initialized;

  async function initialize() {
    if (!initialized) initialized = (async () => {
      const legacy = await shared.read(SOURCE);
      await pool.query(`CREATE TABLE IF NOT EXISTS ${LEDGER} (
        day DATE PRIMARY KEY,model_version INTEGER NOT NULL DEFAULT 3,last_success_at TIMESTAMPTZ,last_attempt_at TIMESTAMPTZ,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',last_error_code VARCHAR(64),"rows" BIGINT NOT NULL DEFAULT 0,
        refresh_requested_at TIMESTAMPTZ
      )`);
      if (legacy?.modelVersion === 2 && legacy.lastSuccessAt && legacy.coverageStartDate && legacy.throughDate) {
        const { startDate, endDate } = horizon();
        await pool.query(`INSERT INTO ${LEDGER} AS saved(day,model_version,last_success_at,last_attempt_at,status,"rows")
          SELECT d::date,3,s.last_success_at,s.last_success_at,'complete',COALESCE(counts.count,0)
          FROM bi_dashboard_sync_state s
          CROSS JOIN LATERAL generate_series(GREATEST(s.coverage_start_date,$1::date),LEAST(s.through_date,$2::date),'1 day') d
          LEFT JOIN (SELECT startdate,COUNT(*) AS count FROM dw_sap_quirofano_analiticas WHERE startdate=enddate GROUP BY startdate) counts ON counts.startdate=d::date
          WHERE s.source=$3 AND s.model_version=2 AND s.last_success_at IS NOT NULL
            AND s.coverage_start_date<=s.through_date
          ON CONFLICT(day) DO UPDATE SET model_version=3,last_success_at=EXCLUDED.last_success_at,
            last_attempt_at=COALESCE(saved.last_attempt_at,EXCLUDED.last_attempt_at),
            status=CASE WHEN saved.status='error' THEN 'error' ELSE 'complete' END,"rows"=EXCLUDED."rows"
          WHERE saved.model_version<=3 AND saved.last_success_at IS NULL`, [startDate, endDate, SOURCE]);
      }
    })().catch(error => { initialized = null; throw error; });
    await initialized;
  }

  async function withLock(work) {
    if (typeof work !== 'function') throw new TypeError('Falta el trabajo de ingresos de Quirófano.');
    await initialize();
    const client = await pool.connect();
    let locked = false, releaseError;
    try {
      locked = (await client.query('SELECT pg_try_advisory_lock(72703,20261020) AS locked')).rows[0]?.locked === true;
      if (!locked) return { source: SOURCE, status: 'skipped', errorCode: 'QX_REVENUE_IN_PROGRESS' };
      return await work(client);
    } finally {
      try { if (locked) await client.query('SELECT pg_advisory_unlock(72703,20261020)'); }
      catch (error) { releaseError = error; }
      finally { client.release(releaseError); }
    }
  }

  async function seed(client, period) {
    await client.query(`INSERT INTO ${LEDGER}(day) SELECT d::date FROM generate_series($1::date,$2::date,'1 day') d ON CONFLICT(day) DO NOTHING`, [period.startDate, period.endDate]);
  }

  async function plan(client, { fullSync = false, limit = 28 } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 366) throw new TypeError('Límite de actualización inválido.');
    await initialize();
    const period = horizon(), at = clock();
    await seed(client, period);
    if (fullSync) await client.query(`UPDATE ${LEDGER} SET refresh_requested_at=GREATEST($3::timestamptz,COALESCE(last_success_at,'-infinity'::timestamptz)+INTERVAL '1 millisecond') WHERE day BETWEEN $1 AND $2`, [period.startDate, period.endDate, at]);
    const result = await client.query(`SELECT day::text AS date,(status='error') AS failed_before FROM ${LEDGER}
      WHERE day BETWEEN $1 AND $2 AND (status<>'error' OR last_attempt_at IS NULL OR last_attempt_at<=$3::timestamptz-INTERVAL '15 minutes')
        AND (last_success_at IS NULL OR model_version<>3 OR status='error' OR refresh_requested_at>last_success_at
          OR (day>=$2::date-1 AND last_success_at<=$3::timestamptz-INTERVAL '15 minutes')
          OR (day>=$2::date-14 AND last_success_at<=$3::timestamptz-INTERVAL '24 hours'))
      ORDER BY (day>=$2::date-1) DESC,day DESC LIMIT $4`, [period.startDate, period.endDate, at, limit]);
    return { days: result.rows.map(row => ({ date: row.date, failedBefore: row.failed_before === true })), horizonStart: period.startDate, horizonEnd: period.endDate };
  }

  async function status(client, period) {
    const result = await client.query(`SELECT d::date::text AS date,l.model_version,l.last_success_at,l.last_attempt_at,
      l.status,l.last_error_code,l."rows",l.refresh_requested_at FROM generate_series($1::date,$2::date,'1 day') d
      LEFT JOIN ${LEDGER} l ON l.day=d::date ORDER BY d DESC`, [period.startDate, period.endDate]);
    let completeDays = 0, pendingDays = 0, failedDays = 0, rows = 0, coverageStartDate = null, throughDate = null, lastSuccessAt = null;
    let blockEnded = false, latestAttempt = null, errorCode = null, lastErrorAttempt = null;
    for (const day of result.rows) {
      const confirmed = Number(day.model_version) === MODEL && Boolean(day.last_success_at);
      const success = iso(day.last_success_at), attempt = iso(day.last_attempt_at);
      if (confirmed) { completeDays += 1; rows += Number(day.rows || 0); }
      if (!confirmed || (day.refresh_requested_at && (!success || new Date(day.refresh_requested_at) > new Date(success)))) pendingDays += 1;
      if (day.status === 'error') {
        failedDays += 1;
        if (!lastErrorAttempt || (attempt && new Date(attempt) > new Date(lastErrorAttempt))) { lastErrorAttempt = attempt; errorCode = day.last_error_code; }
      }
      if (attempt && (!latestAttempt || new Date(attempt) > new Date(latestAttempt))) latestAttempt = attempt;
      if (!blockEnded && confirmed) {
        if (!throughDate) throughDate = day.date;
        coverageStartDate = day.date;
        if (!lastSuccessAt || new Date(success) < new Date(lastSuccessAt)) lastSuccessAt = success;
      } else if (throughDate) blockEnded = true;
    }
    return { source: SOURCE, status: failedDays ? 'error' : pendingDays ? 'pending' : 'complete', modelVersion: MODEL,
      lastSuccessAt,lastAttemptAt: latestAttempt,errorCode: errorCode || null,coverageStartDate,throughDate,
      pendingDays,failedDays,completeDays,backfillPending: completeDays < result.rows.length,rows };
  }

  async function summary(client, at) {
    const period = horizon(), current = await status(client, period);
    await client.query(`INSERT INTO bi_dashboard_sync_state(source,last_success_at,last_reconciled_at,last_attempt_at,status,last_error_code,"rows",start_date,coverage_start_date,through_date,model_version)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,3) ON CONFLICT(source) DO UPDATE SET
      last_success_at=EXCLUDED.last_success_at,last_reconciled_at=COALESCE(EXCLUDED.last_reconciled_at,bi_dashboard_sync_state.last_reconciled_at),
      last_attempt_at=EXCLUDED.last_attempt_at,status=EXCLUDED.status,last_error_code=EXCLUDED.last_error_code,"rows"=EXCLUDED."rows",
      start_date=EXCLUDED.start_date,coverage_start_date=EXCLUDED.coverage_start_date,through_date=EXCLUDED.through_date,model_version=3`,
    [SOURCE,current.lastSuccessAt,current.status === 'complete' ? at : null,at,current.status === 'pending' ? 'partial' : current.status,
      current.errorCode,current.rows,period.startDate,current.coverageStartDate,current.throughDate]);
    return current;
  }

  async function transaction(client, work) {
    await client.query('BEGIN');
    try { const result = await work(); await client.query('COMMIT'); return result; }
    catch (error) { try { await client.query('ROLLBACK'); } catch { /* Preserve the publication failure. */ } throw error; }
  }

  async function publish(client, { startDate, endDate, records }) {
    const period = range({ startDate, endDate }), at = clock(), counts = new Map(), seen = new Set();
    if (!Array.isArray(records)) throw failure('SAP_QX_INVALID_RESPONSE');
    for (const row of records) {
      if (!Array.isArray(row) || row.length !== 5 || !['TOTAL','MEDICO','SERVICIO'].includes(row[0]) || typeof row[1] !== 'string'
        || row[2] == null || !['string','number'].includes(typeof row[2]) || String(row[2]).trim() === '' || !Number.isFinite(Number(row[2]))
        || dateOnly(row[3]) !== dateOnly(row[4]) || row[3] < startDate || row[3] > endDate) throw failure('SAP_QX_INVALID_ROW');
      const key = JSON.stringify([row[0],row[1],row[3]]);
      if (seen.has(key)) throw failure('SAP_QX_DUPLICATE_ROW');
      seen.add(key); counts.set(row[3], (counts.get(row[3]) || 0) + 1);
    }
    return transaction(client, async () => {
      await client.query('DELETE FROM dw_sap_quirofano_analiticas WHERE startdate BETWEEN $1 AND $2', [startDate,endDate]);
      const writer = createDashboardBatchWriter(client, 250);
      for (const row of records) await writer.query(`INSERT INTO dw_sap_quirofano_analiticas(tipo,nombre,ingresos,startdate,enddate,sync_date)
        VALUES($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)`, row);
      await writer.flush();
      await client.query(`INSERT INTO ${LEDGER} AS saved(day,model_version,last_success_at,last_attempt_at,status,last_error_code,"rows",refresh_requested_at)
        SELECT d::date,3,$3,$3,'complete',NULL,COALESCE(c.count,0),NULL FROM generate_series($1::date,$2::date,'1 day') d
        LEFT JOIN jsonb_to_recordset($4::jsonb) AS c(day date,count bigint) ON c.day=d::date
        ON CONFLICT(day) DO UPDATE SET model_version=3,last_success_at=EXCLUDED.last_success_at,last_attempt_at=EXCLUDED.last_attempt_at,
          status='complete',last_error_code=NULL,"rows"=EXCLUDED."rows",refresh_requested_at=NULL`,
      [startDate,endDate,at,JSON.stringify([...counts].map(([day,count]) => ({ day,count })))]);
      return summary(client, at);
    });
  }

  async function fail(client, { startDate, endDate, errorCode }) {
    range({ startDate,endDate });
    const at = clock(), code = /^[A-Za-z0-9_]{1,64}$/.test(String(errorCode)) ? String(errorCode) : 'SAP_QX_SYNC_FAILED';
    return transaction(client, async () => {
      await client.query(`INSERT INTO ${LEDGER}(day,last_attempt_at,status,last_error_code)
        SELECT d::date,$3,'error',$4 FROM generate_series($1::date,$2::date,'1 day') d
        ON CONFLICT(day) DO UPDATE SET last_attempt_at=EXCLUDED.last_attempt_at,status='error',last_error_code=EXCLUDED.last_error_code`, [startDate,endDate,at,code]);
      return summary(client, at);
    });
  }

  async function getStatus(options = {}) { await initialize(); return status(pool, range(options)); }
  return { withLock,plan,publish,fail,getStatus };
}

module.exports = { createQuirofanoRevenueStore };
