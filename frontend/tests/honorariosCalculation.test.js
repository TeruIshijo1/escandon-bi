import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateHonorarios, summarizeHonorarios, honorarioRowId, reviewFingerprint, sapDocumentsToRows } from '../src/utils/honorariosCalculation.js';

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
