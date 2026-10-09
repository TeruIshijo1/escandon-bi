'use strict';

jest.mock('../config/pg-db', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../services/sap.service', () => ({ get: jest.fn(), post: jest.fn(), _request: jest.fn() }));
jest.mock('../services/sapInventory.service', () => ({ ensureInventoryData: jest.fn(), getInventoryCache: jest.fn(() => []), getBatchesCache: jest.fn(() => []) }));
jest.mock('../services/assistantAccountFinance.service', () => ({ ...jest.requireActual('../services/assistantAccountFinance.service'), execute: jest.fn() }));
jest.mock('../services/verticalReportCatalog.service', () => ({ ...jest.requireActual('../services/verticalReportCatalog.service'), execute: jest.fn() }));
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/pg-db');
const finance = require('../services/assistantAccountFinance.service');
const vertical = require('../services/verticalReportCatalog.service');
const app = express();
app.use(express.json());
app.use('/api/sap-query', require('../routes/sapQueryBuilder.routes'));
const entity = 'assistant_account_case';
const permits = ['vertical_accounts', 'sales_invoice_summary', 'incoming_payments', 'vertical_account_charges'].map(key => `sap-query-${key}`);
const recipient = { id: 2, username: 'RECIPIENT_FICTICIO', role: 'USUARIO_OPERATIVO', permisos: [] };
const full = { id: 1, username: 'CREATOR_FICTICIO', role: 'ADMIN', permisos: permits };
const headers = user => ({ Authorization: `Bearer ${jwt.sign({ sub: user.id, username: user.username, role: user.role, permisos: user.permisos }, process.env.JWT_SECRET, { expiresIn: '1h' })}` });
const selectedFields = ['PatientName', 'BillingStatus', 'ItemDescription'];
const analysis = { predicates: [{ field: 'PCNum', op: 'eq', value: 7 }] };
let assigned;
beforeEach(() => {
  jest.clearAllMocks(); assigned = true;
  finance.execute.mockResolvedValue({ rows: [{ PCNum: 7, PTNum: 42, PatientName: 'Paciente FICTICIO', AccountBalance: 200, BillingStatus: 'Con factura' }], truncated: false });
  vertical.execute.mockResolvedValue({ rows: [{ PCNum: 7, PCITNum: 10, ItemCode: 'A', ItemDescription: 'Insumo FICTICIO', Quantity: 2, UnitPrice: 4.5 }], truncated: false });
  pool.query.mockImplementation(async (query, params) => query.includes('FROM usersapqueries q') ? { rows: [{ queryid: 7, userid: 1,
    username: full.username, titulo: 'CASO FICTICIO', entidad: entity, camposseleccionados: selectedFields,
    filtrosaplicados: { analysis, busqueda: 'FICTICIO', limit: 20 }, isassigned: assigned && Number(params[0]) === recipient.id, espublico: 0 }] } : { rows: [] });
});

test('actual JWT is required and three financial grants do not authorize reading the fourth charge resource', async () => {
  await request(app).post('/api/sap-query/execute').send({ entity, selectedFields, analysis }).expect(401);
  for (const removed of permits) {
    const user = { ...full, permisos: permits.filter(permission => permission !== removed) };
    await request(app).post('/api/sap-query/execute').set(headers(user)).send({ entity, selectedFields, analysis }).expect(403);
  }
  expect(finance.execute).not.toHaveBeenCalled();
  expect(vertical.execute).not.toHaveBeenCalled();
});

test('all origin grants and a validated exact folio allow one bounded combined report without dates', async () => {
  const response = await request(app).post('/api/sap-query/execute').set(headers(full)).send({ entity, selectedFields, analysis }).expect(200);
  expect(response.body.data).toEqual([{ PatientName: 'Paciente FICTICIO', BillingStatus: 'Con factura', ItemDescription: 'Insumo FICTICIO' }]);
  expect(response.body.columnas.map(field => field.key)).toEqual(selectedFields);
  expect(finance.execute.mock.calls[0][1]).toMatchObject({ pointLookup: { field: 'PCNum', value: 7 }, limit: 10000 });
  await request(app).post('/api/sap-query/execute').set(headers(full)).send({ entity, pointLookup: { field: 'PCNum', value: 7 } }).expect(400);
  expect(finance.execute).toHaveBeenCalledTimes(1);
});

test('a report-only JWT executes the fixed case and cannot replace its search, identity, plan, source or columns', async () => {
  const catalog = await request(app).get('/api/sap-query/catalog').set(headers(recipient)).expect(200);
  expect(catalog.body.catalog).toEqual([]);
  expect(catalog.body.assistantCatalog).toEqual([]);
  const result = await request(app).post('/api/sap-query/execute').set(headers(recipient)).send({ savedQueryId: 7, limit: 1 }).expect(200);
  expect(result.body.data).toEqual([{ PatientName: 'Paciente FICTICIO', BillingStatus: 'Con factura', ItemDescription: 'Insumo FICTICIO' }]);
  expect(result.body.analysisScope.complete).toBe(true);
  expect(result.body).not.toHaveProperty('rawRows');
  for (const override of [{ busqueda: '' }, { analysis: { predicates: [{ field: 'PCNum', op: 'eq', value: 8 }] } },
    { entity: 'vertical_accounts' }, { selectedFields: ['AccountBalance'] }, { pointLookup: { field: 'PCNum', value: 8 } }]) {
    await request(app).post('/api/sap-query/execute').set(headers(recipient)).send({ savedQueryId: 7, ...override }).expect(400);
  }
  expect(finance.execute).toHaveBeenCalledTimes(1);
  expect(recipient.permisos).toEqual([]);
});

test('an assignment revoked while reading the case is checked again before any patient or charge result is returned', async () => {
  vertical.execute.mockImplementation(async () => { assigned = false; return { rows: [{ PCNum: 7, PCITNum: 10 }], truncated: false }; });
  const result = await request(app).post('/api/sap-query/execute').set(headers(recipient)).send({ savedQueryId: 7 }).expect(403);
  expect(result.body).not.toHaveProperty('data');
  expect(result.body).not.toHaveProperty('columnas');
});
