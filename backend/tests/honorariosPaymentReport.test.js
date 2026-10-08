'use strict';

jest.mock('../config/db', () => ({ getDb: jest.fn() }));
jest.mock('../services/honorariosLiquidation.service', () => ({ ensureSchema: jest.fn(async () => {}), checkLiquidationChanges: jest.fn(async () => []) }));
const { buildPaymentReport, getPaymentReport } = require('../services/honorariosPaymentReport.service');
const { priceApprovedSnapshots } = require('../utils/honorariosFiscal');
const { getDb } = require('../config/db');
const { checkLiquidationChanges } = require('../services/honorariosLiquidation.service');
const { fixedFingerprint } = require('../services/honorariosMonthlyFixed.service');

const profile = { subjectToWithholding: true, federalTaxId: 'AAAA800101AAA', configuredWithholdings: [
  { inactive: false, estimateRule: 'isr_on_fee', rate: 1.25, appliesAt: 'factura', codeEffectiveFrom: '2025-01-01' },
  { inactive: false, estimateRule: 'vat_two_thirds', rate: 10.6667, appliesAt: 'factura', codeEffectiveFrom: '2025-01-01' }
] };
function fixture({ count = 1, base = 100, quantity = 1, unitAmount = base, vatRate = 0, exempt = false, physicianIds = [] } = {}) {
  const fiscal = exempt ? { subjectToWithholding: false, configuredWithholdings: [] } : profile;
  const providers = { MEDICO: { linkStatus: 'candidato_unico', candidates: [fiscal] } };
  const reviews = Array.from({ length: count }, (_, i) => ({ rowId: `BI|SOLN|${i + 1}|ORDEN`,
    revision: 1, reviewer: '1: Revisor', fingerprint: 'fingerprint', motivo: 'Servicio revisado', vatRate,
    snapshot: { rowId: `BI|SOLN|${i + 1}|ORDEN`, providerId: physicianIds[i] || 7, providerName: 'MEDICO',
      sourceType: 'SOLN', sourceLineId: i + 1, sourceFingerprint: `source-${i + 1}`, itemCode: 'SER1471',
      description: 'Sesión confirmada', serviceDate: '2026-09-02', role: 'TRATANTE', quantity, unitAmount, baseAmount: base,
      catalog: { itemCode: 'SER1471', status: 'INCLUIDO', revision: 1 }, tariff: { id: 1, amount: unitAmount, revision: 1 } } }));
  const lines = priceApprovedSnapshots(reviews, providers);
  const saved = { id: '1', start_date: '2026-09-01', end_date: '2026-09-30', created_by: '1: Revisor',
    created_at: '2026-09-30T12:00:00.000Z', reason: 'Cierre confirmado', snapshot: { lines, currency: 'MXN',
      totalBase: Math.round(lines.reduce((sum, line) => sum + line.baseAmount * 100, 0)) / 100,
      totalNet: Math.round(lines.reduce((sum, line) => sum + line.netAmount * 100, 0)) / 100,
      fiscalNote: 'Fiscalidad confirmada al cerrar', sapAsOf: '2026-09-30T11:00:00.000Z' } };
  const finalized = () => saved.snapshot.lines.map(line => ({ row_id: line.rowId, liquidation_id: '1', snapshot: JSON.parse(JSON.stringify(line)) }));
  return { saved, finalized, build: (payments = [], adjustments = [], changes = []) => buildPaymentReport(saved, payments, adjustments, finalized(), changes) };
}
const movement = (overrides = {}) => ({ id: '1', liquidation_id: '1', row_id: 'BI|SOLN|1|ORDEN', amount: '40.00',
  reference: 'COMPROBANTE-1', reason: 'Movimiento confirmado', created_by: '1: Revisor',
  payment_date: '2026-09-30', created_at: '2026-09-30T12:00:00.000Z', ...overrides });

function fixedFixture({ mixed = false } = {}) {
  const data = fixture({ count: 23, base: 214.5, vatRate: 0.16 });
  const fixed = { assignmentId: 4, revision: 1, providerId: 7, providerName: 'MEDICO', area: 'Urgencias',
    amount: 1000, amountBasis: 'BASE', monthPolicy: 'FULL_MONTH', month: '2026-09',
    validFromMonth: '2026-01', validToMonth: null, updatedBy: '1: Configurador' };
  const review = { revision: 1, reviewer: '2: Revisor', fingerprint: 'monthly-row-fingerprint',
    motivo: 'Se incluye el pago fijo de septiembre', vatRate: 0.16,
    snapshot: { rowId: 'FIXED|7|2026-09', FixedMonthly: true, sourceType: 'BI_FIJO_MENSUAL',
      sourceLineId: 4, occurrenceId: '2026-09', allocationKey: 'FIXED|7|2026-09', maximumQuantity: 1,
      providerId: 7, providerName: 'MEDICO', role: 'JEFE_AREA', itemCode: 'BI_FIJO_MENSUAL',
      description: 'Pago fijo mensual · Urgencias', serviceDate: '2026-09-01', month: '2026-09',
      quantity: 1, unitAmount: 1000, baseAmount: 1000, fixed, sourceFingerprint: fixedFingerprint(fixed) } };
  const clinical = mixed ? data.saved.snapshot.lines.map(line => ({ snapshot: line, vatRate: line.vatRate,
    revision: line.reviewRevision, reviewer: line.reviewer, fingerprint: line.reviewFingerprint, motivo: line.reason })) : [];
  data.saved.snapshot.lines = priceApprovedSnapshots([...clinical, review], { MEDICO: { linkStatus: 'candidato_unico', candidates: [profile] } });
  data.saved.snapshot.totalBase = Math.round(data.saved.snapshot.lines.reduce((sum, line) => sum + line.baseAmount * 100, 0)) / 100;
  data.saved.snapshot.totalNet = Math.round(data.saved.snapshot.lines.reduce((sum, line) => sum + line.netAmount * 100, 0)) / 100;
  return data;
}

