'use strict';
const { prepareReport: prepareWithProvider, validateProposal, dateRange, todayInMexico } = require('../services/reportAssistant.service');
// These provider tests deliberately bypass the local interpretation shortcut.
const prepareReport = input => prepareWithProvider({ ...input, requireAi: true });
const catalog = [
  { id: 'vertical_surgeries', source: 'Vertical', title: 'Cirugías y uso de quirófano', category: 'Quirófano', requiresDateFilter: true, filters: [], defaultFields: ['Patient', 'Doctor', 'Procedure'], fields: [{ key: 'Patient', label: 'Paciente' }, { key: 'Doctor', label: 'Médicos registrados' }, { key: 'Procedure', label: 'Procedimientos' }, { key: 'Start', label: 'Inicio', type: 'datetime' }] },
  { id: 'inventory', source: 'SAP', title: 'Inventario por almacén', category: 'Inventarios', requiresDateFilter: false, filters: ['almacen'], defaultFields: ['Name', 'Quantity'], fields: [{ key: 'Name', label: 'Insumo' }, { key: 'Quantity', label: 'Existencias' }, { key: 'Cost', label: 'Costo promedio' }] },
];
const dates = { fechaDesde: '2026-09-01', fechaHasta: '2026-09-30' };
const proposal = (extra = {}) => ({ status: 'ready', message: 'Preparé las cirugías.', plan: { entity: 'vertical_surgeries', selectedFields: ['Patient', 'Doctor'], filters: dates }, ...extra });
const analysisEntity = { id: 'vertical_accounts', title: 'Cuentas hospitalarias', aliases: ['cuentas'], source: 'Vertical', filters: [], requiresDateFilter: true,
  pointLookupFields: ['PCNum', 'PTNum'], defaultFields: ['PCNum', 'PatientName', 'Customer', 'Balance'],
  fields: [{ key: 'PCNum', label: 'Folio de atención', type: 'number' }, { key: 'PTNum', label: 'Número de paciente', type: 'number' },
    { key: 'PatientName', label: 'Paciente', type: 'string' }, { key: 'Customer', label: 'Cliente / aseguradora', aliases: ['cliente'], type: 'string' },
    { key: 'Balance', label: 'Saldo de cuenta', aliases: ['saldo'], type: 'money' }, { key: 'Total', label: 'Total de cuenta', type: 'money' },
    { key: 'Rate', label: 'Precio unitario', type: 'money' }] };
const analysisPlan = (analysis, filters = dates) => ({ entity: analysisEntity.id, selectedFields: analysisEntity.defaultFields, filters, ...(analysis ? { analysis } : {}) });
const analysisResponse = plan => ({ status: 'ready', message: 'Preparé las cuentas.', plan });
const providerResponse = plan => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(analysisResponse(plan)) } }] }) });
const envKeys = ['GEMINI_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'GEMINI_MODEL', 'DEEPSEEK_MODEL', 'OPENAI_MODEL', 'LLM_BASE_URL', 'AZURE_OPENAI_ENDPOINT'];
let originalEnv;
beforeEach(() => { originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]])); envKeys.forEach(key => delete process.env[key]); });
afterEach(() => { envKeys.forEach(key => { if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key]; }); jest.restoreAllMocks(); });

test('valid proposals preserve exact columns and bounded supported filters', () => {
  const result = validateProposal(proposal(), catalog);
  expect(result.status).toBe('ready');
  expect(result.plan.fieldLabels).toEqual(['Paciente', 'Médicos registrados']);
  expect(result.plan.filters).toEqual({ ...dates, almacen: 'ALL', estatusDoc: 'ALL', clasificacionMedica: 'ALL', busqueda: '' });
});

test('validated bounded analysis is public, canonical, and separate from source columns', () => {
  const result = validateProposal(analysisResponse(analysisPlan({ predicates: [{ field: 'Balance', op: 'gt', value: 10000 }], groupBy: ['Customer'],
    measures: [{ op: 'sum', field: 'Balance' }], orderBy: [{ field: 'metric_0', direction: 'desc' }] })), [analysisEntity]);
  expect(result).toMatchObject({ status: 'ready', plan: { selectedFields: analysisEntity.defaultFields,
    analysis: { predicates: [{ field: 'Balance', op: 'gt', value: '10000' }], groupBy: ['Customer'], measures: [{ op: 'sum', field: 'Balance' }], orderBy: [{ field: 'metric_0', direction: 'desc' }] } } });
  expect(result.plan.analysisSummary.measures[0]).toMatch(/Saldo de cuenta/);
  expect(result.plan.selectedFields).not.toContain('metric_0');
});

