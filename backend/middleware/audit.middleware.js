/**
 * audit.middleware.js
 * Registra acciones sensibles en la tabla AuditLog
 * Hospital Escandón BI Platform v1.0
 */
'use strict';

const { getDb } = require('../config/db');

/* Métodos que deben registrarse */
const AUDIT_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']);

/* Rutas que siempre se auditan */
const ALWAYS_AUDIT = [
  '/api/audit/',
  '/api/admin/',
  '/api/export/',
  '/api/auth/login',
  '/api/dashboard/',
  '/api/bi/',
];

async function auditMiddleware(req, res, next) {
  const start    = Date.now();

  const method   = req.method;
  const path     = req.path;

  const shouldAudit =
    AUDIT_METHODS.has(method) ||
    ALWAYS_AUDIT.some(p => path.startsWith(p));

  if (!shouldAudit) return next();

  // Capturar respuesta
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    const duration = Date.now() - start;
    const user     = req.user; // disponible si authenticate corrió antes

    // Insertar log asíncronamente (no bloquea la respuesta)
    logAction({
      userId:   user?.id   || null,
      username: user?.username || 'anonymous',
      role:     user?.role || 'N/A',
      method,
      path,
      status:   res.statusCode,
      duration,
      ip:       req.ip || req.connection?.remoteAddress,
      body:     AUDIT_METHODS.has(method) ? sanitizeBody(req.body) : null,
    }).catch(err => console.error('[AuditLog]', err.message));

    return originalJson(body);
  };

  next();
}

async function logAction(entry) {
  try {
    const db = getDb();
    if (!db) return; // BD no disponible (tests)

    db.prepare(`
      INSERT INTO AuditLog
        (UsuarioId, Username, Rol, Metodo, Ruta, EstadoHTTP, DuracionMs, IP, CuerpoRequest, FechaHora)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
    `).run(
      entry.userId,
      entry.username,
      entry.role,
      entry.method,
      entry.path,
      entry.status,
      entry.duration,
      entry.ip,
      entry.body ? JSON.stringify(entry.body) : null
    );
  } catch (err) {
    // No fallar el request por un error de log
    console.error('[AuditLog] Error al registrar:', err.message);
  }
}

/* Elimina campos sensibles del body antes de loguear */
function sanitizeBody(body) {
  if (!body || typeof body !== 'object') return null;
  const safe = { ...body };
  for (const key of ['password', 'contrasena', 'token', 'secret', 'pin']) {
    if (key in safe) safe[key] = '***';
  }
  return safe;
}

module.exports = { auditMiddleware };
