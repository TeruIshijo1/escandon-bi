import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';
import * as XLSX from 'xlsx';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '../tmp/statistics-ui');
await fs.mkdir(output, { recursive: true });
const server = await createServer({ configFile: false, root, appType: 'custom', cacheDir: path.join(output, 'vite-cache'),
  plugins: [react(), { name: 'statistics-test', configureServer(server) {
    server.middlewares.use('/__statistics', async (_request, response) => {
      const html = await server.transformIndexHtml('/__statistics', `<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module">
        import React from 'react'; import {createRoot} from 'react-dom/client'; import {MemoryRouter} from 'react-router-dom';
        import {AuthProvider,useAuth} from '/src/context/AuthContext.jsx'; import Estadisticas from '/src/pages/Estadisticas.jsx'; import '/src/styles/globals.css';
        function App(){const {loading}=useAuth();return loading?null:React.createElement('main',{style:{padding:20}},React.createElement(Estadisticas));}
        createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,null,React.createElement(AuthProvider,null,React.createElement(App))));
      </script></body></html>`);
      response.setHeader('Content-Type', 'text/html'); response.end(html);
    });
  } }], server: { host: '127.0.0.1', port: 0, hmr: false },
});
let browser;
let releaseHistory;
let delayedHistory = false;
let releaseDetail;
let delayedDetail = false;
let releaseExport;
let exportFailure = false;
let exportOutdated = false;
let exportRequests = 0;
let historyRequests = 0;
let statsFailure = false;
const birthSection = '02_NACIMIENTOS';
const consultationSection = '04_ADMISIÓN CONTINUA (CONSULTAS DE URGENCIAS)';
const fixtureWorkbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(fixtureWorkbook, XLSX.utils.aoa_to_sheet([['Estadístico de prueba'], ['Septiembre 2026']]), 'Resumen');
const reportBytes = XLSX.write(fixtureWorkbook, { type: 'buffer', bookType: 'xlsx' });
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, timezoneId: 'America/Mexico_City' });
  await page.clock.setFixedTime(new Date('2026-10-07T15:00:00Z'));
  await page.addInitScript(() => sessionStorage.setItem('escandon_token', 'statistics-test'));
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const respond = async payload => { try { await route.fulfill(payload); } catch (error) { if (!route.request().failure()) throw error; } };
    if (url.pathname.endsWith('/auth/me')) return respond({ json: { user: { role: 'DIRECTIVO', username: 'prueba' } } });
    if (url.pathname.endsWith('/kpi-config')) return respond({ json: { ok: true, data: {} } });
    if (url.pathname.endsWith('/stats')) return respond(statsFailure
      ? { status: 503, json: { ok: false, error: 'No se pudieron consultar las estadísticas. Intenta de nuevo.' } }
      : { json: { ok: true, data: { general: null, diagnosticos: [], warnings: ['No se pudo verificar el resumen del periodo.'],
        medicosHospitalizacion: [{ area: 'Médico hospitalización de prueba', n: 1500, especialidad: 'Cirugía general' }],
        medicosUrgencias: [{ area: 'Médico urgencias de prueba', n: 900, especialidad: 'Urgencias' }] } } });
    if (url.pathname.endsWith('/stats-historico')) {
      historyRequests++;
      if (url.searchParams.get('seccion') === birthSection && delayedHistory) {
        await new Promise(resolve => { releaseHistory = resolve; });
        return respond({ json: { ok: true, data: { 2026: { 9: 999 } }, criterion: 'Criterio anterior', unit: 'personas' } });
      }
      const consultations = url.searchParams.get('seccion') === consultationSection;
      return respond({ json: { ok: true, data: { 2026: { 7: null, 8: 5, 9: consultations ? 8 : 0 } }, warnings: [], unit: 'servicios', criterion: consultations ? 'Criterio de consultas vigente' : 'Servicios del periodo' } });
    }
    if (url.pathname.endsWith('/stats-detalle')) {
      const month = Number(url.searchParams.get('mes'));
      if (month === 8 && delayedDetail) await new Promise(resolve => { releaseDetail = resolve; });
      return respond({ json: { ok: true, data: month === 8 ? [{ Paciente: 'Paciente de prueba', FolioAtencion: '12345678', TotalCargosServicio: 2, TotalMonto: null, IngresoTotal: 1500 }] : month === 7 ? [{ Servicio: 'Servicio pendiente de clasificación' }] : [],
        quantity: month === 8 ? 5 : month === 7 ? null : 0, unit: 'servicios', criterion: 'Cantidad neta de servicios', warnings: [] } });
    }
    if (url.pathname.endsWith('/stats-export')) {
      exportRequests++;
      assert.equal(url.searchParams.get('startDate'), '2026-09-01');
      assert.equal(url.searchParams.get('endDate'), '2026-09-30');
      if (exportOutdated) return respond({ status: 404, contentType: 'text/html', body: '<html>Cannot GET /api/dashboard/stats-export</html>' });
      if (exportFailure) return respond({ status: 503, json: { ok: false, error: 'No se pudo reunir toda la información. Intenta de nuevo.' } });
      await new Promise(resolve => { releaseExport = resolve; });
      return respond({ status: 200, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: reportBytes });
    }
    return respond({ json: { ok: true, data: [] } });
  });
  await page.goto(`${server.resolvedUrls.local[0]}__statistics`);
  await page.getByRole('heading', { name: 'Top 10 médicos por ingreso en hospitalización' }).waitFor();
  await page.getByText('Médico hospitalización de prueba', { exact: false }).waitFor();
  await page.getByText('Médico urgencias de prueba', { exact: false }).waitFor();
  assert.equal(await page.locator('.dashboard-metric-value').filter({ hasText: 'No disponible' }).count(), 7);
  assert.equal(historyRequests, 0, 'Opening statistics must not load the entire annual history');
  await page.getByRole('button', { name: 'Consultar histórico', exact: true }).click();
  await page.getByText('Servicios del periodo', { exact: true }).waitFor();
  assert.equal(historyRequests, 1);
  assert.ok(await page.getByText('Parcial: 5', { exact: true }).count() > 0);
  const septemberRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Septiembre', exact: true }) });
  const augustRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Agosto', exact: true }) });
  const julyRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Julio', exact: true }) });
  await julyRow.getByRole('button', { name: /No disponible/ }).click();
  await page.getByText('Estas filas se muestran para revisión. Aún no hay un total confirmado para este estadístico.', { exact: true }).waitFor();
  await page.getByText('Total del periodo: No disponible servicios', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Cerrar detalle', exact: true }).click();
  await septemberRow.getByRole('button', { name: /0/ }).click();
  await page.getByText('Total del periodo: 0 servicios', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Cerrar detalle', exact: true }).click();
  await augustRow.getByRole('button', { name: /5/ }).click();
  await page.getByText('Paciente de prueba', { exact: true }).waitFor();
  const dialog = page.getByRole('dialog');
  assert.equal(await dialog.getByRole('cell', { name: '$2.00', exact: true }).count(), 0, 'Service counts must not be formatted as money');
  assert.equal(await dialog.getByRole('cell', { name: '2', exact: true }).count(), 1);
  assert.equal(await dialog.getByRole('cell', { name: 'No disponible', exact: true }).count(), 1);
  assert.equal(await dialog.getByRole('cell', { name: '$1,500.00', exact: true }).count(), 1);
  const detailDownloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: /Exportar a Excel/ }).click();
  const detailDownload = await detailDownloadPromise;
  const detailFile = path.join(output, 'detail.xlsx');
  await detailDownload.saveAs(detailFile);
  const detailWorkbook = XLSX.read(await fs.readFile(detailFile));
  const firstDetail = XLSX.utils.sheet_to_json(detailWorkbook.Sheets.Detalle)[0];
  assert.equal(firstDetail['Folio Atención'], '12345678', 'An eight-digit account identifier must remain an identifier');
  assert.equal(firstDetail['Total Cargos / Eventos'], 2);
  assert.equal(firstDetail['Total Importe'], 'No disponible');
  assert.equal(firstDetail['Importe de órdenes de venta'], 1500);
  await page.getByRole('button', { name: 'Cerrar detalle', exact: true }).click();

  delayedDetail = true;
  await augustRow.getByRole('button', { name: /5/ }).click();
  await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.textContent.includes('Consultando registros'));
  await page.getByRole('button', { name: 'Cerrar detalle', exact: true }).click();
  await septemberRow.getByRole('button', { name: /0/ }).click();
  await page.getByText('Total del periodo: 0 servicios', { exact: true }).waitFor();
  releaseDetail();
  await page.getByRole('button', { name: 'Cerrar detalle', exact: true }).click();
  assert.equal(await page.getByRole('dialog').count(), 0);

  delayedHistory = true;
  const selector = page.getByRole('combobox', { name: 'Estadístico a consultar' });
  await selector.selectOption(birthSection);
  await page.getByText('Cargando datos históricos...', { exact: true }).waitFor();
  await selector.selectOption(consultationSection);
  await page.getByText('Criterio de consultas vigente', { exact: true }).waitFor();
  releaseHistory();
  assert.equal(await page.getByText('Criterio anterior', { exact: true }).count(), 0);
  await septemberRow.getByRole('button', { name: /8/ }).waitFor();

  await page.getByRole('button', { name: 'Generar estadístico', exact: true }).click();
  assert.equal(await page.getByLabel('Desde', { exact: true }).inputValue(), '2026-09-01');
  assert.equal(await page.getByLabel('Hasta', { exact: true }).inputValue(), '2026-09-30');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar Excel completo', exact: true }).click();
  await page.getByRole('button', { name: 'Generando estadístico…', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Desde', { exact: true }).isDisabled(), true);
  await page.locator('#statistics-report-form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  assert.equal(exportRequests, 1, 'Double submission must not request two reports');
  releaseExport();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'Estadistico_2026-09-01_2026-09-30.xlsx');
  const downloadedFile = path.join(output, download.suggestedFilename());
  await download.saveAs(downloadedFile);
  assert.equal(XLSX.read(await fs.readFile(downloadedFile)).SheetNames[0], 'Resumen');

  exportFailure = true;
  await page.getByRole('button', { name: 'Descargar Excel completo', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'No se pudo reunir toda la información' }).waitFor();
  assert.equal(exportRequests, 2);
  exportOutdated = true;
  await page.getByRole('button', { name: 'Descargar Excel completo', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Reinicia la aplicación BI' }).waitFor();
  assert.equal(exportRequests, 3);
  await page.screenshot({ path: path.join(output, 'statistics-desktop.png'), fullPage: true });
  statsFailure = true;
  await page.getByRole('button', { name: 'semana', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'No se pudieron consultar las estadísticas' }).waitFor();
  assert.equal(await page.getByText('Médico hospitalización de prueba', { exact: false }).count(), 0, 'Failed requests must not retain an old ranking');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(output, 'statistics-mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Mobile layout must keep horizontal scrolling inside the table');
  assert.deepEqual(errors, []);
  console.log('Statistics UI passed: unavailable data, separate doctors, quantity units, request races, inclusive dates, single Excel download and visible failures.');
} finally {
  releaseHistory?.(); releaseDetail?.(); releaseExport?.();
  await browser?.close();
  await server.close();
}
