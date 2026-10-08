'use strict';
// Package the entire runtime tree, including uncommitted files. Never read
// credentials, connect to databases or copy a database backup.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { builtinModules } = require('node:module');
const root = path.resolve(__dirname, '..');
const normalize = value => value.split(path.sep).join('/');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const excludedDir = /^(node_modules|tests|coverage|scratch|uploads|__pycache__|\.git|\.venv|venv)$/i;
const excludedFile = /^(?:\.env(?:\..+)?|(?:scratch|test|check|search|query|update)_.+|eslint\.config\.js|jest\.config\.js|nodemon\.json|0)$|\.(?:log|pyc|pyo|db(?:-wal|-shm)?|sqlite(?:-wal|-shm)?|dump|bak)$|_backup\.joblib$/i;
const initialDataPath = /^backend\/(?:data\/|ml\/(?:models|reports)\/)/;

function walk(directory, filtered = false) {
  if (!fs.existsSync(directory)) throw new Error(`Falta el directorio requerido: ${directory}`);
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`No se empaquetan enlaces simbólicos: ${file}`);
    if (filtered && (entry.isDirectory() ? excludedDir.test(entry.name) : excludedFile.test(entry.name) && entry.name !== '.env.example')) return [];
    return entry.isDirectory() ? walk(file, filtered) : [file];
  });
}
const relativeFiles = (directory, filtered = false) => walk(path.join(root, directory), filtered).map(file => normalize(path.relative(root, file)));
const productionEnv = content => content.replace(/^NODE_ENV=.*$/m, 'NODE_ENV=production').replace(/^PORT=.*$/m, 'PORT=5173');

function createPlan() {
  const entries = [];
  const add = (source, destination = source) => {
    if (!fs.statSync(path.join(root, source)).isFile()) throw new Error(`Falta ${source}`);
    entries.push({ source, destination });
  };
  for (const source of relativeFiles('backend', true)) {
    // Histories/models are initial data, installed only if absent. An update
    // must not replace mutable data on the server.
    const initial = initialDataPath.test(source);
    add(source, initial ? `initial-data/${source}` : source);
  }
  for (const directory of ['frontend/dist', 'frontend/public', 'docs', 'database']) {
    for (const source of relativeFiles(directory, true)) {
      if (directory === 'database' && !/\.sql$/i.test(source)) continue;
      add(source);
    }
  }
  for (const source of ['README.md', 'README_PRODUCCION.md', 'GUIA_CONEXION_PRODUCCION_TAILSCALE.md',
    'iniciar_produccion.bat', 'permitir_acceso_red.bat', '.nvmrc', '.runtime/node.exe',
    'scripts/prepare-node-runtime.ps1', 'scripts/initialize-package-data.cjs', 'scripts/production-package.cjs', 'verificar_pase.ps1']) add(source);
  add('instalar_produccion.bat', 'instalar.bat');
  if (new Set(entries.map(entry => entry.destination)).size !== entries.length) throw new Error('Destinos duplicados.');
  return entries.sort((a, b) => a.destination.localeCompare(b.destination));
}
function buildInputs() {
  const envInputs = fs.readdirSync(path.join(root, 'frontend')).filter(name => /^\.env(?:\.|$)/.test(name)).map(name => `frontend/${name}`);
  return [...relativeFiles('frontend/src'), ...relativeFiles('frontend/public'),
    ...envInputs, 'frontend/index.html', 'frontend/vite.config.js', 'frontend/package.json', 'frontend/package-lock.json']
    .sort().map(file => ({ path: file, sha256: hash(path.join(root, file)) }));
}
function resolveModule(base, specifier) {
  const target = path.resolve(path.dirname(base), specifier);
  return [target, `${target}.js`, `${target}.cjs`, `${target}.json`, path.join(target, 'index.js')]
    .find(file => fs.existsSync(file) && fs.statSync(file).isFile());
}
function resolvePackagedModule(directory, base, specifier) {
  const active = resolveModule(base, specifier);
  if (active) return active;
  const relativeTarget = normalize(path.relative(directory, path.resolve(path.dirname(base), specifier)));
  // These resources become active only after initialize-package-data.cjs runs.
  // Keep them in initial-data so an update preserves the server's histories.
  if (!initialDataPath.test(relativeTarget)) return undefined;
  return resolveModule(path.join(directory, 'initial-data', path.relative(directory, base)), specifier);
}
const relativePackageFiles = directory => walk(directory).map(file => normalize(path.relative(directory, file)));

