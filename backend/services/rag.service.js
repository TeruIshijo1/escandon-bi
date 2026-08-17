'use strict';

const { getDb } = require('../config/db');
const { buildSystemPrompt, buildUserMessage, ROLE_DATA_ACCESS } = require('./prompts/ai.system.prompt');
const ariaService = require('./aria');
const ExcelJS = require('exceljs');

const LLM_API_KEY = process.env.GEMINI_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
const LLM_MODEL   = process.env.GEMINI_MODEL || process.env.DEEPSEEK_MODEL || process.env.OPENAI_MODEL || 
  (process.env.GEMINI_API_KEY ? 'gemini-2.0-flash' : (process.env.DEEPSEEK_API_KEY ? 'deepseek-chat' : 'gpt-4o'));
const LLM_BASE    = process.env.LLM_BASE_URL || 
  (process.env.GEMINI_API_KEY ? 'https://generativelanguage.googleapis.com/v1beta/openai' : 
  (process.env.DEEPSEEK_API_KEY ? 'https://api.deepseek.com' : (process.env.AZURE_OPENAI_ENDPOINT || 'https://api.openai.com/v1')));

/* ── Mapeo de intenciones → permisos por rol ─────────────── */
const INTENT_PERMISSIONS = {
  ocupacion_camas:  ['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'USUARIO_OPERATIVO'],
  censo_pacientes:  ['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'USUARIO_OPERATIVO'],
  tasa_mortalidad:  ['ADMIN', 'DIRECTOR'],
  cirugias_dia:     ['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'USUARIO_OPERATIVO'],
  rotacion_area:    ['ADMIN', 'DIRECTOR', 'JEFE_AREA'],
  readmision:       ['ADMIN', 'DIRECTOR'],
  auditoria:        ['ADMIN', 'DIRECTOR'],
  financiero:       ['ADMIN', 'DIRECTOR'],
  saludo:           ['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'USUARIO_OPERATIVO'],
  plataforma:       ['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'USUARIO_OPERATIVO'],
  general:          ['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'USUARIO_OPERATIVO'],
};

/* ── Catálogo de intenciones → queries SQL ────────────────── */
const INTENT_QUERIES = {
  saludo: {
    description: 'Saludo o presentación (hola, buenos días, qué tal)',
    sql: null,
    params: [],
  },

  plataforma: {
    description: 'Pregunta sobre cómo usar la plataforma, dónde encontrar algo',
    sql: null,
    params: [],
  },

  ocupacion_camas: {
    description: 'Ocupación actual de camas por área',
    sql: `
      SELECT
        c.Area,
        COUNT(*)                                                          AS TotalCamas,
        SUM(CASE WHEN c.Estado = 'OCUPADA' THEN 1 ELSE 0 END)            AS CamasOcupadas,
        SUM(CASE WHEN c.Estado = 'DISPONIBLE' THEN 1 ELSE 0 END)         AS CamasLibres,
        ROUND(
          CAST(SUM(CASE WHEN c.Estado = 'OCUPADA' THEN 1 ELSE 0 END) AS NUMERIC)
          * 100.0 / GREATEST(COUNT(*), 1)
        , 1)                                                               AS PorcentajeOcupacion
      FROM Camas c
      WHERE c.Activo = 1
      GROUP BY c.Area
      ORDER BY PorcentajeOcupacion DESC
    `,
    sqlArea: `
      SELECT
        c.Area,
        COUNT(*)                                                          AS TotalCamas,
        SUM(CASE WHEN c.Estado = 'OCUPADA' THEN 1 ELSE 0 END)            AS CamasOcupadas,
        SUM(CASE WHEN c.Estado = 'DISPONIBLE' THEN 1 ELSE 0 END)         AS CamasLibres,
        ROUND(
          CAST(SUM(CASE WHEN c.Estado = 'OCUPADA' THEN 1 ELSE 0 END) AS NUMERIC)
          * 100.0 / GREATEST(COUNT(*), 1)
        , 1)                                                               AS PorcentajeOcupacion
      FROM Camas c
      WHERE c.Activo = 1 AND c.Area = ?
      GROUP BY c.Area
    `,
    params: [],
  },

  censo_pacientes: {
    description: 'Número actual de pacientes hospitalizados',
    sql: `
      SELECT
        a.AreaActual AS Area,
        COUNT(*) AS Pacientes
      FROM Admisiones a
      WHERE a.Estado = 'ACTIVA'
      GROUP BY a.AreaActual
      ORDER BY Pacientes DESC
    `,
    sqlArea: `
      SELECT
        a.AreaActual AS Area,
        COUNT(*) AS Pacientes
      FROM Admisiones a
      WHERE a.Estado = 'ACTIVA' AND a.AreaActual = ?
      GROUP BY a.AreaActual
    `,
    params: [],
  },

  tasa_mortalidad: {
    description: 'Tasa de mortalidad del período',
    sql: `
      SELECT
        COUNT(*)                                                           AS TotalEgresos,
        SUM(CASE WHEN e.TipoEgreso = 'DEFUNCION' THEN 1 ELSE 0 END)      AS Defunciones,
        ROUND(
          CAST(SUM(CASE WHEN e.TipoEgreso = 'DEFUNCION' THEN 1 ELSE 0 END) AS NUMERIC)
          * 100.0 / GREATEST(COUNT(*), 1)
        , 2)                                                                AS TasaMortalidad
      FROM Egresos e
      WHERE e.FechaEgreso >= CURRENT_TIMESTAMP - INTERVAL '1 month'
    `,
    params: [],
  },

  cirugias_dia: {
    description: 'Cirugías programadas y realizadas hoy',
    sql: `
      SELECT
        COUNT(*)                                                            AS TotalCirugias,
        SUM(CASE WHEN qx.Estado = 'REALIZADA'   THEN 1 ELSE 0 END)        AS Realizadas,
        SUM(CASE WHEN qx.Estado = 'PROGRAMADA'  THEN 1 ELSE 0 END)        AS Programadas,
        SUM(CASE WHEN qx.Estado = 'CANCELADA'   THEN 1 ELSE 0 END)        AS Canceladas,
        SUM(CASE WHEN qx.Estado = 'EN_CURSO'    THEN 1 ELSE 0 END)        AS EnCurso
      FROM ProgramacionQuirofano qx
      WHERE qx.FechaCirugia::date = CURRENT_DATE
    `,
    params: [],
  },

  rotacion_area: {
    description: 'Rotación de camas y estancia promedio por área',
    sql: `
      SELECT
        e.AreaEgreso                                                AS Area,
        COUNT(*)                                                    AS Egresos,
        AVG((EXTRACT(EPOCH FROM e.FechaEgreso) - EXTRACT(EPOCH FROM a.FechaIngreso)) / 86400.0) AS EstanciaPromedioDias,
        ROUND(
          CAST(COUNT(*) AS NUMERIC) /
          GREATEST((SELECT COUNT(*) FROM Camas WHERE Area = e.AreaEgreso), 1)
        , 2)                                                         AS RotacionCamas
      FROM Egresos e
      JOIN Admisiones a ON a.AdmisionId = e.AdmisionId
      WHERE e.FechaEgreso >= CURRENT_TIMESTAMP - INTERVAL '1 month'
      GROUP BY e.AreaEgreso
      ORDER BY RotacionCamas DESC
      LIMIT 10
    `,
    sqlArea: `
      SELECT
        e.AreaEgreso                                                AS Area,
        COUNT(*)                                                    AS Egresos,
        AVG((EXTRACT(EPOCH FROM e.FechaEgreso) - EXTRACT(EPOCH FROM a.FechaIngreso)) / 86400.0) AS EstanciaPromedioDias,
        ROUND(
          CAST(COUNT(*) AS NUMERIC) /
          GREATEST((SELECT COUNT(*) FROM Camas WHERE Area = e.AreaEgreso), 1)
        , 2)                                                         AS RotacionCamas
      FROM Egresos e
      JOIN Admisiones a ON a.AdmisionId = e.AdmisionId
      WHERE e.FechaEgreso >= CURRENT_TIMESTAMP - INTERVAL '1 month' AND e.AreaEgreso = ?
      GROUP BY e.AreaEgreso
    `,
    params: [],
  },

  readmision: {
    description: 'Tasa de readmisión a 30 días',
    sql: `
      SELECT
        COUNT(DISTINCT r.PacienteId)                     AS ReadmisionesCount,
        COUNT(DISTINCT e.PacienteId)                     AS TotalEgresados,
        ROUND(
          CAST(COUNT(DISTINCT r.PacienteId) AS NUMERIC)
          * 100.0 / GREATEST(COUNT(DISTINCT e.PacienteId), 1)
        , 2)                                              AS TasaReadmision
      FROM Egresos e
      LEFT JOIN Admisiones r
        ON  r.PacienteId   = e.PacienteId
        AND r.FechaIngreso  > e.FechaEgreso
        AND EXTRACT(EPOCH FROM (r.FechaIngreso - e.FechaEgreso)) / 86400.0 <= 30
      WHERE e.FechaEgreso >= CURRENT_TIMESTAMP - INTERVAL '1 month'
    `,
    params: [],
  },
};

/* ══════════════════════════════════════════════════════════════
   Función principal: processRAGQuery
══════════════════════════════════════════════════════════════ */
async function processRAGQuery({ question, userRole, userArea, userName, file, screenImage, currentContext }) {
  // Procesar primero con el motor de intenciones analíticas de ARIA (que incluye Quirófano, Almacén, Farmacia, Censo, etc.)
  const ariaUser = { role: userRole, area: userArea, nombre: userName };
  const ariaResponse = await ariaService.processAriaQuery(question, ariaUser);

  if (ariaResponse && ariaResponse.answer) {
    let excelSources = [];
    let excelDataStr = null;
    if (file && file.buffer) {
      try {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(file.buffer);
        const sheet = workbook.worksheets[0];
        const excelRows = [];
        sheet.eachRow((row, rowNumber) => {
          if (rowNumber <= 50) excelRows.push(row.values.slice(1));
        });
        excelDataStr = JSON.stringify(excelRows);
        excelSources.push('Archivo Excel adjunto');
      } catch (e) {
        console.error('[Mar-IA] Error parseando Excel:', e.message);
      }
    }

    return {
      answer: ariaResponse.answer,
      sources: ['Plataforma BI — Datos en vivo', ariaResponse.topic || 'Consulta Operativa', ...excelSources],
      intent: ariaResponse.topic || 'general',
      assistant: 'Mar-IA',
      timestamp: new Date().toISOString(),
      kpis: ariaResponse.kpis || null,
      table: ariaResponse.table || null,
      suggestions: ariaResponse.suggestions || null,
    };
  }

  // 1. Clasificar intención si no hubo match en ARIA
  const intent = await classifyIntent(question);
  const allowed = INTENT_PERMISSIONS[intent] || INTENT_PERMISSIONS.general;
  const hasPermission = allowed.includes(userRole);

  let data = [];
  let executedSQL = null;
  let sources = [];

  if (hasPermission && INTENT_QUERIES[intent]?.sql) {
    const result = await fetchDataForIntent(intent, { userRole, userArea });
    data = result.data;
    executedSQL = result.sql;
    sources = result.sources;
  } else if (!hasPermission) {
    data = [{ _rbac_denied: true, intent, userRole }];
    sources = ['Acceso denegado por RBAC'];
  }

  let excelData = null;
  if (file && file.buffer) {
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file.buffer);
      const sheet = workbook.worksheets[0];
      const excelRows = [];
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber <= 50) excelRows.push(row.values.slice(1));
      });
      excelData = JSON.stringify(excelRows);
      sources.push('Archivo Excel adjunto');
    } catch (e) {
      console.error('[Mar-IA] Error parseando Excel:', e.message);
    }
  }

  const systemPrompt = buildSystemPrompt(userRole, userArea, currentContext);
  const answer = await generateAnswer({ question, data, intent, userRole, userName, systemPrompt, excelData, screenImage });

  return {
    answer,
    sources,
    intent,
    assistant: 'Mar-IA',
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV === 'development' && { sql: executedSQL }),
  };
}

