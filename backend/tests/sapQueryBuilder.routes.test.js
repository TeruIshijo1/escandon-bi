'use strict';
const express = require('express');
const request = require('supertest');
const modules = [
  { id: 'inventory', source: 'SAP' }, { id: 'sales_orders', source: 'SAP' },
  { id: 'vertical_accounts', source: 'Vertical' }
];
jest.mock('../services/sapQueryBuilder.service', () => ({
  getEntityCatalog: jest.fn(), getEntityDefinition: jest.fn(), executeQuery: jest.fn(),
  getSavedQueries: jest.fn(), saveQuery: jest.fn()
}));
jest.mock('../middleware/auth.middleware', () => ({ authenticate: (req, _res, next) => {
  req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next();
} }));
const service = require('../services/sapQueryBuilder.service');
const app = express();
app.use(express.json());
app.use('/api/sap-query', require('../routes/sapQueryBuilder.routes'));
const userHeader = user => ({ 'x-test-user': JSON.stringify(user) });
beforeEach(() => {
  jest.clearAllMocks();
  service.getEntityCatalog.mockReturnValue(modules);
  service.getEntityDefinition.mockImplementation(id => modules.find(entity => entity.id === id));
  service.executeQuery.mockResolvedValue({ data: [], totalRegistros: 0 });
  service.saveQuery.mockResolvedValue({ id: 1 });
});

test('granular permissions restrict both SAP and Vertical catalogue/execution', async () => {
  const headers = userHeader({ username: 'staff', role: 'ADMIN', permisos: ['sap-query-vertical_accounts'] });
  const catalog = await request(app).get('/api/sap-query/catalog').set(headers);
  expect(catalog.body.catalog).toEqual([modules[2]]);
  expect((await request(app).post('/api/sap-query/execute').set(headers).send({ entity: 'sales_orders' })).status).toBe(403);
  expect(service.executeQuery).not.toHaveBeenCalled();
  expect((await request(app).post('/api/sap-query/execute').set(headers).send({ entity: 'vertical_accounts' })).status).toBe(200);
});

test('screen-only access retains the existing limited inventory fallback', async () => {
  const response = await request(app).get('/api/sap-query/catalog').set(userHeader({ username: 'staff', permisos: ['mi-area-consultas-service-layer'] }));
  expect(response.body.catalog).toEqual([modules[0]]);
});

test('superadministrator receives every module and default bounded limit', async () => {
  const headers = userHeader({ username: 'amendoza', permisos: [] });
  expect((await request(app).get('/api/sap-query/catalog').set(headers)).body.catalog).toEqual(modules);
  await request(app).post('/api/sap-query/execute').set(headers).send({ entity: 'sales_orders' });
  expect(service.executeQuery.mock.calls[0][0].limit).toBe(10000);
});

test('direct authorized execution forwards analysis but never accepts internal source scopes from the request', async () => {
  const analysis = { predicates: [{ field: 'DocNum', op: 'eq', value: 7 }], measures: [{ op: 'count' }] };
  await request(app).post('/api/sap-query/execute').set(userHeader({ username: 'staff', permisos: ['sap-query-sales_orders'] }))
    .send({ entity: 'sales_orders', analysis, pointLookup: { field: 'PCNum', value: 7 }, searchFields: ['Secret'] }).expect(200);
  expect(service.executeQuery.mock.calls[0][0].analysis).toEqual(analysis);
  expect(service.executeQuery.mock.calls[0][0]).not.toHaveProperty('pointLookup');
  expect(service.executeQuery.mock.calls[0][0]).not.toHaveProperty('searchFields');
});

test('saved templates are only listed and created for authorized modules', async () => {
  const headers = userHeader({ username: 'staff', permisos: ['sap-query-vertical_accounts'] });
  service.getSavedQueries.mockResolvedValue([{ id: 1, entity: 'sales_orders' }, { id: 2, entity: 'vertical_accounts' }]);
  const response = await request(app).get('/api/sap-query/saved').set(headers);
  expect(response.body.queries).toEqual([{ id: 2, entity: 'vertical_accounts' }]);
  expect((await request(app).post('/api/sap-query/saved').set(headers).send({ title: 'No permitido', entity: 'sales_orders' })).status).toBe(403);
  expect((await request(app).post('/api/sap-query/saved').set(headers).send({ title: 'No existe', entity: 'missing' })).status).toBe(400);
  expect(service.saveQuery).not.toHaveBeenCalled();
  expect((await request(app).post('/api/sap-query/saved').set(headers).send({ title: 'Permitido', entity: 'vertical_accounts' })).status).toBe(200);
});

test('assistant resources stay outside manual themes and lose execution/template access when any source grant is removed', async () => {
  const hidden = { id: 'assistant-combination', assistantOnly: true, source: 'SAP + Vertical',
    requiredPermissions: ['vertical_accounts', 'customers'], fields: [{ key: 'Balance', label: 'Saldo' }] };
  service.getAssistantCatalog = jest.fn(() => [...modules, hidden]);
  service.getEntityDefinition.mockImplementation(id => [...modules, hidden].find(entity => entity.id === id));
  const full = userHeader({ username: 'staff', permisos: ['sap-query-vertical_accounts', 'sap-query-customers'] });
  const partial = userHeader({ username: 'staff', permisos: ['sap-query-vertical_accounts', 'sap-query-assistant-combination'] });
  const response = await request(app).get('/api/sap-query/catalog').set(full);
  expect(response.body.catalog).toEqual([modules[2]]);
  expect(response.body.assistantCatalog).toContainEqual(hidden);
  const denied = await request(app).get('/api/sap-query/catalog').set(partial);
  expect(denied.body.assistantCatalog).not.toContainEqual(hidden);
  await request(app).post('/api/sap-query/execute').set(partial).send({ entity: hidden.id }).expect(403);
  await request(app).post('/api/sap-query/saved').set(partial).send({ title: 'No permitido', entity: hidden.id }).expect(403);
  service.getSavedQueries.mockResolvedValue([{ id: 9, entity: hidden.id }]);
  expect((await request(app).get('/api/sap-query/saved').set(partial)).body.queries).toEqual([]);
  await request(app).post('/api/sap-query/execute').set(full).send({ entity: hidden.id }).expect(200);
});
