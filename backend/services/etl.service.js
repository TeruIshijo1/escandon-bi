/**
 * etl.service.js
 * Servicio ETL para Auditoría: Inventarios vs. Cargos de Enfermería
 * Hospital Escandón BI Platform v1.0
 *
 * Proceso ETL:
 *  EXTRACT  → Lee órdenes de almacén (AlmacenOrdenes) y cargos de enfermería (CargosEnfermeria)
 *  TRANSFORM→ Cruza por (PacienteId + InsumoId + Fecha) y calcula diferencias
 *  LOAD     → Escribe resultados en AuditoriaInventarioCargos y devuelve JSON
 */
'use strict';

const { getDb } = require('../config/db');

/* ══════════════════════════════════════════════════════════════
   ENDPOINT PRINCIPAL — /api/audit/inventarios-vs-cargos
   Devuelve conciliación con métricas de resumen
══════════════════════════════════════════════════════════════ */
async function getInventariosVsCargos({ area, estado, fechaDesde, fechaHasta, limit = 500 }) {
  const db = getDb();

  // ── 1. EXTRACT: Leer órdenes del Almacén ──────────────────
  let ordenesSQL = `
    SELECT
      ao.OrdenId,
      ao.PacienteId,
      p.NombreCompleto        AS NombrePaciente,
      ao.AreaHospitalaria,
      ao.InsumoId,
      i.Descripcion           AS Insumo,
      i.CodigoBarras,
      ao.CantidadSurtida      AS CantAlmacen,
      ao.PrecioUnitario,
      ao.FechaSurtido         AS Fecha,
      ao.EnfermeraReceptora
    FROM AlmacenOrdenes ao
    JOIN Pacientes p  ON p.PacienteId  = ao.PacienteId
    JOIN Insumos   i  ON i.InsumoId    = ao.InsumoId
    WHERE ao.Estado = 'SURTIDA'
  `;

  const params = [];

  if (area) {
    ordenesSQL += ` AND ao.AreaHospitalaria = ?`;
    params.push(area);
  }
  if (fechaDesde) {
    ordenesSQL += ` AND ao.FechaSurtido >= ?`;
    params.push(fechaDesde);
  }

  ordenesSQL += ` AND ao.FechaSurtido <= ?`;
  params.push(fechaHasta || new Date().toISOString());

  ordenesSQL += ` ORDER BY ao.FechaSurtido DESC`;

  const ordenes = db.prepare(ordenesSQL).all(...params);

  // ── 2. EXTRACT: Leer cargos de enfermería correspondientes ──
  const cargoIds = ordenes.map(o => o.OrdenId);

  const cargosMap = new Map();
  if (cargoIds.length > 0) {
    const placeholders = cargoIds.map(() => '?').join(',');
    const cargos = db.prepare(`
      SELECT
        ce.OrdenAlmacenId,
        ce.CantidadCargada  AS CantCargo,
        ce.FechaCargo,
        ce.EnfermerId,
        u.NombreCompleto    AS NombreEnfermera
      FROM CargosEnfermeria ce
      JOIN Usuarios u ON u.UsuarioId = ce.EnfermerId
      WHERE ce.OrdenAlmacenId IN (${placeholders})
    `).all(...cargoIds);

    for (const c of cargos) {
      cargosMap.set(c.OrdenAlmacenId, c);
    }
  }

  // ── 3. TRANSFORM: Cruzar y calcular diferencias ───────────
  const partidas = ordenes.map(o => {
    const cargo      = cargosMap.get(o.OrdenId);
    const cantCargo  = cargo?.CantCargo ?? 0;
    const diferencia = cantCargo - o.CantAlmacen;
    const monto      = Math.abs(diferencia) * o.PrecioUnitario;

    let estadoConciliacion;
    if (diferencia === 0)      estadoConciliacion = 'COINCIDE';
    else if (diferencia > 0)   estadoConciliacion = 'EXCEDENTE';
    else if (cantCargo === 0)  estadoConciliacion = 'FALTANTE';
    else                       estadoConciliacion = 'DIFERENCIA';

    return {
      orden:       o.OrdenId,
      paciente:    o.NombrePaciente,
      area:        o.AreaHospitalaria,
      insumo:      o.Insumo,
      codigo:      o.CodigoBarras,
      cantAlmacen: o.CantAlmacen,
      cantCargo,
      diferencia,
      monto,
      estado:      estadoConciliacion,
      enfermera:   cargo?.NombreEnfermera || o.EnfermeraReceptora || 'Sin registro',
      fecha:       o.Fecha ? o.Fecha.split('T')[0] : '',
    };
  });

  // Filtro de estado (post-transform)
  const filtradas = estado
    ? partidas.filter(p => p.estado === estado)
    : partidas;

  // ── 4. TRANSFORM: Calcular métricas de resumen ────────────
  const resumen = calcularResumen(filtradas);

  // ── 5. LOAD: Persistir resultados en tabla de auditoría ───
  //    (En producción se haría como job programado, no en cada request)
  persistirResultados(db, filtradas);

  return {
    generadoEn:  new Date().toISOString(),
    totalRegistros: filtradas.length,
    resumen,
    partidas:    filtradas.slice(0, limit),
  };
}

