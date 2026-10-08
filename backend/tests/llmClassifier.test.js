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
