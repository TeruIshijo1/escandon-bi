/**
 * ai.routes.js — Endpoints del Asistente Mar-IA
 * Hospital Escandón BI Platform v1.0
 */
'use strict';

const express    = require('express');
const router     = express.Router();
const rateLimit  = require('express-rate-limit');
const { authenticate, authorizeCapability } = require('../middleware/auth.middleware');
const { processRAGQuery } = require('../services/rag.service');
const multer     = require('multer');

// Configuración de multer (memoria)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB máximo
});

/* Rate limit específico para IA (evitar abuso de tokens) */
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minuto
  max:      20,
  message: { error: 'Límite de consultas a Mar-IA alcanzado. Espere 1 minuto.' },
  keyGenerator: (req) => req.user?.id || req.ip,
});

/**
 * POST /api/ai/query
 * Procesa una pregunta en lenguaje natural con pipeline RAG.
 * Todos los roles autenticados pueden usar Mar-IA,
 * pero las respuestas se filtran según rol y área.
 */
router.post(
  '/query',
  authenticate,
  authorizeCapability('usarAsistenteIA'),
  aiLimiter,
  upload.single('file'), // 'file' es el nombre del campo para el archivo Excel
  async (req, res, next) => {
    try {
      // Soportamos multipart (req.body) para texto y req.file para el adjunto
      const { question, screenImage, currentContext } = req.body;
      const file = req.file;

      if (!question || typeof question !== 'string' || question.trim().length < 2) {
        return res.status(400).json({ error: 'La pregunta debe tener al menos 2 caracteres.' });
      }

      if (question.length > 500) {
        return res.status(400).json({ error: 'La pregunta es demasiado larga (máx. 500 caracteres).' });
      }

      const result = await processRAGQuery({
        question:     question.trim(),
        userRole:     req.user.role,
        userArea:     req.user.area,
        userName:     req.user.nombre,
        file:         file,
        screenImage:  screenImage,
        currentContext: currentContext
      });

      res.json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
