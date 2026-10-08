'use strict';
jest.mock('../config/db', () => { const pool = { query: jest.fn(async () => ({ rows: [] })) }; return { getDb: () => ({ pool }) }; });
jest.mock('../services/honorariosMonthlyFixed.service', () => ({ getPeriodRows: jest.fn(async () => []) }));
jest.mock('../services/honorariosSources.service', () => ({ getHonorariosCandidates: jest.fn(),
  getProviderDirectory: jest.fn(async () => [{ id: 7, name: 'Médico confirmado' }]) }));
jest.mock('../services/honorariosCatalog.service', () => ({ ensureCatalogReady: jest.fn(async () => ({})), listCatalog: jest.fn(async () => ({ items: [] })), discoverCandidates: jest.fn(async () => {}), isExcludedHonorariosService: () => false,
  resolveTariffs: jest.fn(async () => []), loadPricingContext: jest.fn(async () => ({})),
  enrichCandidates: jest.fn(async rows => rows.map(row => ({ ...row, ModeBI: true,
    CatalogStatus: row.CatalogStatus || 'INCLUIDO', CatalogSnapshot: { itemCode: 'SER1471', revision: 1 },
    CatalogApproved: row.CatalogApproved ?? true, ReviewEligible: row.ReviewEligible ?? true,
    TariffSnapshot: row.TariffSnapshot === undefined ? { id: 1, revision: 1, amount: 250 } : row.TariffSnapshot, PrecioUnitarioBI: 250,
    BaseImporte: row.Cantidad * 250 }))) }));
const { getHonorariosCandidates } = require('../services/honorariosSources.service');
const { prepareSourceReview, getPeriodCandidates, approvalPreview, validatePeriod } = require('../services/honorariosWorkflow.service');
const { reviewFingerprint } = require('../utils/honorariosReviewSource');

const candidate = () => ({ SourceIdentity: 'BI|SOLN|10|ORDEN', SourceType: 'SOLN', SourceLineId: 10,
  OccurrenceId: 'ORDEN', CodigoServicio: 'SER1471', FechaAtencion: '2026-04-15', MedicoId: 7,
  Medico: 'Médico confirmado', RolMedico: 'TRATANTE', Cantidad: 1, CantidadOriginal: 1, CantidadMaxima: 1,
  FolioOrdenVenta: 16258, FolioAtencion: null, SourceFingerprint: 'source', EjecucionConfirmada: false });
async function input(changes = {}) {
  const { rows } = await getPeriodCandidates({}, '2026-04-15', '2026-04-15');
  return { rowId: rows[0].SourceIdentity, serviceDate: '2026-04-15', expectedRevision: 0,
    decision: { action: 'APROBAR', motivo: 'Sesión psicológica validada', fingerprint: reviewFingerprint(rows[0]),
      customAmount: 999999, providerId: 7, quantity: 1, executionConfirmed: true, evidenceReference: 'CC-01',
      quotedTariffId: 1, quotedTariffRevision: 1, ...changes } };
}
beforeEach(() => {
  require('../services/honorariosMonthlyFixed.service').getPeriodRows.mockReset().mockResolvedValue([]);
  require('../services/honorariosSources.service').getProviderDirectory.mockReset().mockResolvedValue([{ id: 7, name: 'Médico confirmado' }]);
  getHonorariosCandidates.mockResolvedValue({ rows: [candidate()], coverage: {} });
  require('../config/db').getDb().pool.query.mockReset().mockResolvedValue({ rows: [] });
  require('../services/honorariosCatalog.service').resolveTariffs.mockReset().mockResolvedValue([]);
});

test('online approval without arrival uses the server tariff and records the confirmed physician and evidence', async () => {
  const saved = await prepareSourceReview({}, await input());
  expect(saved.decision.customAmount).toBe(250);
  expect(saved.decision.snapshot).toMatchObject({ providerId: 7, quantity: 1, salesOrder: 16258,
    attention: null, unitAmount: 250, execution: { reference: 'CC-01', confirmedInBI: true } });
});
test('incomplete or changed sources cannot be approved by a crafted browser request', async () => {
  for (const change of [{ evidenceReference: '' }, { executionConfirmed: false }, { providerId: 999 },
    { quantity: 2 }, { quantity: -1 }, { fingerprint: 'outdated' }, { quotedTariffRevision: 99 }]) {
    await expect(prepareSourceReview({}, await input(change))).rejects.toThrow();
  }
});
test('excluded, cancelled and duplicate candidates require the appropriate resolution before approval', async () => {
  for (const change of [{ CatalogStatus: 'EXCLUIDO' }, { Cancelado: true }, { PosibleDuplicado: true }]) {
    getHonorariosCandidates.mockResolvedValue({ rows: [{ ...candidate(), ...change }], coverage: {} });
    await expect(prepareSourceReview({}, await input())).rejects.toThrow();
  }
});
test('period cuts reject impossible dates and unbounded queries', () => {
  for (const dates of [['2026-02-30', '2026-03-02'], ['2024-01-01', '2026-09-30']]) expect(() => validatePeriod(...dates)).toThrow();
});

