const express = require('express');
const router = express.Router();
const etlService = require('../services/etl.service');
const sapService = require('../services/sap.service');
const { connectRemoteDB } = require('../config/remote-db');
const { getDb } = require('../config/db');
const sql = require('mssql');
const { authenticate, authorize } = require('../middleware/auth.middleware');

router.get('/devoluciones', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res) => {
  try {
    const { fechaDesde, fechaHasta } = req.query;
    const data = await etlService.getDevolucionesFarmacia(fechaDesde, fechaHasta);
    res.json({ ok: true, ...data });
  } catch (err) {
    console.error('[Pharmacy Devoluciones Error]', err);
    res.status(500).json({ ok: false, error: 'Error interno al procesar la solicitud' });
  }
});

router.get('/cargos-sap', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'USUARIO_OPERATIVO']), async (req, res) => {
  try {
    const { fechaDesde, fechaHasta, area } = req.query;
    const data = await etlService.getCargosFarmaciaSAP({ fechaDesde, fechaHasta, area });
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[Pharmacy Cargos SAP Error]', err);
    res.status(500).json({ ok: false, error: 'Error interno al procesar la solicitud de cargos' });
  }
});

router.get('/master-outputs', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'USUARIO_OPERATIVO']), async (req, res) => {
  try {
    const { fechaDesde, fechaHasta, almacen } = req.query;
    const data = await etlService.getMasterOutputs({ fechaDesde, fechaHasta, almacen });
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[Pharmacy Master Outputs Error]', err);
    res.status(500).json({ ok: false, error: 'Error interno al procesar la solicitud del resumen maestro' });
  }
});

const sapInventoryService = require('../services/sapInventory.service');

router.get('/inventario', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res) => {
  try {
    const warehouseCode = req.query.warehouse || 'FAR';

    // Si el caché está vacío (ej. servidor recién prendido), forzamos una carga
    if (sapInventoryService.getInventoryCache().length === 0) {
      await sapInventoryService.syncInventoryCache();
    }
    
    // Filtrar únicamente los items que pertenecen al almacén solicitado
    const warehouseItems = sapInventoryService.getInventoryCache().filter(item => item.WhsCode === warehouseCode);
    
    res.json({ ok: true, data: warehouseItems });
  } catch (err) {
    console.error('[Pharmacy Inventario SAP Error]', err);
    res.status(500).json({ ok: false, error: 'Error interno al consultar el inventario' });
  }
});

router.get('/lotes/:itemCode', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res) => {
  try {
    const { itemCode } = req.params;
    const warehouseCode = req.query.warehouse || 'FAR';
    
    if (!itemCode) return res.status(400).json({ ok: false, error: 'ItemCode requerido' });

    // Filtrar desde la memoria directamente (0 ms de latencia!)
    const itemBatches = sapInventoryService.getBatchesCache().filter(b => b.ItemCode === itemCode && b.WhsCode === warehouseCode);
    
    res.json({ ok: true, data: itemBatches });
  } catch (err) {
    console.error(`[SAP] Error al obtener lotes del artículo ${itemCode}:`, err);
    res.status(500).json({ ok: false, error: 'Error interno del servidor al consultar SAP' });
  }
});

/**
 * GET /api/pharmacy/historial-lotes/:itemCode
 * Extrae el historial de movimientos de inventario desde Vertical (Cirrus) cruzando PCPRBT y UDR_CUENTAS_SERVICIOS
 */
router.get('/historial-lotes/:itemCode', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res) => {
  try {
    const { itemCode } = req.params;
    if (!itemCode) return res.status(400).json({ ok: false, error: 'ItemCode requerido' });

    const pool = await connectRemoteDB();
    
    // Consulta directa a la base de datos de Vertical (Cirrus) KH_HE
    const sqlText = `
      SELECT TOP 200
        b.CreatedOn AS Fecha,
        b.BatchCode AS Lote,
        b.Quantity AS Cantidad,
        t.FullName AS Paciente,
        'Salida de Farmacia' AS TipoMovimiento
      FROM PCPRBT b
      INNER JOIN PCPRIT i ON b.PCPRITNum = i.PCPRITNum
      INNER JOIN PCPR p ON i.PCPRNum = p.PCPRNum
      INNER JOIN PC c ON p.PCNum = c.PCNum
      INNER JOIN PT t ON c.PTNum = t.PTNum
      WHERE i.ItemCode = @ItemCode AND b.BatchCode IS NOT NULL
      ORDER BY b.CreatedOn DESC
    `;
    
    const dbRes = await pool.request()
      .input('ItemCode', sql.VarChar, itemCode)
      .query(sqlText);
      
    // Formatear fechas para el frontend
    const formattedData = dbRes.recordset.map(d => ({
      ...d,
      Fecha: d.Fecha ? new Date(d.Fecha).toISOString() : null
    }));
    
    res.json({ ok: true, data: formattedData });
  } catch (err) {
    console.error(`[Farmacia Vertical] Error al obtener el historial del artículo:`, err);
    res.status(500).json({ 
      ok: false, 
      error: 'No se pudo obtener el historial desde Vertical.'
    });
  }
});

