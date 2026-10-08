'use strict';

const envKeys = ['GEMINI_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'GEMINI_MODEL', 'DEEPSEEK_MODEL', 'OPENAI_MODEL', 'LLM_BASE_URL', 'AZURE_OPENAI_ENDPOINT', 'REPORT_AI_FALLBACK_PROVIDERS', 'REPORT_AI_GEMINI_FALLBACK_MODELS'];
const catalog = [{ id: 'inventory', title: 'Inventario por almacén', requiresDateFilter: false,
  filters: [], defaultFields: ['Name'], fields: [{ key: 'Name', label: 'Insumo' }] }];
const proposal = { status: 'ready', plan: { entity: 'inventory', selectedFields: ['Name'], filters: {} } };
const success = value => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(value) } }] }) });
const hosts = fetch => fetch.mock.calls.filter(([, options]) => options.method === 'POST').map(([url]) => new URL(url).hostname);
let saved;
beforeEach(() => {
  saved = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  envKeys.forEach(key => delete process.env[key]);
  process.env.GEMINI_API_KEY = 'fictional-google-key';
  process.env.GEMINI_MODEL = 'gemini-3.7-flash';
  process.env.OPENAI_API_KEY = 'fictional-openai-key';
  process.env.REPORT_AI_FALLBACK_PROVIDERS = 'openai';
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

test('Google capacity failures switch to an explicitly enabled independent provider with its own credentials', async () => {
  const fetch = jest.fn(async (url, options) => {
    if (url.endsWith('/models')) return { ok: true, json: async () => ({ data: [{ id: 'gemini-3.8-flash' }, { id: 'gemini-3.5-flash-lite' }] }) };
    if (new URL(url).hostname === 'generativelanguage.googleapis.com') return { ok: false, status: 503 };
    expect(options.headers.Authorization).toBe('Bearer fictional-openai-key');
    expect(JSON.parse(options.body)).toMatchObject({ model: 'gpt-4o', response_format: { type: 'json_object' } });
    return success(proposal);
  });
  const diagnostics = jest.fn();
  expect(await prepare(fetch, { onDiagnostic: diagnostics })).toMatchObject({ engine: 'ai', status: 'ready' });
  expect(hosts(fetch)).toEqual(['generativelanguage.googleapis.com', 'generativelanguage.googleapis.com', 'generativelanguage.googleapis.com', 'api.openai.com']);
  expect(diagnostics).toHaveBeenLastCalledWith(expect.objectContaining({ provider: 'openai', category: 'available' }));
  expect(JSON.stringify(console.warn.mock.calls)).not.toMatch(/fictional-google-key|fictional-openai-key/);
});

test.each(['request', 'body', 'discovery'])('a hung primary %s leaves half the shared deadline for the reserve', async stage => {
  const never = () => new Promise(() => {});
  const fetch = jest.fn(async url => {
    if (new URL(url).hostname === 'api.openai.com') return success(proposal);
    if (url.endsWith('/models')) return never();
    if (stage === 'request') return never();
    return stage === 'body' ? { ok: true, status: 200, json: never } : { ok: false, status: 503 };
  });
  const started = Date.now();
  expect(await prepare(fetch)).toMatchObject({ engine: 'ai', status: 'ready' });
  expect(Date.now() - started).toBe(12500);
  expect(hosts(fetch)).toEqual(['generativelanguage.googleapis.com', 'api.openai.com']);
  expect(jest.getTimerCount()).toBe(0);
});

test('three stalled providers finish guided within the single 25-second budget', async () => {
  process.env.DEEPSEEK_API_KEY = 'fictional-deepseek-key';
  process.env.REPORT_AI_FALLBACK_PROVIDERS = 'deepseek,openai';
  const fetch = jest.fn(() => new Promise(() => {}));
  const started = Date.now();
  expect(await prepare(fetch)).toMatchObject({ engine: 'guided', status: 'ready', plan: { selectedFields: ['Name'] } });
  expect(Date.now() - started).toBe(25000);
  expect(hosts(fetch)).toEqual(['generativelanguage.googleapis.com', 'api.deepseek.com', 'api.openai.com']);
  expect(jest.getTimerCount()).toBe(0);
});

test('a failed provider is skipped for later requests and probed again after the cooldown', async () => {
  const fetch = jest.fn(url => new URL(url).hostname === 'api.openai.com' ? Promise.resolve(success(proposal)) : new Promise(() => {}));
  expect(await prepare(fetch)).toMatchObject({ engine: 'ai' });
  const next = jest.fn().mockResolvedValue(success(proposal));
  const started = Date.now();
  expect(await prepare(next)).toMatchObject({ engine: 'ai' });
  expect(Date.now() - started).toBe(0);
  expect(hosts(next)).toEqual(['api.openai.com']);
  await jest.advanceTimersByTimeAsync(30000);
  expect(await prepare(next)).toMatchObject({ engine: 'ai' });
  expect(hosts(next)).toEqual(['api.openai.com', 'generativelanguage.googleapis.com']);
});

test('explicit stable Flash reserves can recover a Lite primary without automatic discovery', async () => {
  process.env.GEMINI_MODEL = 'gemini-3.5-flash-lite';
  process.env.REPORT_AI_GEMINI_FALLBACK_MODELS = 'gemini-3.8-flash';
  const fetch = jest.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValue(success(proposal));
  expect(await prepare(fetch)).toMatchObject({ engine: 'ai' });
  expect(fetch.mock.calls).toHaveLength(2);
  expect(JSON.parse(fetch.mock.calls[1][1].body).model).toBe('gemini-3.8-flash');
  expect(hosts(fetch)).toEqual(['generativelanguage.googleapis.com', 'generativelanguage.googleapis.com']);
});

test.each(['credentials', 'network', 'format'])('a %s failure can use an independently configured reserve', async failure => {
  const fetch = jest.fn(async url => {
    if (new URL(url).hostname === 'api.openai.com') return success(proposal);
    if (failure === 'credentials') return { ok: false, status: 401 };
    if (failure === 'network') throw new TypeError('private provider error with fictional-google-key');
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'invalid JSON' } }] }) };
  });
  expect(await prepare(fetch)).toMatchObject({ engine: 'ai', status: 'ready' });
  expect(hosts(fetch)).toEqual(['generativelanguage.googleapis.com', 'api.openai.com']);
});

