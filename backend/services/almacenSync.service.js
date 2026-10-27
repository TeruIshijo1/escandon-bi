'use strict';

const { pool } = require('../config/pg-db');
const { connectRemoteDB } = require('../config/remote-db');
const sql = require('mssql');
const etlService = require('./etl.service');
const sapService = require('./sap.service');
const { withSapQuery } = require('./sapQueryRegistration.service');
const { hospitalToday, addDays } = require('./statisticsCommon');

const SAP_READ_OPTIONS = { maxPages: 5000, timeoutMs: 30000, queueTimeoutMs: 60000, totalTimeoutMs: 300000, cacheTtlMs: 0 };
const activeSyncs = new Map();

function singleFlight(name, work) {
  if (activeSyncs.has(name)) return activeSyncs.get(name);
  const promise = Promise.resolve().then(work).finally(() => { activeSyncs.delete(name); });
  activeSyncs.set(name, promise);
  return promise;
}

async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function executeBatchInsert(client, table, columns, rows, batchSize = 250) {
  if (!rows || !rows.length) return;
  const colCount = columns.length;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    if (chunk.length === 1) {
      const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(', ');
      await client.query(`
        INSERT INTO ${table} (
          ${columns.join(', ')}, lastsync
        ) VALUES (
          ${placeholders}, CURRENT_TIMESTAMP
        )
      `, chunk[0]);
    } else {
      const tuples = [];
      const params = [];
      for (let r = 0; r < chunk.length; r++) {
        const row = chunk[r];
        const offset = r * colCount;
        const rowPlaceholders = [];
        for (let c = 1; c <= colCount; c++) {
          rowPlaceholders.push(`$${offset + c}`);
        }
        tuples.push(`(${rowPlaceholders.join(', ')}, CURRENT_TIMESTAMP)`);
        for (let c = 0; c < colCount; c++) {
          params.push(row[c]);
        }
      }
      await client.query(`
        INSERT INTO ${table} (
          ${columns.join(', ')}, lastsync
        ) VALUES ${tuples.join(', ')}
      `, params);
    }
  }
}

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
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    qs.append(key, `'${String(value).replace(/'/g, "''")}'`);
  }
  return withSapQuery(queryName, sqlText, async () => {
    const list = await sapService.fetchAllPages(`/SQLQueries('${queryName}')/List?${qs.toString()}`, {}, SAP_READ_OPTIONS);
    if (!Array.isArray(list)) throw new Error(`Lectura SAP incompleta: ${queryName}`);
    return list;
  });
};

