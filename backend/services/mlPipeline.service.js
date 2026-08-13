'use strict';

const cron = require('node-cron');
const { exec } = require('child_process');
const path = require('path');
const { syncRevenueDataset } = require('./mlRevenueDataset.service');

const isRunning = { train: false, predict: false };

const ML_DIR = path.join(__dirname, '..', 'ml');

function runPythonScript(scriptName) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(ML_DIR, scriptName);
    console.log(`[ML Pipeline] Ejecutando python "${scriptPath}"...`);
    const startedAt = Date.now();
    exec(`python "${scriptPath}"`, { timeout: 30 * 60 * 1000 }, (error, stdout, stderr) => {
      const duration = ((Date.now() - startedAt) / 1000).toFixed(1);
      if (stdout) console.log(`[ML Pipeline] stdout (${scriptName}):\n${stdout}`);
      if (stderr) console.error(`[ML Pipeline] stderr (${scriptName}):\n${stderr}`);
      if (error) {
        console.error(`[ML Pipeline] Error en ${scriptName} tras ${duration}s:`, error.message);
        reject(error);
        return;
      }
      console.log(`[ML Pipeline] ${scriptName} completado en ${duration}s.`);
      resolve(stdout);
    });
  });
}

/**
 * Re-entrena el modelo y regenera las predicciones con los datos más frescos.
 * Se ejecuta en cascada: primero train (necesita historial maduro) y luego predict.
 */
async function runMLPipeline() {
  if (isRunning.train) {
    console.log('[ML Pipeline] Entrenamiento ya en progreso. Omitiendo ciclo...');
    return { ok: false, skipped: true };
  }
  isRunning.train = true;
  const startedAt = Date.now();
  try {
    console.log('\n🔄 [ML Pipeline] Iniciando re-entrenamiento automático del modelo de riesgo...');
    await runPythonScript('train_reorder_risk.py');
    console.log('[ML Pipeline] Modelo re-entrenado. Regenerando predicciones...');
    await runPythonScript('predict_reorder_risk.py');

    console.log('[ML Pipeline] Generando dataset mensual de ingresos (Línea Financiera)...');
    await syncRevenueDataset();
    console.log('[ML Pipeline] Re-entrenando modelo de ingresos...');
    await runPythonScript('train_revenue_forecast.py');
    console.log('[ML Pipeline] Generando proyección de ingresos del siguiente mes...');
    await runPythonScript('predict_revenue_forecast.py');

    const duration = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`✅ [ML Pipeline] Re-entrenamiento y predicción completados en ${duration}s.`);
    return { ok: true, duration };
  } catch (err) {
    console.error('❌ [ML Pipeline] Falló el pipeline automático:', err.message);
    return { ok: false, error: err.message };
  } finally {
    isRunning.train = false;
  }
}

/**
 * Inicializa el cron diario de re-entrenamiento.
 * Se programa a las 04:30 (después de los syncs nocturnos y con targets maduros).
 */
function initMLCron() {
  cron.schedule('30 4 * * *', () => {
    runMLPipeline();
  });
  console.log('⏰ Cron Job de ML Pipeline inicializado (Re-entrenamiento diario 04:30).');
}

module.exports = {
  runMLPipeline,
  initMLCron
};
