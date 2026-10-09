import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';
const require = createRequire(import.meta.url);
const { prepareReport } = require('../../backend/services/reportAssistant.service');
const { catalog: verticalAssistantSources } = require('../../backend/services/assistantVerticalSources.service');
const { applyAnalysis, validateAnalysis, describeAnalysis } = require('../../backend/services/reportAnalysis.service');
// Use the actual guided planner and fake records; this test never contacts an LLM or hospital database.
for (const key of ['GEMINI_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY']) delete process.env[key];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.resolve(root, '../tmp/report-assistant');
await fs.mkdir(outputDir, { recursive: true });
const server = await createServer({ configFile: false, root, cacheDir: path.join(outputDir, 'vite-cache'), appType: 'custom', plugins: [react(), {
  name: 'report-assistant-preview', configureServer(server) {
    server.middlewares.use('/__assistant', async (_req, res) => {
      const html = await server.transformIndexHtml('/__assistant', `<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module">
        import React from 'react'; import { createRoot } from 'react-dom/client';
        import { AuthProvider, useAuth } from '/src/context/AuthContext.jsx'; import ReportBuilder from '/src/components/mi-area/ConsultaServiceLayer.jsx'; import '/src/styles/globals.css';
        function App() { const { loading, login } = useAuth(); React.useEffect(() => { window.__refreshAssistantTestUser = () => login('synthetic-user', 'synthetic-password'); return () => { delete window.__refreshAssistantTestUser; }; }, [login]); return loading ? null : React.createElement('main', {style: {padding: '16px', maxWidth: '1400px', margin: '0 auto'}}, React.createElement(ReportBuilder)); }
        createRoot(document.getElementById('root')).render(React.createElement(AuthProvider, null, React.createElement(App)));
      </script></body></html>`);
      res.setHeader('Content-Type', 'text/html'); res.end(html);
    });
  },
}], server: { host: '127.0.0.1', port: 0, hmr: false } });
const catalog = [
  { id: 'inventory', source: 'SAP', title: 'Inventario por almacén', category: 'Inventarios', description: 'Existencias actuales.', requiresDateFilter: false, filters: ['almacen', 'clasificacionMedica'], defaultFields: ['Name'], fields: [{ key: 'Name', label: 'Insumo' }, { key: 'Quantity', label: 'Existencias', type: 'number' }, { key: 'Cost', label: 'Costo promedio', type: 'money' }, { key: 'LastCost', label: 'Último costo de compra', type: 'money' }] },
  { id: 'vertical_surgeries', source: 'Vertical', title: 'Cirugías y uso de quirófano', category: 'Quirófano', description: 'Cirugías con paciente, médico y estado actual de la cuenta.', grain: 'Una fila por cirugía registrada.', requiresDateFilter: true, dateFieldLabel: 'Inicio de cirugía', filters: ['estatusDoc'], statusField: 'State', medicalDischargeField: 'Discharged', statusLabel: 'Estado de cuenta o alta médica', statusDescription: 'El estado es el actual. Una cuenta puede estar abierta o cerrada y tener alta médica. El período corresponde al inicio de la cirugía.', statusOptions: [{ value: 'ALL', label: 'Todas las cuentas' }, { value: 'OPEN', label: 'Abiertas' }, { value: 'CLOSED', label: 'Cerradas' }, { value: 'MEDICAL_DISCHARGE', label: 'Con alta médica' }, { value: 'NO_MEDICAL_DISCHARGE', label: 'Sin alta médica' }, { value: 'CANCELED', label: 'Canceladas' }], defaultFields: ['Patient', 'Doctor', 'Procedure', 'State', 'Discharged'], fields: [{ key: 'Patient', label: 'Paciente' }, { key: 'Doctor', label: 'Médicos registrados' }, { key: 'Procedure', label: 'Procedimientos' }, { key: 'Start', label: 'Inicio', type: 'datetime' }, { key: 'State', label: 'Estado de cuenta' }, { key: 'Discharged', label: 'Alta médica' }, { key: 'DischargeDate', label: 'Fecha de alta médica', type: 'datetime' }, { key: 'ClosedDate', label: 'Fecha de cierre de cuenta', type: 'datetime' }] },
  { id: 'sales_order_summary', source: 'SAP', title: 'Órdenes de venta SAP · resumen por orden', category: 'Ventas y Servicios', description: 'Una fila por orden, incluidas las canceladas y las órdenes sin líneas.', grain: 'Una fila por orden SAP.', requiresDateFilter: true, dateFieldLabel: 'Fecha de emisión', filters: ['estatusDoc'], defaultFields: ['DocNum', 'DocDate', 'PatientName', 'CardName'], fields: [{ key: 'DocNum', label: 'Folio SAP' }, { key: 'DocDate', label: 'Fecha de emisión', type: 'date' }, { key: 'PatientName', label: 'Paciente' }, { key: 'PTNum', label: 'Número de paciente', type: 'number' }, { key: 'PCNum', label: 'Folio de atención', type: 'number' }, { key: 'CardName', label: 'Cliente / proveedor' }] },
  { id: 'vertical_sales_orders', source: 'Vertical', title: 'Órdenes de venta Vertical · resumen por orden', category: 'Servicios Clínicos', description: 'Todas las órdenes de venta, tengan servicios, artículos o ninguna línea.', grain: 'Una fila por orden Vertical.', requiresDateFilter: true, dateFieldLabel: 'Fecha de creación de orden', filters: [], defaultFields: ['SONum', 'CreatedOn', 'PatientName'], fields: [{ key: 'SONum', label: 'Número de orden', type: 'number' }, { key: 'CreatedOn', label: 'Creación de orden', type: 'datetime' }, { key: 'PatientName', label: 'Paciente' }, { key: 'PTNum', label: 'Número de paciente', type: 'number' }] },
  { id: 'vertical_service_orders', source: 'Vertical', title: 'Órdenes de venta de servicios', category: 'Servicios Clínicos', description: 'Solo líneas de servicio de órdenes Vertical.', requiresDateFilter: true, dateFieldLabel: 'Fecha de creación de orden', filters: [], defaultFields: ['SONum', 'SOLNNum', 'CreatedOn', 'PatientName'], fields: [{ key: 'SONum', label: 'Número de orden', type: 'number' }, { key: 'SOLNNum', label: 'Número de línea', type: 'number' }, { key: 'CreatedOn', label: 'Creación de orden', type: 'datetime' }, { key: 'PatientName', label: 'Paciente' }, { key: 'PTNum', label: 'Número de paciente', type: 'number' }] },
];
const hiddenCapability = {
  id: 'assistant_account_agreements_test', assistantOnly: true, source: 'SAP + Vertical',
  title: 'Acuerdos comerciales y cuenta del paciente', category: 'Reportes conversados',
  description: 'Relaciona la cuenta y el acuerdo de Vertical con el cliente de SAP.',
  requiresDateFilter: false, filters: [], requiredPermissions: ['vertical_surgeries', 'sales_order_summary'],
  defaultFields: ['AccountNumber', 'PatientName', 'AgreementName', 'CardName'],
  fields: [{ key: 'AccountNumber', label: 'Cuenta' }, { key: 'PatientName', label: 'Paciente' }, { key: 'AgreementName', label: 'Acuerdo comercial' }, { key: 'CardName', label: 'Cliente SAP' }, { key: 'CreditLimit', label: 'Límite de crédito', type: 'money' }],
};
const hiddenRequest = 'Necesito acuerdos comerciales y estados de cuenta del paciente con el cliente de SAP';
const commercialAgreementsCapability = verticalAssistantSources.assistant_commercial_agreements;
const commercialTermsFixture = {
  Deductible: 'SER_DED', DeductibleItemName: 'Deducible sintético', DefaultDeductible: 1500,
  CopayAmount: 'SER_COPA', CopayAmountItemName: 'Copago sintético', DefaultCopayAmount: 300,
  CopayPercentage: 'SER_COPA_PCT', CopayPercentageItemName: 'Copago porcentual sintético', DefaultCopayPercentage: 10,
  Coinsurance: 'SER_COAS', CoinsuranceItemName: 'Coaseguro sintético',
  CoinsurancePercentage: null, CoinsurancePercentageItemName: null, DefaultCoinsurancePercentage: 20,
};
const formattingCapability = {
  id: 'assistant_formatting_values_test', assistantOnly: true, source: 'Vertical',
  title: 'Condiciones registradas · valores de prueba', category: 'Reportes conversados',
  requiresDateFilter: false, filters: [], requiredPermissions: ['assistant_commercial_agreements'],
  defaultFields: ['AgreementCode', 'Amount', 'Rate', 'Count'],
  fields: [{ key: 'AgreementCode', label: 'Código de convenio' }, { key: 'Amount', label: 'Condición de importe', type: 'money' }, { key: 'Rate', label: 'Condición de porcentaje', type: 'percent' }, { key: 'Count', label: 'Condición de cantidad', type: 'number' }],
};
const formattingRequest = 'Prueba local de condiciones numéricas y textos registrados';
const analysisCapability = {
  id: 'sales_invoice_summary', assistantOnly: true, source: 'SAP', title: 'Facturas de prueba · análisis', category: 'Reportes conversados',
  requiresDateFilter: false, filters: [], requiredPermissions: ['assistant_sap_resources'], grain: 'Una fila por factura de prueba.',
  defaultFields: ['DocEntry', 'CardName', 'DocTotal'], fields: [{ key: 'DocEntry', label: 'Identificador de factura', type: 'number' }, { key: 'CardName', label: 'Socio de negocios' }, { key: 'DocTotal', label: 'Importe de factura', type: 'money' }, { key: 'DocStatus', label: 'Estado de factura' }],
};
const analysisRequest = 'Analiza las facturas de prueba con importe positivo por socio de negocios, suma importes y cuenta facturas distintas; pregunta el orden';
const analysisAdjustment = 'Ordena este análisis de menor a mayor';
const financialAnalysis = validateAnalysis(analysisCapability, { predicates: [{ field: 'DocTotal', op: 'gt', value: 0 }], groupBy: ['CardName'], measures: [{ op: 'sum', field: 'DocTotal' }, { op: 'countDistinct', field: 'DocEntry' }], orderBy: [{ field: 'metric_0', direction: 'desc' }] });
const analysisRows = Array.from({ length: 120 }, (_, index) => [
  { DocEntry: index * 2 + 1, CardName: `Socio de prueba ${String(index + 1).padStart(3, '0')}`, DocTotal: 100 + index, DocStatus: 'O' },
  { DocEntry: index * 2 + 2, CardName: `Socio de prueba ${String(index + 1).padStart(3, '0')}`, DocTotal: 50, DocStatus: 'C' },
]).flat().concat([{ DocEntry: 241, CardName: 'Socio sin importe', DocTotal: 0, DocStatus: 'C' }, { DocEntry: 242, CardName: 'Socio desconocido', DocTotal: null, DocStatus: 'O' }]);
let analysisSourceTruncated = false;
let analysisOutputLimit = 10000;
const exactCapability = {
  id: 'assistant_account_billing_collections', assistantOnly: true, source: 'SAP + Vertical', title: 'Cuentas de prueba · consulta exacta', category: 'Reportes conversados',
  requiresDateFilter: true, pointLookupFields: ['PCNum', 'PTNum'], filters: [], requiredPermissions: ['assistant_vertical_resources', 'assistant_sap_resources'],
  defaultFields: ['PCNum', 'PatientName', 'InvoiceTotal'], fields: [{ key: 'PCNum', label: 'Cuenta del paciente', type: 'number' }, { key: 'PTNum', label: 'Número de paciente', type: 'number' }, { key: 'PatientName', label: 'Paciente' }, { key: 'InvoiceTotal', label: 'Importe facturado SAP', type: 'money' }, { key: 'Currency', label: 'Moneda' }],
};
const exactRequest = 'Consulta de prueba de la cuenta exacta 6101 sin período';
const canonicalCurrencyRequest = 'Prueba de totales facturados por paciente conservando su moneda';
const canonicalCurrencyFollowup = 'Ordena la prueba de moneda por total';
const formattingRows = [
  { AgreementCode: 'NUM', Amount: 1500.25, Rate: 10, Count: 2 },
  { AgreementCode: 'NUM-STRING', Amount: '2500.50', Rate: '12.5', Count: '3' },
  { AgreementCode: 'SCIENTIFIC', Amount: '1.5e3', Rate: '+1.2e1', Count: '-2e0' },
  { AgreementCode: 'TEXT', Amount: 'Sin deducible <condición> & cobertura', Rate: '10% ó 15% según cobertura', Count: 'Consultar convenio' },
  { AgreementCode: 'EXPRESSION', Amount: '1 UMA + IVA; validar tabulador', Rate: 'Copago fijo > $500 & no incluye IVA', Count: '=1+2' },
  { AgreementCode: 'FORMATTED-TEXT', Amount: '$2,500.50 MXN', Rate: '12,5% aprobado', Count: 'Hasta 3 consultas' },
  { AgreementCode: 'NONCANONICAL', Amount: '0x10', Rate: '20% incluido', Count: '1,000' },
  { AgreementCode: 'NULL', Amount: null, Rate: null, Count: null },
  { AgreementCode: 'EMPTY', Amount: '', Rate: '', Count: '' },
  { AgreementCode: 'SPACE', Amount: '  ', Rate: '  ', Count: '  ' },
  { AgreementCode: 'ZERO', Amount: 0, Rate: 0, Count: 0 },
  // JSON cannot carry non-finite numeric values: they become null on the wire.
  { AgreementCode: 'NONFINITE', Amount: Number.NaN, Rate: Number.POSITIVE_INFINITY, Count: Number.NEGATIVE_INFINITY },
  { AgreementCode: 'NONFINITE-TEXT', Amount: 'NaN', Rate: 'Infinity', Count: '-Infinity' },
];
let user = { id: 1, username: 'amendoza', role: 'ADMIN', permisos: [] };
let assistantError = false;
let assistantOutageNoticeOnce = false;
let assistantLocalWithKeyOnce = false;
let providerRequests = 0;
let executionError = false;
const requests = [];
const plans = [];
const saved = [];
const assignmentRequests = [];
const recipients = [{ id: 42, username: 'contador-prueba', nombre: 'Contador de prueba', role: 'JEFE_AREA', area: 'Contabilidad', activo: true }, { id: 43, username: 'auditor-prueba', nombre: 'Auditor de prueba', role: 'JEFE_AREA', area: 'Auditoría', activo: true }, { id: 44, username: 'exusuario-prueba', nombre: 'Exusuario de prueba', role: 'JEFE_AREA', area: 'Contabilidad', activo: false }];
let assignmentErrorOnce = false;
let browser, page;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/Mexico_City' });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.addInitScript(() => sessionStorage.setItem('escandon_token', 'assistant-test'));
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (!pathname.startsWith('/api/')) return route.continue();
    if (pathname.endsWith('/auth/me')) return route.fulfill({ json: { user } });
    if (pathname.endsWith('/auth/login')) return route.fulfill({ json: { token: 'assistant-test', user } });
    const allowed = catalog.filter(entity => user.username === 'amendoza' || user.permisos.includes(`sap-query-${entity.id}`));
    const allowedAssistant = [...allowed, ...[hiddenCapability, commercialAgreementsCapability, formattingCapability, analysisCapability, exactCapability].filter(entity => entity.requiredPermissions.every(moduleId => user.username === 'amendoza' || user.permisos.includes(`sap-query-${moduleId}`)))];
    if (pathname.endsWith('/sap-query/catalog')) return route.fulfill({ json: { ok: true, catalog: allowed, assistantCatalog: allowedAssistant } });
    const canAssign = user.role === 'ADMIN' || user.username === 'amendoza';
    const isAssigned = report => report.assignedUserIds?.includes(user.id);
    const visibleSaved = report => canAssign || report.username === user.username || isAssigned(report);
    if (pathname.endsWith('/sap-query/saved/access')) return route.fulfill({ json: { ok: true, hasAssignedReports: saved.some(isAssigned) } });
    const savedDefinition = report => {
      const entity = [...catalog, hiddenCapability, commercialAgreementsCapability, formattingCapability, analysisCapability, exactCapability].find(entity => entity.id === report.entity);
      return { ...entity, fields: entity.fields.filter(field => report.selectedFields.includes(field.key)), defaultFields: report.selectedFields };
    };
    if (pathname.endsWith('/sap-query/saved/recipients')) return route.fulfill({ status: canAssign ? 200 : 403, json: canAssign ? { ok: true, users: recipients.filter(person => person.activo !== false) } : { ok: false, error: 'No tienes permiso para asignar reportes.' } });
    const assignmentMatch = pathname.match(/\/sap-query\/saved\/([^/]+)\/assignments$/);
    if (assignmentMatch) {
      assert.equal(canAssign, true, 'Only administrators can change assignments');
      const body = route.request().postDataJSON(); assignmentRequests.push({ id: assignmentMatch[1], ...body });
      if (body.userIds.some(id => !recipients.some(person => person.id === id && person.activo !== false))) return route.fulfill({ status: 400, json: { ok: false, error: 'Sólo puedes asignar reportes a usuarios activos.' } });
      if (assignmentErrorOnce) { assignmentErrorOnce = false; return route.fulfill({ status: 503, json: { ok: false, error: 'No se pudieron guardar los accesos. Intenta de nuevo.' } }); }
      const report = saved.find(report => report.id === assignmentMatch[1]); assert.ok(report);
      report.assignedUserIds = [...body.userIds];
      return route.fulfill({ json: { ok: true, savedQueryId: report.id, assignedUsers: recipients.filter(person => body.userIds.includes(person.id)) } });
    }
    if (pathname.endsWith('/sap-query/saved')) {
      if (route.request().method() === 'POST') {
        const report = { id: `synthetic-${saved.length + 1}`, username: user.username, userId: user.id, createdAt: '2026-10-01T15:00:00Z', assignedUserIds: [], ...route.request().postDataJSON() }; saved.push(report);
        return route.fulfill({ json: { ok: true, saved: { id: report.id, queryid: report.id, titulo: report.title, fechacreacion: report.createdAt } } });
      }
      return route.fulfill({ json: { ok: true, canAssign, queries: saved.filter(visibleSaved).map(report => ({ ...report, isOwner: report.username === user.username, isAssigned: isAssigned(report), canAssign, canDelete: canAssign || report.username === user.username, executionLocked: true, definition: savedDefinition(report), ...(canAssign ? { assignedUsers: recipients.filter(person => report.assignedUserIds?.includes(person.id)) } : {}) })) } });
    }
    if (pathname.endsWith('/sap-query/assistant')) {
      const body = route.request().postDataJSON(); plans.push(body);
      if (assistantError) return route.fulfill({ status: 503, json: { ok: false, error: 'No pude preparar el reporte en este momento.' } });
      // This fixture isolates the frontend contract for assistant-only joined reports.
      // The existing scenarios below keep using the real guided planner.
      if (body.message === hiddenRequest && allowedAssistant.some(entity => entity.id === hiddenCapability.id)) {
        return route.fulfill({ json: { ok: true, status: 'ready', engine: 'guided', message: 'Prepararé los acuerdos de Vertical con el cliente de SAP.', plan: { entity: hiddenCapability.id, entityTitle: hiddenCapability.title, source: hiddenCapability.source, requiresDateFilter: false, selectedFields: hiddenCapability.defaultFields, filters: { fechaDesde: '', fechaHasta: '', busqueda: '', almacen: 'ALL', estatusDoc: 'ALL', clasificacionMedica: 'ALL' }, appliedFilters: [] } } });
      }
      if (body.message === formattingRequest && allowedAssistant.some(entity => entity.id === formattingCapability.id)) {
        return route.fulfill({ json: { ok: true, status: 'ready', engine: 'guided', message: 'Prepararé las condiciones registradas de prueba.', plan: { entity: formattingCapability.id, entityTitle: formattingCapability.title, source: formattingCapability.source, requiresDateFilter: false, selectedFields: formattingCapability.defaultFields, filters: { fechaDesde: '', fechaHasta: '', busqueda: '', almacen: 'ALL', estatusDoc: 'ALL', clasificacionMedica: 'ALL' }, appliedFilters: [] } } });
      }
      if ([analysisRequest, analysisAdjustment, 'Ordena el total de mayor a menor.'].includes(body.message) && allowedAssistant.some(entity => entity.id === analysisCapability.id)) {
        const analysis = body.message === analysisRequest ? { ...financialAnalysis, orderBy: [] } : body.message === analysisAdjustment ? { ...body.context.analysis, orderBy: [{ field: 'metric_0', direction: 'asc' }] } : financialAnalysis;
        const plan = { entity: analysisCapability.id, entityTitle: analysisCapability.title, source: analysisCapability.source, selectedFields: analysisCapability.defaultFields, requiresDateFilter: false, filters: { fechaDesde: '', fechaHasta: '', busqueda: '', almacen: 'ALL', estatusDoc: 'ALL', clasificacionMedica: 'ALL' }, analysis, analysisSummary: describeAnalysis(analysisCapability, analysis), appliedFilters: [] };
        return route.fulfill({ json: { ok: true, status: body.message === analysisRequest ? 'clarification' : 'ready', engine: 'guided', message: body.message === analysisRequest ? '¿Cómo quieres ordenar los totales?' : 'Prepararé el análisis de facturas por socio.', plan, ...(body.message === analysisRequest ? { pending: { request: analysisRequest, answers: [] }, options: [{ label: 'De mayor a menor', message: 'Ordena el total de mayor a menor.' }] } : {}) } });
      }
      if ([exactRequest, canonicalCurrencyRequest, canonicalCurrencyFollowup].includes(body.message) && allowedAssistant.some(entity => entity.id === exactCapability.id)) {
        const analysis = body.message === exactRequest ? { predicates: [{ field: 'PCNum', op: 'eq', value: 6101 }], groupBy: [], measures: [], orderBy: [] } : body.message === canonicalCurrencyRequest ? { predicates: [], groupBy: ['PatientName'], measures: [{ op: 'sum', field: 'InvoiceTotal' }], orderBy: [] } : { ...body.context.analysis, orderBy: [{ field: 'metric_0', direction: 'desc' }] };
        const filters = { fechaDesde: body.message === exactRequest ? '' : '2026-09-01', fechaHasta: body.message === exactRequest ? '' : '2026-09-30', busqueda: '', almacen: 'ALL', estatusDoc: 'ALL', clasificacionMedica: 'ALL' };
        const plan = { entity: exactCapability.id, entityTitle: exactCapability.title, source: exactCapability.source, selectedFields: exactCapability.defaultFields, requiresDateFilter: true, filters, analysis, appliedFilters: [] };
        return route.fulfill({ json: { ok: true, status: 'ready', engine: 'guided', message: 'Prepararé la consulta de cuentas de prueba.', plan } });
      }
      const localWithKey = assistantLocalWithKeyOnce;
      assistantLocalWithKeyOnce = false;
      const providerEnv = ['GEMINI_API_KEY', 'GEMINI_MODEL', 'LLM_BASE_URL'];
      const previousProviderEnv = Object.fromEntries(providerEnv.map(key => [key, process.env[key]]));
      let result;
      try {
        if (localWithKey) {
          process.env.GEMINI_API_KEY = 'fictional-key-for-local-resolution';
          process.env.GEMINI_MODEL = 'gemini-3.5-flash-lite';
          process.env.LLM_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
        }
        result = await prepareReport({ ...body, catalog: allowedAssistant.filter(entity => ![hiddenCapability.id, formattingCapability.id, analysisCapability.id, exactCapability.id].includes(entity.id)), now: new Date('2026-10-01T15:00:00Z'), fetchImpl: async () => { providerRequests += 1; throw new Error('Network access is blocked in this synthetic UI test'); } });
      } finally {
        for (const key of providerEnv) {
          if (previousProviderEnv[key] === undefined) delete process.env[key];
          else process.env[key] = previousProviderEnv[key];
        }
      }
      // Simulate an earlier provider outage without contacting an AI service.
      if (assistantOutageNoticeOnce) {
        assistantOutageNoticeOnce = false;
        result.notice = 'La conexión de IA no está disponible en este momento. Te ayudaré con la búsqueda guiada.';
      }
      return route.fulfill({ json: { ok: true, ...result } });
    }
    if (pathname.endsWith('/sap-query/execute')) {
      const requestedBody = route.request().postDataJSON(); requests.push(requestedBody);
      if (executionError) return route.fulfill({ status: 503, json: { ok: false, error: 'No se pudo consultar la información. Intenta de nuevo.' } });
      const savedReport = requestedBody.savedQueryId && saved.find(report => report.id === requestedBody.savedQueryId && visibleSaved(report));
      if (requestedBody.savedQueryId && !savedReport) return route.fulfill({ status: 403, json: { ok: false, error: 'Ya no tienes acceso a este reporte. Actualiza Mis reportes.' } });
      const body = savedReport ? { entity: savedReport.entity, selectedFields: savedReport.selectedFields, ...savedReport.filters } : requestedBody;
      const entity = savedReport ? savedDefinition(savedReport) : allowedAssistant.find(entity => entity.id === body.entity);
      assert.ok(entity, 'Assistant cannot execute a module without permission');
      if (body.entity === analysisCapability.id) {
        try {
          const source = { entityTitle: entity.title, data: analysisRows, truncated: analysisSourceTruncated, loadedFields: body.selectedFields, columnas: entity.fields.filter(field => body.selectedFields.includes(field.key)), limit: analysisOutputLimit };
          const result = body.analysis ? applyAnalysis(entity, source, body.analysis, { selectedFields: body.selectedFields, limit: analysisOutputLimit }) : { ...source, data: analysisRows.map(record => Object.fromEntries(body.selectedFields.map(key => [key, record[key]]))) };
          return route.fulfill({ json: { ok: true, ...result } });
        } catch (error) { return route.fulfill({ status: error.status || 400, json: { ok: false, error: error.message } }); }
      }
      if (body.entity === formattingCapability.id) return route.fulfill({ json: { ok: true, entityTitle: entity.title, data: formattingRows.map(record => Object.fromEntries(body.selectedFields.map(key => [key, record[key]]))), truncated: false, loadedFields: body.selectedFields, columnas: entity.fields.filter(field => body.selectedFields.includes(field.key)) } });
      const record = { Patient: 'Paciente de prueba', Doctor: 'Médico de prueba', Procedure: 'Procedimiento de prueba', Start: '2026-09-15T10:00:00', State: body.estatusDoc === 'OPEN' ? 'Abierta' : body.estatusDoc === 'CANCELED' ? 'Cancelada' : 'Cerrada', Discharged: body.estatusDoc === 'NO_MEDICAL_DISCHARGE' ? 'No' : 'Sí', DischargeDate: '2026-09-16T11:00:00', ClosedDate: '2026-09-17T09:00:00', Name: 'Insumo de prueba', Quantity: 12, Cost: 50, PatientName: 'Paciente de prueba OV', DocNum: 3101, DocDate: '2026-09-15', CardName: 'Aseguradora de prueba', SONum: 7101, SOLNNum: 1, CreatedOn: '2026-09-15T10:00:00', PTNum: 2101, PCNum: 6101, InvoiceTotal: 120, Currency: 'USD', AccountNumber: 6101, AgreementCode: 'CONV-01', AgreementName: 'Acuerdo de prueba Vertical', CreditLimit: 9000, GlobalDiscount: 15, AdministrativeChargePercent: 5, ...commercialTermsFixture };
      const row = Object.fromEntries(body.selectedFields.map(key => [key, record[key]]));
      if (body.analysis) {
        try {
          const source = { entityTitle: entity.title, data: body.busqueda === 'sin resultados' ? [] : [record], truncated: false, loadedFields: body.selectedFields };
          return route.fulfill({ json: { ok: true, ...applyAnalysis(entity, source, body.analysis, { selectedFields: body.selectedFields }) } });
        } catch (error) { return route.fulfill({ status: error.status || 400, json: { ok: false, error: error.message } }); }
      }
      return route.fulfill({ json: { ok: true, entityTitle: entity.title, data: body.busqueda === 'sin resultados' ? [] : [row], truncated: false,
        ...(entity.assistantOnly ? { loadedFields: body.selectedFields, columnas: entity.fields.filter(field => body.selectedFields.includes(field.key)) } : {}) } });
    }
    return route.fulfill({ json: { ok: true, data: [] } });
  });
  await page.goto(`${server.resolvedUrls.local[0]}__assistant`);
  const input = page.getByLabel('¿Qué información necesitas?', { exact: true });
  const send = async text => { await input.fill(text); await page.getByRole('button', { name: 'Enviar solicitud', exact: true }).click(); await page.getByRole('button', { name: 'Enviar solicitud', exact: true }).waitFor(); };
  const waitForExportEnabled = () => page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.includes('Descargar Excel Oficial') && !button.disabled));
  await input.waitFor(); await page.waitForFunction(() => !document.querySelector('#report-assistant-message').disabled);
  assert.equal(await page.getByRole('button', { name: 'Crear con asistente', exact: true }).getAttribute('aria-pressed'), 'true');
  await send('Cirugías con paciente y médico');
  await page.getByText(/¿De qué período necesitas/).waitFor();
  assert.equal(requests.length, 0, 'Incomplete requests must ask a question before querying');
  await page.getByRole('button', { name: 'Elegir filtros y columnas', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Elegir un tema', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('checkbox', { name: 'Paciente', exact: true }).isChecked(), true);
  assert.equal(await page.getByRole('checkbox', { name: 'Médicos registrados', exact: true }).isChecked(), true);
  assert.equal(await page.getByRole('checkbox', { name: 'Procedimientos', exact: true }).isChecked(), false, 'A partial manual draft keeps only the requested columns');
  assert.equal(await page.getByLabel('Fecha Desde', { exact: true }).inputValue(), '');
  assert.equal(await page.getByLabel('Fecha Hasta', { exact: true }).inputValue(), '');
  assert.equal(requests.length, 0, 'Switching to manual configuration never runs the partial report');
  await page.getByRole('button', { name: 'Buscar información', exact: true }).click();
  await page.getByRole('alert').getByText(/Elige las fechas de inicio y fin/).waitFor();
  assert.equal(requests.length, 0, 'Missing dates must be completed explicitly in the manual form');
  await page.getByRole('button', { name: 'Crear con asistente', exact: true }).click();
  await page.getByRole('log').getByText('Cirugías con paciente y médico', { exact: true }).waitFor();
  assistantOutageNoticeOnce = true;
  await send('El mes pasado');
  assert.equal(plans.at(-1).pending.request, 'Cirugías con paciente y médico', 'Manual mode preserves the pending original request');
  assert.deepEqual(plans.at(-1).context.selectedFields, ['Patient', 'Doctor']);
  await page.getByText(/Tu reporte está listo con 1 registro/).waitFor();
  assert.match(await page.locator('.report-assistant__notice').innerText(), /La conexión de IA no está disponible/);
  assert.deepEqual(requests.at(-1).selectedFields, ['Patient', 'Doctor']);
  assert.equal(requests.at(-1).fechaDesde, '2026-09-01'); assert.equal(requests.at(-1).fechaHasta, '2026-09-30');
  assistantLocalWithKeyOnce = true;
  await send('Mejor del 1 al 15 de septiembre');
  assert.equal(providerRequests, 0, 'A confident local date adjustment does not contact the configured AI provider');
  assert.equal(await page.locator('.report-assistant__notice').count(), 0, 'A local guided result with no notice clears an earlier provider-outage banner');
  assert.equal(await page.locator('.report-assistant__sender').last().innerText(), 'Guía de reportes');
  assert.equal(requests.at(-1).fechaDesde, '2026-09-01'); assert.equal(requests.at(-1).fechaHasta, '2026-09-15', 'Colloquial follow-up must reach the execution endpoint with the requested end date');
  assert.deepEqual(requests.at(-1).selectedFields, ['Patient', 'Doctor']);
  await page.getByRole('log').getByText(/del 01\/09\/2026 al 15\/09\/2026/).waitFor();
  const beforeUnclear = requests.length;
  await send('Mejor antes de Navidad');
  assert.equal(requests.length, beforeUnclear, 'An unclear date change must ask instead of querying the old period');
  await page.getByRole('log').getByText(/No pude identificar el nuevo período/).waitFor();
  await send('La primera quincena de septiembre, porfa');
  assert.equal(requests.at(-1).fechaHasta, '2026-09-15');
  await send('Agrega el procedimiento');
  assert.deepEqual(requests.at(-1).selectedFields, ['Patient', 'Doctor', 'Procedure']);
  assert.ok(plans.at(-1).context.selectedFields.includes('Doctor'), 'Follow-up carries validated context');
  await send('agrega status y alta medica y fecha de alta medica y fecha de cierre de cuenta');
  assert.deepEqual(requests.at(-1).selectedFields, ['Patient', 'Doctor', 'Procedure', 'State', 'Discharged', 'DischargeDate', 'ClosedDate']);
  await send('nomas las cerradas');
  assert.equal(requests.at(-1).estatusDoc, 'CLOSED');
  await send('mejor solo con alta medica');
  assert.equal(requests.at(-1).estatusDoc, 'MEDICAL_DISCHARGE');
  assert.equal(requests.at(-1).fechaHasta, '2026-09-15');
  await page.getByRole('complementary', { name: 'Configuración del reporte conversado' }).getByText('Con alta médica', { exact: true }).waitFor();
  assert.ok(!JSON.stringify(plans).includes('Paciente de prueba'), 'Fetched record contents must never enter the assistant conversation');
  await page.getByRole('button', { name: 'Ver reporte', exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Reporte generado');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Descargar Excel Oficial/ }).click();
  const download = await downloadPromise; const excel = await fs.readFile(await download.path(), 'utf8');
  assert.match(excel, /Paciente de prueba/); assert.match(excel, /Médico de prueba/); assert.match(excel, /Procedimiento de prueba/);
  assert.match(excel, /2026-09-01 al 2026-09-15/, 'Excel must include the applied period');
  assert.match(excel, /Estado de cuenta/); assert.match(excel, /Cerrada/);
  assert.match(excel, /Alta médica/); assert.match(excel, /Fecha de cierre de cuenta/);
  await send('nomas sin alta medica');
  assert.equal(requests.at(-1).estatusDoc, 'NO_MEDICAL_DISCHARGE');
  await send('solo abiertas');
  assert.equal(requests.at(-1).estatusDoc, 'OPEN');
  await send('solo canceladas');
  assert.equal(requests.at(-1).estatusDoc, 'CANCELED');
  await send('solo con alta medica');
  const beforeUnsupported = requests.length;
  await send('Agrega el costo'); await page.getByText(/Este tema no reúne todos los datos/).waitFor();
  assert.equal(requests.length, beforeUnsupported);
  await page.getByRole('complementary', { name: 'Configuración del reporte conversado' }).getByText('De tu idea al reporte', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Elegir filtros y columnas', exact: true }).count(), 0, 'An unsupported reply with no plan does not expose the earlier conversation plan as a manual draft');
  await page.getByRole('button', { name: 'Prefiero elegir un tema', exact: true }).click();
  assert.equal(await page.locator('.report-builder__configuration-panel').count(), 0, 'An unsupported request opens the catalog without the previous ready report');
  assert.equal(await page.getByRole('button', { name: 'Buscar información', exact: true }).count(), 0);
  assert.equal(requests.length, beforeUnsupported, 'Manual continuation after an unsupported response does not execute an older report');
  await page.getByRole('button', { name: 'Crear con asistente', exact: true }).click();
  await page.getByRole('log').getByText('Agrega el costo', { exact: true }).waitFor();
  await send('Agrega la fecha');
  assert.equal(requests.length, beforeUnsupported, 'Adding a date column cannot silently omit the unavailable cost requested earlier');
  assert.equal(plans.at(-1).pending.request, 'Agrega el costo');
  assert.ok(plans.at(-1).context.selectedFields.includes('Procedure'), 'Discarding a manual draft does not discard the earlier context needed for a chat adjustment');
  assert.ok(plans.at(-1).history.some(item => item.role === 'user' && item.content === 'Agrega el costo'));
  await page.locator('.report-assistant__message--assistant').last().getByRole('button', { name: 'Continuar sin costo', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#report-assistant-message').disabled);
  assert.equal(plans.at(-1).message, 'Sin costo.');
  assert.equal(plans.at(-1).pending.request, 'Agrega el costo');
  assert.ok(plans.at(-1).pending.answers.includes('Agrega la fecha'), 'Explicitly omitting cost keeps the later requested date column in the pending draft');
  assert.equal(requests.length, beforeUnsupported + 1, 'The report executes only after explicit acceptance of the missing cost');
  assert.ok(requests.at(-1).selectedFields.includes('Start'), 'The date column requested during the clarification is applied after accepting the omission');
  assert.ok(requests.at(-1).selectedFields.includes('Procedure'));
  await page.getByRole('button', { name: 'Guardar reporte', exact: true }).click();
  await page.getByPlaceholder('Ej. Condiciones de convenios').fill('Cirugías conversadas');
  await page.getByRole('dialog', { name: 'Guardar reporte', exact: true }).getByRole('button', { name: 'Guardar reporte', exact: true }).click();
  await page.getByRole('dialog', { name: 'Guardar reporte', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(saved.at(-1).entity, 'vertical_surgeries');
  assert.deepEqual(saved.at(-1).selectedFields, requests.at(-1).selectedFields);
  assert.equal(saved.at(-1).filters.fechaDesde, '2026-09-01');
  assert.equal(saved.at(-1).filters.estatusDoc, 'MEDICAL_DISCHARGE');

  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 }); await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(350);
      const bounds = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(bounds.scroll <= bounds.width + 1, `${theme} ${width}px must not overflow`);
      await page.screenshot({ path: path.join(outputDir, `${theme}-${width}.png`), fullPage: true });
      if (width === 1440) await page.screenshot({ path: path.join(outputDir, `${theme}-preview.png`) });
    }
  }
  await page.getByRole('button', { name: 'Ajustar filtros y columnas', exact: true }).click();
  assert.equal(await page.getByRole('checkbox', { name: 'Procedimientos', exact: true }).isChecked(), true);
  assert.equal(await page.getByRole('checkbox', { name: 'Estado de cuenta', exact: true }).isChecked(), true);
  const stateSelect = page.getByLabel('Estado de cuenta o alta médica', { exact: true });
  assert.equal(await stateSelect.inputValue(), 'MEDICAL_DISCHARGE');
  assert.deepEqual(await stateSelect.locator('option').allTextContents(), catalog[1].statusOptions.map(option => option.label));
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await stateSelect.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      const bounds = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(bounds.scroll <= bounds.width + 1, `${theme} status configuration fits ${width}px`);
      await page.screenshot({ path: path.join(outputDir, `${theme}-status-${width}.png`) });
    }
  }
  await stateSelect.selectOption('NO_MEDICAL_DISCHARGE');
  await page.getByRole('button', { name: 'Buscar información', exact: true }).click();
  assert.equal(requests.at(-1).estatusDoc, 'NO_MEDICAL_DISCHARGE');
  await page.getByRole('button', { name: 'Crear con asistente', exact: true }).click();
  assert.ok(await page.getByRole('log').getByText('Agrega el procedimiento', { exact: true }).isVisible(), 'Switching to manual configuration preserves the conversation');

  executionError = true;
  await send('Cambia a este mes'); await page.locator('.report-assistant__error').waitFor();
  executionError = false;
  await page.getByRole('button', { name: 'Reintentar reporte', exact: true }).click();
  await page.getByRole('button', { name: 'Ver reporte', exact: true }).waitFor();
  assistantError = true; await send('Agrega la fecha');
  await page.locator('.report-assistant__error').waitFor(); assistantError = false;
  await page.getByRole('button', { name: 'Nueva conversación', exact: true }).click();
  assert.equal(await page.getByRole('log').getByText('Agrega el procedimiento', { exact: true }).count(), 0);
  assert.equal(await page.getByLabel('Reporte generado', { exact: true }).count(), 0, 'A new conversation clears the previous result');
  assert.equal(await page.getByRole('button', { name: 'Guardar reporte', exact: true }).isDisabled(), true);

  await send('kiero las sirujias del mes pasado pasiente doc fecha');
  assert.deepEqual(requests.at(-1).selectedFields, ['Patient', 'Doctor', 'Start']);
  await send('quita el doc y metele procedimiento');
  assert.deepEqual(requests.at(-1).selectedFields, ['Patient', 'Start', 'Procedure']);
  assert.deepEqual(await page.locator('thead th > div > div > span').allTextContents(), ['Paciente', 'Inicio', 'Procedimientos'], 'Rendered columns keep the requested order rather than catalogue order');
  const orderedDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Descargar Excel Oficial/ }).click();
  const orderedDownload = await orderedDownloadPromise;
  const orderedExcel = await fs.readFile(await orderedDownload.path(), 'utf8');
  assert.match(orderedExcel, /<th[^>]*>Paciente<\/th>\s*<th[^>]*>Inicio<\/th>\s*<th[^>]*>Procedimientos<\/th>/, 'Exported columns preserve the requested order');
  await send('ahora quiero lo que hay en farma con producto existencias y costo');
  const beforeChoice = requests.length;
  await page.getByRole('button', { name: 'Costo promedio', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Reporte generado', { exact: true }).count(), 0, 'A pending adjustment must not show the old report as its result');
  assert.equal(await page.getByRole('button', { name: 'Guardar reporte', exact: true }).isDisabled(), true);
  await page.setViewportSize({ width: 390, height: 1000 });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
    await page.waitForTimeout(350);
    const bounds = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(bounds.scroll <= bounds.width + 1, `${theme} clarification options must fit on mobile`);
    await page.screenshot({ path: path.join(outputDir, `${theme}-clarification-mobile.png`), fullPage: true });
  }
  await page.getByRole('button', { name: 'Costo promedio', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#report-assistant-message').disabled);
  assert.equal(requests.length, beforeChoice + 1, 'Ambiguous requests execute only after the user chooses');
  assert.equal(requests.at(-1).entity, 'inventory');
  assert.deepEqual(requests.at(-1).selectedFields, ['Name', 'Quantity', 'Cost']);
  assert.equal(requests.at(-1).almacen, 'FAR');
  assert.equal(requests.at(-1).fechaDesde, '', 'A new current-information topic discards the previous date filter');
  assert.ok(plans.at(-1).pending.request.includes('producto existencias y costo'), 'The clarification retains the original request');
  await page.getByRole('complementary', { name: 'Configuración del reporte conversado' }).getByText('Farmacia central', { exact: true }).waitFor();
  await send('nomas los que van en refri');
  assert.equal(requests.at(-1).clasificacionMedica, 'REFRI');
  assert.deepEqual(requests.at(-1).selectedFields, ['Name', 'Quantity', 'Cost']);
  await page.getByRole('complementary', { name: 'Configuración del reporte conversado' }).getByText('Refrigerados', { exact: true }).waitFor();
  await send('quita el filtro de farma');
  assert.equal(requests.at(-1).almacen, 'ALL');
  assert.equal(requests.at(-1).clasificacionMedica, 'REFRI');
  await send('buska Mediko SA y quitale costo');
  assert.equal(requests.at(-1).busqueda, 'Mediko SA');
  assert.deepEqual(requests.at(-1).selectedFields, ['Name', 'Quantity']);
  const beforeUnknown = requests.length;
  await send('solo con existencias mayor que 100');
  assert.equal(requests.length, beforeUnknown + 1, 'A supported numerical condition executes a new filtered analysis');
  assert.deepEqual(requests.at(-1).analysis.predicates, [{ field: 'Quantity', op: 'gt', value: '100' }]);
  await page.getByLabel('Análisis ejecutado', { exact: true }).getByText(/1 registros consultados; 0 cumplen las condiciones/).waitFor();
  await page.getByRole('button', { name: 'Nueva conversación', exact: true }).click();

  // Production regression: order names and their abbreviation must clarify the
  // origin while retaining the patient request and dates, instead of looping on
  // an unrecognized column or silently dropping the patient name.
  await page.setViewportSize({ width: 1440, height: 1000 });
  const salesOrderRequest = 'Necesito los pacientes con todas las órdenes de venta que tengan del 01/09/2026 al 30/09/2026';
  const beforeOrders = requests.length;
  assistantOutageNoticeOnce = true;
  await send(salesOrderRequest);
  assert.match(await page.locator('.report-assistant__notice').innerText(), /La conexión de IA no está disponible/);
  const latestMessage = () => page.locator('.report-assistant__message--assistant').last();
  for (const title of [catalog[2].title, catalog[3].title]) await latestMessage().getByRole('button', { name: title, exact: true }).waitFor();
  assert.equal(await latestMessage().getByRole('button', { name: catalog[4].title, exact: true }).count(), 0, 'All orders must use the complete summaries instead of the services-only report');
  assert.equal(requests.length, beforeOrders, 'Orders available from two origins must be chosen before execution');
  assert.doesNotMatch(await latestMessage().innerText(), /No pude identificar.*todas las ordenes de ventas? que tengan/i);
  assistantLocalWithKeyOnce = true;
  await send('Las OV');
  assert.equal(providerRequests, 0, 'A required order-source clarification does not contact the configured AI provider');
  assert.equal(await page.locator('.report-assistant__notice').count(), 0, 'A local source clarification with no notice clears the outage banner without losing pending state');
  assert.equal(await latestMessage().locator('.report-assistant__sender').innerText(), 'Guía de reportes');
  assert.equal(plans.at(-1).pending.request, salesOrderRequest, 'An abbreviation answer retains the original patient and date request');
  assert.ok(plans.at(-1).history.some(item => item.role === 'user' && item.content === salesOrderRequest));
  for (const title of [catalog[2].title, catalog[3].title]) await latestMessage().getByRole('button', { name: title, exact: true }).waitFor();
  assert.equal(await latestMessage().getByRole('button', { name: catalog[4].title, exact: true }).count(), 0);
  assert.equal(await page.getByRole('log').locator('.report-assistant__choices button').count(), 2, 'Only the latest clarification offers actions for the current pending request');
  assert.equal(requests.length, beforeOrders);
  await latestMessage().getByRole('button', { name: catalog[2].title, exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#report-assistant-message').disabled);
  assert.equal(requests.length, beforeOrders + 1, 'Choosing SAP executes the original report exactly once');
  assert.equal(plans.at(-1).message, `Quiero el reporte «${catalog[2].title}».`, 'The SAP choice sends the exact title in an ordinary report request');
  assert.equal(plans.at(-1).pending.request, salesOrderRequest);
  assert.ok(plans.at(-1).pending.answers.includes('Las OV'));
  assert.equal(requests.at(-1).entity, 'sales_order_summary');
  assert.ok(requests.at(-1).selectedFields.includes('PatientName'));
  assert.ok(requests.at(-1).selectedFields.includes('DocNum'));
  assert.equal(requests.at(-1).fechaDesde, '2026-09-01');
  assert.equal(requests.at(-1).fechaHasta, '2026-09-30');
  assert.equal(await page.getByRole('log').locator('.report-assistant__choices button').count(), 0, 'A completed report retires clarification actions from older replies');
  assert.equal(await page.getByRole('log').getByText(/El tema que necesito es/).count(), 0);
  await page.getByRole('log').getByText(`Quiero el reporte «${catalog[2].title}».`, { exact: true }).waitFor();
  assert.doesNotMatch(await latestMessage().innerText(), /No pude identificar|Continuar sin/i, 'Clicking SAP cannot reinterpret a catalog choice as an unknown column');
  await page.getByLabel('Reporte generado', { exact: true }).getByRole('cell', { name: 'Paciente de prueba OV', exact: true }).waitFor();
  await page.screenshot({ path: path.join(outputDir, 'ov-sap.png'), fullPage: true });
  await page.getByRole('button', { name: 'Nueva conversación', exact: true }).click();
  await send(salesOrderRequest);
  await latestMessage().getByRole('button', { name: catalog[3].title, exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#report-assistant-message').disabled);
  assert.equal(requests.length, beforeOrders + 2, 'Choosing Vertical executes that source exactly once');
  assert.equal(plans.at(-1).message, `Quiero el reporte «${catalog[3].title}».`, 'The Vertical choice sends the exact catalog title');
  assert.equal(plans.at(-1).pending.request, salesOrderRequest);
  assert.equal(requests.at(-1).entity, 'vertical_sales_orders');
  assert.ok(requests.at(-1).selectedFields.includes('PatientName'));
  assert.ok(requests.at(-1).selectedFields.includes('SONum'));
  assert.equal(requests.at(-1).fechaDesde, '2026-09-01');
  assert.equal(requests.at(-1).fechaHasta, '2026-09-30');
  assert.equal(await page.getByRole('log').locator('.report-assistant__choices button').count(), 0);
  await page.getByRole('log').getByText(`Quiero el reporte «${catalog[3].title}».`, { exact: true }).waitFor();
  assert.doesNotMatch(await latestMessage().innerText(), /No pude identificar|Continuar sin/i, 'Clicking Vertical cannot offer to omit the selected report title');
  await page.getByLabel('Reporte generado', { exact: true }).getByRole('cell', { name: 'Paciente de prueba OV', exact: true }).waitFor();
  await page.screenshot({ path: path.join(outputDir, 'ov-vertical.png'), fullPage: true });
  await page.getByRole('button', { name: 'Nueva conversación', exact: true }).click();
  await send(salesOrderRequest);
  await send('Ambas');
  assert.equal(requests.length, beforeOrders + 2, 'Both origins must explain separate reports before executing either source');
  assert.match(await latestMessage().innerText(), /SAP/);
  assert.match(await latestMessage().innerText(), /Vertical/);
  assert.match(await latestMessage().innerText(), /separad|por (?:cada )?fuente|un reporte.*otro/i);
  await page.getByRole('button', { name: 'Nueva conversación', exact: true }).click();

  // A chosen title is also replayed from pending.answers when the period comes
  // later. It must keep its role as a source selection throughout that replay.
  const salesOrderRequestWithoutDates = 'Necesito los pacientes con todas las órdenes de venta que tengan';
  for (const [entity, orderField] of [[catalog[2], 'DocNum'], [catalog[3], 'SONum']]) {
    const beforeDeferredPeriod = requests.length;
    const choiceMessage = `Quiero el reporte «${entity.title}».`;
    await send(salesOrderRequestWithoutDates);
    await latestMessage().getByRole('button', { name: entity.title, exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#report-assistant-message').disabled);
    assert.equal(plans.at(-1).message, choiceMessage);
    assert.equal(requests.length, beforeDeferredPeriod, 'Choosing a sales-order origin cannot query before its period is supplied');
    await latestMessage().getByText(/¿De qué período necesitas/).waitFor();
    assert.doesNotMatch(await latestMessage().innerText(), /No pude identificar|Continuar sin/i);
    if (entity.id === 'sales_order_summary') await page.screenshot({ path: path.join(outputDir, 'ov-sap-fechas-pendientes.png'), fullPage: true });
    await send('Del 01/09/2026 al 30/09/2026');
    assert.equal(plans.at(-1).pending.request, salesOrderRequestWithoutDates);
    assert.ok(plans.at(-1).pending.answers.includes(choiceMessage), 'The period answer carries the earlier source choice as pending history');
    assert.equal(requests.length, beforeDeferredPeriod + 1, 'The deferred period completes exactly one report for the chosen origin');
    assert.equal(requests.at(-1).entity, entity.id);
    assert.deepEqual(requests.at(-1).selectedFields, ['PatientName', orderField]);
    assert.equal(requests.at(-1).fechaDesde, '2026-09-01');
    assert.equal(requests.at(-1).fechaHasta, '2026-09-30');
    assert.doesNotMatch(await latestMessage().innerText(), /No pude identificar|Continuar sin/i, 'Replaying a source title must not turn it into an unknown column');
    assert.equal(await page.getByRole('log').locator('.report-assistant__choices button').count(), 0);
    await page.getByLabel('Reporte generado', { exact: true }).getByRole('cell', { name: 'Paciente de prueba OV', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Nueva conversación', exact: true }).click();
  }
  assert.equal(providerRequests, 0, 'Choosing an origin and supplying dates uses the local planner without an AI request');

  const partialRequest = 'Cirugías del 01/09/2026 al 30/09/2026 con paciente y código lunar';
  const beforePartialManual = requests.length;
  await send(partialRequest);
  await page.getByRole('button', { name: 'Elegir filtros y columnas', exact: true }).click();
  assert.equal(await page.getByRole('checkbox', { name: 'Paciente', exact: true }).isChecked(), true);
  assert.equal(await page.getByRole('checkbox', { name: 'Médicos registrados', exact: true }).isChecked(), false);
  assert.equal(await page.getByLabel('Fecha Desde', { exact: true }).inputValue(), '2026-09-01');
  assert.equal(await page.getByLabel('Fecha Hasta', { exact: true }).inputValue(), '2026-09-30');
  assert.equal(requests.length, beforePartialManual, 'The partial draft is copied without an automatic query');
  await page.getByRole('checkbox', { name: 'Médicos registrados', exact: true }).check();
  await page.getByRole('button', { name: 'Buscar información', exact: true }).click();
  await page.getByLabel('Reporte generado', { exact: true }).getByRole('cell', { name: 'Paciente de prueba', exact: true }).waitFor();
  assert.equal(requests.length, beforePartialManual + 1);
  assert.deepEqual(requests.at(-1).selectedFields, ['Patient', 'Doctor']);
  assert.equal(requests.at(-1).fechaDesde, '2026-09-01');
  assert.equal(requests.at(-1).fechaHasta, '2026-09-30');
  await page.getByRole('button', { name: 'Crear con asistente', exact: true }).click();
  await page.getByRole('log').getByText(partialRequest, { exact: true }).waitFor();
  await send('Sin código lunar');
  assert.equal(plans.at(-1).pending.request, partialRequest);
  assert.deepEqual(plans.at(-1).context.selectedFields, ['Patient'], 'Manual form edits do not replace the pending conversation draft');
  assert.equal(requests.length, beforePartialManual + 2);
  assert.deepEqual(requests.at(-1).selectedFields, ['Patient']);
  await page.getByRole('button', { name: 'Nueva conversación', exact: true }).click();

  for (const mode of ['missing-key', 'provider-outage']) {
    const unknownRequest = `Necesito un reporte zzzxyz ${mode}`;
    const beforeUnknownManual = requests.length;
    const beforeProviderOutage = providerRequests;
    if (mode === 'provider-outage') assistantLocalWithKeyOnce = true;
    await send(unknownRequest);
    assert.equal(requests.length, beforeUnknownManual);
    if (mode === 'provider-outage') assert.equal(providerRequests, beforeProviderOutage + 1, 'The synthetic outage uses a blocked provider call, never a real network request');
    await page.getByRole('button', { name: 'Prefiero elegir un tema', exact: true }).click();
    assert.equal(requests.length, beforeUnknownManual, 'Unknown requests open the authorized catalog without running a report');
    assert.equal(await page.locator('.report-builder__configuration-panel').count(), 0, 'An unknown request requires choosing a topic before a manual form is shown');
    assert.equal(await page.getByRole('button', { name: 'Buscar información', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Seleccionar módulo: Inventario por almacén', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Existencias', exact: true }).check();
    await page.getByRole('button', { name: 'Buscar información', exact: true }).click();
    await page.getByLabel('Reporte generado', { exact: true }).getByRole('cell', { name: 'Insumo de prueba', exact: true }).waitFor();
    assert.equal(requests.length, beforeUnknownManual + 1, `${mode} can finish a report by explicit manual selection`);
    assert.equal(requests.at(-1).entity, 'inventory');
    assert.deepEqual(requests.at(-1).selectedFields, ['Name', 'Quantity']);
    await page.getByRole('button', { name: 'Crear con asistente', exact: true }).click();
    await page.getByRole('log').getByText(unknownRequest, { exact: true }).waitFor();
    await send('Sigue sin quedar claro zzzxyz');
    assert.equal(requests.length, beforeUnknownManual + 1, 'Returning to an unresolved chat must not execute the manual form as its result');
    assert.equal(plans.at(-1).pending.request, unknownRequest);
    assert.ok(plans.at(-1).history.some(item => item.role === 'user' && item.content === unknownRequest));
    await page.getByRole('button', { name: 'Nueva conversación', exact: true }).click();
  }

  // Production regression: exact option labels with a percentage sibling
  // must resolve the pending column instead of repeating the same question.
  const commercialRequest = 'Necesito los acuerdos con descuentos, dedicibles, copagos y coaseguros';
  for (const [copayLabel, copayField, otherCopayField] of [['Copago del convenio', 'CopayAmount', 'CopayPercentage'], ['Copago del convenio (%)', 'CopayPercentage', 'CopayAmount']]) {
    const beforeCommercial = requests.length;
    const beforeCommercialProvider = providerRequests;
    await send(commercialRequest);
    await latestMessage().getByRole('button', { name: 'Descuento global registrado (%)', exact: true }).waitFor();
    assert.equal(requests.length, beforeCommercial, 'Commercial ambiguity must not query before the chosen fields are known');
    await latestMessage().getByRole('button', { name: 'Descuento global registrado (%)', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#report-assistant-message').disabled);
    await latestMessage().getByRole('button', { name: copayLabel, exact: true }).waitFor();
    assert.equal(plans.at(-1).message, 'Me refiero a «Descuento global registrado (%)».');
    assert.equal(plans.at(-1).pending.request, commercialRequest, 'An option click retains the exact original request including its typo');
    assert.equal(requests.length, beforeCommercial, 'Choosing the discount must still wait for the copay clarification');
    await latestMessage().getByRole('button', { name: copayLabel, exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#report-assistant-message').disabled);
    assert.equal(plans.at(-1).message, `Me refiero a «${copayLabel}».`, 'The UI sends the exact option message without removing the percentage symbol');
    assert.equal(plans.at(-1).pending.request, commercialRequest);
    assert.ok(plans.at(-1).pending.answers.includes('Me refiero a «Descuento global registrado (%)».'));
    assert.ok(plans.at(-1).context.selectedFields.includes('GlobalDiscount'), 'The next option carries the discount already chosen in the draft');
    assert.doesNotMatch(await latestMessage().innerText(), /Cuando dices «copagos»/i, 'An exact copay choice must not repeat the same clarification');
    await page.getByRole('button', { name: 'Ver reporte', exact: true }).waitFor();
    assert.equal(requests.length, beforeCommercial + 1, 'All commercial clarifications produce one report');
    assert.equal(requests.at(-1).entity, commercialAgreementsCapability.id);
    const requestedConceptFields = ['Deductible', 'DeductibleItemName', 'DefaultDeductible', copayField, `${copayField}ItemName`, `Default${copayField}`, 'Coinsurance', 'CoinsuranceItemName', 'CoinsurancePercentage', 'CoinsurancePercentageItemName', 'DefaultCoinsurancePercentage'];
    for (const field of ['AgreementCode', 'AgreementName', 'GlobalDiscount', ...requestedConceptFields]) assert.ok(requests.at(-1).selectedFields.includes(field), `The completed report retains ${field}`);
    await page.getByLabel('Reporte generado', { exact: true }).getByRole('cell', { name: 'CONV-01', exact: true }).waitFor();
    await page.getByLabel('Reporte generado', { exact: true }).getByRole('cell', { name: 'Acuerdo de prueba Vertical', exact: true }).waitFor();
    for (const field of ['Deductible', 'DeductibleItemName', copayField, `${copayField}ItemName`, 'Coinsurance', 'CoinsuranceItemName']) await page.getByLabel('Reporte generado', { exact: true }).getByRole('cell', { name: commercialTermsFixture[field], exact: true }).waitFor();
    for (const value of ['$1,500.00', copayField === 'CopayAmount' ? '$300.00' : '10.0%', '20.0%']) await page.getByLabel('Reporte generado', { exact: true }).getByRole('cell', { name: value, exact: true }).waitFor();
    await page.locator('thead').getByText(commercialAgreementsCapability.fields.find(field => field.key === `Default${copayField}`).label, { exact: true }).waitFor();
    const headerFits = await page.locator('thead th > div > div > span').evaluateAll(labels => labels.every(label => label.scrollWidth <= label.clientWidth + 1));
    assert.equal(headerFits, true, 'Long concept headers wrap within their own columns');
    assert.doesNotMatch(await page.getByLabel('Reporte generado', { exact: true }).innerText(), /NaN/);
    const commercialDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Descargar Excel Oficial/ }).click();
    const commercialDownload = await commercialDownloadPromise;
    const commercialExcel = await fs.readFile(await commercialDownload.path(), 'utf8');
    const exportedCommercialCells = await page.evaluate(html => [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('tr.even td, tr.odd td')].map(cell => cell.textContent), commercialExcel);
    for (const field of ['Deductible', copayField, 'Coinsurance']) assert.ok(exportedCommercialCells.includes(commercialTermsFixture[field]), `Excel preserves the original ${field} item code in full`);
    const exportedCodesAreText = await page.evaluate(({ html, code }) => [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('tr.even td, tr.odd td')].some(cell => cell.textContent === code && cell.hasAttribute('x:str')), { html: commercialExcel, code: commercialTermsFixture[copayField] });
    assert.equal(exportedCodesAreText, true, 'Excel item codes are explicitly retained as text');
    assert.doesNotMatch(commercialExcel, /NaN|<condición>/);
    assert.ok(!requests.at(-1).selectedFields.includes(otherCopayField), 'The exact amount/percentage choice cannot add its sibling implicitly');
    assert.equal(await page.getByRole('log').locator('.report-assistant__choices button').count(), 0, 'Completed clarifications retire the previous option buttons');
    assert.equal(providerRequests, beforeCommercialProvider, 'Known commercial clarification options resolve without an AI provider request');
    if (copayField === 'CopayAmount') await page.screenshot({ path: path.join(outputDir, 'copago-convenio-resuelto.png'), fullPage: true });
    await page.getByRole('button', { name: 'Nueva conversación', exact: true }).click();
  }

  const administrativeRequest = 'Acuerdos comerciales con cargos administrativos';
  const beforeAdministrative = requests.length;
  await send(administrativeRequest);
  await latestMessage().getByRole('button', { name: 'Cargo administrativo del convenio (%)', exact: true }).waitFor();
  assert.equal(requests.length, beforeAdministrative, 'An ambiguity-only column request cannot query default columns');
  await latestMessage().getByRole('button', { name: 'Cargo administrativo del convenio (%)', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#report-assistant-message').disabled);
  assert.equal(plans.at(-1).message, 'Me refiero a «Cargo administrativo del convenio (%)».');
  assert.equal(plans.at(-1).pending.request, administrativeRequest);
  await page.getByRole('button', { name: 'Ver reporte', exact: true }).waitFor();
  assert.equal(requests.length, beforeAdministrative + 1, 'The exact administrative percentage choice generates once');
  assert.equal(requests.at(-1).entity, commercialAgreementsCapability.id);
  assert.deepEqual([...requests.at(-1).selectedFields].sort(), ['AgreementCode', 'AgreementName', 'AdministrativeChargePercent'].sort(), 'An ambiguity-only request includes the chosen column and identity fields without defaults or sibling amount/description');
  await page.locator('thead').getByText('Cargo administrativo del convenio (%)', { exact: true }).waitFor();
  assert.equal(await page.getByRole('log').locator('.report-assistant__choices button').count(), 0);
  assert.doesNotMatch(await latestMessage().innerText(), /Cuando dices «cargos administrativos»/i);
  await page.screenshot({ path: path.join(outputDir, 'cargo-administrativo-porcentaje-resuelto.png'), fullPage: true });
  await page.getByRole('button', { name: 'Nueva conversación', exact: true }).click();

  // Legacy money/percent metadata can contain original clinical expressions.
  // The table and Excel must preserve these texts and format only finite numbers.
  await send(formattingRequest);
  await page.getByRole('button', { name: 'Ver reporte', exact: true }).waitFor();
  const expectedFormattingRows = [
    ['NUM', '$1,500.25', '10.0%', '2'],
    ['NUM-STRING', '$2,500.50', '12.5%', '3'],
    ['SCIENTIFIC', '$1,500.00', '12.0%', '-2'],
    ['TEXT', 'Sin deducible <condición> & cobertura', '10% ó 15% según cobertura', 'Consultar convenio'],
    ['EXPRESSION', '1 UMA + IVA; validar tabulador', 'Copago fijo > $500 & no incluye IVA', '=1+2'],
    ['FORMATTED-TEXT', '$2,500.50 MXN', '12,5% aprobado', 'Hasta 3 consultas'],
    ['NONCANONICAL', '0x10', '20% incluido', '1,000'],
    ['NULL', '-', '-', '-'], ['EMPTY', '-', '-', '-'], ['SPACE', '-', '-', '-'],
    ['ZERO', '$0.00', '0.0%', '0'],
    ['NONFINITE', '-', '-', '-'], ['NONFINITE-TEXT', '-', '-', '-'],
  ];
  const actualFormattingRows = await page.getByLabel('Reporte generado', { exact: true }).locator('tbody tr').evaluateAll(rows => rows.map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent)));
  assert.deepEqual(actualFormattingRows, expectedFormattingRows, 'The table formats canonical finite values, keeps expressions intact, distinguishes zero, and hides missing/nonfinite data');
  assert.doesNotMatch(await page.getByLabel('Reporte generado', { exact: true }).locator('tbody').innerText(), /NaN|Infinity/);
  const formattingDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Descargar Excel Oficial/ }).click();
  const formattingDownload = await formattingDownloadPromise;
  const formattingExcel = await fs.readFile(await formattingDownload.path(), 'utf8');
  const exportedFormattingRows = await page.evaluate(html => {
    const document = new DOMParser().parseFromString(html, 'text/html');
    return [...document.querySelectorAll('tr.even, tr.odd')].map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent));
  }, formattingExcel);
  const expectedFormattingExport = expectedFormattingRows.map(row => row.map((value, index) => index > 0 && value === '-' ? '' : value));
  assert.deepEqual(exportedFormattingRows, expectedFormattingExport, 'Excel keeps complete source text and the same finite numeric format, with blank cells for missing/nonfinite data');
  assert.match(formattingExcel, /&lt;condición&gt; &amp; cobertura/, 'Expression text is escaped in the HTML workbook without changing its content');
  const protectedExportText = await page.evaluate(html => {
    const cells = [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('tr.even td, tr.odd td')];
    return ['=1+2', '0x10', '20% incluido'].every(text => cells.some(cell => cell.textContent === text && cell.hasAttribute('x:str')));
  }, formattingExcel);
  assert.equal(protectedExportText, true, 'Formula-looking expressions and noncanonical numeric text remain text in Excel');
  assert.doesNotMatch(formattingExcel, /NaN|Infinity|<condición>/);
  await page.screenshot({ path: path.join(outputDir, 'condiciones-texto-numeros-sin-nan.png'), fullPage: true });
  await page.getByRole('button', { name: 'Nueva conversación', exact: true }).click();

  // Joined capabilities can execute and be adjusted/saved without becoming
  // another card or changing the source/category totals in the manual picker.
  const beforeHidden = requests.length;
  await send(hiddenRequest);
  assert.equal(requests.length, beforeHidden + 1);
  assert.equal(requests.at(-1).entity, hiddenCapability.id);
  assert.deepEqual(requests.at(-1).selectedFields, hiddenCapability.defaultFields);
  await page.getByRole('complementary', { name: 'Configuración del reporte conversado' }).getByText('SAP + Vertical', { exact: true }).waitFor();
  await page.getByLabel('Reporte generado', { exact: true }).getByText('Información de SAP + Vertical · 4 columnas visibles', { exact: true }).waitFor();
  assert.deepEqual(await page.locator('thead th > div > div > span').allTextContents(), ['Cuenta', 'Paciente', 'Acuerdo comercial', 'Cliente SAP']);
  const hiddenDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Descargar Excel Oficial/ }).click();
  const hiddenDownload = await hiddenDownloadPromise;
  const hiddenExcel = await fs.readFile(await hiddenDownload.path(), 'utf8');
  assert.match(hiddenExcel, /Reporte de SAP \+ Vertical/);
  assert.match(hiddenExcel, /Acuerdo de prueba Vertical/);
  assert.match(hiddenExcel, /Aseguradora de prueba/);
  await page.getByRole('button', { name: 'Guardar reporte', exact: true }).click();
  await page.getByPlaceholder('Ej. Condiciones de convenios').fill('Acuerdos conversados de prueba');
  await page.getByRole('dialog', { name: 'Guardar reporte', exact: true }).getByRole('checkbox', { name: /Contador de prueba/ }).check();
  await page.getByRole('dialog', { name: 'Guardar reporte', exact: true }).getByRole('button', { name: 'Guardar reporte', exact: true }).click();
  await page.getByRole('dialog', { name: 'Guardar reporte', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(saved.at(-1).entity, hiddenCapability.id);
  assert.deepEqual(assignmentRequests.at(-1), { id: saved.at(-1).id, userIds: [42] }, 'Save uses the stable ID inside the API saved response when assigning recipients');
  await page.getByRole('button', { name: 'Ajustar filtros y columnas', exact: true }).click();
  await page.locator('.report-builder__configuration-panel').getByText('Información de SAP + Vertical. Elige los filtros y las columnas que quieres incluir.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: `Seleccionar módulo: ${hiddenCapability.title}`, exact: true }).count(), 0);
  assert.equal(await page.locator('.report-catalog__card').count(), catalog.length);
  assert.equal(await page.locator('.report-catalog__count').innerText(), `${catalog.length} de ${catalog.length} módulos disponibles`);
  assert.equal(await page.getByRole('button', { name: 'SAP + Vertical (1)', exact: true }).count(), 0, 'Assistant-only sources do not become manual filter chips');
  await page.getByLabel('Buscar módulos o temas', { exact: true }).fill('acuerdos comerciales');
  assert.equal(await page.locator('.report-catalog__card').count(), 0, 'Manual search excludes assistant-only capabilities');
  assert.equal(await page.locator('.report-catalog__count').innerText(), `0 de ${catalog.length} módulos disponibles`);
  await page.getByLabel('Buscar módulos o temas', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Buscar información', exact: true }).click();
  await page.getByRole('button', { name: /Descargar Excel Oficial/ }).waitFor();
  await page.getByRole('checkbox', { name: 'Límite de crédito', exact: true }).check();
  assert.equal(await page.getByRole('button', { name: /Descargar Excel Oficial/ }).isDisabled(), true, 'Unqueried columns cannot be exported as empty source values');
  await page.getByRole('button', { name: 'Consultar los nuevos datos', exact: true }).waitFor();
  assert.equal(await page.locator('thead').getByText('Límite de crédito', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Buscar información', exact: true }).click();
  assert.equal(requests.at(-1).entity, hiddenCapability.id);
  assert.ok(requests.at(-1).selectedFields.includes('CreditLimit'));
  await page.locator('thead').getByText('Límite de crédito', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /Descargar Excel Oficial/ }).isDisabled(), false);
  await page.getByRole('button', { name: /Mis reportes/ }).click();
  await page.getByText(`Sección: ${hiddenCapability.title}`, { exact: true }).waitFor();
  await page.getByText('Acuerdos conversados de prueba', { exact: true }).click();
  assert.equal(await page.getByRole('checkbox', { name: 'Límite de crédito', exact: true }).isChecked(), false, 'An assistant-only saved template restores its authorized columns');

  // Assignment gives access to one saved configuration, without granting its
  // source modules. Two reports for the same entity retain separate definitions.
  const assignedAgreement = saved.at(-1);
  for (const label of ['Paciente', 'Acuerdo comercial', 'Cliente SAP']) await page.getByRole('checkbox', { name: label, exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'Límite de crédito', exact: true }).check();
  await page.getByRole('button', { name: 'Buscar información', exact: true }).click();
  await page.locator('thead').getByText('Límite de crédito', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Guardar reporte', exact: true }).click();
  const saveDialog = page.getByRole('dialog', { name: 'Guardar reporte', exact: true });
  await saveDialog.getByPlaceholder('Ej. Condiciones de convenios').fill('Crédito conversado de prueba');
  await saveDialog.getByLabel('Buscar personas', { exact: true }).fill('contabilidad');
  assert.equal(await saveDialog.getByRole('checkbox').count(), 1, 'Recipient search filters by department');
  await saveDialog.getByRole('checkbox', { name: /Contador de prueba/ }).check();
  await page.setViewportSize({ width: 390, height: 1000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true, 'Save report with the recipient selector fits a 390px screen');
  await page.screenshot({ path: path.join(outputDir, 'guardar-reporte-destinatarios-390.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  assignmentErrorOnce = true;
  await saveDialog.getByRole('button', { name: 'Guardar reporte', exact: true }).click();
  await saveDialog.waitFor({ state: 'hidden' });
  await page.getByText(/El reporte quedó guardado\. No se pudieron asignar sus accesos/).waitFor();
  const assignedCredit = saved.at(-1);
  assert.deepEqual(assignedCredit.selectedFields, ['AccountNumber', 'CreditLimit']);
  assert.deepEqual(assignedCredit.assignedUserIds, [], 'A failed assignment does not undo or duplicate the saved report');
  // Model a historical assignment where one recipient was later deactivated.
  assignedCredit.assignedUserIds.push(43, 44);
  await page.getByRole('button', { name: /Mis reportes/ }).click();
  const creditSavedRow = page.getByRole('article', { name: 'Reporte: Crédito conversado de prueba', exact: true });
  await creditSavedRow.getByText('Usuarios inactivos: Exusuario de prueba', { exact: true }).waitFor();
  assert.match(await creditSavedRow.innerText(), /Disponible para: Auditor de prueba\s+Usuarios inactivos: Exusuario de prueba/);
  await creditSavedRow.getByRole('button', { name: 'Administrar accesos', exact: true }).click();
  const accessDialog = page.getByRole('dialog', { name: 'Administrar accesos', exact: true });
  await accessDialog.getByText('Al guardar se retirarán las asignaciones de estas personas inactivas: Exusuario de prueba.', { exact: true }).waitFor();
  assert.equal(await accessDialog.getByRole('checkbox', { name: /Exusuario de prueba/ }).count(), 0, 'Inactive recipients cannot be reactivated from report assignment');
  assert.equal(await accessDialog.getByRole('checkbox', { name: /Auditor de prueba/ }).isChecked(), true, 'Existing active assignments remain selected');
  await accessDialog.getByRole('checkbox', { name: /Contador de prueba/ }).check();
  await accessDialog.getByRole('checkbox', { name: /Auditor de prueba/ }).check();
  await page.setViewportSize({ width: 390, height: 1000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true, 'Manage report access with search and selection fits a 390px screen');
  await page.screenshot({ path: path.join(outputDir, 'administrar-accesos-390.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await accessDialog.getByRole('button', { name: 'Guardar accesos', exact: true }).click();
  await accessDialog.waitFor({ state: 'hidden' });
  assert.deepEqual(assignedCredit.assignedUserIds, [43, 42]);
  assert.deepEqual(assignmentRequests.at(-1), { id: assignedCredit.id, userIds: [43, 42] }, 'Saving removes the invisible inactive ID and preserves the active recipient plus new selection');
  assert.equal(await creditSavedRow.getByText('Usuarios inactivos: Exusuario de prueba', { exact: true }).count(), 0);
  await creditSavedRow.getByText('Disponible para: Contador de prueba, Auditor de prueba', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(outputDir, 'mis-reportes-administracion.png'), fullPage: true });
  await page.getByRole('dialog', { name: 'Mis reportes', exact: true }).getByRole('button', { name: 'Cerrar', exact: true }).click();

  user = { id: 42, username: 'contador-prueba', role: 'JEFE_AREA', permisos: [] };
  await page.reload();
  await page.getByRole('heading', { name: 'Mis reportes', exact: true, level: 1 }).waitFor();
  await page.getByRole('button', { name: /Mis reportes/ }).click();
  const myReportsDialog = page.getByRole('dialog', { name: 'Mis reportes', exact: true });
  await myReportsDialog.getByRole('article', { name: 'Reporte: Acuerdos conversados de prueba', exact: true }).waitFor();
  assert.equal(await myReportsDialog.getByRole('article').count(), 2, 'Recipients see only reports assigned to them');
  assert.equal(await myReportsDialog.getByRole('button', { name: 'Administrar accesos', exact: true }).count(), 0);
  assert.equal(await myReportsDialog.getByRole('button', { name: 'Eliminar reporte', exact: true }).count(), 0);
  assert.equal(await myReportsDialog.getByRole('button', { name: 'Ajustar una copia', exact: true }).count(), 0);
  await myReportsDialog.getByRole('article', { name: 'Reporte: Acuerdos conversados de prueba', exact: true }).getByRole('button', { name: 'Ver reporte', exact: true }).click();
  await page.getByLabel('Reporte generado', { exact: true }).getByRole('cell', { name: 'Acuerdo de prueba Vertical', exact: true }).waitFor();
  assert.deepEqual(requests.at(-1), { savedQueryId: assignedAgreement.id }, 'Assigned execution sends only the report ID without source, dates, filters or field overrides');
  assert.deepEqual(await page.locator('thead th > div > div > span').allTextContents(), ['Cuenta', 'Paciente', 'Acuerdo comercial', 'Cliente SAP']);
  assert.equal(await page.getByRole('checkbox').count(), 0, 'An assigned report has no field editing controls');
  assert.equal(await page.getByRole('button', { name: 'Guardar reporte', exact: true }).isDisabled(), true);
  assert.equal(await page.getByLabel('Fecha Desde', { exact: true }).count(), 0);
  await page.getByRole('button', { name: /Mis reportes/ }).click();
  await myReportsDialog.getByRole('article', { name: 'Reporte: Crédito conversado de prueba', exact: true }).getByRole('button', { name: 'Ver reporte', exact: true }).click();
  await page.getByLabel('Reporte generado', { exact: true }).getByRole('cell', { name: '$9,000.00', exact: true }).waitFor();
  assert.deepEqual(requests.at(-1), { savedQueryId: assignedCredit.id });
  assert.deepEqual(await page.locator('thead th > div > div > span').allTextContents(), ['Cuenta', 'Límite de crédito'], 'The second saved definition does not merge fields from the first report with the same entity');
  await page.getByRole('button', { name: 'Actualizar reporte', exact: true }).click();
  await page.getByRole('button', { name: 'Actualizar reporte', exact: true }).waitFor();
  assert.deepEqual(requests.at(-1), { savedQueryId: assignedCredit.id });
  const assignedDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Descargar Excel Oficial/ }).click();
  const assignedDownload = await assignedDownloadPromise;
  const assignedExcel = await fs.readFile(await assignedDownload.path(), 'utf8');
  assert.match(assignedExcel, /Límite de crédito/);
  assert.doesNotMatch(assignedExcel, /Paciente de prueba OV|Aseguradora de prueba|Acuerdo de prueba Vertical/, 'The recipient export contains only the saved columns');
  await page.screenshot({ path: path.join(outputDir, 'mis-reportes-asignado.png'), fullPage: true });
  assert.equal(await page.getByRole('button', { name: 'Elegir un tema', exact: true }).count(), 0, 'Saved-only recipients do not see the source topic editor');
  assert.equal(await page.locator('.report-catalog__card').count(), 0, 'Assignment does not grant source module cards');

  user = { id: 1, username: 'amendoza', role: 'ADMIN', permisos: [] };
  await page.reload();
  await page.getByRole('button', { name: /Mis reportes/ }).click();
  await page.getByRole('article', { name: 'Reporte: Crédito conversado de prueba', exact: true }).getByRole('button', { name: 'Administrar accesos', exact: true }).click();
  assert.equal(await accessDialog.getByRole('checkbox', { name: /Contador de prueba/ }).isChecked(), true);
  await accessDialog.getByRole('checkbox', { name: /Contador de prueba/ }).uncheck();
  await accessDialog.getByRole('button', { name: 'Guardar accesos', exact: true }).click();
  await accessDialog.waitFor({ state: 'hidden' });
  assert.deepEqual(assignedCredit.assignedUserIds, [43], 'Replacing assignment recipients can revoke one person while retaining another');
  user = { id: 42, username: 'contador-prueba', role: 'JEFE_AREA', permisos: [] };
  await page.reload();
  await page.getByRole('button', { name: /Mis reportes/ }).click();
  await myReportsDialog.getByRole('article', { name: 'Reporte: Acuerdos conversados de prueba', exact: true }).waitFor();
  assert.equal(await myReportsDialog.getByRole('article', { name: 'Reporte: Crédito conversado de prueba', exact: true }).count(), 0, 'A revoked report disappears from Mis reportes');
  user = { id: 1, username: 'amendoza', role: 'ADMIN', permisos: [] };
  await page.reload(); await page.waitForFunction(() => !document.querySelector('#report-assistant-message')?.disabled);
  await page.getByRole('button', { name: 'Crear con asistente', exact: true }).click();
  user = { username: 'joined-reader', role: 'JEFE_AREA', permisos: hiddenCapability.requiredPermissions.map(moduleId => `sap-query-${moduleId}`) };
  await page.reload(); await page.waitForFunction(() => !document.querySelector('#report-assistant-message')?.disabled);
  await send(hiddenRequest);
  assert.equal(requests.at(-1).entity, hiddenCapability.id, 'All component permissions grant the hidden capability without a separate capability permission');
  const beforeMissingJoinPermission = requests.length;
  user.permisos = user.permisos.slice(0, 1);
  await page.evaluate(async () => { const result = await window.__refreshAssistantTestUser(); if (!result.ok) throw new Error('Synthetic auth refresh failed'); });
  await page.waitForFunction(() => document.querySelector('.report-assistant__reset')?.disabled);
  assert.equal(await page.getByLabel('Reporte generado', { exact: true }).count(), 0, 'Revoking one required source permission clears the joined result');
  await send(hiddenRequest);
  assert.equal(requests.length, beforeMissingJoinPermission, 'A partial set of required source permissions cannot generate a joined report');
  user = { username: 'amendoza', role: 'ADMIN', permisos: [] };
  await page.reload(); await page.waitForFunction(() => !document.querySelector('#report-assistant-message')?.disabled);

  // Exercise the real in-memory backend analysis engine over synthetic invoices.
  // The browser must retain source fields while displaying calculated aliases.
  const beforeAnalysis = requests.length;
  await send(analysisRequest);
  await latestMessage().getByRole('button', { name: 'De mayor a menor', exact: true }).waitFor();
  await page.getByLabel('Análisis solicitado', { exact: true }).getByText('Socio de negocios', { exact: true }).waitFor();
  assert.equal(requests.length, beforeAnalysis, 'An unresolved ordering choice does not execute the analysis');
  await latestMessage().getByRole('button', { name: 'De mayor a menor', exact: true }).click();
  await page.getByRole('button', { name: 'Ver reporte', exact: true }).waitFor();
  assert.deepEqual(plans.at(-1).context.analysis.groupBy, ['CardName']);
  assert.deepEqual(plans.at(-1).context.analysis.measures, financialAnalysis.measures);
  assert.equal(plans.at(-1).pending.request, analysisRequest);
  assert.equal(requests.length, beforeAnalysis + 1);
  assert.deepEqual(requests.at(-1).analysis, financialAnalysis);
  assert.deepEqual(requests.at(-1).selectedFields, analysisCapability.defaultFields, 'Calculated output aliases are never sent as authorized source fields');
  const analysisReport = page.getByLabel('Reporte generado', { exact: true });
  const analysisOutput = applyAnalysis(analysisCapability, { data: analysisRows, truncated: false }, financialAnalysis, { selectedFields: analysisCapability.defaultFields });
  assert.deepEqual(await analysisReport.locator('thead th > div > div > span').allTextContents(), analysisOutput.columnas.map(column => column.label));
  assert.deepEqual(await analysisReport.locator('tbody tr').first().locator('td').allTextContents(), ['Socio de prueba 120', '$269.00', '2']);
  assert.equal(await analysisReport.locator('tbody tr').count(), 100);
  await analysisReport.getByLabel('Análisis ejecutado', { exact: true }).getByText(/242 registros consultados; 240 cumplen las condiciones/).waitFor();
  await analysisReport.getByText('Mostrando 1 a 100 de 120 grupos', { exact: true }).waitFor();
  await analysisReport.getByRole('button', { name: 'Siguiente', exact: true }).click();
  assert.equal(await analysisReport.locator('tbody tr').count(), 20);
  const analysisDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Descargar Excel Oficial/ }).click();
  const analysisDownload = await analysisDownloadPromise;
  const analysisExcel = await fs.readFile(await analysisDownload.path(), 'utf8');
  const exportedAnalysis = await page.evaluate(html => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return [...doc.querySelectorAll('tr.even, tr.odd')].map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent));
  }, analysisExcel);
  assert.equal(exportedAnalysis.length, 120, 'Excel exports every returned group rather than only the current page');
  assert.deepEqual(exportedAnalysis[0], ['Socio de prueba 120', '$269.00', '2']);
  assert.deepEqual(exportedAnalysis.at(-1), ['Socio de prueba 001', '$150.00', '2']);
  assert.match(analysisExcel, /Una fila por combinación de Socio de negocios/);
  assert.doesNotMatch(analysisExcel, /Una fila por factura de prueba/);
  assert.match(analysisExcel, /Agrupado por: Socio de negocios/);
  assert.match(analysisExcel, /Total del reporte · Registros que cumplen los filtros: 240/);
  await send(analysisAdjustment);
  await page.getByRole('button', { name: 'Ver reporte', exact: true }).waitFor();
  assert.deepEqual(plans.at(-1).context.analysis, financialAnalysis, 'A follow-up keeps the complete prior analysis in conversation context');
  assert.equal(requests.at(-1).analysis.orderBy[0].direction, 'asc');
  assert.deepEqual(await analysisReport.locator('tbody tr').first().locator('td').allTextContents(), ['Socio de prueba 001', '$150.00', '2']);
  const ascendingAnalysis = requests.at(-1).analysis;
  await page.getByRole('button', { name: 'Ajustar filtros y columnas', exact: true }).click();
  await page.getByLabel('Análisis configurado', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Buscar información', exact: true }).click();
  await waitForExportEnabled();
  assert.deepEqual(requests.at(-1).analysis, ascendingAnalysis, 'Manual continuation preserves the analysis until explicitly removed');
  assert.equal(await page.getByRole('button', { name: /Descargar Excel Oficial/ }).isDisabled(), false);
  await page.getByRole('button', { name: 'Guardar reporte', exact: true }).click();
  const saveAnalysisDialog = page.getByRole('dialog', { name: 'Guardar reporte', exact: true });
  await saveAnalysisDialog.getByPlaceholder('Ej. Condiciones de convenios').fill('Análisis financiero de prueba');
  await saveAnalysisDialog.getByRole('checkbox', { name: /Contador de prueba/ }).check();
  await saveAnalysisDialog.getByRole('button', { name: 'Guardar reporte', exact: true }).click();
  await saveAnalysisDialog.waitFor({ state: 'hidden' });
  const savedAnalysis = saved.at(-1);
  assert.deepEqual(savedAnalysis.filters.analysis, ascendingAnalysis, 'Saved reports persist the exact canonical analysis under filters.analysis');
  await page.getByRole('button', { name: /Mis reportes/ }).click();
  await page.getByRole('article', { name: 'Reporte: Análisis financiero de prueba', exact: true }).getByRole('button', { name: 'Ajustar una copia', exact: true }).click();
  await page.getByLabel('Análisis configurado', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Buscar información', exact: true }).click();
  await waitForExportEnabled();
  assert.deepEqual(requests.at(-1).analysis, ascendingAnalysis, 'Loading a copy retains its saved conditions, grouping, measures and order');
  await page.getByRole('checkbox', { name: 'Estado de factura', exact: true }).check();
  assert.equal(await page.getByRole('button', { name: /Descargar Excel Oficial/ }).isDisabled(), true, 'Changing analytical configuration blocks the prior Excel until a new query');
  await page.getByRole('button', { name: 'Buscar información', exact: true }).click();
  await waitForExportEnabled();
  assert.equal(await page.getByRole('button', { name: /Descargar Excel Oficial/ }).isDisabled(), false);
  executionError = true;
  await page.getByRole('button', { name: 'Buscar información', exact: true }).click();
  await page.getByRole('alert').getByText('No se pudo consultar la información. Intenta de nuevo.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /Descargar Excel Oficial/ }).isDisabled(), true, 'A failed recalculation cannot export the previous successful analysis');
  executionError = false;
  analysisSourceTruncated = true;
  await page.getByRole('button', { name: 'Buscar información', exact: true }).click();
  await page.getByRole('alert').getByText(/fuente supera el alcance de una consulta completa/).waitFor();
  assert.equal(await page.getByRole('button', { name: /Descargar Excel Oficial/ }).isDisabled(), true, 'A truncated source cannot produce or export new totals');
  analysisSourceTruncated = false;
  analysisOutputLimit = 105;
  await page.getByRole('button', { name: 'Buscar información', exact: true }).click();
  await analysisReport.getByText(/Se muestran 105 de 120 grupos por el límite de salida/).waitFor();
  assert.equal(await page.getByRole('button', { name: /Descargar Excel Oficial/ }).isDisabled(), false, 'Complete source analysis remains valid when only its output groups are limited');
  const limitedAnalysisDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Descargar Excel Oficial/ }).click();
  const limitedAnalysisDownload = await limitedAnalysisDownloadPromise;
  const limitedAnalysisExcel = await fs.readFile(await limitedAnalysisDownload.path(), 'utf8');
  assert.equal(await page.evaluate(html => new DOMParser().parseFromString(html, 'text/html').querySelectorAll('tr.even, tr.odd').length, limitedAnalysisExcel), 105);
  assert.match(limitedAnalysisExcel, /Se muestran 105 de 120 grupos por el límite de salida/);
  analysisOutputLimit = 10000;
  await page.getByRole('button', { name: 'Quitar análisis', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: /Descargar Excel Oficial/ }).isDisabled(), true);
  await page.getByRole('button', { name: 'Buscar información', exact: true }).click();
  await waitForExportEnabled();
  assert.equal(requests.at(-1).analysis, undefined, 'Removing the analysis explicitly returns to the source detail report');
  assert.deepEqual(await analysisReport.locator('thead th > div > div > span').allTextContents(), ['Identificador de factura', 'Socio de negocios', 'Importe de factura', 'Estado de factura']);

  user = { id: 42, username: 'contador-prueba', role: 'JEFE_AREA', permisos: [] };
  await page.reload();
  await page.getByRole('heading', { name: 'Mis reportes', level: 1, exact: true }).waitFor();
  await page.getByRole('button', { name: /Mis reportes/ }).click();
  await page.getByRole('article', { name: 'Reporte: Análisis financiero de prueba', exact: true }).getByRole('button', { name: 'Ver reporte', exact: true }).click();
  await analysisReport.getByRole('cell', { name: 'Socio de prueba 001', exact: true }).waitFor();
  assert.deepEqual(requests.at(-1), { savedQueryId: savedAnalysis.id }, 'Assigned analytics execute only by saved report ID with no analytical overrides');
  assert.equal(await page.getByRole('button', { name: 'Quitar análisis', exact: true }).count(), 0);
  await page.getByLabel('Análisis guardado', { exact: true }).waitFor();
  assert.deepEqual(await analysisReport.locator('thead th > div > div > span').allTextContents(), analysisOutput.columnas.map(column => column.label));
  await page.evaluate(() => document.querySelector('[aria-label="Análisis ejecutado"]').scrollIntoView());
  await page.screenshot({ path: path.join(outputDir, 'analisis-financiero-asignado.png') });
  for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
    await page.waitForTimeout(350);
    assert.equal(await page.locator('.report-builder').evaluate(element => getComputedStyle(element).getPropertyValue('--report-surface').trim()), theme === 'dark' ? '#142135' : '#fff');
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(dimensions.scroll <= dimensions.width + 1, `${theme} analytical totals and assigned configuration must fit on mobile`);
    await page.screenshot({ path: path.join(outputDir, `analisis-financiero-asignado-390-${theme}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  user = { id: 1, username: 'amendoza', role: 'ADMIN', permisos: [] };
  await page.reload(); await page.waitForFunction(() => !document.querySelector('#report-assistant-message')?.disabled);

  const beforeExact = requests.length;
  await send(exactRequest);
  await page.getByRole('button', { name: 'Ver reporte', exact: true }).waitFor();
  assert.equal(requests.length, beforeExact + 1, 'An authorized exact account query runs without a date range');
  assert.equal(requests.at(-1).fechaDesde, ''); assert.equal(requests.at(-1).fechaHasta, '');
  await page.getByRole('complementary', { name: 'Configuración del reporte conversado' }).getByText('Consulta exacta sin período', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Ajustar filtros y columnas', exact: true }).click();
  await page.getByRole('button', { name: 'Buscar información', exact: true }).click();
  await waitForExportEnabled();
  await page.getByLabel('Fecha Desde', { exact: true }).fill('2026-09-01');
  await page.getByRole('button', { name: 'Buscar información', exact: true }).click();
  await page.getByRole('alert').getByText(/Elige las fechas de inicio y fin/).waitFor();
  assert.equal(requests.length, beforeExact + 2, 'An exact lookup does not bypass validation when only one date is supplied');
  assert.equal(await page.getByRole('button', { name: /Descargar Excel Oficial/ }).isDisabled(), true);
  await page.getByLabel('Fecha Desde', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Buscar información', exact: true }).click();
  await waitForExportEnabled();
  assert.equal(requests.length, beforeExact + 3);
  await analysisReport.getByText(/Consulta de cuenta\/paciente por identificador/).waitFor();
  const exactDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Descargar Excel Oficial/ }).click();
  const exactDownload = await exactDownloadPromise;
  const exactExcel = await fs.readFile(await exactDownload.path(), 'utf8');
  assert.match(exactExcel, /Consulta de cuenta\/paciente por identificador/);
  assert.doesNotMatch(exactExcel, /Período:  al |Período: - al -/);
  await page.getByRole('button', { name: 'Crear con asistente', exact: true }).click();
  await send(canonicalCurrencyRequest);
  await page.getByRole('button', { name: 'Ver reporte', exact: true }).waitFor();
  await page.getByLabel('Análisis solicitado', { exact: true }).getByText('Paciente · Moneda', { exact: true }).waitFor();
  assert.deepEqual(await analysisReport.locator('thead th > div > div > span').allTextContents(), ['Paciente', 'Moneda', 'Total de Importe facturado SAP (Moneda de facturas SAP)']);
  assert.deepEqual(await analysisReport.locator('tbody tr').first().locator('td').allTextContents(), ['Paciente de prueba OV', 'USD', '$120.00']);
  await send(canonicalCurrencyFollowup);
  await page.getByRole('button', { name: 'Ver reporte', exact: true }).waitFor();
  assert.deepEqual(plans.at(-1).context.analysis.groupBy, ['PatientName', 'Currency'], 'The next conversation turn uses the backend canonical currency grouping');

  await send('Cirugías con paciente y médico');
  const beforeRevokedDraft = requests.length;
  user = { username: 'limited', role: 'JEFE_AREA', permisos: ['sap-query-inventory'] };
  await page.evaluate(async () => { const result = await window.__refreshAssistantTestUser(); if (!result.ok) throw new Error('Synthetic auth refresh failed'); });
  await page.getByRole('button', { name: 'Prefiero elegir un tema', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Prefiero elegir un tema', exact: true }).click();
  assert.equal(await page.locator('.report-builder__configuration-panel').count(), 0, 'A revoked partial draft cannot keep a manual form selected');
  assert.equal(await page.getByRole('button', { name: 'Seleccionar módulo: Cirugías y uso de quirófano', exact: true }).count(), 0, 'A revoked topic is absent from manual continuation');
  assert.equal(await page.getByRole('button', { name: 'Seleccionar módulo: Inventario por almacén', exact: true }).count(), 1);
  assert.equal(requests.length, beforeRevokedDraft, 'Revoking access discards a partial draft without querying it');

  user = { username: 'limited', role: 'JEFE_AREA', permisos: ['sap-query-inventory'] };
  await page.reload(); await page.waitForFunction(() => !document.querySelector('#report-assistant-message')?.disabled);
  const beforeRestricted = requests.length; await send('Cirugías con paciente y médico');
  assert.equal(requests.length, beforeRestricted, 'Restricted users cannot generate an unauthorized report');
  await send('Inventario por almacén'); await page.getByRole('button', { name: 'Ver reporte', exact: true }).waitFor();
  assert.equal(requests.at(-1).entity, 'inventory');
  await page.getByRole('button', { name: 'Nueva conversación', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'light'); window.scrollTo(0, 0); });
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(outputDir, 'inicio.png') });
  assert.deepEqual(errors, []);
  console.log('PASS: informal topics/columns/filters, clarification/context/pending, commercial concepts/defaults and numeric/text formatting, hidden SAP + Vertical resources and source permissions, saved reports/assignments/inactive recipients, analytical conditions/grouping/sums/distinct/order with canonical currency grouping, 120 groups/pagination/full Excel, saved/copied/assigned analysis, changed/failed/truncated-source export blocking, complete limited output, exact lookup without dates and partial-date validation, errors/retry and light/dark at 390–1440 px.');
} catch (error) {
  if (page) { await page.screenshot({ path: path.join(outputDir, 'failure.png'), fullPage: true }); console.error(await page.locator('body').innerText()); }
  throw error;
} finally { await browser?.close(); await server.close(); }
