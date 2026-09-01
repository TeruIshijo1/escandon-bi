'use strict';

const { pool } = require('../config/pg-db');
const { connectRemoteDB } = require('../config/remote-db');
const sql = require('mssql');
const etlService = require('./etl.service');

function parseSapDate(dateStr) {
  if (!dateStr) return null;
  if (dateStr instanceof Date) return dateStr;
  const str = String(dateStr).trim();
  if (str.length === 8 && /^\d{8}$/.test(str)) {
    const yyyy = str.substring(0, 4);
    const mm = str.substring(4, 6);
    const dd = str.substring(6, 8);
    return new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
  }
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

const executeSAPQuery = async (queryName, sqlText, params) => {
  const sapService = require('../services/sap.service');
  await sapService._ensureSession();
  try {
    await sapService.post('/SQLQueries', { SqlCode: queryName, SqlName: queryName, SqlText: sqlText });
  } catch (e) {
    try {
      await sapService.patch(`/SQLQueries('${queryName}')`, { SqlName: queryName, SqlText: sqlText });
    } catch(err) {
      console.error('[SAP SQL Error]', err.response?.data?.error?.message?.value || err.message);
    }
  }
  const qs = new URLSearchParams();
  for(let key in params) {
    qs.append(key, `'${params[key]}'`);
  }
  const list = await sapService.fetchAllPages(`/SQLQueries('${queryName}')/List?${qs.toString()}`, {}, 5000);
  return list || [];
};

/**
 * Sincroniza el Censo de Pacientes de Cirrus a PostgreSQL
 */
async function syncCenso() {
  try {
    console.log('[Sync] Extrayendo Censo de Pacientes de Cirrus...');
    const remotePool = await connectRemoteDB();
    
    // Traer los admitidos en el último mes
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
    
    const dbRes = await remotePool.request()
      .input('startDate', sql.DateTime, startDate)
      .query(`
        SELECT DISTINCT
          PC.PCNum AS CuentaHospitalaria,
          PT.FullName AS NombrePaciente,
          ISNULL(CURR_FR.FRName, 'NO ESPECIFICADA') AS Habitacion,
          PC.CreatedOn AS FechaIngreso
        FROM dbo.PC PC
        INNER JOIN dbo.PT PT ON PC.PTNum = PT.PTNum
        OUTER APPLY (
            SELECT TOP 1 FRName 
            FROM dbo.PCFR 
            WHERE PCFR.PCNum = PC.PCNum 
            ORDER BY EntryDate DESC
        ) CURR_FR
        WHERE PC.CreatedOn >= @startDate
      `);
      
    const records = dbRes.recordset;
    console.log(`[Sync] Extraídos ${records.length} pacientes del censo. Guardando en PostgreSQL...`);

    for (const r of records) {
      await pool.query(`
        INSERT INTO dw_cirrus_censo (cuentahospitalaria, nombrepaciente, habitacion, fechaingreso, lastsync)
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
        ON CONFLICT(cuentahospitalaria) DO UPDATE SET
          nombrepaciente = EXCLUDED.nombrepaciente,
          habitacion = EXCLUDED.habitacion,
          fechaingreso = EXCLUDED.fechaingreso,
          lastsync = CURRENT_TIMESTAMP
      `, [
        String(r.CuentaHospitalaria),
        String(r.NombrePaciente || ''),
        String(r.Habitacion || ''),
        parseSapDate(r.FechaIngreso)
      ]);
    }

    console.log('[Sync] Censo sincronizado exitosamente.');
    return records.length;
  } catch (err) {
    console.error('[Sync] Error sincronizando Censo:', err);
    throw err;
  }
}

/**
 * Sincroniza los consumos (cargos) cruzados de Cirrus + SAP a PostgreSQL
 */
async function syncConsumo() {
  try {
    console.log('[Sync] Extrayendo Consumos de Cirrus y cruzando con SAP (Últimos 45 días)...');
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 45);
    const endDate = new Date();
    
    const data = await etlService.getCargosFarmaciaSAP({ 
      fechaDesde: startDate.toISOString().split('T')[0], 
      fechaHasta: endDate.toISOString().split('T')[0],
      limit: 100000
    });

    console.log(`[Sync] Cruzados ${data.length} registros de consumo. Guardando en PostgreSQL...`);

    // Limpiamos los últimos 45 días para evitar duplicados y volvemos a insertar
    await pool.query(`DELETE FROM dw_cirrus_consumo WHERE fechacargo >= $1`, [startDate]);

    for (const d of data) {
      await pool.query(`
        INSERT INTO dw_cirrus_consumo (
          cuentahospitalaria, fechacargo, codigo, insumo, cantidad, preciounitario, montocobrado, lote, caducidad, 
          paciente, habitacion, medico, usuariocargo, lastsync
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP
        )
      `, [
        String(d.Cuenta || ''),
        parseSapDate(d.FechaCargo || d.Fecha),
        String(d.Codigo || ''),
        String(d.Insumo || ''),
        Number(d.CantidadCargada ?? d.Cantidad ?? 0),
        Number(d.PrecioUnitario || 0),
        Number(d.MontoCobrado || 0),
        String(d.Lote || ''),
        d.Caducidad ? String(d.Caducidad) : '',
        String(d.NombrePaciente || d.Paciente || ''),
        String(d.AreaHospitalaria || d.Habitacion || ''),
        String(d.MedicoTratante || d.Medico || ''),
        String(d.UsuarioCargo || d.Usuario || '')
      ]);
    }

    console.log('[Sync] Consumos sincronizados exitosamente.');
    return data.length;
  } catch (err) {
    console.error('[Sync] Error sincronizando Consumos:', err);
    throw err;
  }
}

