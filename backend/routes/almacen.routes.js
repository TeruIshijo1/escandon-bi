'use strict';

const express = require('express');
const router = express.Router();
const sapInventoryService = require('../services/sapInventory.service');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { pool } = require('../config/pg-db');

/**
 * GET /api/almacen/inventario
 * Devuelve el inventario exclusivo de Almacén General ('ALG', '01').
 * Excluye los artículos transferidos a sub-almacenes como Almacén de Insumos, CEYE, etc.
 */
router.get('/inventario', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'ALMACEN_GENERAL']), async (req, res) => {
  try {
    const { warehouse } = req.query;

    // Si el caché está vacío (ej. servidor recién prendido), forzamos una carga
    if (sapInventoryService.getInventoryCache().length === 0) {
      await sapInventoryService.syncInventoryCache();
    }
    
    // Filtrar únicamente los artículos que físicamente pertenecen a Almacén General ('ALG' o '01')
    const generalItems = sapInventoryService.getInventoryCache().filter(item => {
      if (warehouse) return item.WhsCode === warehouse;
      return item.WhsCode === 'ALG' || item.WhsCode === '01';
    });
    
    res.json({ ok: true, data: generalItems });
  } catch (err) {
    console.error('[Almacen General Inventario SAP Error]', err);
    res.status(500).json({ ok: false, error: 'Error interno al consultar el inventario general' });
  }
});

/**
 * GET /api/almacen/ubicaciones
 * Devuelve todas las ubicaciones donde existe stock físico del artículo
 */
router.get('/ubicaciones', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'ALMACEN_GENERAL', 'USUARIO_OPERATIVO']), async (req, res) => {
  const { itemCode } = req.query;
  if (!itemCode) {
    return res.status(400).json({ ok: false, error: 'Código de artículo requerido (itemCode)' });
  }

  // 1. Validar si el caché ya está listo
  if (sapInventoryService.getInventoryCache().length > 0) {
    const allStock = sapInventoryService.getInventoryCache();
    const batches = sapInventoryService.getBatchesCache() || [];

    // Mapear almacenes con nombres legibles
    const whsNames = {
      '01': 'Almacén General (01)',
      'ALG': 'Almacén General (ALG)',
      '02': 'Farmacia Quirófano (02)',
      'FAR': 'Farmacia General (FAR)',
      '03': 'Sub-Almacén Urgencias (03)',
      '05': 'CEYE (05)',
      'CON': 'Consignación (CON)'
    };

    // Filtrar registros del insumo en todos los almacenes
    const locations = allStock
      .filter(item => item.ItemCode === itemCode && Number(item.QuantityOnStock || item.OnHand || 0) > 0)
      .map(item => {
        // Encontrar lotes y caducidades vinculados a este almacén para el artículo
        const itemBatches = batches
          .filter(b => b.ItemCode === itemCode && b.WhsCode === item.WhsCode)
          .map(b => ({
            lote: b.Batch || b.BatchNum || 'S/L',
            caducidad: b.ExpirationDate || b.ExpDate || 'Sin Fecha'
          }));

        return {
          almacen: whsNames[item.WhsCode] || `Otro Almacén (${item.WhsCode})`,
          whsCode: item.WhsCode,
          stock: Number(item.QuantityOnStock || item.OnHand || 0),
          costo: Number(item.PurchaseCost || 0),
          precio: Number(item.SalesPrice || 0),
          detallesLotes: itemBatches
        };
      });
    
    return res.json({ ok: true, data: locations });
  }

  // Si no hay caché, error
  res.status(503).json({ ok: false, error: 'El caché de inventario aún no está listo. Intente de nuevo en unos segundos.' });
});

/**
 * GET /api/almacen/traslados
 * Lista las solicitudes de traslado desde PostgreSQL (caching de SAP)
 */
