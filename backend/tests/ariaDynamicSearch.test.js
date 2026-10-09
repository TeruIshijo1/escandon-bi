'use strict';

jest.mock('../config/remote-db', () => ({ getRemoteDb: jest.fn() }));
jest.mock('../services/aria/handlers/quirofano.handler', () => ({ queryCirugiasDelMomento: jest.fn() }));
jest.mock('../services/aria/handlers/almacen.handler', () => ({ queryTrasladosAlmacen: jest.fn(), queryKardexAlmacen: jest.fn() }));
jest.mock('../services/aria/handlers/recetas.handler', () => ({ queryRecetasPendientes: jest.fn(), queryLibroControlados: jest.fn() }));
jest.mock('../services/aria/handlers/resumen.handler', () => jest.fn());
jest.mock('../services/aria/config/intents', () => ({ getSuggestionsForUser: jest.fn(() => []), IA_PERMISSION_CATALOG: [] }));
const { getRemoteDb } = require('../config/remote-db');
const { queryCirugiasDelMomento } = require('../services/aria/handlers/quirofano.handler');
const { queryTrasladosAlmacen, queryKardexAlmacen } = require('../services/aria/handlers/almacen.handler');
const { queryRecetasPendientes, queryLibroControlados } = require('../services/aria/handlers/recetas.handler');
const search = require('../services/aria/core/dynamicSearch');

beforeEach(() => jest.clearAllMocks());

test.each([
  ['cirugías recientes', 'ia-quirofano', 'quirofano-agenda', queryCirugiasDelMomento],
  ['traslados', 'ia-almacen', 'almacen-traslados', queryTrasladosAlmacen],
  ['kardex', 'ia-almacen', 'almacen-reportes', queryKardexAlmacen],
  ['recetas pendientes', 'ia-farmacia', 'farmacia-inventario', queryRecetasPendientes],
  ['controlados', 'ia-farmacia', 'farmacia-inventario', queryLibroControlados],
])('the %s redirect requires both its IA and section permission', async (query, permission, section, handler) => {
  for (const permisos of [[], [permission], ['ia-calidad-datos', section]]) {
    expect((await search(query, { role: 'JEFE_AREA', permisos })).topic).toBe('Acceso Restringido');
  }
  expect(handler).not.toHaveBeenCalled();
  expect(getRemoteDb).not.toHaveBeenCalled();
  handler.mockResolvedValue({ answer: 'Respuesta autorizada' });
  expect(await search(query, { role: 'JEFE_AREA', permisos: [permission, section] })).toEqual({ answer: 'Respuesta autorizada' });
  expect(handler).toHaveBeenCalledTimes(1);
});

test('denied free searches do not connect to a database', async () => {
  expect((await search('buscar apellido ejemplo', { role: 'JEFE_AREA', permisos: [] })).topic).toBe('Acceso Restringido');
  expect(getRemoteDb).not.toHaveBeenCalled();
});

test('supply searches omit patient, doctor and financial fields from SQL and response', async () => {
  const dbRequest = { input: jest.fn(), query: jest.fn().mockResolvedValue({ recordset: [
    { Paciente: 'PACIENTE SENSIBLE', Medico: 'MEDICO SENSIBLE', Monto: 99999, Area: 'Área', Insumo: 'Insumo autorizado', Cantidad: 2, Fecha: '2026-10-08' },
  ] }) };
  getRemoteDb.mockResolvedValue({ request: () => dbRequest });
  const response = await search('última aguja', { role: 'JEFE_AREA', permisos: ['ia-busqueda-insumos'] });
  const sql = dbRequest.query.mock.calls[0][0];
  expect(sql).toContain('NULL AS Paciente');
  expect(sql).toContain('NULL AS Medico');
  expect(sql).toContain('0       AS Monto');
  expect(response.table.headers).toEqual(['Fecha', 'Área', 'Insumo / Servicio']);
  expect(JSON.stringify(response)).not.toMatch(/PACIENTE SENSIBLE|MEDICO SENSIBLE|99999/);
  expect(JSON.stringify(response)).toContain('Insumo autorizado');
});

test('database errors never appear in the public fallback response', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  getRemoteDb.mockRejectedValue(new Error('SQL Server password=fictitious UDR_CUENTAS_SERVICIOS'));
  const response = await search('aguja', { role: 'JEFE_AREA', permisos: ['ia-busqueda-insumos'] });
  expect(response.answer).toContain('Intenta de nuevo');
  expect(JSON.stringify(response)).not.toMatch(/SQL Server|password|UDR_/);
  log.mockRestore();
});
