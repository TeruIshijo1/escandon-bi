'use strict';

const { isHonorariosScopeExcluded } = require('../utils/honorariosScope');

const { getDb } = require('../config/db');
const { canReview, ensureTables, readReviews } = require('./honorariosReview.service');
const { getPeriodCandidates, validatePeriod } = require('./honorariosWorkflow.service');
const { reviewFingerprint } = require('../utils/honorariosReviewSource');
const { priceApprovedSnapshots } = require('../utils/honorariosFiscal');
const { reconcileHonorariosWithSap } = require('./honorariosSapReconciliation.service');
const { getHonorariosCandidates } = require('./honorariosSources.service');
const { dateOnly } = require('./honorariosCatalog.service');
const fiscalProfiles = require('./honorariosFiscalProfile.service');
const monthlyFixed = require('./honorariosMonthlyFixed.service');
let ready;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const money = value => Math.round(Number(value) * 100) / 100;
const by = user => `${user.id}: ${user.nombre || user.username || 'Usuario BI'}`;

async function ensureSchema() {
  await ensureTables();
  if (!ready) ready = getDb().pool.query(`
    CREATE TABLE IF NOT EXISTS bi_honorarios_liquidations (
      id bigserial PRIMARY KEY, start_date date NOT NULL, end_date date NOT NULL,
      provider_id text, reason text NOT NULL, snapshot jsonb NOT NULL, created_by text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS bi_honorarios_payment_applications (
      id bigserial PRIMARY KEY, liquidation_id bigint NOT NULL REFERENCES bi_honorarios_liquidations(id),
      row_id text NOT NULL, amount numeric(18,2) NOT NULL CHECK(amount>0), payment_date date NOT NULL,
      reference text NOT NULL, reason text NOT NULL, created_by text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(liquidation_id,row_id,reference)
    );
    CREATE TABLE IF NOT EXISTS bi_honorarios_liquidation_adjustments (
      id bigserial PRIMARY KEY, liquidation_id bigint NOT NULL REFERENCES bi_honorarios_liquidations(id),
      row_id text NOT NULL, amount numeric(18,2) NOT NULL CHECK(amount<>0), reason text NOT NULL,
      reference text NOT NULL, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
  `).catch(error => { ready = undefined; throw error; });
  await ready;
}

async function closeLiquidation(pool, input, user) {
  const outcome = { mayHaveCommitted: false };
  try {
    return await prepareLiquidation(pool, input, user, outcome);
  } catch (error) {

    if (!outcome.mayHaveCommitted) error.preparationStatus = 'NOT_CREATED';
    throw error;
  }
}

