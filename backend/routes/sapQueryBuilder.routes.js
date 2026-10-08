/**
 * sapQueryBuilder.routes.js
 * Rutas para el Constructor de Consultas SAP Service Layer
 * Hospital Escandón BI Platform v4.0
 */
'use strict';

const express = require('express');
const router = express.Router();
const sapQueryBuilderService = require('../services/sapQueryBuilder.service');
const reportAssistant = require('../services/reportAssistant.service');
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middleware/auth.middleware');

const assistantLimiter = rateLimit({
  windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  validate: { xForwardedForHeader: false, trustProxy: false },
  keyGenerator: req => String(req.user?.id || req.user?.username || req.ip),
  message: { ok: false, error: 'Has enviado varias solicitudes seguidas. Espera un minuto y vuelve a intentarlo.' },
});

/**
 * Función auxiliar para verificar si el usuario tiene permiso para consultar un módulo específico de SAP.
 * REGLA MAESTRA: Solo amendoza es Superadmin con acceso total absoluto.
 */
function checkSapModuleAccess(user, entity) {
  if (!user) return false;
  const username = (user.username || '').toLowerCase();
  
  // REGLA MAESTRA: amendoza es Superadmin absoluto
  if (username === 'amendoza') return true;

  const permisos = Array.isArray(user.permisos) ? user.permisos : [];
  const hasSpecificSapPerms = permisos.some(p => typeof p === 'string' && p.startsWith('sap-query-'));
  if (hasSpecificSapPerms) {
    return permisos.includes(`sap-query-${entity}`);
  }

  // Fallback si tiene acceso a la pantalla pero aún no se le configuran permisos granulares
  if (permisos.includes('mi-area-consultas-service-layer')) {
    return ['inventory', 'batches', 'item_prices', 'item_master_data', 'stock_transfers'].includes(entity);
  }

  return false;
}

// GET /api/sap-query/catalog
// Catálogo de entidades filtrado según los permisos del usuario autenticado
router.get('/catalog', authenticate, (req, res) => {
  try {
    const fullCatalog = sapQueryBuilderService.getEntityCatalog();
    const catalog = fullCatalog.filter(c => checkSapModuleAccess(req.user, c.id));
    res.json({ ok: true, catalog });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/sap-query/assistant
// Prepare a bounded report configuration without reading any clinical records.
router.post('/assistant', authenticate, assistantLimiter, async (req, res) => {
  const { message, history = [], context, pending } = req.body || {};
  if (typeof message !== 'string' || message.trim().length < 2 || message.length > 1500) return res.status(400).json({ ok: false, error: 'Describe tu reporte con un texto de entre 2 y 1500 caracteres.' });
  if (!Array.isArray(history) || history.length > 8 || history.some(item => !item || !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string' || item.content.length > 1500)) return res.status(400).json({ ok: false, error: 'No pude leer la conversación. Inicia una nueva solicitud e intenta de nuevo.' });
  if (pending != null && (typeof pending !== 'object' || Array.isArray(pending) || typeof pending.request !== 'string' || pending.request.length > 1500 || !Array.isArray(pending.answers) || pending.answers.length > 4 || pending.answers.some(answer => typeof answer !== 'string' || answer.length > 1500))) return res.status(400).json({ ok: false, error: 'No pude continuar la solicitud anterior. Inicia una nueva conversación e intenta de nuevo.' });
  try {
    const catalog = sapQueryBuilderService.getEntityCatalog().filter(entity => checkSapModuleAccess(req.user, entity.id));
    if (!catalog.length) return res.status(403).json({ ok: false, error: 'No tienes temas disponibles para crear reportes. Solicita acceso al área de Sistemas.' });
    const result = await reportAssistant.prepareReport({ message: message.trim(), history, context, pending, catalog });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.warn('[Report Assistant] Could not prepare report.');
    res.status(503).json({ ok: false, error: 'No pude preparar el reporte en este momento. Intenta de nuevo o elige un tema manualmente.' });
  }
});

// POST /api/sap-query/execute
// Ejecuta consulta contra Service Layer / SQL nativo verificando permisos
router.post('/execute', authenticate, async (req, res) => {
  try {
    const { entity, selectedFields, fechaDesde, fechaHasta, almacen, estatusDoc, clasificacionMedica, busqueda, limit } = req.body;
    
    if (!checkSapModuleAccess(req.user, entity)) {
      return res.status(403).json({
        ok: false,
        error: `Acceso denegado: No tienes permisos asignados para consultar el módulo SAP '${entity}'. Solicita autorización al Administrador.`
      });
    }

    const result = await sapQueryBuilderService.executeQuery({
      entity,
      selectedFields,
      fechaDesde,
      fechaHasta,
      almacen,
      estatusDoc,
      clasificacionMedica,
      busqueda,
      limit: limit ?? 10000
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// GET /api/sap-query/saved
// Lista de consultas guardadas visibles para el usuario autenticado
router.get('/saved', authenticate, async (req, res) => {
  try {
    const queries = await sapQueryBuilderService.getSavedQueries(req.user);
    res.json({ ok: true, queries: queries.filter(query => checkSapModuleAccess(req.user, query.entity)) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/sap-query/saved
// Guarda una nueva consulta personalizada
router.post('/saved', authenticate, async (req, res) => {
  try {
    const { title, description, entity, selectedFields, filters, isPublic } = req.body;
    if (!sapQueryBuilderService.getEntityDefinition(entity)) {
      return res.status(400).json({ ok: false, error: 'El módulo seleccionado no existe.' });
    }
    if (!checkSapModuleAccess(req.user, entity)) {
      return res.status(403).json({ ok: false, error: 'No tienes permiso para guardar reportes de este módulo.' });
    }
    const saved = await sapQueryBuilderService.saveQuery(req.user, {
      title,
      description,
      entity,
      selectedFields,
      filters,
      isPublic
    });
    res.json({ ok: true, saved });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// DELETE /api/sap-query/saved/:id
// Elimina una consulta guardada
router.delete('/saved/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await sapQueryBuilderService.deleteQuery(req.user, id);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