/* ── Paso 1: Clasificar intención ────────────────────────── */
async function classifyIntent(question) {
  const intentList = Object.entries(INTENT_QUERIES)
    .map(([key, v]) => `- ${key}: ${v.description}`)
    .join('\n');

  const response = await callLLM([
    {
      role:    'system',
      content: `Clasifica la pregunta del usuario en UNA de estas intenciones.
Responde SOLO con la clave exacta. Si no corresponde a ninguna, responde "general".
Si es un saludo (hola, buenos días, qué tal, hey), responde "saludo".
Si pregunta cómo usar la plataforma o dónde encontrar algo, responde "plataforma".

Intenciones disponibles:
${intentList}`,
    },
    { role: 'user', content: question },
  ], { max_tokens: 30, temperature: 0 });

  const intent = response.trim().toLowerCase().replace(/[^a-z_]/g, '');
  return INTENT_QUERIES[intent] ? intent : 'general';
}

/* ── Paso 2: Ejecutar query SQL con filtro RBAC ──────────── */
async function fetchDataForIntent(intent, { userRole, userArea }) {
  const queryConfig = INTENT_QUERIES[intent];
  if (!queryConfig || !queryConfig.sql) {
    return { data: [], sql: null, sources: [] };
  }

  try {
    const db = getDb();
    const needsAreaFilter = (userRole === 'JEFE_AREA' || userRole === 'USUARIO_OPERATIVO') && userArea;

    let sqlToUse;
    let params = [];

    if (needsAreaFilter && queryConfig.sqlArea) {
      sqlToUse = queryConfig.sqlArea;
      params = [userArea];
    } else {
      sqlToUse = queryConfig.sql;
    }

    const data = await db.prepare(sqlToUse).all(...params);

    return {
      data,
      sql: sqlToUse,
      sources: ['PostgreSQL — Hospital Escandón', `Consulta: ${intent}`],
    };
  } catch (err) {
    console.error('[Mar-IA] Error al ejecutar query:', err.message);
    return { data: [], sql: null, sources: [] };
  }
}

