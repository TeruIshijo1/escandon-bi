// Componente y descarga reales con datos sintéticos; sin acceso a sistemas de negocio.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '../tmp/honorarios-folios');
await mkdir(output, { recursive: true });
const common = { RenglonAuditoria: 1, Medico: 'MÉDICO DE PRUEBA', Especialidad: 'GENERAL',
  ModeBI: true, TipoCalculo: 'BI_PRESTACION', MedicoId: 77, RolMedico: 'TRATANTE', CodigoServicio: 'SER-CONSULTA',
  CatalogStatus: 'INCLUIDO', CatalogApproved: true, ReviewEligible: true,
  CatalogSnapshot: { itemCode: 'SER-CONSULTA', status: 'INCLUIDO', active: true, revision: 1 },
  TariffSnapshot: { id: 51, itemCode: 'SER-CONSULTA', amount: 225, active: true, revision: 1, validFrom: '2026-01-01' },
  PrecioUnitarioBI: 225,
  FuenteHonorario: 'Liquidación clínica', BaseImporte: 225, IvaLinea: 0, TasaISR: 0.1,
  Cantidad: 1, FechaAtencion: '2026-04-15', GrupoServicio: 'CONSULTA EXTERNA',
  EstadoVertical: 'RECHAZADO', ElegiblePago: 0 };
const rows = [
  { ...common, UDRKey: 'SO-16258', FolioReferenciaOrigen: 16258, FolioAtencion: null,
    FolioCita: null, FolioOrdenVenta: 16258, Paciente: 'PACIENTE ORDEN', Servicio: 'SERVICIO ORDEN' },
  { ...common, UDRKey: 'CITA-26205', FolioReferenciaOrigen: 26205, FolioAtencion: null,
    FolioCita: 26205, FolioOrdenVenta: 31499, Paciente: 'PACIENTE CITA', Servicio: 'SERVICIO CITA' },
  { ...common, UDRKey: 'PC-5264', FolioReferenciaOrigen: 5264, FolioAtencion: 5264,
    FolioCita: null, FolioOrdenVenta: 999, Paciente: 'PACIENTE ATENCIÓN', Servicio: 'SERVICIO ATENCIÓN' },
  { ...common, UDRKey: 'PC-77', FolioReferenciaOrigen: 77, FolioAtencion: 77,
    FolioCita: null, FolioOrdenVenta: null, Paciente: 'PACIENTE SIN ORDEN', Servicio: 'SERVICIO SIN ORDEN' },
  ...['FARMACIA', 'LABORATORIO', 'ESTUDIOS DE LABORATORIO', 'IMAGENOLOGÍA', ' Almacén   General ', 'ALIAS', 'PAQUETE DE CIRUGIA'].map((GrupoServicio, index) => ({
    ...common, UDRKey: `PC-EXCLUIDO-${index}`, FolioAtencion: 500 + index,
    CatalogStatus: 'EXCLUIDO', CatalogApproved: false, ReviewEligible: false, ScopeExcluded: true,
    Medico: 'MÉDICO GRUPO EXCLUIDO', Paciente: 'PACIENTE EXCLUIDO', Servicio: 'SERVICIO EXCLUIDO',
    GrupoServicio, EstadoVertical: 'APROBADO', ElegiblePago: 1, BaseImporte: 9000
  })),
  ...[['A-QUI', '', 'ARTICULO QUIROFANO'], ['PQX0002', '', 'PAQUETE QX COMPLETO'],
    ['SER0628', 'CONSULTA EXTERNA', 'CONSULTA EXTERNA MATERIAL DE CURACION'],
    ['SER0713', 'ANALISIS DE CUENTAS', 'SERVICIOS ADMINISTRATIVOS']].map(([CodigoServicio, GrupoServicio, Servicio], index) => ({
    ...common, UDRKey: `PC-NO-HONORARIO-${index}`, CodigoServicio, GrupoServicio, Servicio,
    CatalogStatus: 'EXCLUIDO', CatalogApproved: false, ReviewEligible: false, ScopeExcluded: true,
    Medico: 'MÉDICO GRUPO EXCLUIDO', Paciente: 'PACIENTE EXCLUIDO',
    EstadoVertical: 'APROBADO', ElegiblePago: 1, BaseImporte: 9000
  })),
  ...[
    { CatalogStatus: 'PENDIENTE', CatalogApproved: false, ReviewEligible: false },
    { TariffSnapshot: null, CatalogApproved: false, ReviewEligible: false },
    { TariffSnapshot: { ...common.TariffSnapshot, providerId: 88 }, ReviewEligible: false },
    { TariffSnapshot: { ...common.TariffSnapshot, validFrom: '2026-05-01' }, ReviewEligible: false },
    { MedicoId: null, ReviewEligible: false }
  ].map((configuration, index) => ({
    ...common, ...configuration, UDRKey: `PC-SIN-CONFIGURAR-${index}`, FolioAtencion: 800 + index,
    Medico: 'MÉDICO GRUPO EXCLUIDO', Paciente: 'PACIENTE SIN CONFIGURAR', Servicio: 'CONSULTA SIN CONFIGURACIÓN APLICABLE'
  }))
];
const sap = { ok: true, providers: {}, additionalProviders: [{ medico: 'PROVEEDOR PRUEBA',
  invoices: [{ docEntry: 200, docNum: 888, postingDate: '2026-04-15', currency: 'MXN',
    documentTotal: 900, cancelled: false, lines: [] }] }] };
