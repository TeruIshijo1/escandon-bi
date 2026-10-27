const { pool } = require('../config/pg-db');
const sapService = require('./sap.service');
const READ_OPTIONS = { maxPages: 5000, timeoutMs: 30000, queueTimeoutMs: 60000, totalTimeoutMs: 300000, cacheTtlMs: 0 };
let activeSync = null;

function validateTransfers(records) {
  if (!Array.isArray(records)) throw new Error('SAP no confirmó la colección de traslados.');
  const seen = new Set();
  const required = ['DocEntry', 'DocNum', 'DocDate', 'DueDate', 'FromWarehouse', 'ToWarehouse', 'Comments', 'DocumentStatus', 'StockTransferLines'];
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record) || required.some(key => !Object.hasOwn(record, key)) ||
      !Number.isSafeInteger(record.DocEntry) || record.DocEntry < 0 || !Number.isSafeInteger(record.DocNum) || record.DocNum < 0 ||
      typeof record.DocDate !== 'string' || !Number.isFinite(Date.parse(record.DocDate)) ||
      (record.DueDate != null && (typeof record.DueDate !== 'string' || !Number.isFinite(Date.parse(record.DueDate)))) ||
      ['FromWarehouse', 'ToWarehouse', 'Comments'].some(key => record[key] != null && typeof record[key] !== 'string') ||
      typeof record.DocumentStatus !== 'string' || !record.DocumentStatus.trim() ||
      !Array.isArray(record.StockTransferLines) || record.StockTransferLines.some(line => !line || typeof line !== 'object' || Array.isArray(line) ||
        typeof line.ItemCode !== 'string' || !line.ItemCode.trim() || typeof line.Quantity !== 'number' || !Number.isFinite(line.Quantity)) ||
      seen.has(record.DocEntry)) {
      throw new Error('SAP no confirmó todas las cabeceras y partidas de traslado.');
    }
    seen.add(record.DocEntry);
  }
}

function syncTraslados(options = {}) {
  if (activeSync) return activeSync;
  activeSync = syncTrasladosOnce(options).finally(() => { activeSync = null; });
  return activeSync;
}

/* Sincroniza las Solicitudes de Traslado desde SAP a PostgreSQL */
async function syncTrasladosOnce({ fullSync = false } = {}) {
  try {
    console.log('[Sync] Extrayendo solicitudes y partidas de traslado de SAP...');
    let url = '/InventoryTransferRequests?%24orderby=DocEntry%20desc&%24select=DocEntry,DocNum,DocDate,DueDate,FromWarehouse,ToWarehouse,Comments,DocumentStatus,StockTransferLines';
    if (process.env.NODE_ENV !== 'test' && !fullSync) {
      try {
        const countRes = await pool.query('SELECT COUNT(*)::int AS total FROM dw_sap_traslados');
        if ((countRes.rows[0]?.total || 0) > 0) {
          const since = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
          url += `&%24filter=${encodeURIComponent(`DocDate ge '${since}'`)}`;
        }
      } catch {
        // Si falla la verificación previa, usar consulta completa.
      }
    }
    const allRecords = await sapService.fetchAllPages(url, { Prefer: 'odata.maxpagesize=500' }, READ_OPTIONS);
    validateTransfers(allRecords);

    console.log(`[Sync] Extraídos ${allRecords.length} traslados de SAP. Sincronizando con PostgreSQL...`);
    
    if (process.env.NODE_ENV !== 'test' && allRecords.length > 1) {
      const batchSize = 200;
      const colCount = 11;
      for (let i = 0; i < allRecords.length; i += batchSize) {
        const chunk = allRecords.slice(i, i + batchSize);
        const tuples = [];
        const params = [];
        for (let r = 0; r < chunk.length; r++) {
          const record = chunk[r];
          const offset = r * colCount;
          const placeholders = [];
          for (let c = 1; c <= colCount; c++) placeholders.push(`$${offset + c}`);
          tuples.push(`(${placeholders.join(', ')}, CURRENT_TIMESTAMP)`);
          params.push(
            record.DocEntry,
            record.DocNum,
            record.DocDate,
            record.DueDate,
            record.FromWarehouse,
            record.ToWarehouse,
            record.DocumentStatus,
            record.Comments,
            record.Requester ?? null,
            record.RequesterName ?? null,
            JSON.stringify(record.StockTransferLines)
          );
        }
        await pool.query(`
          INSERT INTO dw_sap_traslados (
            docentry, docnum, docdate, duedate, fromwarehouse, towarehouse,
            documentstatus, comments, requester, requestername, stocktransferlines, lastsync
          ) VALUES ${tuples.join(', ')}
          ON CONFLICT(docentry) DO UPDATE SET
            docnum = EXCLUDED.docnum,
            docdate = EXCLUDED.docdate,
            duedate = EXCLUDED.duedate,
            fromwarehouse = EXCLUDED.fromwarehouse,
            towarehouse = EXCLUDED.towarehouse,
            documentstatus = EXCLUDED.documentstatus,
            comments = EXCLUDED.comments,
            requester = COALESCE(EXCLUDED.requester, dw_sap_traslados.requester),
            requestername = COALESCE(EXCLUDED.requestername, dw_sap_traslados.requestername),
            stocktransferlines = EXCLUDED.stocktransferlines,
            lastsync = CURRENT_TIMESTAMP
        `, params);
      }
    } else {
      for (const record of allRecords) {
      await pool.query(`
        INSERT INTO dw_sap_traslados (
          docentry, docnum, docdate, duedate, fromwarehouse, towarehouse, 
          documentstatus, comments, requester, requestername, stocktransferlines, lastsync
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP
        )
        ON CONFLICT(docentry) DO UPDATE SET
          docnum = EXCLUDED.docnum,
          docdate = EXCLUDED.docdate,
          duedate = EXCLUDED.duedate,
          fromwarehouse = EXCLUDED.fromwarehouse,
          towarehouse = EXCLUDED.towarehouse,
          documentstatus = EXCLUDED.documentstatus,
          comments = EXCLUDED.comments,
          requester = COALESCE(EXCLUDED.requester, dw_sap_traslados.requester),
          requestername = COALESCE(EXCLUDED.requestername, dw_sap_traslados.requestername),
          stocktransferlines = EXCLUDED.stocktransferlines,
          lastsync = CURRENT_TIMESTAMP
      `, [
        record.DocEntry,
        record.DocNum,
        record.DocDate,
        record.DueDate,
        record.FromWarehouse,
        record.ToWarehouse,
        record.DocumentStatus,
        record.Comments,
        record.Requester ?? null,
        record.RequesterName ?? null,
        JSON.stringify(record.StockTransferLines)
      ]);
      }
    }

    console.log('[Sync] Sincronización de traslados completada exitosamente.');
    return allRecords.length;
  } catch (err) {
    console.error('[Sync] Error durante la sincronización de traslados:', err.message || err);
    throw err;
  }
}

module.exports = {
  syncTraslados, waitForTraslados: () => (activeSync || Promise.resolve()).catch(() => {})
};