/* ── Paso 3: Generar respuesta con LLM ───────────────────── */
async function generateAnswer({ question, data, intent, userRole, userName, systemPrompt, excelData, screenImage }) {
  const userMessageContent = buildUserMessage(question, data, intent, userName, excelData);

  let userMessage;
  if (screenImage) {
    userMessage = {
      role: 'user',
      content: [
        { type: 'text', text: userMessageContent },
        { type: 'image_url', image_url: { url: screenImage } }
      ]
    };
  } else {
    userMessage = { role: 'user', content: userMessageContent };
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    userMessage
  ];

  return callLLM(messages);
}

/* ── Cliente OpenAI / Azure OpenAI (MODO DEMO) ──────────────────────── */
async function callLLM(messages, options = {}) {
  const isClassification = messages[0]?.content?.includes("Clasifica la pregunta");
  
  if (isClassification) {
    const q = (messages[1]?.content || '').toLowerCase();
    if (q.includes('hola') || q.includes('buenos dias') || q.includes('qué tal')) return 'saludo';
    if (q.includes('ocupación') || q.includes('cama') || q.includes('ocupacion')) return 'ocupacion_camas';
    if (q.includes('paciente') || q.includes('censo')) return 'censo_pacientes';
    if (q.includes('cirug')) return 'cirugias_dia';
    if (q.includes('mortalidad')) return 'tasa_mortalidad';
    if (q.includes('rotacion') || q.includes('estancia')) return 'rotacion_area';
    if (q.includes('readmision')) return 'readmision';
    if (q.includes('auditoria') || q.includes('inventario')) return 'auditoria';
    if (q.includes('financiero') || q.includes('factura') || q.includes('dinero')) return 'financiero';
    if (q.includes('plataforma') || q.includes('como') || q.includes('dónde')) return 'plataforma';
    return 'general';
  }

  const userMsg = messages.find(m => m.role === 'user');
  let qText = '';
  if (userMsg && typeof userMsg.content === 'string') {
    qText = userMsg.content.toLowerCase();
  } else if (userMsg && Array.isArray(userMsg.content)) {
    qText = userMsg.content.find(c => c.type === 'text')?.text?.toLowerCase() || '';
  }

  const intentMatch = qText.match(/intención detectada:\s*([a-z_]+)/);
  const detectedIntent = intentMatch ? intentMatch[1] : 'general';

  let dbData = [];
  const jsonMatch = qText.match(/```json\n([\s\S]*?)\n```/);
  if (jsonMatch) {
     try {
       dbData = JSON.parse(jsonMatch[1]);
     } catch (e) {
       console.error("Error parseando JSON en DEMO:", e);
     }
  }

  let response = "🤖 **[MAR-IA BI]**\n\n";

  if (detectedIntent === 'saludo') {
      response += "¡Hola! 👋 Soy Mar-IA, tu asistente de inteligencia analítica del Hospital Escandón. ¿En qué te puedo ayudar hoy? Puedo informarte sobre la ocupación de camas, cirugías del momento, censo de pacientes, inventarios de Almacén General y recetas pendientes en Farmacia. 📊";
  } else if (detectedIntent === 'plataforma') {
      response += "Para usar la plataforma, puedes navegar por el menú lateral izquierdo. Allí encontrarás los Dashboards directivos, Quirófano, Almacén General, Farmacia, auditoría de inventarios y configuración general.";
  } else if (Array.isArray(dbData) && dbData.length > 0 && !dbData[0]._rbac_denied) {
      response += "Aquí tienes la información solicitada basada en los datos actuales del hospital:\n\n";
      
      if (detectedIntent === 'ocupacion_camas') {
          dbData.forEach(row => {
              response += `- **${row.Area}**: Ocupación al **${row.PorcentajeOcupacion}%** (${row.CamasOcupadas} de ${row.TotalCamas} camas ocupadas).\n`;
          });
      } else if (detectedIntent === 'censo_pacientes') {
          dbData.forEach(row => {
              response += `- **${row.Area}**: **${row.Pacientes}** pacientes ingresados.\n`;
          });
      } else if (detectedIntent === 'cirugias_dia') {
          dbData.forEach(row => {
              response += `- **${row.Area}**: **${row.TotalCirugias}** cirugías totales (Completadas: ${row.Completadas}, Urgencias: ${row.Urgencias}, Canceladas: ${row.Canceladas}).\n`;
          });
      } else if (detectedIntent === 'tasa_mortalidad') {
          dbData.forEach(row => {
              response += `- **${row.Area}**: Tasa de mortalidad del **${row.TasaMortalidadPorcentaje}%** (${row.Defunciones} defunciones de ${row.TotalEgresos} egresos).\n`;
          });
      } else if (detectedIntent === 'rotacion_area') {
          dbData.forEach(row => {
              response += `- **${row.Area}**: Hubo **${row.Egresos}** egresos con una estancia promedio de **${Math.round(row.EstanciaPromedioDias || 0)} días**. La rotación de camas fue de **${row.RotacionCamas}**.\n`;
          });
      } else if (detectedIntent === 'readmision') {
          dbData.forEach(row => {
              response += `- Tasa de readmisión global a 30 días: **${row.TasaReadmision}%** (${row.ReadmisionesCount} readmisiones de ${row.TotalEgresados} egresos totales).\n`;
          });
      } else {
          response += "Resumen de datos encontrados:\n";
          dbData.forEach((row) => {
              response += "- ";
              Object.entries(row).forEach(([k, v]) => {
                  if (k !== '_rbac_denied') {
                      response += `**${k}**: ${v} | `;
                  }
              });
              response += "\n";
          });
      }
      response += "\n*Nota: Esta respuesta fue construida automáticamente a partir de los datos en vivo del sistema.*";
  } else if (Array.isArray(dbData) && dbData.length > 0 && dbData[0]._rbac_denied) {
      response += "🔒 Lo siento, no tienes los permisos suficientes para consultar esta información con tu rol actual.";
  } else {
      response += "No he encontrado datos específicos para responder a tu consulta en este momento. ¿Puedo ayudarte con alguna consulta de Quirófano, Almacén General o Farmacia?";
  }

  return response;
}

module.exports = { processRAGQuery };
