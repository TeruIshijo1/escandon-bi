const express = require('express');
const router = express.Router();
const { pool } = require('../config/pg-db');
const { authenticate, authorize } = require('../middleware/auth.middleware');

const { syncRevenueDataset } = require('../services/mlRevenueDataset.service');
const { startJob, getLatestJobStatus, runPythonScript } = require('../services/mlJobRunner.service');

// GET /api/finanzas/ml-forecast
// Retorna las proyecciones de ingresos para el siguiente mes (o periodo específico)
router.get('/ml-forecast', authenticate, authorize(['ADMIN', 'DIRECTOR']), async (req, res) => {
  try {
    const { periodo } = req.query;
    let query;
    let params = [];

    if (periodo) {
      query = `
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
        WHERE periodo_predicho = $1
        ORDER BY ingreso_estimado DESC
      `;
      params = [periodo];
    } else {
      query = `
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
        WHERE periodo_predicho = (
          SELECT MAX(periodo_predicho)
          FROM ml_forecast_ingresos_mensual
        )
        ORDER BY ingreso_estimado DESC
      `;
    }

    const pgRes = await pool.query(query, params);
    res.json({ ok: true, data: pgRes.rows });
  } catch (err) {
    console.error('[GET ML Forecast Error]', err);
    res.status(500).json({ ok: false, error: 'Error al consultar proyecciones financieras' });
  }
});

// GET /api/finanzas/ml-forecast/status
// Retorna el estado de ejecución del último job de forecast financiero
router.get('/ml-forecast/status', authenticate, authorize(['ADMIN', 'DIRECTOR']), async (req, res) => {
  try {
    const status = await getLatestJobStatus('REVENUE_FORECAST');
    res.json({ ok: true, data: status });
  } catch (err) {
    console.error('[GET ML Forecast Status Error]', err);
    res.status(500).json({ ok: false, error: 'Error al consultar estado del job de ingresos' });
  }
});

// POST /api/finanzas/ml-forecast/run
// Genera el dataset, entrena el modelo y ejecuta la predicción con trazabilidad
router.post('/ml-forecast/run', authenticate, authorize(['ADMIN', 'DIRECTOR']), async (req, res) => {
  try {
    const triggeredBy = req.user?.username || req.user?.email || 'USER';
    const jobInfo = await startJob('REVENUE_FORECAST', async () => {
      console.log('[Predict Revenue] 1. Sincronizando dataset de ingresos...');
      await syncRevenueDataset();

      console.log('[Predict Revenue] 2. Entrenando modelo...');
      const trainRes = await runPythonScript('train_revenue_forecast.py');

      console.log('[Predict Revenue] 3. Ejecutando predicción...');
      const predRes = await runPythonScript('predict_revenue_forecast.py');

      return {
        trainOutput: trainRes.stdout,
        predictOutput: predRes.stdout
      };
    }, triggeredBy);

    if (jobInfo.alreadyRunning) {
      return res.status(409).json({
        ok: false,
        error: jobInfo.message
      });
    }

    res.json({
      ok: true,
      message: 'Pipeline de proyecciones ejecutado correctamente',
      data: jobInfo
    });
  } catch (err) {
    console.error('[POST ML Forecast Error]', err);
    res.status(500).json({ ok: false, error: 'Error al ejecutar pipeline de ingresos' });
  }
});

module.exports = router;
