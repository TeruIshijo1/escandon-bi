'use strict';

jest.mock('../services/sapQueryBuilder.service', () => ({ getEntityCatalog: jest.fn(), executeQuery: jest.fn() }));
const builder = require('../services/sapQueryBuilder.service');
const { processReportQuery, canUseReport } = require('../services/aria/reportQuery.service');
const catalog = [
  { id: 'vertical_surgeries', title: 'Cirugías y uso de quirófano', category: 'Quirófano', source: 'Vertical',
    description: 'Cirugías con paciente, médico y estado de cuenta.', requiresDateFilter: true, filters: ['estatusDoc'],
    statusOptions: [{ value: 'ALL', label: 'Todas' }, { value: 'OPEN', label: 'Abiertas' }, { value: 'CLOSED', label: 'Cerradas' }],
    defaultFields: ['Patient', 'Doctor', 'Procedure'], fields: [{ key: 'Patient', label: 'Paciente' },
      { key: 'Doctor', label: 'Médicos registrados' }, { key: 'Procedure', label: 'Procedimientos' }, { key: 'Start', label: 'Inicio', type: 'datetime' }] },
  { id: 'inventory', title: 'Inventario por almacén', category: 'Inventarios y Stock', source: 'SAP',
    requiresDateFilter: false, filters: ['almacen'], defaultFields: ['Name', 'Quantity'],
    fields: [{ key: 'Name', label: 'Insumo' }, { key: 'Quantity', label: 'Existencias', type: 'number' }] },
];
const user = { username: 'test-user', role: 'JEFE_AREA', permisos: ['sap-query-vertical_surgeries', 'ia-quirofano'] };
const now = new Date('2026-10-08T16:00:00Z');
const envKeys = ['GEMINI_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  envKeys.forEach(key => delete process.env[key]);
  jest.clearAllMocks(); builder.getEntityCatalog.mockReturnValue(catalog);
  builder.executeQuery.mockResolvedValue({ data: [{ Patient: 'Paciente ficticio', Doctor: 'Médico ficticio', Procedure: 'Procedimiento ficticio' }] });
});
afterEach(() => { envKeys.forEach(key => { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; }); jest.restoreAllMocks(); });

test('historical surgery query uses exact dates and selected columns, never the current-data handler', async () => {
  const response = await processReportQuery('Necesito las cirugías de septiembre con paciente médico procedimiento', user, { now });
  expect(response.report.status).toBe('ready');
  expect(builder.executeQuery).toHaveBeenCalledWith(expect.objectContaining({ entity: 'vertical_surgeries',
    selectedFields: ['Patient', 'Doctor', 'Procedure'], fechaDesde: '2026-09-01', fechaHasta: '2026-09-30', limit: 200 }));
  expect(response.answer).toContain('01/09/2026 al 30/09/2026');
  expect(response.table.headers).toEqual(['Paciente', 'Médicos registrados', 'Procedimientos']);
});

test('follow-up keeps dates and columns and actually applies closed-account filter', async () => {
  const previous = await processReportQuery('Cirugías de septiembre con paciente médico procedimiento', user, { now });
  const response = await processReportQuery('nomás las cerradas', user, { now, context: previous.report.plan });
  expect(response.report.status).toBe('ready');
  expect(builder.executeQuery).toHaveBeenLastCalledWith(expect.objectContaining({ estatusDoc: 'CLOSED',
    fechaDesde: '2026-09-01', fechaHasta: '2026-09-30', selectedFields: ['Patient', 'Doctor', 'Procedure'] }));
});

test('missing period asks before reading data; reply continues the original request', async () => {
  const first = await processReportQuery('Necesito las cirugías con paciente y médico', user, { now });
  expect(first.report.status).toBe('clarification'); expect(builder.executeQuery).not.toHaveBeenCalled();
  const next = await processReportQuery('septiembre', user, { now, context: first.report.plan, pending: first.report.pending });
  expect(next.report.status).toBe('ready');
  expect(builder.executeQuery).toHaveBeenCalledWith(expect.objectContaining({ fechaDesde: '2026-09-01', fechaHasta: '2026-09-30' }));
});

test.each(['Cirugías del 31 de septiembre con paciente', 'Cirugías del 20 al 1 de septiembre con paciente'])('invalid period %s never reads hospital data', async message => {
  const response = await processReportQuery(message, user, { now });
  expect(response.report.status).not.toBe('ready'); expect(builder.executeQuery).not.toHaveBeenCalled();
});

test('retry after data failure preserves plan and succeeds, without exposing server errors', async () => {
  builder.executeQuery.mockRejectedValueOnce(new Error('SECRET server connection string'));
  const failed = await processReportQuery('Cirugías de septiembre con paciente', user, { now });
  expect(failed.report.status).toBe('error'); expect(JSON.stringify(failed)).not.toContain('SECRET');
  const retried = await processReportQuery('Genera de nuevo el reporte.', user, { now, context: failed.report.plan });
  expect(retried.report.status).toBe('ready'); expect(retried.table.rows).toHaveLength(1);
  expect(builder.executeQuery).toHaveBeenLastCalledWith(expect.objectContaining({ selectedFields: ['Patient'], fechaDesde: '2026-09-01' }));
});

