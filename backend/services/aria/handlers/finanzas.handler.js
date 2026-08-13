'use strict';

const { pool } = require('../../../config/pg-db');

async function queryForecastIngresos(user, matches) {
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
        text: 'Aún no se han generado proyecciones de ingresos para el siguiente mes. Ve al Dashboard Financiero y haz clic en "Recalcular Proyecciones".',
        data: []
      };
    }

    const generalRow = res.rows.find(r => r.area === 'GENERAL' && r.servicio === 'TODOS');
    const specificRows = res.rows.filter(r => r.area !== 'GENERAL');

    let responseText = '';
    
    if (generalRow) {
      const formatMoneda = (val) => '$' + parseFloat(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      
      responseText += `Para el periodo **${generalRow.periodo_predicho}**, el modelo de IA estima un ingreso general del hospital de **${formatMoneda(generalRow.ingreso_estimado)}** (rango esperado entre ${formatMoneda(generalRow.intervalo_bajo)} y ${formatMoneda(generalRow.intervalo_alto)}).\n\n`;
    }

    if (specificRows.length > 0) {
      responseText += `Top áreas/servicios proyectados:\n`;
      specificRows.slice(0, 5).forEach(r => {
        const formatMoneda = (val) => '$' + parseFloat(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        responseText += `- **${r.area} (${r.servicio})**: ${formatMoneda(r.ingreso_estimado)}\n`;
      });
    }

    return {
      text: responseText,
      data: res.rows
    };
  } catch (error) {
    console.error('[queryForecastIngresos Error]', error);
    return {
      text: 'Ocurrió un error al consultar las proyecciones de ingresos generadas por IA.',
      data: []
    };
  }
}

module.exports = {
  queryForecastIngresos
};
