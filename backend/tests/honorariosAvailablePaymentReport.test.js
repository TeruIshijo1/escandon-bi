'use strict';

jest.mock('../config/db', () => ({ getDb: jest.fn() }));
jest.mock('../services/honorariosReview.service', () => ({ readReviews: jest.fn(), saveReview: jest.fn(), ensureTables: jest.fn() }));
jest.mock('../services/honorariosWorkflow.service', () => ({ getPeriodCandidates: jest.fn(),
  validatePeriod: jest.requireActual('../services/honorariosWorkflow.service').validatePeriod }));
jest.mock('../services/honorariosMonthlyFixed.service', () => ({
  ...jest.requireActual('../services/honorariosMonthlyFixed.service'), readMonthlyReviews: jest.fn(), saveDecision: jest.fn()
}));
jest.mock('../services/honorariosFiscalProfile.service', () => ({ readProfiles: jest.fn(), saveProfile: jest.fn() }));
jest.mock('../services/sap.service', () => ({ get: jest.fn(), post: jest.fn() }));
const { getDb } = require('../config/db');
const workflow = require('../services/honorariosWorkflow.service');
const reviews = require('../services/honorariosReview.service');
const monthly = require('../services/honorariosMonthlyFixed.service');
const profiles = require('../services/honorariosFiscalProfile.service');
const sap = require('../services/sap.service');
const { reviewFingerprint } = require('../utils/honorariosReviewSource');
const { priceApprovedSnapshots } = require('../utils/honorariosFiscal');
const { getAvailablePaymentReport } = require('../services/honorariosAvailablePaymentReport.service');
const input = { startDate: '2026-09-01', endDate: '2026-09-30', providerId: 7 };
const clinicalRow = (index = 1, providerId = 7, amount = 225, changes = {}) => ({
  SourceIdentity: `BI|SOLN|${index}|TRATANTE`, ModeBI: true, SourceType: 'SOLN', SourceLineId: index,
  SourceFingerprint: `clinical-${index}`, FechaAtencion: '2026-09-16', MedicoId: providerId,
  Medico: `MEDICO ${providerId}`, RolMedico: 'TRATANTE', CodigoServicio: 'SER0616', Servicio: 'Consulta',
  CatalogApproved: true, CatalogSnapshot: { itemCode: 'SER0616', status: 'INCLUIDO', revision: 1 },
  ReviewEligible: true, TariffSnapshot: { id: 11, revision: 1, amount }, Cantidad: 1, CantidadMaxima: 1,
  BaseImporte: amount, ...changes
});
const approval = (row, snapshotChanges = {}) => {
  const beneficiary = row.ReviewBeneficiary || { providerId: row.MedicoId, providerName: row.Medico, role: row.RolMedico };
  const tariff = row.ReviewEligibilityTariff || row.TariffSnapshot;
  const snapshot = { rowId: row.SourceIdentity, sourceType: row.SourceType, sourceLineId: row.SourceLineId,
    sourceFingerprint: row.SourceFingerprint, serviceDate: row.FechaAtencion, itemCode: row.CodigoServicio,
    description: row.Servicio, providerId: beneficiary.providerId, providerName: beneficiary.providerName,
    role: beneficiary.role, quantity: 1, unitAmount: tariff.amount, baseAmount: tariff.amount,
    catalog: row.CatalogSnapshot, tariff, ...snapshotChanges };
  return { action: 'APROBAR', sourceType: 'BI_PRESTACION', revision: 2, reviewer: '1: REVISOR',
    motivo: 'Servicio aprobado', fingerprint: reviewFingerprint(row), vatRate: .16,
    providerId: snapshot.providerId, quantity: snapshot.quantity, customAmount: snapshot.baseAmount, snapshot };
};
const profile = (id = 7, changes = {}) => ({ source: 'BI_INTERNO', providerId: String(id), providerName: `MEDICO ${id}`,
  enabled: true, confirmed: true, federalTaxId: 'AAAA800101AAA', fiscalRegime: '612', validFrom: '2026-01-01',
  isrRate: .1, vatFraction: 2 / 3, defaultVatRate: .16, revision: 1, ...changes });
let query, connect, currentRows, currentReviews;