const server = await createServer({ configFile: false, root, appType: 'custom', plugins: [react(), {
  name: 'isolated-folios-test', configureServer(server) {
    server.middlewares.use('/__folios', async (_req, res) => {
      const html = await server.transformIndexHtml('/__folios', `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>body{font-family:Arial;background:#f1f5f9;margin:20px}button,input,select{font:inherit}</style></head><body><div id="root"></div><script type="module">import React from 'react';import{createRoot}from'react-dom/client';import{AuthProvider}from'/src/context/AuthContext.jsx';import View from '/src/components/honorarios/HonorariosAuditView.jsx';createRoot(document.getElementById('root')).render(React.createElement(AuthProvider,null,React.createElement(View)));</script></body></html>`);
      res.setHeader('Content-Type', 'text/html'); res.end(html);
    });
  }
}], server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1570, height: 1050 }, acceptDownloads: true });
  const errors = [];
  let sapDoctors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => sessionStorage.setItem('escandon_token', 'token-de-prueba'));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: 7, role: 'ADMIN', nombre: 'REVISOR PRUEBA' } } }));
  await page.route('**/api/honorarios/**', route => {
    const url = route.request().url();
    if (url.endsWith('/providers')) return route.fulfill({ json: { providers: [{ id: 77, name: 'MÉDICO DE PRUEBA' }] } });
    if (url.includes('/sap-reconciliation')) sapDoctors = route.request().postDataJSON().doctors;
    return route.fulfill({ json: url.includes('/audit?') ? { ok: true, data: rows }
      : url.includes('/reviews') ? { ok: true, reviews: {}, canReview: true } : sap });
  });
  await page.goto(`${server.resolvedUrls.local[0]}__folios`);
  await page.getByRole('button', { name: 'Buscar servicios', exact: true }).click();
  await page.getByRole('button', { name: /^Todos/ }).click();
  await page.getByRole('button', { name: 'Más opciones', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir todos', exact: true }).click();
  const patientRow = patient => page.locator('tbody tr').filter({ hasText: patient }).first();
  const serviceRow = patient => page.locator('.hon-doctor-service').filter({ hasText: patient }).first();
  await serviceRow('PACIENTE ORDEN').getByRole('button', { name: 'Detalle', exact: true }).click();
  await page.getByText('Folio Orden Venta', { exact: true }).waitFor();
  assert.ok(await page.getByText('#16258', { exact: true }).count());
  assert.ok(await page.getByText('Sin atención vinculada', { exact: true }).count());
  await page.keyboard.press('Escape');
  await page.locator('.hon-doc-item').first().screenshot({ path: path.join(output, 'por-medico.png') });
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  const pdfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF detallado', exact: true }).click();
  const pdfPath = path.join(output, 'folios.pdf');
  await (await pdfDownload).saveAs(pdfPath);
  const pdfText = (await readFile(pdfPath)).toString('latin1');
  assert.ok(pdfText.includes('Orden de venta #16258'));
  assert.ok(pdfText.includes('Cita #26205'));
  assert.equal(pdfText.includes('Atenci\xf3n #16258'), false);
  assert.equal(pdfText.includes('PROVEEDOR PRUEBA'), false);
  await page.getByLabel('Vista de resultados', { exact: true }).selectOption('inteligente');
  const orderRow = patientRow('PACIENTE ORDEN');
  await orderRow.getByText('Orden de venta #16258', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Exportar', exact: true }).waitFor({ state: 'visible' });
  assert.equal(await page.getByText('PACIENTE EXCLUIDO', { exact: true }).count(), 0);
  assert.equal(await page.getByText('PACIENTE SIN CONFIGURAR', { exact: true }).count(), 0);
  assert.equal(await page.locator('.hon-doc-item').filter({ hasText: 'PROVEEDOR PRUEBA' }).count(), 0,
    'an invoice without an approved catalog service cannot become a physician review row');
  assert.equal(await page.locator('option').filter({ hasText: /FARMACIA|LABORATORIO|IMAGENOLOG|ALMAC[EÉ]N/i }).count(), 0);
  assert.equal(await page.getByText('Atención #16258', { exact: true }).count(), 0);
  assert.ok(await orderRow.getByText('Orden de venta registrada', { exact: true }).count());
  await patientRow('PACIENTE CITA').getByText(/^Cita #26205/).waitFor();
  await patientRow('PACIENTE ATENCIÓN').getByText(/^Atención #5264/).waitFor();
  await patientRow('PACIENTE SIN ORDEN').getByText('Sin orden de venta', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, 'matriz-folios.png') });
  await orderRow.click();
  await page.getByText('Folio Orden Venta', { exact: true }).waitFor();
  assert.ok(await page.getByText('#16258', { exact: true }).count());
  await page.keyboard.press('Escape');
  await page.getByLabel('Vista de resultados', { exact: true }).selectOption('inteligente');
  await patientRow('PACIENTE ORDEN').getByText('Orden de venta #16258', { exact: true }).waitFor();
  await page.getByLabel('Vista de resultados', { exact: true }).selectOption('plana');
  await page.getByRole('columnheader', { name: 'Folio Orden Venta', exact: true }).waitFor();
  assert.ok((await patientRow('PACIENTE ORDEN').innerText()).includes('Sin atención vinculada'));
  assert.ok((await patientRow('PACIENTE CITA').innerText()).includes('26205'));
  const search = page.getByLabel('Buscar', { exact: true });
  await search.fill('31499');
  await page.waitForFunction(() => document.querySelectorAll('tbody.hon-tbody tr').length === 1);
  assert.ok((await patientRow('PACIENTE CITA').innerText()).includes('31499'));
  await search.fill('');
  await page.waitForFunction(() => document.querySelectorAll('tbody.hon-tbody tr').length === 4);
  await search.fill('26205');
  await page.waitForFunction(() => document.querySelectorAll('tbody.hon-tbody tr').length === 1);
  assert.ok((await patientRow('PACIENTE CITA').innerText()).includes('26205'));
  await search.fill('');
  await page.waitForFunction(() => document.querySelectorAll('tbody.hon-tbody tr').length === 4);
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar Excel', exact: true }).click();
  const excelPath = path.join(output, 'folios.xlsx');
  await (await download).saveAs(excelPath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(excelPath);
  const detail = workbook.getWorksheet('Resumen y revisión');
  let header;
  detail.eachRow(row => { if (row.values.includes('Folio Atención (Vertical)')) header = row; });
  assert.ok(header);
  const column = title => header.values.indexOf(title);
  const valueFor = (key, title) => {
    let value;
    detail.eachRow(row => { if (row.getCell(column('Clave de registro')).value === key) value = row.getCell(column(title)).value; });
    return value;
  };
  assert.equal(valueFor('SO-16258', 'Folio Atención (Vertical)'), '');
  assert.equal(valueFor('SO-16258', 'Folio Orden Venta'), 16258);
  assert.equal(valueFor('CITA-26205', 'Folio Atención (Vertical)'), '');
  assert.equal(valueFor('CITA-26205', 'Folio Cita (Vertical)'), 26205);
  assert.equal(valueFor('CITA-26205', 'Folio Orden Venta'), 31499);
  assert.equal(valueFor('PC-5264', 'Folio Atención (Vertical)'), 5264);
  assert.equal(valueFor('PC-5264', 'Folio Orden Venta'), 999);
  assert.equal(valueFor('PC-77', 'Folio Orden Venta'), '');
  assert.equal(valueFor('SAP-200', 'Folio Atención (Vertical)'), undefined);
  assert.equal(valueFor('SAP-200', 'Factura SAP'), undefined);
  assert.equal(sapDoctors.includes('MÉDICO GRUPO EXCLUIDO'), false);
  detail.eachRow(row => assert.equal(row.values.includes('SERVICIO EXCLUIDO'), false));
  detail.eachRow(row => assert.equal(row.values.includes('CONSULTA SIN CONFIGURACIÓN APLICABLE'), false));
  assert.deepEqual(errors, []);
  console.log('Folios verificados en las tres vistas, ficha, búsqueda, PDF y archivo Excel descargado.');
} finally { await browser?.close(); await server.close(); }
