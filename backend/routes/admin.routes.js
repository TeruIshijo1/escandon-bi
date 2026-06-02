/**
 * admin.routes.js — Gestión de Usuarios (solo ADMIN)
 * Hospital Escandón BI Platform v1.0
 *
 * Solo el rol ADMIN puede crear, editar, desactivar usuarios
 * y asignar roles/permisos.
 */
'use strict';

const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const { getDb } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');

// Configuración de Multer con subcarpetas
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let subfolder = '';
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (ext === '.pbix') subfolder = 'pbix';
    else if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') subfolder = 'excel';
    else if (['.jpg', '.jpeg', '.png', '.webp', '.svg'].includes(ext)) subfolder = 'thumbnails';
    
    const dir = path.join(__dirname, '..', 'uploads', subfolder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // Límite de 100MB para PBIX pesados
});

/* ── Todas las rutas requieren ADMIN ──────────────────────── */
router.use(authenticate, authorize(['ADMIN']));

/**
 * GET /api/admin/usuarios
 * Lista todos los usuarios con su rol
 */
router.get('/usuarios', (req, res, next) => {
  try {
    const db = getDb();
    const usuarios = db.prepare(`
      SELECT
        u.UsuarioId   AS id,
        u.Username    AS username,
        u.NombreCompleto AS nombre,
        u.Email       AS email,
        r.NombreRol   AS rol,
        u.AreaAsignada AS area,
        u.Activo      AS activo,
        u.UltimoAcceso AS ultimoAcceso,
        u.FechaCreacion AS fechaCreacion,
        u.ReportesPermitidos AS permisos
      FROM Usuarios u
      JOIN Roles r ON r.RolId = u.RolId
      ORDER BY u.UsuarioId
    `).all();

    const data = usuarios.map(u => ({
      ...u,
      permisos: JSON.parse(u.permisos || '[]')
    }));

    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/usuarios/:id
 * Detalle de un usuario
 */
router.get('/usuarios/:id', (req, res, next) => {
  try {
    const db = getDb();
    const u = db.prepare(`
      SELECT
        u.UsuarioId   AS id,
        u.Username    AS username,
        u.NombreCompleto AS nombre,
        u.Email       AS email,
        r.NombreRol   AS rol,
        r.RolId       AS rolId,
        u.AreaAsignada AS area,
        u.Activo      AS activo,
        u.UltimoAcceso AS ultimoAcceso,
        u.UltimaIP    AS ultimaIP,
        u.FechaCreacion AS fechaCreacion
      FROM Usuarios u
      JOIN Roles r ON r.RolId = u.RolId
      WHERE u.UsuarioId = ?
    `).get(req.params.id);

    if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ ok: true, data: u });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/admin/usuarios/:id/permisos
 * Actualiza los reportes/tableros específicos a los que tiene acceso el usuario
 */
router.put('/usuarios/:id/permisos', (req, res, next) => {
  try {
    const { permisos } = req.body;
    const db = getDb();

    db.prepare('UPDATE Usuarios SET ReportesPermitidos = ? WHERE UsuarioId = ?')
      .run(JSON.stringify(permisos || []), req.params.id);

    res.json({ ok: true, message: 'Permisos actualizados correctamente' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/usuarios
 * Crear nuevo usuario
 * Body: { username, nombre, email, password, rolId, area? }
 */
router.post('/usuarios', async (req, res, next) => {
  try {
    const { username, nombre, email, password, rolId, area } = req.body;

    if (!username || !nombre || !email || !password || !rolId) {
      return res.status(400).json({
        error: 'Campos requeridos: username, nombre, email, password, rolId',
      });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }

    const db = getDb();

    // Verificar que el rol existe
    const rol = db.prepare('SELECT RolId, NombreRol FROM Roles WHERE RolId = ?').get(rolId);
    if (!rol) return res.status(400).json({ error: 'Rol no válido' });

    // Verificar duplicados
    const existe = db.prepare('SELECT UsuarioId FROM Usuarios WHERE Username = ? OR Email = ?')
      .get(username.toLowerCase(), email.toLowerCase());
    if (existe) return res.status(409).json({ error: 'El username o email ya existe' });

    const hash = await bcrypt.hash(password, 12);

    const result = db.prepare(`
      INSERT INTO Usuarios (Username, NombreCompleto, Email, PasswordHash, RolId, AreaAsignada, CreadoPor)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      username.trim().toLowerCase(),
      nombre.trim(),
      email.trim().toLowerCase(),
      hash,
      rolId,
      area || null,
      req.user.id
    );

    res.status(201).json({
      ok: true,
      message: 'Usuario creado correctamente',
      data: {
        id:       result.lastInsertRowid,
        username: username.toLowerCase(),
        nombre,
        email,
        rol:      rol.NombreRol,
        area:     area || null,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/admin/usuarios/:id
 * Actualizar usuario (nombre, email, rol, área, activo)
 * Body: { nombre?, email?, rolId?, area?, activo? }
 */
router.put('/usuarios/:id', (req, res, next) => {
  try {
    const db = getDb();
    const id = req.params.id;
    const { nombre, email, rolId, area, activo, password } = req.body;

    const user = db.prepare('SELECT UsuarioId FROM Usuarios WHERE UsuarioId = ?').get(id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const updates = [];
    const params  = [];

    if (nombre !== undefined) { updates.push('NombreCompleto = ?'); params.push(nombre.trim()); }
    if (email  !== undefined) { updates.push('Email = ?'); params.push(email.trim().toLowerCase()); }
    if (rolId  !== undefined) {
      const rol = db.prepare('SELECT RolId FROM Roles WHERE RolId = ?').get(rolId);
      if (!rol) return res.status(400).json({ error: 'Rol no válido' });
      updates.push('RolId = ?'); params.push(rolId);
    }
    if (area   !== undefined) { updates.push('AreaAsignada = ?'); params.push(area || null); }
    if (activo !== undefined) { updates.push('Activo = ?'); params.push(activo ? 1 : 0); }

    // Cambio de contraseña (opcional)
    if (password) {
      if (password.length < 8) {
        return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });
      }
      const bcrypt = require('bcryptjs');
      const hash = bcrypt.hashSync(password, 10);
      updates.push('PasswordHash = ?');
      params.push(hash);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No se proporcionaron campos para actualizar' });
    }

    updates.push("FechaModificacion = datetime('now','localtime')");
    params.push(id);

    db.prepare(`UPDATE Usuarios SET ${updates.join(', ')} WHERE UsuarioId = ?`).run(...params);

    res.json({ ok: true, message: 'Usuario actualizado correctamente' });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/admin/usuarios/:id/password
 * Resetear contraseña de un usuario
 * Body: { password }
 */
router.put('/usuarios/:id/password', async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }

    const db   = getDb();
    const user = db.prepare('SELECT UsuarioId FROM Usuarios WHERE UsuarioId = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const hash = await bcrypt.hash(password, 12);
    db.prepare(`UPDATE Usuarios SET PasswordHash = ?, FechaModificacion = datetime('now','localtime') WHERE UsuarioId = ?`)
      .run(hash, req.params.id);

    res.json({ ok: true, message: 'Contraseña actualizada correctamente' });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/admin/usuarios/:id
 * Desactivar usuario (soft delete)
 */
router.delete('/usuarios/:id', (req, res, next) => {
  try {
    const db = getDb();
    const id = req.params.id;

    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ error: 'No puede desactivar su propia cuenta' });
    }

    const user = db.prepare('SELECT UsuarioId, Username FROM Usuarios WHERE UsuarioId = ?').get(id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    db.prepare(`UPDATE Usuarios SET Activo = 0, FechaModificacion = datetime('now','localtime') WHERE UsuarioId = ?`)
      .run(id);

    res.json({ ok: true, message: `Usuario '${user.Username}' desactivado correctamente` });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/roles
 * Lista todos los roles disponibles
 */
router.get('/roles', (req, res, next) => {
  try {
    const db = getDb();
    const roles = db.prepare('SELECT RolId AS id, NombreRol AS nombre FROM Roles ORDER BY Nivel').all();
    res.json({ ok: true, data: roles });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/audit-logs
 * Retorna los últimos 1000 logs de auditoría del sistema
 */
router.get('/audit-logs', (req, res, next) => {
  try {
    const db = getDb();
    const logs = db.prepare(`
      SELECT
        LogId      AS id,
        Username   AS usuario,
        Rol        AS rol,
        Metodo     AS metodo,
        Ruta       AS ruta,
        EstadoHTTP AS status,
        DuracionMs AS ms,
        IP         AS ip,
        FechaHora  AS fecha
      FROM AuditLog
      ORDER BY FechaHora DESC
      LIMIT 1000
    `).all();

    res.json({ ok: true, data: logs });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/config-bi
 * Lista todos los reportes configurados
 */
router.get('/config-bi', (req, res, next) => {
  try {
    const db = getDb();
    const config = db.prepare('SELECT ConfigId AS id, ReporteId AS reportId, Titulo AS name, PowerBIWorkspace AS workspaceId, PowerBIReportId AS pbiReportId, LookerDashboard AS lookerUrl, PbixPath AS pbixPath, ExcelPath AS excelPath, ThumbnailPath AS thumbnailPath, RolesPermitidos AS roles, AreaRequerida AS area, Activo AS active FROM ConfiguracionBI').all();
    
    // Parsear roles JSON
    const data = config.map(c => ({
      ...c,
      roles: JSON.parse(c.roles || '[]')
    }));

    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/config-bi
 * Crear nueva configuración de reporte
 */
router.post('/config-bi', (req, res, next) => {
  try {
    const { reportId, name, workspaceId, pbiReportId, lookerUrl, pbixPath, excelPath, thumbnailPath, roles, area } = req.body;
    const db = getDb();

    db.prepare(`
      INSERT INTO ConfiguracionBI (ReporteId, Titulo, PowerBIWorkspace, PowerBIReportId, LookerDashboard, PbixPath, ExcelPath, ThumbnailPath, RolesPermitidos, AreaRequerida)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(reportId, name, workspaceId, pbiReportId, lookerUrl, pbixPath, excelPath, thumbnailPath, JSON.stringify(roles || []), area);

    res.status(201).json({ ok: true, message: 'Configuración creada' });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/admin/config-bi/:id
 * Actualizar configuración de reporte
 */
router.put('/config-bi/:id', (req, res, next) => {
  try {
    const { name, workspaceId, pbiReportId, lookerUrl, pbixPath, excelPath, thumbnailPath, roles, area, active } = req.body;
    const db = getDb();

    db.prepare(`
      UPDATE ConfiguracionBI
      SET Titulo = ?, PowerBIWorkspace = ?, PowerBIReportId = ?, LookerDashboard = ?, PbixPath = ?, ExcelPath = ?, ThumbnailPath = ?, RolesPermitidos = ?, AreaRequerida = ?, Activo = ?
      WHERE ConfigId = ?
    `).run(name, workspaceId, pbiReportId, lookerUrl, pbixPath, excelPath, thumbnailPath, JSON.stringify(roles || []), area, active ? 1 : 0, req.params.id);

    res.json({ ok: true, message: 'Configuración actualizada' });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/admin/config-bi/:id
 * Eliminar configuración de reporte
 */
router.delete('/config-bi/:id', (req, res, next) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM ConfiguracionBI WHERE ConfigId = ?').run(req.params.id);
    res.json({ ok: true, message: 'Reporte eliminado del catálogo' });
  } catch (err) {
    next(err);
  }
});


/**
 * DATA HUB: GESTIÓN DE CONECTORES Y MAPEOS
 */
const dataHubService = require('../services/datahub.service');

// Listar conectores
router.get('/connectors', (req, res, next) => {
  try {
    const db = getDb();
    const connectors = db.prepare('SELECT * FROM DataConnectors ORDER BY FechaCreacion DESC').all();
    res.json({ ok: true, data: connectors });
  } catch (err) { next(err); }
});

// Crear conector
router.post('/connectors', (req, res, next) => {
  try {
    const { nombre, tipo, configuracion } = req.body;
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO DataConnectors (Nombre, Tipo, Configuracion)
      VALUES (?, ?, ?)
    `).run(nombre, tipo, JSON.stringify(configuracion));
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (err) { next(err); }
});

// Escanear entidades de un conector
router.get('/connectors/:id/entities', async (req, res, next) => {
  try {
    const entities = await dataHubService.scanFileSource(req.params.id);
    res.json({ ok: true, data: entities });
  } catch (err) { next(err); }
});

// Listar todas las entidades registradas
router.get('/entities', (req, res, next) => {
  try {
    const db = getDb();
    const entities = db.prepare('SELECT * FROM DataEntities ORDER BY NombreEntidad').all();
    res.json({ ok: true, data: entities });
  } catch (err) { next(err); }
});

// Listar mapeos de métricas
router.get('/metric-mappings', (req, res, next) => {
  try {
    const db = getDb();
    const mappings = db.prepare(`
      SELECT m.*, e.NombreEntidad, c.Nombre as ConectorNombre
      FROM MetricMappings m
      LEFT JOIN DataEntities e ON m.EntityId = e.EntityId
      LEFT JOIN DataConnectors c ON e.ConnectorId = c.ConnectorId
    `).all();
    res.json({ ok: true, data: mappings });
  } catch (err) { next(err); }
});

// Crear/Actualizar mapeo
router.post('/metric-mappings', (req, res, next) => {
  try {
    const { seccionUI, entityId, campoValor, campoDelta, campoFiltro, metodoCalculo } = req.body;
    const db = getDb();
    db.prepare(`
      INSERT INTO MetricMappings (SeccionUI, EntityId, CampoValor, CampoDelta, CampoFiltro, MetodoCalculo)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(SeccionUI) DO UPDATE SET
        EntityId = excluded.EntityId,
        CampoValor = excluded.CampoValor,
        CampoDelta = excluded.CampoDelta,
        CampoFiltro = excluded.CampoFiltro,
        MetodoCalculo = excluded.MetodoCalculo,
        FechaActualizacion = datetime('now','localtime')
    `).run(seccionUI, entityId, campoValor, campoDelta, campoFiltro || null, metodoCalculo);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/**
 * ─────────────────────────────────────────────────────────────────
 * KPI CONFIG — Gestión de indicadores y enlaces Power BI
 * ─────────────────────────────────────────────────────────────────
 */

/**
 * GET /api/admin/kpi-config
 * Lista los 37 KPIs con su configuración actual
 */
router.get('/kpi-config', (req, res, next) => {
  try {
    const db   = getDb();
    const kpis = db.prepare(`
      SELECT KPIId AS id, ElementoId, Seccion,
             NombreDefault, NombreCustom, Icono, PBIUrl, Activo
      FROM KPIConfig
      ORDER BY Seccion, KPIId
    `).all();
    res.json({ ok: true, data: kpis });
  } catch (err) { next(err); }
});

/**
 * PUT /api/admin/kpi-config/:elementoId
 * Actualiza nombre, ícono y URL PBI de un KPI específico
 * Body: { nombreCustom?, icono?, pbiUrl? }
 */
router.put('/kpi-config/:elementoId', (req, res, next) => {
  try {
    const { nombreCustom, icono, pbiUrl } = req.body;
    const db = getDb();

    const kpi = db.prepare('SELECT KPIId FROM KPIConfig WHERE ElementoId = ?').get(req.params.elementoId);
    if (!kpi) return res.status(404).json({ error: 'KPI no encontrado' });

    const updates = [];
    const params  = [];

    if (nombreCustom !== undefined) { updates.push('NombreCustom = ?');  params.push(nombreCustom || null); }
    if (icono        !== undefined) { updates.push('Icono = ?');         params.push(icono); }
    if (pbiUrl       !== undefined) { updates.push('PBIUrl = ?');        params.push(pbiUrl || null); }

    if (updates.length === 0) return res.status(400).json({ error: 'Sin campos que actualizar' });

    updates.push("FechaModif = datetime('now','localtime')");
    params.push(req.params.elementoId);

    db.prepare(`UPDATE KPIConfig SET ${updates.join(', ')} WHERE ElementoId = ?`).run(...params);
    res.json({ ok: true, message: 'KPI actualizado correctamente' });
  } catch (err) { next(err); }
});

module.exports = router;

