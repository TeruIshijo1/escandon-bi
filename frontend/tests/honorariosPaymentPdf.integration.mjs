// Contrato y PDF reales de un cierre sintético; sin bases de datos ni pagos reales.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '../tmp/honorarios-payment-pdf');
await mkdir(output, { recursive: true });
const round = value => Math.round(value * 100) / 100;
const summarize = lines => {
  const fields = { base: 'baseAmount', vat: 'vat', isr: 'isr', vatWithholding: 'vatWithholding',
    net: 'netAmount', adjustments: 'adjustmentAmount', paid: 'paidAmount', balance: 'balance' };
  const totals = Object.fromEntries(Object.entries(fields).map(([key, name]) => [key,
    lines.reduce((sum, line) => sum + Math.round(line[name] * 100), 0) / 100]));
  return { ...totals, payable: totals.balance };
};
const recompute = report => {
  report.doctors.forEach(doctor => {
    doctor.lines.forEach(line => {
      line.paidAmount = round(doctor.payments.filter(payment => payment.row_id === line.rowId).reduce((sum, payment) => sum + payment.amount, 0));
      line.adjustmentAmount = round(doctor.adjustments.filter(adjustment => adjustment.row_id === line.rowId).reduce((sum, adjustment) => sum + adjustment.amount, 0));
      line.balance = round(line.netAmount + line.adjustmentAmount - line.paidAmount);
    });
    doctor.totals = summarize(doctor.lines);
  });
  report.totals = summarize(report.doctors.flatMap(doctor => doctor.lines));
  report.status = report.totals.balance === 0 ? 'PAID' : 'READY';
  return report;
};
const line = (providerId, changes = {}) => ({ rowId: `BI|SERVICIO|${providerId}`, providerId,
  providerName: 'MEDICO HOMONIMO DE PRUEBA', role: 'TRATANTE', description: `CONSULTA AUTORIZADA ${providerId}`,
  serviceDate: '2026-10-01', patient: `PACIENTE CIERRE ${providerId}`, attention: 900 + providerId,
  appointment: 1900 + providerId, salesOrder: 2900 + providerId,
  quantity: 1, unitAmount: 250, baseAmount: 250, vat: 40, isr: 25, vatWithholding: 26.67, netAmount: 238.33,
  tariff: { id: 3, revision: 2 }, reviewer: 'RESPONSABLE CLINICO', ...changes });
const application = (providerId, amount, reference, adjustment = false) => ({ row_id: `BI|SERVICIO|${providerId}`, amount,
  reference, reason: adjustment ? 'CORRECCION AUTORIZADA' : 'TRANSFERENCIA CONFIRMADA', created_by: 'TESORERIA PRUEBA',
  payment_date: '2026-10-02', created_at: '2026-10-02T16:00:00.000Z' });
const createReport = () => recompute({ version: 1, generatedAt: '2026-10-02T17:30:00.000Z', currency: 'MXN', status: 'READY', issues: [],
  liquidation: { id: 42, startDate: '2026-10-01', endDate: '2026-10-02', createdAt: '2026-10-02T15:00:00.000Z',
    createdBy: 'RESPONSABLE DEL CIERRE', reason: 'CIERRE VALIDADO OCTUBRE', fiscalNote: 'Impuestos confirmados al cierre de prueba.', sapAsOf: '2026-10-02T14:55:00.000Z' },
  doctors: [{ providerId: 7, providerName: 'MEDICO HOMONIMO DE PRUEBA', lines: [line(7)],
    payments: [application(7, 100, 'TRANSFERENCIA-7')], adjustments: [application(7, -38.33, 'AJUSTE-7', true)] },
  { providerId: 8, providerName: 'MEDICO HOMONIMO DE PRUEBA', lines: [line(8, { quantity: 2, baseAmount: 500, vat: 80, isr: 50, vatWithholding: 53.33, netAmount: 476.67 })],
    payments: [application(8, 400, 'TRANSFERENCIA-8')], adjustments: [application(8, 23.33, 'AJUSTE-8', true)] }] });

