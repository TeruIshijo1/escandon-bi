'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const pack = require('./production-package.cjs');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function fixture(t) {
  const temporaryRoot = path.resolve(pack.root, 'tmp');
  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'package-test-'));
  t.after(() => {
    assert.ok(path.resolve(directory).startsWith(temporaryRoot + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const write = (file, text = '') => { fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true }); fs.writeFileSync(path.join(directory, file), text); };
  const pkg = { dependencies: {}, devDependencies: {} };
  write('backend/package.json', JSON.stringify(pkg));
  write('backend/package-lock.json', JSON.stringify({ packages: { '': pkg } }));
  for (const file of ['frontend/public/logo-escandon.png', 'frontend/dist/logo-escandon.png', 'backend/scripts/start-server.js', 'backend/middleware/publicMessages.middleware.js', 'backend/services/reportAssistant.service.js', 'backend/services/verticalReportCatalog.service.js']) write(file);
  write('frontend/dist/index.html', '<script src="/assets/main.js"></script>');
  write('frontend/dist/assets/main.js', 'import("./lazy.js");');
  write('frontend/dist/assets/lazy.js', 'export const value=1;');
  const files = [];
  const visit = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) visit(file); else files.push({ path: path.relative(directory, file).split(path.sep).join('/'), sha256: hash(file), bytes: fs.statSync(file).size }); } };
  visit(directory); write('MANIFIESTO.json', JSON.stringify({ files }));
  return { directory, write };
}
test('inventory includes new runtime files and protects credentials, uploads, dumps and mutable data', () => {
  const plan = pack.createPlan();
  for (const source of ['backend/scripts/migrate-honorarios.js', 'backend/services/reportIntent.service.js', 'backend/services/honorariosSources.service.js', 'backend/services/sapAccountReview.service.js', '.runtime/node.exe', 'backend/package-lock.json']) assert.ok(plan.some(entry => entry.source === source));
  assert.ok(!plan.some(entry => /(?:^|\/)\.env$|node_modules\/|uploads\/|\.dump$|_backup\.joblib$/.test(entry.destination)));
  assert.ok(plan.filter(entry => entry.source.startsWith('backend/data/')).every(entry => entry.destination.startsWith('initial-data/')));
});
test('production configuration comes from the example and changes only server mode and port', () => {
  assert.equal(pack.productionEnv('NODE_ENV=development\nPORT=4000\nGEMINI_MODEL=gemini-3.5-flash-lite\nGEMINI_API_KEY=\n'), 'NODE_ENV=production\nPORT=5173\nGEMINI_MODEL=gemini-3.5-flash-lite\nGEMINI_API_KEY=\n');
});
test('verification accepts a complete package and detects a missing lazy chunk', t => {
  const { directory } = fixture(t);
  assert.equal(pack.verify(directory).compiledAssets, 'ok');
  fs.unlinkSync(path.join(directory, 'frontend/dist/assets/lazy.js'));
  assert.throws(() => pack.verify(directory), /Falta o cambió/);
  assert.throws(() => pack.validateRuntime(directory), /Faltan recursos compilados/);
});
test('verification detects edited code and private files added to a package', t => {
  const { directory, write } = fixture(t);
  write('backend/.env', 'NOT_A_REAL_SECRET=fictional');
  assert.throws(() => pack.verify(directory), /Archivos ajenos/);
  fs.unlinkSync(path.join(directory, 'backend/.env'));
  write('backend/services/reportAssistant.service.js', '// changed');
  assert.throws(() => pack.verify(directory), /Falta o cambió/);
});
test('runtime audit rejects missing local imports and packages available only as dev dependencies', t => {
  const { directory, write } = fixture(t);
  write('backend/services/reportAssistant.service.js', "require('./missing.service');");
  assert.throws(() => pack.validateRuntime(directory), /Faltan dependencias locales/);
  write('backend/services/reportAssistant.service.js', "require('some-dev-only-module');");
  assert.throws(() => pack.validateRuntime(directory), /dependencia productiva/);
});

