'use strict';
jest.mock('../services/sap.service', () => ({ get: jest.fn() }));
jest.mock('../config/remote-db', () => ({ connectRemoteDB: jest.fn(), sql: {} }));
const { prepareReport } = require('../services/reportAssistant.service');
const { normalizeWords } = require('../services/reportVocabulary.service');
const { interpretRequest } = require('../services/reportIntent.service');
const realOrders = [require('../services/sapReportCatalog.service').catalog.sales_order_summary, require('../services/verticalReportCatalog.service').catalog.vertical_sales_orders];
const catalog = [
  { id: 'vertical_surgeries', title: 'Cirugías y uso de quirófano', requiresDateFilter: true, dateFieldLabel: 'Inicio', filters: [], defaultFields: ['Patient', 'Doctor', 'Procedure'], fields: [{ key: 'Patient', label: 'Paciente' }, { key: 'PatientId', label: 'Número de paciente', type: 'number' }, { key: 'Doctor', label: 'Médicos registrados' }, { key: 'Procedure', label: 'Procedimientos' }, { key: 'Start', label: 'Inicio', type: 'datetime' }] },
  { id: 'inventory', title: 'Inventario por almacén', requiresDateFilter: false, filters: ['almacen', 'clasificacionMedica'], defaultFields: ['Name', 'Quantity'], fields: [{ key: 'Name', label: 'Insumo' }, { key: 'Quantity', label: 'Existencias', type: 'number' }, { key: 'Cost', label: 'Costo promedio', type: 'money' }] },
  { id: 'purchase_orders', title: 'Órdenes de Compra a Proveedores', requiresDateFilter: true, dateFieldLabel: 'Fecha de emisión', filters: ['estatusDoc'], defaultFields: ['Folio', 'Date', 'Provider', 'Total'], fields: [{ key: 'Folio', label: 'Folio de pedido' }, { key: 'Date', label: 'Fecha de emisión', type: 'date' }, { key: 'Provider', label: 'Proveedor' }, { key: 'Total', label: 'Total del pedido', type: 'money' }, { key: 'State', label: 'Estado del documento' }] },
  { id: 'vertical_service_charges', title: 'Cargos por unidad de servicio', requiresDateFilter: true, dateFieldLabel: 'Fecha de cargo', filters: [], defaultFields: ['Patient', 'Date'], fields: [{ key: 'Patient', label: 'Paciente' }, { key: 'Date', label: 'Fecha de cargo', type: 'date' }, { key: 'Treating', label: 'Médico tratante' }, { key: 'Requesting', label: 'Médico solicitante' }] },
];
const dates = { fechaDesde: '2026-09-01', fechaHasta: '2026-09-30' };
const context = { entity: 'vertical_surgeries', selectedFields: ['Patient', 'Doctor'], filters: dates };
const inventoryContext = { entity: 'inventory', selectedFields: ['Name', 'Quantity'], filters: { almacen: 'FAR', clasificacionMedica: 'ANTI' } };
const envKeys = ['GEMINI_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'GEMINI_MODEL', 'LLM_BASE_URL'];
let savedEnv;
beforeEach(() => { savedEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]])); envKeys.forEach(key => delete process.env[key]); });
afterEach(() => { envKeys.forEach(key => { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; }); jest.restoreAllMocks(); });
const prepare = (message, extra = {}) => prepareReport({ message, catalog, now: new Date('2026-10-01T15:00:00Z'), ...extra });

test.each([
  ['nesesito las sirujias del mes pasado que salga el nombre del pasiente y el doc', ['Patient', 'Doctor']],
  ['kiero sirujias mes pasado pasiente doc fecha', ['Patient', 'Doctor', 'Start']],
  ['Hasme un reporte de operaciones del mes pasado con pasiente y mediko', ['Patient', 'Doctor']],
  ['Pásame las cirugias del mes pasado con paciente y que le hicieron', ['Patient', 'Procedure']],
  ['Quiero las cirugias del mes pasado con numero de paciente y medico', ['PatientId', 'Doctor']],
  ['las sirujias del 1 al 15 de septiembre con pasiente y procedimiento', ['Patient', 'Procedure']],
  ['sirujias del primero al quince de septiembre pasiente medico fecha', ['Patient', 'Doctor', 'Start']],
])('informal topic and column requests with spelling errors select actual fields: %s', async (message, fields) => {
  const result = await prepare(message);
  expect(result).toMatchObject({ status: 'ready', plan: { entity: 'vertical_surgeries', selectedFields: fields, filters: message.includes('quince') || message.includes('15') ? { fechaDesde: '2026-09-01', fechaHasta: '2026-09-15' } : dates } });
});