/* Sincroniza el Censo de Pacientes de Vertical a PostgreSQL */
async function syncCenso() {
  try {
    console.log('[Sync] Extrayendo Censo de Pacientes de Vertical...');
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

function syncConsumo() {
  return singleFlight('consumo', syncConsumoOnce);
}

async function syncConsumoOnce() {
  try {
    console.log('[Sync] Extrayendo Consumos de Vertical y cruzando con SAP (Últimos 45 días)...');
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 45);
    startDate.setUTCHours(0, 0, 0, 0);
    const endDate = new Date();
    
    const data = await etlService.getCargosFarmaciaSAP({ 
      fechaDesde: startDate.toISOString().split('T')[0], 
      fechaHasta: endDate.toISOString().split('T')[0],
      limit: 100000
    });

    if (!Array.isArray(data)) throw new Error('La lectura de consumos no está completa.');
    console.log(`[Sync] Cruzados ${data.length} registros de consumo. Guardando en PostgreSQL...`);

    const consumoColumns = [
      'cuentahospitalaria', 'fechacargo', 'codigo', 'insumo', 'cantidad', 'preciounitario',
      'montocobrado', 'lote', 'caducidad', 'paciente', 'habitacion', 'medico', 'usuariocargo'
    ];
    const consumoRows = data.map(d => [
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

    await withTransaction(async client => {
      await client.query(`DELETE FROM dw_cirrus_consumo WHERE fechacargo >= $1`, [startDate]);
      await executeBatchInsert(client, 'dw_cirrus_consumo', consumoColumns, consumoRows, 250);
    });

    console.log('[Sync] Consumos sincronizados exitosamente.');
    return data.length;
  } catch (err) {
    console.error('[Sync] Error sincronizando Consumos:', err);
    throw err;
  }
}

function syncEntradas() {
  return singleFlight('entradas', syncEntradasOnce);
}

function validateEntradas(rows) {
  const numericFields = ['CantidadArticulos', 'PrecioUnitario', 'ImporteFactura'];
  const optionalFields = ['NumeroFactura', 'NombreProveedor', 'Codigo', 'Descripcion', 'AlmacenReceptor'];
  const fields = ['Fecha', 'NumeroEntrada', ...numericFields, ...optionalFields];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const invalid = field => { throw Object.assign(new Error(`SAP devolvió una partida de Entradas inválida (fila ${index + 1}, campo ${field}).`), { code: 'SAP_ENTRADAS_INVALID' }); };
    if (!row || typeof row !== 'object' || Array.isArray(row)) invalid('partida');
    for (const field of fields) if (!Object.hasOwn(row, field)) invalid(field);
    const date = parseSapDate(row.Fecha);
    if (!(row.Fecha instanceof Date) && typeof row.Fecha !== 'string') invalid('Fecha');
    if (!date || !Number.isFinite(date.getTime())) invalid('Fecha');
    if (typeof row.Fecha === 'string') {
      const text = row.Fecha.trim();
      const day = /^\d{8}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : text.slice(0, 10);
      const calendarDate = /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T00:00:00Z`) : null;
      if (!calendarDate || !Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== day) invalid('Fecha');
    }
    if (!['string', 'number'].includes(typeof row.NumeroEntrada) || !String(row.NumeroEntrada).trim() || (typeof row.NumeroEntrada === 'number' && !Number.isFinite(row.NumeroEntrada))) invalid('NumeroEntrada');
    for (const field of numericFields) {
      const value = row[field];
      if (!['string', 'number'].includes(typeof value) || (typeof value === 'string' && !value.trim()) || !Number.isFinite(Number(value))) invalid(field);
    }
    for (const field of optionalFields) if (row[field] !== null && typeof row[field] !== 'string') invalid(field);
  }
}

async function syncEntradasOnce() {
  try {
    console.log('[Sync] Extrayendo Entradas de Factura con partidas individuales (SAP)...');
    
    const endDate = hospitalToday();
    const sDate = addDays(endDate, -60).replace(/-/g, '');
    const eDate = endDate.replace(/-/g, '');

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
    validateEntradas(data);
    console.log(`[Sync] Obtenidas ${data.length} partidas de Entradas. Guardando en PostgreSQL...`);

    const entradasColumns = [
      'fecha', 'numeroentrada', 'numerofactura', 'nombreproveedor', 'codigo', 'descripcion',
      'cantidadarticulos', 'preciounitario', 'importefactura', 'almacenreceptor'
    ];
    const entradasRows = data.map(d => [
      parseSapDate(d.Fecha),
      String(d.NumeroEntrada),
      String(d.NumeroFactura || ''),
      String(d.NombreProveedor || ''),
      String(d.Codigo || ''),
      String(d.Descripcion || ''),
      Number(d.CantidadArticulos || 0),
      Number(d.PrecioUnitario || 0),
      Number(d.ImporteFactura || 0),
      String(d.AlmacenReceptor || 'ALG')
    ]);

    await withTransaction(async client => {
      await client.query(`DELETE FROM dw_sap_entradas`);
      await executeBatchInsert(client, 'dw_sap_entradas', entradasColumns, entradasRows, 250);
    });
    return data.length;
  } catch (err) {
    console.error('[Sync] Error sincronizando Entradas:', err);
    throw err;
  }
}

// Reemplaza el Kardex sólo con las fuentes locales completas y un inventario disponible.
function syncKardex() {
  return singleFlight('kardex', syncKardexOnce);
}

async function syncKardexOnce() {
  try {
    const inventoryService = require('./sapInventory.service');
    if (!await inventoryService.ensureInventoryData()) {
      throw new Error('No hay una copia válida del inventario para generar el Kardex.');
    }
    const stockMap = new Map();
    inventoryService.getInventoryCache().forEach(item => {
      stockMap.set(item.ItemCode, (stockMap.get(item.ItemCode) || 0) + Number(item.QuantityOnStock || 0));
    });
    const count = await withTransaction(async client => {
      if (process.env.NODE_ENV !== 'test') {
        await client.query('SELECT pg_advisory_xact_lock(72702, 20261022)');
        const invalidTransfer = await client.query(`
          SELECT 1 FROM dw_sap_traslados
          WHERE stocktransferlines IS NOT NULL
            AND btrim(stocktransferlines::text) <> ''
            AND jsonb_typeof(stocktransferlines::jsonb) <> 'array'
          LIMIT 1
        `);
        if (invalidTransfer.rowCount > 0) {
          throw new Error('Las partidas de un traslado no están completas.');
        }
        const stockCodes = [];
        const stockValues = [];
        for (const [code, qty] of stockMap.entries()) {
          stockCodes.push(String(code));
          stockValues.push(Number(qty || 0));
        }
        await client.query('DELETE FROM dw_sap_kardex');
        const insertRes = await client.query(`
          WITH stock_map AS (
            SELECT * FROM UNNEST($1::text[], $2::numeric[]) AS s(codigo, existencias)
          )
          INSERT INTO dw_sap_kardex (
            codigo, descripcion, almacenorigen, almacendestino, documentoref,
            existencias, fecha, servicio, usuario, movimiento, valoracumulado, lastsync
          )
          SELECT
            'ENTRADA',
            'Entrada Factura ' || COALESCE(e.numerofactura, '') || ' - ' || COALESCE(e.nombreproveedor, ''),
            'Proveedor: ' || COALESCE(NULLIF(e.nombreproveedor, ''), 'Externo'),
            'Almacén General (01)',
            'Factura ' || COALESCE(NULLIF(e.numerofactura, ''), NULLIF(e.numeroentrada, ''), 'S/N'),
            0,
            e.fecha,
            'Almacén General',
            COALESCE(NULLIF(e.nombreproveedor, ''), 'Sistema SAP'),
            COALESCE(e.cantidadarticulos, 0),
            COALESCE(e.importefactura, 0),
            CURRENT_TIMESTAMP
          FROM dw_sap_entradas e
          UNION ALL
          SELECT
            COALESCE(NULLIF(line->>'ItemCode', ''), 'TRASLADO'),
            'Traslado: ' || COALESCE(NULLIF(line->>'ItemDescription', ''), 'Insumo Médico'),
            COALESCE(NULLIF(t.fromwarehouse, ''), 'Almacén General (01)'),
            COALESCE(NULLIF(t.towarehouse, ''), 'Farmacia Quirófano (02)'),
            'Solicitud Traslado #' || COALESCE(NULLIF(t.docnum::text, ''), t.docentry::text, ''),
            COALESCE(sm.existencias, 0),
            t.docdate,
            COALESCE(NULLIF(t.towarehouse, ''), 'Farmacia / Servicio'),
            COALESCE(NULLIF(t.requestername, ''), 'Sistema'),
            COALESCE((line->>'Quantity')::numeric, 0),
            0,
            CURRENT_TIMESTAMP
          FROM dw_sap_traslados t
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE
              WHEN t.stocktransferlines IS NULL OR btrim(t.stocktransferlines::text) = '' THEN '[]'::jsonb
              ELSE t.stocktransferlines::jsonb
            END
          ) AS line
          LEFT JOIN stock_map sm ON sm.codigo = COALESCE(line->>'ItemCode', '')
          UNION ALL
          SELECT
            COALESCE(c.codigo, ''),
            COALESCE(c.insumo, ''),
            CASE WHEN c.habitacion IS NOT NULL AND c.habitacion <> '' THEN 'Farmacia / ' || c.habitacion ELSE 'Almacén Sub-Farmacia' END,
            CASE WHEN c.paciente IS NOT NULL AND c.paciente <> '' THEN 'Paciente: ' || c.paciente ELSE 'Servicio Hospitalario' END,
            'Cuenta #' || COALESCE(c.cuentahospitalaria, ''),
            COALESCE(sm.existencias, 0),
            c.fechacargo,
            COALESCE(NULLIF(c.habitacion, ''), 'Farmacia / Servicio'),
            COALESCE(NULLIF(c.usuariocargo, ''), 'Vertical'),
            -ABS(COALESCE(c.cantidad, 0)),
            CASE WHEN COALESCE(c.montocobrado, 0) <> 0 THEN c.montocobrado ELSE COALESCE(c.cantidad, 0) * COALESCE(c.preciounitario, 0) END,
            CURRENT_TIMESTAMP
          FROM dw_cirrus_consumo c
          LEFT JOIN stock_map sm ON sm.codigo = c.codigo
          WHERE c.fechacargo IS NOT NULL
        `, [stockCodes, stockValues]);
        return insertRes.rowCount || 0;
      }
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const entradas = (await client.query('SELECT * FROM dw_sap_entradas')).rows;
      const traslados = (await client.query('SELECT * FROM dw_sap_traslados')).rows;
      const consumos = (await client.query('SELECT * FROM dw_cirrus_consumo WHERE fechacargo IS NOT NULL')).rows;
      const rows = [];
      for (const e of entradas) {
        rows.push([
          'ENTRADA', `Entrada Factura ${e.numerofactura || ''} - ${e.nombreproveedor || ''}`,
          `Proveedor: ${e.nombreproveedor || 'Externo'}`, 'Almacén General (01)',
          `Factura ${e.numerofactura || e.numeroentrada || 'S/N'}`, 0, e.fecha,
          'Almacén General', e.nombreproveedor || 'Sistema SAP',
          Number(e.cantidadarticulos || 0), Number(e.importefactura || 0)
        ]);
      }
      for (const t of traslados) {
        const lines = typeof t.stocktransferlines === 'string'
          ? JSON.parse(t.stocktransferlines) : (t.stocktransferlines || []);
        if (!Array.isArray(lines)) throw new Error('Las partidas de un traslado no están completas.');
        for (const line of lines) {
          const itemCode = line.ItemCode || '';
          rows.push([
            String(itemCode || 'TRASLADO'), `Traslado: ${line.ItemDescription || 'Insumo Médico'}`,
            String(t.fromwarehouse || 'Almacén General (01)'), String(t.towarehouse || 'Farmacia Quirófano (02)'),
            `Solicitud Traslado #${t.docnum || t.docentry}`, stockMap.get(itemCode) || 0,
            t.docdate, String(t.towarehouse || 'Farmacia / Servicio'), String(t.requestername || 'Sistema'),
            Number(line.Quantity || 0), 0
          ]);
        }
      }
      for (const c of consumos) {
        rows.push([
          String(c.codigo || ''), String(c.insumo || ''),
          String(c.habitacion ? `Farmacia / ${c.habitacion}` : 'Almacén Sub-Farmacia'),
          String(c.paciente ? `Paciente: ${c.paciente}` : 'Servicio Hospitalario'),
          `Cuenta #${c.cuentahospitalaria || ''}`, stockMap.get(c.codigo) || 0, c.fechacargo,
          String(c.habitacion || 'Farmacia / Servicio'), String(c.usuariocargo || 'Vertical'),
          -Math.abs(Number(c.cantidad || 0)),
          Number(c.montocobrado || (Number(c.cantidad || 0) * Number(c.preciounitario || 0)))
        ]);
      }
      const kardexColumns = [
        'codigo', 'descripcion', 'almacenorigen', 'almacendestino', 'documentoref',
        'existencias', 'fecha', 'servicio', 'usuario', 'movimiento', 'valoracumulado'
      ];
      await client.query('DELETE FROM dw_sap_kardex');
      await executeBatchInsert(client, 'dw_sap_kardex', kardexColumns, rows, 250);
      return rows.length;
    });
    console.log(`[Sync] Kardex unificado generado exitosamente con ${count} movimientos y trazabilidad.`);
    return count;
  } catch (err) {
    console.error('[Sync] Error al generar Kardex:', err);
    throw err;
  }
}

