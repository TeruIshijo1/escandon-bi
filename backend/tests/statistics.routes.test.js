'use strict';
const request = require('supertest');
const express = require('express');
jest.mock('../services/statisticsCommon', () => ({ ...jest.requireActual('../services/statisticsCommon'), hospitalToday: () => '2026-10-07' }));
jest.mock('../middleware/auth.middleware', () => ({
  authenticate: (req, _res, next) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); },
  authorizeCapability: () => (_req, _res, next) => next()
}));
jest.mock('../services/statistics.service', () => ({ getReport: jest.fn(), getHistory: jest.fn(), dashboardData: jest.fn() }));
jest.mock('../services/statisticsWorkbook.service', () => ({ createStatisticsWorkbook: jest.fn() }));
const service = require('../services/statistics.service');
const workbook = require('../services/statisticsWorkbook.service');
const app = express();
app.use(require('../routes/statistics.routes'));
const allowed = { 'x-test-user': JSON.stringify({ role: 'USUARIO_OPERATIVO', permisos: ['estadisticas'] }) };
beforeEach(() => {
  jest.clearAllMocks();
  service.getReport.mockResolvedValue({ sections: {} });
  service.dashboardData.mockReturnValue({ general: {} });
  workbook.createStatisticsWorkbook.mockResolvedValue(Buffer.from('xlsx-test'));
});

test('todas las rutas requieren permiso específico, incluso para administradores', async () => {
  const headers = { 'x-test-user': JSON.stringify({ role: 'ADMIN', permisos: ['otra-area'] }) };
  for (const route of ['/stats', '/stats-historico', '/stats-detalle', '/stats-export']) expect((await request(app).get(route).set(headers)).status).toBe(403);
  expect(service.getReport).not.toHaveBeenCalled();
});

test('export valida fechas antes de consultar y no ofrece detalle inventado del histórico', async () => {
  for (const query of ['startDate=2026-09-31&endDate=2026-10-01', 'startDate=2026-03-01&endDate=2026-03-31', 'startDate=2026-09-30&endDate=2026-09-01']) {
    expect((await request(app).get(`/stats-export?${query}`).set(allowed)).status).toBe(400);
  }
  expect(service.getReport).not.toHaveBeenCalled();
});

test('export devuelve libro completo con nombre de fechas inclusivas', async () => {
  const res = await request(app).get('/stats-export?startDate=2026-09-01&endDate=2026-09-30').set(allowed);
  expect(res.status).toBe(200);
  expect(res.headers['content-disposition']).toContain('Estadistico_2026-09-01_2026-09-30.xlsx');
  expect(res.headers['cache-control']).toBe('no-store');
  expect(service.getReport).toHaveBeenCalledWith('2026-09-01', '2026-09-30');
});

test('fallo de fuente da error visible sin publicar cero ni filtrar datos técnicos', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  service.getReport.mockRejectedValue(new Error('SQL password=secreto tabla_privada'));
  const res = await request(app).get('/stats?startDate=2026-09-01&endDate=2026-09-30').set(allowed);
  expect(res.status).toBe(503);
  expect(res.body.ok).toBe(false);
  expect(JSON.stringify(res.body)).not.toMatch(/secreto|tabla_privada/);
  expect(workbook.createStatisticsWorkbook).not.toHaveBeenCalled();
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/secreto|tabla_privada/);
  log.mockRestore();
});

test('export informa la espera agotada sin entregar un libro incompleto', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  service.getReport.mockRejectedValue(Object.assign(new Error('detalle privado'), { code: 'SAP_READ_TIMEOUT' }));
  const res = await request(app).get('/stats-export?startDate=2026-09-01&endDate=2026-09-30').set(allowed);
  expect(res.status).toBe(503);
  expect(res.body.error).toMatch(/SAP tardó más/);
  expect(res.headers['content-disposition']).toBeUndefined();
  expect(workbook.createStatisticsWorkbook).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledWith('[statistics] Consulta incompleta', { route: '/stats-export', code: 'SAP_READ_TIMEOUT' });
  log.mockRestore();
});

test('detalle del mes en curso comparte el corte del histórico y rechaza el futuro', async () => {
  service.getReport.mockResolvedValue({ sections: { hospital: { rows: [], quantity: 0, unit: 'cuentas' } } });
  const section = encodeURIComponent('03_CUENTAS HOSPITALARIAS (HOSPITALIZACIÓN)');
  const res = await request(app).get(`/stats-detalle?seccion=${section}&year=2026&mes=10`).set(allowed);
  expect(res.status).toBe(200);
  expect(service.getReport).toHaveBeenCalledWith('2026-10-01', '2026-10-07');
  expect(res.body.period.endDate).toBe('2026-10-07');
  expect((await request(app).get(`/stats-detalle?seccion=${section}&year=2026&mes=11`).set(allowed)).status).toBe(400);
  expect((await request(app).get('/stats-export?startDate=2026-10-01&endDate=2026-10-31').set(allowed)).status).toBe(400);
});
