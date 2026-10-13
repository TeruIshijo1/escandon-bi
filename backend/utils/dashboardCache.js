/**
 * dashboardCache.js — Caché en memoria para optimizar tiempos de respuesta de tableros
 * Hospital Escandón BI Platform
 */
'use strict';

const cache = new Map();

/**
 * Obtiene un elemento de la caché si no ha expirado.
 */
function get(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    cache.delete(key);
    return null;
  }
  return item.data;
}

/**
 * Guarda un elemento en la caché con un TTL en segundos (default 60s).
 */
function set(key, data, ttlSeconds = 60) {
  cache.set(key, {
    data,
    expiresAt: Date.now() + (ttlSeconds * 1000)
  });
}

/**
 * Elimina claves que coincidan con un prefijo o todas si no se especifica.
 */
function invalidate(prefix) {
  if (!prefix) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

/**
 * Helper de conveniencia para envolver llamadas a tableros.
 */
async function getCachedOrFetch(key, fetchFn, ttlSeconds = 60, bypass = false) {
  if (!bypass) {
    const cached = get(key);
    if (cached) {
      return cached;
    }
  }
  const result = await fetchFn();
  if (result) {
    set(key, result, ttlSeconds);
  }
  return result;
}

module.exports = {
  get,
  set,
  invalidate,
  getCachedOrFetch
};