test.each([
  { predicates: [{ field: 'Secret', op: 'eq', value: 1 }] },
  { predicates: [{ field: 'Balance', op: 'gt', value: '1 + 1' }] },
  { predicates: [{ field: 'Balance', op: 'between', values: [1] }] },
  { predicates: [{ field: 'Balance', op: 'between', values: [100, 50] }] },
  { predicates: [{ field: 'Balance', op: 'isNull', value: 0 }] },
  { predicates: Array.from({ length: 9 }, () => ({ field: 'Balance', op: 'eq', value: 1 })) },
  { groupBy: ['Customer'], having: [{ op: 'gt', value: 1 }] },
  { groupBy: ['Customer'], compare: 'previous-month' },
  { measures: [{ op: 'avg', field: 'Balance' }] },
  { measures: [{ op: 'sum', field: 'Rate' }] },
  { measures: [{ op: 'count', field: 'PCNum' }] },
  { measures: [{ op: 'countDistinct' }] },
  { measures: [{ op: 'sum', field: 'Balance' }], orderBy: [{ field: 'Balance', direction: 'desc' }] },
  { orderBy: [{ field: 'metric_0', direction: 'desc' }] },
  { orderBy: [{ field: 'Balance', direction: 'desc' }], topN: 10 },
])('untrusted analysis cannot introduce keys, units, expressions or unsupported operations: %j', analysis => {
  expect(validateProposal(analysisResponse(analysisPlan(analysis)), [analysisEntity])).toMatchObject({ status: 'unsupported', plan: null });
});

test('only a trusted exact positive identifier permits an undated plan; a partial period remains incomplete', () => {
  const lookup = { predicates: [{ field: 'PCNum', op: 'eq', value: '123' }] };
  expect(validateProposal(analysisResponse(analysisPlan(lookup, {})), [analysisEntity]).status).toBe('ready');
  expect(validateProposal(analysisResponse(analysisPlan(lookup, { fechaDesde: '2026-09-01' })), [analysisEntity]).status).toBe('clarification');
  for (const analysis of [{ predicates: [{ field: 'PCNum', op: 'gt', value: '123' }] }, { predicates: [{ field: 'PCNum', op: 'eq', value: '-1' }] },
    { predicates: [{ field: 'PatientName', op: 'eq', value: 'Juan Pérez' }] }]) {
    expect(validateProposal(analysisResponse(analysisPlan(analysis, {})), [analysisEntity]).status).toBe('clarification');
  }
  expect(validateProposal(analysisResponse(analysisPlan(lookup, {})), [{ ...analysisEntity, pointLookupFields: [] }]).status).toBe('clarification');
});

test('provider metadata declares exact bounded operations and preserves prior analysis when changing dates', async () => {
  process.env.OPENAI_API_KEY = 'synthetic-test-key';
  const analysis = { predicates: [{ field: 'Balance', op: 'gt', value: '10000' }], groupBy: ['Customer'], measures: [{ op: 'sum', field: 'Balance' }], orderBy: [{ field: 'metric_0', direction: 'desc' }] };
  const context = { ...analysisPlan(analysis), ignoredRow: { PatientName: 'never-send-records' } };
  const fetchImpl = jest.fn().mockResolvedValue(providerResponse(analysisPlan(null)));
  const result = await prepareReport({ message: 'Mejor primera quincena de septiembre', context, catalog: [analysisEntity], now: new Date('2026-10-01T15:00:00Z'), fetchImpl });
  expect(result).toMatchObject({ status: 'ready', engine: 'ai', plan: { analysis, filters: { fechaDesde: '2026-09-01', fechaHasta: '2026-09-15' } } });
  const payload = JSON.parse(fetchImpl.mock.calls[0][1].body);
  expect(payload.messages[0].content).toContain('"analysisCapabilities"');
  expect(payload.messages[0].content).toContain('"sumAllowed":true');
  expect(payload.messages[0].content).toContain('"sumAllowed":false');
  expect(payload.messages[0].content).toContain('metric_0');
  expect(payload.messages[0].content).toContain('pointLookupFields');
  expect(JSON.stringify(payload)).not.toContain('never-send-records');
  expect(JSON.parse(payload.messages.at(-1).content).context.analysis).toEqual(analysis);
});

test('a model cannot silently drop an explicit local financial condition or replace it with another threshold', async () => {
  process.env.OPENAI_API_KEY = 'synthetic-test-key';
  const fetchImpl = jest.fn().mockResolvedValue(providerResponse(analysisPlan({ predicates: [{ field: 'Balance', op: 'gt', value: '1' }] })));
  const result = await prepareReport({ message: 'Cuentas con saldo mayor a $10,000 del mes pasado', catalog: [analysisEntity], now: new Date('2026-10-01T15:00:00Z'), fetchImpl });
  expect(result).toMatchObject({ status: 'ready', plan: { analysis: { predicates: [{ field: 'Balance', op: 'gt', value: '10000' }] } } });
});

