// Configuración fiscal y descargas reales con API sintética; sin consultar ni escribir datos de negocio.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import { reviewFingerprint, calculateHonorarios } from '../src/utils/honorariosCalculation.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '../tmp/honorarios-fiscal-scope');
await mkdir(output, { recursive: true });
const providers = [{ id: 7, name: 'MÉDICO FISCAL CONFIRMADO' }, { id: 8, name: 'MÉDICO FISCAL ORIGINAL' }];
const row = { ModeBI: true, TipoCalculo: 'BI_PRESTACION', SourceIdentity: 'BI|SOLN|91|ORDEN',
  SourceType: 'SOLN', SourceLineId: 91, OccurrenceId: 'ORDEN', UDRKey: 'BI|SOLN|91|ORDEN',
  FolioAtencion: null, FolioCita: null, FolioOrdenVenta: 181, FechaAtencion: '2026-09-02',
  GrupoServicio: 'CONSULTA EXTERNA', CodigoServicio: 'SER1471', Servicio: 'CONSULTA SINTÉTICA',
  Paciente: 'PACIENTE SINTÉTICO', MedicoId: 8, Medico: providers[1].name, RolMedico: 'TRATANTE',
  Cantidad: 1, CantidadOriginal: 1, CantidadMaxima: 1, MedicoConfirmado: true,
  EjecucionConfirmada: true, CantidadConfirmada: true, CatalogStatus: 'INCLUIDO',
  CatalogApproved: true, ReviewEligible: true,
  CatalogSnapshot: { itemCode: 'SER1471', revision: 1, status: 'INCLUIDO' },
  TariffSnapshot: { id: 51, revision: 1, amount: 250 }, PrecioUnitarioBI: 250, BaseImporte: 250,
  IvaLinea: 0, ElegiblePago: 0, EstadoVertical: null };
const candidate = id => ({ cardCode: `SYNTHETIC-${id}`, cardName: providers.find(provider => provider.id === id).name,
  federalTaxId: 'AAAA800101AAA', subjectToWithholding: true, configuredWithholdings: [
    { description: 'ISR', inactive: false, estimateRule: 'isr_on_fee', rate: 10, appliesAt: 'factura', codeEffectiveFrom: '2025-01-01' },
    { description: 'Retención IVA', inactive: false, estimateRule: 'vat_two_thirds', rate: 10.666667, appliesAt: 'factura', codeEffectiveFrom: '2025-01-01' }
  ] });
