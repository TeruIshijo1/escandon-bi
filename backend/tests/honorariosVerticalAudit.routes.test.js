'use strict';
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
jest.mock('../config/remote-db', () => ({ connectRemoteDB: jest.fn().mockResolvedValue({}) }));
jest.mock('../services/honorariosVerticalAudit.service', () => ({
  validateFilters: jest.fn(), readAudit: jest.fn(), readOptions: jest.fn(), readExport: jest.fn(), writeExcel: jest.fn()
}));
const service = require('../services/honorariosVerticalAudit.service');
const db = require('../config/remote-db');
const app = express(); app.use('/api/honorarios', require('../routes/honorarios.routes'));
const auth = user => ({ Authorization: `Bearer ${jwt.sign({ sub: 42, username: 'staff', role: 'ADMIN', permisos: [], ...user }, process.env.JWT_SECRET)}` });
const query = '?startDate=2026-09-01&endDate=2026-09-30';
beforeEach(() => {
  jest.clearAllMocks();
  service.validateFilters.mockReset();
  service.readAudit.mockResolvedValue({ rows: [], summary: { total: 0 } });
  service.readOptions.mockResolvedValue({ doctors: ['MÉDICO PRUEBA'], groups: ['CONSULTA'], sources: [{ value: 'CITA', label: 'Cita médica' }] });
  service.readExport.mockResolvedValue({ filters: { startDate: '2026-09-01', endDate: '2026-09-30' }, rows: [] });
  service.writeExcel.mockImplementation(async res => res.end('excel-prueba'));
});
test('consultation, filter lists and Excel require the exact existing Honorarios permission', async () => {
  for (const path of ['/vertical-audit', '/vertical-audit/options', '/vertical-audit/excel']) {
    expect((await request(app).get('/api/honorarios' + path + query)).status).toBe(401);
    for (const permisos of [[], ['estadisticas'], ['auditoria-cargos']])
      expect((await request(app).get('/api/honorarios' + path + query).set(auth({ permisos }))).status).toBe(403);
  }
  expect(db.connectRemoteDB).not.toHaveBeenCalled();
});
test('authorized operational staff and the existing superadministrator can consult and download', async () => {
  for (const user of [{ role: 'USUARIO_OPERATIVO', permisos: ['interconsultas-jornadas'] }, { username: 'AMendoza' }]) {
    const result = await request(app).get('/api/honorarios/vertical-audit' + query).set(auth(user));
    expect(result.status).toBe(200); expect(result.headers['cache-control']).toBe('no-store');
    const lists = await request(app).get('/api/honorarios/vertical-audit/options' + query).set(auth(user));
    expect(lists.status).toBe(200); expect(lists.headers['cache-control']).toBe('no-store');
    expect(lists.body).toEqual({ ok: true, options: { doctors: ['MÉDICO PRUEBA'], groups: ['CONSULTA'], sources: [{ value: 'CITA', label: 'Cita médica' }] } });
    const excel = await request(app).get('/api/honorarios/vertical-audit/excel' + query).set(auth(user));
    expect(excel.status).toBe(200);
    expect(excel.headers['content-disposition']).toContain('.xlsx');
    expect(excel.headers['cache-control']).toBe('no-store');
  }
});
test('invalid filters cannot open a database connection and connection errors stay friendly', async () => {
  const silent = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const headers = auth({ permisos: ['interconsultas-jornadas'] });
    for (const path of ['/vertical-audit', '/vertical-audit/options', '/vertical-audit/excel']) {
      service.validateFilters.mockImplementationOnce(() => { throw Object.assign(new Error('Elige fechas válidas.'), { status: 400 }); });
      const invalid = await request(app).get('/api/honorarios' + path + query).set(headers);
      expect(invalid.status).toBe(400); expect(invalid.body.error).toBe('Elige fechas válidas.');
    }
    expect(db.connectRemoteDB).not.toHaveBeenCalled();
    service.readAudit.mockRejectedValueOnce(new Error('SQL Server private internals'));
    const failure = await request(app).get('/api/honorarios/vertical-audit' + query).set(headers);
    expect(failure.status).toBe(503); expect(failure.body.error).not.toMatch(/SQL|private/);
    service.readOptions.mockRejectedValueOnce(new Error('SQL Server private internals'));
    const listsFailure = await request(app).get('/api/honorarios/vertical-audit/options' + query).set(headers);
    expect(listsFailure.status).toBe(503); expect(listsFailure.body.error).not.toMatch(/SQL|private/);
    expect(listsFailure.body.error).toContain('listas de médicos, grupos y orígenes');
  } finally { silent.mockRestore(); }
});
