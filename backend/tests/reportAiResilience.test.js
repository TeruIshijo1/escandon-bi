'use strict';

let resilience;
beforeEach(() => { jest.resetModules(); jest.useFakeTimers(); resilience = require('../utils/reportAiResilience'); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

test('cache identifiers separate endpoint, configured model and credentials without disclosing their content', () => {
  const config = { base: 'https://private-host/path?token=private-url', model: 'gemini-3.7-flash', key: 'private-api-key' };
  const id = resilience.cacheKey(config);
  expect(id).toMatch(/^[a-f0-9]{64}$/);
  expect(id).toBe(resilience.cacheKey({ ...config }));
  for (const field of ['base', 'model', 'key']) expect(resilience.cacheKey({ ...config, [field]: `${config[field]}-different` })).not.toBe(id);
  expect(id).not.toMatch(/private|gemini|https/);
});

test('model lists expire after fifteen minutes, are defensive copies, and retain an empty discovered list', () => {
  const input = ['gemini-3.7-flash', 'gemini-3.5-flash-lite'];
  resilience.setDiscoveredModels('a', input);
  input.push('mutated-input');
  const first = resilience.getDiscoveredModels('a'); first.push('mutated-return');
  expect(resilience.getDiscoveredModels('a')).toEqual(['gemini-3.7-flash', 'gemini-3.5-flash-lite']);
  resilience.setDiscoveredModels('empty', []);
  expect(resilience.getDiscoveredModels('empty')).toEqual([]);
  jest.advanceTimersByTime(15 * 60 * 1000 - 1);
  expect(resilience.getDiscoveredModels('a')).not.toBeNull();
  jest.advanceTimersByTime(1);
  expect(resilience.getDiscoveredModels('a')).toBeNull();
  expect(resilience.getDiscoveredModels('empty')).toBeNull();
});

test('successful models expire after one hour and invalidation affects only the intended configuration', () => {
  resilience.setSuccessfulModel('a', 'gemini-3.7-flash');
  resilience.setSuccessfulModel('b', 'gemini-3.5-flash-lite');
  resilience.setDiscoveredModels('a', ['gemini-3.7-flash']);
  resilience.invalidateSuccessfulModel('a');
  expect(resilience.getSuccessfulModel('a')).toBeNull();
  expect(resilience.getSuccessfulModel('b')).toBe('gemini-3.5-flash-lite');
  expect(resilience.getDiscoveredModels('a')).toEqual(['gemini-3.7-flash']);
  resilience.invalidateDiscoveredModels('a');
  expect(resilience.getDiscoveredModels('a')).toBeNull();
  jest.advanceTimersByTime(60 * 60 * 1000);
  expect(resilience.getSuccessfulModel('b')).toBeNull();
});

test('only HTTP503 cools a model for thirty seconds; success clears its cooling immediately', () => {
  for (const status of [400, 401, 403, 404, 429, 500, 502, 504]) resilience.recordFailure('a', 'flash', status);
  expect(resilience.isCooling('a', 'flash')).toBe(false);
  resilience.recordFailure('a', 'flash', 503);
  expect(resilience.isCooling('a', 'flash')).toBe(true);
  expect(resilience.isCooling('b', 'flash')).toBe(false);
  expect(resilience.isCooling('a', 'lite')).toBe(false);
  jest.advanceTimersByTime(29999);
  expect(resilience.isCooling('a', 'flash')).toBe(true);
  jest.advanceTimersByTime(1);
  expect(resilience.isCooling('a', 'flash')).toBe(false);
  resilience.recordFailure('a', 'flash', 503);
  resilience.recordFailure('a', 'lite', 503);
  resilience.recordSuccess('a', 'flash');
  expect(resilience.isCooling('a', 'flash')).toBe(false);
  expect(resilience.isCooling('a', 'lite')).toBe(true);
});

test('two operations can hold slots and idempotent release never admits a third concurrent operation', () => {
  const first = resilience.tryAcquireGemini(); const second = resilience.tryAcquireGemini();
  expect(first).toEqual(expect.any(Function)); expect(second).toEqual(expect.any(Function));
  expect(resilience.tryAcquireGemini()).toBeNull();
  first(); first();
  const third = resilience.tryAcquireGemini(); expect(third).toEqual(expect.any(Function));
  expect(resilience.tryAcquireGemini()).toBeNull();
  second(); third();
  const fourth = resilience.tryAcquireGemini(); const fifth = resilience.tryAcquireGemini();
  expect(fourth).toEqual(expect.any(Function)); expect(fifth).toEqual(expect.any(Function));
  expect(resilience.tryAcquireGemini()).toBeNull();
  fourth(); fifth();
});

test('abort terminates a promise that ignores its signal and removes the listener', async () => {
  const controller = new AbortController(); const remove = jest.spyOn(controller.signal, 'removeEventListener');
  const reason = new Error('cancelled');
  const result = resilience.abortable(() => new Promise(() => {}), controller.signal);
  const assertion = expect(result).rejects.toBe(reason);
  controller.abort(reason);
  await assertion;
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
});

test('success, rejection and synchronous exceptions all remove their abort listener', async () => {
  const controller = new AbortController(); const remove = jest.spyOn(controller.signal, 'removeEventListener');
  await expect(resilience.abortable(() => Promise.resolve('done'), controller.signal)).resolves.toBe('done');
  const reason = new Error('operation failed');
  await expect(resilience.abortable(() => Promise.reject(reason), controller.signal)).rejects.toBe(reason);
  await expect(resilience.abortable(() => { throw reason; }, controller.signal)).rejects.toBe(reason);
  expect(remove).toHaveBeenCalledTimes(3);
});

test('already aborted signals never start a thunk, and late operation rejections remain handled', async () => {
  const controller = new AbortController(); const reason = new Error('cancelled'); controller.abort(reason);
  const operation = jest.fn();
  await expect(resilience.abortable(operation, controller.signal)).rejects.toBe(reason);
  expect(operation).not.toHaveBeenCalled();
  await expect(resilience.abortable(Promise.reject(new Error('already-started operation')), controller.signal)).rejects.toBe(reason);
  const pending = new AbortController(); let rejectOperation;
  const result = resilience.abortable(new Promise((_resolve, reject) => { rejectOperation = reject; }), pending.signal);
  const assertion = expect(result).rejects.toBe(reason);
  pending.abort(reason); await assertion;
  rejectOperation(new Error('late failure'));
  await Promise.resolve(); await Promise.resolve();
});
