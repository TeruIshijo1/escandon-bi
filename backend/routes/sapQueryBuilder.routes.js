/**
 * sapQueryBuilder.routes.js
 * Rutas para el Constructor de Consultas SAP Service Layer
 * Hospital Escandón BI Platform v4.0
 */
'use strict';

const express = require('express');
const router = express.Router();
const sapQueryBuilderService = require('../services/sapQueryBuilder.service');
const { authenticate } = require('../middleware/auth.middleware');

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
      limit: limit ? parseInt(limit, 10) : 2000
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
    res.json({ ok: true, queries });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/sap-query/saved
// Guarda una nueva consulta personalizada
router.post('/saved', authenticate, async (req, res) => {
  try {
    const { title, description, entity, selectedFields, filters, isPublic } = req.body;
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