test('a model clarification retains the validated analysis and known period in its draft', async () => {
  process.env.OPENAI_API_KEY = 'synthetic-test-key';
  const analysis = { predicates: [{ field: 'Balance', op: 'gt', value: '10000' }], groupBy: ['Customer'], measures: [{ op: 'sum', field: 'Balance' }], orderBy: [] };
  const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ status: 'clarification', message: 'Necesito un dato más.', plan: analysisPlan(null) }) } }] }) });
  const result = await prepareReport({ message: 'Mejor primera quincena de septiembre', context: analysisPlan(analysis), catalog: [analysisEntity], now: new Date('2026-10-01T15:00:00Z'), fetchImpl });
  expect(result).toMatchObject({ status: 'clarification', plan: { analysis, filters: { fechaDesde: '2026-09-01', fechaHasta: '2026-09-15' } } });
});

test('an implicit model detail exposes the amount used by the requested predicate', async () => {
  process.env.OPENAI_API_KEY = 'synthetic-test-key';
  const entity = { ...analysisEntity, defaultFields: ['PCNum', 'PatientName'] };
  const fetchImpl = jest.fn().mockResolvedValue(providerResponse({ ...analysisPlan(null), selectedFields: entity.defaultFields }));
  const result = await prepareReport({ message: 'Cuentas de septiembre con saldo mayor a 10000', catalog: [entity], now: new Date('2026-10-01T15:00:00Z'), fetchImpl });
  expect(result).toMatchObject({ status: 'ready', plan: { selectedFields: ['PCNum', 'PatientName', 'Balance'] } });
});

test.each(['Top 10 cuentas por saldo', 'Compara septiembre contra agosto', 'Calcula el promedio de saldo'])('a valid model detail proposal cannot erase an unsupported requested operation: %s', async message => {
  process.env.OPENAI_API_KEY = 'synthetic-test-key';
  const fetchImpl = jest.fn().mockResolvedValue(providerResponse(analysisPlan(null)));
  const result = await prepareReport({ message, context: analysisPlan(null), catalog: [analysisEntity], now: new Date('2026-10-01T15:00:00Z'), fetchImpl });
  expect(result).toMatchObject({ status: 'unsupported', plan: null });
});

test.each([
  { entity: 'unauthorized', selectedFields: ['Patient'], filters: dates },
  { entity: 'vertical_surgeries', selectedFields: ['InventedColumn'], filters: dates },
  { entity: 'vertical_surgeries', selectedFields: [], filters: dates },
  { entity: 'vertical_surgeries', selectedFields: ['Patient'], filters: { ...dates, sql: 'DROP TABLE PC' } },
  { entity: 'vertical_surgeries', selectedFields: ['Patient'], filters: { ...dates, almacen: 'ALG' } },
  { entity: 'vertical_surgeries', selectedFields: ['Patient'], filters: { ...dates, estatusDoc: 'ALL OR 1=1' } },
  { entity: 'vertical_surgeries', selectedFields: ['Patient'], filters: { ...dates, busqueda: { sql: 'anything' } } },
  { entity: 'vertical_surgeries', selectedFields: ['Patient'], filters: dates, joins: ['PC'] },
])('rejects fabricated fields, unauthorized modules and unsupported operations: %j', plan => {
  expect(validateProposal(proposal({ plan }), catalog)).toMatchObject({ status: 'unsupported', plan: null });
});

test('missing data, root-level calculations and unsupported historical queries cannot execute', () => {
  expect(validateProposal(proposal({ missingFields: ['costo'] }), catalog).status).toBe('unsupported');
  expect(validateProposal(proposal({ groupBy: 'Doctor' }), catalog).status).toBe('unsupported');
  expect(validateProposal(proposal({ plan: { entity: 'inventory', selectedFields: ['Name'], filters: dates } }), catalog).status).toBe('unsupported');
});

test.each([{}, { fechaDesde: '2026-09-31', fechaHasta: '2026-10-01' }, { fechaDesde: '2026-10-02', fechaHasta: '2026-10-01' }, { fechaDesde: 0, fechaHasta: {} }])('asks for missing or invalid dates without inventing a period: %j', filters => {
  const result = validateProposal(proposal({ plan: { ...proposal().plan, filters } }), catalog);
  expect(result.status).toBe('clarification');
  expect(result.plan.entity).toBe('vertical_surgeries');
});

test('choices disclose authorized titles only', () => {
  expect(validateProposal({ status: 'clarification', choices: ['unknown', 'inventory', 'inventory'], message: 'Elige un tema.' }, catalog).choices).toEqual([{ id: 'inventory', title: 'Inventario por almacén' }]);
});