test('no module permission, limited IA profile and revoked prior plan cannot read restricted data', async () => {
  expect(canUseReport({ ...user, permisos: ['ia-quirofano'] }, catalog[0])).toBe(false);
  expect(canUseReport({ ...user, permisos: ['sap-query-vertical_surgeries', 'ia-farmacia'] }, catalog[0])).toBe(false);
  const response = await processReportQuery('Cirugías de septiembre con paciente', { ...user, permisos: ['ia-quirofano'] }, { now });
  expect(response.report.status).toBe('unsupported'); expect(builder.executeQuery).not.toHaveBeenCalled();
  await processReportQuery('nomás las cerradas', { ...user, permisos: ['sap-query-inventory', 'ia-farmacia'] }, { now,
    context: { entity: 'vertical_surgeries', selectedFields: ['Patient'], filters: { fechaDesde: '2026-09-01', fechaHasta: '2026-09-30' } } });
  expect(builder.executeQuery).not.toHaveBeenCalled();
});

test('preview is capped and result count is explicitly bounded, not a claimed complete total', async () => {
  builder.executeQuery.mockResolvedValue({ data: Array.from({ length: 200 }, (_, index) => ({ Patient: `Ficticio ${index}` })), truncated: true });
  const response = await processReportQuery('Cirugías de septiembre con paciente', user, { now });
  expect(response.table.rows).toHaveLength(20); expect(response.report).toMatchObject({ limited: true, rowCount: 200 });
  expect(response.answer).toContain('como máximo'); expect(response.answer).toContain('generador de reportes');
});

test('empty successful query is explicit and retains configuration for adjustments', async () => {
  builder.executeQuery.mockResolvedValue({ data: [], truncated: false });
  const response = await processReportQuery('Cirugías de septiembre con paciente', user, { now });
  expect(response.report.status).toBe('ready'); expect(response.answer).toContain('No se encontraron'); expect(response.table).toBeUndefined();
});

test('current-data quick query stays available, but a requested history on current-only inventory is rejected', async () => {
  expect(await processReportQuery('¿Cuáles son las cirugías del momento?', user, { now })).toBeNull();
  const response = await processReportQuery('Reporte de inventario de septiembre', { ...user, permisos: ['sap-query-inventory', 'ia-farmacia'] }, { now });
  expect(response.report.status).toBe('unsupported'); expect(builder.executeQuery).not.toHaveBeenCalled();
});

test('existing pharmacy shortcuts keep section access rather than requiring report module permissions', async () => {
  const pharmacy = { role: 'JEFE_AREA', permisos: ['ia-farmacia', 'farmacia-inventario'] };
  expect(await processReportQuery('¿Qué recetas están pendientes en Farmacia?', pharmacy,
    { now, operationalIntent: 'farmacia-recetas-pendientes' })).toBeNull();
  expect(await processReportQuery('¿Cuáles son las devoluciones de farmacia hoy?', pharmacy,
    { now, operationalIntent: 'devoluciones-farmacia' })).toBeNull();
});

test('item master and price reports respect inventory IA profiles and explicit module permissions', () => {
  const inventoryUser = { role: 'JEFE_AREA', permisos: ['ia-busqueda-insumos', 'sap-query-item_master_data', 'sap-query-item_prices'] };
  for (const id of ['item_master_data', 'item_prices']) expect(canUseReport(inventoryUser, { id, category: 'Catálogos Maestros' })).toBe(true);
});

test('the actual physician directory ID is limited to the medical-search IA profile', () => {
  const entity = { id: 'vertical_physicians', category: 'Catálogos Clínicos' };
  expect(canUseReport({ role: 'JEFE_AREA', permisos: ['sap-query-vertical_physicians', 'ia-busqueda-medicos'] }, entity)).toBe(true);
  expect(canUseReport({ role: 'JEFE_AREA', permisos: ['sap-query-vertical_physicians', 'ia-busqueda-insumos'] }, entity)).toBe(false);
});

test('provider outage still supports recognized reports locally without sending records to the provider', async () => {
  process.env.GEMINI_API_KEY = 'fictional-key';
  const provider = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network offline'));
  const response = await processReportQuery('Cirugías de septiembre con paciente', user, { now });
  expect(response.report.status).toBe('ready'); expect(response.engine).toBe('guided'); expect(provider).not.toHaveBeenCalled();
});

test('rejects oversized periods before database work and keeps an editable draft', async () => {
  const response = await processReportQuery('Cirugías del 1 de enero de 2024 al 1 de octubre de 2026 con paciente', user, { now });
  expect(response.report.status).toBe('clarification'); expect(builder.executeQuery).not.toHaveBeenCalled();
});