const server = await createServer({ configFile: false, root, appType: 'custom', plugins: [{
  name: 'isolated-payment-pdf', configureServer(server) {
    server.middlewares.use('/__payment_pdf', async (_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end(await server.transformIndexHtml('/__payment_pdf', '<!doctype html><html><body><script type="module">import * as pdf from "/src/utils/honorariosPaymentPdfGenerator.js"; window.paymentPdf = pdf;</script></body></html>'));
    });
  }
}], server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  let downloads = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('download', () => { downloads += 1; });
  await page.goto(`${server.resolvedUrls.local[0]}__payment_pdf`);
  await page.waitForFunction(() => !!window.paymentPdf);
  const download = async (report, file) => {
    const pending = page.waitForEvent('download');
    assert.equal(await page.evaluate(report => window.paymentPdf.generateHonorariosPaymentPdf(report), report), true);
    const filePath = path.join(output, file); await (await pending).saveAs(filePath);
    return (await readFile(filePath)).toString('latin1');
  };
  const report = createReport();
  assert.deepEqual(report.totals, { base: 750, vat: 120, isr: 75, vatWithholding: 80, net: 715, adjustments: -15, paid: 500, balance: 200, payable: 200 });
  const pdf = await download(report, 'pago-pendiente.pdf');
  for (const required of ['SALDO PENDIENTE', '$200.00', '$715.00', '$500.00', '-$15.00', '$750.00', '$120.00', '-$75.00', '-$80.00',
    'CONSULTA AUTORIZADA 7', 'CONSULTA AUTORIZADA 8', 'TRANSFERENCIA-7', 'TRANSFERENCIA-8', 'AJUSTE-7', 'AJUSTE-8',
    'PACIENTE CIERRE 7', 'RESPONSABLE DEL CIERRE', 'RESPONSABLE CLINICO', 'TESORERIA PRUEBA', 'CORRECCION AUTORIZADA',
    'Orden de venta #2907', 'Cita #1907', '#7', '#8']) assert.ok(pdf.includes(required), required);
  assert.ok((pdf.match(/\/Type \/Page\b/g) || []).length >= 3);

  const paid = createReport();
  paid.doctors.forEach(doctor => doctor.payments.push(application(doctor.providerId, 100, `PAGO-FINAL-${doctor.providerId}`)));
  recompute(paid);
  const paidPdf = await download(paid, 'pagado-sin-saldo.pdf');
  assert.ok(paidPdf.includes('CIERRE SIN SALDO PENDIENTE'));
  assert.ok(paidPdf.includes('Importe a pagar: $0.00'));
  assert.ok(paidPdf.includes('PAGO-FINAL-7'));

  const noLedger = createReport();
  noLedger.doctors.forEach(doctor => { doctor.payments = []; doctor.adjustments = []; });
  recompute(noLedger);
  const noLedgerPdf = await download(noLedger, 'sin-movimientos.pdf');
  assert.ok(noLedgerPdf.includes('Sin pagos registrados.'));
  assert.ok(noLedgerPdf.includes('Sin ajustes registrados.'));

  const fractional = createReport();
  fractional.doctors = [{ providerId: 7, providerName: 'MEDICO HOMONIMO DE PRUEBA', payments: [], adjustments: [],
    lines: [line(7, { quantity: 0.03, unitAmount: 33.50, baseAmount: 1.01, vat: 0, isr: 0, vatWithholding: 0, netAmount: 1.01 })] }];
  recompute(fractional);
  const fractionalPdf = await download(fractional, 'cantidad-fraccionaria.pdf');
  assert.ok(fractionalPdf.includes('$1.01'));
  assert.ok(fractionalPdf.includes('Cantidad: 0.03'));
  assert.ok(fractionalPdf.includes('$33.50'));
  const incorrectFractional = structuredClone(fractional);
  incorrectFractional.doctors[0].lines[0].baseAmount = 1;
  incorrectFractional.doctors[0].lines[0].netAmount = 1;
  recompute(incorrectFractional);
  const fractionalError = await page.evaluate(report => {
    try { window.paymentPdf.generateHonorariosPaymentPdf(report); return null; }
    catch (error) { return error.message; }
  }, incorrectFractional);
  assert.match(fractionalError || '', /No se puede generar el PDF de pago/);

  for (const [unitAmount, quantity, correct, incorrect] of [[2.30, 0.95, 2.19, 2.18], [2.50, 0.87, 2.18, 2.17], [2.65, 0.9, 2.39, 2.38]]) {
    const exact = structuredClone(fractional);
    Object.assign(exact.doctors[0].lines[0], { unitAmount, quantity, baseAmount: correct, netAmount: correct });
    recompute(exact);
    const exactPdf = await download(exact, `decimal-exacto-${correct}.pdf`);
    assert.ok(exactPdf.includes(`$${correct.toFixed(2)}`));
    Object.assign(exact.doctors[0].lines[0], { baseAmount: incorrect, netAmount: incorrect });
    recompute(exact);
    const error = await page.evaluate(report => {
      try { window.paymentPdf.generateHonorariosPaymentPdf(report); return null; }
      catch (error) { return error.message; }
    }, exact);
    assert.match(error || '', /No se puede generar el PDF de pago/, `${unitAmount} × ${quantity} debe ser ${correct}`);
  }

  const many = createReport();
  many.doctors = [{ providerId: 7, providerName: 'MEDICO HOMONIMO DE PRUEBA', payments: [], adjustments: [],
    lines: Array.from({ length: 30 }, (_, index) => line(7, { rowId: `PAGINA-${index}`, description: `SERVICIO AMPLIO ${index} CON INFORMACION CLINICA PARA IDENTIFICAR LA ATENCION`, patient: `PACIENTE MULTIPAGINA ${index}` })) }];
  recompute(many);
  const multiPdf = await download(many, 'pago-multipagina.pdf');
  assert.ok(multiPdf.includes('PACIENTE MULTIPAGINA 29'));
  assert.ok((multiPdf.match(/\/Type \/Page\b/g) || []).length > 7);

  const invalidCases = [
    r => { r.status = 'REVIEW_REQUIRED'; }, r => { r.issues = [{ code: 'MISSING_FISCAL', message: 'Falta información' }]; },
    r => { r.currency = 'USD'; }, r => { r.totals.payable = 715; }, r => { r.doctors[0].totals.base += 0.01; },
    r => { r.doctors[0].lines[0].netAmount += 0.01; }, r => { r.doctors[0].lines[0].balance = -0.01; },
    r => { r.doctors[0].lines[0].baseAmount = null; }, r => { r.doctors[0].lines[0].baseAmount = '250'; },
    r => { r.doctors[0].lines[0].vat = 40.001; }, r => { r.doctors[0].lines[0].quantity = true; },
    r => { r.doctors[0].lines[0].providerId = 8; }, r => { r.doctors[1].providerId = 7; },
    r => { r.doctors[1].lines[0].rowId = r.doctors[0].lines[0].rowId; }, r => { r.doctors[0].payments[0].amount = 99; },
    r => { r.doctors[0].payments[0].row_id = 'OTRO-SERVICIO'; }, r => { r.doctors[0].payments[0].reference = ''; },
    r => { r.doctors[0].payments.push({ ...r.doctors[0].payments[0] }); },
    r => { r.doctors[0].adjustments[0].created_by = ''; }, r => { r.doctors[0].adjustments[0].amount = 38.33; },
    r => { r.status = 'PAID'; }, r => { r.generatedAt = '2026-02-31'; },
    r => { r.doctors[0].lines[0].unitAmount = 249; }, r => { r.doctors[0].lines[0].vatWithholding = -1; },
    r => { r.doctors[0].payments[0].liquidation_id = 99; },
    r => { r.doctors[0].adjustments[0].id = 1; r.doctors[1].adjustments[0].id = 1; }
  ];
  const before = downloads;
  for (const mutate of invalidCases) {
    const invalid = createReport(); mutate(invalid);
    const error = await page.evaluate(report => {
      try { window.paymentPdf.generateHonorariosPaymentPdf(report); return null; }
      catch (error) { return error.message; }
    }, invalid);
    assert.match(error || '', /No se puede generar el PDF de pago/, mutate.toString());
  }
  assert.equal(downloads, before, 'ningún informe inconsistente debe producir una descarga');
  assert.deepEqual(errors, []);
  console.log(`PASS: PDF de pago y saldo cero, dos médicos homónimos separados, redondeo decimal exacto, movimientos trazables, multipágina y ${invalidCases.length + 4} inconsistencias bloqueadas.`);
} finally { await browser?.close(); await server.close(); }
