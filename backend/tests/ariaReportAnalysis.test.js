'use strict';
jest.mock('../services/sapQueryBuilder.service', () => ({ getAssistantCatalog: jest.fn(), getEntityCatalog: jest.fn(), executeQuery: jest.fn() }));
jest.mock('../services/sap.service', () => ({ get: jest.fn(), post: jest.fn() }));
const builder = require('../services/sapQueryBuilder.service');
const { processReportQuery, canUseReport } = require('../services/aria/reportQuery.service');
const { applyAnalysis } = require('../services/reportAnalysis.service');
const sap = require('../services/sapReportCatalog.service');
const finance = require('../services/assistantAccountFinance.service');
const accountCase = require('../services/assistantAccountCase.service');
const vertical = require('../services/verticalReportCatalog.service');
const catalog = [sap.catalog.accounts_receivable, finance.catalog.assistant_account_billing_collections,
  accountCase.catalog.assistant_account_case, vertical.catalog.vertical_account_charges];
const user = { username: 'amendoza', role: 'ADMIN', permisos: [] };
const now = new Date('2026-10-09T18:00:00Z');
const environmentKeys = ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY'];
let originalEnv;
beforeEach(() => {
  originalEnv = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
  environmentKeys.forEach(key => delete process.env[key]);
  jest.clearAllMocks(); builder.getAssistantCatalog.mockReturnValue(catalog);
  builder.getEntityCatalog.mockReturnValue(catalog.filter(entity => !entity.assistantOnly));
  builder.executeQuery.mockImplementation(async options => {
    const entity = catalog.find(entity => entity.id === options.entity);
    const rows = options.entity === 'accounts_receivable' ? [
      { DocEntry: 1, CardName: 'Aseguradora sintética', Balance: 15000 }, { DocEntry: 2, CardName: 'Aseguradora sintética', Balance: 20000 }
    ] : [{ PCNum: 123, PTNum: 456, PatientName: 'Paciente sintético', AccountStatus: 'Abierta', AccountBalance: 120,
      BillingStatus: 'Con facturas vigentes en SAP', CollectionStatus: 'Sin cobros recibidos registrados', InvoiceFolios: '789', Evidence: 'Cuenta abierta con saldo.',
      ItemDescription: 'Insumo sintético', Quantity: 2 }];
    return applyAnalysis(entity, { data: rows, truncated: false, columnas: entity.fields, grain: entity.grain }, options.analysis,
      { selectedFields: options.selectedFields, limit: options.limit });
  });
});
afterEach(() => { environmentKeys.forEach(key => { if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key]; }); });

test('MAR-IA executes complete financial grouping and displays returned measure columns', async () => {
  const response = await processReportQuery('Cuentas por cobrar de septiembre agrupadas por cliente con suma de saldo', user, { now });
  expect(response.report.status).toBe('ready');
  expect(builder.executeQuery).toHaveBeenCalledWith(expect.objectContaining({ entity: 'accounts_receivable', analysis: expect.objectContaining({ groupBy: ['CardName'] }) }));
  expect(response.table.headers).toEqual(['Cliente / proveedor', 'Total de Saldo actual en moneda local (Moneda local de SAP)']);
  expect(response.table.rows).toEqual([['Aseguradora sintética', '$35,000']]);
  expect(response.report.analysisScope).toMatchObject({ complete: true, sourceRows: 2, matchingRows: 2, groups: 1 });
  expect(response.answer).toContain('Se analizaron 2 registros');
});
test('an exact account question returns unpaid/open evidence instead of filtering the account away', async () => {
  const response = await processReportQuery('Dime si la cuenta 123 ya tiene factura pagada y está cerrada', user, { now });
  expect(response.report.status).toBe('ready');
  expect(builder.executeQuery).toHaveBeenCalledWith(expect.objectContaining({ entity: 'assistant_account_billing_collections', estatusDoc: 'ALL', analysis: expect.objectContaining({ predicates: [{ field: 'PCNum', op: 'eq', value: '123' }] }) }));
  expect(response.table.rows).toHaveLength(1);
  expect(JSON.stringify(response.table)).toContain('Abierta');
  expect(JSON.stringify(response.table)).toContain('Sin cobros recibidos registrados');
  expect(response.answer).toContain('facturas y cobros son actuales');
});
test('financial case and charges can be requested together, while header balances remain nonadditive', async () => {
  const response = await processReportQuery('Dime las facturas, cobros e insumos de la cuenta 123', user, { now });
  expect(response.report.status).toBe('ready');
  expect(builder.executeQuery).toHaveBeenCalledWith(expect.objectContaining({ entity: 'assistant_account_case' }));
  expect(JSON.stringify(response.table)).toContain('Insumo sintético');
  expect(JSON.stringify(response.table)).toContain('Sin cobros recibidos registrados');
});
test('every case source permission remains required even with financial IA access', () => {
  const limited = { role: 'JEFE_AREA', username: 'test', permisos: ['ia-finanzas', 'sap-query-vertical_accounts', 'sap-query-sales_invoice_summary', 'sap-query-incoming_payments'] };
  expect(canUseReport(limited, finance.catalog.assistant_account_billing_collections)).toBe(true);
  expect(canUseReport(limited, accountCase.catalog.assistant_account_case)).toBe(false);
  expect(canUseReport({ ...limited, permisos: [...limited.permisos, 'sap-query-vertical_account_charges'] }, accountCase.catalog.assistant_account_case)).toBe(true);
});
test('a permission revocation during execution removes the entire response', async () => {
  builder.executeQuery.mockImplementation(async () => { builder.getAssistantCatalog.mockReturnValue([]); return { data: [{ Secret: 'Should never be visible' }] }; });
  const response = await processReportQuery('Dime si la cuenta 123 ya tiene factura pagada y está cerrada', user, { now });
  expect(response.report.status).toBe('unsupported');
  expect(builder.executeQuery).toHaveBeenCalledTimes(1);
  expect(response.table).toBeUndefined(); expect(JSON.stringify(response)).not.toContain('Should never be visible');
});
test('incomplete source failure explains how to refine the analysis without leaking provider errors', async () => {
  const error = Object.assign(new Error('La fuente supera el alcance de una consulta completa. Reduce el período o los filtros antes de calcular este análisis.'), { code: 'REPORT_ANALYSIS_VALIDATION', status: 400 });
  builder.executeQuery.mockRejectedValue(error);
  const response = await processReportQuery('Cuentas por cobrar de septiembre con saldo mayor a 10000', user, { now });
  expect(response.report.status).toBe('error'); expect(response.answer).toContain('Reduce el período'); expect(response.table).toBeUndefined();
});
