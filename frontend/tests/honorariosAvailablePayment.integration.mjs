// SAP permanece sin responder; los PDF reales se descargan desde aprobaciones y datos locales sintéticos.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';
import { reviewFingerprint } from '../src/utils/honorariosCalculation.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '../tmp/honorarios-available-payment');
await mkdir(output, { recursive: true });
const providers = [{ id: 7, name: 'MÉDICO DE PRUEBA SEPTIEMBRE' }, { id: 8, name: 'MÉDICO DE PRUEBA OCTUBRE' }];
const row = { ModeBI: true, TipoCalculo: 'BI_PRESTACION', SourceIdentity: 'BI|SOLN|91|ORDEN',
  SourceType: 'SOLN', SourceLineId: 91, OccurrenceId: 'ORDEN', UDRKey: 'BI|SOLN|91|ORDEN',
  FolioAtencion: null, FolioCita: null, FolioOrdenVenta: 181, FechaAtencion: '2026-09-02',
  GrupoServicio: 'CONSULTA EXTERNA', CodigoServicio: 'SER1471', Servicio: 'SERVICIO SEPTIEMBRE',
  Paciente: 'PACIENTE SINTÉTICO', MedicoId: 7, Medico: providers[0].name, RolMedico: 'TRATANTE',
  Cantidad: 1, CantidadOriginal: 1, CantidadMaxima: 1, MedicoConfirmado: true,
  EjecucionConfirmada: true, CantidadConfirmada: true, CatalogStatus: 'INCLUIDO',
  CatalogApproved: true, ReviewEligible: true,
  CatalogSnapshot: { itemCode: 'SER1471', revision: 1, status: 'INCLUIDO' },
  TariffSnapshot: { id: 51, revision: 1, amount: 250 }, PrecioUnitarioBI: 250, BaseImporte: 250,
  IvaLinea: 0, ElegiblePago: 0, EstadoVertical: null };
const reviews = { [row.SourceIdentity]: { action: 'APROBAR', fingerprint: reviewFingerprint(row), revision: 1,
  reviewer: 'REVISOR SINTÉTICO', vatRate: .16, customAmount: 250,
  snapshot: { rowId: row.SourceIdentity, providerId: 7, providerName: providers[0].name,
    quantity: 1, role: 'TRATANTE', baseAmount: 250, unitAmount: 250, itemCode: row.CodigoServicio,
    description: row.Servicio, serviceDate: row.FechaAtencion, tariff: row.TariffSnapshot, catalog: row.CatalogSnapshot } } };
