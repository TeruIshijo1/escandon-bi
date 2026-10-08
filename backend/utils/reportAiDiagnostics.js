'use strict';

// Diagnostics must never serialize provider errors, URLs, environment values,
// response bodies or conversation text. Every value below is allowlisted.
const NETWORK_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
  'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'ERR_TLS_CERT_ALTNAME_INVALID']);
const MODEL_PATTERN = /^(?:gemini-\d+(?:\.\d+)?-(?:flash(?:-lite)?|pro)(?:-(?:preview|latest)(?:-\d+)?)?|deepseek-(?:chat|reasoner)|gpt-\d+(?:\.\d+)?o?(?:-(?:mini|nano|turbo|chat-latest|preview|latest))?|o[1-9](?:-(?:mini|preview))?)$/;
const PROVIDERS = new Set(['gemini', 'deepseek', 'openai', 'azure', 'custom', 'unknown']);
const CATEGORIES = new Set(['available', 'configuration', 'timeout', 'response_format', 'credentials',
  'access', 'model', 'rate_limit', 'capacity', 'provider', 'network', 'unavailable', 'client_busy', 'cooldown']);

function safeModel(model) {
  return typeof model === 'string' && model.length <= 80 && MODEL_PATTERN.test(model) ? model : 'configured';
}

function providerDetails(config) {
  let endpoint;
  try { endpoint = new URL(config.base); } catch { /* Do not expose malformed URLs. */ }
  const host = endpoint?.hostname;
  const provider = host === 'generativelanguage.googleapis.com' ? 'gemini'
    : host === 'api.deepseek.com' ? 'deepseek' : host === 'api.openai.com' ? 'openai'
      : host?.endsWith('.openai.azure.com') ? 'azure' : endpoint ? 'custom' : 'unknown';
  return { provider, model: safeModel(config.model), keyConfigured: Boolean(config.key),
    endpointValid: Boolean(endpoint && ['https:', 'http:'].includes(endpoint.protocol) && !endpoint.username && !endpoint.password) };
}

function failureDiagnostic(config, error, { stage = 'request', httpStatus, aborted = false, activeModel = config.model } = {}) {
  const details = providerDetails({ ...config, model: activeModel });
  const networkCode = [error?.cause?.code, error?.code].find(code => NETWORK_CODES.has(code));
  const status = Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : undefined;
  let category = 'unavailable';
  if (!details.endpointValid || stage === 'configuration') category = 'configuration';
  else if (aborted || error?.name === 'AbortError' || error?.name === 'TimeoutError') category = 'timeout';
  else if (stage === 'client_busy' || stage === 'cooldown') category = stage;
  else if (stage === 'response') category = 'response_format';
  else if (stage === 'http') category = ({ 401: 'credentials', 403: 'access', 404: 'model', 429: 'rate_limit', 503: 'capacity' })[status] || 'provider';
  else if (networkCode || error?.name === 'TypeError') category = 'network';
  return { provider: details.provider, model: details.model, category,
    ...(stage === 'http' && status ? { httpStatus: status } : {}), ...(networkCode ? { networkCode } : {}) };
}

function sanitizeDiagnostic(value) {
  return { provider: PROVIDERS.has(value?.provider) ? value.provider : 'unknown',
    model: safeModel(value?.model), category: CATEGORIES.has(value?.category) ? value.category : 'unavailable',
    ...(Number.isInteger(value?.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599 ? { httpStatus: value.httpStatus } : {}),
    ...(NETWORK_CODES.has(value?.networkCode) ? { networkCode: value.networkCode } : {}) };
}

module.exports = { providerDetails, failureDiagnostic, sanitizeDiagnostic };