/**
 * Sincroniza Entradas (OPDN / PDN1) de los últimos 60 días a PostgreSQL
 */
async function syncEntradas() {
  try {
    console.log('[Sync] Extrayendo Entradas de Factura con partidas individuales (SAP)...');
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 60);
    const sDate = startDate.toISOString().split('T')[0].replace(/-/g, '');
    const eDate = new Date().toISOString().split('T')[0].replace(/-/g, '');

    const sqlText = `
      SELECT 
        T0.DocDate AS "Fecha",
        T0.DocNum AS "NumeroEntrada",
        T0.NumAtCard AS "NumeroFactura",
        T0.CardName AS "NombreProveedor",
        T1.ItemCode AS "Codigo",
        T1.Dscription AS "Descripcion",
        T1.Quantity AS "CantidadArticulos",
        T1.Price AS "PrecioUnitario",
        T1.LineTotal AS "ImporteFactura",
        T1.WhsCode AS "AlmacenReceptor"
      FROM OPDN T0
      INNER JOIN PDN1 T1 ON T0.DocEntry = T1.DocEntry
      WHERE T0.DocDate >= :sDate AND T0.DocDate <= :eDate
      ORDER BY T0.DocDate DESC
    `;

    const data = await executeSAPQuery('sq_sync_entradas_lineas', sqlText, { sDate, eDate });
    console.log(`[Sync] Obtenidas ${data.length} partidas de Entradas. Guardando en PostgreSQL...`);

    await pool.query(`DELETE FROM dw_sap_entradas`);

    for (const d of data) {
      await pool.query(`
        INSERT INTO dw_sap_entradas (
          fecha, numeroentrada, numerofactura, nombreproveedor, codigo, descripcion, cantidadarticulos, preciounitario, importefactura, almacenreceptor, lastsync
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP
        )
      `, [
        parseSapDate(d.Fecha),
        String(d.NumeroEntrada || ''),
        String(d.NumeroFactura || ''),
        String(d.NombreProveedor || ''),
        String(d.Codigo || ''),
        String(d.Descripcion || ''),
        Number(d.CantidadArticulos || 0),
        Number(d.PrecioUnitario || 0),
        Number(d.ImporteFactura || 0),
        String(d.AlmacenReceptor || 'ALG')
      ]);
    }
    return data.length;
  } catch (err) {
    console.error('[Sync] Error sincronizando Entradas:', err);
    throw err;
  }
}