test('internal capabilities remain bounded and send descriptive metadata rather than executable joins to the provider', async () => {
  process.env.OPENAI_API_KEY = 'synthetic-test-key';
  const capability = { ...catalog[0], id: 'assistant_internal_account', assistantOnly: true, source: 'SAP + Vertical',
    sources: ['SAP', 'Vertical'], title: 'Cuenta y pagador', aliases: ['cuenta con informacion del pagador'], grain: 'Una fila por cuenta',
    sql: 'sensitive server implementation', requiredEntities: ['customers', 'vertical_accounts'] };
  const plan = { entity: capability.id, selectedFields: ['Patient', 'Doctor'], filters: dates };
  const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ status: 'ready', plan }) } }] }) });
  const result = await prepareReport({ message: 'Cuenta con informacion del pagador del mes pasado con paciente y médico',
    catalog: [capability], now: new Date('2026-10-01T15:00:00Z'), fetchImpl });
  expect(result).toMatchObject({ status: 'ready', engine: 'ai', plan: { ...plan, source: 'SAP + Vertical' } });
  const system = JSON.parse(fetchImpl.mock.calls[0][1].body).messages[0].content;
  expect(system).toContain('"assistantOnly":true');
  expect(system).toContain('"aliases":["cuenta con informacion del pagador"]');
  expect(system).toContain('"sources":["SAP","Vertical"]');
  expect(system).not.toContain('sensitive server implementation');
  expect(system).not.toContain('requiredEntities');
  expect(validateProposal({ status: 'ready', plan: { ...plan, joins: ['customers'] } }, [capability])).toMatchObject({ status: 'unsupported', plan: null });
});

test('relative dates respect Mexico City at month/year boundaries', () => {
  expect(todayInMexico(new Date('2026-10-01T02:00:00Z'))).toBe('2026-09-30');
  expect(dateRange('el mes pasado', '2026-01-03')).toEqual({ fechaDesde: '2025-12-01', fechaHasta: '2025-12-31' });
  expect(dateRange('este mes', '2026-10-01')).toEqual({ fechaDesde: '2026-10-01', fechaHasta: '2026-10-01' });
  expect(dateRange('esta semana', '2026-10-01')).toEqual({ fechaDesde: '2026-09-28', fechaHasta: '2026-10-01' });
  expect(dateRange('del 01/09/2026 al 15/09/2026', '2026-10-01')).toEqual({ fechaDesde: '2026-09-01', fechaHasta: '2026-09-15' });
});

test('guided mode asks for dates and continues the same report with an added column', async () => {
  const now = new Date('2026-10-01T15:00:00Z');
  const first = await prepareReport({ message: 'Cirugías con paciente y médico', catalog, now });
  expect(first).toMatchObject({ status: 'clarification', engine: 'guided', plan: { selectedFields: ['Patient', 'Doctor'] } });
  const second = await prepareReport({ message: 'El mes pasado', context: first.plan, catalog, now });
  expect(second).toMatchObject({ status: 'ready', plan: { filters: dates, selectedFields: ['Patient', 'Doctor'] } });
  const third = await prepareReport({ message: 'Agrega el procedimiento', context: second.plan, catalog, now });
  expect(third).toMatchObject({ status: 'ready', plan: { filters: dates, selectedFields: ['Patient', 'Doctor', 'Procedure'] } });
  const missing = await prepareReport({ message: 'Agrega el costo', context: third.plan, catalog, now });
  expect(missing.status).toBe('unsupported');
});

test('a recognized report asks only for its missing period without contacting AI or showing an outage', async () => {
  process.env.GEMINI_API_KEY = 'synthetic-test-key';
  const now = new Date('2026-10-07T15:00:00Z');
  const fetchImpl = jest.fn(() => { throw new Error('No provider should be needed for this clarification'); });
  const first = await prepareWithProvider({ message: 'Cirugías con paciente y médico', catalog, now, fetchImpl });
  expect(first).toMatchObject({ status: 'clarification', engine: 'guided', plan: { entity: 'vertical_surgeries', selectedFields: ['Patient', 'Doctor'], filters: { fechaDesde: '', fechaHasta: '' } } });
  expect(first.message).toMatch(/período/);
  expect(first).not.toHaveProperty('notice');
  const next = await prepareWithProvider({ message: 'Septiembre de 2026', context: first.plan, pending: first.pending, catalog, now, fetchImpl });
  expect(next).toMatchObject({ status: 'ready', engine: 'guided', plan: { entity: 'vertical_surgeries', selectedFields: ['Patient', 'Doctor'], filters: dates } });
  expect(fetchImpl).not.toHaveBeenCalled();
});

test('an unavailable field keeps the pending adjustment so accepting its removal preserves the other requested columns', async () => {
  const context = proposal().plan;
  const now = new Date('2026-10-07T15:00:00Z');
  const fetchImpl = jest.fn(() => { throw new Error('No external provider should be called'); });
  const unresolved = await prepareWithProvider({ message: 'Agrega fecha y costo', context, catalog, now, fetchImpl });
  expect(unresolved).toMatchObject({ status: 'unsupported', plan: null, pending: { request: 'Agrega fecha y costo', answers: [] } });
  const removal = unresolved.options.find(option => option.message === 'Sin costo.');
  expect(removal).toBeDefined();
  const resolved = await prepareWithProvider({ message: removal.message, context, pending: unresolved.pending, catalog, now, fetchImpl });
  expect(resolved).toMatchObject({ status: 'ready', plan: { entity: 'vertical_surgeries', selectedFields: ['Patient', 'Doctor', 'Start'], filters: dates } });
  expect(resolved.pending).toBeNull();
  expect(context.selectedFields).toEqual(['Patient', 'Doctor']);
  expect(fetchImpl).not.toHaveBeenCalled();
});

