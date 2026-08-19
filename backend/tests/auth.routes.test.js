/**
 * auth.routes.test.js — Tests de integración del flujo de autenticación
 * Usa la app completa de server.js con la BD mockeada.
 */
'use strict';

const jwt = require('jsonwebtoken');

// Mockear la BD ANTES de requerir la app (server.js, auth.routes y audit usan config/db)
jest.mock('../config/db', () => {
  const mockUser = {
    UsuarioId: 1,
    Username: 'jefatura',
    NombreCompleto: 'Jefatura de Área',
    // bcrypt hash de 'Contrasena123' (cost 4, generado con bcryptjs)
    PasswordHash: '$2a$04$3yGQL2XTwYOgvEjS9T6hWOU7yRlKH5GM5r2AkU55cubBggxsc.1QS',
    Activo: 1,
    Rol: 'JEFE_AREA',
    AreaAsignada: 'UCI',
    ReportesPermitidos: '["r1","r2"]',
  };

  const runMock = jest.fn().mockResolvedValue({ changes: 1 });
  const getMock = jest.fn().mockResolvedValue(undefined);
  const prepareMock = jest.fn(() => ({ get: getMock, run: runMock, all: jest.fn().mockResolvedValue([]) }));

  return {
    getDb: () => ({ prepare: prepareMock, query: jest.fn().mockResolvedValue([]) }),
    connectDB: jest.fn().mockResolvedValue(true),
    closeDB: jest.fn(),
    __mocks: { mockUser, getMock, runMock, prepareMock },
  };
});

jest.mock('../config/pg-db', () => ({
  pool: { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
  initPostgresDW: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const app = require('../server');
const { __mocks } = require('../config/db');

const TOKEN = jwt.sign(
  { sub: 1, username: 'jefatura', nombre: 'Jefatura de Área', role: 'JEFE_AREA', area: 'UCI', permisos: ['r1'] },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);

beforeEach(() => {
  jest.clearAllMocks();
  __mocks.getMock.mockResolvedValue(undefined);
});

describe('POST /api/auth/login', () => {
  test('400 si faltan credenciales', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/requeridos/i);
  });

  test('401 si el usuario no existe', async () => {
    __mocks.getMock.mockResolvedValue(undefined);
    const res = await request(app).post('/api/auth/login').send({ username: 'fantasma', password: 'x' });
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/no existe/i);
  });

  test('401 si la contraseña es incorrecta', async () => {
    __mocks.getMock.mockResolvedValue(__mocks.mockUser);
    const res = await request(app).post('/api/auth/login').send({ username: 'jefatura', password: 'mala' });
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Credenciales incorrectas/i);
  });

  test('200 y devuelve token + usuario con credenciales válidas', async () => {
    __mocks.getMock.mockResolvedValue(__mocks.mockUser);
    const res = await request(app).post('/api/auth/login').send({ username: 'jefatura', password: 'Contrasena123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.user).toMatchObject({ username: 'jefatura', role: 'JEFE_AREA', area: 'UCI' });

    // El login debe registrar UltimoAcceso
    expect(__mocks.runMock).toHaveBeenCalled();
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded.sub).toBe(1);
  });
});

describe('GET /api/auth/me', () => {
  test('401 sin token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('200 con token válido devuelve el usuario', async () => {
    __mocks.getMock.mockResolvedValue(__mocks.mockUser);
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('jefatura');
  });

  test('401 con token inválido', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer token-basura');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  test('200 y limpia el refresh token', async () => {
    const res = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('401 sin token', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(401);
  });
});