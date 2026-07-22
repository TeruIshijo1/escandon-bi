/**
 * aria.routes.js — Endpoints para ARIA Copiloto de Inteligencia Analítica Local
 * Hospital Escandón BI Platform
 */
'use strict';

const express = require('express');
const router = express.Router();
const ariaService = require('../services/aria.service');
const { authenticate } = require('../middleware/auth.middleware');

/**
 * POST /api/aria/query — Consulta en lenguaje natural a ARIA
 */
router.post('/query', authenticate, async (req, res) => {
  try {
    const { query } = req.body;
    const response = await ariaService.processAriaQuery(query || '');
    res.json({ success: true, data: response });
  } catch (err) {
    console.error('[ARIA API Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/aria/suggestions — Sugerencias de preguntas dinámicas
 */
router.get('/suggestions', authenticate, (req, res) => {
  res.json({
    success: true,
    suggestions: [
      '🛏️ ¿Cómo está la ocupación de camas por área?',
      '🔍 ¿Cuáles son las partidas con faltantes hoy?',
      '💰 ¿Quién es el paciente con mayor gasto acumulado?',
      '💊 ¿Cuáles son los 5 insumos más consumidos?',
      '🛡️ ¿Qué anomalías de calidad se detectaron?',
    ],
  });
});

module.exports = router;