const fiscalProvider = id => ({ linkStatus: 'candidato_unico', candidates: [candidate(id)] });
const reviews = {}, sapBodies = [], writes = [];
let legacyResponse = false;
const server = await createServer({ configFile: false, root, appType: 'custom', cacheDir: path.join(output, 'vite-cache'),
  plugins: [react(), { name: 'fiscal-scope-isolated', configureServer(vite) {
    vite.middlewares.use('/__fiscal_scope', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(await vite.transformIndexHtml('/__fiscal_scope', '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import React from "react";import{createRoot}from"react-dom/client";import{AuthProvider}from"/src/context/AuthContext.jsx";import View from "/src/components/honorarios/HonorariosAuditView.jsx";import"/src/styles/globals.css";createRoot(document.getElementById("root")).render(React.createElement(AuthProvider,null,React.createElement(View)));</script></body></html>'));
    });
  } }], server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
  page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => sessionStorage.setItem('escandon_token', 'synthetic-fiscal-scope'));
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const endpoint = url.pathname.replace('/api/honorarios', '');
    const body = method === 'GET' ? {} : request.postDataJSON();
    let result = { ok: true };
    if (url.pathname === '/api/auth/me') result.user = { id: 71, role: 'ADMIN', nombre: 'REVISOR SINTÉTICO', username: 'revisor', permisos: ['interconsultas-jornadas'] };
    else if (endpoint === '/providers') result.providers = providers;
    else if (endpoint === '/fiscal-profiles') result.profiles = {};
    else if (endpoint === '/audit') result.data = [row];
    else if (endpoint === '/reviews' && method === 'GET') Object.assign(result, { reviews, canReview: true });
    else if (endpoint === '/approval-preview') result.row = { ...row, BaseImporte: 250, TariffSnapshot: row.TariffSnapshot };
    else if (endpoint === '/reviews' && method === 'PUT') {
      writes.push(body);
      const doctor = providers.find(provider => provider.id === Number(body.decision.providerId));
      result.review = { ...body.decision, fingerprint: reviewFingerprint(row), revision: 1, reviewer: '71: REVISOR SINTÉTICO',
        snapshot: { rowId: row.SourceIdentity, providerId: doctor.id, providerName: doctor.name, quantity: 1,
          role: 'TRATANTE', baseAmount: 250, unitAmount: 250, itemCode: row.CodigoServicio, description: row.Servicio,
          serviceDate: row.FechaAtencion, tariff: row.TariffSnapshot, catalog: row.CatalogSnapshot } };
      reviews[body.rowId] = result.review;
    } else if (endpoint === '/sap-reconciliation') {
      assert.equal(body.scope, 'fiscal', 'La pantalla solicita únicamente configuración fiscal');
      sapBodies.push(body);
      const matches = Object.fromEntries(body.doctors.map(name => {
        const doctor = providers.find(provider => provider.name === name);
        const provider = fiscalProvider(doctor.id);
        if (legacyResponse) Object.assign(provider, { invoices: [{ docEntry: 99, cancelled: false, lines: [] }], totalsByCurrency: [{ currency: 'MXN', openBalance: 999999 }] });
        return [name, provider];
      }));
      Object.assign(result, { providers: matches, additionalProviders: [], period: { startDate: body.startDate, endDate: body.endDate }, asOf: '2026-10-08T18:00:00Z',
        ...(legacyResponse ? {} : { documentsQueried: false }) });
    } else throw Error(`Petición no prevista: ${method} ${endpoint}`);
    await route.fulfill({ json: result });
  });
  const search = async () => {
    await page.locator('#hon-period-start').fill('2026-09-01'); await page.locator('#hon-period-end').fill('2026-09-30');
    await page.getByRole('button', { name: 'Buscar servicios', exact: true }).click();
  };
  await page.goto(`${server.resolvedUrls.local[0]}__fiscal_scope`); await search();
  await page.getByRole('button', { name: 'Ver servicios de MÉDICO FISCAL ORIGINAL · #8', exact: true }).click();
  await page.locator('[data-service-id="91"]').getByRole('button', { name: 'Aprobar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Aprobar honorario', exact: true });
  await dialog.getByLabel('IVA confirmado', { exact: true }).selectOption('0.16');
  await dialog.getByText('Corregir médico o cantidad (opcional)', { exact: true }).click();
  await dialog.getByLabel('Médico beneficiario', { exact: true }).selectOption('7');
  await dialog.getByLabel('Motivo del cambio de médico', { exact: true }).fill('Corrección sintética del médico confirmado.');
  await dialog.getByText('Honorario: $250.00', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Guardar aprobación', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Pagos y PDF', exact: true }).click();
  const doctor = page.locator('.hon-doctor-simple').filter({ has: page.getByRole('heading', { name: 'MÉDICO FISCAL CONFIRMADO · #7', exact: true }) });
  await doctor.getByText('$238.33', { exact: true }).waitFor();
  assert.equal(writes.length, 1);
  assert.deepEqual(sapBodies.map(body => body.doctors), [[providers[1].name], [providers[0].name]],
    'La lectura inicial y el refresco del médico confirmado usan el mismo alcance fiscal');
  const calculated = calculateHonorarios([row], reviews, { [providers[0].name]: fiscalProvider(7) })[0];
  const withDocuments = calculateHonorarios([row], reviews, { [providers[0].name]: { ...fiscalProvider(7),
    invoices: [{ documentTotal: 999999, paidToDate: 999999 }], paymentsInPeriod: [{ amount: 999999 }] } })[0];
  assert.equal(calculated._effectiveNeto, 238.33); assert.equal(withDocuments._effectiveNeto, calculated._effectiveNeto,
    'Facturas y pagos ajenos no alteran el cálculo de los servicios BI');
  if (await doctor.getByRole('button', { name: /^Ver servicios de/ }).count())
    await doctor.getByRole('button', { name: /^Ver servicios de/ }).click();
  await doctor.getByText('Ver impuestos y documentos', { exact: true }).click();
  await doctor.getByText('Las facturas y los pagos de SAP no se consultaron.', { exact: true }).waitFor();
  assert.equal(await doctor.getByText(/Facturas activas en SAP|Saldo de facturas SAP/).count(), 0);
  await doctor.screenshot({ path: path.join(output, 'datos-fiscales-sin-documentos.png') });
  for (const [button, filename] of [['Descargar PDF detallado', 'aprobados-detallado.pdf'], ['Descargar PDF resumido', 'aprobados-resumido.pdf']]) {
    const event = page.waitForEvent('download'); await doctor.getByRole('button', { name: button, exact: true }).click();
    const file = path.join(output, filename); await (await event).saveAs(file);
    assert.ok((await readFile(file)).byteLength > 1000, 'El PDF real se descarga con el contrato fiscal reducido');
  }
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  const excelEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'Descargar Excel', exact: true }).click();
  const excelFile = path.join(output, 'honorarios-fiscal.xlsx'); await (await excelEvent).saveAs(excelFile);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(excelFile);
  const fiscalSheet = workbook.getWorksheet('Datos fiscales SAP'); assert.ok(fiscalSheet);
  const cells = []; fiscalSheet.eachRow(sheetRow => sheetRow.eachCell(cell => cells.push(cell.text)));
  const text = cells.join(' ');
  assert.match(text, /facturas y los pagos de SAP no se consultaron/i);
  assert.doesNotMatch(text, /No se encontraron facturas|FACTURAS CONSULTADAS|Total de la factura|Saldo pendiente/);
  assert.ok(text.includes('AAAA800101AAA')); assert.equal(fiscalSheet.columnCount, 10);
  assert.equal(workbook.getWorksheet('Facturas en SAP'), undefined);
  console.log('PASS: ambas consultas piden fiscal, neto BI invariable sin documentos, PDF detallado/resumido y Excel fiscal sin afirmar ausencia de facturas.');

  legacyResponse = true;
  await page.reload(); await search(); await page.getByRole('button', { name: 'Pagos y PDF', exact: true }).click();
  await doctor.getByRole('button', { name: /^Ver servicios de/ }).click();
  await doctor.getByText('Ver impuestos y documentos', { exact: true }).click();
  await doctor.getByText('Facturas activas en SAP: 1.', { exact: true }).waitFor();
  assert.equal(await doctor.getByText('Las facturas y los pagos de SAP no se consultaron.', { exact: true }).count(), 0,
    'Sin la nueva bandera se conserva la respuesta documental legacy');
  assert.deepEqual(errors, []);
  console.log('PASS: el contrato documental legacy conserva su evidencia; no se realizaron operaciones reales.');
} finally { await browser?.close(); await server.close(); }
