import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';
import { fiscalCategory } from '../src/utils/honorariosFiscalDirectory.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '../tmp/honorarios-fiscal-categorias');
await mkdir(output, { recursive: true });
const viewSource = await readFile(path.join(root, 'src/components/honorarios/HonorariosAuditView.jsx'), 'utf8');
const commonStyles = viewSource.match(/<style>\{`([\s\S]*?)`\}<\/style>/)[1];
const providers = [
  { id: 1, name: 'ANA MÉDICA DE EJEMPLO' }, { id: 2, name: 'MÉDICO CON SAP PARCIAL' },
  { id: 3, name: 'MÉDICO SIN SAP' }, { id: 4, name: 'MÉDICO CON FICHA INTERNA' },
  { id: 5, name: 'MÉDICO CON VIGENCIA FUTURA' }, { id: 6, name: 'MÉDICO CON COINCIDENCIA AMBIGUA' }
];
const internal = (id, changes = {}) => ({ source: 'BI_INTERNO', providerId: String(id), enabled: true, confirmed: true,
  federalTaxId: 'AAAA800101AAA', fiscalRegime: '612', validFrom: '2026-01-01', isrRate: .1,
  vatFraction: 2 / 3, defaultVatRate: .16, revision: 1, updatedBy: 'REVISOR DE EJEMPLO', updatedAt: '2026-10-05T16:00:00Z', ...changes });
let profiles = { 4: internal(4), 5: internal(5, { validFrom: '2026-11-01' }) };
const doctors = providers.map(item => ({ providerId: String(item.id), sapReady: item.id === 1,
  suggestedProfile: item.id === 1 ? { federalTaxId: 'AAAA800101AAA', fiscalRegime: '612', isrRate: .1, vatFraction: 2 / 3 }
    : item.id === 2 ? { federalTaxId: 'BBBB800101BBB', fiscalRegime: '', isrRate: .1, vatFraction: '' } : {},
  reasons: [item.id === 2 ? 'SAP permite servicios sin IVA. Falta confirmar la retención para servicios con IVA.' : 'Completa su ficha interna.'],
  sap: { linkStatus: item.id <= 2 ? 'candidato_unico' : item.id === 6 ? 'ambiguo' : 'sin_coincidencia',
    candidates: item.id <= 2 ? [{ cardCode: `P00${item.id}`, cardName: item.name }] : [] } }));
