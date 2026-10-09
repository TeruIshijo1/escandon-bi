'use strict';

jest.mock('../services/aria/handlers/censo.handler', () => jest.fn());
jest.mock('../services/etl.service', () => ({ getInventariosVsCargos: jest.fn() }));
jest.mock('../services/aria/config/intents', () => ({ getSuggestionsForUser: jest.fn(() => []) }));
const census = require('../services/aria/handlers/censo.handler');
const etl = require('../services/etl.service');
const summary = require('../services/aria/handlers/resumen.handler');

beforeEach(() => {
  jest.clearAllMocks();
  census.mockResolvedValue({ kpis: [
    { label: '% Ocupación', value: '25%' }, { label: 'Ocupadas', value: 10 }, { label: 'Total Camas Físicas', value: 40 },
  ] });
  etl.getInventariosVsCargos.mockResolvedValue({ resumen: { diferencias: 3, montoDisputa: 1234 } });
});

test('a greeting with no authorized modules reads neither census nor audit', async () => {
  const result = await summary({ role: 'JEFE_AREA', permisos: [] });
  expect(census).not.toHaveBeenCalled();
  expect(etl.getInventariosVsCargos).not.toHaveBeenCalled();
  expect(result.kpis).toEqual([]);
  expect(result.answer).not.toMatch(/1234|discrepancias|40 camas/);
});

test('an occupancy profile only reads and reports the authorized census block', async () => {
  const result = await summary({ role: 'JEFE_AREA', permisos: ['ia-ocupacion-camas', 'dashboard-ocupacion'] });
  expect(census).toHaveBeenCalledTimes(1);
  expect(etl.getInventariosVsCargos).not.toHaveBeenCalled();
  expect(result.answer).toContain('25%');
  expect(result.kpis).toHaveLength(1);
  expect(result.answer).not.toContain('Auditoría');
});

test('an audit profile without financial permission does not receive the amount in dispute', async () => {
  const result = await summary({ role: 'JEFE_AREA', permisos: ['ia-auditoria-inventarios', 'auditoria-inventarios'] });
  expect(census).not.toHaveBeenCalled();
  expect(etl.getInventariosVsCargos).toHaveBeenCalledTimes(1);
  expect(result.answer).toContain('3 discrepancias');
  expect(result.kpis).toEqual([{ label: 'Discrepancias Auditadas', value: 3 }]);
  expect(result.answer).not.toMatch(/1,234|1234|\$/);
});

test('IA permission alone does not authorize a summary block', async () => {
  await summary({ role: 'JEFE_AREA', permisos: ['ia-ocupacion-camas', 'ia-auditoria-inventarios'] });
  expect(census).not.toHaveBeenCalled();
  expect(etl.getInventariosVsCargos).not.toHaveBeenCalled();
});

test('missing audit figures do not become zero-valued metrics', async () => {
  etl.getInventariosVsCargos.mockResolvedValue({ resumen: { diferencias: null, montoDisputa: null } });
  const result = await summary({ role: 'DIRECTOR' });
  expect(result.answer).toContain('No pude consultar la auditoría');
  expect(result.kpis).toEqual([{ label: 'Ocupación Camas Físicas', value: '25%' }]);
});

test('authorized summary blocks survive partial source failure without fabricated values or raw errors', async () => {
  census.mockRejectedValue(new Error('PGPASSWORD=fictitious'));
  const result = await summary({ role: 'DIRECTOR' });
  expect(result.answer).toContain('No pude consultar la ocupación');
  expect(result.answer).toContain('3 discrepancias');
  expect(result.answer).not.toMatch(/PGPASSWORD|0%|40 camas/);
  expect(result.kpis).toHaveLength(2);
});
