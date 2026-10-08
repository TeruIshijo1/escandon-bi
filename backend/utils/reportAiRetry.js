'use strict';

function retryDelay(response, retryIndex, gemini, now = Date.now(), random = Math.random()) {
  const backoff = gemini ? 1000 * 2 ** retryIndex + Math.floor(Math.max(0, Math.min(1, random)) * 200) : 250;
  const header = response.headers?.get?.('retry-after');
  if (typeof header !== 'string' || !header.trim()) return backoff;
  const seconds = /^\d+(?:\.\d+)?$/.test(header.trim()) ? Number(header.trim()) : NaN;
  const requested = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
  return Number.isFinite(requested) && requested >= 0 ? Math.max(backoff, requested) : backoff;
}

function waitForRetry(delay, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, delay);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

module.exports = { retryDelay, waitForRetry };
