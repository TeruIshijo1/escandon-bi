'use strict';

const { providerConfig, providerChain, configuredGeminiBackups } = require('../utils/reportAiProviders');

test('the primary preserves priority, matching models and legacy shared endpoint overrides', () => {
  const env = { GEMINI_API_KEY: '  fictional-gemini-key  ', DEEPSEEK_API_KEY: 'fictional-deepseek-key', OPENAI_API_KEY: 'fictional-openai-key',
    GEMINI_MODEL: '  gemini-3.7-flash  ', LLM_BASE_URL: '  https://legacy-proxy.invalid/v1  ' };
  expect(providerConfig(env)).toEqual({ key: 'fictional-gemini-key', model: 'gemini-3.7-flash', base: 'https://legacy-proxy.invalid/v1' });
  expect(providerConfig({ DEEPSEEK_API_KEY: 'fictional', GEMINI_MODEL: 'unrelated-model' })).toEqual({ key: 'fictional', model: 'deepseek-chat', base: 'https://api.deepseek.com' });
  expect(providerConfig({ OPENAI_API_KEY: 'fictional', AZURE_OPENAI_ENDPOINT: '  https://resource.openai.azure.com/deployment  ' }))
    .toEqual({ key: 'fictional', model: 'gpt-4o', base: 'https://resource.openai.azure.com/deployment' });
  expect(providerConfig({ OPENAI_API_KEY: 'fictional', LLM_BASE_URL: 'https://proxy.invalid/v1', AZURE_OPENAI_ENDPOINT: 'https://resource.openai.azure.com/deployment' }).base)
    .toBe('https://proxy.invalid/v1');
});

test('additional configured keys never enable a reserve unless the reserve setting opts in', () => {
  const env = { GEMINI_API_KEY: 'fictional-gemini', DEEPSEEK_API_KEY: 'fictional-deepseek', OPENAI_API_KEY: 'fictional-openai' };
  for (const setting of [undefined, '', '  ']) {
    expect(providerChain({ ...env, REPORT_AI_FALLBACK_PROVIDERS: setting })).toEqual([providerConfig(env)]);
  }
});

test('explicit reserve order is allowlisted, deduplicated, and endpoints cannot inherit the primary override', () => {
  const env = { GEMINI_API_KEY: 'fictional-gemini', DEEPSEEK_API_KEY: 'fictional-deepseek', OPENAI_API_KEY: 'fictional-openai',
    DEEPSEEK_MODEL: '  deepseek-reasoner  ', OPENAI_MODEL: '  gpt-4o-mini  ',
    LLM_BASE_URL: 'https://private-proxy.invalid/v1', AZURE_OPENAI_ENDPOINT: 'https://other-resource.openai.azure.com/deployment',
    REPORT_AI_FALLBACK_PROVIDERS: ' OPENAI, deepseek,openai,gemini,unknown,https://private-host?key=secret,,' };
  expect(providerChain(env)).toEqual([
    { key: 'fictional-gemini', model: 'gemini-3.5-flash-lite', base: 'https://private-proxy.invalid/v1' },
    { key: 'fictional-openai', model: 'gpt-4o-mini', base: 'https://api.openai.com/v1' },
    { key: 'fictional-deepseek', model: 'deepseek-reasoner', base: 'https://api.deepseek.com' },
  ]);
});

test('missing or whitespace keys and invalid provider tokens never create reserves', () => {
  expect(providerChain({ REPORT_AI_FALLBACK_PROVIDERS: 'gemini,deepseek,openai' })).toEqual([]);
  expect(providerConfig({ GEMINI_API_KEY: '  ', DEEPSEEK_API_KEY: 'fictional', GEMINI_MODEL: 'unrelated-model' })).toMatchObject({ key: 'fictional', model: 'deepseek-chat' });
  expect(providerChain({ GEMINI_API_KEY: 'fictional', DEEPSEEK_API_KEY: '  ', REPORT_AI_FALLBACK_PROVIDERS: 'deepseek,openai,invalid' }))
    .toEqual([providerConfig({ GEMINI_API_KEY: 'fictional' })]);
  expect(providerConfig({})).toEqual({ key: undefined, model: 'gpt-4o', base: 'https://api.openai.com/v1' });
});

test('all primary choices use only their own key/model and official bases for explicitly enabled backups', () => {
  const env = { DEEPSEEK_API_KEY: 'fictional-deepseek', DEEPSEEK_MODEL: 'deepseek-chat', OPENAI_API_KEY: 'fictional-openai',
    OPENAI_MODEL: 'gpt-4o', GEMINI_MODEL: 'must-not-affect-another-provider', REPORT_AI_FALLBACK_PROVIDERS: 'openai' };
  expect(providerChain(env)).toEqual([
    { key: 'fictional-deepseek', model: 'deepseek-chat', base: 'https://api.deepseek.com' },
    { key: 'fictional-openai', model: 'gpt-4o', base: 'https://api.openai.com/v1' },
  ]);
});

test('configured Gemini reserves accept stable Flash/Lite models only and preserve requested order', () => {
  const config = { model: 'gemini-3.7-flash', base: 'https://generativelanguage.googleapis.com/v1beta/openai' };
  const env = { REPORT_AI_GEMINI_FALLBACK_MODELS: ' gemini-3.5-flash-lite,gemini-3.8-flash,gemini-3.7-flash,gemini-3.8-flash,gemini-3.5-pro,gemini-4-flash-preview,https://private-host?key=secret,gemini-3.8-flash-tts' };
  expect(configuredGeminiBackups(config, env)).toEqual(['gemini-3.5-flash-lite', 'gemini-3.8-flash']);
  expect(configuredGeminiBackups({ ...config, model: 'gemini-3.5-flash-lite' }, env)).toEqual(['gemini-3.8-flash', 'gemini-3.7-flash']);
  expect(configuredGeminiBackups({ ...config, model: 'gemini-3.5-flash-lite' }, { REPORT_AI_GEMINI_FALLBACK_MODELS: 'gemini-3.4-flash-lite,gemini-3.8-flash' }))
    .toEqual(['gemini-3.4-flash-lite', 'gemini-3.8-flash']);
});

test('custom or invalid endpoints and non-Gemini models cannot switch into Gemini model reserves', () => {
  const env = { REPORT_AI_GEMINI_FALLBACK_MODELS: 'gemini-3.5-flash-lite' };
  expect(configuredGeminiBackups({ model: 'gemini-3.7-flash', base: 'https://custom-provider.invalid/v1' }, env)).toEqual([]);
  expect(configuredGeminiBackups({ model: 'gemini-3.7-flash', base: 'invalid' }, env)).toEqual([]);
  expect(configuredGeminiBackups({ model: 'gpt-4o', base: 'https://generativelanguage.googleapis.com/v1beta/openai' }, env)).toEqual([]);
});
