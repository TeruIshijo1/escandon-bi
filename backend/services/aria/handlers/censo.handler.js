'use strict';

const { getRemoteDb } = require('../../../config/remote-db');

async function queryCensoCamas() {
  try {
    const pool = await getRemoteDb();
    
    const bedsResult = await pool.request().query(`
      SELECT DISTINCT RoomCode, RoomName 
      FROM V_MRPT 
      WHERE RoomName LIKE '%CAMA%' 
        AND RoomName IS NOT NULL
        AND RoomName NOT LIKE '%VIRTUAL%' 
        AND RoomName NOT LIKE '%VIRT%' 
        AND RoomCode NOT LIKE '%VIRT%'
    `);
    const allRealBeds = bedsResult.recordset || [];
    const totalBeds = allRealBeds.length;

    const occupiedResult = await pool.request().query(`
      WITH CTE AS (
        SELECT 
          V.RoomCode AS Cama, 
          V.RoomName AS Area,
          V.FullName AS Paciente, 
          PR.FullName AS Medico,
          ROW_NUMBER() OVER(PARTITION BY V.RoomCode ORDER BY PC.Date DESC) as rn
        FROM PC
        JOIN V_MRPT V ON PC.PTNum = V.PTNum
        LEFT JOIN PR ON PC.PRNum = PR.PRNum
        WHERE PC.PC_ST = 'OP' 
          AND PC.PCType IN ('IP', 'ER')
          AND PC.MedicalDischargeDate IS NULL
          AND V.RoomCode IS NOT NULL
          AND V.RoomName NOT LIKE '%VIRTUAL%'
          AND V.RoomName NOT LIKE '%VIRT%'
          AND V.RoomCode NOT LIKE '%VIRT%'
      )
      SELECT Cama, Area, Paciente, Medico
      FROM CTE WHERE rn = 1
    `);

    const ocupadas = occupiedResult.recordset || [];
    const ocupadasCount = ocupadas.length;
    const libresCount = Math.max(0, totalBeds - ocupadasCount);
    const porcentaje = totalBeds > 0 ? Math.round((ocupadasCount / totalBeds) * 100) : 0;

    return {
      topic: 'Ocupación de Camas Físicas',
      answer: `Actualmente el hospital cuenta con un censo de **${totalBeds} camas físicas reales** (excluyendo camas virtuales). Se registra una ocupación del **${porcentaje}%** con **${ocupadasCount} camas ocupadas** y **${libresCount} disponibles**.`,
      kpis: [
        { label: 'Total Camas Físicas', value: totalBeds },
        { label: 'Ocupadas', value: ocupadasCount, color: '#004687' },
        { label: 'Disponibles', value: libresCount, color: '#16A34A' },
        { label: '% Ocupación', value: `${porcentaje}%`, color: porcentaje > 85 ? '#DC2626' : '#0088C9' },
      ],
      table: {
        headers: ['Cama', 'Área', 'Paciente Hospedado', 'Médico Tratante'],
        rows: ocupadas.slice(0, 8).map(r => [r.Cama, r.Area || 'Hospitalización', r.Paciente || 'Sin Nombre', r.Medico || 'Sin Asignar']),
      },
    };
  } catch (err) {
    return {
      topic: 'Ocupación de Camas',
      answer: 'Error al consultar censo de camas: ' + err.message,
    };
  }
}

module.exports = queryCensoCamas;
