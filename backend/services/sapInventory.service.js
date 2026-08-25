'use strict';

const sapService = require('./sap.service');
const { pool } = require('../config/pg-db');

// ==== MOTOR DE CACHÉ EN MEMORIA ====
let globalInventoryCache = [];
let globalInventoryMap = new Map();
let globalBatchesCache = []; // Cache para lotes
let globalMedicalClassificationMap = new Map(); // Mapa de clasificaciones médicas (CON, ANTI, REFRI, etc.)
let globalItemGroups = {};
let globalManufacturers = {};
let syncPromise = null;
let lastSyncTime = null;
let usingDBFallback = false; // true cuando el caché viene del snapshot de PostgreSQL (SAP no disponible)

async function ensureSqlQuery(sqlCode, sqlText) {
  try {
    await sapService.post('/SQLQueries', {
      SqlCode: sqlCode,
      SqlName: sqlCode,
      SqlText: sqlText
    });
  } catch (e) {
    try {
      // Si ya existe, actualizarla (Patch)
      await sapService.patch(`/SQLQueries('${sqlCode}')`, {
        SqlName: sqlCode,
        SqlText: sqlText
      });
    } catch (err) {
      console.error(`[SAP Cache SQL] No se pudo crear ni actualizar SQLQuery ${sqlCode}`);
    }
  }
}

function formatSapDate(dateStr) {
  if (!dateStr) return null;
  return `${dateStr.substring(0,4)}-${dateStr.substring(4,6)}-${dateStr.substring(6,8)}T00:00:00Z`;
}

