'use strict';
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
jest.mock('../services/sap.service', () => ({ get: jest.fn() }));
jest.mock('../services/sapAccountReview.service', () => ({ search: jest.fn(), review: jest.fn() }));
jest.mock('../services/accountReopening.service', () => ({ prepare: jest.fn(), execute: jest.fn(), status: jest.fn() }));
const service = require('../services/accountReopening.service');
const app = express();
app.use(express.json());
app.use('/api/sap', require('../routes/sap.routes'));
const permissions = ['auditoria-reapertura-cuentas', 'ejecutar-reapertura-cuentas'];
const auth = user => ({ Authorization: `Bearer ${jwt.sign({ sub: 42, username: 'staff', role: 'ADMIN', permisos: permissions, ...user }, process.env.JWT_SECRET)}` });
const endpoint = action => `/api/sap/account-review/269/reopening/${action}`;
beforeEach(() => {
  jest.resetAllMocks();
  service.prepare.mockResolvedValue({ account: '269', status: 'ready' });
  service.execute.mockResolvedValue({ account: '269', status: 'reopened' });
  service.status.mockResolvedValue({ account: '269', status: 'pending' });
});

test.each(['prepare', 'execute', 'status'])('%s requires authentication and both explicit permissions', async action => {
  expect((await request(app).post(endpoint(action)).send({})).status).toBe(401);
  for (const permisos of [[], ['auditoria-reapertura-cuentas'], ['ejecutar-reapertura-cuentas'], ['auditoria-rastreo-ordenes']]) {
    expect((await request(app).post(endpoint(action)).set(auth({ permisos })).send({})).status).toBe(403);
  }
  expect(service[action]).not.toHaveBeenCalled();
});

test.each(['prepare', 'execute', 'status'])('%s passes server identity and only its intended input', async action => {
  const response = await request(app).post(endpoint(action)).set(auth({ role: 'USUARIO_OPERATIVO' }))
    .send({ previewToken: 'signed-preview', confirmedAccount: '269', eligible: true, recordId: 999, backupDirectory: 'untrusted' });
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body.success).toBe(true);
  const [account, options] = service[action].mock.calls[0];
  expect(account).toBe('269');
  expect(options.user).toMatchObject({ id: 42, username: 'staff', permisos: permissions });
  expect(options.signal).toBeInstanceOf(AbortSignal);
  expect(options).not.toHaveProperty('eligible');
  expect(options).not.toHaveProperty('recordId');
  expect(options).not.toHaveProperty('backupDirectory');
  if (action !== 'prepare') expect(options.previewToken).toBe('signed-preview');
  if (action === 'execute') expect(options.confirmedAccount).toBe('269');
});

test('the established superadministrator may prepare without assigned permission lists', async () => {
  expect((await request(app).post(endpoint('prepare')).set(auth({ username: 'AMendoza', permisos: [] })).send({})).status).toBe(200);
});

test('safe eligibility failures retain their reason while database errors stay private', async () => {
  service.execute.mockRejectedValueOnce(Object.assign(new Error('technical'), {
    status: 409, code: 'SAP_NOT_ELIGIBLE', publicMessage: 'La cuenta ya no cumple condiciones para reapertura.',
  }));
  const blocked = await request(app).post(endpoint('execute')).set(auth()).send({ previewToken: 'signed-preview', confirmedAccount: '269' });
  expect(blocked.status).toBe(409);
  expect(blocked.body).toMatchObject({ success: false, code: 'SAP_NOT_ELIGIBLE', error: 'La cuenta ya no cumple condiciones para reapertura.' });
  service.prepare.mockRejectedValueOnce(Object.assign(new Error('SQL connection password private-table'), { status: 503 }));
  const failed = await request(app).post(endpoint('prepare')).set(auth()).send({});
  expect(failed.status).toBe(503);
  expect(JSON.stringify(failed.body)).not.toMatch(/SQL|password|private-table/);
});

test('execute completes its receipt even when the browser closes the connection', async () => {
  let executionSignal;
  let finish;
  let completed;
  const completion = new Promise(resolve => { completed = resolve; });
  const started = new Promise(resolve => {
    service.execute.mockImplementationOnce(async (_account, options) => {
      executionSignal = options.signal;
      executionSignal.addEventListener('abort', completed, { once: true });
      resolve();
      await new Promise(done => { finish = done; });
      return { account: '269', status: 'reopened' };
    });
  });
  const server = app.listen(0);
  try {
    const pending = request(server).post(endpoint('execute')).set(auth()).send({ previewToken: 'signed-preview', confirmedAccount: '269' });
    pending.end(() => {});
    await started;
    pending.abort();
    await new Promise(resolve => setImmediate(resolve));
    expect(executionSignal.aborted).toBe(false);
    finish();
    await completion;
    expect(executionSignal.aborted).toBe(true);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
