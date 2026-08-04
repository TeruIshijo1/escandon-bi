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

    const pool = await connectRemoteDB();
    const result = await pool.request()
      .input('pcNum', parseInt(pcNum, 10))
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
      
    const records = result.recordset;
    
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
    const pool = await connectRemoteDB();
    const request = pool.request();

    let whereClauses = ["1=1"];

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

    if (startDate) {
      // Forzar que la fecha de inicio no sea anterior a MIN_DATE
      const effectiveStartDate = startDate < MIN_DATE ? MIN_DATE : startDate;
      whereClauses.push("PC.Date >= @startDate");
      request.input('startDate', effectiveStartDate);
    } else {
      // Default: últimos 6 meses, pero garantizando que no rebase MIN_DATE
      whereClauses.push(`PC.Date >= CASE WHEN DATEADD(month, -6, GETDATE()) < '${MIN_DATE}' THEN '${MIN_DATE}' ELSE DATEADD(month, -6, GETDATE()) END`);
    }

    if (endDate) {
      whereClauses.push("PC.Date <= @endDate");
      request.input('endDate', endDate);
    } else {
      whereClauses.push("PC.Date <= GETDATE()");
    }

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

    const rawData = result.recordset;
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
    const pool = await connectRemoteDB();
    const request = pool.request();

    let whereClauses = ["1=1"];

    if (startDate) {
      whereClauses.push("FechaPeriodo >= @startDate");
      request.input('startDate', startDate);
    }
    if (endDate) {
      whereClauses.push("FechaPeriodo <= @endDate");
      request.input('endDate', endDate);
    }

    const queryStr = `
      SELECT ${(!startDate && !endDate) ? 'TOP 6' : ''}
        Anio, Mes,
        CONVERT(varchar(7), FechaPeriodo, 120) AS monthStr,
        CamasOcupadas, QuirofanosActivos, Urgencias, Hospitalizacion,
        TriajeMin, TriajeMeta, TriajeOutliers,
        LaboratorioMin, LaboratorioMeta, LaboratorioOutliers,
        ImagenologiaMin, ImagenologiaMeta, ImagenologiaOutliers,
        EgresoHoras, EgresoMeta,
        EstadoTriaje, EstadoLaboratorio, EstadoImagenologia, EstadoEgreso
      FROM UDR_BI_INDICADORES_OPERATIVOS
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY FechaPeriodo DESC
    `;

    const result = await request.query(queryStr);

    // Invertir para que el orden cronológico sea ASC
    const data = result.recordset.reverse();
    
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
      quirofanosActivos: data.length ? Math.round(totalQuirofanos / data.length) : 0,
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
    res.status(500).json({ ok: false, error: 'Error de conexión con la base de datos remota.' });
  }
});

/**
 * GET /api/dashboard/censo-camas
 * Retorna el censo de camas en tiempo real cruzando V_MRPT y PC
 */
