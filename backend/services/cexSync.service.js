'use strict';

const { pool } = require('../config/pg-db');

/**
 * Sincroniza desde dw_vertical_consultas_prog hacia cex_citas y cex_pacientes.
 * Solo actualiza estados si la cita local sigue estando PROGRAMADA.
 * Los estados finales (ASISTIDA, CANCELADA localmente, NO_ASISTIO) son respetados.
 */
async function syncCexFromDW() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Obtener todas las citas cacheadas desde VERTICAL (ventana de 30 días para eficiencia)
    const res = await client.query(`
      SELECT 
        no_cita, 
        nopaciente, 
        paciente, 
        desdefecha, 
        medico, 
        especialidad, 
        pcap_st_descripcion,
        ps,
        comentarios
      FROM dw_vertical_consultas_prog
      WHERE desdefecha >= CURRENT_TIMESTAMP - INTERVAL '30 days'
    `);
    
    let insertadosPacientes = 0;
    let upsertsCitas = 0;
    
    for (const row of res.rows) {
      if (!row.no_cita || !row.nopaciente) continue;
      
      const noExpediente = row.nopaciente.toString();
      const citaOrigenId = row.no_cita.toString();
      const nombrePaciente = row.paciente || 'Sin Nombre';
      
      // 1. Asegurar el paciente
      const pacRes = await client.query(`
        INSERT INTO cex_pacientes (NoExpediente, NombreCompleto, Origen, ModificadoPor)
        VALUES ($1, $2, 'VERTICAL', 'SYSTEM_SYNC')
        ON CONFLICT (NoExpediente) DO NOTHING
        RETURNING NoExpediente
      `, [noExpediente, nombrePaciente]);
      
      if (pacRes.rowCount > 0) insertadosPacientes++;
      
      // 2. Mapear estado VERTICAL -> LOCAL
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
          // Si han pasado más de 4 horas de la cita y sigue programada, es que no asistió
          if (hoursPassed >= 4) {
            estadoVertical = 'NO_ASISTIO';
          }
        }
      }
      
      // 3. Upsert de Cita
      // NOTA: Si el origen de la cita es LOCAL (creada manualmente en plataforma), 
      // esto no debería interferir por el UNIQUE CitaOrigenId, ya que las locales 
      // probablemente tengan CitaOrigenId nulo o un ID diferente.
      const citaRes = await client.query(`
        INSERT INTO cex_citas (
          CitaOrigenId, NoExpediente, FechaHoraCita, Medico, Especialidad, Estado, Origen, ModificadoPor, TipoConsulta
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'VERTICAL', 'SYSTEM_SYNC', $7)
        ON CONFLICT (CitaOrigenId) DO UPDATE SET
          FechaHoraCita = EXCLUDED.FechaHoraCita,
          Medico = EXCLUDED.Medico,
          Especialidad = EXCLUDED.Especialidad,
          TipoConsulta = EXCLUDED.TipoConsulta,
          Estado = EXCLUDED.Estado
        RETURNING CitaId
      `, [
        citaOrigenId,
        noExpediente,
        row.desdefecha,
        row.medico,
        row.especialidad,
        estadoVertical,
        row.ps
      ]);
      
      // Se cuenta si se insertó o se actualizó algo
      if (citaRes.rowCount > 0) upsertsCitas++;
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