const availableReport = body => {
  const provider = providers.find(item => String(item.id) === String(body.providerId));
  const totals = { base: 250, vat: 40, isr: null, vatWithholding: null, net: null };
  return { version: 1, status: 'FISCAL_PENDING', currency: 'MXN', generatedAt: '2026-10-08T18:00:00Z',
    period: { startDate: body.startDate, endDate: body.endDate }, totals,
    doctors: [{ providerId: provider.id, providerName: provider.name, fiscal: { federalTaxId: null, fiscalRegime: null, ready: false }, totals,
      lines: [{ rowId: `FRESH|${provider.id}|${body.startDate}`, providerId: provider.id, providerName: provider.name,
        description: body.startDate.startsWith('2026-10') ? 'SERVICIO FRESCO OCTUBRE' : row.Servicio,
        serviceDate: body.startDate, quantity: 1, unitAmount: 250, baseAmount: 250, vatRate: .16,
        vat: 40, isr: null, vatWithholding: null, netAmount: null }] }] };
};
const server = await createServer({ configFile: false, root, appType: 'custom', cacheDir: path.join(output, 'vite-cache'),
  plugins: [react(), { name: 'available-payment-isolated', configureServer(vite) {
    vite.middlewares.use('/__available_payment', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(await vite.transformIndexHtml('/__available_payment', '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import React from "react";import{createRoot}from"react-dom/client";import{AuthProvider}from"/src/context/AuthContext.jsx";import View from "/src/components/honorarios/HonorariosAuditView.jsx";import"/src/styles/globals.css";createRoot(document.getElementById("root")).render(React.createElement(AuthProvider,null,React.createElement(View)));</script></body></html>'));
    });
  } }], server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
  page.setDefaultTimeout(10000);
  const errors = [], availableBodies = [], sapBodies = []; let creates = 0, lists = 0, wrongPeriod = false, sapOption = '', closed = null;
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => sessionStorage.setItem('escandon_token', 'synthetic-available-payment'));
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const endpoint = url.pathname.replace('/api/honorarios', ''), body = method === 'GET' ? {} : request.postDataJSON();
    let result = { ok: true };
    if (url.pathname === '/api/auth/me') result.user = { id: 71, role: 'ADMIN', nombre: 'REVISOR SINTÉTICO', username: 'revisor', permisos: ['interconsultas-jornadas'] };
    else if (endpoint === '/providers') result.providers = providers;
    else if (endpoint === '/fiscal-profiles') result.profiles = {};
    else if (endpoint === '/audit') result.data = [row];
    else if (endpoint === '/reviews' && method === 'GET') Object.assign(result, { reviews, canReview: true });
    else if (endpoint === '/sap-reconciliation') { assert.equal(body.scope, 'fiscal'); sapBodies.push(body); return; }
    else if (endpoint === '/available-payment-report') {
      availableBodies.push(body); result.report = availableReport(body);
      if (wrongPeriod) result.report.period.startDate = '2026-08-01';
    } else if (endpoint === '/liquidations' && method === 'GET') {
      lists++; result.liquidations = closed ? [{ id: 31, provider_id: 8, start_date: closed.start_date, end_date: closed.end_date, lines: 1, total_net: 238.33 }] : [];
    } else if (endpoint === '/liquidations' && method === 'POST') {
      creates++;
      if (sapOption === 'timeout') {
        await route.fulfill({ status: 504, json: { error: 'No se pudieron consultar los datos fiscales de SAP. Intenta nuevamente.', preparationStatus: 'NOT_CREATED', code: 'HONORARIOS_SAP_TIMEOUT' } }); return;
      }
      if (sapOption !== 'success') throw Error('Un reporte fiscal pendiente no debe crear un cierre.');
      const line = availableReport(body).doctors[0].lines[0];
      closed = { id: 31, provider_id: 8, start_date: body.startDate, end_date: body.endDate,
        snapshot: { totalNet: 238.33, fiscalNote: 'Impuestos sintéticos confirmados con la configuración fiscal SAP.' },
        lines: [{ ...line, isr: 25, vatWithholding: 26.67, netAmount: 238.33, adjustmentAmount: 0, paidAmount: 0, balance: 238.33 }],
        payments: [], adjustments: [], totalPaid: 0, balance: 238.33 };
      result.liquidation = closed;
    } else if (endpoint === '/liquidations/31/payment-report') {
      const totals = { base: 250, vat: 40, isr: 25, vatWithholding: 26.67, net: 238.33, adjustments: 0, paid: 0, balance: 238.33, payable: 238.33 };
      result.report = { version: 1, status: 'READY', currency: 'MXN', generatedAt: '2026-10-08T18:00:00Z', issues: [], totals,
        liquidation: { id: 31, startDate: closed.start_date, endDate: closed.end_date, createdAt: '2026-10-08T18:00:00Z', createdBy: 'REVISOR SINTÉTICO', fiscalNote: closed.snapshot.fiscalNote },
        doctors: [{ providerId: 8, providerName: providers[1].name, lines: closed.lines, payments: [], adjustments: [], totals }] };
    }
    else throw Error(`Petición no prevista: ${method} ${endpoint}`);
    await route.fulfill({ json: result });
  });
  const saveDownload = async (button, filename) => {
    const event = page.waitForEvent('download'); await button.click();
    const file = path.join(output, filename); await (await event).saveAs(file);
    assert.ok((await readFile(file)).byteLength > 1000); return file;
  };
  await page.goto(`${server.resolvedUrls.local[0]}__available_payment`);
  await page.locator('#hon-period-start').fill('2026-09-01'); await page.locator('#hon-period-end').fill('2026-09-30');
  await page.getByRole('button', { name: 'Buscar servicios', exact: true }).click();
  await page.getByRole('button', { name: 'Pagos y PDF', exact: true }).click();
  const doctor = page.locator('.hon-doctor-simple').filter({ has: page.getByRole('heading', { name: 'MÉDICO DE PRUEBA SEPTIEMBRE · #7', exact: true }) });
  await doctor.waitFor();
  assert.equal(sapBodies.length, 1);
  for (const [label, filename] of [['Descargar PDF detallado', 'aprobados-detallado-sap-pendiente.pdf'], ['Descargar PDF resumido', 'aprobados-resumido-sap-pendiente.pdf']]) {
    const button = doctor.getByRole('button', { name: label, exact: true }); assert.equal(await button.isEnabled(), true);
    await saveDownload(button, filename);
  }
  await doctor.getByRole('button', { name: 'Preparar pago y PDF', exact: true }).click();
  const generate = page.getByRole('button', { name: 'Generar PDF para pago', exact: true });
  const firstFile = await saveDownload(generate, 'disponible-septiembre.pdf');
  await page.getByRole('status').filter({ hasText: 'Falta completar los datos fiscales' }).waitFor();
  assert.equal(creates, 0); assert.equal(lists, 1, 'Sólo se consultó la lista inicial; el reporte pendiente evita baseline y cierre');
  assert.equal(availableBodies.length, 1);
  assert.deepEqual(availableBodies[0], { startDate: '2026-09-01', endDate: '2026-09-30', providerId: '7' });
  const firstText = (await readFile(firstFile)).toString('latin1'); assert.match(firstText, /Pendiente/);
  assert.equal(await page.getByRole('button', { name: 'Completar datos fiscales', exact: true }).isEnabled(), true);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('honorarios_pending_preparation_71')), null);
  await page.screenshot({ path: path.join(output, 'pdf-disponible-fiscal-pendiente.png'), fullPage: true });

  await page.getByText('Cambiar médico o fechas (opcional)', { exact: true }).click();
  await page.getByLabel('Cierre desde', { exact: true }).fill('2026-10-01'); await page.getByLabel('Cierre hasta', { exact: true }).fill('2026-10-31');
  await page.locator('form').filter({ has: generate }).locator('select').selectOption('8');
  const currentFile = await saveDownload(generate, 'disponible-octubre-medico8.pdf');
  assert.deepEqual(availableBodies[1], { startDate: '2026-10-01', endDate: '2026-10-31', providerId: '8' });
  const currentText = (await readFile(currentFile)).toString('latin1');
  assert.ok(currentText.includes('SERVICIO FRESCO OCTUBRE')); assert.equal(currentText.includes('SERVICIO SEPTIEMBRE'), false);
  assert.equal(creates, 0); assert.equal(await generate.isEnabled(), true);
  let unexpectedDownloads = 0; const countDownload = () => unexpectedDownloads++;
  page.on('download', countDownload); wrongPeriod = true;
  await generate.click();
  await page.getByRole('alert').filter({ hasText: 'No se pudieron confirmar los servicios' }).waitFor();
  assert.equal(unexpectedDownloads, 0, 'Un periodo que no corresponde se bloquea antes de descargar');
  assert.equal(creates, 0); page.off('download', countDownload); wrongPeriod = false;
  const fallback = await saveDownload(page.getByRole('button', { name: 'PDF de servicios aprobados', exact: true }), 'alternativo-octubre-medico8.pdf');
  assert.deepEqual(availableBodies.at(-1), { startDate: '2026-10-01', endDate: '2026-10-31', providerId: '8' });
  assert.ok((await readFile(fallback)).toString('latin1').includes('SERVICIO FRESCO OCTUBRE'),
    'El PDF alternativo vuelve a consultar las fechas actuales sin reutilizar el callback del mes anterior');
  await page.setViewportSize({ width: 390, height: 1000 }); await page.screenshot({ path: path.join(output, 'pdf-disponible-mobile.png'), fullPage: true });
  assert.equal(creates, 0); assert.equal(sapBodies.length, 1); assert.deepEqual(errors, []);
  console.log('PASS: SAP sin respuesta no bloquea detallado/resumido ni PDF disponible automático, fiscal null permanece pendiente y no se crea cierre.');
  console.log('PASS: médico y fechas actuales se consultan de nuevo; reporte equivocado no descarga, PDF alternativo fresco y móvil.');
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.getByText('Opciones para preparar el pago', { exact: true }).click();
  const prepareWithSap = page.getByRole('button', { name: 'Preparar pago con datos de SAP', exact: true });
  sapOption = 'timeout';
  await prepareWithSap.click();
  await page.getByRole('alert').filter({ hasText: 'No se pudieron consultar los datos fiscales de SAP' }).waitFor();
  assert.equal(await prepareWithSap.isEnabled(), true, 'NOT_CREATED permite un nuevo intento explícito con SAP');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('honorarios_pending_preparation_71')), null);
  assert.ok((await readFile(currentFile)).byteLength > 1000, 'El PDF disponible anterior sigue descargado');
  assert.equal(creates, 1); assert.equal(closed, null);
  await page.screenshot({ path: path.join(output, 'sap-opcional-no-creado.png'), fullPage: true });
  sapOption = 'success';
  const paymentFile = await saveDownload(prepareWithSap, 'pago-completo-sap-opcional.pdf');
  await page.getByRole('heading', { name: /^Pago #31/ }).waitFor();
  assert.equal(creates, 2, 'Los dos intentos con SAP requieren clic explícito');
  assert.equal(await page.getByRole('button', { name: 'Preparar pago con datos de SAP', exact: true }).count(), 0,
    'La opción deja de ofrecer otra preparación al confirmar el cierre');
  assert.ok((await readFile(paymentFile)).byteLength > 1000); assert.deepEqual(errors, []);
  console.log('PASS: vía SAP opcional sólo por clic explícito, NOT_CREATED conserva PDF/aprobaciones y reintento genera cierre y PDF de pago completo.');
} finally { await browser?.close(); await server.close(); }
