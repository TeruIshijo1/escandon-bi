'use strict';

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
jest.mock('../config/remote-db', () => ({ connectRemoteDB: jest.fn(async () => ({})) }));
jest.mock('../services/honorariosLiquidation.service', () => ({ closeLiquidation: jest.fn() }));
jest.mock('../services/honorariosAvailablePaymentReport.service', () => ({ getAvailablePaymentReport: jest.fn() }));
jest.mock('../services/honorariosSapReconciliation.service', () => ({ reconcileHonorariosWithSap: jest.fn() }));
jest.mock('../services/honorariosCoverage.service', () => ({ getClinicalProviderDirectory: jest.fn(async () => []) }));
const liquidation = require('../services/honorariosLiquidation.service');
const available = require('../services/honorariosAvailablePaymentReport.service');
const sap = require('../services/honorariosSapReconciliation.service');
const remote = require('../config/remote-db');
const coverage = require('../services/honorariosCoverage.service');
const app = express();
app.use(express.json());
app.use('/api/honorarios', require('../routes/honorarios.routes'));
const authorization = `Bearer ${jwt.sign({ sub: 42, username: 'staff', role: 'ADMIN',
  permisos: ['interconsultas-jornadas'] }, process.env.JWT_SECRET)}`;
const input = { startDate: '2026-08-01', endDate: '2026-08-31', providerId: '23', confirmed: true, reason: 'Periodo revisado' };

beforeEach(() => jest.clearAllMocks());

test('authenticated staff can read a fiscal-pending PDF without creating a liquidation or loading SAP', async () => {
  const report = { version: 1, status: 'FISCAL_PENDING', period: { startDate: input.startDate, endDate: input.endDate } };
  available.getAvailablePaymentReport.mockResolvedValue(report);
  const response = await request(app).post('/api/honorarios/available-payment-report')
    .set('Authorization', authorization).send(input).expect(200);
  expect(response.body).toEqual({ ok: true, report });
  expect(response.headers['cache-control']).toBe('no-store');
  expect(available.getAvailablePaymentReport).toHaveBeenCalledWith({}, input);
  expect(liquidation.closeLiquidation).not.toHaveBeenCalled();
  expect(sap.reconcileHonorariosWithSap).not.toHaveBeenCalled();
});

test('available reports keep authentication and approved-source validation errors', async () => {
  await request(app).post('/api/honorarios/available-payment-report').send(input).expect(401);
  expect(available.getAvailablePaymentReport).not.toHaveBeenCalled();
  available.getAvailablePaymentReport.mockRejectedValue(Object.assign(new Error('Cambió el servicio aprobado. Actualiza.'), { status: 409 }));
  const response = await request(app).post('/api/honorarios/available-payment-report')
    .set('Authorization', authorization).send(input).expect(409);
  expect(response.body.error).toBe('Cambió el servicio aprobado. Actualiza.');
  expect(liquidation.closeLiquidation).not.toHaveBeenCalled();
});

test('fiscal-only SAP reads avoid the clinical directory and preserve the typed timeout response', async () => {
  sap.reconcileHonorariosWithSap.mockRejectedValue(Object.assign(new Error('SAP tardó demasiado en responder.'), { status: 504 }));
  const response = await request(app).post('/api/honorarios/sap-reconciliation').set('Authorization', authorization)
    .send({ ...input, doctors: ['MEDICO DE PRUEBA'], scope: 'fiscal' }).expect(504);
  expect(sap.reconcileHonorariosWithSap).toHaveBeenCalledWith({ startDate: input.startDate, endDate: input.endDate,
    doctors: ['MEDICO DE PRUEBA'], clinicalDirectory: [], includeAdditional: false, scope: 'fiscal' });
  expect(remote.connectRemoteDB).not.toHaveBeenCalled();
  expect(coverage.getClinicalProviderDirectory).not.toHaveBeenCalled();
  expect(response.body.error).toContain('permanece disponible');
});

test('a fiscal timeout explicitly confirmed before closure permits a safe manual retry', async () => {
  liquidation.closeLiquidation.mockRejectedValue(Object.assign(new Error('SAP no respondió a tiempo. Intenta de nuevo.'),
    { status: 504, preparationStatus: 'NOT_CREATED' }));
  const response = await request(app).post('/api/honorarios/liquidations').set('Authorization', authorization).send(input).expect(504);
  expect(response.body).toEqual({ ok: false, error: 'SAP no respondió a tiempo. Intenta de nuevo.', preparationStatus: 'NOT_CREATED' });
  expect(liquidation.closeLiquidation).toHaveBeenCalledTimes(1);
});

test('an unconfirmed server failure never promises that the payment was not prepared', async () => {
  liquidation.closeLiquidation.mockRejectedValue(new Error('private diagnostic detail'));
  const response = await request(app).post('/api/honorarios/liquidations').set('Authorization', authorization).send(input).expect(503);
  expect(response.body.preparationStatus).toBeUndefined();
  expect(JSON.stringify(response.body)).not.toContain('private diagnostic detail');
});

test('a browser cannot claim a preparation was not created or trigger an automatic retry', async () => {
  liquidation.closeLiquidation.mockRejectedValue(Object.assign(new Error('SAP no respondió a tiempo.'), { status: 504 }));
  const response = await request(app).post('/api/honorarios/liquidations').set('Authorization', authorization)
    .send({ ...input, preparationStatus: 'NOT_CREATED' }).expect(504);
  expect(response.body.preparationStatus).toBeUndefined();
  expect(liquidation.closeLiquidation).toHaveBeenCalledTimes(1);
});
