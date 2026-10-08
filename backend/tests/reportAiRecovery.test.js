'use strict';
const { retryDelay, waitForRetry } = require('../utils/reportAiRetry');
const envKeys = ['GEMINI_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'GEMINI_MODEL', 'LLM_BASE_URL'];
const catalog = [{ id: 'inventory', title: 'Inventario por almacén', filters: [], defaultFields: ['Name'], fields: [{ key: 'Name', label: 'Insumo' }] }];
const valid = { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ status: 'ready', plan: { entity: 'inventory', selectedFields: ['Name'], filters: {} } }) } }] }) };
const busy = { ok: false, status: 503 };
const models = ids => ({ ok: true, status: 200, json: async () => ({ data: ids.map(id => ({ id })) }) });
const posts = fetch => fetch.mock.calls.filter(([, options]) => options.method === 'POST');
let saved;
beforeEach(() => {
  saved = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  envKeys.forEach(key => delete process.env[key]);
  process.env.GEMINI_API_KEY = 'fictional-key'; process.env.GEMINI_MODEL = 'gemini-3.7-flash';
  jest.resetModules(); jest.useFakeTimers();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  envKeys.forEach(key => { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; });
  jest.useRealTimers(); jest.restoreAllMocks();
});
async function prepare(fetchImpl, extra = {}) {
  const promise = require('../services/reportAssistant.service').prepareReport({ message: 'Inventario', catalog, fetchImpl, requireAi: true, ...extra });
  await jest.runAllTimersAsync();
  return promise;
}

test('two capacity failures reach stable Lite within three posts, then reuse only its successful response', async () => {
  const fetch = jest.fn().mockResolvedValueOnce(busy)
    .mockResolvedValueOnce(models(['gemini-3.7-flash', 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-4-flash-preview', 'gemini-3.5-pro']))
    .mockResolvedValueOnce(busy).mockResolvedValue(valid);
  const diagnostic = jest.fn();
  const started = Date.now();
  expect(await prepare(fetch, { onDiagnostic: diagnostic })).toMatchObject({ engine: 'ai', status: 'ready' });
  expect(posts(fetch).map(([, options]) => JSON.parse(options.body).model)).toEqual(['gemini-3.7-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite']);
  expect(fetch.mock.calls.filter(([url]) => url.endsWith('/models'))).toHaveLength(1);
  expect(Date.now() - started).toBeGreaterThanOrEqual(3000);
  expect(Date.now() - started).toBeLessThan(25000);
  expect(new Set(fetch.mock.calls.map(([, options]) => options.signal)).size).toBe(1);
  expect(diagnostic).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'gemini-3.5-flash-lite', category: 'available' }));
  await prepare(fetch);
  expect(JSON.parse(posts(fetch).at(-1)[1].body).model).toBe('gemini-3.5-flash-lite');
});

test('retired model recovery and capacity recovery share the same three-post ceiling', async () => {
  const fetch = jest.fn().mockResolvedValueOnce({ ok: false, status: 404 })
    .mockResolvedValueOnce(models(['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite']))
    .mockResolvedValueOnce(busy).mockResolvedValue(valid);
  expect(await prepare(fetch)).toMatchObject({ engine: 'ai' });
  expect(posts(fetch).map(([, options]) => JSON.parse(options.body).model)).toEqual(['gemini-3.7-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite']);
});

test('a replacement with invalid JSON is not remembered for the following request', async () => {
  const fetch = jest.fn().mockResolvedValueOnce({ ok: false, status: 404 })
    .mockResolvedValueOnce(models(['gemini-3.8-flash']))
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'invalid JSON' } }] }) })
    .mockResolvedValue(valid);
  expect(await prepare(fetch)).toMatchObject({ engine: 'guided' });
  await prepare(fetch);
  expect(JSON.parse(posts(fetch).at(-1)[1].body).model).toBe('gemini-3.7-flash');
});

test('a previously successful replacement that retires refreshes the model list and selects an untried model', async () => {
  const fetch = jest.fn().mockResolvedValueOnce(busy)
    .mockResolvedValueOnce(models(['gemini-3.8-flash', 'gemini-3.5-flash-lite']))
    .mockResolvedValueOnce(valid)
    .mockResolvedValueOnce({ ok: false, status: 404 })
    .mockResolvedValueOnce(models(['gemini-3.8-flash', 'gemini-3.5-flash-lite']))
    .mockResolvedValue(valid);
  expect(await prepare(fetch)).toMatchObject({ engine: 'ai' });
  expect(await prepare(fetch)).toMatchObject({ engine: 'ai' });
  expect(posts(fetch).map(([, options]) => JSON.parse(options.body).model)).toEqual(['gemini-3.7-flash', 'gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite']);
  expect(fetch.mock.calls.filter(([url]) => url.endsWith('/models'))).toHaveLength(2);
});