async function syncInventoryCache() {
  if (syncPromise) return syncPromise;
  
  syncPromise = (async () => {
    try {
      console.log(`[SAP Cache SQL] Iniciando sincronización ultra-rápida...`);
    
    await sapService._ensureSession();
    
    // 1. Preparar consultas SQL Nativas (para todos los almacenes con stock)
    const sqlInv = `SELECT T0.ItemCode, T0.ItemName, T0.ItmsGrpCod, T0.FirmCode, T0.U_CLASI_MED_1 AS MedicalClassification, T0.U_CLASI_MED_2 AS SecondaryClassification, T1.WhsCode, T1.OnHand AS QuantityOnStock, T1.AvgPrice AS PurchaseCost, T2.Price AS SalesPrice FROM OITM T0 INNER JOIN OITW T1 ON T0.ItemCode = T1.ItemCode LEFT JOIN ITM1 T2 ON T0.ItemCode = T2.ItemCode AND T2.PriceList = 1 WHERE T0.InvntItem = 'Y' AND T1.OnHand > 0`;
    const sqlBat = `SELECT T0.ItemCode, T1.WhsCode, T0.DistNumber AS Batch, T0.InDate AS AdmissionDate, T0.ExpDate AS ExpirationDate FROM OBTN T0 INNER JOIN OBTQ T1 ON T0.ItemCode = T1.ItemCode AND T0.SysNumber = T1.SysNumber WHERE T1.Quantity > 0`;
    const sqlClasi = `SELECT ItemCode, ItemName, U_CLASI_MED_1, U_CLASI_MED_2 FROM OITM WHERE U_CLASI_MED_1 IS NOT NULL OR U_CLASI_MED_2 IS NOT NULL`;
    
    await ensureSqlQuery('sq_inv_all', sqlInv);
    await ensureSqlQuery('sq_bat_all', sqlBat);
    await ensureSqlQuery('sq_clasi_all', sqlClasi);
    
    // 1.5 Obtener metadatos (Grupos y Fabricantes)
    if (Object.keys(globalItemGroups).length === 0) {
      const groupsRes = await sapService._request('/ItemGroups?$select=Number,GroupName', 'GET', null, { 'Cookie': sapService.sessionCookie });
      if (groupsRes && groupsRes.data && groupsRes.data.value) {
        groupsRes.data.value.forEach(g => globalItemGroups[g.Number] = g.GroupName);
      }
      const mfgRes = await sapService._request('/Manufacturers', 'GET', null, { 'Cookie': sapService.sessionCookie });
      if (mfgRes && mfgRes.data && mfgRes.data.value) {
        mfgRes.data.value.forEach(m => globalManufacturers[m.Code] = m.ManufacturerName);
      }
    }

    // 2. Obtener Inventario Principal
    console.log(`[SAP Cache SQL] Obteniendo artículos de inventario...`);
    const pageHeaders = { 'Prefer': 'odata.maxpagesize=5000' };
    let invResponse = await sapService.get(`/SQLQueries('sq_inv_all')/List`, pageHeaders);
    let invItems = invResponse.data.value || [];
    let nextLinkInv = invResponse.data['odata.nextLink'];
    while (nextLinkInv) {
      let query = nextLinkInv.startsWith('/b1s/v1') ? nextLinkInv.replace('/b1s/v1', '') : nextLinkInv;
      if (!query.startsWith('/')) query = '/' + query;
      let res = await sapService._request(query, 'GET', null, { 'Cookie': sapService.sessionCookie, ...pageHeaders });
      if (res && res.data && res.data.value) {
        invItems = invItems.concat(res.data.value);
        nextLinkInv = res.data['odata.nextLink'];
      } else {
        nextLinkInv = null;
      }
    }

    // 3. Obtener Lotes
    console.log(`[SAP Cache SQL] Obteniendo lotes...`);
    let batResponse = await sapService.get(`/SQLQueries('sq_bat_all')/List`, pageHeaders);
    let batItems = batResponse.data.value || [];
    let nextLinkBat = batResponse.data['odata.nextLink'];
    while (nextLinkBat) {
      let query = nextLinkBat.startsWith('/b1s/v1') ? nextLinkBat.replace('/b1s/v1', '') : nextLinkBat;
      if (!query.startsWith('/')) query = '/' + query;
      let res = await sapService._request(query, 'GET', null, { 'Cookie': sapService.sessionCookie, ...pageHeaders });
      if (res && res.data && res.data.value) {
        batItems = batItems.concat(res.data.value);
        nextLinkBat = res.data['odata.nextLink'];
      } else {
        nextLinkBat = null;
      }
    }
    
    // 3.5 Obtener Clasificaciones Médicas Generales
    try {
      let clasiResponse = await sapService.get(`/SQLQueries('sq_clasi_all')/List`, pageHeaders);
      let clasiItems = clasiResponse.data?.value || [];
      globalMedicalClassificationMap.clear();
      clasiItems.forEach(c => {
        const c1 = c.U_CLASI_MED_1 ? String(c.U_CLASI_MED_1).trim().toUpperCase() : null;
        const c2 = c.U_CLASI_MED_2 ? String(c.U_CLASI_MED_2).trim().toUpperCase() : null;
        globalMedicalClassificationMap.set(c.ItemCode, {
          ItemCode: c.ItemCode,
          ItemName: c.ItemName,
          MedicalClassification: c1,
          SecondaryClassification: c2,
          isControlled: c1 === 'CON' || c2 === 'CON',
          isAntibiotic: c1 === 'ANTI' || c2 === 'ANTI',
          isColdChain: c1 === 'REFRI' || c2 === 'REFRI',
          isHighRisk: c1 === 'AR' || c2 === 'AR',
          isLasa: c1 === 'LASA' || c2 === 'LASA'
        });
      });
    } catch (clasiErr) {
      console.warn(`[SAP Cache SQL] Error al cargar clasificaciones médicas:`, clasiErr.message);
    }
    
    // 4. Formatear y guardar en memoria
    if (invItems.length > 0) {
      globalInventoryCache = invItems.map(item => {
        const cost = item.PurchaseCost || 0;
        const price = item.SalesPrice || 0;
        const margin = price > 0 ? ((price - cost) / price) * 100 : 0;
        const medClass = globalMedicalClassificationMap.get(item.ItemCode);
        
        return {
          ...item,
          MedicalClassification: medClass?.MedicalClassification || item.MedicalClassification || null,
          SecondaryClassification: medClass?.SecondaryClassification || item.SecondaryClassification || null,
          ItemGroupName: globalItemGroups[item.ItmsGrpCod] || 'General',
          ManufacturerName: globalManufacturers[item.FirmCode] && globalManufacturers[item.FirmCode] !== '- Ningún fabricante -' ? globalManufacturers[item.FirmCode] : 'Genérico',
          ProfitMargin: margin,
          ExpectedUtility: (price - cost) * (item.QuantityOnStock || 0)
        };
      });
      globalInventoryMap = new Map(globalInventoryCache.map(i => [i.ItemCode, i]));
      // Formatear fechas de los lotes para que el frontend no falle
      globalBatchesCache = batItems.map(b => ({
        ...b,
        AdmissionDate: formatSapDate(b.AdmissionDate),
        ExpirationDate: formatSapDate(b.ExpirationDate)
      }));
      lastSyncTime = new Date();
      usingDBFallback = false;
      console.log(`[SAP Cache SQL] Sincronización exitosa: ${globalInventoryCache.length} artículos, ${globalBatchesCache.length} lotes y ${globalMedicalClassificationMap.size} clasificaciones médicas en memoria.`);
      // Persistir snapshot en PostgreSQL para operar si SAP llega a caerse
      persistInventorySnapshot();
    }
    } catch (error) {
      console.error(`[SAP Cache SQL] Error al sincronizar inventario:`, error.message || error);
    } finally {
      syncPromise = null;
    }
  })();
  return syncPromise;
}

