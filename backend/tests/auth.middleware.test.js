/**
 * auth.middleware.test.js — Tests unitarios del middleware de autenticación/RBAC
 */
'use strict';

const jwt = require('jsonwebtoken');

const {
  authenticate,
  authorize,
  authorizeArea,
  generateTokens,
} = require('../middleware/auth.middleware');

const JWT_SECRET = process.env.JWT_SECRET;

function mockReqRes(token) {
  const req = {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    query: {},
    params: {},
    body: {},
    user: null,
    path: '/api/test',
    method: 'GET',
  };
  const res = { statusCode: 200 };
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  const next = jest.fn();
  return { req, res, next };
}

describe('generateTokens', () => {
  test('genera accessToken y refreshToken con payload correcto', () => {
    const { accessToken, refreshToken } = generateTokens({
      id: 1,
      username: 'usuario1',
      nombre: 'Usuario Uno',
      role: 'ADMIN',
      area: null,
      permisos: ['r1'],
    });

    expect(accessToken).toBeTruthy();
    expect(refreshToken).toBeTruthy();

    const decoded = jwt.verify(accessToken, JWT_SECRET);
    expect(decoded.sub).toBe(1);
    expect(decoded.role).toBe('ADMIN');
    expect(decoded.username).toBe('usuario1');
    expect(decoded.iss).toBe('hospital-escandon-bi');
  });
});

describe('authenticate', () => {
  test('401 NO_TOKEN si no hay header', async () => {
    const { req, res, next } = mockReqRes(null);
    await authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'NO_TOKEN' }));
    expect(next).not.toHaveBeenCalled();
  });

  test('401 NO_TOKEN si el token es literal "null" o "undefined"', async () => {
    for (const bad of ['null', 'undefined']) {
      const { req, res, next } = mockReqRes(null);
      req.headers.authorization = `Bearer ${bad}`;
      await authenticate(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    }
  });

  test('401 INVALID_TOKEN si el token no es válido', async () => {
    const { req, res, next } = mockReqRes('token-invalido');
    await authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_TOKEN' }));
  });

  test('401 TOKEN_EXPIRED si el token está expirado', async () => {
    const expired = jwt.sign({ sub: 1, role: 'ADMIN' }, JWT_SECRET, { expiresIn: '-10s' });
    const { req, res, next } = mockReqRes(expired);
    await authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_EXPIRED' }));
  });

  test('401 MALFORMED_TOKEN si falta sub o role en el payload', async () => {
    const noRole = jwt.sign({ sub: 1 }, JWT_SECRET, { expiresIn: '1h' });
    const { req, res, next } = mockReqRes(noRole);
    await authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'MALFORMED_TOKEN' }));
  });

  test('403 INVALID_ROLE si el rol no es reconocido', async () => {
    const badRole = jwt.sign({ sub: 1, role: 'SUPER_PODEROSO' }, JWT_SECRET, { expiresIn: '1h' });
    const { req, res, next } = mockReqRes(badRole);
    await authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_ROLE' }));
  });

  test('llama next() y adjunta req.user con token válido', async () => {
    const token = jwt.sign(
      { sub: 7, role: 'JEFE_AREA', username: 'jefa', nombre: 'Jefa', area: 'UCI', permisos: [] },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    const { req, res, next } = mockReqRes(token);
    await authenticate(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toMatchObject({ id: 7, role: 'JEFE_AREA', area: 'UCI' });
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('authorize', () => {
  const baseUser = { id: 1, username: 'x', role: 'ADMIN' };

  test('401 si no hay req.user', () => {
    const { req, res, next } = mockReqRes(null);
    authorize(['ADMIN'])(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('403 INSUFFICIENT_ROLE si el rol no está permitido', () => {
    const { req, res, next } = mockReqRes(null);
    req.user = { ...baseUser, role: 'USUARIO_OPERATIVO' };
    authorize(['ADMIN', 'DIRECTOR'])(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INSUFFICIENT_ROLE' }));
  });

  test('llama next() si el rol está permitido', () => {
    const { req, res, next } = mockReqRes(null);
    req.user = { ...baseUser, role: 'DIRECTOR' };
    authorize(['ADMIN', 'DIRECTOR'])(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('amendoza (admin global) pasa incondicionalmente', () => {
    const { req, res, next } = mockReqRes(null);
    req.user = { ...baseUser, username: 'amendoza', role: 'USUARIO_OPERATIVO' };
    authorize(['ADMIN'])(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

describe('authorizeArea', () => {
  const baseUser = { id: 2, username: 'jefe', role: 'JEFE_AREA' };

  test('ADMIN pasa sin restricción de área', () => {
    const { req, res, next } = mockReqRes(null);
    req.user = { ...baseUser, role: 'ADMIN' };
    authorizeArea()(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('403 si el área del usuario no coincide con la solicitada', () => {
    const { req, res, next } = mockReqRes(null);
    req.user = { ...baseUser, area: 'UCI' };
    req.query = { area: 'QUIROFANO' };
    authorizeArea()(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('aplica areaFilter si el usuario no envía área', () => {
    const { req, res, next } = mockReqRes(null);
    req.user = { ...baseUser, area: 'FARMACIA' };
    req.query = {};
    authorizeArea()(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.areaFilter).toBe('FARMACIA');
  });
});