router.get('/traslados', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'ALMACEN_GENERAL']), async (req, res) => {
  try {
    const { startDate, endDate, search } = req.query;
    
    let query = 'SELECT docentry AS "DocEntry", docnum AS "DocNum", docdate AS "DocDate", duedate AS "DueDate", fromwarehouse AS "FromWarehouse", towarehouse AS "ToWarehouse", documentstatus AS "DocumentStatus", comments AS "Comments", requester AS "Requester", requestername AS "RequesterName", stocktransferlines AS "StockTransferLines", lastsync AS "LastSync" FROM dw_sap_traslados';
    let conditions = [];
    let values = [];
    
    if (search) {
      conditions.push('(docnum::text LIKE $1 OR towarehouse LIKE $1 OR comments LIKE $1)');
      values.push(`%${search}%`);
    } else if (startDate && endDate) {
      conditions.push('docdate::date >= $1 AND docdate::date <= $2');
      values.push(startDate);
      values.push(endDate);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY docentry DESC LIMIT 1500';
    
    const pgRes = await pool.query(query, values);
    res.json({ ok: true, data: pgRes.rows });
  } catch (err) {
    console.error(`[Almacen] Error al obtener solicitudes de traslado locales:`, err);
    res.status(500).json({ ok: false, error: 'Error al consultar las solicitudes de traslado en la base de datos local' });
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

let lastAutoSyncTimestamp = 0;

async function checkAndSyncStaleData(cleanEnd) {
  const yesterdayClean = new Date(Date.now() - 86400000).toISOString().split('T')[0].replace(/-/g, '');
  const isRecentQuery = cleanEnd >= yesterdayClean;
  const isStale = (Date.now() - lastAutoSyncTimestamp > 15 * 60 * 1000);

  if (isRecentQuery && isStale) {
    lastAutoSyncTimestamp = Date.now();
    try {
      console.log('[Almacén Reportes] Sincronizando datos recientes en background...');
      const { runAlmacenSync } = require('../services/almacenSync.service');
      await runAlmacenSync();
    } catch (err) {
      console.error('[Almacén Reportes] Error en sincronización bajo demanda:', err.message);
    }
  }
}

/**
 * GET /api/almacen/reportes/kardex
 */
router.get('/reportes/kardex', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'ALMACEN_GENERAL']), async (req, res) => {
  try {
    const { startDate, endDate, itemCode } = req.query;

    const cleanEnd = endDate ? endDate.replace(/-/g, '') : '';
    await checkAndSyncStaleData(cleanEnd);
    
    let query = `
      SELECT 
        codigo AS "Código", 
        descripcion AS "Descripción",
        almacenorigen AS "Almacén Origen",
        almacendestino AS "Almacén Destino",
        documentoref AS "Documento Referencia",
        existencias AS "Existencias",
        fecha AS "Fecha y hora",
        servicio AS "Servicio que solicita",
        usuario AS "Usuario que libera",
        movimiento AS "Historial de movimiento",
        valoracumulado AS "Valor acumulado por articulo"
      FROM dw_sap_kardex 
      WHERE fecha::date >= $1 AND fecha::date <= $2
    `;
    let params = [startDate, endDate];
    
    if (itemCode) {
      query += ` AND (codigo LIKE $3 OR codigo = 'ENTRADA')`;
      params.push(`%${itemCode}%`);
    }
    
    const pgRes = await pool.query(query, params);
    res.json({ ok: true, data: pgRes.rows });
  } catch (err) {
    console.error('[Kardex Error]', err.message);
    res.status(500).json({ ok: false, error: 'Error al generar Kardex' });
  }
});

/**
 * GET /api/almacen/reportes/censo
 */
router.get('/reportes/censo', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'ALMACEN_GENERAL']), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const cleanEnd = endDate ? endDate.replace(/-/g, '') : '';
    await checkAndSyncStaleData(cleanEnd);

    const dbRes = await pool.query(`
      SELECT 
        cuentahospitalaria AS "Cuenta Hospitalaria",
        nombrepaciente AS "Nombre Paciente",
        habitacion AS "Habitacion",
        fechaingreso AS "Fecha Ingreso"
      FROM dw_cirrus_censo
      WHERE fechaingreso::date >= $1 AND fechaingreso::date <= $2
    `, [startDate, endDate]);
      
    res.json({ ok: true, data: dbRes.rows });
  } catch (err) {
    console.error('[Censo PG Error]', err);
    res.status(500).json({ ok: false, error: 'Error al generar Censo cruzado' });
  }
});

/**
 * GET /api/almacen/reportes/entradas
 */
