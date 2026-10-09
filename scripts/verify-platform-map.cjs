#!/usr/bin/env node
'use strict';

// Documentary verification only. Never assemble Markdown, launch the backend,
// load real database clients, or execute queries against any source system.
// Usage: node scripts/verify-platform-map.cjs [--cut-date YYYY-MM-DD]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const documentFile = 'docs/Mapa_Instructivo_Plataforma_y_Origen_Datos.md';
const reportFile = 'tmp/pdfs/mapa-2026-10-09/map-coverage.json';
const cutIndex = process.argv.indexOf('--cut-date');
const cutDate = cutIndex < 0 ? '2026-10-09' : process.argv[cutIndex + 1];
const issues = [];
const issue = (code, detail) => issues.push({ code, detail });
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const sourceReadHashes = new Map();
const read = file => {
  const buffer = fs.readFileSync(path.join(root, file));
  if (!sourceReadHashes.has(file)) sourceReadHashes.set(file, sha256(buffer));
  return buffer.toString('utf8');
};
const lineAt = (source, index) => source.slice(0, index).split('\n').length;
const walk = directory => fs.readdirSync(path.join(root, directory), { withFileTypes: true })
  .sort((a, b) => a.name.localeCompare(b.name))
  .flatMap(entry => entry.isDirectory() ? walk(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]);
const codeMention = (document, value) => document.includes(`\`${value}\``);
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function extractCatalog() {
  const allowed = new Set(['sapReportCatalog.service.js', 'verticalReportCatalog.service.js',
    'assistantResourceCatalog.service.js', 'assistantVerticalSources.service.js',
    'assistantAccountFinance.service.js', 'assistantAccountCase.service.js', 'assistantPriceLists.service.js',
    'assistantReportComposition.service.js', 'reportVocabulary.service.js', 'reportAnalysis.service.js',
    'sapQueryBuilder.service.js', 'statisticsCatalog.js']);
  const loaded = new Map();
  const touched = new Set();
  const blocked = () => { throw new Error('Source-system I/O is prohibited by the documentary verifier.'); };
  function load(name) {
    if (loaded.has(name)) return loaded.get(name);
    if (!allowed.has(name)) throw new Error(`Static catalog module is not allowed: ${name}`);
    const file = `backend/services/${name}`;
    touched.add(file);
    const module = { exports: {} };
    loaded.set(name, module.exports);
    const context = { module, exports: module.exports, console: { log() {}, warn() {}, error() {} },
      process: { env: { NODE_ENV: 'test' } }, setTimeout: blocked, setInterval: blocked,
      clearTimeout() {}, clearInterval() {}, Buffer, URL, AbortController,
      require(request) {
        if (request.endsWith('.json')) {
          const absolute = path.resolve(root, 'backend/services', request);
          const relative = path.relative(root, absolute).replaceAll('\\', '/');
          if (!relative.startsWith('backend/config/')) throw new Error(`Unexpected catalog JSON: ${request}`);
          touched.add(relative);
          return JSON.parse(read(relative));
        }
        const requested = path.basename(request) + (request.endsWith('.js') ? '' : '.js');
        if (allowed.has(requested)) return load(requested);
        if (request.includes('remote-db')) return { connectRemoteDB: blocked, getRemoteDb: blocked, sql: {} };
        if (request.includes('pg-db')) return { pool: { query: blocked } };
        if (request.includes('savedReportAccess')) return {};
        if (request.includes('sap')) return new Proxy({}, { get: () => blocked });
        throw new Error(`Unexpected catalog dependency: ${request}`);
      } };
    const extra = name === 'assistantResourceCatalog.service.js' ? '\nmodule.exports.__definitions = definitions;' : '';
    vm.runInNewContext(read(file) + extra, context, { filename: file, timeout: 10000 });
    loaded.set(name, module.exports);
    return module.exports;
  }
  const builder = load('sapQueryBuilder.service.js');
  // Run getters inside the VM too, so future changes cannot create an unbounded
  // catalog evaluation. System connectors remain throwing stubs throughout.
  const getterContext = { builder, catalog: null, manual: null };
  vm.runInNewContext('manual=builder.getEntityCatalog(); catalog=builder.getAssistantCatalog();',
    getterContext, { timeout: 10000 });
  const manual = getterContext.manual;
  const all = getterContext.catalog;
  const manualIds = new Set(manual.map(item => item.id));
  const assistant = all.filter(item => !manualIds.has(item.id));
  const resources = load('assistantResourceCatalog.service.js').__definitions;
  const groups = [
    ['Consultas especializadas de convenios, cuenta y precios', item => !item.composition && !resources[item.id]],
    ['Recursos de Vertical declarados por metadatos', item => !item.composition && resources[item.id] && !resources[item.id].target && item.source === 'Vertical'],
    ['Recursos de SAP declarados por metadatos', item => !item.composition && resources[item.id] && !resources[item.id].target && item.source === 'SAP'],
    ['Relaciones declaradas entre recursos de Vertical', item => !item.composition && Boolean(resources[item.id]?.target)],
    ['Combinaciones de Vertical con pagador/artículo de SAP', item => Boolean(item.composition)],
  ].map(([name, filter]) => ({ name, count: assistant.filter(filter).length }));
  return { manual, assistant, all, groups, statisticSections: load('statisticsCatalog.js').SECTIONS,
    sourceFiles: [...touched].sort() };
}