test.each([
  ['quita el doc y pon la fecha', ['Patient', 'Start']],
  ['cambia el medico por el procedimiento', ['Patient', 'Procedure']],
  ['nomas paciente y fecha', ['Patient', 'Start']],
  ['no pongas medico y metele procedimiento', ['Patient', 'Procedure']],
  ['que venga el procedimiento tmb', ['Patient', 'Doctor', 'Procedure']],
])('multiple column operations keep their local meaning and order: %s', async (message, fields) => {
  const result = await prepare(message, { context });
  expect(result).toMatchObject({ status: 'ready', plan: { selectedFields: fields, filters: dates } });
});

test.each([
  ['kiero el invntario de farma con producto cuanto queda costo', ['Name', 'Quantity', 'Cost']],
  ['lo que hay en farma nomas antivioticos con nombre y existencias', ['Name', 'Quantity']],
  ['quiero lo que tengo en farma con nombre y cuanto queda', ['Name', 'Quantity']],
  ['nesesito el inventario con nombre costo y existencias', ['Name', 'Cost', 'Quantity']],
])('everyday inventory wording resolves the topic, columns and warehouse: %s', async (message, fields) => {
  const result = await prepare(message);
  expect(result).toMatchObject({ status: 'ready', plan: { entity: 'inventory', selectedFields: fields, filters: { almacen: message.includes('farma') ? 'FAR' : 'ALL' } } });
});

test.each([
  ['nomas los antivioticos de farma', { almacen: 'FAR', clasificacionMedica: 'ANTI' }],
  ['solo los que van en refri', { clasificacionMedica: 'REFRI' }],
  ['solo controlados', { clasificacionMedica: 'CON' }],
  ['mejor de almacen general', { almacen: 'ALG' }],
  ['de todos lados', { almacen: 'ALL' }],
  ['quita el filtro de farma', { almacen: 'ALL' }],
])('colloquial filters keep the existing columns: %s', async (message, filters) => {
  const result = await prepare(message, { context: inventoryContext });
  expect(result).toMatchObject({ status: 'ready', plan: { selectedFields: ['Name', 'Quantity'], filters } });
});

test('switching the topic discards incompatible fields and filters from the prior report', async () => {
  const result = await prepare('ahora quiero invntario de farma con producto y cuanto queda', { context });
  expect(result).toMatchObject({ status: 'ready', plan: { entity: 'inventory', selectedFields: ['Name', 'Quantity'], filters: { fechaDesde: '', fechaHasta: '', almacen: 'FAR' } } });
});

test('a new topic written without an introductory verb clears a pending request for the old topic', async () => {
  const first = await prepare('inventario de farma con producto y medico');
  expect(first.status).toBe('unsupported');
  const result = await prepare('cirujias del mes pasado paciente fecha', { context: inventoryContext, pending: first.pending });
  expect(result).toMatchObject({ status: 'ready', pending: null, plan: { entity: 'vertical_surgeries', selectedFields: ['Patient', 'Start'], filters: { ...dates, almacen: 'ALL', clasificacionMedica: 'ALL' } } });
});

test.each(['Juan Peres', 'AB-C/001-2026', 'Mediko SA de CV'])('search values retain the exact original spelling and identifiers: %s', async value => {
  const result = await prepare(`busca "${value}"`, { context });
  expect(result).toMatchObject({ status: 'ready', plan: { filters: { busqueda: value } } });
  expect(normalizeWords(`busca "${value}"`)).toContain(value);
});

test('unquoted search and a column change are applied together without correcting the person’s name', async () => {
  const result = await prepare('buska Juan Peres y pon fecha', { context });
  expect(result).toMatchObject({ status: 'ready', plan: { selectedFields: ['Patient', 'Doctor', 'Start'], filters: { busqueda: 'Juan Peres', ...dates } } });
});

test('warehouse clarification retains product, quantity and the requested medication type', async () => {
  const first = await prepare('inventario del quirofano nomas antivioticos con producto y cuanto queda');
  expect(first.status).toBe('clarification');
  const option = first.options.find(item => item.label === 'Quirófano general');
  const second = await prepare(option.message, { context: first.plan, pending: first.pending });
  expect(second).toMatchObject({ status: 'ready', plan: { selectedFields: ['Name', 'Quantity'], filters: { almacen: 'QX', clasificacionMedica: 'ANTI' } } });
});

