'use strict';

// Aritmética con datos ficticios. No abre conexiones ni consulta proveedores.
jest.mock('../config/db', () => ({ getDb: () => ({ pool: mockPool }) }));
jest.mock('../services/honorariosReview.service', () => ({ ensureTables: jest.fn(async () => {}), canReview: () => true }));
jest.mock('../services/honorariosWorkflow.service', () => ({ getPeriodCandidates: jest.fn(), validatePeriod: jest.fn() }));
jest.mock('../services/honorariosSapReconciliation.service', () => ({ reconcileHonorariosWithSap: jest.fn() }));
jest.mock('../services/honorariosCoverage.service', () => ({ getClinicalProviderDirectory: jest.fn() }));

const mockPool = { query: jest.fn() };
const { fiscalProfile, priceApprovedSnapshots } = require('../utils/honorariosFiscal');
const { getLiquidation } = require('../services/honorariosLiquidation.service');

const tax = (estimateRule, rate) => ({ estimateRule, rate, inactive: false,
  appliesAt: 'factura', codeEffectiveFrom: '2026-01-01' });
const provider = (isr = 10) => ({ linkStatus: 'candidato_unico', candidates: [{
  cardCode: `P-${isr}`, federalTaxId: 'AAAA800101AAA', subjectToWithholding: isr !== 0,
  configuredWithholdings: isr === 0 ? [] : [tax('isr_on_fee', isr), tax('vat_two_thirds', 10.66)]
}] });
const review = (rowId, baseAmount, vatRate, providerId = 7, providerName = 'MÉDICO FICTICIO') => ({
  rowId, revision: 1, vatRate, reviewer: 'REVISOR FICTICIO', fingerprint: `source-${rowId}`,
  snapshot: { rowId, providerId, providerName, serviceDate: '2026-10-02', baseAmount }
});
const cents = value => Math.round(value * 100);
const total = (lines, field) => lines.reduce((sum, line) => sum + cents(line[field]), 0);
// Oráculo entero: evita repetir el algoritmo de asignación de centavos del servicio.
const roundRatio = (numerator, denominator) => Number((BigInt(numerator) * 2n + BigInt(denominator)) / (BigInt(denominator) * 2n));

describe.each([0, 1.25, 10])('retención ISR configurada %s%%', isr => {
  test.each([0, 0.08, 0.16])('conserva cada centavo en 23 servicios con IVA %s', vatRate => {
    const baseCents = [1, 5, 40, 101, 22500, 3333, 9999];
    const reviews = Array.from({ length: 23 }, (_, index) => review(`S-${String(index).padStart(2, '0')}`,
      baseCents[index % baseCents.length] / 100, vatRate));
    const profile = provider(isr);
    const original = JSON.stringify({ reviews, profile });
    const lines = priceApprovedSnapshots(reviews, { 'MÉDICO FICTICIO': profile });
    const expectedBase = reviews.reduce((sum, item) => sum + cents(item.snapshot.baseAmount), 0);
    const expectedVat = reviews.reduce((sum, item) => sum
      + roundRatio(cents(item.snapshot.baseAmount) * Math.round(vatRate * 10000), 10000), 0);
    const expectedIsr = roundRatio(expectedBase * Math.round(isr * 100), 10000);
    const expectedVatWithholding = isr === 0 ? 0 : roundRatio(expectedVat * 2, 3);
    expect(total(lines, 'baseAmount')).toBe(expectedBase);
    expect(total(lines, 'vat')).toBe(expectedVat);
    expect(total(lines, 'isr')).toBe(expectedIsr);
    expect(total(lines, 'vatWithholding')).toBe(expectedVatWithholding);
    expect(total(lines, 'netAmount')).toBe(expectedBase + expectedVat - expectedIsr - expectedVatWithholding);
    lines.forEach(line => expect(cents(line.netAmount)).toBe(cents(line.baseAmount) + cents(line.vat)
      - cents(line.isr) - cents(line.vatWithholding)));
    const reversed = priceApprovedSnapshots([...reviews].reverse(), { 'MÉDICO FICTICIO': profile });
    const byId = new Map(reversed.map(line => [line.rowId, line]));
    lines.forEach(line => {
      expect(byId.get(line.rowId).isr).toBe(line.isr);
      expect(byId.get(line.rowId).vatWithholding).toBe(line.vatWithholding);
      expect(byId.get(line.rowId).netAmount).toBe(line.netAmount);
    });
    expect(JSON.stringify({ reviews, profile })).toBe(original);
  });
});

test('23 consultas de 225 conservan el total esperado sin usar importes de facturas', () => {
  const reviews = Array.from({ length: 23 }, (_, index) => review(`S-${index}`, 225, 0.16));
  const profile = { ...provider(), invoices: [{ documentTotal: 999999.99 }] };
  const lines = priceApprovedSnapshots(reviews, { 'MÉDICO FICTICIO': profile });
  expect(['baseAmount', 'vat', 'isr', 'vatWithholding', 'netAmount'].map(field => total(lines, field) / 100))
    .toEqual([5175, 828, 517.5, 552, 4933.5]);
});

