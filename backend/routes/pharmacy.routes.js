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
    // (SAP en vivo; si no responde, se usa el snapshot persistido en PostgreSQL)
    await sapInventoryService.ensureInventoryData();
    
    // Filtrar únicamente los items que pertenecen al almacén solicitado
    const warehouseItems = sapInventoryService.getInventoryCache().filter(item => item.WhsCode === warehouseCode);
    
    res.json({ ok: true, data: warehouseItems });
  } catch (err) {
    console.error('[Pharmacy Inventario SAP Error]', err);
    res.status(500).json({ ok: false, error: 'Error interno al consultar el inventario' });
  }
});

router.get('/lotes', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res) => {
  const itemCode = req.query.itemCode;
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
router.get('/historial-lotes', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res) => {
  try {
    const itemCode = req.query.itemCode;
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
router.get('/ubicaciones', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res) => {
  const itemCode = req.query.itemCode;
  if (!itemCode) return res.status(400).json({ ok: false, error: 'ItemCode requerido' });
  
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

const pool = pgPool;

/**
 * GET /api/pharmacy/punto-reorden
 * Devuelve el catálogo de Insumos con Mínimos, Máximos, Stock Actual, Pedidos SAP en curso y Notas de Almacén.
 */
router.get('/punto-reorden', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'ALMACEN_GENERAL', 'USUARIO_OPERATIVO']), async (req, res) => {
  try {
    const sapInventoryService = require('../services/sapInventory.service');
    // Garantiza inventario disponible (SAP en vivo o snapshot PostgreSQL)
    await sapInventoryService.ensureInventoryData();
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
      // Stock de Farmacia (almacén FAR) si el artículo existe ahí;
      // si no, se usa el total entre almacenes (p.ej. códigos ALG heredados)
      const farRows = sapInventoryService.getInventoryCache().filter(i => i.ItemCode === item.ItemCode && i.WhsCode === 'FAR');
      const farStock = farRows.reduce((acc, curr) => acc + (curr.QuantityOnStock || curr.OnHand || 0), 0);
      let stock = farStock;
      let stockFuente = 'FAR';
      if (farRows.length === 0) {
        stock = sapInventoryService.getInventoryCache()
          .filter(i => i.ItemCode === item.ItemCode)
          .reduce((acc, curr) => acc + (curr.QuantityOnStock || curr.OnHand || 0), 0);
        stockFuente = 'TOTAL';
      }
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
        StockFuente: stockFuente,
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
      },
      meta: {
        sapOnline: !sapInventoryService.isUsingDBFallback(),
        inventorySource: sapInventoryService.isUsingDBFallback() ? 'snapshot_postgresql' : 'sap_live',
        lastInventorySync: sapInventoryService.getLastSyncTime()
      }
    });
  } catch (err) {
    console.error('[Punto Reorden Error]', err);
    res.status(500).json({ ok: false, error: 'Error al consultar Punto de Reorden' });
  }
});


/**
 * PUT /api/pharmacy/punto-reorden/:code
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
 * GET /api/pharmacy/pedidos-sap
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
 * GET /api/pharmacy/ml-dataset
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
    
      // FILTRO EXCLUSIVO FARMACIA:
      const sapInventoryService = require('../services/sapInventory.service');
      const allCache = sapInventoryService.getInventoryCache();
      const farItems = new Set();
      if (allCache && Array.isArray(allCache)) {
        allCache.forEach(i => {
          if (i.WhsCode === 'FAR') farItems.add(i.ItemCode);
        });
      }
      
      const filteredData = pgRes.rows.filter(r => farItems.has(r.itemcode));
      res.json({ ok: true, data: filteredData, count: filteredData.length });

  } catch (err) {
    console.error('[GET ML Dataset Error]', err);
    res.status(500).json({ ok: false, error: 'Error al consultar el dataset analítico de ML' });
  }
});


/**
 * POST /api/pharmacy/ml-dataset/sync
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


/**
 * GET /api/pharmacy/ml-history
 * Retorna el historial completo del dataset analítico
 */
