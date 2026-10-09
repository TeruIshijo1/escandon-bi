'use strict';

const { getDb } = require('../config/db');
const { getPeriodCandidates, validatePeriod } = require('./honorariosWorkflow.service');
const { readReviews } = require('./honorariosReview.service');
const monthlyFixed = require('./honorariosMonthlyFixed.service');
const fiscalProfiles = require('./honorariosFiscalProfile.service');
const { reviewFingerprint } = require('../utils/honorariosReviewSource');
const { fiscalProfile, priceApprovedSnapshots } = require('../utils/honorariosFiscal');
const { multiplyHonorario } = require('../utils/honorariosMoney');

const invalid = detail => Object.assign(new Error(`No se puede generar el reporte: ${detail}. Actualiza y revisa las aprobaciones.`), { status: 409 });
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const validId = value => ['number', 'string'].includes(typeof value) && /^\d+$/.test(String(value))
  && Number.isSafeInteger(Number(value)) && Number(value) > 0;

function requestedProvider(value) {
  if (value === undefined || value === null || value === '' || value === 0 || value === '0') return null;
  if (!validId(value)) throw Object.assign(new Error('Selecciona un médico válido.'), { status: 400 });
  return String(Number(value));
}

function validProfileDate(value) {
  try { validatePeriod(value, value); return true; }
  catch { return false; }
}

function cents(value, positive = false) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '' || !Number.isFinite(Number(value))) {
    throw invalid('falta un importe confirmado');
  }
  const number = Number(value), result = Math.round(number * 100);
  if (!Number.isSafeInteger(result) || Math.abs(number * 100 - result) > 1e-6 || (positive && result <= 0)) {
    throw invalid('un importe confirmado no es válido');
  }
  return result;
}

function validateApproval(row, review, rowId, period) {
  const snapshot = review.snapshot;
  if (!row || row.ReviewInvalidated || row.Cancelado || row.ScopeExcluded
    || review.fingerprint !== reviewFingerprint(row)) throw invalid('cambió un servicio, su tarifa o el pago fijo');
  if (!snapshot || snapshot.rowId !== rowId || !validId(snapshot.providerId) || !nonempty(snapshot.providerName)
    || !nonempty(snapshot.description) || !nonempty(snapshot.sourceFingerprint)
    || snapshot.sourceFingerprint !== row.SourceFingerprint || !Number.isSafeInteger(review.revision) || review.revision <= 0
    || !nonempty(review.reviewer) || !nonempty(review.motivo) || ![0, 0.08, 0.16].includes(review.vatRate)
    || typeof snapshot.quantity !== 'number' || !Number.isFinite(snapshot.quantity) || snapshot.quantity <= 0
    || snapshot.serviceDate !== String(row.FechaAtencion || '').slice(0, 10)) throw invalid('la aprobación está incompleta o cambió su fuente');
  const base = cents(snapshot.baseAmount, true), unit = cents(snapshot.unitAmount, true);
  let expected;
  try { expected = cents(multiplyHonorario(unit / 100, snapshot.quantity), true); }
  catch { throw invalid('la cantidad y tarifa aprobadas no permiten calcular el importe'); }
  if (base !== expected || (review.customAmount != null && cents(review.customAmount, true) !== base)
    || (review.providerId != null && String(review.providerId) !== String(snapshot.providerId))
    || (review.quantity != null && review.quantity !== snapshot.quantity)) throw invalid('el importe o médico no coincide con la aprobación');

  if (row.FixedMonthly === true) {
    const fixed = row.FixedMonthlySnapshot;
    if (review.sourceType !== 'BI_FIJO_MENSUAL' || snapshot.sourceType !== 'BI_FIJO_MENSUAL' || snapshot.FixedMonthly !== true
      || !snapshot.fixed || !fixed || monthlyFixed.fixedFingerprint(snapshot.fixed) !== row.SourceFingerprint
      || String(snapshot.providerId) !== String(fixed.providerId) || snapshot.month !== fixed.month
      || snapshot.month < period.startDate.slice(0, 7) || snapshot.month > period.endDate.slice(0, 7)
      || snapshot.quantity !== 1 || base !== cents(fixed.amount, true) || unit !== base) {
      throw invalid('cambió la configuración del pago mensual');
    }
  } else {
    const beneficiary = row.ReviewBeneficiary || { providerId: row.MedicoId, providerName: row.Medico, role: row.RolMedico || 'TRATANTE' };
    const tariff = row.ReviewEligibilityTariff || row.TariffSnapshot;
    const maximum = Number(row.CantidadMaxima ?? row.CantidadOriginal ?? row.Cantidad);
    if (review.sourceType !== 'BI_PRESTACION' || row.CatalogApproved !== true || row.ReviewEligible !== true
      || snapshot.itemCode !== row.CodigoServicio || snapshot.sourceType !== row.SourceType
      || String(snapshot.sourceLineId) !== String(row.SourceLineId)
      || snapshot.serviceDate < period.startDate || snapshot.serviceDate > period.endDate
      || String(snapshot.providerId) !== String(beneficiary.providerId) || snapshot.providerName !== beneficiary.providerName
      || snapshot.role !== beneficiary.role || !Number.isFinite(maximum) || snapshot.quantity > maximum
      || !snapshot.catalog || snapshot.catalog.revision !== row.CatalogSnapshot?.revision
      || !snapshot.tariff || !tariff || snapshot.tariff.id !== tariff.id || snapshot.tariff.revision !== tariff.revision
      || unit !== cents(tariff.amount, true)) throw invalid('cambió la configuración, tarifa o beneficiario del servicio');
  }
  return { ...review, rowId };
}

