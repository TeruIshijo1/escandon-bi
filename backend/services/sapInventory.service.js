'use strict';

const sapService = require('./sap.service');
const { ensureSapQuery, withSapQuery } = require('./sapQueryRegistration.service');
const { pool } = require('../config/pg-db');

// ==== MOTOR DE CACHÉ EN MEMORIA ====
let globalInventoryCache = [];
let globalInventoryMap = new Map();
let globalBatchesCache = [];  
let globalMedicalClassificationMap = new Map();  
let globalItemGroups = {};
let globalManufacturers = {};
let syncPromise = null;
let lastSyncTime = null;
let usingDBFallback = false;
let hasInventorySnapshot = false;

const SAP_READ_OPTIONS = { maxPages: 5000, timeoutMs: 30000, queueTimeoutMs: 60000, totalTimeoutMs: 300000, cacheTtlMs: 0 };

function formatSapDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  const parsed = /^\d{8}$/.test(text)
    ? new Date(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T00:00:00Z`)
    : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function readSapRows(endpoint) {
  const rows = await sapService.fetchAllPages(endpoint, { Prefer: 'odata.maxpagesize=5000' }, SAP_READ_OPTIONS);
  if (!Array.isArray(rows)) throw new Error(`Lectura SAP incompleta: ${endpoint}`);
  return rows;
}

function classificationFor(item) {
  const c1 = item.U_CLASI_MED_1 ? String(item.U_CLASI_MED_1).trim().toUpperCase() : null;
  const c2 = item.U_CLASI_MED_2 ? String(item.U_CLASI_MED_2).trim().toUpperCase() : null;
  return {
    ItemCode: item.ItemCode,
    ItemName: item.ItemName,
    MedicalClassification: c1,
    SecondaryClassification: c2,
    isControlled: c1 === 'CON' || c2 === 'CON',
    isAntibiotic: c1 === 'ANTI' || c2 === 'ANTI',
    isColdChain: c1 === 'REFRI' || c2 === 'REFRI',
    isHighRisk: c1 === 'AR' || c2 === 'AR',
    isLasa: c1 === 'LASA' || c2 === 'LASA'
  };
}

function resolveDrugClassification(itemName, firmCode, manufacturersMap = {}) {
  const mfg = manufacturersMap[firmCode];
  if (mfg && mfg !== '- Ningún fabricante -' && mfg !== '- Ninguna Marca -') {
    return mfg;
  }

  if (!itemName) return 'General';

  const clean = String(itemName).trim().toUpperCase();

  const isPatente = /\sP\s|\sP$|\sP\/|\sP\.|\bPATENTE\b/i.test(clean);

  const isGenerico = /\sG\s|\sG$|\sG\/|\sG\.|\bGENERICO\b|\bGEN\b/i.test(clean);

  if (isPatente && !isGenerico) {
    return 'Patente';
  }
  if (isGenerico && !isPatente) {
    return 'Genérico';
  }
  if (isPatente && isGenerico) {
    return 'Patente';
  }

  return 'General';
}

// Publica el inventario sólo después de leer todas las fuentes y confirmar PostgreSQL.
function syncInventoryCache() {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    try {
      console.log('[SAP Cache SQL] Iniciando sincronización de inventario...');
      const sqlInv = `SELECT T0.ItemCode, T0.ItemName, T0.ItmsGrpCod, T0.FirmCode, T0.U_CLASI_MED_1 AS MedicalClassification, T0.U_CLASI_MED_2 AS SecondaryClassification, T1.WhsCode, T1.OnHand AS QuantityOnStock, T0.LastPurPrc AS PurchaseCost, T1.AvgPrice AS AvgCost, T2.Price AS PricePG, T3.Price AS PriceHos FROM OITM T0 INNER JOIN OITW T1 ON T0.ItemCode = T1.ItemCode LEFT JOIN ITM1 T2 ON T0.ItemCode = T2.ItemCode AND T2.PriceList = 1 LEFT JOIN ITM1 T3 ON T0.ItemCode = T3.ItemCode AND T3.PriceList = 2 WHERE T0.InvntItem = 'Y' AND T1.OnHand > 0`;
      const sqlBat = `SELECT T0.ItemCode, T1.WhsCode, T0.DistNumber AS Batch, T0.InDate AS AdmissionDate, T0.ExpDate AS ExpirationDate, T1.Quantity FROM OBTN T0 INNER JOIN OBTQ T1 ON T0.ItemCode = T1.ItemCode AND T0.SysNumber = T1.SysNumber WHERE T1.Quantity > 0`;
      const sqlClasi = `SELECT ItemCode, ItemName, U_CLASI_MED_1, U_CLASI_MED_2 FROM OITM WHERE U_CLASI_MED_1 IS NOT NULL OR U_CLASI_MED_2 IS NOT NULL`;
      await ensureSapQuery('sq_inv_all', sqlInv);
      await ensureSapQuery('sq_bat_all', sqlBat);
      await ensureSapQuery('sq_clasi_all', sqlClasi);

      let itemGroups = globalItemGroups;
      let manufacturers = globalManufacturers;
      if (Object.keys(itemGroups).length === 0) {
        const groups = await readSapRows('/ItemGroups?$select=Number,GroupName');
        const firms = await readSapRows('/Manufacturers');
        itemGroups = Object.fromEntries(groups.map(g => [g.Number, g.GroupName]));
        manufacturers = Object.fromEntries(firms.map(m => [m.Code, m.ManufacturerName]));
      }
      const invItems = await withSapQuery('sq_inv_all', sqlInv, () => readSapRows(`/SQLQueries('sq_inv_all')/List`));
      const batItems = await withSapQuery('sq_bat_all', sqlBat, () => readSapRows(`/SQLQueries('sq_bat_all')/List`));
      const classifications = await withSapQuery('sq_clasi_all', sqlClasi, () => readSapRows(`/SQLQueries('sq_clasi_all')/List`));
      const medicalMap = new Map(classifications.map(c => [c.ItemCode, classificationFor(c)]));
      const inventory = invItems.map(item => {
        const cost = Number((item.PurchaseCost > 0 ? item.PurchaseCost : item.AvgCost) || 0);
        const pricePG = Number(item.PricePG != null ? item.PricePG : (item.SalesPrice || 0));
        const priceHos = Number(item.PriceHos || 0);
        const quantity = Number(item.QuantityOnStock || 0);
        const medClass = medicalMap.get(item.ItemCode);
        return {
          ...item,
          QuantityOnStock: quantity,
          PurchaseCost: cost,
          PricePG: pricePG,
          PriceHos: priceHos,
          SalesPrice: pricePG,
          MedicalClassification: medClass?.MedicalClassification || item.MedicalClassification || null,
          SecondaryClassification: medClass?.SecondaryClassification || item.SecondaryClassification || null,
          ItemGroupName: itemGroups[item.ItmsGrpCod] || (item.ItemCode?.startsWith('FAR') ? 'FARMACIA' : 'General'),
          ManufacturerName: resolveDrugClassification(item.ItemName, item.FirmCode, manufacturers),
          ProfitMargin: pricePG > 0 ? ((pricePG - cost) / pricePG) * 100 : 0,
          ExpectedUtility: (pricePG - cost) * quantity
        };
      });
      const batches = batItems.map(b => ({
        ...b,
        Quantity: Number(b.Quantity || 0),
        AdmissionDate: formatSapDate(b.AdmissionDate),
        ExpirationDate: formatSapDate(b.ExpirationDate)
      }));
      const syncedAt = new Date();
      await persistInventorySnapshot(inventory, { allowEmpty: true, syncedAt });
      globalInventoryCache = inventory;
      globalInventoryMap = new Map(inventory.map(i => [i.ItemCode, i]));
      globalBatchesCache = batches;
      globalMedicalClassificationMap = medicalMap;
      globalItemGroups = itemGroups;
      globalManufacturers = manufacturers;
      lastSyncTime = syncedAt;
      hasInventorySnapshot = true;
      usingDBFallback = false;
      console.log(`[SAP Cache SQL] Sincronización exitosa: ${inventory.length} artículos, ${batches.length} lotes y ${medicalMap.size} clasificaciones médicas.`);
    } catch (error) {
      console.error('[SAP Cache SQL] Error al sincronizar inventario:', error.message || error);
      throw error;
    }
  })().finally(() => { syncPromise = null; });
  return syncPromise;
}

// Sustituye el snapshot completo en una transacción.
async function persistInventorySnapshot(rows = globalInventoryCache, { allowEmpty = false, syncedAt = new Date() } = {}) {
  if (!Array.isArray(rows)) throw new TypeError('El snapshot de inventario debe ser una lista completa.');
  if (rows.length === 0 && !allowEmpty) return;
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('DELETE FROM dw_sap_inventory_cache');
    const batchSize = 500;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const values = [];
      const params = [];
      batch.forEach((item, idx) => {
        const base = idx * 11;
        values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11})`);
        params.push(
          String(item.ItemCode || ''), item.ItemName || null, String(item.WhsCode || ''),
          Number(item.QuantityOnStock || 0), Number(item.PurchaseCost || 0),
          Number(item.SalesPrice || item.PricePG || 0),
          Number(item.PricePG != null ? item.PricePG : (item.SalesPrice || 0)),
          Number(item.PriceHos || 0), item.MedicalClassification || null,
          item.SecondaryClassification || null, syncedAt
        );
      });
      await client.query(`
        INSERT INTO dw_sap_inventory_cache (itemcode, itemname, whscode, quantity, avgprice, salesprice, price_pg, price_hos, medicalclassification, secondaryclassification, lastsync)
        VALUES ${values.join(',')}
      `, params);
    }
    await client.query('COMMIT');
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.warn('[SAP Cache SQL] No se pudo persistir el snapshot de inventario:', err.message);
    throw err;
  } finally {
    client?.release();
  }
}