async function prepareLiquidation(pool, input, user, outcome) {
  if (!canReview(user)) throw fail('No tienes permiso para cerrar honorarios.', 403);
  const { startDate, endDate, providerId, reason } = input || {};
  validatePeriod(startDate, endDate);
  if (!String(reason || '').trim() || String(reason).length > 2000 || input.confirmed !== true) {
    throw fail('Confirma la revisión de servicios, pagos previos y cálculo fiscal, y registra el motivo del cierre.');
  }
  await ensureSchema();
  const [{ rows }, clinicalReviews, fixedReviews] = await Promise.all([getPeriodCandidates(pool, startDate, endDate),
    readReviews(startDate, endDate), monthlyFixed.readMonthlyReviews(startDate, endDate)]);
  const reviews = { ...clinicalReviews, ...fixedReviews };
  const selected = rows.filter(row => !row.LiquidacionCerrada && reviews[row.SourceIdentity]?.action === 'APROBAR'
    && (!providerId || String(reviews[row.SourceIdentity]?.snapshot?.providerId) === String(providerId)));
  if (!selected.length) throw fail('No hay servicios aprobados para cerrar.');
  for (const row of selected) {
    if (row.ReviewInvalidated || reviews[row.SourceIdentity].fingerprint !== reviewFingerprint(row)) throw fail('Cambió un servicio, su tarifa o el pago fijo. Actualiza y revisa las aprobaciones antes de cerrar.', 409);
    if (row.FixedMonthly === true) {
      const snapshot = reviews[row.SourceIdentity].snapshot;
      const fixed = row.FixedMonthlySnapshot;
      if (!snapshot || snapshot.sourceType !== 'BI_FIJO_MENSUAL' || snapshot.FixedMonthly !== true
        || snapshot.rowId !== row.SourceIdentity || snapshot.sourceFingerprint !== row.SourceFingerprint
        || !snapshot.fixed || monthlyFixed.fixedFingerprint(snapshot.fixed) !== row.SourceFingerprint
        || String(snapshot.providerId) !== String(fixed?.providerId) || snapshot.month !== fixed?.month
        || snapshot.quantity !== 1 || snapshot.unitAmount !== fixed?.amount || snapshot.baseAmount !== fixed?.amount) {
        throw fail('Cambió la configuración del pago mensual. Actualiza y vuelve a decidir si lo incluyes.', 409);
      }
    }
  }
  const approved = selected.map(row => ({ ...reviews[row.SourceIdentity], rowId: row.SourceIdentity }));
  const names = [...new Set(approved.map(review => review.snapshot.providerName))];
  const internal = await fiscalProfiles.readProfiles();
  const sapNames = names.filter(name => approved.some(review => review.snapshot.providerName === name && !internal[review.snapshot.providerId]?.enabled));
  const sap = sapNames.length ? await reconcileHonorariosWithSap({ startDate, endDate, doctors: sapNames, scope: 'fiscal',
    includeAdditional: false }) : { providers: {}, asOf: new Date().toISOString() };
  const lines = priceApprovedSnapshots(approved, sap.providers, internal);
  const client = await getDb().pool.connect();
  try {
    await client.query('BEGIN');
    for (const id of [...new Set(lines.map(line => String(line.providerId)))].sort()) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`honorarios-fiscal:${id}`]);
      const current = await client.query('SELECT revision FROM bi_honorarios_fiscal_profiles WHERE provider_id=$1 FOR UPDATE', [id]);
      if ((current.rows[0]?.revision || 0) !== (internal[id]?.revision || 0)) throw fail('Cambió la ficha fiscal durante la preparación del pago. Intenta de nuevo.', 409);
    }
    await monthlyFixed.lockAndValidateRows(client, selected.filter(row => row.FixedMonthly === true));
    for (const line of [...lines].sort((a, b) => a.rowId.localeCompare(b.rowId))) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [line.rowId]);
      const current = await client.query('SELECT revision FROM bi_honorarios_reviews WHERE row_id=$1 FOR UPDATE', [line.rowId]);
      if (current.rows[0]?.revision !== line.reviewRevision) throw fail('Una aprobación cambió durante el cierre. Actualiza el reporte.', 409);
      const closed = await client.query('SELECT liquidation_id FROM bi_honorarios_finalized_rows WHERE row_id=$1', [line.rowId]);
      if (closed.rows.length) throw fail(`El servicio ya pertenece al cierre ${closed.rows[0].liquidation_id}.`, 409);
    }
    const clinicalLines = lines.filter(line => line.sourceType !== 'BI_FIJO_MENSUAL');
    for (const code of [...new Set(clinicalLines.map(line => line.itemCode))].sort()) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`honorarios-catalog:${code}`]);
      const config = await client.query('SELECT revision,status,source_active,scope_excluded,item_code,name,description,group_name,reference_prices,source_metadata FROM bi_honorarios_catalog WHERE item_code=$1 FOR UPDATE', [code]);
      for (const line of clinicalLines.filter(item => item.itemCode === code)) {
        const tariff = await client.query('SELECT revision,active FROM bi_honorarios_tariffs WHERE id=$1 FOR UPDATE', [line.tariff.id]);
        if (config.rows[0]?.revision !== line.catalog.revision || config.rows[0]?.status !== 'INCLUIDO'
          || config.rows[0]?.source_active === false || isHonorariosScopeExcluded(config.rows[0])
          || tariff.rows[0]?.revision !== line.tariff.revision || !tariff.rows[0]?.active) {
          throw fail('Cambió la configuración o tarifa durante el cierre. Actualiza el reporte.', 409);
        }
      }
    }
    const snapshot = { lines, currency: 'MXN', totalBase: money(lines.reduce((sum, line) => sum + line.baseAmount, 0)),
      totalNet: money(lines.reduce((sum, line) => sum + line.netAmount, 0)), sapAsOf: sap.asOf,
      fiscalNote: 'Impuestos calculados con la ficha interna confirmada del médico o la configuración de SAP. Los datos utilizados se conservan con el pago preparado.' };
    const saved = await client.query(`INSERT INTO bi_honorarios_liquidations(start_date,end_date,provider_id,reason,snapshot,created_by)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, [startDate, endDate, providerId ? String(providerId) : null, reason.trim(), snapshot, by(user)]);
    const id = saved.rows[0].id;
    for (const line of lines) await client.query(`INSERT INTO bi_honorarios_finalized_rows(row_id,liquidation_id,snapshot)
      VALUES($1,$2,$3)`, [line.rowId, id, line]);
    outcome.mayHaveCommitted = true;
    await client.query('COMMIT');
    return getLiquidation(id);
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function listLiquidations() {
  await ensureSchema();
  const result = await getDb().pool.query(`SELECT id,start_date,end_date,provider_id,reason,created_by,created_at,
    snapshot->>'totalBase' AS total_base,snapshot->>'totalNet' AS total_net,
    jsonb_array_length(snapshot->'lines') AS lines FROM bi_honorarios_liquidations ORDER BY id DESC LIMIT 200`);
  return result.rows;
}

async function getLiquidation(id, reader = getDb().pool) {
  await ensureSchema();
  if (!/^\d+$/.test(String(id))) throw fail('Cierre inválido.');
  const result = await reader.query('SELECT * FROM bi_honorarios_liquidations WHERE id=$1', [id]);
  if (!result.rows.length) throw fail('No se encontró el cierre.', 404);
  const [payments, adjustments] = await Promise.all([
    reader.query('SELECT * FROM bi_honorarios_payment_applications WHERE liquidation_id=$1 ORDER BY id', [id]),
    reader.query('SELECT * FROM bi_honorarios_liquidation_adjustments WHERE liquidation_id=$1 ORDER BY id', [id])
  ]);
  const liquidation = result.rows[0];
  const lines = liquidation.snapshot.lines.map(line => {
    const paid = money(payments.rows.filter(payment => payment.row_id === line.rowId).reduce((sum, payment) => sum + Number(payment.amount), 0));
    const adjustment = money(adjustments.rows.filter(item => item.row_id === line.rowId).reduce((sum, item) => sum + Number(item.amount), 0));
    return { ...line, paidAmount: paid, adjustmentAmount: adjustment, balance: money(line.netAmount + adjustment - paid) };
  });
  return { ...liquidation, lines, payments: payments.rows, adjustments: adjustments.rows,
    totalPaid: money(lines.reduce((sum, line) => sum + line.paidAmount, 0)),
    balance: money(lines.reduce((sum, line) => sum + line.balance, 0)) };
}

async function recordApplication(id, input, user, adjustment = false) {
  if (!canReview(user)) throw fail('No tienes permiso para registrar pagos o ajustes.', 403);
  const amount = Number(input?.amount);
  if (Number.isFinite(amount) && Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) {
    throw fail('Captura el importe con un máximo de dos decimales.');
  }
  if (!Number.isFinite(amount) || Math.abs(amount) > 1e9 || amount === 0 || (!adjustment && amount < 0)
    || money(amount) === 0 || !String(input?.reference || '').trim() || String(input.reference).length > 1000
    || !String(input?.reason || '').trim() || String(input.reason).length > 2000) throw fail('Captura un importe, referencia y motivo válidos.');
  if (!adjustment) validatePeriod(input.paymentDate, input.paymentDate);
  await ensureSchema();
  const client = await getDb().pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM bi_honorarios_liquidations WHERE id=$1 FOR UPDATE', [id]);
    const liquidation = await getLiquidation(id, client);
    const line = liquidation.lines.find(item => item.rowId === input.rowId);
    if (!line) throw fail('Selecciona un servicio de este cierre.');
    if (!adjustment && money(amount) > line.balance) throw fail('El pago supera el saldo pendiente del servicio.');
    if (adjustment && money(line.netAmount + line.adjustmentAmount + amount) < 0) throw fail('El ajuste no puede reducir la obligación por debajo de cero.');
    if (adjustment) await client.query(`INSERT INTO bi_honorarios_liquidation_adjustments(liquidation_id,row_id,amount,reference,reason,created_by)
      VALUES($1,$2,$3,$4,$5,$6)`, [id, input.rowId, money(amount), input.reference.trim(), input.reason.trim(), by(user)]);
    else await client.query(`INSERT INTO bi_honorarios_payment_applications(liquidation_id,row_id,amount,payment_date,reference,reason,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7)`, [id, input.rowId, money(amount), input.paymentDate, input.reference.trim(), input.reason.trim(), by(user)]);
    await client.query('COMMIT');
    return getLiquidation(id);
  } catch (error) { await client.query('ROLLBACK'); if (error.code === '23505') throw fail('Esta referencia de pago ya se aplicó a este servicio.', 409); throw error; }
  finally { client.release(); }
}

async function recordProviderPayment(id, input, user) {
  if (!canReview(user)) throw fail('No tienes permiso para registrar pagos.', 403);
  const amount = Number(input?.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6
    || !String(input?.reference || '').trim() || String(input.reference).length > 1000 || !/^\d+$/.test(String(input.providerId || ''))) {
    throw fail('Captura médico, importe y referencia válidos.');
  }
  validatePeriod(input.paymentDate, input.paymentDate);
  await ensureSchema();
  const client = await getDb().pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM bi_honorarios_liquidations WHERE id=$1 FOR UPDATE', [id]);
    const saved = await getLiquidation(id, client);
    const lines = saved.lines.filter(line => String(line.providerId) === String(input.providerId))
      .sort((a, b) => a.serviceDate.localeCompare(b.serviceDate) || a.rowId.localeCompare(b.rowId));
    if (!lines.length || lines.some(line => line.balance < 0)) throw fail('Revisa el médico y sus saldos antes de registrar el pago.');
    const reference = input.reference.trim();
    if (saved.payments.some(payment => payment.reference === reference && lines.some(line => line.rowId === payment.row_id))) {
      throw fail('Este comprobante ya fue registrado para el médico.', 409);
    }
    let remaining = Math.round(amount * 100);
    const available = lines.reduce((sum, line) => sum + Math.round(line.balance * 100), 0);
    if (remaining > available) throw fail('El pago supera el saldo pendiente del médico.');
    for (const line of lines) {
      const applied = Math.min(remaining, Math.round(line.balance * 100));
      if (applied <= 0) continue;
      await client.query(`INSERT INTO bi_honorarios_payment_applications(liquidation_id,row_id,amount,payment_date,reference,reason,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7)`, [id, line.rowId, applied / 100, input.paymentDate, reference,
        'Pago del médico registrado y distribuido sobre los servicios con saldo.', by(user)]);
      remaining -= applied;
      if (!remaining) break;
    }
    await client.query('COMMIT');
    return getLiquidation(id);
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function checkLiquidationChanges(pool, saved) {
   
  // nunca reemplazan los importes conservados al cerrar
  const clinicalLines = (saved.lines || saved.snapshot.lines).filter(line => line.sourceType !== 'BI_FIJO_MENSUAL');
  if (!clinicalLines.length) return [];
  const result = await getHonorariosCandidates(pool, dateOnly(saved.start_date), dateOnly(saved.end_date));
  const current = new Map(result.rows.map(row => [row.SourceIdentity, row]));
  return clinicalLines
    .filter(line => !current.has(line.rowId) || current.get(line.rowId).SourceFingerprint !== line.sourceFingerprint)
    .map(line => ({ rowId: line.rowId, description: line.description,
      code: !current.has(line.rowId) ? 'CLINICAL_SOURCE_MISSING'
        : current.get(line.rowId).Cancelado ? 'CLINICAL_SOURCE_CANCELLED' : 'CLINICAL_SOURCE_CHANGED',
      reason: !current.has(line.rowId) ? 'El servicio no aparece en el periodo del cierre. Revisa su fecha y su registro.'
        : current.get(line.rowId).Cancelado ? 'La atención fue cancelada después del cierre. Revisa el pago.'
          : 'Cambió la información de la atención después del cierre. Revisa el pago.' }));
}

module.exports = { ensureSchema, closeLiquidation, listLiquidations, getLiquidation, recordApplication, recordProviderPayment, checkLiquidationChanges };