/* ── Cálculo de métricas ─────────────────────────────────── */
function calcularResumen(partidas) {
  const totales = {
    totalPartidas:  partidas.length,
    coincidencias:  0,
    diferencias:    0,
    faltantes:      0,
    excedentes:     0,
    montoDisputa:   0,
    porcentajeConciliado: 0,
  };

  for (const p of partidas) {
    switch (p.estado) {
      case 'COINCIDE':   totales.coincidencias++;                          break;
      case 'DIFERENCIA': totales.diferencias++;  totales.montoDisputa += p.monto; break;
      case 'FALTANTE':   totales.faltantes++;    totales.montoDisputa += p.monto; break;
      case 'EXCEDENTE':  totales.excedentes++;   totales.montoDisputa += p.monto; break;
    }
  }

  totales.montoDisputa        = Math.round(totales.montoDisputa * 100) / 100;
  totales.porcentajeConciliado =
    totales.totalPartidas > 0
      ? Math.round((totales.coincidencias / totales.totalPartidas) * 10000) / 100
      : 100;

  return totales;
}

/* ── Persistir en tabla de auditoría ──────────────────────── */
function persistirResultados(db, partidas) {
  if (!partidas.length) return;

  const insertStmt = db.prepare(`
    INSERT INTO AuditoriaInventarioCargos
      (OrdenId, EstadoConciliacion, Diferencia, MontoDisputa, FechaAuditoria)
    VALUES (?, ?, ?, ?, datetime('now','localtime'))
  `);

  const insertMany = db.transaction((items) => {
    for (const p of items) {
      if (p.estado !== 'COINCIDE') { // Solo persistir discrepancias
        insertStmt.run(p.orden, p.estado, p.diferencia, p.monto);
      }
    }
  });

  try {
    insertMany(partidas);
  } catch (err) {
    // No fallar el request por error de persistencia
    console.error('[ETL] Error al persistir resultados:', err.message);
  }
}

/* ══════════════════════════════════════════════════════════════
   SERVICIO AUXILIAR — KPIs de Productividad (para Dashboard)
══════════════════════════════════════════════════════════════ */
async function getKPIsProductividad({ area } = {}) {
  const db = getDb();

  let sql = `
    SELECT
      COUNT(DISTINCT e.EgresoId)                                                      AS TotalEgresos,
      AVG(CAST(julianday(e.FechaEgreso) - julianday(a.FechaIngreso) AS INTEGER))      AS EstanciaPromedioHospDias,
      ROUND(
        CAST(COUNT(DISTINCT a.AdmisionId) AS REAL) * 100.0 /
        MAX((SELECT COUNT(*) FROM Camas WHERE (? IS NULL OR Area = ?)), 1)
      , 1)                                                                             AS OcupacionPorcentaje,
      ROUND(
        CAST(COUNT(DISTINCT e.EgresoId) AS REAL) /
        MAX((SELECT COUNT(*) FROM Camas WHERE (? IS NULL OR Area = ?)), 1)
      , 2)                                                                             AS RotacionCamas
    FROM Egresos e
    JOIN Admisiones a ON a.AdmisionId = e.AdmisionId
    WHERE e.FechaEgreso >= datetime('now', '-1 month')
      AND (? IS NULL OR e.AreaEgreso = ?)
  `;

  const areaParam = area || null;
  const row = db.prepare(sql).get(areaParam, areaParam, areaParam, areaParam, areaParam, areaParam);

  return {
    totalEgresos:     row?.TotalEgresos || 0,
    estanciaPromedio: row?.EstanciaPromedioHospDias || 0,
    ocupacion:        row?.OcupacionPorcentaje || 0,
    rotacionCamas:    row?.RotacionCamas || 0,
  };
}

/* ── Tasa de Mortalidad ──────────────────────────────────── */
async function getTasaMortalidad({ periodo = 'mes' } = {}) {
  const db = getDb();

  const dias = periodo === 'semana' ? 7 : periodo === 'año' ? 365 : 30;

  const row = db.prepare(`
    SELECT
      COUNT(*) AS TotalEgresos,
      SUM(CASE WHEN e.TipoEgreso = 'DEFUNCION' THEN 1 ELSE 0 END) AS Defunciones,
      ROUND(
        CAST(SUM(CASE WHEN e.TipoEgreso = 'DEFUNCION' THEN 1 ELSE 0 END) AS REAL)
        * 100.0 / MAX(COUNT(*), 1)
      , 2) AS TasaMortalidad
    FROM Egresos e
    WHERE e.FechaEgreso >= datetime('now', '-' || ? || ' days')
  `).get(dias);

  return {
    periodo,
    totalEgresos: row?.TotalEgresos  || 0,
    defunciones:  row?.Defunciones   || 0,
    tasa:         row?.TasaMortalidad || 0,
  };
}

module.exports = {
  getInventariosVsCargos,
  getKPIsProductividad,
  getTasaMortalidad,
};