test('monthly payment PDF validates its configuration instead of a clinical tariff and accepts a partial monthly cut', () => {
  const data = fixedFixture();
  data.saved.start_date = '2026-09-15'; data.saved.end_date = '2026-09-20';
  const report = data.build();
  expect(report.status).toBe('READY');
  expect(report.totals).toMatchObject({ base: 1000, vat: 160, isr: 12.5, vatWithholding: 106.67, net: 1040.83 });
  expect(report.doctors[0].lines[0].tariff).toBeUndefined();
});

test('monthly and clinical payments share the same fiscal cent allocation in one payment report', () => {
  const data = fixedFixture({ mixed: true });
  const report = data.build();
  expect(report.doctors[0].lines).toHaveLength(24);
  expect(report.totals.base).toBe(5933.5);
  expect(report.totals.net).toBe(data.saved.snapshot.totalNet);
});

test('monthly payment PDF rejects missing or altered configuration, month, provider and amount traceability', () => {
  for (const mutate of [
    line => { delete line.fixed; }, line => { line.fixed.amount = 999; }, line => { line.month = '2026-08'; },
    line => { line.fixed.providerId = 8; }, line => { line.fixed.amountBasis = 'NET'; },
    line => { line.sourceFingerprint = 'forged'; }, line => { line.FixedMonthly = false; },
    line => { line.quantity = 2; }, line => { line.fixed.updatedBy = ''; },
    line => { line.fixed.deactivatedFromMonth = '2026-09'; line.sourceFingerprint = fixedFingerprint(line.fixed); }
  ]) {
    const data = fixedFixture(); mutate(data.saved.snapshot.lines[0]);
    expect(() => data.build()).toThrow('No se puede preparar el PDF para pago');
  }
});

test('a fixed-only closed payment report does not require a Vertical connection', async () => {
  const data = fixedFixture();
  const query = jest.fn(async sql => ({ rows: sql.includes('FROM bi_honorarios_liquidations')
    ? [{ ...data.saved, report_generated_at: '2026-10-07T12:00:00.000Z' }]
    : sql.includes('FROM bi_honorarios_finalized_rows') ? data.finalized() : [] }));
  getDb.mockReturnValue({ pool: { connect: async () => ({ query, release: jest.fn() }) } });
  const getRemotePool = jest.fn(async () => { throw new Error('Vertical no disponible'); });
  checkLiquidationChanges.mockResolvedValueOnce([]);
  expect((await getPaymentReport('1', getRemotePool)).status).toBe('READY');
  expect(getRemotePool).not.toHaveBeenCalled();
  expect(checkLiquidationChanges).toHaveBeenLastCalledWith(null, expect.objectContaining(data.saved));
});

test('validates original cent allocation and frozen taxes for 23 medical services', () => {
  const { build } = fixture({ count: 23, base: 214.5, vatRate: 0.16 });
  const report = build();
  expect(report.status).toBe('READY');
  expect(report.totals).toEqual({ base: 4933.5, vat: 789.36, isr: 61.67, vatWithholding: 526.24,
    net: 5134.95, adjustments: 0, paid: 0, balance: 5134.95, payable: 5134.95 });
  expect(report.doctors[0].lines.filter(line => line.isr === 2.69)).toHaveLength(3);
});

test('fractional quantity uses the same rounded preview amount stored in the approval', () => {
  const { saved, build } = fixture({ quantity: 0.03, unitAmount: 33.5, base: 1.01, exempt: true });
  expect(build().totals.net).toBe(1.01);
  saved.snapshot.lines[0].baseAmount = 1;
  expect(() => build()).toThrow('la cantidad y la tarifa no coinciden');
});

test('validates the exact decimal product rather than the binary multiplication result', () => {
  for (const [unitAmount, quantity, base] of [[2.3, 0.95, 2.19], [2.5, 0.87, 2.18], [2.65, 0.9, 2.39]]) {
    const { build } = fixture({ unitAmount, quantity, base, exempt: true });
    expect(build().totals.base).toBe(base);
  }
});

