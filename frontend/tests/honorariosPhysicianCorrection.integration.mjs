import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';
import { reviewFingerprint } from '../src/utils/honorariosCalculation.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '../tmp/honorarios-physician-correction');
await mkdir(output, { recursive: true });
const providers = [{ id: 7, name: 'MÉDICO CORRECTO' }, { id: 8, name: 'MÉDICO ORIGINAL' }];
const rows = [8, 7, 8].map((doctor, index) => ({ ModeBI: true, TipoCalculo: 'BI_PRESTACION',
  SourceIdentity: `BI|SOLN|${91 + index}|ORDEN`, SourceType: 'SOLN', SourceLineId: 91 + index,
  OccurrenceId: 'ORDEN', UDRKey: `BI|SOLN|${91 + index}|ORDEN`, SourceFingerprint: `source-${index}`,
  FolioAtencion: null, FolioCita: null, FolioOrdenVenta: 181 + index, FechaAtencion: '2026-09-02',
  GrupoServicio: 'CONSULTA EXTERNA', CodigoServicio: 'SER1471', Servicio: 'CONSULTA DE ESPECIALIDAD',
  Paciente: `PACIENTE PRUEBA ${index + 1}`, MedicoId: doctor, Medico: providers.find(p => p.id === doctor).name,
  RolMedico: 'TRATANTE', Cantidad: 1, CantidadOriginal: 1, CantidadMaxima: 1, MedicoConfirmado: true,
  EjecucionConfirmada: true, CantidadConfirmada: true, PrecioCobradoPaciente: 1500, CatalogStatus: 'INCLUIDO',
  CatalogApproved: true, ReviewEligible: true, CatalogSnapshot: { itemCode: 'SER1471', revision: 1, status: 'INCLUIDO' },
  TariffSnapshot: { id: 51, revision: 1, amount: 250 }, PrecioUnitarioBI: 250, BaseImporte: 250, IvaLinea: 0,
  ElegiblePago: 0, EstadoVertical: null }));
