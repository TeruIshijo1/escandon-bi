// Prueba aislada del componente real con respuestas sintéticas; no inicia el
// backend, no usa credenciales y no consulta ni escribe sistemas de negocio.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import { honorarioRowId, reviewFingerprint } from '../src/utils/honorariosCalculation.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '../tmp/pdfs/honorarios-revision-20260928');
await mkdir(output, { recursive: true });
const name = 'PRUEBA CONTABLE';
const rows = Array.from({ length: 23 }, (_, index) => ({
  UDRKey: index + 1, RenglonAuditoria: 1, FolioAtencion: index + 1,
  Medico: name, Especialidad: 'PSICOLOGÍA', TipoMedico: 'HN',
  ElegiblePago: index === 0 ? 1 : 0, EstadoVertical: index === 0 ? 'APROBADO' : index === 1 ? 'RECHAZADO' : null,
  FuenteHonorario: 'Liquidación clínica', BaseImporte: 225, IvaLinea: 36, TasaISR: 0.1,
  Cantidad: 1, FechaAtencion: '2026-08-29', Paciente: `CASO DE PRUEBA ${index + 1}`,
  Servicio: 'CUOTA DE RECUPERACION CONSULTA PSICOLOGIA', GrupoServicio: 'CONSULTA EXTERNA'
}));
const accountingInvoice = { docEntry: 201, docNum: 201, postingDate: '2026-09-16', currency: 'MXN', documentTotal: 7769.66,
  paidToDate: 0, openBalance: 7769.66, vatRecorded: 0, cancelled: false, comments: 'Conceptos de referencia de prueba',
  lines: [
    { lineNumber: 0, description: 'PSICOLOGIA', quantity: 24, recordedAmount: 6264 },
    { lineNumber: 1, description: 'CONSULTAS HSBC', quantity: 11, recordedAmount: 3190 }
  ] };
const sap = { ok: true, period:{startDate:'2026-08-01',endDate:'2026-09-30',serviceStartDate:'2026-08-01',serviceEndDate:'2026-08-31',lookaheadDays:30}, supplierCoverage: { count: 1, complete: true }, providers: {
  [name]: { linkStatus: 'candidato_unico', candidates: [{
    cardName: name, federalTaxId: 'AAAA800101AAA', subjectToWithholding: true,
    configuredWithholdings: [
      { description: 'Retención de ISR Servicios Profesionales', rate: 10, estimateRule: 'isr_on_fee', calculationBase: 'base neta definida en SAP' },
      { description: 'Retención de IVA Servicios Profesionales', rate: 10.66, estimateRule: 'vat_two_thirds', calculationBase: 'base neta definida en SAP' }
    ].map(t => ({ ...t, basePercentage: 100, appliesAt: 'factura', codeEffectiveFrom: '2025-12-26', inactive: false }))
  }], invoices: [accountingInvoice], totalsByCurrency: [], paymentsInPeriod: [] }
} };
const extraInvoice={docEntry:200,docNum:200,postingDate:'2026-09-15',currency:'MXN',documentTotal:900,
  paidToDate:0,openBalance:900,vatRecorded:0,cancelled:false,comments:'Honorarios de guardias, agosto',
  retentions:[{description:'Retención ISR',amount:100,taxableBase:1000,rate:10}],
  lines:[{lineNumber:0,description:'GUARDIAS MÉDICAS',quantity:1,recordedAmount:1000}]};
sap.additionalProviders=[{medico:'MÉDICO SOLO SAP',cardCode:'P2',linkStatus:'solo_sap',
  candidates:[{cardName:'MÉDICO SOLO SAP',groupName:'HONMED'}],invoices:[extraInvoice],totalsByCurrency:[],paymentsInPeriod:[]}];