test('topic choices retain the original requested fields and period', async () => {
  const ambiguous = [
    { ...catalog[2], id: 'purchase_invoice_summary', title: 'Facturas de proveedores · resumen por documento' },
    { ...catalog[2], id: 'sales_invoice_summary', title: 'Facturas de clientes · resumen por documento' },
  ];
  const first = await prepare('facturas del mes pasado con proveedor y total', { catalog: ambiguous });
  expect(first.status).toBe('clarification');
  const second = await prepare('El tema que necesito es «Facturas de proveedores · resumen por documento».', { catalog: ambiguous, context: first.plan, pending: first.pending });
  expect(second).toMatchObject({ status: 'ready', plan: { entity: 'purchase_invoice_summary', selectedFields: ['Provider', 'Total'], filters: dates } });
});

test('a choice resolves the medical role without losing the original date and requested patient column', async () => {
  const first = await prepare('cargos por servicio del mes pasado con paciente y medico');
  expect(first.status).toBe('clarification');
  expect(first.options.map(option => option.label)).toEqual(['Médico tratante', 'Médico solicitante']);
  const second = await prepare(first.options[0].message, { context: first.plan, pending: first.pending });
  expect(second).toMatchObject({ status: 'ready', plan: { entity: 'vertical_service_charges', selectedFields: ['Patient', 'Treating'], filters: dates } });
});

test('ambiguous cost choices preserve the original product and stock request', async () => {
  const expanded = catalog.map(entity => entity.id === 'inventory' ? { ...entity, fields: [...entity.fields, { key: 'LastCost', label: 'Último costo de compra', type: 'money' }] } : entity);
  const first = await prepare('inventario de farma con producto existencias y costo', { catalog: expanded });
  expect(first.status).toBe('clarification');
  const option = first.options.find(option => option.label === 'Costo promedio');
  const second = await prepare(option.message, { catalog: expanded, context: first.plan, pending: first.pending });
  expect(second).toMatchObject({ status: 'ready', plan: { selectedFields: ['Name', 'Quantity', 'Cost'], filters: { almacen: 'FAR' } } });
});

test('unavailable conditions cannot be silently ignored or converted into another business meaning', async () => {
  const orders = { entity: 'purchase_orders', selectedFields: ['Folio', 'Total'], filters: dates };
  expect((await prepare('solo las abiertas', { context: orders }))).toMatchObject({ status: 'ready', plan: { filters: { estatusDoc: 'OPEN' } } });
  expect((await prepare('solo las ya pagadas', { context: orders })).status).toBe('unsupported');
  expect((await prepare('solo con costo mayor que 100', { context: inventoryContext })).status).toBe('unsupported');
  expect((await prepare('cirugias del mes pasado con paciente y sexo')).status).toBe('unsupported');
  expect((await prepare('cirugias del mes pasado con paciente joven y medico')).status).toBe('unsupported');
  expect((await prepare('cirugias del medico Juan Peres del mes pasado')).status).toBe('clarification');
});

test('provider responses that omit requested column operations or filters are corrected before execution', async () => {
  process.env.OPENAI_API_KEY = 'test-key';
  const model = plan => async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ status: 'ready', message: 'Listo.', plan }) } }] }) });
  const columns = await prepare('quita el doc y pon la fecha', { context, fetchImpl: model(context), requireAi: true });
  expect(columns).toMatchObject({ engine: 'ai', status: 'ready', plan: { selectedFields: ['Patient', 'Start'] } });
  const types = await prepare('solo controlados', { context: inventoryContext, fetchImpl: model(inventoryContext), requireAi: true });
  expect(types).toMatchObject({ engine: 'ai', status: 'ready', plan: { filters: { clasificacionMedica: 'CON' } } });
});

