// Esperas, cancelaciones y resultados tardíos sintéticos; no se crea ni registra un pago real.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '../tmp/honorarios-payment-recovery');
await mkdir(output, { recursive: true });
const provider = { id: 7, name: 'MÉDICO DE PRUEBA DE RECUPERACIÓN' };
const line = { rowId: 'BI|PCBL|7|CARGO', providerId: 7, providerName: provider.name, role: 'TRATANTE',
  description: 'SERVICIO SINTÉTICO', quantity: 1, netAmount: 180, adjustmentAmount: 0, paidAmount: 0, balance: 180 };
const liquidation = id => ({ id, provider_id: 7, start_date: '2026-08-01', end_date: '2026-08-31',
  snapshot: { totalNet: 180, fiscalNote: 'Cálculo sintético confirmado.' }, lines: [{ ...line }],
  payments: [], adjustments: [], totalPaid: 0, balance: 180 });
const listing = record => ({ id: record.id, provider_id: record.provider_id, start_date: record.start_date,
  end_date: record.end_date, lines: record.lines.length, total_net: 180 });
const report = id => ({ liquidation: { id }, status: 'REVIEW_REQUIRED',
  issues: [{ code: 'SYNTHETIC_REVIEW', message: 'Revisión sintética antes de descargar el PDF.' }] });
