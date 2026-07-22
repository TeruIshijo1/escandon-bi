/**
 * dataQuality.routes.js — Endpoints para Control de Calidad de Datos
 * Hospital Escandón BI Platform
 */
'use strict';

const express = require('express');
const router = express.Router();
const dataQualityService = require('../services/dataQuality.service');
const { authenticate } = require('../middleware/auth.middleware');

/**
 * POST /api/data-quality/scan — Escanear base de datos del hospital en vivo
 */
router.post('/scan', authenticate, async (req, res) => {
  try {
    const result = await dataQualityService.runLiveQualityScan();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/data-quality/stats — Obtener indicador global de salud de datos
 */
router.get('/stats', authenticate, async (req, res) => {
  try {
    // Correr escaneo ligero en vivo
    await dataQualityService.runLiveQualityScan();
    const stats = dataQualityService.getQualityStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/data-quality/issues — Listar hallazgos de calidad con filtros
 */
router.get('/issues', authenticate, (req, res) => {
  try {
    const { status, severity, limit } = req.query;
    const issues = dataQualityService.getQualityIssues({ status, severity, limit });
    res.json({ success: true, count: issues.length, data: issues });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/data-quality/issues/:id/resolve — Resolver o ignorar una anomalía
 */
router.post('/issues/:id/resolve', authenticate, (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    const resolvedBy = req.user?.username || 'AUDITOR';

    const success = dataQualityService.resolveIssue(id, status, notes, resolvedBy);
    if (!success) {
      return res.status(404).json({ success: false, message: 'Anomalía no encontrada.' });
    }

    res.json({ success: true, message: `Anomalía marcada como ${status}.` });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/data-quality/inspect — Probar inspección sobre un registro individual
 */
router.post('/inspect', authenticate, (req, res) => {
  try {
    const record = req.body;
    const issues = dataQualityService.inspectRecord(record, 'INSPECCION_MANUAL');
    res.json({ success: true, issuesFoundCount: issues.length, issues });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
