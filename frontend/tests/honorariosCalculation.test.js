import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateHonorarios, summarizeHonorarios, honorarioRowId, reviewFingerprint, sapDocumentsToRows, hasPhysicianChange } from '../src/utils/honorariosCalculation.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const serverSource = require('../../backend/utils/honorariosReviewSource.js');
const { priceApprovedSnapshots } = require('../../backend/utils/honorariosFiscal.js');

const tax = (estimateRule, rate) => ({ estimateRule, rate, inactive: false, appliesAt: 'factura', codeEffectiveFrom: '2025-12-26' });
const profile = (rate = 10, withVat = true) => ({ linkStatus: 'candidato_unico', candidates: [{
  federalTaxId: 'AAAA800101AAA', subjectToWithholding: true,
  configuredWithholdings: [tax('isr_on_fee', rate), ...(withVat ? [tax('vat_two_thirds', 10.66)] : [])]
}] });
const row = (base = 225, vat = 36, id = 1) => ({ UDRKey: id, Medico: ' PRUEBA ', ElegiblePago: 1, BaseImporte: base,
  IvaLinea: vat, TasaISR: 0.1, Cantidad: 1, FechaAtencion: '2026-08-29', RenglonAuditoria: id });
const approved = (rows, changes = {}) => Object.fromEntries(rows.map(r => {
  const id = honorarioRowId(r);
  return [id, { action: 'APROBAR', fingerprint: reviewFingerprint(r), ...changes[id] }];
}));
const calc = (rows, p = profile(), overrides = {}) => calculateHonorarios(rows, approved(rows, overrides), { PRUEBA: p });

test('BI source identity and fingerprint agree with server and approvals use their assigned physician snapshot', () => {
  const source = { ...row(), ModeBI: true, SourceIdentity: 'BI|SOLN|1|ORDEN', SourceLineId: 1,
    MedicoId: 5, CatalogStatus: 'INCLUIDO', CatalogSnapshot: { revision: 1 }, TariffSnapshot: { id: 1 } };
  assert.equal(honorarioRowId(source), serverSource.honorarioRowId(source));
  assert.equal(reviewFingerprint(source), serverSource.reviewFingerprint(source));
  assert.equal(calculateHonorarios([source], {}, {}).at(0)._reviewStatus, 'PENDIENTE');
  const snapshot = { providerId: 7, providerName: 'OTRO MÉDICO', quantity: 2, unitAmount: 300, baseAmount: 600 };
  const saved = { [source.SourceIdentity]: { action: 'APROBAR', fingerprint: reviewFingerprint(source), customAmount: 600, vatRate: 0, snapshot } };
  const result = calculateHonorarios([source], saved, { 'OTRO MÉDICO': profile(10, false) }).at(0);
  assert.equal(result.MedicoId, 7); assert.equal(result._effectiveBase, 600); assert.equal(result._effectiveNeto, 540);
  assert.equal(reviewFingerprint(result), reviewFingerprint(source));
  assert.equal(calculateHonorarios([{ ...source, ReviewInvalidated: true }], saved, {}).at(0)._reviewStatus, 'PENDIENTE');
});

test('physician changes compare the selected ID with the displayed physician without requiring a selection-wide replacement', () => {
  assert.equal(hasPhysicianChange(7, '7'), false);
  assert.equal(hasPhysicianChange(' 7 ', ' 7 '), false);
  assert.equal(hasPhysicianChange(7, ''), false);
  assert.equal(hasPhysicianChange(7, '   '), false);
  assert.equal(hasPhysicianChange(7, '8'), true);
  assert.equal(hasPhysicianChange(null, '8'), true);
  const providers = [7, 8];
  assert.equal(providers.some(providerId => hasPhysicianChange(providerId, '7')), true);
  assert.equal(providers.some(providerId => hasPhysicianChange(providerId, '')), false);
});