beforeEach(() => {
  jest.clearAllMocks();
  currentRows = [clinicalRow()];
  currentReviews = { [currentRows[0].SourceIdentity]: approval(currentRows[0]) };
  workflow.getPeriodCandidates.mockImplementation(async () => ({ rows: currentRows }));
  reviews.readReviews.mockImplementation(async () => currentReviews);
  monthly.readMonthlyReviews.mockResolvedValue({});
  profiles.readProfiles.mockResolvedValue({});
  query = jest.fn(async sql => {
    if (!sql.startsWith('SELECT row_id FROM bi_honorarios_finalized_rows')) throw new Error('Unexpected write or read');
    return { rows: [] };
  });
  connect = jest.fn();
  getDb.mockReturnValue({ pool: { query, connect } });
});

afterEach(() => {
  expect(sap.get).not.toHaveBeenCalled();
  expect(sap.post).not.toHaveBeenCalled();
  expect(connect).not.toHaveBeenCalled();
  expect(reviews.saveReview).not.toHaveBeenCalled();
  expect(monthly.saveDecision).not.toHaveBeenCalled();
  expect(profiles.saveProfile).not.toHaveBeenCalled();
  expect(query.mock.calls.every(([sql]) => /^SELECT\s/i.test(sql) && !/FOR UPDATE|pg_advisory|INSERT|UPDATE|DELETE/i.test(sql))).toBe(true);
});

test('missing fiscal information still returns approved amounts and VAT with unknown taxes and no invented balance', async () => {
  const before = JSON.stringify({ currentRows, currentReviews });
  const report = await getAvailablePaymentReport({}, input);
  expect(report).toMatchObject({ version: 1, status: 'FISCAL_PENDING', currency: 'MXN', period: {
    startDate: input.startDate, endDate: input.endDate }, totals: { base: 225, vat: 36, isr: null, vatWithholding: null, net: null } });
  expect(Number.isFinite(Date.parse(report.generatedAt))).toBe(true);
  expect(report.doctors[0]).toMatchObject({ providerId: 7, providerName: 'MEDICO 7',
    fiscal: { federalTaxId: null, fiscalRegime: null, ready: false }, lines: [{
      rowId: currentRows[0].SourceIdentity, quantity: 1, unitAmount: 225, baseAmount: 225,
      vatRate: .16, vat: 36, isr: null, vatWithholding: null, netAmount: null
    }] });
  expect(JSON.stringify({ currentRows, currentReviews })).toBe(before);
  expect(JSON.stringify(report)).not.toMatch(/liquidationId|balance|payable|paidAmount/);
  expect(workflow.getPeriodCandidates).toHaveBeenCalledWith({}, input.startDate, input.endDate, { includeUnconfigured: true });
});

test('a complete internal profile uses existing group allocation and preserves every cent for 23 consultations', async () => {
  currentRows = Array.from({ length: 23 }, (_, index) => clinicalRow(index + 1));
  currentReviews = Object.fromEntries(currentRows.map(row => [row.SourceIdentity, approval(row)]));
  const internal = { 7: profile() };
  profiles.readProfiles.mockResolvedValue(internal);
  const before = JSON.stringify({ currentRows, currentReviews, internal });
  const expected = priceApprovedSnapshots(Object.values(currentReviews), {}, internal);
  const report = await getAvailablePaymentReport({}, input);
  expect(report.status).toBe('AVAILABLE');
  expect(report.doctors[0].fiscal).toEqual({ federalTaxId: 'AAAA800101AAA', fiscalRegime: '612', ready: true });
  expect(report.totals).toEqual({ base: 5175, vat: 828, isr: 517.5, vatWithholding: 552, net: 4933.5 });
  const expectedById = new Map(expected.map(line => [line.rowId, line]));
  for (const line of report.doctors[0].lines) expect(line).toMatchObject({
    isr: expectedById.get(line.rowId).isr, vatWithholding: expectedById.get(line.rowId).vatWithholding,
    netAmount: expectedById.get(line.rowId).netAmount
  });
  expect(JSON.stringify({ currentRows, currentReviews, internal })).toBe(before);
});

test.each([{ confirmed: false }, { enabled: false }, { federalTaxId: '' }, { validFrom: '2026-10-01' }, { validFrom: '2026-02-30' },
  { providerId: '8' }, { revision: 0 }])('an incomplete or mismatched profile remains optional: %p', async changes => {
  profiles.readProfiles.mockResolvedValue({ 7: profile(7, changes) });
  const report = await getAvailablePaymentReport({}, input);
  expect(report.status).toBe('FISCAL_PENDING');
  expect(report.doctors[0].fiscal.ready).toBe(false);
  expect(report.totals.isr).toBeNull();
  if (changes.providerId) expect(report.doctors[0].fiscal.federalTaxId).toBeNull();
  else expect(report.doctors[0].fiscal.fiscalRegime).toBe('612');
});

