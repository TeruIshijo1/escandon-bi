'use strict';

const express = require('express');
const router = express.Router();
const sapInventoryService = require('../services/sapInventory.service');
const { authenticate, authorize } = require('../middleware/auth.middleware');

/**
 * GET /api/almacen/inventario
 * Devuelve el inventario general de SAP para almacenes que NO sean 'FAR' (Farmacia)
 */
router.get('/inventario', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'ALMACEN_GENERAL']), async (req, res) => {
  try {
    // Si el caché está vacío (ej. servidor recién prendido), forzamos una carga
    if (sapInventoryService.getInventoryCache().length === 0) {
      await sapInventoryService.syncInventoryCache();
    }
    
    // Filtrar únicamente los items que NO pertenecen a 'FAR'
    const generalItems = sapInventoryService.getInventoryCache().filter(item => item.WhsCode !== 'FAR');
    
    res.json({ ok: true, data: generalItems });
  } catch (err) {
    console.error('[Almacen General Inventario SAP Error]', err);
    res.status(500).json({ ok: false, error: 'Error interno al consultar el inventario general' });
  }
});

/**
 * GET /api/almacen/historial-movimientos/:itemCode
 * Extrae el historial de movimientos de inventario (Traslados) desde SAP B1
 */
router.get('/historial-movimientos/:itemCode', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'ALMACEN_GENERAL']), async (req, res) => {
  try {
    const { itemCode } = req.params;
    if (!itemCode) return res.status(400).json({ ok: false, error: 'ItemCode requerido' });

    const sapService = require('../services/sap.service');
    await sapService._ensureSession();
    
    // Como SQLQueries sobre OWTR falla por permisos del Service Layer en SAP B1 (ODBC -2028 / 702),
    // usamos $crossjoin nativo de OData para extraer el historial de traslados del artículo.
    const url = `/$crossjoin(StockTransfers,StockTransfers/StockTransferLines)?$expand=StockTransfers($select=DocDate,DocNum,ToWarehouse,Comments),StockTransfers/StockTransferLines($select=ItemCode,Quantity)&$filter=StockTransfers/DocEntry eq StockTransfers/StockTransferLines/DocEntry and StockTransfers/StockTransferLines/ItemCode eq '${encodeURIComponent(itemCode)}'&$orderby=StockTransfers/DocDate desc`;
    
    const response = await sapService.get(url);
    const dbRes = response.data.value || [];
      
    // Formatear fechas para el frontend
    const formattedData = dbRes.map(d => {
      const header = d['StockTransfers'] || {};
      const line = d['StockTransfers/StockTransferLines'] || {};
      return {
        Fecha: header.DocDate ? new Date(header.DocDate).toISOString() : null,
        Lote: header.DocNum,
        Cantidad: line.Quantity,
        Paciente: header.Comments,
        TipoMovimiento: header.ToWarehouse
      };
    });
    
    res.json({ ok: true, data: formattedData });
  } catch (err) {
    console.error(`[Almacen] Error al obtener el historial de traslados del artículo:`, err.response?.data || err.error || err.message);
    res.status(500).json({ ok: false, error: 'Error interno al consultar el historial de movimientos' });
  }
});

/**
 * GET /api/almacen/ubicaciones/:itemCode
 * Devuelve en qué otros almacenes del hospital hay stock del artículo
 */
router.get('/ubicaciones/:itemCode', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'ALMACEN_GENERAL']), async (req, res) => {
  const itemCode = req.params.itemCode;
  
  if (sapInventoryService.getInventoryCache().length > 0) {
    // Buscar en el caché global en qué almacenes hay stock de este ItemCode
    let locations = sapInventoryService.getInventoryCache()
      .filter(item => item.ItemCode === itemCode && item.QuantityOnStock > 0)
      .map(item => ({
        WhsCode: item.WhsCode,
        QuantityOnStock: item.QuantityOnStock
      }));
    
    return res.json({ ok: true, data: locations });
  }

  // Si no hay caché, error
  res.status(503).json({ ok: false, error: 'El caché de inventario aún no está listo. Intente de nuevo en unos segundos.' });
});

/**
 * GET /api/almacen/traslados
 * Lista las solicitudes de traslado recientes de SAP (InventoryTransferRequests)
 */
router.get('/traslados', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'ALMACEN_GENERAL']), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const sapService = require('../services/sap.service');
    await sapService._ensureSession();
    
    let url = '/InventoryTransferRequests?%24orderby=DocEntry%20desc&%24top=500&%24select=DocEntry,DocNum,DocDate,DueDate,FromWarehouse,ToWarehouse,Comments,DocumentStatus';
    
    if (startDate && endDate) {
      // In OData, DocDate format usually requires just the date 'YYYY-MM-DD'
      url += `&%24filter=DocDate ge '${startDate}' and DocDate le '${endDate}'`;
    }
    
    const response = await sapService.get(url);
    
    res.json({ ok: true, data: response.data.value || [] });
  } catch (err) {
    console.error(`[Almacen] Error al obtener solicitudes de traslado:`, err.response?.data || err.message);
    res.status(500).json({ ok: false, error: 'Error al consultar las solicitudes de traslado en SAP' });
  }
});

/**
 * GET /api/almacen/traslados/:id
 * Obtiene el detalle completo de una solicitud de traslado
 */
router.get('/traslados/:id', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'ALMACEN_GENERAL']), async (req, res) => {
  try {
    const { id } = req.params;
    const sapService = require('../services/sap.service');
    await sapService._ensureSession();
    
    const response = await sapService.get(`/InventoryTransferRequests(${id})`);
    
    res.json({ ok: true, data: response.data });
  } catch (err) {
    console.error(`[Almacen] Error al obtener detalle de traslado ${req.params.id}:`, err.response?.data || err.message);
    res.status(500).json({ ok: false, error: 'Error al consultar el detalle de la solicitud en SAP' });
  }
});

module.exports = router;