/**
 * Genera el Kardex de inventario en PostgreSQL
 */
async function syncKardex() {
  try {
    console.log('[Sync] Generando Kardex unificado con trazabilidad completa de almacenes en PostgreSQL...');
    
    // Obtener mapa de existencias actuales desde SAP
    const stockMap = new Map();
    try {
      const sapInventoryService = require('./sapInventory.service');
      await sapInventoryService.syncInventoryCache();
      const invCache = sapInventoryService.getInventoryCache() || [];
      invCache.forEach(item => {
        stockMap.set(item.ItemCode, (stockMap.get(item.ItemCode) || 0) + Number(item.QuantityOnStock || 0));
      });
    } catch(e) {
      console.log('[Sync Kardex] No se pudo actualizar el caché de inventario SAP.');
    }

    await pool.query(`DELETE FROM dw_sap_kardex`);

    // 1. Insertar Entradas (Recepción en Almacén General)
    const entradasRes = await pool.query(`SELECT * FROM dw_sap_entradas`);
    for (const e of entradasRes.rows) {
      await pool.query(`
        INSERT INTO dw_sap_kardex (
          codigo, descripcion, almacenorigen, almacendestino, documentoref, existencias, fecha, servicio, usuario, movimiento, valoracumulado, lastsync
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP
        )
      `, [
        'ENTRADA',
        `Entrada Factura ${e.numerofactura || ''} - ${e.nombreproveedor || ''}`,
        `Proveedor: ${e.nombreproveedor || 'Externo'}`,
        'Almacén General (01)',
        `Factura ${e.numerofactura || e.numeroentrada || 'S/N'}`,
        0,
        e.fecha,
        'Almacén General',
        e.nombreproveedor || 'Sistema SAP',
        Number(e.cantidadarticulos || 0),
        Number(e.importefactura || 0)
      ]);
    }

    // 2. Insertar Traslados entre Almacenes (dw_sap_traslados)
    try {
      const trasladosRes = await pool.query(`SELECT * FROM dw_sap_traslados`);
      for (const t of trasladosRes.rows) {
        const lines = t.stocktransferlines ? JSON.parse(t.stocktransferlines) : [];
        for (const line of lines) {
          const itemCode = line.ItemCode || '';
          const currentStock = stockMap.get(itemCode) || 0;
          await pool.query(`
            INSERT INTO dw_sap_kardex (
              codigo, descripcion, almacenorigen, almacendestino, documentoref, existencias, fecha, servicio, usuario, movimiento, valoracumulado, lastsync
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP
            )
          `, [
            String(itemCode || 'TRASLADO'),
            `Traslado: ${line.ItemDescription || 'Insumo Médico'}`,
            String(t.fromwarehouse || 'Almacén General (01)'),
            String(t.towarehouse || 'Farmacia Quirófano (02)'),
            `Solicitud Traslado #${t.docnum || t.docentry}`,
            currentStock,
            t.docdate,
            String(t.towarehouse || 'Farmacia / Servicio'),
            String(t.requestername || 'Sistema'),
            Number(line.Quantity || 0),
            0
          ]);
        }
      }
    } catch(e) {
      console.log('[Sync Kardex] dw_sap_traslados no contiene datos aun:', e.message);
    }

    // 3. Insertar Consumos (Salidas a Paciente/Servicio)
    const consumosRes = await pool.query(`SELECT * FROM dw_cirrus_consumo WHERE fechacargo IS NOT NULL`);
    for (const c of consumosRes.rows) {
      const currentStock = stockMap.get(c.codigo) || 0;
      const totalValue = Number(c.montocobrado || (Number(c.cantidad || 0) * Number(c.preciounitario || 0)));
      await pool.query(`
        INSERT INTO dw_sap_kardex (
          codigo, descripcion, almacenorigen, almacendestino, documentoref, existencias, fecha, servicio, usuario, movimiento, valoracumulado, lastsync
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP
        )
      `, [
        String(c.codigo || ''),
        String(c.insumo || ''),
        String(c.habitacion ? `Farmacia / ${c.habitacion}` : 'Almacén Sub-Farmacia'),
        String(c.paciente ? `Paciente: ${c.paciente}` : 'Servicio Hospitalario'),
        `Cuenta #${c.cuentahospitalaria || ''}`,
        currentStock,
        c.fechacargo,
        String(c.habitacion || 'Farmacia / Servicio'),
        String(c.usuariocargo || 'Cirrus'),
        -Math.abs(Number(c.cantidad || 0)),
        totalValue
      ]);
    }

    const countRes = await pool.query(`SELECT count(*) as total FROM dw_sap_kardex`);
    const count = parseInt(countRes.rows[0].total, 10);
    console.log(`[Sync] Kardex unificado generado exitosamente con ${count} movimientos y trazabilidad.`);
    return count;
  } catch (err) {
    console.error('[Sync] Error al generar Kardex:', err);
    return 0;
  }
}

