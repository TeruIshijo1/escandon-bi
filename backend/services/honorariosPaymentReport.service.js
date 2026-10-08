'use strict';

const { isDeepStrictEqual } = require('node:util');
const { getDb } = require('../config/db');
const { dateOnly } = require('./honorariosCatalog.service');
const { ensureSchema, checkLiquidationChanges } = require('./honorariosLiquidation.service');
const { priceApprovedSnapshots } = require('../utils/honorariosFiscal');
const { multiplyHonorario } = require('../utils/honorariosMoney');
const { fixedFingerprint } = require('./honorariosMonthlyFixed.service');

const invalid = detail => Object.assign(new Error(`No se puede preparar el PDF para pago: ${detail}. Revisa el cierre antes de continuar.`), { status: 409 });
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const validDate = value => Boolean(dateOnly(value));
const amount = (value, label, { positive = false, nonnegative = false } = {}) => {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '' || !Number.isFinite(Number(value))) throw invalid(`falta ${label}`);
  const number = Number(value), cents = Math.round(number * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(number * 100 - cents) > 1e-6
    || (positive && cents <= 0) || (nonnegative && cents < 0)) throw invalid(`${label} no tiene un importe válido en centavos`);
  return cents;
};
const add = (a, b) => {
  const total = a + b;
  if (!Number.isSafeInteger(total)) throw invalid('los importes superan el rango de cálculo permitido');
  return total;
};
const keys = ['base', 'vat', 'isr', 'vatWithholding', 'net', 'adjustments', 'paid', 'balance', 'payable'];
const zeroTotals = () => Object.fromEntries(keys.map(key => [key, 0]));
const moneyTotals = totals => Object.fromEntries(keys.map(key => [key, totals[key] / 100]));
const validId = value => /^\d+$/.test(String(value)) && BigInt(value) > 0n;
const fixedLine = line => line?.sourceType === 'BI_FIJO_MENSUAL' || line?.FixedMonthly === true || String(line?.rowId || '').startsWith('FIXED|');

function validateFixedSnapshot(line, saved) {
  const fixed = line.fixed;
  const month = line.month;
  if (line.sourceType !== 'BI_FIJO_MENSUAL' || line.FixedMonthly !== true || !fixed
    || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month || '') || !validDate(`${month}-01`)
    || month < dateOnly(saved.start_date).slice(0, 7) || month > dateOnly(saved.end_date).slice(0, 7)
    || line.rowId !== `FIXED|${line.providerId}|${month}` || line.serviceDate !== `${month}-01`
    || line.role !== 'JEFE_AREA' || line.quantity !== 1 || line.itemCode !== 'BI_FIJO_MENSUAL'
    || !validId(fixed.assignmentId) || !Number.isSafeInteger(fixed.revision) || fixed.revision <= 0
    || String(fixed.providerId) !== String(line.providerId) || fixed.providerName !== line.providerName
    || fixed.month !== month || fixed.amountBasis !== 'BASE' || fixed.monthPolicy !== 'FULL_MONTH'
    || !nonempty(fixed.area) || !nonempty(fixed.updatedBy)
    || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(fixed.validFromMonth || '') || fixed.validFromMonth > month
    || (fixed.validToMonth != null && (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(fixed.validToMonth) || fixed.validToMonth < month))
    || (fixed.deactivatedFromMonth != null && (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(fixed.deactivatedFromMonth) || month >= fixed.deactivatedFromMonth))
    || String(line.sourceLineId) !== String(fixed.assignmentId) || line.occurrenceId !== month
    || line.allocationKey !== line.rowId || line.maximumQuantity !== 1
    || line.sourceFingerprint !== fixedFingerprint(fixed)) throw invalid('falta trazabilidad de la configuración y del mes del pago fijo');
  const configured = amount(fixed.amount, 'el importe mensual configurado', { positive: true });
  if (amount(line.unitAmount, 'el importe mensual', { positive: true }) !== configured
    || amount(line.baseAmount, 'el honorario mensual', { positive: true }) !== configured) throw invalid('el pago fijo no coincide con el importe mensual confirmado');
}

