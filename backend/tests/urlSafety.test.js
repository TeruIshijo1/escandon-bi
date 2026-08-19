/**
 * urlSafety.test.js — Tests de protección SSRF
 */
'use strict';

const { assertSafeFetchUrl } = require('../utils/urlSafety');

describe('assertSafeFetchUrl', () => {
  test('rechaza URLs con protocolo no http(s)', async () => {
    await expect(assertSafeFetchUrl('file:///etc/passwd')).rejects.toThrow(/http|https/i);
    await expect(assertSafeFetchUrl('ftp://example.com/x')).rejects.toThrow(/http|https/i);
  });

  test('rechaza URLs inválidas', async () => {
    await expect(assertSafeFetchUrl('no-es-una-url')).rejects.toThrow(/URL inválida/i);
  });

  test('rechaza IPs privadas literales', async () => {
    await expect(assertSafeFetchUrl('http://127.0.0.1/')).rejects.toThrow('SSRF_BLOCKED');
    await expect(assertSafeFetchUrl('http://10.0.0.5/')).rejects.toThrow('SSRF_BLOCKED');
    await expect(assertSafeFetchUrl('http://192.168.1.10/')).rejects.toThrow('SSRF_BLOCKED');
    await expect(assertSafeFetchUrl('http://172.16.0.1/')).rejects.toThrow('SSRF_BLOCKED');
  });

  test('rechaza metadata cloud y link-local', async () => {
    await expect(assertSafeFetchUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow('SSRF_BLOCKED');
    await expect(assertSafeFetchUrl('http://169.254.169.254/')).rejects.toThrow('SSRF_BLOCKED');
  });

  test('rechaza localhost y dominios .local', async () => {
    await expect(assertSafeFetchUrl('http://localhost:4000/api')).rejects.toThrow('SSRF_BLOCKED');
    await expect(assertSafeFetchUrl('http://intranet.local/')).rejects.toThrow('SSRF_BLOCKED');
    await expect(assertSafeFetchUrl('http://metadata.google.internal/')).rejects.toThrow('SSRF_BLOCKED');
  });

  test('rechaza IPv6 privadas', async () => {
    await expect(assertSafeFetchUrl('http://[::1]:8080/')).rejects.toThrow('SSRF_BLOCKED');
    await expect(assertSafeFetchUrl('http://[fc00::1]/')).rejects.toThrow('SSRF_BLOCKED');
  });

  test('permite URLs públicas https', async () => {
    const parsed = await assertSafeFetchUrl('https://sl.hospesc.com:50000/b1s/v2');
    expect(parsed.hostname).toBe('sl.hospesc.com');
  });

  test('permite dominios públicos con resolución DNS', async () => {
    const parsed = await assertSafeFetchUrl('https://www.google.com/');
    expect(parsed.protocol).toBe('https:');
  });
});