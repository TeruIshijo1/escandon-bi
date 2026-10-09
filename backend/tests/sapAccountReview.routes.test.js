'use strict';
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
jest.mock('../services/sap.service', () => ({ get: jest.fn() }));
jest.mock('../services/sapAccountReview.service', () => ({ search: jest.fn(), review: jest.fn() }));
const service = require('../services/sapAccountReview.service');
const app = express();
app.use('/api/sap', require('../routes/sap.routes'));
const auth = user => ({ Authorization: `Bearer ${jwt.sign({ sub: 42, username: 'staff', role: 'ADMIN', permisos: [], ...user }, process.env.JWT_SECRET)}` });
beforeEach(() => {
  jest.clearAllMocks();
  service.search.mockResolvedValue({ accounts: [], truncated: false });
  service.review.mockResolvedValue({ account: '123', eligible: false, status: 'unverified' });
});

test('both account review endpoints require an authenticated token', async () => {
  expect((await request(app).get('/api/sap/account-review/search?mode=patient&q=Ana')).status).toBe(401);
  expect((await request(app).get('/api/sap/account-review/123')).status).toBe(401);
  expect(service.search).not.toHaveBeenCalled();
  expect(service.review).not.toHaveBeenCalled();
});

test('admin role and unrelated permissions do not unlock account review', async () => {
  for (const permisos of [[], ['auditoria-rastreo-ordenes'], ['sap-query-sales_invoice_summary']]) {
    const headers = auth({ permisos });
    expect((await request(app).get('/api/sap/account-review/search?mode=patient&q=Ana').set(headers)).status).toBe(403);
    expect((await request(app).get('/api/sap/account-review/123').set(headers)).status).toBe(403);
  }
  expect(service.search).not.toHaveBeenCalled();
});

test('explicit permission and the established superadministrator receive the agreed envelope', async () => {
  for (const user of [{ role: 'USUARIO_OPERATIVO', permisos: ['auditoria-reapertura-cuentas'] }, { username: 'AMendoza' }]) {
    const search = await request(app).get('/api/sap/account-review/search?mode=patient&q=Ana').set(auth(user));
    expect(search.body).toEqual({ success: true, data: { accounts: [], truncated: false } });
    expect(search.headers['cache-control']).toBe('no-store');
    const detail = await request(app).get('/api/sap/account-review/123').set(auth(user));
    expect(detail.body).toEqual({ success: true, data: { account: '123', eligible: false, status: 'unverified' } });
  }
  expect(service.search).toHaveBeenCalledWith({ mode: 'patient', q: 'Ana' }, { signal: expect.any(AbortSignal) });
  expect(service.review).toHaveBeenCalledWith('123', { fullMap: false, signal: expect.any(AbortSignal) });
});

test('only an explicit fullMap=true query enables the full map override', async () => {
  const headers = auth({ permisos: ['auditoria-reapertura-cuentas'] });
  for (const [query, enabled] of [['true', true], ['TRUE', false], ['1', false]]) {
    await request(app).get('/api/sap/account-review/123?fullMap=' + query).set(headers);
    expect(service.review).toHaveBeenLastCalledWith('123', { fullMap: enabled, signal: expect.any(AbortSignal) });
  }
});

test('the explicit SAP order search retains authentication, permission and no-store protections', async () => {
  const url = '/api/sap/account-review/search?mode=order&q=50837';
  expect((await request(app).get(url)).status).toBe(401);
  expect((await request(app).get(url).set(auth({ permisos: [] }))).status).toBe(403);
  expect(service.search).not.toHaveBeenCalled();
  const response = await request(app).get(url).set(auth({ permisos: ['auditoria-reapertura-cuentas'] }));
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(service.search).toHaveBeenCalledWith({ mode: 'order', q: '50837' }, { signal: expect.any(AbortSignal) });
});

test('completed success and error responses cancel any remaining SAP branch on both endpoints', async () => {
  const headers = auth({ permisos: ['auditoria-reapertura-cuentas'] });
  for (const [method, url] of [['search', '/api/sap/account-review/search?mode=patient&q=Ana'],
    ['review', '/api/sap/account-review/123']]) {
    for (const rejected of [false, true]) {
      let branchCancelled = false;
      let signal;
      service[method].mockImplementationOnce(async (_, options) => {
        signal = options.signal;
        signal.addEventListener('abort', () => { branchCancelled = true; }, { once: true });
        if (rejected) throw new Error('One parallel SAP branch failed');
        return { eligible: false };
      });
      const response = await request(app).get(url).set(headers);
      expect(response.status).toBe(rejected ? 502 : 200);
      expect(signal.aborted).toBe(true);
      expect(branchCancelled).toBe(true);
      expect(response.body.success).toBe(!rejected);
    }
  }
});

test('validation errors are useful while SAP errors cannot expose backend internals', async () => {
  const headers = auth({ permisos: ['auditoria-reapertura-cuentas'] });
  service.review.mockRejectedValueOnce(Object.assign(new Error('Cuenta inválida'), { status: 400 }));
  const invalid = await request(app).get('/api/sap/account-review/abc').set(headers);
  expect(invalid.status).toBe(400);
  expect(invalid.body.error).toBe('Cuenta inválida');
  service.search.mockRejectedValueOnce(new Error('Sensitive SAP connection details'));
  const failure = await request(app).get('/api/sap/account-review/search?mode=patient&q=Ana').set(headers);
  expect(failure.status).toBe(502);
  expect(JSON.stringify(failure.body)).not.toContain('Sensitive');
});
