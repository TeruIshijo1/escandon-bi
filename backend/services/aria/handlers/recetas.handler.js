'use strict';

const { connectRemoteDB } = require('../../../config/remote-db');
const sapInventoryService = require('../../sapInventory.service');
const sql = require('mssql');

/**
 * Handler 1: Recetas Pendientes (Cola de despacho en Farmacia)
 */
async function queryRecetasPendientes() {
  try {
    const pool = await connectRemoteDB();
    const dbRes = await pool.request().query(`
      SELECT TOP 100
        i.PCPRITNum AS Id,
        p.PCPRNum AS Requisicion,
        c.PCNum AS Cuenta,
        p.CreatedOn AS FechaSolicitud,
        p.CreatedBy AS UsuarioSolicito,
        t.FullName AS Paciente,
        COALESCE(NULLIF(LTRIM(RTRIM(pr.FullName)), ''), NULLIF(LTRIM(RTRIM(pr.Name)) + ' ' + LTRIM(RTRIM(pr.LastName)), ''), 'NO ESPECIFICADO') AS Medico,
        i.ItemCode AS Codigo,
        ISNULL(i.ItemDescription, 'Material/Medicamento') AS Medicamento,
        i.Quantity AS Solicitado,
        i.Notes AS Indicaciones,
        COALESCE(pcfr_req.FRName, pcfr_req.FRCode, pcfr_act.FRName, pcfr_act.FRCode, NULLIF(LTRIM(RTRIM(c.AuxiliaryField2)), ''), 'Ambulatorio') AS CamaCuarto
      FROM PCPRIT i
      INNER JOIN PCPR p ON i.PCPRNum = p.PCPRNum
      INNER JOIN PC c ON p.PCNum = c.PCNum
      INNER JOIN PT t ON c.PTNum = t.PTNum
      LEFT JOIN PR pr ON p.PR_PC_ID = pr.PRID
      LEFT JOIN dbo.PCFR pcfr_req ON p.PCFRNum = pcfr_req.PCFRNum
      LEFT JOIN dbo.PCFR pcfr_act ON c.PCNum = pcfr_act.PCNum AND pcfr_act.ExitDate IS NULL
      WHERE i.PCPRITNum NOT IN (SELECT PCPRITNum FROM PCPRBT)
      AND p.CreatedOn >= DATEADD(day, -7, GETDATE())
      AND i.ItemCode IS NOT NULL
      AND i.WarehouseCode = 'FAR'
      ORDER BY p.CreatedOn ASC
    `);

    // Filtrar recetas ocultas localmente
    const { pool: pgPool } = require('../../../config/pg-db');
    let hiddenIds = new Set();
    try {
      const hiddenRes = await pgPool.query('SELECT pcprit_num FROM dw_hidden_prescriptions');
      hiddenIds = new Set(hiddenRes.rows.map(r => String(r.pcprit_num)));
    } catch (e) {
      // Ignorar si la tabla no existe
    }

    const inventoryMap = sapInventoryService.getInventoryMap();
    const pendingList = [];

    for (const row of (dbRes.recordset || [])) {
      if (!hiddenIds.has(String(row.Id))) {
        const sapItem = inventoryMap.get(row.Codigo);
        pendingList.push({
          ...row,
          Medicamento: sapItem ? sapItem.ItemName : row.Medicamento,
          StockActual: sapItem ? (sapItem.QuantityOnStock ?? 0) : 0
        });
      }
    }

    if (pendingList.length === 0) {
      return {
        topic: 'Farmacia: Recetas Pendientes',
        answer: '🎉 **¡Excelente! No hay recetas pendientes por surtir en la cola de Farmacia.**',
      };
    }

    const tableRows = pendingList.slice(0, 10).map(r => {
      let fechaStr = '';
      if (r.FechaSolicitud) {
        try {
          const d = new Date(r.FechaSolicitud);
          fechaStr = `${d.toLocaleDateString('es-MX')} ${d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;
        } catch (e) {
          fechaStr = String(r.FechaSolicitud).slice(0, 16);
        }
      }

      return [
        r.CamaCuarto || 'Piso',
        r.Paciente || 'Sin Nombre',
        r.Medicamento || r.Codigo,
        Number(r.Solicitado || 0).toLocaleString('es-MX'),
        Number(r.StockActual || 0).toLocaleString('es-MX'),
        r.Medico || 'Dr. No asignado',
        fechaStr
      ];
    });

    return {
      topic: 'Farmacia: Cola de Recetas Pendientes',
      answer: `Actualmente hay **${pendingList.length} prescripciones médicas pendientes por surtir** en la cola de despacho de Farmacia:`,
      kpis: [
        { label: 'Recetas por Surtir', value: pendingList.length, color: '#DC2626' },
        { label: 'Primera en Cola', value: pendingList[0]?.CamaCuarto || 'Ambulatorio', color: '#004687' }
      ],
      table: {
        headers: ['Cuarto/Cama', 'Paciente', 'Medicamento Solicitado', 'Cant. Solicitada', 'Stock Farmacia', 'Médico Tratante', 'Hora Solicitud'],
        rows: tableRows
      }
    };
  } catch (err) {
    console.error('Error en queryRecetasPendientes:', err);
    return {
      topic: 'Farmacia: Recetas Pendientes',
      answer: 'No se pudo consultar el monitor de recetas pendientes: ' + err.message
    };
  }
}

/**
 * Handler 2: Registro de Salidas de Farmacia con Lote
 */
async function queryLibroControlados() {
  try {
    const pool = await connectRemoteDB();
    const dbRes = await pool.request().query(`
      SELECT TOP 200
        b.CreatedOn AS Fecha,
        t.FullName AS Paciente,
        COALESCE(NULLIF(LTRIM(RTRIM(pr.FullName)), ''), NULLIF(LTRIM(RTRIM(pr.Name)) + ' ' + LTRIM(RTRIM(pr.LastName)), ''), 'NO ESPECIFICADO') AS Medico,
        i.ItemCode AS Codigo,
        ISNULL(i.ItemDescription, 'Material/Medicamento') AS Medicamento,
        b.BatchCode AS Lote,
        b.Quantity AS Cantidad
      FROM PCPRBT b
      INNER JOIN PCPRIT i ON b.PCPRITNum = i.PCPRITNum
      INNER JOIN PCPR p ON i.PCPRNum = p.PCPRNum
      INNER JOIN PC c ON p.PCNum = c.PCNum
      INNER JOIN PT t ON c.PTNum = t.PTNum
      LEFT JOIN PR pr ON p.PR_PC_ID = pr.PRID
      WHERE b.BatchCode IS NOT NULL
      ORDER BY b.CreatedOn DESC
    `);

    const inventoryMap = sapInventoryService.getInventoryMap();
    const rows = (dbRes.recordset || []).map(row => {
      const sapItem = inventoryMap.get(row.Codigo);
      return {
        ...row,
        Medicamento: sapItem ? sapItem.ItemName : row.Medicamento
      };
    });

    if (rows.length === 0) {
      return {
        topic: 'Farmacia: Salidas de Farmacia',
        answer: 'No se encontraron movimientos de salidas registrados en Farmacia.',
      };
    }

    let totalPiezas = 0;
    const tableRows = rows.slice(0, 10).map(r => {
      let fechaStr = '';
      if (r.Fecha) {
        try { fechaStr = new Date(r.Fecha).toISOString().split('T')[0]; } catch (e) { fechaStr = String(r.Fecha).slice(0, 10); }
      }
      const cant = Number(r.Cantidad || 0);
      totalPiezas += cant;

      return [
        fechaStr,
        r.Paciente || 'Sin Nombre',
        r.Medico || 'Sin Asignar',
        r.Medicamento || r.Codigo,
        r.Lote || 'Sin Lote',
        cant.toLocaleString('es-MX')
      ];
    });

    return {
      topic: 'Farmacia: Salidas de Farmacia con Lote',
      answer: `El registro de **Salidas de Farmacia** contiene **${rows.length} dispensaciones con lote** realizadas a pacientes:`,
      kpis: [
        { label: 'Salidas Registradas', value: rows.length, color: '#004687' },
        { label: 'Unidades Dispensadas', value: totalPiezas.toLocaleString('es-MX'), color: '#0088C9' }
      ],
      table: {
        headers: ['Fecha', 'Paciente', 'Médico Autoriza', 'Artículo / Insumo', 'Lote', 'Cantidad'],
        rows: tableRows
      }
    };
  } catch (err) {
    console.error('Error en queryLibroControlados:', err);
    return {
      topic: 'Farmacia: Salidas de Farmacia',
      answer: 'No se pudo consultar el registro de salidas de Farmacia: ' + err.message
    };
  }
}

/**
 * Handler 3: Historial Farmacológico por Paciente
 */
async function queryHistorialFarmacologico(normalizedQuery) {
  try {
    // Extraer posible nombre/apellido del paciente de la consulta
    const terms = normalizedQuery.replace(/(historial|farmacologico|medicamentos?|recetas?|del?|paciente|para|buscar|consulta)/gi, '').trim();

    if (!terms || terms.length < 2) {
      return await queryRecetasPendientes();
    }

    const pool = await connectRemoteDB();
    const dbRes = await pool.request()
      .input('search', sql.VarChar, `%${terms}%`)
      .query(`
        SELECT TOP 100
          b.CreatedOn AS Fecha,
          t.FullName AS Paciente,
          COALESCE(NULLIF(LTRIM(RTRIM(pr.FullName)), ''), NULLIF(LTRIM(RTRIM(pr.Name)) + ' ' + LTRIM(RTRIM(pr.LastName)), ''), 'NO ESPECIFICADO') AS Medico,
          i.ItemCode AS Codigo,
          ISNULL(i.ItemDescription, 'Material/Medicamento') AS Medicamento,
          b.BatchCode AS Lote,
          b.Quantity AS Cantidad
        FROM PCPRBT b
        INNER JOIN PCPRIT i ON b.PCPRITNum = i.PCPRITNum
        INNER JOIN PCPR p ON i.PCPRNum = p.PCPRNum
        INNER JOIN PC c ON p.PCNum = c.PCNum
        INNER JOIN PT t ON c.PTNum = t.PTNum
        LEFT JOIN PR pr ON p.PR_PC_ID = pr.PRID
        WHERE t.FullName LIKE @search
        ORDER BY b.CreatedOn DESC
      `);

    const rows = dbRes.recordset || [];
    if (rows.length === 0) {
      return {
        topic: `Historial Farmacológico: ${terms}`,
        answer: `No encontré historial de medicamentos entregados para el paciente o búsqueda **"${terms}"**.`,
      };
    }

    const inventoryMap = sapInventoryService.getInventoryMap();
    const tableRows = rows.slice(0, 10).map(r => {
      const sapItem = inventoryMap.get(r.Codigo);
      const name = sapItem ? sapItem.ItemName : r.Medicamento;
      let fechaStr = r.Fecha ? String(r.Fecha).slice(0, 10) : '';

      return [
        fechaStr,
        r.Paciente,
        name,
        r.Lote || 'N/A',
        Number(r.Cantidad || 0).toLocaleString('es-MX'),
        r.Medico
      ];
    });

    return {
      topic: `Historial Farmacológico: "${terms}"`,
      answer: `Se encontraron **${rows.length} insumos/medicamentos dispensados** para la búsqueda **"${terms}"**:`,
      kpis: [
        { label: 'Insumos Surtidos', value: rows.length, color: '#004687' }
      ],
      table: {
        headers: ['Fecha', 'Paciente', 'Medicamento Surtido', 'Lote', 'Cantidad', 'Médico Tratante'],
        rows: tableRows
      }
    };
  } catch (err) {
    console.error('Error en queryHistorialFarmacologico:', err);
    return {
      topic: 'Historial Farmacológico',
      answer: 'No se pudo realizar la búsqueda del historial farmacológico: ' + err.message
    };
  }
}

module.exports = {
  queryRecetasPendientes,
  queryLibroControlados,
  querySalidasFarmacia: queryLibroControlados,
  queryHistorialFarmacologico
};