const surgeryStates = { ...catalog[0], filters: ['estatusDoc'], statusLabel: 'Estado de cuenta o alta médica', statusOptions: [{ value: 'ALL', label: 'Todas las cuentas' }, { value: 'OPEN', label: 'Abiertas' }, { value: 'CLOSED', label: 'Cerradas' }, { value: 'MEDICAL_DISCHARGE', label: 'Con alta médica' }, { value: 'NO_MEDICAL_DISCHARGE', label: 'Sin alta médica' }, { value: 'CANCELED', label: 'Canceladas' }], fields: [...catalog[0].fields, { key: 'State', label: 'Estado de cuenta' }, { key: 'Discharged', label: 'Alta médica' }, { key: 'DischargeDate', label: 'Fecha de alta médica', type: 'datetime' }, { key: 'ClosedDate', label: 'Fecha de cierre de cuenta', type: 'datetime' }] };
test('a colloquial request without column separators includes patient, doctor, state and medical discharge', async () => {
  const result = await prepare('nesesito las sirujias de septiembre con pasiente medico status y alta medica', { catalog: [surgeryStates] });
  expect(result).toMatchObject({ status: 'ready', plan: { selectedFields: ['Patient', 'Doctor', 'State', 'Discharged'], filters: { ...dates, estatusDoc: 'ALL' } } });
});
test('status and medical discharge are selected as separate real columns', async () => {
  const result = await prepare('agrega status y alta medica y fecha de alta medica y fecha de cierre de cuenta', { context, catalog: [surgeryStates] });
  expect(result).toMatchObject({ status: 'ready', plan: { selectedFields: ['Patient', 'Doctor', 'State', 'Discharged', 'DischargeDate', 'ClosedDate'], filters: { estatusDoc: 'ALL' } } });
});

test.each([['solo las cerradas', 'CLOSED'], ['nomas abiertas', 'OPEN'], ['solo con alta medica', 'MEDICAL_DISCHARGE'], ['nomas sin alta medica', 'NO_MEDICAL_DISCHARGE'], ['solo canceladas', 'CANCELED']])('clinical status changes are applied without changing columns: %s', async (message, state) => {
  const result = await prepare(message, { context, catalog: [surgeryStates] });
  expect(result).toMatchObject({ status: 'ready', plan: { selectedFields: ['Patient', 'Doctor'], filters: { estatusDoc: state } } });
  expect(result.plan.appliedFilters[0].value).toBe(surgeryStates.statusOptions.find(option => option.value === state).label);
});

test('a request for two clinical conditions asks and keeps both until the user chooses', async () => {
  const first = await prepare('solo abiertas con alta medica', { context, catalog: [surgeryStates] });
  expect(first.status).toBe('clarification');
  const option = first.options.find(option => option.label === 'Con alta médica');
  const second = await prepare(option.message, { context: first.plan, pending: first.pending, catalog: [surgeryStates] });
  expect(second).toMatchObject({ status: 'ready', plan: { selectedFields: ['Patient', 'Doctor'], filters: { estatusDoc: 'MEDICAL_DISCHARGE' } } });
});

const orderCatalog = [
  { id: 'sales_order_summary', source: 'SAP', title: 'Órdenes de venta SAP · resumen por orden', requiresDateFilter: true, filters: ['estatusDoc'], defaultFields: ['DocNum', 'PatientName'], fields: [{ key: 'DocNum', label: 'Folio SAP' }, { key: 'PatientName', label: 'Paciente' }, { key: 'PTNum', label: 'Número de paciente', type: 'number' }, { key: 'CardName', label: 'Cliente / proveedor' }] },
  { id: 'vertical_sales_orders', source: 'Vertical', title: 'Órdenes de venta Vertical · resumen por orden', requiresDateFilter: true, filters: [], defaultFields: ['SONum', 'PatientName'], fields: [{ key: 'SONum', label: 'Número de orden', type: 'number' }, { key: 'PatientName', label: 'Paciente' }, { key: 'PTNum', label: 'Número de paciente', type: 'number' }] },
];
const originalOrdersRequest = 'Necesito los pacientes con todas las ordenes de venta que tengan del 01/09/2026 al 30/09/2026';

test.each(orderCatalog)('sales-order source choices retain patients, order numbers and dates: $source', async entity => {
  const first = await prepare(originalOrdersRequest, { catalog: orderCatalog });
  expect(first).toMatchObject({ status: 'clarification', plan: null });
  expect(first.choices.map(choice => choice.id)).toEqual(orderCatalog.map(item => item.id));
  expect(first.message).not.toContain('No pude identificar');
  const reply = await prepare('Las OV', { catalog: orderCatalog, pending: first.pending });
  expect(reply.choices.map(choice => choice.id)).toEqual(first.choices.map(choice => choice.id));
  const result = await prepare(`El tema que necesito es «${entity.title}».`, { catalog: orderCatalog, pending: reply.pending });
  expect(result).toMatchObject({ status: 'ready', pending: null, plan: { entity: entity.id, selectedFields: ['PatientName', entity.id === 'sales_order_summary' ? 'DocNum' : 'SONum'], filters: dates } });
});