const totalFields = { base: 'baseAmount', vat: 'vat', isr: 'isr', vatWithholding: 'vatWithholding', net: 'netAmount' };
function totalsFor(lines) {
  return Object.fromEntries(Object.entries(totalFields).map(([key, field]) => {
    if (lines.some(line => line[field] === null || line[field] === undefined)) return [key, null];
    const total = lines.reduce((sum, line) => {
      const next = sum + cents(line[field]);
      if (!Number.isSafeInteger(next)) throw invalid('los importes superan el rango de cálculo permitido');
      return next;
    }, 0);
    return [key, total / 100];
  }));
}

async function getAvailablePaymentReport(pool, input = {}) {
  const { startDate, endDate } = input;
  validatePeriod(startDate, endDate);
  const providerId = requestedProvider(input.providerId);
  const period = { startDate, endDate };
  const [candidates, clinicalReviews, fixedReviews, profiles] = await Promise.all([
    getPeriodCandidates(pool, startDate, endDate, { includeUnconfigured: true }),
    readReviews(startDate, endDate), monthlyFixed.readMonthlyReviews(startDate, endDate), fiscalProfiles.readProfiles()
  ]);
  if (!Array.isArray(candidates?.rows) || !clinicalReviews || !fixedReviews || !profiles) throw invalid('no se pudieron leer todos los datos');
  const rows = new Map();
  for (const row of candidates.rows) {
    if (!row.SourceIdentity || rows.has(row.SourceIdentity)) throw invalid('la fuente tiene servicios repetidos o sin identificar');
    rows.set(row.SourceIdentity, row);
  }
  const reviews = Object.entries({ ...clinicalReviews, ...fixedReviews }).filter(([rowId, review]) => review?.action === 'APROBAR'
    && (['BI_PRESTACION', 'BI_FIJO_MENSUAL'].includes(review.sourceType) || rows.get(rowId)?.ModeBI)
    && (!providerId || String(review.snapshot?.providerId ?? review.providerId) === providerId));
  const finalized = reviews.length ? await getDb().pool.query('SELECT row_id FROM bi_honorarios_finalized_rows WHERE row_id=ANY($1::text[])',
    [reviews.map(([rowId]) => rowId)]) : { rows: [] };
  const closed = new Set(finalized.rows.map(row => row.row_id));
  const approved = reviews.filter(([rowId]) => !closed.has(rowId) && !rows.get(rowId)?.LiquidacionCerrada)
    .map(([rowId, review]) => validateApproval(rows.get(rowId), review, rowId, period));
  if (!approved.length) throw Object.assign(new Error('No hay servicios aprobados disponibles para generar el reporte.'), { status: 400 });

  const ready = [], pending = [];
  for (const review of approved) {
    const snapshot = review.snapshot, profile = profiles[snapshot.providerId];
    const matches = profile?.source === 'BI_INTERNO' && String(profile.providerId) === String(snapshot.providerId);
    if (matches && validProfileDate(profile.validFrom)
      && fiscalProfile({ linkStatus: 'candidato_unico', candidates: [profile] }, snapshot.serviceDate, review.vatRate !== 0)) ready.push(review);
    else pending.push({ ...snapshot, reviewRevision: review.revision, reviewer: review.reviewer,
      reviewFingerprint: review.fingerprint, reason: review.motivo, vatRate: review.vatRate,
      vat: multiplyHonorario(Number(snapshot.baseAmount), review.vatRate), isrRate: null, vatFraction: null,
      isr: null, vatWithholding: null, netAmount: null, fiscalSource: null, fiscalSnapshot: null });
  }
  const calculated = ready.length ? priceApprovedSnapshots(ready, {}, profiles).map(line => ({ ...line,
    fiscalSource: 'Ficha fiscal interna confirmada para esta consulta.' })) : [];
  const lines = [...calculated, ...pending].sort((a, b) => String(a.rowId).localeCompare(String(b.rowId)));
  const grouped = new Map();
  for (const line of lines) {
    const id = String(line.providerId);
    let doctor = grouped.get(id);
    if (!doctor) {
      const profile = profiles[id], matches = String(profile?.providerId) === id;
      doctor = { providerId: line.providerId, providerName: line.providerName,
        fiscal: { federalTaxId: matches && nonempty(profile.federalTaxId) ? profile.federalTaxId.trim() : null,
          fiscalRegime: matches && nonempty(profile.fiscalRegime) ? profile.fiscalRegime.trim() : null, ready: true }, lines: [] };
      grouped.set(id, doctor);
    } else if (doctor.providerName !== line.providerName) throw invalid('el médico tiene nombres incompatibles en sus aprobaciones');
    doctor.lines.push(line);
    if (line.netAmount === null) doctor.fiscal.ready = false;
  }
  const doctors = [...grouped.values()].sort((a, b) => a.providerName.localeCompare(b.providerName))
    .map(doctor => ({ ...doctor, totals: totalsFor(doctor.lines) }));
  return { version: 1, status: pending.length ? 'FISCAL_PENDING' : 'AVAILABLE', currency: 'MXN',
    generatedAt: new Date().toISOString(), period, doctors, totals: totalsFor(lines) };
}

module.exports = { getAvailablePaymentReport };