function validateLedger(entries, liquidationId, rowIds, adjustment = false) {
  const ids = new Set(), references = new Set();
  return entries.map(entry => {
    const kind = adjustment ? 'ajuste' : 'pago';
    if (!validId(entry.id) || ids.has(String(entry.id))) throw invalid(`hay un ${kind} repetido o sin identificador`);
    ids.add(String(entry.id));
    if (String(entry.liquidation_id) !== String(liquidationId) || !rowIds.has(entry.row_id)) throw invalid(`hay un ${kind} que no corresponde a los servicios del cierre`);
    if (!nonempty(entry.reference) || !nonempty(entry.reason) || !nonempty(entry.created_by)
      || !Number.isFinite(new Date(entry.created_at).getTime()) || (!adjustment && !validDate(entry.payment_date))) throw invalid(`falta información del ${kind}`);
    const reference = JSON.stringify([entry.row_id, entry.reference.trim()]);
    if (!adjustment && references.has(reference)) throw invalid(`la referencia de un ${kind} está repetida para el mismo servicio`);
    references.add(reference);
    const cents = amount(entry.amount, `el importe del ${kind}`, { positive: !adjustment });
    if (cents === 0) throw invalid(`el ${kind} tiene importe cero`);
    return { ...entry, amount: cents / 100 };
  });
}