const server = await createServer({ configFile: false, root, appType: 'custom', plugins: [react(), {
  name: 'isolated-honorarios-test', configureServer(server) {
    server.middlewares.use('/__honorarios_test', async (_req, res) => {
      const html = await server.transformIndexHtml('/__honorarios_test', `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;background:#f1f5f9;margin:20px;color:#0f172a}button,input,select{font:inherit}</style></head><body><div id="root"></div><script type="module">import React from 'react';import{createRoot}from'react-dom/client';import{AuthProvider}from'/src/context/AuthContext.jsx';import View from '/src/components/honorarios/HonorariosAuditView.jsx';createRoot(document.getElementById('root')).render(React.createElement(AuthProvider,null,React.createElement(View)));</script></body></html>`);
      res.setHeader('Content-Type', 'text/html'); res.end(html);
    });
  }
}], server: { host: '127.0.0.1', port: 5188, strictPort: true } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1570, height: 1050 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.error(e.message); });
  let sapFailure = false;
  let reportRows = rows;
  let reviews = {};
  let failSave = false;
  let lastSapRequest;
  await page.addInitScript(() => sessionStorage.setItem('escandon_token', 'token-de-prueba'));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: {
    id: 7, username: 'revisor-prueba', nombre: 'USUARIO GENERADOR DE PRUEBA', role: 'ADMIN', permisos: []
  } } }));
  await page.route('**/api/honorarios/**', async route => {
    const url=route.request().url();
    if (url.includes('/audit?')) return route.fulfill({ json: { data: reportRows, coverage:{candidates:1,recoveredAppointments:1,pendingAppointments:0} } });
    if (url.includes('/reviews')) {
      if(route.request().method()==='GET') return route.fulfill({json:{ok:true,reviews,canReview:true}});
      if(failSave)return route.fulfill({status:503,json:{error:'No se pudo guardar la decisión de prueba'}});
      const body=route.request().postDataJSON();
      assert.equal(body.expectedRevision,reviews[body.rowId]?.revision||0);
      const review={...body.decision,revision:body.expectedRevision+1,reviewer:'REVISOR DE PRUEBA',timestamp:new Date().toISOString()};
      reviews[body.rowId]=review;
      return route.fulfill({json:{ok:true,review}});
    }
    lastSapRequest=route.request().postDataJSON();
    return route.fulfill({ status: sapFailure ? 502 : 200, json: sapFailure ? { error: 'SAP de prueba no disponible' } : sap });
  });
  // Other network API calls would be an error in this isolated test.
  await page.goto('http://127.0.0.1:5188/__honorarios_test');
  assert.equal(await page.locator('input[type="date"]').count(), 2, 'one shared service period replaces separate SAP dates');
  await page.locator('input[type="date"]').nth(0).fill('2026-08-01');
  await page.locator('input[type="date"]').nth(1).fill('2026-08-31');
  await page.getByRole('button', { name: /Generar Reporte/ }).click();
  await page.locator('.hon-doc-item').filter({hasText:'MÉDICO SOLO SAP'}).first().waitFor();
  await page.screenshot({ path: path.join(output, 'vista-principal.png') });
  assert.equal(lastSapRequest.startDate,'2026-08-01');
  assert.equal(lastSapRequest.endDate,'2026-08-31');
  assert.equal(await page.getByRole('button', { name: /Por revisar/ }).count(), 1);
  const search=page.getByPlaceholder('Buscar por médico, paciente, atención #, servicio, aseguradora...');
  await search.fill(name);
  const crossTabSummary=page.getByText(/Con estos filtros hay 24 registros:/);
  await crossTabSummary.waitFor();
  assert.match(await crossTabSummary.innerText(),/1 aprobados, 1 rechazados y 22 por revisar/);
  await page.getByRole('button',{name:'Ver todos (24)'}).click();
  await search.fill('');
  await page.locator('.hon-status-tabs-container button').nth(0).click();
  await page.getByRole('button', { name: 'Expandir Todos' }).click();
  await page.getByText('Fuente principal: Vertical',{exact:true}).waitFor();
  await page.getByText('Posible coincidencia con Vertical',{exact:true}).waitFor();
  assert.ok(await page.getByText('Posible complemento: no aparece en Vertical',{exact:true}).count() > 0);
  const statusTabs=page.locator('.hon-status-tabs-container button');
  const initialTabLabels=await statusTabs.allInnerTexts();
  assert.match(initialTabLabels[0],/23/);
  assert.match(initialTabLabels[1],/1/);
  assert.match(initialTabLabels[2],/1/);
  assert.match(initialTabLabels[3],/25/);
  await statusTabs.nth(1).click();
  await page.getByRole('button', { name: 'Expandir Todos' }).click();
  const firstRow=page.locator('tr').filter({hasText:'CASO DE PRUEBA 1'}).first();
  await firstRow.getByText('Aprobado en Vertical',{exact:true}).waitFor();
  await statusTabs.nth(2).click();
  await page.getByRole('button', { name: 'Expandir Todos' }).click();
  const secondRow=page.locator('tr').filter({hasText:'CASO DE PRUEBA 2'}).first();
  await secondRow.getByText('Rechazado en Vertical',{exact:true}).waitFor();
  await page.locator('.hon-status-tabs-container button').nth(3).click();
  await page.getByRole('button', { name: 'Expandir Todos' }).click();
  await firstRow.getByText('Aprobado en Vertical',{exact:true}).waitFor();
  await secondRow.getByText('Rechazado en Vertical',{exact:true}).waitFor();
  await firstRow.getByRole('button',{name:'Rechazar',exact:true}).click();
  await page.getByPlaceholder('Escribe el motivo del cambio...').fill('Servicio duplicado');
  await page.getByRole('button',{name:'Guardar rechazo'}).click();
  await firstRow.getByText('Rechazado',{exact:true}).waitFor();
  await secondRow.getByRole('button',{name:'Aprobar',exact:true}).click();
  await page.getByPlaceholder('Escribe el motivo del cambio...').fill('Tabulador y servicio revisados');
  await page.getByRole('button',{name:'Guardar aprobación'}).click();
  await secondRow.getByText('Aprobado',{exact:true}).waitFor();
  // A failed save must not optimistically change an approval.
  failSave=true;
  await secondRow.getByRole('button',{name:'Rechazar',exact:true}).click();
  await page.getByPlaceholder('Escribe el motivo del cambio...').fill('Intento fallido');
  await page.getByRole('button',{name:'Guardar rechazo'}).click();
  await page.getByText('No se pudo guardar la decisión de prueba').waitFor();
  await page.keyboard.press('Escape');failSave=false;
  assert.ok(await secondRow.getByText('Aprobado',{exact:true}).count());
  // Reload reads the shared server decisions instead of browser storage.
  await page.getByRole('button',{name:/Generar Reporte/}).click();
  await page.locator('.hon-doc-item').filter({hasText:'MÉDICO SOLO SAP'}).first().waitFor();
  await page.getByRole('button', { name: /Aprobados/ }).click();
  await page.getByRole('button', { name: 'Expandir Todos' }).click();
  await secondRow.getByText('Aprobado',{exact:true}).waitFor();
  assert.equal(reviews[honorarioRowId(rows[0])].revision,1);
  // Historical approved records returned by the server exercise the complete exports.
  reviews=Object.fromEntries(rows.map(row=>[honorarioRowId(row),{action:'APROBAR',fingerprint:reviewFingerprint(row),revision:1,reviewer:'REVISOR DE PRUEBA'}]));
  await page.getByRole('button',{name:/Generar Reporte/}).click();
  await page.getByText('$4,933.50', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: /Aprobados/ }).click();
  await page.getByRole('button', { name: 'Expandir Todos' }).click();
  await page.getByText('$214.50', { exact: true }).first().waitFor();
  assert.equal(await page.getByText('$214.50', { exact: true }).count(), 23);
  assert.equal(await page.getByText('$5,485.50', { exact: true }).count(), 0);
  await page.locator('.hon-doc-item').first().screenshot({ path: path.join(output, 'pantalla.png') });
  const pdfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: /PDF Resumido/ }).first().click();
  const summaryPdfPath = path.join(output, 'resumido.pdf');
  await (await pdfDownload).saveAs(summaryPdfPath);
  const summaryPdfText = (await readFile(summaryPdfPath)).toString('latin1');
  assert.ok(summaryPdfText.includes(name), 'the signature includes the selected physician name');
  assert.ok(summaryPdfText.includes('USUARIO GENERADOR DE PRUEBA'), 'the signature includes the authenticated PDF generator');
  assert.ok(summaryPdfText.includes('Posible coincidencia con Vertical'), 'the PDF labels likely matching SAP concepts');
  assert.ok(summaryPdfText.includes('Posible complemento: no aparece en Vertical'), 'the PDF identifies possible SAP supplements');
  const detailedDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: /PDF Detallado/ }).first().click();
  await (await detailedDownload).saveAs(path.join(output, 'detallado.pdf'));
  const excelDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: /Descargar Excel/ }).click();
  const excelPath = path.join(output, 'unificado.xlsx');
  await (await excelDownload).saveAs(excelPath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(excelPath);
  const detail = workbook.getWorksheet('Preliquidación y Auditoría');
  const allRows = []; detail.eachRow(r => allRows.push(r.values));
  assert.ok(allRows.some(r => r.includes('Retención IVA estimada')));
  assert.equal(allRows.filter(r => r.includes(214.5) && r.includes(24)).length, 23);
  assert.ok(allRows.some(r => r.includes(4933.5) && r.includes(552) && r.includes(517.5)));
  await page.getByRole('button', { name: /Detalle$/ }).first().click();
  assert.ok(await page.getByText('Retención IVA estimada', { exact: true }).count());
  await page.keyboard.press('Escape');
  await firstRow.getByRole('button', { name: 'Rechazar',exact:true }).click();
  await page.getByPlaceholder('Escribe el motivo del cambio...').fill('Rechazo de prueba');
  await page.getByRole('button', { name: 'Guardar rechazo' }).click();
  await page.getByText('$4,719.00', { exact: true }).first().waitFor();
  await page.locator('.hon-status-tabs-container button').nth(3).click();
  await page.getByRole('button', { name: 'Expandir Todos' }).click();
  await firstRow.getByRole('button',{name:'Aprobar',exact:true}).click();
  await page.getByPlaceholder('Escribe el motivo del cambio...').fill('Revisado nuevamente');
  await page.getByRole('button',{name:'Guardar aprobación'}).click();
  await page.getByText('$4,933.50', { exact: true }).first().waitFor();
  // SAP-only supplier is reviewed using the very same controls and exports.
  const sapRow=page.locator('tr').filter({hasText:'Factura 200: GUARDIAS MÉDICAS'}).first();
  await sapRow.getByText(/cantidad 1 · importe registrado \$1,000\.00/).waitFor();
  await sapRow.getByRole('button',{name:'Aprobar',exact:true}).click();
  await page.getByPlaceholder('Escribe el motivo del cambio...').fill('Guardias revisadas');
  await page.getByRole('button',{name:'Guardar aprobación'}).click();
  await page.getByText('$5,833.50',{exact:true}).first().waitFor();
  await page.locator('.hon-doc-item').filter({hasText:'MÉDICO SOLO SAP'}).first().screenshot({path:path.join(output,'solo-sap.png')});
  const allPdf=page.waitForEvent('download');
  await page.getByRole('button',{name:'Todos (Detallado)',exact:false}).click();
  await (await allPdf).saveAs(path.join(output,'unificado.pdf'));
  const combinedExcel=page.waitForEvent('download');
  await page.getByRole('button',{name:/Descargar Excel/}).click();
  await (await combinedExcel).saveAs(path.join(output,'aprobados-unificado.xlsx'));
  const combinedWorkbook=new ExcelJS.Workbook();await combinedWorkbook.xlsx.readFile(path.join(output,'aprobados-unificado.xlsx'));
  const values=[];combinedWorkbook.getWorksheet('Preliquidación y Auditoría').eachRow(r=>values.push(r.values));
  assert.ok(values.some(r=>r.includes(5833.5)));
  assert.ok(values.some(r=>r.includes('MÉDICO SOLO SAP')&&r.includes(900)));
  // SAP failure must not export the old incomplete amount as a net.
  sapFailure = true;
  await page.getByRole('button', { name: /Generar Reporte/ }).click();
  await page.getByText(/SAP de prueba no disponible/).waitFor();
  await page.getByRole('button', { name: /Aprobados/ }).click();
  assert.equal(await page.getByText('$4,933.50', { exact: true }).count(), 0);
  assert.equal(await page.getByText('$5,485.50', { exact: true }).count(), 0);
  const pendingPdf = page.waitForEvent('download');
  await page.getByRole('button', { name: /PDF Resumido/ }).first().click();
  await (await pendingPdf).saveAs(path.join(output, 'pendiente.pdf'));
  assert.deepEqual(errors, []);
  // Empty clinical report still presents the independently discovered SAP supplier.
  sapFailure=false;reportRows=[];reviews={};
  await page.getByRole('button',{name:/Generar Reporte/}).click();
  await page.locator('.hon-doc-item').filter({hasText:'MÉDICO SOLO SAP'}).first().waitFor();
  await page.getByRole('button', { name: 'Expandir Todos' }).click();
  const emptySapRow=page.locator('tr').filter({hasText:'Factura 200: GUARDIAS MÉDICAS'}).first();
  await emptySapRow.getByText('Pendiente de revisión',{exact:true}).waitFor();
  assert.ok(await emptySapRow.getByText('Documento complementario · sin atención individual vinculada').count());
  await emptySapRow.getByRole('button', { name: /Detalle$/ }).click();
  await page.getByText(/Total de factura: \$900\.00/).waitFor();
  assert.deepEqual(errors, []);
  // Escala de un mes de Vertical: escribir debe seguir rápido y las tablas
  // detalladas nunca deben montar los 12,796 renglones de una sola vez.
  await page.keyboard.press('Escape');
  reportRows = Array.from({ length: 12794 }, (_, index) => ({
    ...rows[index % rows.length], UDRKey: 100000 + index, RenglonAuditoria: 1,
    FolioAtencion: 100000 + index, Medico: `MÉDICO PRUEBA ${String(index % 149).padStart(3, '0')}`,
    Paciente: `PACIENTE ESCALA ${index + 1}`,
    EstadoVertical: index % 3 === 0 ? 'APROBADO' : index % 3 === 1 ? 'RECHAZADO' : null
  }));
  reviews = {};
  await page.getByRole('button', { name: /Generar Reporte/ }).click();
  await page.locator('.hon-doc-item').first().waitFor();
  await page.locator('.hon-status-tabs-container button').nth(3).click();
  assert.equal(await page.getByRole('button', { name: 'Expandir Todos' }).isDisabled(), true);
  await page.getByRole('button', { name: /Detallada/ }).click();
  const pageInfo = page.locator('nav[aria-label="Paginación de registros"]');
  await pageInfo.waitFor();
  assert.match(await pageInfo.innerText(), /de 12,796 registros/);
  assert.equal(await page.locator('tbody.hon-tbody tr').count(), 100);
  await pageInfo.getByRole('button', { name: 'Siguiente' }).click();
  assert.match(await pageInfo.innerText(), /Mostrando 101/);
  await pageInfo.getByRole('button', { name: 'Anterior' }).click();
  const searchStarted = Date.now();
  await search.fill('MÉDICO PRUEBA 14');
  assert.ok(Date.now() - searchStarted < 1500, 'the search input remains responsive with 12,796 records');
  await page.getByText('Actualizando resultados…', { exact: true }).waitFor();
  await page.getByText('Actualizando resultados…', { exact: true }).waitFor({ state: 'detached' });
  const searchedPageInfo = await pageInfo.innerText();
  assert.doesNotMatch(searchedPageInfo, /12,796/);
  assert.equal(await page.locator('tbody.hon-tbody tr').count(), 100);
  assert.deepEqual(errors, []);
  console.log('PASS: estados, aprobaciones, exports, SAP degradado y búsqueda paginada con 12,796 registros.');
} finally {
  if (browser) await browser.close();
  await server.close();
}
