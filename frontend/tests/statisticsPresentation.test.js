import test from 'node:test';
import assert from 'node:assert/strict';
import { statisticsDownloadError, statisticsNumber, statisticsSummary, formatStatistic, formatStatisticsSummary, previousStatisticsMonth, validateStatisticsPeriod } from '../src/utils/statisticsPresentation.js';

test('download distinguishes outdated backend and unavailable service even without JSON', () => {
  assert.match(statisticsDownloadError(404, null), /Reinicia la aplicación BI/);
  for (const status of [502, 503, 504]) assert.match(statisticsDownloadError(status, null), /Espera un momento/);
  assert.equal(statisticsDownloadError(403, { error: 'No tienes permiso para exportar.' }), 'No tienes permiso para exportar.');
  assert.match(statisticsDownloadError(200, null), /No se pudo generar/);
});

test('missing values remain unavailable while confirmed zero remains zero', () => {
  for (const value of [null, undefined, '', ' ', false, [], {}, 'unknown', Infinity]) assert.equal(statisticsNumber(value), null);
  assert.equal(statisticsNumber(0), 0);
  assert.equal(formatStatistic(null), 'No disponible');
  assert.equal(formatStatistic(0), '0');
});

test('partly missing periods cannot be presented as complete totals', () => {
  assert.deepEqual(statisticsSummary([0, 3]), { value: 3, partial: false });
  assert.deepEqual(statisticsSummary([null, undefined]), { value: null, partial: false });
  assert.equal(formatStatisticsSummary(statisticsSummary([4, null, 2])), 'Parcial: 6');
  assert.equal(formatStatisticsSummary(statisticsSummary([null])), 'No disponible');
});

test('default month follows Mexico dates including UTC month boundaries', () => {
  assert.deepEqual(previousStatisticsMonth(new Date('2026-10-07T15:00:00Z')), { startDate: '2026-09-01', endDate: '2026-09-30' });
  assert.deepEqual(previousStatisticsMonth(new Date('2026-10-01T01:00:00Z')), { startDate: '2026-08-01', endDate: '2026-08-31' });
});

test('complete report validates coverage, inclusive date range and impossible dates', () => {
  assert.equal(validateStatisticsPeriod('2026-09-01', '2026-09-30', '2026-10-07'), '');
  assert.equal(validateStatisticsPeriod('2026-09-30', '2026-09-30', '2026-10-07'), '');
  for (const [start, end] of [['2026-02-30', '2026-03-01'], ['2026-03-31', '2026-04-01'], ['2026-09-30', '2026-09-01'], ['2026-09-30', '2026-10-08']]) {
    assert.ok(validateStatisticsPeriod(start, end, '2026-10-07'));
  }
  assert.equal(validateStatisticsPeriod('2026-04-01', '2027-04-01', '2027-05-01'), '');
  assert.ok(validateStatisticsPeriod('2026-04-01', '2027-04-02', '2027-05-01'));
});
