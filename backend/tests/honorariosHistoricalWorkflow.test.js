'use strict';

jest.mock('../config/db', () => ({ getDb: jest.fn() }));
jest.mock('../services/honorariosReview.service', () => ({
  canReview: () => true, ensureTables: jest.fn(async () => {})
}));
jest.mock('../services/honorariosMonthlyFixed.service', () => ({ getPeriodRows: jest.fn(async () => []) }));

const catalog = require('../services/honorariosCatalog.service');
const sources = require('../services/honorariosSources.service');
const { getDb } = require('../config/db');
const { getPeriodCandidates } = require('../services/honorariosWorkflow.service');
const { reviewFingerprint } = require('../utils/honorariosReviewSource');

const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

afterEach(() => jest.restoreAllMocks());

test('historical psychology uses tariff validity and preserves stored approvals and closures when validity is extended', async () => {
  const dates = ['2026-07-31', '2026-08-01', '2026-08-31', '2026-09-01', '2026-09-30', '2026-10-01', '2026-10-31', '2026-11-01'];
  const rawRows = freeze(dates.map((ServiceDate, index) => ({
    SONum: 100 + index, SOLNNum: 200 + index, PCAPNum: 300 + index,
    ItemCode: 'SER0616', ItemDescription: 'Consulta Psicología', ItemGroupName: 'CONSULTA EXTERNA',
    Quantity: 1, UnitPrice: 1000, ServiceDate, ServiceDateType: 'CITA_PROGRAMADA',
    AppointmentDate: ServiceDate, AppointmentCount: 1, ServiceLineCount: 1,
    AppointmentDoctorId: 7, AppointmentDoctorName: 'Médico de psicología',
    RequesterId: 7, RequesterName: 'Médico de psicología', PCAP_ST: 'SH',
    UDF_Ejecutada: true, SO_ST: 'PR', SOLN_ST: 'PR'
  })));
  const config = freeze({ itemCode: 'SER0616', name: 'Consulta Psicología', groupName: 'CONSULTA EXTERNA',
    active: true, status: 'INCLUIDO', modality: 'presencial', paymentUnit: 'consulta',
    scopeExcluded: false, revision: 2, referencePrices: [{ amount: 1000 }] });
  const octoberTariff = freeze({ id: 42, itemCode: 'SER0616', providerId: null, role: null, amount: 225,
    validFrom: '2026-09-01', validTo: null, active: true, revision: 1 });
  const pricing = { configs: new Map([['SER0616', config]]), tariffs: [octoberTariff] };

  // Keep the actual source normalization, enrichment and tariff resolution.
  // Schema/discovery setup is outside this isolated query regression.
  jest.spyOn(catalog, 'ensureCatalogReady').mockResolvedValue({});
  jest.spyOn(catalog, 'discoverCandidates').mockResolvedValue();
  const actualEnrich = catalog.enrichCandidates;
  jest.spyOn(catalog, 'enrichCandidates').mockImplementation(rows => actualEnrich(rows, pricing));
  jest.spyOn(catalog, 'resolveTariffs').mockImplementation(async rows => rows.map(row => catalog.resolveTariff(row, pricing.tariffs)));

  const octoberRow = catalog.enrichCandidate(sources.normalizeOrderCandidate(rawRows[5]), config, pricing.tariffs);
  const reviews = freeze([{ row_id: octoberRow.SourceIdentity, revision: 9, payload: {
    action: 'APROBAR', sourceType: 'BI_PRESTACION', providerId: 7, fingerprint: reviewFingerprint(octoberRow),
    snapshot: { rowId: octoberRow.SourceIdentity, itemCode: 'SER0616', sourceType: octoberRow.SourceType,
      sourceLineId: octoberRow.SourceLineId, serviceDate: '2026-10-01', sourceFingerprint: octoberRow.SourceFingerprint,
      providerId: 7, providerName: 'Médico de psicología', role: 'TRATANTE',
      catalog: octoberRow.CatalogSnapshot, tariff: octoberRow.TariffSnapshot, baseAmount: 225 }
  } }]);
  const closedRow = sources.normalizeOrderCandidate(rawRows[6]);
  const finalized = freeze([{ row_id: closedRow.SourceIdentity, liquidation_id: 5,
    snapshot: { serviceDate: '2026-10-31', sourceFingerprint: closedRow.SourceFingerprint,
      baseAmount: 225, tariff: octoberTariff } }]);
  const before = JSON.stringify({ rawRows, config, octoberTariff, reviews, finalized });

  const query = jest.fn(async (sql, values) => {
    if (sql.includes('FROM bi_honorarios_finalized_rows')) return { rows: finalized.filter(row =>
      row.snapshot.serviceDate >= values[0] && row.snapshot.serviceDate <= values[1]) };
    if (sql.includes('SELECT row_id,payload')) return { rows: reviews.filter(row => values[0].includes(row.row_id)) };
    throw new Error('Unexpected PostgreSQL statement in a read-only regression: ' + sql);
  });
  getDb.mockReturnValue({ pool: { query } });
  const remoteStatements = [];
  const remote = { request() {
    const params = {};
    return { input(key, value) { params[key] = value; return this; }, async query(sql) {
      remoteStatements.push({ sql, params });
      return { recordset: sql === sources.ORDER_CANDIDATES_SQL ? rawRows.filter(row =>
        row.ServiceDate >= params.startDate && row.ServiceDate <= params.endDate) : [] };
    } };
  } };

  const august = await getPeriodCandidates(remote, '2026-08-01', '2026-08-31');
  expect(august.rows).toEqual([]);
  expect(august.coverage).toMatchObject({ sourceCandidates: 2, omittedFromReview: 2, pendingCatalog: 0, pendingTariff: 2,
    sourceCounts: { orderLines: 2, clinicalCharges: 0, standaloneAppointments: 0, surgicalProcedures: 0, contactCenter: 0 } });
  const october = await getPeriodCandidates(remote, '2026-10-01', '2026-10-31');
  expect(october.rows.map(row => row.FechaAtencion)).toEqual(['2026-10-01', '2026-10-31']);
  expect(october.rows.every(row => row.TariffSnapshot.id === 42 && row.ReviewInvalidated === false)).toBe(true);
  expect(october.rows[1].SnapshotCierre).toBe(finalized[0].snapshot);
  expect((await getPeriodCandidates(remote, '2026-09-01', '2026-09-01')).rows).toHaveLength(1);
  expect((await getPeriodCandidates(remote, '2026-08-31', '2026-08-31')).rows).toEqual([]);

  // Simulate an independently authorized extension in the fixture.
  // The query itself never extends a tariff or rewrites an approval.
  const historical = catalog.validateTariff({ id: 42, itemCode: 'SER0616',
    amount: 225, validFrom: '2026-08-01', validTo: null, expectedRevision: 1 });
  pricing.tariffs = [freeze({ ...historical, revision: 2 })];
  const authorizedAugust = await getPeriodCandidates(remote, '2026-08-01', '2026-08-31');
  expect(authorizedAugust.rows.map(row => row.FechaAtencion)).toEqual(['2026-08-01', '2026-08-31']);
  expect(authorizedAugust.rows.every(row => row.TariffSnapshot.id === 42 && row.TariffSnapshot.revision === 2 && row.BaseImporte === 225)).toBe(true);
  expect(authorizedAugust.coverage).toMatchObject({ candidates: 2, omittedFromReview: 0, pendingTariff: 0 });
  expect((await getPeriodCandidates(remote, '2026-07-31', '2026-07-31')).rows).toEqual([]);
  const afterExtension = await getPeriodCandidates(remote, '2026-10-01', '2026-10-31');
  expect(afterExtension.rows.map(row => row.FechaAtencion)).toEqual(['2026-10-01', '2026-10-31']);
  expect(afterExtension.rows[0].ReviewInvalidated).toBe(true);
  expect(afterExtension.rows[1].ReviewInvalidated).toBe(false);
  expect(afterExtension.rows[1].SnapshotCierre).toBe(finalized[0].snapshot);
  expect(finalized[0].snapshot.tariff.revision).toBe(1);
  expect(reviews[0].payload.snapshot.tariff.revision).toBe(1);
  const bounded = { ...pricing.tariffs[0], validTo: '2026-08-31' };
  expect(catalog.resolveTariff({ itemCode: 'SER0616', serviceDate: '2026-08-31' }, [bounded]).tariff.id).toBe(42);
  expect(catalog.resolveTariff({ itemCode: 'SER0616', serviceDate: '2026-09-01' }, [bounded]).tariff).toBeNull();
  expect(JSON.stringify({ rawRows, config, octoberTariff, reviews, finalized })).toBe(before);
  expect(query.mock.calls.every(([sql]) => /^SELECT\s/i.test(sql))).toBe(true);
  expect(remoteStatements.every(({ sql }) => !/\b(INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|CREATE|TRUNCATE|EXEC|INTO)\b/i.test(sql))).toBe(true);
  expect(remoteStatements.filter(({ sql }) => sql === sources.ORDER_CANDIDATES_SQL)[0].params)
    .toEqual({ startDate: '2026-08-01', endDate: '2026-08-31' });
  expect(sources.ORDER_CANDIDATES_SQL).toMatch(/<DATEADD\(day,1,CAST\(@endDate AS date\)\)/);
});
