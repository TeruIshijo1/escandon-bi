'use strict';

jest.mock('../config/db', () => ({ getDb: jest.fn() }));
jest.mock('../services/honorariosReview.service', () => ({ canReview: jest.fn(() => true),
  ensureTables: jest.fn(async () => {}), readReviews: jest.fn(async () => ({})) }));
jest.mock('../services/honorariosWorkflow.service', () => ({ getPeriodCandidates: jest.fn(),
  validatePeriod: jest.fn() }));
jest.mock('../services/honorariosMonthlyFixed.service', () => ({ readMonthlyReviews: jest.fn(async () => ({})),
  lockAndValidateRows: jest.fn(async () => {}), fixedFingerprint: jest.fn(() => 'monthly-source') }));
jest.mock('../services/honorariosFiscalProfile.service', () => ({ readProfiles: jest.fn() }));
jest.mock('../services/honorariosSapReconciliation.service', () => ({ reconcileHonorariosWithSap: jest.fn() }));
jest.mock('../services/honorariosCoverage.service', () => ({ getClinicalProviderDirectory: jest.fn() }));
jest.mock('../services/honorariosSources.service', () => ({ getHonorariosCandidates: jest.fn() }));
const { getDb } = require('../config/db');
const workflow = require('../services/honorariosWorkflow.service');
const reviews = require('../services/honorariosReview.service');
const monthly = require('../services/honorariosMonthlyFixed.service');
const profiles = require('../services/honorariosFiscalProfile.service');
const sources = require('../services/honorariosSources.service');
const { closeLiquidation, checkLiquidationChanges } = require('../services/honorariosLiquidation.service');
const { reviewFingerprint } = require('../utils/honorariosReviewSource');
const user = { id: 1, nombre: 'Revisor de prueba' };
const input = { startDate: '2026-09-15', endDate: '2026-09-20', providerId: 7,
  confirmed: true, reason: 'Cierre del mes confirmado' };
const fixedRow = () => ({ SourceIdentity: 'FIXED|7|2026-09', ModeBI: true, FixedMonthly: true,
  FechaAtencion: '2026-09-01', MedicoId: 7, Medico: 'MEDICO', Cantidad: 1, BaseImporte: 1000,
  FixedMonthlySnapshot: { assignmentId: 4, revision: 1, providerId: 7, providerName: 'MEDICO',
    month: '2026-09', amount: 1000 }, SourceFingerprint: 'monthly-source' });
const fixedApproval = row => ({ action: 'APROBAR', sourceType: 'BI_FIJO_MENSUAL', revision: 2,
  reviewer: '1: Revisor', motivo: 'Se incluye este mes', vatRate: 0.16, fingerprint: reviewFingerprint(row),
  snapshot: { rowId: row.SourceIdentity, FixedMonthly: true, sourceType: 'BI_FIJO_MENSUAL',
    itemCode: 'BI_FIJO_MENSUAL', sourceFingerprint: row.SourceFingerprint, fixed: row.FixedMonthlySnapshot,
    providerId: 7, providerName: 'MEDICO', description: 'Pago fijo mensual de jefatura',
    serviceDate: '2026-09-01', month: '2026-09', quantity: 1, unitAmount: 1000, baseAmount: 1000, role: 'JEFE_AREA' } });
let query, release, saved, reviewRevision, finalized;

