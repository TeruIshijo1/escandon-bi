const express = require('express');
const router = express.Router();
const etlService = require('../services/etl.service');
const sapService = require('../services/sap.service');
const { authenticate, authorize } = require('../middleware/auth.middleware');

router.get('/devoluciones', async (req, res) => {
  try {
    const { fechaDesde, fechaHasta } = req.query;
    const data = await etlService.getDevolucionesFarmacia(fechaDesde, fechaHasta);
    res.json({ ok: true, ...data });
  } catch (err) {
    console.error('[Pharmacy Devoluciones Error]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==== MOTOR DE CACHÉ EN MEMORIA ====
let globalInventoryCache = [];
let isSyncing = false;
let lastSyncTime = null;

async function syncInventoryCache() {
  if (isSyncing) return;
  try {
    isSyncing = true;
    console.log(`[SAP Cache] Sincronizando catálogo completo de inventario...`);
    const query = `/Items?$select=ItemCode,ItemName,MovingAveragePrice,ItemWarehouseInfoCollection&$filter=InventoryItem eq 'tYES'`;
    
    // Asegurar que estamos logueados en SAP antes de la petición manual
    await sapService._ensureSession();
    
    // Pedimos maxpagesize muy alto para traer todos en 1 sola llamada (o las menos posibles)
    const response = await sapService._request(query, 'GET', null, {
      'Cookie': sapService.sessionCookie,
      'B1S-PageSize': '10000',
      'Prefer': 'odata.maxpagesize=10000'
    });
    
    if (response && response.data && response.data.value) {
      globalInventoryCache = response.data.value;
      lastSyncTime = new Date();
      console.log(`[SAP Cache] Sincronización exitosa: ${globalInventoryCache.length} artículos en memoria.`);
    }
  } catch (error) {
    console.error(`[SAP Cache] Error al sincronizar inventario:`, error.error || error.message || error);
  } finally {
    isSyncing = false;
  }
}

// Iniciar sincronización en background cada 15 minutos
setInterval(syncInventoryCache, 15 * 60 * 1000);
// Disparar la primera vez con un pequeño delay para dar tiempo a que el servidor arranque
setTimeout(syncInventoryCache, 3000);
// ===================================

router.get('/inventario', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res) => {
  try {
    const warehouseCode = req.query.warehouse || 'FAR';

    // Si el caché está vacío (ej. servidor recién prendido), forzamos una carga
    if (globalInventoryCache.length === 0) {
      await syncInventoryCache();
    }
    
    const items = globalInventoryCache;
    
    const processedItems = items.map(item => {
      let warehouseStock = 0;
      if (item.ItemWarehouseInfoCollection) {
        const whInfo = item.ItemWarehouseInfoCollection.find(w => w.WarehouseCode === warehouseCode);
        if (whInfo) {
          warehouseStock = whInfo.InStock || 0;
        }
      }
      return {
        ItemCode: item.ItemCode,
        ItemName: item.ItemName,
        MovingAveragePrice: item.MovingAveragePrice,
        QuantityOnStock: warehouseStock
      };
    }).filter(item => item.QuantityOnStock > 0); // Para la vista de un almacén, es más limpio mostrar solo lo que sí tiene existencia (o tuvo recientemente).

    res.json({ ok: true, data: processedItems });
  } catch (err) {
    console.error('[Pharmacy Inventario SAP Error]', err);
    res.status(500).json({ ok: false, error: err.error || err.message });
  }
});

module.exports = router;
