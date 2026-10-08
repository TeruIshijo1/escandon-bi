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
const output = path.resolve(root, '../tmp/honorarios-qa/end-to-end');
await mkdir(output, { recursive: true });
const server = await createServer({ configFile: false, root, appType: 'custom', plugins: [react(), {
  name: 'honorarios-real-api-test', configureServer(server) {
    server.middlewares.use(harness.app);
    server.middlewares.use('/__honorarios_e2e', async (_req, res) => {
      const html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:Arial;margin:16px;background:#f1f5f9}input,select,button{font:inherit}</style></head><body><div id="root"></div><script type="module">import React from"react";import{createRoot}from"react-dom/client";import{AuthProvider}from"/src/context/AuthContext.jsx";import View from"/src/components/honorarios/HonorariosAuditView.jsx";createRoot(document.getElementById("root")).render(React.createElement(AuthProvider,null,React.createElement(View)));</script></body></html>';
      res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml('/__honorarios_e2e', html));
    });
  }
}], server: { host: '127.0.0.1', port: 0 } });
let browser, page;
try {
  await harness.start(); await server.listen(); browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => sessionStorage.setItem('escandon_token', 'qa-isolated'));
  await page.goto(`${server.resolvedUrls.local[0]}__honorarios_e2e`);
  await page.getByLabel('Desde', { exact: true }).fill('2026-09-01');
  await page.getByLabel('Hasta', { exact: true }).fill('2026-09-30');
  await page.getByRole('button', { name: 'Buscar servicios', exact: true }).click();
  await page.getByRole('heading', { name: 'No se encontraron registros', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Configuración', exact: true }).click();
  await page.getByRole('button', { name: 'Catálogo y precios', exact: true }).click();
  await page.getByRole('button', { name: 'Configurar SER1471', exact: true }).click();
  await page.getByLabel('Incluir en honorarios').selectOption('INCLUIDO');
  await page.getByRole('button', { name: 'Guardar configuración', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /Configuración guardada/ }).waitFor();
  await page.getByRole('button', { name: 'Agregar tarifa', exact: true }).click();
  await page.getByLabel('Honorario por unidad ($)', { exact: true }).fill('250');
  await page.getByLabel('Función del médico (opcional)', { exact: true }).selectOption('TRATANTE');
  await page.getByLabel('Se aplica desde', { exact: true }).fill('2026-09-01');
  await page.getByLabel('Se aplica hasta (opcional)', { exact: true }).fill('2026-08-31');
  const attempts = harness.state.tariffWrites;
  await page.getByRole('button', { name: 'Guardar tarifa', exact: true }).click();
  assert.equal(harness.state.tariffWrites, attempts, 'Una fecha final anterior no se envía al servidor');
  await page.getByLabel('Se aplica hasta (opcional)', { exact: true }).fill('2026-09-30');
  harness.state.failTariff = true;
  await page.getByRole('button', { name: 'Guardar tarifa', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'No se pudo guardar la tarifa de prueba' }).waitFor();
  assert.equal(await page.getByLabel('Honorario por unidad ($)', { exact: true }).inputValue(), '250');
  assert.equal(await page.getByLabel('Se aplica hasta (opcional)', { exact: true }).inputValue(), '2026-09-30');
  harness.state.failTariff = false;
  await page.getByRole('button', { name: 'Guardar tarifa', exact: true }).dblclick();
  await page.getByRole('status').filter({ hasText: /Tarifa guardada/ }).waitFor();
  assert.equal(harness.state.tariffWrites, attempts + 2, 'El doble clic no envía dos guardados');
  assert.equal((await harness.pool.query('SELECT COUNT(*)::int AS total FROM bi_honorarios_tariffs')).rows[0].total, 1);
  await page.getByRole('button', { name: 'Agregar tarifa', exact: true }).click();
  await page.getByLabel('Honorario por unidad ($)', { exact: true }).fill('300');
  await page.getByLabel('Función del médico (opcional)', { exact: true }).selectOption('TRATANTE');
  await page.getByLabel('Se aplica desde', { exact: true }).fill('2026-09-01');
  await page.getByLabel('Se aplica hasta (opcional)', { exact: true }).fill('2026-09-30');
  await page.getByRole('button', { name: 'Guardar tarifa', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: /Ya hay una tarifa/ }).waitFor();
  assert.equal((await harness.pool.query('SELECT COUNT(*)::int AS total FROM bi_honorarios_tariffs')).rows[0].total, 1);
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('button', { name: 'Servicios', exact: true }).click();
  const card = page.locator('.hon-doctor-simple').filter({ has: page.getByRole('heading', { name: 'MÉDICO FICTICIO · #7', exact: true }) });
  await card.getByRole('button', { name: 'Aprobar pendientes de MÉDICO FICTICIO · #7', exact: true }).click();
  await page.getByLabel('IVA de la selección', { exact: true }).selectOption('0.16');
  await page.getByRole('button', { name: 'Aprobar servicios', exact: true }).click();
  await page.getByRole('button', { name: 'Pagos y PDF', exact: true }).click();
  await card.getByRole('button', { name: 'Completar datos fiscales', exact: true }).click();
  await page.getByLabel('RFC del médico').fill('AAAA800101AAA');
  await page.getByLabel('Régimen fiscal del médico').fill('612');
  await page.getByLabel('Vigencia fiscal').fill('2026-01-01');
  await page.getByLabel('IVA habitual', { exact: true }).selectOption('0.16');
  await page.getByLabel('ISR del médico').selectOption('0.1');
  await page.getByLabel('Retención IVA del médico').selectOption(String(2 / 3));
  await page.getByRole('button', { name: 'Guardar datos fiscales', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Datos guardados internamente' }).waitFor();
  await page.getByRole('button', { name: 'Pagos y PDF', exact: true }).click();
  await card.getByRole('button', { name: 'Preparar pago y PDF', exact: true }).click();
  const firstPdf = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Generar PDF para pago', exact: true }).click();
  await (await firstPdf).saveAs(path.join(output, 'pago-inicial.pdf'));
  await page.getByRole('heading', { name: 'Pago #1 · Neto $238.33 · Pagado $0.00 · Saldo $238.33', exact: true }).waitFor();
  assert.ok((await readFile(path.join(output, 'pago-inicial.pdf'))).toString('latin1').includes('238.33'));
  await page.getByText('Registrar un pago ya realizado', { exact: true }).click();
  await page.getByLabel('Importe del pago', { exact: true }).fill('100');
  await page.getByLabel('Referencia del pago', { exact: true }).fill('COMPROBANTE-QA');
  await page.getByRole('button', { name: 'Guardar pago realizado', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Pago registrado' }).waitFor();
  await page.getByRole('heading', { name: 'Pago #1 · Neto $238.33 · Pagado $100.00 · Saldo $138.33', exact: true }).waitFor();
  const paid = await harness.pool.query('SELECT amount FROM bi_honorarios_payment_applications');
  assert.equal(paid.rows.reduce((total, row) => total + Number(row.amount), 0), 100);
  await page.getByLabel('Importe del pago', { exact: true }).fill('1');
  await page.getByLabel('Referencia del pago', { exact: true }).fill('COMPROBANTE-QA');
  await page.getByRole('button', { name: 'Guardar pago realizado', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: /ya fue registrado/ }).waitFor();
  const finalPdf = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar PDF para pago', exact: true }).click();
  await (await finalPdf).saveAs(path.join(output, 'pago-saldo.pdf'));
  assert.ok((await readFile(path.join(output, 'pago-saldo.pdf'))).toString('latin1').includes('138.33'));
  await page.screenshot({ path: path.join(output, 'pago-validado.png'), fullPage: true });
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `El pago cabe a ${width}px`);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: navegador conectado a API y PostgreSQL reales aislados: configuración, fechas, funciones, reintento, duplicados, aprobación, impuestos, cierre, pagos y PDF.');
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'fallo.png'), fullPage: true }); throw error;
} finally {
  await browser?.close(); await server.close(); await harness.close();
}