/**
 * Sincroniza Pedidos (PO) y Solicitudes (PR) abiertas de SAP Service Layer a PostgreSQL
 */
async function syncPedidosSAP() {
  try {
    const sapService = require('../services/sap.service');
    console.log('[Sync] Consultando Pedidos y Requisiciones abiertas en SAP Service Layer...');

    // Mapear usuarios SAP (con paginación completa: SL devuelve solo ~20 por página)
    let usersMap = {};
    try {
      const users = await sapService.fetchAllPages('/Users?$select=InternalKey,UserCode,UserName');
      users.forEach(u => {
        usersMap[u.InternalKey] = u.UserName || u.UserCode;
      });
      console.log(`[Sync] Mapa de usuarios SAP generado: ${Object.keys(usersMap).length} usuarios.`);
    } catch(e) {
      console.warn('[Sync] No se pudo obtener el catálogo de usuarios de SAP:', e.status || e.message);
    }

    let totalSynced = 0;

    // 1. Fetch Purchase Orders (PO) — con paginación completa
    try {
      const poList = await sapService.fetchAllPages("/PurchaseOrders?$orderby=DocDate desc&$filter=DocumentStatus eq 'bost_Open'");
      for (const po of poList) {
        const userName = po.RequesterName || usersMap[po.UserSign] || `Usuario #${po.UserSign}`;
        const lineItems = (po.DocumentLines || []).map(l => ({
          itemCode: l.ItemCode,
          description: l.ItemDescription,
          quantity: l.Quantity,
          openQuantity: l.RemainingOpenQuantity
        }));

        await pool.query(`
          INSERT INTO dw_sap_pedidos (
            dockey, docentry, docnum, tipodocumento, tiponombre, fechadoc, cardcode, cardname, usersign, usuarionombre, docstatus, doctotal, estatustexto, itemsjson, lastsync
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP
          )
          ON CONFLICT(dockey) DO UPDATE SET
            fechadoc = EXCLUDED.fechadoc,
            cardname = EXCLUDED.cardname,
            usuarionombre = EXCLUDED.usuarionombre,
            docstatus = EXCLUDED.docstatus,
            doctotal = EXCLUDED.doctotal,
            estatustexto = EXCLUDED.estatustexto,
            itemsjson = EXCLUDED.itemsjson,
            lastsync = CURRENT_TIMESTAMP
        `, [
          `PO-${po.DocNum}`,
          po.DocEntry,
          po.DocNum,
          'PO',
          'Orden de Compra (PO)',
          parseSapDate(po.DocDate),
          String(po.CardCode || ''),
          String(po.CardName || 'N/A'),
          po.UserSign,
          userName,
          po.DocumentStatus || 'bost_Open',
          Number(po.DocTotal || 0),
          '🚚 En camino',
          JSON.stringify(lineItems)
        ]);
        totalSynced++;
      }
    } catch(e) {
      console.error('[Sync Pedidos PO Error]', e.message);
    }

    // 2. Fetch Purchase Requests (PR) — con paginación completa
    try {
      const prList = await sapService.fetchAllPages("/PurchaseRequests?$orderby=DocDate desc&$filter=DocumentStatus eq 'bost_Open'");
      for (const pr of prList) {
        const userName = pr.RequesterName || usersMap[pr.UserSign] || `Usuario #${pr.UserSign}`;
        const lineItems = (pr.DocumentLines || []).map(l => ({
          itemCode: l.ItemCode,
          description: l.ItemDescription,
          quantity: l.Quantity,
          openQuantity: l.RemainingOpenQuantity
        }));

        await pool.query(`
          INSERT INTO dw_sap_pedidos (
            dockey, docentry, docnum, tipodocumento, tiponombre, fechadoc, cardcode, cardname, usersign, usuarionombre, docstatus, doctotal, estatustexto, itemsjson, lastsync
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP
          )
          ON CONFLICT(dockey) DO UPDATE SET
            fechadoc = EXCLUDED.fechadoc,
            cardname = EXCLUDED.cardname,
            usuarionombre = EXCLUDED.usuarionombre,
            docstatus = EXCLUDED.docstatus,
            doctotal = EXCLUDED.doctotal,
            estatustexto = EXCLUDED.estatustexto,
            itemsjson = EXCLUDED.itemsjson,
            lastsync = CURRENT_TIMESTAMP
        `, [
          `PR-${pr.DocNum}`,
          pr.DocEntry,
          pr.DocNum,
          'PR',
          'Solicitud de Compra (PR)',
          parseSapDate(pr.DocDate),
          '',
          'N/A (Interno)',
          pr.UserSign,
          userName,
          pr.DocumentStatus || 'bost_Open',
          Number(pr.DocTotal || 0),
          '⏳ En Autorización',
          JSON.stringify(lineItems)
        ]);
        totalSynced++;
      }
    } catch(e) {
      console.error('[Sync Pedidos PR Error]', e.message);
    }

    // 3. Auto-reparación: registros históricos que quedaron como 'Usuario #N'
    if (Object.keys(usersMap).length > 0) {
      try {
        const repairRes = await pool.query(`
          UPDATE dw_sap_pedidos p
          SET usuarionombre = u.nombre
          FROM (
            SELECT unnest($1::int[]) AS usersign, unnest($2::text[]) AS nombre
          ) u
          WHERE p.usersign = u.usersign
            AND p.usuarionombre LIKE 'Usuario #%'
        `, [Object.keys(usersMap).map(Number), Object.values(usersMap)]);
        if (repairRes.rowCount > 0) {
          console.log(`[Sync] Reparados ${repairRes.rowCount} registros históricos con nombre de usuario genérico.`);
        }
      } catch(e) {
        console.warn('[Sync] No se pudieron reparar registros históricos:', e.message);
      }
    }

    console.log(`[Sync] Pedidos SAP sincronizados exitosamente en PostgreSQL: ${totalSynced} documentos.`);
    return totalSynced;
  } catch (err) {
    console.error('[Sync] Error al sincronizar Pedidos SAP:', err);
    return 0;
  }
}

async function runAlmacenSync() {
  await syncCenso();
  await syncConsumo();
  await syncEntradas();
  await syncKardex();
  await syncPedidosSAP();

  try {
    console.log('[Sync] Sincronizando Dataset Analítico para Machine Learning...');
    const { syncMLDataset } = require('./mlDataset.service');
    await syncMLDataset();
  } catch (mlErr) {
    console.error('[Sync] Error al sincronizar el Dataset Analítico de ML:', mlErr.message);
  }
}

module.exports = {
  syncCenso,
  syncConsumo,
  syncEntradas,
  syncKardex,
  syncPedidosSAP,
  runAlmacenSync
};
