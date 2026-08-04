'use strict';

const dataQualityService = require('../../dataQuality.service');

async function queryCalidadDatos() {
  try {
    await dataQualityService.runLiveQualityScan();
    const stats = dataQualityService.getQualityStats();
    const issues = dataQualityService.getQualityIssues({ status: 'PENDIENTE', limit: 5 });

    return {
      topic: 'Control de Calidad de Datos',
      answer: `El motor de calidad asigna un **Score de Limpieza de ${stats.cleanliness_score}%** a la base de datos viva. Hay **${stats.pending_issues} alertas pendientes** por revisar, de las cuales **${stats.high_severity_pending} son de severidad alta** (como precios en $0.00 o cargos atípicos).`,
      kpis: [
        { label: 'Score Limpieza', value: `${stats.cleanliness_score}%`, color: stats.cleanliness_score >= 90 ? '#16A34A' : '#D97706' },
        { label: 'Alertas Pendientes', value: stats.pending_issues, color: '#DC2626' },
        { label: 'Severidad Alta', value: stats.high_severity_pending, color: '#991B1B' },
        { label: 'Corregidas', value: stats.resolved_issues, color: '#2563EB' },
      ],
      table: {
        headers: ['ID', 'Regla Violada', 'Severidad', 'Producto / Expediente'],
        rows: issues.map(i => [
          `#${i.id}`,
          i.rule_failed,
          i.severity,
          `${i.description} (${i.patient_id || 'Sin Paciente'})`,
        ]),
      },
    };
  } catch (err) {
    return {
      topic: 'Calidad de Datos',
      answer: 'Indicador de calidad de datos: ' + err.message,
    };
  }
}

module.exports = queryCalidadDatos;