test('monthly payments stay available without consultations and outside the exact daily cut', async () => {
  const row = { FixedMonthly: true, TipoCalculo: 'BI_FIJO_MENSUAL', SourceIdentity: 'FIXED|7|2026-04',
    FeeMonth: '2026-04', FechaAtencion: '2026-04-01', MedicoId: 7, Medico: 'Médico confirmado',
    Cantidad: 1, BaseImporte: 1000, ReviewEligible: true, FixedMonthlySnapshot: { revision: 1 } };
  getHonorariosCandidates.mockResolvedValue({ rows: [], coverage: {} });
  require('../services/honorariosMonthlyFixed.service').getPeriodRows.mockResolvedValue([row]);
  const result = await getPeriodCandidates({}, '2026-04-15', '2026-04-20');
  expect(result.rows).toEqual([{ ...row, ReviewInvalidated: false }]);
  expect(result.coverage).toMatchObject({ candidates: 1, monthlyFixed: 1, omittedFromReview: 0, pendingCatalog: 0 });
  const reviewRead = require('../config/db').getDb().pool.query.mock.calls.find(([sql]) => sql.includes('SELECT row_id,payload'));
  expect(reviewRead[1]).toEqual([['FIXED|7|2026-04']]);
  await expect(approvalPreview({}, {}, row)).rejects.toThrow('configuración');
  await expect(prepareSourceReview({}, {}, row)).rejects.toThrow('configuración');
});

test('monthly configuration changes invalidate an open inclusion but preserve a closed amount', async () => {
  const row = { FixedMonthly: true, SourceIdentity: 'FIXED|7|2026-04', FechaAtencion: '2026-04-01',
    Cantidad: 1, BaseImporte: 1500, FixedMonthlySnapshot: { revision: 2 }, SourceFingerprint: 'new' };
  getHonorariosCandidates.mockResolvedValue({ rows: [], coverage: {} });
  require('../services/honorariosMonthlyFixed.service').getPeriodRows.mockResolvedValue([row]);
  const db = require('../config/db').getDb().pool;
  db.query.mockImplementation(async sql => ({ rows: sql.includes('SELECT row_id,payload')
    ? [{ row_id: row.SourceIdentity, payload: { action: 'APROBAR', sourceType: 'BI_FIJO_MENSUAL',
      fingerprint: 'old', snapshot: { fixed: { revision: 1 } } } }] : [] }));
  expect((await getPeriodCandidates({}, '2026-04-15', '2026-04-20')).rows[0].ReviewInvalidated).toBe(true);
  db.query.mockImplementation(async sql => ({ rows: sql.includes('FROM bi_honorarios_finalized_rows')
    ? [{ row_id: row.SourceIdentity, liquidation_id: 9, snapshot: { baseAmount: 1000, sourceFingerprint: 'old' } }] : [] }));
  expect((await getPeriodCandidates({}, '2026-04-15', '2026-04-20')).rows[0]).toMatchObject({
    BaseImporte: 1000, LiquidacionCerrada: 9, CambiosTrasCierre: false, ReviewInvalidated: false });
});

test('review only returns configured applicable services and counts omitted candidates without approving payment', async () => {
  getHonorariosCandidates.mockResolvedValue({ rows: [candidate(),
    { ...candidate(), SourceIdentity: 'BI|SOLN|11|ORDEN', CatalogApproved: false, ReviewEligible: false },
    { ...candidate(), SourceIdentity: 'BI|SOLN|12|ORDEN', ReviewEligible: false, MedicoId: null }
  ], coverage: {} });
  const result = await getPeriodCandidates({}, '2026-04-15', '2026-04-15');
  expect(result.rows.map(row => row.SourceIdentity)).toEqual([candidate().SourceIdentity]);
  expect(result.coverage).toMatchObject({ candidates: 1, sourceCandidates: 3, omittedFromReview: 2, pendingCatalog: 1, pendingProvider: 1 });
  await expect(prepareSourceReview({}, { rowId: 'BI|SOLN|11|ORDEN', serviceDate: '2026-04-15', decision: { action: 'APROBAR' } }))
    .rejects.toThrow('El servicio ya no aparece');
  const historical = await getPeriodCandidates({}, '2026-04-15', '2026-04-15', { includeUnconfigured: true });
  expect(historical.rows).toHaveLength(3);
});

