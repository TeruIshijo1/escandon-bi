'use strict';

const cron = require('node-cron');
const path = require('path');
const { syncRevenueDataset } = require('./mlRevenueDataset.service');
const { runPythonScript, startJob } = require('./mlJobRunner.service');

/**
 * Re-entrena los modelos y regenera las predicciones con los datos más frescos.
 * Se ejecuta en cascada: primero train (necesita historial maduro) y luego predict.
 */
async function runMLPipeline(triggeredBy = 'CRON_04_30') {
  try {
    const jobResult = await startJob('FULL_PIPELINE', async () => {
      console.log('\n🔄 [ML Pipeline] Iniciando re-entrenamiento automático del modelo de riesgo...');
      const out1 = await runPythonScript('train_reorder_risk.py');

      console.log('[ML Pipeline] Modelo re-entrenado. Regenerando predicciones...');
      const out2 = await runPythonScript('predict_reorder_risk.py');

      console.log('[ML Pipeline] Generando dataset mensual de ingresos (Línea Financiera)...');
      await syncRevenueDataset();

      console.log('[ML Pipeline] Re-entrenando modelo de ingresos...');
      const out3 = await runPythonScript('train_revenue_forecast.py');

      console.log('[ML Pipeline] Generando proyección de ingresos del siguiente mes...');
      const out4 = await runPythonScript('predict_revenue_forecast.py');

      return {
        step1_train_reorder: out1.stdout,
        step2_predict_reorder: out2.stdout,
        step3_train_revenue: out3.stdout,
        step4_predict_revenue: out4.stdout
      };
    }, triggeredBy);

    if (jobResult.alreadyRunning) {
      console.log('[ML Pipeline] Entrenamiento ya en progreso. Omitiendo ciclo...');
      return { ok: false, skipped: true, message: jobResult.message };
    }

    return { ok: true, jobId: jobResult.jobId };
  } catch (err) {
    console.error('❌ [ML Pipeline] Falló el inicio del pipeline automático:', err.message);
    return { ok: false, error: err.message };
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
