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
      let dateFilter = "-1 month";
      if (periodo === 'semana')    dateFilter = "-7 days";
      if (periodo === 'trimestre') dateFilter = "-3 months";
      if (periodo === 'año')       dateFilter = "-1 year";

      // 1. KPIs Generales
      const general = db.prepare(`
        SELECT 
          COUNT(*) AS TotalEgresos,
          ROUND(AVG(CAST(strftime('%Y', 'now') - strftime('%Y', p.FechaNacimiento) AS REAL)), 1) AS PromedioEdad,
          SUM(CASE WHEN e.TipoEgreso = 'DEFUNCION' THEN 1 ELSE 0 END) AS Defunciones,
          ROUND(AVG(CAST(julianday(e.FechaEgreso) - julianday(a.FechaIngreso) AS REAL)), 1) AS EstanciaPromedio,
          (SELECT COUNT(*) FROM Egresos WHERE AreaEgreso = 'CUNEROS' AND FechaEgreso >= datetime('now', ?)) AS Nacimientos
        FROM Egresos e
        JOIN Admisiones a ON a.AdmisionId = e.AdmisionId
        JOIN Pacientes p ON a.PacienteId = p.PacienteId
        WHERE e.FechaEgreso >= datetime('now', ?)
      `).get(dateFilter, dateFilter);

      // 2. Género
      const generos = db.prepare(`
        SELECT p.Genero, COUNT(*) as Cantidad
        FROM Egresos e
        JOIN Admisiones a ON a.AdmisionId = e.AdmisionId
        JOIN Pacientes p ON a.PacienteId = p.PacienteId
        WHERE e.FechaEgreso >= datetime('now', ?)
        GROUP BY p.Genero
      `).all(dateFilter);

      const totalGen = generos.reduce((s, g) => s + g.Cantidad, 0);
      const pctFemenino = totalGen > 0 
        ? ((generos.find(g => g.Genero === 'F' || g.Genero === 'FEMENINO')?.Cantidad || 0) * 100 / totalGen).toFixed(1)
        : 0;

      // 3. Top Diagnósticos
      const diagnosticos = db.prepare(`
        SELECT 
          DiagnosticoEgreso as dx, 
          COUNT(*) as n,
          ROUND(CAST(COUNT(*) AS REAL) * 100.0 / (SELECT COUNT(*) FROM Egresos WHERE FechaEgreso >= datetime('now', ?)), 1) as pct
        FROM Egresos
        WHERE FechaEgreso >= datetime('now', ?)
        GROUP BY DiagnosticoEgreso
        ORDER BY n DESC
        LIMIT 8
      `).all(dateFilter, dateFilter);

      // 4. Egresos por Servicio
      const servicios = db.prepare(`
        SELECT 
          AreaEgreso as area, 
          COUNT(*) as n
        FROM Egresos
        WHERE FechaEgreso >= datetime('now', ?)
        GROUP BY AreaEgreso
        ORDER BY n DESC
      `).all(dateFilter);

      res.json({
        ok: true,
        data: {
          general: {
            ...general,
            pctFemenino
          },
          diagnosticos,
          servicios
        }
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
const { connectRemoteDB } = require('../config/remote-db');

router.get('/financiero-nativo', authenticate, async (req, res, next) => {
  try {
    const { startDate, endDate, search } = req.query;
    const pool = await connectRemoteDB();
    const request = pool.request();

    let whereClauses = ["1=1"];

    if (startDate) {
      whereClauses.push("PC.Date >= @startDate");
      request.input('startDate', startDate);
    } else {
      whereClauses.push("PC.Date >= DATEADD(month, -6, GETDATE())");
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
    let totalIng = 0, totalUt = 0, totalCuentas = 0;
    Object.keys(dataByMonth).forEach(m => {
      totalIng += dataByMonth[m].Ingresos;
      totalUt += dataByMonth[m].Utilidad;
      totalCuentas += dataByMonth[m].Balance;
    });

    // Ordenar los registros válidos por fecha descendente y tomar los top 100
    const listaCuentas = validRecords
      .sort((a,b) => new Date(b.MedicalDischargeDate) - new Date(a.MedicalDischargeDate))
      .slice(0, 100);

    res.json({
      ok: true,
      data: {
        tendenciaMensual,
        listaCuentas,
        kpis: {
          ingresosAcumulados: totalIng,
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
router.get('/eficiencia-nativo', authenticate, async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
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
router.get('/censo-camas', authenticate, async (req, res, next) => {
  try {
    const pool = await connectRemoteDB();

    // 1. Obtener listado maestro de camas
    const bedsResult = await pool.request().query(`
      SELECT DISTINCT RoomCode, RoomName 
      FROM V_MRPT 
      WHERE RoomName LIKE '%CAMA%' 
        AND RoomName IS NOT NULL
    `);
    const allBeds = bedsResult.recordset;

    // 2. Obtener camas ocupadas actualmente (última cama asignada)
    const occupiedResult = await pool.request().query(`
      WITH CTE AS (
        SELECT 
          V.RoomCode, 
          V.FullName AS Paciente, 
          PR.FullName AS Medico,
          ROW_NUMBER() OVER(PARTITION BY V.RoomCode ORDER BY PC.Date DESC) as rn
        FROM PC
        JOIN V_MRPT V ON PC.PTNum = V.PTNum AND V.RoomName LIKE '%CAMA%'
        LEFT JOIN PR ON PC.PRNum = PR.PRNum
        WHERE PC.PC_ST = 'OP' 
          AND PC.PCType IN ('IP', 'ER')
          AND PC.MedicalDischargeDate IS NULL
          AND V.RoomCode IS NOT NULL
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
router.get('/urgencias-nativo', authenticate, async (req, res, next) => {
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
          rotacion
        },
        tendencia: formatArr(tendenciaAgrupada),
        estatus: formatArr(estatusAgrupado),
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
router.get('/eficacia-nativo', authenticate, async (req, res, next) => {
  try {
    const { startDate, endDate, search, especialidad } = req.query;
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
        kpis: {
          totalConsultas: kpis.TotalConsultas || 0,
          primeras: kpis.TotalPrimeras || 0,
          subsecuentes: kpis.TotalSubsecuentes || 0,
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
router.get('/quirofano-nativo', authenticate, async (req, res, next) => {
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

    res.json({
      ok: true,
      data: result.recordset
    });
  } catch (err) {
    console.error('Error consultando Quirófano Nativo:', err);
    res.status(500).json({ ok: false, error: 'Error de conexión con la base de datos remota.' });
  }
});

const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

/**
 * GET /api/dashboard/export-excel
 * Exporta la tabla de datos cruda del dashboard a Excel con el logo y formato institucional
 */
router.get('/export-excel', authenticate, async (req, res, next) => {
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

module.exports = router;

