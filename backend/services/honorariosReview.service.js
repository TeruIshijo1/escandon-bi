'use strict';

// Decisiones internas de BI. Este servicio nunca usa las conexiones de SAP o clínica.
const { getDb } = require('../config/db');
let ready;
async function ensureTables() {
  if (!ready) ready = getDb().pool.query(`
    CREATE TABLE IF NOT EXISTS bi_honorarios_reviews (
      row_id text PRIMARY KEY, service_date date NOT NULL, payload jsonb NOT NULL,
      revision integer NOT NULL, updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS bi_honorarios_review_history (
      id bigserial PRIMARY KEY, row_id text NOT NULL, payload jsonb NOT NULL,
      revision integer NOT NULL, updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
    );
  `).catch(error => { ready = undefined; throw error; });
  await ready;
}

function canReview(user) {
  // Mismo permiso que la ruta Honorarios en el catálogo existente de BI.
  return String(user?.username || '').toLowerCase() === 'amendoza'
    || user?.permisos?.includes('interconsultas-jornadas') === true;
}

function validateDecision(input) {
  const { rowId, serviceDate, expectedRevision, decision } = input || {};
  if (typeof rowId !== 'string' || !rowId.trim() || rowId.length > 1000
    || !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate || '') || !Number.isFinite(Date.parse(serviceDate))
    || !Number.isInteger(expectedRevision) || expectedRevision < 0
    || !['APROBAR', 'EXCLUIR', 'PENDIENTE'].includes(decision?.action)
    || typeof decision?.fingerprint !== 'string' || decision.fingerprint.length > 15000
    || typeof decision?.motivo !== 'string' || !decision.motivo.trim() || decision.motivo.length > 2000) {
    throw Object.assign(new Error('La decisión, su motivo o el registro no son válidos.'), { status: 400 });
  }
  const sapDocument = decision.sourceType === 'SAP_DOCUMENTO';
  if (decision.action === 'APROBAR' && !sapDocument && (typeof decision.customAmount !== 'number'
    || !Number.isFinite(decision.customAmount) || decision.customAmount <= 0 || decision.customAmount > 1e9)) {
    throw Object.assign(new Error('Se requiere una base de honorarios positiva.'), { status: 400 });
  }
  if (decision.vatRate !== null && decision.vatRate !== undefined && ![0, 0.08, 0.16].includes(decision.vatRate)) {
    throw Object.assign(new Error('La tasa de IVA no es válida.'), { status: 400 });
  }
  return { rowId, serviceDate, expectedRevision, decision: {
    action: decision.action, customAmount: sapDocument ? null : decision.customAmount ?? null,
    vatRate: sapDocument ? null : decision.vatRate ?? null,
    motivo: decision.motivo.trim(), fingerprint: decision.fingerprint,
    sourceType: sapDocument ? 'SAP_DOCUMENTO' : 'CLINICO',
    separateServicesConfirmed: decision.separateServicesConfirmed === true
  } };
}

async function readReviews(startDate, endDate) {
  await ensureTables();
  const result = await getDb().pool.query(`SELECT row_id, payload, revision, updated_by, updated_at
    FROM bi_honorarios_reviews WHERE service_date BETWEEN $1 AND $2`, [startDate, endDate]);
  return Object.fromEntries(result.rows.map(row => [row.row_id, { ...row.payload,
    revision: row.revision, reviewer: row.updated_by, timestamp: row.updated_at }]));
}

async function saveReview(input, user) {
  if (!canReview(user)) throw Object.assign(new Error('No tienes permiso para aprobar o rechazar honorarios.'), { status: 403 });
  const { rowId, serviceDate, expectedRevision, decision } = validateDecision(input);
  await ensureTables();
  const client = await getDb().pool.connect();
  try {
    await client.query('BEGIN');
    // El bloqueo también protege la primera aprobación de un registro inexistente.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [rowId]);
    const previous = await client.query('SELECT revision FROM bi_honorarios_reviews WHERE row_id=$1 FOR UPDATE', [rowId]);
    if ((previous.rows[0]?.revision || 0) !== expectedRevision) {
      throw Object.assign(new Error('Otra persona modificó este registro. Actualiza el reporte antes de decidir.'), { status: 409 });
    }
    const revision = expectedRevision + 1;
    const reviewer = `${user.id}: ${user.nombre || user.username || 'Usuario BI'}`;
    const saved = await client.query(`INSERT INTO bi_honorarios_reviews (row_id,service_date,payload,revision,updated_by)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT (row_id) DO UPDATE SET service_date=EXCLUDED.service_date,
      payload=EXCLUDED.payload,revision=EXCLUDED.revision,updated_by=EXCLUDED.updated_by,updated_at=now()
      RETURNING updated_at`, [rowId, serviceDate, decision, revision, reviewer]);
    await client.query(`INSERT INTO bi_honorarios_review_history (row_id,payload,revision,updated_by)
      VALUES ($1,$2,$3,$4)`, [rowId, decision, revision, reviewer]);
    await client.query('COMMIT');
    return { ...decision, revision, reviewer, timestamp: saved.rows[0].updated_at };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

module.exports = { readReviews, saveReview, canReview, validateDecision };
