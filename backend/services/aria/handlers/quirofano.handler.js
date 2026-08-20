'use strict';

const { pool: pgPool } = require('../../../config/pg-db');
const { connectRemoteDB } = require('../../../config/remote-db');
const sapInventoryService = require('../../sapInventory.service');

/**
 * Handler 1: Cirugías del momento / Agenda Quirúrgica de hoy
 */
async function queryCirugiasDelMomento() {
  try {
    let events = [];

    // 1. Intentar consultar PostgreSQL DW (sincronizado)
    try {
      const pgRes = await pgPool.query(`
        SELECT 
          pcfr_num AS "PCFRNum",
          paciente AS "Paciente",
          quirofano AS "Quirofano",
          fecha_inicio AS "FechaInicio",
          fecha_fin AS "FechaFin",
          medicos AS "Medicos",
          procedimientos AS "Procedimiento"
        FROM dw_quirofano_eventos
        WHERE fecha_inicio >= NOW() - INTERVAL '3 days'
        ORDER BY fecha_inicio DESC
        LIMIT 20;
      `);
      events = pgRes.rows || [];
    } catch (pgErr) {
      console.warn('[ARIA Quirófano] DW Postgres no disponible, consultando SQL Server live:', pgErr.message);
    }

    // 2. Fallback a SQL Server en vivo si DW está vacío
    if (events.length === 0) {
      const remotePool = await connectRemoteDB();
      const dbRes = await remotePool.request().query(`
        SELECT TOP 20
          q.PCFRNum,
          ISNULL(NULLIF(TRIM(q.Paciente), ''), 'PACIENTE DESCONOCIDO') AS Paciente,
          ISNULL(NULLIF(TRIM(q.Quirofano), ''), 'QUIROFANO S/N') AS Quirofano,
          q.FechaInicio,
          q.FechaFin,
          ISNULL(NULLIF(TRIM(q.Medicos), ''), 'MEDICO NO ESPECIFICADO') AS Medicos,
          ISNULL(NULLIF(TRIM(q.Procedimientos), ''), 'PROCEDIMIENTO SIN ESPECIFICAR') AS Procedimiento
        FROM UDR_USOQX q
        ORDER BY q.FechaInicio DESC
      `);
      events = dbRes.recordset || [];
    }

    if (events.length === 0) {
      return {
        topic: 'Quirófano: Cirugías del Momento',
        answer: 'No hay cirugías registradas recientemente en la agenda de Quirófano.',
      };
    }

    let enCurso = 0;
    let recsCount = events.length;

    const tableRows = events.map(e => {
      let fechaStr = '';
      if (e.FechaInicio) {
        try {
          const d = new Date(e.FechaInicio);
          fechaStr = `${d.toLocaleDateString('es-MX')} ${d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;
        } catch (err) {
          fechaStr = String(e.FechaInicio).slice(0, 16);
        }
      }

      const estado = e.FechaFin ? 'COMPLETADA' : 'EN CURSO / RECIENTE';
      if (estado === 'EN CURSO / RECIENTE') enCurso++;

      return [
        e.Quirofano || 'QX S/N',
        e.Paciente || 'Sin Nombre',
        e.Procedimiento || 'General',
        e.Medicos || 'No especificado',
        fechaStr,
        estado
      ];
    });

    const kpis = [
      { label: 'Cirugías Recientes/Hoy', value: recsCount, color: '#004687' },
      { label: 'En Curso / Recientes', value: enCurso, color: '#16A34A' }
    ];

    return {
      topic: 'Quirófano: Cirugías del Momento',
      answer: `Se encontraron **${recsCount} cirugías recientes/programadas** en la agenda de Quirófano. A continuación se muestran los procedimientos registrados en tiempo real:`,
      kpis,
      table: {
        headers: ['Quirófano', 'Paciente', 'Procedimiento', 'Médico', 'Fecha Inicio', 'Estado'],
        rows: tableRows.slice(0, 10)
      }
    };
  } catch (err) {
    console.error('Error en queryCirugiasDelMomento:', err);
    return {
      topic: 'Cirugías del Momento',
      answer: 'No se pudo obtener la información de Quirófano en tiempo real: ' + err.message,
    };
  }
}

/**
 * Handler 2: Kits Quirúrgicos y Materiales
 */
async function queryKitsQuirurgicos() {
  try {
    const pgRes = await pgPool.query(`
      SELECT 
        cirugia AS "Cirugia",
        num_cirugias AS "NumCirugias",
        jsonb_array_length(items_json) AS "ItemsCount",
        items_json AS "Items"
      FROM dw_quirofano_kits_cache
      ORDER BY num_cirugias DESC
      LIMIT 15;
    `);

    const kits = pgRes.rows || [];

    if (kits.length === 0) {
      return {
        topic: 'Quirófano: Kits Quirúrgicos',
        answer: 'No hay datos agregados de kits quirúrgicos en la memoria del sistema.',
      };
    }

    const tableRows = kits.map(k => {
      const itemsList = Array.isArray(k.Items) 
        ? k.Items.slice(0, 3).map(i => `${i.Medicamento} (${i.PromedioPiezas} pzas)`).join(', ') + (k.Items.length > 3 ? '...' : '')
        : 'Materiales varios';
      return [
        k.Cirugia,
        k.NumCirugias,
        k.ItemsCount,
        itemsList
      ];
    });

    return {
      topic: 'Quirófano: Kits Quirúrgicos Promedio',
      answer: `Analicé la base de datos de consumos quirúrgicos. Encontré **${kits.length} tipos de cirugías** con kits de insumos parametrizados según su uso histórico:`,
      kpis: [
        { label: 'Tipos de Cirugías', value: kits.length, color: '#004687' },
        { label: 'Procedimiento Principal', value: kits[0]?.Cirugia || 'General', color: '#0088C9' }
      ],
      table: {
        headers: ['Procedimiento Quirúrgico', 'Histórico Cirugías', 'Insumos Promedio', 'Insumos Clave Usados'],
        rows: tableRows
      }
    };
  } catch (err) {
    console.error('Error en queryKitsQuirurgicos:', err);
    return {
      topic: 'Kits Quirúrgicos',
      answer: 'No se pudo obtener la información de kits quirúrgicos: ' + err.message,
    };
  }
}

/**
 * Handler 3: Inventario de Quirófano (QX y QXCR)
 */
async function queryInventarioQuirofano() {
  try {
    if (sapInventoryService.getInventoryCache().length === 0) {
      try {
        await Promise.race([
          sapInventoryService.syncInventoryCache(),
          new Promise(resolve => setTimeout(resolve, 3000))
        ]);
      } catch (e) {
        console.warn('[Quirófano ARIA] SAP sync timeout/error:', e.message);
      }
    }

    const cache = sapInventoryService.getInventoryCache();
    const qxItems = cache.filter(item => item.WhsCode === 'QX' || item.WhsCode === 'QXCR');

    if (qxItems.length === 0) {
      return {
        topic: 'Inventario Quirófano',
        answer: 'No hay insumos registrados actualmente en los almacenes QX o QXCR.',
      };
    }

    let totalStock = 0;
    let totalValor = 0;
    let controladosCount = 0;

    qxItems.forEach(i => {
      const qty = Number(i.QuantityOnStock || 0);
      const price = Number(i.SalesPrice || 0);
      totalStock += qty;
      totalValor += qty * price;
      if (i.WhsCode === 'QXCR') controladosCount++;
    });

    const sortedItems = [...qxItems].sort((a, b) => (b.QuantityOnStock || 0) - (a.QuantityOnStock || 0));

    const tableRows = sortedItems.slice(0, 10).map(i => [
      i.ItemCode || '',
      i.ItemName || 'Insumo Médico',
      i.WhsCode === 'QXCR' ? 'Quirófano Carro Rojo (QXCR)' : 'Almacén Quirófano (QX)',
      Number(i.QuantityOnStock || 0).toLocaleString('es-MX'),
      `$${Number(i.SalesPrice || 0).toLocaleString('es-MX')}`
    ]);

    return {
      topic: 'Inventario de Quirófano (QX / QXCR — Carro Rojo)',
      answer: `El inventario actual del **Almacén Quirófano (QX)** y **Carro Rojo (QXCR)** cuenta con **${qxItems.length} tipos de artículos en stock** sumando **${totalStock.toLocaleString('es-MX')} piezas en existencia**.`,
      kpis: [
        { label: 'Tipos de Insumos', value: qxItems.length, color: '#004687' },
        { label: 'Piezas Totales QX', value: totalStock.toLocaleString('es-MX'), color: '#0088C9' },
        { label: 'Insumos Carro Rojo (QXCR)', value: controladosCount, color: '#DC2626' },
      ],
      table: {
        headers: ['Código', 'Descripción', 'Almacén', 'Stock Actual', 'Precio Unitario'],
        rows: tableRows
      }
    };
  } catch (err) {
    console.error('Error en queryInventarioQuirofano:', err);
    return {
      topic: 'Inventario Quirófano',
      answer: 'No se pudo obtener el inventario de Quirófano: ' + err.message,
    };
  }
}

module.exports = {
  queryCirugiasDelMomento,
  queryKitsQuirurgicos,
  queryInventarioQuirofano
};