test.each([['SAP', 'sales_order_summary', 'DocNum'], ['Vertical', 'vertical_sales_orders', 'SONum']])('an explicit source resolves sales orders without treating patient name as an ID: %s', async (source, entity, order) => {
  const result = await prepare(`${originalOrdersRequest} de ${source}`, { catalog: orderCatalog });
  expect(result).toMatchObject({ status: 'ready', plan: { entity, selectedFields: ['PatientName', order], filters: dates } });
});

test('asking for both order sources requires separate selection, then accepts the source reply', async () => {
  const first = await prepare(originalOrdersRequest, { catalog: orderCatalog });
  const both = await prepare('Ambas', { catalog: orderCatalog, pending: first.pending });
  expect(both).toMatchObject({ status: 'clarification', plan: null });
  expect(both.message).toContain('por separado');
  const result = await prepare('SAP', { catalog: orderCatalog, pending: both.pending });
  expect(result).toMatchObject({ status: 'ready', plan: { entity: 'sales_order_summary', selectedFields: ['PatientName', 'DocNum'], filters: dates } });
});

test('order choices only expose authorized sources, and an unavailable explicit source never falls back', async () => {
  const result = await prepare(originalOrdersRequest, { catalog: [orderCatalog[1]] });
  expect(result).toMatchObject({ status: 'ready', plan: { entity: 'vertical_sales_orders', selectedFields: ['PatientName', 'SONum'], filters: dates } });
  const unavailable = await prepare(`${originalOrdersRequest} de SAP`, { catalog: [orderCatalog[1]] });
  expect(unavailable).toMatchObject({ status: 'unsupported', plan: null, choices: [] });
});

test('an order report without a patient name never substitutes the patient number or payer', async () => {
  const withoutNames = orderCatalog.map(entity => ({ ...entity, fields: entity.fields.filter(field => field.key !== 'PatientName'), defaultFields: entity.defaultFields.filter(key => key !== 'PatientName') }));
  const result = await prepare(`${originalOrdersRequest} de SAP`, { catalog: withoutNames });
  expect(result.status).toBe('unsupported');
  expect(result.message).toContain('pacientes');
});

test('an AI response cannot bypass source clarification or substitute an unauthorized order source', async () => {
  process.env.OPENAI_API_KEY = 'test-key';
  const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ status: 'ready', plan: { entity: 'vertical_sales_orders', selectedFields: ['PatientName', 'SONum'], filters: dates } }) } }] }) });
  const ambiguous = await prepare(originalOrdersRequest, { catalog: orderCatalog, fetchImpl, requireAi: true });
  expect(ambiguous).toMatchObject({ status: 'clarification', plan: null });
  expect(ambiguous.choices).toHaveLength(2);
  const unauthorized = await prepare(`${originalOrdersRequest} de SAP`, { catalog: [orderCatalog[1]], fetchImpl, requireAi: true });
  expect(unauthorized).toMatchObject({ status: 'unsupported', plan: null });
});

test('asking for both sources with only one authorized never silently generates a partial report', async () => {
  const result = await prepare(`${originalOrdersRequest} de ambas`, { catalog: [orderCatalog[1]] });
  expect(result).toMatchObject({ status: 'unsupported', plan: null });
  expect(result.message).toContain('ambos orígenes');
  expect(result.choices.map(choice => choice.id)).toEqual(['vertical_sales_orders']);
});

test('source and topic words inside a search value remain literal search text', async () => {
  const inventory = await prepare('Inventario busca "OV"');
  expect(inventory).toMatchObject({ status: 'ready', plan: { entity: 'inventory', filters: { busqueda: 'OV' } } });
  const orders = await prepare(`${originalOrdersRequest} de SAP busca "Vertical"`, { catalog: orderCatalog });
  expect(orders).toMatchObject({ status: 'ready', plan: { entity: 'sales_order_summary', selectedFields: ['PatientName', 'DocNum'], filters: { ...dates, busqueda: 'Vertical' } } });
});

test('patients mentioned before the order clause remain names when the source is included in that clause', async () => {
  const result = await prepare('Necesito los pacientes de SAP con todas las OV del 01/09/2026 al 30/09/2026', { catalog: orderCatalog });
  expect(result).toMatchObject({ status: 'ready', plan: { entity: 'sales_order_summary', selectedFields: ['PatientName', 'DocNum'], filters: dates } });
});

test('the restricted service detail never replaces the summary of all orders', async () => {
  const services = { ...orderCatalog[1], id: 'vertical_service_orders', title: 'Órdenes de venta de servicios' };
  const result = await prepare(originalOrdersRequest, { catalog: [services] });
  expect(result).toMatchObject({ status: 'unsupported', plan: null });
});

