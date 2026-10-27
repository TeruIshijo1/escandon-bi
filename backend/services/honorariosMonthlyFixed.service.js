'use strict';

// confirma la identidad; cada mensualidad requiere una decisión explícita
const { createHash } = require('node:crypto');
const { getDb } = require('../config/db');
const { canReview, ensureTables } = require('./honorariosReview.service');
const { getProviderDirectory, validatePeriod } = require('./honorariosSources.service');
const { reviewFingerprint } = require('../utils/honorariosReviewSource');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const by = user => `${user.id ?? user.username ?? 'BI'}: ${user.nombre || user.username || 'Usuario BI'}`;
let ready;

function month(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value)) throw fail('Selecciona un mes válido.');
  return value;
}
function previousMonth(value) {
  const [year, number] = value.split('-').map(Number);
  return `${String(number === 1 ? year - 1 : year).padStart(4, '0')}-${String(number === 1 ? 12 : number - 1).padStart(2, '0')}`;
}
function nextMonth(value) {
  const [year, number] = value.split('-').map(Number);
  return `${number === 12 ? year + 1 : year}-${String(number === 12 ? 1 : number + 1).padStart(2, '0')}`;
}
const dateMonth = value => value instanceof Date ? value.toISOString().slice(0, 7) : String(value || '').slice(0, 7);
function providerIdentity(value) {
  if (!['string', 'number'].includes(typeof value) || !/^[1-9]\d*$/.test(String(value))
    || !Number.isSafeInteger(Number(value))) throw fail('Selecciona un médico del directorio.');
  return String(Number(value));
}
function parseRowId(value) {
  const parts = typeof value === 'string' ? value.split('|') : [];
  if (parts.length !== 3 || parts[0] !== 'FIXED') throw fail('Selecciona una mensualidad válida.');
  const providerId = providerIdentity(parts[1]), feeMonth = month(parts[2]);
  if (`FIXED|${providerId}|${feeMonth}` !== value) throw fail('Selecciona una mensualidad válida.');
  return { providerId, month: feeMonth };
}
function validateAssignment(input) {
  if (!input || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 0
    || (input.id !== undefined && (!Number.isSafeInteger(Number(input.id)) || Number(input.id) <= 0))
    || typeof input.area !== 'string' || !input.area.trim() || input.area.length > 200
    || typeof input.amount !== 'number' || !Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 1e9
    || Math.abs(input.amount * 100 - Math.round(input.amount * 100)) > 1e-6
    || (input.active !== undefined && typeof input.active !== 'boolean')
    || (input.reason !== undefined && (typeof input.reason !== 'string' || input.reason.length > 2000))) {
    throw fail('Revisa el médico, área e importe mensual; el importe debe ser positivo y tener hasta dos decimales.');
  }
  if ((input.amountBasis || 'BASE') !== 'BASE') throw fail('El pago fijo se captura antes de impuestos. El importe neto aún no está disponible.');
  if ((input.monthPolicy || 'FULL_MONTH') !== 'FULL_MONTH') throw fail('El pago fijo se reconoce completo por mes.');
  const validFromMonth = month(input.validFromMonth);
  const validToMonth = input.validToMonth ? month(input.validToMonth) : null;
  if (validToMonth && validToMonth < validFromMonth) throw fail('El último mes debe ser igual o posterior al primero.');
  return { id: input.id ? Number(input.id) : null, expectedRevision: input.expectedRevision,
    providerId: providerIdentity(input.providerId), area: input.area.trim(), amount: Math.round(input.amount * 100) / 100,
    amountBasis: 'BASE', monthPolicy: 'FULL_MONTH', validFromMonth, validToMonth,
    active: input.active !== false, deactivatedFromMonth: input.deactivatedFromMonth ? month(input.deactivatedFromMonth) : null,
    reason: (input.reason || '').trim() };
}
function assignment(row) {
  return { id: Number(row.id), providerId: row.provider_id, providerName: row.provider_name, area: row.area,
    amount: Number(row.amount), amountBasis: row.amount_basis, monthPolicy: row.month_policy,
    validFromMonth: dateMonth(row.valid_from_month), validToMonth: row.valid_to_month ? dateMonth(row.valid_to_month) : null,
    active: row.active, deactivatedFromMonth: row.deactivated_from_month ? dateMonth(row.deactivated_from_month) : null,
    revision: row.revision, updatedBy: row.updated_by, updatedAt: row.updated_at, createdAt: row.created_at };
}
function effectiveEnd(config) {
  const cutoff = config.active ? null : config.deactivatedFromMonth ? previousMonth(config.deactivatedFromMonth) : '0000-00';
  return [config.validToMonth, cutoff].filter(Boolean).sort()[0] || '9999-12';
}
function applies(config, feeMonth) {
  return config.validFromMonth <= feeMonth && feeMonth <= effectiveEnd(config);
}
function overlaps(first, second) {
  return first.providerId === second.providerId && first.validFromMonth <= effectiveEnd(first)
    && second.validFromMonth <= effectiveEnd(second)
    && first.validFromMonth <= effectiveEnd(second) && second.validFromMonth <= effectiveEnd(first);
}
async function ensureSchema() {
  await ensureTables();
  if (!ready) ready = getDb().pool.query(`
    CREATE TABLE IF NOT EXISTS bi_honorarios_monthly_fixed_assignments (
      id bigserial PRIMARY KEY, provider_id text NOT NULL, provider_name text NOT NULL,
      area text NOT NULL, amount numeric(18,2) NOT NULL CHECK(amount>0),
      amount_basis text NOT NULL CHECK(amount_basis='BASE'), month_policy text NOT NULL CHECK(month_policy='FULL_MONTH'),
      valid_from_month date NOT NULL, valid_to_month date,
      active boolean NOT NULL DEFAULT true, deactivated_from_month date,
      revision integer NOT NULL CHECK(revision>0), updated_by text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
      CHECK(extract(day FROM valid_from_month)=1), CHECK(valid_to_month IS NULL OR (extract(day FROM valid_to_month)=1 AND valid_to_month>=valid_from_month)),
      CHECK(deactivated_from_month IS NULL OR extract(day FROM deactivated_from_month)=1)
    );
    CREATE INDEX IF NOT EXISTS bi_honorarios_monthly_fixed_provider_idx ON bi_honorarios_monthly_fixed_assignments(provider_id);
    CREATE TABLE IF NOT EXISTS bi_honorarios_monthly_fixed_history (
      id bigserial PRIMARY KEY, assignment_id bigint NOT NULL REFERENCES bi_honorarios_monthly_fixed_assignments(id),
      payload jsonb NOT NULL, revision integer NOT NULL, updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
    );
  `).catch(error => { ready = undefined; throw error; });
  await ready;
}
async function listAssignments() {
  await ensureSchema();
  return (await getDb().pool.query('SELECT * FROM bi_honorarios_monthly_fixed_assignments ORDER BY provider_name,valid_from_month,id')).rows.map(assignment);
}
async function history(client, saved, user, reason, operation) {
  await client.query(`INSERT INTO bi_honorarios_monthly_fixed_history(assignment_id,payload,revision,updated_by)
    VALUES($1,$2,$3,$4)`, [saved.id, { ...saved, reason, operation }, saved.revision, by(user)]);
}
async function assertProvider(pool, id) {
  const providers = await getProviderDirectory(pool);
  const matches = providers.filter(item => String(item.id) === id && item.role === 'P' && String(item.name || '').trim());
  if (matches.length !== 1) throw fail('El médico no está disponible en el directorio. Actualiza la lista y selecciona un médico válido.');
  return matches[0];
}
async function saveAssignment(pool, input, user) {
  if (!canReview(user)) throw fail('No tienes permiso para administrar pagos fijos.', 403);
  if (input?.id && input.active === false) return deactivateAssignment(pool, input, user);
  const config = validateAssignment(input);
  const provider = await assertProvider(pool, config.providerId);
  await ensureSchema();
  const client = await getDb().pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`honorarios-fixed-provider:${config.providerId}`]);
    const existing = (await client.query('SELECT * FROM bi_honorarios_monthly_fixed_assignments WHERE provider_id=$1 FOR UPDATE', [config.providerId])).rows.map(assignment);
    const previous = config.id ? existing.find(item => item.id === config.id) : null;
    if (config.id && !previous) throw fail('No se encontró esta configuración para el médico.', 404);
    if ((previous?.revision || 0) !== config.expectedRevision) throw fail('Otra persona modificó esta configuración. Actualiza la lista.', 409);
    const split = previous && config.validFromMonth > previous.validFromMonth;
    if (split && previous.validToMonth && config.validFromMonth > nextMonth(previous.validToMonth)) throw fail('Crea una nueva configuración para una vigencia separada.');
    if (existing.some(item => item.id !== config.id && overlaps(config, item))) throw fail('Este médico ya tiene un pago fijo en esos meses. Revisa las vigencias antes de guardar.', 409);
    if (split) {
      const end = previousMonth(config.validFromMonth);
      const result = await client.query(`UPDATE bi_honorarios_monthly_fixed_assignments SET valid_to_month=$2,
        revision=revision+1,updated_by=$3,updated_at=now() WHERE id=$1 RETURNING *`, [previous.id, `${end}-01`, by(user)]);
      await history(client, assignment(result.rows[0]), user, config.reason, 'VIGENCIA_ANTERIOR');
    }
    const values = [config.providerId, provider.name, config.area, config.amount, config.amountBasis, config.monthPolicy,
      `${config.validFromMonth}-01`, config.validToMonth ? `${config.validToMonth}-01` : null, config.active,
      config.active || !previous ? null : config.deactivatedFromMonth ? `${config.deactivatedFromMonth}-01` : null, by(user)];
    const result = previous && !split ? await client.query(`UPDATE bi_honorarios_monthly_fixed_assignments
      SET provider_id=$1,provider_name=$2,area=$3,amount=$4,amount_basis=$5,month_policy=$6,valid_from_month=$7,
      valid_to_month=$8,active=$9,deactivated_from_month=$10,updated_by=$11,revision=revision+1,updated_at=now()
      WHERE id=$12 RETURNING *`, [...values, previous.id]) : await client.query(`INSERT INTO bi_honorarios_monthly_fixed_assignments
      (provider_id,provider_name,area,amount,amount_basis,month_policy,valid_from_month,valid_to_month,active,deactivated_from_month,updated_by,revision)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1) RETURNING *`, values);
    const saved = assignment(result.rows[0]);
    await history(client, saved, user, config.reason, previous ? 'ACTUALIZAR' : 'CREAR');
    await client.query('COMMIT');
    return saved;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function deactivateAssignment(_pool, input, user) {
  if (!canReview(user)) throw fail('No tienes permiso para administrar pagos fijos.', 403);
  if (!Number.isSafeInteger(Number(input?.id)) || Number(input.id) <= 0 || !Number.isInteger(input.expectedRevision)
    || input.expectedRevision < 1 || (input.reason !== undefined && (typeof input.reason !== 'string' || input.reason.length > 2000))) {
    throw fail('Revisa la configuración que deseas retirar.');
  }
  const today = new Date();
  const cutoff = month(input.deactivatedFromMonth || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`);
  await ensureSchema();
   
  // nuevo bajo el bloqueo compartido con revisiones y cierres
  const found = await getDb().pool.query('SELECT provider_id FROM bi_honorarios_monthly_fixed_assignments WHERE id=$1', [input.id]);
  if (!found.rows.length) throw fail('No se encontró esta configuración.', 404);
  const client = await getDb().pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`honorarios-fixed-provider:${found.rows[0].provider_id}`]);
    const previous = (await client.query('SELECT * FROM bi_honorarios_monthly_fixed_assignments WHERE id=$1 FOR UPDATE', [input.id])).rows[0];
    if (!previous || previous.revision !== input.expectedRevision) throw fail('Otra persona modificó esta configuración. Actualiza la lista.', 409);
    if (!previous.active && (!previous.deactivated_from_month || cutoff > dateMonth(previous.deactivated_from_month))) {
      throw fail('La configuración ya está retirada. Reactívala explícitamente si deseas pagar meses posteriores.', 409);
    }
    const result = await client.query(`UPDATE bi_honorarios_monthly_fixed_assignments SET active=false,deactivated_from_month=$2,
      revision=revision+1,updated_by=$3,updated_at=now() WHERE id=$1 RETURNING *`, [input.id, `${cutoff}-01`, by(user)]);
    const saved = assignment(result.rows[0]);
    await history(client, saved, user, (input.reason || '').trim(), 'DESACTIVAR');
    await client.query('COMMIT');
    return saved;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
function actualMonthlySnapshot(config, feeMonth) {
  month(feeMonth);
  return { assignmentId: Number(config.id), revision: config.revision, providerId: config.providerId,
    providerName: config.providerName, area: config.area, amount: config.amount, amountBasis: config.amountBasis,
    monthPolicy: config.monthPolicy, month: feeMonth, validFromMonth: config.validFromMonth,
    validToMonth: config.validToMonth, deactivatedFromMonth: config.deactivatedFromMonth || null, updatedBy: config.updatedBy };
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function fixedFingerprint(snapshot) { return createHash('sha256').update(JSON.stringify(canonical(snapshot))).digest('hex'); }
function rowFromSnapshot(snapshot) {
  const identity = `FIXED|${snapshot.providerId}|${snapshot.month}`;
  return { ModeBI: true, FixedMonthly: true, TipoCalculo: 'BI_FIJO_MENSUAL', SourceType: 'BI_FIJO_MENSUAL',
    SourceIdentity: identity, UDRKey: identity, SourceLineId: snapshot.assignmentId, OccurrenceId: snapshot.month,
    SourceAllocationKey: identity, RenglonAuditoria: 1, FeeMonth: snapshot.month, FechaAtencion: `${snapshot.month}-01`,
    MedicoId: snapshot.providerId, Medico: snapshot.providerName, RolMedico: 'JEFE_AREA',
    Servicio: `Pago fijo mensual · ${snapshot.area} · ${snapshot.month}`, CodigoServicio: 'BI_FIJO_MENSUAL',
    GrupoServicio: 'JEFATURA DE ÁREA', Cantidad: 1, CantidadOriginal: 1, CantidadMaxima: 1,
    BaseImporte: snapshot.amount, BasePropuesta: snapshot.amount, PrecioUnitarioBI: snapshot.amount,
    FuenteHonorario: 'PAGO_FIJO_MENSUAL', OrigenRenglon: 'BI_FIJO_MENSUAL', FechaReferenciaTipo: 'MES_PAGO_FIJO',
    ReviewEligible: true, ElegiblePago: 0, EstadoVertical: 'PENDIENTE',
    MensajeAuditoria: 'Pago mensual opcional. Inclúyelo sólo si corresponde pagarlo en este mes; se reconoce el importe completo.',
    FixedMonthlySnapshot: snapshot, SourceFingerprint: fixedFingerprint(snapshot) };
}
async function getPeriodRows(startDate, endDate) {
  validatePeriod(startDate, endDate);
  if ((Date.parse(endDate) - Date.parse(startDate)) / 86400000 > 366) throw fail('Selecciona un periodo válido de hasta un año.');
  await ensureSchema();
  const [configs, closed] = await Promise.all([
    listAssignments(), getDb().pool.query(`SELECT row_id,liquidation_id,snapshot FROM bi_honorarios_finalized_rows
      WHERE row_id LIKE 'FIXED|%' AND split_part(row_id,'|',3) BETWEEN $1 AND $2`, [startDate.slice(0, 7), endDate.slice(0, 7)])
  ]);
  const rows = new Map();
  const monthIndex = value => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1;
  for (let index = monthIndex(startDate); index <= monthIndex(endDate); index++) {
    const feeMonth = `${String(Math.floor(index / 12)).padStart(4, '0')}-${String(index % 12 + 1).padStart(2, '0')}`;
    for (const config of configs.filter(item => applies(item, feeMonth))) {
      const row = rowFromSnapshot(actualMonthlySnapshot(config, feeMonth));
      if (rows.has(row.SourceIdentity)) throw fail('Hay configuraciones mensuales que se superponen. Revisa las vigencias del médico.', 409);
      rows.set(row.SourceIdentity, row);
    }
  }
  for (const saved of closed.rows) {
    const snapshot = saved.snapshot?.fixed;
    if (!snapshot) throw fail('Un pago mensual cerrado no tiene su configuración guardada. Revisa el cierre antes de continuar.', 409);
    const row = rowFromSnapshot(snapshot);
    if (row.SourceIdentity !== saved.row_id) throw fail('El pago mensual cerrado no corresponde a su configuración guardada.', 409);
    rows.set(saved.row_id, { ...row, BaseImporte: saved.snapshot.baseAmount, LiquidacionCerrada: saved.liquidation_id,
      SnapshotCierre: saved.snapshot, CambiosTrasCierre: false });
  }
  return [...rows.values()].sort((a, b) => a.SourceIdentity.localeCompare(b.SourceIdentity));
}
async function readMonthlyReviews(startDate, endDate) {
  validatePeriod(startDate, endDate);
  await ensureTables();
  const result = await getDb().pool.query(`SELECT row_id,payload,revision,updated_by,updated_at FROM bi_honorarios_reviews
    WHERE row_id LIKE 'FIXED|%' AND split_part(row_id,'|',3) BETWEEN $1 AND $2`, [startDate.slice(0, 7), endDate.slice(0, 7)]);
  return Object.fromEntries(result.rows.map(row => [row.row_id, { ...row.payload, revision: row.revision,
    reviewer: row.updated_by, timestamp: row.updated_at }]));
}
async function lockAndValidateRows(client, rows) {
  const identities = rows.map(row => ({ row, ...parseRowId(row.SourceIdentity) }));
  for (const id of [...new Set(identities.map(item => item.providerId))].sort()) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`honorarios-fixed-provider:${id}`]);
  }
  for (const entry of [...identities].sort((a, b) => a.row.SourceIdentity.localeCompare(b.row.SourceIdentity))) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`honorarios-fixed:${entry.providerId}:${entry.month}`]);
    const result = await client.query('SELECT * FROM bi_honorarios_monthly_fixed_assignments WHERE provider_id=$1 FOR UPDATE', [entry.providerId]);
    const current = result.rows.map(assignment).filter(item => applies(item, entry.month));
    if (current.length !== 1 || entry.row.FixedMonthly !== true || !entry.row.FixedMonthlySnapshot) throw fail('Cambió la configuración del pago mensual. Actualiza el reporte.', 409);
    const snapshot = actualMonthlySnapshot(current[0], entry.month);
    if (fixedFingerprint(snapshot) !== fixedFingerprint(entry.row.FixedMonthlySnapshot)
      || entry.row.SourceFingerprint !== fixedFingerprint(snapshot)
      || Number(entry.row.BaseImporte) !== snapshot.amount || Number(entry.row.Cantidad) !== 1
      || String(entry.row.MedicoId) !== entry.providerId) throw fail('Cambió la configuración del pago mensual. Actualiza el reporte.', 409);
    const closed = await client.query('SELECT liquidation_id FROM bi_honorarios_finalized_rows WHERE row_id=$1', [entry.row.SourceIdentity]);
    if (closed.rows.length) throw fail('Este pago mensual ya pertenece a un cierre. Registra un ajuste en el cierre para conservar el historial.', 409);
  }
}
async function saveMonthlyReview(pool, input, user) {
  if (!canReview(user)) throw fail('No tienes permiso para decidir pagos mensuales.', 403);
  const identity = parseRowId(input?.rowId), decision = input?.decision;
  if (input.serviceDate !== `${identity.month}-01` || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 0
    || !['APROBAR', 'EXCLUIR', 'PENDIENTE'].includes(decision?.action)
    || typeof decision.fingerprint !== 'string' || decision.fingerprint.length > 15000
    || typeof decision.motivo !== 'string' || !decision.motivo.trim() || decision.motivo.length > 2000
    || (decision.action === 'APROBAR' && ![0, 0.08, 0.16].includes(decision.vatRate))) throw fail('Revisa la mensualidad, la decisión, el IVA y el motivo.');
  await assertProvider(pool, identity.providerId);
  const rows = await getPeriodRows(input.serviceDate, input.serviceDate);
  const row = rows.find(item => item.SourceIdentity === input.rowId);
  if (!row || row.LiquidacionCerrada || reviewFingerprint(row) !== decision.fingerprint) throw fail('Cambió el pago mensual o ya está cerrado. Actualiza el reporte.', 409);
  const snapshot = { rowId: row.SourceIdentity, sourceType: 'BI_FIJO_MENSUAL', FixedMonthly: true, sourceLineId: row.SourceLineId,
    occurrenceId: identity.month, allocationKey: row.SourceIdentity, maximumQuantity: 1,
    serviceDate: input.serviceDate, month: identity.month, itemCode: row.CodigoServicio, description: row.Servicio,
    groupName: row.GrupoServicio, providerId: identity.providerId, providerName: row.Medico, role: 'JEFE_AREA',
    quantity: 1, unitAmount: row.BaseImporte, baseAmount: row.BaseImporte,
    fixed: row.FixedMonthlySnapshot, sourceFingerprint: row.SourceFingerprint };
  const savedDecision = { action: decision.action, sourceType: 'BI_FIJO_MENSUAL', customAmount: decision.action === 'APROBAR' ? row.BaseImporte : null,
    vatRate: decision.action === 'APROBAR' ? decision.vatRate : null, motivo: decision.motivo.trim(),
    fingerprint: decision.fingerprint, providerId: identity.providerId,
    snapshot: decision.action === 'APROBAR' ? snapshot : null };
  const client = await getDb().pool.connect();
  try {
    await client.query('BEGIN');
    await lockAndValidateRows(client, [row]);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [input.rowId]);
    const previous = await client.query('SELECT revision FROM bi_honorarios_reviews WHERE row_id=$1 FOR UPDATE', [input.rowId]);
    if ((previous.rows[0]?.revision || 0) !== input.expectedRevision) throw fail('Otra persona modificó esta mensualidad. Actualiza el reporte.', 409);
    const revision = input.expectedRevision + 1;
    const result = await client.query(`INSERT INTO bi_honorarios_reviews(row_id,service_date,payload,revision,updated_by)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(row_id) DO UPDATE SET service_date=EXCLUDED.service_date,payload=EXCLUDED.payload,
      revision=EXCLUDED.revision,updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING updated_at`,
    [input.rowId, input.serviceDate, savedDecision, revision, by(user)]);
    await client.query('INSERT INTO bi_honorarios_review_history(row_id,payload,revision,updated_by) VALUES($1,$2,$3,$4)',
      [input.rowId, savedDecision, revision, by(user)]);
    await client.query('COMMIT');
    return { ...savedDecision, revision, reviewer: by(user), timestamp: result.rows[0].updated_at };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

module.exports = { ensureSchema, listAssignments, saveAssignment, deactivateAssignment, getPeriodRows, readMonthlyReviews,
  actualMonthlySnapshot, fixedFingerprint, lockAndValidateRows, saveMonthlyReview, validateAssignment, overlaps, applies };
