'use strict';
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
jest.mock('../config/remote-db', () => ({ connectRemoteDB: jest.fn() }));
jest.mock('../services/honorariosCatalog.service', () => ({ readCatalogExport: jest.fn() }));
const catalog = require('../services/honorariosCatalog.service');
const remote = require('../config/remote-db');
const app = express(); app.use(express.json()); app.use('/api/honorarios', require('../routes/honorarios.routes'));
const auth = (permisos = ['interconsultas-jornadas']) => ({ Authorization: `Bearer ${jwt.sign({ sub: 42,
  username: 'staff', role: 'ADMIN', permisos }, process.env.JWT_SECRET)}` });
beforeEach(() => jest.clearAllMocks());

test('catalog export requires the Honorarios permission before reading any data', async () => {
  await request(app).get('/api/honorarios/catalog/export-data').expect(401);
  await request(app).get('/api/honorarios/catalog/export-data').set(auth([])).expect(403);
  expect(catalog.readCatalogExport).not.toHaveBeenCalled();
  expect(remote.connectRemoteDB).not.toHaveBeenCalled();
});

test('catalog export forwards the current filters and returns one snapshot without a Vertical connection', async () => {
  const snapshot = { items: [{ itemCode: 'SER1471', status: 'INCLUIDO', approvalStatus: 'APROBADO',
    tariffs: [{ amount: 250, providerId: '7', role: 'AN', active: false }] }], snapshotAt: '2026-10-08T18:00:00.000Z' };
  catalog.readCatalogExport.mockResolvedValue(snapshot);
  const response = await request(app).get('/api/honorarios/catalog/export-data')
    .query({ search: 'Consulta', approvalStatus: 'APROBADO', status: 'INCLUIDO', includeInactive: 'false' })
    .set(auth()).expect(200);
  expect(response.body).toEqual({ ok: true, ...snapshot });
  expect(response.headers['cache-control']).toBe('no-store');
  expect(catalog.readCatalogExport).toHaveBeenCalledTimes(1);
  expect(catalog.readCatalogExport).toHaveBeenCalledWith({ search: 'Consulta', approvalStatus: 'APROBADO',
    status: 'INCLUIDO', includeInactive: 'false' });
  expect(remote.connectRemoteDB).not.toHaveBeenCalled();
});
