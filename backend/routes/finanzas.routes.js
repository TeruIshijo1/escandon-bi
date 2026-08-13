const express = require('express');
const router = express.Router();
const { pool } = require('../config/pg-db');
const { exec } = require('child_process');
const path = require('path');
const { authenticate, authorize } = require('../middleware/auth.middleware');

// GET /api/finanzas/ml-forecast
// Retorna las proyecciones de ingresos para el siguiente mes
router.get('/ml-forecast', authenticate, authorize(['ADMIN', 'DIRECTOR']), async (req, res) => {
  try {
    const query = `
      SELECT 
        periodo_predicho,
        area,
        servicio,
        ingreso_estimado,
        intervalo_bajo,
        intervalo_alto,
        modelo_version,
        metodo,
        fecha_prediccion
      FROM ml_forecast_ingresos_mensual
      ORDER BY ingreso_estimado DESC
    `;
    const pgRes = await pool.query(query);
    res.json({ ok: true, data: pgRes.rows });
  } catch (err) {
    console.error('[GET ML Forecast Error]', err);
    res.status(500).json({ ok: false, error: 'Error al consultar proyecciones financieras' });
  }
});

// POST /api/finanzas/ml-forecast/run
// Ejecuta asíncronamente el script de predicción en Python
router.post('/ml-forecast/run', authenticate, authorize(['ADMIN', 'DIRECTOR']), (req, res) => {
  const scriptPath = path.join(__dirname, '..', 'ml', 'predict_revenue_forecast.py');
  
  exec(`python "${scriptPath}"`, (error, stdout, stderr) => {
    if (error) {
      console.error(`[Predict Revenue Error] ${error.message}`);
      return;
    }
    if (stderr) {
      console.error(`[Predict Revenue Stderr] ${stderr}`);
    }
    console.log(`[Predict Revenue Output] ${stdout}`);
  });

  res.json({ ok: true, message: 'Predicción de ingresos iniciada en segundo plano.' });
});

module.exports = router;