function buildPaymentReport(saved, payments, adjustments, finalizedRows, changes = [], generatedAt = new Date().toISOString()) {
  const snapshot = saved?.snapshot;
  if (!saved || !validId(saved.id) || !validDate(saved.start_date) || !validDate(saved.end_date)
    || dateOnly(saved.start_date) > dateOnly(saved.end_date) || !nonempty(saved.created_by) || !nonempty(saved.reason)
    || !saved.created_at || !Number.isFinite(new Date(saved.created_at).getTime()) || !snapshot
    || snapshot.currency !== 'MXN' || !Array.isArray(snapshot.lines) || !snapshot.lines.length
    || !nonempty(snapshot.fiscalNote) || !snapshot.sapAsOf || !Number.isFinite(new Date(snapshot.sapAsOf).getTime())) throw invalid('el cierre está incompleto');
  const rowIds = new Set();
  const centsByRow = new Map();
  const profiles = {};
  const reviews = snapshot.lines.map((line, index) => {
    if (!nonempty(line.rowId) || rowIds.has(line.rowId)) throw invalid('hay servicios repetidos o sin identificador');
    rowIds.add(line.rowId);
    const monthly = fixedLine(line);
    if (!validId(line.providerId) || !nonempty(line.providerName) || !nonempty(line.description)
      || !validDate(line.serviceDate) || (!monthly && (line.serviceDate < dateOnly(saved.start_date) || line.serviceDate > dateOnly(saved.end_date)))
      || !nonempty(line.sourceFingerprint) || !nonempty(line.reviewFingerprint) || !nonempty(line.reviewer)
      || !nonempty(line.reason) || !Number.isSafeInteger(line.reviewRevision) || line.reviewRevision <= 0
      || !nonempty(line.role) || (!monthly && (!line.catalog || !line.tariff)) || !line.fiscalSnapshot
      || !Number.isFinite(line.quantity) || line.quantity <= 0) throw invalid('falta información del médico, del servicio o de su aprobación');
    if (monthly) validateFixedSnapshot(line, saved);
    const unit = amount(line.unitAmount, 'la tarifa del servicio', { positive: true });
    const base = amount(line.baseAmount, 'el honorario', { positive: true });
    const vat = amount(line.vat, 'el IVA', { nonnegative: true });
    const isr = amount(line.isr, 'la retención de ISR', { nonnegative: true });
    const vatWithholding = amount(line.vatWithholding, 'la retención de IVA', { nonnegative: true });
    const net = amount(line.netAmount, 'el importe neto', { positive: true });
    let expectedBase;
    try { expectedBase = amount(multiplyHonorario(unit / 100, line.quantity), 'el honorario calculado'); }
    catch { throw invalid('la cantidad y la tarifa no permiten calcular el honorario con precisión'); }
    if (expectedBase !== base) throw invalid('la cantidad y la tarifa no coinciden con el honorario guardado');
    if (add(add(base, vat), -add(isr, vatWithholding)) !== net) throw invalid('el honorario y los impuestos no coinciden con el importe neto');
    centsByRow.set(line.rowId, { base, vat, isr, vatWithholding, net });
    // La clave temporal permite validar médicos homónimos con perfiles fiscales
    // distintos; la distribución original continúa agrupando por providerId.
    const profileKey = `fiscal-snapshot-${index}`;
    profiles[profileKey] = { linkStatus: 'candidato_unico', candidates: [line.fiscalSnapshot] };
    return { snapshot: { ...line, providerName: profileKey, baseAmount: base / 100 }, vatRate: line.vatRate,
      revision: line.reviewRevision, reviewer: line.reviewer, fingerprint: line.reviewFingerprint, motivo: line.reason };
  });
  let calculated;
  try { calculated = priceApprovedSnapshots(reviews, profiles); }
  catch { throw invalid('la información fiscal guardada está incompleta'); }
  calculated.forEach((expected, index) => {
    const line = snapshot.lines[index], cents = centsByRow.get(line.rowId);
    if (line.isrRate !== expected.isrRate || line.vatFraction !== expected.vatFraction
      || cents.vat !== amount(expected.vat, 'el IVA calculado') || cents.isr !== amount(expected.isr, 'el ISR calculado')
      || cents.vatWithholding !== amount(expected.vatWithholding, 'la retención calculada')
      || cents.net !== amount(expected.netAmount, 'el neto calculado')) throw invalid('los impuestos no coinciden con el cálculo y la distribución de centavos del cierre');
  });
  if (!Array.isArray(finalizedRows) || finalizedRows.length !== rowIds.size) throw invalid('los servicios confirmados no coinciden con el cierre');
  const finalized = new Map();
  for (const row of finalizedRows) {
    if (finalized.has(row.row_id) || !rowIds.has(row.row_id) || String(row.liquidation_id) !== String(saved.id)) throw invalid('hay un servicio confirmado repetido o ajeno al cierre');
    finalized.set(row.row_id, row.snapshot);
  }
  if (snapshot.lines.some(line => !isDeepStrictEqual(line, finalized.get(line.rowId)))) throw invalid('el detalle confirmado no coincide con el cierre guardado');
  if (!Array.isArray(payments) || !Array.isArray(adjustments)) throw invalid('faltan los movimientos del cierre');
  const paymentRows = validateLedger(payments, saved.id, rowIds);
  const adjustmentRows = validateLedger(adjustments, saved.id, rowIds, true);
  const issues = changes.map(change => ({ code: change.code || 'CLINICAL_SOURCE_CHANGED', message: change.reason || change.message, ...(change.rowId ? { rowId: change.rowId } : {}) }));
  const doctors = new Map(), totalCents = zeroTotals();
  for (const source of snapshot.lines) {
    const key = String(source.providerId);
    if (!doctors.has(key)) doctors.set(key, { providerId: source.providerId, providerName: source.providerName,
      _totals: zeroTotals(), lines: [], payments: [], adjustments: [] });
    const doctor = doctors.get(key), lineCents = { ...zeroTotals(), ...centsByRow.get(source.rowId) };
    const rowPayments = paymentRows.filter(item => item.row_id === source.rowId);
    const rowAdjustments = adjustmentRows.filter(item => item.row_id === source.rowId);
    lineCents.paid = rowPayments.reduce((sum, item) => add(sum, amount(item.amount, 'el pago')), 0);
    lineCents.adjustments = rowAdjustments.reduce((sum, item) => add(sum, amount(item.amount, 'el ajuste')), 0);
    lineCents.balance = add(add(lineCents.net, lineCents.adjustments), -lineCents.paid);
    if (lineCents.balance < 0) issues.push({ code: 'NEGATIVE_BALANCE', rowId: source.rowId,
      message: 'Este servicio tiene un saldo a favor después de pagos y ajustes. Revisa cómo aplicarlo antes de preparar el pago.' });
    doctor.lines.push({ ...source, paidAmount: lineCents.paid / 100, adjustmentAmount: lineCents.adjustments / 100, balance: lineCents.balance / 100 });
    doctor.payments.push(...rowPayments); doctor.adjustments.push(...rowAdjustments);
    for (const field of keys) {
      doctor._totals[field] = add(doctor._totals[field], lineCents[field]);
      totalCents[field] = add(totalCents[field], lineCents[field]);
    }
  }
  if (amount(snapshot.totalBase, 'el total de honorarios') !== totalCents.base || amount(snapshot.totalNet, 'el total neto') !== totalCents.net) throw invalid('los totales no coinciden con los servicios del cierre');
  const status = issues.length ? 'REVIEW_REQUIRED' : totalCents.balance === 0 ? 'PAID' : 'READY';
  totalCents.payable = status === 'READY' ? totalCents.balance : 0;
  return { version: 1, generatedAt, liquidation: { id: saved.id, startDate: dateOnly(saved.start_date), endDate: dateOnly(saved.end_date),
    createdAt: saved.created_at, createdBy: saved.created_by, reason: saved.reason, fiscalNote: snapshot.fiscalNote, sapAsOf: snapshot.sapAsOf },
  currency: 'MXN', status, issues, totals: moneyTotals(totalCents), doctors: [...doctors.values()].map(({ _totals, ...doctor }) => ({
    ...doctor, totals: moneyTotals({ ..._totals, payable: status === 'READY' ? _totals.balance : 0 }) })) };
}

