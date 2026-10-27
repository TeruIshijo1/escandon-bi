'use strict';

const CONNECTION_TIMEOUT_MS = 10000;
const QUERY_TIMEOUT_MS = 30000;

function timeoutError(phase) {
  return Object.assign(new Error('La base local tardó demasiado en responder.'), {
    code: 'STATISTICS_DB_TIMEOUT', phase, status: 503
  });
}

// Scope the server limit to each statistics checkout and restore it before reuse
// by another module. A client deadline alone does not stop a running PostgreSQL query.
function createStatisticsDatabase(source, { connectionTimeoutMs = CONNECTION_TIMEOUT_MS, queryTimeoutMs = QUERY_TIMEOUT_MS } = {}) {
  async function connect() {
    let expired = false;
    let timer;
    const pending = Promise.resolve().then(() => source.connect()).then(client => {
      if (expired) { client.release(); throw timeoutError('connection'); }
      return client;
    }).catch(error => {
      if (/timeout exceeded when trying to connect|connection terminated due to connection timeout/i.test(error?.message || '')) throw timeoutError('connection');
      throw error;
    });
    let raw;
    try {
      raw = await Promise.race([pending, new Promise((_, reject) => {
        timer = setTimeout(() => { expired = true; reject(timeoutError('connection')); }, connectionTimeoutMs);
      })]);
    } finally { clearTimeout(timer); }
    let released = false, destroyed = false, releasePromise;
    const destroy = error => {
      if (destroyed) return;
      destroyed = true;
      raw.release(error);
    };
    const execute = async (text, values) => {
      let queryTimer;
      try {
        return await Promise.race([
          Promise.resolve().then(() => raw.query(text, values)),
          new Promise((_, reject) => {
            queryTimer = setTimeout(() => {
              const error = timeoutError('query');
              destroy(error);
              reject(error);
            }, queryTimeoutMs);
          })
        ]);
      } catch (error) {
        if (error?.code === '57014') {
          const bounded = timeoutError('query');
          destroy(bounded);
          throw bounded;
        }
        throw error;
      } finally { clearTimeout(queryTimer); }
    };
    let previousTimeout;
    try {
      const setting = await execute("SELECT setting FROM pg_settings WHERE name = 'statement_timeout'");
      previousTimeout = Number(setting.rows[0]?.setting);
      if (!Number.isSafeInteger(previousTimeout) || previousTimeout < 0) throw new Error('No se pudo comprobar el límite de consulta estadística.');
      const effective = previousTimeout > 0 ? Math.min(previousTimeout, queryTimeoutMs) : queryTimeoutMs;
      await execute("SELECT set_config('statement_timeout', $1, false)", [`${effective}ms`]);
    } catch (error) { destroy(error); throw error; }
    const release = error => {
      if (releasePromise) return releasePromise;
      released = true;
      releasePromise = (async () => {
        if (error) destroy(error);
        if (destroyed) return;
        try { await execute("SELECT set_config('statement_timeout', $1, false)", [`${previousTimeout}ms`]); }
        catch (restoreError) { destroy(restoreError); }
        if (!destroyed) { destroyed = true; raw.release(); }
      })();
      return releasePromise;
    };
    return {
      release,
      async query(text, values) {
        if (released || destroyed) throw Object.assign(new Error('La conexión estadística ya está cerrada.'), { code: 'STATISTICS_DB_CONNECTION_CLOSED' });
        return execute(text, values);
      }
    };
  }
  return {
    connect,
    async query(text, values) {
      const client = await connect();
      let failure;
      try { return await client.query(text, values); }
      catch (error) { failure = error; throw error; }
      finally { await client.release(failure); }
    }
  };
}

module.exports = { createStatisticsDatabase, CONNECTION_TIMEOUT_MS, QUERY_TIMEOUT_MS };