router.get('/censo-camas', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res, next) => {
  try {
    const pool = await connectRemoteDB();

    // 1. Obtener listado maestro de camas reales (excluyendo virtuales)
    const bedsResult = await pool.request().query(`
      SELECT DISTINCT RoomCode, RoomName 
      FROM V_MRPT 
      WHERE (RoomName LIKE '%CAMA%' OR RoomCode LIKE 'CUBUTI%') 
        AND RoomName IS NOT NULL
        AND RoomName NOT LIKE '%VIRTUAL%'
        AND RoomName NOT LIKE '%VIRT%'
        AND RoomCode NOT LIKE '%VIRT%'
    `);
    const allBeds = bedsResult.recordset;

    // 2. Obtener camas ocupadas actualmente (última cama asignada sin virtuales)
    const occupiedResult = await pool.request().query(`
      WITH CTE AS (
        SELECT 
          V.RoomCode, 
          V.FullName AS Paciente, 
          PR.FullName AS Medico,
          ROW_NUMBER() OVER(PARTITION BY V.RoomCode ORDER BY PC.Date DESC) as rn
        FROM PC
        JOIN V_MRPT V ON PC.PCNum = V.ControllerKey AND V.ControllerName = 'PC' AND (V.RoomName LIKE '%CAMA%' OR V.RoomCode LIKE 'CUBUTI%')
        LEFT JOIN PR ON PC.PRNum = PR.PRNum
        WHERE PC.PC_ST = 'OP' 
          AND PC.PCType IN ('IP', 'ER')
          AND PC.MedicalDischargeDate IS NULL
          AND V.RoomCode IS NOT NULL
          AND V.RoomName NOT LIKE '%VIRTUAL%'
          AND V.RoomName NOT LIKE '%VIRT%'
          AND V.RoomCode NOT LIKE '%VIRT%'
      )
      SELECT RoomCode, Paciente, Medico
      FROM CTE 
      WHERE rn = 1
    `);
    const occupied = occupiedResult.recordset;

    // 3. Cruzar datos
    const bedsMap = {};
    allBeds.forEach(b => {
      bedsMap[b.RoomCode] = { ...b, Estado: 'LIBRE', Paciente: null, Medico: null };
    });

    occupied.forEach(o => {
      if (bedsMap[o.RoomCode]) {
        bedsMap[o.RoomCode].Estado = 'OCUPADA';
        bedsMap[o.RoomCode].Paciente = o.Paciente;
        bedsMap[o.RoomCode].Medico = o.Medico;
      } else {
        // En caso de que el paciente esté en una cama que no fue capturada por el filtro LIKE '%CAMA%'
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

    const pool = await connectRemoteDB();
    const request = pool.request();

    let whereClauses = ["PC.PCType = 'ER'"];

    if (startDate) {
      whereClauses.push("PC.Date >= @startDate");
      request.input('startDate', startDate);
    } else {
      // Por defecto ultimo mes
      whereClauses.push("PC.Date >= DATEADD(day, -30, GETDATE())");
    }

    if (endDate) {
      whereClauses.push("PC.Date <= @endDate");
      request.input('endDate', endDate);
    } else {
      whereClauses.push("PC.Date <= GETDATE()");
    }

    if (search) {
      whereClauses.push("(PC.PCNum LIKE @search OR PC.PTNum IN (SELECT PTNum FROM PT WHERE FullName LIKE @search))");
      request.input('search', `%${search}%`);
    }

    // SAP Revenue Query (VERTICAL / OPERATIVO)
    let whereSAP = ["UNIDAD_DE_SERVICIO IN ('URG1', 'URG2')"];
    if (startDate) whereSAP.push("FECHA_DE_CARGO >= @startDate");
    if (endDate) whereSAP.push("FECHA_DE_CARGO <= @endDate");

    const sapStr = `
      SELECT 
        Medico_Solicitante,
        Medico_Tratante,
        DESCRIPCION_DEL_ARTICULO,
        TOTAL_COBRADO
      FROM UDR_CUENTAS_SERVICIOS
      WHERE ${whereSAP.join(' AND ')}
    `;
    const resSAP = await request.query(sapStr);
    const sapData = resSAP.recordset;

    // Calcular KPIs Financieros (VERTICAL)
    const ingresosTotales = sapData.reduce((acc, curr) => acc + (curr.TOTAL_COBRADO || 0), 0);
    
    // Cruce con SAP Contabilidad Oficial
    let ingresosSAPTotales = 0;
    try {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const todayStr = now.toISOString().split('T')[0];
      const sd = startDate ? new Date(startDate).toISOString().split('T')[0] : thirtyDaysAgo;
      const ed = endDate ? new Date(endDate).toISOString().split('T')[0] : todayStr;
      const sapSLRes = await sapService.fetchAllPages(`/SQLQueries('sq_ingresos_grupos')/List?startDate='${sd}'&endDate='${ed}'`);
      if (sapSLRes && sapSLRes.length > 0) {
        ingresosSAPTotales = sapSLRes
          .filter(row => row.ItmsGrpCod === 104) // 104 = AMBULANCIAS / URGENCIAS
          .reduce((acc, row) => acc + (row.Total || 0), 0);
      }
    } catch (e) {
      console.error('[SAP] Error al consultar ingresos contabilizados para Urgencias:', e.error || e);
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

    // 1. Obtener datos detallados
    const queryStr = `
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
    `;

    const result = await request.query(queryStr);
    const data = result.recordset;

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

/**
 * GET /api/dashboard/eficacia-nativo
 * Retorna datos de UDR_BI_PRODUCTIVIDAD_MEDICOS y V_UDR_CONSULTA_DIA
 */
router.get('/eficacia-nativo', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res, next) => {
  try {
    let { startDate, endDate, search, especialidad } = req.query;
    if (endDate && endDate.length === 10) endDate += ' 23:59:59';
    const pool = await connectRemoteDB();
    const request = pool.request();

    let whereProd = ["1=1"];
    let whereCons = ["1=1"];

    if (startDate) {
      whereProd.push("Fecha >= @startDate");
      whereCons.push("Fecha >= @startDate");
      request.input('startDate', startDate);
    }
    if (endDate) {
      whereProd.push("Fecha <= @endDate");
      whereCons.push("Fecha <= @endDate");
      request.input('endDate', endDate);
    }
    if (search) {
      whereProd.push("Medico LIKE @search");
      whereCons.push("(Medico LIKE @search OR Paciente LIKE @search)");
      request.input('search', `%${search}%`);
    }
    if (especialidad) {
      whereProd.push("Especialidad = @especialidad");
      // For V_UDR_CONSULTA_DIA, the column is MSDescription_ES
      whereCons.push("MSDescription_ES = @especialidad");
      request.input('especialidad', especialidad);
    }

    // 1. Tendencia Mensual (Consultas por mes)
    const tendenciaMensual = await request.query(`
      SELECT 
        FORMAT(Fecha, 'yyyy-MM') AS monthStr,
        SUM(TotalAtenciones) as Total,
        SUM(Primeras) as Primeras,
        SUM(Subsecuentes) as Subsecuentes
      FROM UDR_BI_PRODUCTIVIDAD_MEDICOS
      WHERE ${whereProd.join(' AND ')}
      GROUP BY FORMAT(Fecha, 'yyyy-MM')
      ORDER BY monthStr ASC
    `);

    // 2. Top Especialidades
    const topEspecialidades = await request.query(`
      SELECT TOP 10
        Especialidad,
        SUM(TotalAtenciones) as Total
      FROM UDR_BI_PRODUCTIVIDAD_MEDICOS
      WHERE ${whereProd.join(' AND ')}
      GROUP BY Especialidad
      ORDER BY Total DESC
    `);

    // 3. Top Médicos
    const topMedicos = await request.query(`
      SELECT TOP 10
        Medico,
        Especialidad,
        SUM(TotalAtenciones) as Total
      FROM UDR_BI_PRODUCTIVIDAD_MEDICOS
      WHERE ${whereProd.join(' AND ')}
      GROUP BY Medico, Especialidad
      ORDER BY Total DESC
    `);

    // 4. Estatus Consultas Día (Para gráfica de dona)
    const estatusResult = await request.query(`
      SELECT Estatus_Orden_Venta as nombre, COUNT(*) as valor
      FROM V_UDR_CONSULTA_DIA
      WHERE ${whereCons.join(' AND ')}
      GROUP BY Estatus_Orden_Venta
    `);

    // 5. Agregados Totales para KPIs
    const kpisResult = await request.query(`
      SELECT 
        SUM(TotalAtenciones) as TotalConsultas,
        SUM(Primeras) as TotalPrimeras,
        SUM(Subsecuentes) as TotalSubsecuentes
      FROM UDR_BI_PRODUCTIVIDAD_MEDICOS
      WHERE ${whereProd.join(' AND ')}
    `);

    // 6. Lista cruda para la tabla (Limitamos a 100 para no saturar)
    const listaResult = await request.query(`
      SELECT TOP 100
        Numero_Cita,
        Medico,
        MSDescription_ES as Especialidad,
        CONVERT(varchar, Fecha, 23) as Fecha,
        CONVERT(varchar, Hora, 108) as Hora,
        Paciente,
        Edad_Anios,
        Estatus_Orden_Venta,
        Articulo
      FROM V_UDR_CONSULTA_DIA
      WHERE ${whereCons.join(' AND ')}
      ORDER BY Fecha DESC, Hora DESC
    `);

    // 7. Detalle de Consultas para Drill-down (Agrupado por estatus)
    const detalleConsultas = {};
    listaResult.recordset.forEach(row => {
      const e = row.Estatus_Orden_Venta;
      if (!detalleConsultas[e]) detalleConsultas[e] = [];
      if (detalleConsultas[e].length < 50) {
        detalleConsultas[e].push(row);
      }
    });

    const kpis = kpisResult.recordset[0];
    const topEspecialidadText = topEspecialidades.recordset.length > 0 ? topEspecialidades.recordset[0].Especialidad : 'N/A';

    res.json({
      ok: true,
      data: {
        tendenciaMensual: tendenciaMensual.recordset,
        topEspecialidades: topEspecialidades.recordset,
        topMedicos: topMedicos.recordset,
        estatusConsultas: estatusResult.recordset,
        listaConsultas: listaResult.recordset,
        detalleConsultas,
        kpis: {
          totalConsultas: kpis?.TotalConsultas || 0,
          primeras: kpis?.TotalPrimeras || 0,
          subsecuentes: kpis?.TotalSubsecuentes || 0,
          topEspecialidad: topEspecialidadText
        }
      }
    });

  } catch (err) {
    console.error('Error consultando Eficacia Clínica:', err);
    res.status(500).json({ ok: false, error: 'Error de conexión con la base de datos remota.' });
  }
});

/**
 * GET /api/dashboard/filtros-eficacia
 * Retorna las listas únicas de Médicos y Especialidades para los slicers
 */
router.get('/filtros-eficacia', authenticate, async (req, res, next) => {
  try {
    const pool = await connectRemoteDB();

    const medicosResult = await pool.request().query(`
      SELECT DISTINCT Medico
      FROM UDR_BI_PRODUCTIVIDAD_MEDICOS
      WHERE Medico IS NOT NULL AND Medico != ''
      ORDER BY Medico
    `);

    const especialidadesResult = await pool.request().query(`
      SELECT DISTINCT Especialidad
      FROM UDR_BI_PRODUCTIVIDAD_MEDICOS
      WHERE Especialidad IS NOT NULL AND Especialidad != ''
      ORDER BY Especialidad
    `);

    res.json({
      ok: true,
      data: {
        medicos: medicosResult.recordset.map(m => m.Medico),
        especialidades: especialidadesResult.recordset.map(e => e.Especialidad)
      }
    });

  } catch (err) {
    console.error('Error consultando filtros de eficacia:', err);
    res.status(500).json({ ok: false, error: 'Error consultando filtros.' });
  }
});

/**
 * GET /api/dashboard/quirofano-nativo
 * Dashboard nativo para Quirófanos basado en la vista UDR_USOQX
 */
router.get('/quirofano-nativo', authenticate, authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA']), async (req, res, next) => {
  try {
    let { startDate, endDate, search } = req.query;

    if (startDate === 'undefined' || startDate === 'null' || startDate === '') startDate = null;
    if (endDate === 'undefined' || endDate === 'null' || endDate === '') endDate = null;
    if (search === 'undefined' || search === 'null' || search === '') search = null;

    const pool = await connectRemoteDB();
    const request = pool.request();

    let whereClauses = ["1=1"];

    if (startDate) {
      whereClauses.push("FechaInicio >= @startDate");
      request.input('startDate', startDate);
    }
    if (endDate) {
      whereClauses.push("FechaInicio <= @endDate");
      request.input('endDate', endDate);
    }
    if (search) {
      whereClauses.push("(Procedimientos LIKE @search OR Paciente LIKE @search OR Medicos LIKE @search)");
      request.input('search', `%${search}%`);
    }

    const queryStr = `
      SELECT 
        Quirofano,
        FechaInicio,
        FechaFin,
        Medicos,
        Procedimientos
      FROM UDR_USOQX
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY FechaInicio DESC
    `;

    const result = await request.query(queryStr);

    // SAP Revenue queries
    let ingresosSAPTotales = 0;
    let topMedicosIngresos = [];
    let topServiciosIngresos = [];
    let ingresosTotales = 0; // Para compatibilidad (Vertical)

    // Formatear fechas para SAP (últimos 30 días si no se especifican)
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const todayStr = now.toISOString().split('T')[0];
    const sd = startDate ? new Date(startDate).toISOString().split('T')[0] : thirtyDaysAgo;
    const ed = endDate ? new Date(endDate).toISOString().split('T')[0] : todayStr;

    // Inicializar caché global para Quirófanos si no existe
    if (!global.sapQuirofanoCache) {
      global.sapQuirofanoCache = new Map();
    }
    const CACHE_TTL = 3 * 60 * 1000; // 3 minutos de caché para frescura de datos financieros
    const cacheKey = `${sd}_${ed}`;
    const cached = global.sapQuirofanoCache.get(cacheKey);

    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
      ingresosSAPTotales = cached.ingresosSAPTotales;
      topMedicosIngresos = cached.topMedicosIngresos;
      topServiciosIngresos = cached.topServiciosIngresos;
      ingresosTotales = ingresosSAPTotales;
    } else {
      try {
        await sapService._ensureSession();

        // Ejecutar consultas HTTP de SAP de manera concurrente con Promise.all (GET simples sin paginación)
        const [totalRes, medRes, srvRes] = await Promise.all([
          sapService.get(`/SQLQueries('sq_quirofano_ingresos_totales')/List?startDate='${sd}'&endDate='${ed}'`).catch(err => {
            console.error('[SAP] Error cargando sq_quirofano_ingresos_totales:', err.message);
            return { data: { value: [] } };
          }),
          sapService.get(`/SQLQueries('sq_quirofano_top_medicos')/List?startDate='${sd}'&endDate='${ed}'`).catch(err => {
            console.error('[SAP] Error cargando sq_quirofano_top_medicos:', err.message);
            return { data: { value: [] } };
          }),
          sapService.get(`/SQLQueries('sq_quirofano_top_servicios')/List?startDate='${sd}'&endDate='${ed}'`).catch(err => {
            console.error('[SAP] Error cargando sq_quirofano_top_servicios:', err.message);
            return { data: { value: [] } };
          })
        ]);

        // 1. Obtener ingresos totales acumulados de Quirófano directamente del totalizador
        if (totalRes.data && totalRes.data.value && totalRes.data.value.length > 0) {
          ingresosSAPTotales = totalRes.data.value[0].ingresos || 0;
        }

        // 2. Obtener Top Médicos por Ingreso directamente de SAP
        if (medRes.data && medRes.data.value) {
          topMedicosIngresos = medRes.data.value
            .map(row => ({
              nombre: row.nombre || 'NO ESPECIFICADO',
              ingresos: row.ingresos || 0
            }))
            .sort((a, b) => b.ingresos - a.ingresos)
            .slice(0, 10);
        }

        // 3. Obtener Top Servicios Facturados directamente de SAP
        if (srvRes.data && srvRes.data.value) {
          topServiciosIngresos = srvRes.data.value
            .map(row => ({
              nombre: row.nombre || 'Desconocido',
              ingresos: row.ingresos || 0
            }))
            .sort((a, b) => b.ingresos - a.ingresos)
            .slice(0, 10);
        }

        ingresosTotales = ingresosSAPTotales;

        // Guardar en el caché
        global.sapQuirofanoCache.set(cacheKey, {
          ingresosSAPTotales,
          topMedicosIngresos,
          topServiciosIngresos,
          timestamp: Date.now()
        });

      } catch (e) {
        console.error('[SAP] Error al procesar analíticas de Quirófano en paralelo:', e.message || e);
      }
    }

    res.json({
      ok: true,
      data: {
        lista: result.recordset,
        kpisFinancieros: { ingresosTotales, ingresosSAP: ingresosSAPTotales },
        topMedicosIngresos,
        topServiciosIngresos
      }
    });
  } catch (err) {
    console.error('Error consultando Quirófano Nativo:', err);
    res.status(500).json({ ok: false, error: 'Error de conexión con la base de datos remota.' });
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

  /**
 * GET /api/dashboard/auxiliares-nativo/:tipo
 * Extrae volumen e ingresos operativos desde KH_HE (SQL Server) 
 * y los cruza con los Ingresos Contabilizados desde SAP.
 */
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
    const sd = startDate ? new Date(startDate).toISOString().split('T')[0] : startOfYear;
    const ed = endDate ? new Date(endDate).toISOString().split('T')[0] : todayStr;

    const { connectRemoteDB } = require('../config/remote-db');
    const pool = await connectRemoteDB();
    const request = pool.request();
    
    let whereClauses = ["s.AreaNombre = @areaNombre", "s.Fecha IS NOT NULL"];
    request.input('areaNombre', areaNombre);

    if (startDate) {
      whereClauses.push("s.Fecha >= @startDate");
      request.input('startDate', startDate);
    }
    if (endDate) {
      whereClauses.push("s.Fecha <= @endDate");
      request.input('endDate', endDate);
    }
    
    // 1. Obtener Tendencia Operativa (VERTICAL)
    const tendenciaQuery = await request.query(`
        SELECT 
          YEAR(s.Fecha) as Yr,
          MONTH(s.Fecha) as Mes,
          SUM(s.Cantidad) as volumen,
          SUM(CAST(ISNULL(p.LineTotal, 0) AS FLOAT)) as ingresos
        FROM UDR_BI_SOLICITUDES_ESTUDIOS s
        LEFT JOIN UDR_PAY_IMA p ON s.PCPRITNum = p.PCITNum
        WHERE ${whereClauses.join(' AND ')}
        GROUP BY YEAR(s.Fecha), MONTH(s.Fecha)
        ORDER BY Yr ASC, Mes ASC
      `);

    let tendenciaAnual = tendenciaQuery.recordset.map(row => ({
      Yr: row.Yr,
      Mes: row.Mes,
      volumen: row.volumen,
      ingresos: row.ingresos || 0,
      ingresosSAP: 0 // Valor por defecto
    }));

    // 2. Obtener Ingresos Contabilizados (SAP)
    try {
      const sapRes = await sapService.fetchAllPages(`/SQLQueries('sq_ingresos_grupos')/List?startDate='${sd}'&endDate='${ed}'`);
      
      if (sapRes && sapRes.length > 0) {
        // Agrupar SAP por Año y Mes
        const sapData = {}; // clave: "Yr-Mes"
        sapRes.forEach(row => {
          if (row.ItmsGrpCod === sapGroupCode && row.DocDate) {
            const yr = parseInt(row.DocDate.substring(0, 4), 10);
            const mes = parseInt(row.DocDate.substring(4, 6), 10);
            const key = `${yr}-${mes}`;
            if (!sapData[key]) sapData[key] = 0;
            sapData[key] += row.Total || 0;
          }
        });

        // Hacer el cruce (Join)
        Object.keys(sapData).forEach(key => {
          const [yrStr, mesStr] = key.split('-');
          const yr = parseInt(yrStr, 10);
          const mes = parseInt(mesStr, 10);
          
          let existing = tendenciaAnual.find(t => t.Yr === yr && t.Mes === mes);
          if (existing) {
            existing.ingresosSAP = sapData[key];
          } else {
            // Si SAP tiene ingresos en un mes que Vertical no tiene volumen, lo agregamos
            tendenciaAnual.push({
              Yr: yr,
              Mes: mes,
              volumen: 0,
              ingresos: 0,
              ingresosSAP: sapData[key]
            });
          }
        });

        // Re-ordenar cronológicamente después del merge
        tendenciaAnual.sort((a, b) => (a.Yr - b.Yr) || (a.Mes - b.Mes));
      }
    } catch (sapError) {
      console.error('[SAP] Error al cruzar ingresos en auxiliares:', sapError.error || sapError);
    }

    // Top Estudios
    const topQuery = await request.query(`
        SELECT TOP 10
          s.Estudio as procedimiento,
          SUM(s.Cantidad) as cantidad
        FROM UDR_BI_SOLICITUDES_ESTUDIOS s
        WHERE ${whereClauses.join(' AND ')}
        GROUP BY s.Estudio
        ORDER BY cantidad DESC
      `);

    res.json({
      success: true,
      tendenciaAnual,
      topEstudios: topQuery.recordset
    });
  } catch (error) {
    console.error('Error en auxiliares-nativo:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/dashboard/cuneros-nativo
 * Extrae datos de Neonatos (Cuneros) desde KH_HE
 */
router.get('/cuneros-nativo', authenticate, async (req, res, next) => {
  try {
    let { startDate, endDate } = req.query;

    // Default: año en curso si no se proporcionan fechas
    if (!startDate && !endDate) {
      const now = new Date();
      startDate = `${now.getFullYear()}-01-01`;
      endDate = now.toISOString().split('T')[0];
    }

    const pool = await connectRemoteDB();

    // 1. Total de Recién Nacidos — misma lógica validada que /stats (PC+PT+V_MRPT con BirthDate=Date)
    const rnRequest = pool.request();
    let rnWhere = [
      "p.PC_ST = 'CL'",
      "(v.RoomName LIKE '%CUNERO%' OR v.RoomCode LIKE '%CUN%')",
      "DATEDIFF(day, pt.BirthDate, p.Date) = 0"
    ];
    if (startDate) { rnWhere.push("CAST(p.Date AS DATE) >= @rnStart"); rnRequest.input('rnStart', startDate); }
    if (endDate)   { rnWhere.push("CAST(p.Date AS DATE) <= @rnEnd");   rnRequest.input('rnEnd', endDate); }

    const rnQuery = await rnRequest.query(`
      SELECT COUNT(DISTINCT p.PTNum) AS total_rn
      FROM PC p
      JOIN PT pt ON p.PTNum = pt.PTNum
      JOIN V_MRPT v ON p.PTNum = v.PTNum
      WHERE ${rnWhere.join(' AND ')}
    `);
    const totalRN = rnQuery.recordset[0].total_rn || 0;

    // 2. Ingresos SAP Contabilidad Oficial (Grupo 109 — CLINICA MUJER / CUNEROS) — FUENTE PRINCIPAL
    let ingresosSAPTotales = 0;
    try {
      const now = new Date();
      const startOfYear = `${now.getFullYear()}-01-01`;
      const todayStr = now.toISOString().split('T')[0];
      const sd = startDate ? new Date(startDate).toISOString().split('T')[0] : startOfYear;
      const ed = endDate ? new Date(endDate).toISOString().split('T')[0] : todayStr;
      const sapSLRes = await sapService.fetchAllPages(`/SQLQueries('sq_ingresos_grupos')/List?startDate='${sd}'&endDate='${ed}'`);
      if (sapSLRes && sapSLRes.length > 0) {
        ingresosSAPTotales = sapSLRes
          .filter(row => row.ItmsGrpCod === 109)
          .reduce((acc, row) => acc + (row.Total || 0), 0);
      }
    } catch (e) {
      console.error('[SAP] Error al consultar ingresos contabilizados para Cuneros:', e.error || e);
    }

    // 3. Ingresos UCIN Vertical (complemento)
    const ucRequest = pool.request();
    let whereUCIN = ["UNIDAD_DE_SERVICIO = 'UCIN'"];
    if (startDate) { whereUCIN.push("FECHA_DE_CARGO >= @ucStart"); ucRequest.input('ucStart', startDate); }
    if (endDate)   { whereUCIN.push("FECHA_DE_CARGO <= @ucEnd");   ucRequest.input('ucEnd', endDate); }
    const ingresosVertQuery = await ucRequest.query(`
      SELECT SUM(TOTAL_COBRADO) as total_ingresos
      FROM UDR_CUENTAS_SERVICIOS
      WHERE ${whereUCIN.join(' AND ')}
    `);
    const totalIngresosVertical = ingresosVertQuery.recordset[0].total_ingresos || 0;

    // 4. Fórmulas entregadas (Biberones)
    const fRequest = pool.request();
    let whereFormula = ["ima.FullName LIKE 'RN %'", "ima.ItemDescription LIKE '%FORMULA%'"];
    let joinFormula = "";
    if (startDate || endDate) {
      joinFormula = "INNER JOIN PCIT ON ima.PCITNum = PCIT.PCITNum INNER JOIN PC ON PCIT.PCNum = PC.PCNum";
      if (startDate) { whereFormula.push("CAST(PC.CreatedOn AS DATE) >= @fStart"); fRequest.input('fStart', startDate); }
      if (endDate)   { whereFormula.push("CAST(PC.CreatedOn AS DATE) <= @fEnd");   fRequest.input('fEnd', endDate); }
    }
    const formulasQuery = await fRequest.query(`
      SELECT SUM(ima.Quantity) as total_formulas 
      FROM UDR_PAY_IMA ima ${joinFormula}
      WHERE ${whereFormula.join(' AND ')}
    `);
    const totalFormulas = formulasQuery.recordset[0].total_formulas || 0;

    // 5. Top Insumos y Medicamentos
    const iRequest = pool.request();
    let whereIns = ["ima.FullName LIKE 'RN %'"];
    let joinIns = "";
    if (startDate || endDate) {
      joinIns = "INNER JOIN PCIT ON ima.PCITNum = PCIT.PCITNum INNER JOIN PC ON PCIT.PCNum = PC.PCNum";
      if (startDate) { whereIns.push("CAST(PC.CreatedOn AS DATE) >= @iStart"); iRequest.input('iStart', startDate); }
      if (endDate)   { whereIns.push("CAST(PC.CreatedOn AS DATE) <= @iEnd");   iRequest.input('iEnd', endDate); }
    }
    const insumosQuery = await iRequest.query(`
      SELECT TOP 10 
        ima.ItemDescription as item, 
        SUM(ima.Quantity) as cantidad,
        SUM(CAST(ISNULL(ima.LineTotal, 0) AS FLOAT)) as ingresos
      FROM UDR_PAY_IMA ima ${joinIns}
      WHERE ${whereIns.join(' AND ')}
        AND ima.ItemDescription NOT LIKE '%FORMULA%'
        AND ima.ItemDescription NOT LIKE '%USO DE OXIGENO%'
        AND ima.ItemDescription NOT LIKE '%USO PUNTAS PARA OXIGENO%'
        AND ima.ItemDescription NOT LIKE '%ESTANCIA%'
        AND ima.ItemDescription NOT LIKE '%GRUPO SANGUINEO%'
        AND ima.ItemDescription NOT LIKE '%TOMA DE GLUCOSA%'
        AND ima.ItemDescription NOT LIKE '%Anticipo%'
        AND ima.ItemDescription NOT LIKE '%CONSULTA%'
      GROUP BY ima.ItemDescription
      ORDER BY cantidad DESC
    `);
    const topInsumos = insumosQuery.recordset;

    // 6. Distribución de Servicios
    const sRequest = pool.request();
    let whereServ = ["ima.FullName LIKE 'RN %'"];
    let joinServ = "";
    if (startDate || endDate) {
      joinServ = "INNER JOIN PCIT ON ima.PCITNum = PCIT.PCITNum INNER JOIN PC ON PCIT.PCNum = PC.PCNum";
      if (startDate) { whereServ.push("CAST(PC.CreatedOn AS DATE) >= @sStart"); sRequest.input('sStart', startDate); }
      if (endDate)   { whereServ.push("CAST(PC.CreatedOn AS DATE) <= @sEnd");   sRequest.input('sEnd', endDate); }
    }
    const serviciosQuery = await sRequest.query(`
      SELECT 
        ima.ItemDescription as servicio, 
        SUM(ima.Quantity) as cantidad
      FROM UDR_PAY_IMA ima ${joinServ}
      WHERE ${whereServ.join(' AND ')}
        AND (
          ima.ItemDescription LIKE '%USO DE OXIGENO%' OR 
          ima.ItemDescription LIKE '%USO PUNTAS PARA OXIGENO%' OR
          ima.ItemDescription LIKE '%ESTANCIA DE CUNERO%' OR
          ima.ItemDescription LIKE '%TOMA DE GLUCOSA%' OR
          ima.ItemDescription LIKE '%GRUPO SANGUINEO%' OR
          ima.ItemDescription LIKE '%TAMIZ%'
        )
      GROUP BY ima.ItemDescription
      ORDER BY cantidad DESC
    `);
    const topServicios = serviciosQuery.recordset;

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


/**
 * GET /api/dashboard/geografia
 * Datos geográficos para el dashboard demográfico
 */
router.get('/geografia', authenticate, async (req, res) => {
  try {
    const db = getDb();
    
    let estados = [];
    let ciudades = [];

    // Ahora traemos la demografía desde el sistema nuevo Verical (SQL Server)
    const { connectRemoteDB } = require('../config/remote-db');
    const pool = await connectRemoteDB();

    const estadosQuery = await pool.request().query(`
      SELECT StateCode as estado, COUNT(*) as cantidad 
      FROM PT 
      WHERE StateCode IS NOT NULL 
      GROUP BY StateCode 
      ORDER BY cantidad DESC 
    `);
    estados = estadosQuery.recordset;

    const ciudadesQuery = await pool.request().query(`
      SELECT City as ciudad, COUNT(*) as cantidad 
      FROM PT 
      WHERE City IS NOT NULL 
      GROUP BY City 
      ORDER BY cantidad DESC 
    `);
    ciudades = ciudadesQuery.recordset;

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

module.exports = router;