router.get('/reportes/entradas', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'ALMACEN_GENERAL']), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const cleanEnd = endDate ? endDate.replace(/-/g, '') : '';
    await checkAndSyncStaleData(cleanEnd);

    let query = `
      SELECT 
        fecha AS "Fecha",
        numeroentrada AS "Numero de entrada",
        numerofactura AS "Numero de factura",
        nombreproveedor AS "Nombre proveedor",
        COUNT(DISTINCT codigo) AS "Tipos de articulos",
        SUM(cantidadarticulos) AS "Cantidad de articulos",
        SUM(importefactura) AS "Importe de factura"
      FROM dw_sap_entradas
      WHERE fecha::date >= $1 AND fecha::date <= $2
      GROUP BY numeroentrada, numerofactura, nombreproveedor, fecha
      ORDER BY fecha DESC
    `;
    
    const pgRes = await pool.query(query, [startDate, endDate]);
    res.json({ ok: true, data: pgRes.rows });
  } catch (err) {
    console.error('[Entradas Error]', err.message);
    res.status(500).json({ ok: false, error: 'Error al generar Entradas' });
  }
});

/**
 * GET /api/almacen/reportes/consumo
 */
router.get('/reportes/consumo', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'ALMACEN_GENERAL']), async (req, res) => {
  try {
    const { startDate, endDate, itemCode } = req.query;
    
    const cleanEnd = endDate ? endDate.replace(/-/g, '') : '';
    await checkAndSyncStaleData(cleanEnd);

    let query = `
      SELECT 
        fechacargo::date AS "Fecha Cargo",
        codigo AS "Codigo",
        insumo AS "Insumo",
        cantidad AS "Cantidad",
        lote AS "Lote",
        caducidad AS "Caducidad",
        paciente AS "Paciente",
        habitacion AS "Habitacion",
        medico AS "Medico",
        usuariocargo AS "Usuario Cargo"
      FROM dw_cirrus_consumo
      WHERE fechacargo::date >= $1 AND fechacargo::date <= $2
    `;
    const params = [startDate, endDate];
    
    if (itemCode) {
      query += ` AND codigo = $3`;
      params.push(itemCode);
    }
    
    const pgRes = await pool.query(query, params);
    res.json({ ok: true, data: pgRes.rows });
  } catch (err) {
    console.error('[Consumo PG Error]', err);
    res.status(500).json({ ok: false, error: 'Error al generar Historial de Consumo cruzado' });
  }
});

/**
 * GET /api/almacen/reportes/detalle/kardex/:codigo
 */
router.get('/reportes/detalle/kardex/:codigo', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'ALMACEN_GENERAL']), async (req, res) => {
  try {
    const { codigo } = req.params;
    
    const pgRes = await pool.query(`
      SELECT 
        codigo AS "Codigo", descripcion AS "Descripcion", almacenorigen AS "AlmacenOrigen", almacendestino AS "AlmacenDestino", documentoref AS "DocumentoRef", existencias AS "Existencias", fecha AS "Fecha", servicio AS "Servicio", usuario AS "Usuario", movimiento AS "Movimiento", valoracumulado AS "ValorAcumulado"
      FROM dw_sap_kardex
      WHERE codigo LIKE $1 OR descripcion LIKE $1 OR documentoref LIKE $1
      ORDER BY fecha DESC
      LIMIT 50
    `, [`%${codigo}%`]);

    res.json({ ok: true, data: pgRes.rows });
  } catch (err) {
    console.error('[Detalle Kardex Error]', err);
    res.status(500).json({ ok: false, error: 'Error al obtener detalle del Kardex' });
  }
});

/**
 * GET /api/almacen/reportes/detalle/censo/:cuenta
 */
