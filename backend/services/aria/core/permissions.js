'use strict';

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
  const permisos = user.permisos || [];
  const hasAnyIAPerm = permisos.some(p => p.startsWith('ia-'));
  if (!hasAnyIAPerm) return true; // Compatibilidad: si aún no hay permisos IA granulares asignados, permitir por defecto
  return permisos.includes(iaPermId);
}

/**
 * Verifica si el usuario tiene un permiso de dashboard/sección
 * ADMIN y DIRECTOR siempre tienen acceso total.
 */
function hasSectionPermission(user, permId) {
  if (!user) return false;
  if (user.role === 'ADMIN' || user.role === 'DIRECTOR') return true;
  return (user.permisos || []).includes(permId);
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
  buildAccessDeniedResponse
};
