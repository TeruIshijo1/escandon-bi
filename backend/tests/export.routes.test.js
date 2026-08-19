/**
 * export.routes.test.js — Tests del endpoint convert-json (SSRF + happy path)
 * Se monta solo el router para aislar del audit/rate-limit globales.
 */
'use strict';

jest.mock('../middleware/auth.middleware', () => ({
  authenticate: (req, res, next) => { req.user = { id: 1, username: 'test', role: 'ADMIN' }; next(); },
  authorize: () => (req, res, next) => next(),
  authorizeArea: () => (req, res, next) => next(),
  authorizeCapability: () => (req, res, next) => next(),
  generateTokens: () => ({ accessToken: 'x', refreshToken: 'y' }),
}));

const express = require('express');
const request = require('supertest');
const exportRoutes = require('../routes/export.routes');

const app = express();
app.use(express.json());
app.use('/api/export', exportRoutes);

describe('POST /api/export/convert-json', () => {
  test('400 si falta la URL', async () => {
    const res = await request(app).post('/api/export/convert-json').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/URL es requerida/i);
  });

  test('400 si la URL apunta a red interna (SSRF bloqueado)', async () => {
    const res = await request(app).post('/api/export/convert-json').send({ url: 'http://169.254.169.254/latest/meta-data/' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/red interna/i);
  });

  test('400 si la URL es localhost', async () => {
    const res = await request(app).post('/api/export/convert-json').send({ url: 'http://localhost:4000/api/secretos' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/red interna/i);
  });

  test('400 si la URL tiene protocolo no permitido', async () => {
    const res = await request(app).post('/api/export/convert-json').send({ url: 'file:///etc/passwd' });
    expect(res.status).toBe(400);
  });

  test('200 y devuelve xlsx desde una API externa', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ nombre: 'A', valor: 1 }, { nombre: 'B', valor: 2 }],
    });

    const res = await request(app).post('/api/export/convert-json').send({ url: 'https://www.google.com/datos' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml|octet-stream/);
    expect(res.headers['content-disposition']).toMatch(/api_extract_.*\.xlsx/);
    const bodyLen = Buffer.isBuffer(res.body) ? res.body.length : (typeof res.text === 'string' ? res.text.length : 0);
    expect(bodyLen).toBeGreaterThan(0); // binario xlsx

    global.fetch.mockRestore();
  });

  test('500 si la API externa falla', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });

    const res = await request(app).post('/api/export/convert-json').send({ url: 'https://www.google.com/rota' });
    expect(res.status).toBe(500);

    global.fetch.mockRestore();
  });
});