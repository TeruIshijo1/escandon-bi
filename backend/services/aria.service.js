/**
 * aria.service.js — Motor de Inteligencia Analítica Local ARIA Escandón
 * Hospital Escandón BI Platform
 * 
 * 100% Local, Gratuito y Privado (Sin APIs externas, sin tarjetas de crédito)
 */
'use strict';

const { getDb } = require('../config/db');
const { getRemoteDb } = require('../config/remote-db');
const etlService = require('./etl.service');
const dataQualityService = require('./dataQuality.service');

/**
 * Procesa una consulta en lenguaje natural enviada por el usuario
 * @param {string} query - Pregunta o comando del usuario
 * @returns {Object} Respuesta estructurada con resumen, KPIs y filas
 */
async function processAriaQuery(query = '') {
  const q = query.trim().toLowerCase();

  // 1. Ocupación de Camas y Censo Hospitalario
  if (q.includes('cama') || q.includes('ocupacion') || q.includes('censo') || q.includes('habitacion')) {
    return await queryCensoCamas();
  }

  // 2. Discrepancias, Faltantes e Inventarios vs Cargos
  if (q.includes('faltante') || q.includes('discrepancia') || q.includes('inventario') || q.includes('diferencia') || q.includes('disputa')) {
    return await queryAuditoriaInventarios(q);
  }

  // 3. Pacientes con Mayor Gasto / Consumo
  if (q.includes('paciente') || q.includes('gasto') || q.includes('cuenta') || q.includes('cobro')) {
    return await queryPacientesMayorGasto();
  }

  // 4. Calidad de Datos y Anomalías
  if (q.includes('calidad') || q.includes('limpieza') || q.includes('anomalia') || q.includes('alerta') || q.includes('error')) {
    return await queryCalidadDatos();
  }

  // 5. Insumos Más Gastados / Frecuentes
  if (q.includes('insumo') || q.includes('medicamento') || q.includes('producto') || q.includes('mas gastado') || q.includes('articulo')) {
    return await queryInsumosMasGastados();
  }

  // Fallback inteligente general
  return await queryResumenEjecutivoGeneral();
}

/* ── 1. Censo de Camas ───────────────────────────────────────── */
async function queryCensoCamas() {
  try {
    const pool = await getRemoteDb();
    const res = await pool.request().query(`
      WITH CTE AS (
        SELECT 
          V.RoomCode AS Cama, 
          V.RoomName AS Area,
          V.FullName AS Paciente, 
          PR.FullName AS Medico,
          ROW_NUMBER() OVER(PARTITION BY V.RoomCode ORDER BY PC.Date DESC) as rn
        FROM PC
        JOIN V_MRPT V ON PC.PTNum = V.PTNum
        LEFT JOIN PR ON PC.PRNum = PR.PRNum
        WHERE PC.PC_ST = 'OP' 
          AND PC.PCType IN ('IP', 'ER')
          AND PC.MedicalDischargeDate IS NULL
          AND V.RoomCode IS NOT NULL
      )
      SELECT Cama, Area, Paciente, Medico
      FROM CTE WHERE rn = 1
    `);

    const ocupadas = res.recordset || [];
    
    const totalBedsRes = await pool.request().query(`SELECT COUNT(*) AS total FROM V_MRPT WHERE RoomName LIKE '%CAMA%' OR RoomCode LIKE '%CAMA%'`);
    const totalBeds = totalBedsRes.recordset[0]?.total || 30;
    const ocupadasCount = ocupadas.length;
    const libresCount = Math.max(0, totalBeds - ocupadasCount);
    const porcentaje = Math.round((ocupadasCount / totalBeds) * 100);

    return {
      topic: 'Ocupación de Camas',
      answer: `Actualmente el hospital registra una ocupación hospitalaria del **${porcentaje}%** con **${ocupadasCount} camas ocupadas** y **${libresCount} camas disponibles** de un censo total de ${totalBeds} camas.`,
      kpis: [
        { label: 'Total Camas', value: totalBeds },
        { label: 'Ocupadas', value: ocupadasCount, color: '#004687' },
        { label: 'Disponibles', value: libresCount, color: '#16A34A' },
        { label: '% Ocupación', value: `${porcentaje}%`, color: porcentaje > 85 ? '#DC2626' : '#0088C9' },
      ],
      table: {
        headers: ['Cama', 'Área', 'Paciente Hospedado', 'Médico Tratante'],
        rows: ocupadas.slice(0, 8).map(r => [r.Cama, r.Area || 'Hospitalización', r.Paciente || 'Sin Nombre', r.Medico || 'Sin Asignar']),
      },
    };
  } catch (err) {
    return {
      topic: 'Ocupación de Camas',
      answer: 'Error al consultar censo de camas: ' + err.message,
    };
  }
}

