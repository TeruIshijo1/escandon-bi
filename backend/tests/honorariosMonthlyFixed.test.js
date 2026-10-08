'use strict';

jest.mock('../config/db', () => ({ getDb: () => ({ pool: { query: jest.fn() } }) }));
const monthly = require('../services/honorariosMonthlyFixed.service');
const config = { expectedRevision: 0, providerId: 7, area: 'Cardiología', amount: 5000,
  amountBasis: 'BASE', monthPolicy: 'FULL_MONTH', validFromMonth: '2026-09', validToMonth: null };

test.each([0, -1, 0.001, 5000.123, Number.NaN, '5000'])('rejects an invalid or sub-cent monthly amount (%s)', amount => {
  expect(() => monthly.validateAssignment({ ...config, amount })).toThrow();
});
test.each([{ amountBasis: 'NET' }, { monthPolicy: 'PRORATED' }, { providerId: '7abc' },
  { validFromMonth: '2026-13' }, { validToMonth: '2026-08' }])('rejects unsupported strategy or ambiguous identity/validity %p', changes => {
  expect(() => monthly.validateAssignment({ ...config, ...changes })).toThrow();
});
test('a prospective withdrawal preserves earlier months and occupies those months for overlap checks', () => {
  const withdrawn = { ...config, providerId: '7', active: false, deactivatedFromMonth: '2026-11' };
  expect(monthly.applies(withdrawn, '2026-10')).toBe(true);
  expect(monthly.applies(withdrawn, '2026-11')).toBe(false);
  expect(monthly.overlaps(withdrawn, { ...config, providerId: '7', active: true, validFromMonth: '2026-10' })).toBe(true);
  expect(monthly.overlaps(withdrawn, { ...config, providerId: '7', active: true, validFromMonth: '2026-11' })).toBe(false);
  expect(monthly.applies({ ...withdrawn, deactivatedFromMonth: null }, '2026-10')).toBe(false);
});
test('snapshot signatures survive JSONB key reordering but detect changed values and configured months', () => {
  const snapshot = monthly.actualMonthlySnapshot({ ...config, id: 1, providerId: '7', providerName: 'MÉDICO FICTICIO',
    revision: 2, updatedBy: 'REVISOR FICTICIO' }, '2026-09');
  const reordered = Object.fromEntries(Object.entries(snapshot).reverse());
  expect(monthly.fixedFingerprint(reordered)).toBe(monthly.fixedFingerprint(snapshot));
  expect(monthly.fixedFingerprint({ ...snapshot, amount: 5001 })).not.toBe(monthly.fixedFingerprint(snapshot));
  expect(monthly.fixedFingerprint({ ...snapshot, month: '2026-10' })).not.toBe(monthly.fixedFingerprint(snapshot));
});
