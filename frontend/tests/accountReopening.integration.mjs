import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.resolve(root, '../tmp/account-review');
await fs.mkdir(outputDir, { recursive: true });
const server = await createServer({
  configFile: false, root, cacheDir: path.join(outputDir, 'vite-cache'), appType: 'custom',
  plugins: [react(), {
    name: 'account-review-preview', configureServer(server) {
      server.middlewares.use('/__account_review', async (_req, res) => {
        const html = await server.transformIndexHtml('/__account_review', `<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body><div id="root"></div><script type="module">
          import React from 'react'; import { createRoot } from 'react-dom/client';
          import AccountReopeningReview from '/src/pages/AccountReopeningReview.jsx';
          import '/src/styles/globals.css';
          createRoot(document.getElementById('root')).render(React.createElement('main', {style:{padding:'20px',maxWidth:'1400px',margin:'auto'}},React.createElement(AccountReopeningReview)));
        </script></body></html>`);
        res.setHeader('Content-Type', 'text/html'); res.end(html);
      });
    },
  }], server: { host: '127.0.0.1', port: 0, hmr: false },
});

const invoice = { id: 'Invoices:101', entity: 'Invoices', docEntry: 101, docNum: 7001, typeLabel: 'Factura de clientes', status: 'closed', sapStatus: 'bost_Close', cancelled: false, date: '2026-09-30', total: 12500, currency: 'MXN' };
const order = { id: 'Orders:202', entity: 'Orders', docEntry: 202, docNum: 8002, typeLabel: 'Pedido de clientes', status: 'closed', sapStatus: 'bost_Close', cancelled: false, date: '2026-09-29', total: 12500, currency: 'MXN' };
const base = { account: '12345', patientName: 'Paciente de prueba', checkedAt: '2026-10-01T18:00:00Z', complete: true, eligible: true, status: 'eligible', reasons: [], invoices: [invoice], nodes: [order, invoice], edges: [{ source: order.id, target: invoice.id, label: 'Documento base' }], openDocuments: [], warnings: [] };
let detail = structuredClone(base);
let searchResults = [{ account: '12345', patientName: 'Paciente de prueba', invoiceCount: 1 }];
let searchError = false;
let detailError = false;
const detailOverrides = new Map();
const fullMapOverrides = new Map();
let delayedAccount = null;
let delayedDetailGate = null;
let delayedFullMapOnly = false;
let delayedSearchGate = null;
const requests = [];
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, timezoneId: 'America/Mexico_City' });
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error('Browser error:', error.message); });
  page.on('console', message => { if (message.type() === 'error') console.error('Browser console:', message.text()); });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    requests.push({ pathname: url.pathname, params: Object.fromEntries(url.searchParams), method: route.request().method() });
    if (url.pathname.endsWith('/account-review/search')) {
      if (delayedSearchGate) await delayedSearchGate;
      return route.fulfill(searchError ? { status: 503, json: { success: false, message: 'No se pudo consultar SAP. Intenta de nuevo.' } } : { json: { success: true, data: { accounts: searchResults, truncated: false } } });
    }
    if (url.pathname.includes('/account-review/')) {
      const account = decodeURIComponent(url.pathname.split('/').at(-1));
      // Capture the response before any intentional delay so the old account
      // really arrives after the new one without changing its data midflight.
      const responseDetail = url.searchParams.get('fullMap') === 'true' && fullMapOverrides.has(account) ? fullMapOverrides.get(account) : detailOverrides.get(account) || detail;
      const response = detailError ? { status: 503, json: { success: false, message: 'No se pudo verificar la cuenta. Intenta de nuevo.' } } : { json: { success: true, data: structuredClone(responseDetail) } };
      if (account === delayedAccount && delayedDetailGate && (!delayedFullMapOnly || url.searchParams.get('fullMap') === 'true')) await delayedDetailGate;
      try { return await route.fulfill(response); } catch (error) {
        // A delayed test response can be released after its real fetch abort.
        if (!route.request().failure()) throw error;
      }
    }
    return route.fulfill({ json: { success: true, data: [] } });
  });
  await page.goto(`${server.resolvedUrls.local[0]}__account_review`);
  // Selectors below use the public labels and remain independent of implementation details.
  const input = page.getByRole('textbox').first();
  const positive = page.getByText('Cumple condiciones para reapertura', { exact: true });
  const searchButton = page.getByRole('button', { name: /^Buscar$/ });
  await input.fill('Paciente de prueba');
  await searchButton.click();
  await page.getByRole('button', { name: /12345/ }).click();
  await positive.waitFor();
  assert.equal(requests.find(request => request.pathname.endsWith('/search')).params.mode, 'patient');
  assert.ok(await page.getByText('bost_Close', { exact: true }).count() > 0);
  await page.screenshot({ path: path.join(outputDir, 'closed-account.png'), fullPage: true });

  const refresh = page.getByRole('button', { name: /Actualizar|Volver a consultar|Verificar de nuevo/ }).first();
  async function reloadDetail(nextDetail, expectedPositive = false) {
    detail = nextDetail;
    const response = page.waitForResponse(result => new URL(result.url()).pathname.endsWith('/account-review/12345'));
    await refresh.click();
    await response;
    await page.getByRole('button', { name: 'Actualizar desde SAP', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Estado de las facturas', exact: true }).waitFor();
    assert.equal(await positive.count(), expectedPositive ? 1 : 0);
  }
  await reloadDetail({ ...structuredClone(base), eligible: false, status: 'blocked', nodes: [{ ...order, status: 'open', sapStatus: 'bost_Open' }, invoice], openDocuments: [{ ...order, status: 'open', sapStatus: 'bost_Open' }], reasons: ['El pedido 8002 sigue abierto en SAP.'] });
  await page.getByText('El pedido 8002 sigue abierto en SAP.', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(outputDir, 'open-relation.png'), fullPage: true });

  await reloadDetail({ ...structuredClone(base), complete: false, eligible: true, status: 'eligible', reasons: ['La consulta del mapa quedó incompleta.'] });
  await page.getByText('La consulta del mapa quedó incompleta.', { exact: true }).waitFor();
  await reloadDetail({ ...structuredClone(base), invoices: [], nodes: [], edges: [] });
  await reloadDetail({ ...structuredClone(base), nodes: [invoice, { ...order, status: 'unknown', sapStatus: null }] });

  const missingLiteral = { ...invoice, sapStatus: null };
  await reloadDetail({ ...structuredClone(base), invoices: [missingLiteral], nodes: [order, missingLiteral] });
  assert.ok(await page.getByText('Sin estado disponible', { exact: true }).count() > 0, 'Missing literal SAP state must be visible and prevent a positive result');

  const cancelledInvoice = { ...invoice, id: 'Invoices:102', docEntry: 102, docNum: 7002, cancelled: true, status: 'cancelled', sapStatus: null };
  await reloadDetail({ ...structuredClone(base), invoices: [invoice, cancelledInvoice], nodes: [order, invoice, cancelledInvoice] }, true);
  assert.ok(await page.getByText('Cancelado', { exact: true }).count() > 0, 'Confirmed cancelled invoices remain visible alongside the current closed invoice');
  await reloadDetail({ ...structuredClone(base), invoices: [cancelledInvoice], nodes: [cancelledInvoice], edges: [] });
  const unknownCancellation = { ...invoice, cancelled: null };
  await reloadDetail({ ...structuredClone(base), invoices: [unknownCancellation], nodes: [order, unknownCancellation] });

  // Native journal/transfer entities omit cancellation metadata; their verified
  // ledger/native state remains usable while invoice cancellation stays strict.
  const settledJournal = { id: 'JournalEntries:404', entity: 'JournalEntries', docEntry: 404, docNum: 9104, typeLabel: 'Asiento contable', status: 'settled', statusBasis: 'ledger', sapStatus: 'Sin partidas abiertas (ML, ME y MS)', cancelled: null, date: '2026-09-30', total: null, currency: null };
  const closedTransfer = { id: 'StockTransfers:505', entity: 'StockTransfers', docEntry: 505, docNum: 8105, typeLabel: 'Traslado de inventario', status: 'closed', statusBasis: 'document', sapStatus: 'bost_Close', cancelled: null, date: '2026-09-30', total: null, currency: null };
  await reloadDetail({ ...structuredClone(base), nodes: [order, invoice, settledJournal], edges: [...base.edges, { source: invoice.id, target: settledJournal.id, label: 'Asiento contable' }] }, true);
  const journalNode = page.getByRole('button', { name: /Asiento contable.*#9104/ });
  assert.match(await journalNode.textContent(), /Sin partidas abiertas \(ML, ME y MS\)/);
  assert.doesNotMatch(await journalNode.textContent(), /bost_Close/, 'A ledger-verified journal without cancellation metadata must not pretend to have a literal closed state');
  await reloadDetail({ ...structuredClone(base), nodes: [order, invoice, closedTransfer], edges: [...base.edges, { source: order.id, target: closedTransfer.id, label: 'Traslado asociado' }] }, true);
  assert.match(await page.getByRole('button', { name: /Traslado de inventario.*#8105/ }).textContent(), /SAP: bost_Close/);
  await reloadDetail({ ...structuredClone(base), nodes: [order, invoice, { ...closedTransfer, cancelled: true }] });

  const settledPayment = { id: 'IncomingPayments:303', entity: 'IncomingPayments', docEntry: 303, docNum: 9003, typeLabel: 'Pago recibido', status: 'settled', sapStatus: 'Sin partidas abiertas', cancelled: false, date: '2026-09-30', total: 12500, currency: 'MXN' };
  await reloadDetail({ ...structuredClone(base), nodes: [order, invoice, settledPayment], edges: [...base.edges, { source: invoice.id, target: settledPayment.id, label: 'Pago aplicado' }] }, true);
  const paymentNode = page.getByRole('button', { name: /Pago recibido.*#9003/ });
  assert.match(await paymentNode.textContent(), /SAP: Sin partidas abiertas/);
  assert.doesNotMatch(await paymentNode.textContent(), /bost_Close/, 'A settled financial document must not pretend to have a literal closed SAP status');
  await paymentNode.click();
  await page.getByRole('heading', { name: 'Pago recibido 9003', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Relaciones del documento', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Factura de clientes 7001', exact: true }).click();
  await page.getByRole('heading', { name: 'Factura de clientes 7001', exact: true }).waitFor();

  // Zoom must change the actual diagram geometry and reset to its original size.
  const scale = page.getByRole('button', { name: 'Restablecer escala del mapa' });
  const diagramInvoice = page.getByRole('button', { name: /Factura de clientes.*#7001/ });
  const initialWidth = (await diagramInvoice.boundingBox()).width;
  await page.getByRole('button', { name: 'Reducir mapa', exact: true }).click();
  assert.equal(await scale.textContent(), '85%');
  assert.ok(Math.abs((await diagramInvoice.boundingBox()).width - initialWidth * 0.85) < 1);
  await page.getByRole('button', { name: 'Ampliar mapa', exact: true }).click();
  assert.equal(await scale.textContent(), '100%');
  await page.getByRole('button', { name: 'Reducir mapa', exact: true }).click();
  await scale.click();
  assert.ok(Math.abs((await diagramInvoice.boundingBox()).width - initialWidth) < 1);
  await page.getByText('Ver lista de todas las relaciones (2)', { exact: true }).click();
  await page.screenshot({ path: path.join(outputDir, 'settled-relationship.png'), fullPage: true });

  detailError = true;
  await refresh.click();
  await page.getByText('No se pudo verificar la cuenta. Intenta de nuevo.', { exact: true }).waitFor();
  assert.equal(await positive.count(), 0);
  detailError = false;

  // Account mode trims only outer whitespace and sends the exact account value.
  detail = structuredClone(base);
  await page.getByRole('combobox', { name: 'Buscar por', exact: true }).selectOption('account');
  await input.fill(' 12345 ');
  await input.press('Enter');
  await positive.waitFor();
  assert.deepEqual(requests.filter(request => request.pathname.endsWith('/search')).at(-1).params, { mode: 'account', q: '12345' });

  searchResults = [];
  await input.fill('99999');
  assert.equal(await positive.count(), 0, 'Changing the query must invalidate a previously positive account');
  await searchButton.click();
  await page.getByRole('heading', { name: 'No se encontraron cuentas', exact: true }).waitFor();
  assert.equal(await positive.count(), 0, 'No results must not reuse a previous positive result');
  assert.equal(await page.getByRole('button', { name: 'Actualizar desde SAP', exact: true }).count(), 0);

  searchResults = [{ account: '12345', patientName: base.patientName, invoiceCount: 1 }];
  await input.fill('12345');
  await searchButton.click();
  await positive.waitFor();
  searchError = true;
  await input.fill('54321');
  await searchButton.click();
  await page.getByText('No se pudo consultar SAP. Intenta de nuevo.', { exact: true }).waitFor();
  assert.equal(await positive.count(), 0, 'A failed search must not retain a previously positive result');
  searchError = false;

  // Hold an old positive response while a newly selected account finishes first.
  const newInvoice = { ...invoice, id: 'Invoices:401', docEntry: 401, docNum: 7101, status: 'open', sapStatus: 'bost_Open' };
  const newAccountReason = 'La factura 7101 de la cuenta 67890 sigue abierta en SAP.';
  detailOverrides.set('12345', structuredClone(base));
  detailOverrides.set('67890', { ...structuredClone(base), account: '67890', patientName: 'Paciente seleccionado más reciente', eligible: false, status: 'blocked', invoices: [newInvoice], nodes: [newInvoice], edges: [], openDocuments: [newInvoice], reasons: [newAccountReason] });
  searchResults = [{ account: '12345', patientName: base.patientName, invoiceCount: 1 }, { account: '67890', patientName: 'Paciente seleccionado más reciente', invoiceCount: 1 }];
  let releaseSlowResponse;
  delayedAccount = '12345';
  delayedDetailGate = new Promise(resolve => { releaseSlowResponse = resolve; });
  await page.getByRole('combobox', { name: 'Buscar por', exact: true }).selectOption('patient');
  await input.fill('Paciente');
  await searchButton.click();
  await page.getByRole('heading', { name: '2 cuentas encontradas', exact: true }).waitFor();
  const oldRequestStarted = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/account-review/12345'));
  await page.getByRole('button', { name: /Cuenta 12345/ }).click();
  await oldRequestStarted;
  const oldRequestCancelled = page.waitForEvent('requestfailed', { predicate: request => new URL(request.url()).pathname.endsWith('/account-review/12345') });
  await page.getByRole('button', { name: /Cuenta 67890/ }).click();
  await oldRequestCancelled;
  await page.getByText(newAccountReason, { exact: true }).waitFor();
  releaseSlowResponse();
  await page.waitForLoadState('networkidle');
  await page.getByRole('heading', { name: 'Paciente seleccionado más reciente', exact: true }).waitFor();
  assert.equal(await positive.count(), 0, 'A stale positive response must not overwrite the latest blocked account');
  assert.ok(await page.getByText(newAccountReason, { exact: true }).isVisible());
  delayedAccount = null;
  delayedDetailGate = null;
  detailOverrides.clear();

  // Inspect the real invoice table, graph and selected document at mobile width.
  searchResults = [{ account: '12345', patientName: base.patientName, invoiceCount: 1 }];
  await page.getByRole('combobox', { name: 'Buscar por', exact: true }).selectOption('account');
  await input.fill('12345');
  await input.press('Enter');
  await positive.waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /Pedido de clientes.*#8002/ }).click();
  await page.getByRole('heading', { name: 'Pedido de clientes 8002', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Relaciones del documento', exact: true }).waitFor();
  await page.screenshot({ path: path.join(outputDir, 'mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, 'Mobile must not overflow the page');

  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.clock.install();
  let releasePreviousPositive;
  delayedAccount = '12345';
  delayedDetailGate = new Promise(resolve => { releasePreviousPositive = resolve; });
  const positiveRefreshStarted = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/account-review/12345'));
  const positiveRefreshCancelled = page.waitForEvent('requestfailed', { predicate: request => new URL(request.url()).pathname.endsWith('/account-review/12345') });
  await refresh.click();
  await positiveRefreshStarted;
  assert.equal(await positive.count(), 0, 'Refreshing must invalidate an earlier positive diagnostic immediately');
  assert.ok(await page.getByRole('heading', { name: 'Estado de las facturas', exact: true }).isVisible(), 'Earlier invoice observations must remain available while the refresh is pending');
  assert.ok(await page.getByText('Datos de la consulta anterior', { exact: true }).isVisible());
  await page.getByRole('button', { name: 'Cancelar consulta', exact: true }).click();
  await positiveRefreshCancelled;
  releasePreviousPositive();
  delayedDetailGate = null;
  delayedAccount = null;
  await page.waitForLoadState('networkidle');
  assert.equal(await positive.count(), 0, 'Cancelling the refresh must not restore a previous positive diagnostic');

  const noInvoiceAccount = { ...structuredClone(base), account: '5294', patientName: 'Sin nombre de paciente en SAP', complete: false, eligible: false, status: 'blocked', mapState: 'not_requested', invoices: [], nodes: [order], edges: [], reasons: ['La cuenta no tiene una factura localizada en SAP.'], warnings: ['Mapa completo no consultado: la cuenta no tiene factura y no cumple el requisito para reapertura.'] };
  detailOverrides.set('5294', noInvoiceAccount);
  fullMapOverrides.set('5294', { ...noInvoiceAccount, complete: true, mapState: 'complete', warnings: [] });
  searchResults = [{ account: '5294', patientName: 'Paciente cuenta 5294', invoiceCount: 0 }];
  await input.fill('5294');
  await input.press('Enter');
  await page.getByRole('heading', { name: 'Mapa completo no consultado', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Paciente cuenta 5294', exact: true }).waitFor();
  assert.equal(await positive.count(), 0);
  assert.equal(await page.getByRole('region', { name: /Mapa SAP con/ }).count(), 0, 'A skipped full map must not render a partial diagram as if all relations were verified');
  assert.ok(await page.getByText('0 facturas localizadas en la búsqueda inicial', { exact: true }).isVisible());
  assert.ok(await page.getByText('Sin verificar', { exact: true }).count() > 0, 'Unknown open-document count must not be presented as zero');
  assert.equal(requests.filter(request => request.pathname.endsWith('/account-review/5294')).at(-1).params.fullMap, undefined);
  await page.screenshot({ path: path.join(outputDir, 'no-invoice-account.png'), fullPage: true });

  // Explicit full-map work keeps the earlier invoice findings and patient name.
  delayedAccount = '5294';
  delayedFullMapOnly = true;
  let releaseFullMap;
  delayedDetailGate = new Promise(resolve => { releaseFullMap = resolve; });
  const fullMapStarted = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname.endsWith('/account-review/5294') && url.searchParams.get('fullMap') === 'true';
  });
  await page.getByRole('button', { name: 'Consultar mapa completo', exact: true }).click();
  await fullMapStarted;
  await page.getByRole('button', { name: 'Cancelar consulta', exact: true }).waitFor();
  assert.ok(await page.getByRole('heading', { name: 'Estado de las facturas', exact: true }).isVisible());
  assert.ok(await page.getByText('Datos de la consulta anterior', { exact: true }).isVisible());
  assert.ok(await page.getByRole('heading', { name: 'Paciente cuenta 5294', exact: true }).isVisible());
  assert.equal(await positive.count(), 0);
  assert.equal(await page.getByRole('progressbar').count(), 0, 'Elapsed time must not masquerade as a percentage of SAP work completed');
  await page.clock.fastForward(30_000);
  await page.getByText('Todavía no se ha recibido la respuesta de SAP. La cuenta sigue sin verificar.', { exact: true }).waitFor();
  await page.clock.fastForward(30_000);
  await page.getByText('La consulta lleva un minuto o más. Puedes cancelarla y volver a intentar.', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(outputDir, 'waiting-full-map.png'), fullPage: true });
  const fullMapCancelled = page.waitForEvent('requestfailed', { predicate: request => new URL(request.url()).pathname.endsWith('/account-review/5294') });
  await page.getByRole('button', { name: 'Cancelar consulta', exact: true }).click();
  await fullMapCancelled;
  await page.getByText('Consulta cancelada. La cuenta sigue sin verificar; puedes reintentar cuando lo necesites.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Cancelar consulta', exact: true }).count(), 0);
  releaseFullMap();
  delayedDetailGate = null;
  await page.waitForLoadState('networkidle');
  assert.equal(await positive.count(), 0, 'A response released after cancellation must not certify the account');
  await page.getByRole('button', { name: 'Reintentar consulta', exact: true }).click();
  await page.getByRole('region', { name: /Mapa SAP con/ }).waitFor();
  assert.equal(await positive.count(), 0, 'An explicit complete map cannot satisfy the missing-invoice requirement');
  assert.equal(requests.filter(request => request.pathname.endsWith('/account-review/5294')).at(-1).params.fullMap, 'true', 'Retry must preserve the explicit full-map request');

  // Advance only the browser clock: a stalled response must be aborted at the
  // real configured deadline without waiting four minutes in the test runner.
  let releaseTimedOutDetail;
  delayedDetailGate = new Promise(resolve => { releaseTimedOutDetail = resolve; });
  const timeoutStarted = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/account-review/5294'));
  const timedOutDetail = page.waitForEvent('requestfailed', { predicate: request => new URL(request.url()).pathname.endsWith('/account-review/5294') });
  await refresh.click();
  await timeoutStarted;
  await page.clock.fastForward(250_001);
  await timedOutDetail;
  await page.getByText('La consulta alcanzó el límite de espera de 4 min 10 s. La cuenta sigue sin verificar. Puedes reintentar la consulta.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Cancelar consulta', exact: true }).count(), 0);
  assert.ok(await page.getByRole('button', { name: 'Reintentar consulta', exact: true }).isEnabled());
  assert.equal(await positive.count(), 0);
  releaseTimedOutDetail();
  delayedDetailGate = null;
  delayedAccount = null;
  delayedFullMapOnly = false;
  await page.waitForLoadState('networkidle');

  let releaseTimedOutSearch;
  delayedSearchGate = new Promise(resolve => { releaseTimedOutSearch = resolve; });
  const searchTimeoutStarted = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/account-review/search'));
  const timedOutSearch = page.waitForEvent('requestfailed', { predicate: request => new URL(request.url()).pathname.endsWith('/account-review/search') });
  await input.fill('12345');
  await searchButton.click();
  await searchTimeoutStarted;
  await page.clock.fastForward(130_001);
  await timedOutSearch;
  await page.getByText('La búsqueda alcanzó el límite de espera de 2 min 10 s. Puedes intentarlo de nuevo.', { exact: true }).waitFor();
  assert.ok(await searchButton.isEnabled());
  assert.equal(await page.getByRole('button', { name: 'Cancelar búsqueda', exact: true }).count(), 0);
  assert.equal(await positive.count(), 0);
  releaseTimedOutSearch();
  delayedSearchGate = null;
  await page.waitForLoadState('networkidle');

  let releaseCancelledSearch;
  delayedSearchGate = new Promise(resolve => { releaseCancelledSearch = resolve; });
  const cancelledSearchStarted = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/account-review/search'));
  const cancelledSearch = page.waitForEvent('requestfailed', { predicate: request => new URL(request.url()).pathname.endsWith('/account-review/search') });
  await input.fill('54321');
  await searchButton.click();
  await cancelledSearchStarted;
  await page.getByRole('button', { name: 'Cancelar búsqueda', exact: true }).click();
  await cancelledSearch;
  await page.getByText('Búsqueda cancelada. Puedes intentarlo de nuevo.', { exact: true }).waitFor();
  releaseCancelledSearch();
  delayedSearchGate = null;
  await page.waitForLoadState('networkidle');
  assert.equal(await positive.count(), 0);
  assert.ok(requests.every(request => request.method === 'GET'), 'This section must only query the API');
  assert.deepEqual(errors, []);
  console.log('PASS account reopening: patient/account search, literal SAP state, cancellation/ledger flags, skipped/explicit full map, retained findings, elapsed time, real request cancellation/timeouts, stale-response protection, graph selection/zoom, mobile and read-only API');
} finally {
  await browser?.close();
  await server.close();
}
