'use strict';

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SERVICE_NAME, instanceId, probeExistingBackend } = require('../utils/backendInstance');

const ENVIRONMENT = 'development';
const INSTALLATION_ID = '0123456789abcdef';
const servers = new Set();

function healthy(overrides = {}) {
  return {
    service: SERVICE_NAME,
    environment: ENVIRONMENT,
    installationId: INSTALLATION_ID,
    status: 'ok',
    db: 'ok',
    version: '1.0.0',
    ...overrides,
  };
}

async function serve(handler) {
  const server = http.createServer(handler);
  const sockets = new Set();
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const fixture = {
    port: server.address().port,
    close: () => new Promise((resolve, reject) => {
      for (const socket of sockets) socket.destroy();
      server.close(error => error ? reject(error) : resolve());
    }),
  };
  servers.add(fixture);
  return fixture;
}

function probe(port, overrides = {}) {
  return probeExistingBackend({
    port,
    environment: ENVIRONMENT,
    installationId: INSTALLATION_ID,
    timeoutMs: 1000,
    ...overrides,
  });
}

function sendJson(response, body, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

afterEach(async () => {
  const fixtures = [...servers];
  servers.clear();
  await Promise.all(fixtures.map(fixture => fixture.close()));
});

test('publishes the stable service identifier used to recognize this backend', () => {
  expect(SERVICE_NAME).toBe('hospital-escandon-bi-backend');
});

test('recognizes a refused connection as a free port', async () => {
  const fixture = await serve((_request, response) => response.end());
  const port = fixture.port;
  servers.delete(fixture);
  await fixture.close();
  await expect(probe(port)).resolves.toEqual({ state: 'free' });
});

test('reuses only a healthy backend from the requested environment and installation', async () => {
  const health = healthy();
  const requests = [];
  const fixture = await serve((request, response) => {
    requests.push({ method: request.method, url: request.url });
    sendJson(response, health);
  });
  await expect(probe(fixture.port)).resolves.toEqual({ state: 'reuse', health });
  expect(requests).toEqual([{ method: 'GET', url: '/health' }]);
});

test.each([
  ['another service', { service: 'unrelated-backend' }],
  ['another environment', { environment: 'production' }],
  ['another installation', { installationId: 'fedcba9876543210' }],
  ['an unidentified legacy backend', { service: undefined, installationId: undefined }],
  ['a degraded backend', { status: 'degradado', db: 'sin_conexion' }],
  ['an inconsistent database state', { status: 'ok', db: 'sin_conexion' }],
])('rejects the occupied port when health describes %s', async (_label, overrides) => {
  const fixture = await serve((_request, response) => sendJson(response, healthy(overrides)));
  await expect(probe(fixture.port)).rejects.toThrow();
});

test('distinguishes a recognized backend that is still starting', async () => {
  const fixture = await serve((_request, response) => {
    sendJson(response, healthy({ status: 'degradado', db: 'pendiente' }));
  });
  await expect(probe(fixture.port)).rejects.toMatchObject({ code: 'BACKEND_STARTING' });
});

test.each([401, 404, 500, 503])('rejects HTTP %s even when its body claims to be healthy', async status => {
  const fixture = await serve((_request, response) => sendJson(response, healthy(), status));
  await expect(probe(fixture.port)).rejects.toThrow();
});

test.each(['<html>Another application</html>', '{not-json', 'null', '[]'])('rejects an invalid health body: %s', async body => {
  const fixture = await serve((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(body);
  });
  await expect(probe(fixture.port)).rejects.toThrow();
});

test('rejects an occupied HTTP port that does not return a response before the deadline', async () => {
  const fixture = await serve(() => { /* Deliberately leave the request unanswered. */ });
  await expect(probe(fixture.port, { timeoutMs: 100 })).rejects.toThrow();
});

test('rejects an oversized response by bytes, including multibyte UTF-8 content', async () => {
  const body = JSON.stringify(healthy({ extra: '界'.repeat(1800) }));
  expect(body.length).toBeLessThan(4096);
  expect(Buffer.byteLength(body, 'utf8')).toBeGreaterThan(4096);
  const fixture = await serve((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    // Two writes also cover accumulating the size across response chunks.
    response.write(body.slice(0, 1000));
    response.end(body.slice(1000));
  });
  await expect(probe(fixture.port)).rejects.toThrow();
});

describe('installation identity', () => {
  let temporaryRoot;
  let installation;
  let secondInstallation;

  beforeAll(() => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-instance-test-'));
    installation = path.join(temporaryRoot, 'Hospital BI');
    secondInstallation = path.join(temporaryRoot, 'Other BI');
    fs.mkdirSync(path.join(installation, 'child'), { recursive: true });
    fs.mkdirSync(secondInstallation);
  });

  afterAll(() => {
    // Only remove the precise temporary fixture created by this test suite.
    const target = path.resolve(temporaryRoot);
    if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('bi-instance-test-')) {
      throw new Error('Refusing to remove a directory outside the temporary test fixture.');
    }
    fs.rmSync(target, { recursive: true, force: true });
  });

  test('returns a stable 16-character hexadecimal identity for equivalent directory paths', () => {
    const identity = instanceId(installation);
    expect(identity).toMatch(/^[0-9a-f]{16}$/);
    expect(instanceId(installation + path.sep)).toBe(identity);
    expect(instanceId(path.join(installation, 'child', '..'))).toBe(identity);
    expect(instanceId(secondInstallation)).not.toBe(identity);
  });

  test('resolves a directory alias to the same installation', () => {
    const alias = path.join(temporaryRoot, 'Alias BI');
    fs.symlinkSync(installation, alias, process.platform === 'win32' ? 'junction' : 'dir');
    expect(instanceId(alias)).toBe(instanceId(installation));
  });

  (process.platform === 'win32' ? test : test.skip)('normalizes Windows directory case', () => {
    expect(instanceId(installation.toUpperCase())).toBe(instanceId(installation.toLowerCase()));
  });
});
