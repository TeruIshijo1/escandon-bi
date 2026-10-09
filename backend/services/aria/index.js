'use strict';

const { normalizeText, isGreeting } = require('./utils/nlp');
const { matchIntent, getSuggestionsForUser, IA_PERMISSION_CATALOG, INTENT_REGISTRY } = require('./config/intents');
const { hasIASectionAccess, buildAccessDeniedResponse } = require('./core/permissions');
const { classifyWithLLM } = require('./core/llmClassifier');
const searchDatabaseDynamically = require('./core/dynamicSearch');
const queryResumenEjecutivoGeneral = require('./handlers/resumen.handler');
const { processReportQuery } = require('./reportQuery.service');

/**
 * Ejecuta un intent verificando permisos IA y de sección.
 */
async function executeIntent(intent, normalized, user) {
  if (!hasIASectionAccess(user, intent.iaPermission, intent.sectionPerm)) {
    return buildAccessDeniedResponse(intent.iaPermission, IA_PERMISSION_CATALOG);
  }
  return await intent.handler(normalized);
}

/**
 * Procesa una consulta en lenguaje natural enviada por el usuario
 * @param {string} query - Pregunta o comando del usuario
 * @param {object} user - Objeto del usuario autenticado (con role y permisos)
 * @returns {Object} Respuesta estructurada con resumen, KPIs y filas
 */
async function processAriaQuery(query = '', user = null, options = {}) {
  const normalized = normalizeText(query);

  // 1. Saludos / inicio → Resumen Ejecutivo
  if (isGreeting(normalized)) {
    return await queryResumenEjecutivoGeneral(user);
  }

  const match = matchIntent(normalized);
  const reportResponse = await processReportQuery(query, user, { ...options, operationalIntent: match?.intent.id });
  if (reportResponse) return reportResponse;

  // 2. Intentar match con el registro de intenciones (regex + coincidencia difusa)
  if (match) {
    const { intent } = match;
    return await executeIntent(intent, normalized, user);
  }

  // 2b. Clasificación con LLM: vocabulario amplio para todos los módulos.
  //     Solo se invoca cuando los regex no aciertan; si falla la API,
  //     se cae a la búsqueda dinámica sin afectar la experiencia.
  const allowedIntents = INTENT_REGISTRY.filter(intent => hasIASectionAccess(user, intent.iaPermission, intent.sectionPerm));
  let diagnostic;
  const llmIntentId = await classifyWithLLM(query, allowedIntents, { onDiagnostic: value => { diagnostic = value; } });
  if (llmIntentId) {
    const intent = allowedIntents.find(i => i.id === llmIntentId);
    if (intent) {
      return await executeIntent(intent, normalized, user);
    }
  }

  // 3. Fallback: Búsqueda dinámica multitabla
  const response = await searchDatabaseDynamically(query, user);
  return diagnostic ? { ...response, notice: diagnostic.category === 'billing'
    ? 'La conexión de IA requiere revisar el proyecto y la facturación de Gemini. Puedes continuar con las consultas disponibles.'
    : 'La conexión de IA no está disponible en este momento. Puedes continuar con las consultas disponibles.' } : response;
}

module.exports = {
  processAriaQuery,
  getSuggestionsForUser,
  IA_PERMISSION_CATALOG,
};
