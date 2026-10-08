// Descargas reales con servicios sintéticos; sin backend ni sistemas del hospital.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '../tmp/honorarios-pdf-approved');
await mkdir(output, { recursive: true });
const service = (changes = {}) => ({ ModeBI: true, TipoCalculo: 'BI_PRESTACION', CatalogStatus: 'INCLUIDO',
  CatalogApproved: true, ReviewEligible: true, MedicoId: 7, Medico: 'MEDICO AUTORIZADO',
  CodigoServicio: 'SER1', Servicio: 'SERVICIO APROBADO', GrupoServicio: 'CONSULTA',
  Paciente: 'PACIENTE AUTORIZADO', RolMedico: 'TRATANTE', FechaAtencion: '2026-10-02',
  FolioAtencion: 781, FolioOrdenVenta: 882, Cantidad: 1, BaseImporte: 250,
  TariffSnapshot: { id: 1, itemCode: 'SER1', amount: 250, active: true, providerId: null,
    role: 'TRATANTE', validFrom: '2026-10-01', validTo: '2026-10-31' },
  _reviewStatus: 'APROBADO', _effectiveElegible: true, _effectiveBase: 250,
  _effectiveIVA: 0, _effectiveISR: 25, _effectiveRetIVA: 0, _effectiveNeto: 225,
  _effectiveISRRate: 0.1, _fiscalNote: 'Impuestos estimados para la prueba.', ...changes });
const rows = [service(),
  service({ Servicio: 'SERVICIO PENDIENTE', Paciente: 'PACIENTE PENDIENTE', FolioAtencion: 782,
    _reviewStatus: 'PENDIENTE', _effectiveElegible: false, _effectiveBase: 0, _effectiveNeto: 0 }),
  service({ Servicio: 'SERVICIO EXCLUIDO', Paciente: 'PACIENTE EXCLUIDO', FolioAtencion: 783,
    _reviewStatus: 'RECHAZADO', _effectiveElegible: false, _effectiveBase: 0, _effectiveNeto: 0 }),
  ...[{ CatalogStatus: 'PENDIENTE' }, { ReviewEligible: false }, { CatalogApproved: false }, { TariffSnapshot: null },
    { TariffSnapshot: { ...service().TariffSnapshot, providerId: 99 } },
    { TariffSnapshot: { ...service().TariffSnapshot, validTo: '2026-10-01' } },
    { MedicoId: 99 }, { Medico: 'MEDICO AJENO', MedicoId: 99 }].map((change, index) =>
    service({ Servicio: `NO INCLUIR ${index}`, Paciente: `PACIENTE AJENO ${index}`, ...change })),
  service({ TipoCalculo: 'SAP_DOCUMENTO', Servicio: 'FACTURA SECRETA SAP', SapDocumento: { docNum: 999,
    documentTotal: 5000, currency: 'MXN', lines: [{ description: 'CONCEPTO AJENO SAP', quantity: 1, recordedAmount: 5000 }] } })];
const doctor = { medico: 'MEDICO AUTORIZADO · #7', providerName: 'MEDICO AUTORIZADO', providerId: 7,
  especialidad: 'GENERAL', filas: rows, filasRevision: rows, totalNeto: 999999,
  sap: { linkStatus: 'candidato_unico', invoices: [{ docNum: 999, documentTotal: 5000, currency: 'MXN',
    lines: [{ description: 'CONCEPTO AJENO SAP', quantity: 1, recordedAmount: 5000 }] }] } };
