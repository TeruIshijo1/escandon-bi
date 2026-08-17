'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../config/pg-db');
const { authenticate, authorizeCapability } = require('../middleware/auth.middleware');
const { syncCexFromDW } = require('../services/cexSync.service');

const ESTADOS_VALIDOS = ['PROGRAMADA', 'ASISTIDA', 'CANCELADA', 'NO_ASISTIO'];

// Todos los endpoints de CEX requieren el rol/capability adecuado
router.use(authenticate);

/**
 * POST /api/cex/sync
 * Fuerza la sincronización de la agenda desde VERTICAL
 */
router.post('/sync', authorizeCapability('gestionCEX'), async (req, res, next) => {
  try {
    const result = await syncCexFromDW();
    res.json({ ok: true, message: 'Sincronización completada', result });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/cex/agenda
 * Obtiene las citas para la agenda de hoy o de un rango de fechas.
 */
router.get('/agenda', authorizeCapability('verCEX'), async (req, res, next) => {
  try {
    let { start, end, live } = req.query;

    if (live === '1') {
      await syncCexFromDW().catch(e => console.warn('Sync en vivo falló', e));
    }

    // Por defecto: solo el día de hoy (evita traer todo el histórico)
    const today = new Date().toISOString().split('T')[0];
    if (!start) start = today;
    if (!end) end = today;
    if (end.length === 10) end += ' 23:59:59';

    let query = `
      SELECT c.*, p.NombreCompleto as NombrePaciente, 
             COALESCE(NULLIF(TRIM(c.Consultorio), ''), dw.articulo) as consultoriofinal,
             COALESCE(NULLIF(TRIM(cons.Diagnostico), ''), dw.dx_description_es) as diagnosticofinal,
             COALESCE(NULLIF(TRIM(c.Notas), ''), dw.comentarios) as notasfinal,
             COALESCE(NULLIF(TRIM(p.Telefonos), ''), CONCAT_WS(' ', NULLIF(TRIM(dw.telefono_1), ''), NULLIF(TRIM(dw.celular_2), ''))) as telefonosfinal,
             c.TipoConsulta,
             dw.edad_anios,
             dw.edad_mes,
             dw.genero,
             dw.consultas_previas,
             dw.convenio
      FROM cex_citas c
      LEFT JOIN dw_vertical_consultas_prog dw ON c.CitaOrigenId = dw.no_cita::VARCHAR
      LEFT JOIN cex_pacientes p ON c.NoExpediente = p.NoExpediente
      LEFT JOIN cex_consultas cons ON c.CitaId = cons.CitaId
      WHERE c.FechaHoraCita >= $1 AND c.FechaHoraCita <= $2
    `;
    const values = [start, end];

    query += ' ORDER BY c.FechaHoraCita ASC';

    const result = await pool.query(query, values);
    const data = result.rows.map(r => ({
      ...r,
      consultorio: r.consultoriofinal || r.consultorio,
      diagnostico: r.diagnosticofinal || r.diagnostico,
      notas: r.notasfinal || r.notas,
      telefonos: r.telefonosfinal || r.telefonos,
      edad_anios: r.edad_anios,
      edad_mes: r.edad_mes,
      genero: r.genero,
      consultas_previas: r.consultas_previas,
      convenio: r.convenio
    }));
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/cex/pacientes
 * Búsqueda de pacientes
 */
router.get('/pacientes', authorizeCapability('verCEX'), async (req, res, next) => {
  try {
    const { search } = req.query;
    let query = 'SELECT * FROM cex_pacientes';
    const values = [];

    if (search) {
      values.push(`%${search.toUpperCase()}%`);
      query += ` WHERE UPPER(NombreCompleto) LIKE $1 OR NoExpediente LIKE $1`;
    }

    query += ' ORDER BY NombreCompleto ASC LIMIT 50';

    const result = await pool.query(query, values);
    res.json({ ok: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/cex/citas
 * Crea una cita local
 */
router.post('/citas', authorizeCapability('gestionCEX'), async (req, res, next) => {
  try {
    const { NoExpediente, FechaHoraCita, Medico, Especialidad, Consultorio, Notas } = req.body;
    const ModificadoPor = req.user.username;

    if (!NoExpediente || !FechaHoraCita) {
      return res.status(400).json({ error: 'NoExpediente y FechaHoraCita son obligatorios' });
    }

    // Asegurar que el paciente exista (si no, se crea como LOCAL para no violar la FK)
    const pacienteExiste = await pool.query('SELECT NoExpediente FROM cex_pacientes WHERE NoExpediente = $1', [NoExpediente]);
    if (pacienteExiste.rowCount === 0) {
      await pool.query(`
        INSERT INTO cex_pacientes (NoExpediente, NombreCompleto, Origen, ModificadoPor)
        VALUES ($1, $2, 'LOCAL', $3)
        ON CONFLICT (NoExpediente) DO NOTHING
      `, [NoExpediente, req.body.NombreCompleto || 'Paciente pendiente de registro', ModificadoPor]);
    }

    const result = await pool.query(`
      INSERT INTO cex_citas (NoExpediente, FechaHoraCita, Medico, Especialidad, Consultorio, Notas, Origen, ModificadoPor)
      VALUES ($1, $2, $3, $4, $5, $6, 'LOCAL', $7)
      RETURNING *
    `, [NoExpediente, FechaHoraCita, Medico, Especialidad, Consultorio, Notas, ModificadoPor]);

    // Registrar en bitácora
    await pool.query(`
      INSERT INTO cex_bitacora (CitaId, Accion, EstadoNuevo, Detalles, Usuario)
      VALUES ($1, 'CREACION', 'PROGRAMADA', 'Creación de cita local', $2)
    `, [result.rows[0].citaid, ModificadoPor]);

    res.json({ ok: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/cex/citas/:id/estado
 * Actualiza el estado de una cita
 */
router.patch('/citas/:id/estado', authorizeCapability('gestionCEX'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { Estado } = req.body;
    const ModificadoPor = req.user.username;

    if (!ESTADOS_VALIDOS.includes(Estado)) {
      return res.status(400).json({ error: `Estado inválido. Válidos: ${ESTADOS_VALIDOS.join(', ')}` });
    }

    // Obtener estado anterior
    const citaActual = await pool.query('SELECT Estado FROM cex_citas WHERE CitaId = $1', [id]);
    if (citaActual.rowCount === 0) return res.status(404).json({ error: 'Cita no encontrada' });
    const estadoAnterior = citaActual.rows[0].estado;

    const result = await pool.query(`
      UPDATE cex_citas 
      SET Estado = $1, ModificadoPor = $2, FechaModificacion = CURRENT_TIMESTAMP
      WHERE CitaId = $3
      RETURNING *
    `, [Estado, ModificadoPor, id]);

    // Registrar en bitácora
    await pool.query(`
      INSERT INTO cex_bitacora (CitaId, Accion, EstadoAnterior, EstadoNuevo, Detalles, Usuario)
      VALUES ($1, 'CAMBIO_ESTADO', $2, $3, 'Cambio de estado manual', $4)
    `, [id, estadoAnterior, Estado, ModificadoPor]);

    res.json({ ok: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/cex/citas/:id/notas
 * Actualiza las notas y diagnóstico directamente
 */
router.patch('/citas/:id/notas', authorizeCapability('gestionCEX'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { Notas, Diagnostico } = req.body;

    await pool.query('UPDATE cex_citas SET Notas = $1 WHERE CitaId = $2', [Notas, id]);

    const exists = await pool.query('SELECT ConsultaId FROM cex_consultas WHERE CitaId = $1 LIMIT 1', [id]);
    if (exists.rowCount > 0) {
      await pool.query('UPDATE cex_consultas SET Diagnostico = $1 WHERE CitaId = $2', [Diagnostico, id]);
    } else {
      await pool.query(`INSERT INTO cex_consultas (CitaId, Diagnostico, RegistradoPor) VALUES ($1, $2, $3)`, [id, Diagnostico, req.user.username]);
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/cex/consultas
 * Registra una atención médica
 */
router.post('/consultas', authorizeCapability('gestionCEX'), async (req, res, next) => {
  try {
    const { CitaId, NoExpediente, SignosVitales, MotivoConsulta, Diagnostico, NotasAtencion, ProximaCita } = req.body;
    const RegistradoPor = req.user.username;

    if (!CitaId) return res.status(400).json({ error: 'CitaId es obligatorio' });

    // Asumimos que el médico es el mismo de la cita o el usuario actual
    const citaActual = await pool.query('SELECT Medico, NoExpediente FROM cex_citas WHERE CitaId = $1', [CitaId]);
    if (citaActual.rowCount === 0) return res.status(404).json({ error: 'Cita no encontrada' });
    const Medico = citaActual.rows[0].medico || req.user.nombre;
    const noExpCita = citaActual.rows[0].noexpediente;

    const result = await pool.query(`
      INSERT INTO cex_consultas (CitaId, NoExpediente, SignosVitales, MotivoConsulta, Diagnostico, NotasAtencion, ProximaCita, Medico, RegistradoPor)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [CitaId, noExpCita, JSON.stringify(SignosVitales || {}), MotivoConsulta, Diagnostico, NotasAtencion, ProximaCita, Medico, RegistradoPor]);

    // Automáticamente marcar la cita como ASISTIDA
    await pool.query('UPDATE cex_citas SET Estado = $1 WHERE CitaId = $2', ['ASISTIDA', CitaId]);

    res.json({ ok: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/cex/reportes
 * Reportes simples
 */
router.get('/reportes', authorizeCapability('verCEX'), async (req, res, next) => {
  try {
    let { start, end } = req.query;

    // Por defecto: solo el día de hoy
    const today = new Date().toISOString().split('T')[0];
    if (!start) start = today;
    if (!end) end = today;
    if (end.length === 10) end += ' 23:59:59';

    const query = `
      SELECT Estado, COUNT(*) as Total
      FROM cex_citas
      WHERE FechaHoraCita >= $1 AND FechaHoraCita <= $2
      GROUP BY Estado
    `;

    const result = await pool.query(query, [start, end]);
    res.json({ ok: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
