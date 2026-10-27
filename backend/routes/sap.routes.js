

'use strict';

const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');
const sapService = require('../services/sap.service');
const sapAccountReview = require('../services/sapAccountReview.service');
const accountReopening = require('../services/accountReopening.service');
const orderTraceSearch = require('../services/orderTraceSearch.service');

function authorizeOrderTrace(req, res, next) {
  if (String(req.user?.username || '').toLowerCase() === 'amendoza' ||
    req.user?.permisos?.includes('rastreo-ordenes')) return next();
  return res.status(403).json({ success: false, error: 'No tienes permiso para consultar el rastreo de órdenes.' });
}

function traceSearchHandler(method, source) {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', cancel);
    try {
      const data = await orderTraceSearch[method]({ mode: req.query.mode, q: req.query.q, offset: req.query.offset }, { signal: controller.signal });
      if (!res.destroyed) res.json({ success: true, data });
    } catch (error) {
      if (controller.signal.aborted || res.destroyed) return;
      const status = error.status === 400 ? 400 : 502;
      res.status(status).json({ success: false, error: status === 400 ? error.message : error.publicMessage || `No se pudo completar la consulta de ${source}. Intenta de nuevo.` });
    } finally { res.removeListener('close', cancel); controller.abort(); }
  };
}
router.get('/trace-accounts/search', authenticate, authorizeOrderTrace, traceSearchHandler('searchAccounts', 'las cuentas del hospital'));
router.get('/trace-orders/search', authenticate, authorizeOrderTrace, traceSearchHandler('searchOrders', 'las órdenes de venta'));

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
    console.error('[AccountReview Search] Error en búsqueda SAP:', error.message, error.code || '', error.status || '');
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
    console.error(`[AccountReview] Error verificando cuenta ${req.params.account} en SAP:`, error.message, error.code || '', error.status || '');
    const status = error.status === 400 ? 400 : 502;
    res.status(status).json({ success: false, error: status === 400 ? error.message : 'No se pudo verificar el estado de la cuenta en SAP. Intenta de nuevo.' });
  } finally {
    res.removeListener('close', cancel);
    controller.abort();
  }
});

router.get('/ping', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {

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

router.get('/trace-order/:docNum', authenticate, authorizeOrderTrace, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { docNum } = req.params;
  const { entity, docEntry } = req.query;
  if (!orderTraceSearch.positiveId(docNum) || (docEntry !== undefined && !orderTraceSearch.positiveId(docEntry)) ||
    (entity !== undefined && !['Orders', 'PurchaseOrders'].includes(entity)) || (docEntry !== undefined && !entity)) {
    return res.status(400).json({ success: false, error: 'Selecciona una orden válida para rastrear.' });
  }
  const controller = new AbortController();
  const cancel = () => { if (!res.writableEnded) controller.abort(); };
  res.once('close', cancel);
  const budgetTimer = setTimeout(() => controller.abort(), 120000);
  const sapGet = endpoint => sapService.get(endpoint, {}, { signal: controller.signal, timeoutMs: 30000 });
  try {
    const { pool } = require('../config/pg-db.js');
    
    // Buscar la Orden de Venta
    let order = null;
    let orderEntity = entity || 'Orders';
    const orderRes = await sapGet(docEntry ? `/${orderEntity}(${Number(docEntry)})` : `/${orderEntity}?$filter=DocNum eq ${Number(docNum)}`);
    if (docEntry) {
      if (Number(orderRes.data?.DocEntry) === Number(docEntry) && Number(orderRes.data?.DocNum) === Number(docNum)) order = orderRes.data;
    } else if (orderRes.data.value && orderRes.data.value.length > 1) {
      return res.status(409).json({ success: false, error: 'Hay más de una orden con ese número. Selecciona la orden desde los resultados de búsqueda.' });
    } else if (orderRes.data.value && orderRes.data.value.length > 0) {
      order = orderRes.data.value[0];
    } else if (!entity) {
      // Intentar en órdenes de compra por si acaso
      const poRes = await sapGet(`/PurchaseOrders?$filter=DocNum eq ${Number(docNum)}`);
      if (poRes.data.value && poRes.data.value.length > 1) {
        return res.status(409).json({ success: false, error: 'Hay más de una orden con ese número. Selecciona una orden específica.' });
      }
      if (poRes.data.value && poRes.data.value.length === 1) {
        order = poRes.data.value[0];
        orderEntity = 'PurchaseOrders';
      }
    }

    if (!order) {
      return res.status(404).json({ success: false, message: 'Orden no encontrada' });
    }

    const lines = order.DocumentLines || [];
    const accounts = [...new Set([order.U_PCNum, ...lines.map(line => line.U_PCNum)].map(orderTraceSearch.positiveId).filter(Boolean))].map(String);
    const itemsData = [];

    for (let line of lines) {
      controller.signal.throwIfAborted();
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
        // Obtener stock real de SAP
        const itemRes = await sapGet(`/Items('${encodeURIComponent(String(itemCode).replace(/'/g, "''"))}')?$select=ItemWarehouseInfoCollection`);
        controller.signal.throwIfAborted();
        if (itemRes.data && itemRes.data.ItemWarehouseInfoCollection) {
          resultItem.StockByWarehouse = itemRes.data.ItemWarehouseInfoCollection
            .filter(w => w.InStock > 0 || w.Committed > 0)
            .map(w => ({
              WarehouseCode: w.WarehouseCode,
              InStock: w.InStock,
              Committed: w.Committed
            }));
        }

        // Obtener Kardex reciente de PG
        const kardexRes = await pool.query(
          `SELECT fecha, almacenorigen, almacendestino, movimiento, documentoref, usuario 
           FROM dw_sap_kardex 
           WHERE codigo = $1 
           ORDER BY fecha DESC LIMIT 10`,
          [itemCode]
        );
        controller.signal.throwIfAborted();
        resultItem.RecentKardex = kardexRes.rows;

        // Obtener Traslados recientes de PG
        const transRes = await pool.query(
          `SELECT docnum, docdate, fromwarehouse, towarehouse, comments, stocktransferlines 
           FROM dw_sap_traslados 
           WHERE stocktransferlines LIKE $1 
           ORDER BY docdate DESC LIMIT 5`,
          [`%${itemCode}%`]
        );
        controller.signal.throwIfAborted();
        
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
        if (controller.signal.aborted) throw err;
        console.error(`Error al rastrear el item ${itemCode}:`, err.message);
      }

      itemsData.push(resultItem);
    }

    res.status(200).json({
      success: true,
      data: {
        OrderInfo: {
          DocEntry: order.DocEntry,
          Entity: orderEntity,
          Account: accounts.length === 1 ? accounts[0] : null,
          Accounts: accounts,
          PatientName: accounts.length <= 1 ? order.U_PTName || null : null,
          PatientNumber: accounts.length <= 1 ? order.U_PTNum || null : null,
          Currency: order.DocCurrency,
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
    if (res.destroyed) return;
    console.error('Error en /api/sap/trace-order:', error);
    res.status(controller.signal.aborted ? 504 : 502).json({
      success: false,
      error: controller.signal.aborted ? 'La consulta tardó demasiado. Intenta de nuevo.' : 'No se pudo consultar la orden. Intenta de nuevo.'
    });
  } finally {
    clearTimeout(budgetTimer);
    res.removeListener('close', cancel);
    controller.abort();
  }
});

module.exports = router;
