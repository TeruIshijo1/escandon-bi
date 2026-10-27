

'use strict';

const express  = require('express');
const router   = express.Router();
const { getDb } = require('../config/db');
const { authenticate, authorize, authorizeArea } = require('../middleware/auth.middleware');
const dataHubService = require('../services/datahub.service');
const { querySiti } = require('../config/siti-api');
const { connectRemoteDB } = require('../config/remote-db');
const sapService = require('../services/sap.service');
const fs = require('fs');
const path = require('path');
const { splitDateRange } = require('../utils/dashboard-helper');
const { pool: pgPool } = require('../config/pg-db');
const dashboardCache = require('../utils/dashboardCache');
const { hospitalToday, addDays } = require('../services/statisticsCommon');
const { getQuirofanoRevenueStatus } = require('../services/quirofanoRevenue.service');
const coversSnapshot = (state, start, end) => Boolean(state?.lastSuccessAt && state.coverageStartDate && state.throughDate
  && state.coverageStartDate <= start.slice(0, 10) && state.throughDate >= end.slice(0, 10));

async function fetchAllSapPages(sapService, initialUrl) {
  return sapService.fetchAllPages(initialUrl);
}

router.get(
  '/directivo',
  authenticate,
  authorize(['ADMIN', 'DIRECTOR']),
  async (req, res, next) => {
    try {
      const db = getDb();

      // Ocupación global
      const ocupacion = await db.prepare(`
        SELECT
          COUNT(*)                                                           AS TotalCamas,
          SUM(CASE WHEN Estado = 'OCUPADA' THEN 1 ELSE 0 END)               AS Ocupadas,
          ROUND(
            CAST(SUM(CASE WHEN Estado = 'OCUPADA' THEN 1 ELSE 0 END) AS NUMERIC)
            * 100.0 / GREATEST(COUNT(*), 1)
          , 1)                                                               AS PctOcupacion
        FROM Camas WHERE Activo = 1
      `).get();

      // KPIs de eficacia clínica
      const eficacia = await db.prepare(`
        SELECT
          ROUND(
            CAST(SUM(CASE WHEN TipoEgreso='DEFUNCION' THEN 1 ELSE 0 END) AS NUMERIC)
            * 100.0 / GREATEST(COUNT(*), 1)
          , 2) AS TasaMortalidad,
          COUNT(*) AS TotalEgresos,
          ROUND(AVG((EXTRACT(EPOCH FROM e.FechaEgreso) - EXTRACT(EPOCH FROM a.FechaIngreso)) / 86400.0), 1) AS EstanciaPromedio
        FROM Egresos e
        JOIN Admisiones a ON a.AdmisionId = e.AdmisionId
        WHERE e.FechaEgreso >= CURRENT_TIMESTAMP - INTERVAL '1 month'
      `).get();

      // Producción quirúrgica
      const produccion = await db.prepare(`
        SELECT
          COUNT(*) AS CirugiasHoy,
          SUM(CASE WHEN Estado='REALIZADA'  THEN 1 ELSE 0 END) AS Realizadas,
          SUM(CASE WHEN Estado='CANCELADA'  THEN 1 ELSE 0 END) AS Canceladas,
          SUM(CASE WHEN Estado='EN_CURSO'   THEN 1 ELSE 0 END) AS EnCurso
        FROM ProgramacionQuirofano
        WHERE FechaCirugia::date = CURRENT_DATE
      `).get();

      // Aquí usaremos los montos de AuditoriaInventarioCargos como referencia
      const financiero = await db.prepare(`
        SELECT 
          COALESCE(SUM(MontoDisputa), 0) AS MontoEnDisputa,
          (SELECT COALESCE(SUM(PrecioUnitario * CantidadSurtida), 0) FROM AlmacenOrdenes WHERE FechaSurtido >= DATE_TRUNC('month', CURRENT_TIMESTAMP)) AS CostoInsumosMes
        FROM AuditoriaInventarioCargos
        WHERE FechaAuditoria >= DATE_TRUNC('month', CURRENT_TIMESTAMP)
      `).get();

      // Estado por Área (Censo)
      const censo = await db.prepare(`
        SELECT Area, COUNT(*) as Ocupadas 
        FROM Camas 
        WHERE Estado = 'OCUPADA' 
        GROUP BY Area
      `).all();

      // Sobrescribir con Mapeos Dinámicos (Data Hub)
      const dynamicKPIs = [
        'dir_ocupacion', 'dir_mortalidad', 'dir_cirugias',
        'mando_eficiencia', 'mando_eficacia', 'mando_satisfaccion', 'mando_presupuesto'
      ];
      const overrides = {};
      
      for (const kpi of dynamicKPIs) {
        const val = await dataHubService.getMetricValue(kpi);
        if (val !== null) overrides[kpi] = val;
      }

      res.json({
        ok:        true,
        timestamp: new Date().toISOString(),
        data: {
          ocupacion: {
            ...ocupacion,
            ...(overrides.dir_ocupacion !== undefined && { PctOcupacion: overrides.dir_ocupacion })
          },
          eficacia: {
            ...eficacia,
            ...(overrides.dir_mortalidad !== undefined && { TasaMortalidad: overrides.dir_mortalidad })
          },
          produccion: {
            ...produccion,
            ...(overrides.dir_cirugias !== undefined && { CirugiasHoy: overrides.dir_cirugias })
          },
          financiero: {
            ingresosMes: 0,
            egresosMes: financiero.CostoInsumosMes,
            margen: 0,
            costoInsumos: financiero.CostoInsumosMes
          },
          mando: {
            eficiencia: overrides.mando_eficiencia ?? null,
            eficacia: overrides.mando_eficacia ?? null,
            satisfaccion: overrides.mando_satisfaccion ?? null,
            presupuesto: overrides.mando_presupuesto ?? null,
          },
          censo: censo || []
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/area/:area',
  authenticate,
  authorizeArea(['ADMIN', 'DIRECTOR']),
  async (req, res, next) => {
    try {
      const db   = getDb();
      const area = req.areaFilter || req.params.area;

      const camas = await db.prepare(`
        SELECT
          COUNT(*) AS TotalCamas,
          SUM(CASE WHEN Estado='OCUPADA' THEN 1 ELSE 0 END) AS Ocupadas,
          ROUND(
            CAST(SUM(CASE WHEN Estado='OCUPADA' THEN 1 ELSE 0 END) AS NUMERIC)
            * 100.0 / GREATEST(COUNT(*), 1)
          , 1) AS PctOcupacion
        FROM Camas WHERE Area = ? AND Activo = 1
      `).get(area);

      const egresos = await db.prepare(`
        SELECT
          COUNT(*) AS EgresosMes,
          AVG((EXTRACT(EPOCH FROM e.FechaEgreso) - EXTRACT(EPOCH FROM a.FechaIngreso)) / 86400.0) AS EstanciaPromedio,
          ROUND(
            CAST(COUNT(*) AS NUMERIC) /
            GREATEST((SELECT COUNT(*) FROM Camas WHERE Area = ?), 1)
          , 2) AS RotacionCamas
        FROM Egresos e
        JOIN Admisiones a ON a.AdmisionId = e.AdmisionId
        WHERE e.AreaEgreso = ?
          AND e.FechaEgreso >= CURRENT_TIMESTAMP - INTERVAL '1 month'
      `).get(area, area);

      res.json({
        ok:   true,
        area,
        data: {
          camas:   camas   || {},
          egresos: egresos || {},
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

const histPath = path.join(__dirname, '../data/excel_stats_history.json');
let excelStatsHistory = {};
try {
  if (fs.existsSync(histPath)) {
    excelStatsHistory = JSON.parse(fs.readFileSync(histPath, 'utf8'));
  }
} catch (e) {
  console.error('Error al cargar excel_stats_history.json:', e.message);
}

const getExcelProportionalValue = (table, startDate, endDate) => {
  let total = 0;
  const limit = new Date('2026-03-31T23:59:59');
  if (startDate > limit) return 0;

  const targetEnd = endDate < limit ? endDate : limit;
  let current = new Date(startDate.getFullYear(), startDate.getMonth(), 1);

  let jsonKey = '';
  if (table === 'vidasSalvadas') jsonKey = '01_VIDAS SALVADAS';
  else if (table === 'nacimientos') jsonKey = '02_NACIMIENTOS';
  else if (table === 'egresos') jsonKey = '03_CUENTAS HOSPITALARIAS (HOSPITALIZACIÓN)';
  else if (table === 'estanciaDias') jsonKey = '05_ESTANCIA';

  const tableData = excelStatsHistory[jsonKey] || {};

  while (current <= targetEnd) {
    const y = current.getFullYear();
    const m = current.getMonth() + 1;
    const val = tableData[y]?.[m] || 0;

    const monthStart = new Date(y, current.getMonth(), 1);
    const monthEnd = new Date(y, current.getMonth() + 1, 0);
    const daysInMonth = monthEnd.getDate();

    const rangeStart = startDate > monthStart ? startDate : monthStart;
    const rangeEnd = targetEnd < monthEnd ? targetEnd : monthEnd;

    if (rangeStart <= rangeEnd) {
      const daysInRange = Math.round((rangeEnd - rangeStart) / (1000 * 60 * 60 * 24)) + 1;
      total += val * (daysInRange / daysInMonth);
    }

    current.setMonth(current.getMonth() + 1);
  }
  return total;
};

router.use(require('./statistics.routes'));

router.get('/kpi-config', authenticate, async (req, res, next) => {
  try {
    const db   = getDb();
    const kpis = await db.prepare(`
      SELECT ElementoId, Seccion,
             COALESCE(NombreCustom, NombreDefault) AS Nombre,
             NombreDefault, NombreCustom, Icono, PBIUrl, PBIUrl2, PBIUrl3, MultiPagina, JsonApiUrl, JsonFilePath
      FROM KPIConfig
      WHERE Activo = 1
    `).all();

    const map = {};
    for (const kpi of kpis) {
      map[kpi.ElementoId] = {
        nombre:       kpi.Nombre,
        icono:        kpi.Icono,
        pbiUrl:       kpi.PBIUrl || null,
        pbiUrl2:      kpi.PBIUrl2 || null,
        pbiUrl3:      kpi.PBIUrl3 || null,
        jsonApiUrl:   kpi.JsonApiUrl || null,
        jsonFilePath: kpi.JsonFilePath || null,
        multiPagina:  kpi.MultiPagina === 1,
        nombreDefault: kpi.NombreDefault,
        nombreCustom:  kpi.NombreCustom,
      };
    }

    res.json({ ok: true, data: map });
  } catch (err) { next(err); }
});

router.get('/financiero-nativo/cuenta/:pcNum', authenticate, authorize(['ADMIN', 'DIRECTOR']), async (req, res) => {
  try {
    const { pcNum } = req.params;

    if (isNaN(Number(pcNum)) || isNaN(parseInt(pcNum, 10))) {
      return res.json({ success: true, data: [] });
    }

    const pcNumInt = parseInt(pcNum, 10);
    let records = [];

    // Intentar buscar en PostgreSQL DW (local)
    try {
      const pgRes = await pgPool.query(`
        SELECT 
          pcitnum as "PCITNum",
          chargedate as "ChargeDate",
          sucode as "SUCode",
          itemcode as "ItemCode",
          itemdescription as "ItemDescription",
          quantity as "Quantity",
          unitprice as "UnitPrice",
          (quantity * unitprice) as "Total"
        FROM dw_vertical_pcit
        WHERE pcnum = $1
        ORDER BY chargedate ASC
      `, [pcNumInt]);
      
      records = pgRes.rows.map(row => ({
        PCITNum: Number(row.PCITNum),
        ChargeDate: row.ChargeDate,
        SUCode: row.SUCode,
        ItemCode: row.ItemCode,
        ItemDescription: row.ItemDescription,
        Quantity: Number(row.Quantity),
        UnitPrice: Number(row.UnitPrice),
        Total: Number(row.Total)
      }));
    } catch (pgErr) {
      console.warn('[PCIT pg lookup warning]', pgErr.message);
    }

    if (records.length === 0) {
      const pool = await connectRemoteDB();
      const result = await pool.request()
        .input('pcNum', pcNumInt)
        .query(`
          SELECT 
            PCITNum,
            ChargeDate,
            SUCode,
            ItemCode,
            ItemDescription,
            Quantity,
            UnitPrice,
            (Quantity * UnitPrice) as Total
          FROM PCIT
          WHERE PCNum = @pcNum
          ORDER BY ChargeDate ASC
        `);
      records = result.recordset;
    }

    const missingDescItems = [...new Set(records.filter(r => !r.ItemDescription && r.ItemCode).map(r => r.ItemCode))];
    
    if (missingDescItems.length > 0) {
      const sapDescriptions = {};

      const chunkSize = 20;
      for (let i = 0; i < missingDescItems.length; i += chunkSize) {
        const chunk = missingDescItems.slice(i, i + chunkSize);
        const filterStr = chunk.map(code => `ItemCode eq '${code}'`).join(' or ');
        
        try {
          const sapRes = await sapService.get(`/Items?$filter=${encodeURIComponent(filterStr)}&$select=ItemCode,ItemName`);
          if (sapRes && sapRes.data && sapRes.data.value) {
            sapRes.data.value.forEach(item => {
              sapDescriptions[item.ItemCode] = item.ItemName;
            });
          }
        } catch (e) {
           
        }
      }

      records.forEach(r => {
        if (!r.ItemDescription && sapDescriptions[r.ItemCode]) {
          r.ItemDescription = sapDescriptions[r.ItemCode];
        }
      });
    }

    res.json({ success: true, data: records });
  } catch (err) {
    console.error('Error fetching cuenta details:', err);
    res.status(500).json({ success: false, error: 'Error al obtener detalles de la cuenta.' });
  }
});

router.get('/financiero-nativo', authenticate, authorize(['ADMIN', 'DIRECTOR']), async (req, res, next) => {
  try {
    let { startDate, endDate, search } = req.query;
    if (endDate && endDate.length === 10) endDate += ' 23:59:59';

    const MIN_DATE = '2026-04-01';

    if (endDate && endDate < MIN_DATE) {
      return res.json({
        success: true,
        data: {
          kpis: { ingresosAcumulados: 0, costosAcumulados: 0, utilidadAcumulada: 0, margenPromedio: 0, cuentasPorCobrar: 0 },
          tendenciaMensual: [],
          listaCuentas: [],
          carteraCobranza: [],
          audit: { totalCrudo: 0, valido: 0, motivos: {}, outliersEncontrados: 0 }
        }
      });
    }

    const effectiveStartDate = !startDate ? MIN_DATE : (startDate < MIN_DATE ? MIN_DATE : startDate);
    const effectiveEndDate = endDate || new Date().toISOString().split('T')[0] + ' 23:59:59';

    const split = splitDateRange(effectiveStartDate, effectiveEndDate);
    let rawData = [];

    // Obtener histórico desde PostgreSQL local
    if (split.pgStart && split.pgEnd) {
      let pgWhere = ["c.entrydate >= $1", "c.entrydate <= $2"];
      let params = [split.pgStart, split.pgEnd + ' 23:59:59'];
      
      if (search) {
        pgWhere.push("(p.fullname ILIKE $3 OR CAST(c.pcnum AS VARCHAR) ILIKE $3)");
        params.push(`%${search}%`);
      }
      
      const pgRes = await pgPool.query(`
        SELECT 
          c.pcnum as "PCNum",
          c.pc_st as "PC_ST",
          c.medicaldischargedate as "MedicalDischargeDate",
          c.entrydate as "EntryDate",
          c.total as "Total",
          c.profit as "Profit",
          c.subtotalcost as "SubtotalCost",
          c.balance as "Balance",
          c.downpayments as "Downpayments",
          p.fullname as "FullName"
        FROM dw_vertical_pc c
        LEFT JOIN dw_vertical_pt p ON c.ptnum = p.ptnum
        WHERE ${pgWhere.join(' AND ')}
      `, params);
      
      rawData = rawData.concat(pgRes.rows.map(row => ({
        PCNum: Number(row.PCNum),
        PC_ST: row.PC_ST,
        MedicalDischargeDate: row.MedicalDischargeDate,
        EntryDate: row.EntryDate,
        Total: Number(row.Total || 0),
        Profit: Number(row.Profit || 0),
        SubtotalCost: Number(row.SubtotalCost || 0),
        Balance: Number(row.Balance || 0),
        Downpayments: Number(row.Downpayments || 0),
        FullName: row.FullName
      })));
    }

    if (split.hasToday && split.remoteStart) {
      const pool = await connectRemoteDB();
      const request = pool.request();
      
      let whereClauses = ["PC.Date >= @startDate", "PC.Date <= @endDate"];
      request.input('startDate', split.remoteStart);
      request.input('endDate', split.remoteEnd || new Date());
      
      if (search) {
        whereClauses.push("(PT.FullName LIKE @search OR CAST(PC.PCNum AS VARCHAR) LIKE @search)");
        request.input('search', `%${search}%`);
      }

      const queryStr = `
        SELECT 
          PC.PCNum,
          PC.PC_ST,
          PC.MedicalDischargeDate,
          PC.Date as EntryDate,
          PC.Total,
          PC.Profit,
          PC.SubtotalCost,
          PC.Balance,
          PC.Downpayments,
          PT.FullName
        FROM PC
        LEFT JOIN PT ON PC.PTNum = PT.PTNum
        WHERE ${whereClauses.join(' AND ')}
      `;
      
      const result = await request.query(queryStr);
      rawData = rawData.concat(result.recordset.map(row => ({
        PCNum: Number(row.PCNum),
        PC_ST: row.PC_ST,
        MedicalDischargeDate: row.MedicalDischargeDate,
        EntryDate: row.EntryDate,
        Total: Number(row.Total || 0),
        Profit: Number(row.Profit || 0),
        SubtotalCost: Number(row.SubtotalCost || 0),
        Balance: Number(row.Balance || 0),
        Downpayments: Number(row.Downpayments || 0),
        FullName: row.FullName
      })));
    }
    const audit = {
      totalCrudo: rawData.length,
      valido: 0,
      motivos: {
        noFinalizada: 0,
        cerosONegativos: 0,
        pacientePrueba: 0,
        fechasIncoherentes: 0
      },
      outliersEncontrados: 0
    };

    let validRecords = [];

    // Depuración (Reglas de Negocio)
    rawData.forEach(row => {
      const isTest = row.FullName && (row.FullName.toUpperCase().includes('TEST') || row.FullName.toUpperCase().includes('PRUEBA'));
      const isClosed = row.PC_ST === 'CL';  
      const isPositive = (Number(row.Balance) > 0);  
      const isDateValid = row.MedicalDischargeDate && new Date(row.MedicalDischargeDate) >= new Date(row.EntryDate) && new Date(row.MedicalDischargeDate) <= new Date();

      if (isTest) {
        audit.motivos.pacientePrueba++;
      } else if (!isClosed) {
        audit.motivos.noFinalizada++;
      } else if (!isPositive) {
        audit.motivos.cerosONegativos++;
      } else if (!isDateValid) {
        audit.motivos.fechasIncoherentes++;
      } else {
        const totalAccount = Number(row.Balance);
        const cost = Number(row.SubtotalCost || 0);
        const profit = totalAccount - cost;
        const pendingBalance = Math.max(0, Number(row.Total || 0));
        const paid = Math.max(0, totalAccount - pendingBalance);
        const profitMargin = totalAccount > 0 ? (profit / totalAccount) * 100 : 0;

        row.TotalAccount = totalAccount;
        row.SubtotalCost = cost;
        row.Profit = profit;
        row.ProfitMargin = profitMargin;
        row.Paid = paid;
        row.PendingBalance = pendingBalance;

        validRecords.push(row);
      }
    });

    audit.valido = validRecords.length;

    // Agrupación por Mes y Detección de Outliers (IQR)
    let dataByMonth = {};
    validRecords.forEach(row => {
      let d = new Date(row.MedicalDischargeDate);
      let month = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      
      if (!dataByMonth[month]) {
        dataByMonth[month] = { records: [], Ingresos: 0, Utilidad: 0, Costos: 0, Balance: 0, Cobrado: 0, outliersCount: 0 };
      }
      dataByMonth[month].records.push(row);
    });

    Object.keys(dataByMonth).forEach(month => {
      const mData = dataByMonth[month];
      const totals = mData.records.map(r => r.TotalAccount).sort((a,b) => a-b);

      if (totals.length >= 4) {
        const q1 = totals[Math.floor(totals.length * 0.25)];
        const q3 = totals[Math.floor(totals.length * 0.75)];
        const iqr = q3 - q1;
        const upperLimit = q3 + 1.5 * iqr;
        
        mData.records.forEach(r => {
          if (r.TotalAccount > upperLimit) mData.outliersCount++;
        });
      }

      audit.outliersEncontrados += mData.outliersCount;

      mData.records.forEach(r => {
        mData.Ingresos += r.TotalAccount || 0;
        mData.Utilidad += r.Profit || 0;
        mData.Costos += r.SubtotalCost || 0;
        mData.Balance += r.PendingBalance || 0;
        mData.Cobrado += r.Paid || 0;
      });
    });

    // Crear arreglo de serie temporal
    let tendenciaMensual = Object.keys(dataByMonth).sort().map(month => ({
      month,
      Ingresos: dataByMonth[month].Ingresos,
      Utilidad: dataByMonth[month].Utilidad,
      Costos: dataByMonth[month].Costos,
      isPrediction: false
    }));

    // Modelo Predictivo: Regresión Lineal Simple (Proyectar 3 meses)
    if (tendenciaMensual.length >= 3) {
      const n = tendenciaMensual.length;
      let sumX = 0, sumY_ing = 0, sumY_ut = 0, sumXY_ing = 0, sumXY_ut = 0, sumX2 = 0;
      
      tendenciaMensual.forEach((m, i) => {
        sumX += i;
        sumY_ing += m.Ingresos;
        sumY_ut += m.Utilidad;
        sumXY_ing += i * m.Ingresos;
        sumXY_ut += i * m.Utilidad;
        sumX2 += i * i;
      });

      const denominator = (n * sumX2 - sumX * sumX);
      if (denominator !== 0) {
        const slope_ing = (n * sumXY_ing - sumX * sumY_ing) / denominator;
        const intercept_ing = (sumY_ing - slope_ing * sumX) / n;
        
        const slope_ut = (n * sumXY_ut - sumX * sumY_ut) / denominator;
        const intercept_ut = (sumY_ut - slope_ut * sumX) / n;

        const lastMonthStr = tendenciaMensual[tendenciaMensual.length - 1].month;
        const lastDate = new Date(lastMonthStr + '-01T12:00:00Z');

        for (let j = 1; j <= 3; j++) {
          let nextDate = new Date(lastDate);
          nextDate.setUTCMonth(nextDate.getUTCMonth() + j);
          let nextMonth = nextDate.getUTCFullYear() + '-' + String(nextDate.getUTCMonth() + 1).padStart(2, '0');
          let index = n - 1 + j;
          
          let predictedIngresos = slope_ing * index + intercept_ing;
          let predictedUtilidad = slope_ut * index + intercept_ut;
          
          tendenciaMensual.push({
            month: nextMonth,
            IngresosProyectados: Math.max(0, predictedIngresos),
            UtilidadProyectada: Math.max(0, predictedUtilidad),
            Costos: null, 
            isPrediction: true
          });
        }
      }
    }

    try {
      const mlRes = await pgPool.query("SELECT periodo_predicho, ingreso_estimado FROM ml_forecast_ingresos_mensual WHERE area = 'GENERAL' AND servicio = 'TODOS'");
      if (mlRes.rows.length > 0) {
        mlRes.rows.forEach(mlRow => {
          const mlMonth = mlRow.periodo_predicho;
          const mlIngreso = Number(mlRow.ingreso_estimado);
          
          let existingPrediction = tendenciaMensual.find(m => m.month === mlMonth);
          if (existingPrediction) {
            existingPrediction.IngresosProyectados = mlIngreso;
            existingPrediction.isML = true;  
          }
        });
      }
    } catch(err) {
      console.error('[Dashboard] Error al mezclar ML forecast con dashboard financiero-nativo:', err);
    }

    let totalIng = 0, totalUt = 0, totalCuentas = 0, totalCostos = 0, totalCobrado = 0;
    Object.keys(dataByMonth).forEach(m => {
      totalIng += dataByMonth[m].Ingresos;
      totalUt += dataByMonth[m].Utilidad;
      totalCuentas += dataByMonth[m].Balance;
      totalCostos += dataByMonth[m].Costos;
      totalCobrado += dataByMonth[m].Cobrado;
    });

    // Cartera de Cobranza (Aging)
    const carteraCobranza = {
      '0-30 días': 0,
      '31-60 días': 0,
      '61-90 días': 0,
      '90+ días': 0
    };
    const carteraCobranzaDetalle = {
      '0-30 días': [],
      '31-60 días': [],
      '61-90 días': [],
      '90+ días': []
    };

    const now = Date.now();
    validRecords.forEach(row => {
      if (row.PendingBalance > 0) {
        const dateToUse = row.MedicalDischargeDate ? new Date(row.MedicalDischargeDate) : new Date(row.EntryDate);
        const diffDays = Math.floor((now - dateToUse.getTime()) / (1000 * 60 * 60 * 24));
        
        let bucket = '90+ días';
        if (diffDays <= 30) bucket = '0-30 días';
        else if (diffDays <= 60) bucket = '31-60 días';
        else if (diffDays <= 90) bucket = '61-90 días';

        carteraCobranza[bucket] += row.PendingBalance;
        carteraCobranzaDetalle[bucket].push(row);
      }
    });

    Object.keys(carteraCobranzaDetalle).forEach(bucket => {
      carteraCobranzaDetalle[bucket].sort((a,b) => b.PendingBalance - a.PendingBalance);
      carteraCobranzaDetalle[bucket] = carteraCobranzaDetalle[bucket].slice(0, 50);
    });

    const listaCuentas = validRecords
      .sort((a,b) => new Date(b.MedicalDischargeDate || b.EntryDate) - new Date(a.MedicalDischargeDate || a.EntryDate))
      .slice(0, 100);

    res.json({
      ok: true,
      data: {
        tendenciaMensual,
        listaCuentas,
        carteraCobranza,
        carteraCobranzaDetalle,
        kpis: {
          ingresosAcumulados: totalIng,
          costosAcumulados: totalCostos,
          utilidadAcumulada: totalUt,
          cuentasPorCobrar: totalCuentas,
          cobranzaRealizada: totalCobrado,
          margenPromedio: totalIng > 0 ? (totalUt / totalIng) * 100 : 0
        },
        audit
      }
    });
  } catch (err) {
    console.error('Error Pipeline DQ SQL:', err);
    res.status(500).json({ ok: false, error: "No se pudo preparar la información. Intenta de nuevo." });
  }
});

router.get('/eficiencia-nativo', authenticate, authorize(['ADMIN', 'DIRECTOR']), async (req, res, next) => {
  try {
    let { startDate, endDate } = req.query;
    if (endDate && endDate.length === 10) endDate += ' 23:59:59';

    let whereClauses = ["1=1"];
    let params = [];
    let paramIndex = 1;

    if (startDate) {
      whereClauses.push(`fechaperiodo >= $${paramIndex++}`);
      params.push(startDate);
    }
    if (endDate) {
      whereClauses.push(`fechaperiodo <= $${paramIndex++}`);
      params.push(endDate);
    }

    const queryStr = `
      SELECT 
        anio as "Anio", mes as "Mes",
        TO_CHAR(fechaperiodo, 'YYYY-MM') AS "monthStr",
        camasocupadas as "CamasOcupadas", quirofanosactivos as "QuirofanosActivos", 
        urgencias as "Urgencias", hospitalizacion as "Hospitalizacion",
        triajemin as "TriajeMin", triajemeta as "TriajeMeta", triajeoutliers as "TriajeOutliers",
        laboratoriomin as "LaboratorioMin", laboratoriometa as "LaboratorioMeta", laboratoriooutliers as "LaboratorioOutliers",
        imagenologiamin as "ImagenologiaMin", imagenologiameta as "ImagenologiaMeta", imagenologiaoutliers as "ImagenologiaOutliers",
        egresohoras as "EgresoHoras", egresometa as "EgresoMeta",
        estadotriaje as "EstadoTriaje", estadolaboratorio as "EstadoLaboratorio", estadoimagenologia as "EstadoImagenologia", estadoegreso as "EstadoEgreso"
      FROM dw_vertical_indicadores_operativos
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY fechaperiodo DESC
      ${(!startDate && !endDate) ? 'LIMIT 6' : ''}
    `;

    const pgRes = await pgPool.query(queryStr, params);
    
    // Invertir para que el orden cronológico sea ASC
    const data = pgRes.rows.map(row => ({
      Anio: Number(row.Anio),
      Mes: Number(row.Mes),
      monthStr: row.monthStr,
      CamasOcupadas: Number(row.CamasOcupadas),
      QuirofanosActivos: Number(row.QuirofanosActivos),
      Urgencias: Number(row.Urgencias),
      Hospitalizacion: Number(row.Hospitalizacion),
      TriajeMin: Number(row.TriajeMin),
      TriajeMeta: Number(row.TriajeMeta),
      TriajeOutliers: Number(row.TriajeOutliers),
      LaboratorioMin: Number(row.LaboratorioMin),
      LaboratorioMeta: Number(row.LaboratorioMeta),
      LaboratorioOutliers: Number(row.LaboratorioOutliers),
      ImagenologiaMin: Number(row.ImagenologiaMin),
      ImagenologiaMeta: Number(row.ImagenologiaMeta),
      ImagenologiaOutliers: Number(row.ImagenologiaOutliers),
      EgresoHoras: Number(row.EgresoHoras),
      EgresoMeta: Number(row.EgresoMeta),
      EstadoTriaje: row.EstadoTriaje,
      EstadoLaboratorio: row.EstadoLaboratorio,
      EstadoImagenologia: row.EstadoImagenologia,
      EstadoEgreso: row.EstadoEgreso
    })).reverse();

    let totalCamas = 0, totalQuirofanos = 0, totalUrgencias = 0, totalHospitalizacion = 0;
    data.forEach(d => {
      totalCamas += d.CamasOcupadas || 0;
      totalQuirofanos += d.QuirofanosActivos || 0;
      totalUrgencias += d.Urgencias || 0;
      totalHospitalizacion += d.Hospitalizacion || 0;
    });

    const kpis = {
      camasOcupadas: data.length ? Math.round(totalCamas / data.length) : 0,
      quirofanosactivos: data.length ? Math.round(totalQuirofanos / data.length) : 0,
      urgencias: totalUrgencias,
      hospitalizacion: totalHospitalizacion
    };

    res.json({
      ok: true,
      data: {
        tendenciaMensual: data,
        kpis
      }
    });
  } catch (err) {
    console.error('Error consultando Eficiencia Operativa:', err);
    res.status(500).json({ ok: false, error: 'Error al consultar indicadores de eficiencia.' });
  }
});

router.get('/censo-camas', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res, next) => {
  try {
     
    const bedsResult = await pgPool.query(`
      SELECT DISTINCT roomcode as "RoomCode", roomname as "RoomName" 
      FROM dw_vertical_pt 
      WHERE (roomname LIKE '%CAMA%' OR roomcode LIKE 'CUBUTI%') 
        AND roomname IS NOT NULL
        AND roomname NOT LIKE '%VIRTUAL%'
        AND roomname NOT LIKE '%VIRT%'
        AND roomcode NOT LIKE '%VIRT%'
    `);
    const allBeds = bedsResult.rows;

    const mssqlPool = await connectRemoteDB();
    const occupiedResult = await mssqlPool.request().query(`
      SELECT 
        v.RoomCode, 
        pt.FullName AS Paciente, 
        pr.FullName AS Medico
      FROM PC pc
      INNER JOIN PT pt ON pc.PTNum = pt.PTNum
      LEFT JOIN PR pr ON pc.PRNum = pr.PRNum
      OUTER APPLY (
        SELECT TOP 1 
          pcfr.FRCode AS RoomCode,
          pcfr.FRName AS RoomName
        FROM PCFR pcfr
        WHERE pcfr.PCNum = pc.PCNum
          AND pcfr.PCFR_ST = 'AS'
          AND pcfr.ExitDate IS NULL
        ORDER BY pcfr.EntryDate DESC, pcfr.PCFRNum DESC
      ) v
      WHERE pc.PC_ST = 'OP' 
        AND pc.PCType IN ('IP', 'ER')
        AND pc.MedicalDischargeDate IS NULL
        AND v.RoomCode IS NOT NULL
        AND v.RoomName NOT LIKE '%VIRTUAL%'
        AND v.RoomName NOT LIKE '%VIRT%'
        AND v.RoomCode NOT LIKE '%VIRT%'
    `);
    const occupied = occupiedResult.recordset;

    // Cruzar datos
    const bedsMap = {};
    allBeds.forEach(b => {
      bedsMap[b.RoomCode] = { RoomCode: b.RoomCode, RoomName: b.RoomName, Estado: 'LIBRE', Paciente: null, Medico: null };
    });

    occupied.forEach(o => {
      if (bedsMap[o.RoomCode]) {
        bedsMap[o.RoomCode].Estado = 'OCUPADA';
        bedsMap[o.RoomCode].Paciente = o.Paciente;
        bedsMap[o.RoomCode].Medico = o.Medico;
      } else {
        // Cama encontrada pero no capturada por el filtro inicial
        bedsMap[o.RoomCode] = { 
          RoomCode: o.RoomCode, 
          RoomName: o.RoomCode, 
          Estado: 'OCUPADA', 
          Paciente: o.Paciente, 
          Medico: o.Medico 
        };
      }
    });

    // Ordenar alfabéticamente
    const finalBeds = Object.values(bedsMap).sort((a,b) => (a.RoomName || '').localeCompare(b.RoomName || ''));

    // Estadísticas
    const total = finalBeds.length;
    const ocupadas = finalBeds.filter(b => b.Estado === 'OCUPADA').length;
    const libres = finalBeds.filter(b => b.Estado === 'LIBRE').length;

    res.json({
      ok: true,
      data: {
        camas: finalBeds,
        resumen: { total, ocupadas, libres }
      }
    });
  } catch (err) {
    console.error('Error consultando censo de camas:', err);
    res.status(500).json({ ok: false, error: 'Error obteniendo censo en tiempo real.' });
  }
});

router.get('/urgencias-nativo', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res, next) => {
  try {
    let { startDate, endDate, search } = req.query;
    
    if (startDate === 'undefined' || startDate === 'null' || startDate === '') startDate = null;
    if (endDate === 'undefined' || endDate === 'null' || endDate === '') endDate = null;
    if (search === 'undefined' || search === 'null' || search === '') search = null;
    
    const cacheKey = `urgencias:${startDate || ''}:${endDate || ''}:${search || ''}`;
    if (req.query.nocache !== '1') {
      const cached = dashboardCache.get(cacheKey);
      if (cached) return res.json(cached);
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const effectiveStartDate = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const effectiveEndDate = endDate || todayStr + ' 23:59:59';

    const split = splitDateRange(effectiveStartDate, effectiveEndDate);

    // Obtener ingresos de servicios (sapData)
    const fetchSapData = async () => {
      let sapRows = [];
      if (split.pgStart && split.pgEnd) {
        const pgRes = await pgPool.query(`
          SELECT 
            medico_solicitante as "Medico_Solicitante",
            medico_tratante as "Medico_Tratante",
            descripcion_del_articulo as "DESCRIPCION_DEL_ARTICULO",
            total_cobrado as "TOTAL_COBRADO"
          FROM dw_vertical_cuentas_servicios
          WHERE unidad_de_servicio IN ('URG1', 'URG2')
            AND fecha_de_cargo >= $1 AND fecha_de_cargo <= $2
        `, [split.pgStart, split.pgEnd + ' 23:59:59']);
        
        sapRows = sapRows.concat(pgRes.rows.map(row => ({
          Medico_Solicitante: row.Medico_Solicitante,
          Medico_Tratante: row.Medico_Tratante,
          DESCRIPCION_DEL_ARTICULO: row.DESCRIPCION_DEL_ARTICULO,
          TOTAL_COBRADO: Number(row.TOTAL_COBRADO)
        })));
      }
      if (split.hasToday && split.remoteStart) {
        const mssqlPool = await connectRemoteDB();
        const request = mssqlPool.request();
        let whereSAP = ["UNIDAD_DE_SERVICIO IN ('URG1', 'URG2')", "FECHA_DE_CARGO >= @startDate", "FECHA_DE_CARGO <= @endDate"];
        request.input('startDate', split.remoteStart);
        request.input('endDate', split.remoteEnd || new Date());
        
        const mssqlRes = await request.query(`
          SELECT Medico_Solicitante, Medico_Tratante, DESCRIPCION_DEL_ARTICULO, TOTAL_COBRADO
          FROM UDR_CUENTAS_SERVICIOS
          WHERE ${whereSAP.join(' AND ')}
        `);
        sapRows = sapRows.concat(mssqlRes.recordset);
      }
      return sapRows;
    };

    // Cruce con SAP Contabilidad Oficial
    const fetchSapIngresos = async () => {
      let total = 0;
      if (split.pgStart && split.pgEnd) {
        const pgSapRes = await pgPool.query(`
          SELECT SUM(total) as total
          FROM dw_sap_ingresos_grupos
          WHERE itmsgrpcod = 104 AND docdate >= $1 AND docdate <= $2
        `, [split.pgStart, split.pgEnd]);
        total += Number(pgSapRes.rows[0]?.total || 0);
      }
      if (split.hasToday && split.remoteStart) {
        try {
          const sdStr = split.remoteStart.substring(0, 10);
          const edStr = (split.remoteEnd || todayStr).substring(0, 10);
          const sapSLRes = await sapService.fetchAllPages(`/SQLQueries('sq_ingresos_grupos')/List?startDate='${sdStr}'&endDate='${edStr}'`);
          if (sapSLRes && sapSLRes.length > 0) {
            const todayTotal = sapSLRes
              .filter(row => row.ItmsGrpCod === 104)  
              .reduce((acc, row) => acc + (row.Total || 0), 0);
            total += todayTotal;
          }
        } catch (e) {
          console.error('[SAP] Error al consultar ingresos contabilizados para Urgencias hoy:', e.message);
        }
      }
      return total;
    };

    // Obtener datos detallados
    const fetchDetailedData = async () => {
      let list = [];
      if (split.pgStart && split.pgEnd) {
        let pgWhere = ["pc.pctype = 'ER'", "pc.entrydate >= $1", "pc.entrydate <= $2"];
        let params = [split.pgStart, split.pgEnd + ' 23:59:59'];
        if (search) {
          pgWhere.push("(pc.pcnum = $3 OR pt.fullname ILIKE $4)");
          params.push(parseInt(search) || 0, `%${search}%`);
        }
        
        const pgRes = await pgPool.query(`
          SELECT 
            pc.pcnum as "PCNum",
            pc.entrydate as "Ingreso",
            pc.medicaldischargedate as "Egreso",
            pc.pc_st as "Estatus",
            pt.fullname as "Paciente",
            EXTRACT(EPOCH FROM (pc.medicaldischargedate - pc.entrydate))/60 as "MinutosEstancia"
          FROM dw_vertical_pc pc
          LEFT JOIN dw_vertical_pt pt ON pc.ptnum = pt.ptnum
          WHERE ${pgWhere.join(' AND ')}
          ORDER BY pc.entrydate DESC
          LIMIT 500
        `, params);
        
        list = list.concat(pgRes.rows.map(row => ({
          PCNum: Number(row.PCNum),
          Ingreso: row.Ingreso,
          Egreso: row.Egreso,
          Estatus: row.Estatus,
          Paciente: row.Paciente,
          MinutosEstancia: row.MinutosEstancia ? Math.round(Number(row.MinutosEstancia)) : null
        })));
      }
      if (split.hasToday && split.remoteStart) {
        const mssqlPool = await connectRemoteDB();
        const request = mssqlPool.request();
        let whereClauses = ["PC.PCType = 'ER'", "PC.Date >= @startDate", "PC.Date <= @endDate"];
        request.input('startDate', split.remoteStart);
        request.input('endDate', split.remoteEnd || new Date());
        
        if (search) {
          whereClauses.push("(PC.PCNum LIKE @search OR PC.PTNum IN (SELECT PTNum FROM PT WHERE FullName LIKE @search))");
          request.input('search', `%${search}%`);
        }

        const mssqlRes = await request.query(`
          SELECT TOP 500
            PC.PCNum,
            PC.Date as Ingreso,
            PC.MedicalDischargeDate as Egreso,
            PC.PC_ST as Estatus,
            PT.FullName as Paciente,
            DATEDIFF(minute, PC.Date, PC.MedicalDischargeDate) as MinutosEstancia
          FROM PC
          LEFT JOIN PT ON PC.PTNum = PT.PTNum
          WHERE ${whereClauses.join(' AND ')}
          ORDER BY PC.Date DESC
        `);
        list = list.concat(mssqlRes.recordset);
      }
      return list;
    };

    const fetchCensoCamas = async () => {
      let censo = [];
      try {
        const mssqlPool = await connectRemoteDB();
        const [liveBedsRes, masterBedsRes] = await Promise.all([
          mssqlPool.request().query(`
            SELECT DISTINCT
              v.RoomCode, 
              v.RoomName,
              pt.FullName AS Paciente, 
              pr.FullName AS Medico,
              pc.Date AS FechaIngreso,
              pc.PCNum AS PCNum
            FROM PC pc
            INNER JOIN PT pt ON pc.PTNum = pt.PTNum
            LEFT JOIN PR pr ON pc.PRNum = pr.PRNum
            OUTER APPLY (
              SELECT TOP 1 
                pcfr.FRCode AS RoomCode,
                pcfr.FRName AS RoomName
              FROM PCFR pcfr
              WHERE pcfr.PCNum = pc.PCNum
                AND pcfr.PCFR_ST = 'AS'
                AND pcfr.ExitDate IS NULL
              ORDER BY pcfr.EntryDate DESC, pcfr.PCFRNum DESC
            ) v
            WHERE pc.PC_ST = 'OP' 
              AND pc.PCType = 'ER'
              AND pc.MedicalDischargeDate IS NULL
              AND (v.RoomName LIKE '%URGENCIAS 1%' OR v.RoomName LIKE '%URGENCIAS 2%')
              AND v.RoomName NOT LIKE '%VIRTUAL%'
              AND v.RoomName NOT LIKE '%VIRT%'
              AND v.RoomCode NOT LIKE '%VIRT%'
          `),
          pgPool.query(`
            SELECT DISTINCT roomcode as "RoomCode", roomname as "RoomName"
            FROM dw_vertical_pt
            WHERE (roomname LIKE '%URGENCIAS 1%' OR roomname LIKE '%URGENCIAS 2%')
              AND roomname NOT LIKE '%VIRTUAL%'
            ORDER BY roomcode ASC
          `)
        ]);

        let occupiedBeds = liveBedsRes.recordset || [];
        let activeChargesMap = {};
        if (occupiedBeds.length > 0) {
          const activeFolios = occupiedBeds.map(o => o.PCNum).filter(Boolean);
          if (activeFolios.length > 0) {
            const activeChargesRes = await pgPool.query(`
              SELECT folio_de_atencion as folio, SUM(total_cobrado)::float as total_cargos
              FROM dw_vertical_cuentas_servicios
              WHERE folio_de_atencion = ANY($1)
              GROUP BY folio_de_atencion
            `, [activeFolios]);
            activeChargesRes.rows.forEach(r => {
              activeChargesMap[r.folio] = r.total_cargos;
            });
          }
        }

        const bedsMap = {};
        masterBedsRes.rows.forEach(b => {
          bedsMap[b.RoomCode] = { 
            RoomCode: b.RoomCode, RoomName: b.RoomName, Estado: 'LIBRE', 
            Paciente: null, Medico: null, FechaIngreso: null, PCNum: null, totalCargos: 0
          };
        });

        occupiedBeds.forEach(o => {
          const code = o.RoomCode ? o.RoomCode.trim() : null;
          if (code) {
            if (!bedsMap[code]) {
              bedsMap[code] = {
                RoomCode: code, RoomName: o.RoomName || code, Estado: 'LIBRE',
                Paciente: null, Medico: null, FechaIngreso: null, PCNum: null, totalCargos: 0
              };
            }
            bedsMap[code] = {
              ...bedsMap[code],
              Estado: 'OCUPADA', Paciente: o.Paciente, Medico: o.Medico,
              FechaIngreso: o.FechaIngreso, PCNum: o.PCNum,
              totalCargos: activeChargesMap[o.PCNum] || 0
            };
          }
        });
        censo = Object.values(bedsMap).sort((a,b) => a.RoomCode.localeCompare(b.RoomCode));
      } catch (e) {
        console.error('[SAP/Vertical] Error al consultar camas Urgencias en vivo:', e.message);
      }
      return censo;
    };

    // Ejecutar todas las consultas en paralelo
    const [sapData, ingresosSAPTotales, data, censoCamas] = await Promise.all([
      fetchSapData(),
      fetchSapIngresos(),
      fetchDetailedData(),
      fetchCensoCamas()
    ]);

    const ingresosTotales = sapData.reduce((acc, curr) => acc + (curr.TOTAL_COBRADO || 0), 0);

    // Top Médicos
    const medicosMap = {};
    sapData.forEach(d => {
      const med = d.Medico_Solicitante || d.Medico_Tratante || 'NO ESPECIFICADO';
      if (med !== 'NO ESPECIFICADO' && med !== 'EXTERNO EXTERNO') {
        medicosMap[med] = (medicosMap[med] || 0) + (d.TOTAL_COBRADO || 0);
      }
    });
    const topMedicos = Object.keys(medicosMap)
      .map(k => ({ nombre: k, ingresos: medicosMap[k] }))
      .sort((a, b) => b.ingresos - a.ingresos)
      .slice(0, 10);

    // Top Servicios
    const serviciosMap = {};
    sapData.forEach(d => {
      const srv = d.DESCRIPCION_DEL_ARTICULO || 'Desconocido';
      serviciosMap[srv] = (serviciosMap[srv] || 0) + (d.TOTAL_COBRADO || 0);
    });
    const topServicios = Object.keys(serviciosMap)
      .map(k => ({ nombre: k, ingresos: serviciosMap[k] }))
      .sort((a, b) => b.ingresos - a.ingresos)
      .slice(0, 10);

    const atenciones = data.length;
    const egresos = data.filter(d => d.Estatus === 'CL' && d.Egreso).length;

    const estanciasValidas = data.filter(d => d.MinutosEstancia > 0);
    const minutosPromedio = estanciasValidas.length > 0 
      ? estanciasValidas.reduce((acc, curr) => acc + curr.MinutosEstancia, 0) / estanciasValidas.length 
      : 0;
    const horasPromedio = (minutosPromedio / 60).toFixed(1);

    // Rotación (Pacientes por día aprox)
    const diasUnicos = new Set(data.map(d => d.Ingreso ? d.Ingreso.toISOString().substring(0,10) : null).filter(Boolean)).size;
    const rotacion = diasUnicos > 0 ? (atenciones / diasUnicos).toFixed(1) : 0;

    // Gráfica: Llegadas por fecha
    const tendenciaAgrupada = {};
    data.forEach(d => {
      if (!d.Ingreso) return;
      const dateStr = d.Ingreso.toISOString().substring(0, 10);
      tendenciaAgrupada[dateStr] = (tendenciaAgrupada[dateStr] || 0) + 1;
    });
    
    // Gráfica: Estatus
    const estatusAgrupado = {};
    data.forEach(d => {
      const e = d.Estatus === 'CL' ? 'Alta (Cerrada)' : (d.Estatus === 'OP' ? 'En Piso (Abierta)' : d.Estatus);
      estatusAgrupado[e] = (estatusAgrupado[e] || 0) + 1;
    });

    const formatArr = (obj) => Object.keys(obj).sort().map(k => ({ nombre: k, valor: obj[k] }));

    const responsePayload = {
      ok: true,
      data: {
        kpis: {
          atenciones,
          egresos,
          estanciaHoras: horasPromedio,
          rotacion,
          ingresosTotales
        },
        censoCamas,
        kpisFinancieros: {
          ingresosTotales,
          ingresosSAP: ingresosSAPTotales
        },
        tendencia: formatArr(tendenciaAgrupada),
        estatus: formatArr(estatusAgrupado),
        topMedicos,
        topServicios,
        lista: data.map(d => ({
          ...d,
          IngresoFormat: d.Ingreso ? new Date(d.Ingreso).toLocaleString('es-MX') : 'N/A',
          EgresoFormat: d.Egreso ? new Date(d.Egreso).toLocaleString('es-MX') : 'N/A'
        }))
      }
    };

    dashboardCache.set(cacheKey, responsePayload, 60);
    res.json(responsePayload);

  } catch (err) {
    console.error('Error consultando Urgencias:', err);
    res.status(500).json({ ok: false, error: 'Error obteniendo datos de urgencias.' });
  }
});

router.get('/eficacia-nativo', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res, next) => {
  try {
    let { startDate, endDate, search, especialidad } = req.query;
    if (endDate && endDate.length === 10) endDate += ' 23:59:59';

    const todayStr = hospitalToday();
    const effectiveStartDate = startDate || addDays(todayStr, -30);
    const effectiveEndDate = endDate || todayStr + ' 23:59:59';
    const { getDashboardSyncStatus } = require('../services/dashboardSync.service');
    const [productivityState, consultationState] = await Promise.all([
      getDashboardSyncStatus('productividad').catch(() => null),
      getDashboardSyncStatus('consulta').catch(() => null),
    ]);
    const dailyProductivity = Number(productivityState?.modelVersion) >= 2;

    const split = { pgStart: effectiveStartDate, pgEnd: effectiveEndDate };

    let prodData = [];
    
    // Histórico de PostgreSQL
    if (split.pgStart && split.pgEnd && dailyProductivity) {
      let pgWhere = ["fecha >= $1", "fecha <= $2"];
      let params = [split.pgStart, split.pgEnd];
      let paramIndex = 3;
      
      if (search) {
        pgWhere.push(`medico ILIKE $${paramIndex++}`);
        params.push(`%${search}%`);
      }
      if (especialidad) {
        pgWhere.push(`especialidad = $${paramIndex++}`);
        params.push(especialidad);
      }
      
      const pgRes = await pgPool.query(`
        SELECT medico as "Medico", especialidad as "Especialidad", fecha as "Fecha", 
               primeras as "Primeras", subsecuentes as "Subsecuentes", totalatenciones as "TotalAtenciones"
        FROM dw_vertical_productividad_medicos
        WHERE ${pgWhere.join(' AND ')}
      `, params);
      
      prodData = prodData.concat(pgRes.rows.map(r => ({
        Medico: r.Medico,
        Especialidad: r.Especialidad,
        Fecha: r.Fecha,
        Primeras: Number(r.Primeras),
        Subsecuentes: Number(r.Subsecuentes),
        TotalAtenciones: Number(r.TotalAtenciones)
      })));
    }
    
    // Hoy live de SQL Server
    

    let consData = [];
    
    // Histórico de PostgreSQL
    if (split.pgStart && split.pgEnd) {
      let pgWhere = ["fecha >= $1", "fecha <= $2"];
      let params = [split.pgStart, split.pgEnd];
      let paramIndex = 3;
      
      if (search) {
        pgWhere.push(`(medico ILIKE $${paramIndex} OR paciente ILIKE $${paramIndex})`);
        params.push(`%${search}%`);
        paramIndex++;
      }
      if (especialidad) {
        pgWhere.push(`msdescription_es = $${paramIndex++}`);
        params.push(especialidad);
      }
      
      const pgRes = await pgPool.query(`
        SELECT numero_cita as "Numero_Cita", folio_medico as "Folio_Medico", medico as "Medico", 
               msdescription_es as "Especialidad", fecha as "Fecha", hora as "Hora", 
               numero_paciente as "Numero_Paciente", paciente as "Paciente", edad_anios as "Edad_Anios", 
               telefono_1 as "Telefono_1", celular_2 as "Celular_2", estatus_orden_venta as "Estatus_Orden_Venta", 
               articulo as "Articulo"
        FROM dw_vertical_consulta_dia
        WHERE ${pgWhere.join(' AND ')}
      `, params);
      
      consData = consData.concat(pgRes.rows.map(r => ({
        Numero_Cita: Number(r.Numero_Cita),
        Folio_Medico: Number(r.Folio_Medico),
        Medico: r.Medico,
        Especialidad: r.Especialidad,
        Fecha: r.Fecha,
        Hora: r.Hora,
        Numero_Paciente: Number(r.Numero_Paciente),
        Paciente: r.Paciente,
        Edad_Anios: r.Edad_Anios,
        Telefono_1: r.Telefono_1,
        Celular_2: r.Celular_2,
        Estatus_Orden_Venta: r.Estatus_Orden_Venta,
        Articulo: r.Articulo
      })));
    }
    
    // Hoy live de SQL Server
    

    const tendenciaAgrupada = {};
    prodData.forEach(row => {
      let d = new Date(row.Fecha);
      let monthStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      if (!tendenciaAgrupada[monthStr]) {
        tendenciaAgrupada[monthStr] = { monthStr, Total: 0, Primeras: 0, Subsecuentes: 0 };
      }
      tendenciaAgrupada[monthStr].Total += row.TotalAtenciones || 0;
      tendenciaAgrupada[monthStr].Primeras += row.Primeras || 0;
      tendenciaAgrupada[monthStr].Subsecuentes += row.Subsecuentes || 0;
    });
    const tendenciaMensual = Object.values(tendenciaAgrupada).sort((a,b) => a.monthStr.localeCompare(b.monthStr));

    const especialidadesAgrupadas = {};
    prodData.forEach(row => {
      const esp = row.Especialidad || 'N/A';
      especialidadesAgrupadas[esp] = (especialidadesAgrupadas[esp] || 0) + (row.TotalAtenciones || 0);
    });
    const topEspecialidades = Object.keys(especialidadesAgrupadas)
      .map(k => ({ Especialidad: k, Total: especialidadesAgrupadas[k] }))
      .sort((a,b) => b.Total - a.Total)
      .slice(0, 10);

    // Top Médicos
    const medicosAgrupados = {};
    prodData.forEach(row => {
      const key = `${row.Medico}||${row.Especialidad || 'N/A'}`;
      medicosAgrupados[key] = (medicosAgrupados[key] || 0) + (row.TotalAtenciones || 0);
    });
    const topMedicos = Object.keys(medicosAgrupados)
      .map(key => {
        const [medico, especialidad] = key.split('||');
        return { Medico: medico, Especialidad: especialidad, Total: medicosAgrupados[key] };
      })
      .sort((a,b) => b.Total - a.Total)
      .slice(0, 10);

    // Estatus Consultas Día (Gráfica Dona)
    const estatusAgrupados = {};
    consData.forEach(row => {
      const est = row.Estatus_Orden_Venta || 'SIN ESTATUS';
      estatusAgrupados[est] = (estatusAgrupados[est] || 0) + 1;
    });
    const estatusConsultas = Object.keys(estatusAgrupados).map(k => ({ nombre: k, valor: estatusAgrupados[k] }));

    let totalConsultas = 0;
    let totalPrimeras = 0;
    let totalSubsecuentes = 0;
    prodData.forEach(row => {
      totalConsultas += row.TotalAtenciones || 0;
      totalPrimeras += row.Primeras || 0;
      totalSubsecuentes += row.Subsecuentes || 0;
    });

    const listaConsultas = consData
      .sort((a,b) => {
        const dateA = new Date(`${a.Fecha}T${a.Hora || '00:00:00'}`);
        const dateB = new Date(`${b.Fecha}T${b.Hora || '00:00:00'}`);
        return dateB - dateA;
      })
      .slice(0, 100);

    // Detalle por estatus para drill-down
    const detalleConsultas = {};
    listaConsultas.forEach(row => {
      const e = row.Estatus_Orden_Venta;
      if (!detalleConsultas[e]) detalleConsultas[e] = [];
      if (detalleConsultas[e].length < 50) {
        detalleConsultas[e].push(row);
      }
    });

    const topEspecialidadText = topEspecialidades.length > 0 ? topEspecialidades[0].Especialidad : 'N/A';

    const productivityCovered = dailyProductivity && coversSnapshot(productivityState, effectiveStartDate, effectiveEndDate);
    const consultationsCovered = coversSnapshot(consultationState, effectiveStartDate, effectiveEndDate);
    const productivityAvailable = dailyProductivity && (prodData.length > 0 || productivityCovered);
    const consultationsAvailable = consData.length > 0 || consultationsCovered;
    const confirmed = productivityCovered && consultationsCovered && productivityState.status === 'complete' && consultationState.status === 'complete';
    const sourceStatus = {
      status: confirmed ? 'complete' : productivityAvailable || consultationsAvailable ? 'stale' : 'pending',
      productivityAvailable, consultationsAvailable,
      updatedAt: productivityState?.lastSuccessAt || null,
      consultationsUpdatedAt: consultationState?.lastSuccessAt || null,
      coverageStartDate: productivityState?.coverageStartDate || null, throughDate: productivityState?.throughDate || null,
    };

    res.set('Cache-Control', 'no-store');
    res.json({
      ok: true,
      data: {
        sourceStatus,
        tendenciaMensual,
        topEspecialidades,
        topMedicos,
        estatusConsultas,
        listaConsultas,
        detalleConsultas,
        kpis: {
          totalConsultas: productivityAvailable ? totalConsultas : null,
          primeras: productivityAvailable ? totalPrimeras : null,
          subsecuentes: productivityAvailable ? totalSubsecuentes : null,
          topEspecialidad: productivityAvailable ? topEspecialidadText : 'No disponible'
        }
      }
    });

  } catch (err) {
    console.error('Error consultando Eficacia Clínica:', err);
    res.status(500).json({ ok: false, error: 'Error al consultar datos de eficacia clínica.' });
  }
});

router.get('/filtros-eficacia', authenticate, async (req, res, next) => {
  try {
    const medicosResult = await pgPool.query(`
      SELECT DISTINCT medico as "Medico"
      FROM dw_vertical_productividad_medicos
      WHERE medico IS NOT NULL AND medico != ''
      ORDER BY medico
    `);

    const especialidadesResult = await pgPool.query(`
      SELECT DISTINCT especialidad as "Especialidad"
      FROM dw_vertical_productividad_medicos
      WHERE especialidad IS NOT NULL AND especialidad != ''
      ORDER BY especialidad
    `);

    res.json({
      ok: true,
      data: {
        medicos: medicosResult.rows.map(m => m.Medico),
        especialidades: especialidadesResult.rows.map(e => e.Especialidad)
      }
    });

  } catch (err) {
    console.error('Error consultando filtros de eficacia:', err);
    res.status(500).json({ ok: false, error: 'Error consultando filtros.' });
  }
});

router.get('/quirofano-nativo', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res, next) => {
  try {
    let { startDate, endDate, search } = req.query;

    if (startDate === 'undefined' || startDate === 'null' || startDate === '') startDate = null;
    if (endDate === 'undefined' || endDate === 'null' || endDate === '') endDate = null;
    if (search === 'undefined' || search === 'null' || search === '') search = null;

    const todayStr = new Date().toISOString().split('T')[0];
    const effectiveStartDate = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const effectiveEndDate = endDate || todayStr + ' 23:59:59';

    const split = splitDateRange(effectiveStartDate, effectiveEndDate);
    let rawList = [];

    // Obtener histórico de PostgreSQL
    if (split.pgStart && split.pgEnd) {
      let pgWhere = ["fecha_de_cargo >= $1", "fecha_de_cargo <= $2"];
      let params = [split.pgStart, split.pgEnd + ' 23:59:59'];
      let paramIndex = 3;
      let pgSearch = '';

      if (search) {
        pgSearch = `
          WHERE (
            A."Paciente" ILIKE $${paramIndex} 
            OR A."Medicos" ILIKE $${paramIndex} 
            OR U.medicos ILIKE $${paramIndex} 
            OR A."Procedimientos" ILIKE $${paramIndex} 
            OR U.procedimientos ILIKE $${paramIndex}
            OR CAST(A."FOLIO_DE_ATENCION" AS VARCHAR) ILIKE $${paramIndex}
          )
        `;
        params.push(`%${search}%`);
      }

      const pgQuery = `
        WITH Agrupado AS (
          SELECT 
            folio_de_atencion as "FOLIO_DE_ATENCION",
            MIN(fecha_de_cargo) as "FechaInicio",
            MAX(fecha_de_cargo) as "FechaFin",
            MAX(nombre_del_paciente) as "Paciente",
            MAX(medico_tratante) as "Medicos",
            STRING_AGG(descripcion_del_articulo, ', ') as "Procedimientos"
          FROM dw_vertical_cuentas_servicios
          WHERE unidad_de_servicio = 'CQX' AND ${pgWhere.join(' AND ')}
          GROUP BY folio_de_atencion
        )
        SELECT 
          A."FOLIO_DE_ATENCION",
          COALESCE(U.fecha_inicio, A."FechaInicio") as "FechaInicio",
          COALESCE(U.fecha_fin, A."FechaInicio") as "FechaFin",
          A."Paciente",
          COALESCE(U.quirofano, 'CQX') as "Quirofano",
          COALESCE(U.medicos, A."Medicos") as "Medicos",
          A."Procedimientos", U.procedimientos as "Procedimiento_Bitacora",
          CASE WHEN U.pcfr_num IS NULL THEN 'Facturado sin registro en Quirófano (Consultorio/Omisión)' ELSE 'Cirugía Registrada' END as "Notas"
        FROM Agrupado A
        LEFT JOIN LATERAL (
          SELECT pcfr_num, fecha_inicio, fecha_fin, quirofano, procedimientos, medicos
          FROM dw_quirofano_eventos 
          WHERE paciente = A."Paciente" 
            AND fecha_inicio >= A."FechaInicio" - INTERVAL '3 days'
            AND fecha_inicio <= A."FechaInicio" + INTERVAL '3 days'
          ORDER BY fecha_inicio DESC
          LIMIT 1
        ) U ON TRUE
        ${pgSearch}
        ORDER BY A."FechaInicio" DESC
      `;
      
      const pgRes = await pgPool.query(pgQuery, params);
      rawList = rawList.concat(pgRes.rows.map(row => ({
        FOLIO_DE_ATENCION: Number(row.FOLIO_DE_ATENCION),
        FechaInicio: row.FechaInicio,
        FechaFin: row.FechaFin,
        Paciente: row.Paciente,
        Quirofano: row.Quirofano,
        Medicos: row.Medicos,
        Procedimientos: row.Procedimientos,
        Procedimiento_Bitacora: row.Procedimiento_Bitacora,
        Notas: row.Notas
      })));
    }

    // Obtener lo de hoy (en vivo de SQL Server)
    if (split.hasToday && split.remoteStart) {
      const pool = await connectRemoteDB();
      const request = pool.request();
      let whereClauses = ["UNIDAD_DE_SERVICIO = 'CQX'", "FECHA_DE_CARGO >= @startDate", "FECHA_DE_CARGO <= @endDate"];
      request.input('startDate', split.remoteStart);
      request.input('endDate', split.remoteEnd || new Date());
      
      if (search) {
        request.input('search', `%${search}%`);
      }

      const mssqlQuery = `
        WITH Agrupado AS (
          SELECT 
            FOLIO_DE_ATENCION,
            MIN(FECHA_DE_CARGO) as FechaInicio,
            MAX(FECHA_DE_CARGO) as FechaFin,
            MAX(NOMBRE_DEL_PACIENTE) as Paciente,
            MAX(Medico_Tratante) as Medicos,
            STRING_AGG(CAST(DESCRIPCION_DEL_ARTICULO AS NVARCHAR(MAX)), ', ') as Procedimientos
          FROM UDR_CUENTAS_SERVICIOS
          WHERE ${whereClauses.join(' AND ')}
          GROUP BY FOLIO_DE_ATENCION
        )
        SELECT 
          A.FOLIO_DE_ATENCION,
          COALESCE(U.UDR_Inicio, A.FechaInicio) as FechaInicio,
          COALESCE(U.UDR_Fin, A.FechaInicio) as FechaFin,
          A.Paciente,
          COALESCE(U.Quirofano, 'CQX') as Quirofano,
          COALESCE(U.Medicos, A.Medicos) as Medicos,
          A.Procedimientos, U.Procedimientos as Procedimiento_Bitacora,
          CASE WHEN U.PCFRNum IS NULL THEN 'Facturado sin registro en Quirófano (Consultorio/Omisión)' ELSE 'Cirugía Registrada' END as Notas
        FROM Agrupado A
        OUTER APPLY (
          SELECT TOP 1 PCFRNum, FechaInicio as UDR_Inicio, FechaFin as UDR_Fin, Quirofano, Procedimientos, Medicos
          FROM UDR_USOQX 
          WHERE Paciente = A.Paciente 
            AND FechaInicio >= DATEADD(day, -3, A.FechaInicio)
            AND FechaInicio <= DATEADD(day, 3, A.FechaInicio)
        ) U
        ${search ? `WHERE (
          A.Paciente LIKE @search 
          OR A.Medicos LIKE @search 
          OR U.Medicos LIKE @search 
          OR A.Procedimientos LIKE @search 
          OR U.Procedimientos LIKE @search
          OR CAST(A.FOLIO_DE_ATENCION AS VARCHAR) LIKE @search
        )` : ""}
        ORDER BY A.FechaInicio DESC
      `;
      const mssqlRes = await request.query(mssqlQuery);
      rawList = rawList.concat(mssqlRes.recordset);
    }

    let ingresosSAPTotales = null;
    let topMedicosIngresos = [];
    let topServiciosIngresos = [];
    let sourceStatus = { status: 'pending', available: false, partial: false, updatedAt: null, coverageStartDate: null, throughDate: null };
    const sd = startDate ? String(startDate).slice(0, 10) : effectiveStartDate.slice(0, 10);
    const ed = endDate ? String(endDate).slice(0, 10) : todayStr;

    try {
      let state = null;
      try { state = await getQuirofanoRevenueStatus({ startDate: sd, endDate: ed }); }
      catch (error) { console.warn('[Quirófano] No se pudo verificar la cobertura de ingresos:', error.message); }
      const revenueRes = await pgPool.query(`
        SELECT tipo, nombre, SUM(ingresos) AS ingresos, MAX(sync_date) AS updated_at
        FROM dw_sap_quirofano_analiticas
        WHERE startdate >= $1 AND startdate <= $2
          AND startdate = enddate
        GROUP BY tipo, nombre
      `, [sd, ed]);
      const rows = revenueRes.rows;
      if (!Array.isArray(rows) || rows.some(row => row.ingresos == null || !Number.isFinite(Number(row.ingresos)))) {
        throw new Error('No se pudo verificar la copia de ingresos de Quirófano.');
      }
      const totals = rows.filter(row => row.tipo === 'TOTAL');
      const savedTotal = totals.length ? totals.reduce((sum, row) => sum + Number(row.ingresos), 0) : null;
      const coverageConfirmed = [2, 3].includes(Number(state?.modelVersion)) && coversSnapshot(state, sd, ed);
      const available = coverageConfirmed || (savedTotal !== null && savedTotal !== 0);
      const coverageCounts = Object.fromEntries(['totalDays', 'completeDays', 'pendingDays', 'failedDays']
        .filter(key => Number.isInteger(state?.[key]) && state[key] >= 0)
        .map(key => [key, state[key]]));
      if (Object.keys(coverageCounts).length && coverageCounts.totalDays == null) {
        const totalDays = (Date.parse(`${ed}T00:00:00Z`) - Date.parse(`${sd}T00:00:00Z`)) / 86400000 + 1;
        if (Number.isInteger(totalDays) && totalDays > 0) coverageCounts.totalDays = totalDays;
      }
      sourceStatus = {
        status: available ? coverageConfirmed && state?.status === 'complete' ? 'complete' : 'stale' : 'pending',
        available,
        partial: available && !coverageConfirmed,
        ...coverageCounts,
        updatedAt: state?.lastSuccessAt || rows.map(row => row.updated_at).filter(Boolean).sort((left, right) => new Date(right) - new Date(left))[0] || null,
        coverageStartDate: state?.coverageStartDate || null,
        throughDate: state?.throughDate || null
      };
      if (available) {
        ingresosSAPTotales = savedTotal ?? 0;
        const ranking = type => rows.filter(row => row.tipo === type)
          .map(row => ({ nombre: row.nombre, ingresos: Number(row.ingresos) }))
          .sort((left, right) => right.ingresos - left.ingresos).slice(0, 10);
        topMedicosIngresos = ranking('MEDICO');
        topServiciosIngresos = ranking('SERVICIO');
      }
    } catch (e) {
      console.error('[PostgreSQL Error] No se pudo leer la copia de ingresos de Quirófano:', e.message);
    }

    res.set('Cache-Control', 'no-store');
    res.json({
      ok: true,
      sourceStatus,
      data: {
        lista: rawList,
        kpisFinancieros: { ingresosTotales: ingresosSAPTotales, ingresosSAP: ingresosSAPTotales },
        topMedicosIngresos,
        topServiciosIngresos
      }
    });
  } catch (err) {
    console.error('Error consultando Quirófano Nativo:', err);
    res.status(500).json({ ok: false, error: 'Error al consultar quirófano nativo.' });
  }
});

const ExcelJS = require('exceljs');

router.get('/export-excel', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'USUARIO_OPERATIVO', 'ALMACEN_GENERAL']), async (req, res, next) => {
  try {
    let { dashboard, startDate, endDate, search, especialidad } = req.query;
    
    // Evitar strings literales "undefined" o "null" desde el frontend
    if (startDate === 'undefined' || startDate === 'null' || startDate === '') startDate = null;
    if (endDate === 'undefined' || endDate === 'null' || endDate === '') endDate = null;
    if (search === 'undefined' || search === 'null' || search === '') search = null;
    if (especialidad === 'undefined' || especialidad === 'null' || especialidad === '') especialidad = null;

    const request = dashboard === 'eficacia' ? null : (await connectRemoteDB()).request();
    
    let query = '';
    let sheetName = 'Exportación';
    let rows = [];

    // Construir query según el dashboard
    if (dashboard === 'finanzas') {
      sheetName = 'Ingresos_Egresos_SAP';
      const cleanStart = (startDate || '2026-04-01').split(' ')[0];
      const cleanEnd = (endDate || new Date().toISOString().split('T')[0]).split(' ')[0];
      
      let inWhere = ["DocDate >= $1", "DocDate <= $2", "Canceled = 'N'"];
      let inParams = [cleanStart, cleanEnd];
      let outWhere = ["DocDate >= $1", "DocDate <= $2", "Canceled = 'N'"];
      let outParams = [cleanStart, cleanEnd];

      if (search) {
        inWhere.push("(CardName ILIKE $3 OR CardCode ILIKE $3 OR CAST(DocNum AS VARCHAR) ILIKE $3 OR CounterReference ILIKE $3)");
        inParams.push(`%${search}%`);
        outWhere.push("(CardName ILIKE $3 OR CardCode ILIKE $3 OR CAST(DocNum AS VARCHAR) ILIKE $3)");
        outParams.push(`%${search}%`);
      }

      const resIn = await pgPool.query(`
        SELECT 
          'INGRESO' AS "Tipo",
          TO_CHAR(DocDate, 'YYYY-MM-DD') AS "Fecha",
          CONCAT('REC-', DocNum) AS "Folio / Documento",
          COALESCE(CounterReference, CardCode) AS "No. Cuenta / BP",
          COALESCE(CardName, 'Venta General') AS "Paciente / Proveedor",
          CASE 
            WHEN CreditSum > 0 THEN 'Tarjeta de Débito / Crédito'
            WHEN TrsfrSum > 0 THEN 'Transferencia'
            WHEN CheckSum > 0 THEN 'Cheque'
            ELSE 'Efectivo'
          END AS "Método de Pago",
          DocTotal AS "Monto ($)"
        FROM sap_incoming_payments
        WHERE ${inWhere.join(' AND ')}
        ORDER BY DocDate DESC
        LIMIT 5000
      `, inParams);

      const resOut = await pgPool.query(`
        SELECT 
          'EGRESO' AS "Tipo",
          TO_CHAR(DocDate, 'YYYY-MM-DD') AS "Fecha",
          CONCAT('FAC-', DocNum) AS "Folio / Documento",
          CardCode AS "No. Cuenta / BP",
          COALESCE(CardName, 'Proveedor') AS "Paciente / Proveedor",
          'Factura Proveedor' AS "Método de Pago",
          DocTotal AS "Monto ($)"
        FROM sap_purchase_invoices
        WHERE ${outWhere.join(' AND ')}
        ORDER BY DocDate DESC
        LIMIT 5000
      `, outParams);

      rows = resIn.rows.concat(resOut.rows);
      rows.sort((a,b) => String(b.Fecha || '').localeCompare(String(a.Fecha || '')));
    } else if (dashboard === 'financiero') {
      sheetName = 'Cuentas_Financiero';
      const cleanStart = (startDate || '2026-04-01').split(' ')[0];
      const cleanEnd = (endDate || new Date().toISOString().split('T')[0]).split(' ')[0];
      
      let pgWhere = ["c.entrydate >= $1", "c.entrydate <= $2", "c.pc_st = 'CL'", "c.balance > 0"];
      let params = [cleanStart, cleanEnd + ' 23:59:59'];
      
      if (search) {
        pgWhere.push("(p.fullname ILIKE $3 OR CAST(c.pcnum AS VARCHAR) ILIKE $3)");
        params.push(`%${search}%`);
      }

      const resPg = await pgPool.query(`
        SELECT 
          TO_CHAR(COALESCE(c.medicaldischargedate, c.entrydate), 'YYYY-MM-DD') AS "Alta Médica",
          c.pcnum AS "Cuenta",
          COALESCE(p.fullname, 'Sin Nombre') AS "Paciente",
          c.balance AS "Total Facturado",
          COALESCE(c.subtotalcost, 0) AS "Costo Insumos",
          (c.balance - COALESCE(c.subtotalcost, 0)) AS "Utilidad Bruta",
          ROUND(CASE WHEN c.balance > 0 THEN ((c.balance - COALESCE(c.subtotalcost, 0)) / c.balance) * 100 ELSE 0 END, 1) AS "Margen %",
          COALESCE(c.downpayments, (c.balance - CASE WHEN c.total > 0 THEN c.total ELSE 0 END)) AS "Pagado",
          CASE WHEN c.total > 0 THEN c.total ELSE 0 END AS "Saldo Pendiente"
        FROM dw_vertical_pc c
        LEFT JOIN dw_vertical_pt p ON c.ptnum = p.ptnum
        WHERE ${pgWhere.join(' AND ')}
        ORDER BY c.medicaldischargedate DESC NULLS LAST
        LIMIT 5000
      `, params);

      rows = resPg.rows;
    } else if (dashboard === 'eficacia') {
      sheetName = 'Consultas_Eficacia';
      const today = hospitalToday();
      const params = [startDate || addDays(today, -30), endDate ? `${endDate.slice(0, 10)} 23:59:59` : `${today} 23:59:59`];
      const whereCons = ['fecha >= $1', 'fecha <= $2'];
      if (search) { whereCons.push(`(medico ILIKE $${params.length + 1} OR paciente ILIKE $${params.length + 1})`); params.push(`%${search}%`); }
      if (especialidad) {
        whereCons.push(`msdescription_es = $${params.length + 1}`);
        params.push(especialidad);
      }
      const result = await pgPool.query(`
        SELECT TO_CHAR(fecha, 'YYYY-MM-DD') AS "Fecha", LEFT(hora::text, 5) AS "Hora",
          numero_cita AS "Num Cita", paciente AS "Paciente", medico AS "Médico",
          msdescription_es AS "Especialidad", estatus_orden_venta AS "Estatus"
        FROM dw_vertical_consulta_dia
        WHERE ${whereCons.join(' AND ')}
        ORDER BY fecha DESC, hora DESC LIMIT 500`, params);
      rows = result.rows;
      const { getDashboardSyncStatus } = require('../services/dashboardSync.service');
      const state = await getDashboardSyncStatus('consulta').catch(() => null);
      if (!rows.length && !coversSnapshot(state, params[0], params[1])) {
        return res.status(409).json({ ok: false, error: 'Las consultas todavía no tienen una copia confirmada para exportar. Intenta de nuevo cuando termine la actualización.' });
      }
    } else if (dashboard === 'eficiencia') {
      sheetName = 'Censo_Eficiencia';
      let whereClauses = ["1=1"];
      if (startDate) { whereClauses.push("FechaPeriodo >= @startDate"); request.input('startDate', startDate); }
      if (endDate) { whereClauses.push("FechaPeriodo <= @endDate"); request.input('endDate', endDate); }
      query = `
        SELECT 
          Anio AS 'Año',
          Mes AS 'Mes',
          CONVERT(varchar(10), FechaPeriodo, 120) AS 'Fecha',
          CamasOcupadas AS 'Camas Ocupadas',
          QuirofanosActivos AS 'Quirófanos Activos',
          Urgencias AS 'Urgencias',
          Hospitalizacion AS 'Hospitalización',
          TriajeMin AS 'Triaje (Min)',
          LaboratorioMin AS 'Laboratorio (Min)',
          ImagenologiaMin AS 'Imagenología (Min)',
          EgresoHoras AS 'Egreso (Horas)'
        FROM UDR_BI_INDICADORES_OPERATIVOS
        WHERE ${whereClauses.join(' AND ')}
        ORDER BY FechaPeriodo DESC
      `;
      const result = await request.query(query);
      rows = result.recordset;
    } else if (dashboard === 'urgencias') {
      sheetName = 'Pacientes_Urgencias';
      let whereClauses = ["PC.PCType = 'ER'"];
      
      if (startDate) { whereClauses.push("PC.Date >= @startDate"); request.input('startDate', startDate); }
      if (endDate) { whereClauses.push("PC.Date <= @endDate"); request.input('endDate', endDate); }
      if (search) {
        whereClauses.push("(PC.PCNum LIKE @search OR PC.PTNum IN (SELECT PTNum FROM PT WHERE FullName LIKE @search))");
        request.input('search', `%${search}%`);
      }
      query = `
        SELECT TOP 500
          CONVERT(varchar(10), PC.Date, 120) AS 'Fecha Admisión',
          LEFT(CONVERT(varchar, PC.Date, 108), 5) AS 'Hora Admisión',
          CONVERT(varchar(10), PC.MedicalDischargeDate, 120) AS 'Fecha Alta',
          LEFT(CONVERT(varchar, PC.MedicalDischargeDate, 108), 5) AS 'Hora Alta',
          PC.PCNum AS 'Cuenta',
          PT.FullName AS 'Paciente',
          CASE 
            WHEN PC.PC_ST = 'CL' THEN 'Alta'
            WHEN PC.PC_ST = 'OP' THEN 'En Piso'
            ELSE PC.PC_ST
          END AS 'Estatus',
          PC.Total AS 'Costo Total'
        FROM PC
        LEFT JOIN PT ON PC.PTNum = PT.PTNum
        WHERE ${whereClauses.join(' AND ')}
        ORDER BY PC.Date DESC
      `;
      const result = await request.query(query);
      rows = result.recordset;
    } else if (dashboard === 'quirofano') {
      sheetName = 'Cirugias_Quirofano';
      let whereClauses = ["1=1"];
      
      if (startDate) { whereClauses.push("FechaInicio >= @startDate"); request.input('startDate', startDate); }
      if (endDate) { whereClauses.push("FechaInicio <= @endDate"); request.input('endDate', endDate); }
      if (search) {
        whereClauses.push("(Procedimientos LIKE @search OR Paciente LIKE @search OR Medicos LIKE @search OR Quirofano LIKE @search)");
        request.input('search', `%${search}%`);
      }
      query = `
        SELECT TOP 10000
          Quirofano AS 'Quirófano',
          Paciente AS 'Paciente',
          Procedimientos AS 'Procedimiento',
          Medicos AS 'Médicos',
          CONVERT(varchar(16), FechaInicio, 120) AS 'Fecha Inicio',
          CONVERT(varchar(16), FechaFin, 120) AS 'Fecha Fin',
          DATEDIFF(MINUTE, FechaInicio, FechaFin) AS 'Duración (Min)',
          ISNULL(Notas, 'Cirugía Registrada') AS 'Estado (SAP)'
        FROM UDR_USOQX
        WHERE ${whereClauses.join(' AND ')}
        ORDER BY FechaInicio DESC
      `;
      const result = await request.query(query);
      rows = result.recordset;
    } else {
      return res.status(400).json({ error: 'Dashboard no reconocido para exportar' });
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sheetName);

    // Obtener imagen del logo
    const logoPath = path.join(__dirname, '../../frontend/public/logo-escandon.png');
    if (fs.existsSync(logoPath)) {
      const logoId = workbook.addImage({
        filename: logoPath,
        extension: 'png',
      });
      sheet.addImage(logoId, 'A1:B3');
    }

    // Título y filtros
    sheet.mergeCells('C2:F2');
    const titleCell = sheet.getCell('C2');
    titleCell.value = `Reporte Hospital Escandón: ${sheetName}`;
    titleCell.font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FF004687' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'left' };

    sheet.mergeCells('C3:F3');
    const filterCell = sheet.getCell('C3');
    filterCell.value = `Filtros: ${search || 'Ninguno'} | Desde: ${startDate || 'N/A'} Hasta: ${endDate || 'N/A'}`;
    filterCell.font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF64748B' } };

    // Espacio para la cabecera
    sheet.getRow(4).height = 15;

    // Obtener columnas de los datos
    if (rows.length > 0) {
      const keys = Object.keys(rows[0]);
      
      // Fila 5 será los encabezados
      const headerRow = sheet.getRow(5);
      keys.forEach((key, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = key;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF004687' } };  
        cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, name: 'Arial', size: 11 };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };

        sheet.getColumn(i + 1).width = Math.max(15, key.length + 5);
      });
      headerRow.height = 25;

      // Datos
      rows.forEach((row, rowIndex) => {
        const excelRow = sheet.getRow(6 + rowIndex);
        keys.forEach((key, colIndex) => {
          const cell = excelRow.getCell(colIndex + 1);
          let val = row[key];
          cell.value = val;

          if (key === 'Ingresos' || key === 'Utilidad' || key === 'Saldo') {
            cell.numFmt = '$#,##0.00';
          }

          if (rowIndex % 2 === 0) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F6F9' } };
          }
        });
      });
    } else {
      sheet.getCell('A5').value = "No se encontraron datos con los filtros seleccionados.";
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Export_${sheetName}.xlsx"`);

    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('Error generando Excel:', err);
    res.status(500).json({ ok: false, error: 'Error generando reporte Excel.' });
  }
});

  router.get('/auxiliares-nativo/:tipo', authenticate, async (req, res, next) => {
  try {
    const { tipo } = req.params;
    let areaNombre = 'IMAGENOLOGIA';
    let sapGroupCode = 117;  
    if (tipo === 'laboratorio') {
      areaNombre = 'LABORATORIO';
      sapGroupCode = 101;  
    }
    if (tipo === 'farmacia') {
      areaNombre = 'FARMACIA';
      sapGroupCode = 115;  
    }

    let { startDate, endDate } = req.query;
    const now = new Date();
    const startOfYear = `${now.getFullYear()}-01-01`;
    const todayStr = now.toISOString().split('T')[0];
    const effectiveStartDate = startDate || startOfYear;
    const effectiveEndDate = endDate || todayStr + ' 23:59:59';

    const split = splitDateRange(effectiveStartDate, effectiveEndDate);
    const trendMap = {};  
    const estudiosMap = {};  

    const addTrendRow = (yr, mes, volumen, ingresos) => {
      const key = `${yr}-${mes}`;
      if (!trendMap[key]) {
        trendMap[key] = { Yr: yr, Mes: mes, volumen: 0, ingresos: 0, ingresosSAP: 0 };
      }
      trendMap[key].volumen += volumen || 0;
      trendMap[key].ingresos += ingresos || 0;
    };

    const addEstudioRow = (procedimiento, cantidad) => {
      const p = procedimiento || 'Desconocido';
      estudiosMap[p] = (estudiosMap[p] || 0) + (cantidad || 0);
    };

    // Obtener histórico de PostgreSQL
    if (split.pgStart && split.pgEnd) {
      const pgTrendRes = await pgPool.query(`
        SELECT 
          EXTRACT(YEAR FROM s.fecha)::int as "Yr",
          EXTRACT(MONTH FROM s.fecha)::int as "Mes",
          SUM(s.cantidad)::int as volumen,
          SUM(COALESCE(p.linetotal, 0))::float as ingresos
        FROM dw_vertical_solicitudes_estudios s
        LEFT JOIN dw_vertical_pay_ima p ON s.pcpritnum = p.pcitnum
        WHERE s.areanombre = $1 AND s.fecha >= $2 AND s.fecha <= $3
        GROUP BY EXTRACT(YEAR FROM s.fecha), EXTRACT(MONTH FROM s.fecha)
      `, [areaNombre, split.pgStart, split.pgEnd + ' 23:59:59']);
      
      pgTrendRes.rows.forEach(r => addTrendRow(r.Yr, r.Mes, r.volumen, r.ingresos));

      const pgTopRes = await pgPool.query(`
        SELECT 
          s.estudio as procedimiento,
          SUM(s.cantidad)::int as cantidad
        FROM dw_vertical_solicitudes_estudios s
        WHERE s.areanombre = $1 AND s.fecha >= $2 AND s.fecha <= $3
        GROUP BY s.estudio
      `, [areaNombre, split.pgStart, split.pgEnd + ' 23:59:59']);
      
      pgTopRes.rows.forEach(r => addEstudioRow(r.procedimiento, r.cantidad));
    }

    // Obtener lo de hoy de SQL Server
    if (split.hasToday && split.remoteStart) {
      const mssqlPool = await connectRemoteDB();
      const request = mssqlPool.request();
      request.input('areaNombre', areaNombre);
      request.input('startDate', split.remoteStart);
      request.input('endDate', split.remoteEnd || new Date());

      const mssqlTrendRes = await request.query(`
        SELECT 
          YEAR(s.Fecha) as Yr,
          MONTH(s.Fecha) as Mes,
          SUM(s.Cantidad) as volumen,
          SUM(CAST(ISNULL(p.LineTotal, 0) AS FLOAT)) as ingresos
        FROM UDR_BI_SOLICITUDES_ESTUDIOS s
        LEFT JOIN UDR_PAY_IMA p ON s.PCPRITNum = p.PCITNum
        WHERE s.AreaNombre = @areaNombre AND s.Fecha IS NOT NULL
          AND s.Fecha >= @startDate AND s.Fecha <= @endDate
        GROUP BY YEAR(s.Fecha), MONTH(s.Fecha)
      `);
      mssqlTrendRes.recordset.forEach(r => addTrendRow(r.Yr, r.Mes, r.volumen, r.ingresos));

      const mssqlTopRes = await request.query(`
        SELECT 
          s.Estudio as procedimiento,
          SUM(s.Cantidad) as cantidad
        FROM UDR_BI_SOLICITUDES_ESTUDIOS s
        WHERE s.AreaNombre = @areaNombre AND s.Fecha IS NOT NULL
          AND s.Fecha >= @startDate AND s.Fecha <= @endDate
        GROUP BY s.Estudio
      `);
      mssqlTopRes.recordset.forEach(r => addEstudioRow(r.procedimiento, r.cantidad));
    }

    const sapMap = {};  
    const addSapAmount = (yr, mes, total) => {
      const key = `${yr}-${mes}`;
      sapMap[key] = (sapMap[key] || 0) + total;
    };

    // Histórico SAP de PostgreSQL
    if (split.pgStart && split.pgEnd) {
      const pgSapRes = await pgPool.query(`
        SELECT 
          EXTRACT(YEAR FROM docdate)::int as "Yr",
          EXTRACT(MONTH FROM docdate)::int as "Mes",
          SUM(total)::float as total
        FROM dw_sap_ingresos_grupos
        WHERE itmsgrpcod = $1 AND docdate >= $2 AND docdate <= $3
        GROUP BY EXTRACT(YEAR FROM docdate), EXTRACT(MONTH FROM docdate)
      `, [sapGroupCode, split.pgStart, split.pgEnd]);
      pgSapRes.rows.forEach(r => addSapAmount(r.Yr, r.Mes, r.total));
    }

    // Hoy live de SAP Service Layer
    if (split.hasToday && split.remoteStart) {
      try {
        const sdStr = split.remoteStart.substring(0, 10);
        const edStr = (split.remoteEnd || todayStr).substring(0, 10);
        const sapRes = await sapService.fetchAllPages(`/SQLQueries('sq_ingresos_grupos')/List?startDate='${sdStr}'&endDate='${edStr}'`);
        if (sapRes && sapRes.length > 0) {
          sapRes.forEach(row => {
            if (row.ItmsGrpCod === sapGroupCode && row.DocDate) {
              const yr = parseInt(row.DocDate.substring(0, 4), 10);
              const mes = parseInt(row.DocDate.substring(4, 6), 10);
              addSapAmount(yr, mes, row.Total || 0);
            }
          });
        }
      } catch (sapError) {
        console.error('[SAP live error in Auxiliares]', sapError.message);
      }
    }

    // Unir ingresos SAP en la tendenciaAnual
    Object.keys(sapMap).forEach(key => {
      const [yrStr, mesStr] = key.split('-');
      const yr = parseInt(yrStr, 10);
      const mes = parseInt(mesStr, 10);
      if (!trendMap[key]) {
        trendMap[key] = { Yr: yr, Mes: mes, volumen: 0, ingresos: 0, ingresosSAP: 0 };
      }
      trendMap[key].ingresosSAP = sapMap[key];
    });

    const tendenciaAnual = Object.values(trendMap).sort((a, b) => (a.Yr - b.Yr) || (a.Mes - b.Mes));
    const topEstudios = Object.keys(estudiosMap)
      .map(k => ({ procedimiento: k, cantidad: estudiosMap[k] }))
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 10);

    res.json({
      success: true,
      tendenciaAnual,
      topEstudios
    });
  } catch (error) {
    console.error('Error en auxiliares-nativo:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/cuneros-nativo', authenticate, async (req, res, next) => {
  try {
    let { startDate, endDate } = req.query;

    if (startDate === 'undefined' || startDate === 'null' || startDate === '') startDate = null;
    if (endDate === 'undefined' || endDate === 'null' || endDate === '') endDate = null;

    const cacheKey = `cuneros:${startDate || ''}:${endDate || ''}`;
    if (req.query.nocache !== '1') {
      const cached = dashboardCache.get(cacheKey);
      if (cached) return res.json(cached);
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const effectiveStartDate = startDate || `${new Date().getFullYear()}-01-01`;
    const effectiveEndDate = endDate || todayStr + ' 23:59:59';

    const split = splitDateRange(effectiveStartDate, effectiveEndDate);

    // Total de Recién Nacidos
    const fetchRN = async () => {
      let count = 0;
      if (split.pgStart && split.pgEnd) {
        const pgRNRes = await pgPool.query(`
          SELECT COUNT(DISTINCT p.ptnum) AS total_rn
          FROM dw_vertical_pc p
          JOIN dw_vertical_pt pt ON p.ptnum = pt.ptnum
          WHERE p.pc_st = 'CL'
            AND (pt.roomname LIKE '%CUNERO%' OR pt.roomcode LIKE '%CUN%')
            AND DATE(pt.birthdate) = DATE(p.entrydate)
            AND p.entrydate >= $1 AND p.entrydate <= $2
        `, [split.pgStart, split.pgEnd + ' 23:59:59']);
        count += Number(pgRNRes.rows[0]?.total_rn || 0);
      }
      return count;
    };

    const fetchSap = async () => {
      let total = 0;
      if (split.pgStart && split.pgEnd) {
        const pgSapRes = await pgPool.query(`
          SELECT SUM(total) as total
          FROM dw_sap_ingresos_grupos
          WHERE itmsgrpcod = 109 AND docdate >= $1 AND docdate <= $2
        `, [split.pgStart, split.pgEnd]);
        total += Number(pgSapRes.rows[0]?.total || 0);
      }
      if (split.hasToday && split.remoteStart) {
        try {
          const sd = split.remoteStart.substring(0, 10);
          const ed = (split.remoteEnd || todayStr).substring(0, 10);
          const sapSLRes = await sapService.fetchAllPages(`/SQLQueries('sq_ingresos_grupos')/List?startDate='${sd}'&endDate='${ed}'`);
          if (sapSLRes && sapSLRes.length > 0) {
            total += sapSLRes
              .filter(row => row.ItmsGrpCod === 109)
              .reduce((acc, row) => acc + (row.Total || 0), 0);
          }
        } catch (e) {
          console.error('[SAP] Error al consultar ingresos Cuneros hoy:', e.message);
        }
      }
      return total;
    };

    const fetchUCIN = async () => {
      let total = 0;
      if (split.pgStart && split.pgEnd) {
        const pgUCINRes = await pgPool.query(`
          SELECT SUM(total_cobrado) as total_ingresos
          FROM dw_vertical_cuentas_servicios
          WHERE unidad_de_servicio = 'UCIN'
            AND fecha_de_cargo >= $1 AND fecha_de_cargo <= $2
        `, [split.pgStart, split.pgEnd + ' 23:59:59']);
        total += Number(pgUCINRes.rows[0]?.total_ingresos || 0);
      }
      return total;
    };

    // Consumo Fórmulas e Insumos
    const fetchInsumos = async () => {
      let topInsumos = [];
      let totalFormulas = 0;
      if (split.pgStart && split.pgEnd) {
        const pgInsRes = await pgPool.query(`
          SELECT descripcion_del_articulo as "nombre", SUM(cantidad)::int as "cantidad", SUM(total_cobrado)::float as "total"
          FROM dw_vertical_cuentas_servicios
          WHERE (unidad_de_servicio = 'UCIN' OR descripcion_del_articulo ILIKE '%FORMULA%' OR descripcion_del_articulo ILIKE '%LECHE%')
            AND fecha_de_cargo >= $1 AND fecha_de_cargo <= $2
          GROUP BY descripcion_del_articulo
          ORDER BY total DESC
          LIMIT 10
        `, [split.pgStart, split.pgEnd + ' 23:59:59']);
        topInsumos = pgInsRes.rows;

        const formulasRow = topInsumos.filter(i => (i.nombre || '').toLowerCase().includes('formula') || (i.nombre || '').toLowerCase().includes('leche'));
        totalFormulas = formulasRow.reduce((acc, curr) => acc + (curr.cantidad || 0), 0);
      }
      return { topInsumos, totalFormulas };
    };

    const [totalRN, ingresosSAPTotales, totalIngresosVertical, insumosResult] = await Promise.all([
      fetchRN(),
      fetchSap(),
      fetchUCIN(),
      fetchInsumos()
    ]);

    const totalIngresos = (ingresosSAPTotales > 0 ? ingresosSAPTotales : totalIngresosVertical);

    const responsePayload = {
      ok: true,
      success: true,
      data: {
        totalRN,
        totalIngresos,
        totalFormulas: insumosResult.totalFormulas,
        topInsumos: insumosResult.topInsumos,
        topServicios: []
      }
    };

    dashboardCache.set(cacheKey, responsePayload, 60);
    res.json(responsePayload);

  } catch (error) {
    console.error('Error en cuneros-nativo:', error);
    res.status(500).json({ ok: false, success: false, error: error.message });
  }
});

router.get('/uci-nativo', authenticate, async (req, res, next) => {
  try {
    let { startDate, endDate } = req.query;

    if (startDate === 'undefined' || startDate === 'null' || startDate === '') startDate = null;
    if (endDate === 'undefined' || endDate === 'null' || endDate === '') endDate = null;

    const cacheKey = `uci:${startDate || ''}:${endDate || ''}`;
    if (req.query.nocache !== '1') {
      const cached = dashboardCache.get(cacheKey);
      if (cached) return res.json(cached);
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const effectiveStartDate = startDate || `${new Date().getFullYear()}-01-01`;
    const effectiveEndDate = endDate || todayStr + ' 23:59:59';
    const split = splitDateRange(effectiveStartDate, effectiveEndDate);

    // Camas en vivo y censo
    const fetchCenso = async () => {
      let occupiedBeds = [];
      try {
        const mssqlPool = await connectRemoteDB();
        const liveBedsRes = await mssqlPool.request().query(`
          SELECT DISTINCT
            v.RoomCode, 
            v.RoomName,
            pt.FullName AS Paciente, 
            pr.FullName AS Medico,
            pc.Date AS FechaIngreso,
            pc.PCNum AS PCNum
          FROM PC pc
          INNER JOIN PT pt ON pc.PTNum = pt.PTNum
          LEFT JOIN PR pr ON pc.PRNum = pr.PRNum
          OUTER APPLY (
            SELECT TOP 1 
              pcfr.FRCode AS RoomCode,
              pcfr.FRName AS RoomName
            FROM PCFR pcfr
            WHERE pcfr.PCNum = pc.PCNum
              AND pcfr.PCFR_ST = 'AS'
              AND pcfr.ExitDate IS NULL
            ORDER BY pcfr.EntryDate DESC, pcfr.PCFRNum DESC
          ) v
          WHERE pc.PC_ST = 'OP' 
            AND pc.PCType IN ('IP', 'ER')
            AND pc.MedicalDischargeDate IS NULL
            AND (v.RoomCode LIKE 'CUBUTI%' OR v.RoomCode = 'CUNUCIN01')
            AND v.RoomName NOT LIKE '%VIRTUAL%'
            AND v.RoomName NOT LIKE '%VIRT%'
            AND v.RoomCode NOT LIKE '%VIRT%'
        `);
        occupiedBeds = liveBedsRes.recordset || [];
      } catch (e) {
        console.error('[SAP/Vertical] Error al consultar camas UCI en vivo:', e.message);
      }

      const masterBedsRes = await pgPool.query(`
        SELECT DISTINCT roomcode as "RoomCode", roomname as "RoomName"
        FROM dw_vertical_pt
        WHERE roomcode LIKE 'CUBUTI%' OR roomcode = 'CUNUCIN01'
        ORDER BY roomcode ASC
      `);
      const masterBeds = masterBedsRes.rows;

      const bedsMap = {};
      const defaultBeds = [
        { RoomCode: 'CUBUTI01', RoomName: 'CUBICULO 1 TERAPIA INTENSIVA' },
        { RoomCode: 'CUBUTI03', RoomName: 'CUBICULO 3 TERAPIA INTENSIVA' },
        { RoomCode: 'CUBUTI04', RoomName: 'CUBICULO 4 TERAPIA INTENSIVA' },
        { RoomCode: 'CUBUTI05', RoomName: 'CUBICULO 5 TERAPIA INTENSIVA' },
        { RoomCode: 'CUBUTI06', RoomName: 'CUBICULO 6 TERAPIA INTENSIVA' },
        { RoomCode: 'CUBUTI07', RoomName: 'CUBICULO 7 TERAPIA INTENSIVA' },
        { RoomCode: 'CUNUCIN01', RoomName: 'CUNA DE UCIN 1' }
      ];

      const bedsListToUse = masterBeds.length > 0 ? masterBeds : defaultBeds;
      bedsListToUse.forEach(b => {
        bedsMap[b.RoomCode] = { 
          RoomCode: b.RoomCode, RoomName: b.RoomName, Estado: 'LIBRE', 
          Paciente: null, Medico: null, FechaIngreso: null, PCNum: null, totalCargos: 0
        };
      });

      let activeChargesMap = {};
      if (occupiedBeds.length > 0) {
        const activeFolios = occupiedBeds.map(o => o.PCNum).filter(Boolean);
        if (activeFolios.length > 0) {
          const activeChargesRes = await pgPool.query(`
            SELECT folio_de_atencion as folio, SUM(total_cobrado)::float as total_cargos
            FROM dw_vertical_cuentas_servicios
            WHERE folio_de_atencion = ANY($1)
              AND (unidad_de_servicio = 'UCI' OR grupo_de_articulos = 'TERAPIA INTENSIVA  E INTERMEDIA' OR unidad_de_servicio = 'UCIN')
            GROUP BY folio_de_atencion
          `, [activeFolios]);
          activeChargesRes.rows.forEach(r => {
            activeChargesMap[r.folio] = r.total_cargos;
          });
        }
      }

      occupiedBeds.forEach(o => {
        const code = o.RoomCode ? o.RoomCode.trim() : null;
        if (code && bedsMap[code]) {
          bedsMap[code] = {
            RoomCode: code,
            RoomName: o.RoomName || bedsMap[code].RoomName,
            Estado: 'OCUPADA',
            Paciente: o.Paciente,
            Medico: o.Medico,
            FechaIngreso: o.FechaIngreso,
            PCNum: o.PCNum,
            totalCargos: activeChargesMap[o.PCNum] || 0
          };
        }
      });

      return {
        occupiedBeds,
        censoCamas: Object.values(bedsMap).sort((a,b) => a.RoomCode.localeCompare(b.RoomCode))
      };
    };

    // Estadísticas Clínicas
    const fetchClinical = async () => {
      let totalEgresos = 0;
      let defunciones = 0;
      let totalDias = 0;

      if (split.pgStart && split.pgEnd) {
        const pgStats = await pgPool.query(`
          SELECT 
            COUNT(DISTINCT pc.pcnum)::int as total_egresos,
            SUM(CASE WHEN (pt.roomcode LIKE '%DEF%' OR pc.medicaldischargedate = pc.entrydate) THEN 1 ELSE 0 END)::int as defunciones,
            COALESCE(SUM(EXTRACT(EPOCH FROM (pc.medicaldischargedate - pc.entrydate)) / 86400.0), 0)::float as total_dias
          FROM dw_vertical_pc pc
          JOIN dw_vertical_pt pt ON pc.ptnum = pt.ptnum
          WHERE pc.pc_st = 'CL'
            AND pc.medicaldischargedate >= $1 AND pc.medicaldischargedate <= $2
            AND (pt.roomcode LIKE 'CUBUTI%' OR pt.roomcode = 'CUNUCIN01')
        `, [split.pgStart, split.pgEnd + ' 23:59:59']);

        if (pgStats.rows.length > 0) {
          totalEgresos += pgStats.rows[0].total_egresos || 0;
          defunciones += pgStats.rows[0].defunciones || 0;
          totalDias += pgStats.rows[0].total_dias || 0;
        }
      }

      if (split.hasToday && split.remoteStart) {
        try {
          const mssqlPool = await connectRemoteDB();
          const statsRes = await mssqlPool.request()
            .input('startDate', split.remoteStart.substring(0, 10))
            .input('endDate', split.remoteEnd || new Date())
            .query(`
              SELECT 
                COUNT(DISTINCT pc.PCNum) as TotalEgresos,
                SUM(CASE WHEN pc.MedicalDischarge IN ('DEF', 'DEFUNCION', 'MD003') OR pc.DateOfDeath IS NOT NULL THEN 1 ELSE 0 END) as Defunciones,
                COALESCE(SUM(CAST(DATEDIFF(day, pc.Date, pc.MedicalDischargeDate) AS FLOAT)), 0) as TotalDias
              FROM PC pc
              INNER JOIN PT pt ON pc.PTNum = pt.PTNum
              WHERE pc.PC_ST = 'CL'
                AND pc.MedicalDischargeDate >= @startDate AND pc.MedicalDischargeDate <= @endDate
            `);
          if (statsRes.recordset && statsRes.recordset.length > 0) {
            totalEgresos += statsRes.recordset[0].TotalEgresos || 0;
            defunciones += statsRes.recordset[0].Defunciones || 0;
            totalDias += statsRes.recordset[0].TotalDias || 0;
          }
        } catch (e) {
          console.error('[UCI Live Stats]', e.message);
        }
      }

      const estanciaPromedio = totalEgresos > 0 ? parseFloat((totalDias / totalEgresos).toFixed(1)) : 0;
      return { TotalEgresos: totalEgresos, Defunciones: defunciones, EstanciaPromedio: estanciaPromedio };
    };

    // Consultas Financieras en PostgreSQL
    const fetchFinanzas = async () => {
      const [finRes, grupoRes, insumosRes, listaPacientesRes] = await Promise.all([
        pgPool.query(`
          SELECT 
            COALESCE(SUM(total_cobrado), 0)::float as total_facturado, 
            COUNT(DISTINCT folio_de_atencion)::int as total_pacientes
          FROM dw_vertical_cuentas_servicios
          WHERE (unidad_de_servicio = 'UCI' OR grupo_de_articulos = 'TERAPIA INTENSIVA  E INTERMEDIA' OR unidad_de_servicio = 'UCIN')
            AND fecha_de_cargo >= $1 AND fecha_de_cargo <= $2
        `, [effectiveStartDate, effectiveEndDate]),

        pgPool.query(`
          SELECT 
            grupo_de_articulos as "grupo", 
            COALESCE(SUM(total_cobrado), 0)::float as "total"
          FROM dw_vertical_cuentas_servicios
          WHERE (unidad_de_servicio = 'UCI' OR grupo_de_articulos = 'TERAPIA INTENSIVA  E INTERMEDIA' OR unidad_de_servicio = 'UCIN')
            AND fecha_de_cargo >= $1 AND fecha_de_cargo <= $2
          GROUP BY grupo_de_articulos
          ORDER BY total DESC
        `, [effectiveStartDate, effectiveEndDate]),

        pgPool.query(`
          SELECT 
            descripcion_del_articulo as "nombre", 
            SUM(cantidad)::float as "cantidad", 
            COALESCE(SUM(total_cobrado), 0)::float as "total"
          FROM dw_vertical_cuentas_servicios
          WHERE (unidad_de_servicio = 'UCI' OR grupo_de_articulos = 'TERAPIA INTENSIVA  E INTERMEDIA' OR unidad_de_servicio = 'UCIN')
            AND fecha_de_cargo >= $1 AND fecha_de_cargo <= $2
            AND grupo_de_articulos NOT LIKE '%ESTANCIA%'
          GROUP BY descripcion_del_articulo
          ORDER BY total DESC
          LIMIT 10
        `, [effectiveStartDate, effectiveEndDate]),

        pgPool.query(`
          SELECT 
            s.folio_de_atencion as "folio",
            MAX(s.nombre_del_paciente) as "paciente",
            MIN(pc.entrydate) as "entrydate",
            MAX(pc.medicaldischargedate) as "medicaldischargedate",
            COALESCE(MAX(s.medico_tratante), MAX(s.medico_solicitante)) as "medico",
            SUM(s.total_cobrado)::float as "total_cargos_uci",
            pc.pc_st as "status",
            MAX(pt.roomname) as "room"
          FROM dw_vertical_cuentas_servicios s
          LEFT JOIN dw_vertical_pc pc ON s.folio_de_atencion = pc.pcnum
          LEFT JOIN dw_vertical_pt pt ON pc.ptnum = pt.ptnum
          WHERE (s.grupo_de_articulos != 'TERAPIA INTENSIVA  E INTERMEDIA' AND s.unidad_de_servicio IN ('UCI', 'UCIN'))
            AND s.fecha_de_cargo >= $1 AND s.fecha_de_cargo <= $2
          GROUP BY s.folio_de_atencion, pc.pc_st
          ORDER BY entrydate DESC
          LIMIT 500
        `, [effectiveStartDate, effectiveEndDate])
      ]);

      return {
        totalFacturado: finRes.rows[0]?.total_facturado || 0,
        totalPacientes: finRes.rows[0]?.total_pacientes || 0,
        ingresosPorGrupo: grupoRes.rows,
        topInsumos: insumosRes.rows,
        listaPacientes: listaPacientesRes.rows
      };
    };

    const [censoResult, clinicalStats, finanzasResult] = await Promise.all([
      fetchCenso(),
      fetchClinical(),
      fetchFinanzas()
    ]);

    const totalEgresos = clinicalStats.TotalEgresos;
    const defunciones = clinicalStats.Defunciones;
    const tasaMortalidad = totalEgresos > 0 ? parseFloat(((defunciones * 100) / totalEgresos).toFixed(1)) : 0;
    const camasOcupadas = censoResult.occupiedBeds.length;
    const totalCamas = censoResult.censoCamas.length;
    const ocupacionPct = totalCamas > 0 ? parseFloat(((camasOcupadas * 100) / totalCamas).toFixed(1)) : 0;

    const responsePayload = {
      ok: true,
      data: {
        kpis: {
          totalFacturado: finanzasResult.totalFacturado,
          totalPacientes: finanzasResult.totalPacientes,
          estanciaPromedio: clinicalStats.EstanciaPromedio,
          tasaMortalidad,
          camasOcupadas,
          totalCamas,
          ocupacionPct
        },
        censoCamas: censoResult.censoCamas,
        ingresosPorGrupo: finanzasResult.ingresosPorGrupo,
        topInsumos: finanzasResult.topInsumos,
        listaPacientes: finanzasResult.listaPacientes
      }
    };

    dashboardCache.set(cacheKey, responsePayload, 60);
    res.json(responsePayload);

  } catch (err) {
    console.error('Error en uci-nativo:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/cuenta-detalle/:folio', authenticate, async (req, res) => {
  try {
    const { folio } = req.params;
    const result = await pgPool.query(`
      SELECT 
        fecha_de_cargo as "fecha",
        grupo_de_articulos as "grupo",
        codigo as "codigo",
        descripcion_del_articulo as "insumo",
        cantidad::float as "cantidad",
        precio_unitario::float as "precio_unitario",
        total_cobrado::float as "total_cobrado"
      FROM dw_vertical_cuentas_servicios
      WHERE folio_de_atencion = $1
      ORDER BY fecha_de_cargo DESC;
    `, [folio]);
    
    res.json({ ok: true, data: result.rows });
  } catch (err) {
    console.error('Error en cuenta-detalle:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/geografia', authenticate, async (req, res) => {
  try {
    const estadosQuery = await pgPool.query(`
      SELECT 
        COALESCE(NULLIF(TRIM(statecode), ''), 'CDMX') as "estado", 
        COUNT(*)::int as "cantidad" 
      FROM dw_vertical_pt 
      GROUP BY 1 
      ORDER BY cantidad DESC 
      LIMIT 10
    `);
    const estados = estadosQuery.rows;

    const ciudadesQuery = await pgPool.query(`
      SELECT 
        COALESCE(NULLIF(TRIM(city), ''), 'CDMX') as "ciudad", 
        COUNT(*)::int as "cantidad" 
      FROM dw_vertical_pt 
      GROUP BY 1 
      ORDER BY cantidad DESC 
      LIMIT 15
    `);
    const ciudades = ciudadesQuery.rows;

    res.json({
      ok: true,
      estados,
      ciudades
    });
  } catch (err) {
    console.error('Error en geografía:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/sap/vidas-salvadas', authenticate, async (req, res) => {
  try {
    let { startDate, endDate, periodo } = req.query;

    let d = new Date();
    if (periodo === 'semana') d.setDate(d.getDate() - 7);
    else if (periodo === 'trimestre') d.setMonth(d.getMonth() - 3);
    else if (periodo === 'año') { d = new Date(d.getFullYear(), 0, 1); }  
    else if (periodo === 'mes') d.setMonth(d.getMonth() - 1);
    else if (!startDate) d.setMonth(d.getMonth() - 1);  

    let sapDate = '';
    if (startDate) {
      sapDate = startDate;  
    } else {
      sapDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    const sapService = require('../services/sap.service');
    const allSapRows = await fetchAllSapPages(sapService, `/SQLQueries('VidasSalvChoqueDet')/List?startDate='${sapDate}'`);
    
    res.json({
      ok: true,
      data: allSapRows || [],
      totalVidasSalvadas: allSapRows?.length || 0
    });

  } catch (err) {
    console.error('Error en vidas salvadas SAP detalle:', err.error || err);
    res.status(500).json({ ok: false, error: err.error?.message?.value || err.message });
  }
});

/* GET /api/dashboard/sap/vidas-salvadas/:atencion/detalle */
router.get('/sap/vidas-salvadas/:atencion/detalle', authenticate, async (req, res) => {
  try {
    const atencion = req.params.atencion;
    if (!/^\d{1,20}$/.test(atencion)) return res.status(400).json({ ok: false, error: 'Escribe un número de cuenta válido.' });
    const pool = await connectRemoteDB();

    const sapService = require('../services/sap.service');
    await sapService._ensureSession();
    const queryName = 'EscandonBIDetalleAtencion';
    const sapSqlText = `
      SELECT 
        T0.DocNum AS "FolioSAP",
        T0.DocDate AS "Fecha",
        T1.ItemCode AS "CodigoArticulo",
        T1.Dscription AS "Descripcion",
        T1.Quantity AS "Cantidad",
        T1.Price AS "PrecioUnitario",
        T1.LineTotal AS "TotalLinea"
      FROM OINV T0
      INNER JOIN INV1 T1 ON T0.DocEntry = T1.DocEntry
      WHERE T0.U_PCNum = :atencion AND T0.CANCELED = 'N'
      
      UNION ALL
      
      SELECT 
        T0.DocNum AS "FolioSAP",
        T0.DocDate AS "Fecha",
        T1.ItemCode AS "CodigoArticulo",
        T1.Dscription AS "Descripcion",
        T1.Quantity AS "Cantidad",
        T1.Price AS "PrecioUnitario",
        T1.LineTotal AS "TotalLinea"
      FROM ORDR T0
      INNER JOIN RDR1 T1 ON T0.DocEntry = T1.DocEntry
      WHERE T0.U_PCNum = :atencion AND T0.CANCELED = 'N'
    `;
    
    let sapData = [];
    try {
      const { ensureSapQuery } = require('../services/sapQueryRegistration.service');
      await ensureSapQuery(queryName, sapSqlText);
      const parameters = new URLSearchParams({ atencion: `'${atencion}'` });
      sapData = await sapService.fetchAllPages(`/SQLQueries('${queryName}')/List?${parameters}`);
    } catch(err) {
      console.warn('[SAP SL] Detalle de atención pendiente:', err.status || err.code || 'SAP_SOURCE_FAILED');
      throw err;
    }

    const verticalQuery = `
      SELECT 
        PCITNum,
        ChargeDate,
        SUCode,
        ItemCode,
        ItemDescription,
        Quantity,
        UnitPrice,
        (Quantity * UnitPrice) as Total
      FROM PCIT
      WHERE PCNum = @atencion
      ORDER BY ChargeDate ASC
    `;
    
    const verticalResult = await pool.request()
      .input('atencion', atencion)
      .query(verticalQuery);

    res.json({
      ok: true,
      sap: sapData || [],
      vertical: verticalResult.recordset || []
    });

  } catch (err) {
    console.error('Error en detalle de vidas salvadas:', err);
    res.status(502).json({ ok: false, error: 'No se pudo completar el detalle de la atención. Intenta de nuevo cuando termine la actualización.' });
  }
});

/* GET /api/dashboard/consulta-externa-nativo */
router.get('/consulta-externa-nativo', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res, next) => {
  try {
    let { startDate, endDate, search } = req.query;
    
    if (startDate === 'undefined' || startDate === 'null' || startDate === '') startDate = null;
    if (endDate === 'undefined' || endDate === 'null' || endDate === '') endDate = null;
    if (search === 'undefined' || search === 'null' || search === '') search = null;

    const cacheKey = `consulta-externa:${startDate || ''}:${endDate || ''}:${search || ''}`;
    if (req.query.nocache !== '1') {
      const cached = dashboardCache.get(cacheKey);
      if (cached) return res.json(cached);
    }

    if (!startDate && !endDate) {
      const today = new Date();
      const dateStr = today.toISOString().split('T')[0];
      startDate = dateStr;
      endDate = dateStr;
    }
    
    if (endDate && endDate.length === 10) endDate += ' 23:59:59';
    
    const pool = await connectRemoteDB();
    
    let whereV = ["1=1"];
    let whereP = ["1=1"];
    const params = {};
    
    if (startDate) {
      whereV.push("Fecha >= @startDate");
      whereP.push("DesdeFecha >= @startDate");
      params.startDate = startDate;
    }
    if (endDate) {
      whereV.push("Fecha <= @endDate");
      whereP.push("DesdeFecha <= @endDate");
      params.endDate = endDate;
    }

    const req1 = pool.request();
    const req2 = pool.request();
    if (params.startDate) { req1.input('startDate', params.startDate); req2.input('startDate', params.startDate); }
    if (params.endDate) { req1.input('endDate', params.endDate); req2.input('endDate', params.endDate); }

    const [progRes, diaRes] = await Promise.all([
      req1.query(`
        SELECT No_Cita, No_Medico, Medico, Especialidad, NoPaciente, Paciente, DesdeFecha, HastaFecha, UDF_Ejecutada, PCAP_ST_Descripcion
        FROM UDR_CONSULTAS_PROG
        WHERE ${whereP.join(' AND ')}
      `),
      req2.query(`
        SELECT Numero_Cita, Folio_Medico, Medico, MSDescription_ES, Fecha, Hora, Numero_Paciente, Paciente, Estatus_Orden_Venta, Articulo
        FROM V_UDR_CONSULTA_DIA
        WHERE ${whereV.join(' AND ')}
      `)
    ]);

    const programadasData = progRes.recordset || [];
    const diaData = diaRes.recordset || [];

    let finalDiaData = diaData;
    let finalProgData = programadasData;
    
    if (search) {
      const term = search.toLowerCase();
      finalDiaData = diaData.filter(d => 
        (d.Paciente && d.Paciente.toLowerCase().includes(term)) || 
        (d.Medico && d.Medico.toLowerCase().includes(term))
      );
      finalProgData = programadasData.filter(d => 
        (d.Paciente && d.Paciente.toLowerCase().includes(term)) || 
        (d.Medico && d.Medico.toLowerCase().includes(term))
      );
    }
    
    // Top Médicos por cantidad de consultas
    const medicosCount = {};
    finalProgData.forEach(p => {
      const med = (p.Medico || 'SIN MEDICO ASIGNADO').toUpperCase();
      medicosCount[med] = (medicosCount[med] || 0) + 1;
    });
    
    const topMedicos = Object.keys(medicosCount).map(k => ({
      nombre: k,
      valor: medicosCount[k]
    })).sort((a,b) => b.valor - a.valor).slice(0, 10);

    const totalProgramadas = programadasData.length;
    let cancelaciones = 0;
    let asistencias = 0;
    
    programadasData.forEach(p => {
      const st = (p.PCAP_ST_Descripcion || '').toLowerCase();
      if (st.includes('cancelad')) {
        cancelaciones++;
      } else if (st.includes('llegó') || st.includes('lleg')) {
        asistencias++;
      }
    });
    
    if (asistencias === 0 && diaData.length > 0) {
      asistencias = diaData.length;
    }
    
    const tasaAsistencia = totalProgramadas > 0 ? Math.round((asistencias / totalProgramadas) * 100) : 0;
    
    // Tendencia por día
    const tendenciaMap = {};
    programadasData.forEach(p => {
      if (p.DesdeFecha) {
        const dStr = p.DesdeFecha instanceof Date ? p.DesdeFecha.toISOString().split('T')[0] : String(p.DesdeFecha).substring(0, 10);
        tendenciaMap[dStr] = (tendenciaMap[dStr] || 0) + 1;
      }
    });
    const tendencia = Object.keys(tendenciaMap).sort().map(k => ({ fecha: k, consultas: tendenciaMap[k] }));

    const espCount = {};
    finalProgData.forEach(p => {
      const e = p.Especialidad || 'OTRA';
      espCount[e] = (espCount[e] || 0) + 1;
    });
    const especialidades = Object.keys(espCount).map(k => ({
      nombre: k,
      valor: espCount[k]
    })).sort((a,b) => b.valor - a.valor).slice(0, 5);

    const responsePayload = {
      ok: true,
      data: {
        kpis: {
          total: totalProgramadas,
          asistencias,
          cancelaciones,
          tasaAsistencia
        },
        tendencia,
        especialidades,
        topMedicos,
        lista: finalProgData
      }
    };

    dashboardCache.set(cacheKey, responsePayload, 60);
    res.json(responsePayload);

  } catch (err) {
    console.error('Error Consulta Externa:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/aseguradoras-nativo', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res, next) => {
  try {
    let { startDate, endDate } = req.query;

    if (startDate === 'undefined' || startDate === 'null' || startDate === '') startDate = null;
    if (endDate === 'undefined' || endDate === 'null' || endDate === '') endDate = null;

    const cacheKey = `aseguradoras:${startDate || ''}:${endDate || ''}`;
    if (req.query.nocache !== '1') {
      const cached = dashboardCache.get(cacheKey);
      if (cached) return res.json(cached);
    }

    if (!startDate && !endDate) {
      const now = new Date();
      startDate = `${now.getFullYear()}-01-01`;
      endDate = now.toISOString().split('T')[0];
    }
    
    if (endDate && endDate.length === 10) endDate += ' 23:59:59';

    let sapBPs = [];
    let bpNames = {};
    try {
      const sapSLRes = await sapService.fetchAllPages(`/BusinessPartners?$select=CardCode,CardName&$filter=GroupCode eq 109`);
      if (sapSLRes && sapSLRes.length > 0) {
        sapBPs = sapSLRes.map(bp => bp.CardCode);
        sapSLRes.forEach(bp => {
          bpNames[bp.CardCode] = bp.CardName;
        });
      }
    } catch (e) {
      console.error('[SAP] Error al consultar BusinessPartners Grupo 109:', e.message);
    }

    if (sapBPs.length === 0) {
      sapBPs = ['CTE00005', 'CTE00014', 'CTE00024', 'CTE00187'];
    }

    const pool = await connectRemoteDB();
    const request = pool.request();

    let wherePC = [];
    const bpParams = sapBPs.map((bp, i) => `@bp${i}`);
    
    wherePC.push(`(
      pc.BPCode IN (${bpParams.join(',')}) 
      OR 
      EXISTS (SELECT 1 FROM PCAG ag WHERE ag.PCNum = pc.PCNum AND ag.AGCode IN (${bpParams.join(',')}))
    )`);
    
    sapBPs.forEach((bp, i) => request.input(`bp${i}`, bp));

    if (startDate) {
      wherePC.push("pc.Date >= @startDate");
      request.input('startDate', startDate);
    }
    if (endDate) {
      wherePC.push("pc.Date <= @endDate");
      request.input('endDate', endDate);
    }

    const verticalQuery = `
      SELECT 
        pc.PCNum, 
        pc.PTNum, 
        pc.Date as FechaApertura, 
        pc.Balance, 
        pc.Total, 
        COALESCE(
          (SELECT TOP 1 ag.AGCode FROM PCAG ag WHERE ag.PCNum = pc.PCNum AND ag.AGCode IN (${bpParams.join(',')})),
          pc.BPCode
        ) as BPCode, 
        pt.FullName as Paciente,
        pr.FullName as Medico
      FROM PC pc
      JOIN PT pt ON pc.PTNum = pt.PTNum
      LEFT JOIN PR pr ON pc.PRNum = pr.PRNum
      WHERE ${wherePC.join(' AND ')}
      ORDER BY pc.Date DESC
    `;
    const verticalRes = await request.query(verticalQuery);
    const cuentas = verticalRes.recordset || [];

    const aseguradorasMap = {};
    cuentas.forEach(c => {
      const bp = c.BPCode || 'Desconocida';
      if (!aseguradorasMap[bp]) {
        aseguradorasMap[bp] = { 
          bp, 
          nombre: bpNames[bp] || bp,
          count: 0, 
          totalFacturado: 0, 
          pacientes: [] 
        };
      }
      aseguradorasMap[bp].count++;
      aseguradorasMap[bp].totalFacturado += parseFloat(c.Total || 0);
      
      if (aseguradorasMap[bp].pacientes.length < 10) {
        aseguradorasMap[bp].pacientes.push(c);
      }
    });

    const topAseguradoras = Object.values(aseguradorasMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const listaPacientes = cuentas.map(c => ({
      ...c,
      AseguradoraNombre: aseguradorasMap[c.BPCode]?.nombre || c.BPCode
    })).slice(0, 2000);

    const totalCuentas = cuentas.length;
    const totalMontoVertical = cuentas.reduce((acc, c) => acc + parseFloat(c.Total || 0), 0);
    const totalSaldoVertical = cuentas.reduce((acc, c) => acc + parseFloat(c.Balance || 0), 0);

    const responsePayload = {
      ok: true,
      success: true,
      data: {
        kpis: {
          totalPacientes: totalCuentas,
          montoTotal: totalMontoVertical,
          saldoPendiente: totalSaldoVertical,
          cuentaPromedio: totalCuentas > 0 ? (totalMontoVertical / totalCuentas) : 0
        },
        topAseguradoras,
        listaPacientes
      }
    };

    dashboardCache.set(cacheKey, responsePayload, 60);
    res.json(responsePayload);

  } catch (error) {
    console.error('Error en aseguradoras-nativo:', error);
    res.status(500).json({ ok: false, success: false, error: error.message });
  }
});

router.get('/finanzas-nativo', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res, next) => {
  try {
    let { startDate, endDate, search } = req.query;

    if (!startDate || startDate === 'undefined' || startDate === 'null' || startDate.trim() === '') {
      startDate = '2026-04-01';
    }
    if (!endDate || endDate === 'undefined' || endDate === 'null' || endDate.trim() === '') {
      endDate = new Date().toISOString().split('T')[0];
    }

    if (startDate < '2026-04-01') {
      startDate = '2026-04-01';
    }

    let sapStartDate = startDate.split(' ')[0];
    let sapEndDate = endDate.split(' ')[0];

    if (sapStartDate > sapEndDate) {
      const tmp = sapStartDate;
      sapStartDate = sapEndDate;
      sapEndDate = tmp;
    }

    // Conexión a PostgreSQL DW
    const { pool } = require('../config/pg-db');

    let inWhere = ["DocDate >= $1", "DocDate <= $2", "Canceled = 'N'"];
    let inParams = [sapStartDate, sapEndDate];
    let outWhere = ["DocDate >= $1", "DocDate <= $2", "Canceled = 'N'"];
    let outParams = [sapStartDate, sapEndDate];

    if (search && search.trim() !== '') {
      inWhere.push("(CardName ILIKE $3 OR CardCode ILIKE $3 OR CAST(DocNum AS VARCHAR) ILIKE $3 OR CounterReference ILIKE $3)");
      inParams.push(`%${search.trim()}%`);
      outWhere.push("(CardName ILIKE $3 OR CardCode ILIKE $3 OR CAST(DocNum AS VARCHAR) ILIKE $3)");
      outParams.push(`%${search.trim()}%`);
    }

    let kpiData = {
      DocTotalIngresos: 0, CashSum: 0, CreditSum: 0, CheckSum: 0, TrsfrSum: 0, DocTotalEgresos: 0
    };

    try {
      const resKpiIngresos = await pool.query(`
        SELECT 
          SUM(DocTotal) as "DocTotalIngresos", 
          SUM(CashSum) as "CashSum", 
          SUM(CreditSum) as "CreditSum", 
          SUM(CheckSum) as "CheckSum", 
          SUM(TrsfrSum) as "TrsfrSum" 
        FROM sap_incoming_payments 
        WHERE ${inWhere.join(' AND ')}
      `, inParams);
      
      if (resKpiIngresos.rows.length > 0) {
        kpiData = { ...kpiData, ...resKpiIngresos.rows[0] };
      }

      const resKpiEgresos = await pool.query(`
        SELECT SUM(DocTotal) as "DocTotalEgresos" 
        FROM sap_purchase_invoices 
        WHERE ${outWhere.join(' AND ')}
      `, outParams);
      
      if (resKpiEgresos.rows.length > 0) {
        kpiData.DocTotalEgresos = resKpiEgresos.rows[0].DocTotalEgresos || 0;
      }
    } catch (e) {
      console.error("[PostgreSQL Error - Finanzas] Error fetching KPIs:", e);
    }

    const totalIngresos = Number(kpiData.DocTotalIngresos || 0);
    const totalEgresos = Number(kpiData.DocTotalEgresos || 0);
    const balance = totalIngresos - totalEgresos;

    const totalEfectivo = Number(kpiData.CashSum || 0);
    const totalTransferencias = Number(kpiData.TrsfrSum || 0);
    const totalCheques = Number(kpiData.CheckSum || 0);
    const totalTarjetas = Number(kpiData.CreditSum || 0);

    const transacciones = [];

    // INGRESOS DESDE POSTGRESQL (Límite 300 para la UI)
    try {
      const resSapIn = await pool.query(`
        SELECT 
          DocNum as "DocNum", DocDate as "DocDate", CardCode as "CardCode", 
          CardName as "CardName", CashSum as "CashSum", TrsfrSum as "TransferSum", 
          CreditSum as "CreditSum", CheckSum as "CheckSum", DocTotal as "DocTotal", 
          CounterReference as "CounterReference"
        FROM sap_incoming_payments
        WHERE ${inWhere.join(' AND ')}
        ORDER BY DocDate DESC
        LIMIT 300
      `, inParams);
      
      const allPayments = resSapIn.rows;

      allPayments.forEach(p => {
        let cash = Number(p.CashSum) || 0;
        let transfer = Number(p.TransferSum) || 0;
        let creditCard = Number(p.CreditSum) || 0;
        let check = Number(p.CheckSum) || 0;

        const montoPayment = (cash + transfer + creditCard + check);

        let metodoNombre = 'Efectivo';
        if (creditCard > 0) metodoNombre = 'Tarjeta de Débito / Crédito';
        else if (transfer > 0) metodoNombre = 'Transferencia';
        else if (check > 0) metodoNombre = 'Cheque';

        transacciones.push({
          tipo: 'INGRESO',
          Code: `REC-${p.DocNum}`,
          DocNum: p.DocNum,
          Fecha: p.DocDate,
          MetodoPago: metodoNombre,
          MontoPago: montoPayment,
          PCNum: p.CounterReference || p.CardCode,
          Paciente: p.CardName || 'Venta General',
          MetodoNombre: metodoNombre
        });
      });
    } catch (e) {
      console.error("[PostgreSQL Error - Finanzas] Error fetching IncomingPayments:", e.message);
    }

    // EGRESOS DESDE POSTGRESQL (Límite 300 para la UI)
    try {
      const resSap = await pool.query(`
        SELECT 
          DocEntry as "DocEntry", DocNum as "DocNum", DocDate as "DocDate", 
          CardCode as "CardCode", CardName as "CardName", DocTotal as "DocTotal"
        FROM sap_purchase_invoices
        WHERE ${outWhere.join(' AND ')}
        ORDER BY DocDate DESC
        LIMIT 300
      `, outParams);
      
      const sapData = resSap.rows;
      sapData.forEach(inv => {
        const amt = Number(inv.DocTotal || 0);

        transacciones.push({
          tipo: 'EGRESO',
          Code: `FAC-${inv.DocNum}`,
          DocNum: inv.DocNum,
          DocEntry: inv.DocEntry,
          Fecha: inv.DocDate,
          MetodoPago: 'Factura Proveedor',
          MontoPago: amt,
          PCNum: inv.CardCode,
          Paciente: inv.CardName || 'Proveedor',
          MetodoNombre: 'Factura Proveedor'
        });
      });
    } catch (e) {
      console.error("[PostgreSQL Error - Finanzas] Error fetching PurchaseInvoices for Egresos:", e.message);
    }

    transacciones.sort((a, b) => new Date(b.Fecha) - new Date(a.Fecha));

    const metodosData = [
      { metodo: 'Efectivo', codigo: 'E', monto: totalEfectivo, transacciones: transacciones.filter(t => t.MetodoNombre === 'Efectivo').length },
      { metodo: 'Tarjeta de Débito / Crédito', codigo: 'CC', monto: totalTarjetas, transacciones: transacciones.filter(t => t.MetodoNombre === 'Tarjeta de Débito / Crédito').length },
      { metodo: 'Transferencia', codigo: 'T', monto: totalTransferencias, transacciones: transacciones.filter(t => t.MetodoNombre === 'Transferencia').length },
      { metodo: 'Cheque', codigo: 'CH', monto: totalCheques, transacciones: transacciones.filter(t => t.MetodoNombre === 'Cheque').length }
    ].sort((a, b) => b.monto - a.monto);

    res.json({
      success: true,
      data: {
        kpis: {
          totalIngresos,
          totalEfectivo,
          totalTarjetas,
          totalTransacciones: transacciones.length,
          totalEgresos
        },
        metodosData,
        transacciones
      }
    });

  } catch (error) {
    console.error('Error en finanzas-nativo:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/finanzas-nativo/factura/:docNum', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res) => {
  try {
    const { docNum } = req.params;
    const sapService = require('../services/sap.service');
    
    await sapService._ensureSession();
    
    // Intentar consultar SAP filtrando por DocNum
    const filterRes = await sapService.get(`/PurchaseInvoices?$filter=DocNum eq ${docNum}`);
    const invoice = filterRes.data?.value?.[0];
    
    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Factura de proveedor no encontrada en SAP' });
    }

    res.json({
      success: true,
      data: {
        DocNum: invoice.DocNum,
        DocEntry: invoice.DocEntry,
        DocDate: invoice.DocDate,
        DueDate: invoice.DocDueDate || invoice.DueDate,
        CardCode: invoice.CardCode,
        CardName: invoice.CardName,
        DocTotal: invoice.DocTotal,
        VatSum: invoice.VatSum || 0,
        Comments: invoice.Comments || 'Factura de Proveedor SAP B1',
        DocumentLines: (invoice.DocumentLines || []).map(line => ({
          ItemCode: line.ItemCode || line.Dscription || 'CONCEPTO',
          ItemDescription: line.ItemDescription || line.Dscription || 'Concepto de Servicio / Compra',
          Quantity: line.Quantity || 1,
          Price: line.Price || line.LineTotal,
          LineTotal: line.LineTotal
        }))
      }
    });
  } catch (err) {
    console.error("Error al obtener detalle de factura SAP:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/finanzas-nativo/ingreso/:docNum', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res) => {
  try {
    const { docNum } = req.params;
    const { pool } = require('../config/pg-db');
    const sapService = require('../services/sap.service');
    
    // Buscar DocEntry en PostgreSQL
    const pqRes = await pool.query('SELECT docentry FROM sap_incoming_payments WHERE docnum = $1 LIMIT 1', [docNum]);
    if (pqRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Ingreso no encontrado en la base de datos' });
    }
    
    const docEntry = pqRes.rows[0].docentry;
    
    await sapService._ensureSession();
    
    // Consultar SAP por DocEntry
    const sapRes = await sapService.get(`/IncomingPayments(${docEntry})`);
    const payment = sapRes.data;
    
    if (!payment) {
      return res.status(404).json({ success: false, error: 'Ingreso no encontrado en SAP' });
    }

    // Obtener el detalle de cada factura si existe
    const paymentInvoices = payment.PaymentInvoices || [];
    for (let inv of paymentInvoices) {
      if (inv.InvoiceType === 'it_Invoice') {
        try {
          const invRes = await sapService.get(`/Invoices(${inv.DocEntry})`);
          if (invRes.data && invRes.data.DocumentLines) {
            inv.DocumentLines = invRes.data.DocumentLines.map(line => ({
              ItemCode: line.ItemCode,
              ItemDescription: line.ItemDescription,
              Quantity: line.Quantity,
              Price: line.Price,
              LineTotal: line.LineTotal
            }));
          }
        } catch (e) {
          console.error(`Error fetching Invoice ${inv.DocEntry}:`, e.message);
        }
      }
    }

    res.json({
      success: true,
      data: {
        DocNum: payment.DocNum,
        DocEntry: payment.DocEntry,
        DocDate: payment.DocDate,
        CardCode: payment.CardCode,
        CardName: payment.CardName,
        DocCurrency: payment.DocCurrency,
        CashSum: payment.CashSum || 0,
        TransferSum: payment.TransferSum || 0,
        CheckSum: payment.CheckSum || 0,
        CreditSum: payment.CreditSum || 0,
        DocTotal: (payment.CashSum || 0) + (payment.TransferSum || 0) + (payment.CheckSum || 0) + (payment.CreditSum || 0),
        CounterReference: payment.CounterReference,
        Remarks: payment.Remarks || payment.JournalRemarks,
        PaymentInvoices: paymentInvoices,
        PaymentAccounts: payment.PaymentAccounts || [],
        PaymentChecks: payment.PaymentChecks || [],
        PaymentCreditCards: payment.PaymentCreditCards || []
      }
    });
  } catch (err) {
    console.error("Error al obtener detalle de ingreso SAP:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/hospitalizacion-nativo', authenticate, async (req, res, next) => {
  try {
    let { startDate, endDate } = req.query;
    
    if (startDate === 'undefined' || startDate === 'null' || startDate === '') startDate = null;
    if (endDate === 'undefined' || endDate === 'null' || endDate === '') endDate = null;

    const cacheKey = `hospitalizacion:${startDate || ''}:${endDate || ''}`;
    if (req.query.nocache !== '1') {
      const cached = dashboardCache.get(cacheKey);
      if (cached) return res.json(cached);
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const effectiveStartDate = startDate || `${new Date().getFullYear()}-01-01`;
    const effectiveEndDate = endDate || todayStr + ' 23:59:59';
    const split = splitDateRange(effectiveStartDate, effectiveEndDate);

    // Censo de camas en vivo
    const fetchCenso = async () => {
      let occupiedBeds = [];
      try {
        const mssqlPool = await connectRemoteDB();
        const liveBedsRes = await mssqlPool.request().query(`
          SELECT DISTINCT
            v.RoomCode, 
            v.RoomName,
            pt.FullName AS Paciente, 
            pr.FullName AS Medico,
            pc.Date AS FechaIngreso,
            pc.PCNum AS PCNum
          FROM PC pc
          INNER JOIN PT pt ON pc.PTNum = pt.PTNum
          LEFT JOIN PR pr ON pc.PRNum = pr.PRNum
          OUTER APPLY (
            SELECT TOP 1 
              pcfr.FRCode AS RoomCode,
              pcfr.FRName AS RoomName
            FROM PCFR pcfr
            WHERE pcfr.PCNum = pc.PCNum
              AND pcfr.PCFR_ST = 'AS'
              AND pcfr.ExitDate IS NULL
            ORDER BY pcfr.EntryDate DESC, pcfr.PCFRNum DESC
          ) v
          WHERE pc.PC_ST = 'OP' 
            AND pc.PCType = 'IP'
            AND pc.MedicalDischargeDate IS NULL
            AND (v.RoomName LIKE '%CAMA 1%' OR v.RoomName LIKE '%CAMA 2%')
            AND v.RoomName NOT LIKE '%URGENCIAS%'
            AND (v.RoomCode NOT LIKE 'CUBUTI%' AND v.RoomCode != 'CUNUCIN01')
            AND v.RoomName NOT LIKE '%VIRTUAL%'
            AND v.RoomName NOT LIKE '%VIRT%'
            AND v.RoomCode NOT LIKE '%VIRT%'
        `);
        occupiedBeds = liveBedsRes.recordset || [];
      } catch (e) {
        console.error('[SAP/Vertical] Error al consultar camas Hospitalización en vivo:', e.message);
      }

      const masterBedsRes = await pgPool.query(`
        SELECT DISTINCT roomcode as "RoomCode", roomname as "RoomName"
        FROM dw_vertical_pt
        WHERE (roomname LIKE '%CAMA 1%' OR roomname LIKE '%CAMA 2%')
          AND roomname NOT LIKE '%URGENCIAS%'
          AND roomcode NOT LIKE 'CUBUTI%'
          AND roomname NOT LIKE '%VIRTUAL%'
          AND roomname NOT LIKE '%VIRT%'
          AND roomcode NOT LIKE '%VIRT%'
        ORDER BY roomcode ASC
      `);
      const masterBeds = masterBedsRes.rows;

      const bedsMap = {};
      masterBeds.forEach(b => {
        bedsMap[b.RoomCode] = { 
          RoomCode: b.RoomCode, RoomName: b.RoomName, Estado: 'LIBRE', 
          Paciente: null, Medico: null, FechaIngreso: null, PCNum: null, totalCargos: 0
        };
      });

      let activeChargesMap = {};
      if (occupiedBeds.length > 0) {
        const activeFolios = occupiedBeds.map(o => o.PCNum).filter(Boolean);
        if (activeFolios.length > 0) {
          const activeChargesRes = await pgPool.query(`
            SELECT folio_de_atencion as folio, SUM(total_cobrado)::float as total_cargos
            FROM dw_vertical_cuentas_servicios
            WHERE folio_de_atencion = ANY($1)
              AND grupo_de_articulos != 'TERAPIA INTENSIVA  E INTERMEDIA' 
              AND unidad_de_servicio NOT IN ('UCI', 'UCIN', 'URG1', 'URG2')
            GROUP BY folio_de_atencion
          `, [activeFolios]);
          activeChargesRes.rows.forEach(r => {
            activeChargesMap[r.folio] = r.total_cargos;
          });
        }
      }

      occupiedBeds.forEach(o => {
        const code = o.RoomCode ? o.RoomCode.trim() : null;
        if (code) {
          if (!bedsMap[code]) {
            bedsMap[code] = {
              RoomCode: code, RoomName: o.RoomName || code, Estado: 'LIBRE',
              Paciente: null, Medico: null, FechaIngreso: null, PCNum: null, totalCargos: 0
            };
          }
          bedsMap[code] = {
            ...bedsMap[code],
            Estado: 'OCUPADA', Paciente: o.Paciente, Medico: o.Medico,
            FechaIngreso: o.FechaIngreso, PCNum: o.PCNum,
            totalCargos: activeChargesMap[o.PCNum] || 0
          };
        }
      });

      return {
        occupiedBeds,
        censoCamas: Object.values(bedsMap).sort((a,b) => a.RoomCode.localeCompare(b.RoomCode))
      };
    };

    const fetchClinical = async () => {
      let totalEgresos = 0;
      let defunciones = 0;
      let totalDias = 0;

      if (split.pgStart && split.pgEnd) {
        const pgStats = await pgPool.query(`
          SELECT 
            COUNT(DISTINCT pc.pcnum)::int as total_egresos,
            SUM(CASE WHEN (pt.roomcode LIKE '%DEF%' OR pc.medicaldischargedate = pc.entrydate) THEN 1 ELSE 0 END)::int as defunciones,
            COALESCE(SUM(EXTRACT(EPOCH FROM (pc.medicaldischargedate - pc.entrydate)) / 86400.0), 0)::float as total_dias
          FROM dw_vertical_pc pc
          JOIN dw_vertical_pt pt ON pc.ptnum = pt.ptnum
          WHERE pc.pc_st = 'CL' AND pc.pctype = 'IP'
            AND pc.medicaldischargedate >= $1 AND pc.medicaldischargedate <= $2
            AND (pt.roomcode NOT LIKE 'CUBUTI%' AND pt.roomcode != 'CUNUCIN01')
        `, [split.pgStart, split.pgEnd + ' 23:59:59']);

        if (pgStats.rows.length > 0) {
          totalEgresos += pgStats.rows[0].total_egresos || 0;
          defunciones += pgStats.rows[0].defunciones || 0;
          totalDias += pgStats.rows[0].total_dias || 0;
        }
      }

      if (split.hasToday && split.remoteStart) {
        try {
          const mssqlPool = await connectRemoteDB();
          const statsRes = await mssqlPool.request()
            .input('startDate', split.remoteStart.substring(0, 10))
            .input('endDate', split.remoteEnd || new Date())
            .query(`
              SELECT 
                COUNT(DISTINCT pc.PCNum) as TotalEgresos,
                SUM(CASE WHEN pc.MedicalDischarge IN ('DEF', 'DEFUNCION', 'MD003') OR pc.DateOfDeath IS NOT NULL THEN 1 ELSE 0 END) as Defunciones,
                COALESCE(SUM(CAST(DATEDIFF(day, pc.Date, pc.MedicalDischargeDate) AS FLOAT)), 0) as TotalDias
              FROM PC pc
              WHERE pc.PC_ST = 'CL' AND pc.PCType = 'IP'
                AND pc.MedicalDischargeDate >= @startDate AND pc.MedicalDischargeDate <= @endDate
            `);
          if (statsRes.recordset && statsRes.recordset.length > 0) {
            totalEgresos += statsRes.recordset[0].TotalEgresos || 0;
            defunciones += statsRes.recordset[0].Defunciones || 0;
            totalDias += statsRes.recordset[0].TotalDias || 0;
          }
        } catch (e) {
          console.error('[Hospitalizacion Live Stats]', e.message);
        }
      }

      const estanciaPromedio = totalEgresos > 0 ? parseFloat((totalDias / totalEgresos).toFixed(1)) : 0;
      return { TotalEgresos: totalEgresos, Defunciones: defunciones, EstanciaPromedio: estanciaPromedio };
    };

    // Consultas Financieras en PostgreSQL en paralelo
    const fetchFinanzas = async () => {
      const [finRes, sapRes, grupoRes, insumosRes, listaPacientesRes] = await Promise.all([
        pgPool.query(`
          SELECT COUNT(DISTINCT folio_de_atencion)::int as total_pacientes
          FROM dw_vertical_cuentas_servicios
          WHERE (grupo_de_articulos != 'TERAPIA INTENSIVA  E INTERMEDIA' AND unidad_de_servicio NOT IN ('UCI', 'UCIN', 'URG1', 'URG2'))
            AND folio_de_atencion IN (SELECT pcnum FROM dw_vertical_pc WHERE pctype = 'IP')
            AND fecha_de_cargo >= $1 AND fecha_de_cargo <= $2
        `, [effectiveStartDate, effectiveEndDate]),

        pgPool.query(`
          SELECT SUM(total) as total_facturado 
          FROM dw_sap_ingresos_grupos
          WHERE docdate >= $1 AND docdate <= $2
            AND itmsgrpcod NOT IN (104, 111, 101, 115, 117, 109, 105, 103)
        `, [effectiveStartDate.substring(0,10), effectiveEndDate.substring(0,10)]).catch(() => ({ rows: [{ total_facturado: 0 }] })),

        pgPool.query(`
          SELECT 
            grupo_de_articulos as "grupo", 
            COALESCE(SUM(total_cobrado), 0)::float as "total"
          FROM dw_vertical_cuentas_servicios
          WHERE (grupo_de_articulos != 'TERAPIA INTENSIVA  E INTERMEDIA' AND unidad_de_servicio NOT IN ('UCI', 'UCIN', 'URG1', 'URG2'))
            AND folio_de_atencion IN (SELECT pcnum FROM dw_vertical_pc WHERE pctype = 'IP')
            AND fecha_de_cargo >= $1 AND fecha_de_cargo <= $2
          GROUP BY grupo_de_articulos
          ORDER BY total DESC
        `, [effectiveStartDate, effectiveEndDate]),

        pgPool.query(`
          SELECT 
            descripcion_del_articulo as "nombre", 
            SUM(cantidad)::float as "cantidad", 
            COALESCE(SUM(total_cobrado), 0)::float as "total"
          FROM dw_vertical_cuentas_servicios
          WHERE (grupo_de_articulos != 'TERAPIA INTENSIVA  E INTERMEDIA' AND unidad_de_servicio NOT IN ('UCI', 'UCIN', 'URG1', 'URG2'))
            AND folio_de_atencion IN (SELECT pcnum FROM dw_vertical_pc WHERE pctype = 'IP')
            AND fecha_de_cargo >= $1 AND fecha_de_cargo <= $2
            AND grupo_de_articulos NOT LIKE '%ESTANCIA%'
          GROUP BY descripcion_del_articulo
          ORDER BY total DESC
          LIMIT 10
        `, [effectiveStartDate, effectiveEndDate]),

        pgPool.query(`
          SELECT 
            s.folio_de_atencion as "folio",
            MAX(s.nombre_del_paciente) as "paciente",
            MIN(pc.entrydate) as "entrydate",
            MAX(pc.medicaldischargedate) as "medicaldischargedate",
            COALESCE(MAX(s.medico_tratante), MAX(s.medico_solicitante)) as "medico",
            SUM(s.total_cobrado)::float as "total_cargos",
            pc.pc_st as "status",
            MAX(pt.roomname) as "room"
          FROM dw_vertical_cuentas_servicios s
          LEFT JOIN dw_vertical_pc pc ON s.folio_de_atencion = pc.pcnum
          LEFT JOIN dw_vertical_pt pt ON pc.ptnum = pt.ptnum
          WHERE (s.grupo_de_articulos != 'TERAPIA INTENSIVA  E INTERMEDIA' AND s.unidad_de_servicio NOT IN ('UCI', 'UCIN', 'URG1', 'URG2'))
            AND pc.pctype = 'IP'
            AND s.fecha_de_cargo >= $1 AND s.fecha_de_cargo <= $2
          GROUP BY s.folio_de_atencion, pc.pc_st
          ORDER BY entrydate DESC
          LIMIT 500
        `, [effectiveStartDate, effectiveEndDate])
      ]);

      return {
        totalPacientes: finRes.rows[0]?.total_pacientes || 0,
        totalFacturado: parseFloat(sapRes.rows[0]?.total_facturado) || 0,
        ingresosPorGrupo: grupoRes.rows,
        topInsumos: insumosRes.rows,
        listaPacientes: listaPacientesRes.rows
      };
    };

    const [censoResult, clinicalStats, finanzasResult] = await Promise.all([
      fetchCenso(),
      fetchClinical(),
      fetchFinanzas()
    ]);

    const totalEgresos = clinicalStats.TotalEgresos;
    const defunciones = clinicalStats.Defunciones;
    const tasaMortalidad = totalEgresos > 0 ? parseFloat(((defunciones * 100) / totalEgresos).toFixed(1)) : 0;
    const camasOcupadas = censoResult.occupiedBeds.length;
    const totalCamas = censoResult.censoCamas.length;
    const ocupacionPct = totalCamas > 0 ? parseFloat(((camasOcupadas * 100) / totalCamas).toFixed(1)) : 0;

    const responsePayload = {
      ok: true,
      data: {
        kpis: {
          totalFacturado: finanzasResult.totalFacturado,
          totalPacientes: finanzasResult.totalPacientes,
          estanciaPromedio: clinicalStats.EstanciaPromedio,
          tasaMortalidad,
          camasOcupadas,
          totalCamas,
          ocupacionPct
        },
        censoCamas: censoResult.censoCamas,
        ingresosPorGrupo: finanzasResult.ingresosPorGrupo,
        topInsumos: finanzasResult.topInsumos,
        listaPacientes: finanzasResult.listaPacientes
      }
    };

    dashboardCache.set(cacheKey, responsePayload, 60);
    res.json(responsePayload);

  } catch (err) {
    console.error('Error en hospitalizacion-nativo:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;