async function loadInventoryFromDB() {
  try {
    let loaded = await loadSnapshotFromTable();

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
             COALESCE(price_pg, salesprice, 0) AS "PricePG",
             COALESCE(price_hos, 0) AS "PriceHos",
             medicalclassification AS "MedicalClassification", secondaryclassification AS "SecondaryClassification",
             lastsync AS "LastSync"
      FROM dw_sap_inventory_cache
    `);
  if (res.rows.length === 0) return false;
  applyInventoryRows(res.rows, res.rows[0]?.LastSync || null);
  return true;
}

async function loadFromKardex() {
   
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
      PricePG: 0,
      PriceHos: 0,
      MedicalClassification: null,
      SecondaryClassification: null,
      LastSync: r.LastSync
    }));
  if (rows.length === 0) return false;
  applyInventoryRows(rows, rows[0]?.LastSync || null);
  return true;
}

function applyInventoryRows(rows, lastSync) {
  hasInventorySnapshot = true;
  globalInventoryCache = rows.map(item => {
    const cost = Number(item.PurchaseCost || 0);
    const pricePG = Number(item.PricePG != null ? item.PricePG : (item.SalesPrice || 0));
    const priceHos = Number(item.PriceHos || 0);
    const quantity = Number(item.QuantityOnStock || 0);
    return {
      ...item,
      QuantityOnStock: quantity,
      PurchaseCost: cost,
      PricePG: pricePG,
      PriceHos: priceHos,
      SalesPrice: pricePG,
      ItemGroupName: item.ItemGroupName || (item.ItemCode?.startsWith('FAR') ? 'FARMACIA' : 'General'),
      ManufacturerName: resolveDrugClassification(item.ItemName, item.FirmCode, globalManufacturers),
      ProfitMargin: pricePG > 0 ? ((pricePG - cost) / pricePG) * 100 : 0,
      ExpectedUtility: (pricePG - cost) * quantity
    };
  });
  globalInventoryMap = new Map(globalInventoryCache.map(i => [i.ItemCode, i]));
  lastSyncTime = lastSync;
   
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

async function ensureInventoryData() {
  if (hasInventorySnapshot || globalInventoryCache.length > 0) {
    const itemWithPrice = globalInventoryCache.find(i => (i.SalesPrice > 0 || i.PricePG > 0));
    if (itemWithPrice && itemWithPrice.PriceHos === undefined) {
      await syncInventoryCache().catch(() => {});
    }
    return true;
  }
  try {
    await syncInventoryCache();
  } catch (e) {
     
  }
  if (!hasInventorySnapshot && globalInventoryCache.length === 0) {
    await loadInventoryFromDB();
  }
  return hasInventorySnapshot || globalInventoryCache.length > 0;
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
  hasInventorySnapshot: () => hasInventorySnapshot,
  isUsingDBFallback: () => usingDBFallback,
  getLastSyncTime: () => lastSyncTime
};
