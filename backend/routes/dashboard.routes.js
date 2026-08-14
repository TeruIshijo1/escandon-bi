/**
 * dashboard.routes.js — Endpoints de dashboard y KPIs
 * Hospital Escandón BI Platform v1.0
 */
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

// Asegurar que las consultas de analíticas de Quirófano de SAP B1 existan al arrancar
const initSapQueries = async () => {
  try {
    const sqlMedText = `
      SELECT 
        T0.U_PRName AS nombre,
        SUM(T1.LineTotal) AS ingresos
      FROM OINV T0
      INNER JOIN INV1 T1 ON T0.DocEntry = T1.DocEntry
      INNER JOIN OITM T2 ON T1.ItemCode = T2.ItemCode
      WHERE T2.ItmsGrpCod = 111 
        AND T0.DocDate >= :startDate 
        AND T0.DocDate <= :endDate
        AND T0.U_PRName IS NOT NULL AND T0.U_PRName <> ''
      GROUP BY T0.U_PRName
    `;

    const sqlSrvText = `
      SELECT 
        T1.Dscription AS nombre,
        SUM(T1.LineTotal) AS ingresos
      FROM OINV T0
      INNER JOIN INV1 T1 ON T0.DocEntry = T1.DocEntry
      INNER JOIN OITM T2 ON T1.ItemCode = T2.ItemCode
      WHERE T2.ItmsGrpCod = 111 
        AND T0.DocDate >= :startDate 
        AND T0.DocDate <= :endDate
      GROUP BY T1.Dscription
    `;

    const sqlTotalText = `
      SELECT 
        SUM(T1.LineTotal) AS ingresos
      FROM OINV T0
      INNER JOIN INV1 T1 ON T0.DocEntry = T1.DocEntry
      INNER JOIN OITM T2 ON T1.ItemCode = T2.ItemCode
      WHERE T2.ItmsGrpCod = 111 
        AND T0.DocDate >= :startDate 
        AND T0.DocDate <= :endDate
    `;

    await sapService._ensureSession();

    const ensureQuery = async (code, text) => {
      try {
        await sapService.post('/SQLQueries', { SqlCode: code, SqlName: code, SqlText: text });
      } catch (e) {
        try {
          await sapService.patch(`/SQLQueries('${code}')`, { SqlName: code, SqlText: text });
        } catch (err) {
          // Ignorar si ya está registrada correctamente
        }
      }
    };

    await ensureQuery('sq_quirofano_top_medicos', sqlMedText);
    await ensureQuery('sq_quirofano_top_servicios', sqlSrvText);
    await ensureQuery('sq_quirofano_ingresos_totales', sqlTotalText);

    // SQLQueries para KPIs Financieros (Dashboard Finanzas Nativo)
    const sqlORCT = `
      SELECT 
        SUM(DocTotal) as "DocTotal", 
        SUM(CashSum) as "CashSum", 
        SUM(CreditSum) as "CreditSum", 
        SUM(CheckSum) as "CheckSum", 
        SUM(TrsfrSum) as "TrsfrSum" 
      FROM ORCT 
      WHERE DocDate >= :startDate AND DocDate <= :endDate AND Canceled = 'N'
    `;
    const sqlOPCH = `
      SELECT 
        SUM(DocTotal) as "DocTotal" 
      FROM OPCH 
      WHERE DocDate >= :startDate AND DocDate <= :endDate AND Canceled = 'N'
    `;
    await ensureQuery('sq_finanzas_kpi_ingresos', sqlORCT);
    await ensureQuery('sq_finanzas_kpi_egresos', sqlOPCH);

    console.log('[SAP] Queries de analítica de Quirófano y Finanzas inicializadas exitosamente.');
  } catch (err) {
    console.error('[SAP] Error al inicializar queries de Quirófano:', err.message);
  }
};
setTimeout(initSapQueries, 5000);

/**
 * GET /api/dashboard/directivo
 * Retorna los KPIs consolidados para el Dashboard Directivo.
 * Roles: ADMIN, DIRECTOR
 */
