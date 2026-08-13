'use strict';

const { normalizeText, isGreeting } = require('./utils/nlp');
const { matchIntent, getSuggestionsForUser, IA_PERMISSION_CATALOG, INTENT_REGISTRY } = require('./config/intents');
const { hasIAPermission, hasSectionPermission, buildAccessDeniedResponse } = require('./core/permissions');
const { classifyWithLLM } = require('./core/llmClassifier');
const searchDatabaseDynamically = require('./core/dynamicSearch');
const queryResumenEjecutivoGeneral = require('./handlers/resumen.handler');

/**
 * Ejecuta un intent verificando permisos IA y de sección.
 */
async function executeIntent(intent, normalized, user) {
  if (!hasIAPermission(user, intent.iaPermission)) {
    return buildAccessDeniedResponse(intent.iaPermission, IA_PERMISSION_CATALOG);
  }
  if (intent.sectionPerm && !hasSectionPermission(user, intent.sectionPerm)) {
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
async function processAriaQuery(query = '', user = null) {
  const normalized = normalizeText(query);

  // 1. Saludos / inicio → Resumen Ejecutivo
  if (isGreeting(normalized)) {
    return await queryResumenEjecutivoGeneral(user);
  }

  // 2. Intentar match con el registro de intenciones (regex + coincidencia difusa)
  const match = matchIntent(normalized);

  if (match) {
    const { intent } = match;
    return await executeIntent(intent, normalized, user);
  }

  // 2b. Clasificación con LLM: vocabulario amplio para todos los módulos.
  //     Solo se invoca cuando los regex no aciertan; si falla la API,
  //     se cae a la búsqueda dinámica sin afectar la experiencia.
  const llmIntentId = await classifyWithLLM(query, INTENT_REGISTRY);
  if (llmIntentId) {
    const intent = INTENT_REGISTRY.find(i => i.id === llmIntentId);
    if (intent) {
      console.log(`[MAR-IA LLM] Consulta "${query.slice(0, 60)}" → intent: ${intent.id}`);
      return await executeIntent(intent, normalized, user);
    }
  }

  // 3. Fallback: Búsqueda dinámica multitabla
  return await searchDatabaseDynamically(query, user);
}

module.exports = {
  processAriaQuery,
  getSuggestionsForUser,
  IA_PERMISSION_CATALOG,
};
