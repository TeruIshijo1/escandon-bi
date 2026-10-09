'use strict';

jest.mock('../config/pg-db', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../services/sapQueryBuilder.service', () => {
  const access = require('../services/savedReportAccess.service');
  const entity = { id: 'accounts', title: 'Cuentas', source: 'SAP', grain: 'Una fila por cuenta', requiresDateFilter: true,
    fields: [{ key: 'Name', label: 'Nombre', type: 'string' }, { key: 'Balance', label: 'Saldo', type: 'money' }] };
  const definitionFor = id => id === entity.id ? entity : undefined;
  const executeQuery = jest.fn(async () => ({ data: [{ Name: 'FICTICIO', Balance: 4500 }], source: 'SAP', limit: 10000 }));
  return {
    getEntityCatalog: () => [entity], getAssistantCatalog: () => [entity], getEntityDefinition: definitionFor,
    executeQuery, executeSavedQuery: (user, input) => access.executeSavedQuery(user, input, definitionFor, executeQuery),
    getSavedQueries: user => access.getSavedQueries(user, definitionFor), saveQuery: jest.fn(),
    deleteQuery: access.deleteQuery, canAssignSavedReports: access.canAssign,
    getSavedReportRecipients: access.getRecipients,
    hasAssignedReports: access.hasAssignedReports,
    setSavedReportAssignments: (user, id, ids) => access.setAssignments(user, id, ids, definitionFor)
  };
});
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/pg-db');
const service = require('../services/sapQueryBuilder.service');
const app = express();
app.use(express.json());
app.use('/api/sap-query', require('../routes/sapQueryBuilder.routes'));
const admin = { id: 1, username: 'admin_test', role: 'ADMIN', permisos: ['sap-query-accounts'] };
const recipient = { id: 2, username: 'recipient_test', role: 'USUARIO_OPERATIVO', permisos: [] };
const headers = user => ({ Authorization: `Bearer ${jwt.sign({ sub: user.id, username: user.username, role: user.role, permisos: user.permisos }, process.env.JWT_SECRET, { expiresIn: '1h' })}` });
let assigned, active, storedFilters;
const row = actorId => ({ queryid: 7, userid: 1, username: 'admin_test', titulo: 'Reporte delegado', entidad: 'accounts',
  camposseleccionados: ['Name'], filtrosaplicados: storedFilters,
  espublico: 0, isassigned: assigned && active && Number(actorId) === 2 });
beforeEach(() => {
  jest.clearAllMocks(); assigned = true; active = true;
  storedFilters = { fechaDesde: '2026-09-01', fechaHasta: '2026-09-30' };
  service.executeQuery.mockImplementation(async () => ({ data: [{ Name: 'FICTICIO', Balance: 4500 }], source: 'SAP', limit: 10000 }));
  pool.query.mockImplementation(async (query, parameters) => {
    if (query.includes('AS available')) return { rows: [{ available: assigned && active && Number(parameters[0]) === 2 }] };
    if (query.includes('FROM usersapqueries q')) return { rows: [row(parameters[0])] };
    if (query.includes('SELECT a.queryid')) return { rows: [{ queryid: 7, id: 2, username: 'recipient_test', nombre: 'Usuario FICTICIO', activo: 1 }] };
    if (query.startsWith('DELETE FROM usersapqueries')) return { rows: [], rowCount: 0 };
    return { rows: [] };
  });
  pool.connect.mockResolvedValue({ query: async (query, params) => {
    if (query.includes('FROM usersapqueries q')) return { rows: [row(params[0])] };
    if (query.startsWith('SELECT usuarioid')) return { rows: [{ usuarioid: 2 }] };
    if (query.startsWith('DELETE FROM usersapqueryassignments')) assigned = false;
    if (query.startsWith('INSERT INTO usersapqueryassignments')) assigned = params[1].includes(2);
    if (query.startsWith('SELECT a.queryid')) return { rows: assigned ? [{ queryid: 7, id: 2, nombre: 'Usuario FICTICIO', username: 'recipient_test', activo: 1 }] : [] };
    return { rows: [], rowCount: 1 };
  }, release: jest.fn() });
});

test('actual JWT authentication is required for lists, assignments and execution', async () => {
  await request(app).get('/api/sap-query/saved').expect(401);
  await request(app).put('/api/sap-query/saved/7/assignments').send({ userIds: [2] }).expect(401);
  await request(app).post('/api/sap-query/execute').send({ savedQueryId: 7 }).expect(401);
  await request(app).get('/api/sap-query/saved/access').expect(401);
});

test('navigation availability is a noncached boolean tied to the current active recipient', async () => {
  const available = await request(app).get('/api/sap-query/saved/access').set(headers(recipient)).expect(200);
  expect(available.body).toEqual({ ok: true, hasAssignedReports: true });
  expect(available.headers['cache-control']).toBe('no-store');
  assigned = false;
  expect((await request(app).get('/api/sap-query/saved/access').set(headers(recipient)).expect(200)).body.hasAssignedReports).toBe(false);
  assigned = true; active = false;
  expect((await request(app).get('/api/sap-query/saved/access').set(headers(recipient)).expect(200)).body.hasAssignedReports).toBe(false);
});