test('AI cannot return the previous report after the user removes its only column', async () => {
  process.env.OPENAI_API_KEY = 'synthetic-test-key';
  const context = { ...proposal().plan, selectedFields: ['Patient'] };
  const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(proposal({ plan: context })) } }] }) });
  const result = await prepareReport({ message: 'Quita el paciente', context, catalog, now: new Date('2026-10-07T15:00:00Z'), fetchImpl });
  expect(result.status).toBe('clarification');
  expect(result.message).toMatch(/al menos una columna/);
  expect(result.message).not.toContain('Preparé');
  expect(result.pending).toMatchObject({ request: 'Quita el paciente' });
});

test('a catalog column choice is resolved locally without waiting for AI', async () => {
  process.env.GEMINI_API_KEY = 'synthetic-test-key';
  const inventory = { ...catalog[1], fields: [...catalog[1].fields, { key: 'LastCost', label: 'Último costo' }] };
  const fetchImpl = jest.fn(() => { throw new Error('An explicit column choice must not contact AI'); });
  const first = await prepareWithProvider({ message: 'Inventario con producto y costo', catalog: [inventory], fetchImpl });
  expect(first).toMatchObject({ status: 'clarification', engine: 'guided' });
  expect(first.options.map(option => option.label)).toEqual(['Costo promedio', 'Último costo']);
  expect(first).not.toHaveProperty('notice');
  const next = await prepareWithProvider({ message: first.options[0].message, context: first.plan, pending: first.pending, catalog: [inventory], fetchImpl });
  expect(next).toMatchObject({ status: 'ready', engine: 'guided', plan: { selectedFields: ['Name', 'Cost'] } });
  expect(fetchImpl).not.toHaveBeenCalled();
});

test.each(['Con resumen por orden', 'Sólo resumen por orden'])('a recognized presentation keeps an existing order summary without a false unknown-change question: %s', async message => {
  const orders = { id: 'sales_order_summary', source: 'SAP', title: 'Órdenes de venta SAP · resumen por orden', requiresDateFilter: true, filters: [], defaultFields: ['DocNum', 'PatientName'], fields: [{ key: 'DocNum', label: 'Folio SAP' }, { key: 'PatientName', label: 'Paciente' }] };
  const context = { entity: orders.id, selectedFields: ['PatientName', 'DocNum'], filters: dates };
  const fetchImpl = jest.fn(() => { throw new Error('The known report presentation must not contact AI'); });
  const result = await prepareWithProvider({ message, context, catalog: [orders], fetchImpl });
  expect(result).toMatchObject({ status: 'ready', engine: 'guided', plan: { entity: orders.id, selectedFields: context.selectedFields, filters: dates } });
  expect(result.message).not.toMatch(/No pude identificar|Continuar sin/);
  expect(fetchImpl).not.toHaveBeenCalled();
});

test.each([
  ['Mejor del 1 al 15 de septiembre', '2026-09-01', '2026-09-15'],
  ['Mejor del primero al quince de septiembre', '2026-09-01', '2026-09-15'],
  ['Entre el 1 y el 15 de septiembre', '2026-09-01', '2026-09-15'],
  ['Ponlo del 1 hasta el 15 de sep.', '2026-09-01', '2026-09-15'],
  ['Mejor 1 al 15 de septiembre', '2026-09-01', '2026-09-15'],
  ['Del 1-15 de septiembre', '2026-09-01', '2026-09-15'],
  ['Septiembre del 1 al 15', '2026-09-01', '2026-09-15'],
  ['La primera quincena de septiembre', '2026-09-01', '2026-09-15'],
  ['Mejor la segunda quincena de septiembre', '2026-09-16', '2026-09-30'],
  ['Mejor del 1 al 15', '2026-09-01', '2026-09-15'],
  ['Del 1 al 15 de este mes', '2026-10-01', '2026-10-15'],
  ['Del 1 al 15 del mes pasado', '2026-09-01', '2026-09-15'],
  ['Mejor del 01/09 al 15/09', '2026-09-01', '2026-09-15'],
  ['Del 28 de septiembre al 2 de octubre', '2026-09-28', '2026-10-02'],
  ['Del 28 de diciembre de 2025 al 2 de enero de 2026', '2025-12-28', '2026-01-02'],
  ['Del 28 de diciembre al 2 de enero de 2026', '2025-12-28', '2026-01-02'],
  ['Mejor septiembre', '2026-09-01', '2026-09-30'],
  ['El 15 de septiembre', '2026-09-15', '2026-09-15'],
  ['Los últimos quince días', '2026-09-17', '2026-10-01'],
  ['La semana anterior', '2026-09-21', '2026-09-27'],
])('colloquial dates resolve exact inclusive endpoints: %s', (message, fechaDesde, fechaHasta) => {
  expect(dateRange(message, '2026-10-01', dates)).toEqual({ fechaDesde, fechaHasta });
});

