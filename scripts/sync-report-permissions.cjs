'use strict';
// Ejecutar tras cambiar el catálogo: node scripts/sync-report-permissions.cjs
// No conecta con las fuentes: sólo sincroniza las opciones de permisos de UI.
process.env.NODE_ENV = 'test';
const fs = require('node:fs');
const path = require('node:path');
const { getEntityCatalog } = require('../backend/services/sapQueryBuilder.service');
const permissions = getEntityCatalog().map(entity => ({
  id: `sap-query-${entity.id}`, name: entity.title, icon: entity.icon, entity: entity.id,
  category: `${entity.source} · ${entity.category}`
}));
fs.writeFileSync(path.join(__dirname, '../frontend/src/utils/reportQueryPermissions.json'), `${JSON.stringify(permissions, null, 2)}\n`);
console.log(`Permisos de ${permissions.length} módulos sincronizados.`);