test('all capacity failures stop after three posts and preserve a safe last-model diagnosis', async () => {
  const fetch = jest.fn().mockResolvedValueOnce(busy).mockResolvedValueOnce(models(['gemini-3.8-flash', 'gemini-3.5-flash-lite'])).mockResolvedValue(busy);
  const diagnostic = jest.fn();
  expect(await prepare(fetch, { onDiagnostic: diagnostic })).toMatchObject({ engine: 'guided', status: 'ready' });
  expect(posts(fetch)).toHaveLength(3);
  expect(diagnostic).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'capacity', httpStatus: 503, model: 'gemini-3.5-flash-lite' }));
  // All known models are temporarily cooling; do not immediately hammer them.
  const next = jest.fn().mockResolvedValue(valid);
  expect(await prepare(next, { onDiagnostic: diagnostic })).toMatchObject({ engine: 'guided' });
  expect(next).not.toHaveBeenCalled();
  expect(diagnostic).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'cooldown' }));
  await jest.advanceTimersByTimeAsync(30000);
  await prepare(next);
  expect(JSON.parse(posts(next)[0][1].body).model).toBe('gemini-3.7-flash');
});

test('configured Lite never silently upgrades to Flash or Pro when capacity is unavailable', async () => {
  process.env.GEMINI_MODEL = 'gemini-3.5-flash-lite';
  const fetch = jest.fn().mockResolvedValueOnce(busy).mockResolvedValueOnce(models(['gemini-3.8-flash', 'gemini-3.4-flash-lite', 'gemini-3.7-pro'])).mockResolvedValue(busy);
  await prepare(fetch);
  expect(posts(fetch).map(([, options]) => JSON.parse(options.body).model)).toEqual(['gemini-3.5-flash-lite', 'gemini-3.4-flash-lite']);
});

test('Retry-After beyond the remaining deadline never starts a premature second post', async () => {
  const fetch = jest.fn().mockResolvedValueOnce({ ...busy, headers: { get: () => '60' } }).mockResolvedValue(models(['gemini-3.5-flash-lite']));
  expect(await prepare(fetch)).toMatchObject({ engine: 'guided' });
  expect(posts(fetch)).toHaveLength(1);
});

test('a model-list request aborted at the shared deadline cannot dispatch another post', async () => {
  const fetch = jest.fn().mockResolvedValueOnce(busy).mockImplementationOnce((_url, { signal }) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); }));
  const diagnostic = jest.fn();
  const started = Date.now();
  expect(await prepare(fetch, { onDiagnostic: diagnostic })).toMatchObject({ engine: 'guided' });
  expect(Date.now() - started).toBe(25000);
  expect(posts(fetch)).toHaveLength(1);
  expect(diagnostic).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'timeout' }));
});

test.each(['request', 'body', 'discovery'])('a hung %s is bounded even if the transport ignores abort, and releases its slot', async stage => {
  const never = () => new Promise(() => {});
  const fetch = stage === 'request' ? jest.fn(never)
    : stage === 'body' ? jest.fn().mockResolvedValue({ ok: true, status: 200, json: never })
      : jest.fn().mockResolvedValueOnce(busy).mockImplementation(never);
  const diagnostic = jest.fn();
  const started = Date.now();
  expect(await prepare(fetch, { onDiagnostic: diagnostic })).toMatchObject({ engine: 'guided', status: 'ready' });
  expect(Date.now() - started).toBe(25000);
  expect(diagnostic).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'timeout' }));
  // A second unrelated configuration can still call Gemini after the timeout.
  process.env.GEMINI_MODEL = 'gemini-3.5-flash-lite';
  const healthy = jest.fn().mockResolvedValue(valid);
  expect(await prepare(healthy)).toMatchObject({ engine: 'ai' });
  expect(healthy).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('only two Gemini operations run simultaneously, including a stalled response body', async () => {
  const service = require('../services/reportAssistant.service');
  let finishRequest; let finishBody;
  const firstFetch = jest.fn(() => new Promise(resolve => { finishRequest = resolve; }));
  const secondFetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: () => new Promise(resolve => { finishBody = resolve; }) });
  const args = { message: 'Inventario', catalog, requireAi: true };
  const first = service.prepareReport({ ...args, fetchImpl: firstFetch });
  const second = service.prepareReport({ ...args, fetchImpl: secondFetch });
  // Let the second request reach body parsing before sending the overflow.
  await jest.advanceTimersByTimeAsync(0);
  expect(finishBody).toEqual(expect.any(Function));
  const overflowFetch = jest.fn().mockResolvedValue(valid);
  const diagnostic = jest.fn();
  expect(await service.prepareReport({ ...args, fetchImpl: overflowFetch, onDiagnostic: diagnostic })).toMatchObject({ engine: 'guided', status: 'ready' });
  expect(overflowFetch).not.toHaveBeenCalled();
  expect(diagnostic).toHaveBeenLastCalledWith({ provider: 'gemini', model: 'gemini-3.7-flash', category: 'client_busy' });
  finishRequest(valid); finishBody(await valid.json());
  expect((await Promise.all([first, second])).every(result => result.engine === 'ai')).toBe(true);
  expect(await service.prepareReport({ ...args, fetchImpl: overflowFetch })).toMatchObject({ engine: 'ai' });
  expect(overflowFetch).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('certain local requests keep working without Gemini or a false outage notice', async () => {
  const fetch = jest.fn(() => { throw new Error('Should not call network'); });
  expect(await prepare(fetch, { requireAi: false })).toMatchObject({ engine: 'guided', status: 'ready', plan: { entity: 'inventory', selectedFields: ['Name'] } });
  const result = await prepare(fetch, { requireAi: false });
  expect(result).not.toHaveProperty('notice');
  expect(fetch).not.toHaveBeenCalled();
});

