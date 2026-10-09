'use strict';
jest.mock('../services/aria/config/intents', () => ({ matchIntent: jest.fn(), getSuggestionsForUser: jest.fn(),
  IA_PERMISSION_CATALOG: [], INTENT_REGISTRY: [
    { id: 'allowed', iaPermission: 'ia-farmacia', sectionPerm: 'farmacia-inventario', handler: jest.fn(async () => ({ answer: 'Allowed' })), patterns: [] },
    { id: 'denied', iaPermission: 'ia-quirofano', sectionPerm: 'quirofano-agenda', handler: jest.fn(), patterns: [] },
  ] }));
jest.mock('../services/aria/core/llmClassifier', () => ({ classifyWithLLM: jest.fn(async () => null) }));
jest.mock('../services/aria/core/dynamicSearch', () => jest.fn(async () => ({ answer: 'Búsqueda local' })));
jest.mock('../services/aria/handlers/resumen.handler', () => jest.fn(async () => ({ answer: 'Resumen autorizado' })));
jest.mock('../services/aria/reportQuery.service', () => ({ processReportQuery: jest.fn(async () => null) }));
const { processAriaQuery } = require('../services/aria');
const { matchIntent, INTENT_REGISTRY } = require('../services/aria/config/intents');
const { classifyWithLLM } = require('../services/aria/core/llmClassifier');
const reportQuery = require('../services/aria/reportQuery.service');
const summary = require('../services/aria/handlers/resumen.handler');
const search = require('../services/aria/core/dynamicSearch');
const user = { role: 'JEFE_AREA', permisos: ['ia-farmacia', 'farmacia-inventario'] };
beforeEach(() => { jest.clearAllMocks(); matchIntent.mockReturnValue(null); reportQuery.processReportQuery.mockResolvedValue(null); classifyWithLLM.mockResolvedValue(null); });

test('short source and confirmation replies reach report continuation rather than a greeting', async () => {
  for (const query of ['SAP', 'sí', 'OV']) {
    reportQuery.processReportQuery.mockResolvedValue({ report: { status: 'clarification' }, answer: 'Aclaración' });
    expect(await processAriaQuery(query, user, { pending: { request: 'Reporte', answers: [] } })).toMatchObject({ answer: 'Aclaración' });
  }
  expect(summary).not.toHaveBeenCalled(); expect(search).not.toHaveBeenCalled();
});

test('a greeting runs the authorized summary and does not use an external classifier', async () => {
  expect(await processAriaQuery('Hola', user)).toMatchObject({ answer: 'Resumen autorizado' });
  expect(classifyWithLLM).not.toHaveBeenCalled();
});

test('only IA and section-authorized intents reach the model', async () => {
  await processAriaQuery('Una pregunta que no coincide', user);
  expect(classifyWithLLM).toHaveBeenCalledWith(expect.any(String), [INTENT_REGISTRY[0]], expect.any(Object));
});

test('local matched intent cannot bypass its section permission', async () => {
  matchIntent.mockReturnValue({ intent: INTENT_REGISTRY[0] });
  await processAriaQuery('Stock de farmacia', { role: 'JEFE_AREA', permisos: ['ia-farmacia'] });
  expect(INTENT_REGISTRY[0].handler).not.toHaveBeenCalled(); expect(classifyWithLLM).not.toHaveBeenCalled();
});

test('provider billing failure preserves local response with an actionable notice', async () => {
  classifyWithLLM.mockImplementation(async (_query, _intents, options) => { options.onDiagnostic({ category: 'billing' }); return null; });
  const response = await processAriaQuery('Una pregunta que no coincide', user);
  expect(response.answer).toBe('Búsqueda local'); expect(response.notice).toContain('proyecto y la facturación');
});
