

'use strict';

const jwt = require('jsonwebtoken');

const JWT_SECRET  = process.env.JWT_SECRET;
const JWT_REFRESH = process.env.JWT_REFRESH;

if (!JWT_SECRET || !JWT_REFRESH) {
  throw new Error('JWT_SECRET and JWT_REFRESH must be set in environment variables.');
}

/* Roles válidos del sistema */
const VALID_ROLES = new Set([
  'ADMIN',
  'DIRECTOR',
  'JEFE_AREA',
  'USUARIO_OPERATIVO',
  'ALMACEN_GENERAL',
  'CONSULTA_EXTERNA',
]);

/* Áreas válidas del hospital */
const VALID_AREAS = new Set([
  'QUIROFANO', 'IMAGENOLOGIA', 'URGENCIAS', 'CUNEROS',
  'UCI', 'CONSULTA_EXTERNA', 'CARDIOLOGIA', 'LABORATORIO',
  'HOSPITALIZACION', 'FARMACIA', 'FINANZAS', 'ASEGURADORAS',
  'ALMACEN_GENERAL',
]);

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else if (req.query && req.query.token) {
      token = req.query.token;
    }

    if (!token || token === 'null' || token === 'undefined') {
      return res.status(401).json({
        error: 'Token de autenticación no proporcionado',
        code:  'NO_TOKEN',
      });
    }

    // Verificar y decodificar
    const decoded = jwt.verify(token, JWT_SECRET);

    // Validaciones adicionales del payload
    if (!decoded.sub || !decoded.role) {
      return res.status(401).json({ error: 'Token malformado', code: 'MALFORMED_TOKEN' });
    }

    if (!VALID_ROLES.has(decoded.role)) {
      return res.status(403).json({ error: 'Rol no reconocido', code: 'INVALID_ROLE' });
    }

    // Adjuntar usuario al request para middlewares y controllers
    req.user = {
      id:       decoded.sub,
      username: decoded.username,
      nombre:   decoded.nombre,
      role:     decoded.role,
      area:     decoded.area   || null,
      permisos: decoded.permisos || [],
      iat:      decoded.iat,
      exp:      decoded.exp,
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Sesión expirada. Por favor inicie sesión nuevamente.',
        code:  'TOKEN_EXPIRED',
      });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Token inválido',
        code:  'INVALID_TOKEN',
      });
    }
    next(err);
  }
}

function authorize(allowedRoles = []) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'No autenticado', code: 'NOT_AUTHENTICATED' });
    }

    const { role, id, username, permisos } = req.user;

    if (username && username.toLowerCase() === 'amendoza') {
      return next();
    }

    if (allowedRoles.includes(role)) {
      return next();
    }

    // NUEVA REGLA (Quitar tipo de perfil para permisos explícitos)

    if (permisos && permisos.length > 0) {
      return next();
    }

    // Log del intento denegado
    console.warn(`[RBAC] Acceso denegado — Usuario: ${username} (${id}), Rol: ${role}, Ruta: ${req.method} ${req.path}, Roles requeridos: ${allowedRoles.join(',')}`);

    return res.status(403).json({
      error: `Acceso no autorizado. Se requiere autorización explícita de amendoza.`,
      code:  'INSUFFICIENT_ROLE',
    });
  };
}

function authorizeArea(allowedRolesForAll = ['ADMIN', 'DIRECTOR']) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'No autenticado', code: 'NOT_AUTHENTICATED' });
    }

    const { role, username, area: userArea } = req.user;

    // REGLA MAESTRA: amendoza pasa incondicionalmente sin restricción de área
    if (username && username.toLowerCase() === 'amendoza') return next();

    // Roles globales: sin restricción de área
    if (allowedRolesForAll.includes(role)) return next();

    const requestedArea =
      req.params.area  ||
      req.query.area   ||
      req.body?.area   ||
      null;

    if (!requestedArea) {
       
      req.areaFilter = userArea;
      return next();
    }

    if (!VALID_AREAS.has(requestedArea)) {
      return res.status(400).json({ error: 'Área no válida', code: 'INVALID_AREA', area: requestedArea });
    }

    if (requestedArea !== userArea) {
      return res.status(403).json({
        error:           'No tiene permisos para acceder a datos de esta área',
        code:            'AREA_MISMATCH',
        yourArea:        userArea,
        requestedArea,
      });
    }

    req.areaFilter = userArea;
    next();
  };
}

function authorizeCapability(capability) {
  const ROLE_CAPABILITIES = {
    ADMIN:            ['exportarPDF','exportarExcel','gestionarUsuarios','verAuditoria','verLogAuditoria','verMacropanelFinanciero','usarAsistenteIA', 'verCEX', 'gestionCEX'],
    DIRECTOR:         ['exportarPDF','exportarExcel','verAuditoria','verMacropanelFinanciero','usarAsistenteIA', 'verCEX'],
    JEFE_AREA:        ['exportarPDF','exportarExcel','usarAsistenteIA'],
    USUARIO_OPERATIVO:['exportarExcel'],
    ALMACEN_GENERAL:  ['exportarExcel'],
    CONSULTA_EXTERNA: ['exportarExcel','verCEX','gestionCEX'],
  };

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'No autenticado' });
    }

    const caps = [...(ROLE_CAPABILITIES[req.user.role] || [])];
    
    // Inyectar capacidades específicas de área o permisos asignados manualmente
    if (
      req.user.area === 'CONSULTA_EXTERNA' || 
      req.user.permisos.includes('consulta-externa') || 
      req.user.permisos.includes('area-consulta-externa')
    ) {
      caps.push('verCEX', 'gestionCEX');
    }

    if (!caps.includes(capability)) {
      return res.status(403).json({
        error:       `No tiene permiso para: ${capability}`,
        code:        'CAPABILITY_DENIED',
        capability,
      });
    }

    next();
  };
}

function generateTokens(user) {
  const payload = {
    sub:      user.id,
    username: user.username,
    nombre:   user.nombre,
    role:     user.role,
    area:     user.area || null,
    permisos: user.permisos || [],
  };

  const accessToken = jwt.sign(payload, JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRY || '8h',
    issuer:    'hospital-escandon-bi',
    audience:  'escandon-platform',
  });

  const refreshToken = jwt.sign(
    { sub: user.id, type: 'refresh' },
    JWT_REFRESH,
    { expiresIn: '7d' }
  );

  return { accessToken, refreshToken };
}

module.exports = {
  authenticate,
  authorize,
  authorizeArea,
  authorizeCapability,
  generateTokens,
};