test.each([
  { status: 'unsupported', message: 'Esa combinación no está disponible.' },
  { status: 'ready', plan: { entity: 'unauthorized', selectedFields: ['Sensitive'], filters: {} } },
  { status: 'ready', plan: { entity: 'inventory', selectedFields: ['Sensitive'], filters: {} } },
])('a valid answer or rejected plan never asks another provider to bypass the catalog', async raw => {
  const fetch = jest.fn().mockResolvedValue(success(raw));
  expect(await prepare(fetch)).toMatchObject({ engine: 'ai', status: 'unsupported', plan: null });
  expect(hosts(fetch)).toEqual(['generativelanguage.googleapis.com']);
});

test('a second key alone never sends the conversation to an unenabled reserve', async () => {
  delete process.env.REPORT_AI_FALLBACK_PROVIDERS;
  const fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 });
  expect(await prepare(fetch)).toMatchObject({ engine: 'guided' });
  expect(hosts(fetch)).toEqual(['generativelanguage.googleapis.com']);
});

test('explicit Gemini model reserves work even when discovery is not reachable', async () => {
  delete process.env.REPORT_AI_FALLBACK_PROVIDERS;
  process.env.REPORT_AI_GEMINI_FALLBACK_MODELS = 'gemini-3.5-flash-lite,gemini-3.6-flash';
  const fetch = jest.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValue(success(proposal));
  expect(await prepare(fetch)).toMatchObject({ engine: 'ai' });
  expect(fetch.mock.calls.some(([url]) => url.endsWith('/models'))).toBe(false);
  expect(JSON.parse(fetch.mock.calls[1][1].body).model).toBe('gemini-3.5-flash-lite');
});

test('known requests continue locally for all providers, including no configured key', async () => {
  const fetch = jest.fn();
  for (const mode of ['gemini', 'openai', 'none']) {
    if (mode !== 'gemini') delete process.env.GEMINI_API_KEY;
    if (mode === 'none') delete process.env.OPENAI_API_KEY;
    expect(await prepare(fetch, { requireAi: false })).toMatchObject({ engine: 'guided', status: 'ready', plan: { selectedFields: ['Name'] } });
  }
  expect(fetch).not.toHaveBeenCalled();
});