test('groups homonymous doctors by ID and never compensates one doctor credit against another payment', () => {
  const { build } = fixture({ count: 2, physicianIds: [7, 8], exempt: true });
  const report = build([movement({ amount: 100 })], [movement({ amount: -50 })]);
  expect(report.doctors.map(doctor => doctor.providerId)).toEqual([7, 8]);
  expect(report.doctors.map(doctor => doctor.totals.balance)).toEqual([-50, 100]);
  expect(report.status).toBe('REVIEW_REQUIRED'); expect(report.totals.balance).toBe(50);
  expect(report.totals.payable).toBe(0);
  expect(report.doctors.every(doctor => doctor.totals.payable === 0)).toBe(true);
  expect(report.issues[0]).toMatchObject({ code: 'NEGATIVE_BALANCE', rowId: 'BI|SOLN|1|ORDEN' });
});

test('subtracts recorded payments and applies signed adjustments without recalculating the closed net', () => {
  const { build } = fixture({ exempt: true });
  const partial = build([movement()], [movement({ amount: -10 })]);
  expect(partial.status).toBe('READY');
  expect(partial.totals).toMatchObject({ net: 100, adjustments: -10, paid: 40, balance: 50, payable: 50 });
  expect(partial.doctors[0].lines[0]).toMatchObject({ netAmount: 100, paidAmount: 40, adjustmentAmount: -10, balance: 50 });
  const paid = build([movement({ amount: 90 })], [movement({ amount: -10 })]);
  expect(paid.status).toBe('PAID'); expect(paid.totals.payable).toBe(0);
  const changed = build([], [], [{ code: 'CLINICAL_SOURCE_CHANGED', rowId: 'BI|SOLN|1|ORDEN', reason: 'La atención cambió' }]);
  expect(changed.status).toBe('REVIEW_REQUIRED'); expect(changed.totals.payable).toBe(0);
});

test('rejects orphan, duplicated or incomplete ledger entries and excess monetary precision', () => {
  const { build } = fixture({ exempt: true });
  for (const entry of [movement({ row_id: 'missing' }), movement({ liquidation_id: '2' }),
    movement({ amount: '1.005' }), movement({ amount: '-1.00' }), movement({ reference: '' }), movement({ created_by: null })]) {
    expect(() => build([entry])).toThrow('No se puede preparar el PDF para pago');
  }
  expect(() => build([movement(), movement()])).toThrow('repetido');
  expect(() => build([movement(), movement({ id: '2' })])).toThrow('referencia');
  expect(() => build([], [movement({ amount: -1.005 })])).toThrow('centavos');
});

test('rejects changed totals, duplicate services, incomplete fiscal data and altered cent allocation', () => {
  for (const mutate of [
    data => { data.saved.snapshot.totalNet += 0.01; },
    data => { data.saved.snapshot.lines.push(structuredClone(data.saved.snapshot.lines[0])); },
    data => { data.saved.snapshot.lines[0].fiscalSnapshot = null; },
    data => { data.saved.snapshot.lines[0].providerId = null; },
    data => { data.saved.snapshot.lines[0].netAmount += 0.01; }
  ]) {
    const data = fixture(); mutate(data);
    expect(() => data.build()).toThrow('No se puede preparar el PDF para pago');
  }
  const allocation = fixture({ count: 23, base: 214.5, vatRate: 0.16 });
  const first = allocation.saved.snapshot.lines.find(line => line.isr === 2.69);
  const second = allocation.saved.snapshot.lines.find(line => line.isr === 2.68);
  first.isr = 2.68; first.netAmount = Math.round((first.netAmount + 0.01) * 100) / 100;
  second.isr = 2.69; second.netAmount = Math.round((second.netAmount - 0.01) * 100) / 100;
  expect(() => allocation.build()).toThrow('distribución de centavos');
});

test('requires matching finalized snapshots, not only internally matching header totals', () => {
  const data = fixture();
  const finalized = data.finalized(); finalized[0].snapshot.baseAmount += 0.01;
  expect(() => buildPaymentReport(data.saved, [], [], finalized)).toThrow('detalle confirmado');
  expect(() => buildPaymentReport(data.saved, [], [], [])).toThrow('servicios confirmados');
});

test('reads the whole ledger in one repeatable read transaction and blocks payment when clinical validation is unavailable', async () => {
  const data = fixture({ exempt: true });
  const query = jest.fn(async sql => ({ rows: sql.includes('FROM bi_honorarios_liquidations')
    ? [{ ...data.saved, report_generated_at: '2026-10-02T12:00:00.000Z' }]
    : sql.includes('FROM bi_honorarios_finalized_rows') ? data.finalized() : [] }));
  const release = jest.fn();
  getDb.mockReturnValue({ pool: { connect: async () => ({ query, release }) } });
  checkLiquidationChanges.mockRejectedValueOnce(new Error('offline'));
  const report = await getPaymentReport('1', async () => ({}));
  expect(query.mock.calls[0][0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  expect(query.mock.calls.at(-1)[0]).toBe('COMMIT'); expect(release).toHaveBeenCalledTimes(1);
  expect(report.status).toBe('REVIEW_REQUIRED'); expect(report.totals.payable).toBe(0);
  expect(report.issues[0].code).toBe('CLINICAL_CHECK_UNAVAILABLE');
  expect(report.generatedAt).toBe('2026-10-02T12:00:00.000Z');
});

