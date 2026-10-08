// Navegador y componente reales, directorio y servidor simulados; sin sistemas de negocio.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '../tmp/honorarios-monthly-fixed');
await mkdir(output, { recursive: true });
const providers = [
  { id: 4, name: 'FELIPE ALFAN GUZMAN' }, { id: 5, name: 'LUIS JERÓNIMO GARCÍA TORRES' },
  { id: 6, name: 'RUBEN DARIO ORRICO GALVEZ' }, { id: 66, name: 'RUBÉN DARÍO ORRICO GÁLVEZ' },
  { id: 7, name: 'JUAN JOSE MEDINA PEREZ' }, { id: 8, name: 'FRANCISCO JAVIER MERAYO CHALICO' },
  { id: 9, name: 'CESAR EMMANUEL LOPEZ VEJAR' }, { id: 77, name: 'MÉDICO NUEVO DE EJEMPLO' },
  { id: 99, name: 'MÉDICO CON HISTORIAL DE EJEMPLO' },
];
let assignments = [{ id: 500, providerId: '99', providerName: providers[8].name, area: 'DIRECCIÓN MÉDICA', amount: 2000,
  amountBasis: 'BASE', monthPolicy: 'FULL_MONTH', validFromMonth: '2026-10', validToMonth: null, active: true, revision: 1 }];
