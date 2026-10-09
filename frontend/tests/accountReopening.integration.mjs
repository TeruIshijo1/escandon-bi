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
          import { AuthProvider } from '/src/context/AuthContext.jsx';
          import '/src/styles/globals.css';
          createRoot(document.getElementById('root')).render(React.createElement(AuthProvider,null,React.createElement('main', {style:{padding:'20px',maxWidth:'1400px',margin:'auto'}},React.createElement(AccountReopeningReview))));
        </script></body></html>`);
        res.setHeader('Content-Type', 'text/html'); res.end(html);
      });
    },
  }], server: { host: '127.0.0.1', port: 0, hmr: false },
});

const invoice = { id: 'Invoices:101', entity: 'Invoices', docEntry: 101, docNum: 7001, typeLabel: 'Factura de clientes', status: 'closed', sapStatus: 'bost_Close', cancelled: false, date: '2026-09-30', total: 12500, currency: 'MXN' };
const order = { id: 'Orders:202', entity: 'Orders', docEntry: 202, docNum: 8002, typeLabel: 'Pedido de clientes', status: 'closed', sapStatus: 'bost_Close', cancelled: false, date: '2026-09-29', total: 12500, currency: 'MXN', cardCode: 'CTE00029', cardName: 'VENTA GENERAL' };
const base = { account: '12345', accountFound: true, accountDocumentCount: 2, patientName: 'Paciente de prueba', checkedAt: '2026-10-01T18:00:00Z', complete: true, eligible: true, status: 'eligible', reasons: [], invoices: [invoice], nodes: [order, invoice], edges: [{ source: order.id, target: invoice.id, label: 'Documento base' }], openDocuments: [], warnings: [] };
let detail = structuredClone(base);
let searchResults = [{ account: '12345', patientName: 'Paciente de prueba', invoiceCount: 1 }];
let searchError = false;
let searchLookup = null;
let detailError = false;
const detailOverrides = new Map();
const fullMapOverrides = new Map();
let delayedAccount = null;
let delayedDetailGate = null;
let delayedFullMapOnly = false;
let delayedSearchGate = null;
let authUser = { username: 'auditor_fixture', role: 'area', permisos: ['auditoria-reapertura-cuentas'] };
let reopeningBehavior = 'success';
let reopeningStatus = 'reopened';
let delayedExecuteGate = null;
let previewLifetime = 300_000;
let previewNumber = 0;
const requests = [];
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, timezoneId: 'America/Mexico_City' });
  await page.addInitScript(() => sessionStorage.setItem('escandon_token', 'synthetic-account-review-token'));
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error('Browser error:', error.message); });
  page.on('console', message => { if (message.type() === 'error') console.error('Browser console:', message.text()); });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    requests.push({ pathname: url.pathname, params: Object.fromEntries(url.searchParams), method: route.request().method(), body: route.request().postDataJSON() });
    if (url.pathname.endsWith('/auth/me')) return route.fulfill({ json: { user: authUser } });
    if (url.pathname.includes('/reopening/')) {
      const account = decodeURIComponent(url.pathname.split('/').at(-3));
      const operation = url.pathname.split('/').at(-1);
      const now = await page.evaluate(() => Date.now());
      const receipt = { account, status: 'reopened', operationId: `OP-FIXTURE-${account}`, backupFile: `D:\\Escritorio\\Reaperturas\\cuenta-${account}-fixture.md`, reopenedAt: new Date(now).toISOString(), previousStatus: 'CL', currentStatus: 'OP', deletedRecordId: 404, sapCheckedAt: new Date(now).toISOString() };
      if (operation === 'prepare') return route.fulfill({ json: { success: true, data: { account, status: 'ready', previewToken: `preview-fixture-${++previewNumber}`, expiresAt: new Date(now + previewLifetime).toISOString(), verticalStatus: 'CL', record: { id: 404, documentType: 'Orden de venta', documentNumber: '8002', reference: 'Referencia de prueba', populatedFields: { fixture: 'valor preservado' } }, recordCount: 1, backupDirectory: 'D:\\Escritorio\\Reaperturas', sapCheckedAt: new Date(now).toISOString() } } });
      if (operation === 'execute') {
        if (delayedExecuteGate) await delayedExecuteGate;
        if (reopeningBehavior === 'network') return route.abort('failed');
        if (reopeningBehavior === 'unknown409') return route.fulfill({ status: 409, json: { success: false, code: 'OPERATION_STATUS_UNKNOWN', message: 'El resultado de la operación todavía no se puede confirmar.' } });
        if (reopeningBehavior === 'conflict') return route.fulfill({ status: 409, json: { success: false, message: 'SAP detectó un documento abierto. La reapertura no se realizó.' } });
        return route.fulfill({ json: { success: true, data: receipt } });
      }
      if (operation === 'status') return route.fulfill({ json: { success: true, data: { ...receipt, status: reopeningStatus } } });
    }
    if (url.pathname.endsWith('/account-review/search')) {
      if (delayedSearchGate) await delayedSearchGate;
      return route.fulfill(searchError ? { status: 503, json: { success: false, message: 'No se pudo consultar SAP. Intenta de nuevo.' } } : { json: { success: true, data: { accounts: searchResults, truncated: false, ...(searchLookup ? { lookup: searchLookup } : {}) } } });
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
  const canOpenReview = user => page.evaluate(async currentUser => {
    const { hasPermission } = await import('/src/utils/rbac.js');
    return hasPermission(currentUser, '/auditoria/reapertura-cuentas');
  }, user);
  assert.equal(await canOpenReview(authUser), true, 'The reader fixture must have the current route permission');
  assert.equal(await canOpenReview({ username: 'admin_no_access_fixture', role: 'admin', permisos: [] }), false, 'Administrator role alone does not grant access to the review route');
  assert.equal(await canOpenReview({ username: 'write_only_fixture', role: 'area', permisos: ['ejecutar-reapertura-cuentas'] }), false, 'Execution permission alone does not grant access to the review route');
  // Selectors below use the public labels and remain independent of implementation details.
  const input = page.getByRole('textbox').first();
  const positive = page.getByText('Cumple condiciones para reapertura', { exact: true });
  const searchButton = page.getByRole('button', { name: /^Buscar$/ });
  await input.fill('Paciente de prueba');
  await searchButton.click();
  await page.getByRole('button', { name: /12345/ }).click();
  await positive.waitFor();
  assert.ok(await page.getByRole('button', { name: 'Preparar reapertura', exact: true }).isDisabled(), 'Read access must not grant permission to prepare or execute a reopening');
  assert.equal(requests.find(request => request.pathname.endsWith('/search')).params.mode, 'patient');
  assert.ok(await page.getByText('bost_Close', { exact: true }).count() > 0);
  assert.ok(await page.getByText('VENTA GENERAL', { exact: true }).isVisible());
  assert.match(await page.getByRole('button', { name: /Pedido de clientes.*#8002/ }).textContent(), /29 sep(?:t)? 2026.*12,500\.00 MXN/);
  await page.getByText('Los documentos cerrados o cancelados pueden seguir apareciendo en el mapa como historial.', { exact: false }).waitFor();
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
  await reloadDetail({ ...structuredClone(base), invoices: [], nodes: [order], edges: [] }, true);
  await page.getByText('No hay facturas vigentes; el resultado se confirma con los documentos y saldos del mapa completo.', { exact: false }).waitFor();
  await reloadDetail({ ...structuredClone(base), accountFound: false, accountDocumentCount: 0, invoices: [], nodes: [order], edges: [] });
  await reloadDetail({ ...structuredClone(base), accountFound: undefined, accountDocumentCount: undefined, invoices: [], nodes: [order], edges: [] });
  await reloadDetail({ ...structuredClone(base), nodes: [invoice, { ...order, status: 'unknown', sapStatus: null }] });
  await page.getByRole('heading', { name: 'Documentos pendientes de verificar', exact: true }).waitFor();
  await reloadDetail({ ...structuredClone(base), nodes: [order, invoice], edges: [{ source: order.id, target: 'DeliveryNotes:missing', label: 'Documento pendiente' }] });
  await page.getByText('Hay relaciones cuyos documentos todavía no se han obtenido.', { exact: false }).waitFor();

  const missingLiteral = { ...invoice, sapStatus: null };
  await reloadDetail({ ...structuredClone(base), invoices: [missingLiteral], nodes: [order, missingLiteral] });
  assert.ok(await page.getByText('Sin estado disponible', { exact: true }).count() > 0, 'Missing literal SAP state must be visible and prevent a positive result');

  const cancelledInvoice = { ...invoice, id: 'Invoices:102', docEntry: 102, docNum: 7002, cancelled: true, status: 'cancelled', sapStatus: null };
  await reloadDetail({ ...structuredClone(base), invoices: [invoice, cancelledInvoice], nodes: [order, invoice, cancelledInvoice] }, true);
  assert.ok(await page.getByText('Cancelado', { exact: true }).count() > 0, 'Confirmed cancelled invoices remain visible alongside the current closed invoice');
  const cancellationDocument = { ...cancelledInvoice, id: 'Invoices:103', docEntry: 103, docNum: 7003, typeLabel: 'Factura (documento de cancelación)', cancellationDocument: true };
  await reloadDetail({ ...structuredClone(base), invoices: [invoice, cancellationDocument], nodes: [order, invoice, cancellationDocument] }, true);
  await page.getByRole('button', { name: /Factura \(documento de cancelación\).*#7003/ }).click();
  await page.getByText('Este documento registra una cancelación en SAP.', { exact: false }).waitFor();
  await reloadDetail({ ...structuredClone(base), invoices: [cancelledInvoice], nodes: [cancelledInvoice], edges: [] }, true);
  await reloadDetail({ ...structuredClone(base), invoices: [cancelledInvoice, cancellationDocument], nodes: [order, cancelledInvoice, cancellationDocument], edges: [] }, true);
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

  // A native SAP chain retains its commercial direction even when accounting
  // provenance creates the reciprocal invoice ↔ journal relationship.
  const delivery = { ...order, id: 'DeliveryNotes:606', entity: 'DeliveryNotes', docEntry: 606, docNum: 44362, typeLabel: 'Entrega', date: '2026-09-30' };
  const reconciliation = { ...settledJournal, id: 'InternalReconciliations:707', entity: 'InternalReconciliations', docEntry: 707, docNum: 9707, typeLabel: 'Conciliación interna' };
  const chain = { ...structuredClone(base), nodes: [order, delivery, invoice, settledPayment, settledJournal, reconciliation], edges: [
    { source: order.id, target: delivery.id, label: 'Documento base' },
    { source: delivery.id, target: invoice.id, label: 'Documento base' },
    { source: invoice.id, target: settledPayment.id, label: 'Pago aplicado' },
    { source: invoice.id, target: settledJournal.id, label: 'Asiento contable' },
    { source: settledJournal.id, target: invoice.id, label: 'Origen del asiento' },
    { source: settledPayment.id, target: reconciliation.id, label: 'Conciliación de pago' },
    { source: settledJournal.id, target: reconciliation.id, label: 'Partida conciliada' },
  ] };
  await reloadDetail(chain, true);
  const commercialNodes = [/Pedido de clientes.*#8002/, /Entrega.*#44362/, /Factura de clientes.*#7001/, /Pago recibido.*#9003/];
  const chainBoxes = await Promise.all(commercialNodes.map(name => page.getByRole('button', { name }).boundingBox()));
  assert.ok(chainBoxes.every((box, index) => index === 0 || box.x > chainBoxes[index - 1].x), 'Reciprocal accounting links must not collapse the order → delivery → invoice → payment chain');
  await page.getByRole('button', { name: 'Ver todo el mapa', exact: true }).click();
  await page.getByText('Ver lista de todas las relaciones (7)', { exact: true }).click();
  assert.ok(await page.getByText('Origen del asiento', { exact: false }).count() > 0, 'Accounting provenance must remain inspectable');
  await page.screenshot({ path: path.join(outputDir, 'sap-chain.png'), fullPage: true });
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  await page.screenshot({ path: path.join(outputDir, 'sap-chain-dark.png'), fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, 'A full SAP chain must remain within the mobile page');
  await page.screenshot({ path: path.join(outputDir, 'sap-chain-mobile-dark.png'), fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.evaluate(() => document.documentElement.dataset.theme = 'light');

  // A fully cancelled commercial/payment chain can be reopened only after the
  // complete map and its accounting balances have been verified. Cancellation
  // alone must never override an open document or unknown financial state.
  const cancelledChain = { ...structuredClone(chain), reopeningScenario: 'all_cancelled', invoices: [{ ...invoice, cancelled: true, status: 'cancelled' }], nodes: chain.nodes.map(node => ['JournalEntries', 'InternalReconciliations'].includes(node.entity) ? node : { ...node, cancelled: true, status: 'cancelled' }) };
  const cancelledMapExplanation = page.getByText('Los documentos de la cuenta están cancelados y el mapa completo está verificado, sin documentos ni saldos abiertos. Cumple condiciones para reapertura.', { exact: true });
  await reloadDetail(cancelledChain, true);
  await cancelledMapExplanation.waitFor();
  await page.screenshot({ path: path.join(outputDir, 'all-cancelled-verified-map.png'), fullPage: true, animations: 'disabled' });
  await reloadDetail({ ...structuredClone(cancelledChain), complete: false, mapState: 'partial' });
  assert.equal(await cancelledMapExplanation.count(), 0, 'An all-cancelled partial map cannot confirm reopening');
  const contradictoryOpenOrder = { ...cancelledChain.nodes[0], status: 'open', sapStatus: 'bost_Open' };
  await reloadDetail({ ...structuredClone(cancelledChain), nodes: [contradictoryOpenOrder, ...cancelledChain.nodes.slice(1)] });
  await page.getByRole('heading', { name: 'No cumple condiciones para reapertura', exact: true }).waitFor();
  const blockingDocuments = page.getByRole('region', { name: 'Documentos abiertos que impiden la reapertura', exact: true });
  assert.ok(await blockingDocuments.getByText('Pedido de clientes 8002', { exact: true }).isVisible(), 'An open document must remain in the blocking list even if it also carries a cancellation flag');
  await page.screenshot({ path: path.join(outputDir, 'cancelled-map-with-open-document.png'), fullPage: true, animations: 'disabled' });
  const unknownCancelledJournal = { ...settledJournal, status: 'unknown', sapStatus: null };
  await reloadDetail({ ...structuredClone(cancelledChain), nodes: cancelledChain.nodes.map(node => node.id === settledJournal.id ? unknownCancelledJournal : node) });
  await page.getByRole('heading', { name: 'Documentos pendientes de verificar', exact: true }).waitFor();
  const openInvoiceWithCancellationFlag = { ...cancelledInvoice, status: 'open', sapStatus: 'bost_Open' };
  await reloadDetail({ ...structuredClone(cancelledChain), invoices: [openInvoiceWithCancellationFlag], nodes: cancelledChain.nodes.map(node => node.entity === 'Invoices' ? openInvoiceWithCancellationFlag : node) });
  assert.ok(await blockingDocuments.getByText('Factura de clientes 7002', { exact: true }).isVisible(), 'An invoice with status open must block even when its cancellation flag is true');
  const literalOpenCancelledOrder = { ...cancelledChain.nodes[0], status: 'cancelled', sapStatus: 'bost_Open', cancellationStatusConflict: true };
  await reloadDetail({ ...structuredClone(cancelledChain), nodes: [literalOpenCancelledOrder, ...cancelledChain.nodes.slice(1)] });
  await page.getByRole('heading', { name: 'No cumple condiciones para reapertura', exact: true }).waitFor();
  assert.ok(await blockingDocuments.getByText('Pedido de clientes 8002', { exact: true }).isVisible(), 'A literal open SAP state cannot be hidden behind a cancelled display status');
  assert.match(await page.getByRole('button', { name: /Pedido de clientes.*#8002/ }).textContent(), /Abierto.*SAP: bost_Open/);
  const literalOpenCancelledInvoice = { ...cancelledChain.invoices[0], sapStatus: 'bost_Open' };
  await reloadDetail({ ...structuredClone(cancelledChain), invoices: [literalOpenCancelledInvoice], nodes: cancelledChain.nodes.map(node => node.id === invoice.id ? literalOpenCancelledInvoice : node) });
  assert.ok(await blockingDocuments.getByText('Factura de clientes 7001', { exact: true }).isVisible(), 'A cancelled invoice with a literal open state must be listed as a blocker');
  assert.ok(await page.getByRole('row').filter({ has: page.getByText('#7001', { exact: true }) }).getByText('Abierto', { exact: true }).isVisible(), 'The invoice table must also expose the literal open status');

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

  // An SAP sales-order number resolves to the actual hospital account. It must
  // never become the account-review identifier simply because it was entered.
  const matchedCancelledOrder = { ...order, docNum: 50837, status: 'cancelled', cancelled: true };
  const orderAccount = { ...structuredClone(base), account: '3482', accountDocumentCount: 1, patientName: 'Paciente de prueba de la orden SAP', complete: false, eligible: false, status: 'unverified', mapState: 'not_requested', invoices: [], nodes: [matchedCancelledOrder], edges: [], reasons: ['Hace falta consultar el mapa completo para verificar documentos y saldos.'] };
  detailOverrides.set('3482', orderAccount);
  await input.fill('50837');
  await searchButton.click();
  await page.getByRole('heading', { name: 'No se encontraron cuentas', exact: true }).waitFor();
  searchResults = [{ account: '3482', patientName: orderAccount.patientName, invoiceCount: 0, matchedOrders: [{ docEntry: 909, docNum: 50837 }] }];
  searchLookup = { mode: 'order', number: '50837', documentCount: 1, unassignedDocumentCount: 0 };
  await page.getByRole('button', { name: 'Buscar como orden de venta SAP', exact: true }).click();
  await page.getByRole('heading', { name: orderAccount.patientName, exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Mapa completo no consultado', exact: true }).waitFor();
  assert.equal(await positive.count(), 0, 'Finding an SAP order resolves the account and must not certify a partial map');
  assert.equal(await input.inputValue(), '50837', 'Changing to the explicit SAP-order search preserves the entered number');
  assert.equal(await page.getByRole('combobox', { name: 'Buscar por', exact: true }).inputValue(), 'order');
  assert.deepEqual(requests.filter(request => request.pathname.endsWith('/search')).at(-1).params, { mode: 'order', q: '50837' });
  assert.equal(requests.filter(request => /\/account-review\/[^/]+$/.test(request.pathname) && !request.pathname.endsWith('/search')).at(-1).pathname, '/api/sap/account-review/3482');
  await page.getByText('Orden de venta SAP #50837: cuenta del hospital 3482.', { exact: false }).waitFor();
  await page.screenshot({ path: path.join(outputDir, 'sap-order-account.png'), fullPage: true });
  searchLookup = null;
  detailOverrides.clear();
  await page.getByRole('combobox', { name: 'Buscar por', exact: true }).selectOption('account');

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

  const noInvoiceAccount = { ...structuredClone(base), account: '5294', accountDocumentCount: 1, patientName: 'Sin nombre de paciente en SAP', complete: false, eligible: false, status: 'unverified', mapState: 'not_requested', invoices: [], nodes: [order], edges: [], reasons: ['Hace falta consultar el mapa completo para verificar documentos y saldos.'], warnings: ['Mapa completo no consultado: los documentos conocidos se muestran como mapa parcial.'] };
  detailOverrides.set('5294', noInvoiceAccount);
  fullMapOverrides.set('5294', { ...noInvoiceAccount, complete: true, eligible: true, status: 'eligible', reasons: [], mapState: 'complete', warnings: [] });
  searchResults = [{ account: '5294', patientName: 'Paciente cuenta 5294', invoiceCount: 0 }];
  await input.fill('5294');
  await input.press('Enter');
  await page.getByRole('heading', { name: 'Mapa completo no consultado', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Paciente cuenta 5294', exact: true }).waitFor();
  assert.equal(await positive.count(), 0);
  assert.ok(await page.getByRole('region', { name: /Mapa SAP con 1 documento/ }).isVisible(), 'A skipped full map must still show known documents with an explicit partial-map explanation');
  await page.getByText('Se muestran los documentos y vínculos conocidos hasta ahora.', { exact: false }).waitFor();
  assert.ok(await page.getByText('1 conocido', { exact: true }).isVisible());
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
  await positive.waitFor();
  assert.equal(await positive.count(), 1, 'An explicit complete map with real documents and no pending documents or balances can confirm reopening without invoices');
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

  // The permission to consult the map never grants the separate permission to
  // modify a Vertical account. All mutations below are intercepted fixtures.
  authUser = { username: 'operator_fixture', role: 'area', permisos: ['auditoria-reapertura-cuentas', 'ejecutar-reapertura-cuentas'] };
  assert.equal(await canOpenReview(authUser), true, 'The operator fixture must have both route access and execution permissions');
  await page.reload();
  await page.getByText('Consulta y reapertura', { exact: true }).waitFor();
  const prepareButton = page.getByRole('button', { name: 'Preparar reapertura', exact: true });
  const executeButton = page.getByRole('button', { name: 'Respaldar y reaperturar cuenta', exact: true });
  const confirmation = page.getByRole('textbox', { name: /^Escribe el número de cuenta/ });
  const countOperation = operation => requests.filter(request => request.pathname.endsWith(`/reopening/${operation}`)).length;
  async function openFixtureAccount(account) {
    detail = { ...structuredClone(base), account };
    searchResults = [{ account, patientName: base.patientName, invoiceCount: 1 }];
    await page.getByRole('combobox', { name: 'Buscar por', exact: true }).selectOption('account');
    await input.fill(account);
    await searchButton.click();
    await positive.waitFor();
  }
  await openFixtureAccount('12345');
  assert.ok(await prepareButton.isEnabled());
  const beforeBlockedPrepare = countOperation('prepare');
  await reloadDetail({ ...structuredClone(base), eligible: false, status: 'blocked', nodes: [{ ...order, status: 'open', sapStatus: 'bost_Open' }, invoice] });
  assert.equal(await prepareButton.count(), 0);
  await reloadDetail({ ...structuredClone(base), complete: false });
  assert.equal(await prepareButton.count(), 0);
  assert.equal(countOperation('prepare'), beforeBlockedPrepare, 'Blocked or incomplete reviews cannot start preparation');
  await reloadDetail(structuredClone(base), true);
  await prepareButton.click();
  await page.getByRole('heading', { name: 'Revisa y confirma la cuenta 12345', exact: true }).waitFor();
  assert.ok(await executeButton.isDisabled());
  await confirmation.fill('54321');
  assert.ok(await executeButton.isDisabled(), 'An incorrect account number cannot confirm the write');
  await confirmation.fill('12345');
  assert.ok(await executeButton.isEnabled());
  await page.screenshot({ path: path.join(outputDir, 'reopening-confirmation.png'), fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  await page.screenshot({ path: path.join(outputDir, 'reopening-confirmation-mobile-dark.png'), fullPage: true, animations: 'disabled' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.evaluate(() => document.documentElement.dataset.theme = 'light');
  await refresh.click();
  await positive.waitFor();
  assert.equal(await confirmation.count(), 0, 'Refreshing SAP invalidates the prepared token');
  assert.equal(countOperation('execute'), 0);

  await prepareButton.click();
  await confirmation.waitFor();
  await input.fill('67890');
  assert.equal(await confirmation.count(), 0, 'Changing the account invalidates the prepared token');
  await openFixtureAccount('12345');
  previewLifetime = 2000;
  await prepareButton.click();
  await confirmation.waitFor();
  await page.clock.fastForward(2001);
  await page.getByText('La preparación expiró. Prepara nuevamente la reapertura para volver a verificar la cuenta.', { exact: true }).waitFor();
  assert.equal(await executeButton.count(), 0, 'Expired preparations cannot be executed');
  previewLifetime = 300_000;
  reopeningBehavior = 'conflict';
  await prepareButton.click();
  await confirmation.fill('12345');
  await executeButton.click();
  await page.getByText('SAP detectó un documento abierto. La reapertura no se realizó. Consulta el estado de la reapertura antes de continuar.', { exact: true }).waitFor();
  assert.equal(await positive.count(), 0, 'An execute-time eligibility change must invalidate the earlier positive review');
  assert.equal(await executeButton.count(), 0);
  assert.equal(await prepareButton.count(), 0);
  reopeningStatus = 'rolled_back';
  await page.getByRole('button', { name: 'Consultar estado de la reapertura', exact: true }).click();
  await page.getByText('La reapertura no se completó y los cambios fueron revertidos. Actualiza la consulta y revisa la cuenta antes de preparar otro intento.', { exact: true }).waitFor();
  await refresh.click();
  await positive.waitFor();

  reopeningBehavior = 'success';
  reopeningStatus = 'reopened';
  await prepareButton.click();
  await confirmation.fill('12345');
  const beforeStorageBlocked = countOperation('execute');
  await page.evaluate(() => {
    window.originalSessionSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('escandon_reopening_pending:')) throw new DOMException('Storage fixture blocked', 'SecurityError');
      return window.originalSessionSetItem.call(this, key, value);
    };
  });
  await executeButton.click();
  await page.getByText('No se pudo conservar la operación en esta sesión. Permite el almacenamiento de la sesión antes de reaperturar la cuenta.', { exact: true }).waitFor();
  assert.equal(countOperation('execute'), beforeStorageBlocked, 'A write cannot start if the recovery token cannot be preserved in session storage');
  await page.evaluate(() => Storage.prototype.setItem = window.originalSessionSetItem);
  let releaseWrite;
  delayedExecuteGate = new Promise(resolve => { releaseWrite = resolve; });
  const beforeExecute = countOperation('execute');
  const executeStarted = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/reopening/execute'));
  await executeButton.evaluate(button => { button.click(); button.click(); });
  await executeStarted;
  await page.getByRole('heading', { name: 'Respaldando y reaperturando cuenta…', exact: true }).waitFor();
  assert.equal(countOperation('execute'), beforeExecute + 1, 'A double submission must send exactly one execute request');
  assert.ok(await input.isDisabled());
  assert.ok(await searchButton.isDisabled());
  assert.ok(await page.getByRole('combobox', { name: 'Buscar por', exact: true }).isDisabled());
  assert.ok(await refresh.isDisabled());
  assert.ok(await page.getByRole('button', { name: /Cuenta 12345/ }).isDisabled());
  assert.equal(await page.getByRole('button', { name: 'Cancelar consulta', exact: true }).count(), 0, 'An in-flight write has no cancellation action');
  releaseWrite();
  delayedExecuteGate = null;
  await page.getByRole('heading', { name: 'Cuenta reaperturada en Vertical', exact: true }).waitFor();
  await page.getByText('OP-FIXTURE-12345', { exact: true }).waitFor();
  await page.getByText('D:\\Escritorio\\Reaperturas\\cuenta-12345-fixture.md', { exact: true }).waitFor();
  assert.equal(await prepareButton.count(), 0);
  assert.equal(await executeButton.count(), 0);
  const executed = requests.filter(request => request.pathname.endsWith('/reopening/execute')).at(-1);
  assert.equal(executed.body.confirmedAccount, '12345');
  assert.match(executed.body.previewToken, /^preview-fixture-/);
  await page.screenshot({ path: path.join(outputDir, 'reopening-receipt.png'), fullPage: true, animations: 'disabled' });
  await refresh.click();
  await page.getByRole('heading', { name: 'Cuenta reaperturada en Vertical', exact: true }).waitFor();
  assert.equal(await prepareButton.count(), 0, 'A confirmed reopening is remembered and cannot be repeated after a SAP refresh');

  await openFixtureAccount('67890');
  reopeningBehavior = 'network';
  await prepareButton.click();
  await confirmation.fill('67890');
  const beforeUncertainExecute = countOperation('execute');
  await executeButton.click();
  await page.getByRole('heading', { name: 'Resultado de la reapertura por confirmar', exact: true }).waitFor();
  assert.equal(await positive.count(), 0);
  assert.ok(await input.isDisabled());
  assert.equal(await executeButton.count(), 0, 'A connection failure must not offer a blind execute retry');
  const statusButton = page.getByRole('button', { name: 'Consultar estado de la reapertura', exact: true });
  const storedAttempt = await page.evaluate(() => JSON.parse(sessionStorage.getItem('escandon_reopening_pending:operator_fixture')));
  assert.deepEqual(Object.keys(storedAttempt).sort(), ['account', 'previewToken'], 'Session recovery stores only the account and token, never patient or backup rows');
  assert.equal(storedAttempt.account, '67890');
  await page.reload();
  await page.getByRole('heading', { name: 'Resultado de la reapertura por confirmar', exact: true }).waitFor();
  await page.getByText('Se recuperó una reapertura pendiente de esta sesión. Consulta su estado antes de continuar.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Estado de las facturas', exact: true }).count(), 0, 'A recovered pending operation is visible without reloading the previous SAP detail');
  assert.equal(countOperation('execute'), beforeUncertainExecute + 1, 'Reloading recovers status without issuing another execution');
  reopeningStatus = 'pending';
  await statusButton.click();
  await page.getByText('La operación sigue pendiente. Consulta de nuevo su estado; no inicies otra reapertura.', { exact: true }).waitFor();
  assert.equal(countOperation('execute'), beforeUncertainExecute + 1, 'Status queries must never repeat the write');
  await page.screenshot({ path: path.join(outputDir, 'reopening-result-pending.png'), fullPage: true, animations: 'disabled' });
  reopeningStatus = 'reopened';
  await statusButton.click();
  await page.getByRole('heading', { name: 'Cuenta reaperturada en Vertical', exact: true }).waitFor();
  await page.getByText('OP-FIXTURE-67890', { exact: true }).waitFor();
  assert.equal(countOperation('execute'), beforeUncertainExecute + 1);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('escandon_reopening_pending:operator_fixture')), null, 'Only a terminal receipt clears the persisted pending attempt');

  await openFixtureAccount('78901');
  reopeningBehavior = 'success';
  await prepareButton.click();
  await confirmation.fill('78901');
  let releaseTimedOutWrite;
  delayedExecuteGate = new Promise(resolve => { releaseTimedOutWrite = resolve; });
  const beforeTimedOutWrite = countOperation('execute');
  await executeButton.click();
  await page.getByRole('heading', { name: 'Respaldando y reaperturando cuenta…', exact: true }).waitFor();
  await page.clock.fastForward(250_001);
  await page.getByRole('heading', { name: 'Resultado de la reapertura por confirmar', exact: true }).waitFor();
  await statusButton.click();
  await page.getByRole('heading', { name: 'Cuenta reaperturada en Vertical', exact: true }).waitFor();
  releaseTimedOutWrite();
  delayedExecuteGate = null;
  await page.waitForLoadState('networkidle');
  assert.equal(countOperation('execute'), beforeTimedOutWrite + 1, 'A deadline leaves the original server operation running and never replays it');

  await openFixtureAccount('89012');
  reopeningBehavior = 'unknown409';
  await prepareButton.click();
  await confirmation.fill('89012');
  await executeButton.click();
  await statusButton.waitFor();
  assert.equal(await prepareButton.count(), 0, 'A server-declared uncertain outcome remains locked even when delivered with status 409');
  assert.equal(await executeButton.count(), 0);
  reopeningStatus = 'unknown';
  await statusButton.click();
  await page.getByText('El resultado todavía no se puede confirmar. Revisa la operación en Vertical antes de iniciar otra reapertura.', { exact: true }).waitFor();
  assert.ok(await input.isDisabled(), 'An unknown outcome stays locked until the result has been checked');
  reopeningStatus = 'rolled_back';
  await statusButton.click();
  await page.getByText('La reapertura no se completó y los cambios fueron revertidos. Actualiza la consulta y revisa la cuenta antes de preparar otro intento.', { exact: true }).waitFor();
  assert.equal(await positive.count(), 0);
  assert.equal(await prepareButton.count(), 0, 'A rollback requires a fresh review before another preparation');
  assert.ok(await input.isEnabled());

  await openFixtureAccount('90123');
  reopeningBehavior = 'network';
  await prepareButton.click();
  await confirmation.fill('90123');
  await executeButton.click();
  await statusButton.waitFor();
  reopeningStatus = 'not_started';
  await statusButton.click();
  await page.getByText('La reapertura no llegó a iniciarse. Actualiza la consulta y prepara nuevamente la cuenta.', { exact: true }).waitFor();
  assert.equal(await positive.count(), 0);
  assert.equal(await prepareButton.count(), 0);

  authUser = { username: 'admin_read_fixture', role: 'admin', permisos: ['auditoria-reapertura-cuentas'] };
  assert.equal(await canOpenReview(authUser), true);
  await page.reload();
  await openFixtureAccount('12345');
  assert.ok(await prepareButton.isDisabled(), 'The administrator role alone cannot grant the explicit reopening capability');
  authUser = { username: 'AMendoza', role: 'area', permisos: [] };
  assert.equal(await canOpenReview(authUser), true, 'The explicitly authorized owner account can open the review route');
  await page.reload();
  await openFixtureAccount('12345');
  assert.ok(await prepareButton.isEnabled(), 'The explicitly authorized owner account can prepare even without a listed permission');
  assert.ok(requests.filter(request => request.method !== 'GET').every(request => /\/reopening\/(prepare|execute|status)$/.test(request.pathname)), 'Writes are confined to the explicit reopening workflow');
  assert.deepEqual(errors, []);
  console.log('PASS account reopening: patient/account/SAP-order search, SAP map and cancellation/open defences, partial/full/unknown states, read/write permissions, fresh preparation, account confirmation/expiry/invalidation, single transaction submission, server conflicts, receipt, uncertain network/deadline results and status-only recovery, graph/zoom, mobile/dark, no live writes');
} finally {
  await browser?.close();
  await server.close();
}