async function syncPedidosSAP() {
  try {
    console.log('[Sync] Consultando Pedidos y Requisiciones abiertas en SAP Service Layer...');

    let usersMap = {};
    try {
      const users = await sapService.fetchAllPages('/Users?$select=InternalKey,UserCode,UserName', {}, {
        ...SAP_READ_OPTIONS, timeoutMs: 15000, queueTimeoutMs: 30000, totalTimeoutMs: 30000
      });
      users.forEach(u => {
        usersMap[u.InternalKey] = u.UserName || u.UserCode;
      });
      console.log(`[Sync] Mapa de usuarios SAP generado: ${Object.keys(usersMap).length} usuarios.`);
    } catch(e) {
      console.warn('[Sync] No se pudo obtener el catálogo de usuarios de SAP:', e.status || e.message);
    }

    let totalSynced = 0;
    const sourceErrors = [];

    try {
      const poList = await sapService.fetchAllPages("/PurchaseOrders?$orderby=DocDate desc&$filter=DocumentStatus eq 'bost_Open'", {}, SAP_READ_OPTIONS);
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
      sourceErrors.push(e);
    }

    try {
      const prList = await sapService.fetchAllPages("/PurchaseRequests?$orderby=DocDate desc&$filter=DocumentStatus eq 'bost_Open'", {}, SAP_READ_OPTIONS);
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
      sourceErrors.push(e);
    }

    // Auto-reparación: registros históricos que quedaron como 'Usuario #N'
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

    if (sourceErrors.length) throw new AggregateError(sourceErrors, 'Sincronización de pedidos SAP incompleta.');
    console.log(`[Sync] Pedidos SAP sincronizados exitosamente en PostgreSQL: ${totalSynced} documentos.`);
    return totalSynced;
  } catch (err) {
    console.error('[Sync] Error al sincronizar Pedidos SAP:', err);
    throw err;
  }
}

