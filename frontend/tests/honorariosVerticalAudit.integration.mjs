import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';

const require = createRequire(import.meta.url);
const audit = require('../../backend/services/honorariosVerticalAudit.service');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '../tmp/honorarios-vertical-audit');
await mkdir(output, { recursive: true });
const data = Array.from({ length: 130 }, (_, index) => audit.normalizeRow({
  PCDate: '2026-09-02T23:40:00', CreatedOn: '2026-09-01T18:00:00', PCNum: 100 + index, SONum: 900 + index,
  UDRKey: `CITA-${100 + index}`, PTName: `PACIENTE PRUEBA ${index}`, BPName: 'ASEGURADORA PRUEBA',
  Medico: index % 2 ? 'MÉDICO DOS' : 'MÉDICO UNO', Especialidad: 'MEDICINA GENERAL', ItemCode: `SER${index}`,
  ItemGroupName: index % 2 ? 'CONSULTA EXTERNA' : 'DENTAL', ItemDescription: 'SERVICIO DE PRUEBA',
  Quantity: 1, IMPORTE: index === 0 ? null : 200, Pasa_PC_ST: null, Pasa_ItemType: true,
  Pasa_UT_Honorarios: false, Pasa_Incluido_Honorarios: true, Elegible_V_HON_PAGO: index === 0 ? null : index % 2 === 0,
  MotivoExclusion: index % 2 ? 'Servicio fuera de las reglas de inclusión' : null, OrigenRenglon: 'ORDEN_CITA_PCAP_SO', PCAP_ST: 'SH'
}));
const options = { doctors: ['MÉDICO DOS', 'MÉDICO UNO'], groups: ['CONSULTA EXTERNA', 'DENTAL'],
  sources: [{ value: 'ORDEN_CITA_PCAP_SO', label: 'Orden con cita' }] };
