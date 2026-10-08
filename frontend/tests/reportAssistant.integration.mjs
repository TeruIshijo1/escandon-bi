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
let user = { username: 'amendoza', role: 'ADMIN', permisos: [] };
let assistantError = false;
let assistantOutageNoticeOnce = false;
let assistantLocalWithKeyOnce = false;
let providerRequests = 0;
let executionError = false;
const requests = [];
const plans = [];
const saved = [];
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
    if (pathname.endsWith('/sap-query/catalog')) return route.fulfill({ json: { ok: true, catalog: allowed } });
    if (pathname.endsWith('/sap-query/saved')) { if (route.request().method() === 'POST') saved.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true, queries: [] } }); }
    if (pathname.endsWith('/sap-query/assistant')) {
      const body = route.request().postDataJSON(); plans.push(body);
      if (assistantError) return route.fulfill({ status: 503, json: { ok: false, error: 'No pude preparar el reporte en este momento.' } });
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
        result = await prepareReport({ ...body, catalog: allowed, now: new Date('2026-10-01T15:00:00Z'), fetchImpl: async () => { providerRequests += 1; throw new Error('Network access is blocked in this synthetic UI test'); } });
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
      const body = route.request().postDataJSON(); requests.push(body);
      if (executionError) return route.fulfill({ status: 503, json: { ok: false, error: 'No se pudo consultar la información. Intenta de nuevo.' } });
      const entity = allowed.find(entity => entity.id === body.entity);
      assert.ok(entity, 'Assistant cannot execute a module without permission');
      const record = { Patient: 'Paciente de prueba', Doctor: 'Médico de prueba', Procedure: 'Procedimiento de prueba', Start: '2026-09-15T10:00:00', State: body.estatusDoc === 'OPEN' ? 'Abierta' : body.estatusDoc === 'CANCELED' ? 'Cancelada' : 'Cerrada', Discharged: body.estatusDoc === 'NO_MEDICAL_DISCHARGE' ? 'No' : 'Sí', DischargeDate: '2026-09-16T11:00:00', ClosedDate: '2026-09-17T09:00:00', Name: 'Insumo de prueba', Quantity: 12, Cost: 50, PatientName: 'Paciente de prueba OV', DocNum: 3101, DocDate: '2026-09-15', CardName: 'Aseguradora de prueba', SONum: 7101, SOLNNum: 1, CreatedOn: '2026-09-15T10:00:00', PTNum: 2101, PCNum: 6101 };
      const row = Object.fromEntries(body.selectedFields.map(key => [key, record[key]]));
      return route.fulfill({ json: { ok: true, entityTitle: entity.title, data: body.busqueda === 'sin resultados' ? [] : [row], truncated: false } });
    }
    return route.fulfill({ json: { ok: true, data: [] } });
  });
  await page.goto(`${server.resolvedUrls.local[0]}__assistant`);
  const input = page.getByLabel('¿Qué información necesitas?', { exact: true });
  const send = async text => { await input.fill(text); await page.getByRole('button', { name: 'Enviar solicitud', exact: true }).click(); await page.getByRole('button', { name: 'Enviar solicitud', exact: true }).waitFor(); };
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
  await page.getByRole('button', { name: 'Guardar consulta', exact: true }).click();
  await page.getByPlaceholder('ej. Insumos con Caducidad Próxima de Quirófano').fill('Cirugías conversadas');
  await page.getByRole('button', { name: 'Guardar Plantilla', exact: true }).click();
  await page.waitForFunction(() => !document.body.textContent.includes('Guardar Plantilla de Consulta'));
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
  assert.equal(await page.getByRole('button', { name: 'Guardar consulta', exact: true }).isDisabled(), true);

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
  assert.equal(await page.getByRole('button', { name: 'Guardar consulta', exact: true }).isDisabled(), true);
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
  assert.equal(requests.length, beforeUnknown, 'An unavailable condition cannot execute the previous report');
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
  console.log('PASS: informal topics/columns/filters, misspellings, mixed changes, order origins/OV clarification without loops or dropped patient requests, cleared local-guided notices, manual continuation of partial/unknown requests without auto-execution, preserved context/pending, revoked access, exact execution/export, errors/retry, permissions and light/dark at 390–1440 px.');
} catch (error) {
  if (page) { await page.screenshot({ path: path.join(outputDir, 'failure.png'), fullPage: true }); console.error(await page.locator('body').innerText()); }
  throw error;
} finally { await browser?.close(); await server.close(); }