test('a crafted approval cannot bypass the catalog eligibility checks after physician selection', async () => {
  const { enrichCandidates } = require('../services/honorariosCatalog.service');
  const request = await input();
  const source = { ...candidate(), CatalogStatus: 'INCLUIDO' };
  const original = enrichCandidates.getMockImplementation();
  const [current] = await original([source]);
  request.decision.fingerprint = reviewFingerprint(current);
  enrichCandidates.mockImplementationOnce(async rows => (await original(rows)).map(row => ({ ...row, CatalogApproved: false, ReviewEligible: false })));
  await expect(prepareSourceReview({}, request, current)).rejects.toThrow('Aprueba el servicio y su tarifa');
});

test('an explicitly assigned beneficiary remains reviewable when the source physician tariff is withdrawn', async () => {
  const raw = { ...candidate(), MedicoId: 8, Medico: 'Solicitante', ReviewEligible: false, TariffSnapshot: null };
  const savedTariff = { id: 3, revision: 1, itemCode: 'SER1471', amount: 275, providerId: '7', role: 'TRATANTE' };
  const saved = { action: 'APROBAR', sourceType: 'BI_PRESTACION', providerId: 7, fingerprint: 'prior-source-tariff',
    snapshot: { rowId: raw.SourceIdentity, itemCode: raw.CodigoServicio, sourceType: raw.SourceType, sourceLineId: raw.SourceLineId,
      serviceDate: raw.FechaAtencion, sourceFingerprint: raw.SourceFingerprint, providerId: 7, providerName: 'Médico confirmado',
      role: 'TRATANTE', catalog: { itemCode: raw.CodigoServicio, status: 'INCLUIDO' }, tariff: savedTariff } };
  getHonorariosCandidates.mockResolvedValue({ rows: [raw], coverage: {} });
  require('../config/db').getDb().pool.query.mockImplementation(async sql => ({ rows: /SELECT row_id,payload/.test(sql)
    ? [{ row_id: raw.SourceIdentity, payload: saved }] : [] }));
  require('../services/honorariosCatalog.service').resolveTariffs.mockResolvedValue([{ tariff: savedTariff }]);
  const result = await getPeriodCandidates({}, '2026-04-15', '2026-04-15');
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({ MedicoId: 8, Medico: 'Solicitante', TariffSnapshot: null, ReviewEligible: true,
    ReviewInvalidated: true, ReviewBeneficiary: { providerId: 7, providerName: 'Médico confirmado', role: 'TRATANTE', origin: 'saved_approval' },
    ReviewEligibilityTariff: savedTariff });
  expect(result.coverage).toMatchObject({ candidates: 1, omittedFromReview: 0, pendingTariff: 0 });
  const { enrichCandidates } = require('../services/honorariosCatalog.service');
  const [untouched] = await enrichCandidates([raw]);
  expect(reviewFingerprint(result.rows[0])).toBe(reviewFingerprint(untouched));
  const preview = await approvalPreview({}, { rowId: raw.SourceIdentity, serviceDate: raw.FechaAtencion });
  expect(preview.provider.id).toBe(7);
  expect(preview.row.ReviewBeneficiary).toBeUndefined();
  getHonorariosCandidates.mockResolvedValue({ rows: [{ ...raw, SourceFingerprint: 'changed-clinical-source' }], coverage: {} });
  expect((await getPeriodCandidates({}, '2026-04-15', '2026-04-15')).rows).toHaveLength(0);
  const changed = await getPeriodCandidates({}, '2026-04-15', '2026-04-15', { includeUnconfigured: true });
  expect(changed.rows[0].ReviewBeneficiary).toBeUndefined();
});

test('approval preserves the preview cent for a fractional quantity instead of rounding it again', async () => {
  const { enrichCandidates } = require('../services/honorariosCatalog.service');
  const request = await input({ quantity: 0.03 });
  const original = enrichCandidates.getMockImplementation();
  const [source] = await original([candidate()]);
  request.decision.fingerprint = reviewFingerprint(source);
  enrichCandidates.mockImplementationOnce(async rows => (await original(rows)).map(row => ({ ...row,
    BaseImporte: 1.01, PrecioUnitarioBI: 33.5, TariffSnapshot: { id: 1, revision: 1, amount: 33.5 } })));
  const prepared = await prepareSourceReview({}, request, source);
  expect(prepared.decision.customAmount).toBe(1.01);
  expect(prepared.decision.snapshot).toMatchObject({ quantity: 0.03, unitAmount: 33.5, baseAmount: 1.01 });
});