let almacenSyncPromise = null;

function runAlmacenSync({ skipInventoryDownload = false } = {}) {
  if (almacenSyncPromise) {
    console.log('[Sync] Ya hay una sincronización de almacén en curso; se reutiliza esa ejecución.');
    return almacenSyncPromise;
  }

  almacenSyncPromise = (async () => {
    const errors = [];
    const inventoryService = require('./sapInventory.service');
    let inventoryAvailable = true;
    if (skipInventoryDownload && (inventoryService.hasInventorySnapshot() || await inventoryService.loadInventoryFromDB())) {
      console.log('[Sync] Inventario vigente en PostgreSQL; se omite su descarga desde SAP en este arranque.');
    } else {
      try {
        await inventoryService.syncInventoryCache();
      } catch (error) {
        errors.push(error);
        inventoryAvailable = inventoryService.hasInventorySnapshot() || inventoryService.getInventoryCache().length > 0 || await inventoryService.loadInventoryFromDB();
      }
    }
    const steps = [
      ['censo', syncCenso],
      ['consumo', inventoryAvailable ? syncConsumo : null],
      ['entradas', syncEntradas],
      ['kardex', inventoryAvailable ? syncKardex : null],
      ['pedidos', syncPedidosSAP]
    ];
    const failedSteps = new Set();
    for (const [name, work] of steps) {
      if (!work) continue;
      if (name === 'kardex' && (failedSteps.has('consumo') || failedSteps.has('entradas'))) continue;
      try {
        await work();
      } catch (error) {
        console.error(`[Sync] Etapa ${name} incompleta:`, error.message);
        failedSteps.add(name);
        errors.push(error);
      }
    }

    if (!errors.length) {
      try {
        console.log('[Sync] Sincronizando Dataset Analítico para Machine Learning...');
        const { syncMLDataset } = require('./mlDataset.service');
        await syncMLDataset();
      } catch (mlErr) {
        console.error('[Sync] Error al sincronizar el Dataset Analítico de ML:', mlErr.message);
        errors.push(mlErr);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Sincronización de almacén incompleta; se conserva la última copia válida de las etapas fallidas.');
  })().finally(() => {
    almacenSyncPromise = null;
  });

  return almacenSyncPromise;
}

module.exports = {
  syncCenso,
  syncConsumo,
  syncEntradas,
  syncKardex,
  syncPedidosSAP,
  runAlmacenSync, waitForAlmacenSync: () => (almacenSyncPromise || Promise.resolve()).catch(() => {})
};