test('capacity failure and cooldown preserve the pending patient/order request, dates and source choice', async () => {
  const realCatalog = [require('../services/sapReportCatalog.service').catalog.sales_order_summary,
    require('../services/verticalReportCatalog.service').catalog.vertical_sales_orders];
  const request = 'Necesito los pacientes con todas las órdenes de venta que tengan del 01/09/2026 al 30/09/2026';
  const fetch = jest.fn().mockResolvedValueOnce(busy).mockResolvedValueOnce(models(['gemini-3.8-flash', 'gemini-3.5-flash-lite'])).mockResolvedValue(busy);
  const first = await prepare(fetch, { catalog: realCatalog, message: request });
  expect(first).toMatchObject({ engine: 'guided', status: 'clarification' });
  expect(first.choices.map(choice => choice.id)).toEqual(expect.arrayContaining(['sales_order_summary', 'vertical_sales_orders']));
  const noNetwork = jest.fn();
  const second = await prepare(noNetwork, { requireAi: false, catalog: realCatalog, message: 'Ambas', pending: first.pending });
  expect(second).toMatchObject({ status: 'clarification', engine: 'guided' });
  expect(second).not.toHaveProperty('notice');
  const final = await prepare(noNetwork, { requireAi: false, catalog: realCatalog, message: 'Vertical', pending: second.pending });
  expect(final).toMatchObject({ status: 'ready', plan: { entity: 'vertical_sales_orders', filters: { fechaDesde: '2026-09-01', fechaHasta: '2026-09-30' } } });
  expect(final.plan.selectedFields).toContain('PatientName');
  expect(noNetwork).not.toHaveBeenCalled();
});

test.each([401, 403])('credential and access errors do not retry or discover models: %s', async status => {
  const fetch = jest.fn().mockResolvedValue({ ok: false, status });
  await prepare(fetch);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('a custom Gemini host keeps its configured model and single retry', async () => {
  process.env.LLM_BASE_URL = 'https://custom-provider.test/v1';
  const fetch = jest.fn().mockResolvedValue(busy);
  await prepare(fetch);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(posts(fetch).every(([, options]) => JSON.parse(options.body).model === 'gemini-3.7-flash')).toBe(true);
});

test('an unavailable discovery endpoint still allows bounded retries of the configured model', async () => {
  const fetch = jest.fn().mockResolvedValueOnce(busy).mockRejectedValueOnce(new TypeError('discovery unavailable')).mockResolvedValueOnce(busy).mockResolvedValue(valid);
  expect(await prepare(fetch)).toMatchObject({ engine: 'ai' });
  expect(posts(fetch)).toHaveLength(3);
});

test('backoff grows and respects both numeric and civil Retry-After values', () => {
  expect(retryDelay({}, 0, true, 0, 0)).toBe(1000);
  expect(retryDelay({}, 1, true, 0, 1)).toBe(2200);
  expect(retryDelay({ headers: { get: () => '4' } }, 0, true, 0, 0)).toBe(4000);
  const now = Date.parse('2026-10-06T18:00:00Z');
  expect(retryDelay({ headers: { get: () => 'Tue, 06 Oct 2026 18:00:05 GMT' } }, 0, true, now, 0)).toBe(5000);
  expect(retryDelay({ headers: { get: () => 'invalid' } }, 1, true, now, 0)).toBe(2000);
});

test('retry waits cancel their timer immediately when the shared signal aborts', async () => {
  const controller = new AbortController();
  const waiting = waitForRetry(10000, controller.signal);
  controller.abort();
  await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  expect(jest.getTimerCount()).toBe(0);
});