router.get('/reportes/detalle/censo/:cuenta', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'ALMACEN_GENERAL']), async (req, res) => {
  try {
    const { cuenta } = req.params;

    const pgResPac = await pool.query(`
      SELECT cuentahospitalaria AS "CuentaHospitalaria", nombrepaciente AS "NombrePaciente", habitacion AS "Habitacion", fechaingreso AS "FechaIngreso" 
      FROM dw_cirrus_censo 
      WHERE cuentahospitalaria = $1
    `, [cuenta]);
    const paciente = pgResPac.rows[0] || null;

    const pgResCargos = await pool.query(`
      SELECT 
        fechacargo AS "Fecha Cargo",
        codigo AS "Código Insumo",
        insumo AS "Descripción Insumo",
        cantidad AS "Cantidad",
        COALESCE(preciounitario, 0) AS "Precio Unitario",
        COALESCE(montocobrado, 0) AS "Monto Total",
        lote AS "Lote",
        habitacion AS "Área / Cama",
        usuariocargo AS "Usuario Liberó"
      FROM dw_cirrus_consumo
      WHERE cuentahospitalaria = $1 OR (paciente LIKE $2 AND paciente != '')
      ORDER BY idcargo DESC
    `, [cuenta, paciente ? `%${paciente.NombrePaciente}%` : `%${cuenta}%`]);

    res.json({ ok: true, paciente: paciente || {}, cargos: pgResCargos.rows });
  } catch (err) {
    console.error('[Detalle Censo Error]', err);
    res.status(500).json({ ok: false, error: 'Error al obtener cargos del paciente' });
  }
});

/**
 * GET /api/almacen/reportes/detalle/entradas/:numFactura
 */
router.get('/reportes/detalle/entradas/:numFactura', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'ALMACEN_GENERAL']), async (req, res) => {
  try {
    let { numFactura } = req.params;
    numFactura = String(numFactura).trim();

    const pgResEntrada = await pool.query(`
      SELECT fecha AS "Fecha", numeroentrada AS "NumeroEntrada", numerofactura AS "NumeroFactura", nombreproveedor AS "NombreProveedor" 
      FROM dw_sap_entradas 
      WHERE numerofactura LIKE $1 OR numeroentrada LIKE $1 
      LIMIT 1
    `, [`%${numFactura}%`]);
    const entrada = pgResEntrada.rows[0] || null;
    
    const pgResPartidas = await pool.query(`
      SELECT 
        codigo AS "Código",
        descripcion AS "Descripción Insumo",
        almacenreceptor AS "Almacén Receptor",
        cantidadarticulos AS "Cantidad Recibida",
        preciounitario AS "Precio Unitario",
        importefactura AS "Importe Total"
      FROM dw_sap_entradas
      WHERE numerofactura LIKE $1 OR numeroentrada LIKE $1
      ORDER BY identrada ASC
    `, [`%${numFactura}%`]);

    res.json({ ok: true, entrada: entrada || {}, movimientos: pgResPartidas.rows });
  } catch (err) {
    console.error('[Detalle Entradas Error]', err);
    res.status(500).json({ ok: false, error: 'Error al obtener detalle de la entrada' });
  }
});

/**
 * GET /api/almacen/punto-reorden
 * Devuelve el catálogo de Insumos con Mínimos, Máximos, Stock Actual, Pedidos SAP en curso y Notas de Almacén.
 */