beforeEach(() => {
  jest.clearAllMocks();
  reviews.canReview.mockReturnValue(true);
  reviewRevision = 2; finalized = [];
  workflow.getPeriodCandidates.mockResolvedValue({ rows: [fixedRow()] });
  reviews.readReviews.mockResolvedValue({});
  monthly.readMonthlyReviews.mockResolvedValue({ [fixedRow().SourceIdentity]: fixedApproval(fixedRow()) });
  monthly.lockAndValidateRows.mockReset().mockResolvedValue(undefined);
  profiles.readProfiles.mockResolvedValue({ 7: { source: 'BI_INTERNO', providerId: '7', providerName: 'MEDICO',
    enabled: true, confirmed: true, federalTaxId: 'AAAA800101AAA', fiscalRegime: '612', validFrom: '2026-01-01',
    isrRate: 0.0125, vatFraction: 2 / 3, defaultVatRate: 0.16, revision: 1 } });
  release = jest.fn();
  saved = { id: 9, start_date: input.startDate, end_date: input.endDate };
  query = jest.fn(async (sql, params) => {
    if (sql.startsWith('INSERT INTO bi_honorarios_liquidations')) { saved.snapshot = params[4]; return { rows: [{ id: 9 }] }; }
    if (sql.includes('SELECT revision FROM bi_honorarios_fiscal_profiles')) return { rows: [{ revision: 1 }] };
    if (sql.includes('SELECT revision FROM bi_honorarios_reviews')) return { rows: [{ revision: reviewRevision }] };
    if (sql.includes('FROM bi_honorarios_catalog')) return { rows: [{ revision: 1, status: 'INCLUIDO', source_active: true, scope_excluded: false }] };
    if (sql.includes('FROM bi_honorarios_tariffs')) return { rows: [{ revision: 1, active: true }] };
    if (sql.includes('SELECT liquidation_id FROM bi_honorarios_finalized_rows')) return { rows: finalized };
    if (sql.includes('SELECT * FROM bi_honorarios_liquidations')) return { rows: [saved] };
    return { rows: [] };
  });
  getDb.mockReturnValue({ pool: { query, connect: async () => ({ query, release }) } });
});

