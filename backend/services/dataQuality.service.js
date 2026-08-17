/**
 * dataQuality.service.js — Motor de Control de Calidad de Datos
 * Hospital Escandón BI Platform
 */
'use strict';

const { getDb } = require('../config/db');
const { getRemoteDb } = require('../config/remote-db');

/**
 * Escanea la base de datos viva (UDR_CUENTAS_SERVICIOS) del hospital para detectar anomalías de calidad
 */
async function runLiveQualityScan() {
  const db = getDb();
  try {
    const pool = await getRemoteDb();
    const res = await pool.request().query(`
      SELECT TOP 200
        NUMERO_DE_ORDEN              AS OrdenId,
        NOMBRE_DEL_PACIENTE          AS NombrePaciente,
        UNIDAD_DE_SERVICIO           AS Area,
        CODIGO                       AS Codigo,
        DESCRIPCION_DEL_ARTICULO     AS Descripcion,
        CANTIDAD                     AS Cantidad,
        ISNULL(DEVUELTO, 0)          AS Devuelto,
        ISNULL(TOTAL_COBRADO, 0)     AS TotalCobrado,
        ISNULL(PRECIO_UNITARIO, 0)   AS PrecioUnitario,
        FECHA_DE_CARGO               AS Fecha
      FROM UDR_CUENTAS_SERVICIOS
      ORDER BY FECHA_DE_CARGO DESC
    `);

    const rows = res.recordset || [];
    let detected = 0;

    const checkExistsStmt = db.prepare(`
      SELECT COUNT(*) as count FROM data_quality_issues
      WHERE item_code = ? AND patient_id = ? AND rule_failed = ?
    `);

    const insertStmt = db.prepare(`
      INSERT INTO data_quality_issues (source, rule_failed, severity, item_code, description, patient_id, row_data, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDIENTE')
    `);

    for (const r of rows) {
      const price = parseFloat(r.TotalCobrado || r.PrecioUnitario || 0);
      const qty = parseFloat(r.Cantidad || 0);
      const desc = r.Descripcion || 'DESCONOCIDO';
      const code = r.Codigo || 'N/A';
      const patient = r.NombrePaciente || 'PACIENTE NO REGISTRADO';

      // Regla 1: Precio $0.00 en estudio o servicio cargado
      if (price === 0 && qty > 0) {
        const exists = await checkExistsStmt.get(code, patient, 'PRECIO_ZERO');
        if (!exists || exists.count === 0) {
          await insertStmt.run('BASE_DATOS_VIVO', 'PRECIO_ZERO', 'ALTA', code, desc, patient, JSON.stringify(r));
          detected++;
        }
      }

      // Regla 2: Cantidad Atípica / Elevada
      if (qty >= 10) {
        const exists = await checkExistsStmt.get(code, patient, 'CANTIDAD_ANOMALA');
        if (!exists || exists.count === 0) {
          await insertStmt.run('BASE_DATOS_VIVO', 'CANTIDAD_ANOMALA', 'MEDIA', code, desc, patient, JSON.stringify(r));
          detected++;
        }
      }

      // Regla 3: Devoluciones no conciliadas
      if (r.Devuelto > 0) {
        const exists = await checkExistsStmt.get(code, patient, 'DEVOLUCION_PENDIENTE');
        if (!exists || exists.count === 0) {
          await insertStmt.run('BASE_DATOS_VIVO', 'DEVOLUCION_PENDIENTE', 'MEDIA', code, desc, patient, JSON.stringify(r));
          detected++;
        }
      }
    }

    return { success: true, detectedNewIssues: detected };
  } catch (err) {
    console.warn('[CalidadDatos] Aviso al escanear BD viva:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Inspecciona un registro individual en busca de anomalías
 */
async function inspectRecord(record, source = 'CARGA_MANUAL') {
  const db = getDb();
  const issuesFound = [];

  const itemCode = record.item_code || record.CodigoInsumo || record.codigo || 'DESCONOCIDO';
  const description = record.description || record.DescripcionInsumo || record.descripcion || 'Sin Descripción';
  const patientId = record.patient_id || record.NoExpediente || record.paciente_id || null;
  const price = parseFloat(record.price || record.PrecioUnitario || record.precio || 0);
  const quantity = parseFloat(record.quantity || record.Cantidad || record.cantidad || 0);

  if (price <= 0) {
    issuesFound.push({
      rule: 'PRECIO_ZERO',
      severity: 'ALTA',
      message: `El producto '${description}' (${itemCode}) fue registrado con un precio de $${price.toFixed(2)}.`,
    });
  }

  if (quantity > 20) {
    issuesFound.push({
      rule: 'CANTIDAD_ANOMALA',
      severity: 'MEDIA',
      message: `Se registró una cantidad inusualmente alta (${quantity} unidades) para '${description}'.`,
    });
  }

  const insertStmt = db.prepare(`
    INSERT INTO data_quality_issues (source, rule_failed, severity, item_code, description, patient_id, row_data, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDIENTE')
  `);

  for (const issue of issuesFound) {
    await insertStmt.run(
      source,
      issue.rule,
      issue.severity,
      itemCode,
      description,
      patientId,
      JSON.stringify({ ...record, _issueMessage: issue.message })
    );
  }

  return issuesFound;
}

/**
 * Obtener lista de hallazgos de calidad con filtros
 */
async function getQualityIssues(filters = {}) {
  const db = getDb();
  const { status, severity, limit = 100 } = filters;

  let sql = `SELECT * FROM data_quality_issues WHERE 1=1`;
  const params = [];

  if (status) {
    sql += ` AND status = ?`;
    params.push(status);
  }
  if (severity) {
    sql += ` AND severity = ?`;
    params.push(severity);
  }

  sql += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(parseInt(limit, 10));

  const rows = await db.prepare(sql).all(...params);

  return rows.map(row => ({
    ...row,
    row_data: row.row_data ? JSON.parse(row.row_data) : null,
  }));
}

/**
 * Resolver o ignorar una anomalía de calidad
 */
async function resolveIssue(id, status, notes = '', resolvedBy = 'AUDITOR') {
  const db = getDb();
  if (!['RESUELTO', 'IGNORADO'].includes(status)) {
    throw new Error("Estado inválido. Debe ser 'RESUELTO' o 'IGNORADO'.");
  }

  const result = await db.prepare(`
    UPDATE data_quality_issues
    SET status = ?, resolution_notes = ?, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, notes, resolvedBy, id);

  return result.changes > 0;
}

/**
 * Obtener estadísticas globales de calidad de datos
 */
async function getQualityStats() {
  const db = getDb();

  const totalIssues = (await db.prepare(`SELECT COUNT(*) as count FROM data_quality_issues`).get()).count;
  const pendingIssues = (await db.prepare(`SELECT COUNT(*) as count FROM data_quality_issues WHERE status = 'PENDIENTE'`).get()).count;
  const resolvedIssues = (await db.prepare(`SELECT COUNT(*) as count FROM data_quality_issues WHERE status = 'RESUELTO'`).get()).count;
  const highSeverity = (await db.prepare(`SELECT COUNT(*) as count FROM data_quality_issues WHERE status = 'PENDIENTE' AND severity = 'ALTA'`).get()).count;

  const baseScore = Math.max(0, 100 - (pendingIssues * 2.5));

  return {
    total_issues: totalIssues,
    pending_issues: pendingIssues,
    resolved_issues: resolvedIssues,
    high_severity_pending: highSeverity,
    cleanliness_score: parseFloat(baseScore.toFixed(1)),
  };
}

module.exports = {
  runLiveQualityScan,
  inspectRecord,
  getQualityIssues,
  resolveIssue,
  getQualityStats,
};