async function getPaymentReport(id, getRemotePool) {
  if (!validId(id)) throw Object.assign(new Error('Selecciona un cierre válido.'), { status: 400 });
  await ensureSchema();
  const client = await getDb().pool.connect();
  let saved, payments, adjustments, finalizedRows, generatedAt;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await client.query('SELECT *, transaction_timestamp() AS report_generated_at FROM bi_honorarios_liquidations WHERE id=$1', [id]);
    if (!result.rows.length) throw Object.assign(new Error('No se encontró el cierre.'), { status: 404 });
    saved = result.rows[0]; generatedAt = new Date(saved.report_generated_at).toISOString();
    payments = (await client.query('SELECT * FROM bi_honorarios_payment_applications WHERE liquidation_id=$1 ORDER BY id', [id])).rows;
    adjustments = (await client.query('SELECT * FROM bi_honorarios_liquidation_adjustments WHERE liquidation_id=$1 ORDER BY id', [id])).rows;
    finalizedRows = (await client.query('SELECT row_id,liquidation_id,snapshot FROM bi_honorarios_finalized_rows WHERE liquidation_id=$1 ORDER BY row_id', [id])).rows;
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  // Valida primero la consistencia económica antes de consultar la fuente clínica.
  const report = buildPaymentReport(saved, payments, adjustments, finalizedRows, [], generatedAt);
  let changes;
  try { changes = await checkLiquidationChanges(saved.snapshot.lines.some(line => !fixedLine(line)) ? await getRemotePool() : null, saved); }
  catch { changes = [{ code: 'CLINICAL_CHECK_UNAVAILABLE', message: 'No se pudo confirmar si las atenciones cambiaron después del cierre. Intenta de nuevo antes de preparar el pago.' }]; }
  if (!changes.length) return report;
  return buildPaymentReport(saved, payments, adjustments, finalizedRows, changes, generatedAt);
}

module.exports = { getPaymentReport, buildPaymentReport };
