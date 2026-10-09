// Componente y navegador reales; catálogo sintético, sin modificar datos de negocio.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '../tmp/honorarios-catalog-export');
await mkdir(output, { recursive: true });
const snapshotAt = '2026-10-08T18:30:00.000Z';
const providers = [{ id: 77, name: 'MÉDICO EXPORTACIÓN DE PRUEBA' }];
const service = (itemCode, changes = {}) => ({ itemCode, description: `CONSULTA DE PRUEBA ${itemCode}`,
  groupName: 'CONSULTA EXTERNA', active: true, status: 'PENDIENTE', modality: 'presencial',
  professionalCandidate: true, scopeExcluded: false, revision: 1, approvalStatus: 'PENDIENTE',
  approvedTariffCount: 0, tariffCount: 0, referencePrices: [], tariffs: [], ...changes });
const pending = Array.from({ length: 45 }, (_, index) => service(`SER_P${String(index + 1).padStart(3, '0')}`,
  { referencePrices: [{ id: 1000 + index, amount: index + 1, notes: `Referencia ${index + 1}` }] }));
const complex = service('SER_COMPLEJO', { description: 'CONSULTA COMPLEJA DE MÉDICO ÁURELIO',
  status: 'INCLUIDO', approvalStatus: 'APROBADO', approvedTariffCount: 2, tariffCount: 2,
  referenceChanged: true, modality: 'contact_center', referencePrices: [
    { id: 501, amount: 0, notes: 'Referencia cero explícita', changeAudit: { available: true, source: 'Vertical',
      changedBy: 'RESPONSABLE VERTICAL', changedAt: '2026-10-07T15:00:00Z' } },
    { id: 502, amount: null, notes: 'Referencia sin importe', changeAudit: { available: false } }
  ], tariffs: [
    { id: 601, itemCode: 'SER_COMPLEJO', providerId: null, role: null, amount: 250,
      validFrom: '2026-01-01', validTo: null, active: true, revision: 1, updatedBy: 'CONTABILIDAD GENERAL' },
    { id: 602, itemCode: 'SER_COMPLEJO', providerId: '77', role: 'AN', amount: 300.5,
      validFrom: '2026-01-01', validTo: '2026-06-30', active: true, revision: 2, updatedBy: 'CONTABILIDAD MÉDICO' },
    { id: 603, itemCode: 'SER_COMPLEJO', providerId: '77', role: 'SURGEON', amount: 450,
      validFrom: '2026-07-01', validTo: '2026-08-31', active: false, revision: 3, updatedBy: 'CONTABILIDAD HISTÓRICA' }
  ] });
const items = [...pending, complex,
  service('SER_SIN_TARIFA', { status: 'INCLUIDO', description: 'CONSULTA SIN TARIFA AUTORIZADA' }),
  service('SER_EXCLUIDO', { status: 'EXCLUIDO', approvalStatus: 'EXCLUIDO' }),
  service('SER_INACTIVO', { active: false, referencePrices: [{ id: 503, amount: 25 }] }),
  service('SER_OTRO', { description: 'CONCEPTO NUEVO POR REVISAR', professionalCandidate: false,
    referencePrices: [{ id: 504, amount: 60 }] }),
  service('A-FAR', { groupName: 'FARMACIA', professionalCandidate: true,
    referencePrices: [{ id: 505, amount: 70 }], tariffs: [{ ...complex.tariffs[0], id: 604 }] }),
  service('SER_ALM', { groupName: 'ALMACÉN GENERAL', professionalCandidate: true,
    referencePrices: [{ id: 506, amount: 80 }], tariffs: [{ ...complex.tariffs[0], id: 605 }] }),
  service('SER_FUERA', { scopeExcluded: true, referencePrices: [{ id: 507, amount: 90 }] })];