test('physician correction evidence follows an approved snapshot without changing source identity or attribution', () => {
  const correction = { fromProviderId: 5, fromProviderName: 'MÉDICO ORIGINAL', toProviderId: 7,
    toProviderName: 'MÉDICO CONFIRMADO', reason: 'Se confirmó quién realizó el servicio.',
    correctedBy: { id: 10, name: 'REVISOR ORIGINAL', username: 'revisor' }, correctedAt: '2026-10-08T16:00:00.000Z' };
  const source = { ...row(), ModeBI: true, SourceIdentity: 'BI|SOLN|1|ORDEN', MedicoId: 5,
    Medico: 'MÉDICO ORIGINAL', CatalogStatus: 'INCLUIDO' };
  const snapshot = { providerId: 7, providerName: 'MÉDICO CONFIRMADO', quantity: 2, role: 'TRATANTE',
    unitAmount: 300, baseAmount: 600, physicianCorrection: correction };
  const saved = { [source.SourceIdentity]: { action: 'APROBAR', fingerprint: reviewFingerprint(source),
    customAmount: 600, vatRate: 0, snapshot, reviewer: 'REVISOR POSTERIOR' } };
  const unchangedSource = structuredClone(source);
  const unchangedSaved = structuredClone(saved);
  const result = calculateHonorarios([source], saved, { 'MÉDICO CONFIRMADO': profile(10, false) })[0];
  assert.deepEqual(result._physicianCorrection, correction);
  assert.equal(result._physicianCorrection.correctedBy.name, 'REVISOR ORIGINAL');
  assert.equal(result.MedicoId, 7);
  assert.equal(result._rowId, source.SourceIdentity);
  assert.equal(reviewFingerprint(result), reviewFingerprint(source));
  assert.equal(result._effectiveNeto, 540);
  assert.deepEqual(source, unchangedSource);
  assert.deepEqual(saved, unchangedSaved);
  assert.equal(calculateHonorarios([{ ...source, ReviewInvalidated: true }], saved)[0]._physicianCorrection, null);
});

test('physician correction survives renewed review and a closed snapshot keeps its own evidence', () => {
  const correction = { fromProviderId: 5, fromProviderName: 'ORIGINAL', toProviderId: 7,
    toProviderName: 'CONFIRMADO', reason: 'Médico confirmado en la atención.',
    correctedBy: { id: 10, name: 'PRIMER REVISOR', username: 'revisor' } };
  const source = { ...row(0, null), ModeBI: true, SourceIdentity: 'BI|SOLN|1|ORDEN', MedicoId: 5,
    ReviewInvalidated: true, CatalogStatus: 'INCLUIDO',
    ReviewBeneficiary: { providerId: 7, providerName: 'CONFIRMADO', role: 'TRATANTE', physicianCorrection: correction },
    ReviewEligibilityTariff: { id: 2, revision: 2, amount: 300 } };
  const previous = { [source.SourceIdentity]: { action: 'APROBAR', fingerprint: 'old-source',
    snapshot: { providerId: 7, providerName: 'CONFIRMADO', baseAmount: 250, physicianCorrection: correction } } };
  const pending = calculateHonorarios([source], previous)[0];
  assert.equal(pending._reviewStatus, 'PENDIENTE');
  assert.equal(pending._effectiveNeto, 0);
  assert.equal(pending.MedicoId, 7);
  assert.deepEqual(pending._physicianCorrection, correction);

  const frozen = { providerId: 7, providerName: 'CONFIRMADO', quantity: 1, unitAmount: 300, baseAmount: 300,
    vat: 0, isr: 30, isrRate: .1, vatWithholding: 0, netAmount: 270, physicianCorrection: correction };
  const closedSource = { ...source, LiquidacionCerrada: 4, SnapshotCierre: frozen,
    ReviewBeneficiary: { ...source.ReviewBeneficiary, physicianCorrection: { ...correction, reason: 'CAMBIO POSTERIOR' } } };
  const closed = calculateHonorarios([closedSource], previous)[0];
  assert.deepEqual(closed._physicianCorrection, correction);
  assert.equal(closed._effectiveNeto, 270);
  const legacyFrozen = { ...frozen };
  delete legacyFrozen.physicianCorrection;
  assert.equal(calculateHonorarios([{ ...closedSource, SnapshotCierre: legacyFrozen }], previous)[0]._physicianCorrection, null);
});

