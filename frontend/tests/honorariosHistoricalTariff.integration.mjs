// Navegador y componentes reales; fechas y 80 atenciones sintéticas, sin datos de negocio.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '../tmp/honorarios-historical-tariff');
await mkdir(output, { recursive: true });
const provider = { id: 7, name: 'MÉDICO HISTÓRICO PRUEBA' };
const item = { itemCode: 'SER0616', description: 'CUOTA DE RECUPERACIÓN CONSULTA PSICOLOGÍA',
  groupName: 'CONSULTA EXTERNA', status: 'INCLUIDO', active: true, professionalCandidate: true,
  scopeExcluded: false, modality: 'presencial', revision: 1, approvalStatus: 'APROBADO',
  approvedTariffCount: 1, tariffCount: 1, referencePrices: [{ id: 1, amount: 180 }] };
let tariff = { id: 5, itemCode: item.itemCode, amount: 180, providerId: null, role: null,
  validFrom: '2026-09-01', validTo: null, active: true, revision: 1, updatedBy: 'CONTABILIDAD PRUEBA' };
let legacyCoverage = false;
const writes = [], auditPeriods = [], errors = [];
const candidateRows = () => Array.from({ length: 80 }, (_, index) => ({
  ModeBI: true, TipoCalculo: 'BI_PRESTACION', SourceIdentity: `BI|PCBL|${index + 1}|CARGO`,
  SourceType: 'PCBL', SourceLineId: index + 1, SourceFingerprint: `source-${index + 1}`,
  UDRKey: `BI|PCBL|${index + 1}|CARGO`, RenglonAuditoria: 1,
  FechaAtencion: '2026-08-15', CodigoServicio: item.itemCode, Servicio: item.description,
  GrupoServicio: item.groupName, Medico: provider.name, MedicoId: provider.id, RolMedico: 'TRATANTE',
  Paciente: `PACIENTE SINTÉTICO ${index + 1}`, Cantidad: 1, CantidadOriginal: 1, CantidadMaxima: 1,
  CatalogStatus: 'INCLUIDO', CatalogApproved: true, ReviewEligible: true, CatalogSnapshot: item,
  TariffSnapshot: { ...tariff }, PrecioUnitarioBI: tariff.amount, BaseImporte: tariff.amount,
  MedicoConfirmado: true, EjecucionConfirmada: true, CantidadConfirmada: true, ElegiblePago: 0
}));
const server = await createServer({ configFile: false, root, appType: 'custom', plugins: [react(), {
  name: 'historical-tariff-isolated', configureServer(server) { server.middlewares.use('/__historical_tariff', async (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    const html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:20px"><div id="root"></div><script type="module">import React from "react";import{createRoot}from"react-dom/client";import{AuthProvider}from"/src/context/AuthContext.jsx";import View from "/src/components/honorarios/HonorariosAuditView.jsx";import"/src/styles/globals.css";createRoot(document.getElementById("root")).render(React.createElement(AuthProvider,null,React.createElement(View)));</script></body></html>';
    res.end(await server.transformIndexHtml('/__historical_tariff', html));
  }); }
}], server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, timezoneId: 'America/Mexico_City' });
  page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => sessionStorage.setItem('escandon_token', 'historical-test'));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: 7, username: 'amendoza',
    nombre: 'REVISOR SINTÉTICO', role: 'ADMIN', permisos: ['interconsultas-jornadas'] } } }));
  await page.route('**/api/honorarios/**', async route => {
    const url = new URL(route.request().url()), endpoint = url.pathname.replace('/api/honorarios', '');
    const method = route.request().method();
    let result = { ok: true };
    if (endpoint === '/providers') result.providers = [provider];
    else if (endpoint === '/fiscal-profiles') result.profiles = {};
    else if (endpoint === '/reviews') Object.assign(result, { reviews: {}, canReview: true });
    else if (endpoint === '/catalog') Object.assign(result, { items: [item], sync: {} });
    else if (endpoint === '/catalog/SER0616/history') result.history = [];
    else if (endpoint === '/catalog/SER0616/tariffs') {
      if (method === 'POST') {
        const body = route.request().postDataJSON(); writes.push(body);
        assert.equal(body.expectedRevision, tariff.revision);
        tariff = { ...tariff, ...body, revision: tariff.revision + 1 };
        Object.assign(result, { tariff, item });
      } else result.tariffs = [tariff];
    } else if (endpoint === '/audit') {
      const period = Object.fromEntries(url.searchParams); auditPeriods.push(period);
      assert.deepEqual(period, { startDate: '2026-08-01', endDate: '2026-08-31' });
      const data = tariff.validFrom <= '2026-08-15' ? candidateRows() : [];
      Object.assign(result, { data, coverage: { source: 'SERVICIOS_ORDENES_CARGOS',
        sourceCandidates: 80, candidates: data.length, omittedFromReview: 80 - data.length,
        pendingCatalog: 0, pendingTariff: 80 - data.length, pendingProvider: 0,
        orderLines: 0, clinicalCharges: data.length, standaloneAppointments: 0, surgicalProcedures: 0,
        ...(!legacyCoverage ? { sourceCounts: { orderLines: 0, clinicalCharges: 80,
          standaloneAppointments: 0, surgicalProcedures: 0, contactCenter: 0 } } : {}) } });
    } else if (endpoint === '/sap-reconciliation') Object.assign(result, { providers: { [provider.name]: {
      linkStatus: 'sin_coincidencia', candidates: [], invoices: [] } }, additionalProviders: [] });
    else throw new Error(`API no prevista: ${method} ${endpoint}`);
    await route.fulfill({ json: result });
  });
  await page.goto(`${server.resolvedUrls.local[0]}__historical_tariff`);
  const from = page.getByLabel('Desde', { exact: true }), until = page.getByLabel('Hasta', { exact: true });
  const search = () => page.getByRole('button', { name: 'Buscar servicios', exact: true });
  await from.fill('2026-08-01'); await until.fill('2026-08-31'); await search().click();
  await page.getByRole('heading', { name: 'No se encontraron registros', exact: true }).waitFor();
  await page.getByText(/Hay 80 atenciones de servicios configurados sin tarifa/).waitFor();
  const sources = page.locator('.hon-context-note').getByText(/^Fuentes consultadas:/);
  assert.match(await sources.innerText(), /80 cargos clínicos/);
  assert.equal(await page.getByRole('button', { name: 'Ver todo el historial', exact: true }).count(), 0);
  assert.equal(writes.length, 0); assert.equal(tariff.validFrom, '2026-09-01');
  await page.screenshot({ path: path.join(output, '01-agosto-sin-tarifa-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 1100 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: path.join(output, '02-agosto-sin-tarifa-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole('button', { name: 'Configurar servicios y tarifas', exact: true }).click();
  await page.getByRole('heading', { name: 'Servicios y tarifas para pago', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Aprobados (1)', exact: true }).click();
  await page.getByRole('button', { name: 'Configurar SER0616', exact: true }).click();
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  const tariffFrom = page.getByLabel('Se aplica desde', { exact: true });
  assert.equal(await tariffFrom.inputValue(), '2026-09-01', 'Entrar al catálogo no vuelve retroactiva la tarifa');
  await page.getByText('Las atenciones anteriores a Se aplica desde quedan fuera de esta tarifa. Para revisar un periodo histórico, indica la fecha inicial autorizada.', { exact: true }).waitFor();
  assert.equal(writes.length, 0);
  await tariffFrom.fill('2026-08-01');
  await page.getByRole('button', { name: 'Guardar tarifa', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /Tarifa guardada/ }).waitFor();
  assert.equal(writes.length, 1); assert.equal(writes[0].validFrom, '2026-08-01'); assert.equal(writes[0].amount, 180);
  await page.getByRole('button', { name: 'Servicios', exact: true }).click();
  await page.getByRole('heading', { name: `${provider.name} · #7`, exact: true }).waitFor();
  assert.equal(await from.inputValue(), '2026-08-01'); assert.equal(await until.inputValue(), '2026-08-31');
  assert.equal(auditPeriods.length, 2, 'Guardar y volver consulta otra vez el mismo periodo histórico');
  assert.equal(await page.getByText(/Hay 80 atenciones de servicios configurados sin tarifa/).count(), 0);
  assert.equal(writes.length, 1, 'Consultar de nuevo no guarda ni aprueba atenciones');

  legacyCoverage = true; tariff = { ...tariff, validFrom: '2026-09-01' };
  await search().click();
  await page.getByRole('heading', { name: 'No se encontraron registros', exact: true }).waitFor();
  assert.match(await page.locator('.hon-context-note').getByText(/^Atenciones con configuración aplicable:/).innerText(), /0 cargos clínicos/);
  assert.equal(await page.locator('.hon-context-note').getByText(/^Fuentes consultadas:/).count(), 0,
    'Una API antigua no presenta los elegibles como todas las fuentes consultadas');
  assert.deepEqual(errors, []);
  console.log('PASS: 80 atenciones históricas sin tarifa explicadas; fuentes80/visibles0; primera entrada al catálogo funciona; vigencia no cambia sola; edición explícita conserva importe y periodo de agosto; vuelta consulta de nuevo y fallback legacy preciso.');
} finally { await browser?.close(); await server.close(); }
