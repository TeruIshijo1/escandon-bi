'use strict';

const { normalizeText, isGreeting } = require('./utils/nlp');
const { matchIntent, getSuggestionsForUser, IA_PERMISSION_CATALOG } = require('./config/intents');
const { hasIAPermission, hasSectionPermission, buildAccessDeniedResponse } = require('./core/permissions');
const searchDatabaseDynamically = require('./core/dynamicSearch');
const queryResumenEjecutivoGeneral = require('./handlers/resumen.handler');

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

  // 2. Intentar match con el registro de intenciones
  const match = matchIntent(normalized);

  if (match) {
    const { intent } = match;

    // Verificar permiso IA del usuario
    if (!hasIAPermission(user, intent.iaPermission)) {
      return buildAccessDeniedResponse(intent.iaPermission, IA_PERMISSION_CATALOG);
    }

    // Verificar permiso de sección/dashboard
    if (intent.sectionPerm && !hasSectionPermission(user, intent.sectionPerm)) {
      return buildAccessDeniedResponse(intent.iaPermission, IA_PERMISSION_CATALOG);
    }

    // Ejecutar handler de la intención
    return await intent.handler(normalized);
  }

  // 3. Fallback: Búsqueda dinámica multitabla
  return await searchDatabaseDynamically(query, user);
}

module.exports = {
  processAriaQuery,
  getSuggestionsForUser,
  IA_PERMISSION_CATALOG,
};
