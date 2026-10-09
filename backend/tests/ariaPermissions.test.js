'use strict';

const { hasIAPermission, hasSectionPermission, hasIASectionAccess } = require('../services/aria/core/permissions');

test('an empty or malformed legacy profile does not receive every IA module', () => {
  for (const user of [null, {}, { role: 'JEFE_AREA', permisos: [] }, { role: 'JEFE_AREA', permisos: 'ia-quirofano' }, { role: 'JEFE_AREA', permisos: [null, 7] }]) {
    expect(hasIAPermission(user, 'ia-quirofano')).toBe(false);
    expect(hasIAPermission(user, 'ia-busqueda-pacientes')).toBe(false);
  }
});

test('legacy compatibility is limited to an explicitly authorized section', () => {
  const user = { role: 'JEFE_AREA', permisos: ['dashboard-ocupacion'] };
  expect(hasIAPermission(user, 'ia-ocupacion-camas')).toBe(true);
  expect(hasIAPermission(user, 'ia-auditoria-inventarios')).toBe(false);
  expect(hasIAPermission(user, 'ia-busqueda-pacientes')).toBe(false);
  expect(hasIASectionAccess(user, 'ia-ocupacion-camas', 'dashboard-ocupacion')).toBe(true);
});

test('granular IA profiles do not inherit another module through section compatibility', () => {
  const user = { role: 'JEFE_AREA', permisos: ['ia-farmacia', 'quirofano-agenda', 'farmacia-inventario'] };
  expect(hasIAPermission(user, 'ia-quirofano')).toBe(false);
  expect(hasIASectionAccess(user, 'ia-farmacia', ['farmacia-inventario', 'area-farmacia'])).toBe(true);
  expect(hasIASectionAccess({ ...user, permisos: ['ia-farmacia'] }, 'ia-farmacia', 'farmacia-inventario')).toBe(false);
});

test.each(['ADMIN', 'DIRECTOR'])('the existing %s rule keeps access to IA and sections', role => {
  const user = { role, permisos: [] };
  expect(hasIAPermission(user, 'ia-auditoria-inventarios')).toBe(true);
  expect(hasSectionPermission(user, 'auditoria-inventarios')).toBe(true);
  expect(hasIASectionAccess(user, 'ia-farmacia', 'farmacia-inventario')).toBe(true);
});
