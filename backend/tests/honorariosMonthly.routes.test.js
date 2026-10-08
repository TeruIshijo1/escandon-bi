'use strict';
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
jest.mock('../config/remote-db', () => ({ connectRemoteDB: jest.fn(async () => ({})) }));
jest.mock('../services/honorariosMonthlyFixed.service', () => ({
  getPeriodRows: jest.fn(async () => []), readMonthlyReviews: jest.fn(async () => ({})),
  listAssignments: jest.fn(async () => []), saveAssignment: jest.fn(), saveMonthlyReview: jest.fn()
}));
jest.mock('../services/honorariosReview.service', () => ({
  canReview: user => String(user?.username || '').toLowerCase() === 'amendoza' || user?.permisos?.includes('interconsultas-jornadas') === true,
  ensureTables: jest.fn(async () => {}), readReviews: jest.fn(async () => ({})), saveReview: jest.fn()
}));
const monthly = require('../services/honorariosMonthlyFixed.service');
const reviews = require('../services/honorariosReview.service');
const remote = require('../config/remote-db');
const app = express(); app.use(express.json()); app.use('/api/honorarios', require('../routes/honorarios.routes'));
const auth = (permisos = ['interconsultas-jornadas']) => ({ Authorization: `Bearer ${jwt.sign({ sub: 42,
  username: 'staff', role: 'ADMIN', permisos }, process.env.JWT_SECRET)}` });
beforeEach(() => {
  jest.clearAllMocks(); monthly.listAssignments.mockResolvedValue([]); monthly.readMonthlyReviews.mockResolvedValue({});
  reviews.readReviews.mockResolvedValue({}); monthly.saveAssignment.mockResolvedValue({ id: 4 });
  monthly.saveMonthlyReview.mockResolvedValue({ action: 'APROBAR', revision: 1 });
});

test('monthly configuration uses the existing Honorarios permission for both reading and editing', async () => {
  for (const method of ['get', 'post', 'put']) {
    const route = method === 'put' ? '/monthly-fixed/4' : '/monthly-fixed';
    await request(app)[method]('/api/honorarios' + route).expect(401);
    await request(app)[method]('/api/honorarios' + route).set(auth([])).send({}).expect(403);
  }
  expect(monthly.listAssignments).not.toHaveBeenCalled(); expect(monthly.saveAssignment).not.toHaveBeenCalled();
  expect(remote.connectRemoteDB).not.toHaveBeenCalled();
});

test('monthly configuration reads locally and saves against the existing provider directory service', async () => {
  const list = await request(app).get('/api/honorarios/monthly-fixed').set(auth()).expect(200);
  expect(list.body).toEqual({ ok: true, assignments: [], canManage: true });
  expect(remote.connectRemoteDB).not.toHaveBeenCalled();
  const body = { providerId: 7, area: 'Urgencias', amount: 1000, amountBasis: 'BASE',
    monthPolicy: 'FULL_MONTH', validFromMonth: '2026-09', validToMonth: null, active: true, expectedRevision: 0 };
  await request(app).post('/api/honorarios/monthly-fixed').set(auth()).send(body).expect(200);
  expect(monthly.saveAssignment).toHaveBeenLastCalledWith({}, { ...body, id: undefined }, expect.objectContaining({ id: 42 }));
  await request(app).put('/api/honorarios/monthly-fixed/4').set(auth()).send({ ...body, id: 99, expectedRevision: 1, active: false }).expect(200);
  expect(monthly.saveAssignment.mock.calls.at(-1)[1]).toMatchObject({ id: '4', active: false, expectedRevision: 1 });
});

test('partial daily periods still return the saved decision for the intersected month', async () => {
  monthly.readMonthlyReviews.mockResolvedValue({ 'FIXED|7|2026-09': { action: 'APROBAR', revision: 1 } });
  const response = await request(app).get('/api/honorarios/reviews?startDate=2026-09-15&endDate=2026-09-20').set(auth()).expect(200);
  expect(response.body.reviews).toEqual({ 'FIXED|7|2026-09': { action: 'APROBAR', revision: 1 } });
  expect(monthly.readMonthlyReviews).toHaveBeenCalledWith('2026-09-15', '2026-09-20');
});

test('a fixed month decision uses the monthly validator and cannot enter the clinical approval service', async () => {
  const input = { rowId: 'FIXED|7|2026-09', serviceDate: '2026-09-01', expectedRevision: 0,
    decision: { action: 'APROBAR', vatRate: 0.16, motivo: 'Se incluye este mes', fingerprint: 'current' } };
  const response = await request(app).put('/api/honorarios/reviews').set(auth()).send(input).expect(200);
  expect(response.body.review).toEqual({ action: 'APROBAR', revision: 1 });
  expect(monthly.saveMonthlyReview).toHaveBeenCalledWith({}, input, expect.objectContaining({ id: 42 }));
  expect(reviews.saveReview).not.toHaveBeenCalled();
  await request(app).put('/api/honorarios/reviews').set(auth()).send({ ...input, rowId: 'OTHER',
    decision: { ...input.decision, sourceType: 'BI_FIJO_MENSUAL' } }).expect(400);
  expect(reviews.saveReview).not.toHaveBeenCalled();
});