test('direct approval records the reviewer declaration with an explicit VAT and no invented reference', async () => {
  const saved = await prepareSourceReview({}, await input({ confirmationMode: 'DIRECT_APPROVAL', vatRate: 0, evidenceReference: '' }));
  expect(saved.decision.snapshot.execution).toMatchObject({ confirmed: true, confirmedInBI: true,
    reference: '', confirmationMethod: 'REVIEWER_APPROVAL' });
  for (const vatRate of [null, undefined, 0.15, '0']) {
    await expect(prepareSourceReview({}, await input({ confirmationMode: 'DIRECT_APPROVAL', vatRate, evidenceReference: '' }))).rejects.toThrow('Selecciona el IVA');
  }
  await expect(prepareSourceReview({}, await input({ confirmationMode: 'DIRECT_APPROVAL', vatRate: 0, executionConfirmed: false }))).rejects.toThrow('Confirma que el servicio');
});

test('fifty approvals reuse one directory and pricing read while retaining each service validation', async () => {
  const workflow = require('../services/honorariosWorkflow.service');
  const { getProviderDirectory } = require('../services/honorariosSources.service');
  const catalog = require('../services/honorariosCatalog.service');
  getProviderDirectory.mockClear(); catalog.loadPricingContext.mockClear();
  const request = await input({ confirmationMode: 'DIRECT_APPROVAL', vatRate: 0.16, evidenceReference: '' });
  const [source] = await catalog.enrichCandidates([candidate()]);
  const context = await workflow.loadApprovalContext({});
  for (let i = 0; i < 50; i++) {
    const prepared = await prepareSourceReview({}, request, source, context);
    expect(prepared.decision.snapshot.baseAmount).toBe(250);
    expect(prepared.decision.vatRate).toBe(0.16);
  }
  expect(getProviderDirectory).toHaveBeenCalledTimes(1);
  expect(catalog.loadPricingContext).toHaveBeenCalledTimes(1);
  await expect(prepareSourceReview({}, { ...request, decision: { ...request.decision, quantity: 2 } }, source, context)).rejects.toThrow('La cantidad');
});

test.each([undefined, '', '   ', '\n\t', 123, 'x'.repeat(2001)])('a physician change requires its own nonblank bounded reason (case %#)', async physicianChangeReason => {
  require('../services/honorariosSources.service').getProviderDirectory.mockResolvedValue([{ id: 8, name: 'Médico corregido' }]);
  const request = await input({ providerId: 8, physicianChangeReason,
    motivo: 'Servicios e IVA confirmados en aprobación múltiple.', evidenceReference: 'Nota distinta del motivo de corrección' });
  await expect(prepareSourceReview({}, request)).rejects.toThrow('motivo de la corrección del médico');
});

test('a physician change uses server identities and trims the reason without trusting client correction metadata', async () => {
  require('../services/honorariosSources.service').getProviderDirectory.mockResolvedValue([{ id: 8, name: 'Médico corregido' }]);
  const forged = { fromProviderId: 999, fromProviderName: 'Inventado', toProviderId: 999,
    reason: 'Otro motivo', correctedBy: { id: 999 }, correctedAt: '1900-01-01' };
  const request = await input({ providerId: 8, physicianChangeReason: '  Error de captura del médico  ',
    physicianCorrection: forged, snapshot: { physicianCorrection: forged } });
  const prepared = await prepareSourceReview({}, request);
  expect(prepared.decision.snapshot.physicianCorrection).toEqual({ fromProviderId: 7, fromProviderName: 'Médico confirmado',
    toProviderId: 8, toProviderName: 'Médico corregido', reason: 'Error de captura del médico' });
  expect(prepared.decision.physicianChangeReason).toBe('Error de captura del médico');
  expect(prepared.decision.snapshot.providerId).toBe(8);
  expect(prepared.decision.snapshot.sourceFingerprint).toBe(candidate().SourceFingerprint);
});