function validateRuntime(directory) {
  const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'backend/package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(directory, 'backend/package-lock.json'), 'utf8'));
  for (const key of ['dependencies', 'devDependencies']) {
    if (JSON.stringify(pkg[key]) !== JSON.stringify(lock.packages[''][key])) throw new Error(`package-lock no coincide con ${key}.`);
  }
  const missing = [];
  const builtins = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`)]);
  for (const file of walk(path.join(directory, 'backend'), true).filter(file => /\.(js|cjs)$/.test(file))) {
    const content = fs.readFileSync(file, 'utf8');
    for (const match of content.matchAll(/\brequire\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      if (!resolvePackagedModule(directory, file, match[1])) missing.push(`${normalize(path.relative(directory, file))}: ${match[1]}`);
    }
    for (const [, name] of content.matchAll(/\brequire\(\s*['"]([^.'"][^'"]*)['"]\s*\)/g)) {
      const dependency = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
      if (!builtins.has(name) && !Object.hasOwn(pkg.dependencies, dependency)) missing.push(`${normalize(path.relative(directory, file))}: dependencia productiva ${dependency}`);
    }
  }
  if (missing.length) throw new Error(`Faltan dependencias locales:\n${missing.join('\n')}`);
  for (const file of ['frontend/public/logo-escandon.png', 'frontend/dist/logo-escandon.png',
    'backend/scripts/start-server.js', 'backend/middleware/publicMessages.middleware.js',
    'backend/services/reportAssistant.service.js', 'backend/services/verticalReportCatalog.service.js']) {
    if (!fs.existsSync(path.join(directory, file))) throw new Error(`Falta recurso de ejecución: ${file}`);
  }
  const assets = new Set(relativePackageFiles(directory).filter(file => file.startsWith('frontend/dist/')));
  for (const relative of [...assets].filter(file => /\.(?:html|js|css)$/.test(file))) {
    const content = fs.readFileSync(path.join(directory, relative), 'utf8');
    // Bundled Browserify modules retain internal require strings. Only actual
    // ESM imports, HTML resources, CSS URLs and Vite preload lists are files.
    const references = /\.js$/.test(relative)
      ? [...content.matchAll(/\b(?:import|export)(?:\s*\(\s*|\s*(?:[^;"']*?\bfrom\s*)?)(["'])([^"']+\.(?:js|css))\1/g)].map(match => match[2])
        .concat([...content.matchAll(/["'](assets\/[^"']+\.(?:js|css))["']/g)].map(match => match[1]))
      : /\.html$/.test(relative)
        ? [...content.matchAll(/\b(?:src|href)\s*=\s*(["'])([^"']+\.(?:js|css))\1/g)].map(match => match[2])
        : [...content.matchAll(/url\(\s*(["']?)([^"'()\s]+\.(?:js|css))\1\s*\)/g)].map(match => match[2]);
    for (const specifier of references.filter(value => !/^(?:https?:|data:)/.test(value))) {
      const resolved = specifier.startsWith('assets/') ? `frontend/dist/${specifier}` : specifier.startsWith('/') ? `frontend/dist${specifier}`
        : normalize(path.relative(directory, path.resolve(directory, path.dirname(relative), specifier)));
      if (!assets.has(resolved)) missing.push(`${relative}: ${specifier}`);
    }
  }
  if (missing.length) throw new Error(`Faltan recursos compilados:\n${missing.join('\n')}`);
  return { backendLocalImports: 'ok', compiledAssets: 'ok', dependencyLock: 'ok' };
}
function verify(directory, againstSource = false) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'MANIFIESTO.json'), 'utf8'));
  const expected = new Set([...manifest.files.map(file => file.path), 'MANIFIESTO.json']);
  for (const file of manifest.files) {
    const target = path.resolve(directory, file.path);
    if (!target.startsWith(path.resolve(directory) + path.sep)) throw new Error('Ruta de manifiesto fuera del paquete.');
    if (!fs.existsSync(target) || hash(target) !== file.sha256) throw new Error(`Falta o cambió: ${file.path}`);
  }
  const extra = relativePackageFiles(directory).filter(file => !expected.has(file));
  if (extra.length) throw new Error(`Archivos ajenos al paquete: ${extra.join(', ')}`);
  if (againstSource) {
    const plan = createPlan();
    const actualSources = new Set(manifest.files.map(file => `${file.source}:${file.path}`));
    if (plan.length !== actualSources.size || plan.some(entry => !actualSources.has(`${entry.source}:${entry.destination}`))) throw new Error('El inventario no cubre todas las fuentes actuales.');
    for (const file of manifest.files) {
      if (hash(path.join(root, file.source)) !== file.sourceSha256) throw new Error(`La fuente cambió después del pase: ${file.source}`);
      const expectedHash = file.source === 'backend/.env.example'
        ? crypto.createHash('sha256').update(productionEnv(fs.readFileSync(path.join(root, file.source), 'utf8'))).digest('hex') : file.sourceSha256;
      if (expectedHash !== file.sha256) throw new Error(`La copia no coincide con la fuente: ${file.source}`);
    }
    if (JSON.stringify(buildInputs()) !== JSON.stringify(manifest.frontendBuildInputs)) throw new Error('El frontend fuente cambió después de compilar este pase.');
  }
  return { files: manifest.files.length, bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0), ...validateRuntime(directory) };
}
function build(staging, inputSnapshot) {
  if (!path.resolve(staging).startsWith(path.join(root, 'tmp') + path.sep) || fs.existsSync(staging)) throw new Error('El staging debe ser nuevo y estar en tmp del proyecto.');
  const plan = createPlan(), files = [];
  const inputs = buildInputs();
  if (inputSnapshot && JSON.stringify(inputs) !== fs.readFileSync(inputSnapshot, 'utf8')) throw new Error('Las fuentes del frontend cambiaron durante la compilación. Recompila.');
  const declaredRuntime = fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim();
  if (process.version !== `v${declaredRuntime}`) throw new Error('Usa el runtime declarado en .nvmrc para preparar el pase.');
  fs.mkdirSync(staging, { recursive: true });
  for (const entry of plan) {
    const source = path.join(root, entry.source), destination = path.join(staging, entry.destination);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (entry.source === 'backend/.env.example') fs.writeFileSync(destination, productionEnv(fs.readFileSync(source, 'utf8')));
    else fs.copyFileSync(source, destination);
    files.push({ path: entry.destination, source: entry.source, bytes: fs.statSync(destination).size, sha256: hash(destination), sourceSha256: hash(source) });
  }
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true });
  const manifest = { schemaVersion: 1, generatedAt: new Date().toISOString(), timezone: 'America/Mexico_City',
    sourceCommit: git.status === 0 ? git.stdout.trim() : null, includesWorkingTree: true,
    runtimeVersion: declaredRuntime,
    databasePolicy: 'Schema only. Preserve production database; no dump or restore.',
    environmentPolicy: 'Example only; preserve production .env.', frontendBuildInputs: inputs, files };
  fs.writeFileSync(path.join(staging, 'MANIFIESTO.json'), JSON.stringify(manifest, null, 2) + '\n');
  return verify(staging, true);
}
if (require.main === module) {
  try {
    const [mode, target, option] = process.argv.slice(2);
    if (!target || !['build', 'verify', 'inputs'].includes(mode)) throw new Error('Uso: production-package.cjs build|verify|inputs <ruta> [opción]');
    if (mode === 'inputs') {
      if (!path.resolve(target).startsWith(path.join(root, 'tmp') + path.sep)) throw new Error('El registro de compilación debe estar en tmp.');
      fs.writeFileSync(target, JSON.stringify(buildInputs()));
      console.log('Fuentes de compilación registradas.');
    } else console.log(JSON.stringify({ ok: true, ...(mode === 'build' ? build(path.resolve(target), option) : verify(path.resolve(target), option === '--source')) }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { root, createPlan, productionEnv, buildInputs, validateRuntime, build, verify };