/* ── 2. Auditoría de Inventarios vs Cargos ───────────────────── */
async function queryAuditoriaInventarios(query) {
  try {
    const estado = query.includes('faltante') ? 'FALTANTE' : query.includes('excedente') ? 'EXCEDENTE' : null;
    const data = await etlService.getInventariosVsCargos({ estado, limit: 100 });
    const res = data.resumen;

    return {
      topic: 'Auditoria de Inventarios y Consumos',
      answer: `Se analizaron **${res.totalPartidas} partidas en vivo** del Hospital Escandón. Se detectaron **${res.diferencias} partidas con discrepancia/faltante** acumulando un monto en disputa de **$${res.montoDisputa.toLocaleString('es-MX')} MXN** (Tasa de Conciliación: **${res.porcentajeConciliado}%**).`,
      kpis: [
        { label: 'Partidas Auditadas', value: res.totalPartidas },
        { label: 'Coinciden', value: res.coincidencias, color: '#16A34A' },
        { label: 'Discrepancias', value: res.diferencias, color: '#DC2626' },
        { label: 'Monto en Disputa', value: `$${res.montoDisputa.toLocaleString('es-MX')}`, color: '#D97706' },
      ],
      table: {
        headers: ['# Orden', 'Paciente', 'Área', 'Insumo', 'Diferencia', 'Estado', 'Monto'],
        rows: data.partidas.filter(p => p.estado !== 'COINCIDE').slice(0, 7).map(p => [
          p.orden,
          p.paciente,
          p.area,
          p.insumo,
          p.diferencia,
          p.estado,
          `$${p.monto.toLocaleString('es-MX')}`,
        ]),
      },
    };
  } catch (err) {
    return {
      topic: 'Auditoría',
      answer: 'Error al consultar auditoría de inventarios: ' + err.message,
    };
  }
}

/* ── 3. Pacientes con Mayor Gasto Acumulado ──────────────────── */
async function queryPacientesMayorGasto() {
  try {
    const pool = await getRemoteDb();
    const res = await pool.request().query(`
      SELECT TOP 5
        NOMBRE_DEL_PACIENTE AS Paciente,
        UNIDAD_DE_SERVICIO  AS Area,
        COUNT(*)            AS TotalCargos,
        SUM(ISNULL(TOTAL_COBRADO, ISNULL(TOTAL_SIN_DESC, 0))) AS MontoTotal
      FROM UDR_CUENTAS_SERVICIOS
      WHERE NOMBRE_DEL_PACIENTE IS NOT NULL AND NOMBRE_DEL_PACIENTE != ''
      GROUP BY NOMBRE_DEL_PACIENTE, UNIDAD_DE_SERVICIO
      ORDER BY MontoTotal DESC
    `);

    const rows = res.recordset || [];
    const topPaciente = rows[0] || {};

    return {
      topic: 'Mayores Cuentas de Pacientes',
      answer: `El paciente con el mayor consumo acumulado en el hospital actualmente es **${topPaciente.Paciente || 'N/A'}** en la unidad **${topPaciente.Area || 'General'}** con un total de **$${parseFloat(topPaciente.MontoTotal || 0).toLocaleString('es-MX')} MXN** distribuidos en ${topPaciente.TotalCargos} cargos registradas.`,
      kpis: [
        { label: 'Top Consumo Paciente', value: `$${parseFloat(topPaciente.MontoTotal || 0).toLocaleString('es-MX')}` },
        { label: 'Cargos Registrados', value: topPaciente.TotalCargos || 0 },
      ],
      table: {
        headers: ['Nombre del Paciente', 'Área Hospitalaria', 'Total Cargos', 'Monto Acumulado ($)'],
        rows: rows.map(r => [
          r.Paciente,
          r.Area,
          r.TotalCargos,
          `$${parseFloat(r.MontoTotal || 0).toLocaleString('es-MX')}`,
        ]),
      },
    };
  } catch (err) {
    return {
      topic: 'Pacientes Gasto',
      answer: 'No se pudo obtener el acumulado de cuentas de pacientes: ' + err.message,
    };
  }
}

