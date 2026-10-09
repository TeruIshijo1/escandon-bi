/**
 * aria.routes.js — Endpoints para ARIA Copiloto de Inteligencia Analítica Local
 * Hospital Escandón BI Platform
 * 
 * Integración con permisos IA granulares (ia-*)
 */
'use strict';

const express = require('express');
const router = express.Router();
const ariaService = require('../services/aria');
const rateLimit = require('express-rate-limit');
const { authenticate, authorizeCapability } = require('../middleware/auth.middleware');
const { hasIAPermission } = require('../services/aria/core/permissions');

const assistantLimiter = rateLimit({
  windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  validate: { xForwardedForHeader: false, trustProxy: false },
  keyGenerator: req => String(req.user?.id || req.user?.username || req.ip),
  message: { success: false, error: 'Has enviado varias solicitudes seguidas. Espera un minuto y vuelve a intentarlo.' },
});
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isIdentifier = value => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/.test(value);
const isDate = value => {
  if (value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

function validContext(context) {
  if (context == null) return true;
  if (!isObject(context) || Object.keys(context).some(key => !['entity', 'selectedFields', 'filters', 'analysis'].includes(key)) || !isIdentifier(context.entity)) return false;
  if (!Array.isArray(context.selectedFields) || context.selectedFields.length > 100 || context.selectedFields.some(field => !isIdentifier(field))) return false;
  if (!isObject(context.filters) || Object.keys(context.filters).some(key => !['fechaDesde', 'fechaHasta', 'almacen', 'estatusDoc', 'clasificacionMedica', 'busqueda'].includes(key))) return false;
  for (const [key, value] of Object.entries(context.filters)) {
    if (['fechaDesde', 'fechaHasta'].includes(key)) {
      if (!isDate(value)) return false;
    } else if (key === 'busqueda') {
      if (typeof value !== 'string' || value.length > 200) return false;
    } else if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{0,50}$/.test(value)) return false;
  }
  return validAnalysisShape(context.analysis);
}

// Bound conversation transport here. The report service subsequently validates
// each identifier, type and additive measure against the authorized catalogue.
function validAnalysisShape(analysis) {
  if (analysis == null) return true;
  if (!isObject(analysis) || Object.keys(analysis).some(key => !['predicates', 'groupBy', 'measures', 'orderBy'].includes(key))) return false;
  const bounded = (key, cap) => analysis[key] == null || Array.isArray(analysis[key]) && analysis[key].length <= cap;
  if (!bounded('predicates', 8) || !bounded('groupBy', 4) || !bounded('measures', 6) || !bounded('orderBy', 2)) return false;
  const scalar = value => typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value.length <= 200;
  return (analysis.predicates || []).every(predicate => isObject(predicate)
    && Object.keys(predicate).every(key => ['field', 'op', 'value', 'values'].includes(key)) && isIdentifier(predicate.field)
    && ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'contains', 'isNull', 'notNull'].includes(predicate.op)
    && (predicate.value == null || scalar(predicate.value))
    && (predicate.values == null || Array.isArray(predicate.values) && predicate.values.length === 2 && predicate.values.every(scalar)))
    && (analysis.groupBy || []).every(isIdentifier)
    && (analysis.measures || []).every(measure => isObject(measure) && Object.keys(measure).every(key => ['op', 'field'].includes(key))
      && ['sum', 'count', 'countDistinct'].includes(measure.op) && (measure.field == null || isIdentifier(measure.field)))
    && (analysis.orderBy || []).every(order => isObject(order) && Object.keys(order).every(key => ['field', 'direction'].includes(key))
      && isIdentifier(order.field) && ['asc', 'desc'].includes(order.direction));
}

/**
 * POST /api/aria/query — Consulta en lenguaje natural a ARIA
 */
router.post('/query', authenticate, authorizeCapability('usarAsistenteIA'), assistantLimiter, async (req, res) => {
  const { query, history = [], context, pending } = req.body || {};
  if (typeof query !== 'string' || query.trim().length < 2 || query.length > 1500) return res.status(400).json({ success: false, error: 'Escribe tu pregunta con un texto de entre 2 y 1500 caracteres.' });
  if (!Array.isArray(history) || history.length > 8 || history.some(item => !isObject(item) || Object.keys(item).some(key => !['role', 'content'].includes(key)) || !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string' || item.content.length > 1500)) return res.status(400).json({ success: false, error: 'No pude leer la conversación. Inicia una nueva solicitud e intenta de nuevo.' });
  if (!validContext(context)) return res.status(400).json({ success: false, error: 'No pude leer el reporte anterior. Inicia una nueva solicitud e intenta de nuevo.' });
  if (pending != null && (!isObject(pending) || Object.keys(pending).some(key => !['request', 'answers'].includes(key)) || typeof pending.request !== 'string' || pending.request.length > 1500 || !Array.isArray(pending.answers) || pending.answers.length > 4 || pending.answers.some(answer => typeof answer !== 'string' || answer.length > 1500))) return res.status(400).json({ success: false, error: 'No pude continuar la solicitud anterior. Inicia una nueva conversación e intenta de nuevo.' });
  try {
    // Pass req.user to the service to enforce RBAC + IA profile
    const response = await ariaService.processAriaQuery(query.trim(), req.user, { history, context, pending });
    res.json({ success: true, data: response });
  } catch (err) {
    console.warn('[MAR-IA] No se pudo completar la consulta.');
    // Return 403 if it's a permission error
    if (err.message === 'Acceso denegado') {
      return res.status(403).json({ success: false, error: 'No tienes los permisos necesarios para consultar esta información.' });
    }
    res.status(503).json({ success: false, error: 'No pude consultar la información en este momento. Intenta de nuevo o elige una pregunta sugerida.' });
  }
});

/**
 * GET /api/aria/suggestions — Sugerencias de preguntas dinámicas según permisos IA
 * 
 * Ahora usa el catálogo de permisos IA (ia-*) del usuario para generar
 * sugerencias personalizadas, en vez de validar solo permisos de sección.
 */
router.get('/suggestions', authenticate, (req, res) => {
  try {
    const suggestions = ariaService.getSuggestionsForUser(req.user);

    res.json({
      success: true,
      suggestions: suggestions.slice(0, 6),
    });
  } catch (err) {
    console.error('[ARIA Suggestions Error]', err);
    res.json({
      success: true,
      suggestions: ['📊 Muéstrame un resumen general de mis áreas.'],
    });
  }
});

/**
 * GET /api/aria/permissions — Lista los permisos IA disponibles y cuáles tiene el usuario
 * Útil para el frontend para mostrar qué módulos de IA tiene habilitados
 */
router.get('/permissions', authenticate, (req, res) => {
  const { IA_PERMISSION_CATALOG } = ariaService;
  const permissions = IA_PERMISSION_CATALOG.map(perm => ({
    id: perm.id,
    label: perm.label,
    icon: perm.icon,
    enabled: hasIAPermission(req.user, perm.id),
  }));

  res.json({ success: true, permissions });
});

module.exports = router;
