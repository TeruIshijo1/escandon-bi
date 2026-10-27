'use strict';
const https = require('https');
const { AsyncLocalStorage } = require('node:async_hooks');
const { StringDecoder } = require('node:string_decoder');
const sapConfig = require('../config/sap.config');
const DEFAULT_TIMEOUT = 30000;
const COLLECTION_TIMEOUT = 300000;
const CACHE_TTL = 300000;
const SESSION_BUDGET = { timeoutMs: DEFAULT_TIMEOUT, queueTimeoutMs: 60000, totalTimeoutMs: 120000 };
const PRIORITIES = { high: 0, normal: 1, low: 2 };
const priority = value => Object.hasOwn(PRIORITIES, value) ? value : 'normal';
const timeout = (value, fallback = DEFAULT_TIMEOUT) => Number.isFinite(value) && value > 0 ? Math.min(value, 900000) : fallback;
const failed = (message, code) => Object.assign(new Error(message), { code });
const cancelled = () => failed('La consulta SAP se canceló.', 'ABORT_ERR');
const expired = (phase = 'total', timeoutScope = 'total') => Object.assign(failed('SAP agotó el tiempo disponible para completar la consulta.', 'SAP_READ_TIMEOUT'), { phase,timeoutScope });
const queueExpired = () => Object.assign(failed('Se agotó la espera para iniciar la consulta SAP.', 'SAP_QUEUE_TIMEOUT'), { phase: 'queue',timeoutScope: 'queue' });
class SapService {
  constructor() {
    const configured = process.env.SAP_MAX_CONCURRENT_REQUESTS;
    if (configured !== undefined && (!/^\d+$/.test(configured) || Number(configured) < 1 || Number(configured) > 10)) throw new Error('SAP_MAX_CONCURRENT_REQUESTS debe ser un entero entre 1 y 10.');
    this.maxConcurrentRequests = configured === undefined ? 3 : Number(configured);
    this.activeRequests = 0;
    this.requestQueue = [];
    this.priorityStore = new AsyncLocalStorage();
    this.sessionCookie = null;
    this.sessionExpiresAt = null;
    this.sessionPending = null;
    this.cache = new Map();
    this.pendingCollections = new Map();
    this.httpsAgent = new https.Agent({
      rejectUnauthorized: sapConfig.rejectUnauthorized,
      keepAlive: true,
      keepAliveMsecs: 15000,
      maxSockets: this.maxConcurrentRequests,
      maxFreeSockets: this.maxConcurrentRequests
    });
  }
  runWithPriority(value, work) {
    return this.priorityStore.run(priority(value), work);
  }
  _url(endpoint, current) {
    if (typeof endpoint !== 'string' || !endpoint.trim() || /[\p{Cc}]/u.test(endpoint)) throw failed('La ruta de consulta SAP no es válida.', 'SAP_ENDPOINT_INVALID');
    const base = new URL(sapConfig.baseUrl), root = base.pathname.replace(/\/$/, '');
    let url;
    if (/^https?:\/\//i.test(endpoint) || endpoint.startsWith('//')) url = new URL(endpoint, base.origin);
    else if (/^\/b1s\/v[12](?:\/|$)/.test(endpoint)) url = new URL(endpoint, base.origin);
    else if (endpoint.startsWith('/')) url = new URL(`${root}${endpoint}`, base.origin);
    else if (/^[?.]/.test(endpoint)) url = new URL(endpoint, current || `${base.origin}${root}/`);
    else url = new URL(endpoint, `${base.origin}${current?.pathname.match(/^\/b1s\/v[12]/)?.[0] || root}/`);
    if (url.origin !== base.origin || url.username || url.password || url.hash || !/^\/b1s\/v[12]\//.test(url.pathname)) throw failed('La paginación debe permanecer dentro de SAP Service Layer.', 'SAP_ENDPOINT_INVALID');
    return url;
  }
  _endpoint(url) {
    const root = new URL(sapConfig.baseUrl).pathname.replace(/\/$/, '');
    return (url.pathname.startsWith(`${root}/`) ? url.pathname.slice(root.length) : url.pathname) + url.search;
  }
  _label(endpoint, payload) {
    try {
      const route = this._url(endpoint).pathname.replace(/^\/b1s\/v[12]/, '');
      const query = route.match(/^\/SQLQueries\('([A-Za-z][A-Za-z0-9_]{0,99})'\)(\/List)?$/);
      if (query) return `SQLQueries('${query[1]}')${query[2] || ''}`;
      if (route === '/SQLQueries' && /^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(payload?.SqlCode || '')) return `SQLQueries('${payload.SqlCode}')`;
      return route.match(/^\/[A-Za-z_$][A-Za-z0-9_$]*/)?.[0] || '/ServiceLayer';
    } catch { return '/ServiceLayer'; }
  }
  _options(options = {}) {
    const split = Number.isFinite(options.totalTimeoutMs) && options.totalTimeoutMs > 0;
    const budget = split ? timeout(options.totalTimeoutMs) : timeout(options.timeoutMs);
    return { ...options,timeoutMs: timeout(options.timeoutMs),queueTimeoutMs: timeout(options.queueTimeoutMs,budget),
      deadlineMs: Math.min(Number.isFinite(options.deadlineMs) ? options.deadlineMs : Infinity,Date.now()+budget),
      priority: priority(options.priority || this.priorityStore.getStore()),
      splitTimeout: split,startedAtMs: options.startedAtMs ?? Date.now() };
  }
  _acquire(signal, deadline, timeoutError = queueExpired, level = 'normal') {
    if (signal?.aborted) return Promise.reject(cancelled());
    if (Date.now() >= deadline) return Promise.reject(timeoutError());
    return new Promise((resolve, reject) => {
      const entry = { signal, deadline, resolve, reject,timeoutError,priority: priority(level) };
      const remove = () => { const index = this.requestQueue.indexOf(entry); if (index >= 0) this.requestQueue.splice(index, 1); clearTimeout(entry.timer); signal?.removeEventListener('abort', entry.abort); };
      entry.abort = () => { remove(); reject(cancelled()); };
      entry.timer = setTimeout(() => { remove(); reject(timeoutError()); }, Math.max(1, deadline - Date.now()));
      entry.cleanup = remove;
      this.requestQueue.push(entry);
      signal?.addEventListener('abort', entry.abort, { once: true });
      this._drainRequests();
    });
  }
  _drainRequests() {
    while (this.activeRequests < this.maxConcurrentRequests && this.requestQueue.length) {
      let selected = 0;
      for (let index = 1; index < this.requestQueue.length; index++) {
        if (PRIORITIES[this.requestQueue[index].priority] < PRIORITIES[this.requestQueue[selected].priority]) selected = index;
      }
      const entry = this.requestQueue.splice(selected, 1)[0]; entry.cleanup();
      if (entry.signal?.aborted) { entry.reject(cancelled()); continue; }
      if (Date.now() >= entry.deadline) { entry.reject(entry.timeoutError()); continue; }
      this.activeRequests++;
      let released = false;
      entry.resolve(() => { if (released) return; released = true; this.activeRequests--; this._drainRequests(); });
    }
  }
  async _request(endpoint, method, payload = null, headers = {}, requestOptions = {}) {
    const options = this._options(requestOptions), url = this._url(endpoint);
    const queuedAt = Date.now(),queueDeadline = Math.min(options.deadlineMs,queuedAt+options.queueTimeoutMs);
    let release,httpStartedAt;
    try {
      release = await this._acquire(options.signal,queueDeadline,queueDeadline < options.deadlineMs || !options.splitTimeout ? queueExpired : () => expired('queue'),options.priority);
      if (options.signal?.aborted) throw cancelled();
      httpStartedAt = Date.now();
      const httpDeadline = options.splitTimeout ? Math.min(options.deadlineMs,httpStartedAt+options.timeoutMs) : options.deadlineMs;
      return await new Promise((resolve, reject) => {
        const request = { method, hostname: url.hostname, port: url.port, path: url.pathname + url.search, agent: this.httpsAgent, signal: options.signal, headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers } };
        let payloadString = '';
        if (payload !== null && ['POST', 'PATCH', 'PUT'].includes(method)) { payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload); request.headers['Content-Length'] = Buffer.byteLength(payloadString, 'utf8'); }
        let timer;
        const req = https.request(request, res => {
          let data = ''; const decoder = new StringDecoder('utf8');
          res.on('error', error => { clearTimeout(timer); req.destroy(error); reject(error); });
          res.on('data', chunk => { data += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); });
          res.on('end', () => {
            clearTimeout(timer); data += decoder.end();
            let json; try { json = JSON.parse(data); } catch { json = data; }
            const timings = { queueWaitMs: httpStartedAt-queuedAt,httpMs: Date.now()-httpStartedAt,totalMs: Date.now()-options.startedAtMs };
            if (res.statusCode >= 200 && res.statusCode < 300) return resolve({ status: res.statusCode, headers: res.headers, data: json,timings });
            const message = json?.error?.message?.value || json?.error?.message || (typeof json === 'string' ? json : JSON.stringify(json)), code = json?.error?.code;
            const definition = method === 'GET' && /^\/SQLQueries\('[A-Za-z][A-Za-z0-9_]{0,99}'\)$/.test(url.pathname.replace(/^\/b1s\/v[12]/, ''));
            if (options.allowMissing === true && definition && (res.statusCode === 404 || (res.statusCode < 500 && String(code) === '-2028'))) return resolve({ status: 200, headers: res.headers, data: { value: [] },timings });
            reject(Object.assign(new Error(`[SAP ${res.statusCode}] ${message || 'Error en Service Layer'}`), { status: res.statusCode, error: json, code }));
          });
        });
        req.on('error', reject); req.once('close', () => clearTimeout(timer));
        timer = setTimeout(() => req.destroy(expired('http',httpDeadline < options.deadlineMs ? 'http' : 'total')), Math.max(1,httpDeadline-Date.now()));
        if (payloadString) req.write(payloadString); req.end();
      });
    } catch (error) {
      Object.assign(error,{ phase: error.phase || (httpStartedAt === undefined ? 'queue' : 'http'),
        queueWaitMs: (httpStartedAt ?? Date.now())-queuedAt,httpMs: httpStartedAt === undefined ? 0 : Date.now()-httpStartedAt,
        totalMs: Date.now()-options.startedAtMs });
      throw error;
    } finally { release?.(); }
  }
  _wait(entry, signal, deadline, phase = 'total') {
    if (signal?.aborted) { if (!entry.consumers && !entry.done) entry.controller.abort(); return Promise.reject(cancelled()); }
    entry.consumers++;
    return new Promise((resolve, reject) => {
      let settled = false, timer;
      const finish = (callback, value) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); entry.consumers--; if (!entry.consumers && !entry.done) entry.controller.abort(); callback(value); };
      const abort = () => finish(reject, cancelled());
      signal?.addEventListener('abort', abort, { once: true });
      if (Number.isFinite(deadline)) timer = setTimeout(() => finish(reject, expired(phase)), Math.max(1, deadline - Date.now()));
      entry.promise.then(value => finish(resolve, value), error => finish(reject, error));
    });
  }
  async _pause(milliseconds, options) {
    if (options.signal?.aborted) throw cancelled();
    if (Date.now() + milliseconds >= options.deadlineMs) throw expired();
    await new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(cancelled()); };
      const timer = setTimeout(() => { options.signal?.removeEventListener('abort', abort); resolve(); }, milliseconds);
      options.signal?.addEventListener('abort', abort, { once: true });
    });
  }
  async login(retries = 2, requestOptions = {}) {
    if (!sapConfig.companyDb || !sapConfig.username || !sapConfig.password) throw new Error('Credenciales de SAP no configuradas en el servidor.');
    const options = this._options(requestOptions);
    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      const start = Date.now();
      try {
        const response = await this._request('/Login', 'POST', { CompanyDB: sapConfig.companyDb, UserName: sapConfig.username, Password: sapConfig.password }, {}, options);
        if (response.headers?.['set-cookie']) this.sessionCookie = response.headers['set-cookie'].map(cookie => cookie.split(';')[0]).join('; ');
        else if (response.data?.SessionId) this.sessionCookie = `B1SESSION=${response.data.SessionId}`;
        else throw failed('SAP no confirmó una sesión válida.', 'SAP_SESSION_INVALID');
        const minutes = Number(response.data?.SessionTimeout) || 30;
        this.sessionExpiresAt = Date.now() + Math.max(1, minutes - 5) * 60000;
        console.log('[SAP] Sesión iniciada.'); return true;
      } catch (error) {
        const retry = attempt <= retries && [500, 502, 503, 299].includes(Number(error.status || error.code));
        console.warn('[SAP] Solicitud no completada', { method: 'POST', resource: '/Login', attempt, attempts: retries + 1, durationMs: Date.now() - start,phase: error.phase || 'session',queueWaitMs: error.queueWaitMs || 0,httpMs: error.httpMs || 0,totalMs: Date.now()-options.startedAtMs, status: Number(error.status) || 'SAP_SESSION_FAILED', retry });
        if (!retry) throw error; await this._pause(2500, options);
      }
    }
  }
  async _ensureSession(requestOptions = {}) {
    const options = this._options(requestOptions);
    if (options.signal?.aborted) throw cancelled();
    if (this.sessionCookie && this.sessionExpiresAt && Date.now() <= this.sessionExpiresAt) return;
    if (!this.sessionPending || this.sessionPending.controller.signal.aborted) {
      const entry = { controller: new AbortController(), consumers: 0, done: false }; this.sessionPending = entry;
      // Shared login has its own ceiling; each consumer keeps its deadline and cancellation.
      entry.promise = this.login(2, { ...SESSION_BUDGET,signal: entry.controller.signal }).finally(() => { entry.done = true; if (this.sessionPending === entry) this.sessionPending = null; });
    }
    return this._wait(this.sessionPending, options.signal, options.deadlineMs,'session');
  }
  async _requestWithRetry(endpoint, method, payload = null, headers = {}, retries = 2, requestOptions = {}) {
    const options = this._options(requestOptions), maximum = method === 'GET' ? retries + 1 : 1;
    for (let attempt = 1; attempt <= maximum; attempt++) {
      const start = Date.now();
      try {
        const response = await this._request(endpoint, method, payload, headers, options);
        if (response.timings?.totalMs >= 10000) console.log('[SAP] Solicitud completada', { method,resource: this._label(endpoint,payload),attempt,
          ...response.timings,sessionWaitMs: options.sessionWaitMs || 0 });
        return response;
      }
      catch (error) {
        const retry = attempt < maximum && !options.signal?.aborted && Date.now()+1500 < options.deadlineMs
          && ([502,503,504].includes(Number(error.status)) || ['ECONNRESET','ETIMEDOUT'].includes(error.code)
            || (error.code === 'SAP_READ_TIMEOUT' && error.phase === 'http' && error.timeoutScope === 'http'));
        console.warn('[SAP] Solicitud no completada', { method, resource: this._label(endpoint, payload), attempt, attempts: maximum,
          durationMs: Date.now()-start,phase: error.phase || 'http',timeoutScope: error.timeoutScope || null,
          queueWaitMs: error.queueWaitMs || 0,httpMs: error.httpMs || 0,sessionWaitMs: options.sessionWaitMs || 0,totalMs: Date.now()-options.startedAtMs,
          status: Number(error.status) || (['ABORT_ERR','SAP_QUEUE_TIMEOUT','SAP_READ_TIMEOUT','ECONNRESET','ETIMEDOUT'].includes(error.code) ? error.code : 'SAP_REQUEST_FAILED'), retry });
        if (!retry) throw error; await this._pause(1500, options);
      }
    }
  }
  async get(endpoint, additionalHeaders = {}, requestOptions = {}) {
    const options = this._options(requestOptions); await this._sessionFor(endpoint,'GET',options);
    return this._requestWithRetry(endpoint, 'GET', null, { Cookie: this.sessionCookie, ...additionalHeaders }, 2, options);
  }
  async post(endpoint, payload, additionalHeaders = {}, requestOptions = {}) {
    const options = this._options(requestOptions); await this._sessionFor(endpoint,'POST',options,payload);
    return this._requestWithRetry(endpoint, 'POST', payload, { Cookie: this.sessionCookie, ...additionalHeaders }, 0, options);
  }
  async patch(endpoint, payload, additionalHeaders = {}, requestOptions = {}) {
    const options = this._options(requestOptions); await this._sessionFor(endpoint,'PATCH',options,payload);
    return this._requestWithRetry(endpoint, 'PATCH', payload, { Cookie: this.sessionCookie, ...additionalHeaders }, 0, options);
  }
  async _sessionFor(endpoint,method,options,payload) {
    const start = Date.now();
    try { await this._ensureSession(options); }
    catch (error) {
      error.phase ||= 'session';
      console.warn('[SAP] Solicitud no completada',{ method,resource: this._label(endpoint,payload),attempt: 0,attempts: method === 'GET' ? 3 : 1,
        phase: 'session',sessionWaitMs: Date.now()-start,queueWaitMs: 0,httpMs: 0,totalMs: Date.now()-options.startedAtMs,
        status: ['ABORT_ERR','SAP_QUEUE_TIMEOUT','SAP_READ_TIMEOUT'].includes(error.code) ? error.code : 'SAP_SESSION_FAILED',retry: false });
      throw error;
    } finally { options.sessionWaitMs = Date.now()-start; }
  }
  async fetchAllPages(endpoint, additionalHeaders = {}, maxPages = 1000, requestOptions = {}) {
    if (maxPages && typeof maxPages === 'object') { requestOptions = maxPages; maxPages = requestOptions.maxPages ?? 1000; }
    if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 10000) throw failed('El límite de páginas SAP no es válido.', 'SAP_PAGE_LIMIT');
    if (requestOptions.signal?.aborted) throw cancelled();
    if (Number.isFinite(requestOptions.deadlineMs) && Date.now() >= requestOptions.deadlineMs) throw expired();
    const initial = this._url(endpoint), headers = { Prefer: 'odata.maxpagesize=1000', ...additionalHeaders };
    const ttl = requestOptions.cacheTtlMs === 0 ? 0 : timeout(requestOptions.cacheTtlMs, CACHE_TTL);
    const key = JSON.stringify([initial.href, Object.entries(headers).sort(([a], [b]) => a.localeCompare(b)), maxPages, ttl, timeout(requestOptions.timeoutMs), timeout(requestOptions.totalTimeoutMs, COLLECTION_TIMEOUT),requestOptions.queueTimeoutMs ?? null]);
    const cached = this.cache.get(key);
    if (ttl && cached && Date.now() - cached.timestamp < ttl) return cached.data;
    if (cached) this.cache.delete(key);
    let entry = this.pendingCollections.get(key);
    if (!entry || entry.controller.signal.aborted) {
      entry = { controller: new AbortController(), consumers: 0, done: false }; const own = entry;
      this.pendingCollections.set(key, own);
      own.deadlineMs = Date.now()+timeout(requestOptions.totalTimeoutMs,COLLECTION_TIMEOUT);
      const budget = setTimeout(() => { own.timedOut = true; own.controller.abort(); }, timeout(requestOptions.totalTimeoutMs, COLLECTION_TIMEOUT));
      own.promise = (async () => {
        const rows = [], seen = new Set(), collection = initial.pathname.replace(/^\/b1s\/v[12]/, ''); let current = initial;
        while (current) {
          if (own.controller.signal.aborted) throw own.timedOut ? expired() : cancelled();
          const identity = new URL(current); identity.searchParams.sort();
          if (seen.has(identity.href) || seen.size >= maxPages) throw failed('SAP no completó una paginación verificable.', 'SAP_PAGE_LIMIT');
          seen.add(identity.href);
          const response = await this.get(this._endpoint(current), headers, { signal: own.controller.signal, timeoutMs: timeout(requestOptions.timeoutMs), allowMissing: false,
            ...(requestOptions.queueTimeoutMs !== undefined ? { queueTimeoutMs: requestOptions.queueTimeoutMs,totalTimeoutMs: Math.max(1,own.deadlineMs-Date.now()),deadlineMs: own.deadlineMs } : {}) });
          const data = response?.data;
          if (!Array.isArray(data?.value) || data.value.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw failed('SAP devolvió una página incompleta.', 'SAP_PAGE_INVALID');
          for (const row of data.value) rows.push(row);
          const first = data['@odata.nextLink'], second = data['odata.nextLink'];
          if ([first, second].some(link => link !== undefined && link !== null && typeof link !== 'string')) throw failed('SAP devolvió una continuación inválida.', 'SAP_PAGE_INVALID');
          if (first && second && first !== second) throw failed('SAP devolvió dos continuaciones distintas.', 'SAP_PAGE_INVALID');
          const next = first || second;
          if (next === undefined || next === null || next === '') current = null;
          else { if (typeof next !== 'string') throw failed('SAP devolvió una continuación inválida.', 'SAP_PAGE_INVALID'); current = this._url(next, current); if (current.pathname.replace(/^\/b1s\/v[12]/, '') !== collection) throw failed('SAP cambió la colección durante la paginación.', 'SAP_PAGE_INVALID'); }
        }
        if (own.controller.signal.aborted) throw own.timedOut ? expired() : cancelled();
        if (ttl) { this.cache.delete(key); this.cache.set(key, { timestamp: Date.now(), data: rows }); while (this.cache.size > 30) this.cache.delete(this.cache.keys().next().value); }
        return rows;
      })().catch(error => { throw own.timedOut ? expired() : error; }).finally(() => { clearTimeout(budget); own.done = true; if (this.pendingCollections.get(key) === own) this.pendingCollections.delete(key); });
    }
    return this._wait(entry,requestOptions.signal,requestOptions.deadlineMs);
  }
}
module.exports = new SapService();
