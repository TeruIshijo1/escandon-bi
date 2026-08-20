const express = require('express');
const router = express.Router();
const etlService = require('../services/etl.service');
const sapService = require('../services/sap.service');
const { connectRemoteDB } = require('../config/remote-db');
const { pool: pgPool } = require('../config/pg-db');
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
  const { itemCode } = req.params;
  try {
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
 * GET /api/pharmacy/salidas-farmacia (alias: /api/pharmacy/controlled-ledger)
 * Registro de Salidas y Dispensaciones de Farmacia con Lote
 */
const handleSalidasFarmacia = async (req, res) => {
  try {
    const filterClass = (req.query.classification || req.query.type || 'ALL').toUpperCase();
    const pool = await connectRemoteDB();
    const dbRes = await pool.request().query(`
      SELECT TOP 500
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
    
    const invMap = sapInventoryService.getInventoryMap();
    const clasiMap = sapInventoryService.getMedicalClassificationMap();

    let totalSalidas = 0;
    let totalControlados = 0;
    let totalAntibioticos = 0;
    let totalRedFria = 0;
    let totalAltoRiesgo = 0;

    const allData = dbRes.recordset.map(row => {
      const sapItem = invMap.get(row.Codigo);
      const clasi = clasiMap.get(row.Codigo);
      const medClass = clasi?.MedicalClassification || sapItem?.MedicalClassification || null;
      const secClass = clasi?.SecondaryClassification || sapItem?.SecondaryClassification || null;

      const isControlled = medClass === 'CON' || secClass === 'CON';
      const isAntibiotic = medClass === 'ANTI' || secClass === 'ANTI';
      const isColdChain = medClass === 'REFRI' || secClass === 'REFRI';
      const isHighRisk = medClass === 'AR' || secClass === 'AR';
      const isLasa = medClass === 'LASA' || secClass === 'LASA';

      totalSalidas++;
      if (isControlled) totalControlados++;
      if (isAntibiotic) totalAntibioticos++;
      if (isColdChain) totalRedFria++;
      if (isHighRisk) totalAltoRiesgo++;

      return {
        ...row,
        Medicamento: sapItem ? sapItem.ItemName : (clasi?.ItemName || row.Medicamento),
        Clasificacion: medClass || 'GENERAL',
        ClasificacionSecundaria: secClass,
        EsControlado: isControlled,
        EsAntibiotico: isAntibiotic,
        EsRedFria: isColdChain,
        EsAltoRiesgo: isHighRisk,
        EsLasa: isLasa
      };
    });

    let filteredData = allData;
    if (filterClass === 'CON' || filterClass === 'CONTROLADOS') {
      filteredData = allData.filter(d => d.EsControlado);
    } else if (filterClass === 'ANTI' || filterClass === 'ANTIBIOTICOS') {
      filteredData = allData.filter(d => d.EsAntibiotico);
    } else if (filterClass === 'REFRI' || filterClass === 'REDFRIA') {
      filteredData = allData.filter(d => d.EsRedFria);
    } else if (filterClass === 'AR' || filterClass === 'ALTORIESGO') {
      filteredData = allData.filter(d => d.EsAltoRiesgo);
    }
    
    res.json({
      ok: true,
      data: filteredData,
      stats: {
        totalSalidas,
        totalControlados,
        totalAntibioticos,
        totalRedFria,
        totalAltoRiesgo,
        articulosControladosCatalogo: Array.from(clasiMap.values()).filter(c => c.isControlled).length
      }
    });
  } catch (err) {
    console.error('Error en salidas-farmacia:', err);
    res.status(500).json({ ok: false, error: 'Error interno' });
  }
};

router.get('/salidas-farmacia', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), handleSalidasFarmacia);
router.get('/controlled-ledger', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), handleSalidasFarmacia);

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
        p.PCPRNum AS Requisicion,
        c.PCNum AS Cuenta,
        p.CreatedOn AS FechaSolicitud,
        p.CreatedBy AS UsuarioSolicito,
        t.FullName AS Paciente,
        COALESCE(NULLIF(LTRIM(RTRIM(pr.FullName)), ''), NULLIF(LTRIM(RTRIM(pr.Name)) + ' ' + LTRIM(RTRIM(pr.LastName)), ''), 'NO ESPECIFICADO') AS Medico,
        i.ItemCode AS Codigo,
        ISNULL(i.ItemDescription, 'Material/Medicamento') AS Medicamento,
        i.Quantity AS Solicitado,
        i.Notes AS Indicaciones,
        COALESCE(pcfr_req.FRName, pcfr_req.FRCode, pcfr_act.FRName, pcfr_act.FRCode, NULLIF(LTRIM(RTRIM(c.AuxiliaryField2)), ''), 'Ambulatorio') AS CamaCuarto
      FROM PCPRIT i
      INNER JOIN PCPR p ON i.PCPRNum = p.PCPRNum
      INNER JOIN PC c ON p.PCNum = c.PCNum
      INNER JOIN PT t ON c.PTNum = t.PTNum
      LEFT JOIN PR pr ON p.PR_PC_ID = pr.PRID
      LEFT JOIN dbo.PCFR pcfr_req ON p.PCFRNum = pcfr_req.PCFRNum
      LEFT JOIN dbo.PCFR pcfr_act ON c.PCNum = pcfr_act.PCNum AND pcfr_act.ExitDate IS NULL
      WHERE i.PCPRITNum NOT IN (SELECT PCPRITNum FROM PCPRBT)
      AND p.CreatedOn >= DATEADD(day, -7, GETDATE())
      AND i.ItemCode IS NOT NULL
      AND i.WarehouseCode = 'FAR'
      ORDER BY p.CreatedOn ASC
    `);

    // Obtener los IDs ocultos de PostgreSQL
    const hiddenRes = await pgPool.query('SELECT pcprit_num FROM dw_hidden_prescriptions');
    const hiddenIds = new Set(hiddenRes.rows.map(r => r.pcprit_num));

    let enrichedData = [];
    const inventoryMap = sapInventoryService.getInventoryMap();
    const batchesCache = sapInventoryService.getBatchesCache() || [];

    for (const row of dbRes.recordset) {
      if (!hiddenIds.has(String(row.Id))) {
        const sapItem = inventoryMap.get(row.Codigo);
        const sapBatches = batchesCache.filter(b => b.ItemCode === row.Codigo && (b.WhsCode === 'FAR' || !b.WhsCode) && b.Quantity > 0);
        const stockActual = sapItem ? (sapItem.QuantityOnStock ?? sapItem.OnHand ?? 0) : 0;

        enrichedData.push({ 
          ...row, 
          Medicamento: sapItem ? sapItem.ItemName : row.Medicamento,
          StockActual: stockActual,
          LotesDisponibles: sapBatches.map(b => ({ lote: b.Batch || b.BatchNum, exp: b.ExpirationDate || b.ExpDate, cant: b.Quantity }))
        });
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
    await pgPool.query('INSERT INTO dw_hidden_prescriptions (pcprit_num) VALUES ($1) ON CONFLICT (pcprit_num) DO NOTHING', [req.params.id]);
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
 * Calculadora Estadística de Kits Quirúrgicos desde PostgreSQL DW
 */
router.get('/surgical-kits', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res) => {
  try {
    const pgRes = await pgPool.query(`
      SELECT 
        cirugia AS "Cirugia",
        num_cirugias AS "NumCirugias",
        jsonb_array_length(items_json) AS "ItemsCount",
        items_json AS "Items"
      FROM dw_quirofano_kits_cache
      ORDER BY num_cirugias DESC, jsonb_array_length(items_json) DESC;
    `);

    res.json({ ok: true, data: pgRes.rows, totalKits: pgRes.rows.length });
  } catch (err) {
    console.error('Error en surgical-kits:', err);
    res.status(500).json({ ok: false, error: 'Error interno al consultar kits desde DW' });
  }
});

/**
 * GET /api/pharmacy/surgical-events
 * Agenda y Registro de Eventos Quirúrgicos desde PostgreSQL DW
 */
router.get('/surgical-events', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const clampedDays = Math.min(Math.max(days, 1), 365);

    const pgRes = await pgPool.query(`
      SELECT 
        e.pcfr_num AS "PCFRNum",
        e.numero_paciente AS "Numero_Paciente",
        e.paciente AS "Paciente",
        e.quirofano AS "Quirofano",
        e.fecha_inicio AS "FechaInicio",
        e.fecha_fin AS "FechaFin",
        e.medicos AS "Medicos",
        e.procedimientos AS "Procedimiento",
        COALESCE(
          json_agg(
            json_build_object('Codigo', c.item_code, 'Medicamento', c.item_description, 'Cantidad', c.cantidad)
            ORDER BY c.cantidad DESC
          ) FILTER (WHERE c.item_code IS NOT NULL), '[]'
        ) AS "ActualItems"
      FROM dw_quirofano_eventos e
      LEFT JOIN dw_quirofano_consumos c ON e.pcfr_num = c.pcfr_num
      WHERE e.fecha_inicio >= NOW() - ($1 || ' days')::INTERVAL
      GROUP BY e.pcfr_num, e.numero_paciente, e.paciente, e.quirofano, e.fecha_inicio, e.fecha_fin, e.medicos, e.procedimientos
      ORDER BY e.fecha_inicio DESC
      LIMIT 300;
    `, [clampedDays]);

    const result = pgRes.rows.map(row => ({
      ...row,
      ActualItemsCount: (row.ActualItems || []).length
    }));

    res.json({ ok: true, data: result, days: clampedDays });
  } catch (err) {
    console.error('Error en surgical-events:', err);
    res.status(500).json({ ok: false, error: 'Error interno al consultar eventos quirúrgicos desde DW' });
  }
});

/**
 * GET /api/pharmacy/doctor-variations
 * Comparativo de consumo de insumos por cirujano agrupado por procedimiento desde PostgreSQL DW
 */
router.get('/doctor-variations', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res) => {
  try {
    const months = parseInt(req.query.months) || 6;
    const clampedMonths = Math.min(Math.max(months, 1), 24);

    const pgRes = await pgPool.query(`
      SELECT 
        e.procedimiento_norm AS "ProcedimientoNorm",
        e.medicos AS "Medico",
        c.item_code AS "Codigo",
        c.item_description AS "Medicamento",
        AVG(c.cantidad) AS "PromedioPiezas",
        COUNT(DISTINCT e.pcfr_num) AS "NumCirugias"
      FROM dw_quirofano_eventos e
      INNER JOIN dw_quirofano_consumos c ON e.pcfr_num = c.pcfr_num
      WHERE e.fecha_inicio >= NOW() - ($1 || ' months')::INTERVAL
      AND e.medicos IS NOT NULL AND TRIM(e.medicos) <> ''
      AND e.procedimientos IS NOT NULL AND TRIM(e.procedimientos) <> ''
      GROUP BY e.procedimiento_norm, e.medicos, c.item_code, c.item_description
      HAVING AVG(c.cantidad) > 0;
    `, [clampedMonths]);

    const sapInventoryService = require('../services/sapInventory.service');
    const sapMap = sapInventoryService.getInventoryMap();
    const result = {};

    pgRes.rows.forEach(row => {
      const proc = row.ProcedimientoNorm;
      const med = row.Medico;
      if (!result[proc]) result[proc] = {};
      if (!result[proc][med]) {
        result[proc][med] = {
          Medico: med,
          NumCirugias: parseInt(row.NumCirugias),
          Items: []
        };
      }
      const sapItem = sapMap.get(row.Codigo);
      const name = (sapItem && sapItem.ItemName && sapItem.ItemName !== 'Material/Medicamento') 
        ? sapItem.ItemName 
        : (row.Medicamento && row.Medicamento !== 'Material/Medicamento' ? row.Medicamento : row.Codigo);

      result[proc][med].Items.push({
        Codigo: row.Codigo,
        Medicamento: name,
        PromedioPiezas: Math.round(parseFloat(row.PromedioPiezas) * 10) / 10
      });
    });

    res.json({ ok: true, data: result, months: clampedMonths });
  } catch (err) {
    console.error('Error en doctor-variations:', err);
    res.status(500).json({ ok: false, error: 'Error interno al consultar variaciones por médico desde DW' });
  }
});

/**
 * GET /api/pharmacy/quirofano-inventory
 * Stock en tiempo real del Almacén Quirófano (QX) y Quirófano Controlados (QXCR)
 */
router.get('/quirofano-inventory', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'USUARIO_OPERATIVO', 'ALMACEN_GENERAL']), async (req, res) => {
  try {
    const sapInventoryService = require('../services/sapInventory.service');
    const cache = sapInventoryService.getInventoryCache();
    
    // Filtrar solo insumos con presencia en almacenes QX y QXCR
    const qxItems = cache.filter(item => item.WhsCode === 'QX' || item.WhsCode === 'QXCR');

    // Calcular estadísticas
    let totalItems = qxItems.length;
    let totalStock = 0;
    let totalValue = 0;
    let qxcrCount = 0;

    qxItems.forEach(item => {
      totalStock += item.QuantityOnStock || 0;
      totalValue += (item.QuantityOnStock || 0) * (item.SalesPrice || 0);
      if (item.WhsCode === 'QXCR') qxcrCount++;
    });

    res.json({
      ok: true,
      data: qxItems,
      stats: {
        totalItems,
        totalStock,
        totalValue: Math.round(totalValue * 100) / 100,
        qxcrCount
      }
    });
  } catch (err) {
    console.error('Error en quirofano-inventory:', err);
    res.status(500).json({ ok: false, error: 'Error interno al obtener inventario de Quirófano' });
  }
});

