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
             NombreDefault, NombreCustom, Icono, PBIUrl, PBIUrl2, PBIUrl3, MultiPagina
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
        multiPagina:  kpi.MultiPagina === 1,
        nombreDefault: kpi.NombreDefault,
        nombreCustom:  kpi.NombreCustom,
      };
    }

    res.json({ ok: true, data: map });
  } catch (err) { next(err); }
});

module.exports = router;