/**
 * GET /api/pharmacy/ubicaciones/:itemCode
 * Devuelve en qué otros almacenes del hospital hay stock del artículo
 */
router.get('/ubicaciones/:itemCode', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res) => {
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

// ==========================================
// NUEVAS RUTAS DE INTELIGENCIA AVANZADA
// ==========================================

/**
 * GET /api/pharmacy/controlled-ledger
 * Libro Electrónico de Controlados
 */
router.get('/controlled-ledger', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res) => {
  try {
    const pool = await connectRemoteDB();
    const dbRes = await pool.request().query(`
      SELECT TOP 200
        b.CreatedOn AS Fecha,
        t.FullName AS Paciente,
        COALESCE(NULLIF(LTRIM(RTRIM(pr.FullName)), ''), NULLIF(LTRIM(RTRIM(pr.Name)) + ' ' + LTRIM(RTRIM(pr.LastName)), ''), 'NO ESPECIFICADO') AS Medico,
        i.ItemCode AS Codigo,
        ISNULL(i.ItemDescription, 'Material/Medicamento') AS Medicamento,
        b.BatchCode AS Lote,
        b.Quantity AS Cantidad
      FROM PCPRBT b
      INNER JOIN PCPRIT i ON b.PCPRITNum = i.PCPRITNum
      INNER JOIN PCPR p ON i.PCPRNum = p.PCPRNum
      INNER JOIN PC c ON p.PCNum = c.PCNum
      INNER JOIN PT t ON c.PTNum = t.PTNum
      LEFT JOIN PR pr ON p.PR_PC_ID = pr.PRID
      WHERE b.BatchCode IS NOT NULL
      ORDER BY b.CreatedOn DESC
    `);
    
    const enrichedData = dbRes.recordset.map(row => {
      const sapItem = sapInventoryService.getInventoryMap().get(row.Codigo);
      return { ...row, Medicamento: sapItem ? sapItem.ItemName : row.Medicamento };
    });
    
    res.json({ ok: true, data: enrichedData });
  } catch (err) {
    console.error('Error en controlled-ledger:', err);
    res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

/**
 * GET /api/pharmacy/pending-prescriptions
 * Monitor de Recetas Pendientes (Cola de despacho)
 */
router.get('/pending-prescriptions', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res) => {
  try {
    const pool = await connectRemoteDB();
    const dbRes = await pool.request().query(`
      SELECT TOP 100
        i.PCPRITNum AS Id,
        p.CreatedOn AS FechaSolicitud,
        t.FullName AS Paciente,
        COALESCE(NULLIF(LTRIM(RTRIM(pr.FullName)), ''), NULLIF(LTRIM(RTRIM(pr.Name)) + ' ' + LTRIM(RTRIM(pr.LastName)), ''), 'NO ESPECIFICADO') AS Medico,
        i.ItemCode AS Codigo,
        ISNULL(i.ItemDescription, 'Material/Medicamento') AS Medicamento,
        i.Quantity AS Solicitado,
        c.AuxiliaryField2 AS CamaCuarto
      FROM PCPRIT i
      INNER JOIN PCPR p ON i.PCPRNum = p.PCPRNum
      INNER JOIN PC c ON p.PCNum = c.PCNum
      INNER JOIN PT t ON c.PTNum = t.PTNum
      LEFT JOIN PR pr ON p.PR_PC_ID = pr.PRID
      WHERE i.PCPRITNum NOT IN (SELECT PCPRITNum FROM PCPRBT)
      AND p.CreatedOn >= DATEADD(day, -7, GETDATE())
      AND i.ItemCode IS NOT NULL
      AND i.WarehouseCode = 'FAR'
      ORDER BY p.CreatedOn ASC
    `);

    // Obtener los IDs ocultos de SQLite
    const localDb = getDb();
    const hiddenRows = localDb.prepare('SELECT pcprit_num FROM hidden_prescriptions').all();
    const hiddenIds = new Set(hiddenRows.map(r => r.pcprit_num));

    let enrichedData = [];
    for (const row of dbRes.recordset) {
      if (!hiddenIds.has(String(row.Id))) {
        const sapItem = sapInventoryService.getInventoryMap().get(row.Codigo);
        enrichedData.push({ ...row, Medicamento: sapItem ? sapItem.ItemName : row.Medicamento });
      }
    }

    res.json({ ok: true, data: enrichedData.slice(0, 50) });
  } catch (err) {
    console.error('Error en pending-prescriptions:', err);
    res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

/**
 * POST /api/pharmacy/pending-prescriptions/hide/:id
 * Oculta una receta pendiente localmente
 */
router.post('/pending-prescriptions/hide/:id', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res) => {
  try {
    const localDb = getDb();
    localDb.prepare('INSERT OR IGNORE INTO hidden_prescriptions (pcprit_num) VALUES (?)').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error al ocultar receta:', err);
    res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

/**
 * GET /api/pharmacy/patient-history/:search
 * Historial Farmacológico por Paciente
 */
router.get('/patient-history/:search', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res) => {
  try {
    if (!req.params.search || req.params.search.trim().length < 3) {
      return res.status(400).json({ ok: false, error: 'La búsqueda debe tener al menos 3 caracteres' });
    }
    const pool = await connectRemoteDB();
    const dbRes = await pool.request()
      .input('search', sql.VarChar, '%' + req.params.search + '%')
      .query(`
      SELECT TOP 200
        b.CreatedOn AS Fecha,
        t.FullName AS Paciente,
        COALESCE(NULLIF(LTRIM(RTRIM(pr.FullName)), ''), NULLIF(LTRIM(RTRIM(pr.Name)) + ' ' + LTRIM(RTRIM(pr.LastName)), ''), 'NO ESPECIFICADO') AS Medico,
        i.ItemCode AS Codigo,
        ISNULL(i.ItemDescription, 'Material/Medicamento') AS Medicamento,
        b.BatchCode AS Lote,
        b.Quantity AS Cantidad
      FROM PCPRBT b
      INNER JOIN PCPRIT i ON b.PCPRITNum = i.PCPRITNum
      INNER JOIN PCPR p ON i.PCPRNum = p.PCPRNum
      INNER JOIN PC c ON p.PCNum = c.PCNum
      INNER JOIN PT t ON c.PTNum = t.PTNum
      LEFT JOIN PR pr ON p.PR_PC_ID = pr.PRID
      WHERE t.FullName LIKE @search
      AND b.BatchCode IS NOT NULL
      ORDER BY b.CreatedOn DESC
    `);
    
    const enrichedData = dbRes.recordset.map(row => {
      const sapItem = sapInventoryService.getInventoryMap().get(row.Codigo);
      return { ...row, Medicamento: sapItem ? sapItem.ItemName : row.Medicamento };
    });

    res.json({ ok: true, data: enrichedData });
  } catch (err) {
    console.error('Error en patient-history:', err);
    res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

/**
 * GET /api/pharmacy/surgical-kits
 * Calculadora Estadística de Kits Quirúrgicos
 */
router.get('/surgical-kits', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res) => {
  try {
    const pool = await connectRemoteDB();
    const dbRes = await pool.request().query(`
      SELECT TOP 200
        ISNULL(c.UDF_Diagnostico_presuntivo, 'CIRUGÍA GENERAL') AS Cirugia,
        i.ItemCode AS Codigo,
        ISNULL(i.ItemDescription, 'Material/Medicamento') AS Medicamento,
        AVG(b.Quantity) AS PromedioPiezas
      FROM PCPRBT b
      INNER JOIN PCPRIT i ON b.PCPRITNum = i.PCPRITNum
      INNER JOIN PCPR p ON i.PCPRNum = p.PCPRNum
      INNER JOIN PC c ON p.PCNum = c.PCNum
      WHERE i.WarehouseCode IN ('QX', 'QXCR')
      AND p.CreatedOn >= DATEADD(month, -6, GETDATE())
      GROUP BY c.UDF_Diagnostico_presuntivo, i.ItemCode, i.ItemDescription
      HAVING AVG(b.Quantity) > 0
    `);
    
    const rawData = dbRes.recordset;
    const kitsBySurgery = {};
    rawData.forEach(row => {
      if (!kitsBySurgery[row.Cirugia]) kitsBySurgery[row.Cirugia] = [];
      const sapItem = sapInventoryService.getInventoryMap().get(row.Codigo);
      kitsBySurgery[row.Cirugia].push({
        Codigo: row.Codigo,
        Medicamento: sapItem ? sapItem.ItemName : row.Medicamento,
        PromedioPiezas: row.PromedioPiezas
      });
    });

    // Sort items within kits and return the top 15 most robust kits
    const kitsArray = Object.keys(kitsBySurgery)
      .map(surgery => ({
        Cirugia: surgery,
        Items: kitsBySurgery[surgery].sort((a,b) => b.PromedioPiezas - a.PromedioPiezas).slice(0, 20) // up to 20 items per kit
      }))
      .sort((a,b) => b.Items.length - a.Items.length)
      .slice(0, 15);

    res.json({ ok: true, data: kitsArray });
  } catch (err) {
    console.error('Error en surgical-kits:', err);
    res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

module.exports = router;
