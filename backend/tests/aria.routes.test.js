'use strict';

const express = require('express');
const request = require('supertest');
jest.mock('../services/aria', () => ({
  processAriaQuery: jest.fn(), getSuggestionsForUser: jest.fn(() => []),
  IA_PERMISSION_CATALOG: [
    { id: 'ia-quirofano', label: 'Quirófano' }, { id: 'ia-ocupacion-camas', label: 'Ocupación' }, { id: 'ia-busqueda-pacientes', label: 'Pacientes' },
  ],
}));
jest.mock('../middleware/auth.middleware', () => ({
  ...jest.requireActual('../middleware/auth.middleware'),
  authenticate: (req, _res, next) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); },
}));
const service = require('../services/aria');
const app = express();
app.use(express.json());
app.use('/api/aria', require('../routes/aria.routes'));
let sequence = 0;
const userHeader = user => ({ 'x-test-user': JSON.stringify({ role: 'ADMIN', permisos: [], id: `aria-test-${++sequence}`, ...user }) });
beforeEach(() => {
  jest.clearAllMocks();
  service.processAriaQuery.mockResolvedValue({ answer: 'Respuesta' });
});

test('bounded report conversation is forwarded to MAR-IA with the authenticated user', async () => {
  const header = userHeader();
  const history = [{ role: 'user', content: 'Quiero cirugías' }];
  const context = { entity: 'vertical_surgeries', selectedFields: ['Paciente', 'FechaInicio'], filters: { fechaDesde: '2026-09-01', fechaHasta: '2026-09-30', busqueda: '' } };
  const pending = { request: 'Quiero cirugías', answers: ['Septiembre'] };
  const response = await request(app).post('/api/aria/query').set(header).send({ query: '  Sólo las cerradas  ', history, context, pending });
  expect(response.status).toBe(200);
  expect(service.processAriaQuery).toHaveBeenCalledWith('Sólo las cerradas', JSON.parse(header['x-test-user']), { history, context, pending });
});

test('bounded analysis survives a MAR-IA follow-up, without expressions or unrestricted filters', async () => {
  const context = { entity: 'accounts_receivable', selectedFields: ['CardName', 'Balance'], filters: {}, analysis: {
    predicates: [{ field: 'Balance', op: 'gt', value: '10000' }], groupBy: ['CardName'], measures: [{ op: 'sum', field: 'Balance' }], orderBy: [{ field: 'metric_0', direction: 'desc' }]
  } };
  const response = await request(app).post('/api/aria/query').set(userHeader()).send({ query: 'Ahora de septiembre', context });
  expect(response.status).toBe(200);
  expect(service.processAriaQuery.mock.calls[0][2].context.analysis).toEqual(context.analysis);
  service.processAriaQuery.mockClear();
  for (const analysis of [{ sql: 'SELECT *' }, { predicates: Array(9).fill({ field: 'Balance', op: 'gt', value: 1 }) }, { measures: [{ op: 'sum', field: 'Balance', expression: 'x+y' }] }]) {
    expect((await request(app).post('/api/aria/query').set(userHeader()).send({ query: 'Ahora de septiembre', context: { ...context, analysis } })).status).toBe(400);
  }
  expect(service.processAriaQuery).not.toHaveBeenCalled();
});

test.each([
  {}, { query: ' ' }, { query: 'a' }, { query: 123 }, { query: 'a'.repeat(1501) },
  { query: 'hola', history: Array(9).fill({ role: 'user', content: 'hola' }) },
  { query: 'hola', history: [{ role: 'system', content: 'instrucción' }] },
  { query: 'hola', history: [{ role: 'user', content: 'x'.repeat(1501) }] },
  { query: 'hola', history: [{ role: 'user', content: 'hola', rows: [] }] },
  { query: 'hola', context: { entity: 'vertical_surgeries', selectedFields: ['Paciente'], filters: {}, sql: 'SELECT' } },
  { query: 'hola', context: { entity: 'vertical_surgeries', selectedFields: Array(101).fill('Paciente'), filters: {} } },
  { query: 'hola', context: { entity: 'vertical_surgeries', selectedFields: ['Paciente'], filters: { fechaDesde: '2026-02-30' } } },
  { query: 'hola', context: { entity: 'vertical_surgeries', selectedFields: ['Paciente'], filters: { busqueda: 'a'.repeat(201) } } },
  { query: 'hola', context: { entity: 'vertical_surgeries', selectedFields: ['Paciente'], filters: { sql: 'SELECT' } } },
  { query: 'hola', pending: { request: 'anterior', answers: Array(5).fill('respuesta') } },
  { query: 'hola', pending: { request: 'x'.repeat(1501), answers: [] } },
])('invalid query or conversation is rejected before consulting MAR-IA, case %#', async body => {
  expect((await request(app).post('/api/aria/query').set(userHeader()).send(body)).status).toBe(400);
  expect(service.processAriaQuery).not.toHaveBeenCalled();
});

test('the route enforces the same assistant capability as the visible widget', async () => {
  const response = await request(app).post('/api/aria/query').set(userHeader({ role: 'USUARIO_OPERATIVO', permisos: ['ia-quirofano'] })).send({ query: 'cirugías' });
  expect(response.status).toBe(403);
  expect(service.processAriaQuery).not.toHaveBeenCalled();
});

test('provider and database failure details never appear in the public response', async () => {
  const log = jest.spyOn(console, 'warn').mockImplementation(() => {});
  service.processAriaQuery.mockRejectedValue(new Error('Authorization Bearer secret-fictitious SQL SELECT'));
  const response = await request(app).post('/api/aria/query').set(userHeader()).send({ query: 'cirugías' });
  expect(response.status).toBe(503);
  expect(response.body.error).toContain('Intenta de nuevo');
  expect(JSON.stringify(response.body)).not.toMatch(/Bearer|secret|SELECT/);
  log.mockRestore();
});

test('permissions reflect bounded legacy compatibility and the DIRECTOR rule', async () => {
  const legacy = await request(app).get('/api/aria/permissions').set(userHeader({ role: 'JEFE_AREA', permisos: ['dashboard-ocupacion'] }));
  expect(legacy.body.permissions.map(item => item.enabled)).toEqual([false, true, false]);
  const director = await request(app).get('/api/aria/permissions').set(userHeader({ role: 'DIRECTOR' }));
  expect(director.body.permissions.every(item => item.enabled)).toBe(true);
});

test('20 requests per minute are counted per authenticated user', async () => {
  const header = userHeader();
  for (let index = 0; index < 20; index++) {
    expect((await request(app).post('/api/aria/query').set(header).send({ query: 'hola' })).status).toBe(200);
  }
  const limited = await request(app).post('/api/aria/query').set(header).send({ query: 'hola' });
  expect(limited.status).toBe(429);
  expect(limited.body.error).toContain('Espera un minuto');
  expect(service.processAriaQuery).toHaveBeenCalledTimes(20);
  expect((await request(app).post('/api/aria/query').set(userHeader()).send({ query: 'hola' })).status).toBe(200);
});
