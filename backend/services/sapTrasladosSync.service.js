const { pool } = require('../config/pg-db');
const sapService = require('./sap.service');

/**
 * Sincroniza las Solicitudes de Traslado desde SAP a PostgreSQL.
 */
async function syncTraslados() {
  try {
    console.log('[Sync] Iniciando sesión en SAP...');
    await sapService._ensureSession();
    console.log('[Sync] Sesión iniciada. Extrayendo traslados...');

    // OData parameters must be properly encoded if appended to string, or just use ?%24select=...
    // Also, we remove StockTransferLines from select as it is a collection and needs $expand or it causes errors
    let url = '/InventoryTransferRequests?%24orderby=DocEntry%20desc&%24select=DocEntry,DocNum,DocDate,DueDate,FromWarehouse,ToWarehouse,Comments,DocumentStatus';
    let allRecords = [];
    let nextUrl = url;

    const pageHeaders = { 'Prefer': 'odata.maxpagesize=5000' };
    while (nextUrl) {
      console.log('[Sync] Petición a:', nextUrl);
      const res = await sapService.get(nextUrl, pageHeaders);
      const data = res.data;
      if (data.value) {
        allRecords.push(...data.value);
      }
      if (data['@odata.nextLink'] || data['odata.nextLink']) {
        const link = data['@odata.nextLink'] || data['odata.nextLink'];
        nextUrl = '/' + link;
      } else {
        nextUrl = null;
      }
    }

    console.log(`[Sync] Extraídos ${allRecords.length} traslados de SAP. Sincronizando con PostgreSQL...`);
    
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
          requester = EXCLUDED.requester,
          requestername = EXCLUDED.requestername,
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
        record.Requester || null,
        record.RequesterName || null,
        record.StockTransferLines ? JSON.stringify(record.StockTransferLines) : null
      ]);
    }

    console.log('[Sync] Sincronización de traslados completada exitosamente.');
    return allRecords.length;
  } catch (err) {
    console.error('[Sync] Error durante la sincronización de traslados:', err.response?.data || err.message);
    throw err;
  }
}

module.exports = {
  syncTraslados
};
