'use strict';

// Fichas internas de BI. No modifica el proveedor ni los documentos de SAP.
const { getDb } = require('../config/db');
const { canReview } = require('./honorariosReview.service');
let ready;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
async function ensureSchema() {
  if (!ready) ready = getDb().pool.query(`
    CREATE TABLE IF NOT EXISTS bi_honorarios_fiscal_profiles (
      provider_id text PRIMARY KEY, payload jsonb NOT NULL, revision integer NOT NULL,
      updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS bi_honorarios_fiscal_profile_history (
      id bigserial PRIMARY KEY, provider_id text NOT NULL, payload jsonb NOT NULL,
      revision integer NOT NULL, updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
    );
  `).catch(error => { ready = undefined; throw error; });
  await ready;
}
function validateProfile(input, provider) {
  if (!provider || String(provider.id) !== String(input.providerId)) throw fail('Selecciona un médico del directorio.');
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw fail('Actualiza la ficha del médico antes de guardar.');
  const enabled = input.enabled !== false;
  const federalTaxId = String(input.federalTaxId || '').trim().toUpperCase();
  const fiscalRegime = String(input.fiscalRegime || '').trim();
  const validFrom = String(input.validFrom || '');
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(validFrom) && Number.isFinite(Date.parse(validFrom))
    && new Date(validFrom).toISOString().slice(0, 10) === validFrom;
  if (enabled && (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(federalTaxId) || !/^\d{3}$/.test(fiscalRegime)
    || !validDate || ![0, 0.0125, 0.1].includes(input.isrRate)
    || ![0, 2 / 3].includes(input.vatFraction) || ![0, 0.08, 0.16].includes(input.defaultVatRate))) {
    throw fail('Completa RFC, régimen, fecha de vigencia, ISR, retención de IVA e IVA habitual. Usa los datos de la constancia fiscal.');
  }
  return { source: 'BI_INTERNO', providerId: String(provider.id), providerName: provider.name,
    enabled, federalTaxId, fiscalRegime, validFrom, isrRate: enabled ? input.isrRate : null,
    vatFraction: enabled ? input.vatFraction : null, defaultVatRate: enabled ? input.defaultVatRate : null,
    confirmed: enabled };
}
async function readProfiles() {
  await ensureSchema();
  const result = await getDb().pool.query('SELECT provider_id,payload,revision,updated_by,updated_at FROM bi_honorarios_fiscal_profiles');
  return Object.fromEntries(result.rows.map(row => [row.provider_id, { ...row.payload, revision: row.revision,
    updatedBy: row.updated_by, updatedAt: row.updated_at }]));
}
async function saveProfile(input, provider, user) {
  if (!canReview(user)) throw fail('No tienes permiso para editar datos fiscales.', 403);
  const payload = validateProfile(input, provider);
  await ensureSchema();
  const client = await getDb().pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`honorarios-fiscal:${payload.providerId}`]);
    const current = await client.query('SELECT revision FROM bi_honorarios_fiscal_profiles WHERE provider_id=$1 FOR UPDATE', [payload.providerId]);
    if ((current.rows[0]?.revision || 0) !== input.expectedRevision) throw fail('Otra persona cambió estos datos. Actualiza la ficha antes de guardar.', 409);
    const revision = input.expectedRevision + 1;
    const updatedBy = `${user.id}: ${user.nombre || user.username || 'Usuario BI'}`;
    const result = await client.query(`INSERT INTO bi_honorarios_fiscal_profiles(provider_id,payload,revision,updated_by)
      VALUES($1,$2,$3,$4) ON CONFLICT(provider_id) DO UPDATE SET payload=EXCLUDED.payload,
      revision=EXCLUDED.revision,updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING updated_at`,
    [payload.providerId, payload, revision, updatedBy]);
    await client.query(`INSERT INTO bi_honorarios_fiscal_profile_history(provider_id,payload,revision,updated_by)
      VALUES($1,$2,$3,$4)`, [payload.providerId, payload, revision, updatedBy]);
    await client.query('COMMIT');
    return { ...payload, revision, updatedBy, updatedAt: result.rows[0].updated_at };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function readHistory(providerId) {
  await ensureSchema();
  return (await getDb().pool.query(`SELECT payload,revision,updated_by,updated_at
    FROM bi_honorarios_fiscal_profile_history WHERE provider_id=$1 ORDER BY revision DESC`, [String(providerId)])).rows;
}
module.exports = { ensureSchema, validateProfile, readProfiles, saveProfile, readHistory };