router.get('/ml-history', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'ALMACEN_GENERAL']), async (req, res) => {
  try {
    const pgRes = await pool.query(`
      SELECT 
        snapshot_date AS "snapshot_date",
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
        fecha_desabasto AS "fecha_desabasto",
        dias_stock_restante AS "dias_stock_restante",
        riesgo_base AS "riesgo_base",
        target_desabasto_7d AS "target_desabasto_7d",
        target_desabasto_15d AS "target_desabasto_15d",
        fecha_calculo AS "fecha_calculo"
      FROM ml_dataset_reorden_sku_history
      ORDER BY snapshot_date DESC, itemcode ASC
    `);
    
      // FILTRO EXCLUSIVO FARMACIA:
      const sapInventoryService = require('../services/sapInventory.service');
      const allCache = sapInventoryService.getInventoryCache();
      const farItems = new Set();
      if (allCache && Array.isArray(allCache)) {
        allCache.forEach(i => {
          if (i.WhsCode === 'FAR') farItems.add(i.ItemCode);
        });
      }
      
      const filteredData = pgRes.rows.filter(r => farItems.has(r.itemcode));
      res.json({ ok: true, data: filteredData, count: filteredData.length });

  } catch (err) {
    console.error('[GET ML History Error]', err);
    res.status(500).json({ ok: false, error: 'Error al consultar el historial analítico de ML' });
  }
});


/**
 * GET /api/pharmacy/ml-history/download
 * Descarga el historial completo en formato CSV preparado para pandas/python
 */
router.get('/ml-history/download', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'ALMACEN_GENERAL']), async (req, res) => {
  try {
    const pgRes = await pool.query(`
      SELECT 
        snapshot_date, itemcode, itemdescription, stock_actual, consumo_7d, consumo_15d, consumo_30d, 
        consumo_promedio_diario, variabilidad_consumo, minstock, maxstock, pedidos_abiertos, 
        fecha_ultimo_movimiento, fecha_desabasto, dias_stock_restante, riesgo_base, target_desabasto_7d, target_desabasto_15d, fecha_calculo
      FROM ml_dataset_reorden_sku_history
      ORDER BY snapshot_date DESC, itemcode ASC
    `);
    
    const headers = [
      'snapshot_date', 'itemcode', 'itemdescription', 'stock_actual', 'consumo_7d', 'consumo_15d', 
      'consumo_30d', 'consumo_promedio_diario', 'variabilidad_consumo', 'minstock', 'maxstock', 'pedidos_abiertos', 
      'fecha_ultimo_movimiento', 'fecha_desabasto', 'dias_stock_restante', 'riesgo_base', 'target_desabasto_7d', 'target_desabasto_15d', 'fecha_calculo'
    ];
    
    let csv = '\uFEFF' + headers.join(',') + '\n';
    
    pgRes.rows.forEach(row => {
      const line = headers.map(h => {
        let val = row[h];
        if (val === null || val === undefined) {
          val = '';
        } else if (val instanceof Date) {
          val = val.toISOString();
        } else if (h === 'snapshot_date') {
          // Format snapshot_date as YYYY-MM-DD
          val = new Date(val).toISOString().split('T')[0];
        } else {
          val = String(val);
        }
        val = val.replace(/"/g, '""');
        if (val.includes(',') || val.includes('\n') || val.includes('"')) {
          return `"${val}"`;
        }
        return val;
      });
      csv += line.join(',') + '\n';
    });
    
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="ml_dataset_reorden_sku_history.csv"');
    res.send(csv);
  } catch (err) {
    console.error('[GET Download ML History Error]', err);
    res.status(500).send('Error al generar la descarga del historial analítico');
  }
});


/**
 * GET /api/pharmacy/ml-predictions
 * Retorna las predicciones de Machine Learning actuales
 */
router.get('/ml-predictions', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'ALMACEN_GENERAL']), async (req, res) => {
  try {
    const pgRes = await pool.query(`
      SELECT 
        itemcode AS "itemcode",
        itemdescription AS "itemdescription",
        stock_actual AS "stock_actual",
        consumo_promedio_diario AS "consumo_promedio_diario",
        dias_stock_restante AS "dias_stock_restante",
        riesgo_base AS "riesgo_base",
        prob_desabasto_7d AS "prob_desabasto_7d",
        riesgo_ml AS "riesgo_ml",
        modelo_version AS "modelo_version",
        fecha_ultimo_movimiento AS "fecha_ultimo_movimiento",
        fecha_desabasto AS "fecha_desabasto",
        fecha_estimada_agotamiento AS "fecha_estimada_agotamiento",
        fecha_prediccion AS "fecha_prediccion"
      FROM ml_predictions_reorden_sku
      ORDER BY prob_desabasto_7d DESC, itemcode ASC
    `);
    
      // FILTRO EXCLUSIVO FARMACIA:
      const sapInventoryService = require('../services/sapInventory.service');
      const allCache = sapInventoryService.getInventoryCache();
      const farItems = new Set();
      if (allCache && Array.isArray(allCache)) {
        allCache.forEach(i => {
          if (i.WhsCode === 'FAR') farItems.add(i.ItemCode);
        });
      }
      
      const filteredData = pgRes.rows.filter(r => farItems.has(r.itemcode));
      res.json({ ok: true, data: filteredData, count: filteredData.length });

  } catch (err) {
    console.error('[GET ML Predictions Error]', err);
    res.status(500).json({ ok: false, error: 'Error al consultar predicciones de Machine Learning' });
  }
});


