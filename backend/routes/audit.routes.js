const express = require('express');
const router = express.Router();
const etlService = require('../services/etl.service');
const auditMovementService = require('../services/auditMovement.service');
const { authenticate, authorize } = require('../middleware/auth.middleware');

// GET /api/audit/inventarios-vs-cargos
router.get('/inventarios-vs-cargos', authenticate, authorize(['ADMIN', 'DIRECTOR']), async (req, res, next) => {
  try {
    const { area, estado, fechaDesde, fechaHasta, limit } = req.query;
    const data = await etlService.getInventariosVsCargos({
      area,
      estado,
      fechaDesde,
      fechaHasta,
      limit: limit ? parseInt(limit, 10) : 5000,
    });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// GET /api/audit/movimientos-paciente
// Reporte unificado de cargos, reversas, costos (SAP) y unidad de servicio (ej. Carro Rojo)
router.get('/movimientos-paciente', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res, next) => {
  try {
    const { fechaDesde, fechaHasta, tipoMovimiento, unidadServicio, busqueda, limit } = req.query;
    const result = await auditMovementService.getMovimientosPaciente({
      fechaDesde,
      fechaHasta,
      tipoMovimiento,
      unidadServicio,
      busqueda,
      limit: limit ? parseInt(limit, 10) : 5000,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;