let exportReads = 0, exportFailure = false, incompleteSnapshot = false, exportGate = null, releaseExport;
const methods = [], errors = [], downloads = [];
const server = await createServer({ configFile: false, root, appType: 'custom', plugins: [react(), {
  name: 'catalog-export-isolated', configureServer(server) { server.middlewares.use('/__catalog_export', async (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    const html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:20px}.hon-card{background:var(--surface-raised,#fff);border:1px solid var(--table-border,#dbe3eb);border-radius:12px}</style></head><body><div id="root"></div><script type="module">import React from "react";import{createRoot}from"react-dom/client";import Panel from "/src/components/honorarios/HonorariosCatalogPanel.jsx";import"/src/styles/globals.css";createRoot(document.getElementById("root")).render(React.createElement(Panel,{canManage:false}));</script></body></html>';
    res.end(await server.transformIndexHtml('/__catalog_export', html));
  }); }
}], server: { host: '127.0.0.1', port: 0 } });
let browser;

const headers = {
  'Catálogo': ['Código', 'Servicio', 'Grupo', 'Estado', 'Precios de referencia ($)', 'Tarifas registradas ($)',
    'Referencias', 'Tarifas activas', 'Servicio activo', 'Tipo de atención', 'Cambio desde Vertical'],
  'Referencias Vertical': ['Código', 'Servicio', 'Estado', 'Referencia', 'Importe ($)', 'Notas'],
  'Tarifas autorizadas': ['Código', 'Servicio', 'Estado', 'Tarifa', 'Importe ($)', 'Médico', 'Función',
    'Se aplica desde', 'Se aplica hasta', 'Tarifa activa', 'Responsable de tarifa']
};
function table(workbook, name) {
  const sheet = workbook.getWorksheet(name);
  assert.ok(sheet, `Existe la hoja ${name}`);
  const headerRow = Array.from({ length: sheet.rowCount }, (_, index) => sheet.getRow(index + 1))
    .find(row => row.values.includes('Código') && row.values.includes('Estado'));
  assert.ok(headerRow, `Encabezado identificable en ${name}`);
  const columns = new Map();
  headerRow.eachCell((cell, number) => columns.set(String(cell.value), number));
  for (const label of headers[name]) assert.ok(columns.has(label), `${name}: columna ${label}`);
  const rows = [];
  for (let rowNumber = headerRow.number + 1; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    if (!row.getCell(columns.get('Código')).value) continue;
    rows.push(Object.fromEntries([...columns].map(([label, number]) => [label, row.getCell(number).value])));
  }
  assert.ok(sheet.autoFilter, `${name}: autofiltro disponible`);
  assert.ok(sheet.views.some(view => view.state === 'frozen' && view.ySplit === headerRow.number), `${name}: encabezados congelados`);
  return { sheet, rows, columns, headerRow };
}
function assertCodes(rows, expected) {
  assert.deepEqual(rows.map(row => row['Código']).sort(), [...expected].sort());
  assert.equal(new Set(rows.map(row => row['Código'])).size, rows.length, 'Una fila por servicio');
}
function assertExcluded(workbook) {
  for (const name of Object.keys(headers)) {
    assert.equal(table(workbook, name).rows.some(row => ['A-FAR', 'SER_ALM', 'SER_FUERA'].includes(row['Código'])), false,
      `Inventario y servicios fuera de alcance no entran a ${name}`);
  }
}
async function readDownload(download, filename) {
  const file = path.join(output, filename);
  assert.match(download.suggestedFilename(), /\.xlsx$/);
  await download.saveAs(file);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), Object.keys(headers));
  assertExcluded(workbook);
  console.log(`Excel verificado: ${filename}`);
  return workbook;
}

