/**
 * auth.routes.js — Autenticación
 * Hospital Escandón BI Platform v1.0
 */
'use strict';

const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const { getDb }          = require('../config/db');
const { authenticate, generateTokens } = require('../middleware/auth.middleware');

/**
 * POST /api/auth/login
 * Autentica usuario y devuelve JWT
 */
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'Usuario y contraseña requeridos', error: 'Usuario y contraseña requeridos' });
    }

    const db   = getDb();
    const user = await db.prepare(`
      SELECT
        u.UsuarioId,
        u.Username,
        u.NombreCompleto,
        u.PasswordHash,
        u.Activo,
        r.NombreRol  AS Rol,
        u.AreaAsignada,
        u.ReportesPermitidos
      FROM Usuarios u
      JOIN Roles r ON r.RolId = u.RolId
      WHERE LOWER(u.Username) = LOWER(?)
        AND u.Activo = 1
    `).get(username.trim().toLowerCase());

    if (!user) {
      // Mensaje específico solicitado por el cliente
      return res.status(401).json({ message: 'el usuario no existe, si hay un error comunicarse al departamento de TI' });
    }

    const passwordOk = await bcrypt.compare(password, user.PasswordHash);
    if (!passwordOk) {
      return res.status(401).json({ message: 'Credenciales incorrectas' });
    }

    // Registrar último acceso
    await db.prepare(`UPDATE Usuarios SET UltimoAcceso = CURRENT_TIMESTAMP, UltimaIP = ? WHERE UsuarioId = ?`)
      .run(req.ip, user.UsuarioId);

    const { accessToken, refreshToken } = generateTokens({
      id:       user.UsuarioId,
      username: user.Username,
      nombre:   user.NombreCompleto,
      role:     user.Rol,
      area:     user.AreaAsignada,
      permisos: JSON.parse(user.ReportesPermitidos || '[]')
    });

    res.json({
      token:        accessToken,
      refreshToken,
      user: {
        id:       user.UsuarioId,
        username: user.Username,
        nombre:   user.NombreCompleto,
        role:     user.Rol,
        area:     user.AreaAsignada,
        permisos: JSON.parse(user.ReportesPermitidos || '[]')
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/me
 * Devuelve datos del usuario autenticado (valida token)
 */
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const db = getDb();
    const u  = await db.prepare(`
      SELECT u.UsuarioId, u.Username, u.NombreCompleto, r.NombreRol AS Rol, u.AreaAsignada, u.ReportesPermitidos
      FROM Usuarios u JOIN Roles r ON r.RolId = u.RolId
      WHERE u.UsuarioId = ? AND u.Activo = 1
    `).get(req.user.id);

    if (!u) return res.status(401).json({ error: 'Usuario no encontrado o inactivo' });

    res.json({
      user: {
        id:       u.UsuarioId,
        username: u.Username,
        nombre:   u.NombreCompleto,
        role:     u.Rol,
        area:     u.AreaAsignada,
        permisos: JSON.parse(u.ReportesPermitidos || '[]')
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/logout
 * Invalida el refresh token (blacklist en BD)
 */
router.post('/logout', authenticate, async (req, res) => {
  try {
    const db = getDb();
    await db.prepare(`UPDATE Usuarios SET RefreshToken = NULL WHERE UsuarioId = ?`).run(req.user.id);
    res.json({ ok: true, message: 'Sesión cerrada correctamente' });
  } catch (err) {
    res.json({ ok: true }); // Logout siempre exitoso para el cliente
  }
});

module.exports = router;
