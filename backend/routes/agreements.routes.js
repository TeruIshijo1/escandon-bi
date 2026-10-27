'use strict';

const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');
const agreementsService = require('../services/agreements.service');

// Todas las rutas requieren usuario autenticado con rol ADMIN o DIRECTOR
router.use(authenticate, authorize(['ADMIN', 'DIRECTOR']));

/**
 * GET /api/sistemas/agreements
 * Obtiene el catálogo auditado de los 57 acuerdos con métricas y salud
 */
router.get('/', async (req, res) => {
  try {
    const data = await agreementsService.getAgreementsAudit();
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[AGREEMENTS AUDIT ERROR]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/sistemas/agreements/attempts
 * Obtiene el historial de intentos de aplicación de convenios (AU y CA)
 */
router.get('/attempts', async (req, res) => {
  try {
    const { agCode, status, limit } = req.query;
    const data = await agreementsService.getAgreementAttempts({ agCode, status, limit });
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[AGREEMENTS ATTEMPTS ERROR]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/sistemas/agreements/partners
 * Búsqueda de socios de negocio (BP) en SAP / Vertical
 */
router.get('/partners', async (req, res) => {
  try {
    const { q = '' } = req.query;
    const partners = await agreementsService.searchBusinessPartners(q);
    res.json({ ok: true, partners });
  } catch (err) {
    console.error('[AGREEMENTS PARTNERS ERROR]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/sistemas/agreements/repair/:agCode
 * Repara automáticamente un acuerdo existente con fallas de configuración
 */
router.post('/repair/:agCode', authorize(['ADMIN']), async (req, res) => {
  try {
    const { agCode } = req.params;
    const username = req.user?.username || 'SISTEMAS';
    const result = await agreementsService.repairAgreement(agCode, username);
    res.json({ ok: true, result });
  } catch (err) {
    console.error('[AGREEMENTS REPAIR ERROR]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/sistemas/agreements/create
 * Crea un nuevo acuerdo completo en Vertical (AG + 37 grupos en AGITGR)
 */
router.post('/create', authorize(['ADMIN']), async (req, res) => {
  try {
    const username = req.user?.username || 'SISTEMAS';
    const result = await agreementsService.createAgreement(req.body, username);
    res.json({ ok: true, result });
  } catch (err) {
    console.error('[AGREEMENTS CREATE ERROR]', err.message);
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