/**
 * GET /api/pharmacy/ml-predictions/status
 * Retorna el estado del último job ejecutado para predicciones de almacén
 */
router.get('/ml-predictions/status', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'ALMACEN_GENERAL']), async (req, res) => {
  try {
    const { getLatestJobStatus } = require('../services/mlJobRunner.service');
    const status = await getLatestJobStatus('REORDER_RISK');
    res.json({ ok: true, data: status });
  } catch (err) {
    console.error('[GET ML Predictions Status Error]', err);
    res.status(500).json({ ok: false, error: 'Error al consultar estado de predicciones' });
  }
});


/**
 * POST /api/pharmacy/ml-predictions/run
 * Ejecuta el script de predicción de Machine Learning con trazabilidad en ml_job_runs y control de concurrencia
 */
router.post('/ml-predictions/run', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'ALMACEN_GENERAL']), async (req, res) => {
  const { startJob, runPythonScript } = require('../services/mlJobRunner.service');
  const triggeredBy = req.user?.username || req.user?.email || 'USER';

  try {
    const jobResult = await startJob('REORDER_RISK', async () => {
      console.log('[ML Express] Iniciando predicción de riesgo de desabasto...');
      const { stdout } = await runPythonScript('predict_reorder_risk.py');
      return stdout;
    }, triggeredBy, { waitForCompletion: true });

    if (jobResult.alreadyRunning) {
      return res.status(409).json({
        ok: false,
        alreadyRunning: true,
        error: jobResult.message
      });
    }

    if (jobResult.status === 'ERROR') {
      return res.status(500).json({
        ok: false,
        jobId: jobResult.jobId,
        error: jobResult.error_message || 'Error al ejecutar modelo predictivo',
        stderr: jobResult.stderr || ''
      });
    }

    res.json({
      ok: true,
      jobId: jobResult.jobId,
      message: 'Predicciones de Machine Learning ejecutadas y guardadas correctamente.',
      duration_seconds: jobResult.duration_seconds,
      stdout: jobResult.stdout
    });
  } catch (error) {
    console.error('[POST Run ML Predictions Error]', error);
    res.status(500).json({
      ok: false,
      error: 'Error al procesar job de predicciones: ' + error.message
    });
  }
});

/**
 * GET /api/pharmacy/config-dinamica
 * Configuración Dinámica (Farmacia): lee el Excel de MÁXIMOS, MÍNIMOS Y PUNTOS DE REORDEN,
 * calcula los puntos MIN/REORDEN/MAX por producto y los vincula con códigos SAP.
 */
router.get('/config-dinamica', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'ALMACEN_GENERAL']), async (req, res) => {
  try {
    const reorderConfig = require('../services/reorderConfig.service');
    const data = await reorderConfig.getDynamicConfig();
    res.json(data);
  } catch (err) {
    console.error('[GET Config Dinamica Error]', err);
    res.status(500).json({ ok: false, error: 'Error al procesar el Excel de configuración dinámica: ' + err.message });
  }
});

/**
 * GET /api/pharmacy/config-dinamica/search-sap?q=
 * Busca artículos SAP por código/descripción para vinculación manual del Excel.
 */
router.get('/config-dinamica/search-sap', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'ALMACEN_GENERAL']), async (req, res) => {
  try {
    const reorderConfig = require('../services/reorderConfig.service');
    const results = await reorderConfig.searchSapCatalog(req.query.q, 20);
    res.json({ ok: true, data: results });
  } catch (err) {
    console.error('[GET Config Dinamica Search Error]', err);
    res.status(500).json({ ok: false, error: 'Error en la búsqueda SAP: ' + err.message });
  }
});

/**
 * POST /api/pharmacy/config-dinamica/link
 * Vincula (o desvincula con itemcode null) un producto del Excel con un código SAP.
 */
router.post('/config-dinamica/link', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'ALMACEN_GENERAL']), async (req, res) => {
  try {
    const { producto, itemcode } = req.body || {};
    if (!producto) return res.status(400).json({ ok: false, error: 'El nombre del producto es requerido' });
    const reorderConfig = require('../services/reorderConfig.service');
    await reorderConfig.saveManualLinks([{ producto, itemcode: itemcode || null }]);
    const config = await reorderConfig.getDynamicConfig(true);
    res.json({ ok: true, message: 'Vínculo guardado correctamente', stats: config.stats });
  } catch (err) {
    console.error('[POST Config Dinamica Link Error]', err);
    res.status(500).json({ ok: false, error: 'Error al guardar el vínculo: ' + err.message });
  }
});

