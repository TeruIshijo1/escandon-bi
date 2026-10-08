import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';
import { calculateHonorarios, reviewFingerprint, summarizeHonorarios } from '../src/utils/honorariosCalculation.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '../tmp/honorarios-fiscal');
await mkdir(output, { recursive: true });
const providerName = 'MÉDICO  DE PRUEBA';
const providers = [{ id: 144, name: providerName }, { id: 145, name: 'OTRO MÉDICO DE PRUEBA' }];
const tariff = { id: 1, revision: 1, amount: 225, active: true, itemCode: 'SER1', providerId: null, role: 'TRATANTE', validFrom: '2026-01-01', validTo: null };
const sources = Array.from({ length: 9 }, (_, index) => ({ ModeBI: true, TipoCalculo: 'BI_PRESTACION',
  SourceIdentity: `BI|SOLN|${index + 1}|ORDEN`, SourceType: 'SOLN', SourceLineId: index + 1, OccurrenceId: 'ORDEN',
  UDRKey: `BI|SOLN|${index + 1}|ORDEN`, RenglonAuditoria: 1, SourceFingerprint: `source-${index}`,
  MedicoId: index < 8 ? 144 : 145, Medico: index < 8 ? providerName : providers[1].name,
  CodigoServicio: 'SER1', Servicio: 'SESIÓN DE PSICOLOGÍA', GrupoServicio: 'CONSULTA EXTERNA', Especialidad: 'PSICOLOGÍA',
  Paciente: `PACIENTE DE EJEMPLO ${index + 1}`, Cantidad: 1, CantidadMaxima: 1, RolMedico: 'TRATANTE',
  FechaAtencion: '2026-10-02', FolioOrdenVenta: index + 100, BaseImporte: 225, IvaLinea: null, TasaISR: 0.1,
  CatalogStatus: 'INCLUIDO', CatalogApproved: true, ReviewEligible: true, PrecioUnitarioBI: 225,
  CatalogSnapshot: { itemCode: 'SER1', status: 'INCLUIDO', revision: 1 }, TariffSnapshot: tariff, EjecucionConfirmada: true }));