test('quantity, role and legacy physician adjustments never invent correction evidence', () => {
  const source = { ...row(), ModeBI: true, SourceIdentity: 'BI|SOLN|1|ORDEN', MedicoId: 5,
    Medico: 'MÉDICO ORIGINAL', RolMedico: 'TRATANTE', CatalogStatus: 'INCLUIDO' };
  for (const changes of [{ quantity: 2 }, { role: 'AN' }, { providerId: 7, providerName: 'OTRO MÉDICO' }]) {
    const snapshot = { providerId: 5, providerName: 'MÉDICO ORIGINAL', role: 'TRATANTE', quantity: 1,
      unitAmount: 225, baseAmount: 225, ...changes };
    const saved = { [source.SourceIdentity]: { action: 'APROBAR', fingerprint: reviewFingerprint(source), snapshot } };
    assert.equal(calculateHonorarios([source], saved)[0]._physicianCorrection, null);
  }
});

test('closed snapshots preserve amounts after catalog or source changes', () => {
  const source = { ...row(), ModeBI: true, SourceIdentity: 'BI|PCBL|3|AN', MedicoId: 8, LiquidacionCerrada: 1,
    CambiosTrasCierre: true, CatalogStatus: 'EXCLUIDO', BaseImporte: 9999, SnapshotCierre: {
      providerName: 'MÉDICO DEL CIERRE', providerId: 7, quantity: 1, unitAmount: 300, baseAmount: 300,
      vat: 0, isr: 30, isrRate: 0.1, vatWithholding: 0, netAmount: 270 } };
  const result = calculateHonorarios([source], {}, {}).at(0);
  assert.equal(result._effectiveNeto, 270); assert.equal(result._effectiveBase, 300);
  assert.equal(result._reviewStatus, 'APROBADO'); assert.equal(result._reviewStale, false);
});

test('a previously assigned physician stays visible for renewed review without restoring an obsolete payment', () => {
  const tariff = { id: 9, revision: 2, providerId: 7, amount: 300, validFrom: '2026-01-01', active: true };
  const source = { ...row(0, null), ModeBI: true, SourceIdentity: 'BI|SOLN|1|ORDEN', MedicoId: 8,
    Medico: 'SOLICITANTE', ReviewInvalidated: true, ReviewEligible: true, CatalogStatus: 'INCLUIDO',
    ReviewBeneficiary: { providerId: 7, providerName: 'MÉDICO CONFIRMADO', role: 'TRATANTE', origin: 'saved_approval' },
    ReviewEligibilityTariff: tariff };
  const saved = { [source.SourceIdentity]: { action: 'APROBAR', fingerprint: 'previous source', customAmount: 250,
    snapshot: { providerId: 7, providerName: 'MÉDICO CONFIRMADO', baseAmount: 250 } } };
  const result = calculateHonorarios([source], saved, {}).at(0);
  assert.equal(result.MedicoId, 7);
  assert.equal(result.Medico, 'MÉDICO CONFIRMADO');
  assert.equal(result.BaseImporte, 300);
  assert.equal(result.TariffSnapshot.id, 9);
  assert.equal(result._reviewStatus, 'PENDIENTE');
  assert.equal(result._effectiveNeto, 0);
  assert.equal(reviewFingerprint(result), reviewFingerprint(source));
  assert.equal(source.MedicoId, 8);
});

test('closed fiscal calculation agrees with displayed totals and allocation of rounding cents', () => {
  const originals = Array.from({ length: 23 }, (_, i) => row(1, 0.16, i + 1));
  const display = calc(originals);
  const reviews = display.map(item => ({ rowId: item._rowId, revision: 1, vatRate: 0.16,
    snapshot: { rowId: item._rowId, providerId: 7, providerName: 'PRUEBA', serviceDate: '2026-08-29', baseAmount: 1 } }));
  const closed = priceApprovedSnapshots(reviews, { PRUEBA: profile() });
  assert.equal(closed.reduce((sum, item) => sum + Math.round(item.netAmount * 100), 0) / 100, summarizeHonorarios(display).totalNeto);
});

