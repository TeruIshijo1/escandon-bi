import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.resolve(root, '../tmp/report-builder');
await fs.mkdir(outputDir, { recursive: true });
const server = await createServer({
  configFile: false, root, cacheDir: path.join(outputDir, 'vite-cache'), appType: 'custom',
  plugins: [react(), {
    name: 'report-builder-preview', configureServer(server) {
      server.middlewares.use('/__reports', async (_req, res) => {
        const html = await server.transformIndexHtml('/__reports', `<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module">
          import React from 'react'; import { createRoot } from 'react-dom/client';
          import { AuthProvider, useAuth } from '/src/context/AuthContext.jsx';
          import ConsultaServiceLayer from '/src/components/mi-area/ConsultaServiceLayer.jsx';
          import '/src/styles/globals.css';
          function App() { const { loading } = useAuth(); return loading ? null : React.createElement('main', { style: { padding: '16px', maxWidth: '1500px', margin: '0 auto' } }, React.createElement(ConsultaServiceLayer)); }
          createRoot(document.getElementById('root')).render(React.createElement(AuthProvider, null, React.createElement(App)));
        </script></body></html>`);
        res.setHeader('Content-Type', 'text/html'); res.end(html);
      });
    },
  }], server: { host: '127.0.0.1', port: 0, hmr: false },
});

const nameField = { key: 'Name', label: 'Nombre', type: 'text' };
const catalog = [
  // Legacy metadata keeps the existing warehouse behavior and defaults to SAP.
  { id: 'inventory', title: 'Inventario y stock', description: 'Existencias por almacén.', category: 'Inventarios', icon: '📦', defaultFields: ['Name'], fields: [nameField, { key: 'WhsCode', label: 'Almacén', type: 'text' }, { key: 'MedicalClassification', label: 'Clasificación principal', type: 'text' }, { key: 'SecondaryClassification', label: 'Clasificación secundaria', type: 'text' }] },
  { id: 'invoice_lines', source: 'SAP', title: 'Facturas por línea', description: 'Facturación de servicios.', category: 'Facturación', icon: '🧾', requiresDateFilter: true, dateFieldLabel: 'Fecha de contabilización', grain: 'Una línea de factura. El total del documento se repite por línea; no sumes ese total sin agrupar por documento.', filters: ['estatusDoc'], defaultFields: ['Name', 'DocTotal'], fields: [nameField, { key: 'DocTotal', label: 'Total del documento', type: 'money' }, { key: 'DocStatus', label: 'Estado', type: 'text' }] },
  // An explicit empty filters list overrides fields that look filterable.
  { id: 'partners', source: 'SAP', title: 'Directorio de proveedores', description: 'Datos de contacto.', category: 'Catálogos', icon: '👥', filters: [], defaultFields: ['Name'], fields: [nameField, { key: 'Status', label: 'Estado', type: 'text' }, { key: 'WhsCode', label: 'Almacén de referencia', type: 'text' }] },
  { id: 'vertical_accounts', source: 'Vertical', title: 'Cuentas hospitalarias', description: 'Cuentas y pacientes.', category: 'Atención hospitalaria', icon: '🏥', requiresDateFilter: true, dateFieldLabel: 'Fecha de apertura de cuenta', grain: 'Una cuenta hospitalaria.', keywords: ['folios', 'expedientes'], filters: ['estatusDoc'], defaultFields: ['Name'], fields: [nameField, { key: 'PCStatus', label: 'Situación de cuenta', type: 'text' }, { key: 'Active', label: 'Activa', type: 'boolean' }, { key: 'EntryDate', label: 'Fecha de ingreso', type: 'date' }, { key: 'StartsAt', label: 'Inicio de atención', type: 'datetime' }, { key: 'Amount', label: 'Importe', type: 'number' }] },
  { id: 'vertical_surgeries', source: 'Vertical', title: 'Agenda quirúrgica', description: 'Cirugías y médicos.', category: 'Quirófano', icon: '📅', keywords: ['programacion', 'procedimientos'], filters: [], defaultFields: ['Name'], fields: [nameField] },
];

