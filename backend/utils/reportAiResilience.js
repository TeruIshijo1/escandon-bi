'use strict';

const { createHash } = require('node:crypto');
const LIST_TTL = 15 * 60 * 1000;
const SUCCESS_TTL = 60 * 60 * 1000;
const COOLING_TTL = 30 * 1000;
const MAX_GEMINI_OPERATIONS = 2;
const discovered = new Map();
const successful = new Map();
const cooling = new Map();
const providerCooling = new Map();
const activeProviderOperations = new Map();

function cacheKey(config) {
  const keyHash = createHash('sha256').update(String(config.key || '')).digest('hex');
  // The opaque identifier separates credentials and configurations without
  // returning an API key, endpoint or model as printable cache-key content.
  return createHash('sha256').update(JSON.stringify([String(config.base || ''), String(config.model || ''), keyHash])).digest('hex');
}

function cleanupExpired(now = Date.now()) {
  for (const map of [discovered, successful, providerCooling]) {
    for (const [key, entry] of map) if (entry.expires <= now) map.delete(key);
  }
  for (const [key, models] of cooling) {
    for (const [model, expires] of models) if (expires <= now) models.delete(model);
    if (!models.size) cooling.delete(key);
  }
}

function getDiscoveredModels(key) {
  cleanupExpired();
  const entry = discovered.get(key);
  return entry ? [...entry.models] : null;
}

function setDiscoveredModels(key, models) {
  cleanupExpired();
  if (!Array.isArray(models)) return;
  const safeModels = [...new Set(models.filter(model => typeof model === 'string' && model.length > 0 && model.length <= 120))];
  discovered.set(key, { models: safeModels, expires: Date.now() + LIST_TTL });
}

function invalidateDiscoveredModels(key) {
  cleanupExpired();
  discovered.delete(key);
}

function getSuccessfulModel(key) {
  cleanupExpired();
  return successful.get(key)?.model || null;
}

function setSuccessfulModel(key, model) {
  cleanupExpired();
  if (typeof model !== 'string' || !model || model.length > 120) return;
  successful.set(key, { model, expires: Date.now() + SUCCESS_TTL });
}

function invalidateSuccessfulModel(key) {
  cleanupExpired();
  successful.delete(key);
}

function isCooling(key, model) {
  cleanupExpired();
  return Boolean(cooling.get(key)?.has(model));
}

function recordFailure(key, model, status) {
  cleanupExpired();
  if (status !== 503 || typeof model !== 'string' || !model || model.length > 120) return;
  if (!cooling.has(key)) cooling.set(key, new Map());
  cooling.get(key).set(model, Date.now() + COOLING_TTL);
}

function recordSuccess(key, model) {
  cleanupExpired();
  const models = cooling.get(key);
  models?.delete(model);
  if (models && !models.size) cooling.delete(key);
}

function isProviderCooling(key) {
  cleanupExpired();
  return providerCooling.has(key);
}

function recordProviderFailure(key, category) {
  cleanupExpired();
  if (!['configuration', 'credentials', 'access', 'model', 'rate_limit', 'capacity', 'provider', 'network', 'timeout', 'response_format'].includes(category)) return;
  providerCooling.set(key, { expires: Date.now() + COOLING_TTL });
}

function recordProviderSuccess(key) {
  providerCooling.delete(key);
}

function tryAcquireProvider(provider) {
  cleanupExpired();
  const active = activeProviderOperations.get(provider) || 0;
  if (active >= MAX_GEMINI_OPERATIONS) return null;
  activeProviderOperations.set(provider, active + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (activeProviderOperations.get(provider) || 1) - 1;
    if (remaining) activeProviderOperations.set(provider, remaining);
    else activeProviderOperations.delete(provider);
  };
}

const tryAcquireGemini = () => tryAcquireProvider('gemini');

function abortable(operation, signal) {
  // Prefer a thunk so an already cancelled operation never starts. Promises
  // are accepted too, and their late rejection always has a handler.
  if (signal?.aborted) {
    if (typeof operation !== 'function') Promise.resolve(operation).catch(() => {});
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value, ok) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      if (ok) resolve(value); else reject(value);
    };
    const onAbort = () => finish(signal.reason, false);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    let result;
    try { result = typeof operation === 'function' ? operation() : operation; }
    catch (error) { finish(error, false); return; }
    Promise.resolve(result).then(value => finish(value, true), error => finish(error, false));
  });
}

module.exports = { cacheKey, getDiscoveredModels, setDiscoveredModels, invalidateDiscoveredModels,
  getSuccessfulModel, setSuccessfulModel, invalidateSuccessfulModel, isCooling, recordFailure,
  recordSuccess, isProviderCooling, recordProviderFailure, recordProviderSuccess,
  tryAcquireGemini, tryAcquireProvider, abortable };
