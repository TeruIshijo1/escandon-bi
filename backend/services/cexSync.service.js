'use strict';

const { pool } = require('../config/pg-db');

/* Sincroniza desde dw_vertical_consultas_prog hacia cex_citas y cex_pacientes */
async function syncCexFromDW() {
  const client = await pool.connect();
  try {
    // Asegurar que las columnas existan en la BD
    await client.query(`
      ALTER TABLE dw_vertical_consultas_prog ADD COLUMN IF NOT EXISTS fechacreacion TIMESTAMP WITH TIME ZONE;
      ALTER TABLE dw_vertical_consulta_dia ADD COLUMN IF NOT EXISTS fechacreacion TIMESTAMP WITH TIME ZONE;
      ALTER TABLE cex_citas ADD COLUMN IF NOT EXISTS fechacreacion TIMESTAMP WITH TIME ZONE;
    `).catch(() => {});

    await client.query('BEGIN');

    const res = await client.query(`
      SELECT 
        no_cita, 
        nopaciente, 
        paciente, 
        desdefecha, 
        fechacreacion,
        medico, 
        especialidad, 
        pcap_st_descripcion,
        ps,
        comentarios
      FROM dw_vertical_consultas_prog
      WHERE desdefecha >= CURRENT_TIMESTAMP - INTERVAL '60 days' OR fechacreacion >= CURRENT_TIMESTAMP - INTERVAL '60 days'
    `);
    
    let insertadosPacientes = 0;
    let upsertsCitas = 0;

    if (process.env.NODE_ENV !== 'test') {
      const patients = await client.query(`
        WITH source AS (
          SELECT DISTINCT ON (nopaciente)
            nopaciente::text AS no_expediente,
            COALESCE(NULLIF(BTRIM(paciente), ''), 'Sin Nombre') AS nombre_completo
          FROM dw_vertical_consultas_prog
          WHERE (desdefecha >= CURRENT_TIMESTAMP - INTERVAL '60 days' OR fechacreacion >= CURRENT_TIMESTAMP - INTERVAL '60 days')
            AND nopaciente IS NOT NULL
            AND BTRIM(nopaciente::text) <> ''
            AND nopaciente <> 0
          ORDER BY nopaciente, fechacreacion DESC NULLS LAST, desdefecha DESC NULLS LAST, no_cita DESC
        )
        INSERT INTO cex_pacientes (NoExpediente, NombreCompleto, Origen, ModificadoPor)
        SELECT no_expediente, nombre_completo, 'VERTICAL', 'SYSTEM_SYNC'
        FROM source
        ON CONFLICT (NoExpediente) DO NOTHING
        RETURNING NoExpediente
      `);
      insertadosPacientes = patients.rowCount || 0;

      const citas = await client.query(`
        WITH source AS (
          SELECT DISTINCT ON (no_cita)
            no_cita::text AS cita_origen_id,
            nopaciente::text AS no_expediente,
            desdefecha AS fecha_hora_cita,
            fechacreacion AS fecha_creacion,
            medico,
            especialidad,
            CASE
              WHEN LOWER(COALESCE(pcap_st_descripcion, '')) LIKE '%cancelad%'
                OR LOWER(COALESCE(pcap_st_descripcion, '')) LIKE '%cancelar%' THEN 'CANCELADA'
              WHEN LOWER(COALESCE(pcap_st_descripcion, '')) LIKE '%procesada%'
                OR LOWER(COALESCE(pcap_st_descripcion, '')) LIKE '%llegó%' THEN 'ASISTIDA'
              WHEN desdefecha <= CURRENT_TIMESTAMP - INTERVAL '4 hours' THEN 'NO_ASISTIO'
              ELSE 'PROGRAMADA'
            END AS estado,
            ps AS tipo_consulta
          FROM dw_vertical_consultas_prog
          WHERE (desdefecha >= CURRENT_TIMESTAMP - INTERVAL '60 days' OR fechacreacion >= CURRENT_TIMESTAMP - INTERVAL '60 days')
            AND no_cita IS NOT NULL
            AND nopaciente IS NOT NULL
            AND no_cita <> 0
            AND nopaciente <> 0
          ORDER BY no_cita, fechacreacion DESC NULLS LAST, desdefecha DESC NULLS LAST
        )
        INSERT INTO cex_citas (
          CitaOrigenId, NoExpediente, FechaHoraCita, FechaCreacion, Medico, Especialidad,
          Estado, Origen, ModificadoPor, TipoConsulta
        )
        SELECT cita_origen_id, no_expediente, fecha_hora_cita, fecha_creacion, medico, especialidad,
          estado, 'VERTICAL', 'SYSTEM_SYNC', tipo_consulta
        FROM source
        ON CONFLICT (CitaOrigenId) DO UPDATE SET
          FechaHoraCita = EXCLUDED.FechaHoraCita,
          FechaCreacion = COALESCE(EXCLUDED.FechaCreacion, cex_citas.FechaCreacion),
          Medico = EXCLUDED.Medico,
          Especialidad = EXCLUDED.Especialidad,
          TipoConsulta = EXCLUDED.TipoConsulta,
          Estado = EXCLUDED.Estado
        RETURNING CitaId
      `);
      upsertsCitas = citas.rowCount || 0;
    } else {
      for (const row of res.rows) {
      if (!row.no_cita || !row.nopaciente) continue;
      
      const noExpediente = row.nopaciente.toString();
      const citaOrigenId = row.no_cita.toString();
      const nombrePaciente = row.paciente || 'Sin Nombre';

      const pacRes = await client.query(`
        INSERT INTO cex_pacientes (NoExpediente, NombreCompleto, Origen, ModificadoPor)
        VALUES ($1, $2, 'VERTICAL', 'SYSTEM_SYNC')
        ON CONFLICT (NoExpediente) DO NOTHING
        RETURNING NoExpediente
      `, [noExpediente, nombrePaciente]);
      
      if (pacRes.rowCount > 0) insertadosPacientes++;
      
      // Mapear estado VERTICAL -> LOCAL
      let estadoVertical = 'PROGRAMADA';
      const descEstado = (row.pcap_st_descripcion || '').toLowerCase();
      
      if (descEstado.includes('cancelad') || descEstado.includes('cancelar')) {
        estadoVertical = 'CANCELADA';
      } else if (descEstado.includes('procesada') || descEstado.includes('llegó')) {
        estadoVertical = 'ASISTIDA';
      } else {
        if (row.desdefecha) {
          const citaDate = new Date(row.desdefecha);
          const now = new Date();
          const hoursPassed = (now - citaDate) / (1000 * 60 * 60);
           
          if (hoursPassed >= 4) {
            estadoVertical = 'NO_ASISTIO';
          }
        }
      }
      
      // Upsert de Cita
      const citaRes = await client.query(`
        INSERT INTO cex_citas (
          CitaOrigenId, NoExpediente, FechaHoraCita, FechaCreacion, Medico, Especialidad, Estado, Origen, ModificadoPor, TipoConsulta
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'VERTICAL', 'SYSTEM_SYNC', $8)
        ON CONFLICT (CitaOrigenId) DO UPDATE SET
          FechaHoraCita = EXCLUDED.FechaHoraCita,
          FechaCreacion = COALESCE(EXCLUDED.FechaCreacion, cex_citas.FechaCreacion),
          Medico = EXCLUDED.Medico,
          Especialidad = EXCLUDED.Especialidad,
          TipoConsulta = EXCLUDED.TipoConsulta,
          Estado = EXCLUDED.Estado
        RETURNING CitaId
      `, [
        citaOrigenId,
        noExpediente,
        row.desdefecha,
        row.fechacreacion,
        row.medico,
        row.especialidad,
        estadoVertical,
        row.ps
      ]);

      if (citaRes.rowCount > 0) upsertsCitas++;
      }
    }
    
    await client.query('COMMIT');
    console.log(`[CEX Sync] Sincronizados ${upsertsCitas} citas y ${insertadosPacientes} pacientes nuevos desde DW.`);
    return { upsertsCitas, insertadosPacientes };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[CEX Sync] Error en sincronización:', error);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  syncCexFromDW
};
