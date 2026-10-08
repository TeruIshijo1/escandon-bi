'use strict';

const path = require('node:path');
const { runCheck, runReserveCheck, runCli } = require('../scripts/check-report-ai');
const { providerChain } = require('../utils/reportAiProviders');
const envKeys = ['GEMINI_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'GEMINI_MODEL', 'DEEPSEEK_MODEL', 'OPENAI_MODEL', 'LLM_BASE_URL', 'AZURE_OPENAI_ENDPOINT',
  'REPORT_AI_FALLBACK_PROVIDERS', 'REPORT_AI_GEMINI_FALLBACK_MODELS'];
let originalEnv;
beforeEach(() => {
  originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  envKeys.forEach(key => delete process.env[key]);
});
afterEach(() => {
  envKeys.forEach(key => { if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key]; });
  jest.restoreAllMocks();
});

test('missing credentials stop the check without a network request', async () => {
  const fetchImpl = jest.fn();
  expect(await runCheck({ fetchImpl })).toMatchObject({ exitCode: 2, result: { engine: 'guided', category: 'missing_key', keyConfigured: false } });
  expect(fetchImpl).not.toHaveBeenCalled();
});

test('a successful check sends only its fixed fictitious metadata and reports AI without copying the model reply', async () => {
  process.env.OPENAI_API_KEY = 'fictional-test-key';
  const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: {
    content: JSON.stringify({ status: 'ready', message: 'sensitive model reply must not be printed', plan: { entity: 'inventory', selectedFields: ['Name', 'Quantity'], filters: {} } }),
  } }] }) });
  const check = await runCheck({ fetchImpl });
  expect(check).toMatchObject({ exitCode: 0, result: { engine: 'ai', status: 'ready', provider: 'openai', model: 'gpt-4o' } });
  expect(JSON.stringify(check.result)).not.toMatch(/sensitive|message|plan|fictional-test-key/);
  const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
  const text = JSON.stringify(body);
  expect(text).toContain('Inventario de demostración');
  expect(text).toContain('Catálogo ficticio');
  expect(text).not.toMatch(/vertical_surgeries|secret-key|records/);
  const metadata = JSON.parse(body.messages[0].content.split('Catálogo autorizado: ')[1]);
  expect(metadata).toHaveLength(1);
  expect(metadata[0].source).toBe('Demo');
  expect(metadata[0].fields.map(field => field.key)).toEqual(['Name', 'Quantity']);
  expect(JSON.parse(body.messages[1].content)).toMatchObject({ context: null, pendingRequest: null, resolvedDates: null });
  expect(body.messages).toHaveLength(2);
});

test('the production check distinguishes provider access failures from a successful guided fallback', async () => {
  process.env.OPENAI_API_KEY = 'fictional-test-key';
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  const result = await runCheck({ fetchImpl: jest.fn().mockResolvedValue({ ok: false, status: 403 }) });
  expect(result).toMatchObject({ exitCode: 2, result: { engine: 'guided', status: 'ready', category: 'access', httpStatus: 403 } });
  expect(JSON.stringify(result.result)).not.toMatch(/fictional-test-key|notice|message|plan/);
});

test('the Gemini check actually calls the provider even when local interpretation can prepare its fictitious report', async () => {
  process.env.GEMINI_API_KEY = 'fictional-test-key';
  const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: {
    content: JSON.stringify({ status: 'ready', plan: { entity: 'inventory', selectedFields: ['Name', 'Quantity'], filters: {} } }),
  } }] }) });
  expect(await runCheck({ fetchImpl })).toMatchObject({ exitCode: 0, result: { engine: 'ai', status: 'ready', provider: 'gemini' } });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('an AI reply without a usable report does not mark the diagnostic successful', async () => {
  process.env.OPENAI_API_KEY = 'fictional-test-key';
  const result = await runCheck({ fetchImpl: jest.fn().mockResolvedValue({ ok: true, status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ status: 'unsupported', message: 'private model reply' }) } }] }) }) });
  expect(result).toMatchObject({ exitCode: 3, result: { engine: 'ai', status: 'unsupported' } });
  expect(JSON.stringify(result.result)).not.toContain('private model reply');
});

