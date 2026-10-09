/**
 * sap.routes.js
 * Rutas de monitoreo y diagnóstico para la integración SAP
 */
'use strict';

const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');
const sapService = require('../services/sap.service');
const sapAccountReview = require('../services/sapAccountReview.service');
const accountReopening = require('../services/accountReopening.service');

// This audit contains patient/account data. A role or an unrelated permission
// must never unlock it through the general authorize middleware's fallback.
function authorizeAccountReview(req, res, next) {
  const user = req.user;
  if (user && (String(user.username || '').toLowerCase() === 'amendoza' ||
    (Array.isArray(user.permisos) && user.permisos.includes('auditoria-reapertura-cuentas')))) return next();
  return res.status(403).json({ success: false, error: 'No tienes permiso para consultar la reapertura de cuentas.', code: 'ACCOUNT_REVIEW_FORBIDDEN' });
}

function authorizeAccountReopening(req, res, next) {
  const user = req.user;
  if (user && (String(user.username || '').toLowerCase() === 'amendoza' ||
    (Array.isArray(user.permisos) && user.permisos.includes('ejecutar-reapertura-cuentas')))) return next();
  return res.status(403).json({ success: false, error: 'No tienes permiso para reaperturar cuentas.', code: 'ACCOUNT_REOPENING_FORBIDDEN' });
}

// SAP supplies the fresh eligibility check; the only account changes occur in Vertical.
// A dropped connection cancels pending preparation. Once execution starts, its
// durable receipt must be completed so the user can safely consult its result.
for (const action of ['prepare', 'execute', 'status']) {
  router.post(`/account-review/:account/reopening/${action}`, authenticate, authorizeAccountReview, authorizeAccountReopening, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    if (action !== 'execute') res.once('close', cancel);
    try {
      const body = req.body || {};
      const data = await accountReopening[action](req.params.account, {
        user: req.user, signal: controller.signal,
        ...(action !== 'prepare' ? { previewToken: body.previewToken } : {}),
        ...(action === 'execute' ? { confirmedAccount: body.confirmedAccount } : {}),
      });
      if (!res.destroyed) res.json({ success: true, data });
    } catch (error) {
      if (res.destroyed || controller.signal.aborted) return;
      const status = [400, 403, 404, 409, 422, 502, 503].includes(error.status) ? error.status : 502;
      res.status(status).json({
        success: false,
        error: error.publicMessage || (action === 'prepare'
          ? 'No se pudo preparar la reapertura. Verifica la cuenta e intenta de nuevo.'
          : 'No se pudo confirmar el resultado de la reapertura. Consulta su estado antes de volver a intentarlo.'),
        code: error.publicMessage && error.code ? error.code : 'ACCOUNT_REOPENING_FAILED',
      });
    } finally {
      res.removeListener('close', cancel);
      controller.abort();
    }
  });
}

router.get('/account-review/search', authenticate, authorizeAccountReview, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const controller = new AbortController();
  const cancel = () => { if (!res.writableEnded) controller.abort(); };
  res.once('close', cancel);
  try {
    const data = await sapAccountReview.search({ mode: req.query.mode, q: req.query.q }, { signal: controller.signal });
    res.json({ success: true, data });
  } catch (error) {
    if (controller.signal.aborted || res.destroyed) return;
    const status = error.status === 400 ? 400 : 502;
    res.status(status).json({ success: false, error: status === 400 ? error.message : 'No se pudo completar la búsqueda en SAP. Intenta de nuevo.' });
  } finally {
    res.removeListener('close', cancel);
    controller.abort();
  }
});

router.get('/account-review/:account', authenticate, authorizeAccountReview, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const controller = new AbortController();
  const cancel = () => { if (!res.writableEnded) controller.abort(); };
  res.once('close', cancel);
  try {
    const data = await sapAccountReview.review(req.params.account, { fullMap: req.query.fullMap === 'true', signal: controller.signal });
    res.json({ success: true, data });
  } catch (error) {
    if (controller.signal.aborted || res.destroyed) return;
    const status = error.status === 400 ? 400 : 502;
    res.status(status).json({ success: false, error: status === 400 ? error.message : 'No se pudo verificar el estado de la cuenta en SAP. Intenta de nuevo.' });
  } finally {
    res.removeListener('close', cancel);
    controller.abort();
  }
});

/**
 * GET /api/sap/ping
 * Realiza una consulta básica a SAP (ej: buscar el nombre de la compañía) 
 * para verificar que el autopiloto de sesión funciona correctamente.
 * Solo administradores pueden correr esta prueba.
 */
router.get('/ping', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    // Consultamos la tabla CompanyService_GetCompanyTime como una prueba inofensiva y rápida
    // O si preferimos algo más estándar: buscar Top 1 item
    const response = await sapService.get('/Items?$top=1&$select=ItemCode,ItemName');
    
    res.status(200).json({
      success: true,
      message: 'Conexión exitosa con SAP Business One',
      data: response.data
    });
  } catch (error) {
    console.error('Error en /api/sap/ping:', error);
    res.status(500).json({
      success: false,
      message: 'Error al comunicarse con SAP',
      error: error.error || error.message || String(error)
    });
  }
});