test('correcting source folios preserves saved BI decisions for orders and appointments', () => {
  for (const [key, reference, appointment] of [['SO-16258', 16258, null], ['CITA-10', 10, 10]]) {
    const original = { ...row(), UDRKey: key, FolioAtencion: reference, FolioOrdenVenta: 16258 };
    const corrected = { ...original, FolioReferenciaOrigen: reference, FolioAtencion: null, FolioCita: appointment };
    assert.equal(honorarioRowId(corrected), honorarioRowId(original));
    assert.equal(reviewFingerprint(corrected), reviewFingerprint(original));
    const saved = approved([original]);
    const result = calculateHonorarios([corrected], saved, { PRUEBA: profile() });
    assert.equal(result[0]._reviewStatus, 'APROBADO');
    assert.equal(result[0]._reviewSource, 'BI');
    assert.equal(result[0]._reviewStale, false);
  }
});

test('23 consultations: both retentions deducted; no reuse of unrelated invoice amounts', () => {
  const provider = profile();
  provider.invoices = [{ documentTotal: 7769.66, retentions: [{ amount: 869.34 }] }];
  const original = JSON.stringify(provider);
  const rows = calc(Array.from({ length: 23 }, (_, i) => row(225, 36, i + 1)), provider);
  const s = summarizeHonorarios(rows);
  assert.deepEqual([s.totalBase, s.totalIVA, s.totalISR, s.totalRetIVA, s.totalNeto], [5175, 828, 517.5, 552, 4933.5]);
  assert.equal(rows[0]._effectiveNeto, 214.5);
  assert.equal(JSON.stringify(provider), original);
});

test('accounting example and CFDI rounding remain distinct from estimates', () => {
  assert.equal(summarizeHonorarios(calc([row(5800, 928)])).totalNeto, 5529.33);
  const s = summarizeHonorarios(calc([row(8150, 1304)]));
  assert.equal(s.totalRetIVA, 869.33);
  assert.equal(s.totalNeto, 7769.67); // stamped 7769.66 is preserved separately, never overwritten
});

test('ISR uses SAP fee rate excluding VAT, including RESICO and zero VAT', () => {
  const s = summarizeHonorarios(calc([row(1000, 160)], profile(1.25)));
  assert.equal(s.totalISR, 12.5);
  assert.equal(s.totalNeto, 1040.83);
  assert.equal(summarizeHonorarios(calc([row(1000, 0)], profile(10, false))).totalNeto, 900);
});

test('rounding by physician remains additive through filtering and reorder', () => {
  const original = Array.from({ length: 23 }, (_, i) => row(1, 0.16, i + 1));
  const rows = calc(original);
  assert.equal(summarizeHonorarios(rows).totalRetIVA, 2.45);
  assert.equal(summarizeHonorarios(rows).totalNeto, 21.93);
  const reversed = calc([...original].reverse());
  rows.forEach(r => assert.equal(r._effectiveNeto, reversed.find(p => p._rowId === r._rowId)._effectiveNeto));
  const parts = [summarizeHonorarios(rows.slice(0, 10)), summarizeHonorarios(rows.slice(10))];
  assert.equal(Math.round((parts[0].totalNeto + parts[1].totalNeto) * 100), 2193);
});

test('manual base scales VAT; exclusion zeros every amount; restoration recalculates', () => {
  const original = row();
  const override = { [honorarioRowId(original)]: { action: 'APROBAR', customAmount: 450 } };
  const result = calc([original], profile(), override)[0];
  assert.deepEqual([result._effectiveBase, result._effectiveIVA, result._effectiveISR, result._effectiveRetIVA, result._effectiveNeto], [450, 72, 45, 48, 429]);
  const excluded = calc([original], profile(), { [honorarioRowId(original)]: { action: 'EXCLUIR' } })[0];
  assert.deepEqual([excluded._effectiveBase, excluded._effectiveIVA, excluded._effectiveISR, excluded._effectiveRetIVA, excluded._effectiveNeto], [0, 0, 0, 0, 0]);
  assert.equal(calc([original])[0]._effectiveNeto, 214.5);
});