test('runtime audit resolves statistics JSON imports from initial-data and detects a missing resource', t => {
  const { directory, write } = fixture(t);
  write('backend/services/statistics.service.js', "module.exports = { history: require('../data/excel_stats_history.json'), controls: require('../data/statistics_manual_controls.json') };");
  write('initial-data/backend/data/excel_stats_history.json', JSON.stringify({ source: 'baseline history' }));
  write('initial-data/backend/data/statistics_manual_controls.json', JSON.stringify({ controls: [{ value: 982 }] }));
  assert.equal(pack.validateRuntime(directory).backendLocalImports, 'ok');
  for (const resource of ['excel_stats_history.json', 'statistics_manual_controls.json']) {
    const filename = path.join(directory, 'initial-data/backend/data', resource);
    const original = fs.readFileSync(filename);
    fs.unlinkSync(filename);
    assert.throws(() => pack.validateRuntime(directory), /Faltan dependencias locales/);
    fs.writeFileSync(filename, original);
  }
  write('backend/services/reportAssistant.service.js', "require('./missing.service');");
  write('initial-data/backend/services/missing.service.js', 'module.exports = {};');
  assert.throws(() => pack.validateRuntime(directory), /Faltan dependencias locales/);
});

test('statistics JSON imports load after installation while an existing server history is preserved', t => {
  const { directory, write } = fixture(t);
  write('scripts/initialize-package-data.cjs', fs.readFileSync(path.join(pack.root, 'scripts/initialize-package-data.cjs')));
  write('backend/services/statistics.service.js', "module.exports = { history: require('../data/excel_stats_history.json'), controls: require('../data/statistics_manual_controls.json') };");
  write('initial-data/backend/data/excel_stats_history.json', JSON.stringify({ source: 'baseline history' }));
  write('initial-data/backend/data/statistics_manual_controls.json', JSON.stringify({ controls: [{ value: 982 }] }));
  write('backend/data/excel_stats_history.json', JSON.stringify({ source: 'existing server history' }));
  write('MANIFIESTO.json', JSON.stringify({ files: [
    { path: 'initial-data/backend/data/excel_stats_history.json' },
    { path: 'initial-data/backend/data/statistics_manual_controls.json' },
  ] }));
  const script = path.join(directory, 'scripts/initialize-package-data.cjs');
  assert.match(execFileSync(process.execPath, [script], { encoding: 'utf8', windowsHide: true }), /1 archivos nuevos/);
  assert.match(execFileSync(process.execPath, [script], { encoding: 'utf8', windowsHide: true }), /0 archivos nuevos/);
  const statistics = require(path.join(directory, 'backend/services/statistics.service.js'));
  assert.equal(statistics.history.source, 'existing server history');
  assert.deepEqual(statistics.controls, { controls: [{ value: 982 }] });
});

test('installation initializes missing data once and preserves the existing server history and environment', t => {
  const { directory, write } = fixture(t);
  write('scripts/initialize-package-data.cjs', fs.readFileSync(path.join(pack.root, 'scripts/initialize-package-data.cjs')));
  write('initial-data/backend/data/history.json', 'baseline history');
  write('initial-data/backend/ml/models/example.joblib', 'baseline model');
  write('backend/data/history.json', 'existing server history');
  write('backend/.env', 'FICTIONAL_SERVER_CONFIG=preserved');
  write('MANIFIESTO.json', JSON.stringify({ files: [
    { path: 'initial-data/backend/data/history.json' },
    { path: 'initial-data/backend/ml/models/example.joblib' },
  ] }));
  const script = path.join(directory, 'scripts/initialize-package-data.cjs');
  assert.match(execFileSync(process.execPath, [script], { encoding: 'utf8', windowsHide: true }), /1 archivos nuevos/);
  assert.match(execFileSync(process.execPath, [script], { encoding: 'utf8', windowsHide: true }), /0 archivos nuevos/);
  assert.equal(fs.readFileSync(path.join(directory, 'backend/data/history.json'), 'utf8'), 'existing server history');
  assert.equal(fs.readFileSync(path.join(directory, 'backend/.env'), 'utf8'), 'FICTIONAL_SERVER_CONFIG=preserved');
  assert.equal(fs.readFileSync(path.join(directory, 'backend/ml/models/example.joblib'), 'utf8'), 'baseline model');
  assert.ok(fs.statSync(path.join(directory, 'backend/uploads/excel')).isDirectory());
});
