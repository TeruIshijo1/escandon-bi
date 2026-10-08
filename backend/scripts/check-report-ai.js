'use strict';

const path = require('node:path');
const { prepareReport, providerConfig } = require('../services/reportAssistant.service');
const { providerDetails, sanitizeDiagnostic } = require('../utils/reportAiDiagnostics');
const { providerChain } = require('../utils/reportAiProviders');
const OFFICIAL_PROVIDERS = new Set(['gemini', 'deepseek', 'openai']);

// Fixed synthetic metadata: no catalogue/database imports, dates, records,
// names, identifiers or user-supplied requests enter this diagnostic.
const CHECK_CATALOG = [{ id: 'inventory', title: 'Inventario de demostración', source: 'Demo',
  description: 'Catálogo ficticio para comprobar la conexión.', requiresDateFilter: false,
  filters: [], defaultFields: ['Name', 'Quantity'],
  fields: [{ key: 'Name', label: 'Insumo', type: 'string' }, { key: 'Quantity', label: 'Existencias', type: 'number' }] }];

async function runCheck({ fetchImpl = global.fetch, config = providerConfig(), prepare = prepareReport } = {}) {
  const configuration = providerDetails(config);
  if (!configuration.keyConfigured || !configuration.endpointValid) {
    return { exitCode: 2, result: { engine: 'guided', status: 'configuration', ...configuration,
      category: !configuration.keyConfigured ? 'missing_key' : 'configuration' } };
  }
  let diagnostic;
  const response = await prepare({ message: 'Necesito el inventario con insumo y existencias',
    catalog: CHECK_CATALOG, history: [], context: null, pending: null, fetchImpl, requireAi: true, providerOverride: config,
    onDiagnostic: value => { diagnostic = sanitizeDiagnostic(value); } });
  // Never serialize the assistant's reply, plan, notice or an arbitrary Error.
  const engine = response?.engine === 'ai' ? 'ai' : 'guided';
  const status = ['ready', 'clarification', 'unsupported'].includes(response?.status) ? response.status : 'invalid';
  return { exitCode: engine === 'ai' && status === 'ready' ? 0 : engine === 'ai' ? 3 : 2,
    result: { engine, status, ...configuration, ...(diagnostic || {}) } };
}

async function runReserveCheck({ configs = providerChain(), fetchImpl = global.fetch, prepare = prepareReport } = {}) {
  const configured = Array.isArray(configs) ? configs : [];
  const checks = [];
  const officialProviders = new Set();
  let readyCount = 0;
  for (const value of configured) {
    const config = value && typeof value === 'object' ? value : {};
    const configuration = providerDetails(config);
    let check;
    try { check = await runCheck({ config, fetchImpl, prepare }); }
    catch {
      // Still check the other configured reserves after an unexpected failure;
      // neither its exception nor the configuration is serialized.
      check = { exitCode: 2, result: { engine: 'guided', status: 'failed', ...configuration, category: 'diagnostic_failed' } };
    }
    checks.push(check.result);
    if (check.exitCode === 0 && check.result.engine === 'ai' && check.result.status === 'ready') {
      readyCount += 1;
      if (OFFICIAL_PROVIDERS.has(configuration.provider) && check.result.provider === configuration.provider) officialProviders.add(configuration.provider);
    }
  }
  const ready = configured.length > 0 && readyCount === configured.length && officialProviders.size >= 2;
  return { exitCode: ready ? 0 : 2, result: { status: ready ? 'ready' : 'incomplete',
    configuredCount: configured.length, readyCount, officialProviderCount: officialProviders.size, checks } };
}

async function runCli({ loadEnv = require('dotenv').config, logger = console, parent = process, check = runCheck,
  reserveCheck = runReserveCheck, argv = [] } = {}) {
  try {
    // Unknown arguments are never printed or treated as a request or URL.
    if (!Array.isArray(argv) || argv.length > 1 || argv.length === 1 && argv[0] !== '--reserves') {
      logger.log(JSON.stringify({ engine: 'guided', status: 'configuration', category: 'configuration' }));
      parent.exitCode = 2;
      return;
    }
    const loaded = loadEnv({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
    // An absent .env is permitted when the process environment provides the
    // configuration. Other filesystem errors are reported without path/text.
    if (loaded?.error && loaded.error.code !== 'ENOENT') {
      logger.log(JSON.stringify({ engine: 'guided', status: 'configuration', category: 'configuration_file' }));
      parent.exitCode = 2;
      return;
    }
    const { result, exitCode } = await (argv[0] === '--reserves' ? reserveCheck() : check());
    logger.log(JSON.stringify(result, null, 2));
    parent.exitCode = exitCode;
  } catch {
    logger.log(JSON.stringify({ engine: 'guided', status: 'failed', category: 'diagnostic_failed' }));
    parent.exitCode = 2;
  }
}

if (require.main === module) runCli({ argv: process.argv.slice(2) });
module.exports = { runCheck, runReserveCheck, runCli };