test('missing, ambiguous, unsupported, inactive, future or conflicting configuration never becomes a zero net', () => {
  const candidates = [undefined, { ...profile(), linkStatus: 'ambiguo' }];
  for (const mutate of [
    p => { p.candidates[0].configuredWithholdings[1].estimateRule = null; },
    p => { p.candidates[0].configuredWithholdings[0].inactive = true; },
    p => { p.candidates[0].configuredWithholdings[0].codeEffectiveFrom = '2026-09-01'; },
    p => { p.candidates[0].subjectToWithholding = false; },
    p => { p.candidates[0].federalTaxId = ''; },
    p => { p.candidates[0].configuredWithholdings.pop(); }
  ]) { const p = profile(); mutate(p); candidates.push(p); }
  for (const p of candidates) {
    const s = summarizeHonorarios(calculateHonorarios([row()], approved([row()]), { PRUEBA: p }));
    assert.equal(s.totalNeto, null);
    assert.equal(s.pendingCount, 1);
  }
});

test('mixed pending/known physicians cannot masquerade as a complete total', () => {
  const input = [row(), { ...row(225, 36, 2), Medico: 'OTRO' }];
  const rows = calculateHonorarios(input, approved(input), { PRUEBA: profile() });
  assert.equal(summarizeHonorarios(rows).totalNeto, null);
  assert.equal(summarizeHonorarios(rows.filter(r => r.Medico.trim() === 'PRUEBA')).totalNeto, 214.5);
});

test('only an explicit current approval contributes; pending, rejected and changed sources do not', () => {
  const input = [row(225,36,1),row(225,36,2),row(225,36,3)];
  assert.equal(summarizeHonorarios(calculateHonorarios(input)).totalNeto, 0);
  const decisions = { [honorarioRowId(input[0])]: { action:'APROBAR', fingerprint:reviewFingerprint(input[0]) },
    [honorarioRowId(input[1])]: { action:'EXCLUIR',fingerprint:reviewFingerprint(input[1]) } };
  const result = calculateHonorarios(input, decisions, {PRUEBA:profile()});
  assert.deepEqual(result.map(r=>r._reviewStatus), ['APROBADO','RECHAZADO','PENDIENTE']);
  assert.equal(summarizeHonorarios(result).totalNeto,214.5);
  input[0].BaseImporte=250;
  const changed = calculateHonorarios(input,decisions,{PRUEBA:profile()});
  assert.equal(changed[0]._reviewStale,true);
  assert.equal(summarizeHonorarios(changed).totalNeto,0);
});

