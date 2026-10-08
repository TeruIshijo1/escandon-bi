'use strict';

jest.mock('../config/db', () => {
  const client = { query: jest.fn(), release: jest.fn() };
  const pool = { query: jest.fn(async () => ({ rows: [] })), connect: jest.fn(async () => client) };
  return { getDb: () => ({ pool }), client };
});
const { client } = require('../config/db');
const { saveReview } = require('../services/honorariosReview.service');
const user = { id: 7, nombre: 'REVISOR FICTICIO', permisos: ['interconsultas-jornadas'] };
const input = { rowId: 'BI|SOLN|91|ORDEN', serviceDate: '2026-09-02', expectedRevision: 0,
  decision: { action: 'APROBAR', customAmount: 250, vatRate: 0, motivo: 'Servicio revisado',
    fingerprint: 'source', sourceType: 'BI_PRESTACION', providerId: 7, quantity: 1,
    snapshot: { itemCode: 'SER1471', catalog: { revision: 1 }, tariff: { id: 51, revision: 1 },
      allocationKey: 'SOLN:91|TRATANTE', quantity: 1, maximumQuantity: 1 } } };

function transactionWithCurrentActivity(sourceActive, { previous, closed = false } = {}) {
  client.query.mockReset().mockImplementation(async sql => {
    if (/SELECT revision,payload FROM bi_honorarios_reviews/.test(sql)) return { rows: previous ? [previous] : [] };
    if (/FROM bi_honorarios_finalized_rows/.test(sql)) return { rows: closed ? [{ liquidation_id: 4 }] : [] };
    if (/FROM bi_honorarios_catalog/.test(sql)) return { rows: [{ revision: 1, status: 'INCLUIDO',
      source_active: sourceActive, scope_excluded: false }] };
    if (/FROM bi_honorarios_tariffs/.test(sql)) return { rows: [{ revision: 1, active: true }] };
    if (/AS quantity/.test(sql)) return { rows: [{ quantity: 0 }] };
    if (/RETURNING updated_at/.test(sql)) return { rows: [{ updated_at: '2026-10-07T16:00:00Z' }] };
    return { rows: [] };
  });
  client.release.mockClear();
}

test.each([false, null, undefined])('an inactive or unknown current catalog state rejects an approval prepared before synchronization (%s)', async active => {
  // La sincronización de Vertical conserva la revisión de configuración de BI.
  // Por eso una revisión coincidente no demuestra que el servicio siga activo.
  transactionWithCurrentActivity(active);
  await expect(saveReview(input, user, { sourceValidated: true })).rejects.toMatchObject({ status: 409 });
  expect(client.query.mock.calls.some(([sql]) => /INSERT INTO bi_honorarios_reviews/.test(sql))).toBe(false);
  expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  expect(client.release).toHaveBeenCalledTimes(1);
});

test('the matching active catalog and tariff still allow the approval and history to commit', async () => {
  transactionWithCurrentActivity(true);
  const saved = await saveReview(input, user, { sourceValidated: true });
  expect(saved.revision).toBe(1);
  expect(client.query.mock.calls.some(([sql]) => /INSERT INTO bi_honorarios_review_history/.test(sql))).toBe(true);
  expect(client.query).toHaveBeenCalledWith('COMMIT');
});

const correctionInput = () => ({ ...input, decision: { ...input.decision, physicianChangeReason: 'Error de captura',
  snapshot: { ...input.decision.snapshot, rowId: input.rowId, sourceFingerprint: 'clinical-source', providerId: 7,
    physicianCorrection: { fromProviderId: 8, fromProviderName: 'Médico de origen', toProviderId: 7, toProviderName: 'Médico confirmado',
      reason: 'Error de captura', correctedBy: { id: 999, name: 'Actor falso' }, correctedAt: '1900-01-01T00:00:00.000Z' } } } });