test('a new abbreviated order request leaves an unrelated topic, while adding an order cannot discard its data', async () => {
  const expanded = [...catalog, ...orderCatalog];
  const fresh = await prepare('Las OV', { catalog: expanded, context: inventoryContext });
  expect(fresh).toMatchObject({ status: 'clarification', plan: null });
  expect(fresh.choices.map(choice => choice.id)).toEqual(orderCatalog.map(entity => entity.id));
  const combined = await prepare('agrega las OV de SAP', { catalog: expanded, context: inventoryContext });
  expect(combined).toMatchObject({ status: 'unsupported', plan: null });
  expect(combined.message).toContain('datos del reporte actual');
});

test.each(realOrders.flatMap(entity => ['El tema que necesito es', 'Quiero el reporte'].map(prefix => ({ entity, prefix }))))('a stored exact topic selection is never replayed as requested columns: $entity.source, $prefix', async ({ entity, prefix }) => {
  const first = await prepare('Necesito los pacientes con todas las OV', { catalog: realOrders });
  expect(first).toMatchObject({ status: 'clarification', plan: null });
  const choice = await prepare(`${prefix} «${entity.title}».`, { catalog: realOrders, pending: first.pending });
  const fields = ['PatientName', entity.id === 'sales_order_summary' ? 'DocNum' : 'SONum'];
  expect(choice).toMatchObject({ status: 'clarification', plan: { entity: entity.id, selectedFields: fields, filters: { fechaDesde: '', fechaHasta: '' } } });
  const result = await prepare('del 01/09/2026 al 30/09/2026', { catalog: realOrders, context: choice.plan, pending: choice.pending });
  expect(result).toMatchObject({ status: 'ready', pending: null, plan: { entity: entity.id, selectedFields: fields, filters: dates } });
  expect(result.message).not.toContain('No pude identificar');
});

test.each(realOrders)('a topic title with a presentation delimiter or its exact source alias selects only the authorized report: $source', async entity => {
  const first = await prepare(originalOrdersRequest, { catalog: realOrders });
  for (const title of [entity.title.replace(' · ', ' — '), `OV ${entity.source}`]) {
    const result = await prepare(`Quiero el reporte «${title}».`, { catalog: realOrders, pending: first.pending });
    expect(result).toMatchObject({ status: 'ready', plan: { entity: entity.id, selectedFields: ['PatientName', entity.id === 'sales_order_summary' ? 'DocNum' : 'SONum'], filters: dates } });
  }
});

test('an exact topic selection retains added columns and conditions after the title', async () => {
  const first = await prepare(originalOrdersRequest, { catalog: realOrders });
  const recognized = await prepare(`Quiero el reporte «${realOrders[0].title}». Agrega el total.`, { catalog: realOrders, pending: first.pending });
  expect(recognized).toMatchObject({ status: 'ready', plan: { selectedFields: ['PatientName', 'DocNum', 'DocTotal'], filters: dates } });
  const unknown = await prepare(`Quiero el reporte «${realOrders[0].title}». Agrega dinosaurio.`, { catalog: realOrders, pending: first.pending });
  expect(unknown.status).toBe('clarification');
  expect(unknown.message).toContain('dinosaurio');
  const unavailable = await prepare(`Quiero el reporte «${realOrders[0].title}». Sólo pagadas.`, { catalog: realOrders, pending: first.pending });
  expect(unavailable).toMatchObject({ status: 'unsupported', plan: null });
});

test('an exact title outside the allowed catalog never falls back to the previous report', async () => {
  const result = await prepare(`Quiero el reporte «${realOrders[0].title}».`, { catalog: [realOrders[1]], context: { entity: realOrders[1].id, selectedFields: ['PatientName', 'SONum'], filters: dates } });
  expect(result).toMatchObject({ status: 'unsupported', plan: null, choices: [] });
  const ambiguous = await prepare('Quiero el reporte «OV».', { catalog: realOrders });
  expect(ambiguous).toMatchObject({ status: 'clarification', plan: null });
  expect(ambiguous.choices.map(choice => choice.id)).toEqual(realOrders.map(entity => entity.id));
});