const reviews = {};
const writes = [];
const createReview = (row, decision) => {
  const provider = providers.find(p => p.id === Number(decision.providerId));
  const physicianCorrection = provider.id !== row.MedicoId ? { fromProviderId: row.MedicoId,
    fromProviderName: row.Medico, toProviderId: provider.id, toProviderName: provider.name,
    reason: decision.physicianChangeReason.trim(), correctedBy: { id: 71, name: 'REVISOR PRUEBA', username: 'revisor' },
    correctedAt: '2026-10-08T18:00:00.000Z' } : undefined;
  return { ...decision, fingerprint: reviewFingerprint(row), revision: 1, reviewer: '71: REVISOR PRUEBA',
    timestamp: '2026-10-08T18:00:00.000Z', customAmount: 250,
    snapshot: { rowId: row.SourceIdentity, providerId: provider.id, providerName: provider.name, quantity: 1,
      role: 'TRATANTE', baseAmount: 250, unitAmount: 250, itemCode: row.CodigoServicio, description: row.Servicio,
      serviceDate: row.FechaAtencion, tariff: row.TariffSnapshot, catalog: row.CatalogSnapshot,
      ...(physicianCorrection ? { physicianCorrection } : {}) } };
};
const server = await createServer({ configFile: false, root, cacheDir: path.join(output, 'vite-cache'), appType: 'custom',
  plugins: [react(), { name: 'physician-correction-preview', configureServer(vite) {
    vite.middlewares.use('/__corrections', async (_req, res) => {
      const html = await vite.transformIndexHtml('/__corrections', `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
        import React from 'react'; import {createRoot} from 'react-dom/client';
        import {AuthProvider} from '/src/context/AuthContext.jsx'; import View from '/src/components/honorarios/HonorariosAuditView.jsx';
        import '/src/styles/globals.css'; createRoot(document.getElementById('root')).render(React.createElement(AuthProvider,null,React.createElement(View)));
      </script></body></html>`);
      res.setHeader('Content-Type', 'text/html'); res.end(html);
    });
  } }], server: { host: '127.0.0.1', port: 5198, strictPort: true, hmr: false } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => sessionStorage.setItem('escandon_token', 'local-correction-test'));
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const endpoint = url.pathname.replace('/api/honorarios', ''), method = request.method();
    const body = method === 'GET' ? {} : request.postDataJSON();
    let result = { ok: true };
    if (url.pathname === '/api/auth/me') result.user = { id: 71, role: 'ADMIN', nombre: 'REVISOR PRUEBA', username: 'revisor', permisos: ['interconsultas-jornadas'] };
    else if (endpoint === '/providers') result.providers = providers;
    else if (endpoint === '/fiscal-profiles') result.profiles = {};
    else if (endpoint === '/audit') result.data = rows;
    else if (endpoint === '/reviews' && method === 'GET') Object.assign(result, { reviews, canReview: true });
    else if (endpoint === '/approval-preview') result.row = { ...rows.find(r => r.SourceIdentity === body.rowId), BaseImporte: 250, TariffSnapshot: { id: 51, revision: 1 } };
    else if (endpoint === '/reviews/bulk-preview') result.rows = body.rows.map(input => {
      const source = rows.find(r => r.SourceIdentity === input.rowId);
      const provider = providers.find(p => p.id === Number(body.providerId || input.providerId));
      return { ...input, providerId: provider.id, providerName: provider.name, customAmount: 250,
        quotedTariffId: 51, quotedTariffRevision: 1, fingerprint: reviewFingerprint(source) };
    });
    else if (endpoint === '/reviews' && method === 'PUT') {
      writes.push(body); const source = rows.find(r => r.SourceIdentity === body.rowId);
      result.review = createReview(source, body.decision); reviews[body.rowId] = result.review;
    } else if (endpoint === '/reviews/bulk') {
      writes.push(body); result.reviews = {};
      for (const input of body.rows) {
        const source = rows.find(r => r.SourceIdentity === input.rowId);
        result.reviews[input.rowId] = createReview(source, { ...body.decision, ...input });
      }
      Object.assign(reviews, result.reviews); result.errors = []; result.savedCount = body.rows.length;
    } else if (endpoint === '/sap-reconciliation') { result.providers = {}; result.additionalProviders = []; }
    await route.fulfill({ json: result });
  });
  const search = async () => {
    await page.locator('input[type=date]').nth(0).fill('2026-09-01');
    await page.locator('input[type=date]').nth(1).fill('2026-09-30');
    await page.getByRole('button', { name: 'Buscar servicios', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.includes('Buscar servicios') && !button.disabled));
  };
  await page.goto(`${server.resolvedUrls.local[0]}__corrections`);
  await search();
  await page.getByRole('button', { name: 'Ver servicios de MÉDICO ORIGINAL · #8', exact: true }).click();
  await page.locator('[data-service-id="91"]').getByRole('button', { name: 'Aprobar', exact: true }).click();
  const individual = page.getByRole('dialog', { name: 'Aprobar honorario', exact: true });
  await individual.getByLabel('IVA confirmado', { exact: true }).selectOption('0');
  assert.equal(await individual.getByLabel('Motivo del cambio de médico', { exact: true }).count(), 0);
  assert.equal(await individual.getByRole('button', { name: 'Guardar aprobación', exact: true }).isEnabled(), true);
  await individual.getByText('Corregir médico o cantidad (opcional)', { exact: true }).click();
  await individual.getByLabel('Médico beneficiario', { exact: true }).selectOption('7');
  const reason = individual.getByLabel('Motivo del cambio de médico', { exact: true });
  assert.equal(await reason.getAttribute('required'), '');
  await reason.fill('   ');
  await individual.getByText('Honorario: $250.00', { exact: true }).waitFor();
  assert.equal(await individual.getByRole('button', { name: 'Guardar aprobación', exact: true }).isEnabled(), false);
  assert.equal(writes.length, 0, 'A blank correction note does not reach persistence');
  await reason.fill('Error de captura: el procedimiento fue realizado por el médico correcto.');
  await individual.getByRole('button', { name: 'Guardar aprobación', exact: true }).click();
  await individual.waitFor({ state: 'hidden' });
  assert.match(writes[0].decision.physicianChangeReason, /Error de captura/);

  await page.getByRole('button', { name: 'Aprobar pendientes de MÉDICO CORRECTO · #7', exact: true }).click();
  const bulk = page.getByRole('dialog', { name: 'Revisar selección', exact: true });
  await bulk.getByLabel('IVA de la selección', { exact: true }).selectOption('0');
  await bulk.getByText('Corregir médico de la selección (opcional)', { exact: true }).click();
  await bulk.getByLabel('Médico de la selección', { exact: true }).selectOption('7');
  assert.equal(await bulk.getByLabel('Motivo del cambio de médico', { exact: true }).count(), 0, 'Choosing the current physician does not require a correction reason');
  await bulk.getByRole('button', { name: 'Cancelar', exact: true }).click();
  if (await page.getByRole('button', { name: 'Ver servicios de MÉDICO CORRECTO · #7', exact: true }).count())
    await page.getByRole('button', { name: 'Ver servicios de MÉDICO CORRECTO · #7', exact: true }).click();
  await page.getByLabel('Seleccionar servicio 92', { exact: true }).check();
  await page.getByLabel('Seleccionar servicio 93', { exact: true }).check();
  await page.getByRole('button', { name: 'Aprobar selección', exact: true }).click();
  await bulk.getByLabel('IVA de la selección', { exact: true }).selectOption('0');
  await bulk.getByText('Corregir médico de la selección (opcional)', { exact: true }).click();
  await bulk.getByLabel('Médico de la selección', { exact: true }).selectOption('7');
  const bulkReason = bulk.getByLabel('Motivo del cambio de médico', { exact: true });
  await bulkReason.fill('   ');
  assert.equal(await bulk.getByRole('button', { name: 'Aprobar servicios', exact: true }).isEnabled(), false);
  await bulkReason.fill('Corrección de médico por captura incorrecta en el servicio 93.');
  await bulk.getByRole('button', { name: 'Aprobar servicios', exact: true }).click();
  await bulk.waitFor({ state: 'hidden' });
  assert.equal(writes.length, 2);
  assert.match(writes[1].decision.physicianChangeReason, /captura incorrecta/);
  assert.equal(rows[0].MedicoId, 8); assert.equal(rows[2].MedicoId, 8, 'Clinical source rows stay untouched');

  await page.getByRole('button', { name: 'Ir a Pagos y PDF', exact: true }).first().click();
  if (await page.getByRole('button', { name: 'Ver servicios de MÉDICO CORRECTO · #7', exact: true }).count())
    await page.getByRole('button', { name: 'Ver servicios de MÉDICO CORRECTO · #7', exact: true }).click();
  const corrected = page.locator('[data-service-id="91"]');
  await corrected.getByText('Corregido', { exact: true }).click();
  await corrected.getByText('REVISOR PRUEBA', { exact: false }).waitFor();
  assert.match(await corrected.innerText(), /Error de captura/);
  assert.equal(await page.locator('[data-service-id="92"]').getByText('Corregido', { exact: true }).count(), 0);
  assert.equal(await page.locator('[data-service-id="93"]').getByText('Corregido', { exact: true }).count(), 1);
  await corrected.screenshot({ path: path.join(output, 'corregido-claro.png') });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(350);
  await corrected.screenshot({ path: path.join(output, 'corregido-oscuro-mobile.png') });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.reload(); await search();
  await page.getByRole('button', { name: /^Todos \d/ }).click();
  await page.getByRole('button', { name: 'Ver servicios de MÉDICO CORRECTO · #7', exact: true }).click();
  await page.locator('[data-service-id="91"]').getByText('Corregido', { exact: true }).click();
  assert.match(await page.locator('[data-service-id="91"]').innerText(), /REVISOR PRUEBA/);
  assert.match(await page.locator('[data-service-id="91"]').innerText(), /Error de captura/);
  assert.deepEqual(errors, []);
  console.log('PASS: nota obligatoria individual/lote, espacios rechazados, mismo médico sin nota, Corregido con usuario/motivo, persistencia tras recarga, claro/oscuro y móvil.');
} catch (error) {
  console.error(error); throw error;
} finally { await browser?.close(); await server.close(); }
