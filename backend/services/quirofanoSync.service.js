const cron = require('node-cron');
const { connectRemoteDB } = require('../config/remote-db');
const { pool } = require('../config/pg-db');
const sapInventoryService = require('./sapInventory.service');
const { syncQuirofanoRevenues } = require('./quirofanoRevenue.service');

let activeSync, queuedFull;
let activeFull = false;

async function initQuirofanoDW() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dw_quirofano_eventos (
        pcfr_num INT PRIMARY KEY,
        numero_paciente INT,
        paciente VARCHAR(255),
        quirofano VARCHAR(100),
        fecha_inicio TIMESTAMP WITH TIME ZONE,
        fecha_fin TIMESTAMP WITH TIME ZONE,
        medicos TEXT,
        procedimientos TEXT,
        procedimiento_norm TEXT,
        sync_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS dw_quirofano_consumos (
        id SERIAL PRIMARY KEY,
        pcfr_num INT NOT NULL,
        item_code VARCHAR(50) NOT NULL,
        item_description TEXT,
        cantidad NUMERIC(18,4) NOT NULL,
        UNIQUE(pcfr_num, item_code)
      );

      CREATE TABLE IF NOT EXISTS dw_quirofano_kits_cache (
        cirugia_norm TEXT PRIMARY KEY,
        cirugia TEXT,
        num_cirugias INT,
        items_json JSONB,
        sync_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS dw_sap_quirofano_analiticas (
        id SERIAL PRIMARY KEY,
        tipo VARCHAR(50),
        nombre VARCHAR(255),
        ingresos DECIMAL(18,4) DEFAULT 0,
        startdate DATE,
        enddate DATE,
        sync_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tipo, nombre, startdate, enddate)
      );

      CREATE INDEX IF NOT EXISTS idx_qw_ev_fecha ON dw_quirofano_eventos (fecha_inicio DESC);
      CREATE INDEX IF NOT EXISTS idx_qw_ev_proc ON dw_quirofano_eventos (procedimiento_norm);
      CREATE INDEX IF NOT EXISTS idx_qw_cs_pcfr ON dw_quirofano_consumos (pcfr_num);
    `);
    console.log('✅ PostgreSQL DW: Tablas de Quirófano inicializadas.');
  } catch (err) {
    console.error('❌ Error al inicializar tablas DW Quirófano:', err.message);
    throw err;
  }
}

/* Actividad e ingresos conservan estados separados dentro de un mismo ciclo. */
async function runQuirofanoData(options) {
  const report = { status: 'complete', activity: null, revenues: null };
  try {
    report.activity = { status: 'complete', events: await syncQuirofanoActivity({ ...options, fullSync: Boolean(options.fullSync || options.activityFullSync) }) };
  } catch (error) {
    report.activity = { status: 'error', errorCode: error.code || 'QX_ACTIVITY_FAILED' };
    report.status = 'incomplete';
  }
  try {
    report.revenues = await syncQuirofanoRevenues({ fullSync: Boolean(options.fullSync) });
    if (['error', 'incomplete'].includes(report.revenues.status) || report.revenues.errorCode) report.status = 'incomplete';
  } catch (error) {
    report.revenues = { status: 'error', errorCode: error.code || 'QX_REVENUE_FAILED' };
    report.status = 'incomplete';
  }
  const reason = report.activity.status === 'error' ? 'activity_error' : report.revenues.pendingReason || (report.revenues.errorCode ? 'source_error' : null);
  const progress = report.activity.status === 'complete' && ['history_pending', 'refresh_pending'].includes(reason);
  console.log(progress ? '[Sync Quirófano DW] Avance guardado; actualización en curso' : '[Sync Quirófano DW] Ciclo', {
    status: report.status, reason, activity: report.activity.status, events: report.activity.events ?? null,
    revenues: report.revenues.status, completedWindows: report.revenues.completedWindows ?? 0,
    pendingDays: report.revenues.pendingDays ?? null, failedDays: report.revenues.failedDays ?? null,
    errorCode: report.revenues.errorCode || null
  });
  return report;
}

function syncQuirofanoData(options = {}) {
  if (options.fullSync && queuedFull) return queuedFull;
  if (activeSync) {
    if (options.fullSync && !activeFull) {
      const previous = activeSync;
      const queued = previous.catch(() => {}).then(() => startQuirofanoSync({ ...options,fullSync: true }));
      const full = queued.finally(() => { if (queuedFull === full) queuedFull = null; });
      queuedFull = full;
      return full;
    }
    return activeSync;
  }
  if (queuedFull) return queuedFull;
  return startQuirofanoSync(options);
}

function startQuirofanoSync(options) {
  activeFull = Boolean(options.fullSync);
  activeSync = runQuirofanoData(options).finally(() => { activeSync = null; activeFull = false; });
  return activeSync;
}

async function syncQuirofanoActivity(options) {
  try {
    const remotePool = await connectRemoteDB();
    const dateFilter = options.fullSync ? '' : 'WHERE q.FechaInicio >= DATEADD(day, -15, GETDATE())';

    // Obtener eventos de Quirófano desde SQL Server
    const eventsRes = await remotePool.request().query(`
      SELECT 
        q.PCFRNum,
        q.Numero_Paciente,
        ISNULL(NULLIF(TRIM(q.Paciente), ''), 'PACIENTE DESCONOCIDO') AS Paciente,
        ISNULL(NULLIF(TRIM(q.Quirofano), ''), 'QUIROFANO S/N') AS Quirofano,
        q.FechaInicio,
        q.FechaFin,
        ISNULL(NULLIF(TRIM(q.Medicos), ''), 'MEDICO NO ESPECIFICADO') AS Medicos,
        ISNULL(NULLIF(TRIM(q.Procedimientos), ''), 'PROCEDIMIENTO SIN ESPECIFICAR') AS Procedimiento
      FROM UDR_USOQX q
      ${dateFilter}
      ORDER BY q.FechaInicio DESC
    `);

    if (!Array.isArray(eventsRes.recordset)) throw new Error('Vertical no confirmó los eventos de Quirófano.');
    const events = eventsRes.recordset;
    if (events.length === 0) {
      console.log('ℹ️ Sync Quirófano DW: No hay eventos nuevos para sincronizar.');
      return 0;
    }

    // Upsert eventos en PostgreSQL
    for (const e of events) {
      const procNorm = (e.Procedimiento || '').toUpperCase().trim();
      await pool.query(`
        INSERT INTO dw_quirofano_eventos 
          (pcfr_num, numero_paciente, paciente, quirofano, fecha_inicio, fecha_fin, medicos, procedimientos, procedimiento_norm, sync_date)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
        ON CONFLICT (pcfr_num) DO UPDATE SET
          numero_paciente = EXCLUDED.numero_paciente,
          paciente = EXCLUDED.paciente,
          quirofano = EXCLUDED.quirofano,
          fecha_inicio = EXCLUDED.fecha_inicio,
          fecha_fin = EXCLUDED.fecha_fin,
          medicos = EXCLUDED.medicos,
          procedimientos = EXCLUDED.procedimientos,
          procedimiento_norm = EXCLUDED.procedimiento_norm,
          sync_date = CURRENT_TIMESTAMP;
      `, [
        e.PCFRNum, e.Numero_Paciente, e.Paciente, e.Quirofano,
        e.FechaInicio, e.FechaFin, e.Medicos, e.Procedimiento, procNorm
      ]);
    }

    // Obtener insumos consumidos para estos eventos
    const pcfrNums = events.map(e => e.PCFRNum).filter(Boolean);
    if (pcfrNums.length > 0) {
      const itemsRes = await remotePool.request().query(`
        SELECT 
          fr.PCFRNum,
          i.ItemCode AS Codigo,
          ISNULL(i.ItemDescription, 'Material/Medicamento') AS Medicamento,
          SUM(b.Quantity) AS Cantidad
        FROM PCFR fr
        INNER JOIN PC c ON fr.PCNum = c.PCNum
        INNER JOIN PCPR p ON c.PCNum = p.PCNum
        INNER JOIN PCPRIT i ON p.PCPRNum = i.PCPRNum
        INNER JOIN PCPRBT b ON i.PCPRITNum = b.PCPRITNum
        WHERE fr.PCFRNum IN (${pcfrNums.join(',')})
        AND i.WarehouseCode IN ('QX', 'QXCR')
        GROUP BY fr.PCFRNum, i.ItemCode, i.ItemDescription
        HAVING SUM(b.Quantity) > 0
      `);

      const sapMap = sapInventoryService.getInventoryMap();

      if (!Array.isArray(itemsRes.recordset)) throw new Error('Vertical no confirmó los consumos de Quirófano.');
      for (const item of itemsRes.recordset) {
        const sapItem = sapMap.get(item.Codigo);
        const description = (sapItem && sapItem.ItemName && sapItem.ItemName !== 'Material/Medicamento') 
          ? sapItem.ItemName 
          : (item.Medicamento && item.Medicamento !== 'Material/Medicamento' ? item.Medicamento : item.Codigo);

        await pool.query(`
          INSERT INTO dw_quirofano_consumos
            (pcfr_num, item_code, item_description, cantidad)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (pcfr_num, item_code) DO UPDATE SET
            item_description = EXCLUDED.item_description,
            cantidad = EXCLUDED.cantidad;
        `, [item.PCFRNum, item.Codigo, description, item.Cantidad]);
      }
    }

    // Recalcular la caché de Kits Quirúrgicos Agregados en PostgreSQL
    await refreshSurgicalKitsCache(remotePool);

    return events.length;
  } catch (err) {
    console.error('❌ Error en sincronización de Quirófano DW:', err.message);
    throw err;
  }
}

async function refreshSurgicalKitsCache(remotePool) {
  try {
    const recentCache = await pool.query(`
      SELECT 1
      FROM dw_quirofano_kits_cache
      WHERE sync_date >= CURRENT_TIMESTAMP - INTERVAL '60 minutes'
      LIMIT 1
    `);
    if (recentCache.rowCount > 0) {
      console.log('[Sync Quirófano] Se conserva la caché de kits actualizada durante los últimos 60 minutos.');
      return;
    }

    const dbRes = await remotePool.request().query(`
      SELECT 
        UPPER(RTRIM(LTRIM(ISNULL(NULLIF(c.UDF_Diagnostico_presuntivo, ''), 'CIRUGÍA GENERAL')))) AS CirugiaNorm,
        i.ItemCode AS Codigo,
        ISNULL(i.ItemDescription, 'Material/Medicamento') AS Medicamento,
        AVG(b.Quantity) AS PromedioPiezas,
        COUNT(DISTINCT c.PCNum) AS NumCirugias
      FROM PCPRBT b
      INNER JOIN PCPRIT i ON b.PCPRITNum = i.PCPRITNum
      INNER JOIN PCPR p ON i.PCPRNum = p.PCPRNum
      INNER JOIN PC c ON p.PCNum = c.PCNum
      WHERE i.WarehouseCode IN ('QX', 'QXCR')
      AND p.CreatedOn >= DATEADD(month, -12, GETDATE())
      GROUP BY UPPER(RTRIM(LTRIM(ISNULL(NULLIF(c.UDF_Diagnostico_presuntivo, ''), 'CIRUGÍA GENERAL')))), i.ItemCode, i.ItemDescription
      HAVING AVG(b.Quantity) > 0
    `);

    if (!Array.isArray(dbRes.recordset)) throw new Error('Vertical no confirmó los kits de Quirófano.');
    const rawData = dbRes.recordset;
    const kitsBySurgery = {};
    const sapMap = sapInventoryService.getInventoryMap();

    rawData.forEach(row => {
      const key = row.CirugiaNorm;
      if (!kitsBySurgery[key]) {
        kitsBySurgery[key] = {
          Cirugia: key,
          NumCirugias: row.NumCirugias,
          Items: []
        };
      }
      if (row.NumCirugias > kitsBySurgery[key].NumCirugias) {
        kitsBySurgery[key].NumCirugias = row.NumCirugias;
      }
      const sapItem = sapMap.get(row.Codigo);
      kitsBySurgery[key].Items.push({
        Codigo: row.Codigo,
        Medicamento: sapItem ? sapItem.ItemName : row.Medicamento,
        PromedioPiezas: Math.round(row.PromedioPiezas * 10) / 10
      });
    });

    const kitsArray = Object.values(kitsBySurgery).map(kit => ({
      ...kit,
      ItemsCount: kit.Items.length,
      Items: kit.Items.sort((a,b) => b.PromedioPiezas - a.PromedioPiezas).slice(0, 50)
    }));

    for (const kit of kitsArray) {
      await pool.query(`
        INSERT INTO dw_quirofano_kits_cache 
          (cirugia_norm, cirugia, num_cirugias, items_json, sync_date)
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
        ON CONFLICT (cirugia_norm) DO UPDATE SET
          num_cirugias = EXCLUDED.num_cirugias,
          items_json = EXCLUDED.items_json,
          sync_date = CURRENT_TIMESTAMP;
      `, [kit.Cirugia, kit.Cirugia, kit.NumCirugias, JSON.stringify(kit.Items)]);
    }

  } catch (err) {
    console.error('❌ Error al actualizar la caché de Kits Quirúrgicos DW:', err.message);
    throw err;
  }
}

/* Inicializa el Cron Job de Quirófano (cada 15 min) */
function initQuirofanoCron() {
  cron.schedule('3-59/15 * * * *', () => {
    require('./backgroundQueue.service').enqueue('quirofano', () => syncQuirofanoData({ fullSync: false }))
      .catch(error => console.warn('[Quirófano] Actualización pendiente:', error.message));
  });
  console.log('⏰ Cron Job de Quirófano DW inicializado (Ejecución cada 15 min).');
}

module.exports = {
  initQuirofanoDW,
  syncQuirofanoData,
  initQuirofanoCron
};
