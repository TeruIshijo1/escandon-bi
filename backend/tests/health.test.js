/**
 * health.test.js — Smoke tests de endpoints de salud
 * La BD se mockea para que los endpoints no toquen PostgreSQL real.
 */
'use strict';

jest.mock('../config/db', () => ({
  getDb: () => ({ prepare: () => ({ get: jest.fn().mockResolvedValue(undefined), run: jest.fn().mockResolvedValue({ changes: 0 }), all: jest.fn().mockResolvedValue([]) }), query: jest.fn().mockResolvedValue([]) }),
  connectDB: jest.fn().mockResolvedValue(true),
  closeDB: jest.fn(),
}));

jest.mock('../config/pg-db', () => ({
  pool: { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
  initPostgresDW: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const app = require('../server');

describe('Health checks', () => {
  test('GET /api/ping responde pong', async () => {
    const res = await request(app).get('/api/ping');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.message).toBe('pong');
  });

  test('GET /health devuelve estado del servidor', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('db');
    expect(res.body).toHaveProperty('timestamp');
    expect(new Date(res.body.timestamp).toString()).not.toBe('Invalid Date');
  });
});