test('a report-only recipient has no general catalogue or direct source access, but can execute its exact assigned report', async () => {
  const catalog = await request(app).get('/api/sap-query/catalog').set(headers(recipient)).expect(200);
  expect(catalog.body.catalog).toEqual([]);
  const list = await request(app).get('/api/sap-query/saved').set(headers(recipient)).expect(200);
  expect(list.body.queries[0]).toMatchObject({ isAssigned: true, canAssign: false, canDelete: false });
  expect(list.body.queries[0].definition.fields.map(field => field.key)).toEqual(['Name']);
  await request(app).post('/api/sap-query/execute').set(headers(recipient)).send({ entity: 'accounts' }).expect(403);
  const report = await request(app).post('/api/sap-query/execute').set(headers(recipient)).send({ savedQueryId: 7 }).expect(200);
  expect(report.body.data).toEqual([{ Name: 'FICTICIO' }]);
  expect(report.body.columnas.map(field => field.key)).toEqual(['Name']);
  expect(service.executeQuery.mock.calls.at(-1)[0]).toMatchObject({ selectedFields: ['Name'], fechaDesde: '2026-09-01', fechaHasta: '2026-09-30' });
});

test('actual JWT report-only execution uses the immutable stored analysis and checks revocation before returning metric aliases', async () => {
  storedFilters.analysis = { groupBy: ['Name'], measures: [{ op: 'count' }] };
  const engine = require('../services/reportAnalysis.service');
  const definition = service.getEntityDefinition('accounts');
  service.executeQuery.mockImplementation(async options => engine.applyAnalysis(definition,
    { data: [{ Name: 'FICTICIO', Balance: 4500 }], source: 'SAP', limit: options.limit }, options.analysis,
    { selectedFields: options.selectedFields, limit: options.limit }));
  const report = await request(app).post('/api/sap-query/execute').set(headers(recipient)).send({ savedQueryId: 7 }).expect(200);
  expect(report.body.data).toEqual([{ Name: 'FICTICIO', metric_0: 1 }]);
  expect(report.body.columnas.map(column => column.key)).toEqual(['Name', 'metric_0']);
  expect(report.body.analysisScope.complete).toBe(true);
  expect(recipient.permisos).toEqual([]);
  await request(app).post('/api/sap-query/execute').set(headers(recipient))
    .send({ savedQueryId: 7, analysis: { measures: [{ op: 'countDistinct', field: 'Balance' }] } }).expect(400);
  service.executeQuery.mockImplementation(async options => {
    assigned = false;
    return engine.applyAnalysis(definition, { data: [{ Name: 'FICTICIO' }] }, options.analysis,
      { selectedFields: options.selectedFields, limit: options.limit });
  });
  await request(app).post('/api/sap-query/execute').set(headers(recipient)).send({ savedQueryId: 7 }).expect(403);
});

test('recipients cannot change scope, save copies, list users, redistribute or delete someone else\'s report', async () => {
  const auth = headers(recipient);
  await request(app).post('/api/sap-query/execute').set(auth).send({ savedQueryId: 7, selectedFields: ['Balance'] }).expect(400);
  await request(app).post('/api/sap-query/execute').set(auth).send({ savedQueryId: 7, fechaDesde: '2020-01-01' }).expect(400);
  await request(app).post('/api/sap-query/saved').set(auth).send({ title: 'Copy', entity: 'accounts', selectedFields: ['Name'] }).expect(403);
  await request(app).get('/api/sap-query/saved/recipients').set(auth).expect(403);
  await request(app).put('/api/sap-query/saved/7/assignments').set(auth).send({ userIds: [3] }).expect(403);
  await request(app).delete('/api/sap-query/saved/7').set(auth).expect(404);
  expect(service.saveQuery).not.toHaveBeenCalled();
});

test('administrator can revoke the assignment and a still-valid recipient token loses visibility and execution', async () => {
  await request(app).put('/api/sap-query/saved/7/assignments').set(headers(admin)).send({ userIds: [] }).expect(200);
  const list = await request(app).get('/api/sap-query/saved').set(headers(recipient)).expect(200);
  expect(list.body.queries).toEqual([]);
  await request(app).post('/api/sap-query/execute').set(headers(recipient)).send({ savedQueryId: 7 }).expect(403);
});

test('deactivation prevents execution even with the previous JWT and assignment', async () => {
  active = false;
  await request(app).post('/api/sap-query/execute').set(headers(recipient)).send({ savedQueryId: 7 }).expect(403);
  expect(service.executeQuery).not.toHaveBeenCalled();
});

test('director role and unrelated explicit permissions never confer report assignment management', async () => {
  await request(app).put('/api/sap-query/saved/7/assignments')
    .set(headers({ id: 3, username: 'director_test', role: 'DIRECTOR', permisos: ['administracion', 'sap-query-accounts'] }))
    .send({ userIds: [2] }).expect(403);
  expect(pool.connect).not.toHaveBeenCalled();
});
