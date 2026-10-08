// UI, API y PostgreSQL aislados. Fuentes clínicas ficticias; sin pagos reales.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';
const require = createRequire(import.meta.url);
const harness = require('../../backend/tests/fixtures/honorariosBrowserHarness.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '../tmp/honorarios-monthly-flow');
await mkdir(output, { recursive: true });
const server = await createServer({ configFile: false, root, appType: 'custom', plugins: [react(), {
  name: 'monthly-real-api', configureServer(server) {
    server.middlewares.use(harness.app);
    server.middlewares.use('/__monthly_flow', async (_req, res) => {
      const html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:Arial;margin:16px;background:#f1f5f9}input,select,button{font:inherit}</style></head><body><div id="root"></div><script type="module">import React from"react";import{createRoot}from"react-dom/client";import{AuthProvider}from"/src/context/AuthContext.jsx";import View from"/src/components/honorarios/HonorariosAuditView.jsx";createRoot(document.getElementById("root")).render(React.createElement(AuthProvider,null,React.createElement(View)));</script></body></html>';
      res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml('/__monthly_flow', html));
    });
  }
}], server: { host: '127.0.0.1', port: 0 } });
let browser, page;
try {
  await harness.start(); await server.listen(); browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => sessionStorage.setItem('escandon_token', 'qa-isolated'));
  const baseUrl = server.resolvedUrls.local[0];
  const api = async (method, endpoint, data, expected = 200) => {
    const response = await page.request.fetch(`${baseUrl}api/honorarios${endpoint}`, { method, data });
    const body = await response.json();
    assert.equal(response.status(), expected, JSON.stringify(body)); return body;
  };
  await api('PUT', '/fiscal-profiles/7', { expectedRevision: 0, enabled: true,
    federalTaxId: 'AAAA800101AAA', fiscalRegime: '612', validFrom: '2026-01-01',
    defaultVatRate: 0, isrRate: 0, vatFraction: 0 });
  await page.goto(`${baseUrl}__monthly_flow`);
  await page.getByLabel('Desde', { exact: true }).fill('2026-10-15');
  await page.getByLabel('Hasta', { exact: true }).fill('2026-10-20');
  await page.getByRole('button', { name: 'Configuración', exact: true }).click();
  await page.getByRole('button', { name: 'Jefes de área', exact: true }).click();
  await page.getByRole('button', { name: 'Agregar jefe de área', exact: true }).click();
  await page.getByLabel('Médico del pago mensual', { exact: true }).selectOption('7');
  // El filtro de cargos clínicos no debe ocultar un pago fijo autorizado por su configuración.
  await page.getByLabel('Área del jefe', { exact: true }).fill('SERVICIOS ADMINISTRATIVOS');
  await page.getByLabel('Pago mensual antes de impuestos', { exact: true }).fill('2500');
  await page.getByLabel('Aplicar desde el mes', { exact: true }).fill('2026-10');
  await page.getByLabel('Confirmo que el médico seleccionado corresponde a esta jefatura.').check();
  await page.getByRole('button', { name: 'Guardar pago mensual', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'guardado' }).waitFor();
  assert.equal((await api('GET', '/monthly-fixed')).assignments.length, 1);
  await page.getByRole('button', { name: 'Servicios', exact: true }).click();
  await page.getByRole('button', { name: 'Buscar servicios', exact: true }).click();
  const card = page.locator('.hon-doctor-simple').filter({ has: page.getByRole('heading', { name: 'MÉDICO FICTICIO · #7', exact: true }) });
  await card.waitFor();
  assert.equal(await card.getByRole('button', { name: /^Aprobar pendientes/ }).count(), 0, 'El pago opcional no entra en aprobación conjunta');
  await card.getByRole('button', { name: /^Ver servicios de/ }).click();
  assert.equal(await card.locator('input[type=checkbox]').count(), 0);
  await card.getByRole('button', { name: 'Incluir pago mensual', exact: true }).click();
  await page.getByRole('heading', { name: 'Incluir pago fijo mensual', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Médico beneficiario', { exact: true }).count(), 0);
  assert.equal(await page.getByLabel('Cantidad reconocida', { exact: true }).count(), 0);
  await page.getByLabel('IVA confirmado', { exact: true }).selectOption('0');
  await page.getByRole('button', { name: 'Guardar aprobación', exact: true }).click();
  await page.getByRole('heading', { name: 'No se encontraron registros', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Pagos y PDF', exact: true }).click();
  await card.getByText(/Pago fijo mensual aprobado:/).waitFor();
  assert.equal((await api('GET', '/reviews?startDate=2026-10-15&endDate=2026-10-20')).reviews['FIXED|7|2026-10'].action, 'APROBAR');
  const pdf = page.waitForEvent('download');
  await card.getByRole('button', { name: 'Descargar PDF detallado', exact: true }).click();
  await (await pdf).saveAs(path.join(output, 'fijo-aprobado.pdf'));
  assert.ok((await readFile(path.join(output, 'fijo-aprobado.pdf'))).toString('latin1').includes('2,500.00'));
  await page.reload();
  await page.getByLabel('Desde', { exact: true }).fill('2026-10-25');
  await page.getByLabel('Hasta', { exact: true }).fill('2026-10-30');
  await page.getByRole('button', { name: 'Buscar servicios', exact: true }).click();
  await page.getByRole('heading', { name: 'No se encontraron registros', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Pagos y PDF', exact: true }).click();
  await card.getByText(/Pago fijo mensual aprobado:/).waitFor();
  await page.screenshot({ path: path.join(output, 'aprobado.png'), fullPage: true });
  await card.getByRole('button', { name: 'Preparar pago y PDF', exact: true }).click();
  const paymentPdf = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Generar PDF para pago', exact: true }).click();
  await (await paymentPdf).saveAs(path.join(output, 'fijo-pago.pdf'));
  await page.getByRole('heading', { name: 'Pago #1 · Neto $2,500.00 · Pagado $0.00 · Saldo $2,500.00', exact: true }).waitFor();
  const ledger = await harness.pool.query('SELECT row_id,snapshot FROM bi_honorarios_finalized_rows');
  assert.equal(ledger.rows.length, 1); assert.equal(ledger.rows[0].row_id, 'FIXED|7|2026-10');
  assert.equal(ledger.rows[0].snapshot.baseAmount, 2500);
  const second = await api('POST', '/liquidations', { startDate: '2026-10-01', endDate: '2026-10-07',
    providerId: '7', confirmed: true, reason: 'No duplicar el pago mensual' }, 400);
  assert.match(second.error, /No hay/);
  await page.screenshot({ path: path.join(output, 'pago.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: UI/API/PG: alta vinculada al médico, fijo opcional completo, IVA explícito, persistencia entre cortes parciales, cero consultas, aprobado PDF, cierre y no duplicar el mes.');
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'fallo.png'), fullPage: true }); throw error;
} finally { await browser?.close(); await server.close(); await harness.close(); }
