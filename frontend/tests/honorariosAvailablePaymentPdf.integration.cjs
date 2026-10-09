'use strict';
// Contrato y documentos reales de aprobaciones sintéticas; sin solicitudes ni bases operativas.
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '../tmp/honorarios-available-pdf-renderer');
fs.mkdirSync(output, { recursive: true });
const esbuild = require(path.join(root, 'node_modules/esbuild'));
const { jsPDF } = require('jspdf');
let saved;
jsPDF.API.save = function(filename) {
  saved = { filename, pages: this.getNumberOfPages(), bytes: Buffer.from(this.output('arraybuffer')) };
  return this;
};
const bundle = esbuild.buildSync({ entryPoints: [path.join(root, 'src/utils/honorariosAvailablePaymentPdfGenerator.js')],
  bundle: true, format: 'cjs', platform: 'node', write: false, external: ['jspdf'] }).outputFiles[0].text;
const compiled = new Module(path.join(root, '__available_renderer_check.cjs'));
compiled.filename = path.join(root, '__available_renderer_check.cjs');
compiled.paths = Module._nodeModulePaths(root); compiled._compile(bundle, compiled.filename);
const { validateHonorariosAvailablePaymentReport: validate, generateHonorariosAvailablePaymentPdf: generate } = compiled.exports;
const line = (changes = {}) => ({ rowId: 'BI|SOLN|TEST|ORDEN', sourceType: 'SOLN', providerId: 23,
  providerName: 'MEDICO SINTETICO', description: 'CONSULTA SINTETICA', serviceDate: '2026-08-16',
  quantity: 1, unitAmount: 100, baseAmount: 100, vatRate: .16, vat: 16,
  isr: null, vatWithholding: null, netAmount: null, ...changes });
const amounts = lines => Object.fromEntries(Object.entries({ base: 'baseAmount', vat: 'vat', isr: 'isr',
  vatWithholding: 'vatWithholding', net: 'netAmount' }).map(([key, field]) => [key,
  lines.some(item => item[field] === null) ? null : lines.reduce((total, item) => total + Math.round(item[field] * 100), 0) / 100]));
const report = (lines = [line()], period = { startDate: '2026-08-01', endDate: '2026-08-31' }) => ({ version: 1,
  currency: 'MXN', status: lines.some(item => item.netAmount === null) ? 'FISCAL_PENDING' : 'AVAILABLE',
  generatedAt: '2026-10-08T20:00:00.000Z', period, totals: amounts(lines), doctors: [{ providerId: 23,
    providerName: 'MEDICO SINTETICO', fiscal: { ready: !lines.some(item => item.netAmount === null), federalTaxId: null,
      fiscalRegime: null }, lines, totals: amounts(lines) }] });
const cases = [
  ['unknown fiscal stays null', report(), true],
  ['approved IVA 8%', report([line({ vatRate: .08, vat: 8 })]), true],
  ['IVA rounded per line', report([line({ rowId: 'A', unitAmount: 300.03, baseAmount: 300.03, vat: 48 }),
    line({ rowId: 'B', unitAmount: 300.03, baseAmount: 300.03, vat: 48 })]), true],
  ['fixed monthly in partial period', report([line({ rowId: 'FIXED|23|2026-08', sourceType: 'BI_FIJO_MENSUAL',
    FixedMonthly: true, month: '2026-08', serviceDate: '2026-08-01' })], { startDate: '2026-08-15', endDate: '2026-08-31' }), true],
  ['confirmed zero tax', report([line({ vatRate: 0, vat: 0, isr: 0, vatWithholding: 0, netAmount: 100 })]), true],
  ['fractional quantity', report([line({ unitAmount: 2.3, quantity: .95, baseAmount: 2.19, vatRate: 0, vat: 0 })]), true],
  ['invented net', report([line({ netAmount: 116 })]), false],
  ['wrong doctor', (() => { const value = report(); value.doctors[0].lines[0].providerId = 24; return value; })(), false],
  ['wrong period', report([line({ serviceDate: '2026-09-01' })]), false],
  ['impossible date', report([line({ serviceDate: '2026-02-30' })]), false],
  ['duplicate service', report([line(), line()]), false],
  ['wrong amount', report([line({ baseAmount: 101 })]), false],
  ['wrong IVA', report([line({ vat: 17 })]), false],
  ['fixed month outside period', report([line({ sourceType: 'BI_FIJO_MENSUAL', month: '2026-07', serviceDate: '2026-07-01' })]), false],
  ['fixed month wrong day', report([line({ sourceType: 'BI_FIJO_MENSUAL', month: '2026-08', serviceDate: '2026-08-02' })]), false],
  ['status hides unknown fiscal', { ...report(), status: 'AVAILABLE' }, false],
  ['summary hides unknown taxes', { ...report(), totals: { base: 100, vat: 16, isr: 0, vatWithholding: 0, net: 116 } }, false]
];
for (const [label, value, accepted] of cases) {
  if (accepted) assert.equal(validate(value), value, label);
  else assert.throws(() => validate(value), undefined, label);
}
const large = report(Array.from({ length: 300 }, (_, index) => line({ rowId: `TEST_${index}`,
  description: `SERVICIO_SINTETICO_${String(index).padStart(3, '0')} ${'Descripción extensa '.repeat(7)}` })));
generate(large, true);
const detailed = saved, pdf = detailed.bytes.toString('latin1');
assert.ok(detailed.pages > 10);
for (let index = 0; index < 300; index += 1) assert.ok(pdf.includes(`SERVICIO_SINTETICO_${String(index).padStart(3, '0')}`));
assert.ok(pdf.includes('Pendiente')); assert.ok(!pdf.includes('SALDO PENDIENTE'));
assert.ok(detailed.filename.includes('Fiscal_pendiente'));
fs.writeFileSync(path.join(output, '300-servicios-detallado.pdf'), detailed.bytes);
generate(report([line(), line({ rowId: 'OTHER' })]), false);
assert.ok(saved.filename.includes('Resumido')); assert.ok(saved.bytes.toString('latin1').includes('$200.00'));
fs.writeFileSync(path.join(output, 'resumido-fiscal-pendiente.pdf'), saved.bytes);
const separated = report([line()]);
separated.doctors.push({ ...separated.doctors[0], providerId: 24, lines: [line({ rowId: 'OTHER', providerId: 24 })] });
separated.totals = amounts(separated.doctors.flatMap(doctor => doctor.lines));
generate(separated);
assert.ok(saved.bytes.toString('latin1').includes('#23')); assert.ok(saved.bytes.toString('latin1').includes('#24'));
console.log(`PASS: ${cases.length} validaciones fiscales y de importes; detallado ${detailed.pages} páginas / 300 servicios, resumido y médicos homónimos separados.`);