test('Vertical seeds the initial decision; BI can replace it and non-Vertical rows stay pending', () => {
  const input = [
    { ...row(225, 36, 1), FuenteHonorario: 'Liquidación clínica', EstadoVertical: 'APROBADO' },
    { ...row(225, 36, 2), FuenteHonorario: 'Liquidación clínica', EstadoVertical: 'RECHAZADO' },
    { ...row(225, 36, 3), FuenteHonorario: 'Cita sin orden de venta', EstadoVertical: 'APROBADO' },
    { ...row(225, 36, 4), FuenteHonorario: 'Liquidación clínica' },
    { ...row(225, 36, 5), TipoCalculo: 'SAP_DOCUMENTO', FuenteHonorario: 'Factura SAP', EstadoVertical: 'APROBADO',
      SapDocumento: { currency: 'MXN', documentTotal: 100, retentions: [] } }
  ];
  const initial = calculateHonorarios(input, {}, { PRUEBA: profile() });
  assert.deepEqual(initial.map(r => r._reviewStatus), ['APROBADO', 'RECHAZADO', 'PENDIENTE', 'PENDIENTE', 'PENDIENTE']);
  assert.deepEqual(initial.slice(0, 2).map(r => r._reviewSource), ['VERTICAL', 'VERTICAL']);
  assert.equal(summarizeHonorarios(initial).totalNeto, 214.5);

  const decisions = {
    [honorarioRowId(input[0])]: { action: 'EXCLUIR', fingerprint: reviewFingerprint(input[0]) },
    [honorarioRowId(input[1])]: { action: 'APROBAR', fingerprint: reviewFingerprint(input[1]) },
    [honorarioRowId(input[3])]: { action: 'APROBAR', fingerprint: reviewFingerprint(input[3]) }
  };
  const revised = calculateHonorarios(input, decisions, { PRUEBA: profile() });
  assert.deepEqual(revised.map(r => r._reviewStatus), ['RECHAZADO', 'APROBADO', 'PENDIENTE', 'APROBADO', 'PENDIENTE']);
  assert.deepEqual(revised.slice(0, 2).map(r => r._reviewSource), ['BI', 'BI']);
});

test('a saved decision made against a different Vertical state expires to pending', () => {
  const input = [{ ...row(225, 36, 1), FuenteHonorario: 'Liquidación clínica', EstadoVertical: 'APROBADO' }];
  const decision = { [honorarioRowId(input[0])]: { action: 'APROBAR', fingerprint: reviewFingerprint(input[0]) } };
  input[0].EstadoVertical = 'RECHAZADO';
  const changed = calculateHonorarios(input, decision);
  assert.equal(changed[0]._reviewStale, true);
  assert.equal(changed[0]._reviewStatus, 'PENDIENTE');
});

test('one SAP document per DocEntry; posted net is preserved and double counting needs review', () => {
  const invoice = {docEntry:100,docNum:100,postingDate:'2026-09-16',currency:'MXN',documentTotal:7769.66,retentions:[{amount:869.34}],lines:[]};
  const provider = {medico:'PRUEBA',invoices:[invoice]};
  const docs = sapDocumentsToRows({ providers:{PRUEBA:provider}, additionalProviders:[provider] });
  assert.equal(docs.length,1);
  assert.equal(summarizeHonorarios(calc(docs)).totalNeto,7769.66);
  assert.equal(summarizeHonorarios(calc([row(),...docs])).totalNeto,null);
  const decisions = {[honorarioRowId(docs[0])]: {separateServicesConfirmed:true}};
  const combined = summarizeHonorarios(calc([row(),...docs],profile(),decisions));
  assert.equal(combined.totalNeto,7984.16);
  assert.equal(combined.totalBase,225);
  assert.equal(combined.sapDocumentNet,7769.66);
});

test('Vertical stays primary and SAP only labels possible concept gaps without changing totals', () => {
  const clinical = { ...row(225, 36, 7), Medico: 'PRUEBA', EstadoVertical: 'APROBADO',
    FuenteHonorario: 'Liquidación clínica', Servicio: 'CUOTA DE RECUPERACION CONSULTA PSICOLOGIA' };
  const invoice = { docEntry: 101, docNum: 101, currency: 'MXN', documentTotal: 900, lines: [
    { lineNumber: 0, description: 'PSICOLOGÍA', quantity: 0, recordedAmount: 600 },
    { lineNumber: 1, description: 'CONSULTAS HSBC', quantity: 0, recordedAmount: 300 }
  ] };
  const docs = sapDocumentsToRows({ providers: { PRUEBA: { medico: 'PRUEBA', invoices: [invoice] } } }, [clinical]);
  assert.deepEqual(docs[0].SapDocumento.verticalLineCoverage.map(line => line.status), ['POSIBLE_COINCIDENCIA', 'NO_LOCALIZADO']);
  const result = calculateHonorarios([clinical, ...docs], {}, { PRUEBA: profile() });
  assert.equal(result[0]._reviewSource, 'VERTICAL');
  assert.equal(result[0]._reviewStatus, 'APROBADO');
  assert.equal(result[1]._reviewStatus, 'PENDIENTE');
  const summary = summarizeHonorarios(result);
  assert.equal(summary.totalNeto, 214.5);
  assert.equal(summary.sapDocumentNet, 0);
});