const requests = [];
const optionRequests = [];
let fail = false, exportFail = false, slow = false, optionsFail = false;
const server = await createServer({ configFile: false, root, appType: 'custom', plugins: [react(), {
  name: 'isolated-vertical-audit-test', configureServer(server) { server.middlewares.use('/__vertical_audit', async (_req, res) => {
    const html = await server.transformIndexHtml('/__vertical_audit', '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles/globals.css"><style>body{background:#f1f5f9;margin:16px}#root{max-width:1500px;margin:auto}</style></head><body><div id="root"></div><script type="module">import React from "react";import{createRoot}from"react-dom/client";import{AuthProvider}from"/src/context/AuthContext.jsx";import View from "/src/components/honorarios/HonorariosAuditView.jsx";createRoot(document.getElementById("root")).render(React.createElement(AuthProvider,null,React.createElement(View)));</script></body></html>');
    res.setHeader('Content-Type', 'text/html'); res.end(html);
  }); }
}], server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1050 }, acceptDownloads: true });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => sessionStorage.setItem('escandon_token', 'token-prueba'));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: 7, role: 'ADMIN', nombre: 'REVISOR PRUEBA', permisos: ['interconsultas-jornadas'] } } }));
  await page.route('**/api/honorarios/**', async route => {
    const url = new URL(route.request().url()); const endpoint = url.pathname.replace('/api/honorarios', '');
    if (endpoint === '/providers') return route.fulfill({ json: { providers: [] } });
    if (endpoint === '/fiscal-profiles') return route.fulfill({ json: { profiles: {} } });
    if (endpoint === '/vertical-audit/options') {
      const query = Object.fromEntries(url.searchParams); optionRequests.push(query);
      if (optionsFail) return route.fulfill({ status: 503, json: { error: 'No se pudieron cargar las listas de médicos, grupos y orígenes. Intenta nuevamente.' } });
      const periodOptions = query.startDate.startsWith('2026-08') ? { doctors: [], groups: [], sources: [] }
        : query.startDate.startsWith('2026-10') ? { doctors: ['MÉDICO OCTUBRE'], groups: ['GRUPO OCTUBRE'], sources: [{ value: 'CITA', label: 'Cita médica' }] }
          : { ...options, groups: [...options.groups, 'ALMACEN GENERAL', 'Almacén Quirófano', 'farmacia', 'FARMACIA SATÉLITE'] };
      return route.fulfill({ json: { ok: true, options: periodOptions } });
    }
    if (endpoint.startsWith('/vertical-audit')) {
      const query = Object.fromEntries(url.searchParams); requests.push({ endpoint, query });
      if (fail && endpoint === '/vertical-audit') return route.fulfill({ status: 503, json: { error: 'No se pudo consultar la auditoría. Intenta nuevamente.' } });
      if (exportFail && endpoint.endsWith('/excel')) return route.fulfill({ status: 400, json: { error: 'Hay más de 50,000 registros. Reduce las fechas para descargar el Excel completo.' } });
      if (slow) await new Promise(resolve => setTimeout(resolve, 500));
      const rows = data.filter(row => (!query.doctor || row.Medico === query.doctor) && (!query.group || row.ItemGroupName === query.group)
        && (!query.source || row.OrigenRenglon === query.source) && (query.status === 'all' || row.auditStatus === query.status)
        && (!query.search || `${row.PTName} ${row.PCNum} ${row.SONum} ${row.ItemCode}`.includes(query.search)));
      if (endpoint.endsWith('/excel')) {
        const stream = new PassThrough(); const chunks = []; stream.on('data', chunk => chunks.push(chunk));
        await audit.writeExcel(stream, { filters: audit.validateFilters(query), rows }, { nombre: 'REVISOR PRUEBA' });
        return route.fulfill({ contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: Buffer.concat(chunks) });
      }
      const size = Number(query.pageSize); const currentPage = Number(query.page);
      const summary = { total: rows.length, eligible: rows.filter(row => row.auditStatus === 'eligible').length,
        excluded: rows.filter(row => row.auditStatus === 'excluded').length, unknown: rows.filter(row => row.auditStatus === 'unknown').length };
      return route.fulfill({ json: { ok: true, rows: rows.slice((currentPage - 1) * size, currentPage * size), summary,
        page: currentPage, pageSize: size, totalPages: Math.ceil(rows.length / size), columns: audit.COLUMNS,
        options: query.includeOptions === 'true' ? options : undefined } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__vertical_audit`);
  await page.getByRole('button', { name: 'Auditoría', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Auditoría de honorarios', exact: true });
  await panel.getByLabel('Médico', { exact: true }).locator('option').nth(1).waitFor({ state: 'attached' });
  assert.ok(optionRequests.length > 0, 'Lists load on entering audit');
  assert.equal(requests.length, 0, 'Loading filter lists does not fetch the patient report');
  await panel.getByLabel('Desde', { exact: true }).fill('2026-09-01');
  await panel.getByLabel('Hasta', { exact: true }).fill('2026-09-30');
  await panel.getByRole('status').filter({ hasText: 'Cargando médicos' }).waitFor({ state: 'hidden' });
  assert.deepEqual(await panel.getByLabel('Médico', { exact: true }).locator('option').allTextContents(), ['Todos los médicos', ...options.doctors]);
  assert.deepEqual(await panel.getByLabel('Grupo de servicio').locator('option').allTextContents(), ['Todos los grupos', ...options.groups]);
  assert.deepEqual(await panel.getByLabel('Origen del registro').locator('option').allTextContents(), ['Todos los orígenes', 'Orden con cita']);
  assert.equal(requests.length, 0, 'All lists are populated before the first consultation');
  assert.deepEqual(optionRequests.at(-1), { startDate: '2026-09-01', endDate: '2026-09-30' });
  await panel.getByLabel('Médico', { exact: true }).selectOption('MÉDICO UNO');
  await panel.getByLabel('Médico', { exact: true }).selectOption('');
  assert.equal(await panel.getByRole('button', { name: 'Descargar Excel' }).isEnabled(), false);
  await panel.getByRole('button', { name: 'Consultar auditoría' }).click();
  await panel.getByText('Página 1 de 3', { exact: true }).waitFor();
  assert.equal(await panel.locator('tbody tr').count(), 50);
  assert.ok((await panel.locator('tbody').innerText()).includes('DENTAL'));
  assert.doesNotMatch(await panel.locator('tbody').innerText(), /ALMAC[EÉ]N|FARMACIA/i);
  assert.ok(!(await panel.innerText()).includes('UDR_HON_PAGO_Audit'));
  await page.screenshot({ path: path.join(output, 'auditoria-desktop.png'), fullPage: true });
  await panel.getByRole('button', { name: 'Ver detalle del registro 1', exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.waitFor();
  assert.equal(await dialog.locator('dt').count(), 30);
  assert.ok((await dialog.innerText()).includes('Sin dato'));
  assert.ok((await dialog.innerText()).includes('Orden con cita'));
  assert.ok((await dialog.innerText()).includes('Sin evaluar'));
  assert.ok((await dialog.innerText()).includes('Llegada registrada'));
  const bounds = await dialog.boundingBox();
  assert.ok(Math.abs(bounds.x - (1500 - bounds.width) / 2) < 2, 'The detail dialog is centered');
  await page.screenshot({ path: path.join(output, 'auditoria-detalle.png') });
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  assert.equal(await panel.getByRole('button', { name: 'Ver detalle del registro 1', exact: true }).evaluate(node => node === document.activeElement), true);
  await panel.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await panel.getByText('Página 2 de 3', { exact: true }).waitFor();
  const downloadPromise = page.waitForEvent('download'); await panel.getByRole('button', { name: 'Descargar Excel' }).click();
  const download = await downloadPromise; const filename = path.join(output, download.suggestedFilename()); await download.saveAs(filename);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await readFile(filename));
  assert.equal(workbook.getWorksheet('Auditoría').rowCount, 136, 'Excel includes every row, not just the current screen page');
  assert.ok(!requests.at(-1).query.page, 'Excel request omits screen pagination');
  await panel.getByLabel('Médico', { exact: true }).selectOption('MÉDICO DOS');
  await panel.getByLabel('Grupo de servicio', { exact: true }).selectOption('CONSULTA EXTERNA');
  await panel.getByLabel('Origen del registro', { exact: true }).selectOption('ORDEN_CITA_PCAP_SO');
  await panel.getByLabel('Resultado de revisión', { exact: true }).selectOption('excluded');
  await panel.getByLabel('Buscar paciente, médico, servicio, folio o motivo').fill('PACIENTE PRUEBA 129');
  await panel.getByLabel('Ordenar por', { exact: true }).selectOption('amount');
  assert.equal(await panel.getByRole('button', { name: 'Descargar Excel' }).isEnabled(), false);
  await panel.getByRole('button', { name: 'Consultar auditoría' }).click();
  await panel.getByText('Página 1 de 1', { exact: true }).waitFor();
  assert.equal(await panel.locator('tbody tr').count(), 1);
  assert.deepEqual(requests.at(-1).query, { startDate: '2026-09-01', endDate: '2026-09-30', doctor: 'MÉDICO DOS',
    group: 'CONSULTA EXTERNA', source: 'ORDEN_CITA_PCAP_SO', status: 'excluded', search: 'PACIENTE PRUEBA 129', sort: 'amount',
    direction: 'desc', page: '1', pageSize: '50' });
  await panel.getByRole('button', { name: 'Limpiar filtros' }).click();
  await panel.getByRole('button', { name: 'Consultar auditoría' }).click();
  await panel.getByText('Página 1 de 3', { exact: true }).waitFor();
  await panel.getByLabel('Registros por página').selectOption('25');
  await panel.getByText('Página 1 de 6', { exact: true }).waitFor();
  assert.equal(await panel.locator('tbody tr').count(), 25);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, 'auditoria-mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Only the table scrolls horizontally');
  await panel.getByLabel('Buscar paciente, médico, servicio, folio o motivo').fill('SIN COINCIDENCIA');
  await panel.getByRole('button', { name: 'Consultar auditoría' }).click();
  await panel.getByText('No se encontraron registros. Prueba otro periodo o limpia los filtros.').waitFor();
  assert.equal(await panel.getByRole('button', { name: 'Descargar Excel' }).isEnabled(), false);
  await panel.getByRole('button', { name: 'Limpiar filtros' }).click();
  fail = true;
  await panel.getByRole('button', { name: 'Consultar auditoría' }).click();
  await panel.getByRole('alert').filter({ hasText: 'No se pudo consultar' }).waitFor();
  assert.equal(await panel.locator('tbody tr').count(), 0);
  fail = false;
  await panel.getByRole('button', { name: 'Consultar auditoría' }).click();
  await panel.getByText('Página 1 de 6', { exact: true }).waitFor();
  exportFail = true;
  await panel.getByRole('button', { name: 'Descargar Excel' }).click();
  await panel.getByRole('alert').filter({ hasText: '50,000' }).waitFor();
  await panel.getByLabel('Hasta', { exact: true }).fill('2026-10-31');
  await panel.getByLabel('Desde', { exact: true }).fill('2026-10-01');
  await panel.getByLabel('Médico', { exact: true }).locator('option').filter({ hasText: 'MÉDICO OCTUBRE' }).waitFor({ state: 'attached' });
  assert.deepEqual(await panel.getByLabel('Médico', { exact: true }).locator('option').allTextContents(), ['Todos los médicos', 'MÉDICO OCTUBRE']);
  assert.deepEqual(await panel.getByLabel('Grupo de servicio').locator('option').allTextContents(), ['Todos los grupos', 'GRUPO OCTUBRE']);
  assert.deepEqual(await panel.getByLabel('Origen del registro').locator('option').allTextContents(), ['Todos los orígenes', 'Cita médica']);
  optionsFail = true;
  await panel.getByLabel('Desde', { exact: true }).fill('2026-09-01');
  await panel.getByRole('alert').filter({ hasText: 'listas de médicos' }).waitFor();
  optionsFail = false;
  await panel.getByRole('button', { name: 'Reintentar listas' }).click();
  await panel.getByLabel('Médico', { exact: true }).locator('option').filter({ hasText: 'MÉDICO UNO' }).waitFor({ state: 'attached' });
  assert.equal(await panel.getByRole('alert').filter({ hasText: 'listas de médicos' }).count(), 0);
  await panel.getByLabel('Desde', { exact: true }).fill('2026-08-01');
  await panel.getByLabel('Hasta', { exact: true }).fill('2026-08-31');
  await panel.getByRole('status').filter({ hasText: 'No hay médicos, grupos u orígenes disponibles' }).waitFor();
  assert.equal(await panel.getByLabel('Médico', { exact: true }).locator('option').count(), 1);
  slow = true;
  await panel.getByRole('button', { name: 'Consultar auditoría' }).click();
  await page.getByRole('button', { name: 'Servicios', exact: true }).click();
  await page.waitForTimeout(700);
  assert.equal(await page.locator('.hon-vertical-audit').count(), 0, 'Leaving audit cancels its pending request');
  assert.deepEqual(errors, []);
  console.log('PASS: automatic filter lists before consultation, date changes, list retry/empty states, filters, detail, pagination, complete Excel, mobile layout and cancellation.');
} finally { await browser?.close(); await server.close(); }
