// Extracts static report definitions in isolated VMs. No source-system connections.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '../..');
const serviceDir = path.join(root, 'backend/services');
const allowed = new Set(['sapReportCatalog.service.js', 'verticalReportCatalog.service.js', 'assistantResourceCatalog.service.js', 'assistantVerticalSources.service.js', 'assistantAccountFinance.service.js', 'assistantAccountCase.service.js', 'assistantPriceLists.service.js', 'assistantReportComposition.service.js', 'reportVocabulary.service.js', 'reportAnalysis.service.js', 'sapQueryBuilder.service.js']);
const loaded = new Map();
const sources = {};
const block = () => { throw new Error('Source-system IO prohibited by extractor'); };
function read(name) {
  if (loaded.has(name)) return loaded.get(name);
  const filename = path.join(serviceDir, name);
  const code = fs.readFileSync(filename, 'utf8');
  sources[name] = code;
  const module = { exports: {} };
  loaded.set(name, module.exports);
  const ctx = { module, exports: module.exports, console: { log() {}, warn() {}, error() {} },
    process: { env: { NODE_ENV: 'test' } }, setTimeout: block, clearTimeout() {}, Buffer, URL, AbortController,
    require(request) {
      if (request.endsWith('.json')) return JSON.parse(fs.readFileSync(path.resolve(serviceDir, request), 'utf8'));
      const requested = path.basename(request) + (request.endsWith('.js') ? '' : '.js');
      if (allowed.has(requested)) return read(requested);
      if (request.includes('remote-db')) return { connectRemoteDB: block, sql: {} };
      if (request.includes('pg-db')) return { pool: { query: block } };
      if (request.includes('savedReportAccess')) return {};
      if (request.includes('sap')) return new Proxy({}, { get: () => block });
      throw new Error(`Unexpected dependency: ${request}`);
    }
  };
  const extras = ['sapReportCatalog.service.js', 'verticalReportCatalog.service.js', 'assistantResourceCatalog.service.js', 'assistantVerticalSources.service.js'].includes(name)
    ? '\nmodule.exports.__definitions = definitions;' : name === 'sapQueryBuilder.service.js' ? '\nmodule.exports.__queries = STATIC_SQL_QUERIES;' : '';
  vm.runInNewContext(code + extras, ctx, { filename, timeout: 10000 });
  loaded.set(name, module.exports);
  return module.exports;
}
const builder = read('sapQueryBuilder.service.js');
const manual = builder.getEntityCatalog();
const all = builder.getAssistantCatalog();
const assistant = all.filter(e => !manual.some(m => m.id === e.id));
const definitions = Object.fromEntries([...loaded.entries()].map(([key, value]) => [key, value.__definitions || {}]));
const countSources = list => Object.fromEntries([...new Set(list.map(e => e.source))].map(source => [source, list.filter(e => e.source === source).length]));
const summary = { manual: manual.length, manualSources: countSources(manual), manualCategories: [...new Set(manual.map(e => e.category))].sort(), assistantOnly: assistant.length, assistantSources: countSources(assistant), total: all.length };
fs.writeFileSync(path.join(__dirname, 'catalogos-reportes-inventario.json'), JSON.stringify({ summary, manual, assistant, definitions, staticSapQueries: builder.__queries }, null, 2));
console.log(JSON.stringify(summary));