const server = await createServer({ configFile: false, root, appType: 'custom', plugins: [{
  name: 'isolated-pdf-eligibility', configureServer(server) {
    server.middlewares.use('/__pdf_approved', async (_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end(await server.transformIndexHtml('/__pdf_approved', '<!doctype html><html><body><script type="module">import * as pdf from "/src/utils/honorariosPdfGenerator.js"; window.honorariosPdf = pdf;</script></body></html>'));
    });
  }
}], server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${server.resolvedUrls.local[0]}__pdf_approved`);
  await page.waitForFunction(() => !!window.honorariosPdf);
  const download = async (data, detailed, combined, file) => {
    const downloadPromise = page.waitForEvent('download');
    const generated = await page.evaluate(({ data, detailed, combined }) =>
      window.honorariosPdf[combined ? 'generateAllDoctorsHonorariosPdf' : 'generateDoctorHonorariosPdf'](
        data, '2026-10-01', '2026-10-31', detailed, 'REVISOR PRUEBA'), { data, detailed, combined });
    assert.equal(generated, true);
    const filePath = path.join(output, file);
    await (await downloadPromise).saveAs(filePath);
    return (await readFile(filePath)).toString('latin1');
  };
  const detailed = await download(doctor, true, false, 'revision-detallada.pdf');
  for (const present of ['SERVICIO APROBADO', 'SERVICIO PENDIENTE', 'SERVICIO EXCLUIDO', 'PACIENTE AUTORIZADO',
    'PACIENTE PENDIENTE', 'PACIENTE EXCLUIDO', 'Orden de venta #882', '1 aprobados, 1 excluidos y 1 por revisar',
    'Por revisar', 'Excluido', '$225.00']) assert.ok(detailed.includes(present), present);
  for (const absent of ['NO INCLUIR', 'PACIENTE AJENO', 'MEDICO AJENO', 'FACTURA SECRETA', 'CONCEPTO AJENO',
    '$5,000.00', '$999,999.00', 'finiquito', 'REVISOR PRUEBA']) assert.equal(detailed.includes(absent), false, absent);
  assert.ok(detailed.includes('Honorario propuesto: $250.00'));
  assert.equal(detailed.includes('Honorario propuesto: $0.00'), false);

  const summary = await download(doctor, false, false, 'revision-resumida.pdf');
  for (const present of ['SERVICIO APROBADO', 'SERVICIO PENDIENTE', 'SERVICIO EXCLUIDO', '$225.00']) assert.ok(summary.includes(present), present);
  assert.equal(summary.includes('PACIENTE AUTORIZADO'), false);
  assert.equal(summary.includes('FACTURA SECRETA'), false);

  const secondDoctor = { medico: 'SEGUNDO MEDICO · #8', providerName: 'SEGUNDO MEDICO', providerId: 8,
    filasRevision: [service({ Medico: 'SEGUNDO MEDICO', MedicoId: 8, Servicio: 'SERVICIO SEGUNDO' })] };
  const invalidDoctor = { medico: 'MEDICO SIN CONFIGURAR · #9', filas: [service({ Medico: 'MEDICO SIN CONFIGURAR', MedicoId: 9, CatalogStatus: 'PENDIENTE' })] };
  const combined = await download([doctor, secondDoctor, invalidDoctor], true, true, 'revision-completa.pdf');
  assert.ok(combined.includes('SEGUNDO MEDICO'));
  assert.ok(combined.includes('SERVICIO SEGUNDO'));
  assert.equal(combined.includes('MEDICO SIN CONFIGURAR'), false);

  const pages = await download({ ...doctor, filasRevision: Array.from({ length: 90 }, (_, index) =>
    service({ Servicio: `SERVICIO LARGO ${index} CON DESCRIPCION CLINICA SUFICIENTE PARA REVISAR`,
      Paciente: `PACIENTE PAGINA ${index}`, FolioAtencion: index + 1 })) }, true, false, 'revision-multipagina.pdf');
  assert.ok(pages.includes('PACIENTE PAGINA 89'));
  assert.ok((pages.match(/\/Type \/Page\b/g) || []).length > 3);
  assert.ok(pages.includes('$20,250.00'));
  const approvedDownload = page.waitForEvent('download');
  assert.equal(await page.evaluate(data => window.honorariosPdf.generateDoctorHonorariosPdf(
    data, '2026-10-01', '2026-10-31', true, 'REVISOR PRUEBA', true), doctor), true);
  const approvedPath = path.join(output, 'solo-aprobados.pdf');
  const approvedFile = await approvedDownload;
  assert.match(approvedFile.suggestedFilename(), /^Honorarios_Aprobados_/);
  await approvedFile.saveAs(approvedPath);
  const approvedText = (await readFile(approvedPath)).toString('latin1');
  for (const present of ['SERVICIOS APROBADOS', 'SERVICIO APROBADO', 'PACIENTE AUTORIZADO', '$225.00']) assert.ok(approvedText.includes(present), present);
  for (const absent of ['SERVICIO PENDIENTE', 'PACIENTE PENDIENTE', 'SERVICIO EXCLUIDO', 'PACIENTE EXCLUIDO', 'PACIENTE AJENO', 'FACTURA SECRETA']) assert.equal(approvedText.includes(absent), false, absent);
  const approvedCombinedDownload = page.waitForEvent('download');
  assert.equal(await page.evaluate(data => window.honorariosPdf.generateAllDoctorsHonorariosPdf(
    data, '2026-10-01', '2026-10-31', true, 'REVISOR PRUEBA', true), [doctor, secondDoctor]), true);
  const approvedCombinedPath = path.join(output, 'solo-aprobados-completo.pdf');
  await (await approvedCombinedDownload).saveAs(approvedCombinedPath);
  const approvedCombinedText = (await readFile(approvedCombinedPath)).toString('latin1');
  assert.ok(approvedCombinedText.includes('SERVICIO SEGUNDO'));
  assert.equal(approvedCombinedText.includes('SERVICIO PENDIENTE'), false);
  const skipped = await page.evaluate(({ invalidDoctor }) => ({
    individual: window.honorariosPdf.generateDoctorHonorariosPdf(invalidDoctor, '2026-10-01', '2026-10-31'),
    combined: window.honorariosPdf.generateAllDoctorsHonorariosPdf([invalidDoctor], '2026-10-01', '2026-10-31')
  }), { invalidDoctor });
  assert.deepEqual(skipped, { individual: false, combined: false });
  assert.deepEqual(errors, []);
  console.log('PASS: PDF individual, resumido, combinado y multipágina; catálogo, médico y tarifa aplicable; estados humanos y totales conservados; facturas SAP fuera del PDF.');
} finally {
  await browser?.close();
  await server.close();
}
