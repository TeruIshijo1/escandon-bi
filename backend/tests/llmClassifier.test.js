'use strict';
const envKeys = ['GEMINI_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'GEMINI_MODEL', 'DEEPSEEK_MODEL', 'OPENAI_MODEL', 'LLM_BASE_URL', 'AZURE_OPENAI_ENDPOINT'];
let originalEnv, originalFetch;
beforeEach(() => {
  originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  envKeys.forEach(key => delete process.env[key]);
  originalFetch = global.fetch;
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'cirugias_dia' } }] }) }));
  jest.resetModules();
});
afterEach(() => {
  envKeys.forEach(key => { if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key]; });
  global.fetch = originalFetch;
  jest.resetModules();
});
test.each([
  [{ GEMINI_API_KEY: 'fictional', OPENAI_MODEL: 'other-model' }, 'generativelanguage.googleapis.com', 'gemini-3.5-flash-lite'],
  [{ GEMINI_API_KEY: 'fictional', GEMINI_MODEL: 'configured-gemini' }, 'generativelanguage.googleapis.com', 'configured-gemini'],
  [{ DEEPSEEK_API_KEY: 'fictional', GEMINI_MODEL: 'unrelated-model' }, 'api.deepseek.com', 'deepseek-chat'],
  [{ OPENAI_API_KEY: 'fictional', GEMINI_MODEL: 'unrelated-model', DEEPSEEK_MODEL: 'unrelated-model' }, 'api.openai.com', 'gpt-4o'],
])('uses the selected provider and its model without mixing configuration: %j', async (env, host, model) => {
  Object.assign(process.env, env);
  const { classifyWithLLM } = require('../services/aria/core/llmClassifier');
  expect(await classifyWithLLM('quiero las cirugias', [{ id: 'cirugias_dia', patterns: [/cirugia/] }])).toBe('cirugias_dia');
  const [url, options] = global.fetch.mock.calls[0];
  expect(new URL(url).hostname).toBe(host);
  expect(JSON.parse(options.body).model).toBe(model);
});
test('without a configured provider keeps the local classifier available and makes no request', async () => {
  const { classifyWithLLM } = require('../services/aria/core/llmClassifier');
  expect(await classifyWithLLM('quiero las cirugias', [])).toBeNull();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('no authorized intents makes no external request even with an API key', async () => {
  process.env.GEMINI_API_KEY = 'fictional';
  const { classifyWithLLM } = require('../services/aria/core/llmClassifier');
  expect(await classifyWithLLM('Una consulta privada', [])).toBeNull();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('billing failure is safely reported once and never reads an external error body', async () => {
  process.env.GEMINI_API_KEY = 'fictional-secret-key';
  const json = jest.fn(); global.fetch.mockResolvedValue({ ok: false, status: 402, json });
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const diagnostic = jest.fn();
  const { classifyWithLLM } = require('../services/aria/core/llmClassifier');
  expect(await classifyWithLLM('quiero las cirugias', [{ id: 'cirugias_dia', patterns: [] }], { onDiagnostic: diagnostic })).toBeNull();
  expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({ provider: 'gemini', category: 'billing', httpStatus: 402 }));
  expect(global.fetch).toHaveBeenCalledTimes(1); expect(json).not.toHaveBeenCalled();
  expect(JSON.stringify(warning.mock.calls)).not.toContain('fictional-secret-key'); warning.mockRestore();
});

test('classifier never executes an intent invented by the provider', async () => {
  process.env.GEMINI_API_KEY = 'fictional';
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'private-finances' } }] }) });
  const { classifyWithLLM } = require('../services/aria/core/llmClassifier');
  expect(await classifyWithLLM('Una pregunta nueva', [{ id: 'cirugias_dia', patterns: [] }])).toBeNull();
});