test('approving the same physician needs no correction reason and ignores a forged correction snapshot', async () => {
  const prepared = await prepareSourceReview({}, await input({ physicianChangeReason: ' ',
    snapshot: { physicianCorrection: { reason: 'Inventado', correctedBy: { id: 999 } } } }));
  expect(prepared.decision.snapshot.physicianCorrection).toBeUndefined();
  expect(prepared.decision.physicianChangeReason).toBeNull();
});

test.each(['EXCLUIR', 'PENDIENTE'])('a %s decision cannot plant a forged correction or approval snapshot', async action => {
  const prepared = await prepareSourceReview({}, await input({ action, physicianChangeReason: 'Motivo falso',
    snapshot: { providerId: 999, physicianCorrection: { reason: 'Inventado', correctedBy: { id: 999 } } } }));
  expect(prepared.decision.snapshot).toBeNull();
  expect(prepared.decision.physicianChangeReason).toBeNull();
});

test('a compatible saved assignment carries its authentic correction into reapproval and compares further changes to the shown physician', async () => {
  const raw = { ...candidate(), MedicoId: 8, Medico: 'Médico de origen' };
  const correction = { fromProviderId: 8, fromProviderName: 'Médico de origen', toProviderId: 7, toProviderName: 'Médico confirmado',
    reason: 'Captura original equivocada', correctedBy: { id: 10, name: 'Revisor anterior', username: 'anterior' },
    correctedAt: '2026-04-16T12:00:00.000Z' };
  const tariff = { id: 1, revision: 1, amount: 250 };
  const saved = { action: 'APROBAR', sourceType: 'BI_PRESTACION', providerId: 7, fingerprint: 'old-tariff',
    snapshot: { rowId: raw.SourceIdentity, itemCode: raw.CodigoServicio, sourceType: raw.SourceType, sourceLineId: raw.SourceLineId,
      serviceDate: raw.FechaAtencion, sourceFingerprint: raw.SourceFingerprint, providerId: 7, providerName: 'Médico confirmado',
      role: 'TRATANTE', catalog: { itemCode: raw.CodigoServicio, status: 'INCLUIDO' }, tariff, physicianCorrection: correction } };
  getHonorariosCandidates.mockResolvedValue({ rows: [raw], coverage: {} });
  require('../config/db').getDb().pool.query.mockImplementation(async sql => ({ rows: /SELECT row_id,payload/.test(sql)
    ? [{ row_id: raw.SourceIdentity, payload: saved }] : [] }));
  require('../services/honorariosCatalog.service').resolveTariffs.mockResolvedValue([{ tariff }]);
  const { rows: [current] } = await getPeriodCandidates({}, '2026-04-15', '2026-04-15');
  expect(current.ReviewBeneficiary.physicianCorrection).toEqual(correction);
  expect(current.MedicoId).toBe(8);
  const prepared = await prepareSourceReview({}, await input({ physicianChangeReason: '' }));
  expect(prepared.decision.snapshot.physicianCorrection).toEqual(correction);
  require('../services/honorariosSources.service').getProviderDirectory.mockResolvedValue([{ id: 8, name: 'Médico de origen' }]);
  await expect(prepareSourceReview({}, await input({ providerId: 8 }))).rejects.toThrow('motivo de la corrección');
  const returned = await prepareSourceReview({}, await input({ providerId: 8, physicianChangeReason: 'Se confirmó el médico original' }));
  expect(returned.decision.snapshot.physicianCorrection).toEqual({ fromProviderId: 7, fromProviderName: 'Médico confirmado',
    toProviderId: 8, toProviderName: 'Médico de origen', reason: 'Se confirmó el médico original' });
  getHonorariosCandidates.mockResolvedValue({ rows: [{ ...raw, SourceFingerprint: 'changed-source' }], coverage: {} });
  const changed = await getPeriodCandidates({}, '2026-04-15', '2026-04-15');
  expect(changed.rows[0].ReviewBeneficiary).toBeUndefined();
});

test('a legacy assignment with no correction metadata is not attributed retroactively when reapproved', async () => {
  const source = { ...candidate(), CatalogStatus: 'INCLUIDO', ReviewBeneficiary: {
    providerId: 7, providerName: 'Médico confirmado', role: 'TRATANTE', origin: 'saved_approval'
  }, MedicoId: 8, Medico: 'Médico de origen' };
  const request = await input({ physicianChangeReason: '' });
  request.decision.fingerprint = reviewFingerprint(source);
  const prepared = await prepareSourceReview({}, request, source);
  expect(prepared.decision.snapshot.providerId).toBe(7);
  expect(prepared.decision.snapshot.physicianCorrection).toBeUndefined();
});