test('cancelled or foreign-currency documents never enter the MXN sum as a valid net', () => {
  for (const change of [{cancelled:true},{currency:'USD'},{documentTotal:null}]) {
    const docs = sapDocumentsToRows({providers:{PRUEBA:{invoices:[{docEntry:100,documentTotal:100,currency:'MXN',...change}]}}});
    assert.equal(summarizeHonorarios(calc(docs)).totalNeto,null);
  }
});

test('reviewer confirmed VAT allows a formerly unpriced service to be calculated without assuming exemption', () => {
  const input = {...row(0,null),ElegiblePago:0};
  const result = calc([input],profile(),{[honorarioRowId(input)]:{action:'APROBAR',customAmount:1000,vatRate:0.16}});
  assert.equal(result[0]._effectiveNeto,953.33);
});

test('manual inclusion without a source VAT basis remains pending; no invented exemption', () => {
  const r = { ...row(0, 0), ElegiblePago: 0 };
  assert.equal(calc([r], profile(), { [honorarioRowId(r)]: { action: 'APROBAR', customAmount: 1000 } })[0]._effectiveNeto, null);
});

test('ficha fiscal interna por ID conserva IVA aprobado y coincide con el cierre en centavos', () => {
  const profiles = { 144: { source: 'BI_INTERNO', providerId: '144', enabled: true, confirmed: true,
    federalTaxId: 'AAAA800101AAA', fiscalRegime: '612', validFrom: '2026-01-01', isrRate: 0.1,
    vatFraction: 2 / 3, defaultVatRate: 0, revision: 1 } };
  const data = Array.from({ length: 8 }, (_, index) => ({ ...row(225, null, index + 100), Medico: 'ELSA  CARLOTA', MedicoId: 144 }));
  const overrides = approved(data, Object.fromEntries(data.map(r => [honorarioRowId(r), { vatRate: 0.16 }])));
  const ui = calculateHonorarios(data, overrides, {}, '', profiles);
  const total = summarizeHonorarios(ui);
  assert.equal(total.totalIVA, 288); assert.equal(total.totalRetIVA, 192); assert.equal(total.totalISR, 180); assert.equal(total.totalNeto, 1716);
  assert.ok(ui.every(r => r._effectiveVatRate === 0.16 && r._fiscalReady));
  const reviews = data.map((r, index) => ({ snapshot: { providerId: 144, providerName: r.Medico.trim(), rowId: honorarioRowId(r), baseAmount: 225, serviceDate: r.FechaAtencion }, vatRate: 0.16, revision: 1 }));
  const lines = priceApprovedSnapshots(reviews, {}, profiles);
  assert.deepEqual(ui.map(r => [r._effectiveIVA, r._effectiveISR, r._effectiveRetIVA, r._effectiveNeto]), lines.map(r => [r.vat, r.isr, r.vatWithholding, r.netAmount]));
  const notYet = { 144: { ...profiles[144], validFrom: '2027-01-01' } };
  assert.equal(summarizeHonorarios(calculateHonorarios(data, overrides, {}, '', notYet)).totalNeto, null);
  assert.throws(() => priceApprovedSnapshots(reviews, {}, notYet), /fiscales/);
  const otherId = { 145: profiles[144] };
  assert.equal(summarizeHonorarios(calculateHonorarios(data, overrides, {}, '', otherId)).totalNeto, null);
  const { validateProfile, saveProfile } = require('../../backend/services/honorariosFiscalProfile.service.js');
  assert.throws(() => validateProfile({ providerId: 144, expectedRevision: 0, ...profiles[144], defaultVatRate: 0.16, isrRate: 0.5 }, { id: 144, name: 'ELSA' }), /Completa/);
});