/* ── 4. Calidad de Datos y Anomalías ─────────────────────────── */
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
      answer: 'Error al consultar el indicador de calidad: ' + err.message,
    };
  }
}

/* ── 5. Insumos Más Gastados ─────────────────────────────────── */
async function queryInsumosMasGastados() {
  try {
    const pool = await getRemoteDb();
    const res = await pool.request().query(`
      SELECT TOP 7
        CODIGO                       AS Codigo,
        DESCRIPCION_DEL_ARTICULO     AS Insumo,
        SUM(CANTIDAD)                AS CantidadTotal,
        SUM(ISNULL(TOTAL_COBRADO, ISNULL(TOTAL_SIN_DESC, 0))) AS MontoGenerado
      FROM UDR_CUENTAS_SERVICIOS
      WHERE DESCRIPCION_DEL_ARTICULO IS NOT NULL
      GROUP BY CODIGO, DESCRIPCION_DEL_ARTICULO
      ORDER BY CantidadTotal DESC
    `);

    const rows = res.recordset || [];
    const topInsumo = rows[0] || {};

    return {
      topic: 'Top Insumos Más Utilizados',
      answer: `El insumo con mayor volumen de consumo registrado en el hospital es **${topInsumo.Insumo}** (Código: \`${topInsumo.Codigo}\`) con un total acumulado de **${topInsumo.CantidadTotal} unidades** surtidas.`,
      kpis: [
        { label: 'Insumo #1', value: topInsumo.Insumo },
        { label: 'Unidades Surtidas', value: topInsumo.CantidadTotal },
      ],
      table: {
        headers: ['Código', 'Descripción del Insumo', 'Unidades', 'Monto Cobrado ($)'],
        rows: rows.map(r => [
          r.Codigo,
          r.Insumo,
          r.CantidadTotal,
          `$${parseFloat(r.MontoGenerado || 0).toLocaleString('es-MX')}`,
        ]),
      },
    };
  } catch (err) {
    return {
      topic: 'Insumos',
      answer: 'Error al obtener consumo de insumos: ' + err.message,
    };
  }
}

/* ── Resumen Ejecutivo General ───────────────────────────────── */
async function queryResumenEjecutivoGeneral() {
  const censo = await queryCensoCamas();
  const auditoria = await etlService.getInventariosVsCargos({ limit: 50 });
  const resAud = auditoria.resumen;

  return {
    topic: 'Resumen Ejecutivo Hospital Escandón',
    answer: `Hola, soy **ARIA**, tu copiloto de Inteligencia Analítica local. 
    
Hoy en el **Hospital Escandón**:
- **Censo de Camas**: ${censo.kpis?.find(k => k.label === '% Ocupación')?.value || 'N/A'} de ocupación (${censo.kpis?.find(k => k.label === 'Ocupadas')?.value || 0} ocupadas).
- **Auditoría de Inventarios**: ${resAud.diferencias} discrepancias pendientes acumulando $${resAud.montoDisputa.toLocaleString('es-MX')} en disputa.
- **Servicios Conectados**: Base de datos **KH_HE SQL Server en vivo** activa y respondiendo.`,
    kpis: [
      { label: 'Ocupación Camas', value: censo.kpis?.find(k => k.label === '% Ocupación')?.value || '0%' },
      { label: 'Discrepancias Auditadas', value: resAud.diferencias },
      { label: 'Monto en Disputa', value: `$${resAud.montoDisputa.toLocaleString('es-MX')}` },
    ],
    suggestions: [
      '¿Cuáles son las camas libres por área?',
      '¿Cuáles son los productos con más faltantes?',
      '¿Quién es el paciente con mayor consumo?',
      '¿Cómo está la calidad de los datos?',
    ],
  };
}

module.exports = {
  processAriaQuery,
};