test('CLI loads the backend configuration regardless of the current directory and reports its exit code', async () => {
  const loadEnv = jest.fn().mockReturnValue({});
  const logger = { log: jest.fn() };
  const parent = {};
  const check = jest.fn().mockResolvedValue({ exitCode: 0, result: { engine: 'ai', status: 'ready' } });
  await runCli({ loadEnv, logger, parent, check });
  expect(loadEnv).toHaveBeenCalledWith({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
  expect(check).toHaveBeenCalledTimes(1);
  expect(JSON.parse(logger.log.mock.calls[0][0])).toEqual({ engine: 'ai', status: 'ready' });
  expect(parent.exitCode).toBe(0);
});

test('CLI file and unexpected failures do not disclose exception paths or secret text', async () => {
  const logger = { log: jest.fn() }; const parent = {}; const check = jest.fn();
  await runCli({ loadEnv: () => ({ error: { code: 'EACCES', message: 'private file with secret-key' } }), logger, parent, check });
  expect(check).not.toHaveBeenCalled();
  expect(parent.exitCode).toBe(2);
  await runCli({ loadEnv: () => ({}), logger, parent, check: async () => { throw new Error('secret-key private file'); } });
  expect(JSON.stringify(logger.log.mock.calls)).not.toMatch(/private file|secret-key|EACCES/);
  expect(parent.exitCode).toBe(2);
});

test('a recovered Gemini model is reported as the active model instead of the retired configured model', async () => {
  process.env.GEMINI_API_KEY = 'fictional-test-key';
  process.env.GEMINI_MODEL = 'gemini-3.0-flash-lite';
  const fetchImpl = jest.fn().mockResolvedValueOnce({ ok: false, status: 404 })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [{ id: 'gemini-3.5-flash-lite' }] }) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ status: 'ready',
      plan: { entity: 'inventory', selectedFields: ['Name', 'Quantity'], filters: {} } }) } }] }) });
  const check = await runCheck({ fetchImpl });
  expect(check).toMatchObject({ exitCode: 0, result: { engine: 'ai', status: 'ready', model: 'gemini-3.5-flash-lite', category: 'available', httpStatus: 200 } });
  expect(JSON.parse(fetchImpl.mock.calls[2][1].body).model).toBe('gemini-3.5-flash-lite');
  expect(JSON.stringify(check.result)).not.toContain('fictional-test-key');
});

test('the check allowlists even observer payloads before printing diagnostic output', async () => {
  process.env.OPENAI_API_KEY = 'fictional-test-key';
  const prepare = jest.fn(async ({ onDiagnostic }) => {
    onDiagnostic({ provider: 'https://private-host?key=secret', model: 'secret-key', category: 'private error message',
      httpStatus: 'secret', networkCode: 'secret', response: 'private response', request: 'Patient Sensitive' });
    return { engine: 'guided', status: 'ready', message: 'private reply' };
  });
  const check = await runCheck({ prepare, fetchImpl: jest.fn() });
  expect(check.result).toMatchObject({ provider: 'unknown', model: 'configured', category: 'unavailable' });
  expect(check.result).not.toHaveProperty('httpStatus');
  expect(check.result).not.toHaveProperty('networkCode');
  expect(JSON.stringify(check.result)).not.toMatch(/secret|private|Sensitive|request|response|reply/);
});

const readyResponse = () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({
  status: 'ready', message: 'private model reply', plan: { entity: 'inventory', selectedFields: ['Name', 'Quantity'], filters: {} },
}) } }] }) });

test('an explicit check config controls the actual host, key and model instead of only the printed metadata', async () => {
  process.env.GEMINI_API_KEY = 'unrelated-fictional-gemini-key';
  const config = { key: 'fictional-check-deepseek-key', model: 'deepseek-chat', base: 'https://api.deepseek.com' };
  const fetchImpl = jest.fn().mockResolvedValue(readyResponse());
  const check = await runCheck({ config, fetchImpl });
  expect(check).toMatchObject({ exitCode: 0, result: { engine: 'ai', status: 'ready', provider: 'deepseek' } });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(fetchImpl.mock.calls[0][0]).toBe('https://api.deepseek.com/chat/completions');
  expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer fictional-check-deepseek-key');
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model).toBe('deepseek-chat');
  expect(JSON.stringify(check)).not.toMatch(/fictional|private model reply|plan/);
});

test('reserve preflight tests each official provider independently with its own host and key, even when automatic failover is enabled', async () => {
  process.env.GEMINI_API_KEY = 'fictional-reserve-gemini-key';
  process.env.OPENAI_API_KEY = 'fictional-reserve-openai-key';
  process.env.REPORT_AI_FALLBACK_PROVIDERS = 'openai';
  const fetchImpl = jest.fn().mockImplementation(async () => readyResponse());
  const check = await runReserveCheck({ fetchImpl });
  expect(check).toMatchObject({ exitCode: 0, result: { status: 'ready', configuredCount: 2, readyCount: 2, officialProviderCount: 2 } });
  expect(check.result.checks.map(item => [item.provider, item.engine, item.status])).toEqual([['gemini', 'ai', 'ready'], ['openai', 'ai', 'ready']]);
  expect(fetchImpl.mock.calls.map(([url, options]) => [url, options.headers.Authorization, JSON.parse(options.body).model])).toEqual([
    ['https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', 'Bearer fictional-reserve-gemini-key', 'gemini-3.5-flash-lite'],
    ['https://api.openai.com/v1/chat/completions', 'Bearer fictional-reserve-openai-key', 'gpt-4o'],
  ]);
  for (const [, options] of fetchImpl.mock.calls) {
    const messages = JSON.parse(options.body).messages;
    const metadata = JSON.parse(messages[0].content.split('Catálogo autorizado: ')[1]);
    expect(metadata).toHaveLength(1);
    expect(metadata[0].source).toBe('Demo');
    expect(metadata[0].fields.map(field => field.key)).toEqual(['Name', 'Quantity']);
    expect(messages).toHaveLength(2);
  }
  expect(JSON.stringify(check.result)).not.toMatch(/fictional|private model reply|plan|request|https:/);
});