test('closes an explicitly included fixed payment in a partial month without clinical approval or tariff', async () => {
  const result = await closeLiquidation({}, input, user);
  expect(result.snapshot.totalBase).toBe(1000);
  expect(result.snapshot.totalNet).toBe(1040.83);
  expect(result.lines[0]).toMatchObject({ sourceType: 'BI_FIJO_MENSUAL', month: '2026-09',
    fiscalSnapshot: { source: 'BI_INTERNO' }, vat: 160, isr: 12.5, vatWithholding: 106.67 });
  expect(monthly.readMonthlyReviews).toHaveBeenCalledWith(input.startDate, input.endDate);
  expect(monthly.lockAndValidateRows).toHaveBeenCalledWith(expect.objectContaining({ query }), [fixedRow()]);
  expect(query.mock.calls.some(([sql]) => sql.includes('FROM bi_honorarios_catalog') || sql.includes('FROM bi_honorarios_tariffs'))).toBe(false);
  expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO bi_honorarios_finalized_rows'))).toBe(true);
  expect(query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(true);
  expect(release).toHaveBeenCalledTimes(1);
});

test('one provider closure combines approved clinical services and an included monthly payment', async () => {
  const clinic = { ModeBI: true, SourceIdentity: 'BI|SOLN|1|ORDEN', FechaAtencion: '2026-09-16',
    MedicoId: 7, Medico: 'MEDICO', Cantidad: 1, BaseImporte: 100, CatalogSnapshot: { revision: 1 } };
  const approval = { ...fixedApproval(fixedRow()), sourceType: 'BI_PRESTACION', fingerprint: reviewFingerprint(clinic),
    snapshot: { rowId: clinic.SourceIdentity, sourceType: 'SOLN', sourceFingerprint: 'clinical-source',
      providerId: 7, providerName: 'MEDICO', description: 'Consulta', serviceDate: '2026-09-16',
      quantity: 1, unitAmount: 100, baseAmount: 100, role: 'TRATANTE', itemCode: 'SER1471',
      catalog: { revision: 1 }, tariff: { id: 1, revision: 1 } } };
  workflow.getPeriodCandidates.mockResolvedValue({ rows: [clinic, fixedRow()] });
  reviews.readReviews.mockResolvedValue({ [clinic.SourceIdentity]: approval });
  const result = await closeLiquidation({}, input, user);
  expect(result.lines).toHaveLength(2);
  expect(result.snapshot).toMatchObject({ totalBase: 1100, totalNet: 1144.92 });
  expect(query.mock.calls.filter(([sql]) => sql.includes('FROM bi_honorarios_catalog')).map(([, params]) => params)).toEqual([['SER1471']]);
  expect(monthly.lockAndValidateRows).toHaveBeenCalledWith(expect.anything(), [fixedRow()]);
});

test('an included monthly payment still requires explicit VAT and a verified fiscal profile', async () => {
  const approved = fixedApproval(fixedRow());
  delete approved.vatRate;
  monthly.readMonthlyReviews.mockResolvedValue({ [fixedRow().SourceIdentity]: approved });
  await expect(closeLiquidation({}, input, user)).rejects.toThrow('IVA');
  monthly.readMonthlyReviews.mockResolvedValue({ [fixedRow().SourceIdentity]: fixedApproval(fixedRow()) });
  profiles.readProfiles.mockResolvedValue({ 7: { enabled: true, providerId: '7', confirmed: false } });
  await expect(closeLiquidation({}, input, user)).rejects.toThrow('datos fiscales');
  expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO bi_honorarios_liquidations'))).toBe(false);
});

test('a fixed approval with an altered saved base cannot bypass the monthly configuration amount', async () => {
  const approved = fixedApproval(fixedRow()); approved.snapshot.baseAmount = 999;
  monthly.readMonthlyReviews.mockResolvedValue({ [fixedRow().SourceIdentity]: approved });
  await expect(closeLiquidation({}, input, user)).rejects.toMatchObject({ status: 409 });
  expect(monthly.lockAndValidateRows).not.toHaveBeenCalled();
});

test.each(['PENDIENTE', 'EXCLUIR', null])('fixed payments never close automatically when the month decision is %s', async action => {
  monthly.readMonthlyReviews.mockResolvedValue(action ? { [fixedRow().SourceIdentity]: { ...fixedApproval(fixedRow()), action } } : {});
  await expect(closeLiquidation({}, input, user)).rejects.toThrow('No hay servicios aprobados');
  expect(monthly.lockAndValidateRows).not.toHaveBeenCalled();
  expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO bi_honorarios_liquidations'))).toBe(false);
});

test('a changed monthly configuration or review revision rolls back the whole closure', async () => {
  monthly.lockAndValidateRows.mockRejectedValueOnce(Object.assign(new Error('La configuración cambió'), { status: 409 }));
  await expect(closeLiquidation({}, input, user)).rejects.toMatchObject({ status: 409 });
  expect(query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
  expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO bi_honorarios_liquidations'))).toBe(false);
  query.mockClear(); reviewRevision = 3;
  await expect(closeLiquidation({}, input, user)).rejects.toMatchObject({ status: 409 });
  expect(query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
});

test('one provider-month identity cannot close in overlapping periods once finalized', async () => {
  finalized = [{ liquidation_id: 8 }];
  await expect(closeLiquidation({}, { ...input, startDate: '2026-09-18', endDate: '2026-09-30' }, user)).rejects.toMatchObject({ status: 409 });
  expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO bi_honorarios_finalized_rows'))).toBe(false);
});

test('fixed monthly historical lines never become missing clinical services or use the current configuration', async () => {
  const fixed = fixedApproval(fixedRow()).snapshot;
  const history = { start_date: input.startDate, end_date: input.endDate, snapshot: { lines: [fixed] } };
  expect(await checkLiquidationChanges(null, history)).toEqual([]);
  expect(sources.getHonorariosCandidates).not.toHaveBeenCalled();
  sources.getHonorariosCandidates.mockResolvedValue({ rows: [] });
  const clinical = { rowId: 'BI|SOLN|1|ORDEN', sourceType: 'SOLN', description: 'Consulta', sourceFingerprint: 'clinic' };
  expect(await checkLiquidationChanges({}, { ...history, snapshot: { lines: [fixed, clinical] } })).toEqual([
    expect.objectContaining({ rowId: clinical.rowId, code: 'CLINICAL_SOURCE_MISSING' }) ]);
});
