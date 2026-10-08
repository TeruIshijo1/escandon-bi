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
  ModeBI: true, TipoCalculo: 'BI_PRESTACION', SourceLineId: index + 1,
  MedicoId: 115, RolMedico: 'TRATANTE', CodigoServicio: 'SER-PSICOLOGIA',
  CatalogStatus: 'INCLUIDO', CatalogApproved: true, ReviewEligible: true,
  CatalogSnapshot: { itemCode: 'SER-PSICOLOGIA', status: 'INCLUIDO', active: true, revision: 1 },
  TariffSnapshot: { id: 51, itemCode: 'SER-PSICOLOGIA', amount: 225, active: true, revision: 1, validFrom: '2026-01-01' },
  PrecioUnitarioBI: 225, CantidadOriginal: 1, CantidadMaxima: 1,
  MedicoConfirmado: true, EjecucionConfirmada: true, CantidadConfirmada: true,
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
  const openOptions = async () => {
    if (!await page.locator('.hon-advanced-options').evaluate(node => node.open)) await page.getByRole('button', { name: /Más opciones/ }).click();
  };
  const openAll = async () => { await openOptions(); await page.getByRole('button', { name: 'Abrir todos', exact: true }).click(); };
  const selectStatus = async index => {
    await page.getByRole('button', { name: 'Servicios', exact: true }).click();
    await page.locator('.hon-status-tabs-container button').nth(index).click();
  };
  const exportGlobal = async name => { await page.getByRole('button', { name: /^Exportar/ }).click(); await page.getByRole('button', { name, exact: true }).click(); };
  const verifyFilteredExcel = async (file, expectedKeys, statusLabel) => {
    await page.waitForFunction(()=>document.querySelector('.hon-export summary')?.getAttribute('aria-disabled')==='false');
    const pending = page.waitForEvent('download'); await exportGlobal('Descargar Excel');
    const saved = path.join(output, file); await (await pending).saveAs(saved);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(saved);
    const sheet = workbook.getWorksheet('Resumen y revisión'); let header;
    sheet.eachRow(row => { if (row.values.includes('Clave de registro')) header=row; });
    const keyColumn=header.values.indexOf('Clave de registro');
    const keys=[]; sheet.eachRow(row=>{const key=row.getCell(keyColumn).value;if(expectedKeys.includes(key))keys.push(key);});
    assert.deepEqual(keys,expectedKeys,'El Excel conserva todos los resultados del filtro, sin limitarse a la página');
    assert.equal(sheet.rowCount-header.number-1,expectedKeys.length,'No se agregan registros de otros estados o filtros');
    for(const exported of workbook.worksheets) {
      let exportedHeader;exported.eachRow(row=>{if(row.values.includes('Médico')&&!exportedHeader&&row.number>3)exportedHeader=row;});
      assert.ok(exported.getCell('A3').value.includes(`Estado: ${statusLabel}`));
      const end=Number(String(exported.autoFilter).match(/(\d+)$/)[1]);
      assert.ok(end>=exportedHeader.number,'El autofiltro cubre datos y encabezados');
      if(exported.name==='Resumen y revisión')assert.equal(end,exportedHeader.number+expectedKeys.length,'El autofiltro excluye la fila de totales');
    }
    return workbook;
  };
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.error(e.message); });
  let sapFailure = false;
  let reportRows = rows;
  let reviews = Object.fromEntries(rows.slice(0, 2).map((row, index) => [honorarioRowId(row), {
    action: index === 0 ? 'APROBAR' : 'EXCLUIR', fingerprint: reviewFingerprint(row),
    revision: 1, reviewer: 'REVISOR DE PRUEBA'
  }]));
  let failSave = false;
  let lastSapRequest;
  await page.addInitScript(() => sessionStorage.setItem('escandon_token', 'token-de-prueba'));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: {
    id: 7, username: 'revisor-prueba', nombre: 'USUARIO GENERADOR DE PRUEBA', role: 'ADMIN', permisos: []
  } } }));
  await page.route('**/api/honorarios/**', async route => {
    const url=route.request().url();
    if (url.endsWith('/providers')) return route.fulfill({ json: { providers: [{ id: 115, name }] } });
    if (url.includes('/audit?')) return route.fulfill({ json: { data: reportRows, coverage:{candidates:1,recoveredAppointments:1,pendingAppointments:0} } });
    if (url.includes('/reviews')) {
      if(route.request().method()==='GET') return route.fulfill({json:{ok:true,reviews,canReview:true}});
      if(failSave)return route.fulfill({status:503,json:{error:'No se pudo guardar la decisión de prueba'}});
      const body=route.request().postDataJSON();
      assert.equal(body.expectedRevision,reviews[body.rowId]?.revision||0);
      if (body.decision.action === 'APROBAR') {
        assert.equal(body.decision.providerId, 115);
        assert.equal(body.decision.quotedTariffId, 51);
        assert.equal(body.decision.quantity, 1);
        assert.equal(body.decision.executionConfirmed, true);
        assert.equal(body.decision.sourceType, 'BI_PRESTACION');
      }
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
  await page.getByRole('button', { name: /Buscar servicios/ }).click();
  await page.locator('.hon-doc-item').filter({hasText:name}).first().waitFor();
  assert.equal(await page.locator('.hon-doc-item').filter({hasText:'MÉDICO SOLO SAP'}).count(), 0);
  await page.screenshot({ path: path.join(output, 'vista-principal.png') });
  assert.equal(lastSapRequest.startDate,'2026-08-01');
  assert.equal(lastSapRequest.endDate,'2026-08-31');
  assert.equal(await page.getByRole('button', { name: /Por revisar/ }).count(), 1);
  const search=page.getByPlaceholder('Médico, paciente, servicio o folio');
  await search.fill(name);
  const crossTabSummary=page.getByText(/Estos filtros también encuentran/);
  await crossTabSummary.waitFor();
  assert.match(await crossTabSummary.innerText(),/1 aprobados, 1 excluidos y 21 por revisar/);
  await page.getByRole('button',{name:'Ver todos (23)'}).click();
  await search.fill('');
  await selectStatus(0);
  await openAll();
  await page.locator('.hon-doctor-service').first().waitFor();
  assert.equal(await page.locator('tbody tr').filter({hasText:'Factura 200: GUARDIAS MÉDICAS'}).count(), 0);
  const statusTabs=page.locator('.hon-status-tabs-container button');
  const initialTabLabels=await statusTabs.allInnerTexts();
  assert.match(initialTabLabels[0],/21/);
  assert.match(initialTabLabels[1],/1/);
  assert.match(initialTabLabels[2],/1/);
  assert.match(initialTabLabels[3],/23/);
  // Descargar cada estado debe conservar exactamente la misma población y sus totales.
  for(const [tab,label,keys] of [[0,'Por revisar',rows.slice(2).map(row=>row.UDRKey)],
    [1,'Aprobados',[1]],[2,'Excluidos',[2]],[3,'Todos',rows.map(row=>row.UDRKey)]]) {
    await selectStatus(tab);
    const filteredBook=await verifyFilteredExcel(`estado-${tab}.xlsx`,keys,label);
    const doctorSheet=filteredBook.getWorksheet('Resumen por Médico');let header;
    doctorSheet.eachRow(row=>{if(row.values.includes('Servicios'))header=row;});
    assert.equal(doctorSheet.getRow(header.number+1).getCell(header.values.indexOf('Servicios')).value,keys.length);
    assert.equal(doctorSheet.getRow(header.number+1).getCell(header.values.indexOf('Aprobados')).value,[1,3].includes(tab)?1:0);
    assert.equal(doctorSheet.getRow(header.number+1).getCell(header.values.indexOf('Importe final aprobado MXN')).value,[1,3].includes(tab)?214.5:0);
  }
  await search.fill('CASO DE PRUEBA 23');
  await page.getByText('Actualizando resultados…',{exact:true}).waitFor({state:'detached'});
  await verifyFilteredExcel('busqueda-paciente.xlsx',[23],'Todos');
  await search.fill(''); await page.getByText('Actualizando resultados…',{exact:true}).waitFor({state:'detached'});
  await selectStatus(1);
  await openAll();
  const firstRow=page.locator('.hon-doctor-service').filter({has:page.getByText('CASO DE PRUEBA 1',{exact:true})});
  await firstRow.getByText('Aprobado',{exact:true}).waitFor();
  await selectStatus(2);
  await openAll();
  const secondRow=page.locator('.hon-doctor-service').filter({has:page.getByText('CASO DE PRUEBA 2',{exact:true})});
  await secondRow.getByText('Excluido',{exact:true}).waitFor();
  await selectStatus(3);
  await openAll();
  await firstRow.getByText('Aprobado',{exact:true}).waitFor();
  await secondRow.getByText('Excluido',{exact:true}).waitFor();
  assert.equal(await firstRow.getByRole('button',{name:'Aprobar',exact:true}).count(),0,'El historial no permite reaprobar una decisión guardada');
  await firstRow.getByRole('button',{name:'Excluir',exact:true}).click();
  await page.getByPlaceholder('Escribe el motivo del cambio...').fill('Servicio duplicado');
  await page.getByRole('button',{name:'Guardar exclusión'}).click();
  await page.getByRole('button',{name:'Guardar exclusión'}).waitFor({state:'detached'});
  await selectStatus(3); await openAll();
  await firstRow.getByText('Excluido',{exact:true}).waitFor();
  await secondRow.getByRole('button',{name:'Devolver a revisión',exact:true}).click();
  await selectStatus(0); await openAll();
  await secondRow.getByRole('button',{name:'Aprobar',exact:true}).click();
  await page.getByLabel('IVA confirmado', { exact: true }).selectOption('0.16');
  await page.getByRole('button',{name:'Guardar aprobación'}).click();
  await page.getByRole('button',{name:'Guardar aprobación'}).waitFor({state:'detached'});
  assert.equal(await secondRow.count(),0,'El servicio aprobado desaparece de Por revisar');
  await selectStatus(3); await openAll();
  await secondRow.getByText('Aprobado',{exact:true}).waitFor();
  // A failed save must not optimistically change an approval.
  failSave=true;
  await secondRow.getByRole('button',{name:'Excluir',exact:true}).click();
  await page.getByPlaceholder('Escribe el motivo del cambio...').fill('Intento fallido');
  await page.getByRole('button',{name:'Guardar exclusión'}).click();
  await page.getByText('No se pudo guardar la decisión de prueba').first().waitFor();
  await page.keyboard.press('Escape');failSave=false;
  assert.ok(await secondRow.getByText('Aprobado',{exact:true}).count());
  // Reload reads the shared server decisions instead of browser storage.
  await page.getByRole('button',{name:/Buscar servicios/}).click();
  await page.locator('.hon-doc-item').filter({hasText:name}).first().waitFor();
  await selectStatus(1);
  await openAll();
  await secondRow.getByText('Aprobado',{exact:true}).waitFor();
  assert.equal(reviews[honorarioRowId(rows[0])].revision,2);
  assert.equal(reviews[honorarioRowId(rows[1])].revision,3,'La devolución y la aprobación quedan guardadas con sus revisiones');
  // Historical approved records returned by the server exercise the complete exports.
  reviews=Object.fromEntries(rows.map(row=>[honorarioRowId(row),{action:'APROBAR',fingerprint:reviewFingerprint(row),revision:1,reviewer:'REVISOR DE PRUEBA'}]));
  await page.getByRole('button',{name:/Buscar servicios/}).click();
  await page.getByText('$4,933.50', { exact: true }).first().waitFor();
  await selectStatus(1);
  await openAll();
  assert.equal(await page.locator('.hon-doctor-service .hon-service-fee strong').filter({ hasText: '$225.00' }).count(), 23);
  assert.equal(await page.getByText('$5,485.50', { exact: true }).count(), 0);
  await page.locator('.hon-doc-item').first().screenshot({ path: path.join(output, 'pantalla.png') });
  const pdfDownload = page.waitForEvent('download');
  await exportGlobal('PDF resumido');
  const summaryPdfPath = path.join(output, 'resumido.pdf');
  await (await pdfDownload).saveAs(summaryPdfPath);
  const summaryPdfText = (await readFile(summaryPdfPath)).toString('latin1');
  assert.ok(summaryPdfText.includes(name), 'the signature includes the selected physician name');
  assert.ok(summaryPdfText.includes('USUARIO GENERADOR DE PRUEBA'), 'the signature includes the authenticated PDF generator');
  assert.ok(summaryPdfText.includes('CUOTA DE RECUPERACION CONSULTA PSICOLOGIA'), 'the PDF includes the configured service');
  assert.equal(summaryPdfText.includes('CONSULTAS HSBC'), false, 'SAP invoice concepts are not catalog-approved services');
  assert.equal(summaryPdfText.includes('GUARDIAS'), false, 'SAP-only invoices do not enter the physician report');
  const detailedDownload = page.waitForEvent('download');
  await exportGlobal('PDF detallado');
  await (await detailedDownload).saveAs(path.join(output, 'detallado.pdf'));
  const excelDownload = page.waitForEvent('download');
  await exportGlobal('Descargar Excel');
  const excelPath = path.join(output, 'unificado.xlsx');
  await (await excelDownload).saveAs(excelPath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(excelPath);
  const detail = workbook.getWorksheet('Resumen y revisión');
  const allRows = []; detail.eachRow(r => allRows.push(r.values));
  assert.ok(allRows.some(r => r.includes('Retención IVA estimada')));
  assert.equal(allRows.filter(r => r.includes(214.5) && r.includes(24)).length, 23);
  assert.ok(allRows.some(r => r.includes(4933.5) && r.includes(552) && r.includes(517.5)));
  await page.getByRole('button', { name: /Detalle$/ }).first().click();
  assert.ok(await page.getByText('Retención de IVA estimada', { exact: true }).count());
  await page.keyboard.press('Escape');
  await selectStatus(3); await openAll();
  await firstRow.getByRole('button', { name: 'Excluir',exact:true }).click();
  await page.getByPlaceholder('Escribe el motivo del cambio...').fill('Rechazo de prueba');
  await page.getByRole('button', { name: 'Guardar exclusión' }).click();
  await page.getByText('$4,719.00', { exact: true }).first().waitFor();
  await selectStatus(3);
  await openAll();
  await firstRow.getByRole('button',{name:'Devolver a revisión',exact:true}).click();
  await selectStatus(0); await openAll();
  await firstRow.getByRole('button',{name:'Aprobar',exact:true}).click();
  await page.getByLabel('IVA confirmado', { exact: true }).selectOption('0.16');
  await page.getByRole('button',{name:'Guardar aprobación'}).click();
  await page.getByText('$4,933.50', { exact: true }).first().waitFor();
  await selectStatus(1); await openAll();
  // SAP-only suppliers remain fiscal context and must not inflate services or totals.
  assert.equal(await page.locator('.hon-doc-item').filter({hasText:'MÉDICO SOLO SAP'}).count(), 0);
  assert.equal(await page.getByText('$5,833.50',{exact:true}).count(), 0);
  const allPdf=page.waitForEvent('download');
  await exportGlobal('PDF detallado');
  await (await allPdf).saveAs(path.join(output,'unificado.pdf'));
  const combinedExcel=page.waitForEvent('download');
  await exportGlobal('Descargar Excel');
  await (await combinedExcel).saveAs(path.join(output,'aprobados-unificado.xlsx'));
  const combinedWorkbook=new ExcelJS.Workbook();await combinedWorkbook.xlsx.readFile(path.join(output,'aprobados-unificado.xlsx'));
  const values=[];combinedWorkbook.getWorksheet('Resumen y revisión').eachRow(r=>values.push(r.values));
  assert.ok(values.some(r=>r.includes(4933.5)));
  assert.equal(values.some(r=>r.includes(5833.5)), false);
  assert.equal(values.some(r=>r.includes('MÉDICO SOLO SAP')), false);
  assert.equal((await readFile(path.join(output,'unificado.pdf'))).toString('latin1').includes('GUARDIAS'), false);
  // SAP failure must not export the old incomplete amount as a net.
  sapFailure = true;
  await page.getByRole('button', { name: /Buscar servicios/ }).click();
  await page.getByRole('alert').getByText(/No se pudieron consultar las facturas y los impuestos/).waitFor();
  await selectStatus(1);
  assert.equal(await page.getByText('$4,933.50', { exact: true }).count(), 0);
  assert.equal(await page.getByText('$5,485.50', { exact: true }).count(), 0);
  const pendingPdf = page.waitForEvent('download');
  await exportGlobal('PDF resumido');
  await (await pendingPdf).saveAs(path.join(output, 'pendiente.pdf'));
  assert.deepEqual(errors, []);
  // An empty clinical report cannot turn independently discovered invoices into services.
  sapFailure=false;reportRows=[];reviews={};
  await page.getByRole('button',{name:/Buscar servicios/}).click();
  await page.getByRole('heading', { name: 'No se encontraron registros' }).waitFor();
  await page.getByText('Para aparecer aquí, el servicio debe estar en Aprobados del catálogo y tener una tarifa que corresponda al médico y a la fecha de la atención.').waitFor();
  assert.ok(await page.getByRole('button', { name: 'Configurar servicios y tarifas', exact: true }).count());
  assert.equal(await page.locator('.hon-doc-item').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Exportar', exact: true }).getAttribute('aria-disabled'), 'true');
  assert.deepEqual(errors, []);
  // Médicos, grupos y búsqueda se combinan antes de exportar.
  reportRows=[{...rows[0],GrupoServicio:'CONSULTA EXTERNA'},
    {...rows[1],MedicoId:116,Medico:'SEGUNDO MEDICO',GrupoServicio:'DENTAL'},
    {...rows[2],MedicoId:116,Medico:'SEGUNDO MEDICO',GrupoServicio:'CONSULTA EXTERNA'}];
  reviews={};sap.providers['SEGUNDO MEDICO']={...sap.providers[name]};
  await page.getByRole('button',{name:/Buscar servicios/}).click();
  await page.locator('.hon-status-tabs-container').waitFor();
  await selectStatus(3);
  await openOptions();
  await page.getByLabel('Médico',{exact:true}).selectOption('SEGUNDO MEDICO');
  await verifyFilteredExcel('medico.xlsx',[2,3],'Todos');
  await page.getByLabel('Grupo de servicios',{exact:true}).selectOption('DENTAL');
  await verifyFilteredExcel('medico-grupo.xlsx',[2],'Todos');
  await search.fill('CASO DE PRUEBA 1');
  assert.equal(await page.getByRole('button',{name:/^Exportar/}).getAttribute('aria-disabled'),'true','La exportación se bloquea mientras la búsqueda se actualiza');
  await page.getByText('Actualizando resultados…',{exact:true}).waitFor({state:'detached'});
  assert.equal(await page.getByRole('button',{name:/^Exportar/}).getAttribute('aria-disabled'),'true','Un filtro vacío no permite exportar otro estado');
  await search.fill('');
  await page.getByLabel('Médico',{exact:true}).selectOption('');
  await page.getByLabel('Grupo de servicios',{exact:true}).selectOption('TODOS');
  // Escala de un mes de Vertical: escribir debe seguir rápido y las tablas
  // detalladas nunca deben montar los 12,796 renglones de una sola vez.
  await page.keyboard.press('Escape');
  reportRows = Array.from({ length: 12796 }, (_, index) => ({
    ...rows[index % rows.length], UDRKey: 100000 + index, SourceLineId: 100000 + index, RenglonAuditoria: 1,
    MedicoId: 1000 + index % 149,
    FolioAtencion: 100000 + index, Medico: `MÉDICO PRUEBA ${String(index % 149).padStart(3, '0')}`,
    Paciente: `PACIENTE ESCALA ${index + 1}`,
    EstadoVertical: index % 3 === 0 ? 'APROBADO' : index % 3 === 1 ? 'RECHAZADO' : null
  }));
  reviews = {};
  await page.getByRole('button', { name: /Buscar servicios/ }).click();
  await selectStatus(3);
  await page.locator('.hon-doc-item').first().waitFor();
  await openOptions();
  assert.equal(await page.getByRole('button', { name: 'Abrir todos' }).isDisabled(), true);
  await page.getByLabel('Vista de resultados', { exact: true }).selectOption('inteligente');
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
  await verifyFilteredExcel('todas-las-paginas.xlsx',reportRows.filter(row=>row.Medico.includes('MÉDICO PRUEBA 14')).map(row=>row.UDRKey),'Todos');
  console.log('PASS: estados, aprobaciones, exports, SAP degradado y búsqueda paginada con 12,796 registros.');
} finally {
  if (browser) await browser.close();
  await server.close();
}
