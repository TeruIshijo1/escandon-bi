'use strict';

const PROVIDERS = ['gemini', 'deepseek', 'openai'];
const SETTINGS = {
  gemini: { key: 'GEMINI_API_KEY', model: 'GEMINI_MODEL', defaultModel: 'gemini-3.5-flash-lite', base: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  deepseek: { key: 'DEEPSEEK_API_KEY', model: 'DEEPSEEK_MODEL', defaultModel: 'deepseek-chat', base: 'https://api.deepseek.com' },
  openai: { key: 'OPENAI_API_KEY', model: 'OPENAI_MODEL', defaultModel: 'gpt-4o', base: 'https://api.openai.com/v1' },
};
const trimmed = value => typeof value === 'string' ? value.trim() : '';

function primaryProvider(env) {
  return PROVIDERS.find(provider => trimmed(env[SETTINGS[provider].key])) || null;
}

function configuredProvider(provider, env, primary = false) {
  const setting = SETTINGS[provider];
  return { key: trimmed(env[setting.key]) || undefined,
    model: trimmed(env[setting.model]) || setting.defaultModel,
    base: primary ? trimmed(env.LLM_BASE_URL) || (provider === 'openai' ? trimmed(env.AZURE_OPENAI_ENDPOINT) : '') || setting.base : setting.base };
}

function providerConfig(env = process.env) {
  // Preserve legacy priority and shared endpoint behavior for the primary.
  // The no-key configuration remains OpenAI-shaped, but cannot send a request.
  return configuredProvider(primaryProvider(env) || 'openai', env, true);
}

function providerChain(env = process.env) {
  const primary = primaryProvider(env);
  if (!primary) return [];
  const chain = [configuredProvider(primary, env, true)];
  const seen = new Set([primary]);
  // Finding another application's key never enables sharing this conversation
  // with that provider. Reserves require an explicit allowlisted setting.
  for (const token of trimmed(env.REPORT_AI_FALLBACK_PROVIDERS).split(',')) {
    const provider = token.trim().toLowerCase();
    if (!PROVIDERS.includes(provider) || seen.has(provider)) continue;
    seen.add(provider);
    if (!trimmed(env[SETTINGS[provider].key])) continue;
    chain.push(configuredProvider(provider, env));
  }
  return chain;
}

function configuredGeminiBackups(config, env = process.env) {
  let host;
  try { host = new URL(config.base).hostname; } catch { return []; }
  if (host !== 'generativelanguage.googleapis.com' || !trimmed(config.model).startsWith('gemini-')) return [];
  // Explicitly selecting a stable Flash reserve is permitted even for a Lite
  // primary. Automatic discovery keeps its conservative same-family policy.
  const pattern = /^gemini-\d+(?:\.\d+)?-flash(?:-lite)?$/;
  return [...new Set(trimmed(env.REPORT_AI_GEMINI_FALLBACK_MODELS).split(',').map(token => token.trim())
    .filter(model => pattern.test(model) && model !== trimmed(config.model)))];
}

module.exports = { providerConfig, providerChain, configuredGeminiBackups };
