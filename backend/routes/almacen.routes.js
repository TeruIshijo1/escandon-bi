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

const executeSapQueryViaSL = async (queryName, sqlText, params) => {
  const sapService = require('../services/sap.service');
  await sapService._ensureSession();
  
  try {
    await sapService.post('/SQLQueries', { SqlCode: queryName, SqlName: queryName, SqlText: sqlText });
  } catch (e) {
    try {
      await sapService.patch(`/SQLQueries('${queryName}')`, { SqlName: queryName, SqlText: sqlText });
    } catch (err) {
      console.warn(`[SAP SL Query Register/Patch Warning]:`, err.response?.data?.error?.message?.value || err.message);
    }
  }

  const qs = new URLSearchParams();
  for (let key in params) {
    if (params[key] !== undefined && params[key] !== null) {
      qs.append(key, `'${params[key]}'`);
    }
  }

  const response = await sapService.get(`/SQLQueries('${queryName}')/List?${qs.toString()}`);
  return response.data?.value || [];
};

/**
 * GET /api/almacen/reportes/custom-sap
 * Ejecuta reportes personalizados provistos por soporte de SAP directamente a través de SAP Service Layer
 */
router.get('/reportes/custom-sap', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'ALMACEN_GENERAL']), async (req, res) => {
  try {
    const { reportName, startDate, endDate, docNum } = req.query;
    
    let sqlText = '';
    let params = {};
    let queryCode = `sq_custom_${reportName.replace(/-/g, '_')}`;

    switch (reportName) {
      case 'cuentas-hospitalarias':
        sqlText = `
          SELECT T0.[U_PCNum] AS 'Folio de Atencion Medica', T0.[DocNum] AS 'Numero de documento', T0.[DocStatus] AS 'Status de documento', T0.[TaxDate] AS 'Fecha de documento', T0.[DocDate] AS 'Fecha de contabilizacion', T0.[DocDueDate] AS 'Fecha de vencimiento', T0.[U_PT_Id] AS 'ID Paciente', T0.[U_PCType] AS 'Tipo de Atencion Medica', T0.[U_PTName] AS 'Nombre de Paciente', T0.[U_PTNum] AS 'Numero de Paciente', T0.[CardName] AS 'Nombre de cliente/proveedor', T0.[DocTotal] AS 'Total del documento', T0.[U_UserName] AS 'Usuario' 
          FROM ORDR T0
          WHERE T0.[DocDate] BETWEEN :startDate AND :endDate
          ORDER BY T0.[DocDate]
        `;
        params = { startDate, endDate };
        break;
      case 'atencion-medica-detalle':
        sqlText = `
          SELECT T0.DocNum AS OrdenVenta, T0.DocDate AS FechaDocumento, T0.U_PCNum AS FolioAtencionMedica, T0.U_PTName AS NombrePaciente, T0.U_PRName AS NombreMedico, CASE WHEN T0.U_PCType = 'IP' THEN 'Hospitalizacion' WHEN T0.U_PCType = 'ER' THEN 'Urgencias' ELSE T0.U_PCType END AS TipoAtencion, T0.CardCode AS CodigoCliente, T0.CardName AS NombreCliente, T0.DocTotal AS TotalOrdenVenta, CASE WHEN T0.DocStatus = 'O' THEN 'Abierta' WHEN T0.DocStatus = 'C' THEN 'Cerrada' END AS EstatusDocumento 
          FROM ORDR T0
          WHERE T0.DocDate >= :startDate AND T0.DocDate <= :endDate AND T0.CANCELED = 'N' AND ISNULL(T0.U_PCNum, '') <> '' AND T0.U_PCType IN ('IP', 'ER')
          ORDER BY T0.DocDate, T0.DocNum
        `;
        params = { startDate, endDate };
        break;
      case 'consultas-medicas':
        sqlText = `
          SELECT T0.DocNum AS 'Orden Venta', T0.DocDate AS 'Fecha Documento', T0.DocDueDate AS 'Fecha Entrega', T0.TaxDate AS 'Fecha Contabilizacion', T0.CardCode AS 'Cliente', T0.CardName AS 'Nombre Cliente', T1.ItemCode AS 'Codigo Articulo', T1.Dscription AS 'Descripcion', T1.Quantity AS 'Cantidad', T1.Price AS 'Precio Unitario', T1.LineTotal AS 'Total Linea', T0.DocTotal AS 'Total Documento', T0.U_SONum AS 'Folio Orden Venta', T0.U_PTNum AS 'Numero Paciente', T0.U_PTName AS 'Nombre Paciente', T0.U_PRName AS 'Medico Responsable', T0.U_PRNum AS 'Numero Medico', T0.U_PC_CL AS 'Usuario Medical Suite', T0.U_UserName AS 'Usuario', CASE T0.DocStatus WHEN 'O' THEN 'Abierto' WHEN 'C' THEN 'Cerrado' END AS 'Estatus'
          FROM ORDR T0
          INNER JOIN RDR1 T1 ON T0.DocEntry = T1.DocEntry
          WHERE T0.DocDate BETWEEN :startDate AND :endDate AND ISNULL(T0.U_SONum,'') <> ''
          ORDER BY T0.DocDate, T0.DocNum
        `;
        params = { startDate, endDate };
        break;
      case 'detalles-salida':
        if (docNum && docNum !== 'undefined') {
          queryCode += '_by_doc';
          sqlText = `
            SELECT T1.[DocNum] AS 'Numero de documento', T1.[U_PTName] AS 'Nombre de Paciente', T1.[U_PCNum] AS 'Folio de Atencion Medica', T0.[ItemCode] AS 'Numero de articulo', T0.[Dscription] AS 'Descripcion articulo/serv.', T0.[Quantity] AS 'Cantidad', T1.[DocDate] AS 'Fecha de contabilizacion' 
            FROM IGE1 T0 
            INNER JOIN OIGE T1 ON T1.[DocEntry] = T0.[DocEntry]
            WHERE T1.[DocNum] = :docNum
            ORDER BY T1.[DocNum], T0.[ItemCode]
          `;
          params = { docNum };
        } else {
          queryCode += '_by_range';
          sqlText = `
            SELECT T1.[DocNum] AS 'Numero de documento', T1.[U_PTName] AS 'Nombre de Paciente', T1.[U_PCNum] AS 'Folio de Atencion Medica', T0.[ItemCode] AS 'Numero de articulo', T0.[Dscription] AS 'Descripcion articulo/serv.', T0.[Quantity] AS 'Cantidad', T1.[DocDate] AS 'Fecha de contabilizacion' 
            FROM IGE1 T0 
            INNER JOIN OIGE T1 ON T1.[DocEntry] = T0.[DocEntry]
            WHERE T1.[DocDate] BETWEEN :startDate AND :endDate
            ORDER BY T1.[DocNum], T0.[ItemCode]
          `;
          params = { startDate, endDate };
        }
        break;
      case 'precios-articulos':
        sqlText = `
          SELECT T0.ItemCode, T0.ItemName, T1.ItmsGrpNam AS 'Nombre Grupo', T2.Price AS 'Precio Publico General', T3.Price AS 'Precio Hospitalizacion', T4.Price AS 'Precio 2025' 
          FROM OITM T0
          INNER JOIN OITB T1 ON T0.ItmsGrpCod = T1.ItmsGrpCod
          LEFT JOIN ITM1 T2 ON T0.ItemCode = T2.ItemCode AND T2.PriceList = 2
          LEFT JOIN ITM1 T3 ON T0.ItemCode = T3.ItemCode AND T3.PriceList = 1
          LEFT JOIN ITM1 T4 ON T0.ItemCode = T4.ItemCode AND T4.PriceList = 4
          ORDER BY T1.ItmsGrpNam, T0.ItemCode
        `;
        params = {};
        break;
      case 'interconsultas-jornadas':
        sqlText = `
          SELECT T0.DocDate AS 'Fecha Contable', T0.DocNum AS 'Numero Factura', T0.CardCode AS 'Codigo Cliente', T0.CardName AS 'Cliente', T0.U_PCNum AS 'Folio Atencion Medica', CASE WHEN T0.U_PCType = 'IP' THEN 'Hospitalizacion' WHEN T0.U_PCType = 'ER' THEN 'Urgencias' ELSE T0.U_PCType END AS 'Tipo Atencion Medica', T0.U_PRNum AS 'Codigo Medico', T0.U_PRName AS 'Nombre Medico', T0.U_PTNum AS 'Folio Paciente', T0.U_PTName AS 'Nombre Paciente', T1.ItemCode AS 'Codigo Servicio', T1.Dscription AS 'Servicio', CASE WHEN T1.ItemCode IN ('SER0655', 'SER0715', 'SER0664', 'SER0519', 'SER0537', 'SER0716') THEN 'Jornada' WHEN T1.ItemCode IN ('SER1277', 'SER1423', 'SER0507', 'SER0525') THEN 'Interconsulta' END AS 'Tipo Servicio', T1.Quantity AS 'Cantidad', T1.Price AS 'Precio Unitario', T1.DiscPrcnt AS 'Porcentaje Descuento', T1.LineTotal AS 'Total Linea', CASE WHEN T0.DocStatus = 'O' THEN 'Abierta' WHEN T0.DocStatus = 'C' THEN 'Cerrada' END AS 'Estatus Factura'
          FROM OINV T0
          INNER JOIN INV1 T1 ON T0.DocEntry = T1.DocEntry
          WHERE T0.DocDate >= :startDate AND T0.DocDate <= :endDate AND T0.CANCELED = 'N' AND T0.U_PCNum IS NOT NULL AND T0.U_PCNum <> 0 AND T1.ItemCode IN ('SER0655', 'SER0715', 'SER0664', 'SER0519', 'SER0537', 'SER0716', 'SER1277', 'SER1423', 'SER0507', 'SER0525')
          ORDER BY T0.DocDate, T0.DocNum, T1.ItemCode
        `;
        params = { startDate, endDate };
        break;
      default:
        return res.status(400).json({ ok: false, error: 'Reporte no válido o no especificado.' });
    }

    const data = await executeSapQueryViaSL(queryCode, sqlText, params);
    res.json({ ok: true, data });
  } catch (err) {
    console.error(`[Almacen] Error en reporte custom-sap:`, err);
    res.status(500).json({ ok: false, error: 'Error al consultar la base de datos remota de SAP' });
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

/**
 * GET /api/almacen/ml-dataset
 * Retorna el dataset analítico completo ordenado por nivel de riesgo
 */
router.get('/ml-dataset', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'ALMACEN_GENERAL']), async (req, res) => {
  try {
    const pgRes = await pool.query(`
      SELECT 
        itemcode AS "itemcode",
        itemdescription AS "itemdescription",
        stock_actual AS "stock_actual",
        consumo_7d AS "consumo_7d",
        consumo_15d AS "consumo_15d",
        consumo_30d AS "consumo_30d",
        consumo_promedio_diario AS "consumo_promedio_diario",
        variabilidad_consumo AS "variabilidad_consumo",
        minstock AS "minstock",
        maxstock AS "maxstock",
        pedidos_abiertos AS "pedidos_abiertos",
        fecha_ultimo_movimiento AS "fecha_ultimo_movimiento",
        dias_stock_restante AS "dias_stock_restante",
        riesgo_base AS "riesgo_base",
        fecha_calculo AS "fecha_calculo"
      FROM ml_dataset_reorden_sku
      ORDER BY 
        CASE riesgo_base 
          WHEN 'CRITICO' THEN 1
          WHEN 'ALTO' THEN 2
          WHEN 'MEDIO' THEN 3
          ELSE 4 
        END, 
        dias_stock_restante ASC,
        itemcode ASC
    `);
    res.json({ ok: true, data: pgRes.rows });
  } catch (err) {
    console.error('[GET ML Dataset Error]', err);
    res.status(500).json({ ok: false, error: 'Error al consultar el dataset analítico de ML' });
  }
});

/**
 * POST /api/almacen/ml-dataset/sync
 * Fuerza la regeneración y cálculo del dataset analítico
 */
router.post('/ml-dataset/sync', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'ALMACEN_GENERAL']), async (req, res) => {
  try {
    const { syncMLDataset } = require('../services/mlDataset.service');
    const count = await syncMLDataset();
    res.json({ ok: true, message: `Dataset analítico sincronizado con éxito. ${count} registros calculados.` });
  } catch (err) {
    console.error('[POST Sync ML Dataset Error]', err);
    res.status(500).json({ ok: false, error: 'Error al sincronizar el dataset analítico: ' + err.message });
  }
});

module.exports = router;