test('the reported date adjustment changes the actual plan and confirms its applied period', async () => {
  const result = await prepareReport({ message: 'Mejor del 1 al 15 de septiembre', context: proposal().plan, catalog, now: new Date('2026-10-01T15:00:00Z') });
  expect(result).toMatchObject({ status: 'ready', engine: 'guided', plan: { selectedFields: ['Patient', 'Doctor'], filters: { fechaDesde: '2026-09-01', fechaHasta: '2026-09-15' } } });
  expect(result.message).toContain('del 01/09/2026 al 15/09/2026');
});

test.each(['Mejor del 31 al 35 de septiembre', 'Mejor del 15 al 1 de septiembre', 'Mejor del 1 al 15 de quién sabe qué mes', 'Mejor antes de Navidad', 'Mejor cuando hubo más gente'])('unresolved adjustments ask before reusing the previous report: %s', async message => {
  const result = await prepareReport({ message, context: proposal().plan, catalog, now: new Date('2026-10-01T15:00:00Z') });
  expect(result.status).toBe('clarification');
  expect(result.message).not.toContain('Preparé');
});

test('omitted months require one contextual month and omitted years preserve the report year', async () => {
  expect(dateRange('Del 1 al 15 de septiembre', '2026-10-01', { fechaDesde: '2025-08-01', fechaHasta: '2025-08-31' })).toEqual({ fechaDesde: '2025-09-01', fechaHasta: '2025-09-15' });
  const context = { ...proposal().plan, filters: { fechaDesde: '2026-08-01', fechaHasta: '2026-09-30' } };
  expect((await prepareReport({ message: 'Mejor del 1 al 15', context, catalog })).status).toBe('clarification');
  expect(dateRange('Busca "Juan Mayo"', '2026-10-01', dates)).toBeNull();
});

test('provider output cannot ignore explicit colloquial dates or pretend an unknown adjustment succeeded', async () => {
  process.env.OPENAI_API_KEY = 'test-key';
  const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(proposal()) } }] }) });
  const context = proposal().plan;
  const result = await prepareReport({ message: 'Mejor del 1 al 15 de septiembre', context, catalog, fetchImpl });
  expect(result).toMatchObject({ status: 'ready', engine: 'ai', plan: { filters: { fechaDesde: '2026-09-01', fechaHasta: '2026-09-15' } } });
  expect(JSON.parse(JSON.parse(fetchImpl.mock.calls[0][1].body).messages.at(-1).content).resolvedDates).toEqual({ fechaDesde: '2026-09-01', fechaHasta: '2026-09-15' });
  expect((await prepareReport({ message: 'Mejor cuando hubo más gente', context, catalog, fetchImpl })).status).toBe('clarification');
});

test('colloquial column adjustments preserve dates and never substitute names for patient identifiers', async () => {
  const context = { ...proposal().plan, selectedFields: ['Patient'] };
  const withDoctor = await prepareReport({ message: 'Ponle el nombre del doc, porfa', context, catalog });
  expect(withDoctor).toMatchObject({ status: 'ready', plan: { selectedFields: ['Patient', 'Doctor'], filters: dates } });
  const withoutDoctor = await prepareReport({ message: 'Sácale el médico', context: withDoctor.plan, catalog });
  expect(withoutDoctor.plan.selectedFields).toEqual(['Patient']);
  const only = await prepareReport({ message: 'Nomás paciente y fecha', context: withDoctor.plan, catalog });
  expect(only.plan.selectedFields).toEqual(['Patient', 'Start']);
  expect((await prepareReport({ message: 'Sácale el paciente', context: withoutDoctor.plan, catalog })).status).toBe('clarification');
});

test('the provider receives metadata and sanitized context, not record contents or unknown properties', async () => {
  process.env.OPENAI_API_KEY = 'test-key'; process.env.OPENAI_MODEL = 'test-model';
  const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(proposal()) } }] }) });
  const result = await prepareReport({ message: 'Cirugías del mes pasado con paciente y médico', catalog, context: { entity: 'unauthorized', selectedFields: ['Sensitive'], filters: {}, records: ['private record'] }, fetchImpl });
  expect(result).toMatchObject({ status: 'ready', engine: 'ai' });
  const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
  expect(body.model).toBe('test-model');
  expect(JSON.stringify(body)).not.toMatch(/private record|Sensitive|"entity":"unauthorized"/);
  expect(body.messages[0].content).toContain('Catálogo autorizado:');
});