/**
 * Persiste el caché de inventario actual en PostgreSQL (dw_sap_inventory_cache).
 * Permite que los módulos sigan operando (modo degradado) si SAP Service Layer no responde.
 */
async function persistInventorySnapshot() {
  if (!globalInventoryCache || globalInventoryCache.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM dw_sap_inventory_cache');
    const batchSize = 500;
    for (let i = 0; i < globalInventoryCache.length; i += batchSize) {
      const batch = globalInventoryCache.slice(i, i + batchSize);
      const values = [];
      const params = [];
      batch.forEach((item, idx) => {
        const base = idx * 9;
        values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`);
        params.push(
          String(item.ItemCode || ''),
          item.ItemName || null,
          String(item.WhsCode || ''),
          Number(item.QuantityOnStock || 0),
          Number(item.PurchaseCost || 0),
          Number(item.SalesPrice || 0),
          item.MedicalClassification || null,
          item.SecondaryClassification || null,
          new Date()
        );
      });
      await client.query(`
        INSERT INTO dw_sap_inventory_cache (itemcode, itemname, whscode, quantity, avgprice, salesprice, medicalclassification, secondaryclassification, lastsync)
        VALUES ${values.join(',')}
      `, params);
    }
    await client.query('COMMIT');
    console.log(`[SAP Cache SQL] Snapshot de inventario persistido en PostgreSQL (${globalInventoryCache.length} registros).`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.warn('[SAP Cache SQL] No se pudo persistir el snapshot de inventario:', err.message);
  } finally {
    client.release();
  }
}

/**
 * Carga el último snapshot de inventario desde PostgreSQL a memoria.
 * Se usa como fallback cuando SAP Service Layer no está disponible.
 * Si nunca se ha persistido un snapshot, deriva un stock aproximado del
 * Kardex (última existencia registrada por artículo) en modo degradado.
 */
async function loadInventoryFromDB() {
  try {
    let loaded = await loadSnapshotFromTable();

    // Fallback nivel 2: derivar del Kardex (existencias de la última sincronización)
    if (!loaded) {
      loaded = await loadFromKardex();
    }

    if (loaded) {
      usingDBFallback = true;
      console.log(`[SAP Cache SQL] ⚠️ Modo degradado: inventario cargado desde PostgreSQL (${globalInventoryCache.length} registros, último sync: ${lastSyncTime || 'desconocido'}).`);
    }
    return loaded;
  } catch (err) {
    console.error('[SAP Cache SQL] Error al cargar snapshot de inventario desde PostgreSQL:', err.message);
    return false;
  }
}

async function loadSnapshotFromTable() {
  const res = await pool.query(`
      SELECT itemcode AS "ItemCode", itemname AS "ItemName", whscode AS "WhsCode",
             quantity AS "QuantityOnStock", avgprice AS "PurchaseCost", salesprice AS "SalesPrice",
             medicalclassification AS "MedicalClassification", secondaryclassification AS "SecondaryClassification",
             lastsync AS "LastSync"
      FROM dw_sap_inventory_cache
    `);
  if (res.rows.length === 0) return false;
  applyInventoryRows(res.rows, res.rows[0]?.LastSync || null);
  return true;
}

async function loadFromKardex() {
  // Última existencia registrada por artículo en el Kardex (aprox. del stock total al último sync)
  const res = await pool.query(`
      SELECT DISTINCT ON (k.codigo)
        k.codigo AS "ItemCode", k.descripcion AS "ItemName",
        k.existencias AS "QuantityOnStock", k.fecha AS "LastSync"
      FROM dw_sap_kardex k
      WHERE k.codigo IS NOT NULL AND k.codigo <> ''
        AND k.codigo NOT IN ('ENTRADA', 'TRASLADO')
      ORDER BY k.codigo, k.fecha DESC, k.idkardex DESC
    `);
  if (res.rows.length === 0) return false;

  // Sólo exponer los SKUs mapeados en la matriz de reorden (universo Farmacia/Almacén)
  const settingsRes = await pool.query('SELECT itemcode, itemdescription FROM dw_sap_reorder_settings');
  const mappedCodes = new Set(settingsRes.rows.map(r => r.itemcode));

  const rows = res.rows
    .filter(r => mappedCodes.has(r.ItemCode))
    .map(r => ({
      ItemCode: r.ItemCode,
      ItemName: r.ItemName || settingsRes.rows.find(s => s.itemcode === r.ItemCode)?.itemdescription || 'Insumo Médico',
      WhsCode: 'FAR',
      QuantityOnStock: Number(r.QuantityOnStock || 0),
      PurchaseCost: 0,
      SalesPrice: 0,
      MedicalClassification: null,
      SecondaryClassification: null,
      LastSync: r.LastSync
    }));
  if (rows.length === 0) return false;
  applyInventoryRows(rows, rows[0]?.LastSync || null);
  return true;
}

function applyInventoryRows(rows, lastSync) {
  globalInventoryCache = rows.map(item => {
    const cost = item.PurchaseCost || 0;
    const price = item.SalesPrice || 0;
    return {
      ...item,
      ItemGroupName: 'General',
      ManufacturerName: 'Genérico',
      ProfitMargin: price > 0 ? ((price - cost) / price) * 100 : 0,
      ExpectedUtility: (price - cost) * (item.QuantityOnStock || 0)
    };
  });
  globalInventoryMap = new Map(globalInventoryCache.map(i => [i.ItemCode, i]));
  lastSyncTime = lastSync;
  // Cargar clasificaciones desde el mismo snapshot
  globalMedicalClassificationMap.clear();
  globalInventoryCache.forEach(item => {
    if (item.MedicalClassification || item.SecondaryClassification) {
      const c1 = item.MedicalClassification ? String(item.MedicalClassification).trim().toUpperCase() : null;
      const c2 = item.SecondaryClassification ? String(item.SecondaryClassification).trim().toUpperCase() : null;
      globalMedicalClassificationMap.set(item.ItemCode, {
        ItemCode: item.ItemCode,
        ItemName: item.ItemName,
        MedicalClassification: c1,
        SecondaryClassification: c2,
        isControlled: c1 === 'CON' || c2 === 'CON',
        isAntibiotic: c1 === 'ANTI' || c2 === 'ANTI',
        isColdChain: c1 === 'REFRI' || c2 === 'REFRI',
        isHighRisk: c1 === 'AR' || c2 === 'AR',
        isLasa: c1 === 'LASA' || c2 === 'LASA'
      });
    }
  });
}

/**
 * Garantiza que haya datos de inventario disponibles (SAP en vivo → fallback PostgreSQL).
 */
async function ensureInventoryData() {
  if (globalInventoryCache.length > 0) return true;
  try {
    await syncInventoryCache();
  } catch (e) {
    // Ignorar: el fallback de BD se evalúa abajo
  }
  if (globalInventoryCache.length === 0) {
    await loadInventoryFromDB();
  }
  return globalInventoryCache.length > 0;
}

// Iniciar sincronización en background cada 15 minutos
// (no en modo test: evita timers y conexiones SAP durante los tests)
if (process.env.NODE_ENV !== 'test') {
  setInterval(syncInventoryCache, 15 * 60 * 1000);
  // Disparar la primera vez con un pequeño delay para dar tiempo a que el servidor arranque
  setTimeout(syncInventoryCache, 3000);
}

module.exports = {
  syncInventoryCache,
  ensureInventoryData,
  persistInventorySnapshot,
  loadInventoryFromDB,
  getInventoryCache: () => globalInventoryCache,
  getBatchesCache: () => globalBatchesCache,
  getInventoryMap: () => globalInventoryMap,
  getMedicalClassificationMap: () => globalMedicalClassificationMap,
  isUsingDBFallback: () => usingDBFallback,
  getLastSyncTime: () => lastSyncTime
};
