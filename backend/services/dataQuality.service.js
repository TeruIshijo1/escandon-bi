/**
 * dataQuality.service.js — Motor de Control de Calidad de Datos (Opción 10)
 * Hospital Escandón BI Platform
 */
'use strict';

const { getDb } = require('../config/db');

/**
 * Inspecciona un registro de insumo/cargo en busca de anomalías de calidad
 * @param {Object} record - { item_code, description, price, quantity, patient_id, date, ... }
 * @param {string} source - 'CARGA_EXCEL' | 'HL7_INGESTION' | 'FHIR_WEBHOOK'
 * @returns {Array} Array de reglas violadas
 */
function inspectRecord(record, source = 'SISTEMA') {
  const db = getDb();
  const issuesFound = [];

  const itemCode = record.item_code || record.CodigoInsumo || record.codigo || 'DESCONOCIDO';
  const description = record.description || record.DescripcionInsumo || record.descripcion || 'Sin Descripción';
  const patientId = record.patient_id || record.NoExpediente || record.paciente_id || null;
  const price = parseFloat(record.price || record.PrecioUnitario || record.precio || 0);
  const quantity = parseFloat(record.quantity || record.Cantidad || record.cantidad || 0);
  const recordDate = record.date || record.FechaConsumo || record.fecha || new Date().toISOString();

  // Regla 1: Precio Cero o Negativo en ítem cargable
  if (price <= 0) {
    issuesFound.push({
      rule: 'PRECIO_ZERO',
      severity: 'ALTA',
      message: `El producto '${description}' (${itemCode}) fue registrado con un precio de $${price.toFixed(2)}.`,
    });
  }

  // Regla 2: Cantidad Excesiva / Atípica
  if (quantity > 50) {
    issuesFound.push({
      rule: 'CANTIDAD_ANOMALA',
      severity: 'MEDIA',
      message: `Se registró una cantidad inusualmente alta (${quantity} unidades) para '${description}'.`,
    });
  }

  // Regla 3: Fecha Futura
  const parsedDate = new Date(recordDate);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (!isNaN(parsedDate.getTime()) && parsedDate > tomorrow) {
    issuesFound.push({
      rule: 'FECHA_INVALIDA',
      severity: 'BAJA',
      message: `La fecha de registro (${recordDate}) está en el futuro.`,
    });
  }

  // Regla 4: Posible Cargo Duplicado (Mismo paciente, mismo código, última hora)
  if (patientId && itemCode !== 'DESCONOCIDO') {
    try {
      const duplicateCheck = db.prepare(`
        SELECT COUNT(*) as count FROM data_quality_issues
        WHERE patient_id = ? AND item_code = ? AND created_at >= datetime('now', '-1 hour')
      `).get(patientId, itemCode);

      if (duplicateCheck && duplicateCheck.count > 0) {
        issuesFound.push({
          rule: 'CARGO_DUPLICADO',
          severity: 'ALTA',
          message: `Posible cargo duplicado para el paciente ${patientId} del insumo (${itemCode}) en la última hora.`,
        });
      }
    } catch (e) {
      console.warn('⚠️ No se pudo verificar duplicados:', e.message);
    }
  }

  // Guardar hallazgos en la BD
  const insertStmt = db.prepare(`
    INSERT INTO data_quality_issues (source, rule_failed, severity, item_code, description, patient_id, row_data, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDIENTE')
  `);

  for (const issue of issuesFound) {
    insertStmt.run(
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
function getQualityIssues(filters = {}) {
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

  const rows = db.prepare(sql).all(...params);

  return rows.map(row => ({
    ...row,
    row_data: row.row_data ? JSON.parse(row.row_data) : null,
  }));
}

/**
 * Resolver o ignorar una anomalía de calidad
 */
function resolveIssue(id, status, notes = '', resolvedBy = 'AUDITOR') {
  const db = getDb();
  if (!['RESUELTO', 'IGNORADO'].includes(status)) {
    throw new Error("Estado inválido. Debe ser 'RESUELTO' o 'IGNORADO'.");
  }

  const result = db.prepare(`
    UPDATE data_quality_issues
    SET status = ?, resolution_notes = ?, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, notes, resolvedBy, id);

  return result.changes > 0;
}

/**
 * Obtener estadísticas globales de calidad de datos (% Clean Data)
 */
function getQualityStats() {
  const db = getDb();

  const totalIssues = db.prepare(`SELECT COUNT(*) as count FROM data_quality_issues`).get().count;
  const pendingIssues = db.prepare(`SELECT COUNT(*) as count FROM data_quality_issues WHERE status = 'PENDIENTE'`).get().count;
  const resolvedIssues = db.prepare(`SELECT COUNT(*) as count FROM data_quality_issues WHERE status = 'RESUELTO'`).get().count;
  const highSeverity = db.prepare(`SELECT COUNT(*) as count FROM data_quality_issues WHERE status = 'PENDIENTE' AND severity = 'ALTA'`).get().count;

  // Calcular score básico de limpieza
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
  inspectRecord,
  getQualityIssues,
  resolveIssue,
  getQualityStats,
};
