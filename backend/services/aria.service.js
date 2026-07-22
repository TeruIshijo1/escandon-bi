/**
 * aria.service.js — Motor de Inteligencia Analítica Local MAR-IA
 * Hospital Escandón BI Platform
 * 
 * 100% Local, Gratuito y Privado con Búsqueda Dinámica Multitabla en Tiempo Real
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

  // 1. Saludos / inicio
  if (!q || q === 'hola' || q === 'buenos dias' || q === 'buenas tardes' || q.length <= 3) {
    return await queryResumenEjecutivoGeneral();
  }

  // 2. Médicos que Más Ingresos Aportan / Productividad Médica
  if (q.includes('medico que mas') || q.includes('médico que más') || q.includes('doctor que mas') || q.includes('mas ingresos') || q.includes('más ingresos') || q.includes('productividad')) {
    return await queryMedicosMasIngresos();
  }

  // 3. Ocupación de Camas y Censo Hospitalario
  if (q.includes('ocupacion de camas') || q.includes('ocupación de camas') || q.includes('censo') || q.includes('habitaciones libres')) {
    return await queryCensoCamas();
  }

  // 4. Discrepancias, Faltantes e Inventarios vs Cargos
  if (q.includes('discrepancias') || q.includes('faltantes hoy') || q.includes('auditoria de inventarios')) {
    return await queryAuditoriaInventarios(q);
  }

  // 5. Calidad de Datos y Anomalías
  if (q.includes('anomalias de calidad') || q.includes('score de limpieza') || q.includes('alertas de calidad')) {
    return await queryCalidadDatos();
  }

  // 6. Insumos Más Gastados / Frecuentes
  if (q.includes('insumos mas consumidos') || q.includes('insumos más consumidos') || q.includes('5 insumos')) {
    return await queryInsumosMasGastados();
  }

  // 🔍 7. BÚSQUEDA DINÁMICA MULTITABLA EN TIEMPO REAL
  // Para cualquier otra pregunta abierta (paciente, insumo, médico, área, procedimiento, etc.)
  return await searchDatabaseDynamically(query);
}

/* ── 🔍 Búsqueda Dinámica Multitabla en Tiempo Real ───────────── */
async function searchDatabaseDynamically(userQuery) {
  try {
    const pool = await getRemoteDb();

    // Ruido / Palabras de relleno a ignorar
    const fillerWords = [
      'busca', 'buscar', 'quien', 'quién', 'como', 'cómo', 'cuanto', 'cuánto', 'donde', 'dónde',
      'muestrame', 'muéstrame', 'dame', 'sobre', 'para', 'este', 'esta', 'estos', 'estas', 'del',
      'los', 'las', 'con', 'por', 'que', 'qué', 'una', 'uno', 'unos', 'unas', 'doctor', 'dr', 'dra',
      'medico', 'médico', 'paciente', 'insumo', 'servicio', 'gastado', 'consumido', 'precio', 'costo',
      'hospital', 'cuenta', 'registros', 'datos', 'puedes', 'decirme', 'saber', 'ver'
    ];

    const rawTokens = userQuery
      .toLowerCase()
      .replace(/[?¿!¡,.]/g, '')
      .split(/\s+/);

    const searchTerms = rawTokens.filter(w => w.length >= 3 && !fillerWords.includes(w));
    const finalTerms = searchTerms.length > 0 ? searchTerms : rawTokens.filter(w => w.length >= 3);

    if (finalTerms.length === 0) {
      return await queryResumenEjecutivoGeneral();
    }

    const whereClauses = finalTerms.map((_, idx) => `(
      NOMBRE_DEL_PACIENTE LIKE @kw${idx} OR
      DESCRIPCION_DEL_ARTICULO LIKE @kw${idx} OR
      UNIDAD_DE_SERVICIO LIKE @kw${idx} OR
      Medico_Solicitante LIKE @kw${idx} OR
      CODIGO LIKE @kw${idx} OR
      GRUPO_DE_ARTICULOS LIKE @kw${idx}
    )`).join(' OR ');

    const request = pool.request();
    finalTerms.forEach((term, idx) => {
      request.input(`kw${idx}`, `%${term}%`);
    });

    const querySQL = `
      SELECT TOP 25
        NUMERO_DE_ORDEN          AS OrdenId,
        NOMBRE_DEL_PACIENTE      AS Paciente,
        UNIDAD_DE_SERVICIO       AS Area,
        DESCRIPCION_DEL_ARTICULO AS Insumo,
        CODIGO                   AS Codigo,
        CANTIDAD                 AS Cantidad,
        ISNULL(TOTAL_COBRADO, ISNULL(TOTAL_SIN_DESC, 0)) AS Monto,
        FECHA_DE_CARGO           AS Fecha,
        Medico_Solicitante       AS Medico
      FROM UDR_CUENTAS_SERVICIOS
      WHERE ${whereClauses}
      ORDER BY FECHA_DE_CARGO DESC
    `;

    const res = await request.query(querySQL);
    const rows = res.recordset || [];

    if (rows.length === 0) {
      return {
        topic: `Búsqueda: ${userQuery}`,
        answer: `No encontré registros en la base de datos en vivo que coincidan con la búsqueda "**${userQuery}**". Prueba buscando por el apellido del paciente, nombre del médico o descripción del servicio.`,
        suggestions: [
          '👨‍⚕️ ¿Quién es el médico que más ingresos aporta?',
          '🛏️ ¿Cómo está la ocupación de camas por área?',
          '🔍 ¿Cuáles son las partidas con faltantes hoy?',
        ],
      };
    }

    const totalMonto = rows.reduce((acc, r) => acc + parseFloat(r.Monto || 0), 0);
    const totalCantidad = rows.reduce((acc, r) => acc + parseFloat(r.Cantidad || 0), 0);

    return {
      topic: `Búsqueda Dinámica: "${finalTerms.join(', ')}"`,
      answer: `Analicé la base de datos en tiempo real para "**${userQuery}**". Encontré **${rows.length} registros en vivo** acumulando un monto total de **$${totalMonto.toLocaleString('es-MX')} MXN** (${totalCantidad} unidades/atenciones).`,
      kpis: [
        { label: 'Registros Encontrados', value: rows.length },
        { label: 'Monto Total Sumado', value: `$${totalMonto.toLocaleString('es-MX')}`, color: '#16A34A' },
        { label: 'Unidades/Servicios', value: totalCantidad, color: '#004687' },
      ],
      table: {
        headers: ['Fecha', 'Paciente', 'Área', 'Insumo / Servicio', 'Médico', 'Monto ($)'],
        rows: rows.slice(0, 7).map(r => {
          let fechaStr = '';
          if (r.Fecha) {
            try { fechaStr = new Date(r.Fecha).toISOString().split('T')[0]; } catch(e) { fechaStr = String(r.Fecha).slice(0,10); }
          }
          return [
            fechaStr,
            r.Paciente || 'Sin Nombre',
            r.Area || 'General',
            r.Insumo || 'Servicio',
            r.Medico || 'Sin Asignar',
            `$${parseFloat(r.Monto || 0).toLocaleString('es-MX')}`,
          ];
        }),
      },
    };
  } catch (err) {
    console.error('Error en búsqueda dinámica:', err);
    return {
      topic: 'Búsqueda Dinámica',
      answer: 'No se pudo realizar la búsqueda en tiempo real: ' + err.message,
    };
  }
}