let user = { username: 'amendoza', role: 'ADMIN', permisos: [] };
let activeCatalog = catalog;
let catalogMode = 'held';
let releaseCatalog;
const catalogGate = new Promise(resolve => { releaseCatalog = resolve; });
const executeRequests = [];
const saveRequests = [];
let nextExecuteGate = null;
const savedQueries = [
  { id: 1, title: 'Mi reporte de cuentas', entity: 'vertical_accounts', selectedFields: ['Name', 'OldField'], filters: { almacen: 'FAR', estatusDoc: 'OPEN', busqueda: 'Ana' }, username: 'amendoza', createdAt: '2026-10-01' },
  { id: 2, title: 'Plantilla con columnas anteriores', entity: 'partners', selectedFields: ['RemovedPrice'], filters: {}, username: 'amendoza', createdAt: '2026-10-01' },
];
let browser;
let page;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/Mexico_City' });
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error('Browser error:', error.message); });
  page.on('console', message => { if (message.type() === 'error') console.error('Browser console:', message.text()); });
  await page.addInitScript(() => sessionStorage.setItem('escandon_token', 'report-builder-test'));
  page.on('dialog', dialog => dialog.accept());
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (!pathname.startsWith('/api/')) return route.continue();
    if (pathname.endsWith('/auth/me')) return route.fulfill({ json: { user } });
    if (pathname.endsWith('/sap-query/catalog')) {
      if (catalogMode === 'held') await catalogGate;
      if (catalogMode === 'error') return route.fulfill({ status: 503, json: { ok: false, error: 'Connection failed' } });
      if (catalogMode === 'empty') return route.fulfill({ json: { ok: true, catalog: [] } });
      return route.fulfill({ json: { ok: true, catalog: activeCatalog } });
    }
    if (pathname.endsWith('/sap-query/saved')) {
      if (route.request().method() === 'POST') {
        saveRequests.push(route.request().postDataJSON());
        return route.fulfill({ json: { ok: true } });
      }
      return route.fulfill({ json: { ok: true, queries: savedQueries.filter(report => user.role === 'ADMIN' || report.username === user.username) } });
    }
    if (pathname.endsWith('/sap-query/execute')) {
      const request = route.request().postDataJSON(); executeRequests.push(request);
      const gate = nextExecuteGate; nextExecuteGate = null;
      if (gate) await gate;
      const entity = catalog.find(def => def.id === request.entity);
      const records = [{ Name: 'Ana', DocTotal: 2500, PCStatus: 'OP', Active: true, EntryDate: '2026-10-01', StartsAt: '2026-10-01T14:35:00', Amount: 1000, MedicalClassification: null, SecondaryClassification: 'Antibiótico' }, { Name: 'Luis', DocTotal: 2500, PCStatus: 'CL', Active: false, EntryDate: '2026-10-01', StartsAt: '2026-10-01T16:20:00', Amount: 2000, MedicalClassification: 'Controlado', SecondaryClassification: null }];
      const data = request.busqueda === '1000.00' ? records.slice(0, 1) : records.filter(row => !request.busqueda || row.Name.toLowerCase().includes(request.busqueda.toLowerCase()));
      return route.fulfill({ json: { ok: true, entityTitle: entity.title, data, truncated: true, limit: 2, message: 'Se alcanzó el límite de 2 registros. Reduce el período o los filtros para revisar el resto.' } });
    }
    return route.fulfill({ json: { ok: true, data: [] } });
  });

  await page.goto(`${server.resolvedUrls.local[0]}__reports`);
  await page.getByRole('button', { name: 'Elegir un tema', exact: true }).click();
  await page.getByText('Cargando módulos de SAP y Vertical…', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /Guardar reporte/i }).isDisabled(), true);
  catalogMode = 'ok'; releaseCatalog();
  await page.getByText('5 de 5 módulos disponibles', { exact: true }).waitFor();
  assert.equal(await page.locator('.report-catalog__card').count(), 5);
  assert.equal(await page.getByRole('combobox', { name: 'Almacén', exact: true }).count(), 1);
  assert.equal(await page.getByLabel('Estado del registro', { exact: true }).count(), 0);
  const moduleSearch = page.getByLabel('Buscar módulos o temas', { exact: true });
  const recordSearch = page.getByLabel('Buscar en los registros', { exact: true });
  await recordSearch.fill('nombre de prueba');
  await moduleSearch.fill('quirurgica');
  await page.getByText('1 de 5 módulos disponibles', { exact: true }).waitFor();
  assert.equal(await recordSearch.inputValue(), 'nombre de prueba', 'Module search must not change record search');
  assert.equal(await page.locator('.report-catalog__card').count(), 1);
  await moduleSearch.fill('expedientes');
  assert.equal(await page.getByRole('button', { name: 'Seleccionar módulo: Cuentas hospitalarias', exact: true }).count(), 1, 'Keywords make modules discoverable');
  await moduleSearch.fill('');
  await page.getByRole('button', { name: 'Vertical (2)', exact: true }).click();
  assert.equal(await page.locator('.report-catalog__card').count(), 2);
  assert.equal(await page.getByRole('button', { name: 'Todos los módulos (2)', exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Atención hospitalaria (1)', exact: true }).click();
  assert.equal(await page.locator('.report-catalog__card').count(), 1);
  await moduleSearch.fill('sin coincidencias');
  await page.getByText('No hay módulos que coincidan con tu búsqueda y filtros.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Limpiar búsqueda de módulos', exact: true }).click();
  assert.equal(await page.locator('.report-catalog__card').count(), 5);

  await page.getByRole('button', { name: 'Seleccionar módulo: Directorio de proveedores', exact: true }).click();
  assert.equal(await page.getByLabel('Estado del registro', { exact: true }).count(), 0, 'Explicit filter metadata overrides Status field fallback');
  assert.equal(await page.getByRole('combobox', { name: 'Almacén', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Seleccionar módulo: Facturas por línea', exact: true }).click();
  await page.getByText('Período según: Fecha de contabilización', { exact: true }).waitFor();
  assert.match(await page.locator('.report-builder__grain').innerText(), /no sumes ese total/);
  await page.getByLabel('Fecha Desde', { exact: true }).fill('2026-10-03');
  await page.getByLabel('Fecha Hasta', { exact: true }).fill('2026-10-01');
  await page.getByRole('button', { name: 'Buscar información', exact: true }).click();
  await page.getByRole('alert').getByText('La fecha de inicio debe ser anterior o igual a la fecha de fin.', { exact: true }).waitFor();
  assert.equal(executeRequests.length, 0);

  await page.getByRole('button', { name: /Mis reportes/i }).click();
  await page.getByText('Plantilla con columnas anteriores', { exact: true }).click();
  assert.equal(await page.getByRole('checkbox', { name: 'Nombre', exact: true }).isChecked(), true, 'A retired field list falls back to module defaults');
  assert.equal(await page.locator('.report-builder__configuration input[type="checkbox"]:checked').count(), 1);
  await page.getByRole('button', { name: /Mis reportes/i }).click();
  await page.getByText('Mi reporte de cuentas', { exact: true }).click();
  assert.equal(await recordSearch.inputValue(), 'Ana');
  assert.equal(await page.getByRole('combobox', { name: 'Almacén', exact: true }).count(), 0);
  assert.equal(await page.getByLabel('Estado del registro', { exact: true }).inputValue(), 'OPEN');
  assert.equal(await page.locator('.report-builder__configuration input[type="checkbox"]:checked').count(), 1, 'Old saved fields are removed');
  await page.getByLabel('Fecha Desde', { exact: true }).fill('2026-10-01');
  await page.getByRole('button', { name: 'Buscar información', exact: true }).click();
  await page.getByText(/^Información de Vertical · 1 columnas visibles/).waitFor();
  assert.equal(executeRequests.at(-1).entity, 'vertical_accounts');
  assert.equal(executeRequests.at(-1).almacen, 'ALL', 'Unsupported saved warehouse must not reach query');
  assert.equal(executeRequests.at(-1).busqueda, 'Ana');
  await page.locator('.report-builder__limit').waitFor();
  await page.getByLabel('Fecha Desde', { exact: true }).fill('2026-09-01');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Descargar Excel Oficial/ }).click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /^Reporte_Vertical_vertical_accounts_/);
  assert.match(download.suggestedFilename(), /_2026-10-01_2026-10-01\.xls$/, 'Export filename uses the queried period');
  const excel = await fs.readFile(await download.path(), 'utf8');
  assert.match(excel, /Reporte de Vertical: Cuentas hospitalarias/);
  assert.match(excel, /Una cuenta hospitalaria/);
  assert.match(excel, /Se alcanzó el límite de 2 registros/);
  assert.match(excel, /Fecha de apertura de cuenta: 2026-10-01 al 2026-10-01/);
  assert.doesNotMatch(excel, /2026-09-01/, 'Changing dates must not relabel previously queried data');
  assert.doesNotMatch(excel, /<td[^>]*>Luis<\/td>/, 'Excel preserves record filtering');
  await page.getByLabel('Fecha Desde', { exact: true }).fill('2026-10-01');
  await page.getByRole('checkbox', { name: 'Activa', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Fecha de ingreso', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Inicio de atención', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Importe', exact: true }).check();
  await recordSearch.fill('1000.00');
  await page.getByRole('button', { name: 'Buscar información', exact: true }).click();
  await page.getByRole('button', { name: 'Buscar información', exact: true }).waitFor();
  assert.equal(executeRequests.at(-1).busqueda, '1000.00');
  await page.getByText(/^Información de Vertical · 5 columnas visibles/).waitFor();
  assert.equal(await page.locator('tbody tr').count(), 1, 'A server decimal search must not be discarded because JS displays it differently');
  const renderedCells = await page.locator('tbody td').allTextContents();
  assert.ok(renderedCells.includes('Sí'), 'Boolean values remain visible');
  assert.ok(renderedCells.includes('1/10/2026'), 'Date-only values retain their calendar day in Mexico City');
  assert.ok(renderedCells.some(value => value.includes('14:35')), 'Timestamp values retain their time');
  await recordSearch.fill('sin coincidencias');
  assert.equal(await page.locator('tbody tr').count(), 0, 'Changing record search still filters already fetched records');
  await recordSearch.fill('');
  await page.getByRole('button', { name: 'Buscar información', exact: true }).click();
  await page.getByText('Cuentas hospitalarias (2 registros)', { exact: true }).waitFor();
  assert.ok((await page.locator('tbody td').allTextContents()).includes('No'), 'False booleans remain visible');
  const formattedDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Descargar Excel Oficial/ }).click();
  const formattedDownload = await formattedDownloadPromise;
  const formattedExcel = await fs.readFile(await formattedDownload.path(), 'utf8');
  assert.match(formattedExcel, />Sí<\/td>/);
  assert.match(formattedExcel, />No<\/td>/);
  assert.match(formattedExcel, /1\/10\/2026/);
  assert.match(formattedExcel, /14:35/);
  await page.getByRole('button', { name: /Guardar reporte/i }).click();
  await page.getByPlaceholder('Ej. Condiciones de convenios').fill('Cuentas de Ana');
  await page.getByRole('dialog', { name: 'Guardar reporte', exact: true }).getByRole('button', { name: 'Guardar reporte', exact: true }).click();
  await page.getByRole('dialog', { name: 'Guardar reporte', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(saveRequests.at(-1).entity, 'vertical_accounts');
  assert.equal(saveRequests.at(-1).filters.almacen, 'ALL');

  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const bounds = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(bounds.scroll <= bounds.width + 1, `${theme} ${width}px must not overflow: ${JSON.stringify(bounds)}`);
      await page.screenshot({ path: path.join(outputDir, `${theme}-${width}.png`), fullPage: true });
    }
  }

  let releaseExecute;
  nextExecuteGate = new Promise(resolve => { releaseExecute = resolve; });
  const staleResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/sap-query/execute'));
  await page.getByRole('button', { name: 'Buscar información', exact: true }).click();
  await page.getByRole('button', { name: 'Seleccionar módulo: Inventario y stock', exact: true }).click();
  releaseExecute(); await (await staleResponse).finished();
  await page.getByRole('heading', { name: 'Inventario y stock', exact: true }).waitFor();
  assert.equal(await page.locator('tbody').count(), 0, 'A late response must not appear under a different module');
  await page.getByRole('button', { name: 'Buscar información', exact: true }).click();
  await page.getByText('Inventario y stock (2 registros)', { exact: true }).waitFor();
  await page.getByRole('combobox', { name: 'Clasificación Sanitaria', exact: true }).selectOption('ANTI');
  await page.getByText('Inventario y stock (1 registro filtrado de 2)', { exact: true }).waitFor();
  assert.deepEqual(await page.locator('tbody td').allTextContents(), ['Ana'], 'Secondary classification matches even when primary classification is null');

  user = { username: 'report-reader', role: 'JEFE_AREA', permisos: ['sap-query-inventory', 'sap-query-vertical_accounts'] };
  await page.reload();
  await page.getByRole('button', { name: 'Elegir un tema', exact: true }).click();
  await page.getByText('2 de 2 módulos disponibles', { exact: true }).waitFor();
  assert.equal(await page.locator('.report-catalog__card').count(), 2);
  assert.equal(await page.getByRole('button', { name: 'SAP (1)', exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Vertical (1)', exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Facturación (1)', exact: true }).count(), 0, 'Counts and categories must not expose unauthorized modules');
  catalogMode = 'error'; await page.reload();
  await page.getByRole('button', { name: 'Elegir un tema', exact: true }).click();
  await page.getByRole('alert').getByText('No se pudo cargar la lista de módulos de SAP y Vertical. Intenta de nuevo.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /Guardar reporte/i }).isDisabled(), true);
  catalogMode = 'ok'; await page.getByRole('button', { name: 'Reintentar carga', exact: true }).click();
  await page.getByText('2 de 2 módulos disponibles', { exact: true }).waitFor();
  catalogMode = 'empty'; await page.reload();
  await page.getByRole('button', { name: 'Elegir un tema', exact: true }).click();
  await page.getByText('No hay módulos disponibles para tu usuario. Solicita acceso al área de Sistemas.', { exact: true }).waitFor();
  assert.equal(await page.locator('.report-catalog__card').count(), 0);
  if (process.argv.includes('--real-catalog')) {
    activeCatalog = JSON.parse(await fs.readFile(path.join(outputDir, 'catalog.json'), 'utf8'));
    user = { username: 'amendoza', role: 'ADMIN', permisos: [] }; catalogMode = 'ok';
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload();
    await page.getByRole('button', { name: 'Elegir un tema', exact: true }).click();
    await page.getByText(`${activeCatalog.length} de ${activeCatalog.length} módulos disponibles`, { exact: true }).waitFor();
    assert.equal(await page.locator('.report-catalog__card').count(), activeCatalog.length);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
      for (const width of [1440, 1100, 768, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('.report-catalog__results').scrollTop = 0; });
        // Wait for global theme transitions to settle before measuring contrast.
        await page.waitForTimeout(350);
        const layout = await page.evaluate(() => {
          const cards = [...document.querySelectorAll('.report-catalog__card')];
          const results = document.querySelector('.report-catalog__results');
          return {
            width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
            cardWidths: cards.map(card => card.getBoundingClientRect().width),
            clippedCards: cards.filter(card => card.scrollWidth > card.clientWidth + 1 || card.scrollHeight > card.clientHeight + 1).length,
            resultsHeight: results.clientHeight, resultsScroll: results.scrollHeight,
          };
        });
        assert.ok(layout.scroll <= layout.width + 1, `${theme} ${width}px catalogue must fit the page`);
        assert.ok(layout.cardWidths.every(cardWidth => cardWidth >= 240), `${theme} ${width}px cards need readable space`);
        assert.equal(layout.clippedCards, 0, `${theme} ${width}px full titles and descriptions must fit`);
        assert.ok(layout.resultsScroll > layout.resultsHeight, 'All modules remain available in the scrollable list');
        await page.screenshot({ path: path.join(outputDir, `catalog-${theme}-${width}.png`), fullPage: true });
        if (width === 1440) await page.screenshot({ path: path.join(outputDir, `catalog-${theme}-preview.png`) });
      }
    }
    await page.getByLabel('Filtrar por categoría', { exact: true }).selectOption(activeCatalog[0].category);
    assert.equal(await page.locator('.report-catalog__card').count(), activeCatalog.filter(entity => entity.category === activeCatalog[0].category).length, 'Mobile category selector filters the catalogue');
    await page.getByLabel('Filtrar por categoría', { exact: true }).selectOption('ALL');
    const lastModule = activeCatalog.at(-1);
    await page.getByRole('button', { name: `Seleccionar módulo: ${lastModule.title}`, exact: true }).click();
    assert.equal(await page.getByRole('button', { name: `Seleccionar módulo: ${lastModule.title}`, exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'Configurar reporte', exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.tagName === 'H3' && document.activeElement?.closest('.report-builder__configuration-heading'));
    assert.equal(await page.locator('.report-builder__configuration-heading h3').innerText(), lastModule.title);
    console.log(`PASS: catálogo real de ${activeCatalog.length} módulos renderizado, con ${new Set(activeCatalog.map(entity => entity.category)).size} categorías.`);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: catálogo SAP/Vertical, búsqueda y categorías, metadatos de filtros, granularidad, permisos, plantillas, Excel, estados de carga/error y diseño de 390–1440 px en ambos temas.');
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(outputDir, 'failure.png'), fullPage: true });
    console.error('Failure page:', await page.locator('body').innerText());
  }
  throw error;
} finally {
  await browser?.close(); await server.close();
}
