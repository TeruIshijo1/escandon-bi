/**
 * rag.service.js — Pipeline RAG para Mar-IA
 * Hospital Escandón BI Platform v1.0
 *
 * Flujo:
 *  1. Recibe pregunta en lenguaje natural
 *  2. Clasifica intención y extrae entidades (LLM paso 1)
 *  3. Valida permisos del usuario para la intención detectada
 *  4. Genera y ejecuta query SQL filtrado por rol/área
 *  5. Pasa datos + pregunta al LLM con system prompt estricto
 *  6. Devuelve respuesta en lenguaje natural
 */
'use strict';

const { getDb } = require('../config/db');
const { buildSystemPrompt, buildUserMessage, ROLE_DATA_ACCESS } = require('./prompts/ai.system.prompt');
const ExcelJS = require('exceljs');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL   = process.env.OPENAI_MODEL || 'gpt-4o';
const OPENAI_BASE    = process.env.AZURE_OPENAI_ENDPOINT || 'https://api.openai.com/v1';

/* ── Mapeo de intenciones → permisos por rol ─────────────── */
const INTENT_PERMISSIONS = {
  ocupacion_camas:  ['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'USUARIO_OPERATIVO'],
  censo_pacientes:  ['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'USUARIO_OPERATIVO'],
  tasa_mortalidad:  ['ADMIN', 'DIRECTOR'],
  cirugias_dia:     ['ADMIN', 'DIRECTOR', 'JEFE_AREA'],
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
          CAST(SUM(CASE WHEN c.Estado = 'OCUPADA' THEN 1 ELSE 0 END) AS REAL)
          * 100.0 / MAX(COUNT(*), 1)
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
          CAST(SUM(CASE WHEN c.Estado = 'OCUPADA' THEN 1 ELSE 0 END) AS REAL)
          * 100.0 / MAX(COUNT(*), 1)
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
          CAST(SUM(CASE WHEN e.TipoEgreso = 'DEFUNCION' THEN 1 ELSE 0 END) AS REAL)
          * 100.0 / MAX(COUNT(*), 1)
        , 2)                                                                AS TasaMortalidad
      FROM Egresos e
      WHERE e.FechaEgreso >= datetime('now', '-1 month')
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
      WHERE date(qx.FechaCirugia) = date('now')
    `,
    params: [],
  },

  rotacion_area: {
    description: 'Rotación de camas y estancia promedio por área',
    sql: `
      SELECT
        e.AreaEgreso                                                AS Area,
        COUNT(*)                                                    AS Egresos,
        AVG(CAST(julianday(e.FechaEgreso) - julianday(a.FechaIngreso) AS INTEGER)) AS EstanciaPromedioDias,
        ROUND(
          CAST(COUNT(*) AS REAL) /
          MAX((SELECT COUNT(*) FROM Camas WHERE Area = e.AreaEgreso), 1)
        , 2)                                                         AS RotacionCamas
      FROM Egresos e
      JOIN Admisiones a ON a.AdmisionId = e.AdmisionId
      WHERE e.FechaEgreso >= datetime('now', '-1 month')
      GROUP BY e.AreaEgreso
      ORDER BY RotacionCamas DESC
      LIMIT 10
    `,
    sqlArea: `
      SELECT
        e.AreaEgreso                                                AS Area,
        COUNT(*)                                                    AS Egresos,
        AVG(CAST(julianday(e.FechaEgreso) - julianday(a.FechaIngreso) AS INTEGER)) AS EstanciaPromedioDias,
        ROUND(
          CAST(COUNT(*) AS REAL) /
          MAX((SELECT COUNT(*) FROM Camas WHERE Area = e.AreaEgreso), 1)
        , 2)                                                         AS RotacionCamas
      FROM Egresos e
      JOIN Admisiones a ON a.AdmisionId = e.AdmisionId
      WHERE e.FechaEgreso >= datetime('now', '-1 month') AND e.AreaEgreso = ?
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
          CAST(COUNT(DISTINCT r.PacienteId) AS REAL)
          * 100.0 / MAX(COUNT(DISTINCT e.PacienteId), 1)
        , 2)                                              AS TasaReadmision
      FROM Egresos e
      LEFT JOIN Admisiones r
        ON  r.PacienteId   = e.PacienteId
        AND r.FechaIngreso  > e.FechaEgreso
        AND CAST(julianday(r.FechaIngreso) - julianday(e.FechaEgreso) AS INTEGER) <= 30
      WHERE e.FechaEgreso >= datetime('now', '-1 month')
    `,
    params: [],
  },
};

/* ══════════════════════════════════════════════════════════════
   Función principal: processRAGQuery
══════════════════════════════════════════════════════════════ */
async function processRAGQuery({ question, userRole, userArea, userName, file, screenImage, currentContext }) {
  // 1. Clasificar intención con el LLM
  const intent = await classifyIntent(question);

  // 2. Verificar permisos
  const allowed = INTENT_PERMISSIONS[intent] || INTENT_PERMISSIONS.general;
  const hasPermission = allowed.includes(userRole);

  // 3. Obtener datos (solo si tiene permiso y hay query)
  let data = [];
  let executedSQL = null;
  let sources = [];

  if (hasPermission && INTENT_QUERIES[intent]?.sql) {
    const result = fetchDataForIntent(intent, { userRole, userArea });
    data = result.data;
    executedSQL = result.sql;
    sources = result.sources;
  } else if (!hasPermission) {
    // Pasamos contexto al LLM para que rechace amablemente
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

  // 4. Generar respuesta con Mar-IA
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
function fetchDataForIntent(intent, { userRole, userArea }) {
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

    const data = db.prepare(sqlToUse).all(...params);

    return {
      data,
      sql: sqlToUse,
      sources: ['SQLite — Hospital Escandón', `Consulta: ${intent}`],
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
    // Si hay imagen, la añadimos al mensaje
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

/* ── Cliente OpenAI / Azure OpenAI ──────────────────────── */
async function callLLM(messages, options = {}) {
  if (!OPENAI_API_KEY || OPENAI_API_KEY === 'sk-...') {
    // Modo demo sin API key — Mar-IA simula respuestas
    let question = messages[messages.length - 1]?.content || '';
    if (Array.isArray(question)) {
      const textObj = question.find(item => item.type === 'text');
      question = textObj ? textObj.text : '';
    }

    // Intentamos extraer el contexto de pantalla del system prompt
    const systemContent = messages.find(m => m.role === 'system')?.content || '';
    let screenContext = '';
    if (systemContent.includes('## CONTEXTO DE PANTALLA ACTUAL')) {
      const parts = systemContent.split('## CONTEXTO DE PANTALLA ACTUAL');
      if (parts[1]) {
        screenContext = parts[1].split('##')[0].trim();
      }
    }

    return generateDemoResponse(question, screenContext);
  }

  const response = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      ...(process.env.AZURE_OPENAI_ENDPOINT
        ? { 'api-key': OPENAI_API_KEY }
        : {}),
    },
    body: JSON.stringify({
      model:       OPENAI_MODEL,
      messages,
      max_tokens:  options.max_tokens  || 800,
      temperature: options.temperature ?? 0.3,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`LLM API error: ${response.status} — ${err}`);
  }

  const json = await response.json();
  return json.choices?.[0]?.message?.content?.trim() || 'Disculpa, no pude generar una respuesta. ¿Podrías reformular tu pregunta?';
}

/* ── Respuestas demo cuando no hay API key ────────────────── */
function generateDemoResponse(message, screenContext = '') {
  let actualQuestion = typeof message === 'string' ? message : '';
  if (Array.isArray(message)) {
    const textObj = message.find(item => item.type === 'text');
    actualQuestion = textObj ? textObj.text : '';
  }

  // Si el mensaje es el prompt formateado, extraemos la pregunta original
  if (actualQuestion.includes('## PREGUNTA DEL USUARIO')) {
    const parts = actualQuestion.split('## PREGUNTA DEL USUARIO');
    if (parts[1]) {
      const subParts = parts[1].split('## DATOS RECUPERADOS');
      if (subParts[0]) {
        const lines = subParts[0].trim().split('\n');
        if (lines.length > 1) {
          actualQuestion = lines.slice(1).join('\n').trim();
        } else {
          actualQuestion = lines[0].trim();
        }
      }
    }
  }

  const lower = actualQuestion.toLowerCase();
  const contextLower = screenContext.toLowerCase();

  // 1. COMPROBAR PRIMERO CONSULTAS DE TEMAS O PANTALLAS ESPECÍFICAS
  const isHospitalizacion = lower.includes('hospitalizacion') || lower.includes('hospitalización') || contextLower.includes('hospitalizacion') || contextLower.includes('hospitalización');
  const isQuirofano = lower.includes('quirofano') || lower.includes('quirófano') || lower.includes('cirugia') || lower.includes('cirugía') || contextLower.includes('quirofano') || contextLower.includes('quirófano') || contextLower.includes('cirugia') || contextLower.includes('cirugía');
  const isUrgencias = lower.includes('urgencia') || contextLower.includes('urgencia');
  const isAuditoria = lower.includes('auditor') || lower.includes('cargos') || lower.includes('inventario') || contextLower.includes('auditor') || contextLower.includes('cargos') || contextLower.includes('inventario');

  if (isHospitalizacion) {
    return '🏥 **Explicación del Dashboard de Hospitalización** (Modo Demo)\n\nEste tablero muestra las métricas de hospitalización activa del Hospital Escandón:\n\n• **Pacientes Totales**: 417 pacientes atendidos en el periodo actual.\n• **Habitaciones**: 51 habitaciones operativas en el censo.\n• **Suma de Abonos**: $9.83 millones de pesos registrados por abonos de pacientes.\n• **Distribución por Sexo**: Mayoría femenina (59.6% FEM vs. 40.4% MAS).\n• **Tipo de Paciente**: División entre ingresos eventuales (habituales) e ingresos de tipo recurrente.\n\nPuedes filtrar la información usando las listas desplegables superiores por Sexo, Convenio o Tipo de Paciente.';
  }

  // 2. COMPROBAR PREGUNTAS GENERALES DE NAVEGACIÓN
  const hasPlatformKeyword = ['plataforma', 'donde', 'buscar', 'encontrar', 'tabler', 'explic', 'pantalla', 'modul', 'módul', 'report'].some(kw => lower.includes(kw));

  if (hasPlatformKeyword) {
    return '📍 **Guía de la Plataforma**\n\n• **Dashboard Directivo**: Menú lateral → "Dashboard"\n• **Áreas Clínicas**: Menú lateral → selecciona tu área\n• **Auditoría**: Menú lateral → "Auditoría"\n• **Exportar**: Botón de descarga en cada tablero (PDF/Excel)\n• **Power BI**: Los tableros interactivos se cargan automáticamente\n\n¿Necesitas ayuda con algo más? 😊';
  }

  if (lower.includes('saludo') || lower.includes('hola') || lower.includes('buenos') || lower.includes('buena')) {
    return '¡Hola! 👋 Soy Mar-IA, tu asistente de inteligencia analítica del Hospital Escandón. ¿En qué puedo ayudarte hoy? Puedo consultar datos de ocupación, cirugías, indicadores y más. 📊';
  }

  return '🤖 Soy Mar-IA en modo demostración. Para habilitar respuestas completas con IA, configure OPENAI_API_KEY en el archivo .env del backend.\n\n¿En qué más puedo orientarte sobre la plataforma? 😊';
}

module.exports = { processRAGQuery };