test('mixed physicians and historical validity keep known totals without summing a partial net as the total', async () => {
  currentRows = [clinicalRow(1, 7), clinicalRow(2, 8), clinicalRow(3, 7, 225, { FechaAtencion: '2026-09-01' })];
  currentReviews = Object.fromEntries(currentRows.map(row => [row.SourceIdentity, approval(row)]));
  profiles.readProfiles.mockResolvedValue({ 7: profile(7, { validFrom: '2026-09-15' }), 8: profile(8, { isrRate: 0, vatFraction: 0 }) });
  const report = await getAvailablePaymentReport({}, { ...input, providerId: 0 });
  expect(report.status).toBe('FISCAL_PENDING');
  expect(report.totals).toEqual({ base: 675, vat: 108, isr: null, vatWithholding: null, net: null });
  expect(report.doctors[0].fiscal.ready).toBe(false);
  expect(report.doctors[0].totals.net).toBeNull();
  expect(report.doctors[1]).toMatchObject({ fiscal: { ready: true }, totals: { base: 225, vat: 36, isr: 0, vatWithholding: 0, net: 261 } });
  const onlyEight = await getAvailablePaymentReport({}, { ...input, providerId: '8' });
  expect(onlyEight.status).toBe('AVAILABLE');
  expect(onlyEight.doctors).toHaveLength(1);
  expect(onlyEight.doctors[0].providerId).toBe(8);
});

test('a saved physician correction uses ReviewBeneficiary instead of charging the physician from the source', async () => {
  currentRows = [clinicalRow(1, 7, 225, { ReviewBeneficiary: { providerId: 8, providerName: 'MEDICO 8', role: 'TRATANTE' },
    ReviewEligibilityTariff: { id: 12, revision: 2, amount: 300 } })];
  currentReviews = { [currentRows[0].SourceIdentity]: approval(currentRows[0]) };
  const report = await getAvailablePaymentReport({}, { ...input, providerId: 8 });
  expect(report.doctors[0]).toMatchObject({ providerId: 8, providerName: 'MEDICO 8', totals: { base: 300 } });
  await expect(getAvailablePaymentReport({}, input)).rejects.toMatchObject({ status: 400 });
});

test('pending VAT rounds an authorized fractional quantity exactly and preserves an explicitly approved zero', async () => {
  currentRows = [clinicalRow(1, 7, 33.5, { Cantidad: .03, CantidadMaxima: .03 })];
  const approved = approval(currentRows[0], { quantity: .03, baseAmount: 1.01 });
  approved.vatRate = 0;
  currentReviews = { [currentRows[0].SourceIdentity]: approved };
  const report = await getAvailablePaymentReport({}, input);
  expect(report.totals).toEqual({ base: 1.01, vat: 0, isr: null, vatWithholding: null, net: null });
  expect(report.doctors[0].lines[0]).toMatchObject({ quantity: .03, unitAmount: 33.5, vatRate: 0, vat: 0 });
});

test.each(['source', 'tariff', 'beneficiary', 'base', 'vat', 'quantity'])('changed or malformed %s blocks the report instead of inventing an approved payment', async kind => {
  if (kind === 'source') currentRows[0].SourceFingerprint = 'changed';
  if (kind === 'tariff') currentRows[0].ReviewInvalidated = true;
  if (kind === 'beneficiary') currentRows[0].ReviewBeneficiary = { providerId: 8, providerName: 'MEDICO 8', role: 'TRATANTE' };
  if (kind === 'base') currentReviews[currentRows[0].SourceIdentity].snapshot.baseAmount = 999;
  if (kind === 'vat') currentReviews[currentRows[0].SourceIdentity].vatRate = null;
  if (kind === 'quantity') currentReviews[currentRows[0].SourceIdentity].snapshot.quantity = 2;
  await expect(getAvailablePaymentReport({}, input)).rejects.toMatchObject({ status: 409 });
});