test('malformed provider responses and outages use guided mode with a clear notice', async () => {
  process.env.OPENAI_API_KEY = 'test-key';
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  for (const response of [{ ok: false, status: 503 }, { ok: true, json: async () => ({ choices: [{ message: { content: 'not valid JSON' } }] }) }]) {
    const result = await prepareReport({ message: 'Inventario por almacén', catalog, fetchImpl: async () => response });
    expect(result).toMatchObject({ status: 'ready', engine: 'guided' });
    expect(result.notice).toContain('búsqueda guiada');
  }
});

test('guided mode does not silently omit an unrecognized requested column', async () => {
  const result = await prepareReport({ message: 'Cirugías del mes pasado con paciente y edad', catalog });
  expect(result.status).toBe('unsupported');
});

test('a retired Gemini model is replaced by an available stable Flash model and cached', async () => {
  process.env.GEMINI_API_KEY = 'test-key'; process.env.GEMINI_MODEL = 'gemini-2.0-retired-test';
  const success = { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(proposal()) } }] }) };
  const fetchImpl = jest.fn().mockResolvedValueOnce({ ok: false, status: 404 }).mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'gemini-3.8-flash' }, { id: 'gemini-3.6-flash' }, { id: 'gemini-3.8-flash-tts' }, { id: 'gemini-3-flash-preview' }] }) }).mockResolvedValue(success);
  const result = await prepareReport({ message: 'Cirugías del mes pasado', catalog, fetchImpl });
  expect(result.engine).toBe('ai');
  expect(fetchImpl.mock.calls[1][0]).toMatch(/\/models$/);
  expect(JSON.parse(fetchImpl.mock.calls[2][1].body).model).toBe('gemini-3.8-flash');
  await prepareReport({ message: 'Cirugías del mes pasado', catalog, fetchImpl });
  expect(fetchImpl).toHaveBeenCalledTimes(4);
  expect(JSON.parse(fetchImpl.mock.calls[3][1].body).model).toBe('gemini-3.8-flash');
});

test('transient provider failures get one retry within the existing timeout', async () => {
  process.env.OPENAI_API_KEY = 'test-key';
  const fetchImpl = jest.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(proposal()) } }] }) });
  expect((await prepareReport({ message: 'Cirugías del mes pasado', catalog, fetchImpl })).engine).toBe('ai');
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

test.each([
  ['GEMINI_API_KEY', 'gemini-3.5-flash-lite', 'generativelanguage.googleapis.com'],
  ['DEEPSEEK_API_KEY', 'deepseek-chat', 'api.deepseek.com'],
  ['OPENAI_API_KEY', 'gpt-4o', 'api.openai.com'],
])('default models belong to the provider whose key is configured: %s', async (key, model, host) => {
  process.env[key] = 'test-key';
  if (key !== 'GEMINI_API_KEY') process.env.GEMINI_MODEL = 'unrelated-gemini-model';
  const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(proposal()) } }] }) });
  expect((await prepareReport({ message: 'Cirugías del mes pasado', catalog, fetchImpl })).engine).toBe('ai');
  expect(new URL(fetchImpl.mock.calls[0][0]).hostname).toBe(host);
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model).toBe(model);
});

test('Gemini capacity failures use the single retry on another available stable model and remember a successful response', async () => {
  process.env.GEMINI_API_KEY = 'test-key'; process.env.GEMINI_MODEL = 'gemini-3.8-flash';
  const success = { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(proposal()) } }] }) };
  const fetchImpl = jest.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'gemini-3.8-flash' }, { id: 'gemini-3.7-flash' }, { id: 'gemini-3.6-flash' }] }) }).mockResolvedValue(success);
  expect((await prepareReport({ message: 'Cirugías del mes pasado', catalog, fetchImpl })).engine).toBe('ai');
  expect(JSON.parse(fetchImpl.mock.calls[2][1].body).model).toBe('gemini-3.7-flash');
  await prepareReport({ message: 'Cirugías del mes pasado', catalog, fetchImpl });
  expect(fetchImpl).toHaveBeenCalledTimes(4);
  expect(JSON.parse(fetchImpl.mock.calls[3][1].body).model).toBe('gemini-3.7-flash');
});

test('Gemini rate limits use at most one retry on another available stable model', async () => {
  process.env.GEMINI_API_KEY = 'test-key'; process.env.GEMINI_MODEL = 'gemini-3.6-flash';
  const success = { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(proposal()) } }] }) };
  const fetchImpl = jest.fn().mockResolvedValueOnce({ ok: false, status: 429 }).mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'gemini-3.6-flash' }, { id: 'gemini-3.5-flash' }] }) }).mockResolvedValue(success);
  expect((await prepareReport({ message: 'Cirugías del mes pasado', catalog, fetchImpl })).engine).toBe('ai');
  expect(fetchImpl).toHaveBeenCalledTimes(3);
  expect(JSON.parse(fetchImpl.mock.calls[2][1].body).model).toBe('gemini-3.5-flash');
});