let profiles = {}, reviews = {}, saved = null, auditReads = 0, reviewReads = 0, reviewReadIssue = false, payIssue = false, closeWrites = 0;
const report = () => {
  const totals = { base: 1800, vat: 288, isr: 180, vatWithholding: 192, net: 1716, adjustments: 0,
    paid: saved.totalPaid, balance: saved.balance, payable: payIssue ? 0 : saved.balance };
  return { version: 1, currency: 'MXN', status: payIssue ? 'REVIEW_REQUIRED' : 'READY', generatedAt: '2026-10-05T17:00:00Z',
    issues: payIssue ? [{ message: 'Cambió la atención. Revisa el servicio.', code: 'SOURCE_CHANGED' }] : [],
    liquidation: { id: 1, startDate: '2026-10-01', endDate: '2026-10-05', createdAt: '2026-10-05T16:00:00Z', createdBy: 'REVISOR DE EJEMPLO', fiscalNote: 'Ficha interna confirmada.', sapAsOf: '2026-10-05T16:00:00Z' },
    totals, doctors: [{ providerId: 144, providerName, totals, lines: saved.lines, payments: saved.payments, adjustments: [] }] };
};
const server = await createServer({ configFile: false, root, appType: 'custom', plugins: [react(), {
  name: 'fiscal-isolated', configureServer(server) { server.middlewares.use('/__fiscal', async (_req, res) => {
    res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml('/__fiscal', '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:Arial;margin:16px;background:#f1f5f9}button,input,select{font:inherit}</style></head><body><div id="root"></div><script type="module">import React from "react";import{createRoot}from"react-dom/client";import{AuthProvider}from"/src/context/AuthContext.jsx";import View from "/src/components/honorarios/HonorariosAuditView.jsx";createRoot(document.getElementById("root")).render(React.createElement(AuthProvider,null,React.createElement(View)));</script></body></html>'));
  }); }
}], server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 }, acceptDownloads: true });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => sessionStorage.setItem('escandon_token', 'prueba-aislada'));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: 7, nombre: 'REVISOR DE EJEMPLO', role: 'ADMIN', permisos: ['interconsultas-jornadas'] } } }));
  await page.route('**/api/honorarios/**', async route => {
    const url = new URL(route.request().url()), endpoint = url.pathname.replace('/api/honorarios', '');
    const method = route.request().method(), body = method === 'GET' ? {} : route.request().postDataJSON();
    let result = { ok: true }, status = 200;
    if (endpoint === '/providers') result.providers = providers;
    else if (endpoint === '/fiscal-profiles') result.profiles = profiles;
    else if (endpoint === '/fiscal-directory') Object.assign(result, { sapAvailable: true, date: url.searchParams.get('date'), asOf: '2026-10-05T16:00:00Z', doctors: providers.map(item => ({ providerId: String(item.id), sapReady: false, reasons: ['No se encontró una coincidencia única en SAP. Completa su ficha interna.'], suggestedProfile: {}, sap: { linkStatus: 'sin_coincidencia', candidates: [] } })) });
    else if (endpoint === '/fiscal-profiles/144' && method === 'PUT') {
      result.profile = profiles[144] = { ...body, source: 'BI_INTERNO', providerId: '144', providerName, confirmed: true,
        revision: body.expectedRevision + 1, updatedBy: '7: REVISOR DE EJEMPLO', updatedAt: '2026-10-05T16:00:00Z' };
    } else if (endpoint.endsWith('/history')) result.history = [];
    else if (endpoint === '/audit') { auditReads++; result.data = sources.map(row => saved?.lines.some(line => line.rowId === row.SourceIdentity)
      ? { ...row, LiquidacionCerrada: 1, SnapshotCierre: saved.lines.find(line => line.rowId === row.SourceIdentity) } : row); result.coverage = { omittedFromReview: 0 }; }
    else if (endpoint === '/reviews' && method === 'GET') {
      reviewReads++;
      if (reviewReadIssue) { status = 503; result.error = 'No se pudieron consultar las aprobaciones guardadas. Intenta de nuevo.'; }
      else Object.assign(result, { reviews, canReview: true });
    }
    else if (endpoint === '/reviews/bulk-preview') result.rows = body.rows.map(input => ({ ...input, providerId: 144,
      providerName, customAmount: 225, quotedTariffId: 1, quotedTariffRevision: 1, fingerprint: reviewFingerprint(sources.find(row => row.SourceIdentity === input.rowId)) }));
    else if (endpoint === '/reviews/bulk') {
      result.reviews = Object.fromEntries(body.rows.map(input => [input.rowId, { ...body.decision,
        fingerprint: input.fingerprint, revision: input.expectedRevision + 1, reviewer: 'REVISOR DE EJEMPLO' }]));
      Object.assign(reviews, result.reviews); result.savedCount = body.rows.length; result.errors = [];
    } else if (endpoint === '/sap-reconciliation') { result.providers = Object.fromEntries(body.doctors.map(name => [name, { linkStatus: 'sin_coincidencia', candidates: [], invoices: [] }])); result.additionalProviders = []; }
    else if (endpoint === '/liquidations') {
      if (method === 'GET') result.liquidations = saved ? [{ id: 1, provider_id: '144', start_date: '2026-10-01', end_date: '2026-10-05', lines: 8, total_net: 1716 }] : [];
      else if (!profiles[144]?.enabled) { status = 400; result.error = 'Completa los datos fiscales del médico para preparar su pago.'; }
      else {
        closeWrites++;
        const calculated = calculateHonorarios(sources, reviews, {}, '', profiles).filter(row => row.MedicoId === 144);
        const lines = calculated.map(row => ({ rowId: row._rowId, providerId: 144, providerName, description: row.Servicio,
          serviceDate: '2026-10-02', role: 'TRATANTE', tariff, catalog: row.CatalogSnapshot, salesOrder: row.FolioOrdenVenta, quantity: 1, unitAmount: 225,
          baseAmount: 225, vat: row._effectiveIVA, vatRate: 0.16, isr: row._effectiveISR, vatWithholding: row._effectiveRetIVA,
          netAmount: row._effectiveNeto, isrRate: 0.1, paidAmount: 0, balance: row._effectiveNeto, adjustmentAmount: 0 }));
        saved = { id: 1, provider_id: '144', lines, payments: [], adjustments: [], totalPaid: 0, balance: 1716,
          snapshot: { totalBase: 1800, totalNet: 1716, fiscalNote: 'Ficha interna confirmada.', lines } }; result.liquidation = saved;
      }
    } else if (endpoint === '/liquidations/1/payment-report') result.report = report();
    else if (endpoint === '/liquidations/1') result.liquidation = saved;
    else if (endpoint === '/liquidations/1/provider-payment') {
      assert.equal(body.providerId, '144'); let remaining = body.amount;
      for (const line of saved.lines) { const applied = Math.min(remaining, line.balance); if (!applied) continue;
        line.paidAmount += applied; line.balance = Math.round((line.balance - applied) * 100) / 100; remaining = Math.round((remaining - applied) * 100) / 100;
        saved.payments.push({ id: saved.payments.length + 1, liquidation_id: 1, row_id: line.rowId, amount: applied, payment_date: body.paymentDate,
          reference: body.reference, reason: 'Pago registrado', created_by: 'REVISOR DE EJEMPLO', created_at: '2026-10-05T16:30:00Z' }); }
      saved.totalPaid += body.amount; saved.balance -= body.amount; result.liquidation = saved;
    } else throw Error(`API inesperada: ${method} ${endpoint}`);
    await route.fulfill({ status, json: result });
  });
  await page.goto(`${server.resolvedUrls.local[0]}__fiscal`);
  await page.addStyleTag({ content: '* { transition: none !important; animation: none !important; }' });
  await page.locator('#hon-period-start').fill('2026-10-01'); await page.locator('#hon-period-end').fill('2026-10-05');
  await page.getByRole('button', { name: 'Buscar servicios', exact: true }).click();
  const doctor = page.locator('.hon-doctor-simple').filter({ has: page.getByRole('heading', { name: /#144$/ }) });
  await doctor.getByRole('button', { name: /Aprobar pendientes/ }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByLabel('IVA de la selección').selectOption('0.16');
  await dialog.screenshot({ path: path.join(output, '02-aprobar-iva.png') });
  await dialog.getByRole('button', { name: 'Aprobar servicios', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  assert.equal(Object.keys(reviews).length, 8); assert.ok(Object.values(reviews).every(review => review.vatRate === 0.16));
  assert.equal(await doctor.count(), 0, 'El médico sin pendientes desaparece de Servicios inmediatamente aunque su neto siga sin calcular');
  assert.equal(await page.getByLabel('Seleccionar servicio 1', { exact: true }).count(), 0);
  const approvalsBeforeReload = Object.keys(reviews).sort(), reviewReadsBeforeReload = reviewReads;
  reviewReadIssue = true;
  await page.reload();
  await page.addStyleTag({ content: '* { transition: none !important; animation: none !important; }' });
  await page.locator('#hon-period-start').fill('2026-10-01'); await page.locator('#hon-period-end').fill('2026-10-05');
  await page.getByRole('button', { name: 'Buscar servicios', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'No se pudieron consultar las aprobaciones guardadas.' }).waitFor();
  assert.equal(await page.locator('.hon-doctor-simple').count(), 0, 'Si falla la lectura de aprobaciones no presenta atenciones guardadas como pendientes nuevas');
  assert.equal(await page.getByRole('button', { name: /Aprobar pendientes/ }).count(), 0, 'Una lectura fallida no permite aprobar de nuevo');
  await page.screenshot({ path: path.join(output, '02b-consulta-aprobaciones-fallida.png'), fullPage: true });
  reviewReadIssue = false;
  await page.getByRole('button', { name: 'Buscar servicios', exact: true }).click();
  await page.getByRole('heading', { name: /#145$/ }).waitFor();
  assert.ok(reviewReads > reviewReadsBeforeReload, 'La nueva consulta vuelve a leer las aprobaciones persistidas');
  assert.deepEqual(Object.keys(reviews).sort(), approvalsBeforeReload);
  assert.equal(await doctor.count(), 0, 'Volver a consultar conserva el médico aprobado fuera de Servicios');
  await page.screenshot({ path: path.join(output, '02c-servicios-solo-pendientes.png'), fullPage: true });
  const readsBefore = auditReads;
  await page.getByRole('button', { name: /^Aprobados \d/ }).click();
  await doctor.waitFor();
  assert.equal(await page.locator('.hon-friendly-summary .hon-total-value').innerText(), '8 servicios', 'Aprobados recupera los ocho guardados sin exigir datos fiscales');
  await page.getByRole('button', { name: 'Servicios', exact: true }).click();
  assert.equal(await doctor.count(), 0, 'Cambiar de Aprobados a Servicios no vuelve a ponerlos en Por revisar');
  await page.getByRole('button', { name: 'Pagos y PDF', exact: true }).click();
  await doctor.waitFor();
  assert.equal(auditReads, readsBefore);
  assert.equal(await page.locator('.hon-friendly-summary .hon-total-value').innerText(), '8 servicios', 'Pagos y PDF conserva los aprobados mientras contabilidad completa la ficha');
  await doctor.getByText('Contabilidad debe completar', { exact: false }).waitFor();
  assert.deepEqual(await page.locator('.hon-friendly-nav button').allTextContents(), ['Servicios', 'Pagos y PDF', 'Auditoría', 'Configuración']);
  assert.equal(await page.getByRole('button', { name: 'Pagos y PDF', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.screenshot({ path: path.join(output, '03-pagos-y-pdf.png'), fullPage: true });
  let download = page.waitForEvent('download'); await doctor.getByRole('button', { name: 'Descargar PDF detallado', exact: true }).click();
  await (await download).saveAs(path.join(output, 'aprobados-iva-pendiente.pdf'));
  await doctor.getByRole('button', { name: 'Preparar pago y PDF', exact: true }).click();
  await page.getByRole('button', { name: 'Generar PDF para pago', exact: true }).click();
  await page.getByRole('button', { name: 'Completar datos fiscales', exact: true }).click();
  assert.equal(await page.getByLabel('Médico fiscal', { exact: true }).inputValue(), '144');
  await page.getByLabel('RFC del médico').fill('AAAA800101AAA'); await page.getByLabel('Régimen fiscal del médico').fill('612');
  await page.getByLabel('Vigencia fiscal').fill('2026-01-01'); await page.getByLabel('IVA habitual', { exact: true }).selectOption('0.16');
  await page.getByLabel('ISR del médico').selectOption('0.1'); await page.getByLabel('Retención IVA del médico').selectOption(String(2 / 3));
  await page.locator('.hon-fiscal-panel').screenshot({ path: path.join(output, '04-datos-fiscales.png') });
  await page.getByRole('button', { name: 'Guardar datos fiscales', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Datos guardados internamente' }).waitFor();
  assert.equal(profiles[144].isrRate, 0.1); assert.equal(auditReads, readsBefore);
  for (const width of [320, 390]) { await page.setViewportSize({ width, height: 1000 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); }
  await page.setViewportSize({ width: 1300, height: 1000 });
  await page.getByRole('button', { name: 'Volver al pago', exact: true }).click();
  download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Generar PDF para pago', exact: true }).click();
  await (await download).saveAs(path.join(output, 'pago-interno-iva16.pdf')); assert.equal(closeWrites, 1);
  await page.getByRole('heading', { name: /Pago #1/ }).waitFor();
  await page.screenshot({ path: path.join(output, '05-pago-preparado.png'), fullPage: true });
  await page.getByText('Registrar un pago ya realizado', { exact: true }).click();
  await page.getByLabel('Importe del pago', { exact: true }).fill('1000'); await page.getByLabel('Referencia del pago', { exact: true }).fill('TRANSFERENCIA-EJEMPLO');
  await page.locator('details').filter({ has: page.getByText('Registrar un pago ya realizado', { exact: true }) }).last().screenshot({ path: path.join(output, '06-comprobante-medico.png') });
  await page.getByRole('button', { name: 'Guardar pago realizado', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Pago registrado' }).waitFor(); assert.equal(saved.balance, 716);
  download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Descargar PDF para pago', exact: true }).click();
  await (await download).saveAs(path.join(output, 'pago-saldo716.pdf'));
  let blockedDownloads = 0; page.on('download', () => blockedDownloads++); payIssue = true;
  await page.getByRole('button', { name: 'Descargar PDF para pago', exact: true }).click(); await page.getByRole('alert').filter({ hasText: 'necesita revisión' }).waitFor();
  assert.equal(blockedDownloads, 0);
  await page.getByRole('button', { name: 'Volver a los médicos', exact: true }).click();
  if (await doctor.getByRole('button', { name: /^Ver servicios de/ }).count()) await doctor.getByRole('button', { name: /^Ver servicios de/ }).click();
  await doctor.getByText('IVA 16%: $36.00', { exact: true }).first().waitFor();
  download = page.waitForEvent('download'); await doctor.getByRole('button', { name: 'Descargar PDF detallado', exact: true }).click();
  await (await download).saveAs(path.join(output, 'aprobados-iva16-completo.pdf'));
  await doctor.screenshot({ path: path.join(output, '07-servicios-iva.png') });
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.screenshot({ path: path.join(output, '08-movil.png'), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); assert.deepEqual(errors, []);
  console.log('PASS: aprobados persistidos fuera de Servicios y en Aprobados/Pagos con fiscal pendiente, consulta fallida sin reaprobación y reintento, IVA 16%, ficha interna, cierre, comprobante, saldo actualizado, bloqueo de fuentes cambiadas y móvil.');
} finally { await browser?.close(); await server.close(); }