test('a missing second key cannot pass reserve release preflight although the configured primary is ready', async () => {
  process.env.GEMINI_API_KEY = 'fictional-primary-only-key';
  process.env.REPORT_AI_FALLBACK_PROVIDERS = 'deepseek,openai';
  const fetchImpl = jest.fn().mockResolvedValue(readyResponse());
  expect(await runReserveCheck({ fetchImpl })).toMatchObject({ exitCode: 2,
    result: { status: 'incomplete', configuredCount: 1, readyCount: 1, officialProviderCount: 1 } });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(await runReserveCheck({ configs: [], fetchImpl })).toEqual({ exitCode: 2,
    result: { status: 'incomplete', configuredCount: 0, readyCount: 0, officialProviderCount: 0, checks: [] } });
});

test('a rejected reserve key fails preflight without letting a good provider conceal the failure', async () => {
  process.env.GEMINI_API_KEY = 'fictional-good-key';
  process.env.OPENAI_API_KEY = 'fictional-bad-key';
  process.env.REPORT_AI_FALLBACK_PROVIDERS = 'openai';
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  const fetchImpl = jest.fn().mockImplementation(async url => url.startsWith('https://api.openai.com') ? { ok: false, status: 401 } : readyResponse());
  const check = await runReserveCheck({ configs: providerChain(), fetchImpl });
  expect(check).toMatchObject({ exitCode: 2, result: { status: 'incomplete', configuredCount: 2, readyCount: 1, officialProviderCount: 1 } });
  expect(check.result.checks[1]).toMatchObject({ engine: 'guided', category: 'credentials', httpStatus: 401 });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(check)).not.toMatch(/fictional|notice|message|plan/);
});

test('two successful configs of the same provider or a custom provider do not prove an independent official reserve', async () => {
  const primary = { key: 'fictional-one', model: 'gpt-4o', base: 'https://api.openai.com/v1' };
  const fetchImpl = jest.fn().mockResolvedValue(readyResponse());
  for (const second of [{ ...primary, key: 'fictional-two' }, { ...primary, base: 'https://proxy.invalid/v1' }]) {
    expect(await runReserveCheck({ configs: [primary, second], fetchImpl })).toMatchObject({ exitCode: 2,
      result: { status: 'incomplete', configuredCount: 2, readyCount: 2, officialProviderCount: 1 } });
  }
});

test('unexpected failures remain sanitized and do not prevent checking the next reserve', async () => {
  const configs = [
    { key: 'fictional-one', model: 'deepseek-chat', base: 'https://api.deepseek.com' },
    { key: 'fictional-two', model: 'gpt-4o', base: 'https://api.openai.com/v1' },
  ];
  const prepare = jest.fn().mockRejectedValueOnce(new Error('secret-key patient private-file'))
    .mockResolvedValueOnce({ engine: 'ai', status: 'ready', plan: { private: 'not printed' } });
  const check = await runReserveCheck({ configs, prepare, fetchImpl: jest.fn() });
  expect(check).toMatchObject({ exitCode: 2, result: { status: 'incomplete', configuredCount: 2, readyCount: 1 } });
  expect(check.result.checks[0]).toMatchObject({ engine: 'guided', status: 'failed', category: 'diagnostic_failed' });
  expect(prepare).toHaveBeenCalledTimes(2);
  expect(prepare.mock.calls.map(([args]) => args.providerOverride)).toEqual(configs);
  expect(JSON.stringify(check)).not.toMatch(/secret|patient|private|fictional|plan/);
});

test('CLI --reserves selects reserve preflight while unknown arguments cannot trigger any check or disclose their text', async () => {
  const logger = { log: jest.fn() }; const parent = {};
  const check = jest.fn();
  const reserveCheck = jest.fn().mockResolvedValue({ exitCode: 2, result: { status: 'incomplete', configuredCount: 1, readyCount: 1, officialProviderCount: 1, checks: [] } });
  const loadEnv = jest.fn().mockReturnValue({});
  await runCli({ argv: ['--reserves'], logger, parent, check, reserveCheck, loadEnv });
  expect(check).not.toHaveBeenCalled();
  expect(reserveCheck).toHaveBeenCalledTimes(1);
  expect(parent.exitCode).toBe(2);
  reserveCheck.mockClear(); loadEnv.mockClear();
  for (const argv of [['--secret=private-key'], ['--reserves', 'Patient Sensitive'], ['--reserves', '--reserves']]) {
    await runCli({ argv, logger, parent, check, reserveCheck, loadEnv });
    expect(parent.exitCode).toBe(2);
  }
  expect(check).not.toHaveBeenCalled();
  expect(reserveCheck).not.toHaveBeenCalled();
  expect(loadEnv).not.toHaveBeenCalled();
  expect(JSON.stringify(logger.log.mock.calls)).not.toMatch(/secret|private|Patient|Sensitive/);
});
