const cron = require('node-cron');
const { connectRemoteDB } = require('../config/remote-db');
const { pool } = require('../config/pg-db');
const sapInventoryService = require('./sapInventory.service');

let isSyncing = false;

/**
 * Inicializa las tablas del Data Warehouse en PostgreSQL para Quirófano
 */
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
  }
}

/**
 * Sincronización Incremental / Completa de Quirófano desde SQL Server hacia PostgreSQL DW
 */
async function syncQuirofanoData(options = { fullSync: false }) {
  if (isSyncing) {
    console.log('⏳ Sincronización de Quirófano ya en progreso. Omitiendo ciclo...');
    return;
  }
  isSyncing = true;

  try {
    const remotePool = await connectRemoteDB();
    const dateFilter = options.fullSync ? '' : 'WHERE q.FechaInicio >= DATEADD(day, -15, GETDATE())';

    // 1. Obtener eventos de Quirófano desde SQL Server
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

    const events = eventsRes.recordset || [];
    if (events.length === 0) {
      console.log('ℹ️ Sync Quirófano DW: No hay eventos nuevos para sincronizar.');
      
      // Sincronizar de todos modos las analíticas SAP
      await syncQuirofanoRevenues(options.fullSync);
      isSyncing = false;
      return;
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

    // 2. Obtener insumos consumidos para estos eventos
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

      for (const item of (itemsRes.recordset || [])) {
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

    // 3. Recalcular la caché de Kits Quirúrgicos Agregados en PostgreSQL
    await refreshSurgicalKitsCache(remotePool);

    // 4. Sincronizar ingresos de SAP B1
    await syncQuirofanoRevenues(options.fullSync);

    console.log(`✅ Sync Quirófano DW: Sincronizados ${events.length} eventos quirúrgicos.`);
  } catch (err) {
    console.error('❌ Error en sincronización de Quirófano DW:', err.message);
  } finally {
    isSyncing = false;
  }
}

/**
 * Calcula y actualiza los Kits Quirúrgicos agregados en la caché de PostgreSQL
 */
async function refreshSurgicalKitsCache(remotePool) {
  try {
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

    const rawData = dbRes.recordset || [];
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
  }
}

/**
 * Sincroniza analíticas de ingresos de Quirófano desde SAP B1 a PostgreSQL
 */
async function syncQuirofanoRevenues(fullSync) {
  try {
    const sapService = require('./sap.service');
    await sapService._ensureSession();

    const ensureQuery = async (code, text) => {
      try {
        await sapService.post('/SQLQueries', { SqlCode: code, SqlName: code, SqlText: text });
      } catch (e) {
        try {
          await sapService.patch(`/SQLQueries('${code}')`, { SqlName: code, SqlText: text });
        } catch (err) {}
      }
    };

    // Registrar las consultas agrupadas en SAP B1
    await ensureQuery('sq_quirofano_top_medicos_group', `
      SELECT 
        T0.DocDate AS fecha,
        T0.U_PRName AS nombre,
        SUM(T1.LineTotal) AS ingresos
      FROM OINV T0
      INNER JOIN INV1 T1 ON T0.DocEntry = T1.DocEntry
      INNER JOIN OITM T2 ON T1.ItemCode = T2.ItemCode
      WHERE T2.ItmsGrpCod = 111 
        AND T0.DocDate >= :startDate 
        AND T0.DocDate <= :endDate
        AND T0.U_PRName IS NOT NULL AND T0.U_PRName <> ''
      GROUP BY T0.DocDate, T0.U_PRName
    `);

    await ensureQuery('sq_quirofano_top_servicios_group', `
      SELECT 
        T0.DocDate AS fecha,
        T1.Dscription AS nombre,
        SUM(T1.LineTotal) AS ingresos
      FROM OINV T0
      INNER JOIN INV1 T1 ON T0.DocEntry = T1.DocEntry
      INNER JOIN OITM T2 ON T1.ItemCode = T2.ItemCode
      WHERE T2.ItmsGrpCod = 111 
        AND T0.DocDate >= :startDate 
        AND T0.DocDate <= :endDate
      GROUP BY T0.DocDate, T1.Dscription
    `);

    await ensureQuery('sq_quirofano_ingresos_totales_group', `
      SELECT 
        T0.DocDate AS fecha,
        SUM(T1.LineTotal) AS ingresos
      FROM OINV T0
      INNER JOIN INV1 T1 ON T0.DocEntry = T1.DocEntry
      INNER JOIN OITM T2 ON T1.ItemCode = T2.ItemCode
      WHERE T2.ItmsGrpCod = 111 
        AND T0.DocDate >= :startDate 
        AND T0.DocDate <= :endDate
      GROUP BY T0.DocDate
    `);

    // Rango de fechas
    const now = new Date();
    const endDate = now.toISOString().split('T')[0].replace(/-/g, '');
    let startDate;
    if (fullSync) {
      const past = new Date();
      past.setDate(past.getDate() - 365);
      startDate = past.toISOString().split('T')[0].replace(/-/g, '');
    } else {
      const past = new Date();
      past.setDate(past.getDate() - 15);
      startDate = past.toISOString().split('T')[0].replace(/-/g, '');
    }

    console.log(`[Sync SAP Quirófano Revenue] Sincronizando ingresos desde ${startDate} hasta ${endDate}...`);

    const [totalRes, medRes, srvRes] = await Promise.all([
      sapService.get(`/SQLQueries('sq_quirofano_ingresos_totales_group')/List?startDate='${startDate}'&endDate='${endDate}'`),
      sapService.get(`/SQLQueries('sq_quirofano_top_medicos_group')/List?startDate='${startDate}'&endDate='${endDate}'`),
      sapService.get(`/SQLQueries('sq_quirofano_top_servicios_group')/List?startDate='${startDate}'&endDate='${endDate}'`)
    ]);

    const totals = totalRes.data?.value || [];
    const medicos = medRes.data?.value || [];
    const servicios = srvRes.data?.value || [];

    const startIso = `${startDate.substring(0,4)}-${startDate.substring(4,6)}-${startDate.substring(6,8)}`;
    const endIso = `${endDate.substring(0,4)}-${endDate.substring(4,6)}-${endDate.substring(6,8)}`;
    
    await pool.query(`DELETE FROM dw_sap_quirofano_analiticas WHERE startdate >= $1 AND startdate <= $2`, [startIso, endIso]);

    // Insertar Totales
    for (const r of totals) {
      const fecha = r.fecha ? String(r.fecha).slice(0, 10) : null;
      if (!fecha) continue;
      await pool.query(`
        INSERT INTO dw_sap_quirofano_analiticas (tipo, nombre, ingresos, startdate, enddate, sync_date)
        VALUES ('TOTAL', 'TOTAL', $1, $2, $2, CURRENT_TIMESTAMP)
        ON CONFLICT (tipo, nombre, startdate, enddate) DO UPDATE SET ingresos = EXCLUDED.ingresos, sync_date = CURRENT_TIMESTAMP
      `, [Number(r.ingresos || 0), fecha]);
    }

    // Insertar Médicos
    for (const r of medicos) {
      const fecha = r.fecha ? String(r.fecha).slice(0, 10) : null;
      if (!fecha) continue;
      await pool.query(`
        INSERT INTO dw_sap_quirofano_analiticas (tipo, nombre, ingresos, startdate, enddate, sync_date)
        VALUES ('MEDICO', $1, $2, $3, $3, CURRENT_TIMESTAMP)
        ON CONFLICT (tipo, nombre, startdate, enddate) DO UPDATE SET ingresos = EXCLUDED.ingresos, sync_date = CURRENT_TIMESTAMP
      `, [String(r.nombre || '').trim(), Number(r.ingresos || 0), fecha]);
    }

    // Insertar Servicios
    for (const r of servicios) {
      const fecha = r.fecha ? String(r.fecha).slice(0, 10) : null;
      if (!fecha) continue;
      await pool.query(`
        INSERT INTO dw_sap_quirofano_analiticas (tipo, nombre, ingresos, startdate, enddate, sync_date)
        VALUES ('SERVICIO', $1, $2, $3, $3, CURRENT_TIMESTAMP)
        ON CONFLICT (tipo, nombre, startdate, enddate) DO UPDATE SET ingresos = EXCLUDED.ingresos, sync_date = CURRENT_TIMESTAMP
      `, [String(r.nombre || '').trim(), Number(r.ingresos || 0), fecha]);
    }

    console.log(`✅ [Sync SAP Quirófano Revenue] Sincronizados ${totals.length} totales, ${medicos.length} medicos y ${servicios.length} servicios.`);
  } catch (err) {
    console.error('❌ Error al sincronizar ingresos de Quirófano SAP:', err.message);
  }
}

/**
 * Inicializa el Cron Job de Quirófano (cada 15 min)
 */
function initQuirofanoCron() {
  cron.schedule('*/15 * * * *', () => {
    syncQuirofanoData({ fullSync: false });
  });
  console.log('⏰ Cron Job de Quirófano DW inicializado (Ejecución cada 15 min).');
}

module.exports = {
  initQuirofanoDW,
  syncQuirofanoData,
  initQuirofanoCron
};
