import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

// All API responses and report records in this test are synthetic.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.resolve(root, '../tmp/aria-copilot');
await fs.mkdir(outputDir, { recursive: true });
const server = await createServer({ configFile: false, root, cacheDir: path.join(outputDir, 'vite-cache'), appType: 'custom', plugins: [react(), {
  name: 'aria-copilot-preview', configureServer(vite) {
    vite.middlewares.use('/__aria', async (_req, res) => {
      const html = await vite.transformIndexHtml('/__aria', `<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body style="margin:0"><div id="root"></div><script type="module">
        import React from 'react'; import { createRoot } from 'react-dom/client'; import Aria from '/src/components/aria/AriaCopilotWidget.jsx';
        createRoot(document.getElementById('root')).render(React.createElement(Aria));
      </script></body></html>`);
      res.setHeader('Content-Type', 'text/html'); res.end(html);
    });
  },
}], server: { host: '127.0.0.1', port: 0, hmr: false } });

const filters = { fechaDesde: '', fechaHasta: '', almacen: 'ALL', estatusDoc: 'ALL', clasificacionMedica: 'ALL', busqueda: '' };
const draft = { entity: 'vertical_surgeries', entityTitle: 'Cirugías', source: 'Vertical', selectedFields: ['Patient'], fieldLabels: ['Paciente'], requiresDateFilter: true, filters, appliedFilters: [] };
const readyPlan = { ...draft, filters: { ...filters, fechaDesde: '2026-09-01', fechaHasta: '2026-09-30' } };
const pending = { request: 'Cirugías con paciente', answers: [] };
const response = (answer, report, extras = {}) => ({ success: true, data: { topic: 'report', answer, kpis: [], engine: 'guided', report, ...extras } });
const ready = (plan = readyPlan, count = 23) => response(`Tu reporte está listo con ${count} registros.`, { status: 'ready', plan, choices: [], pending: null, rowCount: count, limited: false }, {
  kpis: [{ label: 'Registros encontrados', value: count }], table: { headers: plan.fieldLabels, rows: Array.from({ length: count }, (_, index) => plan.selectedFields.map(field => field === 'Patient' ? `Paciente sintético reservado ${index}` : 'Médico sintético reservado')) },
});
const requests = [];
const delayed = new Map();
let failConnection = false;
let failReport = false;
let browser, page;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => sessionStorage.setItem('escandon_token', 'synthetic-aria-test'));
  await page.route('**/api/aria/**', async route => {
    if (new URL(route.request().url()).pathname.endsWith('/suggestions')) return route.fulfill({ json: { success: true, suggestions: ['Cirugías con paciente'] } });
    const body = route.request().postDataJSON(); requests.push(body);
    if (body.context) assert.deepEqual(Object.keys(body.context).sort(), [...['entity', 'filters', 'selectedFields'], ...(body.context.analysis ? ['analysis'] : [])].sort(), 'The API receives only its accepted context keys, without public display metadata');
    if (body.query.startsWith('Consulta lenta')) { delayed.set(body.query, route); return; }
    if (failConnection) { failConnection = false; return route.abort('failed'); }
    if (failReport) { failReport = false; return route.fulfill({ json: response('Conservé tu configuración. No pude consultar los registros; puedes reintentar.', { status: 'error', plan: body.context || readyPlan, choices: [], pending: null }) }); }
    if (body.query === 'Cirugías con paciente') return route.fulfill({ json: response('¿De qué período necesitas las cirugías?', { status: 'clarification', plan: draft, choices: [], pending }) });
    if (body.query === 'El mes pasado') return route.fulfill({ json: ready() });
    if (body.query === 'Agrega el médico') return route.fulfill({ json: response('¿Qué médico quieres incluir?', { status: 'clarification', plan: readyPlan, choices: [], options: [{ label: 'Médico tratante', message: 'El médico tratante' }], pending: { request: body.query, answers: [] } }, { notice: 'La IA está ocupada. Te ayudaré con la búsqueda guiada.' }) });
    if (body.query === 'El médico tratante') return route.fulfill({ json: ready({ ...readyPlan, selectedFields: ['Patient', 'Doctor'], fieldLabels: ['Paciente', 'Médico tratante'] }, 1) });
    if (body.query === 'Quiero las órdenes') return route.fulfill({ json: response('¿Quieres las órdenes de SAP o de Vertical?', { status: 'clarification', plan: null, choices: [{ id: 'sales_order_summary', title: 'Órdenes SAP' }, { id: 'vertical_sales_orders', title: 'Órdenes Vertical' }], pending: { request: body.query, answers: [] } }) });
    if (body.query === 'Quiero el reporte «Órdenes SAP».') return route.fulfill({ json: response('¿De qué período necesitas las órdenes?', { status: 'clarification', plan: { ...draft, entity: 'sales_order_summary', entityTitle: 'Órdenes SAP' }, choices: [], pending: { request: 'Quiero las órdenes', answers: [body.query] } }) });
    if (body.query === 'Sin resultados') return route.fulfill({ json: ready(readyPlan, 0) });
    if (body.query === 'Analiza saldos') return route.fulfill({ json: ready({ ...readyPlan,
      analysis: { predicates: [{ field: 'Balance', op: 'gt', value: '10000' }], groupBy: ['Customer'], measures: [{ op: 'sum', field: 'Balance' }], orderBy: [] },
      analysisSummary: { description: 'Saldo > 10000; Agrupado por Cliente; Total de Saldo' }
    }, 1) });
    if (body.query === 'Reporte sin permiso') return route.fulfill({ json: response('Ese tema ya no está disponible para tu usuario. Elige otro tema.', { status: 'unsupported', plan: null, choices: [], pending: null }) });
    if (body.query.startsWith('Consulta general')) return route.fulfill({ json: { success: true, data: { topic: 'general', answer: 'Consulta general atendida.', kpis: [{ label: 'Indicador sintético', value: 87654321 }], table: null, suggestions: [], engine: 'guided' } } });
    return route.fulfill({ json: ready(body.context || readyPlan, 1) });
  });
  await page.goto(`${server.resolvedUrls.local[0]}__aria`);
  await page.getByRole('button', { name: 'Abrir MAR-IA', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'MAR-IA', exact: true });
  const input = page.getByRole('textbox', { name: 'Consulta a MAR-IA', exact: true });
  const send = async query => { await input.fill(query); await dialog.getByRole('button', { name: 'Enviar', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('input[aria-label="Consulta a MAR-IA"]').disabled); };

  await dialog.getByRole('button', { name: 'Cirugías con paciente', exact: true }).waitFor();
  await send('Cirugías con paciente');
  await dialog.getByText('¿De qué período necesitas las cirugías?', { exact: true }).waitFor();
  assert.equal(await dialog.locator('table').count(), 0, 'A clarification does not show report records');
  await send('El mes pasado');
  assert.deepEqual(requests.at(-1).context.selectedFields, ['Patient']);
  assert.deepEqual(requests.at(-1).pending, pending, 'The original request survives the date clarification');
  assert.equal(await dialog.locator('tbody tr').count(), 20, 'The preview is bounded to twenty rows');
  await dialog.getByText('Vista previa: 20 de 23 registros.', { exact: true }).waitFor();
  await send('Agrega el médico');
  assert.equal(requests.at(-1).context.filters.fechaDesde, '2026-09-01');
  assert.doesNotMatch(JSON.stringify(requests.at(-1).history), /Paciente sintético reservado|Médico sintético reservado|Registros encontrados|23 registros/, 'Results never enter conversation history');
  await dialog.getByRole('button', { name: 'Médico tratante', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('input[aria-label="Consulta a MAR-IA"]').disabled);
  assert.equal(requests.at(-1).query, 'El médico tratante');
  assert.equal(requests.at(-1).pending.request, 'Agrega el médico');
  assert.equal(requests.at(-1).context.filters.fechaHasta, '2026-09-30');
  await dialog.getByText('Columnas: Paciente, Médico tratante', { exact: true }).waitFor();
  assert.equal(await dialog.getByRole('button', { name: 'Médico tratante', exact: true }).count(), 0, 'Only the newest clarification has actions');

  failReport = true;
  await send('Genera de nuevo el reporte.');
  await dialog.getByRole('button', { name: 'Reintentar reporte', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('input[aria-label="Consulta a MAR-IA"]').disabled);
  assert.deepEqual(requests.at(-1).context.selectedFields, ['Patient', 'Doctor'], 'Execution failures retain the report configuration for retry');
  assert.equal(requests.at(-1).context.filters.fechaDesde, '2026-09-01');

  failConnection = true;
  await send('Agrega la fecha');
  await dialog.getByText('No se pudo conectar. Revisa tu conexión e intenta de nuevo.', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Reintentar consulta', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('input[aria-label="Consulta a MAR-IA"]').disabled);
  assert.equal(requests.at(-1).query, 'Agrega la fecha', 'A connection retry preserves the failed adjustment');
  assert.deepEqual(requests.at(-1).context.selectedFields, ['Patient', 'Doctor']);

  await send('Reporte sin permiso');
  await dialog.getByText('Ese tema ya no está disponible para tu usuario. Elige otro tema.', { exact: true }).waitFor();
  await send('Otra consulta disponible');
  assert.equal(requests.at(-1).context, null, 'A denied or unsupported result clears the previous report context');

  await dialog.getByRole('button', { name: 'Nueva conversación', exact: true }).click();
  assert.equal(await dialog.locator('table').count(), 0, 'Reset clears the previous results');
  assert.equal(await dialog.getByLabel('Configuración del reporte').count(), 0);
  await send('Quiero las órdenes');
  assert.deepEqual(requests.at(-1).history, []);
  assert.equal(requests.at(-1).context, null);
  assert.equal(requests.at(-1).pending, null);
  await dialog.getByRole('button', { name: 'Órdenes SAP', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('input[aria-label="Consulta a MAR-IA"]').disabled);
  assert.equal(requests.at(-1).pending.request, 'Quiero las órdenes', 'Topic choices preserve the requested report');
  assert.equal(requests.at(-1).context, null);

  await dialog.getByRole('button', { name: 'Nueva conversación', exact: true }).click();
  await send('Sin resultados');
  await dialog.getByText('Tu reporte está listo con 0 registros.', { exact: true }).waitFor();
  assert.equal(await dialog.locator('tbody tr').count(), 0);
  for (let index = 0; index < 6; index += 1) await send(`Consulta general ${index}`);
  assert.equal(requests.at(-1).history.length, 8, 'Only the eight newest conversation messages are sent');
  assert.doesNotMatch(JSON.stringify(requests.at(-1).history), /87654321|Indicador sintético/, 'General dashboard results are also omitted from history');

  await send('Analiza saldos');
  await dialog.getByText('Análisis: Saldo > 10000; Agrupado por Cliente; Total de Saldo', { exact: true }).waitFor();
  await send('Ahora septiembre');
  assert.deepEqual(requests.at(-1).context.analysis, {
    predicates: [{ field: 'Balance', op: 'gt', value: '10000' }], groupBy: ['Customer'], measures: [{ op: 'sum', field: 'Balance' }], orderBy: []
  }, 'MAR-IA sends the entire validated analysis back when changing period');
  assert.doesNotMatch(JSON.stringify(requests.at(-1).history), /Paciente sintético reservado|Médico sintético reservado/, 'A follow-up analysis never includes patient report rows in history');

  for (const action of ['cancel', 'reset', 'close']) {
    const query = `Consulta lenta ${action}`;
    const requestStarted = page.waitForRequest(request => request.method() === 'POST' && request.postDataJSON()?.query === query);
    await input.fill(query); await dialog.getByRole('button', { name: 'Enviar', exact: true }).click();
    await dialog.getByRole('button', { name: 'Cancelar consulta', exact: true }).waitFor();
    await requestStarted;
    if (action === 'cancel') await dialog.getByRole('button', { name: 'Cancelar consulta', exact: true }).click();
    if (action === 'reset') await dialog.getByRole('button', { name: 'Nueva conversación', exact: true }).click();
    if (action === 'close') { await dialog.getByRole('button', { name: 'Cerrar MAR-IA', exact: true }).click(); await page.getByRole('button', { name: 'Abrir MAR-IA', exact: true }).click(); }
    await page.waitForFunction(() => !document.querySelector('input[aria-label="Consulta a MAR-IA"]').disabled);
    await delayed.get(query)?.fulfill({ json: response(`Respuesta vieja ${action}`, { status: 'ready', plan: readyPlan, choices: [] }) }).catch(() => {});
    await send(`Consulta general después de ${action}`);
    assert.equal(await dialog.getByText(`Respuesta vieja ${action}`, { exact: true }).count(), 0, 'A canceled, reset or closed request never adds an old response');
  }

  await page.setViewportSize({ width: 390, height: 700 });
  await page.screenshot({ path: path.join(outputDir, 'aria-mobile.png') });
  const bounds = await dialog.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390, 'The preserved chat layout fits a mobile viewport');
  assert.deepEqual(errors, [], 'The report conversation has no browser runtime errors');
  console.log(JSON.stringify({ ok: true, requests: requests.length, checks: ['clarifications', 'column options', 'topic choices', 'context', 'result-free history', 'retry', 'empty report', 'bounded preview', 'reset', 'cancel', 'close', 'mobile'] }));
} finally {
  await browser?.close();
  await server.close();
}
