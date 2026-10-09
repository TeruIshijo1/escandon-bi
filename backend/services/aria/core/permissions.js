'use strict';

// Legacy profiles retain only the IA modules covered by an explicit section.
// Searches for individual patients require their own IA permission.
const IA_SECTION_ACCESS = {
  'ia-quirofano': ['quirofano', 'quirofano-agenda', 'quirofano-kits', 'quirofano-variaciones', 'quirofano-almacen', 'area-quirofano'],
  'ia-productividad-medica': ['dashboard-directivo'],
  'ia-ocupacion-camas': ['dashboard-ocupacion'],
  'ia-auditoria-inventarios': ['auditoria-inventarios'],
  'ia-calidad-datos': ['calidad-datos'],
  'ia-busqueda-medicos': ['dashboard-directivo'],
  'ia-busqueda-insumos': ['auditoria-inventarios', 'farmacia-inventario', 'almacen-inventario', 'quirofano-almacen'],
  'ia-busqueda-financiera': ['dashboard-directivo'],
  'ia-farmacia': ['farmacia-inventario', 'farmacia-devoluciones', 'farmacia-cargos-sap', 'farmacia-resumen-maestro', 'farmacia-reorden', 'area-farmacia'],
  'ia-almacen': ['almacen-inventario', 'almacen-reorden', 'almacen-traslados', 'almacen-reportes', 'almacen-precios-articulos', 'area-almacen-general'],
  'ia-finanzas': ['dashboard-financiero', 'dashboard-directivo'],
};

function userPermissions(user) {
  return Array.isArray(user?.permisos) ? user.permisos.filter(permission => typeof permission === 'string') : [];
}

/**
 * Verifica si el usuario tiene un permiso IA específico
 * ADMIN y DIRECTOR siempre tienen acceso total.
 * @param {object} user
 * @param {string} iaPermId - Ej: 'ia-quirofano', 'ia-almacen', 'ia-farmacia'
 * @returns {boolean}
 */
function hasIAPermission(user, iaPermId) {
  if (!user) return false;
  if (user.role === 'ADMIN' || user.role === 'DIRECTOR') return true;
  const permisos = userPermissions(user);
  const hasAnyIAPerm = permisos.some(p => p.startsWith('ia-'));
  if (!hasAnyIAPerm) return (IA_SECTION_ACCESS[iaPermId] || []).some(permission => permisos.includes(permission));
  return permisos.includes(iaPermId);
}

/**
 * Verifica si el usuario tiene un permiso de dashboard/sección
 * ADMIN y DIRECTOR siempre tienen acceso total.
 */
function hasSectionPermission(user, permId) {
  if (!user) return false;
  if (user.role === 'ADMIN' || user.role === 'DIRECTOR') return true;
  const sectionPermissions = Array.isArray(permId) ? permId : [permId];
  return sectionPermissions.some(permission => userPermissions(user).includes(permission));
}

function hasIASectionAccess(user, iaPermId, sectionPerm) {
  return hasIAPermission(user, iaPermId) && (!sectionPerm || hasSectionPermission(user, sectionPerm));
}

/**
 * Genera una respuesta educada de acceso denegado
 */
function buildAccessDeniedResponse(iaPermId, permissionCatalog) {
  const perm = permissionCatalog.find(p => p.id === iaPermId);
  const label = perm ? perm.label : 'esta función';

  return {
    topic: 'Acceso Restringido',
    answer: `Lo siento, tu perfil de IA no tiene habilitado el acceso a **${label}**. Si necesitas esta información, contacta al administrador del sistema para que te habilite el permiso correspondiente en tu **Perfil IA**.`,
    kpis: [],
    suggestions: [
      '📊 Muéstrame un resumen general',
    ],
  };
}

module.exports = {
  hasIAPermission,
  hasSectionPermission,
  hasIASectionAccess,
  buildAccessDeniedResponse
};