const originalSap = JSON.stringify(doctors);
assert.equal(fiscalCategory(doctors[0], internal(1, { enabled: false }), '2026-10-01').key, 'sap');
assert.equal(fiscalCategory(doctors[0], internal(99), '2026-10-01').key, 'pending');
assert.equal(fiscalCategory(doctors[0], internal(1, { validFrom: '2026-11-01' }), '2026-10-01').key, 'pending');
assert.equal(fiscalCategory(doctors[0], internal(1, { confirmed: false }), '2026-10-01').key, 'pending');
let unavailable = false, directoryReads = 0, writes = [], versions = [], failSave = false;
let delayHistory = false, releaseHistory;
let delayDirectory = false, releaseDirectory;
const server = await createServer({ configFile: false, root, appType: 'custom', plugins: [react(), {
  name: 'fiscal-categories-isolated', configureServer(server) { server.middlewares.use('/__categorias', async (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    const app = `import React,{useState}from"react";import{createRoot}from"react-dom/client";import Panel from"/src/components/honorarios/HonorariosFiscalPanel.jsx";import"/src/components/honorarios/HonorariosReviewToolbar.css";const{providers,profiles:initial}=window.__fiscalFixture;function App(){const[profiles,setProfiles]=useState(initial);return React.createElement(Panel,{providers,profiles,initialProviderId:new URLSearchParams(location.search).get('provider')||'',referenceDate:'2026-10-01',canManage:true,onSaved:profile=>setProfiles(prev=>({...prev,[profile.providerId]:profile}))})};createRoot(document.getElementById('root')).render(React.createElement(App));`;
    res.end(await server.transformIndexHtml('/__categorias', `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${commonStyles}body{font-family:Arial;margin:16px;background:#f1f5f9}button,input,select{font:inherit}h2{color:#17304d}</style></head><body><div id="root"></div><script>window.__fiscalFixture=${JSON.stringify({ providers, profiles })};</script><script type="module">${app}</script></body></html>`));
  }); }
}], server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1250, height: 1050 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/honorarios/**', async route => {
    const url = new URL(route.request().url()), endpoint = url.pathname.replace('/api/honorarios', ''), method = route.request().method();
    let result = { ok: true }, status = 200;
    if (endpoint === '/fiscal-directory' && method === 'GET') {
      directoryReads++; assert.equal(url.searchParams.get('date'), '2026-10-01');
      if (delayDirectory) await new Promise(resolve => { releaseDirectory = resolve; });
      Object.assign(result, { date: '2026-10-01', sapAvailable: !unavailable, asOf: unavailable ? null : '2026-10-05T16:00:00Z',
        doctors: unavailable ? providers.map(item => ({ providerId: String(item.id), sapReady: false, suggestedProfile: {}, sap: { linkStatus: 'sin_consultar', candidates: [] } })) : doctors,
        warning: unavailable ? 'No se pudo consultar SAP. Puedes completar las fichas internas o pulsar Actualizar SAP para volver a intentar.' : undefined });
    } else if (endpoint === '/fiscal-profiles/1' && method === 'PUT') {
      const body = route.request().postDataJSON(); writes.push(body);
      if (failSave) { status = 409; result.error = 'Otra persona cambió estos datos. Actualiza la ficha antes de guardar.'; }
      else { assert.equal(body.expectedRevision, profiles[1]?.revision || 0);
        result.profile = profiles[1] = internal(1, { ...body, confirmed: body.enabled, revision: body.expectedRevision + 1 });
        versions.push({ payload: { ...result.profile }, revision: result.profile.revision, updated_by: 'REVISOR DE EJEMPLO', updated_at: result.profile.updatedAt }); }
    } else if (endpoint === '/fiscal-profiles/1/history' && method === 'GET') {
      if (delayHistory) {
        await new Promise(resolve => { releaseHistory = resolve; });
        result.history = [{ payload: internal(1), revision: 99, updated_by: 'HISTORIAL MEDICO ANTERIOR', updated_at: '2026-10-05T16:00:00Z' }];
      } else result.history = [...versions].reverse();
    }
    else throw Error(`API inesperada: ${method} ${endpoint}`);
    await route.fulfill({ status, json: result });
  });
  await page.goto(`${server.resolvedUrls.local[0]}__categorias`);
  const group = key => page.getByRole('button', { name: new RegExp(`^${key}`) });
  await group('Listos con SAP').filter({ hasText: '1' }).waitFor();
  assert.match(await group('Por completar').innerText(), /4$/); assert.match(await group('Configurados internamente').innerText(), /1$/);
  await page.locator('.hon-fiscal-panel').screenshot({ path: path.join(output, '01-grupos-fiscales.png') });
  await group('Listos con SAP').click();
  const select = page.getByLabel('Médico fiscal', { exact: true });
  assert.equal(await select.locator('option').count(), 2); await select.selectOption('1');
  await page.waitForFunction(() => document.querySelector('[aria-label="RFC del médico"]').value === 'AAAA800101AAA');
  assert.equal(await page.getByLabel('RFC del médico').inputValue(), 'AAAA800101AAA');
  assert.equal(await page.getByLabel('ISR del médico').inputValue(), '0.1');
  assert.equal(await page.getByLabel('Retención IVA del médico').inputValue(), String(2 / 3));
  assert.equal(await page.getByLabel('Vigencia fiscal').inputValue(), ''); assert.equal(await page.getByLabel('IVA habitual', { exact: true }).inputValue(), '');
  await page.getByLabel('RFC del médico').fill('AAAB800101AAA'); await page.getByRole('button', { name: 'Actualizar SAP', exact: true }).click();
  await page.getByRole('button', { name: 'Actualizar SAP', exact: true }).waitFor();
  assert.equal(directoryReads, 2); assert.equal(await page.getByLabel('RFC del médico').inputValue(), 'AAAB800101AAA');
  await page.getByLabel('Vigencia fiscal').fill('2026-01-01'); await page.getByLabel('IVA habitual', { exact: true }).selectOption('0.16');
  await page.getByLabel('ISR del médico').selectOption('0.0125'); await page.getByLabel('Retención IVA del médico').selectOption('0');
  await page.getByRole('heading', { name: 'Datos fiscales de médicos' }).click();
  await page.locator('.hon-fiscal-panel').screenshot({ path: path.join(output, '02-editar-sap.png') });
  await page.locator('.hon-fiscal-panel form').screenshot({ path: path.join(output, '05-ficha-interna.png') });
  await page.getByRole('button', { name: 'Guardar datos fiscales', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Datos guardados internamente' }).waitFor();
  assert.match(await group('Listos con SAP').innerText(), /0$/); assert.match(await group('Configurados internamente').innerText(), /2$/);
  assert.equal(profiles[1].federalTaxId, 'AAAB800101AAA'); assert.equal(profiles[1].isrRate, .0125); assert.equal(profiles[1].vatFraction, 0);
  assert.equal(JSON.stringify(doctors), originalSap, 'SAP conserva sus datos');
  await page.getByRole('button', { name: 'Copiar datos de SAP a la ficha', exact: true }).click();
  assert.equal(await page.getByLabel('RFC del médico').inputValue(), 'AAAA800101AAA');
  assert.equal(profiles[1].federalTaxId, 'AAAB800101AAA', 'copiar no guarda automáticamente');
  await page.getByText('Opciones e historial', { exact: true }).click();
  await page.getByRole('checkbox', { name: 'Usar esta ficha interna para calcular impuestos' }).uncheck();
  await page.getByRole('button', { name: 'Guardar datos fiscales', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Ficha interna desactivada' }).waitFor();
  assert.match(await group('Listos con SAP').innerText(), /1$/); assert.match(await group('Configurados internamente').innerText(), /1$/);
  await page.getByRole('button', { name: 'Ver historial', exact: true }).click(); await page.getByText(/Versión 2/).waitFor();
  assert.equal(versions.length, 2);
  await page.getByRole('button', { name: 'Copiar datos de SAP a la ficha', exact: true }).click();
  await page.getByLabel('Vigencia fiscal').fill('2026-01-01'); await page.getByLabel('IVA habitual', { exact: true }).selectOption('0.16');
  failSave = true; await page.getByRole('button', { name: 'Guardar datos fiscales', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Otra persona cambió' }).waitFor();
  assert.equal(await page.getByLabel('RFC del médico').inputValue(), 'AAAA800101AAA');
  assert.equal(profiles[1].revision, 2); assert.equal(writes[2].expectedRevision, 2);
  delayHistory = true;
  const historyRequest = page.waitForRequest(request => request.url().endsWith('/fiscal-profiles/1/history'));
  await page.getByRole('button', { name: 'Ver historial', exact: true }).click(); await historyRequest;
  await group('Por completar').click(); await select.selectOption('2');
  await page.waitForFunction(() => document.querySelector('[aria-label="Retención IVA del médico"]').value === '');
  const oldResponse = page.waitForResponse(response => response.url().endsWith('/fiscal-profiles/1/history'));
  releaseHistory(); await oldResponse;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.getByText(/HISTORIAL MEDICO ANTERIOR/).count(), 0, 'Una respuesta lenta no muestra el historial de otro médico');
  delayHistory = false;
  assert.equal(await page.getByLabel('Retención IVA del médico').inputValue(), '');
  await page.getByText('SAP permite servicios sin IVA.', { exact: false }).waitFor();
  await page.locator('.hon-fiscal-panel').screenshot({ path: path.join(output, '03-sap-parcial.png') });
  await page.getByLabel('Buscar médico fiscal').fill('sin sap'); assert.equal(await select.locator('option').count(), 3, 'resultado más selección actual');
  await select.selectOption('3'); await page.waitForFunction(() => document.querySelector('[aria-label="RFC del médico"]').value === '');
  assert.equal(await page.getByLabel('RFC del médico').inputValue(), '');
  await page.getByLabel('Buscar médico fiscal').fill('ambigua'); await select.selectOption('6');
  assert.equal(await page.getByLabel('RFC del médico').inputValue(), '');
  unavailable = true; await page.getByRole('button', { name: 'Actualizar SAP', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'No se pudo consultar SAP' }).waitFor();
  assert.match(await group('Listos con SAP').innerText(), /0$/); assert.match(await group('Configurados internamente').innerText(), /1$/);
  for (const width of [320, 390, 768]) { await page.setViewportSize({ width, height: 1050 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Desbordamiento ${width}`); }
  await page.setViewportSize({ width: 390, height: 1050 });
  await page.screenshot({ path: path.join(output, '04-movil.png'), fullPage: true });
  // La consulta inicial no debe reemplazar una elección manual de grupo.
  unavailable = false; delayDirectory = true;
  const initialDirectoryRequest = page.waitForRequest(request => request.url().includes('/fiscal-directory'));
  await page.goto(`${server.resolvedUrls.local[0]}__categorias?provider=1`); await initialDirectoryRequest;
  const all = page.getByRole('button', { name: 'Ver todos (6)', exact: true });
  await page.getByLabel('Buscar médico fiscal').fill('sin sap');
  await all.click();
  const initialDirectoryResponse = page.waitForResponse(response => response.url().includes('/fiscal-directory'));
  releaseDirectory(); await initialDirectoryResponse;
  await group('Listos con SAP').filter({ hasText: '1' }).waitFor();
  assert.equal(await all.getAttribute('aria-pressed'), 'true', 'Una consulta SAP tardía conserva Ver todos');
  assert.equal(await page.getByLabel('Buscar médico fiscal').inputValue(), '', 'Ver todos limpia la búsqueda anterior');
  assert.equal(await select.locator('option').count(), providers.length + 1, 'Ver todos incluye médicos de los tres grupos');
  assert.ok(Number(await select.getAttribute('size')) > 1, 'Ver todos despliega una lista visible');
  assert.equal(await select.inputValue(), '1', 'Ver todos conserva al médico seleccionado');
  await page.getByLabel('RFC del médico').fill('AAAC800101AAA');
  await group('Por completar').click(); await all.click();
  assert.equal(await page.getByLabel('RFC del médico').inputValue(), 'AAAC800101AAA', 'Cambiar de grupo conserva la captura del mismo médico');
  assert.equal(writes.length, 3, 'Los filtros no guardan ni modifican fichas fiscales');
  await page.locator('.hon-fiscal-panel').screenshot({ path: path.join(output, '06-ver-todos-movil.png') });
  await page.setViewportSize({ width: 1250, height: 1050 });
  const groupedDirectoryRequest = page.waitForRequest(request => request.url().includes('/fiscal-directory'));
  await page.goto(`${server.resolvedUrls.local[0]}__categorias?provider=1`); await groupedDirectoryRequest;
  await group('Configurados internamente').click();
  const groupedDirectoryResponse = page.waitForResponse(response => response.url().includes('/fiscal-directory'));
  releaseDirectory(); await groupedDirectoryResponse;
  await group('Listos con SAP').filter({ hasText: '1' }).waitFor();
  assert.equal(await group('Configurados internamente').getAttribute('aria-pressed'), 'true', 'Una consulta SAP tardía conserva el grupo elegido');
  await all.click();
  await page.locator('.hon-fiscal-panel').screenshot({ path: path.join(output, '07-ver-todos-escritorio.png') });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Ver todos sin desbordamiento');
  // Un directorio del tamaño reportado también permite llegar al último médico.
  providers.push(...Array.from({ length: 260 }, (_, index) => ({ id: index + 7, name: `MÉDICO ADICIONAL ${index + 7}` })));
  delayDirectory = false;
  await page.goto(`${server.resolvedUrls.local[0]}__categorias`);
  await group('Listos con SAP').filter({ hasText: '1' }).waitFor();
  await page.getByRole('button', { name: 'Ver todos (266)', exact: true }).click();
  assert.equal(await select.locator('option').count(), 267);
  assert.equal(await select.getAttribute('size'), '8', 'El directorio completo ocupa ocho filas y permite desplazarse');
  await select.press('End');
  assert.equal(await select.inputValue(), '266', 'El último médico también se puede elegir con el teclado');
  await page.getByLabel('Buscar médico fiscal').fill('adicional 266');
  assert.equal(await select.locator('option').count(), 2, 'La búsqueda también filtra el directorio desplegado');
  await page.getByRole('button', { name: 'Ver todos (266)', exact: true }).click();
  assert.equal(await select.locator('option').count(), 267);
  assert.equal(await select.inputValue(), '266');
  assert.deepEqual(errors, []); assert.equal(writes.length, 3);
  console.log('PASS: grupos, conteos, Ver todos visible, elección manual durante consulta SAP, captura conservada al filtrar, SAP completo/parcial/ambiguo, precarga, edición interna, actualización sin perder captura, vuelta a SAP, historial, vigencia futura, indisponibilidad y móvil.');
} finally { if (browser) await browser.close(); await server.close(); }