/**
 * GET /api/pharmacy/quirofano-movements
 * Historial de Movimientos: Salidas a Pacientes y Devoluciones/Retornos en Quirófano (QX/QXCR)
 */
router.get('/quirofano-movements', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'USUARIO_OPERATIVO', 'ALMACEN_GENERAL']), async (req, res) => {
  try {
    const type = req.query.type || 'all'; // 'salidas', 'devoluciones', 'all'
    const days = parseInt(req.query.days) || 30;
    const clampedDays = Math.min(Math.max(days, 1), 180);

    const pool = await connectRemoteDB();
    const sapMap = sapInventoryService.getInventoryMap();
    let movements = [];

    // 1. Obtener Salidas a Cirugías/Pacientes si aplica ('salidas' o 'all')
    if (type === 'salidas' || type === 'all') {
      const salRes = await pool.request().query(`
        SELECT TOP 500
          p.PCNum,
          p.PCFRNum,
          COALESCE(NULLIF(LTRIM(RTRIM(q.Paciente)), ''), NULLIF(LTRIM(RTRIM(pt.FullName)), ''), 'PACIENTE QUIRURGICO') AS Paciente,
          COALESCE(NULLIF(LTRIM(RTRIM(q.Quirofano)), ''), 'QUIROFANO') AS Quirofano,
          COALESCE(NULLIF(LTRIM(RTRIM(q.Medicos)), ''), NULLIF(LTRIM(RTRIM(pr.FullName)), ''), NULLIF(LTRIM(RTRIM(pr.Name)) + ' ' + LTRIM(RTRIM(pr.LastName)), ''), 'CIRUJANO TRATANTE') AS Medicos,
          COALESCE(NULLIF(LTRIM(RTRIM(q.Procedimientos)), ''), 'CIRUGIA / PROCEDIMIENTO QX') AS Procedimiento,
          p.CreatedOn AS Fecha,
          i.ItemCode AS Codigo,
          COALESCE(NULLIF(LTRIM(RTRIM(i.ItemDescription)), ''), 'Material Quirúrgico') AS Medicamento,
          b.Quantity AS Cantidad,
          COALESCE(i.WarehouseCode, 'QX') AS Almacen,
          'SALIDA_CARGO' AS TipoMovimiento
        FROM PCPR p
        INNER JOIN PCPRIT i ON p.PCPRNum = i.PCPRNum
        INNER JOIN PCPRBT b ON i.PCPRITNum = b.PCPRITNum
        INNER JOIN PC c ON p.PCNum = c.PCNum
        INNER JOIN PT pt ON c.PTNum = pt.PTNum
        LEFT JOIN PR pr ON p.PR_PC_ID = pr.PRID
        LEFT JOIN UDR_USOQX q ON p.PCFRNum = q.PCFRNum
        WHERE (i.WarehouseCode IN ('QX', 'QXCR') OR p.SUCode = 'CQX' OR p.SUCodeReq = 'CQX')
          AND p.CreatedOn >= DATEADD(day, -${clampedDays}, GETDATE())
        ORDER BY p.CreatedOn DESC
      `);
      movements.push(...salRes.recordset);
    }

    // 2. Obtener Devoluciones y Retornos si aplica ('devoluciones' o 'all')
    if (type === 'devoluciones' || type === 'all') {
      const devRes = await pool.request().query(`
        SELECT TOP 500
          h.PCDLNum AS PCNum,
          h.PCFRNum,
          COALESCE(NULLIF(LTRIM(RTRIM(q.Paciente)), ''), NULLIF(LTRIM(RTRIM(pt.FullName)), ''), 'PACIENTE HOSPITAL') AS Paciente,
          COALESCE(NULLIF(LTRIM(RTRIM(q.Quirofano)), ''), 'QUIROFANO') AS Quirofano,
          COALESCE(NULLIF(LTRIM(RTRIM(q.Medicos)), ''), NULLIF(LTRIM(RTRIM(h.CreatedBy)), ''), 'EQUIPO QX') AS Medicos,
          COALESCE(NULLIF(LTRIM(RTRIM(q.Procedimientos)), ''), NULLIF(LTRIM(RTRIM(h.Notes)), ''), 'DEVOLUCION DE MATERIAL / RETORNO QX') AS Procedimiento,
          l.CreatedOn AS Fecha,
          l.ItemCode AS Codigo,
          COALESCE(NULLIF(LTRIM(RTRIM(l.ItemDescription)), ''), 'Material Quirúrgico') AS Medicamento,
          -ABS(l.Quantity) AS Cantidad,
          COALESCE(l.WarehouseCode, 'QX') AS Almacen,
          'DEVOLUCION' AS TipoMovimiento
        FROM PCDLBL l
        INNER JOIN PCDL h ON l.PCDLNum = h.PCDLNum
        LEFT JOIN PC c ON h.PCNum = c.PCNum
        LEFT JOIN PT pt ON c.PTNum = pt.PTNum
        LEFT JOIN UDR_USOQX q ON h.PCFRNum = q.PCFRNum
        WHERE (
          l.WarehouseCode IN ('QX', 'QXCR') 
          OR l.U_SUCode = 'CQX' 
          OR l.ItemCode LIKE 'QUI%' 
          OR l.U_FRCode LIKE '%QX%'
          OR l.U_FRCode LIKE '%QUIRO%'
        )
        AND l.CreatedOn >= DATEADD(day, -${clampedDays}, GETDATE())
        ORDER BY l.CreatedOn DESC
      `);
      movements.push(...devRes.recordset);
    }

    // Ordenar por Fecha descendente
    movements.sort((a, b) => new Date(b.Fecha) - new Date(a.Fecha));

    // Enriquecer con nombres de SAP si el nombre es genérico
    const enrichedMovements = movements.map(m => {
      const sapItem = sapMap.get(m.Codigo);
      const name = (sapItem && sapItem.ItemName && sapItem.ItemName !== 'Material/Medicamento') 
        ? sapItem.ItemName 
        : m.Medicamento;
      return { ...m, Medicamento: name };
    });

    // Contadores estadísticos
    let totalSalidas = 0;
    let totalDevoluciones = 0;
    let piezasSalidas = 0;
    let piezasDevueltas = 0;

    enrichedMovements.forEach(m => {
      if (m.Cantidad < 0) {
        totalDevoluciones++;
        piezasDevueltas += Math.abs(m.Cantidad);
      } else {
        totalSalidas++;
        piezasSalidas += m.Cantidad;
      }
    });

    res.json({
      ok: true,
      data: enrichedMovements,
      stats: {
        totalMovimientos: enrichedMovements.length,
        totalSalidas,
        totalDevoluciones,
        piezasSalidas,
        piezasDevueltas
      }
    });
  } catch (err) {
    console.error('Error en quirofano-movements:', err);
    res.status(500).json({ ok: false, error: 'Error interno al consultar movimientos de Quirófano' });
  }
});

module.exports = router;
