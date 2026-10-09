'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { prepareProductionData } = require('../scripts/start-server');
const { initializePackageData } = require('../../scripts/initialize-package-data.cjs');

const projectRoot = path.resolve(__dirname, '../..');
const fixtureBase = path.join(projectRoot, 'tmp', 'production-data-tests');
const portableRuntime = path.join(projectRoot, '.runtime', 'node.exe');
const executable = process.platform === 'win32' && fs.existsSync(portableRuntime) ? portableRuntime : process.execPath;
const fixtures = [];
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function fixture({ existingHistory = true } = {}) {
  fs.mkdirSync(fixtureBase, { recursive: true });
  const directory = fs.mkdtempSync(path.join(fixtureBase, 'installation with spaces-'));
  fixtures.push(directory);
  const write = (relative, bytes) => {
    const filename = path.resolve(directory, relative);
    if (!filename.startsWith(directory + path.sep)) throw new Error('Fixture path outside temporary installation');
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, bytes);
    return filename;
  };
  const historyBytes = Buffer.from(' { "source": "existing server history", "months": ["2026-09"] }\r\n');
  const envBytes = Buffer.from('NODE_ENV=production\r\nFICTIONAL_SERVER_CONFIG=preserve-exact-bytes\r\n');
  const baselineHistory = JSON.stringify({ source: 'baseline history', months: [] });
  const baselineControls = JSON.stringify({ controls: [{ statistic: '02', month: '2026-09', value: 982 }] });
  const backendDir = path.join(directory, 'backend');
  const history = path.join(backendDir, 'data', 'excel_stats_history.json');
  const controls = path.join(backendDir, 'data', 'statistics_manual_controls.json');
  const sourceHistory = write('initial-data/backend/data/excel_stats_history.json', baselineHistory);
  const sourceControls = write('initial-data/backend/data/statistics_manual_controls.json', baselineControls);
  if (existingHistory) write('backend/data/excel_stats_history.json', historyBytes);
  const environment = write('backend/.env', envBytes);
  const manifest = { files: [
    { path: 'initial-data/backend/data/excel_stats_history.json', sha256: digest(baselineHistory) },
    { path: 'initial-data/backend/data/statistics_manual_controls.json', sha256: digest(baselineControls) },
  ] };
  const manifestPath = write('MANIFIESTO.json', JSON.stringify(manifest));
  const launcher = write('backend/scripts/start-server.js', fs.readFileSync(path.join(projectRoot, 'backend/scripts/start-server.js')));
  const initializer = write('scripts/initialize-package-data.cjs', fs.readFileSync(path.join(projectRoot, 'scripts/initialize-package-data.cjs')));
  // These two dependency stubs keep the real launcher process isolated from
  // credentials, ports, databases, and any running hospital backend.
  write('backend/node_modules/dotenv/index.js', 'module.exports = { config() { return { parsed: {} }; } };');
  write('backend/utils/backendInstance.js', "module.exports = { instanceId() { return 'synthetic-installation'; }, async probeExistingBackend() { return { state: 'fresh' }; } };");
  const started = path.join(backendDir, 'started.log');
  const server = write('backend/server.js', [
    "const fs = require('node:fs'); const path = require('node:path');",
    "const controls = require('./data/statistics_manual_controls.json');",
    "const history = require('./data/excel_stats_history.json');",
    "fs.appendFileSync(path.join(__dirname, 'started.log'), JSON.stringify({ history, controls }) + '\\n');",
    "console.log('FIXTURE_SERVER_READY');",
  ].join('\n'));
  const run = (args = []) => spawnSync(executable, [launcher, ...args], {
    cwd: directory, env: { ...process.env, NODE_ENV: 'production' }, encoding: 'utf8', timeout: 15000, windowsHide: true,
  });
  const logger = { log: jest.fn(), error: jest.fn() };
  const prepare = mode => prepareProductionData({ backendDir, environment: mode || 'production', logger });
  const rewriteManifest = () => fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const expectPreserved = () => {
    if (existingHistory) expect(fs.readFileSync(history)).toEqual(historyBytes);
    expect(fs.readFileSync(environment)).toEqual(envBytes);
  };
  return { directory, write, backendDir, history, controls, sourceHistory, sourceControls, environment,
    historyBytes, envBytes, baselineControls, manifest, manifestPath, launcher, initializer, server, started,
    logger, run, prepare, rewriteManifest, expectPreserved };
}

afterEach(() => {
  for (const directory of fixtures.splice(0)) {
    const absolute = path.resolve(directory);
    if (!absolute.startsWith(path.resolve(fixtureBase) + path.sep)) throw new Error('Refusing cleanup outside fixture directory');
    fs.rmSync(absolute, { recursive: true, force: true });
  }
});