/**
 * POST /api/pharmacy/config-dinamica/apply
 * Aplica los puntos MIN/MAX calculados a la matriz dw_sap_reorder_settings.
 * Body: { productos?: string[], soloVinculados?: boolean, syncMl?: boolean }
 */
router.post('/config-dinamica/apply', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'ALMACEN_GENERAL']), async (req, res) => {
  try {
    const { productos, syncMl } = req.body || {};
    const reorderConfig = require('../services/reorderConfig.service');

    const config = await reorderConfig.getDynamicConfig(true);
    if (!config.available) {
      return res.status(400).json({ ok: false, error: 'No hay Excel de configuración cargado' });
    }

    let rows = config.rows.filter(r => r.itemcode);
    if (Array.isArray(productos) && productos.length > 0) {
      const set = new Set(productos.map(p => String(p).trim()));
      rows = rows.filter(r => set.has(r.producto));
    }

    if (rows.length === 0) {
      return res.status(400).json({ ok: false, error: 'No hay productos vinculados a códigos SAP para aplicar' });
    }

    const result = await reorderConfig.applyToSettings(rows, { onlyLinked: true });

    // Regenerar el dataset de ML con los nuevos mínimos/máximos
    let mlSynced = 0;
    if (syncMl !== false) {
      try {
        const { syncMLDataset } = require('../services/mlDataset.service');
        mlSynced = await syncMLDataset();
      } catch (mlErr) {
        console.warn('[Config Dinamica Apply] No se pudo sincronizar el dataset ML:', mlErr.message);
      }
    }

    res.json({
      ok: true,
      applied: result.applied,
      errors: result.errors,
      mlSynced,
      message: `Configuración aplicada a ${result.applied} SKUs. ${syncMl !== false ? 'Dataset de IA regenerado.' : ''}`
    });
  } catch (err) {
    console.error('[POST Config Dinamica Apply Error]', err);
    res.status(500).json({ ok: false, error: 'Error al aplicar la configuración: ' + err.message });
  }
});

/**
 * POST /api/pharmacy/config-dinamica/upload
 * Carga una nueva versión del Excel (.xlsm/.xlsx) de Puntos de Reorden.
 */
router.post('/config-dinamica/upload', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res) => {
  try {
    const multer = require('multer');
    const fs = require('fs');
    const path = require('path');
    const uploadDir = path.join(__dirname, '..', 'uploads', 'excel');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const uploadMiddleware = multer({
      storage: multer.diskStorage({
        destination: (rq, fl, cb) => cb(null, uploadDir),
        filename: (rq, fl, cb) => cb(null, `reorder_config_${Date.now()}${path.extname(fl.originalname).toLowerCase()}`)
      }),
      limits: { fileSize: 50 * 1024 * 1024 },
      fileFilter: (rq, fl, cb) => {
        if (!/\.(xlsm|xlsx)$/i.test(fl.originalname)) {
          return cb(new Error('Solo se aceptan archivos .xlsm o .xlsx'));
        }
        cb(null, true);
      }
    }).single('file');

    uploadMiddleware(req, res, async (uploadErr) => {
      if (uploadErr) return res.status(400).json({ ok: false, error: uploadErr.message });
      if (!req.file) return res.status(400).json({ ok: false, error: 'No se recibió archivo' });
      try {
        const reorderConfig = require('../services/reorderConfig.service');
        const parsed = await reorderConfig.parseReorderExcel(req.file.path);
        const matched = await reorderConfig.buildMatches(parsed.rows);
        reorderConfig.invalidateCache();
        const stats = {
          total: matched.length,
          linked: matched.filter(r => r.matchType === 'MANUAL').length,
          autoHigh: matched.filter(r => r.matchType === 'AUTO_ALTA').length,
          autoMedium: matched.filter(r => r.matchType === 'AUTO_MEDIA').length,
          unmatched: matched.filter(r => !r.itemcode).length
        };
        res.json({ ok: true, fileName: parsed.fileName, totalRows: parsed.totalRows, stats, message: `Excel procesado: ${parsed.totalRows} productos detectados.` });
      } catch (parseErr) {
        console.error('[POST Config Dinamica Upload Parse Error]', parseErr);
        res.status(400).json({ ok: false, error: 'El archivo no tiene el formato esperado: ' + parseErr.message });
      }
    });
  } catch (err) {
    console.error('[POST Config Dinamica Upload Error]', err);
    res.status(500).json({ ok: false, error: 'Error al cargar el archivo: ' + err.message });
  }
});

module.exports = router;

