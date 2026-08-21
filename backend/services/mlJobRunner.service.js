'use strict';

const { exec } = require('child_process');
const path = require('path');
const { pool } = require('../config/pg-db');

const ML_DIR = path.join(__dirname, '..', 'ml');

// Conjunto de jobs en ejecución activa para control de concurrencia / mutex
const activeRunningJobs = new Set();

/**
 * Verifica si un job específico o el pipeline completo está en ejecución activa.
 * Consulta tanto la memoria de Node como la tabla ml_job_runs (para sobrevivir reinicios del servidor).
 * @param {string} jobName
 * @returns {Promise<boolean>}
 */
async function isJobRunning(jobName) {
  // 1. Verificación rápida en memoria
  if (activeRunningJobs.has('FULL_PIPELINE')) return true;
  if (jobName === 'FULL_PIPELINE' && activeRunningJobs.size > 0) return true;
  if (activeRunningJobs.has(jobName)) return true;

  // 2. Verificación en base de datos para jobs zombie/activos (ej. si Node se reinicia)
  // Ignoramos jobs RUNNING que llevan más de 60 minutos (posibles zombies si Node crasheó duro)
  try {
    const res = await pool.query(`
      SELECT 1 FROM ml_job_runs 
      WHERE (job_name = $1 OR job_name = 'FULL_PIPELINE' OR $1 = 'FULL_PIPELINE') 
        AND status = 'RUNNING' 
        AND started_at > NOW() - INTERVAL '60 minutes'
    `, [jobName]);
    return res.rowCount > 0;
  } catch (dbErr) {
    console.error('[ML JobRunner] Error consultando estado de job en BD:', dbErr.message);
    return false;
  }
}

/**
 * Ejecuta un script de Python en el directorio ml/
 * @param {string} scriptName Nombre del archivo .py
 * @returns {Promise<{ stdout: string, stderr: string, duration: number }>}
 */
function runPythonScript(scriptName) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(ML_DIR, scriptName);
    console.log(`[ML JobRunner] Ejecutando python "${scriptPath}"...`);
    const startedAt = Date.now();

    exec(`python "${scriptPath}"`, { timeout: 30 * 60 * 1000 }, (error, stdout, stderr) => {
      const duration = (Date.now() - startedAt) / 1000;
      if (stdout) console.log(`[ML JobRunner] stdout (${scriptName}):\n${stdout}`);
      if (stderr) console.error(`[ML JobRunner] stderr (${scriptName}):\n${stderr}`);

      if (error) {
        console.error(`[ML JobRunner] Error en ${scriptName} tras ${duration.toFixed(1)}s:`, error.message);
        const err = new Error(error.message);
        err.stdout = stdout;
        err.stderr = stderr;
        err.duration = duration;
        return reject(err);
      }

      console.log(`[ML JobRunner] ${scriptName} completado en ${duration.toFixed(1)}s.`);
      resolve({ stdout: stdout || '', stderr: stderr || '', duration });
    });
  });
}

/**
 * Registra y ejecuta un Job de Machine Learning con trazabilidad en PostgreSQL y control de concurrencia.
 * @param {string} jobName Nombre identificador del job (ej. 'REVENUE_FORECAST', 'REORDER_RISK', 'FULL_PIPELINE')
 * @param {Function} runnerFn Función asíncrona que contiene la lógica del pipeline
 * @param {string} triggeredBy Usuario o sistema que detonó la corrida
 * @param {object} options Opciones de ejecución { waitForCompletion: boolean }
 * @returns {Promise<{ ok: boolean, jobId?: number, status: string, message: string, alreadyRunning?: boolean, duration_seconds?: number, stdout?: string, stderr?: string, error_message?: string }>}
 */
