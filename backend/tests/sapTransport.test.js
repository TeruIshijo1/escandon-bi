'use strict';

const { EventEmitter } = require('node:events');
jest.mock('https', () => ({ Agent: jest.fn(), request: jest.fn() }));
jest.mock('../config/sap.config', () => ({
  baseUrl: 'https://sap.example.test/b1s/v1', companyDb: 'test', username: 'test', password: 'test', rejectUnauthorized: true,
}));
const https = require('https');
const sap = require('../services/sap.service');
let requests;

beforeEach(() => {
  requests = [];
  sap.sessionCookie = 'diagnostic-session';
  sap.sessionExpiresAt = Date.now() + 60000;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  https.request.mockImplementation((options, respond) => {
    const request = new EventEmitter();
    request.write = jest.fn();
    request.end = jest.fn();
    request.destroy = jest.fn(error => {
      queueMicrotask(() => { request.emit('error', error); request.emit('close'); });
    });
    const abort = () => request.destroy(Object.assign(new Error('Aborted'), { code: 'ABORT_ERR' }));
    if (options.signal) {
      options.signal.addEventListener('abort', abort, { once: true });
      request.once('close', () => options.signal.removeEventListener('abort', abort));
      if (options.signal.aborted) queueMicrotask(abort);
    }
    requests.push({ options, request, respond });
    return request;
  });
});

afterEach(() => { jest.restoreAllMocks(); https.request.mockClear(); jest.useRealTimers(); });

function response(index, body, status = 200, headers = {}) {
  const stream = new EventEmitter();
  stream.statusCode = status;
  stream.headers = headers;
  requests[index].respond(stream);
  stream.emit('data', JSON.stringify(body));
  stream.emit('end');
  requests[index].request.emit('close');
}

test('cancelling a read closes its network request without retrying', async () => {
  const controller = new AbortController();
  const result = sap.get('/Invoices', {}, { signal: controller.signal, timeoutMs: 1000 });
  const assertion = expect(result).rejects.toMatchObject({ code: 'ABORT_ERR' });
  await new Promise(resolve => setImmediate(resolve));
  expect(requests[0].options.signal).toBe(controller.signal);
  controller.abort();
  await assertion;
  expect(requests[0].request.destroy).toHaveBeenCalledTimes(1);
  expect(https.request).toHaveBeenCalledTimes(1);
});

test('a read deadline destroys the stalled socket and does not retry it', async () => {
  jest.useFakeTimers();
  const result = sap.get('/Invoices', {}, { timeoutMs: 50 });
  const assertion = expect(result).rejects.toMatchObject({ code: 'SAP_READ_TIMEOUT' });
  await jest.advanceTimersByTimeAsync(50);
  await assertion;
  expect(requests[0].request.destroy).toHaveBeenCalledTimes(1);
  expect(https.request).toHaveBeenCalledTimes(1);
});

test('successful ordinary reads keep their response contract and clear their deadline', async () => {
  jest.useFakeTimers();
  const result = sap.get('/Invoices', { Prefer: 'odata.maxpagesize=200' }, { timeoutMs: 50 });
  await jest.advanceTimersByTimeAsync(0);
  response(0, { value: [{ DocEntry: 1 }] });
  await expect(result).resolves.toMatchObject({ status: 200, data: { value: [{ DocEntry: 1 }] } });
  await jest.advanceTimersByTimeAsync(100);
  expect(requests[0].request.destroy).not.toHaveBeenCalled();
  expect(requests[0].options.headers.Prefer).toBe('odata.maxpagesize=200');
});

test('cancellation also reaches session renewal before a protected read can start', async () => {
  sap.sessionCookie = null;
  const controller = new AbortController();
  const result = sap.get('/Invoices', {}, { signal: controller.signal, timeoutMs: 1000 });
  const assertion = expect(result).rejects.toMatchObject({ code: 'ABORT_ERR' });
  await new Promise(resolve => setImmediate(resolve));
  expect(requests[0].options.path).toBe('/b1s/v1/Login');
  controller.abort();
  await assertion;
  expect(https.request).toHaveBeenCalledTimes(1);
});

test('POST infrastructure reads honor the same cancellation options', async () => {
  const controller = new AbortController();
  const result = sap.post('/SQLQueries', { SqlCode: 'diagnostic' }, {}, { signal: controller.signal, timeoutMs: 1000 });
  const assertion = expect(result).rejects.toMatchObject({ code: 'ABORT_ERR' });
  await new Promise(resolve => setImmediate(resolve));
  expect(requests[0].options.method).toBe('POST');
  controller.abort();
  await assertion;
  expect(https.request).toHaveBeenCalledTimes(1);
});