/**
 * GET /api/sap/warehouses
 * Obtiene el catálogo de almacenes activos de SAP
 */
router.get('/warehouses', authenticate, async (req, res) => {
  try {
    const response = await sapService.get("/Warehouses?$select=WarehouseCode,WarehouseName");
    res.status(200).json({
      success: true,
      data: response.data.value || []
    });
  } catch (error) {
    console.error('Error en /api/sap/warehouses:', error);
    res.status(500).json({
      success: false,
      error: error.error || error.message || String(error)
    });
  }
});

/**
 * GET /api/sap/trace-order/:docNum
 * Busca una orden y rastrea el stock, kardex y traslados de sus insumos.
 */
router.get('/trace-order/:docNum', authenticate, async (req, res) => {
  const { docNum } = req.params;
  try {
    const { pool } = require('../config/pg-db.js');
    
    // 1. Buscar la Orden de Venta
    let order = null;
    const orderRes = await sapService.get(`/Orders?$filter=DocNum eq ${docNum}`);
    if (orderRes.data.value && orderRes.data.value.length > 0) {
      order = orderRes.data.value[0];
    } else {
      // Intentar en órdenes de compra por si acaso
      const poRes = await sapService.get(`/PurchaseOrders?$filter=DocNum eq ${docNum}`);
      if (poRes.data.value && poRes.data.value.length > 0) {
        order = poRes.data.value[0];
      }
    }

    if (!order) {
      return res.status(404).json({ success: false, message: 'Orden no encontrada' });
    }

    const lines = order.DocumentLines || [];
    const itemsData = [];

    for (let line of lines) {
      if (!line.ItemCode) continue;
      
      const itemCode = line.ItemCode;
      const resultItem = {
        ItemCode: itemCode,
        ItemDescription: line.ItemDescription,
        RequestedQuantity: line.Quantity,
        TargetWarehouse: line.WarehouseCode,
        StockByWarehouse: [],
        RecentKardex: [],
        RecentTransfers: []
      };

      try {
        // A. Obtener stock real de SAP
        const itemRes = await sapService.get(`/Items('${itemCode}')?$select=ItemWarehouseInfoCollection`);
        if (itemRes.data && itemRes.data.ItemWarehouseInfoCollection) {
          resultItem.StockByWarehouse = itemRes.data.ItemWarehouseInfoCollection
            .filter(w => w.InStock > 0 || w.Committed > 0)
            .map(w => ({
              WarehouseCode: w.WarehouseCode,
              InStock: w.InStock,
              Committed: w.Committed
            }));
        }

        // B. Obtener Kardex reciente de PG
        const kardexRes = await pool.query(
          `SELECT fecha, almacenorigen, almacendestino, movimiento, documentoref, usuario 
           FROM dw_sap_kardex 
           WHERE codigo = $1 
           ORDER BY fecha DESC LIMIT 10`,
          [itemCode]
        );
        resultItem.RecentKardex = kardexRes.rows;

        // C. Obtener Traslados recientes de PG
        const transRes = await pool.query(
          `SELECT docnum, docdate, fromwarehouse, towarehouse, comments, stocktransferlines 
           FROM dw_sap_traslados 
           WHERE stocktransferlines LIKE $1 
           ORDER BY docdate DESC LIMIT 5`,
          [`%${itemCode}%`]
        );
        
        // Formatear líneas de traslados para mostrar cantidad exacta
        resultItem.RecentTransfers = transRes.rows.map(t => {
          let qty = 0;
          try {
            const linesJson = JSON.parse(t.stocktransferlines);
            const line = linesJson.find(l => l.ItemCode === itemCode);
            if (line) qty = line.Quantity;
          } catch(e) {}
          return {
            DocNum: t.docnum,
            DocDate: t.docdate,
            From: t.fromwarehouse,
            To: t.towarehouse,
            Comments: t.comments,
            QuantityTransferred: qty
          };
        });

      } catch (err) {
        console.error(`Error al rastrear el item ${itemCode}:`, err.message);
      }

      itemsData.push(resultItem);
    }

    res.status(200).json({
      success: true,
      data: {
        OrderInfo: {
          DocNum: order.DocNum,
          DocDate: order.DocDate,
          CardCode: order.CardCode,
          CardName: order.CardName,
          DocumentStatus: order.DocumentStatus,
          DocTotal: order.DocTotal,
          Comments: order.Comments
        },
        Items: itemsData
      }
    });

  } catch (error) {
    console.error('Error en /api/sap/trace-order:', error);
    res.status(500).json({
      success: false,
      error: error.error || error.message || String(error)
    });
  }
});

module.exports = router;