describe.each([0, 1.25, 10])('importes cercanos al máximo permitido con ISR %s%%', isr => {
  test.each([0, 0.08, 0.16])('no pierde centavos en 23 servicios con IVA %s', vatRate => {
    const reviews = Array.from({ length: 23 }, (_, index) => review(`MAX-${String(index).padStart(2, '0')}`,
      (100000000000 - ((index * 7 + 19) % 1000)) / 100, vatRate));
    const profiles = { 'MÉDICO FICTICIO': provider(isr) };
    const lines = priceApprovedSnapshots(reviews, profiles);
    const expectedBase = reviews.reduce((sum, item) => sum + cents(item.snapshot.baseAmount), 0);
    const expectedVat = reviews.reduce((sum, item) => sum
      + roundRatio(cents(item.snapshot.baseAmount) * Math.round(vatRate * 10000), 10000), 0);
    const expectedIsr = roundRatio(expectedBase * Math.round(isr * 100), 10000);
    const expectedVatWithholding = isr === 0 ? 0 : roundRatio(expectedVat * 2, 3);
    expect(total(lines, 'vat')).toBe(expectedVat);
    expect(total(lines, 'isr')).toBe(expectedIsr);
    expect(total(lines, 'vatWithholding')).toBe(expectedVatWithholding);
    expect(total(lines, 'netAmount')).toBe(expectedBase + expectedVat - expectedIsr - expectedVatWithholding);
    const reversed = new Map(priceApprovedSnapshots([...reviews].reverse(), profiles).map(line => [line.rowId, line]));
    lines.forEach(line => expect([line.isr, line.vatWithholding, line.netAmount])
      .toEqual([reversed.get(line.rowId).isr, reversed.get(line.rowId).vatWithholding, reversed.get(line.rowId).netAmount]));
  });
});

test('conserva la base confirmada de 1.01 obtenida de una tarifa fraccionada', () => {
  const snapshot = { ...review('FRACCION', 1.01, 0.16),
    snapshot: { ...review('FRACCION', 1.01, 0.16).snapshot, quantity: 0.03, unitAmount: 33.5 } };
  const [line] = priceApprovedSnapshots([snapshot], { 'MÉDICO FICTICIO': provider() });
  expect([line.baseAmount, line.vat, line.isr, line.vatWithholding, line.netAmount]).toEqual([1.01, 0.16, 0.10, 0.11, 0.96]);
});

test('redondea de forma independiente por médico, aunque los nombres coincidan', () => {
  const lines = priceApprovedSnapshots([review('A', 0.05, 0, 7), review('B', 0.05, 0, 8)], { 'MÉDICO FICTICIO': provider() });
  expect(lines.map(line => line.isr)).toEqual([0.01, 0.01]);
  expect(total(lines, 'netAmount')).toBe(8);
});

test('tasas diferentes de médicos distintos no alteran los importes del otro médico', () => {
  const inputs = [review('A', 1000, 0.16, 7, 'MÉDICO A'), review('B', 1000, 0.08, 8, 'MÉDICO B'),
    review('C', 1000, 0, 9, 'MÉDICO C')];
  const profiles = { 'MÉDICO A': provider(10), 'MÉDICO B': provider(1.25), 'MÉDICO C': provider(0) };
  const together = priceApprovedSnapshots(inputs, profiles);
  together.forEach((line, index) => expect(line).toEqual(priceApprovedSnapshots([inputs[index]], profiles)[0]));
  expect(together.map(line => line.netAmount)).toEqual([953.33, 1014.17, 1000]);
});

test('sin perfil fiscal completo o sin IVA confirmado no produce un importe pagable', () => {
  const inputs = [review('A', 225, 0.16)];
  expect(() => priceApprovedSnapshots(inputs, {})).toThrow('Completa los datos fiscales');
  expect(() => priceApprovedSnapshots([{ ...inputs[0], vatRate: null }], { 'MÉDICO FICTICIO': provider() })).toThrow('Confirma el IVA');
  const incomplete = provider();
  incomplete.candidates[0].configuredWithholdings = [tax('isr_on_fee', 10)];
  expect(fiscalProfile(incomplete, '2026-10-02', true)).toBeNull();
  expect(() => priceApprovedSnapshots(inputs, { 'MÉDICO FICTICIO': incomplete })).toThrow('Completa los datos fiscales');
  expect(fiscalProfile(provider(), '2025-12-31', true)).toBeNull();
});

test('pagos parciales y ajustes cambian el saldo sin recalcular los netos congelados', async () => {
  const stored = { id: '13', snapshot: { currency: 'MXN', totalBase: 226.01, totalNet: 215.46,
    lines: [{ rowId: 'A', baseAmount: 1.01, vat: 0.16, isr: 0.10, vatWithholding: 0.11, netAmount: 0.96 },
      { rowId: 'B', baseAmount: 225, vat: 36, isr: 22.5, vatWithholding: 24, netAmount: 214.5 }] } };
  const original = JSON.stringify(stored);
  const payments = [{ row_id: 'A', amount: '0.01' }, { row_id: 'A', amount: '0.02' },
    { row_id: 'B', amount: '100.00' }, { row_id: 'B', amount: '50.00' }];
  const adjustments = [{ row_id: 'A', amount: '0.04' }, { row_id: 'A', amount: '-0.01' }, { row_id: 'B', amount: '-65.00' }];
  mockPool.query.mockImplementation(async sql => ({ rows: /SELECT \* FROM bi_honorarios_liquidations WHERE/.test(sql) ? [stored]
    : /SELECT \* FROM bi_honorarios_payment_applications/.test(sql) ? payments
      : /SELECT \* FROM bi_honorarios_liquidation_adjustments/.test(sql) ? adjustments : [] }));
  const result = await getLiquidation(13);
  expect(result.lines.map(line => [line.netAmount, line.paidAmount, line.adjustmentAmount, line.balance]))
    .toEqual([[0.96, 0.03, 0.03, 0.96], [214.5, 150, -65, -0.5]]);
  expect(result.totalPaid).toBe(150.03);
  expect(result.balance).toBe(0.46); // Saldo firmado; no equivale por sí solo a un pago autorizado.
  expect(result.snapshot.totalNet).toBe(215.46);
  expect(JSON.stringify(stored)).toBe(original);
});
