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
const { authenticate } = require('../middleware/auth.middleware');

/**
 * POST /api/aria/query — Consulta en lenguaje natural a ARIA
 */
router.post('/query', authenticate, async (req, res) => {
  try {
    const { query } = req.body;
    // Pass req.user to the service to enforce RBAC + IA profile
    const response = await ariaService.processAriaQuery(query || '', req.user);
    res.json({ success: true, data: response });
  } catch (err) {
    console.error('[ARIA API Error]', err);
    // Return 403 if it's a permission error
    if (err.message === 'Acceso denegado') {
      return res.status(403).json({ success: false, error: 'No tienes los permisos necesarios para consultar esta información.' });
    }
    res.status(500).json({ success: false, error: err.message });
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
  const userPermisos = req.user.permisos || [];
  const isAdmin = req.user.role === 'ADMIN';
  const hasAnyIAPerm = userPermisos.some(p => p.startsWith('ia-'));

  const permissions = IA_PERMISSION_CATALOG.map(perm => ({
    id: perm.id,
    label: perm.label,
    icon: perm.icon,
    // ADMIN siempre tiene todo. Si no tiene ningún permiso IA, dar todo (compatibilidad)
    enabled: isAdmin || !hasAnyIAPerm || userPermisos.includes(perm.id),
  }));

  res.json({ success: true, permissions });
});

module.exports = router;