test.each(realOrders)('summary presentation preserves all requested columns and dates: $source', async entity => {
  const fields = ['PatientName', entity.id === 'sales_order_summary' ? 'DocNum' : 'SONum'];
  const requestContext = { entity: entity.id, selectedFields: fields, filters: dates };
  for (const message of ['resumen por orden', 'con resumen por orden', 'solo resumen por orden']) {
    const result = await prepare(message, { catalog: realOrders, context: requestContext });
    expect(result).toMatchObject({ status: 'ready', plan: { entity: entity.id, selectedFields: fields, filters: dates } });
  }
  const unknown = await prepare('con resumen por orden y dinosaurio', { catalog: realOrders, context: requestContext });
  expect(unknown.status).toBe('clarification');
  expect(unknown.message).toContain('dinosaurio');
  expect((await prepare('agrupa por paciente', { catalog: realOrders, context: requestContext })).status).toBe('unsupported');
});

const inventoryChoices = { ...catalog[1], fields: [
  { key: 'Name', label: 'Insumo' }, { key: 'Quantity', label: 'Existencias', type: 'number' },
  { key: 'PurchaseCost', label: 'Último Costo Compra ($)', type: 'money' }, { key: 'AvgCost', label: 'Costo Promedio ($)', type: 'money' },
  { key: 'PriceHos', label: 'Precio Hospitalización ($)', type: 'money' }, { key: 'PricePG', label: 'Precio Público General ($)', type: 'money' },
] };

test('independent explicit cost and price choices remain resolved while replaying pending answers', async () => {
  const first = await prepare('Inventario con producto, costo y precio', { catalog: [inventoryChoices] });
  expect(first.status).toBe('clarification');
  const cost = first.options.find(option => option.label === 'Costo Promedio ($)');
  const second = await prepare(cost.message, { catalog: [inventoryChoices], context: first.plan, pending: first.pending });
  expect(second.status).toBe('clarification');
  expect(second.options.map(option => option.label)).toEqual(['Precio Hospitalización ($)', 'Precio Público General ($)']);
  const result = await prepare(second.options[1].message, { catalog: [inventoryChoices], context: second.plan, pending: second.pending });
  expect(result).toMatchObject({ status: 'ready', pending: null, plan: { selectedFields: ['Name', 'AvgCost', 'PricePG'] } });
});

test.each(['Sólo producto', 'Sin precio y sin costo'])('explicitly replacing or excluding unresolved columns closes their clarification: %s', async message => {
  const first = await prepare('Inventario con producto, costo y precio', { catalog: [inventoryChoices] });
  const result = await prepare(message, { catalog: [inventoryChoices], context: first.plan, pending: first.pending });
  expect(result).toMatchObject({ status: 'ready', plan: { selectedFields: ['Name'] } });
});

test.each([['Sólo antibióticos', 'ANTI'], ['Sólo controlados', 'CON']])('multiple medication types require an explicit choice and then stop asking: %s', async (label, code) => {
  const first = await prepare('Inventario sólo antibióticos y controlados con producto');
  expect(first.status).toBe('clarification');
  expect(first.options.map(option => option.label)).toEqual(['Sólo antibióticos', 'Sólo controlados']);
  const option = first.options.find(item => item.label === label);
  const result = await prepare(option.message, { context: first.plan, pending: first.pending });
  expect(result).toMatchObject({ status: 'ready', pending: null, plan: { selectedFields: ['Name'], filters: { clasificacionMedica: code } } });
});

test('filter clarification options answer the active question and retain an earlier type choice', async () => {
  const first = await prepare('Inventario de farmacia y almacén general sólo antibióticos y controlados con producto');
  expect(first.options.map(option => option.label)).toEqual(['Sólo antibióticos', 'Sólo controlados']);
  const second = await prepare(first.options[0].message, { context: first.plan, pending: first.pending });
  expect(second.status).toBe('clarification');
  expect(second.options.map(option => option.label)).toEqual(['Farmacia central', 'Almacén general']);
  const result = await prepare(second.options[0].message, { context: second.plan, pending: second.pending });
  expect(result).toMatchObject({ status: 'ready', plan: { selectedFields: ['Name'], filters: { almacen: 'FAR', clasificacionMedica: 'ANTI' } } });
});

test('choosing a cost after an ambiguous warehouse never reopens the warehouse question', async () => {
  const first = await prepare('Inventario de farmacia y almacén general con producto y costo', { catalog: [inventoryChoices] });
  expect(first.options.map(option => option.label)).toEqual(['Farmacia central', 'Almacén general']);
  const second = await prepare(first.options[0].message, { catalog: [inventoryChoices], context: first.plan, pending: first.pending });
  expect(second.status).toBe('clarification');
  expect(second.options.map(option => option.label)).toEqual(['Último Costo Compra ($)', 'Costo Promedio ($)']);
  const result = await prepare(second.options[1].message, { catalog: [inventoryChoices], context: second.plan, pending: second.pending });
  expect(result).toMatchObject({ status: 'ready', plan: { selectedFields: ['Name', 'AvgCost'], filters: { almacen: 'FAR' } } });
});

