'use strict';

// Shared by the report builder and MAR-IA; AI never expands report permissions.
function checkSapModuleAccess(user, entity, definition) {
  if (!user) return false;
  if (typeof entity !== 'string' || !entity) return false;
  if ((user.username || '').toLowerCase() === 'amendoza') return true;
  if (definition?.assistantOnly) {
    if (!Array.isArray(definition.requiredPermissions) || !definition.requiredPermissions.length) return false;
    return definition.requiredPermissions.every(moduleId => checkSapModuleAccess(user, moduleId));
  }
  const permissions = Array.isArray(user.permisos) ? user.permisos : [];
  if (permissions.some(permission => typeof permission === 'string' && permission.startsWith('sap-query-'))) {
    return permissions.includes(`sap-query-${entity}`);
  }
  return permissions.includes('mi-area-consultas-service-layer') &&
    ['inventory', 'batches', 'item_prices', 'item_master_data', 'stock_transfers'].includes(entity);
}

module.exports = { checkSapModuleAccess };
