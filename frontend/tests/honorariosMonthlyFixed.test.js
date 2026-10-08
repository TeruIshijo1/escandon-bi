import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { calculateHonorarios, summarizeHonorarios, reviewFingerprint } from '../src/utils/honorariosCalculation.js';
import { isHonorarioReviewEligible, filterDoctorReviewRows } from '../src/utils/honorariosEligibility.js';
const require = createRequire(import.meta.url);
const serverSource = require('../../backend/utils/honorariosReviewSource.js');
const { priceApprovedSnapshots } = require('../../backend/utils/honorariosFiscal.js');
const fixed = () => ({ ModeBI: true, FixedMonthly: true, TipoCalculo: 'BI_FIJO_MENSUAL',
  SourceIdentity: 'FIXED|7|2026-10', FeeMonth: '2026-10', MedicoId: 7, Medico: 'MÉDICO FICTICIO',
  Cantidad: 1, BaseImporte: 2500, FechaAtencion: '2026-10-01', Servicio: 'Pago fijo mensual · Ginecología',
  FixedMonthlySnapshot: { assignmentId: 1, revision: 1, providerId: 7, providerName: 'MÉDICO FICTICIO',
    month: '2026-10', validFromMonth: '2026-10', amount: 2500, amountBasis: 'BASE', monthPolicy: 'FULL_MONTH' } });
const profile = (taxes = true) => ({ linkStatus: 'candidato_unico', candidates: [{
  federalTaxId: 'AAAA800101AAA', subjectToWithholding: taxes,
  configuredWithholdings: taxes ? [
    { estimateRule: 'isr_on_fee', rate: 10, inactive: false, appliesAt: 'factura', codeEffectiveFrom: '2025-01-01' },
    { estimateRule: 'vat_two_thirds', rate: 10.66, inactive: false, appliesAt: 'factura', codeEffectiveFrom: '2025-01-01' },
  ] : [] }] });
const approve = (row, vatRate) => ({ action: 'APROBAR', fingerprint: reviewFingerprint(row), vatRate,
  revision: 1, sourceType: row.TipoCalculo, snapshot: { rowId: row.SourceIdentity,
    providerId: row.MedicoId, providerName: row.Medico, role: 'JEFE_AREA', quantity: 1,
    unitAmount: row.BaseImporte, baseAmount: row.BaseImporte, serviceDate: row.FechaAtencion } });

test('un fijo configurado requiere decisión mensual explícita y no suma por defecto', () => {
  const source = fixed();
  assert.equal(isHonorarioReviewEligible(source), true);
  assert.equal(reviewFingerprint(source), serverSource.reviewFingerprint(source));
  const row = calculateHonorarios([source])[0];
  assert.equal(row._reviewStatus, 'PENDIENTE');
  assert.equal(summarizeHonorarios([row]).totalBase, 0);
});

test('servicios aprobados más un fijo completo usan el mismo cálculo fiscal en cliente y servidor', () => {
  const monthly = fixed();
  const clinical = Array.from({ length: 3 }, (_, index) => ({ ModeBI: true, TipoCalculo: 'BI_PRESTACION',
    SourceIdentity: `BI|SOLN|${index}|ORDEN`, MedicoId: 7, Medico: monthly.Medico,
    FechaAtencion: '2026-10-06', Cantidad: 1, BaseImporte: 225.01 }));
  const sources = [...clinical, monthly];
  for (const taxes of [true, false]) {
    const vatRate = taxes ? 0.16 : 0;
    const decisions = Object.fromEntries(sources.map(source => [source.SourceIdentity, approve(source, vatRate)]));
    const rows = calculateHonorarios(sources, decisions, { [monthly.Medico]: profile(taxes) });
    const totals = summarizeHonorarios(rows);
    assert.equal(totals.totalServiceBase, 675.03);
    assert.equal(totals.totalFixedMonthlyBase, 2500);
    assert.equal(totals.totalBase, 3175.03);
    assert.equal(totals.fixedMonthlyCount, 1);
    const server = priceApprovedSnapshots(Object.values(decisions), { [monthly.Medico]: profile(taxes) });
    assert.equal(totals.totalNeto, server.reduce((sum, row) => sum + Math.round(row.netAmount * 100), 0) / 100);
    assert.equal(totals.totalISR, server.reduce((sum, row) => sum + Math.round(row.isr * 100), 0) / 100);
  }
});

test('una configuración modificada requiere revisar nuevamente el fijo antes de cerrar', () => {
  const original = fixed();
  const decision = approve(original, 0);
  const changed = { ...original, BaseImporte: 3000,
    FixedMonthlySnapshot: { ...original.FixedMonthlySnapshot, revision: 2, amount: 3000 } };
  assert.notEqual(reviewFingerprint(changed), reviewFingerprint(original));
  const row = calculateHonorarios([changed], { [original.SourceIdentity]: decision })[0];
  assert.equal(row._reviewStale, true);
  assert.equal(row._reviewStatus, 'PENDIENTE');
  assert.equal(row._effectiveBase, 0);
});

test('el fijo se vincula por médico existente y el PDF rechaza otra identidad o importe', () => {
  const row = fixed();
  assert.equal(isHonorarioReviewEligible({ ...row, MedicoId: 8 }), false);
  assert.equal(isHonorarioReviewEligible({ ...row, BaseImporte: 4500 }), false);
  assert.equal(isHonorarioReviewEligible({ ...row, Cantidad: 2 }), false);
  assert.equal(isHonorarioReviewEligible({ ...row, FixedMonthlySnapshot: null }), false);
  assert.equal(isHonorarioReviewEligible({ ...row, FixedMonthlySnapshot: { ...row.FixedMonthlySnapshot, validFromMonth: '2026-11' } }), false);
  assert.equal(isHonorarioReviewEligible({ ...row, FixedMonthlySnapshot: { ...row.FixedMonthlySnapshot, deactivatedFromMonth: '2026-10' } }), false);
  assert.equal(filterDoctorReviewRows({ providerId: 8, providerName: row.Medico, filas: [row] }).length, 0);
});