test('an open approval missing from current sources fails while a finalized missing source is excluded', async () => {
  const missing = clinicalRow(2), missingReview = approval(missing);
  currentReviews[missing.SourceIdentity] = missingReview;
  await expect(getAvailablePaymentReport({}, input)).rejects.toMatchObject({ status: 409 });
  query.mockResolvedValueOnce({ rows: [{ row_id: missing.SourceIdentity }] });
  const report = await getAvailablePaymentReport({}, input);
  expect(report.doctors[0].lines).toHaveLength(1);
});

test('rejected, pending and already finalized approvals are not included', async () => {
  currentRows.push(clinicalRow(2), clinicalRow(3), clinicalRow(4, 7, 225, { LiquidacionCerrada: 9 }));
  currentReviews[currentRows[1].SourceIdentity] = { ...approval(currentRows[1]), action: 'EXCLUIR' };
  currentReviews[currentRows[2].SourceIdentity] = { ...approval(currentRows[2]), action: 'PENDIENTE' };
  currentReviews[currentRows[3].SourceIdentity] = approval(currentRows[3]);
  const report = await getAvailablePaymentReport({}, input);
  expect(report.doctors[0].lines).toHaveLength(1);
  query.mockResolvedValueOnce({ rows: [{ row_id: currentRows[0].SourceIdentity }] });
  await expect(getAvailablePaymentReport({}, input)).rejects.toMatchObject({ status: 400 });
});

test('an approved fixed payment is available in a partial month but changed configuration is blocked', async () => {
  const fixed = { assignmentId: 4, providerId: 7, providerName: 'MEDICO 7', amount: 1000, month: '2026-09', revision: 1 };
  const row = { SourceIdentity: 'FIXED|7|2026-09', ModeBI: true, FixedMonthly: true, FechaAtencion: '2026-09-01',
    FixedMonthlySnapshot: fixed, SourceFingerprint: monthly.fixedFingerprint(fixed) };
  const approved = { action: 'APROBAR', sourceType: 'BI_FIJO_MENSUAL', revision: 2, reviewer: '1: REVISOR',
    motivo: 'Se incluye este mes', vatRate: .16, fingerprint: reviewFingerprint(row), snapshot: {
      rowId: row.SourceIdentity, sourceType: 'BI_FIJO_MENSUAL', FixedMonthly: true, sourceFingerprint: row.SourceFingerprint,
      fixed, serviceDate: '2026-09-01', month: '2026-09', providerId: 7, providerName: 'MEDICO 7',
      description: 'Pago fijo mensual', quantity: 1, unitAmount: 1000, baseAmount: 1000
    } };
  currentRows = [row]; currentReviews = {};
  monthly.readMonthlyReviews.mockResolvedValue({ [row.SourceIdentity]: approved });
  const report = await getAvailablePaymentReport({}, { ...input, startDate: '2026-09-15', endDate: '2026-09-20' });
  expect(report.totals).toMatchObject({ base: 1000, vat: 160, net: null });
  approved.snapshot = { ...approved.snapshot, fixed: { ...fixed, revision: 2 } };
  await expect(getAvailablePaymentReport({}, input)).rejects.toMatchObject({ status: 409 });
});

test.each(['sources', 'reviews', 'monthly', 'profiles', 'finalized'])('failure reading %s never falls back to a fabricated PDF', async source => {
  const failure = new Error('Read unavailable');
  if (source === 'sources') workflow.getPeriodCandidates.mockRejectedValueOnce(failure);
  if (source === 'reviews') reviews.readReviews.mockRejectedValueOnce(failure);
  if (source === 'monthly') monthly.readMonthlyReviews.mockRejectedValueOnce(failure);
  if (source === 'profiles') profiles.readProfiles.mockRejectedValueOnce(failure);
  if (source === 'finalized') query.mockRejectedValueOnce(failure);
  await expect(getAvailablePaymentReport({}, input)).rejects.toBe(failure);
});

test.each([{ startDate: '2026-02-30' }, { endDate: '2026-08-01' }, { providerId: -1 }, { providerId: true }])(
  'invalid period or provider is rejected before reads: %p', async changes => {
    await expect(getAvailablePaymentReport({}, { ...input, ...changes })).rejects.toMatchObject({ status: 400 });
    expect(workflow.getPeriodCandidates).not.toHaveBeenCalled();
    expect(reviews.readReviews).not.toHaveBeenCalled();
    expect(profiles.readProfiles).not.toHaveBeenCalled();
  });
