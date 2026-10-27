'use strict';

const { isHonorariosScopeExcluded } = require('../utils/honorariosScope');

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
    CREATE TABLE IF NOT EXISTS bi_honorarios_finalized_rows (
      row_id text PRIMARY KEY, liquidation_id bigint NOT NULL, snapshot jsonb NOT NULL,
      finalized_at timestamptz NOT NULL DEFAULT now()
    );
  `).catch(error => { ready = undefined; throw error; });
  await ready;
}

function canReview(user) {
   
  return String(user?.username || '').toLowerCase() === 'amendoza'
    || user?.permisos?.includes('interconsultas-jornadas') === true;
}

function validateDecision(input, sourceValidated = false) {
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
  const biService = sourceValidated && decision.sourceType === 'BI_PRESTACION';
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
    sourceType: sapDocument ? 'SAP_DOCUMENTO' : biService ? 'BI_PRESTACION' : 'CLINICO',
    separateServicesConfirmed: decision.separateServicesConfirmed === true,
    ...(biService ? { snapshot: decision.snapshot || null, executionConfirmed: decision.executionConfirmed === true,
      evidenceReference: String(decision.evidenceReference || '').trim().slice(0, 1000),
      duplicateConfirmed: decision.duplicateConfirmed === true, providerId: decision.providerId,
      quantity: decision.quantity, physicianChangeReason: decision.snapshot?.physicianCorrection?.reason || null } : {})
  } };
}

function recordPhysicianCorrection(decision, previous, user) {
  const snapshot = decision.snapshot;
  const correction = snapshot?.physicianCorrection;
  if (decision.action !== 'APROBAR' || !correction) return;
  if (typeof correction.reason !== 'string' || !correction.reason.trim() || correction.reason.trim().length > 2000
    || String(correction.toProviderId) !== String(snapshot.providerId)) {
    throw Object.assign(new Error('Escribe un motivo válido para la corrección del médico.'), { status: 400 });
  }
  const fields = ['fromProviderId', 'fromProviderName', 'toProviderId', 'toProviderName', 'reason'];
  const original = previous?.snapshot;
  const previousCorrection = original?.physicianCorrection;
  const sameCorrection = previous?.action === 'APROBAR' && previousCorrection && original.sourceFingerprint === snapshot.sourceFingerprint
    && original.rowId === snapshot.rowId && String(original.providerId) === String(snapshot.providerId)
    && fields.every(key => previousCorrection[key] === correction[key]);

  const attribution = sameCorrection ? {
    correctedBy: previousCorrection.correctedBy, correctedAt: previousCorrection.correctedAt
  } : {
    correctedBy: { id: user.id, name: user.nombre || user.username || 'Usuario BI', username: user.username || null },
    correctedAt: new Date().toISOString()
  };
  decision.snapshot = { ...snapshot, physicianCorrection: {
    ...Object.fromEntries(fields.map(key => [key, correction[key]])), reason: correction.reason.trim(), ...attribution
  } };
  decision.physicianChangeReason = correction.reason.trim();
}

async function readReviews(startDate, endDate) {
  await ensureTables();
  const result = await getDb().pool.query(`SELECT row_id, payload, revision, updated_by, updated_at
    FROM bi_honorarios_reviews WHERE service_date BETWEEN $1 AND $2`, [startDate, endDate]);
  return Object.fromEntries(result.rows.map(row => [row.row_id, { ...row.payload,
    revision: row.revision, reviewer: row.updated_by, timestamp: row.updated_at }]));
}

async function saveReview(input, user, { sourceValidated = false } = {}) {
  if (!canReview(user)) throw Object.assign(new Error('No tienes permiso para aprobar o rechazar honorarios.'), { status: 403 });
  const { rowId, serviceDate, expectedRevision, decision } = validateDecision(input, sourceValidated);
  await ensureTables();
  const client = await getDb().pool.connect();
  try {
    await client.query('BEGIN');
     
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [rowId]);
    const closed = await client.query('SELECT liquidation_id FROM bi_honorarios_finalized_rows WHERE row_id=$1', [rowId]);
    if (closed.rows.length) throw Object.assign(new Error('Este servicio pertenece a una liquidación cerrada. Registra un ajuste en el cierre para conservar el historial.'), { status: 409 });
    if (decision.action === 'APROBAR' && decision.snapshot) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`honorarios-catalog:${decision.snapshot.itemCode}`]);
      const config = await client.query('SELECT revision,status,source_active,scope_excluded,item_code,name,description,group_name,reference_prices,source_metadata FROM bi_honorarios_catalog WHERE item_code=$1 FOR UPDATE', [decision.snapshot.itemCode]);
      const tariff = await client.query('SELECT revision,active FROM bi_honorarios_tariffs WHERE id=$1 FOR UPDATE', [decision.snapshot.tariff.id]);
      if (config.rows[0]?.revision !== decision.snapshot.catalog.revision || config.rows[0]?.status !== 'INCLUIDO'
        || config.rows[0]?.source_active !== true || isHonorariosScopeExcluded(config.rows[0])
        || tariff.rows[0]?.revision !== decision.snapshot.tariff.revision || !tariff.rows[0]?.active) {
        throw Object.assign(new Error('Cambió la configuración o tarifa durante la aprobación. Actualiza el reporte.'), { status: 409 });
      }
      const allocation = decision.snapshot.allocationKey;
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`allocation:${allocation}`]);
      const used = await client.query(`SELECT COALESCE(sum((payload->'snapshot'->>'quantity')::numeric),0) AS quantity
        FROM bi_honorarios_reviews WHERE row_id<>$1 AND payload->>'action'='APROBAR'
        AND payload->'snapshot'->>'allocationKey'=$2`, [rowId, allocation]);
      if (Number(used.rows[0].quantity) + decision.snapshot.quantity > decision.snapshot.maximumQuantity + 1e-8) {
        throw Object.assign(new Error('La cantidad ya reconocida en otras citas supera la cantidad de esta línea. Revisa la distribución antes de aprobar.'), { status: 409 });
      }
    }
    const previous = await client.query('SELECT revision,payload FROM bi_honorarios_reviews WHERE row_id=$1 FOR UPDATE', [rowId]);
    if ((previous.rows[0]?.revision || 0) !== expectedRevision) {
      throw Object.assign(new Error('Otra persona modificó este registro. Actualiza el reporte antes de decidir.'), { status: 409 });
    }
    recordPhysicianCorrection(decision, previous.rows[0]?.payload, user);
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

module.exports = { readReviews, saveReview, canReview, validateDecision, ensureTables };
