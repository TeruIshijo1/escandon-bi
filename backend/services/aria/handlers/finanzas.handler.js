'use strict';

const { pool } = require('../../../config/pg-db');

async function queryForecastIngresos(userQuery) {
  try {
    const query = `
      SELECT 
        periodo_predicho,
        area,
        servicio,
        ingreso_estimado,
        intervalo_bajo,
        intervalo_alto
      FROM ml_forecast_ingresos_mensual
      ORDER BY ingreso_estimado DESC
    `;
    const res = await pool.query(query);

    if (res.rowCount === 0) {
      return {
        topic: 'Proyección de Ingresos (IA)',
        answer: 'Aún no se han generado proyecciones de ingresos para el siguiente mes. Ve al Dashboard Financiero y haz clic en "Recalcular Proyecciones".',
        kpis: [],
        table: null
      };
    }

    const generalRow = res.rows.find(r => r.area === 'GENERAL' && r.servicio === 'TODOS');
    const specificRows = res.rows.filter(r => r.area !== 'GENERAL');

    const formatMoneda = (val) => '$' + parseFloat(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    let responseText = '';

    if (generalRow) {
      responseText += `Para el periodo **${generalRow.periodo_predicho}**, el modelo de IA estima un ingreso general del hospital de **${formatMoneda(generalRow.ingreso_estimado)}** (rango esperado entre ${formatMoneda(generalRow.intervalo_bajo)} y ${formatMoneda(generalRow.intervalo_alto)}).`;
    }

    if (specificRows.length > 0) {
      responseText += `\n\nTop áreas/servicios proyectados:\n`;
      specificRows.slice(0, 5).forEach(r => {
        responseText += `- **${r.area} (${r.servicio})**: ${formatMoneda(r.ingreso_estimado)}\n`;
      });
    }

    const tableRows = res.rows.map(r => [
      r.periodo_predicho,
      `${r.area}${r.servicio ? ' / ' + r.servicio : ''}`,
      formatMoneda(r.ingreso_estimado),
      `${formatMoneda(r.intervalo_bajo)} - ${formatMoneda(r.intervalo_alto)}`
    ]);

    return {
      topic: 'Proyección de Ingresos (IA)',
      answer: responseText,
      kpis: generalRow ? [
        { label: `Ingreso Estimado (${generalRow.periodo_predicho})`, value: formatMoneda(generalRow.ingreso_estimado), color: '#10B981' },
        { label: 'Límite Bajo', value: formatMoneda(generalRow.intervalo_bajo), color: '#64748B' },
        { label: 'Límite Alto', value: formatMoneda(generalRow.intervalo_alto), color: '#004687' },
      ] : [],
      table: {
        headers: ['Periodo', 'Área / Servicio', 'Ingreso Estimado', 'Rango'],
        rows: tableRows
      }
    };
  } catch (error) {
    console.error('[queryForecastIngresos Error]', error);
    return {
      topic: 'Proyección de Ingresos (IA)',
      answer: 'Ocurrió un error al consultar las proyecciones de ingresos generadas por IA.',
      kpis: [],
      table: null
    };
  }
}

module.exports = {
  queryForecastIngresos
};