router.get(
  '/directivo',
  authenticate,
  authorize(['ADMIN', 'DIRECTOR']),
  async (req, res, next) => {
    try {
      const db = getDb();

      // 1. Ocupación global
      const ocupacion = db.prepare(`
        SELECT
          COUNT(*)                                                           AS TotalCamas,
          SUM(CASE WHEN Estado = 'OCUPADA' THEN 1 ELSE 0 END)               AS Ocupadas,
          ROUND(
            CAST(SUM(CASE WHEN Estado = 'OCUPADA' THEN 1 ELSE 0 END) AS REAL)
            * 100.0 / MAX(COUNT(*), 1)
          , 1)                                                               AS PctOcupacion
        FROM Camas WHERE Activo = 1
      `).get();

      // 2. KPIs de eficacia clínica
      const eficacia = db.prepare(`
        SELECT
          ROUND(
            CAST(SUM(CASE WHEN TipoEgreso='DEFUNCION' THEN 1 ELSE 0 END) AS REAL)
            * 100.0 / MAX(COUNT(*), 1)
          , 2) AS TasaMortalidad,
          COUNT(*) AS TotalEgresos,
          ROUND(AVG(CAST(julianday(e.FechaEgreso) - julianday(a.FechaIngreso) AS REAL)), 1) AS EstanciaPromedio
        FROM Egresos e
        JOIN Admisiones a ON a.AdmisionId = e.AdmisionId
        WHERE e.FechaEgreso >= datetime('now', '-1 month')
      `).get();

      // 3. Producción quirúrgica
      const produccion = db.prepare(`
        SELECT
          COUNT(*) AS CirugiasHoy,
          SUM(CASE WHEN Estado='REALIZADA'  THEN 1 ELSE 0 END) AS Realizadas,
          SUM(CASE WHEN Estado='CANCELADA'  THEN 1 ELSE 0 END) AS Canceladas,
          SUM(CASE WHEN Estado='EN_CURSO'   THEN 1 ELSE 0 END) AS EnCurso
        FROM ProgramacionQuirofano
        WHERE date(FechaCirugia) = date('now')
      `).get();

      // 4. Macropanel Financiero (Simulado con datos de cargos si existen, o valores base reales)
      // En una implementación real, esto vendría de una tabla de Finanzas o Facturación.
      // Aquí usaremos los montos de AuditoriaInventarioCargos como referencia.
      const financiero = db.prepare(`
        SELECT 
          IFNULL(SUM(MontoDisputa), 0) AS MontoEnDisputa,
          (SELECT IFNULL(SUM(PrecioUnitario * CantidadSurtida), 0) FROM AlmacenOrdenes WHERE FechaSurtido >= datetime('now', 'start of month')) AS CostoInsumosMes
        FROM AuditoriaInventarioCargos
        WHERE FechaAuditoria >= datetime('now', 'start of month')
      `).get();

      // 5. Estado por Área (Censo)
      const censo = db.prepare(`
        SELECT Area, COUNT(*) as Ocupadas 
        FROM Camas 
        WHERE Estado = 'OCUPADA' 
        GROUP BY Area
      `).all();

      // 6. Sobrescribir con Mapeos Dinámicos (Data Hub)
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

/**
 * GET /api/dashboard/area/:area
 * KPIs específicos del área solicitada.
 * Roles: todos (filtrado por área para Jefe y Operativo)
 */
router.get(
  '/area/:area',
  authenticate,
  authorizeArea(['ADMIN', 'DIRECTOR']),
  async (req, res, next) => {
    try {
      const db   = getDb();
      const area = req.areaFilter || req.params.area;

      const camas = db.prepare(`
        SELECT
          COUNT(*) AS TotalCamas,
          SUM(CASE WHEN Estado='OCUPADA' THEN 1 ELSE 0 END) AS Ocupadas,
          ROUND(
            CAST(SUM(CASE WHEN Estado='OCUPADA' THEN 1 ELSE 0 END) AS REAL)
            * 100.0 / MAX(COUNT(*), 1)
          , 1) AS PctOcupacion
        FROM Camas WHERE Area = ? AND Activo = 1
      `).get(area);

      const egresos = db.prepare(`
        SELECT
          COUNT(*) AS EgresosMes,
          AVG(CAST(julianday(e.FechaEgreso) - julianday(a.FechaIngreso) AS INTEGER)) AS EstanciaPromedio,
          ROUND(
            CAST(COUNT(*) AS REAL) /
            MAX((SELECT COUNT(*) FROM Camas WHERE Area = ?), 1)
          , 2) AS RotacionCamas
        FROM Egresos e
        JOIN Admisiones a ON a.AdmisionId = e.AdmisionId
        WHERE e.AreaEgreso = ?
          AND e.FechaEgreso >= datetime('now', '-1 month')
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

// Datos del Excel histórico (2024 - marzo 2026) para KPIs consolidados
const histPath = path.join(__dirname, '../data/excel_stats_history.json');
let excelStatsHistory = {};
try {
  if (fs.existsSync(histPath)) {
    excelStatsHistory = JSON.parse(fs.readFileSync(histPath, 'utf8'));
  }
} catch (e) {
  console.error('Error al cargar excel_stats_history.json:', e.message);
}

// Función para obtener valores proporcionales del Excel según el rango de fechas
const getExcelProportionalValue = (table, startDate, endDate) => {
  let total = 0;
  const limit = new Date('2026-03-31T23:59:59');
  if (startDate > limit) return 0;

  const targetEnd = endDate < limit ? endDate : limit;
  let current = new Date(startDate.getFullYear(), startDate.getMonth(), 1);

  // Mapear la tabla a las claves reales del archivo JSON del Excel
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

/**
 * GET /api/dashboard/stats
 * Estadísticas demográficas y operativas reales
 */
router.get(
  '/stats',
  authenticate,
  async (req, res, next) => {
    try {
      const db = getDb();
      const periodo = req.query.periodo || 'mes';

      // Calcular objetos Date
      const endDateObj = new Date();
      let startDateObj = new Date();
      if (periodo === 'semana')    startDateObj.setDate(endDateObj.getDate() - 7);
      else if (periodo === 'trimestre') startDateObj.setMonth(endDateObj.getMonth() - 3);
      else if (periodo === 'año')       { startDateObj = new Date(endDateObj.getFullYear(), 0, 1); } // 1 de enero del año actual
      else startDateObj.setMonth(endDateObj.getMonth() - 1); // default mes

      const transitionDate = new Date('2026-04-01T00:00:00');
      const toSqlDate = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

      // 1. Obtener valores proporcionales del Excel histórico
      const excelEgresos = getExcelProportionalValue('egresos', startDateObj, endDateObj);
      const excelNacimientos = getExcelProportionalValue('nacimientos', startDateObj, endDateObj);
      const excelVidasSalvadas = getExcelProportionalValue('vidasSalvadas', startDateObj, endDateObj);
      const excelEstanciaDias = getExcelProportionalValue('estanciaDias', startDateObj, endDateObj);

      // Determinar si hay un rango que requiera consultar la base activa
      const hasActiveRange = endDateObj >= transitionDate;
      const activeStartDate = startDateObj > transitionDate ? startDateObj : transitionDate;
      const activeStartDateStr = toSqlDate(activeStartDate);
      const fullStartDateStr = toSqlDate(startDateObj);

      let dbEgresos = 0;
      let dbEstanciaTotalDias = 0;
      let dbNacimientos = 0;
      let dbVidasSalvadas = 0;
      let pctFemenino = 0;
      
      let generalDemo = { PromedioEdad: 0, Defunciones: 0 };
      let facturacionArea = [];
      let topMedicos = [];

      try {
        const pool = await connectRemoteDB();

        // 2. Consulta Demográfica General (Toda la base sobre el periodo completo)
        const demoRes = await pool.request().query(`
          SELECT 
            ROUND(AVG(CAST(DATEDIFF(year, BirthDate, GETDATE()) AS FLOAT)), 1) AS PromedioEdad,
            SUM(CASE WHEN MedicalDischarge IN ('DEF', 'DEFUNCION', 'MD003') OR DateOfDeath IS NOT NULL THEN 1 ELSE 0 END) AS Defunciones
          FROM PC
          WHERE MedicalDischargeDate >= '${fullStartDateStr}'
            AND PC_ST = 'CL'
        `);

        if (demoRes.recordset && demoRes.recordset.length > 0) {
          generalDemo = {
            PromedioEdad: demoRes.recordset[0].PromedioEdad || 0,
            Defunciones: demoRes.recordset[0].Defunciones || 0
          };
        }

        const generosRes = await pool.request().query(`
          SELECT Gender as Genero, COUNT(*) as Cantidad
          FROM PC
          WHERE MedicalDischargeDate >= '${fullStartDateStr}'
            AND PC_ST = 'CL'
          GROUP BY Gender
        `);
        const generos = generosRes.recordset || [];
        const totalGen = generos.reduce((s, g) => s + g.Cantidad, 0);
        pctFemenino = totalGen > 0 
          ? ((generos.find(g => g.Genero === 'F' || g.Genero === 'FEMENINO')?.Cantidad || 0) * 100 / totalGen).toFixed(1)
          : 0;

        // 3. Consultar volumen activo si aplica (Desde el 1 de abril de 2026 en adelante)
        if (hasActiveRange) {
          const activeVolRes = await pool.request().query(`
            SELECT 
              COUNT(*) AS TotalEgresos,
              SUM(CAST(DATEDIFF(day, Date, MedicalDischargeDate) AS FLOAT)) AS EstanciaTotalDias,
              (
                 SELECT COUNT(DISTINCT p2.PTNum) 
                 FROM PC p2 
                 JOIN PT pt ON p2.PTNum = pt.PTNum
                 JOIN V_MRPT v ON p2.PTNum = v.PTNum 
                 WHERE p2.MedicalDischargeDate >= '${activeStartDateStr}' 
                   AND p2.PC_ST = 'CL' 
                   AND (v.RoomName LIKE '%CUNERO%' OR v.RoomCode LIKE '%CUN%')
                   AND DATEDIFF(day, pt.BirthDate, p2.Date) = 0
              ) AS Nacimientos
            FROM PC
            WHERE MedicalDischargeDate >= '${activeStartDateStr}'
              AND PC_ST = 'CL'
          `);

          if (activeVolRes.recordset && activeVolRes.recordset.length > 0) {
            dbEgresos = activeVolRes.recordset[0].TotalEgresos || 0;
            dbEstanciaTotalDias = activeVolRes.recordset[0].EstanciaTotalDias || 0;
            dbNacimientos = activeVolRes.recordset[0].Nacimientos || 0;
          }

          // Consultar Vidas Salvadas activas desde SAP
          try {
            const vsRes = await sapService.get(`/SQLQueries('VidasSalvChoque')/List?startDate='${activeStartDateStr}'`);
            dbVidasSalvadas = vsRes.data?.value[0]?.VidasSalvadas || 0;
          } catch (vsErr) {
            console.error("Error fetching Vidas Salvadas (SAP):", vsErr.error || vsErr);
          }
        }

        // 4. Facturación por área (Periodo completo)
        const factRes = await pool.request().query(`
          SELECT 
            UNIDAD_DE_SERVICIO as area, 
            SUM(TOTAL_COBRADO) as n
          FROM UDR_CUENTAS_SERVICIOS
          WHERE FECHA_DE_CARGO >= '${fullStartDateStr}'
          GROUP BY UNIDAD_DE_SERVICIO
          ORDER BY n DESC
        `);
        
        const areaLabels = {
          'URG': 'URGENCIAS',
          'QUI': 'QUIROFANO',
          'LAB': 'LABORATORIO',
          'IMA': 'IMAGENOLOGIA',
          'FAR': 'FARMACIA',
          'HOS': 'HOSPITALIZACION',
          'CUN': 'CUNEROS',
          'CE':  'CONSULTA EXTERNA'
        };
        
        facturacionArea = (factRes.recordset || []).map(r => ({
          dx: areaLabels[r.area] || r.area || 'OTRO',
          n: r.n,
          pct: 0
        }));
        
        const totalFact = facturacionArea.reduce((sum, item) => sum + item.n, 0);
        facturacionArea.forEach(item => {
          item.pct = totalFact > 0 ? (item.n * 100 / totalFact).toFixed(1) : 0;
        });

        // 5. Top Médicos (Periodo completo)
        const medRes = await pool.request().query(`
          SELECT TOP 10
            Medico as area,
            SUM(IngresosTotales) as n,
            'SIN ESPECIALIDAD' as Especialidad
          FROM UDR_BI_INGRESOS_MEDICOS
          WHERE DATEFROMPARTS(Anio, Mes, 1) >= '${fullStartDateStr}'
          GROUP BY Medico
          ORDER BY n DESC
        `);

        topMedicos = (medRes.recordset || []).map(r => ({
          area: r.area,
          n: r.n,
          especialidad: r.Especialidad
        }));

      } catch (err) {
        console.error("Error fetching stats from KH_HE:", err);
      }

      // Consolidar resultados (Excel Histórico + DB Activa)
      const totalEgresos = Math.round(excelEgresos) + dbEgresos;
      const totalNacimientos = Math.round(excelNacimientos) + dbNacimientos;
      const totalVidasSalvadas = Math.round(excelVidasSalvadas) + dbVidasSalvadas;
      const totalEstanciaDias = excelEstanciaDias + dbEstanciaTotalDias;

      res.json({
        ok: true,
        data: {
          general: {
            TotalEgresos: totalEgresos,
            PromedioEdad: generalDemo.PromedioEdad || 0,
            Defunciones: generalDemo.Defunciones || 0,
            EstanciaPromedio: totalEgresos > 0 ? parseFloat((totalEstanciaDias / totalEgresos).toFixed(1)) : 0,
            Nacimientos: totalNacimientos,
            pctFemenino,
            VidasSalvadas: totalVidasSalvadas
          },
          diagnosticos: facturacionArea,
          servicios: topMedicos
        }
      });
    } catch (err) {
      next(err);
    }
  }
);
// Mapeo de secciones del Excel a consultas analíticas del HIS (SQL Server)
const mapSectionToQuery = (section) => {
  switch (section) {
    case '02_NACIMIENTOS':
      return `
        SELECT MONTH(p2.MedicalDischargeDate) AS mes, COUNT(DISTINCT p2.PTNum) AS total
        FROM PC p2 
        JOIN PT pt ON p2.PTNum = pt.PTNum
        JOIN V_MRPT v ON p2.PTNum = v.PTNum 
        WHERE p2.MedicalDischargeDate >= '2026-04-01' AND p2.MedicalDischargeDate <= '2026-12-31'
          AND p2.PC_ST = 'CL' 
          AND (v.RoomName LIKE '%CUNERO%' OR v.RoomCode LIKE '%CUN%')
          AND DATEDIFF(day, pt.BirthDate, p2.Date) = 0
        GROUP BY MONTH(p2.MedicalDischargeDate)
      `;
    case '03_CUENTAS HOSPITALARIAS (HOSPITALIZACIÓN)':
      return `
        SELECT MONTH(MedicalDischargeDate) AS mes, COUNT(*) AS total
        FROM PC
        WHERE MedicalDischargeDate >= '2026-04-01' AND MedicalDischargeDate <= '2026-12-31'
          AND PC_ST = 'CL' AND PCType = 'IP'
        GROUP BY MONTH(MedicalDischargeDate)
      `;
    case '03_CUENTAS HOSPITALARIAS DE URGENCIAS':
      return `
        SELECT MONTH(MedicalDischargeDate) AS mes, COUNT(*) AS total
        FROM PC
        WHERE MedicalDischargeDate >= '2026-04-01' AND MedicalDischargeDate <= '2026-12-31'
          AND PC_ST = 'CL' AND PCType = 'ER'
        GROUP BY MONTH(MedicalDischargeDate)
      `;
    case '03_CUENTAS HOSPITALARIAS DE VA - SEGURO':
      return `
        SELECT MONTH(pc.MedicalDischargeDate) AS mes, COUNT(DISTINCT pc.PCNum) AS total
        FROM PC pc
        WHERE pc.MedicalDischargeDate >= '2026-04-01' AND pc.MedicalDischargeDate <= '2026-12-31'
          AND pc.PC_ST = 'CL'
          AND EXISTS (SELECT 1 FROM PCAG ag WHERE ag.PCNum = pc.PCNum)
        GROUP BY MONTH(pc.MedicalDischargeDate)
      `;
    case '04_ADMISIÓN CONTINUA (CONSULTAS DE URGENCIAS)':
      return `
        SELECT MONTH(Date) AS mes, COUNT(*) AS total
        FROM PC
        WHERE Date >= '2026-04-01' AND Date <= '2026-12-31'
          AND PCType = 'ER'
        GROUP BY MONTH(Date)
      `;
    case '05_ESTANCIA':
      return `
        SELECT MONTH(MedicalDischargeDate) AS mes, SUM(DATEDIFF(day, Date, MedicalDischargeDate)) AS total
        FROM PC
        WHERE MedicalDischargeDate >= '2026-04-01' AND MedicalDischargeDate <= '2026-12-31'
          AND PC_ST = 'CL' AND PCType = 'IP'
        GROUP BY MONTH(MedicalDischargeDate)
      `;
    case '06_TERAPIA INTENSIVA (SER501, SER600, SER710, SER730)':
      return `
        SELECT MONTH(FECHA_DE_CARGO) AS mes, COUNT(DISTINCT CUENTA) AS total
        FROM UDR_CUENTAS_SERVICIOS
        WHERE FECHA_DE_CARGO >= '2026-04-01' AND FECHA_DE_CARGO <= '2026-12-31'
          AND (CODIGO_DEL_ARTICULO IN ('SER501', 'SER600', 'SER710', 'SER730') OR DESCRIPCION_DEL_ARTICULO LIKE '%TERAPIA%')
        GROUP BY MONTH(FECHA_DE_CARGO)
      `;
    case '07_PERSONAS EN QX (USOQX1HR)':
      return `
        SELECT MONTH(FechaInicio) AS mes, COUNT(DISTINCT CUENTA) AS total
        FROM UDR_USOQX
        WHERE FechaInicio >= '2026-04-01' AND FechaInicio <= '2026-12-31'
        GROUP BY MONTH(FechaInicio)
      `;
    case '13_ESTADÍSTICO DE CIRUGÍAS':
      return `
        SELECT MONTH(FechaInicio) AS mes, COUNT(*) AS total
        FROM UDR_USOQX
        WHERE FechaInicio >= '2026-04-01' AND FechaInicio <= '2026-12-31'
        GROUP BY MONTH(FechaInicio)
      `;
    case '08_CX ENDOSCOPIA, COLONOSCOPIA, BRONCOSCOPIA, PANENDOSCOPIA':
      return `
        SELECT MONTH(FECHA_DE_CARGO) AS mes, COUNT(DISTINCT CUENTA) AS total
        FROM UDR_CUENTAS_SERVICIOS
        WHERE FECHA_DE_CARGO >= '2026-04-01' AND FECHA_DE_CARGO <= '2026-12-31'
          AND (DESCRIPCION_DEL_ARTICULO LIKE '%ENDOSCOP%' OR DESCRIPCION_DEL_ARTICULO LIKE '%COLONOSCOP%' OR DESCRIPCION_DEL_ARTICULO LIKE '%BRONCOSCOP%')
        GROUP BY MONTH(FECHA_DE_CARGO)
      `;
    case '09_CONSULTAS DE ESPECIALIDAD':
      return `
        SELECT MONTH(Fecha) AS mes, COUNT(*) AS total
        FROM V_UDR_CONSULTA_DIA
        WHERE Fecha >= '2026-04-01' AND Fecha <= '2026-12-31'
        GROUP BY MONTH(Fecha)
      `;
    case '10_ESTADISTICO DE EST. IMAGEN':
      return `
        SELECT MONTH(FECHA_DE_CARGO) AS mes, COUNT(*) AS total
        FROM UDR_CUENTAS_SERVICIOS
        WHERE FECHA_DE_CARGO >= '2026-04-01' AND FECHA_DE_CARGO <= '2026-12-31'
          AND UNIDAD_DE_SERVICIO = 'IMA'
        GROUP BY MONTH(FECHA_DE_CARGO)
      `;
    case '11_ESTADISTICO EST. LABORA':
      return `
        SELECT MONTH(FECHA_DE_CARGO) AS mes, COUNT(*) AS total
        FROM UDR_CUENTAS_SERVICIOS
        WHERE FECHA_DE_CARGO >= '2026-04-01' AND FECHA_DE_CARGO <= '2026-12-31'
          AND UNIDAD_DE_SERVICIO = 'LAB'
        GROUP BY MONTH(FECHA_DE_CARGO)
      `;
    default:
      return null;
  }
};

/**
 * GET /api/dashboard/stats-historico
 * Retorna la matriz de datos de la sección de estadísticas (Excel + SAP/HIS vivo)
 */
router.get(
  '/stats-historico',
  authenticate,
  async (req, res, next) => {
    try {
      const { seccion } = req.query;
      if (!seccion) {
        return res.status(400).json({ ok: false, error: 'Sección requerida.' });
      }

      const histPath = path.join(__dirname, '../data/excel_stats_history.json');
      
      if (!fs.existsSync(histPath)) {
        return res.status(500).json({ ok: false, error: 'Historial de datos no disponible.' });
      }

      const histData = JSON.parse(fs.readFileSync(histPath, 'utf8'));
      const seccionData = histData[seccion];

      if (!seccionData) {
        return res.status(404).json({ ok: false, error: 'Sección no encontrada en el historial.' });
      }

      // Asegurar que el año 2026 exista en la estructura del Excel
      if (!seccionData['2026']) {
        seccionData['2026'] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0 };
      }

      // 2. Consultar datos activos (desde abril de 2026 en adelante)
      const activeData = { 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0 };

      if (seccion === '01_VIDAS SALVADAS') {
        try {
          const vsRes = await sapService.get(`/SQLQueries('VidasSalvChoqueDet')/List?startDate='2026-04-01'`);
          if (vsRes.data && vsRes.data.value) {
            vsRes.data.value.forEach(row => {
              if (row.FechaPrimeraOV && row.FechaPrimeraOV.length === 8) {
                const mes = parseInt(row.FechaPrimeraOV.substring(4, 6), 10);
                if (mes >= 4 && mes <= 12) {
                  activeData[mes] = (activeData[mes] || 0) + 1;
                }
              }
            });
          }
        } catch (e) {
          console.error('[SAP] Error al consultar vidas salvadas activas en historico:', e.message);
        }
      } else {
        const query = mapSectionToQuery(seccion);
        if (query) {
          try {
            const pool = await connectRemoteDB();
            const result = await pool.request().query(query);
            if (result.recordset) {
              result.recordset.forEach(row => {
                const mes = row.mes;
                const total = row.total || 0;
                if (mes >= 4 && mes <= 12) {
                  activeData[mes] = total;
                }
              });
            }
          } catch (e) {
            console.error(`[HIS] Error al consultar ${seccion} activo en historico:`, e.message);
          }
        }
      }

      // 3. Fusionar datos del Excel (Ene, Feb, Mar 2026) con la DB activa (Abr-Dic 2026)
      for (let m = 4; m <= 12; m++) {
        seccionData['2026'][m] = activeData[m] || 0;
      }

      res.json({
        ok: true,
        seccion,
        data: seccionData
      });

    } catch (err) {
      next(err);
    }
  }
);
/**
 * GET /api/dashboard/kpi-config
 * Devuelve la configuración de todos los KPIs para los dashboards.
 * Cualquier usuario autenticado puede leer esto.
 */
router.get('/kpi-config', authenticate, (req, res, next) => {
  try {
    const db   = getDb();
    const kpis = db.prepare(`
      SELECT ElementoId, Seccion,
             COALESCE(NombreCustom, NombreDefault) AS Nombre,
             NombreDefault, NombreCustom, Icono, PBIUrl, PBIUrl2, PBIUrl3, MultiPagina, JsonApiUrl, JsonFilePath
      FROM KPIConfig
      WHERE Activo = 1
    `).all();

    // Convertir a mapa { elementoId: { nombre, icono, pbiUrl, pbiUrl2, pbiUrl3, multiPagina } } para acceso O(1) en el frontend
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

/**
 * GET /api/dashboard/financiero-nativo
 * Pipeline de Calidad de Datos, Detección de Anomalías y Predicciones.
 */

router.get('/financiero-nativo/cuenta/:pcNum', authenticate, authorize(['ADMIN', 'DIRECTOR']), async (req, res) => {
  try {
    const { pcNum } = req.params;

    // Si pcNum no es un número (ej. CTE00029 o cve SAP), retornar respuesta vacía sin fallar en SQL
    if (isNaN(Number(pcNum)) || isNaN(parseInt(pcNum, 10))) {
      return res.json({ success: true, data: [] });
    }

    const pcNumInt = parseInt(pcNum, 10);
    let records = [];

    // 1. Intentar buscar en PostgreSQL DW (local)
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

    // 2. Si no hay registros locales, consultar SQL Server (en vivo)
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
    
    // Obtener los códigos de artículo distintos que no tienen descripción
    const missingDescItems = [...new Set(records.filter(r => !r.ItemDescription && r.ItemCode).map(r => r.ItemCode))];
    
    if (missingDescItems.length > 0) {
      const sapDescriptions = {};
      
      // Consultar SAP en lotes de 20 artículos por request para optimizar velocidad
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
          // ignorar si SAP no encuentra o hay un error en el lote
        }
      }
      
      // Update records
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

    // HARD CUTOFF: Ignorar datos antes del 1 de abril de 2026 (periodo de migración con errores)
    const MIN_DATE = '2026-04-01';

    // Si todo el rango buscado es anterior al corte, regresamos 0 registros de inmediato
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

    // 1. Obtener histórico desde PostgreSQL local
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
        Total: Number(row.Total),
        Profit: Number(row.Profit),
        SubtotalCost: Number(row.SubtotalCost),
        Balance: Number(row.Balance),
        FullName: row.FullName
      })));
    }

    // 2. Obtener lo nuevo (del día de hoy) desde SQL Server
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
          PT.FullName
        FROM PC
        LEFT JOIN PT ON PC.PTNum = PT.PTNum
        WHERE ${whereClauses.join(' AND ')}
      `;
      
      const result = await request.query(queryStr);
      rawData = rawData.concat(result.recordset);
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

    // 1. Depuración (Reglas de Negocio)
    rawData.forEach(row => {
      const isTest = row.FullName && (row.FullName.toUpperCase().includes('TEST') || row.FullName.toUpperCase().includes('PRUEBA'));
      const isClosed = row.PC_ST === 'CL'; // Finalizada
      const isPositive = (row.Total > 0);
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
        // CORRECCIÓN: El campo Profit de Cirrus tiene inconsistencias, lo calculamos matemáticamente
        row.Profit = row.Total - (row.SubtotalCost || 0);
        validRecords.push(row);
      }
    });

    audit.valido = validRecords.length;

    // 2. Agrupación por Mes y Detección de Outliers (IQR)
    let dataByMonth = {};
    validRecords.forEach(row => {
      let d = new Date(row.MedicalDischargeDate);
      let month = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      
      if (!dataByMonth[month]) {
        dataByMonth[month] = { records: [], Ingresos: 0, Utilidad: 0, Costos: 0, Balance: 0, outliersCount: 0 };
      }
      dataByMonth[month].records.push(row);
    });

    Object.keys(dataByMonth).forEach(month => {
      const mData = dataByMonth[month];
      const totals = mData.records.map(r => r.Total).sort((a,b) => a-b);
      
      // Calcular IQR
      if (totals.length >= 4) {
        const q1 = totals[Math.floor(totals.length * 0.25)];
        const q3 = totals[Math.floor(totals.length * 0.75)];
        const iqr = q3 - q1;
        const upperLimit = q3 + 1.5 * iqr;
        
        mData.records.forEach(r => {
          if (r.Total > upperLimit) mData.outliersCount++;
        });
      }

      audit.outliersEncontrados += mData.outliersCount;

      // Sumarizadores
      mData.records.forEach(r => {
        mData.Ingresos += r.Total || 0;
        mData.Utilidad += r.Profit || 0;
        mData.Costos += r.SubtotalCost || 0;
        mData.Balance += r.Balance || 0;
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

    // 3. Modelo Predictivo: Regresión Lineal Simple (Proyectar 3 meses)
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

        // Ultimo mes real
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

    // 3.5. Integrar Predicción de ML (IA) si existe
    try {
      const mlRes = await pgPool.query("SELECT periodo_predicho, ingreso_estimado FROM ml_forecast_ingresos_mensual WHERE area = 'GENERAL' AND servicio = 'TODOS'");
      if (mlRes.rows.length > 0) {
        mlRes.rows.forEach(mlRow => {
          const mlMonth = mlRow.periodo_predicho;
          const mlIngreso = Number(mlRow.ingreso_estimado);
          
          let existingPrediction = tendenciaMensual.find(m => m.month === mlMonth);
          if (existingPrediction) {
            existingPrediction.IngresosProyectados = mlIngreso;
            existingPrediction.isML = true; // Flag for frontend if needed
          }
        });
      }
    } catch(err) {
      console.error('[Dashboard] Error al mezclar ML forecast con dashboard financiero-nativo:', err);
    }

    // KPIs Generales Acumulados
    let totalIng = 0, totalUt = 0, totalCuentas = 0, totalCostos = 0;
    Object.keys(dataByMonth).forEach(m => {
      totalIng += dataByMonth[m].Ingresos;
      totalUt += dataByMonth[m].Utilidad;
      totalCuentas += dataByMonth[m].Balance;
      totalCostos += dataByMonth[m].Costos;
    });

    // 4. Cartera de Cobranza (Aging)
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
      if (row.Balance > 0) {
        const dateToUse = row.MedicalDischargeDate ? new Date(row.MedicalDischargeDate) : new Date(row.EntryDate);
        const diffDays = Math.floor((now - dateToUse.getTime()) / (1000 * 60 * 60 * 24));
        
        let bucket = '90+ días';
        if (diffDays <= 30) bucket = '0-30 días';
        else if (diffDays <= 60) bucket = '31-60 días';
        else if (diffDays <= 90) bucket = '61-90 días';

        carteraCobranza[bucket] += row.Balance;
        carteraCobranzaDetalle[bucket].push(row);
      }
    });

    // Ordenar por balance descendente y limitar a 50 para no saturar frontend
    Object.keys(carteraCobranzaDetalle).forEach(bucket => {
      carteraCobranzaDetalle[bucket].sort((a,b) => b.Balance - a.Balance);
      carteraCobranzaDetalle[bucket] = carteraCobranzaDetalle[bucket].slice(0, 50);
    });

    // Ordenar los registros válidos por fecha descendente y tomar los top 100
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
          margenPromedio: totalIng > 0 ? (totalUt / totalIng) * 100 : 0
        },
        audit
      }
    });
  } catch (err) {
    console.error('Error Pipeline DQ SQL:', err);
    res.status(500).json({ ok: false, error: 'Error procesando pipeline de datos.' });
  }
});

/**
 * GET /api/dashboard/eficiencia-nativo
 * Consulta la vista UDR_BI_INDICADORES_OPERATIVOS creada por el usuario
 */
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
    
    // Calcular promedios generales de los ultimos meses para los KPIs
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
    // 1. Obtener listado maestro de camas reales (excluyendo virtuales) de PostgreSQL (local)
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

    // 2. Obtener camas ocupadas actualmente (en vivo de SQL Server con join indexado rápido)
    const mssqlPool = await connectRemoteDB();
    const occupiedResult = await mssqlPool.request().query(`
      SELECT 
        v.RoomCode, 
        pt.FullName AS Paciente, 
        pr.FullName AS Medico
      FROM PC pc
      INNER JOIN PT pt ON pc.PTNum = pt.PTNum
      LEFT JOIN V_MRPT v ON pt.PTNum = v.PTNum
      LEFT JOIN PR pr ON pc.PRNum = pr.PRNum
      WHERE pc.PC_ST = 'OP' 
        AND pc.PCType IN ('IP', 'ER')
        AND pc.MedicalDischargeDate IS NULL
        AND v.RoomCode IS NOT NULL
        AND v.RoomName NOT LIKE '%VIRTUAL%'
        AND v.RoomName NOT LIKE '%VIRT%'
        AND v.RoomCode NOT LIKE '%VIRT%'
    `);
    const occupied = occupiedResult.recordset;

    // 3. Cruzar datos
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

    // 4. Ordenar alfabéticamente
    const finalBeds = Object.values(bedsMap).sort((a,b) => (a.RoomName || '').localeCompare(b.RoomName || ''));

    // 5. Estadísticas
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

/**
 * GET /api/dashboard/urgencias-nativo
 * Dashboard nativo para Urgencias basado en tabla PC (PCType = 'ER')
 */
router.get('/urgencias-nativo', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res, next) => {
  try {
    let { startDate, endDate, search } = req.query;
    
    if (startDate === 'undefined' || startDate === 'null' || startDate === '') startDate = null;
    if (endDate === 'undefined' || endDate === 'null' || endDate === '') endDate = null;
    if (search === 'undefined' || search === 'null' || search === '') search = null;

    const todayStr = new Date().toISOString().split('T')[0];
    const effectiveStartDate = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const effectiveEndDate = endDate || todayStr + ' 23:59:59';

    const split = splitDateRange(effectiveStartDate, effectiveEndDate);

    // 1. Obtener ingresos de servicios (sapData)
    let sapData = [];
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
      
      sapData = sapData.concat(pgRes.rows.map(row => ({
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
      sapData = sapData.concat(mssqlRes.recordset);
    }

    // Calcular KPIs Financieros (VERTICAL)
    const ingresosTotales = sapData.reduce((acc, curr) => acc + (curr.TOTAL_COBRADO || 0), 0);
    
    // Cruce con SAP Contabilidad Oficial
    let ingresosSAPTotales = 0;
    
    // Histórico SAP de PostgreSQL
    if (split.pgStart && split.pgEnd) {
      const pgSapRes = await pgPool.query(`
        SELECT SUM(total) as total
        FROM dw_sap_ingresos_grupos
        WHERE itmsgrpcod = 104 AND docdate >= $1 AND docdate <= $2
      `, [split.pgStart, split.pgEnd]);
      ingresosSAPTotales += Number(pgSapRes.rows[0].total || 0);
    }
    
    // Hoy live de SAP
    if (split.hasToday && split.remoteStart) {
      try {
        const sdStr = split.remoteStart.substring(0, 10);
        const edStr = (split.remoteEnd || todayStr).substring(0, 10);
        const sapSLRes = await sapService.fetchAllPages(`/SQLQueries('sq_ingresos_grupos')/List?startDate='${sdStr}'&endDate='${edStr}'`);
        if (sapSLRes && sapSLRes.length > 0) {
          const todayTotal = sapSLRes
            .filter(row => row.ItmsGrpCod === 104) // 104 = AMBULANCIAS / URGENCIAS
            .reduce((acc, row) => acc + (row.Total || 0), 0);
          ingresosSAPTotales += todayTotal;
        }
      } catch (e) {
        console.error('[SAP] Error al consultar ingresos contabilizados para Urgencias hoy:', e.message);
      }
    }
    
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

    // 2. Obtener datos detallados
    let data = [];
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
      
      data = data.concat(pgRes.rows.map(row => ({
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
      data = data.concat(mssqlRes.recordset);
    }

    // Calcular KPIs
    const atenciones = data.length;
    const egresos = data.filter(d => d.Estatus === 'CL' && d.Egreso).length;
    
    // Estancia promedio
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

    
    // --- NUEVO: Censo Camas Urgencias ---
    let censoCamas = [];
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
        LEFT JOIN V_MRPT v ON pt.PTNum = v.PTNum
        LEFT JOIN PR pr ON pc.PRNum = pr.PRNum
        WHERE pc.PC_ST = 'OP' 
          AND pc.PCType = 'ER'
          AND pc.MedicalDischargeDate IS NULL
          AND (v.RoomName LIKE '%URGENCIAS 1%' OR v.RoomName LIKE '%URGENCIAS 2%')
          AND v.RoomName NOT LIKE '%VIRTUAL%'
          AND v.RoomName NOT LIKE '%VIRT%'
          AND v.RoomCode NOT LIKE '%VIRT%'
      `);
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
      
      const masterBedsRes = await pgPool.query(`
        SELECT DISTINCT roomcode as "RoomCode", roomname as "RoomName"
        FROM dw_vertical_pt
        WHERE (roomname LIKE '%URGENCIAS 1%' OR roomname LIKE '%URGENCIAS 2%')
          AND roomname NOT LIKE '%VIRTUAL%'
        ORDER BY roomcode ASC
      `);
      
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
      censoCamas = Object.values(bedsMap).sort((a,b) => a.RoomCode.localeCompare(b.RoomCode));
    } catch (e) {
      console.error('[SAP/Vertical] Error al consultar camas Urgencias en vivo:', e.message);
    }
    // --- FIN Censo Camas Urgencias ---

res.json({
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
    });

  } catch (err) {
    console.error('Error consultando Urgencias:', err);
    res.status(500).json({ ok: false, error: 'Error obteniendo datos de urgencias.' });
  }
});

router.get('/eficacia-nativo', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res, next) => {
  try {
    let { startDate, endDate, search, especialidad } = req.query;
    if (endDate && endDate.length === 10) endDate += ' 23:59:59';

    const todayStr = new Date().toISOString().split('T')[0];
    const effectiveStartDate = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const effectiveEndDate = endDate || todayStr + ' 23:59:59';

    const split = splitDateRange(effectiveStartDate, effectiveEndDate);

    // --- 1. Obtener datos de Productividad Médica ---
    let prodData = [];
    
    // Histórico de PostgreSQL
    if (split.pgStart && split.pgEnd) {
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
    if (split.hasToday && split.remoteStart) {
      const mssqlPool = await connectRemoteDB();
      const request = mssqlPool.request();
      let whereProd = ["Fecha >= @startDate", "Fecha <= @endDate"];
      request.input('startDate', split.remoteStart);
      request.input('endDate', split.remoteEnd || new Date());
      
      if (search) {
        whereProd.push("Medico LIKE @search");
        request.input('search', `%${search}%`);
      }
      if (especialidad) {
        whereProd.push("Especialidad = @especialidad");
        request.input('especialidad', especialidad);
      }
      
      const mssqlRes = await request.query(`
        SELECT Medico, Especialidad, Fecha, Primeras, Subsecuentes, TotalAtenciones
        FROM UDR_BI_PRODUCTIVIDAD_MEDICOS
        WHERE ${whereProd.join(' AND ')}
      `);
      prodData = prodData.concat(mssqlRes.recordset);
    }

    // --- 2. Obtener datos de Consultas del Día ---
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
    if (split.hasToday && split.remoteStart) {
      const mssqlPool = await connectRemoteDB();
      const request = mssqlPool.request();
      let whereCons = ["Fecha >= @startDate", "Fecha <= @endDate"];
      request.input('startDate', split.remoteStart);
      request.input('endDate', split.remoteEnd || new Date());
      
      if (search) {
        whereCons.push("(Medico LIKE @search OR Paciente LIKE @search)");
        request.input('search', `%${search}%`);
      }
      if (especialidad) {
        whereCons.push("MSDescription_ES = @especialidad");
        request.input('especialidad', especialidad);
      }
      
      const mssqlRes = await request.query(`
        SELECT Numero_Cita, Folio_Medico, Medico, MSDescription_ES as Especialidad, 
               Fecha, Hora, Numero_Paciente, Paciente, Edad_Anios, Telefono_1, Celular_2, 
               Estatus_Orden_Venta, Articulo
        FROM V_UDR_CONSULTA_DIA
        WHERE ${whereCons.join(' AND ')}
      `);
      
      // Convertir Hora date a String para mantener formato
      const formattedMssql = mssqlRes.recordset.map(row => {
        let horaStr = '';
        if (row.Hora instanceof Date) {
          horaStr = row.Hora.toTimeString().split(' ')[0];
        } else if (row.Hora) {
          horaStr = String(row.Hora);
        }
        
        let fechaStr = '';
        if (row.Fecha instanceof Date) {
          fechaStr = row.Fecha.toISOString().split('T')[0];
        } else {
          fechaStr = row.Fecha;
        }

        return {
          ...row,
          Hora: horaStr,
          Fecha: fechaStr
        };
      });
      consData = consData.concat(formattedMssql);
    }

    // --- 3. Procesar Agregaciones en JS ---
    
    // A. Tendencia Mensual
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

    // B. Top Especialidades
    const especialidadesAgrupadas = {};
    prodData.forEach(row => {
      const esp = row.Especialidad || 'N/A';
      especialidadesAgrupadas[esp] = (especialidadesAgrupadas[esp] || 0) + (row.TotalAtenciones || 0);
    });
    const topEspecialidades = Object.keys(especialidadesAgrupadas)
      .map(k => ({ Especialidad: k, Total: especialidadesAgrupadas[k] }))
      .sort((a,b) => b.Total - a.Total)
      .slice(0, 10);

    // C. Top Médicos
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

    // D. Estatus Consultas Día (Gráfica Dona)
    const estatusAgrupados = {};
    consData.forEach(row => {
      const est = row.Estatus_Orden_Venta || 'SIN ESTATUS';
      estatusAgrupados[est] = (estatusAgrupados[est] || 0) + 1;
    });
    const estatusConsultas = Object.keys(estatusAgrupados).map(k => ({ nombre: k, valor: estatusAgrupados[k] }));

    // E. KPIs Totales
    let totalConsultas = 0;
    let totalPrimeras = 0;
    let totalSubsecuentes = 0;
    prodData.forEach(row => {
      totalConsultas += row.TotalAtenciones || 0;
      totalPrimeras += row.Primeras || 0;
      totalSubsecuentes += row.Subsecuentes || 0;
    });

    // F. Lista para la tabla (Últimas 100 consultas ordenadas por fecha/hora desc)
    const listaConsultas = consData
      .sort((a,b) => {
        const dateA = new Date(`${a.Fecha}T${a.Hora || '00:00:00'}`);
        const dateB = new Date(`${b.Fecha}T${b.Hora || '00:00:00'}`);
        return dateB - dateA;
      })
      .slice(0, 100);

    // G. Detalle por estatus para drill-down
    const detalleConsultas = {};
    listaConsultas.forEach(row => {
      const e = row.Estatus_Orden_Venta;
      if (!detalleConsultas[e]) detalleConsultas[e] = [];
      if (detalleConsultas[e].length < 50) {
        detalleConsultas[e].push(row);
      }
    });

    const topEspecialidadText = topEspecialidades.length > 0 ? topEspecialidades[0].Especialidad : 'N/A';

    res.json({
      ok: true,
      data: {
        tendenciaMensual,
        topEspecialidades,
        topMedicos,
        estatusConsultas,
        listaConsultas,
        detalleConsultas,
        kpis: {
          totalConsultas,
          primeras: totalPrimeras,
          subsecuentes: totalSubsecuentes,
          topEspecialidad: topEspecialidadText
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

    // 1. Obtener histórico de PostgreSQL
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

    // 2. Obtener lo de hoy (en vivo de SQL Server)
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

    // SAP Revenue queries - Consultar base local PostgreSQL (DW)
    let ingresosSAPTotales = 0;
    let topMedicosIngresos = [];
    let topServiciosIngresos = [];
    let ingresosTotales = 0;

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const sd = startDate ? new Date(startDate).toISOString().split('T')[0] : thirtyDaysAgo;
    const ed = endDate ? new Date(endDate).toISOString().split('T')[0] : todayStr;

    try {
      // 1. Obtener total ingresos
      const totalRes = await pgPool.query(`
        SELECT COALESCE(SUM(ingresos), 0) as total 
        FROM dw_sap_quirofano_analiticas 
        WHERE tipo = 'TOTAL' AND startdate >= $1 AND startdate <= $2
      `, [sd, ed]);
      ingresosSAPTotales = Number(totalRes.rows[0].total || 0);
      ingresosTotales = ingresosSAPTotales;

      // 2. Obtener top medicos
      const medRes = await pgPool.query(`
        SELECT nombre, SUM(ingresos) as ingresos 
        FROM dw_sap_quirofano_analiticas 
        WHERE tipo = 'MEDICO' AND startdate >= $1 AND startdate <= $2
        GROUP BY nombre 
        ORDER BY ingresos DESC 
        LIMIT 10
      `, [sd, ed]);
      topMedicosIngresos = medRes.rows.map(row => ({ nombre: row.nombre, ingresos: Number(row.ingresos) }));

      // 3. Obtener top servicios
      const srvRes = await pgPool.query(`
        SELECT nombre, SUM(ingresos) as ingresos 
        FROM dw_sap_quirofano_analiticas 
        WHERE tipo = 'SERVICIO' AND startdate >= $1 AND startdate <= $2
        GROUP BY nombre 
        ORDER BY ingresos DESC 
        LIMIT 10
      `, [sd, ed]);
      topServiciosIngresos = srvRes.rows.map(row => ({ nombre: row.nombre, ingresos: Number(row.ingresos) }));

    } catch (e) {
      console.error('[PostgreSQL Error] Falló consulta de analíticas de Quirófano local:', e.message);
    }

    res.json({
      ok: true,
      data: {
        lista: rawList,
        kpisFinancieros: { ingresosTotales, ingresosSAP: ingresosSAPTotales },
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

/**
 * GET /api/dashboard/export-excel
 * Exporta la tabla de datos cruda del dashboard a Excel con el logo y formato institucional
 */
router.get('/export-excel', authenticate, authorize(['ADMIN', 'DIRECTOR']), async (req, res, next) => {
  try {
    let { dashboard, startDate, endDate, search, especialidad } = req.query;
    
    // Evitar strings literales "undefined" o "null" desde el frontend
    if (startDate === 'undefined' || startDate === 'null' || startDate === '') startDate = null;
    if (endDate === 'undefined' || endDate === 'null' || endDate === '') endDate = null;
    if (search === 'undefined' || search === 'null' || search === '') search = null;
    if (especialidad === 'undefined' || especialidad === 'null' || especialidad === '') especialidad = null;

    const pool = await connectRemoteDB();
    const request = pool.request();
    
    let query = '';
    let columns = [];
    let sheetName = 'Exportación';

    // 1. Construir query según el dashboard
    if (dashboard === 'financiero') {
      sheetName = 'Cuentas_Financiero';
      let whereClauses = ["1=1"];
      if (startDate) { whereClauses.push("PC.Date >= @startDate"); request.input('startDate', startDate); }
      if (endDate) { whereClauses.push("PC.Date <= @endDate"); request.input('endDate', endDate); }
      if (search) { 
        whereClauses.push("(PC.PCNum LIKE @search OR PT.FullName LIKE @search)"); 
        request.input('search', `%${search}%`); 
      }
      query = `
        SELECT TOP 500
          CONVERT(varchar(10), PC.MedicalDischargeDate, 120) AS 'Alta Médica',
          PC.PCNum AS 'Cuenta',
          PT.FullName AS 'Paciente',
          PC.Total AS 'Ingresos',
          PC.Profit AS 'Utilidad',
          PC.Balance AS 'Saldo'
        FROM PC
        LEFT JOIN PT ON PC.PTNum = PT.PTNum
        WHERE ${whereClauses.join(' AND ')}
        ORDER BY PC.Total DESC
      `;
    } else if (dashboard === 'eficacia') {
      sheetName = 'Consultas_Eficacia';
      let whereCons = ["1=1"];
      if (startDate) { whereCons.push("Fecha >= @startDate"); request.input('startDate', startDate); }
      if (endDate) { whereCons.push("Fecha <= @endDate"); request.input('endDate', endDate); }
      if (search) { 
        whereCons.push("(Medico LIKE @search OR Paciente LIKE @search)"); 
        request.input('search', `%${search}%`); 
      }
      if (especialidad) {
        whereCons.push("MSDescription_ES = @especialidad");
        request.input('especialidad', especialidad);
      }
      query = `
        SELECT TOP 500
          CONVERT(varchar(10), Fecha, 120) AS 'Fecha',
          LEFT(CONVERT(varchar, Hora, 108), 5) AS 'Hora',
          Numero_Cita AS 'Num Cita',
          Paciente AS 'Paciente',
          Medico AS 'Médico',
          MSDescription_ES AS 'Especialidad',
          Estatus_Orden_Venta AS 'Estatus'
        FROM V_UDR_CONSULTA_DIA
        WHERE ${whereCons.join(' AND ')}
        ORDER BY Fecha DESC, Hora DESC
      `;
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
        SELECT TOP 500
          Quirofano AS 'Quirófano',
          Procedimientos AS 'Procedimiento',
          Medicos AS 'Médicos',
          CONVERT(varchar(16), FechaInicio, 120) AS 'Fecha Inicio',
          CONVERT(varchar(16), FechaFin, 120) AS 'Fecha Fin',
          DATEDIFF(MINUTE, FechaInicio, FechaFin) AS 'Duración (Min)'
        FROM UDR_USOQX
        WHERE ${whereClauses.join(' AND ')}
        ORDER BY FechaInicio DESC
      `;
    } else {
      return res.status(400).json({ error: 'Dashboard no reconocido para exportar' });
    }

    const result = await request.query(query);
    const rows = result.recordset;

    // 2. Generar Excel
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
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF004687' } }; // Azul Institucional
        cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, name: 'Arial', size: 11 };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        
        // Ajustar ancho
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
          
          // Formato moneda
          if (key === 'Ingresos' || key === 'Utilidad' || key === 'Saldo') {
            cell.numFmt = '$#,##0.00';
          }
          
          // Filas alternadas
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
    let sapGroupCode = 117; // Imagenología
    if (tipo === 'laboratorio') {
      areaNombre = 'LABORATORIO';
      sapGroupCode = 101; // Laboratorio
    }
    if (tipo === 'farmacia') {
      areaNombre = 'FARMACIA';
      sapGroupCode = 115; // Farmacia
    }

    let { startDate, endDate } = req.query;
    const now = new Date();
    const startOfYear = `${now.getFullYear()}-01-01`;
    const todayStr = now.toISOString().split('T')[0];
    const effectiveStartDate = startDate || startOfYear;
    const effectiveEndDate = endDate || todayStr + ' 23:59:59';

    const split = splitDateRange(effectiveStartDate, effectiveEndDate);
    const trendMap = {}; // Clave: Yr-Mes
    const estudiosMap = {}; // Clave: Estudio

    // Helper para agregar filas a la tendencia
    const addTrendRow = (yr, mes, volumen, ingresos) => {
      const key = `${yr}-${mes}`;
      if (!trendMap[key]) {
        trendMap[key] = { Yr: yr, Mes: mes, volumen: 0, ingresos: 0, ingresosSAP: 0 };
      }
      trendMap[key].volumen += volumen || 0;
      trendMap[key].ingresos += ingresos || 0;
    };

    // Helper para agregar filas a los estudios
    const addEstudioRow = (procedimiento, cantidad) => {
      const p = procedimiento || 'Desconocido';
      estudiosMap[p] = (estudiosMap[p] || 0) + (cantidad || 0);
    };

    // 1. Obtener histórico de PostgreSQL
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

    // 2. Obtener lo de hoy de SQL Server
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

    // 3. Obtener Ingresos SAP (Cruce contabilidad)
    const sapMap = {}; // Clave: Yr-Mes
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

    const todayStr = new Date().toISOString().split('T')[0];
    const effectiveStartDate = startDate || `${new Date().getFullYear()}-01-01`;
    const effectiveEndDate = endDate || todayStr + ' 23:59:59';

    const split = splitDateRange(effectiveStartDate, effectiveEndDate);

    // --- 1. Total de Recién Nacidos ---
    let totalRN = 0;
    
    // PG Histórico
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
      totalRN += Number(pgRNRes.rows[0].total_rn || 0);
    }
    // SQL Server Hoy
    if (split.hasToday && split.remoteStart) {
      const mssqlPool = await connectRemoteDB();
      const rnRequest = mssqlPool.request();
      rnRequest.input('rnStart', split.remoteStart);
      rnRequest.input('rnEnd', split.remoteEnd || new Date());
      const rnQuery = await rnRequest.query(`
        SELECT COUNT(DISTINCT p.PTNum) AS total_rn
        FROM PC p
        JOIN PT pt ON p.PTNum = pt.PTNum
        JOIN V_MRPT v ON p.PTNum = v.PTNum
        WHERE p.PC_ST = 'CL'
          AND (v.RoomName LIKE '%CUNERO%' OR v.RoomCode LIKE '%CUN%')
          AND DATEDIFF(day, pt.BirthDate, p.Date) = 0
          AND p.Date >= @rnStart AND p.Date <= @rnEnd
      `);
      totalRN += Number(rnQuery.recordset[0].total_rn || 0);
    }

    // --- 2. Ingresos SAP Contabilidad Oficial (Grupo 109) ---
    let ingresosSAPTotales = 0;
    
    // PG Histórico SAP
    if (split.pgStart && split.pgEnd) {
      const pgSapRes = await pgPool.query(`
        SELECT SUM(total) as total
        FROM dw_sap_ingresos_grupos
        WHERE itmsgrpcod = 109 AND docdate >= $1 AND docdate <= $2
      `, [split.pgStart, split.pgEnd]);
      ingresosSAPTotales += Number(pgSapRes.rows[0].total || 0);
    }
    // SAP Service Layer Hoy
    if (split.hasToday && split.remoteStart) {
      try {
        const sd = split.remoteStart.substring(0, 10);
        const ed = (split.remoteEnd || todayStr).substring(0, 10);
        const sapSLRes = await sapService.fetchAllPages(`/SQLQueries('sq_ingresos_grupos')/List?startDate='${sd}'&endDate='${ed}'`);
        if (sapSLRes && sapSLRes.length > 0) {
          ingresosSAPTotales += sapSLRes
            .filter(row => row.ItmsGrpCod === 109)
            .reduce((acc, row) => acc + (row.Total || 0), 0);
        }
      } catch (e) {
        console.error('[SAP] Error al consultar ingresos contabilizados para Cuneros hoy:', e.message);
      }
    }

    // --- 3. Ingresos UCIN Vertical ---
    let totalIngresosVertical = 0;
    
    // PG Histórico UCIN
    if (split.pgStart && split.pgEnd) {
      const pgUCINRes = await pgPool.query(`
        SELECT SUM(total_cobrado) as total_ingresos
        FROM dw_vertical_cuentas_servicios
        WHERE unidad_de_servicio = 'UCIN'
          AND fecha_de_cargo >= $1 AND fecha_de_cargo <= $2
      `, [split.pgStart, split.pgEnd + ' 23:59:59']);
      totalIngresosVertical += Number(pgUCINRes.rows[0].total_ingresos || 0);
    }
    // SQL Server Hoy UCIN
    if (split.hasToday && split.remoteStart) {
      const mssqlPool = await connectRemoteDB();
      const ucRequest = mssqlPool.request();
      ucRequest.input('ucStart', split.remoteStart);
      ucRequest.input('ucEnd', split.remoteEnd || new Date());
      const ingresosVertQuery = await ucRequest.query(`
        SELECT SUM(TOTAL_COBRADO) as total_ingresos
        FROM UDR_CUENTAS_SERVICIOS
        WHERE UNIDAD_DE_SERVICIO = 'UCIN'
          AND FECHA_DE_CARGO >= @ucStart AND FECHA_DE_CARGO <= @ucEnd
      `);
      totalIngresosVertical += Number(ingresosVertQuery.recordset[0].total_ingresos || 0);
    }

    // --- 4. Fórmulas entregadas (Biberones) ---
    let totalFormulas = 0;
    
    // PG Histórico Fórmulas
    if (split.pgStart && split.pgEnd) {
      const pgFRes = await pgPool.query(`
        SELECT SUM(ima.quantity) as total_formulas 
        FROM dw_vertical_pay_ima ima 
        INNER JOIN dw_vertical_pcit pcit ON pcit.pcitnum = ima.pcitnum
        INNER JOIN dw_vertical_pc pc ON pc.pcnum = pcit.pcnum
        WHERE ima.fullname LIKE 'RN %' AND ima.itemdescription LIKE '%FORMULA%'
          AND pc.entrydate >= $1 AND pc.entrydate <= $2
      `, [split.pgStart, split.pgEnd + ' 23:59:59']);
      totalFormulas += Number(pgFRes.rows[0].total_formulas || 0);
    }
    // SQL Server Hoy Fórmulas
    if (split.hasToday && split.remoteStart) {
      const mssqlPool = await connectRemoteDB();
      const fRequest = mssqlPool.request();
      fRequest.input('fStart', split.remoteStart);
      fRequest.input('fEnd', split.remoteEnd || new Date());
      const formulasQuery = await fRequest.query(`
        SELECT SUM(ima.Quantity) as total_formulas 
        FROM UDR_PAY_IMA ima 
        INNER JOIN PCIT ON ima.PCITNum = PCIT.PCITNum 
        INNER JOIN PC ON PCIT.PCNum = PC.PCNum
        WHERE ima.FullName LIKE 'RN %' AND ima.ItemDescription LIKE '%FORMULA%'
          AND PC.CreatedOn >= @fStart AND PC.CreatedOn <= @fEnd
      `);
      totalFormulas += Number(formulasQuery.recordset[0].total_formulas || 0);
    }

    // --- 5. Top Insumos y Medicamentos ---
    const insumosMap = {}; // Clave: item -> { cantidad, ingresos }
    const addInsumo = (item, qty, amount) => {
      if (!item) return;
      if (!insumosMap[item]) insumosMap[item] = { item, cantidad: 0, ingresos: 0 };
      insumosMap[item].cantidad += qty;
      insumosMap[item].ingresos += amount;
    };

    // PG Histórico Insumos
    if (split.pgStart && split.pgEnd) {
      const pgIRes = await pgPool.query(`
        SELECT 
          ima.itemdescription as item, 
          SUM(ima.quantity)::float as cantidad,
          SUM(ima.linetotal)::float as ingresos
        FROM dw_vertical_pay_ima ima 
        INNER JOIN dw_vertical_pcit pcit ON pcit.pcitnum = ima.pcitnum
        INNER JOIN dw_vertical_pc pc ON pc.pcnum = pcit.pcnum
        WHERE ima.fullname LIKE 'RN %'
          AND pc.entrydate >= $1 AND pc.entrydate <= $2
          AND ima.itemdescription NOT LIKE '%FORMULA%'
          AND ima.itemdescription NOT LIKE '%USO DE OXIGENO%'
          AND ima.itemdescription NOT LIKE '%USO PUNTAS PARA OXIGENO%'
          AND ima.itemdescription NOT LIKE '%ESTANCIA%'
          AND ima.itemdescription NOT LIKE '%GRUPO SANGUINEO%'
          AND ima.itemdescription NOT LIKE '%TOMA DE GLUCOSA%'
          AND ima.itemdescription NOT LIKE '%Anticipo%'
          AND ima.itemdescription NOT LIKE '%CONSULTA%'
        GROUP BY ima.itemdescription
      `, [split.pgStart, split.pgEnd + ' 23:59:59']);
      pgIRes.rows.forEach(r => addInsumo(r.item, r.cantidad, r.ingresos));
    }
    // SQL Server Hoy Insumos
    if (split.hasToday && split.remoteStart) {
      const mssqlPool = await connectRemoteDB();
      const iRequest = mssqlPool.request();
      iRequest.input('iStart', split.remoteStart);
      iRequest.input('iEnd', split.remoteEnd || new Date());
      const insumosQuery = await iRequest.query(`
        SELECT 
          ima.ItemDescription as item, 
          SUM(ima.Quantity) as cantidad,
          SUM(CAST(ISNULL(ima.LineTotal, 0) AS FLOAT)) as ingresos
        FROM UDR_PAY_IMA ima 
        INNER JOIN PCIT ON ima.PCITNum = PCIT.PCITNum 
        INNER JOIN PC ON PCIT.PCNum = PC.PCNum
        WHERE ima.FullName LIKE 'RN %'
          AND PC.CreatedOn >= @iStart AND PC.CreatedOn <= @iEnd
          AND ima.ItemDescription NOT LIKE '%FORMULA%'
          AND ima.ItemDescription NOT LIKE '%USO DE OXIGENO%'
          AND ima.ItemDescription NOT LIKE '%USO PUNTAS PARA OXIGENO%'
          AND ima.ItemDescription NOT LIKE '%ESTANCIA%'
          AND ima.ItemDescription NOT LIKE '%GRUPO SANGUINEO%'
          AND ima.ItemDescription NOT LIKE '%TOMA DE GLUCOSA%'
          AND ima.ItemDescription NOT LIKE '%Anticipo%'
          AND ima.ItemDescription NOT LIKE '%CONSULTA%'
        GROUP BY ima.ItemDescription
      `);
      insumosQuery.recordset.forEach(r => addInsumo(r.item, r.cantidad, r.ingresos));
    }
    const topInsumos = Object.values(insumosMap)
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 10);

    // --- 6. Distribución de Servicios ---
    const serviciosMap = {}; // Clave: servicio -> cantidad
    const addServicio = (serv, qty) => {
      if (!serv) return;
      serviciosMap[serv] = (serviciosMap[serv] || 0) + qty;
    };

    // PG Histórico Servicios
    if (split.pgStart && split.pgEnd) {
      const pgSRes = await pgPool.query(`
        SELECT 
          ima.itemdescription as servicio, 
          SUM(ima.quantity)::float as cantidad
        FROM dw_vertical_pay_ima ima 
        INNER JOIN dw_vertical_pcit pcit ON pcit.pcitnum = ima.pcitnum
        INNER JOIN dw_vertical_pc pc ON pc.pcnum = pcit.pcnum
        WHERE ima.fullname LIKE 'RN %'
          AND pc.entrydate >= $1 AND pc.entrydate <= $2
          AND (
            ima.itemdescription LIKE '%USO DE OXIGENO%' OR 
            ima.itemdescription LIKE '%USO PUNTAS PARA OXIGENO%' OR
            ima.itemdescription LIKE '%ESTANCIA DE CUNERO%' OR
            ima.itemdescription LIKE '%TOMA DE GLUCOSA%' OR
            ima.itemdescription LIKE '%GRUPO SANGUINEO%' OR
            ima.itemdescription LIKE '%TAMIZ%'
          )
        GROUP BY ima.itemdescription
      `, [split.pgStart, split.pgEnd + ' 23:59:59']);
      pgSRes.rows.forEach(r => addServicio(r.servicio, r.cantidad));
    }
    // SQL Server Hoy Servicios
    if (split.hasToday && split.remoteStart) {
      const mssqlPool = await connectRemoteDB();
      const sRequest = mssqlPool.request();
      sRequest.input('sStart', split.remoteStart);
      sRequest.input('sEnd', split.remoteEnd || new Date());
      const serviciosQuery = await sRequest.query(`
        SELECT 
          ima.ItemDescription as servicio, 
          SUM(ima.Quantity) as cantidad
        FROM UDR_PAY_IMA ima 
        INNER JOIN PCIT ON ima.PCITNum = PCIT.PCITNum 
        INNER JOIN PC ON PCIT.PCNum = PC.PCNum
        WHERE ima.FullName LIKE 'RN %'
          AND PC.CreatedOn >= @sStart AND PC.CreatedOn <= @sEnd
          AND (
            ima.ItemDescription LIKE '%USO DE OXIGENO%' OR 
            ima.ItemDescription LIKE '%USO PUNTAS PARA OXIGENO%' OR
            ima.ItemDescription LIKE '%ESTANCIA DE CUNERO%' OR
            ima.ItemDescription LIKE '%TOMA DE GLUCOSA%' OR
            ima.ItemDescription LIKE '%GRUPO SANGUINEO%' OR
            ima.ItemDescription LIKE '%TAMIZ%'
          )
        GROUP BY ima.ItemDescription
      `);
      serviciosQuery.recordset.forEach(r => addServicio(r.servicio, r.cantidad));
    }
    const topServicios = Object.keys(serviciosMap)
      .map(k => ({ servicio: k, cantidad: serviciosMap[k] }))
      .sort((a, b) => b.cantidad - a.cantidad);

    res.json({
      success: true,
      data: {
        totalRN,
        totalIngresos: totalIngresosVertical,
        ingresosSAP: ingresosSAPTotales,
        totalFormulas,
        topInsumos,
        topServicios
      }
    });
  } catch (error) {
    console.error('Error en cuneros-nativo:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/uci-nativo', authenticate, async (req, res, next) => {
  try {
    let { startDate, endDate } = req.query;

    const todayStr = new Date().toISOString().split('T')[0];
    const effectiveStartDate = startDate || `${new Date().getFullYear()}-01-01`;
    const effectiveEndDate = endDate || todayStr + ' 23:59:59';

    // 1. Obtener camas en vivo (Censo UCI) desde SQL Server KH_HE
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
        LEFT JOIN V_MRPT v ON pt.PTNum = v.PTNum
        LEFT JOIN PR pr ON pc.PRNum = pr.PRNum
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

    // 2. Obtener listado maestro de camas UCI desde PostgreSQL
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
        RoomCode: b.RoomCode, 
        RoomName: b.RoomName, 
        Estado: 'LIBRE', 
        Paciente: null, 
        Medico: null, 
        FechaIngreso: null, 
        PCNum: null,
        totalCargos: 0
      };
    });

    // 3. Consultar cargos acumulados de pacientes activos en PostgreSQL para cruzarlos
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

    const censoCamas = Object.values(bedsMap).sort((a,b) => a.RoomCode.localeCompare(b.RoomCode));

    // 4. Estadísticas Clínicas en vivo (Egresos, Mortalidad y Estancia) de SQL Server
    let clinicalStats = { TotalEgresos: 0, Defunciones: 0, EstanciaPromedio: 0 };
    try {
      const mssqlPool = await connectRemoteDB();
      const statsRes = await mssqlPool.request()
        .input('startDate', effectiveStartDate.substring(0, 10))
        .input('endDate', effectiveEndDate)
        .query(`
          SELECT 
            COUNT(DISTINCT pc.PCNum) as TotalEgresos,
            SUM(CASE WHEN pc.MedicalDischarge IN ('DEF', 'DEFUNCION', 'MD003') OR pc.DateOfDeath IS NOT NULL THEN 1 ELSE 0 END) as Defunciones,
            AVG(CAST(DATEDIFF(day, pc.Date, pc.MedicalDischargeDate) AS FLOAT)) as EstanciaPromedio
          FROM PC pc
          INNER JOIN PT pt ON pc.PTNum = pt.PTNum
          LEFT JOIN V_MRPT v ON pt.PTNum = v.PTNum
          WHERE pc.PC_ST = 'CL'
            AND pc.MedicalDischargeDate >= @startDate AND pc.MedicalDischargeDate <= @endDate
            AND (v.RoomCode LIKE 'CUBUTI%' OR v.RoomCode = 'CUNUCIN01')
        `);
      
      if (statsRes.recordset && statsRes.recordset.length > 0) {
        const stats = statsRes.recordset[0];
        clinicalStats = {
          TotalEgresos: stats.TotalEgresos || 0,
          Defunciones: stats.Defunciones || 0,
          EstanciaPromedio: stats.EstanciaPromedio != null ? parseFloat(stats.EstanciaPromedio.toFixed(1)) : 0
        };
      }
    } catch (e) {
      console.error('[SAP/Vertical] Error al consultar estadísticas clínicas de UCI:', e.message);
    }

    const totalEgresos = clinicalStats.TotalEgresos;
    const defunciones = clinicalStats.Defunciones;
    const tasaMortalidad = totalEgresos > 0 ? parseFloat(((defunciones * 100) / totalEgresos).toFixed(1)) : 0;
    const camasOcupadas = occupiedBeds.length;
    const totalCamas = censoCamas.length;
    const ocupacionPct = totalCamas > 0 ? parseFloat(((camasOcupadas * 100) / totalCamas).toFixed(1)) : 0;

    // 5. Métricas Financieras (PostgreSQL DW)
    // A. Total Facturado y total pacientes históricos facturados en el periodo
    const finRes = await pgPool.query(`
      SELECT 
        COALESCE(SUM(total_cobrado), 0)::float as total_facturado, 
        COUNT(DISTINCT folio_de_atencion)::int as total_pacientes
      FROM dw_vertical_cuentas_servicios
      WHERE (unidad_de_servicio = 'UCI' OR grupo_de_articulos = 'TERAPIA INTENSIVA  E INTERMEDIA' OR unidad_de_servicio = 'UCIN')
        AND fecha_de_cargo >= $1 AND fecha_de_cargo <= $2
    `, [effectiveStartDate, effectiveEndDate]);
    const { total_facturado: totalFacturado, total_pacientes: totalPacientes } = finRes.rows[0];

    // B. Desglose de ingresos por grupo de artículos
    const grupoRes = await pgPool.query(`
      SELECT 
        grupo_de_articulos as "grupo", 
        COALESCE(SUM(total_cobrado), 0)::float as "total"
      FROM dw_vertical_cuentas_servicios
      WHERE (unidad_de_servicio = 'UCI' OR grupo_de_articulos = 'TERAPIA INTENSIVA  E INTERMEDIA' OR unidad_de_servicio = 'UCIN')
        AND fecha_de_cargo >= $1 AND fecha_de_cargo <= $2
      GROUP BY grupo_de_articulos
      ORDER BY total DESC
    `, [effectiveStartDate, effectiveEndDate]);

    // C. Top 10 Insumos y Medicamentos
    const insumosRes = await pgPool.query(`
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
    `, [effectiveStartDate, effectiveEndDate]);

    // D. Listado de Pacientes Histórico / Cuentas del periodo
    const listaPacientesRes = await pgPool.query(`
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
      WHERE (s.unidad_de_servicio = 'UCI' OR s.grupo_de_articulos = 'TERAPIA INTENSIVA  E INTERMEDIA' OR s.unidad_de_servicio = 'UCIN')
        AND s.fecha_de_cargo >= $1 AND s.fecha_de_cargo <= $2
      GROUP BY s.folio_de_atencion, pc.pc_st
      ORDER BY entrydate DESC
    `, [effectiveStartDate, effectiveEndDate]);

    res.json({
      ok: true,
      data: {
        kpis: {
          totalFacturado,
          totalPacientes,
          estanciaPromedio: clinicalStats.EstanciaPromedio,
          tasaMortalidad,
          camasOcupadas,
          totalCamas,
          ocupacionPct
        },
        censoCamas,
        ingresosPorGrupo: grupoRes.rows,
        topInsumos: insumosRes.rows,
        listaPacientes: listaPacientesRes.rows
      }
    });

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
      SELECT statecode as "estado", COUNT(*)::int as "cantidad" 
      FROM dw_vertical_pt 
      WHERE statecode IS NOT NULL 
      GROUP BY statecode 
      ORDER BY cantidad DESC 
    `);
    const estados = estadosQuery.rows;

    const ciudadesQuery = await pgPool.query(`
      SELECT city as "ciudad", COUNT(*)::int as "cantidad" 
      FROM dw_vertical_pt 
      WHERE city IS NOT NULL 
      GROUP BY city 
      ORDER BY cantidad DESC 
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
/**
 * GET /api/dashboard/sap/vidas-salvadas
 * Consulta directa a SAP B1 para obtener atenciones médicas con uso de sala de choque (Detalle)
 */
router.get('/sap/vidas-salvadas', authenticate, async (req, res) => {
  try {
    let { startDate, endDate, periodo } = req.query;
    
    // Resolve date string for SAP Service Layer (YYYY-MM-DD)
    let d = new Date();
    if (periodo === 'semana') d.setDate(d.getDate() - 7);
    else if (periodo === 'trimestre') d.setMonth(d.getMonth() - 3);
    else if (periodo === 'año') { d = new Date(d.getFullYear(), 0, 1); } // 1 de enero del año actual
    else if (periodo === 'mes') d.setMonth(d.getMonth() - 1);
    else if (!startDate) d.setMonth(d.getMonth() - 1); // default to mes if no dates passed

    let sapDate = '';
    if (startDate) {
      sapDate = startDate; // Assumes YYYY-MM-DD
    } else {
      sapDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    const sapService = require('../services/sap.service');
    const result = await sapService.get(`/SQLQueries('VidasSalvChoqueDet')/List?startDate='${sapDate}'`);
    
    res.json({
      ok: true,
      data: result.data?.value || [],
      totalVidasSalvadas: result.data?.value?.length || 0
    });

  } catch (err) {
    console.error('Error en vidas salvadas SAP detalle:', err.error || err);
    res.status(500).json({ ok: false, error: err.error?.message?.value || err.message });
  }
});

/**
 * GET /api/dashboard/consulta-externa-nativo
 * Dashboard nativo para Consulta Externa (VERTICAL y SAP)
 */
router.get('/consulta-externa-nativo', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res, next) => {
  try {
    let { startDate, endDate, search } = req.query;
    
    // Default to today if no dates
    if (!startDate && !endDate) {
      const today = new Date();
      // YYYY-MM-DD
      const dateStr = today.toISOString().split('T')[0];
      startDate = dateStr;
      endDate = dateStr;
    }
    
    if (endDate && endDate.length === 10) endDate += ' 23:59:59';
    
    const pool = await connectRemoteDB();
    const request = pool.request();
    
    let whereV = ["1=1"];
    let whereP = ["1=1"];
    
    if (startDate) {
      whereV.push("Fecha >= @startDate");
      whereP.push("DesdeFecha >= @startDate");
      request.input('startDate', startDate);
    }
    if (endDate) {
      whereV.push("Fecha <= @endDate");
      whereP.push("DesdeFecha <= @endDate");
      request.input('endDate', endDate);
    }
    
    // Consultas programadas (UDR_CONSULTAS_PROG)
    const progStr = `
      SELECT *
      FROM UDR_CONSULTAS_PROG
      WHERE ${whereP.join(' AND ')}
    `;
    const progRes = await request.query(progStr);
    const programadasData = progRes.recordset || [];

    // Ingresos CEX (UDR_CUENTAS_SERVICIOS)
    let ingresosData = [];
    try {
      const ingStr = `
        SELECT Medico_Tratante, TOTAL_COBRADO
        FROM UDR_CUENTAS_SERVICIOS
        WHERE UNIDAD_DE_SERVICIO = 'CEX' AND FECHA_DE_CARGO >= @startDate AND FECHA_DE_CARGO <= @endDate
      `;
      const ingRes = await request.query(ingStr);
      ingresosData = ingRes.recordset || [];
    } catch(err) {
      console.warn("No se pudo cargar UDR_CUENTAS_SERVICIOS: ", err.message);
    }
    let ingresosTotales = 0;
    const medicosIngresos = {};
    
    ingresosData.forEach(i => {
      const amt = parseFloat(i.TOTAL_COBRADO) || 0;
      ingresosTotales += amt;
    });
    
    // Top Médicos por cantidad de consultas programadas (finalProgData will be used after filtering, but we can compute it on the initial programadasData and overwrite later, or just wait. Ah, we need to compute it AFTER filtering. Let's do it after.)
    
    // Consultas completadas / facturadas (V_UDR_CONSULTA_DIA)
    const diaStr = `
      SELECT *
      FROM V_UDR_CONSULTA_DIA
      WHERE ${whereV.join(' AND ')}
    `;
    const diaRes = await request.query(diaStr);
    const diaData = diaRes.recordset || [];
    
    // Filtro Search
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
    
    // KPIs
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
    
    // Si no hay asistencias claras en PROG, usamos diaData (las confirmadas / procesadas)
    if (asistencias === 0 && diaData.length > 0) {
      asistencias = diaData.length;
    }
    
    const tasaAsistencia = totalProgramadas > 0 ? Math.round((asistencias / totalProgramadas) * 100) : 0;
    
    // Tendencia por día (últimos 7 días si están viendo hoy)
    const tendencia = [];
    if (startDate && endDate && startDate.substring(0,10) === endDate.substring(0,10)) {
       // Calcular ultimos 7 dias
       const request7 = pool.request();
       const d7 = new Date(startDate);
       d7.setDate(d7.getDate() - 7);
       request7.input('start7', d7.toISOString().split('T')[0]);
       request7.input('end7', endDate);
       const tRes = await request7.query(`
         SELECT CAST(DesdeFecha AS DATE) as fecha, COUNT(*) as valor
         FROM UDR_CONSULTAS_PROG
         WHERE DesdeFecha >= @start7 AND DesdeFecha <= @end7
         GROUP BY CAST(DesdeFecha AS DATE)
         ORDER BY fecha ASC
       `);
       tRes.recordset.forEach(r => {
         // Create date from string by appending 'T12:00:00' to avoid UTC shift
         const dStr = r.fecha instanceof Date ? r.fecha.toISOString().split('T')[0] : String(r.fecha).substring(0, 10);
         const fixedDate = new Date(`${dStr}T12:00:00`);
         tendencia.push({
           nombre: fixedDate.toLocaleDateString('es-MX', {day: '2-digit', month: 'short'}),
           valor: r.valor
         });
       });
    } else {
       // Agrupar por mes o día dentro del rango
       const grouped = {};
       programadasData.forEach(p => {
         const dStr = p.DesdeFecha instanceof Date ? p.DesdeFecha.toISOString().split('T')[0] : String(p.DesdeFecha).substring(0, 10);
         const fixedDate = new Date(`${dStr}T12:00:00`);
         const d = fixedDate.toLocaleDateString('es-MX', {day: '2-digit', month: 'short'});
         grouped[d] = (grouped[d] || 0) + 1;
       });
       Object.keys(grouped).forEach(k => {
         tendencia.push({ nombre: k, valor: grouped[k] });
       });
    }
    
    // Especialidades (Pie Chart)
    const espCount = {};
    finalProgData.forEach(p => {
      const e = p.Especialidad || 'OTRA';
      espCount[e] = (espCount[e] || 0) + 1;
    });
    const especialidades = Object.keys(espCount).map(k => ({
      nombre: k,
      valor: espCount[k]
    })).sort((a,b) => b.valor - a.valor).slice(0, 5); // top 5
    
    res.json({
      ok: true,
      data: {
        kpis: {
          total: totalProgramadas,
          asistencias: asistencias,
          cancelaciones: cancelaciones,
          tasaAsistencia: tasaAsistencia,
          ingresos: ingresosTotales
        },
        tendencia,
        especialidades,
        topMedicos,
        lista: finalProgData // Mandamos la lista de programadas como base para la tabla
      }
    });
    
  } catch (err) {
    console.error('Error Consulta Externa:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});
/**
 * GET /api/dashboard/aseguradoras-nativo
 * Dashboard nativo para Aseguradoras (VERTICAL + SAP)
 */
router.get('/aseguradoras-nativo', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res, next) => {
  try {
    let { startDate, endDate } = req.query;

    // Default to this year
    if (!startDate && !endDate) {
      const now = new Date();
      startDate = `${now.getFullYear()}-01-01`;
      endDate = now.toISOString().split('T')[0];
    }
    
    if (endDate && endDate.length === 10) endDate += ' 23:59:59';

    const { connectRemoteDB } = require('../config/remote-db');
    const sapService = require('../services/sap.service');
    
    // 1. Obtener de SAP el catálogo real de Aseguradoras (GroupCode = 109)
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
      // Fallback in case SAP fails, we don't want to crash but we can't filter precisely
      sapBPs = ['CTE00005', 'CTE00014', 'CTE00024', 'CTE00187']; // Algunos defaults conocidos
    }

    const pool = await connectRemoteDB();
    const request = pool.request();

    // 2. Obtener de Vertical Cuentas que pertenezcan EXCLUSIVAMENTE a esas Aseguradoras
    // o que tengan un Acuerdo activo (PCAG) con alguna de esas Aseguradoras
    let wherePC = [];
    
    // Usar parámetros SQL seguros para la lista de BPCodes
    const bpParams = sapBPs.map((bp, i) => `@bp${i}`);
    
    // Condición: El BPCode principal pertenece a Aseguradoras O existe un acuerdo de Aseguradora
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

    // Agrupación en Vertical (Pacientes atendidos por Aseguradora)
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
      
      // Top 10 pacientes en general para la tabla interna (si hiciera falta)
      if (aseguradorasMap[bp].pacientes.length < 10) {
        aseguradorasMap[bp].pacientes.push(c);
      }
    });

    // Top Aseguradoras por pacientes atendidos
    const topAseguradoras = Object.values(aseguradorasMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Lista general de pacientes
    const listaPacientes = cuentas.map(c => ({
      ...c,
      AseguradoraNombre: aseguradorasMap[c.BPCode]?.nombre || c.BPCode
    })).slice(0, 2000);

    const totalCuentas = cuentas.length;
    const totalMontoVertical = cuentas.reduce((acc, c) => acc + parseFloat(c.Total || 0), 0);
    const totalSaldoVertical = cuentas.reduce((acc, c) => acc + parseFloat(c.Balance || 0), 0);

    res.json({
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
    });

  } catch (error) {
    console.error('Error en aseguradoras-nativo:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/dashboard/finanzas-nativo
 * Dashboard de Ingresos y Egresos (Caja / Pagos)
 */
router.get('/finanzas-nativo', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res, next) => {
  try {
    let { startDate, endDate } = req.query;

    if (!startDate && !endDate) {
      const now = new Date();
      startDate = `${now.getFullYear()}-01-01`;
      endDate = now.toISOString().split('T')[0];
    }
    // Regla de negocio: Datos válidos a partir del 1 de abril de 2026
    const minDate = new Date('2026-04-01T00:00:00');
    if (new Date(startDate) < minDate) {
      startDate = '2026-04-01';
    }
    
    if (endDate && endDate.length === 10) endDate += ' 23:59:59';

    const sapStartDate = startDate.split(' ')[0];
    const sapEndDate = endDate.split(' ')[0];

    // Conexión a PostgreSQL DW
    const { pool } = require('../config/pg-db');

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
        WHERE DocDate >= $1 AND DocDate <= $2 AND Canceled = 'N'
      `, [sapStartDate, sapEndDate]);
      
      if (resKpiIngresos.rows.length > 0) {
        kpiData = { ...kpiData, ...resKpiIngresos.rows[0] };
      }

      const resKpiEgresos = await pool.query(`
        SELECT SUM(DocTotal) as "DocTotalEgresos" 
        FROM sap_purchase_invoices 
        WHERE DocDate >= $1 AND DocDate <= $2 AND Canceled = 'N'
      `, [sapStartDate, sapEndDate]);
      
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

    const cards = [
      { title: 'Ingresos Totales (Cobrado)', value: totalIngresos, type: 'currency', color: 'green' },
      { title: 'Egresos Totales (Pagado)', value: totalEgresos, type: 'currency', color: 'red' },
      { title: 'Balance General', value: balance, type: 'currency', color: balance >= 0 ? 'blue' : 'orange' }
    ];

    // El cálculo de metodosData se realizará después de poblar transacciones

    const transacciones = [];

    // INGRESOS DESDE POSTGRESQL (Límite 150 para la UI)
    try {
      const resSapIn = await pool.query(`
        SELECT 
          DocNum as "DocNum", DocDate as "DocDate", CardCode as "CardCode", 
          CardName as "CardName", CashSum as "CashSum", TrsfrSum as "TransferSum", 
          CreditSum as "CreditSum", CheckSum as "CheckSum", DocTotal as "DocTotal", 
          CounterReference as "CounterReference"
        FROM sap_incoming_payments
        WHERE DocDate >= $1 AND DocDate <= $2 AND Canceled = 'N'
        ORDER BY DocDate DESC
        LIMIT 150
      `, [sapStartDate, sapEndDate]);
      
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

    // EGRESOS DESDE POSTGRESQL (Límite 150 para la UI)
    try {
      const resSap = await pool.query(`
        SELECT 
          DocEntry as "DocEntry", DocNum as "DocNum", DocDate as "DocDate", 
          CardCode as "CardCode", CardName as "CardName", DocTotal as "DocTotal"
        FROM sap_purchase_invoices
        WHERE DocDate >= $1 AND DocDate <= $2 AND Canceled = 'N'
        ORDER BY DocDate DESC
        LIMIT 150
      `, [sapStartDate, sapEndDate]);
      
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

    // Sort all transactions by date descending
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

/**
 * GET /api/dashboard/finanzas-nativo/factura/:docNum
 * Detalle completo de una Factura de Proveedor (Egreso) desde SAP Service Layer
 */
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

/**
 * GET /api/dashboard/finanzas-nativo/ingreso/:docNum
 * Detalle completo de un Ingreso (Incoming Payment) desde SAP Service Layer
 */
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

    const todayStr = new Date().toISOString().split('T')[0];
    const effectiveStartDate = startDate || `${new Date().getFullYear()}-01-01`;
    const effectiveEndDate = endDate || todayStr + ' 23:59:59';

    // 1. Obtener camas en vivo (Censo Hospitalización) desde SQL Server KH_HE
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
        LEFT JOIN V_MRPT v ON pt.PTNum = v.PTNum
        LEFT JOIN PR pr ON pc.PRNum = pr.PRNum
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

    // 2. Obtener listado maestro de camas Hospitalización desde PostgreSQL
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
    const bedsListToUse = masterBeds;
    bedsListToUse.forEach(b => {
      bedsMap[b.RoomCode] = { 
        RoomCode: b.RoomCode, 
        RoomName: b.RoomName, 
        Estado: 'LIBRE', 
        Paciente: null, 
        Medico: null, 
        FechaIngreso: null, 
        PCNum: null,
        totalCargos: 0
      };
    });

    // 3. Consultar cargos acumulados de pacientes activos en PostgreSQL para cruzarlos
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
            RoomCode: code,
            RoomName: o.RoomName || code,
            Estado: 'LIBRE',
            Paciente: null, Medico: null, FechaIngreso: null, PCNum: null, totalCargos: 0
          };
        }
        bedsMap[code] = {
          ...bedsMap[code],
          Estado: 'OCUPADA',
          Paciente: o.Paciente,
          Medico: o.Medico,
          FechaIngreso: o.FechaIngreso,
          PCNum: o.PCNum,
          totalCargos: activeChargesMap[o.PCNum] || 0
        };
      }
    });

    const censoCamas = Object.values(bedsMap).sort((a,b) => a.RoomCode.localeCompare(b.RoomCode));

    // 4. Estadísticas Clínicas en vivo de SQL Server
    let clinicalStats = { TotalEgresos: 0, Defunciones: 0, EstanciaPromedio: 0 };
    try {
      const mssqlPool = await connectRemoteDB();
      const statsRes = await mssqlPool.request()
        .input('startDate', effectiveStartDate.substring(0, 10))
        .input('endDate', effectiveEndDate)
        .query(`
          SELECT 
            COUNT(DISTINCT pc.PCNum) as TotalEgresos,
            SUM(CASE WHEN pc.MedicalDischarge IN ('DEF', 'DEFUNCION', 'MD003') OR pc.DateOfDeath IS NOT NULL THEN 1 ELSE 0 END) as Defunciones,
            AVG(CAST(DATEDIFF(day, pc.Date, pc.MedicalDischargeDate) AS FLOAT)) as EstanciaPromedio
          FROM PC pc
          INNER JOIN PT pt ON pc.PTNum = pt.PTNum
          LEFT JOIN V_MRPT v ON pt.PTNum = v.PTNum
          WHERE pc.PC_ST = 'CL' AND pc.PCType = 'IP'
            AND pc.MedicalDischargeDate >= @startDate AND pc.MedicalDischargeDate <= @endDate
            AND (v.RoomCode NOT LIKE 'CUBUTI%' AND v.RoomCode != 'CUNUCIN01')
        `);
      
      if (statsRes.recordset && statsRes.recordset.length > 0) {
        const stats = statsRes.recordset[0];
        clinicalStats = {
          TotalEgresos: stats.TotalEgresos || 0,
          Defunciones: stats.Defunciones || 0,
          EstanciaPromedio: stats.EstanciaPromedio != null ? parseFloat(stats.EstanciaPromedio.toFixed(1)) : 0
        };
      }
    } catch (e) {
      console.error('[SAP/Vertical] Error al consultar estadísticas clínicas de Hospitalización:', e.message);
    }

    const totalEgresos = clinicalStats.TotalEgresos;
    const defunciones = clinicalStats.Defunciones;
    const tasaMortalidad = totalEgresos > 0 ? parseFloat(((defunciones * 100) / totalEgresos).toFixed(1)) : 0;
    const camasOcupadas = occupiedBeds.length;
    const totalCamas = censoCamas.length;
    const ocupacionPct = totalCamas > 0 ? parseFloat(((camasOcupadas * 100) / totalCamas).toFixed(1)) : 0;

    // 5. Métricas Financieras (PostgreSQL DW)
    const finRes = await pgPool.query(`
      SELECT 
        COALESCE(SUM(total_cobrado), 0)::float as total_facturado, 
        COUNT(DISTINCT folio_de_atencion)::int as total_pacientes
      FROM dw_vertical_cuentas_servicios
      WHERE (grupo_de_articulos != 'TERAPIA INTENSIVA  E INTERMEDIA' AND unidad_de_servicio NOT IN ('UCI', 'UCIN', 'URG1', 'URG2'))
        AND folio_de_atencion IN (SELECT pcnum FROM dw_vertical_pc WHERE pctype = 'IP')
        AND fecha_de_cargo >= $1 AND fecha_de_cargo <= $2
    `, [effectiveStartDate, effectiveEndDate]);
    const { total_facturado: totalFacturado, total_pacientes: totalPacientes } = finRes.rows[0];

    // B. Desglose de ingresos por grupo de artículos
    const grupoRes = await pgPool.query(`
      SELECT 
        grupo_de_articulos as "grupo", 
        COALESCE(SUM(total_cobrado), 0)::float as "total"
      FROM dw_vertical_cuentas_servicios
      WHERE (grupo_de_articulos != 'TERAPIA INTENSIVA  E INTERMEDIA' AND unidad_de_servicio NOT IN ('UCI', 'UCIN', 'URG1', 'URG2'))
        AND folio_de_atencion IN (SELECT pcnum FROM dw_vertical_pc WHERE pctype = 'IP')
        AND fecha_de_cargo >= $1 AND fecha_de_cargo <= $2
      GROUP BY grupo_de_articulos
      ORDER BY total DESC
    `, [effectiveStartDate, effectiveEndDate]);

    // C. Top 10 Insumos y Medicamentos
    const insumosRes = await pgPool.query(`
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
    `, [effectiveStartDate, effectiveEndDate]);

    // D. Listado de Pacientes Histórico / Cuentas del periodo
    const listaPacientesRes = await pgPool.query(`
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
    `, [effectiveStartDate, effectiveEndDate]);

    res.json({
      ok: true,
      data: {
        kpis: {
          totalFacturado,
          totalPacientes,
          estanciaPromedio: clinicalStats.EstanciaPromedio,
          tasaMortalidad,
          camasOcupadas,
          totalCamas,
          ocupacionPct
        },
        censoCamas,
        ingresosPorGrupo: grupoRes.rows,
        topInsumos: insumosRes.rows,
        listaPacientes: listaPacientesRes.rows
      }
    });

  } catch (err) {
    console.error('Error en hospitalizacion-nativo:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;


