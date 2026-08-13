'use strict';

const { pool } = require('../config/pg-db');

/**
 * Genera el dataset histórico de ingresos mensuales
 * y lo guarda en ml_dataset_ingresos_mensual.
 */
async function syncRevenueDataset() {
  console.log('[ML Revenue Dataset] Iniciando generación de dataset de ingresos mensuales...');
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM ml_dataset_ingresos_mensual');
    
    // 1. Ingresos Totales por Mes desde SAP Incoming Payments (GENERAL)
    const resTotal = await client.query(`
      SELECT 
        to_char(docdate, 'YYYY-MM') as periodo_mes,
        SUM(doctotal) as ingresos_total,
        COUNT(*) as num_cuentas
      FROM sap_incoming_payments
      WHERE canceled = 'N'
      GROUP BY to_char(docdate, 'YYYY-MM')
      ORDER BY periodo_mes ASC
    `);
    
    let previousMonthTotal = null;
    
    for (const row of resTotal.rows) {
      const periodo = row.periodo_mes;
      const ingresosTotal = Number(row.ingresos_total || 0);
      const numCuentas = Number(row.num_cuentas || 0);
      
      const ticketPromedio = numCuentas > 0 ? ingresosTotal / numCuentas : 0;
      let crecimiento = 0;
      
      if (previousMonthTotal !== null && previousMonthTotal > 0) {
        crecimiento = (ingresosTotal - previousMonthTotal) / previousMonthTotal;
      }
      
      await client.query(`
        INSERT INTO ml_dataset_ingresos_mensual (
          periodo_mes, area, servicio, ingresos_total, num_cuentas,
          ticket_promedio, ingresos_mes_anterior, crecimiento_mensual,
          fecha_calculo
        ) VALUES ($1, 'GENERAL', 'TODOS', $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
      `, [periodo, ingresosTotal, numCuentas, ticketPromedio, previousMonthTotal || 0, crecimiento]);
      
      previousMonthTotal = ingresosTotal;
    }
    
    // 2. Ingresos por Área y Servicio (dw_vertical_cuentas_servicios)
    const resAreaServicio = await client.query(`
      SELECT 
        to_char(fecha_de_cargo, 'YYYY-MM') as periodo_mes,
        unidad_de_servicio as area,
        grupo_de_articulos as servicio,
        SUM(total * precio_unitario) as ingresos_total,
        COUNT(DISTINCT folio_de_atencion) as num_cuentas
      FROM dw_vertical_cuentas_servicios
      WHERE total > 0 AND precio_unitario > 0
      GROUP BY to_char(fecha_de_cargo, 'YYYY-MM'), unidad_de_servicio, grupo_de_articulos
      ORDER BY area, servicio, periodo_mes ASC
    `);
    
    let prevArea = null;
    let prevServ = null;
    let prevIngreso = null;
    
    for (const row of resAreaServicio.rows) {
      const periodo = row.periodo_mes;
      const area = row.area || 'DESCONOCIDA';
      const servicio = row.servicio || 'DESCONOCIDO';
      const ingresosTotal = Number(row.ingresos_total || 0);
      const numCuentas = Number(row.num_cuentas || 0);
      
      const ticketPromedio = numCuentas > 0 ? ingresosTotal / numCuentas : 0;
      let crecimiento = 0;
      
      if (prevArea === area && prevServ === servicio && prevIngreso !== null && prevIngreso > 0) {
        crecimiento = (ingresosTotal - prevIngreso) / prevIngreso;
      } else {
        prevIngreso = 0; // Se resetea para nueva area/servicio
      }
      
      await client.query(`
        INSERT INTO ml_dataset_ingresos_mensual (
          periodo_mes, area, servicio, ingresos_total, num_cuentas,
          ticket_promedio, ingresos_mes_anterior, crecimiento_mensual,
          fecha_calculo
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
        ON CONFLICT (periodo_mes, area, servicio) DO UPDATE 
        SET ingresos_total = EXCLUDED.ingresos_total,
            num_cuentas = EXCLUDED.num_cuentas,
            ticket_promedio = EXCLUDED.ticket_promedio,
            ingresos_mes_anterior = EXCLUDED.ingresos_mes_anterior,
            crecimiento_mensual = EXCLUDED.crecimiento_mensual,
            fecha_calculo = EXCLUDED.fecha_calculo
      `, [periodo, area, servicio, ingresosTotal, numCuentas, ticketPromedio, prevIngreso, crecimiento]);
      
      prevArea = area;
      prevServ = servicio;
      prevIngreso = ingresosTotal;
    }
    
    await client.query('COMMIT');
    console.log('[ML Revenue Dataset] Dataset guardado exitosamente.');
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[ML Revenue Dataset] Error:', err);
  } finally {
    client.release();
  }
}

module.exports = {
  syncRevenueDataset
};