/* ── 1. Médicos por Mayor Aporte de Ingresos ─────────────────── */
async function queryMedicosMasIngresos() {
  try {
    const pool = await getRemoteDb();
    const res = await pool.request().query(`
      SELECT TOP 5
        Medico_Solicitante                                      AS Medico,
        COUNT(*)                                               AS TotalCargos,
        SUM(ISNULL(TOTAL_COBRADO, ISNULL(TOTAL_SIN_DESC, 0)))  AS IngresosGenerados
      FROM UDR_CUENTAS_SERVICIOS
      WHERE Medico_Solicitante IS NOT NULL AND Medico_Solicitante != ''
      GROUP BY Medico_Solicitante
      ORDER BY IngresosGenerados DESC
    `);

    const rows = res.recordset || [];
    const topMedico = rows[0] || {};
    const montoTop = parseFloat(topMedico.IngresosGenerados || 0);

    return {
      topic: 'Productividad e Ingresos por Médico',
      answer: `El médico que **más ingresos aporta al Hospital Escandón** es el **Dr. ${topMedico.Medico}** con una facturación acumulada de **$${montoTop.toLocaleString('es-MX')} MXN** generada en ${topMedico.TotalCargos} cargos/atenciones registradas.`,
      kpis: [
        { label: 'Médico #1 en Ingresos', value: `Dr. ${topMedico.Medico}` },
        { label: 'Ingreso Generado', value: `$${montoTop.toLocaleString('es-MX')}`, color: '#16A34A' },
        { label: 'Total Atenciones', value: topMedico.TotalCargos, color: '#004687' },
      ],
      table: {
        headers: ['Nombre del Médico', 'Total Cargos', 'Ingresos Generados ($)'],
        rows: rows.map(r => [
          `Dr. ${r.Medico}`,
          r.TotalCargos,
          `$${parseFloat(r.IngresosGenerados || 0).toLocaleString('es-MX')}`,
        ]),
      },
    };
  } catch (err) {
    return {
      topic: 'Productividad Médica',
      answer: 'Error al obtener los ingresos por médico: ' + err.message,
    };
  }
}