function inventoryHttp() {
  const server = read('backend/server.js');
  const variables = new Map([...server.matchAll(/const\s+(\w+)\s*=\s*require\(['"]\.\/routes\/([^'"]+)['"]\)/g)]
    .map(match => [match[1], `backend/routes/${match[2]}.js`]));
  const prefixes = new Map();
  for (const match of server.matchAll(/app\.use\(\s*['"]([^'"]+)['"]\s*,([^;]+)\);/g)) {
    for (const [variable, file] of variables) {
      if (new RegExp(`\\b${escapeRegex(variable)}\\b`).test(match[2])) prefixes.set(file, match[1]);
    }
  }
  const routeFiles = walk('backend/routes').filter(file => file.endsWith('.js'));
  // Nested literal router mounts inherit the parent's URL prefix.
  for (let pass = 0; pass < routeFiles.length; pass += 1) {
    let changed = false;
    for (const file of routeFiles) {
      if (!prefixes.has(file)) continue;
      for (const match of read(file).matchAll(/router\.use\(\s*require\(['"]\.\/([^'"]+)['"]\)\s*\)/g)) {
        const target = `backend/routes/${match[1]}.js`;
        if (!prefixes.has(target)) { prefixes.set(target, prefixes.get(file)); changed = true; }
      }
    }
    if (!changed) break;
  }
  const endpoints = [];
  let literalDeclarations = 0;
  for (const file of routeFiles) {
    const source = read(file);
    if (!prefixes.has(file)) issue('route_file_mount_unknown', file);
    for (const match of source.matchAll(/router\.(get|post|put|delete|patch|all)\s*\(\s*(['"`])([^'"`]+)\2/g)) {
      literalDeclarations += 1;
      const record = { method: match[1].toUpperCase(), route: (prefixes.get(file) || '[unmounted]') + match[3], file, line: lineAt(source, match.index) };
      if (match[3].includes('${')) {
        // Deliberately recognize only this reviewed, explicit source loop.
        // An unknown dynamic route must be reviewed instead of counted once.
        const loop = source.match(/for\s*\(\s*const\s+action\s+of\s+\[\s*'prepare'\s*,\s*'execute'\s*,\s*'status'\s*\]\s*\)/);
        if (file === 'backend/routes/sap.routes.js' && loop && match[3] === '/account-review/:account/reopening/${action}') {
          for (const action of ['prepare', 'execute', 'status']) endpoints.push({ ...record, route: record.route.replace('${action}', action), expandedFromLoop: true });
        } else issue('dynamic_http_route_unverified', { file, line: record.line, route: record.route });
      } else endpoints.push(record);
    }
  }
  for (const match of server.matchAll(/app\.(get|post|put|delete|patch)\s*\(\s*(['"`])([^'"`]+)\2/g)) {
    literalDeclarations += 1;
    if (match[3].includes('${')) issue('dynamic_server_route_unverified', match[3]);
    else endpoints.push({ method: match[1].toUpperCase(), route: match[3], file: 'backend/server.js', line: lineAt(server, match.index) });
  }
  return { endpoints, routeFiles, literalDeclarations };
}

function inventoryKpis() {
  const kpis = [];
  for (const file of ['database/04_kpi_config.sql', 'backend/config/pg-db.js', 'backend/config/init-db.js']) {
    const source = read(file);
    for (const match of source.matchAll(/\(\s*['"]((?:directivo|mando|area|stats|audit|home)\.[a-zA-Z0-9_.-]+)['"]/g)) {
      if (!kpis.some(item => item.id === match[1])) kpis.push({ id: match[1], file, line: lineAt(source, match.index) });
    }
  }
  return kpis;
}

function checkStructure(document) {
  const lines = document.split(/\r?\n/);
  const anchorIds = [...document.matchAll(/<a\s+id=['"]([^'"]+)['"]\s*><\/a>/g)].map(match => match[1]);
  const anchorSet = new Set(anchorIds);
  if (anchorSet.size !== anchorIds.length) issue('duplicate_heading_anchor', anchorIds.filter((id, index) => anchorIds.indexOf(id) !== index));
  const links = [...document.matchAll(/\]\(#([^)]+)\)/g)].map(match => match[1]);
  for (const id of new Set(links)) if (!anchorSet.has(id)) issue('internal_link_target_missing', id);
  const anchoredHeadings = [...document.matchAll(/<a\s+id=['"]([^'"]+)['"]\s*><\/a>\s*\n\s*\n(#{2,4}) ([^\n]+)/g)];
  const headings = lines.filter(line => /^#{2,4} /.test(line) && line !== '## Índice de consulta');
  if (headings.length !== anchoredHeadings.length) issue('heading_anchor_coverage', { headings: headings.length, anchored: anchoredHeadings.length });
  for (const match of anchoredHeadings) if (match[2].length <= 3 && !links.includes(match[1])) issue('toc_heading_missing', match[3]);
  let fence = null, tableColumns = null, tableCount = 0;
  const isHeaderSeparator = line => {
    const cells = String(line || '').trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
    return cells.length > 0 && cells.every(cell => /^:?-+:?$/.test(cell));
  };
  for (const [index, line] of lines.entries()) {
    const marker = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (marker) {
      if (!fence) fence = { character: marker[1][0], length: marker[1].length, line: index + 1 };
      else if (marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      tableColumns = null;
      continue;
    }
    if (fence) continue;
    if (line.startsWith('|')) {
      const separators = [...line.matchAll(/(?<!\\)\|/g)].length;
      if (tableColumns === null) {
        tableColumns = separators; tableCount += 1;
        if (isHeaderSeparator(line) || !isHeaderSeparator(lines[index + 1])) {
          issue('table_header_separator_missing', { table: tableCount, line: index + 1, header: line.slice(0, 160) });
        }
      }
      else if (separators !== tableColumns) issue('table_column_mismatch', { table: tableCount, line: index + 1, separators, expected: tableColumns });
    } else tableColumns = null;
  }
  if (fence) issue('unclosed_code_fence', fence.line);
  if (document.includes('\uFFFD')) issue('unicode_replacement_character', true);
  for (const title of ['## Anexo: catálogo extendido del asistente', '## Anexo de control: rutas, archivos de pantalla y servicios registrados', '### Identificadores iniciales de KPI configurables']) {
    if (!document.includes(title)) issue('required_final_appendix_missing', title);
  }
  return { lines: lines.length, headings: headings.length, anchors: anchorIds.length, internalLinks: links.length, tables: tableCount };
}

function checkReferences(document) {
  const references = [];
  for (const line of document.split(/\r?\n/)) {
    let lastFile;
    for (const match of line.matchAll(/`(?:(?<file>(?:frontend|backend|database|scripts)\/[\w./-]+\.(?:jsx?|json|sql|cjs|mjs|ps1)):(?<start>\d+)(?:[-–](?<end>\d+))?|:(?<shortStart>\d+)(?:[-–](?<shortEnd>\d+))?)`/g)) {
      if (match.groups.file) lastFile = match.groups.file;
      if (lastFile) references.push({ file: lastFile, start: Number(match.groups.start || match.groups.shortStart), end: Number(match.groups.end || match.groups.shortEnd || match.groups.start || match.groups.shortStart) });
    }
  }
  for (const match of document.matchAll(/\]\(<?([A-Za-z]:[\\/][^)>]+?)(?::(\d+)(?:[-–](\d+))?)?>?\)/g)) {
    const absolute = path.resolve(match[1]);
    const file = path.relative(root, absolute).replaceAll('\\', '/');
    if (!file.startsWith('..') && !path.isAbsolute(file)) references.push({ file, start: match[2] ? Number(match[2]) : null, end: match[3] ? Number(match[3]) : match[2] ? Number(match[2]) : null });
  }
  const lineCounts = new Map();
  for (const reference of references) {
    if (!fs.existsSync(path.join(root, reference.file))) { issue('code_reference_file_missing', reference.file); continue; }
    if (!lineCounts.has(reference.file)) lineCounts.set(reference.file, read(reference.file).split('\n').length);
    if (reference.start !== null && (reference.start < 1 || reference.end < reference.start || reference.end > lineCounts.get(reference.file))) issue('code_reference_range_invalid', reference);
  }
  return { count: references.length, distinctFiles: lineCounts.size, affected: references.filter(reference => /AccountReopeningReview|accountReopening\.service|sapAccountReview\.service|sap\.routes|rbac\.js|audit\.middleware/.test(reference.file)).length };
}

function main() {
  const document = read(documentFile);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutDate || '')) throw new Error('Provide --cut-date YYYY-MM-DD.');
  const [year, month, day] = cutDate.split('-').map(Number);
  const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const dateText = `${day} de ${months[month - 1]} de ${year}`;
  if (!document.includes(`**Fecha de corte:** ${dateText}`)) issue('cut_date_missing_or_different', dateText);
  const app = read('frontend/src/App.jsx');
  const routes = [{ route: '/', file: 'frontend/src/App.jsx', line: lineAt(app, app.indexOf('<Route index')) },
    ...[...app.matchAll(/\bpath\s*=\s*"([^"]+)"/g)].map(match => ({ route: match[1] === '*' ? '*' : `/${match[1].replace(/^\//, '')}`, file: 'frontend/src/App.jsx', line: lineAt(app, match.index) }))];
  const screenRoutes = routes.filter(item => item.route !== '*');
  const reactFiles = walk('frontend/src').filter(file => file.endsWith('.jsx'));
  const kpis = inventoryKpis();
  const http = inventoryHttp();
  const catalog = extractCatalog();
  for (const route of screenRoutes) if (!codeMention(document, route.route)) issue('screen_route_missing', route.route);
  for (const file of reactFiles) if (!document.includes(file)) issue('react_file_missing', file);
  for (const file of http.routeFiles) if (!document.includes(file)) issue('backend_route_file_missing', file);
  for (const kpi of kpis) if (!codeMention(document, kpi.id)) issue('initial_kpi_missing', kpi.id);
  for (const [code, pattern, actual] of [
    ['screen_route_caption_count_mismatch', /Rutas de pantalla \((\d+) rutas/g, screenRoutes.length],
    ['react_caption_count_mismatch', /Pantallas y componentes React \((\d+) archivos/g, reactFiles.length],
    ['kpi_caption_count_mismatch', /Identificadores iniciales de KPI configurables \((\d+)\)/g, kpis.length],
    ['manual_catalog_caption_count_mismatch', /Catálogo manual completo: (\d+) apartados/g, catalog.manual.length],
    ['assistant_catalog_caption_count_mismatch', /Anexo: catálogo extendido del asistente — (\d+) capacidades/g, catalog.assistant.length],
  ]) {
    const captions = [...document.matchAll(pattern)].map(match => Number(match[1]));
    if (!captions.length || captions.some(count => count !== actual)) issue(code, { actual, captions });
  }
  for (const endpoint of http.endpoints) if (!codeMention(document.replaceAll('\\|', '|'), endpoint.route)) issue('http_operation_missing', endpoint);
  const declaredHttpCounts = [...document.matchAll(/Operaciones HTTP declaradas \((\d+)\)/g)].map(match => Number(match[1]));
  if (!declaredHttpCounts.length || declaredHttpCounts.some(count => count !== http.endpoints.length)) issue('http_caption_count_mismatch', { actual: http.endpoints.length, captions: declaredHttpCounts });
  const coverageHttpCounts = [...document.matchAll(/\*\*(\d+) declaraciones de operaciones HTTP\*\*/g)].map(match => Number(match[1]));
  if (!coverageHttpCounts.length || coverageHttpCounts.some(count => count !== http.endpoints.length)) issue('http_summary_count_mismatch', { actual: http.endpoints.length, summaries: coverageHttpCounts });
  const apiTableRows = [...document.matchAll(/^\| (GET|POST|PUT|DELETE|PATCH|ALL) \| `([^`]+)` \|/gm)].map(match => ({ method: match[1], route: match[2].replaceAll('\\|', '|') }));
  for (const endpoint of http.endpoints) if (!apiTableRows.some(row => row.method === endpoint.method && row.route === endpoint.route)) issue('http_inventory_row_missing', endpoint);
  if (apiTableRows.length !== http.endpoints.length) issue('http_inventory_row_count_mismatch', { actual: http.endpoints.length, rows: apiTableRows.length });
  const expectedIds = new Set(catalog.all.map(item => item.id));
  if (expectedIds.size !== catalog.all.length) issue('catalog_duplicate_id', catalog.all.length - expectedIds.size);
  const tableIds = [...document.matchAll(/^\| `([^`]+)` —/gm)].map(match => match[1]).filter(id => expectedIds.has(id));
  const occurrences = new Map();
  for (const id of tableIds) occurrences.set(id, (occurrences.get(id) || 0) + 1);
  for (const id of expectedIds) if (occurrences.get(id) !== 1) issue('catalog_id_table_coverage', { id, occurrences: occurrences.get(id) || 0 });
  if (catalog.groups.reduce((sum, group) => sum + group.count, 0) !== catalog.assistant.length) issue('catalog_group_partition_mismatch', catalog.groups);
  for (const group of catalog.groups) if (!document.includes(`${group.name} (${group.count})`)) issue('catalog_group_heading_count_mismatch', group);
  const statsStart = document.indexOf(`#### Las ${catalog.statisticSections.length} secciones del Explorador`);
  const statsEnd = document.indexOf('#### Histórico, detalle y archivos estadísticos', statsStart);
  const statisticRows = statsStart >= 0 && statsEnd > statsStart ? document.slice(statsStart, statsEnd).split('\n').filter(line => /^\| \d\d /.test(line)).length : 0;
  if (statisticRows !== catalog.statisticSections.length) issue('statistic_sections_incomplete', { actual: catalog.statisticSections.length, rows: statisticRows });
  const structure = checkStructure(document);
  const references = checkReferences(document);
  const sourceDirectories = ['frontend/src', 'backend/routes', 'backend/services', 'backend/config', 'backend/models', 'backend/middleware', 'database', 'scripts'];
  const sourceFiles = [...new Set(sourceDirectories.filter(directory => fs.existsSync(path.join(root, directory))).flatMap(walk)
    .filter(file => /\.(jsx?|tsx?|json|sql|css|cjs|mjs|ps1|py|md)$/.test(file)))].sort();
  const sourceHashes = sourceFiles.map(file => ({ file, sha256: sha256(fs.readFileSync(path.join(root, file))) }));
  for (const [file, digest] of sourceReadHashes) {
    if (sha256(fs.readFileSync(path.join(root, file))) !== digest) issue('source_changed_during_verification', file);
  }
  const critical = ['frontend/src/App.jsx', 'frontend/src/pages/AccountReopeningReview.jsx', 'frontend/src/pages/AccountReopeningReview.css',
    'frontend/src/utils/rbac.js', 'backend/routes/sap.routes.js', 'backend/services/accountReopening.service.js',
    'backend/services/sapAccountReview.service.js', 'backend/middleware/audit.middleware.js', 'scripts/verify-platform-map.cjs',
    'scripts/mapa-pdf/generate.mjs', 'scripts/mapa-pdf/build.py', 'scripts/mapa-pdf/config.json', 'scripts/mapa-pdf/README.md'];
  const report = { generatedAt: new Date().toISOString(), cutDate, readOnlySources: true, sourceSystemsContacted: false,
    document: { file: documentFile, bytes: Buffer.byteLength(document), sha256: sha256(document), ...structure },
    counts: { screenRoutes: screenRoutes.length, reactFiles: reactFiles.length, backendRouteFiles: http.routeFiles.length,
      httpLiteralDeclarations: http.literalDeclarations, httpEffectiveOperations: http.endpoints.length, httpInventoryRows: apiTableRows.length,
      initialKpiIds: kpis.length, manualReports: catalog.manual.length, assistantOnlyReports: catalog.assistant.length,
      catalogTotalIds: catalog.all.length, catalogTableOccurrences: tableIds.length, catalogGroups: catalog.groups,
      statisticSections: catalog.statisticSections.length, documentedStatisticRows: statisticRows, sourceFiles: sourceHashes.length },
    references, inventory: { screenRoutes, http: http.endpoints, kpis, catalogSourceFiles: catalog.sourceFiles },
    sourceSnapshot: { sha256: sha256(JSON.stringify(sourceHashes)), files: sourceHashes,
      critical: sourceHashes.filter(item => critical.includes(item.file)) }, issues };
  fs.mkdirSync(path.dirname(path.join(root, reportFile)), { recursive: true });
  fs.writeFileSync(path.join(root, reportFile), JSON.stringify(report, null, 2) + '\n', 'utf8');
  process.stdout.write(JSON.stringify({ report: reportFile, document: report.document, counts: report.counts,
    references, criticalSourceHashes: report.sourceSnapshot.critical, issues }, null, 2) + '\n');
  if (issues.length) process.exitCode = 1;
}

try { main(); }
catch (error) {
  const report = { generatedAt: new Date().toISOString(), cutDate, sourceSystemsContacted: false,
    issues: [...issues, { code: 'verifier_failed', detail: error.message }] };
  fs.mkdirSync(path.dirname(path.join(root, reportFile)), { recursive: true });
  fs.writeFileSync(path.join(root, reportFile), JSON.stringify(report, null, 2) + '\n', 'utf8');
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exitCode = 1;
}