const historicalMonths = { '2026-10': 2000 };
let readFailure = true, canManage = true, reads = 0, mutations = [], nextId = 501, currentSeedId = 500;
const server = await createServer({ configFile: false, root, appType: 'custom', plugins: [react(), {
  name: 'monthly-fixed-isolated', configureServer(server) { server.middlewares.use('/__monthly', async (_req, res) => {
    const html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:Arial;margin:20px;background:#f1f5f9}button,input,select{font:inherit}[data-theme="dark"]{--text-primary:#e2e8f0;--text-muted:#94a3b8;--surface-raised:#17263a;--surface-1:#142133;--surface-2:#263448;--table-border:#41516a;background:#0d1728}.hon-card{background:var(--surface-raised,#fff);border:1px solid var(--table-border,#dbe3eb);border-radius:12px}</style></head><body><div id="root"></div><script type="module">import React,{useState}from"react";import{createRoot}from"react-dom/client";import Panel from"/src/components/honorarios/HonorariosMonthlyFixedPanel.jsx";import"/src/components/honorarios/HonorariosReviewToolbar.css";function App(){const[changes,setChanges]=useState(0);return React.createElement(React.Fragment,null,React.createElement("span",{"data-testid":"changes"},changes),React.createElement(Panel,{canManage:true,referenceMonth:"2026-10",onChanged:()=>setChanges(value=>value+1)}))}createRoot(document.getElementById("root")).render(React.createElement(App));</script></body></html>';
    res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml('/__monthly', html));
  }); }
}], server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => sessionStorage.setItem('escandon_token', 'prueba-local'));
  await page.route('**/api/honorarios/**', async route => {
    const endpoint = new URL(route.request().url()).pathname.replace('/api/honorarios', '');
    const method = route.request().method();
    if (endpoint === '/providers') { await route.fulfill({ json: { providers } }); return; }
    if (endpoint === '/monthly-fixed' && method === 'GET') {
      reads++;
      await route.fulfill(readFailure ? { status: 503, json: { error: 'No se pudo consultar la lista de jefes de área. Intenta de nuevo.' } }
        : { json: { assignments, canManage } }); return;
    }
    if (method !== 'POST' && method !== 'PUT') throw Error(`API inesperada ${method} ${endpoint}`);
    const body = route.request().postDataJSON(); mutations.push({ endpoint, method, body });
    assert.equal(body.amountBasis, 'BASE'); assert.equal(body.monthPolicy, 'FULL_MONTH');
    assert.ok(providers.some(provider => String(provider.id) === body.providerId), 'Sólo se guardan identidades del directorio');
    const existing = method === 'PUT' ? assignments.find(item => String(item.id) === endpoint.split('/').at(-1)) : null;
    if (method === 'PUT' && body.expectedRevision !== existing.revision) {
      await route.fulfill({ status: 409, json: { error: 'Otro usuario cambió este pago mensual. Actualiza la lista y vuelve a editarlo.' } }); return;
    }
    if (method === 'POST') assert.equal(body.expectedRevision, 0);
    const splitting = existing?.id === 500 && body.active && body.validFromMonth > existing.validFromMonth;
    const assignment = { ...existing, ...body, id: splitting ? nextId++ : existing?.id || nextId++, providerName: providers.find(provider => String(provider.id) === body.providerId).name,
      revision: splitting ? 1 : (existing?.revision || 0) + 1 };
    if (splitting) { existing.validToMonth = '2026-11'; existing.revision++; currentSeedId = assignment.id; }
    assignments = [...assignments.filter(item => item.id !== assignment.id), assignment];
    if (assignment.providerId === '99' && body.active) historicalMonths[body.validFromMonth] = body.amount;
    await route.fulfill({ json: { assignment } });
  });
  await page.goto(`${server.resolvedUrls.local[0]}__monthly`);
  await page.addStyleTag({ content: '*{transition:none!important;animation:none!important}' });
  await page.getByRole('alert').filter({ hasText: 'No se pudo consultar la lista' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Agregar jefe de área', exact: true }).count(), 0, 'La lectura fallida no concede permisos de modificación');
  readFailure = false;
  await page.getByRole('button', { name: 'Reintentar consulta', exact: true }).click();
  let seedRow = page.locator('[data-assignment-id="500"]');
  await seedRow.waitFor(); assert.equal(reads, 2);
  await page.getByRole('button', { name: 'Cargar listado inicial', exact: true }).click();
  assert.equal(await page.locator('.hon-monthly-proposal').count(), 6);
  assert.equal(mutations.length, 0, 'Cargar el listado sólo prepara propuestas y no activa pagos');
  const firstProposal = page.locator('.hon-monthly-proposal').filter({ has: page.getByRole('heading', { name: 'ALFAN GUZMAN FELIPE', exact: true }) });
  assert.equal(await firstProposal.locator('select').inputValue(), '4', 'Coincidencia única sugerida por tokens de nombre');
  assert.equal(await firstProposal.getByRole('button', { name: 'Guardar jefe de área', exact: true }).isEnabled(), false, 'La coincidencia sugerida requiere confirmación humana');
  const ambiguousProposal = page.locator('.hon-monthly-proposal').filter({ has: page.getByRole('heading', { name: 'ORRICO GALVEZ RUBEN DARIO', exact: true }) });
  assert.equal(await ambiguousProposal.locator('select').inputValue(), '', 'Nombres ambiguos no se vinculan automáticamente');
  await firstProposal.locator('input[type=checkbox]').check();
  await firstProposal.getByRole('button', { name: 'Guardar jefe de área', exact: true }).click();
  await firstProposal.waitFor({ state: 'detached' });
  assert.equal(mutations[0].body.providerId, '4'); assert.equal(mutations[0].body.amount, 2500);
  assert.equal(mutations[0].body.validFromMonth, '2026-10');
  await ambiguousProposal.locator('select').selectOption('66');
  await ambiguousProposal.locator('input[type=checkbox]').check();
  await ambiguousProposal.getByRole('button', { name: 'Guardar jefe de área', exact: true }).click();
  await ambiguousProposal.waitFor({ state: 'detached' });
  assert.equal(mutations[1].body.providerId, '66', 'La identidad ambigua queda determinada por la elección explícita');
  await page.locator('.hon-monthly-proposals').screenshot({ path: path.join(output, 'propuestas-por-confirmar.png') });
  await page.getByRole('button', { name: 'Cerrar propuestas', exact: true }).click();
  await page.getByRole('button', { name: 'Agregar jefe de área', exact: true }).click();
  let editor = page.locator('.hon-monthly-editor');
  await editor.getByLabel('Médico del pago mensual', { exact: true }).selectOption('77');
  await editor.getByLabel('Área del jefe', { exact: true }).fill('EPIDEMIOLOGÍA');
  await editor.getByLabel('Pago mensual antes de impuestos', { exact: true }).fill('1000');
  await editor.locator('input[type=checkbox]').check();
  await editor.getByRole('button', { name: 'Guardar pago mensual', exact: true }).click();
  await editor.waitFor({ state: 'detached' });
  assert.equal(mutations[2].body.providerId, '77'); assert.equal(await page.getByTestId('changes').innerText(), '3');
  await seedRow.getByRole('button', { name: 'Editar', exact: true }).click();
  editor = page.locator('.hon-monthly-editor');
  assert.equal(await editor.getByLabel('Médico del pago mensual', { exact: true }).isEnabled(), false, 'Editar precio conserva la identidad vinculada');
  await editor.getByLabel('Pago mensual antes de impuestos', { exact: true }).fill('3000');
  await editor.getByLabel('Aplicar desde el mes', { exact: true }).fill('2026-12');
  assignments = assignments.map(item => item.id === 500 ? { ...item, amount: 2200, validFromMonth: '2026-11', revision: 2 } : item);
  historicalMonths['2026-11'] = 2200;
  await editor.getByRole('button', { name: 'Guardar pago mensual', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Otro usuario cambió' }).waitFor();
  assert.equal(mutations[3].body.expectedRevision, 1);
  assert.ok((await seedRow.innerText()).includes('$2,000.00'), 'El guardado fallido no cambia el importe mostrado');
  assert.equal(await page.getByTestId('changes').innerText(), '3');
  await page.getByRole('button', { name: 'Actualizar lista', exact: true }).click();
  await seedRow.getByText('$2,200.00', { exact: true }).waitFor();
  await editor.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await seedRow.getByRole('button', { name: 'Editar', exact: true }).click();
  editor = page.locator('.hon-monthly-editor');
  await editor.getByLabel('Pago mensual antes de impuestos', { exact: true }).fill('3000');
  await editor.getByLabel('Aplicar desde el mes', { exact: true }).fill('2026-12');
  await editor.getByRole('button', { name: 'Guardar pago mensual', exact: true }).click();
  await editor.waitFor({ state: 'detached' });
  assert.equal(mutations[4].body.expectedRevision, 2); assert.equal(mutations[4].body.validFromMonth, '2026-12');
  seedRow = page.locator(`[data-assignment-id="${currentSeedId}"]`);
  await seedRow.getByText('$3,000.00', { exact: true }).waitFor();
  assert.ok((await page.locator('[data-assignment-id="500"]').innerText()).includes('hasta 11/2026'), 'La lista recarga la vigencia anterior cuando el cambio crea otra versión');
  assert.deepEqual(historicalMonths, { '2026-10': 2000, '2026-11': 2200, '2026-12': 3000 });
  await page.getByLabel('Buscar jefe de área', { exact: true }).fill('historial dirección');
  assert.equal(await page.locator('.hon-monthly-table tbody tr').count(), 2);
  await page.getByLabel('Buscar jefe de área', { exact: true }).fill('');
  await page.locator('.hon-monthly-panel').screenshot({ path: path.join(output, 'configurados-desktop.png') });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `La lista mensual cabe a ${width}px`);
    await page.locator('.hon-monthly-panel').screenshot({ path: path.join(output, `configurados-${width}.png`) });
  }
  await seedRow.getByRole('button', { name: 'Editar', exact: true }).click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'El formulario cabe a 320px');
  await page.locator('.hon-monthly-editor').screenshot({ path: path.join(output, 'editor-mobile.png') });
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.setViewportSize({ width: 1360, height: 1000 });
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  await page.locator('.hon-monthly-panel').screenshot({ path: path.join(output, 'configurados-dark.png') });
  await seedRow.getByRole('button', { name: 'Quitar', exact: true }).click();
  editor = page.locator('.hon-monthly-editor');
  await editor.getByLabel('Quitar desde el mes', { exact: true }).fill('2027-01');
  await editor.getByRole('button', { name: 'Confirmar baja', exact: true }).click();
  await editor.waitFor({ state: 'detached' });
  assert.equal(mutations[5].body.active, false); assert.equal(mutations[5].body.expectedRevision, 1);
  assert.equal(mutations[5].body.deactivatedFromMonth, '2027-01');
  assert.equal(mutations[5].body.validFromMonth, '2026-12', 'La baja conserva el inicio de la versión anterior');
  assert.equal(await seedRow.count(), 0);
  await page.getByLabel('Ver anteriores y desactivados', { exact: true }).check();
  await seedRow.getByText('Desactivado', { exact: true }).waitFor();
  assert.deepEqual(historicalMonths, { '2026-10': 2000, '2026-11': 2200, '2026-12': 3000 });
  canManage = false;
  await page.getByRole('button', { name: 'Actualizar lista', exact: true }).click();
  await seedRow.waitFor();
  assert.equal(await page.getByRole('button', { name: 'Agregar jefe de área', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Editar', exact: true }).count(), 0, 'La autorización del servidor limita las modificaciones');
  assert.equal(await page.getByTestId('changes').innerText(), '5', 'Cada cambio confirmado avisa que deben actualizarse las consultas');
  assert.equal(mutations.length, 6); assert.deepEqual(errors, []);
  console.log('PASS: propuestas sin activación, identidad explícita/ambigua, alta, revisión concurrente, nueva vigencia, baja con mes efectivo, consulta sin permiso, móvil y tema oscuro.');
} finally { await browser?.close(); await server.close(); }
