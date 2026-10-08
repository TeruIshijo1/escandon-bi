import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '../tmp/honorarios-management');
await mkdir(output, { recursive: true });
const item = { itemCode: 'SER1471', description: 'SESIÓN PSICOLOGÍA AFIRMA', groupName: 'CONSULTA EXTERNA',
  active: true, status: 'PENDIENTE', modality: 'contact_center', paymentUnit: 'sesión', revision: 1,
  professionalCandidate: true, scopeExcluded: false,
  referencePrices: [{ id: 1, amount: 1, notes: 'Referencia nominal' }], tariffCount: 0 };
const additionalCatalogItems = [
  ...[['A-CEYE', 'ARTÍCULO CEYE'], ['A-FAR', 'ARTÍCULO FARMACIA'], ['A-ITEM', 'ARTÍCULOS GENERAL'],
    ['A-QUI', 'ARTÍCULO QUIRÓFANO'], ['PQX0002', 'PAQUETE QX COMPLETO'], ['SER1234', 'ESTANCIA AMBULATORIA'],
    ['SER1236', 'RENTA DE EQUIPO PARA CIRUGÍA']].map(([itemCode, description]) => ({ ...item, itemCode,
    description, scopeExcluded: true, professionalCandidate: false })),
  { ...item, itemCode: 'SER1259', description: 'SERVICIO DE ANESTESIOLOGÍA GENERAL', modality: 'presencial', groupName: 'CIRUGIA QUIROFANO', referencePrices: [], professionalCandidate: undefined },
  { ...item, itemCode: 'SER2354', description: 'INTERCONSULTA DE ESPECIALIDAD TERAPIA NEONATAL', modality: 'presencial', groupName: 'TERAPIA NEONATAL', referencePrices: [], professionalCandidate: undefined },
  { ...item, itemCode: 'SER0715', description: 'JORNADA VIGILANCIA ESPECIALIDAD MÉDICA HSBC', modality: 'presencial', groupName: 'ANALISIS DE CUENTAS', referencePrices: [], professionalCandidate: undefined },
  { ...item, itemCode: 'SER_NUEVO', description: 'PROCEDIMIENTO NUEVO POR CLASIFICAR', professionalCandidate: undefined, groupName: '', referencePrices: [],
    modality: 'presencial', scopeReason: 'Concepto nuevo; requiere confirmar si genera pago a un médico.' },
  { ...item, itemCode: 'SER_VALIDADO', description: 'SERVICIO AUTORIZADO POR RESPONSABLE',
    professionalCandidate: false, status: 'INCLUIDO', modality: 'presencial', referencePrices: [] },
  { ...item, itemCode: 'SER_REF_CERO', description: 'CONSULTA CON REFERENCIA CERO',
    referencePrices: [{ id: 10, amount: 0 }], referenceWarnings: ['Referencia sin importe positivo'] },
  { ...item, itemCode: 'SER_REF_DUPLICADA', description: 'CONSULTA CON REFERENCIA DUPLICADA',
    referencePrices: [{ id: 11, amount: null }, { id: 12, amount: 250 }], referenceWarnings: ['Referencia duplicada; requiere revisión'] }
];
let fiftyMode = false, lastBulkBody, closeBody;
let tariffs = [], reviews = {}, liquidation = null, approvalBody, auditRequests = 0, catalogRequests = 0, sapDelay = 0, paymentReportRequests = 0, paymentReportIssue = false;
const paymentReport = () => {
  const line = liquidation.lines[0];
  const totals = { base: line.baseAmount, vat: line.vat, isr: line.isr, vatWithholding: line.vatWithholding,
    net: line.netAmount, adjustments: line.adjustmentAmount, paid: line.paidAmount, balance: line.balance,
    payable: paymentReportIssue ? 0 : line.balance };
  return { version: 1, generatedAt: '2026-10-02T18:00:00.000Z', currency: 'MXN',
    status: paymentReportIssue ? 'REVIEW_REQUIRED' : line.balance === 0 ? 'PAID' : 'READY',
    issues: paymentReportIssue ? [{ code: 'SOURCE_CHANGED', message: 'Cambió la atención después del cierre. Revisa el servicio antes de preparar el pago.', rowId: line.rowId }] : [],
    liquidation: { id: 1, startDate: '2026-09-01', endDate: '2026-09-30', createdAt: '2026-10-02T17:00:00.000Z',
      createdBy: 'REVISOR PRUEBA', reason: 'Periodo y pagos previos revisados', fiscalNote: liquidation.snapshot.fiscalNote, sapAsOf: '2026-10-02T17:00:00.000Z' },
    totals, doctors: [{ providerId: line.providerId, providerName: line.providerName, totals,
      lines: [line], payments: liquidation.payments, adjustments: liquidation.adjustments }] };
};
const approval = value => ({ ...value, approvedTariffCount: value.tariffCount,
  approvalStatus: value.status === 'EXCLUIDO' ? 'EXCLUIDO' : value.status === 'INCLUIDO' && value.tariffCount > 0 ? 'APROBADO' : 'PENDIENTE' });
const providers = [{ id: 7, name: 'MÉDICO PRUEBA' }, { id: 8, name: 'SOLICITANTE PRUEBA' }];
const source = () => ({ ModeBI: true, TipoCalculo: 'BI_PRESTACION', SourceIdentity: 'BI|SOLN|91|ORDEN',
  SourceType: 'SOLN', SourceLineId: 91, OccurrenceId: 'ORDEN', UDRKey: 'BI|SOLN|91|ORDEN', RenglonAuditoria: 1,
  SourceFingerprint: 'source', FolioAtencion: null, FolioCita: null, FolioOrdenVenta: 181,
  FechaAtencion: '2026-09-02', GrupoServicio: 'CONSULTA EXTERNA', CodigoServicio: 'SER1471', Servicio: item.description,
  Paciente: 'PACIENTE PRUEBA', Cliente: 'CLIENTE PRUEBA', Medico: 'SOLICITANTE PRUEBA', MedicoId: 8,
  RolMedico: 'TRATANTE', Cantidad: 1, CantidadOriginal: 1, CantidadMaxima: 1, MedicoConfirmado: false,
  EjecucionConfirmada: false, EvidenciaEjecucion: 'SIN_CONFIRMACION', CantidadConfirmada: true,
  FuenteHonorario: 'Línea de orden de venta', OrigenRenglon: 'ORDEN_SERVICIO_BI', PrecioCobradoPaciente: 1500,
  CatalogStatus: item.status, CatalogSnapshot: { itemCode: item.itemCode, revision: item.revision, status: item.status },
  TariffSnapshot: tariffs[0] || null, PrecioUnitarioBI: tariffs[0]?.amount ?? null, BaseImporte: tariffs[0]?.amount ?? null,
  IvaLinea: null, ElegiblePago: 0, EstadoVertical: null, FechaReferenciaTipo: 'FECHA_SERVICIO_ORDEN',
  BIStatusReasons: ['Pendiente de confirmar médico', 'Pendiente de realización'],
  MensajeAuditoria: 'Confirmar realización de la sesión desde Contact Center.' });
