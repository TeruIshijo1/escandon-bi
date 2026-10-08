'use strict';
jest.mock('../services/statisticsVertical.service', () => ({ getClinicalStatistics: jest.fn(), getAccountClassifications: jest.fn() }));
jest.mock('../services/statisticsSap.service', () => ({ getFinancialStatistics: jest.fn() }));
const { topDoctors, financialSections, assembleReport, mergeClassification, getReport, getHistory, clearCache } = require('../services/statistics.service');
const { getClinicalStatistics, getAccountClassifications } = require('../services/statisticsVertical.service');
const { getFinancialStatistics } = require('../services/statisticsSap.service');
const { SECTIONS } = require('../services/statisticsCatalog');
const { createStatisticsWorkbook } = require('../services/statisticsWorkbook.service');
const ExcelJS = require('exceljs');
const range = { startDate: '2026-09-01', endDate: '2026-09-30', endExclusive: '2026-10-01' };

function fixture() {
  const sections = Object.fromEntries(SECTIONS.map(s => [s.key, { rows: [], quantity: 0, unit: s.unit, criterion: 'Criterio de prueba', warnings: [] }]));
  sections.births.quantity = null;
  sections.births.warnings = ['Falta evidencia del lugar de nacimiento.'];
  const financial = {
    rows: [
      { Fecha: '2026-09-30', Categoria: 'imagen', Cantidad: 2, IngresoNeto: 200.12 },
      { Fecha: '2026-10-01', Categoria: 'imagen', Cantidad: 9, IngresoNeto: 999 },
      { Fecha: '2026-09-01', Categoria: 'laboratorio', Cantidad: 3, IngresoNeto: 70.10 },
      { Fecha: '2026-09-02', Categoria: 'choque', FolioAtencion: 21, Cantidad: 2, IngresoNeto: 10 },
      { Fecha: '2026-09-03', Categoria: 'choque', FolioAtencion: 21, Cantidad: 3, IngresoNeto: 15 }
    ],
    documents: [
      { Fecha: '2026-09-01', TipoAtencion: 'IP', Medico: 'Médico A', NumeroMedico: 1, FolioAtencion: 11, TotalOrdenVenta: 100.11 },
      { Fecha: '2026-09-02', TipoAtencion: 'IP', Medico: 'Médico A', NumeroMedico: 1, FolioAtencion: 11, TotalOrdenVenta: 50.10 },
      { Fecha: '2026-09-03', TipoAtencion: 'ER', Medico: 'Médico B', NumeroMedico: 2, FolioAtencion: 12, TotalOrdenVenta: 800 }
    ], warnings: []
  };
  financial.billing = { rows: [...financial.rows], warnings: [] };
  return { clinical: { sections, general: {}, warnings: [] }, financial };
}

test('servicios e ingresos incluyen fecha final completa y excluyen el siguiente día; choque no duplica atenciones', () => {
  const sections = financialSections(fixture().financial, range);
  expect(sections.image.quantity).toBe(2);
  expect(sections.imageIncome.quantity).toBe(200.12);
  expect(sections.lab.quantity).toBe(3);
  expect(sections.shock.quantity).toBe(1);
});

test('imagen y laboratorio descuentan notas de crédito y jamás sustituyen facturas por órdenes', () => {
  const financial = fixture().financial;
  financial.billing.rows.push({ Fecha: '2026-09-15', Categoria: 'laboratorio', Cantidad: -1, IngresoNeto: -20 });
  expect(financialSections(financial, range).lab.quantity).toBe(2);
  expect(financialSections(financial, range).labIncome.quantity).toBe(50.10);
  delete financial.billing;
  expect(financialSections(financial, range).lab.quantity).toBeNull();
});

test('Top 10 independientes suman cabeceras únicas, con cuentas distintas y sin mezclar urgencias', () => {
  const rows = topDoctors(fixture().financial.documents, 'IP');
  expect(rows).toEqual([{ Ranking: 1, Medico: 'Médico A', NumeroMedico: 1, IngresoTotal: 150.21, Ordenes: 2, Cuentas: 1 }]);
  const many = Array.from({length: 12}, (_, i) => ({ TipoAtencion: 'ER', Medico: `M${i}`, NumeroMedico: i + 1, TotalOrdenVenta: i + 1 }));
  const top = topDoctors(many, 'ER');
  expect(top).toHaveLength(10);
  expect(top[0].IngresoTotal).toBe(12);
  expect(top[9].IngresoTotal).toBe(3);
});

