/**
 * etl.service.js
 * Servicio ETL para Auditoría: Inventarios vs. Cargos de Enfermería
 * Hospital Escandón BI Platform v1.0
 *
 * Proceso ETL Real desde SQL Server KH_HE (UDR_CUENTAS_SERVICIOS)
 */
const { getDb } = require('../config/db');
const { getRemoteDb, sql } = require('../config/remote-db');

/* ══════════════════════════════════════════════════════════════
   ENDPOINT PRINCIPAL — /api/audit/inventarios-vs-cargos
   Devuelve datos reales de conciliación cruzando la base KH_HE
══════════════════════════════════════════════════════════════ */
async function getInventariosVsCargos({ area, estado, fechaDesde, fechaHasta, limit = 500 }) {
  const db = getDb();
  let pool;
  try {
    pool = await getRemoteDb();
  } catch (err) {
    throw new Error('No se pudo conectar a la base de datos KH_HE: ' + err.message);
  }

  const request = pool.request();
  request.input('limit', sql.Int, limit);

  let querySQL = `
    SELECT TOP (@limit)
      NUMERO_DE_ORDEN              AS OrdenId,
      NOMBRE_DEL_PACIENTE          AS NombrePaciente,
      UNIDAD_DE_SERVICIO           AS AreaHospitalaria,
      DESCRIPCION_DEL_ARTICULO     AS Insumo,
      CODIGO                       AS CodigoBarras,
      CANTIDAD                     AS CantAlmacen,
      (CANTIDAD - ISNULL(DEVUELTO, 0)) AS CantCargo,
      ISNULL(DEVUELTO, 0)          AS Devuelto,
      ISNULL(TOTAL_COBRADO, ISNULL(TOTAL_SIN_DESC, 0)) AS Monto,
      FECHA_DE_CARGO               AS Fecha,
      Medico_Solicitante           AS EnfermeraReceptora
    FROM UDR_CUENTAS_SERVICIOS
    WHERE 1=1
  `;

  if (area) {
    querySQL += ` AND UNIDAD_DE_SERVICIO LIKE @area`;
    request.input('area', sql.VarChar, `%${area}%`);
  }
  if (fechaDesde) {
    querySQL += ` AND FECHA_DE_CARGO >= @fechaDesde`;
    request.input('fechaDesde', sql.VarChar, fechaDesde);
  }
  if (fechaHasta) {
    querySQL += ` AND FECHA_DE_CARGO <= @fechaHasta`;
    request.input('fechaHasta', sql.VarChar, fechaHasta);
  }

  querySQL += ` ORDER BY FECHA_DE_CARGO DESC`;

  const result = await request.query(querySQL);
  const rows = result.recordset || [];

  // Mapear registros reales de la base KH_HE
  const partidas = rows.map(r => {
    const devuelto = r.Devuelto || 0;
    const cantAlmacen = r.CantAlmacen || 1;
    const cantCargo = r.CantCargo || 1;
    const diferencia = devuelto > 0 ? -devuelto : (cantCargo - cantAlmacen);
    const monto = parseFloat(r.Monto || 0);

    let estadoConciliacion = 'COINCIDE';
    if (devuelto > 0) estadoConciliacion = 'FALTANTE';
    else if (diferencia < 0) estadoConciliacion = 'DIFERENCIA';
    else if (diferencia > 0) estadoConciliacion = 'EXCEDENTE';

    let fechaStr = '';
    if (r.Fecha) {
      try {
        fechaStr = new Date(r.Fecha).toISOString().split('T')[0];
      } catch (e) {
        fechaStr = String(r.Fecha).slice(0, 10);
      }
    }

    return {
      orden: 'ORD-' + (r.OrdenId || '000'),
      paciente: r.NombrePaciente || 'PACIENTE NO REGISTRADO',
      area: r.AreaHospitalaria || 'GENERAL',
      insumo: r.Insumo || 'PRODUCTO SIN DESCRIPCION',
      codigo: r.CodigoBarras || 'N/A',
      cantAlmacen,
      cantCargo,
      diferencia,
      monto,
      estado: estadoConciliacion,
      enfermera: r.EnfermeraReceptora || 'PERSONAL NO ASIGNADO',
      fecha: fechaStr,
    };
  });

  // Filtro por estado
  const filtradas = estado
    ? partidas.filter(p => p.estado === estado)
    : partidas;

  // Métricas de resumen reales
  const resumen = calcularResumen(filtradas);

  // Persistir discrepancias en BD SQLite local
  persistirResultados(db, filtradas);

  return {
    generadoEn: new Date().toISOString(),
    totalRegistros: filtradas.length,
    resumen,
    partidas: filtradas,
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

  totales.montoDisputa = Math.round(totales.montoDisputa * 100) / 100;
  totales.porcentajeConciliado =
    totales.totalPartidas > 0
      ? Math.round((totales.coincidencias / totales.totalPartidas) * 10000) / 100
      : 100;

  return totales;
}

/* ── Persistir en tabla de auditoría local ──────────────────────── */
function persistirResultados(db, partidas) {
  if (!partidas.length) return;

  const insertStmt = db.prepare(`
    INSERT INTO AuditoriaInventarioCargos
      (OrdenId, EstadoConciliacion, Diferencia, MontoDisputa, FechaAuditoria)
    VALUES (?, ?, ?, ?, datetime('now','localtime'))
  `);

  const insertMany = db.transaction((items) => {
    for (const p of items) {
      if (p.estado !== 'COINCIDE') {
        insertStmt.run(p.orden, p.estado, p.diferencia, p.monto);
      }
    }
  });

  try {
    insertMany(partidas);
  } catch (err) {
    console.warn('[ETL] Aviso al persistir resultados:', err.message);
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