test('a selected clinical state survives a later independent doctor-role clarification', async () => {
  const roles = { ...surgeryStates, fields: [...surgeryStates.fields.filter(field => field.key !== 'Doctor'), { key: 'Treating', label: 'Médico tratante' }, { key: 'Requesting', label: 'Médico solicitante' }] };
  const first = await prepare('Cirugías del mes pasado abiertas con alta médica con paciente y médico', { catalog: [roles] });
  const state = first.options.find(option => option.label === 'Abiertas');
  const second = await prepare(state.message, { catalog: [roles], context: first.plan, pending: first.pending });
  expect(second.status).toBe('clarification');
  expect(second.options.map(option => option.label)).toEqual(['Médico tratante', 'Médico solicitante']);
  const result = await prepare(second.options[0].message, { catalog: [roles], context: second.plan, pending: second.pending });
  expect(result).toMatchObject({ status: 'ready', plan: { selectedFields: ['Patient', 'Treating'], filters: { ...dates, estatusDoc: 'OPEN' } } });
});

test('state clarification never inherits the choices for another filter', async () => {
  const warehousesAndStates = { ...catalog[1], filters: [...catalog[1].filters, 'estatusDoc'], statusOptions: [{ value: 'ALL', label: 'Todos' }, { value: 'OPEN', label: 'Abiertos' }, { value: 'CLOSED', label: 'Cerrados' }, { value: 'CANCELED', label: 'Cancelados' }] };
  const first = await prepare('Inventario de farmacia y almacén general abiertos y cancelados con producto', { catalog: [warehousesAndStates] });
  expect(first.message).toContain('¿Qué filtro quieres usar');
  expect(first.options.map(option => option.label)).toEqual(['Abiertos', 'Cerrados', 'Cancelados']);
  const second = await prepare(first.options[0].message, { catalog: [warehousesAndStates], context: first.plan, pending: first.pending });
  expect(second.options.map(option => option.label)).toEqual(['Farmacia central', 'Almacén general']);
  const result = await prepare(second.options[1].message, { catalog: [warehousesAndStates], context: second.plan, pending: second.pending });
  expect(result).toMatchObject({ status: 'ready', plan: { selectedFields: ['Name'], filters: { almacen: 'ALG', estatusDoc: 'OPEN' } } });
});

test('an unknown data request is preserved until an explicit authorized replacement is accepted', async () => {
  const first = await prepare('Cirugías del mes pasado con paciente y dinosaurio');
  expect(first.status).toBe('clarification');
  expect(first.message).toContain('«dinosaurio»');
  expect(first.message).toContain('Elegir filtros y columnas');
  expect(first.options.every(option => !option.label.startsWith('Continuar sin'))).toBe(true);
  const repeated = await prepare('Procedimientos', { context: first.plan, pending: first.pending });
  expect(repeated.status).toBe('clarification');
  expect(repeated.message).toContain('dinosaurio');
  const option = first.options.find(item => item.label === 'Usar Procedimientos');
  expect(option.message).toBe('Cambia «dinosaurio» por «Procedimientos».');
  const result = await prepare(option.message, { context: first.plan, pending: first.pending });
  expect(result).toMatchObject({ status: 'ready', plan: { selectedFields: ['Patient', 'Procedure'], filters: dates } });
});

test('known unavailable data only disappear after accepting their explicit named exclusion', async () => {
  const first = await prepare('Cirugías del mes pasado con paciente y costo');
  expect(first.status).toBe('unsupported');
  const option = first.options.find(item => item.label === 'Continuar sin costo');
  const result = await prepare(option.message, { context: first.plan, pending: first.pending });
  expect(result).toMatchObject({ status: 'ready', plan: { selectedFields: ['Patient'], filters: dates } });
});

test('removing the last column always leaves an unresolved mandatory choice', () => {
  const result = interpretRequest({ message: 'Quita el paciente', context: { entity: 'vertical_surgeries', selectedFields: ['Patient'], filters: dates }, catalog, today: '2026-10-01' });
  expect(result.proposal.status).toBe('clarification');
  expect(result.proposal.message).toContain('al menos una columna');
  expect(result.hasUnresolved).toBe(true);
});
