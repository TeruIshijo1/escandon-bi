import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, '../..');
const runtime = process.env.CODEX_PRIMARY_RUNTIME || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies');
const require = createRequire(import.meta.url);
const argumentsMap = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1]]);
  return pairs;
}, []));
const source = path.resolve(argumentsMap.source || path.join(repository, 'docs/Mapa_Instructivo_Plataforma_y_Origen_Datos.md'));
const output = path.resolve(argumentsMap.output || path.join(repository, 'tmp/pdfs/mapa-2026-10-09/updated-map.pdf'));
if (path.extname(output).toLowerCase() !== '.pdf') throw new Error('La salida debe tener extensión .pdf.');
const config = path.resolve(argumentsMap.config || path.join(here, 'config.json'));
const outputDirectory = path.dirname(output);

async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
let markedFile;
if (process.env.MAPA_PDF_MARKED) markedFile = process.env.MAPA_PDF_MARKED;
else {
  try { markedFile = require.resolve('marked'); } catch { /* The desktop bundle is the supported fallback. */ }
  if (!markedFile) {
    const moduleRoots = [process.env.CODEX_RUNTIME_NODE_MODULES, path.join(runtime, 'node/node_modules')].filter(Boolean);
    for (const root of moduleRoots) {
      const candidate = path.join(root, 'marked/lib/marked.esm.js');
      if (await exists(candidate)) { markedFile = candidate; break; }
    }
  }
}
if (!markedFile) throw new Error('Falta marked: configura MAPA_PDF_MARKED o instala marked en el proyecto.');
const { marked } = await import(pathToFileURL(markedFile).href);
const markdown = await fs.readFile(source, 'utf8');
const sourceHash = crypto.createHash('sha256').update(markdown).digest('hex');
const tokens = marked.lexer(markdown, { gfm: true });
const anchors = [...markdown.matchAll(/<a\s+id="([^"]+)"[^>]*>/g)].map(match => match[1]);
const types = {};
function count(items) {
  for (const item of items || []) {
    types[item.type] = (types[item.type] || 0) + 1;
    if (item.type === 'list') for (const entry of item.items) count(entry.tokens);
    else if (item.type === 'blockquote') count(item.tokens);
  }
}
count(tokens);
await fs.mkdir(outputDirectory, { recursive: true });
const tokenFile = path.join(outputDirectory, 'map-tokens.json');
await fs.writeFile(tokenFile, JSON.stringify({ source, sourceHash, anchors, types, tokens }), 'utf8');
if (argumentsMap['tokens-only'] === 'true') {
  process.stdout.write(`${JSON.stringify({ sourceHash, anchors: anchors.length, types, tokenFile }, null, 2)}\n`);
  process.exit(0);
}
const pythonCandidates = [process.env.MAPA_PDF_PYTHON, process.env.CODEX_RUNTIME_PYTHON,
  path.join(runtime, 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python'), 'python'].filter(Boolean);
let python;
for (const candidate of pythonCandidates) {
  if (candidate === 'python' || await exists(candidate)) { python = candidate; break; }
}
const result = spawnSync(python, [path.join(here, 'build.py'), '--tokens', tokenFile, '--output', output, '--config', config],
  { cwd: repository, encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024, windowsHide: true });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
const currentHash = crypto.createHash('sha256').update(await fs.readFile(source, 'utf8')).digest('hex');
const sourceUnchanged = currentHash === sourceHash;
const qaFile = output.replace(/\.pdf$/i, '.qa.json');
if (await exists(qaFile)) {
  const qa = JSON.parse(await fs.readFile(qaFile, 'utf8'));
  qa.currentSourceHashAtCompletion = currentHash;
  qa.sourceUnchangedAtCompletion = sourceUnchanged && qa.sourceHash === sourceHash;
  await fs.writeFile(qaFile, JSON.stringify(qa, null, 2), 'utf8');
}
if (result.status !== 0) process.exit(result.status || 1);
if (!sourceUnchanged) {
  process.stderr.write('El Markdown cambió durante la exportación. Vuelve a ejecutar el generador antes de entregar el PDF.\n');
  process.exit(2);
}
