'use strict';
const { dateRange, monthRange, periodRange, hospitalToday } = require('../services/statisticsCommon');

test('rango incluye el último día completo, incluso fin de año y febrero bisiesto', () => {
  expect(dateRange('2026-12-01', '2026-12-31').endExclusive).toBe('2027-01-01');
  expect(monthRange(2028, 2).endDate).toBe('2028-02-29');
});

test('rechaza inyección, fechas imposibles, rangos invertidos y excesivos', () => {
  for (const [start, end] of [["2026-07-01' OR 1=1--", '2026-07-31'], ['2026-02-30', '2026-03-01'], ['2026-08-01', '2026-07-31'], ['2026-04-01', '2027-05-01']]) {
    expect(() => dateRange(start, end)).toThrow();
  }
  expect(() => monthRange('2026 OR 1=1', 7)).toThrow();
  expect(() => monthRange(2026, '7abc')).toThrow();
});

test('el histórico agregado no se ofrece como detalle completo', () => {
  expect(() => dateRange('2026-03-01', '2026-04-30')).toThrow(/detalle/);
});

test('periodos usan calendario hospitalario y no el mes móvil ni la fecha UTC del servidor', () => {
  const now = new Date('2026-10-01T02:00:00Z');
  expect(hospitalToday(now)).toBe('2026-09-30');
  expect(periodRange('mes', now)).toEqual({ startDate: '2026-09-01', endDate: '2026-09-30', endExclusive: '2026-10-01' });
  expect(periodRange('trimestre', now).startDate).toBe('2026-07-01');
});
