/**
 * urlSafety.js — Validación de URLs para evitar SSRF (Server-Side Request Forgery)
 * Hospital Escandón BI Platform
 *
 * Evita que el servidor haga fetch hacia:
 *  - Redes privadas / locales (10/8, 172.16/12, 192.168/16, 127/8, etc.)
 *  - Link-local y metadata cloud (169.254.0.0/16 → 169.254.169.254)
 *  - IPv6 loopback/privadas (::1, fc00::/7, fe80::/10)
 *  - Hosts locales (localhost, *.local)
 */
'use strict';

const dns = require('dns').promises;

/* Rangos IPv4 a bloquear (redes no ruteables) */
const PRIVATE_IPV4 = [
  { start: 0,           end: 0x00ffffff },          // 0.0.0.0/8
  { start: 0x0a000000,  end: 0x0affffff },          // 10.0.0.0/8
  { start: 0x7f000000,  end: 0x7fffffff },          // 127.0.0.0/8 (loopback)
  { start: 0x64400000,  end: 0x647fffff },          // 100.64.0.0/10 (CGNAT)
  { start: 0xac100000,  end: 0xac1fffff },          // 172.16.0.0/12
  { start: 0xa9fe0000,  end: 0xa9feffff },          // 169.254.0.0/16 (link-local / metadata)
  { start: 0xc0a80000,  end: 0xc0a8ffff },          // 192.168.0.0/16
  { start: 0xc6120000,  end: 0xc633ffff },          // 198.18.0.0/15 (benchmark)
  { start: 0xe0000000,  end: 0xefffffff },          // 224.0.0.0/4 (multicast)
];

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const value = ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
  return PRIVATE_IPV4.some((r) => value >= r.start && value <= r.end);
}

function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // fe80::/10
  return false;
}

function isPrivateIP(ip) {
  // new URL().hostname devuelve las IPv6 entre corchetes: '[::1]'
  const clean = ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip;
  return clean.includes(':') ? isPrivateIPv6(clean) : isPrivateIPv4(clean);
}

const LOCAL_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'metadata.google.internal', 'metadata', 'kubernetes.default.svc']);

/**
 * Valida que una URL sea segura para fetch del servidor.
 * Lanza Error('SSRF_BLOCKED') si la URL apunta a redes internas o es inválida.
 * @param {string} urlString
 * @returns {Promise<URL>} URL validada
 */
async function assertSafeFetchUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error('URL inválida');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Solo se permiten URLs http/https');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');

  if (LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith('.local')) {
    throw new Error('SSRF_BLOCKED');
  }

  // Si el host es una IP literal, validarla directamente
  const isLiteralIP = /^[\d.]+$/.test(hostname) || hostname.includes(':');
  if (isLiteralIP) {
    if (isPrivateIP(hostname)) throw new Error('SSRF_BLOCKED');
    return parsed;
  }

  // Resolver DNS y validar TODAS las IPs resultantes
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    if (!addresses.length) throw new Error('SSRF_BLOCKED');
    for (const { address } of addresses) {
      if (isPrivateIP(address)) throw new Error('SSRF_BLOCKED');
    }
  } catch (err) {
    if (err.message === 'SSRF_BLOCKED') throw err;
    // Sin resolución DNS no podemos garantizar seguridad: bloquear
    throw new Error('SSRF_BLOCKED');
  }

  return parsed;
}

module.exports = { assertSafeFetchUrl };