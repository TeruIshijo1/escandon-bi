const express = require('express');
const router = express.Router();
const etlService = require('../services/etl.service');

// GET /api/audit/inventarios-vs-cargos
router.get('/inventarios-vs-cargos', async (req, res, next) => {
  try {
    const { area, estado, fechaDesde, fechaHasta, limit } = req.query;
    const data = await etlService.getInventariosVsCargos({
      area,
      estado,
      fechaDesde,
      fechaHasta,
      limit: limit ? parseInt(limit, 10) : 500,
    });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