const availableReport = body => {
  const totals = { base: 180, vat: 0, isr: 0, vatWithholding: 0, net: 180 };
  return { version: 1, status: 'AVAILABLE', currency: 'MXN', generatedAt: '2026-10-08T18:00:00Z',
    period: { startDate: body.startDate, endDate: body.endDate }, totals,
    doctors: [{ providerId: 7, providerName: provider.name, fiscal: { ready: true }, totals,
      lines: [{ ...line, serviceDate: body.startDate, unitAmount: 180, baseAmount: 180, vatRate: 0, vat: 0, isr: 0, vatWithholding: 0, netAmount: 180 }] }] };
};
const server = await createServer({ configFile: false, root, appType: 'custom', plugins: [react(), {
  name: 'payment-recovery-isolated', configureServer(server) { server.middlewares.use('/__payment_recovery', async (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    const html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:20px}.hon-card{background:var(--surface-raised,#fff);border:1px solid var(--table-border,#ddd);border-radius:12px}</style></head><body><div id="root"></div><script type="module">import React from "react";import{createRoot}from"react-dom/client";import Panel from "/src/components/honorarios/HonorariosLiquidationsPanel.jsx";import"/src/styles/globals.css";import"/src/components/honorarios/HonorariosReviewToolbar.css";window.fiscalRequests=[];const query=new URLSearchParams(location.search),owner=query.get("owner")||"7";createRoot(document.getElementById("root")).render(React.createElement(Panel,{startDate:query.get("start")||"2026-08-01",endDate:query.get("end")||"2026-08-31",initialProviderId:"7",preparationOwnerId:owner,canManage:true,onViewApproved:()=>{},onEditFiscal:id=>window.fiscalRequests.push(id)}));</script></body></html>';
    res.end(await server.transformIndexHtml('/__payment_recovery', html));
  }); }
}], server: { host: '127.0.0.1', port: 0 } });
let browser;
const errors = [];
const storageKey = 'honorarios_pending_preparation_7';
async function createCase({ postMode = 'stuck', blockList = false, blockBaseline = false, blockReport = false, failures = [] } = {}) {
  const page = await browser.newPage({ viewport: { width: 1250, height: 1000 } });
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
  await page.clock.install();
  const signals = {}, waits = {};
  for (const name of ['post', 'list', 'report']) waits[name] = new Promise(resolve => { signals[name] = resolve; });
  const state = { posts: 0, lists: 0, details: [], reports: 0, records: [], postMode, blockList, blockBaseline, blockReport, waits,
    failures: [...failures], releasePost: null, releaseList: null, releaseReport: null };
  const fulfill = async (route, response) => {
    try { await route.fulfill(response); } catch (error) { if (!route.request().failure()) throw error; }
  };
  await page.route('**/api/honorarios/**', async route => {
    const url = new URL(route.request().url()), endpoint = url.pathname.replace('/api/honorarios', '');
    const method = route.request().method();
    if (endpoint === '/providers') await fulfill(route, { json: { providers: [provider] } });
    else if (endpoint === '/available-payment-report') await fulfill(route, { json: { report: availableReport(route.request().postDataJSON()) } });
    else if (endpoint === '/liquidations' && method === 'POST') {
      state.posts++;
      signals.post();
      const body = route.request().postDataJSON();
      assert.equal(body.startDate, '2026-08-01'); assert.equal(body.endDate, '2026-08-31'); assert.equal(body.providerId, '7');
      const failure = state.failures.shift();
      if (failure) { await fulfill(route, failure); return; }
      if (state.postMode === 'stuck') await new Promise(resolve => { state.releasePost = resolve; });
      const created = liquidation(44);
      if (!state.records.some(record => record.id === 44)) state.records.push(created);
      await fulfill(route, { json: { liquidation: created } });
    } else if (endpoint === '/liquidations') {
      state.lists++;
      if ((state.blockList && state.posts && state.lists > 2) || (state.blockBaseline && state.lists === 2)) await new Promise(resolve => { state.releaseList = resolve; signals.list(); });
      await fulfill(route, { json: { liquidations: state.records.map(listing) } });
    } else if (/^\/liquidations\/\d+\/payment-report$/.test(endpoint)) {
      state.reports++;
      if (state.blockReport) await new Promise(resolve => { state.releaseReport = resolve; signals.report(); });
      await fulfill(route, { json: { report: report(Number(endpoint.split('/')[2])) } });
    } else if (/^\/liquidations\/\d+$/.test(endpoint)) {
      const id = Number(endpoint.split('/')[2]); state.details.push(id);
      await fulfill(route, { json: { liquidation: state.records.find(record => record.id === id) || liquidation(id) } });
    } else throw new Error(`Petición no prevista: ${method} ${endpoint}`);
  });
  await page.goto(`${server.resolvedUrls.local[0]}__payment_recovery`);
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Generar PDF para pago' && !button.disabled));
  return { page, state };
}
const generate = page => page.getByRole('button', { name: 'Generar PDF para pago', exact: true });
const refresh = page => page.locator('button').filter({ hasText: /^Consultar pagos preparados$/ });
const downloadPdf = page => page.getByRole('button', { name: 'Descargar PDF para pago', exact: true });
const advanceDeadline = async page => { await page.clock.fastForward(120001); };

try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const url = `${server.resolvedUrls.local[0]}__payment_recovery`;
  {
    const { page, state } = await createCase();
    const postStarted = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/liquidations'));
    await generate(page).dblclick(); await postStarted; await state.waits.post;
    assert.equal(state.posts, 1, 'El doble clic sólo envía un POST');
    assert.equal(await page.getByLabel('Cierre desde').isDisabled(), true);
    await advanceDeadline(page);
    await page.getByRole('alert').filter({ hasText: 'No se pudo confirmar si el pago quedó preparado' }).waitFor();
    assert.equal(await generate(page).isDisabled(), true);
    assert.ok(await page.evaluate(key => sessionStorage.getItem(key), storageKey));
    await refresh(page).click();
    await page.getByRole('status').filter({ hasText: 'Todavía no se puede confirmar' }).waitFor();
    assert.equal(state.posts, 1, 'Una lista vacía no provoca reenvío');
    await page.reload();
    await page.getByRole('status').filter({ hasText: 'La preparación sigue sin confirmar' }).waitFor();
    assert.equal(await generate(page).isDisabled(), true, 'Recargar conserva la incertidumbre');
    await page.goto(`${url}?owner=8`);
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Generar PDF para pago' && !button.disabled));
    assert.ok(await page.evaluate(key => sessionStorage.getItem(key), storageKey), 'La marca queda en su cuenta original');
    await page.goto(`${url}?owner=7&start=2026-10-01&end=2026-10-31`);
    await page.getByRole('status').filter({ hasText: 'La preparación sigue sin confirmar' }).waitFor();
    await page.getByRole('status').filter({ hasText: /MÉDICO DE PRUEBA DE RECUPERACIÓN.*01\/08\/2026 al 31\/08\/2026/ }).waitFor();
    await page.screenshot({ path: path.join(output, '00-preparacion-pendiente.png'), fullPage: true });
    state.records.push(liquidation(44)); state.releasePost();
    assert.equal(await page.getByRole('heading', { name: /^Pago #44/ }).count(), 0, 'Una respuesta tardía no modifica la pantalla');
    await refresh(page).click();
    await page.getByRole('heading', { name: /^Pago #44/ }).waitFor();
    assert.equal(state.posts, 1); assert.deepEqual(state.details, [44]);
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), storageKey), null);
    await page.screenshot({ path: path.join(output, '01-preparacion-recuperada.png'), fullPage: true });
    await page.close();
    console.log('PASS: POST sin respuesta, doble clic, bloqueo por cuenta y recuperación GET de resultado tardío.');
  }
  {
    const { page, state } = await createCase({ postMode: 'success', blockList: true });
    await generate(page).click();
    await page.getByRole('status').filter({ hasText: 'Actualizando pagos preparados…' }).waitFor();
    await page.getByRole('heading', { name: /^Pago #44/ }).waitFor();
    await state.waits.list;
    await advanceDeadline(page);
    await page.getByRole('alert').filter({ hasText: 'La consulta tardó demasiado' }).waitFor();
    assert.equal(state.posts, 1); assert.equal(await downloadPdf(page).isEnabled(), true);
    state.blockList = false; state.releaseList();
    state.blockReport = true;
    await downloadPdf(page).click();
    await page.getByRole('status').filter({ hasText: 'Comprobando el PDF para pago…' }).waitFor();
    await state.waits.report;
    await advanceDeadline(page);
    await page.getByRole('alert').filter({ hasText: 'La consulta tardó demasiado' }).waitFor();
    state.blockReport = false; state.releaseReport();
    assert.equal(await page.getByText('Revisión sintética antes de descargar el PDF.', { exact: true }).count(), 0,
      'Un GET tardío no aplica datos después de detener la espera');
    await downloadPdf(page).click();
    await page.getByText('Revisión sintética antes de descargar el PDF.', { exact: true }).waitFor();
    assert.equal(state.posts, 1, 'Recuperar un cierre conocido sólo vuelve a consultar');
    await page.evaluate(() => {
      window.originalRecoveryFetch = window.fetch;
      window.fetch = (...args) => String(args[0]).endsWith('/payment-report')
        ? Promise.resolve({ ok: true, json: () => new Promise(() => {}) }) : window.originalRecoveryFetch(...args);
    });
    await downloadPdf(page).click();
    await page.getByRole('status').filter({ hasText: 'Comprobando el PDF para pago…' }).waitFor();
    await advanceDeadline(page);
    await page.getByRole('alert').filter({ hasText: 'La consulta tardó demasiado' }).waitFor();
    assert.equal(await downloadPdf(page).isEnabled(), true, 'El deadline también limita JSON que ignora AbortSignal');
    assert.equal(state.posts, 1);
    await page.close();
    console.log('PASS: ID conocido, timeout de lista/GET PDF/JSON y recuperación sin POST duplicado.');
  }
  {
    const { page, state } = await createCase({ postMode: 'success', blockBaseline: true });
    await generate(page).click(); await state.waits.list;
    await page.getByRole('button', { name: 'Detener espera', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'La espera se detuvo' }).waitFor();
    assert.equal(state.posts, 0, 'Detener la consulta previa no envía el POST');
    assert.equal(await generate(page).isEnabled(), true);
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), storageKey), null,
      'La consulta previa cancelada no deja una preparación incierta');
    state.blockBaseline = false; state.releaseList();
    await generate(page).click();
    await page.getByText('Revisión sintética antes de descargar el PDF.', { exact: true }).waitFor();
    assert.equal(state.posts, 1);
    await page.close();
    console.log('PASS: cancelar la lista previa al POST permite reintentar sin crear incertidumbre.');
  }
  {
    const { page, state } = await createCase({ postMode: 'success', failures: [
      { status: 404, json: { error: 'No fue posible consultar el detalle del cierre.' } }
    ] });
    await generate(page).click();
    await page.getByRole('alert').filter({ hasText: 'No se pudo confirmar si el pago quedó preparado' }).waitFor();
    assert.equal(await generate(page).isDisabled(), true, 'Un 4xx sin metadata no demuestra que no hubo creación');
    await refresh(page).click();
    await page.getByRole('status').filter({ hasText: 'Todavía no se puede confirmar' }).waitFor();
    assert.equal(state.posts, 1);
    await page.close();
    console.log('PASS: 4xx sin NOT_CREATED conserva el bloqueo y consulta sólo por GET.');
  }
  {
    const { page, state } = await createCase({ postMode: 'success', failures: [
      { status: 400, json: { error: 'Falta completar los datos fiscales del médico.', preparationStatus: 'NOT_CREATED' } },
      { status: 504, json: { error: 'La consulta de impuestos tardó demasiado. Intenta nuevamente.', code: 'HONORARIOS_SAP_TIMEOUT', preparationStatus: 'NOT_CREATED' } }
    ] });
    await generate(page).click();
    await page.getByRole('button', { name: 'Completar datos fiscales', exact: true }).waitFor();
    assert.equal(await generate(page).isEnabled(), true);
    await page.getByRole('button', { name: 'Completar datos fiscales', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.fiscalRequests), ['7']);
    await generate(page).click();
    await page.getByRole('alert').filter({ hasText: 'La consulta de impuestos tardó demasiado' }).waitFor();
    assert.equal(await generate(page).isEnabled(), true, 'NOT_CREATED permite otro intento explícito');
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), storageKey), null);
    await generate(page).click();
    await page.getByText('Revisión sintética antes de descargar el PDF.', { exact: true }).waitFor();
    assert.equal(state.posts, 3, 'Cada fallo definitivo se reintenta solamente al pulsar el botón');
    await page.close();
    console.log('PASS: 4xx fiscal y 504 NOT_CREATED permiten corregir/reintentar manualmente.');
  }
  {
    const { page, state } = await createCase();
    const started = page.waitForRequest(request => request.method() === 'POST');
    await generate(page).click(); await started; await state.waits.post;
    await page.getByRole('button', { name: 'Detener espera', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'No se pudo confirmar si el pago quedó preparado' }).waitFor();
    state.records.push(liquidation(44), liquidation(45)); state.releasePost();
    await refresh(page).click();
    await page.getByRole('status').filter({ hasText: 'Hay varios pagos preparados' }).waitFor();
    assert.deepEqual(state.details, [], 'Varios resultados exactos no se eligen automáticamente');
    await page.getByLabel('Liquidación cerrada', { exact: true }).selectOption('45');
    await page.getByRole('heading', { name: /^Pago #45/ }).waitFor();
    assert.equal(state.posts, 1); assert.deepEqual(state.details, [45]);
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), storageKey), null);
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.screenshot({ path: path.join(output, '02-seleccion-explicita-mobile.png'), fullPage: true });
    await page.close();
    console.log('PASS: detener espera y selección explícita cuando existen varios cierres candidatos.');
  }
  assert.deepEqual(errors, []);
  console.log('PASS: recuperación acotada de preparar pago, sin operaciones reales ni reenvíos automáticos.');
} finally { await browser?.close(); await server.close(); }
