

'use strict';

const dns = require('dns').promises;

const PRIVATE_IPV4 = [
  { start: 0,           end: 0x00ffffff },           
  { start: 0x0a000000,  end: 0x0affffff },           
  { start: 0x7f000000,  end: 0x7fffffff },           
  { start: 0x64400000,  end: 0x647fffff },           
  { start: 0xac100000,  end: 0xac1fffff },           
  { start: 0xa9fe0000,  end: 0xa9feffff },           
  { start: 0xc0a80000,  end: 0xc0a8ffff },           
  { start: 0xc6120000,  end: 0xc633ffff },           
  { start: 0xe0000000,  end: 0xefffffff },           
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
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;  
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;  
  return false;
}

function isPrivateIP(ip) {
   
  const clean = ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip;
  return clean.includes(':') ? isPrivateIPv6(clean) : isPrivateIPv4(clean);
}

const LOCAL_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'metadata.google.internal', 'metadata', 'kubernetes.default.svc']);

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
     
    throw new Error('SSRF_BLOCKED');
  }

  return parsed;
}

module.exports = { assertSafeFetchUrl };