test('new physician corrections stamp the authenticated reviewer and server time into both review and immutable history', async () => {
  transactionWithCurrentActivity(true);
  const request = correctionInput();
  const started = Date.now();
  const saved = await saveReview(request, { ...user, username: 'revisor' }, { sourceValidated: true });
  const correction = saved.snapshot.physicianCorrection;
  expect(correction.correctedBy).toEqual({ id: user.id, name: user.nombre, username: 'revisor' });
  expect(Date.parse(correction.correctedAt)).toBeGreaterThanOrEqual(started);
  expect(Date.parse(correction.correctedAt)).toBeLessThanOrEqual(Date.now());
  expect(correction.reason).toBe('Error de captura');
  expect(saved.physicianChangeReason).toBe('Error de captura');
  const currentWrite = client.query.mock.calls.find(([sql]) => /INSERT INTO bi_honorarios_reviews/.test(sql));
  const historyWrite = client.query.mock.calls.find(([sql]) => /INSERT INTO bi_honorarios_review_history/.test(sql));
  expect(currentWrite[1][2].snapshot.physicianCorrection).toEqual(correction);
  expect(historyWrite[1][1].snapshot.physicianCorrection).toEqual(correction);
  expect(request.decision.snapshot.physicianCorrection.correctedBy.id).toBe(999);
});

test('reapproving the same correction preserves its reason, actor and time from the locked stored review', async () => {
  const request = correctionInput();
  const original = { ...request.decision.snapshot.physicianCorrection,
    correctedBy: { id: 12, name: 'Revisor original', username: 'original' }, correctedAt: '2026-09-03T10:00:00.000Z' };
  const stored = { ...request.decision, snapshot: { ...request.decision.snapshot, physicianCorrection: original } };
  transactionWithCurrentActivity(true, { previous: { revision: 2, payload: stored } });
  const saved = await saveReview({ ...request, expectedRevision: 2 }, user, { sourceValidated: true });
  expect(saved.revision).toBe(3);
  expect(saved.snapshot.physicianCorrection).toEqual(original);
  expect(saved.reviewer).toContain(user.nombre);
});

test.each([undefined, null])('a legacy approval without a snapshot permits a new authenticated physician correction (%s)', async snapshot => {
  transactionWithCurrentActivity(true, { previous: { revision: 1,
    payload: { action: 'APROBAR', sourceType: 'CLINICO', snapshot } } });
  const started = Date.now();
  const saved = await saveReview({ ...correctionInput(), expectedRevision: 1 }, user, { sourceValidated: true });
  expect(saved.revision).toBe(2);
  expect(saved.snapshot.physicianCorrection.correctedBy.id).toBe(user.id);
  expect(Date.parse(saved.snapshot.physicianCorrection.correctedAt)).toBeGreaterThanOrEqual(started);
  expect(client.query.mock.calls.some(([sql]) => /INSERT INTO bi_honorarios_review_history/.test(sql))).toBe(true);
  expect(client.query).toHaveBeenCalledWith('COMMIT');
});

test('a later physician correction creates a new attribution while retaining prior history', async () => {
  const request = correctionInput();
  const previousCorrection = { fromProviderId: 9, fromProviderName: 'Primer médico', toProviderId: 8, toProviderName: 'Médico de origen',
    reason: 'Primera corrección', correctedBy: { id: 12, name: 'Primer revisor' }, correctedAt: '2026-09-03T10:00:00.000Z' };
  const stored = { ...request.decision, snapshot: { ...request.decision.snapshot, providerId: 8, physicianCorrection: previousCorrection } };
  transactionWithCurrentActivity(true, { previous: { revision: 1, payload: stored } });
  const saved = await saveReview({ ...request, expectedRevision: 1 }, user, { sourceValidated: true });
  expect(saved.snapshot.physicianCorrection.correctedBy.id).toBe(user.id);
  expect(saved.snapshot.physicianCorrection.reason).toBe('Error de captura');
  expect(previousCorrection.reason).toBe('Primera corrección');
  expect(client.query.mock.calls.some(([sql]) => /DELETE|UPDATE bi_honorarios_review_history/.test(sql))).toBe(false);
});

test('closed liquidations reject physician corrections without changing their frozen snapshot', async () => {
  transactionWithCurrentActivity(true, { closed: true });
  await expect(saveReview(correctionInput(), user, { sourceValidated: true })).rejects.toThrow('liquidación cerrada');
  expect(client.query.mock.calls.some(([sql]) => /INSERT INTO bi_honorarios_review/.test(sql))).toBe(false);
  expect(client.query).toHaveBeenCalledWith('ROLLBACK');
});
