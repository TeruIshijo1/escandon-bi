'use strict';

const express = require('express');
const request = require('supertest');
const { publicMessages, formatNotices } = require('../middleware/publicMessages.middleware');

test('route errors and warnings do not expose technical internals', async () => {
  const app = express();
  app.use(publicMessages);
  app.get('/failure', (_req, res) => res.status(500).json({
    error: 'relation "bi_honorarios_catalog" does not exist', stack: 'private stack',
  }));
  app.get('/catalog', (_req, res) => res.json({ items: [{ itemCode: 'SER1471', referenceWarnings: ['Sin referencia en UT_Honorarios'] }] }));
  const failure = await request(app).get('/failure');
  expect(failure.status).toBe(500);
  expect(failure.body.error).toContain('Intenta de nuevo');
  expect(failure.body).not.toHaveProperty('stack');
  const catalog = await request(app).get('/catalog');
  expect(catalog.body.items[0].itemCode).toBe('SER1471');
  expect(catalog.body.items[0].referenceWarnings[0]).toContain('precio de referencia');
});

test('business data, dates and recorded reasons are preserved', () => {
  const body = { amount: 250, date: new Date('2026-10-01T12:00:00Z'), file: Buffer.from('data'),
    reason: 'Revisar UT_Honorarios con soporte', snapshot: { providerId: 7, status: 'INCLUIDO' } };
  expect(JSON.stringify(formatNotices(body, 200))).toBe(JSON.stringify(body));
});

test('useful validation and login messages are preserved', () => {
  const error = 'Ya hay una tarifa para este médico en esas fechas. Ajusta las fechas.';
  expect(formatNotices({ error }, 409).error).toBe(error);
  const login = 'El usuario o la contraseña son incorrectos. Revisa tus datos e intenta de nuevo.';
  expect(formatNotices({ message: login }, 401).message).toBe(login);
  expect(formatNotices({ error: 'Token expirado' }, 401).error).toContain('Inicia sesión de nuevo');
});