test('direct server load reproduces MODULE_NOT_FOUND, then the real production launcher restores references before require and is idempotent', () => {
  const data = fixture();
  const historyMtime = fs.statSync(data.history).mtimeMs;
  const envMtime = fs.statSync(data.environment).mtimeMs;
  const direct = spawnSync(executable, [data.server], { cwd: data.directory, env: { ...process.env, NODE_ENV: 'production' }, encoding: 'utf8', timeout: 15000, windowsHide: true });
  expect(direct.error).toBeUndefined();
  expect(direct.status).toBe(1);
  expect(direct.stderr).toMatch(/MODULE_NOT_FOUND/);
  expect(direct.stderr).toMatch(/statistics_manual_controls\.json/);
  expect(fs.existsSync(data.started)).toBe(false);

  const first = data.run();
  expect(first.error).toBeUndefined();
  expect(first.status).toBe(0);
  expect(first.stdout).toContain('FIXTURE_SERVER_READY');
  expect(first.stderr).not.toMatch(/MODULE_NOT_FOUND/);
  expect(fs.readFileSync(data.controls, 'utf8')).toBe(data.baselineControls);
  data.expectPreserved();
  const controlsMtime = fs.statSync(data.controls).mtimeMs;

  const second = data.run();
  expect(second.error).toBeUndefined();
  expect(second.status).toBe(0);
  const starts = fs.readFileSync(data.started, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(starts).toHaveLength(2);
  expect(starts[0]).toEqual({ history: JSON.parse(data.historyBytes), controls: JSON.parse(data.baselineControls) });
  expect(starts[1]).toEqual(starts[0]);
  expect(fs.statSync(data.controls).mtimeMs).toBe(controlsMtime);
  expect(fs.statSync(data.history).mtimeMs).toBe(historyMtime);
  expect(fs.statSync(data.environment).mtimeMs).toBe(envMtime);
  data.expectPreserved();
}, 30000);

test('production helper initializes both missing mandatory references using the package manifest', () => {
  const data = fixture({ existingHistory: false });
  data.prepare();
  expect(fs.readFileSync(data.history, 'utf8')).toBe(fs.readFileSync(data.sourceHistory, 'utf8'));
  expect(fs.readFileSync(data.controls, 'utf8')).toBe(data.baselineControls);
  data.expectPreserved();
});

test.each(['development', 'test'])('%s never copies baseline data or requires a production manifest', environment => {
  const data = fixture();
  fs.unlinkSync(data.manifestPath);
  data.prepare(environment);
  expect(fs.existsSync(data.controls)).toBe(false);
  expect(data.logger.log).not.toHaveBeenCalled();
  data.expectPreserved();
});

test('--check validates the real runtime without copying data or starting the server', () => {
  const data = fixture();
  fs.unlinkSync(data.manifestPath);
  const result = data.run(['--check']);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/Runtime/);
  expect(fs.existsSync(data.controls)).toBe(false);
  expect(fs.existsSync(data.started)).toBe(false);
  data.expectPreserved();
}, 15000);

test('already initialized production starts without baseline installation and retains existing controls and history', () => {
  const data = fixture();
  const existingControls = Buffer.from('{ "controls": [{ "value": 12345 }], "source": "server" }\r\n');
  fs.writeFileSync(data.controls, existingControls);
  fs.unlinkSync(data.manifestPath);
  fs.unlinkSync(data.sourceHistory);
  fs.unlinkSync(data.sourceControls);
  expect(() => data.prepare()).not.toThrow();
  const result = data.run();
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(fs.readFileSync(data.controls)).toEqual(existingControls);
  data.expectPreserved();
}, 15000);

test.each([
  ['missing manifest', data => fs.unlinkSync(data.manifestPath), /MANIFIESTO|pase completo/],
  ['missing initializer', data => fs.unlinkSync(data.initializer), /preparador|pase completo/],
  ['missing baseline', data => fs.unlinkSync(data.sourceControls), /initial-data|pase completo/],
  ['changed baseline bytes', data => fs.writeFileSync(data.sourceControls, '{"controls":[{"value":999}]}'), /manifiesto|referencia|pase completo/],
  ['wrong manifest hash', data => { data.manifest.files[1].sha256 = '0'.repeat(64); data.rewriteManifest(); }, /manifiesto|referencia|pase completo/],
  ['missing required manifest entry', data => { data.manifest.files.pop(); data.rewriteManifest(); }, /statistics_manual_controls|referencias|pase completo/],
])('%s aborts helper and real startup without fabricating data or modifying existing server files', (_name, corrupt, expectedError) => {
  const data = fixture();
  corrupt(data);
  expect(() => data.prepare()).toThrow(expectedError);
  expect(fs.existsSync(data.controls)).toBe(false);
  data.expectPreserved();
  const result = data.run();
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(expectedError);
  expect(result.stdout).not.toContain('FIXTURE_SERVER_READY');
  expect(fs.existsSync(data.started)).toBe(false);
  expect(fs.existsSync(data.controls)).toBe(false);
  data.expectPreserved();
}, 15000);

test('malformed JSON with a matching manifest hash is rejected before copying any pending file', () => {
  const data = fixture({ existingHistory: false });
  const malformed = '{ "controls": [ broken JSON';
  fs.writeFileSync(data.sourceControls, malformed);
  data.manifest.files[1].sha256 = digest(malformed);
  data.rewriteManifest();
  expect(() => data.prepare()).toThrow(/JSON|referencia|pase|initial-data/i);
  expect(fs.existsSync(data.controls)).toBe(false);
  expect(fs.existsSync(data.history)).toBe(false);
  data.expectPreserved();
});

test('validation covers every pending source before any copies and skips baselines for existing server files', () => {
  const data = fixture({ existingHistory: false });
  data.manifest.files[1].sha256 = '0'.repeat(64);
  data.rewriteManifest();
  expect(() => initializePackageData(data.directory)).toThrow(/manifiesto|referencia/);
  expect(fs.existsSync(data.history)).toBe(false);
  expect(fs.existsSync(data.controls)).toBe(false);
  data.write('backend/data/excel_stats_history.json', data.historyBytes);
  fs.writeFileSync(data.sourceHistory, 'baseline for existing file can be missing or unusable');
  data.manifest.files[0].sha256 = '0'.repeat(64);
  data.manifest.files[1].sha256 = digest(data.baselineControls);
  data.rewriteManifest();
  expect(initializePackageData(data.directory)).toBe(1);
  expect(fs.readFileSync(data.history)).toEqual(data.historyBytes);
  expect(fs.readFileSync(data.controls, 'utf8')).toBe(data.baselineControls);
  expect(initializePackageData(data.directory)).toBe(0);
  data.expectPreserved();
});
