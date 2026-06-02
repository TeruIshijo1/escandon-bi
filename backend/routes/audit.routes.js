/**
 * audit.routes.js — Rutas de Auditoría
 * Hospital Escandón BI Platform v1.0
 */
'use strict';

const express  = require('express');
const router   = express.Router();
const { authenticate, authorize, authorizeCapability } = require('../middleware/auth.middleware');
const { getInventariosVsCargos, getKPIsProductividad, getTasaMortalidad } = require('../services/etl.service');

/**
 * GET /api/audit/inventarios-vs-cargos
 * Retorna conciliación ETL de órdenes vs cargos de enfermería.
 * Roles: ADMIN, DIRECTOR
 *
 * Query params:
 *   area       — filtro de área hospitalaria
 *   estado     — COINCIDE | DIFERENCIA | FALTANTE | EXCEDENTE
 *   fechaDesde — YYYY-MM-DD
 *   fechaHasta — YYYY-MM-DD
 *   limit      — máx registros (default 500)
 */
router.get(
  '/inventarios-vs-cargos',
  authenticate,
  authorize(['ADMIN', 'DIRECTOR']),
  async (req, res, next) => {
    try {
      const { area, estado, fechaDesde, fechaHasta, limit } = req.query;

      const resultado = await getInventariosVsCargos({
        area:       area       || null,
        estado:     estado     || null,
        fechaDesde: fechaDesde || null,
        fechaHasta: fechaHasta || null,
        limit:      parseInt(limit) || 500,
      });

      res.json({
        ok:   true,
        data: resultado,
        meta: {
          solicitadoPor: req.user.username,
          rol:           req.user.role,
          timestamp:     new Date().toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/audit/kpis-productividad
 * KPIs de ocupación, rotación, estancia
 * Roles: ADMIN, DIRECTOR, JEFE_AREA (solo su área)
 */
router.get(
  '/kpis-productividad',
  authenticate,
  authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']),
  async (req, res, next) => {
    try {
      // JEFE_AREA solo ve su propia área
      const area =
        req.user.role === 'JEFE_AREA'
          ? req.user.area
          : req.query.area || null;

      const kpis = await getKPIsProductividad({ area });
      res.json({ ok: true, data: kpis });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/audit/tasa-mortalidad
 * Tasa de mortalidad ajustada por período
 * Roles: ADMIN, DIRECTOR
 */
router.get(
  '/tasa-mortalidad',
  authenticate,
  authorize(['ADMIN', 'DIRECTOR']),
  async (req, res, next) => {
    try {
      const { periodo } = req.query; // semana | mes | año
      const data = await getTasaMortalidad({ periodo: periodo || 'mes' });
      res.json({ ok: true, data });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
