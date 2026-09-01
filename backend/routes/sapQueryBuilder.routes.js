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

// GET /api/sap-query/catalog
// Catálogo completo de entidades y campos amigables
router.get('/catalog', authenticate, (req, res) => {
  try {
    const catalog = sapQueryBuilderService.getEntityCatalog();
    res.json({ ok: true, catalog });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/sap-query/execute
// Ejecuta consulta contra Service Layer / SQL nativo
router.post('/execute', authenticate, async (req, res) => {
  try {
    const { entity, selectedFields, fechaDesde, fechaHasta, almacen, proveedor, busqueda, limit } = req.body;
    const result = await sapQueryBuilderService.executeQuery({
      entity,
      selectedFields,
      fechaDesde,
      fechaHasta,
      almacen,
      proveedor,
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
