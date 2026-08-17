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
// Genera el dataset, entrena el modelo y ejecuta la predicción asíncronamente
router.post('/ml-forecast/run', authenticate, authorize(['ADMIN', 'DIRECTOR']), async (req, res) => {
  res.json({ ok: true, message: 'Proceso de IA de ingresos iniciado en segundo plano (Dataset -> Train -> Predict).' });

  try {
    const { syncRevenueDataset } = require('../services/mlRevenueDataset.service');
    console.log('[Predict Revenue] 1. Sincronizando dataset de ingresos...');
    await syncRevenueDataset();

    const trainScript = path.join(__dirname, '..', 'ml', 'train_revenue_forecast.py');
    const predictScript = path.join(__dirname, '..', 'ml', 'predict_revenue_forecast.py');

    console.log('[Predict Revenue] 2. Entrenando modelo...');
    exec(`python "${trainScript}"`, (errTrain, stdoutTrain, stderrTrain) => {
      if (errTrain) return console.error(`[Train Revenue Error] ${errTrain.message}`);
      console.log(`[Train Revenue Output] ${stdoutTrain}`);

      console.log('[Predict Revenue] 3. Ejecutando predicción...');
      exec(`python "${predictScript}"`, (errPred, stdoutPred, stderrPred) => {
        if (errPred) return console.error(`[Predict Revenue Error] ${errPred.message}`);
        console.log(`[Predict Revenue Output] ${stdoutPred}`);
      });
    });

  } catch (err) {
    console.error('[Predict Revenue Pipeline Error]', err);
  }
});

module.exports = router;
