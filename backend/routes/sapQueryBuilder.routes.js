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
const { checkSapModuleAccess } = require('../utils/reportAccess');
const { selectResources } = require('../services/assistantResourceSelection.service');
const fullAssistantCatalog = () => sapQueryBuilderService.getAssistantCatalog?.() || sapQueryBuilderService.getEntityCatalog();
const canRead = (user, entity) => checkSapModuleAccess(user, entity.id, entity);
const canReadId = (user, id) => checkSapModuleAccess(user, id, sapQueryBuilderService.getEntityDefinition(id));

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
// GET /api/sap-query/catalog
// Catálogo de entidades filtrado según los permisos del usuario autenticado
router.get('/catalog', authenticate, (req, res) => {
  try {
    const fullCatalog = sapQueryBuilderService.getEntityCatalog();
    const catalog = fullCatalog.filter(c => checkSapModuleAccess(req.user, c.id));
    const assistantCatalog = fullAssistantCatalog().filter(entity => canRead(req.user, entity));
    res.json({ ok: true, catalog, assistantCatalog });
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
    const catalog = fullAssistantCatalog().filter(entity => canRead(req.user, entity));
    if (!catalog.length) return res.status(403).json({ ok: false, error: 'No tienes temas disponibles para crear reportes. Solicita acceso al área de Sistemas.' });
    const relevantCatalog = selectResources(catalog, message.trim(), context, pending);
    const result = await reportAssistant.prepareReport({ message: message.trim(), history, context, pending, catalog: relevantCatalog });
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
    if (req.body?.savedQueryId != null) {
      const result = await sapQueryBuilderService.executeSavedQuery(req.user, req.body);
      return res.json({ ok: true, ...result });
    }
    const { entity, selectedFields, fechaDesde, fechaHasta, almacen, estatusDoc, clasificacionMedica, busqueda, limit, analysis } = req.body;
    
    if (!canReadId(req.user, entity)) {
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
      analysis,
      limit: limit ?? 10000
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    const savedExecution = req.body?.savedQueryId != null;
    res.status(err.status || (savedExecution ? 503 : 400)).json({ ok: false,
      error: err.status || !savedExecution ? err.message : 'No se pudo consultar el reporte guardado. Intenta nuevamente.' });
  }
});

// GET /api/sap-query/saved
// Lista de consultas guardadas visibles para el usuario autenticado
router.get('/saved', authenticate, async (req, res) => {
  try {
    const queries = await sapQueryBuilderService.getSavedQueries(req.user);
    res.json({ ok: true, canAssign: sapQueryBuilderService.canAssignSavedReports?.(req.user) || false,
      queries: queries.filter(query => query.isAssigned || canReadId(req.user, query.entity)) });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false,
      error: err.status ? err.message : 'No se pudieron consultar tus reportes. Intenta nuevamente.' });
  }
});

// Destinatarios disponibles exclusivamente para Sistemas/Administración.
router.get('/saved/access', authenticate, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    res.json({ ok: true, hasAssignedReports: await sapQueryBuilderService.hasAssignedReports(req.user) });
  } catch {
    res.status(503).json({ ok: false, hasAssignedReports: false, error: 'No se pudo verificar el acceso a tus reportes. Intenta nuevamente.' });
  }
});

// Destinatarios disponibles exclusivamente para Sistemas/Administración.
router.get('/saved/recipients', authenticate, async (req, res) => {
  try {
    const users = await sapQueryBuilderService.getSavedReportRecipients(req.user);
    res.json({ ok: true, users });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.status ? err.message : 'No se pudo consultar la lista de usuarios. Intenta nuevamente.' });
  }
});

router.put('/saved/:id/assignments', authenticate, async (req, res) => {
  try {
    const result = await sapQueryBuilderService.setSavedReportAssignments(req.user, req.params.id, req.body?.userIds);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.status ? err.message : 'No se pudo guardar la asignación. Intenta nuevamente.' });
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
    if (!canReadId(req.user, entity)) {
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
    res.status(err.status || 400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