/* ── 2. Censo de Camas ───────────────────────────────────────── */
async function queryCensoCamas() {
  try {
    const pool = await getRemoteDb();
    
    const bedsResult = await pool.request().query(`
      SELECT DISTINCT RoomCode, RoomName 
      FROM V_MRPT 
      WHERE RoomName LIKE '%CAMA%' 
        AND RoomName IS NOT NULL
        AND RoomName NOT LIKE '%VIRTUAL%' 
        AND RoomName NOT LIKE '%VIRT%' 
        AND RoomCode NOT LIKE '%VIRT%'
    `);
    const allRealBeds = bedsResult.recordset || [];
    const totalBeds = allRealBeds.length;

    const occupiedResult = await pool.request().query(`
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
          AND V.RoomName NOT LIKE '%VIRTUAL%'
          AND V.RoomName NOT LIKE '%VIRT%'
          AND V.RoomCode NOT LIKE '%VIRT%'
      )
      SELECT Cama, Area, Paciente, Medico
      FROM CTE WHERE rn = 1
    `);

    const ocupadas = occupiedResult.recordset || [];
    const ocupadasCount = ocupadas.length;
    const libresCount = Math.max(0, totalBeds - ocupadasCount);
    const porcentaje = totalBeds > 0 ? Math.round((ocupadasCount / totalBeds) * 100) : 0;

    return {
      topic: 'Ocupación de Camas Físicas',
      answer: `Actualmente el hospital cuenta con un censo de **${totalBeds} camas físicas reales** (excluyendo camas virtuales). Se registra una ocupación del **${porcentaje}%** con **${ocupadasCount} camas ocupadas** y **${libresCount} disponibles**.`,
      kpis: [
        { label: 'Total Camas Físicas', value: totalBeds },
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

/* ── 3. Auditoría de Inventarios vs Cargos ───────────────────── */
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
      answer: 'Consulta de auditoría de inventarios: ' + err.message,
    };
  }
}

/* ── 4. Pacientes con Mayor Gasto Acumulado ──────────────────── */
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
      answer: 'Acumulado de cuentas de pacientes: ' + err.message,
    };
  }
}

/* ── 5. Calidad de Datos y Anomalías ─────────────────────────── */
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

/* ── 6. Insumos Más Gastados ─────────────────────────────────── */
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
      answer: 'Consumo de insumos: ' + err.message,
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
    answer: `¡Hola! Soy **MAR-IA**, tu copiloto de Inteligencia Analítica. 
    
Hoy en el **Hospital Escandón**:
- **Censo de Camas Físicas**: ${censo.kpis?.find(k => k.label === '% Ocupación')?.value || 'N/A'} de ocupación (${censo.kpis?.find(k => k.label === 'Ocupadas')?.value || 0} ocupadas de ${censo.kpis?.find(k => k.label === 'Total Camas Físicas')?.value || 40} reales).
- **Auditoría de Inventarios**: ${resAud.diferencias} discrepancias pendientes acumulando $${resAud.montoDisputa.toLocaleString('es-MX')} en disputa.
- **Control de Calidad de Datos**: Monitoreo continuo de anomalías pre-facturación y auditoría automática activa.`,
    kpis: [
      { label: 'Ocupación Camas Físicas', value: censo.kpis?.find(k => k.label === '% Ocupación')?.value || '0%' },
      { label: 'Discrepancias Auditadas', value: resAud.diferencias },
      { label: 'Monto en Disputa', value: `$${resAud.montoDisputa.toLocaleString('es-MX')}` },
    ],
    suggestions: [
      '👨‍⚕️ ¿Quién es el médico que más ingresos aporta?',
      '🛏️ ¿Cómo está la ocupación de camas por área?',
      '🔍 ¿Cuáles son las partidas con faltantes hoy?',
      '💰 ¿Quién es el paciente con mayor gasto acumulado?',
      '💊 ¿Cuáles son los 5 insumos más consumidos?',
    ],
  };
}

module.exports = {
  processAriaQuery,
};