try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true, timezoneId: 'America/Mexico_City' });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('download', download => downloads.push(download));
  await page.route('**/api/honorarios/**', async route => {
    const endpoint = new URL(route.request().url()).pathname.replace('/api/honorarios', '');
    const method = route.request().method(); methods.push({ endpoint, method });
    assert.equal(method, 'GET', 'El acceso de consulta nunca escribe');
    if (endpoint === '/providers') await route.fulfill({ json: { providers } });
    else if (endpoint === '/catalog') await route.fulfill({ json: { items, sync: { lastSuccess: snapshotAt } } });
    else if (endpoint === '/catalog/export-data') {
      exportReads++;
      if (exportGate) await exportGate;
      if (exportFailure) await route.fulfill({ status: 503, json: { error: 'No se pudo descargar el catálogo. Intenta de nuevo.' } });
      else {
        const snapshot = structuredClone(items);
        if (incompleteSnapshot) delete snapshot.find(item => item.itemCode === complex.itemCode).tariffs;
        await route.fulfill({ json: { items: snapshot, snapshotAt } });
      }
    } else if (endpoint.endsWith('/tariffs')) {
      const code = decodeURIComponent(endpoint.split('/')[2]);
      await route.fulfill({ json: { tariffs: items.find(item => item.itemCode === code)?.tariffs || [] } });
    } else if (endpoint.endsWith('/history')) await route.fulfill({ json: { history: [] } });
    else throw new Error(`API no prevista: ${method} ${endpoint}`);
  });
  await page.goto(`${server.resolvedUrls.local[0]}__catalog_export`);
  const exportButton = () => page.getByRole('button', { name: 'Descargar Excel', exact: true });
  const all = page.getByRole('button', { name: /^Todos los servicios \(/ });
  const recommended = page.getByRole('button', { name: /^Recomendados \(/ });
  const approved = page.getByRole('button', { name: /^Aprobados \(/ });
  const search = page.getByLabel('Buscar servicio', { exact: true });
  const status = page.locator('.hon-catalog-filters select');
  const others = page.getByRole('checkbox', { name: 'Revisar otros conceptos', exact: true });
  await page.getByRole('button', { name: 'Configurar SER_P001', exact: true }).waitFor();
  assert.equal(await exportButton().isEnabled(), true, 'Se puede descargar con acceso de consulta');
  assert.equal(await page.getByRole('button', { name: 'Buscar servicios nuevos', exact: true }).isDisabled(), true);
  assert.equal(await page.locator('.hon-catalog-table tbody tr').count(), 40);
  assert.equal(await page.getByRole('button', { name: 'Configurar SER_P045', exact: true }).count(), 0);

  const exportWorkbook = async filename => {
    const pendingDownload = page.waitForEvent('download');
    await exportButton().click();
    const workbook = await readDownload(await pendingDownload, filename);
    await exportButton().waitFor();
    return workbook;
  };
  const recommendedBook = await exportWorkbook('01-recomendados-todas-paginas.xlsx');
  assertCodes(table(recommendedBook, 'Catálogo').rows, [...pending.map(item => item.itemCode), 'SER_INACTIVO']);
  assert.equal(table(recommendedBook, 'Referencias Vertical').rows.length, 46);
  assert.equal(table(recommendedBook, 'Referencias Vertical').columns.has('Responsable en Vertical'), false,
    'Sin atribución de Vertical no se añade una columna vacía de responsable');
  assert.equal(table(recommendedBook, 'Tarifas autorizadas').rows.length, 0);

  await all.click();
  const allBook = await exportWorkbook('02-todos-detalles.xlsx');
  const catalog = table(allBook, 'Catálogo');
  assertCodes(catalog.rows, [...pending.map(item => item.itemCode), 'SER_COMPLEJO', 'SER_SIN_TARIFA', 'SER_EXCLUIDO', 'SER_INACTIVO']);
  const byCode = code => catalog.rows.find(row => row['Código'] === code);
  for (const [code, expected] of [['SER_COMPLEJO', 'Configurados'], ['SER_P001', 'Por configurar'],
    ['SER_SIN_TARIFA', 'Falta tarifa'], ['SER_EXCLUIDO', 'Excluido'], ['SER_INACTIVO', 'Inactivo']]) assert.equal(byCode(code)['Estado'], expected);
  assert.equal(byCode('SER_COMPLEJO')['Referencias'], 2);
  assert.equal(byCode('SER_COMPLEJO')['Tarifas activas'], 2);
  assert.equal(byCode('SER_COMPLEJO')['Tipo de atención'], 'Contact Center');
  assert.match(byCode('SER_COMPLEJO')['Cambio desde Vertical'], /Cambió.*Vertical/);
  assert.equal(byCode('SER_SIN_TARIFA')['Referencias'], 0);
  assert.equal(byCode('SER_INACTIVO')['Servicio activo'], 'No');
  const references = table(allBook, 'Referencias Vertical');
  const complexReferences = references.rows.filter(row => row['Código'] === complex.itemCode);
  assert.equal(complexReferences.length, 2, 'Cada referencia se conserva una sola vez');
  assert.equal(complexReferences.find(row => row['Referencia'] === 501)['Importe ($)'], 0);
  assert.ok([null, ''].includes(complexReferences.find(row => row['Referencia'] === 502)['Importe ($)']),
    'Sin importe permanece vacío y no se convierte a cero');
  assert.equal(complexReferences.find(row => row['Referencia'] === 501)['Responsable en Vertical'], 'RESPONSABLE VERTICAL');
  const zeroRow = references.sheet.getRow(references.headerRow.number + 1 + references.rows.findIndex(row => row['Referencia'] === 501));
  assert.match(zeroRow.getCell(references.columns.get('Importe ($)')).numFmt.split(';')[2], /0\.00/, 'Excel muestra el cero explícito');
  const tariffs = table(allBook, 'Tarifas autorizadas').rows;
  assert.equal(tariffs.length, 3, 'Tres tarifas, sin producto cruzado con dos referencias');
  const general = tariffs.find(row => row['Tarifa'] === 601), doctor = tariffs.find(row => row['Tarifa'] === 602), inactive = tariffs.find(row => row['Tarifa'] === 603);
  assert.equal(general['Médico'], 'Tarifa general'); assert.equal(general['Función'], 'Todas las funciones');
  assert.equal(doctor['Médico'], providers[0].name); assert.equal(doctor['Función'], 'Anestesiólogo');
  assert.equal(doctor['Importe ($)'], 300.5); assert.equal(doctor['Se aplica desde'], '2026-01-01');
  assert.equal(doctor['Se aplica hasta'], '2026-06-30'); assert.equal(doctor['Tarifa activa'], 'Sí');
  assert.equal(inactive['Función'], 'Cirujano'); assert.equal(inactive['Tarifa activa'], 'No');
  assert.equal(inactive['Se aplica desde'], '2026-07-01'); assert.equal(inactive['Se aplica hasta'], '2026-08-31');
  assert.equal(inactive['Responsable de tarifa'], 'CONTABILIDAD HISTÓRICA');

  await status.selectOption('INCLUIDO');
  await page.getByRole('button', { name: 'Configurar SER_COMPLEJO', exact: true }).click();
  assert.equal(await page.getByLabel('Incluir en honorarios').isDisabled(), true, 'Exportar no habilita edición');
  const includedBook = await exportWorkbook('03-incluidos.xlsx');
  assertCodes(table(includedBook, 'Catálogo').rows, ['SER_COMPLEJO', 'SER_SIN_TARIFA']);
  await search.fill('medico aurelio');
  const searchBook = await exportWorkbook('04-busqueda-normalizada.xlsx');
  assertCodes(table(searchBook, 'Catálogo').rows, ['SER_COMPLEJO']);
  await search.fill(''); await status.selectOption('TODOS');
  await others.check();
  const othersBook = await exportWorkbook('05-otros-conceptos.xlsx');
  assert.equal(table(othersBook, 'Catálogo').rows.length, 50);
  assert.ok(table(othersBook, 'Catálogo').rows.some(row => row['Código'] === 'SER_OTRO'));
  await approved.click();
  const approvedBook = await exportWorkbook('06-aprobados.xlsx');
  assertCodes(table(approvedBook, 'Catálogo').rows, ['SER_COMPLEJO']);

  await all.click(); await others.uncheck(); await status.selectOption('INCLUIDO'); await search.fill('compleja');
  exportGate = new Promise(resolve => { releaseExport = resolve; });
  const heldRequest = page.waitForRequest(request => request.url().includes('/catalog/export-data'));
  const capturedDownload = page.waitForEvent('download');
  await exportButton().click(); await heldRequest;
  await search.fill('sin tarifa'); await status.selectOption('PENDIENTE'); await others.check(); await recommended.click();
  releaseExport(); exportGate = null;
  const capturedBook = await readDownload(await capturedDownload, '07-filtros-capturados.xlsx');
  assertCodes(table(capturedBook, 'Catálogo').rows, ['SER_COMPLEJO']);
  const capturedTable = table(capturedBook, 'Catálogo');
  const filterMetadata = Array.from({ length: capturedTable.headerRow.number - 1 }, (_, index) =>
    capturedTable.sheet.getRow(index + 1).values.filter(Boolean).join(' ')).join(' ');
  assert.match(filterMetadata, /Búsqueda: compleja/); assert.match(filterMetadata, /Otros conceptos: No/);
  await exportButton().waitFor();

  await all.click(); await search.fill(''); await status.selectOption('TODOS');
  exportFailure = true;
  const beforeFailure = downloads.length;
  await exportButton().click();
  await page.getByRole('alert').filter({ hasText: 'No se pudo descargar el catálogo' }).waitFor();
  await exportButton().waitFor();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(downloads.length, beforeFailure, 'Un error HTTP no descarga un Excel parcial');
  exportFailure = false; incompleteSnapshot = true;
  await exportButton().click();
  await page.getByRole('alert').filter({ hasText: /tarifas|complet/i }).waitFor();
  await exportButton().waitFor();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(downloads.length, beforeFailure, 'Un snapshot incompleto tampoco descarga un Excel parcial');
  incompleteSnapshot = false;
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1100 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Sin desbordamiento ${width}px`);
  }
  await page.screenshot({ path: path.join(output, 'catalogo-export-readonly-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 1100 });
  await page.screenshot({ path: path.join(output, 'catalogo-export-readonly-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  assert.equal(exportReads, 9, 'Cada exportación consulta su snapshot completo una sola vez');
  assert.equal(downloads.length, 7);
  assert.ok(methods.every(request => request.method === 'GET'));
  console.log('PASS: Excel de catálogo en consulta; 3 hojas, todas las páginas, filtros capturados, estados, referencias cero/vacía, tarifas por médico/función/vigencia/inactivas, exclusiones, errores sin descarga parcial y móvil.');
} finally { await browser?.close(); await server.close(); }