test.each([[401, 'credentials'], [402, 'billing'], [403, 'access'], [404, 'model'], [429, 'rate_limit'], [503, 'capacity'], [502, 'provider']])(
  'provider HTTP %s has an allowlisted internal diagnosis and keeps guided mode', async (httpStatus, category) => {
    process.env.OPENAI_API_KEY = 'do-not-log-this-key';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const json = jest.fn(() => { throw new Error('Provider response contains sensitive text'); });
    const onDiagnostic = jest.fn();
    const result = await prepareReport({ message: 'Inventario por almacén', catalog, onDiagnostic,
      fetchImpl: jest.fn().mockResolvedValue({ ok: false, status: httpStatus, json }) });
    const expected = { provider: 'openai', model: 'gpt-4o', category, httpStatus };
    expect(result.engine).toBe('guided');
    expect(onDiagnostic).toHaveBeenCalledWith(expected);
    expect(warn).toHaveBeenCalledWith(expect.any(String), expected);
    expect(json).not.toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/do-not-log-this-key|Provider response/);
    expect(result).not.toHaveProperty('diagnostic');
  });

test('network errors redact their text, cause, custom URL, model and request; only approved codes survive', async () => {
  process.env.OPENAI_API_KEY = 'secret-key';
  process.env.OPENAI_MODEL = 'secret-key';
  process.env.LLM_BASE_URL = 'https://private-host.invalid/private-path?token=secret-key';
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const error = new TypeError('fetch failed at private-host with secret-key and Patient Sensitive');
  error.cause = { code: 'ENOTFOUND', message: 'secret-key' };
  const result = await prepareReport({ message: 'Inventario por almacén Patient Sensitive', catalog,
    fetchImpl: jest.fn().mockRejectedValue(error) });
  expect(result.engine).toBe('guided');
  expect(warn.mock.calls[0][1]).toEqual({ provider: 'custom', model: 'configured', category: 'network', networkCode: 'ENOTFOUND' });
  expect(JSON.stringify(warn.mock.calls)).not.toMatch(/secret-key|private-host|private-path|Sensitive|fetch failed/);
  error.cause.code = 'secret-key';
  await prepareReport({ message: 'Inventario por almacén', catalog, fetchImpl: jest.fn().mockRejectedValue(error) });
  expect(warn.mock.calls[1][1]).not.toHaveProperty('networkCode');
});

test('timeouts and malformed provider JSON are distinguished without printing error text or response content', async () => {
  process.env.DEEPSEEK_API_KEY = 'secret-key';
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const abort = new Error('private request'); abort.name = 'AbortError';
  await prepareReport({ message: 'Inventario por almacén', catalog, fetchImpl: jest.fn().mockRejectedValue(abort) });
  expect(warn.mock.calls[0][1]).toEqual({ provider: 'deepseek', model: 'deepseek-chat', category: 'timeout' });
  await prepareReport({ message: 'Inventario por almacén', catalog,
    fetchImpl: jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'private response without JSON' } }] }) }) });
  expect(warn.mock.calls[1][1]).toEqual({ provider: 'deepseek', model: 'deepseek-chat', category: 'response_format' });
  expect(JSON.stringify(warn.mock.calls)).not.toMatch(/private request|private response|secret-key/);
});

test('invalid provider configuration falls back before fetching and never reveals the configured URL', async () => {
  process.env.OPENAI_API_KEY = 'secret-key';
  process.env.LLM_BASE_URL = 'malformed-secret-url';
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const fetchImpl = jest.fn();
  expect((await prepareReport({ message: 'Inventario por almacén', catalog, fetchImpl })).engine).toBe('guided');
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(warn.mock.calls[0][1]).toEqual({ provider: 'unknown', model: 'gpt-4o', category: 'configuration' });
  expect(JSON.stringify(warn.mock.calls)).not.toMatch(/malformed-secret-url|secret-key/);
});

test('diagnostic observers cannot disable guided search or turn a successful AI response into a failure', async () => {
  process.env.OPENAI_API_KEY = 'secret-key';
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const onDiagnostic = jest.fn(() => { throw new Error('secret observer exception'); });
  const failed = await prepareReport({ message: 'Inventario por almacén', catalog, onDiagnostic,
    fetchImpl: jest.fn().mockResolvedValue({ ok: false, status: 401 }) });
  expect(failed.engine).toBe('guided');
  const succeeded = await prepareReport({ message: 'Cirugías del mes pasado con paciente y médico', catalog, onDiagnostic,
    fetchImpl: jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(proposal()) } }] }) }) });
  expect(succeeded).toMatchObject({ engine: 'ai', status: 'ready' });
  expect(onDiagnostic).toHaveBeenLastCalledWith({ provider: 'openai', model: 'gpt-4o', category: 'available', httpStatus: 200 });
  expect(warn).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(warn.mock.calls)).not.toMatch(/secret-key|observer exception/);
});