async function startJob(jobName, runnerFn, triggeredBy = 'SYSTEM', options = {}) {
  const { waitForCompletion = false } = options;

  if (await isJobRunning(jobName)) {
    console.warn(`⚠️ [ML JobRunner] Intento de ejecución solapada para ${jobName}. Omitiendo...`);
    return {
      ok: false,
      alreadyRunning: true,
      jobName,
      status: 'RUNNING',
      message: `El proceso ${jobName} ya se encuentra en ejecución activa. Espera a que termine.`
    };
  }

  // Activar lock de concurrencia
  activeRunningJobs.add(jobName);

  let jobId;
  try {
    const insertRes = await pool.query(`
      INSERT INTO ml_job_runs (job_name, status, triggered_by, started_at)
      VALUES ($1, 'RUNNING', $2, CURRENT_TIMESTAMP)
      RETURNING job_id, started_at
    `, [jobName, triggeredBy]);
    jobId = insertRes.rows[0].job_id;
  } catch (err) {
    activeRunningJobs.delete(jobName);
    throw err;
  }

  const startedAt = Date.now();

  const executeTask = async () => {
    try {
      const result = await runnerFn();
      const duration = (Date.now() - startedAt) / 1000;
      const stdout = (result && result.stdout) ? result.stdout : (typeof result === 'string' ? result : JSON.stringify(result || 'OK'));

      await pool.query(`
        UPDATE ml_job_runs
        SET status = 'SUCCESS',
            finished_at = CURRENT_TIMESTAMP,
            duration_seconds = $1,
            stdout = $2
        WHERE job_id = $3
      `, [duration, stdout, jobId]);

      console.log(`✅ [ML JobRunner] Job ${jobName} (#${jobId}) finalizado con éxito en ${duration.toFixed(1)}s.`);
      return {
        ok: true,
        jobId,
        jobName,
        status: 'SUCCESS',
        duration_seconds: duration,
        stdout,
        message: `Job ${jobName} completado exitosamente.`
      };
    } catch (err) {
      const duration = (Date.now() - startedAt) / 1000;
      const stdout = err.stdout || '';
      const stderr = err.stderr || err.stack || '';
      const errorMsg = err.message || 'Error desconocido durante la ejecución del job';

      await pool.query(`
        UPDATE ml_job_runs
        SET status = 'ERROR',
            finished_at = CURRENT_TIMESTAMP,
            duration_seconds = $1,
            stdout = $2,
            stderr = $3,
            error_message = $4
        WHERE job_id = $5
      `, [duration, stdout, stderr, errorMsg, jobId]);

      console.error(`❌ [ML JobRunner] Job ${jobName} (#${jobId}) falló tras ${duration.toFixed(1)}s:`, errorMsg);
      return {
        ok: false,
        jobId,
        jobName,
        status: 'ERROR',
        duration_seconds: duration,
        stdout,
        stderr,
        error_message: errorMsg,
        message: `Fallo en job ${jobName}: ${errorMsg}`
      };
    } finally {
      // Liberar lock de concurrencia siempre al terminar
      activeRunningJobs.delete(jobName);
    }
  };

  if (waitForCompletion) {
    return await executeTask();
  } else {
    // Disparar en segundo plano sin esperar
    executeTask();
    return {
      ok: true,
      jobId,
      jobName,
      status: 'RUNNING',
      message: `Job ${jobName} iniciado en segundo plano (#${jobId}).`
    };
  }
}

/**
 * Obtiene el estado del último job ejecutado para un nombre dado.
 * @param {string} jobName
 */
async function getLatestJobStatus(jobName) {
  const res = await pool.query(`
    SELECT 
      job_id,
      job_name,
      status,
      triggered_by,
      started_at,
      finished_at,
      duration_seconds,
      error_message,
      stdout,
      stderr
    FROM ml_job_runs
    WHERE job_name = $1
    ORDER BY started_at DESC
    LIMIT 1
  `, [jobName]);

  return res.rows[0] || null;
}

/**
 * Obtiene el estado de un job específico por ID.
 * @param {number} jobId
 */
async function getJobById(jobId) {
  const res = await pool.query(`
    SELECT * FROM ml_job_runs WHERE job_id = $1
  `, [jobId]);

  return res.rows[0] || null;
}

/**
 * Obtiene el historial de ejecuciones de un job.
 * @param {string} jobName
 * @param {number} limit
 */
async function getJobHistory(jobName, limit = 10) {
  const res = await pool.query(`
    SELECT 
      job_id,
      job_name,
      status,
      triggered_by,
      started_at,
      finished_at,
      duration_seconds,
      error_message
    FROM ml_job_runs
    WHERE job_name = $1
    ORDER BY started_at DESC
    LIMIT $2
  `, [jobName, limit]);

  return res.rows;
}

module.exports = {
  isJobRunning,
  runPythonScript,
  startJob,
  getLatestJobStatus,
  getJobById,
  getJobHistory
};