test('reporte no convierte nacimientos sin evidencia en cero', () => {
  const report = assembleReport(range, fixture());
  expect(report.general.Nacimientos).toBeNull();
  expect(report.warnings).toContain('Falta evidencia del lugar de nacimiento.');
});

test('nunca combina el nombre SAP con el identificador de un médico diferente', () => {
  expect(mergeClassification({ Medico: 'Doctor A', NumeroMedico: null }, { Medico: 'Doctor B', NumeroMedico: 2 }).NumeroMedico).toBeNull();
  expect(mergeClassification({ Medico: 'Sin identificar', NumeroMedico: null }, { Medico: 'Doctor B', NumeroMedico: 2 }).Medico).toBe('Doctor B');
  expect(mergeClassification({ Medico: 'Sin identificar', NumeroMedico: 1 }, { Medico: 'Doctor B', NumeroMedico: 2 }).Medico).toBe('Sin identificar');
  expect(topDoctors([{ TipoAtencion: 'IP', Medico: 'Sin identificar', TotalOrdenVenta: 100000 }], 'IP')).toEqual([]);
});

test('Excel incluye todas las secciones, detalle, importes tipados, filtros y resultados enlazados', async () => {
  const report = assembleReport(range, fixture());
  const buffer = await createStatisticsWorkbook(report);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  expect(workbook.worksheets).toHaveLength(SECTIONS.length + 4);
  expect(workbook.getWorksheet('02 Nacimientos').getCell('B4').value).toBe('No disponible');
  const image = workbook.getWorksheet('10 Ingresos imagen');
  expect(image.getCell('B4').value).toBe(200.12);
  expect(image.autoFilter).toBeTruthy();
  expect(image.views[0].ySplit).toBe(7);
  const summary = workbook.getWorksheet('Resumen');
  const index = SECTIONS.findIndex(s => s.key === 'imageIncome') + 8;
  expect(summary.getCell(index, 2).value).toEqual({ formula: "'10 Ingresos imagen'!B4", result: 200.12 });
});

describe('deduplicación de consultas pendientes', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-07T18:00:00.000Z'));
    clearCache();
    getClinicalStatistics.mockReset().mockImplementation(async () => fixture().clinical);
    getAccountClassifications.mockReset().mockResolvedValue({});
    getFinancialStatistics.mockReset();
  });
  afterEach(() => { clearCache(); jest.useRealTimers(); });

  test('el límite de caché de reportes no expulsa fuentes pendientes al reintentar', async () => {
    const finish = [];
    getFinancialStatistics.mockImplementation(() => new Promise(resolve => finish.push(resolve)));
    const requests = [1, 2, 3, 4].map(day => getReport(`2026-04-0${day}`, `2026-04-0${day}`));
    requests.push(getReport('2026-04-01', '2026-04-01'));
    expect(getFinancialStatistics).toHaveBeenCalledTimes(4);
    expect(getClinicalStatistics).toHaveBeenCalledTimes(4);
    finish.forEach(resolve => resolve(fixture().financial));
    await Promise.all(requests);
  });

  test('agregar el histórico tampoco expulsa reportes pendientes', async () => {
    const finish = [];
    getFinancialStatistics.mockImplementation(() => new Promise(resolve => finish.push(resolve)));
    const requests = [1, 2, 3, 4, 5].map(day => getReport(`2026-04-0${day}`, `2026-04-0${day}`));
    requests.push(getHistory('01_VIDAS SALVADAS'));
    requests.push(getReport('2026-04-01', '2026-04-01'));
    expect(getFinancialStatistics).toHaveBeenCalledTimes(6);
    expect(getClinicalStatistics).toHaveBeenCalledTimes(5);
    finish.forEach(resolve => resolve(fixture().financial));
    await Promise.all(requests);
  });
});

module.exports = { fixture, range };
