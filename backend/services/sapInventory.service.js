'use strict';

const sapService = require('./sap.service');

// ==== MOTOR DE CACHÉ EN MEMORIA ====
let globalInventoryCache = [];
let globalInventoryMap = new Map();
let globalBatchesCache = []; // Cache para lotes
let globalMedicalClassificationMap = new Map(); // Mapa de clasificaciones médicas (CON, ANTI, REFRI, etc.)
let globalItemGroups = {};
let globalManufacturers = {};
let syncPromise = null;
let lastSyncTime = null;

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
      console.log(`[SAP Cache SQL] Sincronización exitosa: ${globalInventoryCache.length} artículos, ${globalBatchesCache.length} lotes y ${globalMedicalClassificationMap.size} clasificaciones médicas en memoria.`);
    }
    } catch (error) {
      console.error(`[SAP Cache SQL] Error al sincronizar inventario:`, error.message || error);
    } finally {
      syncPromise = null;
    }
  })();
  return syncPromise;
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
  getInventoryCache: () => globalInventoryCache,
  getBatchesCache: () => globalBatchesCache,
  getInventoryMap: () => globalInventoryMap,
  getMedicalClassificationMap: () => globalMedicalClassificationMap
};