router.get('/punto-reorden', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'ALMACEN_GENERAL', 'USUARIO_OPERATIVO']), async (req, res) => {
  try {
    const sapInventoryService = require('../services/sapInventory.service');
    const inventoryMap = sapInventoryService.getInventoryMap();

    // 1. Obtener Pedidos (PO) y Solicitudes (PR) abiertas en PostgreSQL (ultra-rápido)
    let openOrdersMap = new Map();
    const pgResPedidos = await pool.query(`
      SELECT dockey AS "DocKey", docentry AS "DocEntry", docnum AS "DocNum", tipodocumento AS "TipoDocumento", tiponombre AS "TipoNombre", fechadoc AS "FechaDoc", cardcode AS "CardCode", cardname AS "CardName", usersign AS "UserSign", usuarionombre AS "UsuarioNombre", docstatus AS "DocStatus", doctotal AS "DocTotal", estatustexto AS "EstatusTexto", itemsjson AS "ItemsJSON" 
      FROM dw_sap_pedidos 
      WHERE docstatus = 'bost_Open'
    `);
    let pedidosDB = pgResPedidos.rows;
    
    // Si la tabla local no tiene datos aún, disparar sync asíncrono
    if (pedidosDB.length === 0) {
      const { syncPedidosSAP } = require('../services/almacenSync.service');
      syncPedidosSAP().catch(console.error);
    }

    pedidosDB.forEach(p => {
      let itemsList = [];
      try { itemsList = JSON.parse(p.ItemsJSON || '[]'); } catch(e){}
      itemsList.forEach(l => {
        if (l.openQuantity > 0) {
          const list = openOrdersMap.get(l.itemCode) || [];
          list.push({
            folio: p.DocNum,
            tipo: p.TipoNombre,
            fecha: p.FechaDoc,
            usuario: p.UsuarioNombre,
            proveedor: p.CardName || 'N/A',
            cantPedida: l.quantity,
            cantPendiente: l.openQuantity,
            estatus: p.EstatusTexto
          });
          openOrdersMap.set(l.itemCode, list);
        }
      });
    });

    // 2. Cruzar con tabla de settings en PostgreSQL
    const pgResSettings = await pool.query(`
      SELECT itemcode AS "ItemCode", itemdescription AS "ItemDescription", minstock AS "MinStock", maxstock AS "MaxStock", note AS "Note", customsolicitud AS "CustomSolicitud", lastupdated AS "LastUpdated" 
      FROM dw_sap_reorder_settings 
      ORDER BY itemcode ASC
    `);
    const settings = pgResSettings.rows;
    
    let reorderList = [];
    let itemsRequiringPurchase = 0;
    let itemsCritical = 0;
    let itemsWithActiveOrder = 0;

    for (const item of settings) {
      const sapItem = inventoryMap.get(item.ItemCode);
      const stock = sapItem ? (sapItem.QuantityOnStock ?? sapItem.OnHand ?? 0) : 0;
      const minStock = Number(item.MinStock || 0);
      const maxStock = Number(item.MaxStock || 0);
      const calcPromedio = maxStock - stock;
      const hasCustomSolicitud = item.CustomSolicitud !== null && item.CustomSolicitud !== undefined;
      const sugCompra = hasCustomSolicitud 
        ? Number(item.CustomSolicitud) 
        : ((stock <= minStock && maxStock > 0) ? Math.max(0, maxStock - stock) : 0);
      const costoCompra = sapItem ? Number(sapItem.PurchaseCost || 0) : 0;

      let estatus = 'OPTIMO';
      if (stock === 0 && minStock > 0) {
        estatus = 'CRITICO';
        itemsCritical++;
      } else if (stock <= minStock && minStock > 0) {
        estatus = 'REORDEN';
      } else if (stock > maxStock && maxStock > 0) {
        estatus = 'SOBRESTOCK';
      }

      const pedidos = openOrdersMap.get(item.ItemCode) || [];
      if (sugCompra > 0) itemsRequiringPurchase++;
      if (pedidos.length > 0) itemsWithActiveOrder++;

      reorderList.push({
        ...item,
        StockActual: stock,
        CalculoPromedio: calcPromedio,
        SolicitudCompra: sugCompra,
        EsPersonalizada: hasCustomSolicitud,
        CostoUnitario: costoCompra,
        ImporteSugerido: Math.round(sugCompra * costoCompra * 100) / 100,
        Estatus: estatus,
        PedidosEnCurso: pedidos
      });
    }

    res.json({
      ok: true,
      data: reorderList,
      stats: {
        totalItems: reorderList.length,
        itemsRequiringPurchase,
        itemsCritical,
        itemsWithActiveOrder
      }
    });
  } catch (err) {
    console.error('[Punto Reorden Error]', err);
    res.status(500).json({ ok: false, error: 'Error al consultar Punto de Reorden' });
  }
});

/**
 * PUT /api/almacen/punto-reorden/:code
 * Actualiza Mínimo, Máximo, Notita o Solicitud de Compra Personalizada de un artículo en PostgreSQL.
 */