const server = await createServer({ configFile: false, root, appType: 'custom', plugins: [react(), {
  name: 'isolated-management-test', configureServer(server) { server.middlewares.use('/__management', async (_req, res) => {
    const html = await server.transformIndexHtml('/__management', '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:Arial;background:#f1f5f9;margin:20px}button,input,select{font:inherit}</style></head><body><div id="root"></div><script type="module">import React from "react";import{createRoot}from"react-dom/client";import{AuthProvider}from"/src/context/AuthContext.jsx";import View from "/src/components/honorarios/HonorariosAuditView.jsx";createRoot(document.getElementById("root")).render(React.createElement(AuthProvider,null,React.createElement(View)));</script></body></html>');
    res.setHeader('Content-Type', 'text/html'); res.end(html);
  }); }
}], server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1580, height: 1100 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => sessionStorage.setItem('escandon_token', 'token-de-prueba'));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: 7, role: 'ADMIN', nombre: 'REVISOR PRUEBA', permisos: ['interconsultas-jornadas'] } } }));
  await page.route('**/api/honorarios/**', async route => {
    const url = new URL(route.request().url()); const endpoint = url.pathname.replace('/api/honorarios', '');
    const method = route.request().method(); const body = method === 'GET' ? {} : route.request().postDataJSON();
    let result = { ok: true };
    if (endpoint === '/providers') result.providers = providers;
    else if (endpoint === '/fiscal-profiles') result.profiles = {};
    else if (endpoint === '/fiscal-directory') Object.assign(result, { sapAvailable: true, date: url.searchParams.get('date'), doctors: providers.map(item => ({ providerId: String(item.id), sapReady: false, reasons: ['Completa la ficha interna.'], suggestedProfile: {}, sap: { linkStatus: 'sin_coincidencia', candidates: [] } })) });
    else if (endpoint === '/catalog') { catalogRequests++; Object.assign(result, { items: [item, ...additionalCatalogItems].map(approval), sync: { lastSuccess: '2026-09-30T17:00:00Z' } }); }
    else if (endpoint === '/catalog/SER1471' && method === 'PUT') { Object.assign(item, body, { revision: item.revision + 1 }); result.item = approval(item); }
    else if (endpoint === '/catalog/SER1471/tariffs') {
      if (method === 'POST') { tariffs = [{ ...body, id: 1, itemCode: item.itemCode, revision: (tariffs[0]?.revision || 0) + 1 }]; item.tariffCount = body.active === false ? 0 : 1; result.tariff = tariffs[0]; result.item = approval(item); }
      else result.tariffs = tariffs;
    } else if (endpoint.endsWith('/tariffs') && method === 'GET') result.tariffs = [];
    else if (endpoint.endsWith('/history')) result.history = [];
    else if (endpoint === '/audit') {
      auditRequests++;
      const ready = approval(item).approvalStatus === 'APROBADO';
      result.data = ready ? (fiftyMode ? [
        ...Array.from({ length: 50 }, (_, i) => ({ ...source(), SourceIdentity: `BI|SOLN|${500 + i}|ORDEN`,
          UDRKey: `BI|SOLN|${500 + i}|ORDEN`, SourceLineId: 500 + i, FolioOrdenVenta: 1500 + i,
          MedicoId: 7, Medico: 'MÉDICO PRUEBA', CatalogApproved: true, ReviewEligible: true })),
        { ...source(), SourceIdentity: 'BI|SOLN|900|ORDEN', UDRKey: 'BI|SOLN|900|ORDEN', SourceLineId: 900, MedicoId: 7, Medico: 'MÉDICO PRUEBA', Cancelado: true, ReviewEligible: true },
        { ...source(), SourceIdentity: 'BI|SOLN|901|ORDEN', UDRKey: 'BI|SOLN|901|ORDEN', SourceLineId: 901, MedicoId: 7, Medico: 'MÉDICO PRUEBA', LiquidacionCerrada: 2, ReviewEligible: true },
        { ...source(), SourceIdentity: 'BI|SOLN|902|ORDEN', UDRKey: 'BI|SOLN|902|ORDEN', SourceLineId: 902, ReviewEligible: true }
      ] : [{ ...source(), CatalogApproved: true, ReviewEligible: true }]) : [];
      result.coverage = { omittedFromReview: ready ? 0 : 1, pendingCatalog: item.status !== 'INCLUIDO' ? 1 : 0,
        pendingTariff: item.status === 'INCLUIDO' && !item.tariffCount ? 1 : 0, pendingProvider: 0 };
    }
    else if (endpoint === '/approval-preview') result.row = { ...source(), BaseImporte: 250, MedicoId: 7, Medico: 'MÉDICO PRUEBA' };
    else if (endpoint === '/reviews/bulk-preview') result.rows = body.rows.map(row => ({ ...row, providerId: 7, providerName: 'MÉDICO PRUEBA', customAmount: 250, quotedTariffId: 1, quotedTariffRevision: tariffs[0].revision }));
    else if (endpoint === '/reviews/bulk') {
      lastBulkBody = body;
      result.reviews = Object.fromEntries(body.rows.map(row => [row.rowId, { ...reviews[row.rowId], ...body.decision, fingerprint: row.fingerprint, revision: row.expectedRevision + 1 }]));
      Object.assign(reviews, result.reviews); result.errors = []; result.savedCount = body.rows.length;
    } else if (endpoint === '/reviews') {
      if (method === 'PUT') {
        approvalBody = body;
        const snapshot = { rowId: body.rowId, itemCode: item.itemCode, description: item.description, providerId: 7,
          providerName: 'MÉDICO PRUEBA', role: 'TRATANTE', quantity: 1, unitAmount: 250, baseAmount: 250,
          salesOrder: 181, appointment: null, attention: null, serviceDate: '2026-09-02', tariff: tariffs[0],
          execution: { confirmed: true, reference: body.decision.evidenceReference } };
        result.review = { ...body.decision, customAmount: 250, snapshot, revision: 1, reviewer: 'REVISOR PRUEBA' };
        reviews[body.rowId] = result.review;
      } else Object.assign(result, { reviews, canReview: true });
    } else if (endpoint === '/sap-reconciliation') {
      if (sapDelay) await new Promise(resolve => setTimeout(resolve, sapDelay));
      result.providers = Object.fromEntries(body.doctors.map(name => [name, { linkStatus: fiftyMode ? 'sin_coincidencia' : 'candidato_unico', invoices: [],
        candidates: [{ subjectToWithholding: true, federalTaxId: 'AAAA800101AAA', configuredWithholdings: [{ inactive: false, estimateRule: 'isr_on_fee', rate: 10, appliesAt: 'factura', codeEffectiveFrom: '2025-01-01' }] }] }]));
      result.additionalProviders = []; result.period = { startDate: '2026-09-01', endDate: '2026-09-30' };
    } else if (endpoint === '/liquidations') {
      if (method === 'POST') {
        closeBody = body;
        if (fiftyMode) { await route.fulfill({ status: 400, json: { error: 'Falta revisar la información fiscal de MÉDICO PRUEBA en SAP. No se puede cerrar su liquidación.' } }); return; }
        const line = { ...Object.values(reviews)[0].snapshot, netAmount: 225, isr: 25, vat: 0, vatWithholding: 0,
          paidAmount: 0, adjustmentAmount: 0, balance: 225, reason: 'Sesión validada', reviewer: 'REVISOR PRUEBA' };
        liquidation = { id: 1, lines: [line], payments: [], adjustments: [], totalPaid: 0, balance: 225, created_by: 'REVISOR PRUEBA',
          snapshot: { lines: [line], totalBase: 250, totalNet: 225, fiscalNote: 'Estimación fiscal conservada al cierre.' } };
        result.liquidation = liquidation;
      } else result.liquidations = liquidation ? [{ id: 1, start_date: '2026-09-01', end_date: '2026-09-30', lines: 1, total_net: 225 }] : [];
    } else if (endpoint === '/liquidations/1/payments') {
      const line = liquidation.lines[0]; line.paidAmount += body.amount; line.balance -= body.amount;
      liquidation.totalPaid += body.amount; liquidation.balance -= body.amount;
      liquidation.payments.push({ ...body, row_id: body.rowId, payment_date: body.paymentDate,
        created_at: '2026-10-02T17:20:00.000Z', id: 1, created_by: 'REVISOR PRUEBA' }); result.liquidation = liquidation;
    } else if (endpoint === '/liquidations/1/payment-report') {
      paymentReportRequests++;
      result.report = paymentReport();
    } else if (endpoint === '/liquidations/1/check') result.changes = [];
    else if (endpoint === '/liquidations/1') result.liquidation = liquidation;
    else throw Error(`Unexpected API ${method} ${endpoint}`);
    await route.fulfill({ json: result });
  });
  await page.goto(`${server.resolvedUrls.local[0]}__management`);
  assert.equal(await page.locator('.hon-friendly-message.error').count(), 0, 'No debe mostrarse un error antes de consultar');
  await page.locator('input[type=date]').nth(0).fill('2026-09-01'); await page.locator('input[type=date]').nth(1).fill('2026-09-30');
  await page.getByRole('button', { name: 'Buscar servicios', exact: true }).click();
  await page.getByRole('heading', { name: 'No se encontraron registros', exact: true }).waitFor();
  assert.equal(await page.getByText('SOLICITANTE PRUEBA · #8', { exact: true }).count(), 0, 'El servicio aún sin configurar no aparece bajo el médico');
  await page.getByRole('button', { name: 'Configuración', exact: true }).click();
  await page.getByRole('button', { name: 'Catálogo y precios', exact: true }).click();
  await page.getByRole('button', { name: 'Configurar SER1471' }).waitFor();
  const pendingCatalogBadge = page.locator('.hon-catalog-table tbody tr').filter({ has: page.getByRole('button', { name: 'Configurar SER1471', exact: true }) }).locator('.hon-catalog-badge');
  assert.equal(await pendingCatalogBadge.textContent(), 'Por configurar');
  assert.doesNotMatch(await pendingCatalogBadge.getAttribute('class'), /hon-catalog-status-configurado/, 'Un pendiente no se presenta como configurado');
  assert.doesNotMatch(await page.locator('.hon-catalog').innerText(), /UT_Honorarios|\bBI\b|contabilizarse|inclusión/);
  const recommended = page.getByRole('button', { name: /^Recomendados \(/ });
  const allServices = page.getByRole('button', { name: /^Todos los servicios \(/ });
  assert.equal(await recommended.getAttribute('aria-pressed'), 'true');
  assert.equal(await recommended.textContent().then(value => value.trim()), 'Recomendados (3)');
  assert.equal(await allServices.textContent().then(value => value.trim()), 'Todos los servicios (7)');
  assert.equal(await page.getByRole('button', { name: 'Aprobados (0)', exact: true }).count(), 1, 'Incluir sin tarifa no aprueba el catálogo');
  assert.equal(await page.locator('.hon-catalog-filters option[value="TODOS"]').textContent(), 'Todos (3)');
  for (const code of ['SER1259', 'SER2354', 'SER0715', 'SER_VALIDADO', 'A-CEYE', 'PQX0002']) {
    assert.equal(await page.getByRole('button', { name: `Configurar ${code}`, exact: true }).count(), 0);
  }
  for (const code of ['SER_REF_CERO', 'SER_REF_DUPLICADA']) {
    assert.equal(await page.getByRole('button', { name: `Configurar ${code}`, exact: true }).count(), 1);
  }
  await page.getByLabel('Buscar servicio', { exact: true }).fill('SER_REF');
  assert.equal(await page.locator('.hon-catalog-table tbody tr').count(), 2);
  await page.getByLabel('Buscar servicio', { exact: true }).fill('');
  await page.locator('.hon-catalog-filters select').selectOption('INCLUIDO');
  await page.getByText('No hay servicios con estos filtros.', { exact: true }).waitFor();
  await allServices.click();
  await page.locator('.hon-catalog-filters select').selectOption('INCLUIDO');
  await page.getByRole('button', { name: 'Configurar SER_VALIDADO', exact: true }).waitFor();
  assert.equal(await page.locator('.hon-catalog-table tbody button').count(), 1);
  await page.locator('.hon-catalog-filters select').selectOption('TODOS');
  await page.getByRole('button', { name: 'Configurar SER1259', exact: true }).click();
  await page.getByLabel('Incluir en honorarios').waitFor();
  await recommended.click();
  await page.getByRole('heading', { name: 'Selecciona un servicio', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Incluir en honorarios').count(), 0);
  assert.equal(tariffs.length, 0);
  assert.equal(item.status, 'PENDIENTE');
  await page.locator('.hon-catalog-list').screenshot({ path: path.join(output, 'catalogo-recomendados.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'El catálogo recomendado debe caber en móvil');
  await page.locator('.hon-catalog-list').screenshot({ path: path.join(output, 'catalogo-recomendados-mobile.png') });
  await page.setViewportSize({ width: 1580, height: 1100 });
  await allServices.click();
  for (const code of ['A-CEYE', 'A-FAR', 'A-ITEM', 'A-QUI', 'PQX0002', 'SER1234', 'SER1236', 'SER_NUEVO']) {
    assert.equal(await page.getByRole('button', { name: `Configurar ${code}`, exact: true }).count(), 0);
  }
  for (const code of ['SER1259', 'SER2354', 'SER0715', 'SER_VALIDADO']) {
    assert.equal(await page.getByRole('button', { name: `Configurar ${code}`, exact: true }).count(), 1);
  }
  assert.equal(await page.locator('.hon-catalog-filters option[value="TODOS"]').textContent(), 'Todos (7)');
  await page.getByLabel('Revisar otros conceptos', { exact: true }).check();
  await page.getByRole('button', { name: 'Configurar SER_NUEVO', exact: true }).click();
  await page.getByText('Revisar si genera honorarios', { exact: true }).waitFor();
  await page.getByText('Confirma si este servicio corresponde al trabajo de un médico y quién recibe el honorario antes de incluirlo.', { exact: false }).waitFor();
  for (const code of ['A-CEYE', 'A-FAR', 'A-ITEM', 'A-QUI', 'PQX0002', 'SER1234', 'SER1236']) {
    assert.equal(await page.getByRole('button', { name: `Configurar ${code}`, exact: true }).count(), 0);
  }
  assert.equal(await page.locator('.hon-catalog-filters option[value="TODOS"]').textContent(), 'Todos (8)');
  await page.getByLabel('Revisar otros conceptos', { exact: true }).uncheck();
  assert.equal(await page.getByRole('button', { name: 'Configurar SER_NUEVO', exact: true }).count(), 0);
  await recommended.click();
  await page.getByRole('button', { name: 'Configurar SER1471' }).click();
  await page.getByLabel('Incluir en honorarios').selectOption('INCLUIDO');
  for (const label of ['Unidad de pago', 'Motivo del cambio', 'Motivo de la tarifa']) {
    assert.equal(await page.getByLabel(label, { exact: true }).count(), 0, `${label} se retiró del formulario`);
  }
  await page.getByRole('button', { name: 'Guardar configuración', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /Configuración/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Aprobados (0)', exact: true }).count(), 1);
  await page.getByText('Falta tarifa', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Agregar tarifa', exact: true }).click();
  await page.getByLabel('Honorario por unidad ($)', { exact: true }).fill('250');
  await page.getByLabel('Se aplica desde', { exact: true }).fill('2026-01-01');
  await page.getByLabel('Función del médico (opcional)', { exact: true }).selectOption({ label: 'Anestesiólogo' });
  await page.getByLabel('Se aplica hasta (opcional)', { exact: true }).fill('2026-09-30');
  assert.equal(await page.getByLabel('Motivo de la tarifa', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Guardar tarifa', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /Tarifa/ }).waitFor();
  assert.equal(tariffs[0].role, 'AN'); assert.equal(tariffs[0].validTo, '2026-09-30');
  assert.equal(tariffs[0].reason, undefined, 'Guardar no requiere motivo de tarifa');
  await page.getByText('01/01/2026 — 30/09/2026', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  assert.equal(await page.getByLabel('Función del médico (opcional)', { exact: true }).inputValue(), 'AN');
  assert.equal(await page.getByLabel('Se aplica hasta (opcional)', { exact: true }).inputValue(), '2026-09-30');
  await page.locator('.hon-catalog-detail').screenshot({ path: path.join(output, 'tarifa-funcion-fecha-final.png') });
  await page.getByLabel('Función del médico (opcional)', { exact: true }).selectOption('TRATANTE');
  await page.getByLabel('Se aplica hasta (opcional)', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Guardar tarifa', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /Tarifa/ }).waitFor();
  assert.equal(tariffs[0].role, 'TRATANTE'); assert.equal(tariffs[0].validTo, null);
  const approvedCatalog = page.getByRole('button', { name: 'Aprobados (1)', exact: true });
  assert.equal(await approvedCatalog.getAttribute('aria-pressed'), 'false', 'Guardar conserva la lista seleccionada');
  await page.getByText('Aprobado para revisar servicios', { exact: true }).waitFor();
  await recommended.click();
  assert.equal(await page.getByRole('button', { name: 'Configurar SER1471' }).count(), 0, 'Sale de la lista pendiente de configuración');
  assert.equal((await recommended.textContent()).trim(), 'Recomendados (2)');
  await approvedCatalog.click();
  await page.getByRole('button', { name: 'Configurar SER1471' }).click();
  const configuredCatalogBadge = page.locator('.hon-catalog-table tbody tr').filter({ has: page.getByRole('button', { name: 'Configurar SER1471', exact: true }) }).locator('.hon-catalog-badge');
  assert.equal(await configuredCatalogBadge.textContent(), 'Configurados');
  const configuredColor = await configuredCatalogBadge.evaluate(element => getComputedStyle(element).color.match(/\d+/g).map(Number));
  assert.ok(configuredColor[1] > configuredColor[0] && configuredColor[1] > configuredColor[2], 'El distintivo configurado se muestra en verde');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'El catálogo aprobado cabe en móvil');
  await page.screenshot({ path: path.join(output, 'catalogo-aprobado-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1580, height: 1100 });
  await page.screenshot({ path: path.join(output, 'catalogo.png'), fullPage: true });
  const previousRequests = auditRequests;
  sapDelay = 1500;
  await page.getByRole('button', { name: 'Ver servicios de este concepto', exact: true }).click();
  await page.getByRole('button', { name: /^Por revisar/ }).waitFor();
  await page.locator('.hon-doctor-simple').first().waitFor();
  await page.setViewportSize({ width: 1180, height: 860 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, '06-revisar-servicios.png'), fullPage: true });
  await page.setViewportSize({ width: 1580, height: 1100 });
  await page.getByRole('button', { name: 'Más opciones', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir todos', exact: true }).click();
  await page.getByRole('button', { name: 'Aprobar', exact: true }).first().waitFor();
  assert.equal(await page.getByRole('button', { name: 'Aprobar', exact: true }).first().isEnabled(), true, 'SAP no bloquea la aprobación clínica');
  sapDelay = 0;
  await page.getByRole('button', { name: 'Más opciones', exact: true }).click();
  assert.ok(auditRequests > previousRequests, 'El acceso desde Aprobados consulta los servicios automáticamente');
  assert.equal(await page.getByPlaceholder('Médico, paciente, servicio o folio').inputValue(), 'SER1471');
  await page.getByRole('button', { name: /^Por revisar/ }).click();
  assert.equal(await page.getByRole('button', { name: /^Por revisar/ }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('button', { name: 'Aprobar selección', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Descargar Excel', exact: true }).isVisible(), false);
  assert.equal(await page.getByText('Ver desglose de impuestos', { exact: true }).isVisible(), true);
  await page.getByText('Ver desglose de impuestos', { exact: true }).click();
  await page.locator('.hon-friendly-summary').getByText('ISR estimado', { exact: true }).waitFor();
  await page.getByText('Ver desglose de impuestos', { exact: true }).click();
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await page.getByRole('button', { name: 'Descargar Excel', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', { name: 'Descargar Excel', exact: true }).isVisible(), false);
  await page.screenshot({ path: path.join(output, 'honorarios-simplificado.png') });
  await page.getByRole('button', { name: 'Ocultar servicios de SOLICITANTE PRUEBA · #8', exact: true }).click();
  await page.locator('.hon-friendly-summary').getByText('Calculando…', { exact: true }).waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 1180, height: 860 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, '06-revisar-servicios.png'), fullPage: true });
  await page.setViewportSize({ width: 1580, height: 1100 });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'La pantalla debe caber en móvil');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, 'honorarios-mobile.png') });
  await page.getByRole('button', { name: 'Más opciones', exact: true }).click();
  await page.getByLabel('Vista de resultados', { exact: true }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'Las opciones deben caber en móvil');
  await page.screenshot({ path: path.join(output, 'honorarios-mobile-options.png'), fullPage: true });
  await page.setViewportSize({ width: 1580, height: 1100 });
  await page.getByRole('button', { name: 'Abrir todos', exact: true }).click();
  await page.getByRole('button', { name: 'Aprobar', exact: true }).first().click();
  await page.setViewportSize({ width: 1180, height: 780 });
  await page.getByText('Corregir médico o cantidad (opcional)', { exact: true }).click();
  await page.getByLabel('Médico beneficiario', { exact: true }).selectOption('7');
  await page.getByLabel('Cantidad reconocida', { exact: true }).fill('1');
  await page.getByLabel('Motivo del cambio de médico', { exact: true }).fill('Corrección por error de captura confirmado con Contact Center.');
  await page.getByText('Honorario: $250.00', { exact: true }).waitFor();
  await page.getByLabel('IVA confirmado', { exact: true }).selectOption('0');
  await page.getByText('Corregir médico o cantidad (opcional)', { exact: true }).click();
  const approvalDialog = page.getByRole('dialog', { name: 'Aprobar honorario', exact: true });
  assert.equal(await approvalDialog.locator('select:visible').count(), 1, 'La aprobación normal sólo pregunta el IVA');
  assert.equal(await approvalDialog.locator('input:visible').count(), 0, 'No pide motivo, referencia, cantidad ni confirmación adicional');
  await approvalDialog.screenshot({ path: path.join(output, '07-aprobar-honorario.png') });
  const beforeApprovalRequests = auditRequests;
  const beforeApprovalExpansion = await page.locator('.hon-btn-override-approve').count();
  await page.screenshot({ path: path.join(output, 'confirmacion-contact-center.png'), fullPage: true });
  await page.getByRole('button', { name: 'Guardar aprobación', exact: true }).click();
  await page.getByRole('button', { name: 'Guardar aprobación', exact: true }).waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 1580, height: 1100 });
  assert.equal(auditRequests, beforeApprovalRequests, 'Guardar aprobación no recarga el reporte completo');
  assert.ok(beforeApprovalExpansion > 0);
  assert.equal(approvalBody.decision.confirmationMode, 'DIRECT_APPROVAL');
  assert.equal(approvalBody.decision.providerId, 7); assert.equal(approvalBody.decision.executionConfirmed, true);
  assert.equal(approvalBody.decision.physicianChangeReason, 'Corrección por error de captura confirmado con Contact Center.');
  assert.equal(approvalBody.decision.evidenceReference, '');
  assert.equal(await page.locator('[data-service-id="91"]').count(), 0, 'Aprobar un servicio lo retira inmediatamente de Por revisar');
  assert.equal(await page.getByLabel('Seleccionar servicio 91', { exact: true }).count(), 0, 'El aprobado ya no conserva una selección pendiente');
  assert.equal(await page.getByRole('button', { name: 'Aprobar', exact: true }).count(), 0, 'El aprobado no se vuelve a ofrecer para aprobación');
  await page.getByRole('button', { name: 'Ir a Pagos y PDF', exact: true }).first().click();
  await page.getByRole('heading', { name: 'Servicios aprobados', exact: true }).waitFor();
  assert.equal(auditRequests, beforeApprovalRequests, 'Ver los aprobados conserva el reporte sin recargar');
  const firstApprovedDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar PDF detallado', exact: true }).click();
  const firstApprovedPath = path.join(output, 'aprobado-individual.pdf');
  const firstApprovedFile = await firstApprovedDownload;
  assert.match(firstApprovedFile.suggestedFilename(), /^Honorarios_Aprobados_Detallado_/);
  await firstApprovedFile.saveAs(firstApprovedPath);
  const firstApprovedText = (await readFile(firstApprovedPath)).toString('latin1');
  assert.ok(firstApprovedText.includes('SERVICIOS APROBADOS'));
  assert.ok(firstApprovedText.includes('PACIENTE PRUEBA'));
  await page.locator('.hon-friendly-nav').screenshot({ path: path.join(output, '01-navegacion.png') });
  await page.getByRole('button', { name: 'Servicios', exact: true }).click();
  await page.getByRole('button', { name: /^Por revisar/ }).click();
  assert.equal(await page.locator('[data-service-id="91"]').count(), 0, 'Volver a Servicios mantiene el aprobado fuera de los pendientes');
  assert.equal(await page.getByText('MÉDICO PRUEBA · #7', { exact: true }).count(), 0, 'El médico sin pendientes sale de la lista Por revisar');
  await page.getByRole('button', { name: /^Aprobados \d/ }).click();
  await page.getByRole('heading', { name: 'Servicios aprobados', exact: true }).waitFor();
  assert.equal(await page.locator('.hon-friendly-summary .hon-total-value').innerText(), '1 servicio', 'Aprobados muestra la aprobación individual guardada');
  await page.getByRole('button', { name: 'Servicios', exact: true }).click();
  await page.getByRole('button', { name: /^Todos \d/ }).click();
  await page.getByText('MÉDICO PRUEBA · #7', { exact: true }).waitFor();
  const individualDoctorCard = page.locator('.hon-doctor-simple').filter({ has: page.getByRole('heading', { name: 'MÉDICO PRUEBA · #7', exact: true }) });
  await individualDoctorCard.getByRole('button', { name: 'Descargar PDF detallado', exact: true }).waitFor();
  assert.equal(await individualDoctorCard.getByRole('button', { name: 'Descargar PDF resumido', exact: true }).isEnabled(), true, 'Servicios ofrece ambas descargas cuando el médico no tiene pendientes seleccionables');
  await individualDoctorCard.locator('.hon-doctor-simple-header').screenshot({ path: path.join(output, 'medico-sin-pendientes-pdf.png') });
  if (!(await page.getByRole('button', { name: 'Más opciones', exact: true }).evaluate(element => element.parentElement.open)))
  await page.getByRole('button', { name: 'Más opciones', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir todos' }).click();
  const historyRow = individualDoctorCard.locator('[data-service-id="91"]');
  assert.equal(await historyRow.count(), 1, 'Todos permite consultar el servicio aprobado');
  assert.equal(await historyRow.getByLabel('Seleccionar servicio 91', { exact: true }).count(), 0, 'Todos no permite seleccionar un aprobado para otro lote');
  assert.equal(await historyRow.getByRole('button', { name: 'Aprobar', exact: true }).count(), 0, 'Todos no ofrece reaprobación de un servicio guardado');
  await historyRow.getByRole('button', { name: 'Detalle', exact: true }).click();
  const historyDetail = page.locator('.hon-modal-content').filter({ hasText: 'Estado actual de revisión' });
  await historyDetail.waitFor();
  assert.equal(await historyDetail.getByRole('button', { name: 'Aprobar', exact: true }).count(), 0, 'El detalle de un aprobado tampoco ofrece reaprobación');
  assert.equal(await historyDetail.getByLabel('Seleccionar servicio 91', { exact: true }).count(), 0);
  await historyDetail.getByRole('button', { name: '✕', exact: true }).click();
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Descargar Excel', exact: true }).click();
  const excelPath = path.join(output, 'revision.xlsx'); await (await download).saveAs(excelPath);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(excelPath);
  const sheet = workbook.worksheets[0]; const header = [...Array(sheet.rowCount).keys()].map(index => sheet.getRow(index + 1)).find(row => row.values.includes('Folio Atención (Vertical)'));
  const column = name => header.values.indexOf(name);
  const service = [...Array(sheet.rowCount).keys()].map(index => sheet.getRow(index + 1)).find(row => row.getCell(column('Clave de registro')).value === 'BI|SOLN|91|ORDEN');
  assert.equal(service.getCell(column('Folio Atención (Vertical)')).value || '', '');
  assert.equal(service.getCell(column('Folio Orden Venta')).value, 181);
  assert.equal(service.getCell(column('Honorario por servicio')).value, 250);
  await page.getByRole('button', { name: 'Pagos y PDF', exact: true }).click();
  await page.getByRole('button', { name: 'Preparar pago y PDF', exact: true }).click();
  assert.equal(await page.getByLabel('Motivo del cierre', { exact: true }).count(), 0, 'No se vuelve a pedir un motivo');
  assert.equal(await page.locator('input:visible').count(), 0, 'Fechas, médico y confirmación no se vuelven a llenar');
  await page.setViewportSize({ width: 1180, height: 860 });
  await page.locator('.hon-card').filter({ has: page.getByRole('heading', { name: 'Preparar pago', exact: true }) }).screenshot({ path: path.join(output, '09-guardar-cierre.png') });
  await page.setViewportSize({ width: 1580, height: 1100 });
  await page.getByRole('button', { name: 'Generar PDF para pago', exact: true }).click();
  assert.equal(closeBody.startDate, '2026-09-01'); assert.equal(closeBody.endDate, '2026-09-30');
  assert.equal(closeBody.confirmed, true); assert.ok(closeBody.reason.length > 0);
  await page.getByRole('heading', { name: /Pago #1/ }).waitFor();
  await page.getByText('Ajustes o pagos por servicio (opcional)', { exact: true }).click();
  await page.getByLabel('Servicio del cierre', { exact: true }).selectOption('BI|SOLN|91|ORDEN');
  await page.getByLabel('Importe MXN', { exact: true }).fill('100');
  await page.getByLabel('Referencia o comprobante', { exact: true }).fill('TRANSFERENCIA-01');
  await page.getByLabel('Motivo', { exact: true }).fill('Pago previamente realizado, comprobante revisado');
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.locator('form').last().screenshot({ path: path.join(output, '10-registrar-pago.png') });
  await page.setViewportSize({ width: 1580, height: 1100 });
  await page.getByRole('button', { name: 'Aplicar pago registrado', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Pago aplicado' }).waitFor();
  assert.equal(liquidation.balance, 125);
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.getByRole('heading', { name: /Pago #1/ }).evaluate(node => node.parentElement.scrollIntoView());
  await page.getByRole('heading', { name: /Pago #1/ }).locator('..').screenshot({ path: path.join(output, '11-saldo-cierre.png') });
  await page.setViewportSize({ width: 1580, height: 1100 });
  await page.screenshot({ path: path.join(output, 'cierre-y-pago.png'), fullPage: true });
  liquidation.lines[0].paidAmount += 25; liquidation.lines[0].balance -= 25;
  liquidation.totalPaid += 25; liquidation.balance -= 25;
  liquidation.payments.push({ id: 2, row_id: liquidation.lines[0].rowId, amount: 25, payment_date: '2026-10-02',
    reference: 'TRANSFERENCIA-02', reason: 'Pago registrado desde otra sesión', created_by: 'OTRO REVISOR', created_at: '2026-10-02T17:30:00.000Z' });
  const closedDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Descargar Excel del cierre' }).click();
  const closedPath = path.join(output, 'cierre.xlsx'); await (await closedDownload).saveAs(closedPath);
  const closedWorkbook = new ExcelJS.Workbook(); await closedWorkbook.xlsx.readFile(closedPath);
  assert.ok(closedWorkbook.worksheets[0].rowCount > 1); assert.deepEqual(errors, []);
  const closureSheet=closedWorkbook.worksheets[0];let closureHeader;
  closureSheet.eachRow(row=>{if(row.values.includes('Pagos aplicados'))closureHeader=row;});
  const closureLine=closureSheet.getRow(closureHeader.number+1);
  assert.equal(closureLine.getCell(closureHeader.values.indexOf('Pagos aplicados')).value,125,'El Excel vuelve a consultar los pagos de otra sesión');
  assert.equal(closureLine.getCell(closureHeader.values.indexOf('Saldo')).value,100);
  // El PDF también vuelve a consultar el saldo actual del servidor.
  const paymentDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar PDF para pago', exact: true }).click();
  const paymentPath = path.join(output, 'pago-actualizado.pdf'); await (await paymentDownload).saveAs(paymentPath);
  assert.equal(paymentReportRequests, 2, 'Cada PDF consulta el saldo actual del servidor');
  assert.ok((await readFile(paymentPath)).byteLength > 1000);
  await page.getByRole('heading', { name: /Pago #1.*Pagado \$125\.00.*Saldo \$100\.00/ }).waitFor();
  let blockedDownloads = 0;
  const countBlockedDownload = () => { blockedDownloads++; };
  page.on('download', countBlockedDownload);
  paymentReportIssue = true;
  await page.getByRole('button', { name: 'Descargar PDF para pago', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'El PDF para pago necesita revisión.' }).waitFor();
  assert.equal(blockedDownloads, 0, 'Una atención que cambió impide descargar un PDF para pago');
  assert.equal(paymentReportRequests, 3);
  paymentReportIssue = false; page.off('download', countBlockedDownload);
  await page.getByRole('button', { name: 'Configuración', exact: true }).click();
  await page.getByRole('button', { name: 'Catálogo y precios', exact: true }).click();
  await page.getByRole('button', { name: 'Aprobados (1)', exact: true }).click();
  await page.getByRole('button', { name: 'Configurar SER1471' }).click();
  await page.getByLabel('Incluir en honorarios').selectOption('EXCLUIDO');
  await page.getByRole('button', { name: 'Guardar configuración', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /quedó excluido/ }).waitFor();
  await page.getByRole('button', { name: 'Aprobados (0)', exact: true }).waitFor();
  const beforeReturn = auditRequests;
  await page.getByRole('button', { name: 'Servicios', exact: true }).click();
  await page.getByRole('heading', { name: 'No se encontraron registros', exact: true }).waitFor();
  assert.ok(auditRequests > beforeReturn, 'Volver a Revisar actualiza el reporte después de cambiar el catálogo');
  assert.equal(await page.getByText('MÉDICO PRUEBA · #7', { exact: true }).count(), 0, 'La revisión no conserva una copia anterior del servicio retirado');
  assert.equal(await page.getByRole('button', { name: 'Exportar', exact: true }).getAttribute('aria-disabled'), 'true');
  assert.equal(liquidation.balance, 100, 'El cierre y ambos pagos anteriores permanecen conservados');
  await page.getByRole('button', { name: 'Configuración', exact: true }).click();
  await page.getByRole('button', { name: 'Catálogo y precios', exact: true }).click();
  await page.getByRole('button', { name: /^Todos los servicios/ }).click();
  await page.getByRole('button', { name: 'Configurar SER1471' }).click();
  await page.getByLabel('Incluir en honorarios').selectOption('INCLUIDO');
  await page.getByRole('button', { name: 'Guardar configuración', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /ya está en Aprobados/ }).waitFor();
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByLabel('Tarifa activa', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Guardar tarifa', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /necesita una tarifa/ }).waitFor();
  await page.getByRole('button', { name: 'Aprobados (0)', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByLabel('Tarifa activa', { exact: true }).check();
  await page.getByRole('button', { name: 'Guardar tarifa', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /ya está en Aprobados/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Aprobados (1)', exact: true }).getAttribute('aria-pressed'), 'false', 'Guardar conserva la lista y filtros actuales');
  fiftyMode = true;
  await page.getByRole('button', { name: 'Servicios', exact: true }).click();
  await page.getByRole('button', { name: /^Por revisar/ }).click();
  await page.getByLabel('Médico', { exact: true }).selectOption('MÉDICO PRUEBA');
  const doctorCard = page.locator('.hon-doctor-simple').filter({ has: page.getByRole('heading', { name: 'MÉDICO PRUEBA · #7', exact: true }) });
  const quickApprove = doctorCard.getByRole('button', { name: 'Aprobar pendientes de MÉDICO PRUEBA · #7', exact: true });
  await quickApprove.waitFor();
  assert.equal(await doctorCard.locator('button:visible').count(), 2, 'La tarjeta normal muestra solamente aprobar pendientes y ver servicios');
  assert.equal(await doctorCard.locator('input:visible').count(), 0, 'No hace falta marcar 50 casillas');
  assert.equal(await doctorCard.getByText(/ISR|Retención|SAP/).count(), 0, 'Los impuestos y documentos están en detalles');
  await page.setViewportSize({ width: 900, height: 1000 });
  await doctorCard.screenshot({ path: path.join(output, '12-multiseleccion.png') });
  await page.setViewportSize({ width: 1580, height: 1100 });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `La tarjeta simple cabe a ${width}px`);
  }
  await doctorCard.screenshot({ path: path.join(output, 'tarjeta-medico-mobile.png') });
  await page.setViewportSize({ width: 1580, height: 1100 });
  await quickApprove.click();
  const cancelledPreview = page.getByRole('dialog', { name: 'Revisar selección', exact: true });
  await cancelledPreview.getByRole('heading', { name: 'Aprobar 50 servicios', exact: true }).waitFor();
  await cancelledPreview.locator('.hon-bulk-summary').getByText('$12,500.00', { exact: true }).waitFor();
  await cancelledPreview.getByLabel('IVA de la selección', { exact: true }).selectOption('0.16');
  await cancelledPreview.screenshot({ path: path.join(output, '13-aprobar-seleccion.png') });
  await cancelledPreview.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await cancelledPreview.waitFor({ state: 'hidden' });
  assert.equal(Object.keys(reviews).filter(id => /^BI\|SOLN\|5[0-4][0-9]\|ORDEN$/.test(id)).length, 0, 'Cancelar no aprueba ningún pendiente');
  await doctorCard.getByRole('button', { name: 'Ver servicios de MÉDICO PRUEBA · #7', exact: true }).click();
  assert.equal(await page.getByLabel('Seleccionar servicio 900', { exact: true }).isEnabled(), false, 'No permite seleccionar cancelados');
  await page.getByLabel('Seleccionar servicio 500', { exact: true }).check();
  await page.getByLabel('Seleccionar servicio 501', { exact: true }).check();
  await page.getByText('2 servicios seleccionados', { exact: true }).waitFor();
  const selectedApprove = doctorCard.getByRole('button', { name: 'Aprobar seleccionados de MÉDICO PRUEBA · #7', exact: true });
  assert.match(await selectedApprove.textContent(), /Aprobar seleccionados \(2\)/);
  await page.getByLabel('Seleccionar servicio 501', { exact: true }).uncheck();
  assert.match(await selectedApprove.textContent(), /Aprobar seleccionados \(1\)/);
  await page.getByLabel('Seleccionar servicio 501', { exact: true }).check();
  await page.setViewportSize({ width: 1000, height: 1000 });
  await doctorCard.evaluate(node => node.scrollIntoView({ block: 'start' }));
  const selectedBox = await doctorCard.boundingBox();
  const lastSelectedBox = await doctorCard.locator('[data-service-id="501"]').boundingBox();
  await page.screenshot({ path: path.join(output, '14-boton-seleccionados.png'), clip: {
    x: selectedBox.x, y: selectedBox.y, width: selectedBox.width,
    height: lastSelectedBox.y + lastSelectedBox.height - selectedBox.y + 8 } });
  await page.setViewportSize({ width: 1580, height: 1100 });
  const beforeSelectedAudit = auditRequests;
  await selectedApprove.click();
  const selectedDialog = page.getByRole('dialog', { name: 'Revisar selección', exact: true });
  await selectedDialog.getByRole('heading', { name: 'Aprobar 2 servicios', exact: true }).waitFor();
  await selectedDialog.locator('.hon-bulk-summary').getByText('$500.00', { exact: true }).waitFor();
  await selectedDialog.getByLabel('IVA de la selección', { exact: true }).selectOption('0.16');
  await selectedDialog.getByRole('button', { name: 'Aprobar servicios', exact: true }).click();
  await selectedDialog.waitFor({ state: 'hidden' });
  assert.deepEqual(lastBulkBody.rows.map(row => row.sourceLineId), [500, 501], 'El botón azul envía solamente los marcados');
  assert.equal(reviews['BI|SOLN|500|ORDEN'].vatRate, 0.16);
  assert.equal(reviews['BI|SOLN|501|ORDEN'].vatRate, 0.16);
  assert.equal(reviews['BI|SOLN|502|ORDEN'], undefined, 'El servicio sin marcar permanece por revisar');
  assert.equal(reviews['BI|SOLN|902|ORDEN'], undefined, 'No aprueba otro médico');
  assert.equal(auditRequests, beforeSelectedAudit, 'Guardar seleccionados no recarga el periodo');
  assert.equal(await doctorCard.locator('[data-service-id="500"]').count(), 0, 'El primer seleccionado aprobado sale de Por revisar al guardar');
  assert.equal(await doctorCard.locator('[data-service-id="501"]').count(), 0, 'El segundo seleccionado aprobado sale de Por revisar al guardar');
  assert.equal(await doctorCard.locator('[data-service-id="502"]').count(), 1, 'El servicio sin seleccionar sigue visible en Por revisar');
  assert.equal(await page.getByLabel('Seleccionar servicio 500', { exact: true }).count(), 0);
  assert.match(await quickApprove.textContent(), /Aprobar pendientes \(48\)/, 'Aprobar pendientes ofrece sólo los restantes del médico');
  await page.getByRole('button', { name: 'Ir a Pagos y PDF', exact: true }).first().click();
  await page.getByRole('heading', { name: 'Servicios aprobados', exact: true }).waitFor();
  assert.equal(auditRequests, beforeSelectedAudit);
  assert.equal(await page.locator('.hon-friendly-summary .hon-total-value').innerText(), '3 servicios', 'La aprobación es visible aunque falten datos fiscales');
  assert.ok((await page.locator('.hon-friendly-summary').innerText()).includes('Honorarios aprobados: $750.00'));
  await doctorCard.getByRole('button', { name: 'Ver servicios de MÉDICO PRUEBA · #7', exact: true }).count().then(async count => {
    if (count) await doctorCard.getByRole('button', { name: 'Ver servicios de MÉDICO PRUEBA · #7', exact: true }).click();
  });
  assert.equal(await page.getByLabel('Seleccionar servicio 500', { exact: true }).count(), 0, 'Aprobados no vuelve a pedir casillas');
  assert.equal(await doctorCard.locator('[data-service-id="500"]').count(), 1);
  assert.equal(await doctorCard.locator('[data-service-id="501"]').count(), 1);
  assert.equal(await doctorCard.locator('[data-service-id="502"]').count(), 0, 'No mezcla pendientes en la lista de aprobados');
  await doctorCard.getByText('Contabilidad debe completar', { exact: false }).waitFor();
  const pendingFiscalPdf = page.waitForEvent('download');
  await doctorCard.getByRole('button', { name: 'Descargar PDF detallado', exact: true }).click();
  const pendingFiscalPath = path.join(output, 'aprobados-fiscal-pendiente.pdf');
  const pendingFiscalFile = await pendingFiscalPdf;
  assert.match(pendingFiscalFile.suggestedFilename(), /^Honorarios_Aprobados_Detallado_/);
  await pendingFiscalFile.saveAs(pendingFiscalPath);
  const pendingFiscalText = (await readFile(pendingFiscalPath)).toString('latin1');
  assert.ok(pendingFiscalText.includes('PENDIENTE'), 'El PDF conserva los impuestos faltantes como pendientes');
  assert.ok(pendingFiscalText.includes('Orden de venta #1500')); assert.ok(pendingFiscalText.includes('Orden de venta #1501'));
  assert.equal(pendingFiscalText.includes('Orden de venta #1502'), false, 'PDF incluye sólo aprobados');
  const summarizedPdf = page.waitForEvent('download');
  await doctorCard.getByRole('button', { name: 'Descargar PDF resumido', exact: true }).click();
  const summarizedFile = await summarizedPdf;
  assert.match(summarizedFile.suggestedFilename(), /^Honorarios_Aprobados_Resumido_/);
  const summarizedPath = path.join(output, 'aprobados-resumido.pdf');
  await summarizedFile.saveAs(summarizedPath);
  const summarizedText = (await readFile(summarizedPath)).toString('latin1');
  assert.ok(summarizedText.includes('SERVICIOS APROBADOS'));
  assert.ok(summarizedText.includes('$750.00'), 'El resumen conserva los honorarios de los tres aprobados');
  assert.equal(summarizedText.includes('$12,500.00'), false, 'El resumen no suma los pendientes');
  assert.equal(summarizedText.includes('PACIENTE PRUEBA'), false, 'El resumido no incluye pacientes');
  assert.equal(summarizedText.includes('Orden de venta #1500'), false, 'El resumido omite el apéndice de atenciones');
  assert.ok((await readFile(summarizedPath)).byteLength < (await readFile(pendingFiscalPath)).byteLength, 'El resumen omite el detalle conservado por el PDF detallado');
  await page.setViewportSize({ width: 1180, height: 1000 });
  await page.evaluate(() => window.scrollTo(0,0));
  assert.ok((await doctorCard.getByRole('heading', { name: 'MÉDICO PRUEBA · #7', exact: true }).boundingBox()).height < 55, 'Las dos descargas dejan espacio para leer el nombre del médico en escritorio');
  await doctorCard.screenshot({ path: path.join(output, '15-aprobados-pdf.png') });
  for (const width of [390, 320]) {
    await page.setViewportSize({width,height:844});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await doctorCard.locator('.hon-doctor-simple-header').screenshot({ path: path.join(output, `aprobados-pdf-header-${width}.png`) });
  }
  await page.setViewportSize({ width: 1580, height: 1100 });
  await page.getByRole('button', { name: 'Servicios', exact: true }).click();
  await quickApprove.waitFor();
  assert.match(await quickApprove.textContent(), /Aprobar pendientes \(48\)/, 'Sin selección vuelve a ofrecer los pendientes restantes');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `La lista de servicios cabe a ${width}px`);
  }
  await page.setViewportSize({ width: 1580, height: 1100 });
  await doctorCard.getByRole('button', { name: 'Ocultar servicios de MÉDICO PRUEBA · #7', exact: true }).click();
  const beforeFiftyAudit = auditRequests;
  await quickApprove.click();
  const fiftyDialog = page.getByRole('dialog', { name: 'Revisar selección', exact: true });
  await fiftyDialog.getByRole('heading', { name: 'Aprobar 48 servicios', exact: true }).waitFor();
  await fiftyDialog.locator('.hon-bulk-summary').getByText('$12,000.00', { exact: true }).waitFor();
  assert.equal(await fiftyDialog.locator('select:visible').count(), 1, 'Sólo pregunta IVA para los 50 servicios');
  assert.equal(await fiftyDialog.locator('input:visible').count(), 0, 'No pide 50 motivos, referencias o confirmaciones');
  await fiftyDialog.getByLabel('IVA de la selección', { exact: true }).selectOption('0.16');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'Aprobación múltiple cabe en móvil');
  await page.setViewportSize({ width: 1580, height: 1100 });
  await fiftyDialog.getByRole('button', { name: 'Aprobar servicios', exact: true }).click();
  await fiftyDialog.waitFor({ state: 'hidden' });
  assert.equal(lastBulkBody.rows.length, 48);
  assert.equal(lastBulkBody.decision.vatRate, 0.16);
  assert.equal(lastBulkBody.decision.confirmationMode, 'DIRECT_APPROVAL');
  assert.equal(lastBulkBody.decision.executionConfirmed, true);
  assert.ok(lastBulkBody.rows.every(row => row.providerId === 7 && row.sourceLineId >= 502 && row.sourceLineId < 550));
  assert.equal(auditRequests, beforeFiftyAudit, 'Aprobar los 48 restantes no vuelve a cargar el reporte');
  assert.ok(lastBulkBody.rows.every(row => reviews[row.rowId]?.vatRate === 0.16));
  assert.equal(reviews['BI|SOLN|900|ORDEN'], undefined);
  assert.equal(reviews['BI|SOLN|901|ORDEN'], undefined);
  assert.equal(reviews['BI|SOLN|902|ORDEN'], undefined, 'No aprueba a otro médico fuera del filtro');
  assert.equal(await quickApprove.count(), 0, 'Tras aprobar los restantes ya no ofrece Aprobar pendientes para el médico');
  assert.equal(await doctorCard.locator('[data-service-id="502"]').count(), 0, 'El lote restante aprobado ya no aparece en Por revisar');
  await page.getByRole('button', { name: 'Pagos y PDF', exact: true }).click();
  if (!(await doctorCard.getByRole('button', { name: 'Ocultar servicios de MÉDICO PRUEBA · #7', exact: true }).count()))
    await doctorCard.getByRole('button', { name: 'Ver servicios de MÉDICO PRUEBA · #7', exact: true }).click();
  await doctorCard.getByText('Ver impuestos y documentos', { exact: true }).click();
  await doctorCard.getByRole('button', { name: 'Preparar pago de aprobados', exact: true }).click();
  await page.getByRole('button', { name: 'Generar PDF para pago', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Los servicios siguen aprobados.' }).waitFor();
  assert.equal(closeBody.providerId, '7');
  assert.equal(liquidation.balance, 100, 'Falta fiscal no altera el cierre previo ni sus pagos');
  assert.equal(await page.getByRole('button', { name: 'PDF de servicios aprobados', exact: true }).isEnabled(), true, 'El error fiscal deja disponible el PDF de aprobados');
  const blockedClosePdf = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF de servicios aprobados', exact: true }).click();
  await (await blockedClosePdf).saveAs(path.join(output, 'aprobados-tras-cierre-bloqueado.pdf'));
  assert.equal(catalogRequests, 1, 'Las modificaciones y cambios de pestaña no vuelven a descargar el catálogo');
  assert.deepEqual(errors, []);
  console.log('PASS: aprobación individual y por lotes fuera de Por revisar, conservada en Aprobados/Pagos; historial sin reaprobación; sólo los dos marcados y luego 48 pendientes. Cancelación, IVA único, móvil, catálogo, Excel, cierres, pagos y ambos PDF correctos.');
} finally { await browser?.close(); await server.close(); }

