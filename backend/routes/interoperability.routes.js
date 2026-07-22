/**
 * interoperability.routes.js — Endpoints para Interoperabilidad y Conectores HL7/FHIR (Opción 5)
 * Hospital Escandón BI Platform
 */
'use strict';

const express = require('express');
const router = express.Router();
const interopService = require('../services/interoperability.service');
const { authenticate } = require('../middleware/auth.middleware');

/**
 * POST /api/interop/hl7/dft — Webhook para recibir transacciones financieras HL7 v2
 */
router.post('/hl7/dft', express.text({ type: '*/*' }), (req, res) => {
  try {
    const rawHL7 = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const result = interopService.ingestEvent('HL7v2', 'DFT^P03', rawHL7);

    res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/interop/fhir/chargeitem — Endpoint para recibir recursos FHIR ChargeItem
 */
router.post('/fhir/chargeitem', express.json(), (req, res) => {
  try {
    const fhirResource = req.body;
    const result = interopService.ingestEvent('FHIR_R4', 'ChargeItem', fhirResource);

    res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/interop/logs — Obtener bitácora de eventos recibidos
 */
router.get('/logs', authenticate, (req, res) => {
  try {
    const limit = req.query.limit || 50;
    const logs = interopService.getInteropLogs(limit);
    res.json({ success: true, count: logs.length, data: logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/interop/simulate — Disparar un evento simulado para pruebas de la plataforma
 */
router.post('/simulate', authenticate, (req, res) => {
  try {
    const { protocol = 'HL7v2', withAnomaly = false } = req.body;
    const result = interopService.simulateEvent(protocol, Boolean(withAnomaly));

    res.json({
      success: true,
      message: `Evento simulado (${protocol}) procesado correctamente.`,
      result,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