router.put('/punto-reorden/:code', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'ALMACEN_GENERAL', 'USUARIO_OPERATIVO']), async (req, res) => {
  try {
    const { code } = req.params;
    const { minStock, maxStock, note, customSolicitud } = req.body;

    const pgResExisting = await pool.query(`
      SELECT itemcode AS "ItemCode", itemdescription AS "ItemDescription", minstock AS "MinStock", maxstock AS "MaxStock", note AS "Note", customsolicitud AS "CustomSolicitud", lastupdated AS "LastUpdated" 
      FROM dw_sap_reorder_settings 
      WHERE itemcode = $1
    `, [code]);
    const existing = pgResExisting.rows[0] || null;

    let finalCustom = existing ? existing.CustomSolicitud : null;
    if (customSolicitud !== undefined) {
      if (customSolicitud === null || customSolicitud === '' || customSolicitud === 'RESET') {
        finalCustom = null;
      } else {
        finalCustom = Math.max(0, parseInt(customSolicitud));
      }
    }

    if (!existing) {
      await pool.query(`
        INSERT INTO dw_sap_reorder_settings (itemcode, itemdescription, minstock, maxstock, note, customsolicitud, lastupdated)
        VALUES ($1, 'Insumo Médico', $2, $3, $4, $5, CURRENT_TIMESTAMP)
      `, [code, Number(minStock || 0), Number(maxStock || 0), String(note || ''), finalCustom]);
    } else {
      await pool.query(`
        UPDATE dw_sap_reorder_settings 
        SET minstock = $1, maxstock = $2, note = $3, customsolicitud = $4, lastupdated = CURRENT_TIMESTAMP
        WHERE itemcode = $5
      `, [
        minStock !== undefined ? Number(minStock) : existing.MinStock,
        maxStock !== undefined ? Number(maxStock) : existing.MaxStock,
        note !== undefined ? String(note) : existing.Note,
        finalCustom,
        code
      ]);
    }

    res.json({ ok: true, message: 'Configuración de reorden actualizada correctamente' });
  } catch (err) {
    console.error('[PUT Punto Reorden Error]', err);
    res.status(500).json({ ok: false, error: 'Error al actualizar notita / punto de reorden' });
  }
});

/**
 * GET /api/almacen/pedidos-sap
 * Devuelve todas las Ordenes de Compra y Solicitudes abiertas en SAP con desglose de usuarios y estatus en tiempo real.
 */
router.get('/pedidos-sap', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'ALMACEN_GENERAL', 'USUARIO_OPERATIVO']), async (req, res) => {
  try {
    const pgResPedidos = await pool.query(`
      SELECT dockey AS "DocKey", docentry AS "DocEntry", docnum AS "DocNum", tipodocumento AS "TipoDocumento", tiponombre AS "TipoNombre", fechadoc AS "FechaDoc", cardcode AS "CardCode", cardname AS "CardName", usersign AS "UserSign", usuarionombre AS "UsuarioNombre", docstatus AS "DocStatus", doctotal AS "DocTotal", estatustexto AS "EstatusTexto", itemsjson AS "ItemsJSON" 
      FROM dw_sap_pedidos 
      ORDER BY docnum DESC
    `);
    let pedidosDB = pgResPedidos.rows;

    // Si PostgreSQL está vacío o se solicita refresco forzado
    if (pedidosDB.length === 0 || req.query.refresh === 'true') {
      const { syncPedidosSAP } = require('../services/almacenSync.service');
      await syncPedidosSAP();
      const pgResPedidosRefreshed = await pool.query(`
        SELECT dockey AS "DocKey", docentry AS "DocEntry", docnum AS "DocNum", tipodocumento AS "TipoDocumento", tiponombre AS "TipoNombre", fechadoc AS "FechaDoc", cardcode AS "CardCode", cardname AS "CardName", usersign AS "UserSign", usuarionombre AS "UsuarioNombre", docstatus AS "DocStatus", doctotal AS "DocTotal", estatustexto AS "EstatusTexto", itemsjson AS "ItemsJSON" 
        FROM dw_sap_pedidos 
        ORDER BY docnum DESC
      `);
      pedidosDB = pgResPedidosRefreshed.rows;
    } else {
      // Disparar sincronización silenciosa en background
      const { syncPedidosSAP } = require('../services/almacenSync.service');
      syncPedidosSAP().catch(console.error);
    }

    const resultList = pedidosDB.map(p => ({
      docEntry: p.DocEntry,
      folio: p.DocNum,
      tipo: p.TipoNombre,
      tipoCod: p.TipoDocumento,
      fecha: p.FechaDoc,
      proveedor: p.CardName || 'N/A',
      usuario: p.UsuarioNombre,
      total: p.DocTotal || 0,
      estatus: p.EstatusTexto,
      items: JSON.parse(p.ItemsJSON || '[]')
    }));

    res.json({ ok: true, data: resultList });
  } catch (err) {
    console.error('[GET Pedidos SAP Error]', err);
    res.status(500).json({ ok: false, error: 'Error al consultar pedidos SAP' });
  }
});

module.exports = router;
