import REPORT_QUERY_PERMISSIONS from './reportQueryPermissions.json';

export const ROLES = {
  ADMIN:            'ADMIN',
  DIRECTOR:         'DIRECTOR',
  JEFE_AREA:        'JEFE_AREA',
  USUARIO_OPERATIVO:'USUARIO_OPERATIVO',
  ALMACEN_GENERAL:  'ALMACEN_GENERAL',
  CONSULTA_EXTERNA: 'CONSULTA_EXTERNA',
};

export const AREAS = {
  QUIROFANO:        'QUIROFANO',
  IMAGENOLOGIA:     'IMAGENOLOGIA',
  URGENCIAS:        'URGENCIAS',
  CUNEROS:          'CUNEROS',
  UCI:              'UCI',
  CONSULTA_EXTERNA: 'CONSULTA_EXTERNA',
  CARDIOLOGIA:      'CARDIOLOGIA',
  LABORATORIO:      'LABORATORIO',
  HOSPITALIZACION:  'HOSPITALIZACION',
  FARMACIA:         'FARMACIA',
  FINANZAS:         'FINANZAS',
  ASEGURADORAS:     'ASEGURADORAS',
  ALMACEN_GENERAL:  'ALMACEN_GENERAL',
};

export const ROUTE_PERMISSIONS = {
  '/':                      [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO, ROLES.ALMACEN_GENERAL, ROLES.CONSULTA_EXTERNA],
  '/dashboard/directivo':   [ROLES.ADMIN, ROLES.DIRECTOR],
  '/dashboard/ocupacion':   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA],
  '/dashboard/area':        [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO],
  '/mi-area/consultas-service-layer': [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO, ROLES.ALMACEN_GENERAL, ROLES.CONSULTA_EXTERNA],
  '/siti/dashboard':        [ROLES.ADMIN, ROLES.DIRECTOR],
  '/siti/comparativo':      [ROLES.ADMIN, ROLES.DIRECTOR],
  '/auditoria/inventarios': [ROLES.ADMIN, ROLES.DIRECTOR],
  '/auditoria/cargos':      [ROLES.ADMIN, ROLES.DIRECTOR],
  '/auditoria/cargos-reversas': [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA],
  '/auditoria/reapertura-cuentas': [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO],
  '/auditoria/ventas-hospitalarias': [ROLES.ADMIN, ROLES.DIRECTOR],
  '/farmacia/devoluciones': [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA],
  '/farmacia/cargos-sap':   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO],
  '/farmacia/resumen-maestro': [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO],
  '/farmacia/inventario':   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA],
  '/farmacia/reorden':      [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO],
  '/quirofano':             [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO, ROLES.ALMACEN_GENERAL],
  '/quirofano/agenda':      [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO, ROLES.ALMACEN_GENERAL],
  '/quirofano/kits':        [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO, ROLES.ALMACEN_GENERAL],
  '/quirofano/variaciones': [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO, ROLES.ALMACEN_GENERAL],
  '/quirofano/almacen':     [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO, ROLES.ALMACEN_GENERAL],
  '/almacen/inventario':    [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.ALMACEN_GENERAL],
  '/almacen/reorden':       [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.ALMACEN_GENERAL, ROLES.USUARIO_OPERATIVO],
  '/almacen/traslados':     [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.ALMACEN_GENERAL],
  '/almacen/reportes':      [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.ALMACEN_GENERAL],
  '/almacen/precios-articulos': [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.ALMACEN_GENERAL, ROLES.USUARIO_OPERATIVO],
  '/interconsultas-jornadas':   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO, ROLES.CONSULTA_EXTERNA, ROLES.ALMACEN_GENERAL],
  '/rastreo-ordenes':       [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.ALMACEN_GENERAL, ROLES.USUARIO_OPERATIVO],
  '/consulta-externa':      [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO, ROLES.CONSULTA_EXTERNA],
  '/calidad-datos':         [ROLES.ADMIN, ROLES.DIRECTOR],
  '/estadisticas':          [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA],
  '/admin/usuarios':        [ROLES.ADMIN],
  '/admin/auditoria-log':   [ROLES.ADMIN],
  '/admin/configuracion':   [ROLES.ADMIN],
  '/admin/prueba-sap':      [ROLES.ADMIN],
  '/sistemas/acuerdos':     [ROLES.ADMIN, ROLES.DIRECTOR],
  '/sistemas/automatizaciones': [ROLES.ADMIN, ROLES.DIRECTOR],
};

export const ROUTE_TO_PERMISSION = {
  '/':                      'home',
  '/dashboard/directivo':   'dashboard-directivo',
  '/dashboard/ocupacion':   'dashboard-ocupacion',
  '/dashboard/area':        'dashboard-area',
  '/mi-area/consultas-service-layer': 'mi-area-consultas-service-layer',
  '/estadisticas':          'estadisticas',
  '/interconsultas-jornadas': 'interconsultas-jornadas',
  '/siti/dashboard':        'siti-dashboard',
  '/siti/comparativo':      'siti-comparativo',
  '/auditoria/inventarios': 'auditoria-inventarios',
  '/auditoria/cargos':      'auditoria-cargos',
  '/auditoria/cargos-reversas': 'auditoria-cargos-reversas',
  '/auditoria/reapertura-cuentas': 'auditoria-reapertura-cuentas',
  '/auditoria/ventas-hospitalarias': 'auditoria-ventas-hospitalarias',
  '/calidad-datos':         'calidad-datos',
  '/farmacia/devoluciones': 'farmacia-devoluciones',
  '/farmacia/cargos-sap':   'farmacia-cargos-sap',
  '/farmacia/resumen-maestro': 'farmacia-resumen-maestro',
  '/farmacia/inventario':   'farmacia-inventario',
  '/farmacia/reorden':      'farmacia-reorden',
  '/quirofano':             'quirofano',
  '/quirofano/agenda':      'quirofano-agenda',
  '/quirofano/kits':        'quirofano-kits',
  '/quirofano/variaciones': 'quirofano-variaciones',
  '/quirofano/almacen':     'quirofano-almacen',
  '/almacen/inventario':    'almacen-inventario',
  '/almacen/reorden':       'almacen-reorden',
  '/almacen/traslados':     'almacen-traslados',
  '/almacen/reportes':      'almacen-reportes',
  '/almacen/precios-articulos': 'almacen-precios-articulos',
  '/rastreo-ordenes':       'rastreo-ordenes',
  '/consulta-externa':      'consulta-externa',
  '/admin/usuarios':        'admin-usuarios',
  '/admin/auditoria-log':   'admin-auditoria-log',
  '/admin/configuracion':   'admin-configuracion',
  '/sistemas/acuerdos':     'sistemas-acuerdos',
  '/sistemas/automatizaciones': 'sistemas-automatizaciones',
};

export const AREA_TO_PERMISSION = {
  'QUIROFANO':        'area-quirofano',
  'UCI':              'area-uci',
  'URGENCIAS':        'area-urgencias',
  'CUNEROS':          'area-cuneros',
  'IMAGENOLOGIA':     'area-imagenologia',
  'LABORATORIO':      'area-laboratorio',
  'CONSULTA_EXTERNA': 'area-consulta-externa',
  'CARDIOLOGIA':      'area-cardiologia',
  'HOSPITALIZACION':  'area-hospitalizacion',
  'FARMACIA':         'area-farmacia',
  'FINANZAS':         'area-finanzas',
  'ASEGURADORAS':     'area-aseguradoras',
  'ALMACEN_GENERAL':  'area-almacen-general',
};

export function hasPermission(user, path) {
  if (!user) return false;
  
  const username = (user.username || user.Username || '').toLowerCase();

  if (username === 'amendoza') return true;

  if (path === '/') return true;

  // Ruta exclusiva de pruebas de amendoza
  if (path === '/admin/prueba-sap') return username === 'amendoza';

  const permisos = user.permisos || [];
  const permId = ROUTE_TO_PERMISSION[path];

  if (!permId) return true;

  if (path === '/dashboard/area') {
    if (user.area) {
      const areaPermId = AREA_TO_PERMISSION[user.area];
      if (areaPermId && permisos.includes(areaPermId)) return true;
    }
    const allAreaPermIds = Object.values(AREA_TO_PERMISSION);
    const hasAnyAreaPerm = permisos.some(p => allAreaPermIds.includes(p));
    if (hasAnyAreaPerm) return true;
    return permisos.includes(permId);
  }

  return permisos.includes(permId);
}

/* CAPABILITIES — Acciones que puede realizar cada rol */
export const CAPABILITIES = {
  [ROLES.ADMIN]: {
    verTodosTableros:    true,
    verDashboardDirectivo: true,
    verAuditoria:        true,
    exportarPDF:         true,
    exportarExcel:       true,
    gestionarUsuarios:   true,
    verLogAuditoria:     true,
    verMacropanelFinanciero: true,
    editarConfiguracion: true,
    usarAsistenteIA:     true,
    verCEX:              true,
    gestionCEX:          true,
  },
  [ROLES.DIRECTOR]: {
    verTodosTableros:    true,
    verDashboardDirectivo: true,
    verAuditoria:        true,
    exportarPDF:         true,
    exportarExcel:       true,
    gestionarUsuarios:   false,
    verLogAuditoria:     false,
    verMacropanelFinanciero: true,
    editarConfiguracion: false,
    usarAsistenteIA:     true,
    verCEX:              true,
    gestionCEX:          false,
  },
  [ROLES.JEFE_AREA]: {
    verTodosTableros:    false,
    verDashboardDirectivo: false,
    verAuditoria:        false,
    exportarPDF:         true,
    exportarExcel:       true,
    gestionarUsuarios:   false,
    verLogAuditoria:     false,
    verMacropanelFinanciero: false,
    editarConfiguracion: false,
    usarAsistenteIA:     true,
  },
  [ROLES.USUARIO_OPERATIVO]: {
    verTodosTableros:    false,
    verDashboardDirectivo: false,
    verAuditoria:        false,
    exportarPDF:         false,
    exportarExcel:       true,
    gestionarUsuarios:   false,
    verLogAuditoria:     false,
    verMacropanelFinanciero: false,
    editarConfiguracion: false,
    usarAsistenteIA:     false,
  },
  [ROLES.ALMACEN_GENERAL]: {
    verTodosTableros:    false,
    verDashboardDirectivo: false,
    verAuditoria:        false,
    exportarPDF:         false,
    exportarExcel:       true,
    gestionarUsuarios:   false,
    verLogAuditoria:     false,
    verMacropanelFinanciero: false,
    editarConfiguracion: false,
    usarAsistenteIA:     false,
  },
  [ROLES.CONSULTA_EXTERNA]: {
    verTodosTableros:    false,
    verDashboardDirectivo: false,
    verAuditoria:        false,
    exportarPDF:         false,
    exportarExcel:       true,
    gestionarUsuarios:   false,
    verLogAuditoria:     false,
    verMacropanelFinanciero: false,
    editarConfiguracion: false,
    usarAsistenteIA:     false,
    verCEX:              true,
    gestionCEX:          true,
  },
};

export function canAccessRoute(role, path, userArea = null, routeArea = null) {
  const allowed = ROUTE_PERMISSIONS[path];
  if (!allowed) return false;
  if (!allowed.includes(role)) return false;

  if (
    (role === ROLES.JEFE_AREA || role === ROLES.USUARIO_OPERATIVO) &&
    routeArea && userArea &&
    routeArea !== userArea
  ) {
    return false;
  }

  return true;
}

/* Verifica si un usuario tiene una capacidad específica */
export function can(role, capability) {
  return CAPABILITIES[role]?.[capability] ?? false;
}

export const AREAS_LABELS = {
  [AREAS.QUIROFANO]:        'Quirófano',
  [AREAS.IMAGENOLOGIA]:     'Imagenología',
  [AREAS.URGENCIAS]:        'Urgencias',
  [AREAS.CUNEROS]:          'Cuneros',
  [AREAS.UCI]:              'UCI',
  [AREAS.CONSULTA_EXTERNA]: 'Consulta Externa',
  [AREAS.CARDIOLOGIA]:      'Cardiología',
  [AREAS.LABORATORIO]:      'Laboratorio',
  [AREAS.HOSPITALIZACION]:  'Hospitalización',
  [AREAS.FARMACIA]:         'Farmacia',
  [AREAS.FINANZAS]:         'Finanzas',
  [AREAS.ASEGURADORAS]:     'Aseguradoras',
  [AREAS.ALMACEN_GENERAL]:  'Almacén General',
};

export function getNavItems(roleOrUser, areaArg = null, usernameArg = null) {
  let role = roleOrUser;
  let area = areaArg;
  let username = usernameArg;

  if (roleOrUser && typeof roleOrUser === 'object') {
    role = roleOrUser.role || roleOrUser.Rol;
    area = roleOrUser.area || roleOrUser.AreaAsignada;
    username = roleOrUser.username || roleOrUser.Username;
  }

  const uName = (username || '').toLowerCase();
  const areaLabel = area ? AREAS_LABELS[area] ?? area : '';

  const allItems = [
    {
      section: 'Principal',
      icon:    '🏠',
      label:   'Inicio',
      path:    '/',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO, ROLES.ALMACEN_GENERAL, ROLES.CONSULTA_EXTERNA],
    },
    // Dirección
    {
      section: 'Dirección',
      icon:    '📊',
      label:   'Tablero directivo',
      path:    '/dashboard/directivo',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR],
    },
    {
      section: 'Dirección',
      icon:    '🛏️',
      label:   'Ocupación de camas',
      path:    '/dashboard/ocupacion',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA],
    },
    // Área
    {
      section: 'Mi Área',
      icon:    '🏥',
      label:   area ? `Tablero — ${areaLabel}` : 'Tablero de Área',
      path:    '/dashboard/area',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO],
    },
    {
      section: 'Mi Área',
      icon:    '🩺',
      label:   'Honorarios Médicos',
      path:    '/interconsultas-jornadas',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO, ROLES.CONSULTA_EXTERNA, ROLES.ALMACEN_GENERAL],
    },
    {
      section: 'Mi Área',
      icon:    '🔌',
      label:   'Crear Reporte Personalizado',
      path:    '/mi-area/consultas-service-layer',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO, ROLES.ALMACEN_GENERAL, ROLES.CONSULTA_EXTERNA],
    },
    {
      section: 'Históricos SITI',
      icon:    '⏳',
      label:   'Reportes históricos',
      path:    '/siti/dashboard',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR],
    },
    {
      section: 'Históricos SITI',
      icon:    '⚖️',
      label:   'Comparativo vs Vertical',
      path:    '/siti/comparativo',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR],
    },
    // Auditoría y Calidad
    {
      section: 'Auditoría',
      icon:    '🔍',
      label:   'Inventarios y Consumos Clínicos',
      path:    '/auditoria/inventarios',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR],
    },
    {
      section: 'Auditoría',
      icon:    '🧾',
      label:   'Cargos y Reversas por Paciente',
      path:    '/auditoria/cargos-reversas',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA],
    },
    {
      section: 'Auditoría',
      icon:    '🧾',
      label:   'Facturas y reaperturas de cuentas',
      path:    '/auditoria/reapertura-cuentas',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO],
    },
    {
      section: 'Auditoría',
      icon:    '📊',
      label:   'Ventas hospitalarias',
      path:    '/auditoria/ventas-hospitalarias',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR],
    },
    {
      section: 'Farmacia',
      icon:    '📦',
      label:   'Inventario Farmacia (SAP)',
      path:    '/farmacia/inventario',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA],
    },
    {
      section: 'Farmacia',
      icon:    '🧾',
      label:   'Cargos a Pacientes (SAP)',
      path:    '/farmacia/cargos-sap',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO],
    },
    {
      section: 'Farmacia',
      icon:    '📦',
      label:   'Resumen Maestro de Salidas',
      path:    '/farmacia/resumen-maestro',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO],
    },
    {
      section: 'Farmacia',
      icon:    '💊',
      label:   'Devoluciones',
      path:    '/farmacia/devoluciones',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA],
    },
    {
      section: 'Farmacia',
      icon:    '📋',
      label:   'Punto de Reorden SAP',
      path:    '/farmacia/reorden',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO],
    },
    {
      section: 'Quirófano',
      icon:    '📅',
      label:   'Agenda y Proyección',
      path:    '/quirofano/agenda',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO, ROLES.ALMACEN_GENERAL],
    },
    {
      section: 'Quirófano',
      icon:    '🔪',
      label:   'Kits Quirúrgicos',
      path:    '/quirofano/kits',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO, ROLES.ALMACEN_GENERAL],
    },
    {
      section: 'Quirófano',
      icon:    '👨‍⚕️',
      label:   'Variaciones por Cirujano',
      path:    '/quirofano/variaciones',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO, ROLES.ALMACEN_GENERAL],
    },
    {
      section: 'Quirófano',
      icon:    '📦',
      label:   'Almacén Quirófano (QX)',
      path:    '/quirofano/almacen',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO, ROLES.ALMACEN_GENERAL],
    },
    {
      section: 'Almacén General',
      icon:    '📦',
      label:   'Inventario Almacén (SAP)',
      path:    '/almacen/inventario',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.ALMACEN_GENERAL],
    },
    {
      section: 'Almacén General',
      icon:    '📋',
      label:   'Punto de Reorden & Pedidos SAP',
      path:    '/almacen/reorden',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.ALMACEN_GENERAL, ROLES.USUARIO_OPERATIVO],
    },
    {
      section: 'Almacén General',
      icon:    '🚚',
      label:   'Traslados Almacén (SAP)',
      path:    '/almacen/traslados',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.ALMACEN_GENERAL],
    },
    {
      section: 'Almacén General',
      icon:    '📑',
      label:   'Reportes Almacén (SAP)',
      path:    '/almacen/reportes',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.ALMACEN_GENERAL],
    },
    // Consulta Externa Operativa
    {
      section: 'Consulta Externa',
      icon:    '🩺',
      label:   'Agenda',
      path:    '/consulta-externa',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO, ROLES.CONSULTA_EXTERNA],
    },
    {
      section: 'Auditoría',
      icon:    '🛡️',
      label:   'Control de Calidad de Datos',
      path:    '/calidad-datos',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR],
    },

    // Sistemas
    {
      section: 'Sistemas',
      icon:    '⚙️',
      label:   'Gestor de Acuerdos',
      path:    '/sistemas/acuerdos',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR],
    },
    {
      section: 'Sistemas',
      icon:    '🤖',
      label:   'Automatizaciones BI',
      path:    '/sistemas/automatizaciones',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR],
    },
    {
      section: 'Sistemas',
      icon:    '📋',
      label:   'Rastreo de órdenes e insumos',
      path:    '/rastreo-ordenes',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.ALMACEN_GENERAL, ROLES.USUARIO_OPERATIVO],
    },
    {
      section: 'Sistemas',
      icon:    '📈',
      label:   'Estadísticas',
      path:    '/estadisticas',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA],
    },

    // Administración
    {
      section: 'Administración',
      icon:    '👥',
      label:   'Gestión de Usuarios',
      path:    '/admin/usuarios',
      roles:   [ROLES.ADMIN],
    },
    {
      section: 'Administración',
      icon:    '🛡️',
      label:   'Historial de actividad',
      path:    '/admin/auditoria-log',
      roles:   [ROLES.ADMIN],
    },
    {
      section: 'Administración',
      icon:    '⚙️',
      label:   'Configuración',
      path:    '/admin/configuracion',
      roles:   [ROLES.ADMIN],
    },
    {
      section: 'Administración',
      icon:    '🔌',
      label:   'Prueba SAP BOne',
      path:    '/admin/prueba-sap',
      roles:   [ROLES.ADMIN],
      requiredUsername: 'amendoza',
    },
  ];

  if (uName === 'amendoza') {
    return allItems;
  }

  return allItems.filter(item => {

    if (role !== ROLES.ADMIN && !item.roles.includes(role) && item.path !== '/auditoria/ventas-hospitalarias') return false;
    if (item.requiredUsername && item.requiredUsername !== uName) return false;
    return true;
  });
}

export function getPermissionSections(user) {
  const navItems = getNavItems({ username: 'amendoza', role: ROLES.ADMIN });
  const sections = [];
  const seen = new Set();

  for (const item of navItems) {
    const permId = ROUTE_TO_PERMISSION[item.path];
    if (!permId) continue;

    if (item.path === '/dashboard/area') {
      const areaEntries = Object.entries(AREA_TO_PERMISSION);
      for (const [areaKey, areaPermId] of areaEntries) {
        if (seen.has(areaPermId)) continue;
        seen.add(areaPermId);
        const areaName = AREAS_LABELS[areaKey] || areaKey;
        sections.push({
          id:       areaPermId,
          name:     `Tablero — ${areaName}`,
          icon:     '🏥',
          category: 'Tableros por Área',
        });
      }
      continue;
    }

    if (seen.has(permId)) continue;
    seen.add(permId);

    sections.push({
      id:       permId,
      name:     item.label,
      icon:     item.icon,
      category: item.section,
    });
  }

  sections.push({
    id: 'ejecutar-reapertura-cuentas',
    name: 'Reaperturar cuentas verificadas en Vertical',
    icon: '🔄',
    category: 'Auditoría',
  });

  for (const sapPerm of SAP_QUERY_PERMISSIONS) {
    sections.push({
      id:       sapPerm.id,
      name:     sapPerm.name,
      icon:     sapPerm.icon,
      category: sapPerm.category || '🔌 Consultas SAP (Módulos)',
    });
  }

  const IA_PERMISSIONS = [
    { id: 'ia-productividad-medica', name: 'Productividad Médica',     icon: '👨‍⚕️' },
    { id: 'ia-ocupacion-camas',      name: 'Censo y Ocupación',        icon: '🛏️' },
    { id: 'ia-auditoria-inventarios',name: 'Auditoría e Inventarios',  icon: '🔍' },
    { id: 'ia-calidad-datos',        name: 'Calidad de Datos',         icon: '🛡️' },
    { id: 'ia-busqueda-pacientes',   name: 'Búsqueda de Pacientes',    icon: '🏥' },
    { id: 'ia-busqueda-medicos',     name: 'Búsqueda de Médicos',      icon: '⚕️' },
    { id: 'ia-busqueda-insumos',     name: 'Búsqueda de Insumos',      icon: '💊' },
    { id: 'ia-busqueda-financiera',  name: 'Datos Financieros',        icon: '💰' },
    { id: 'ia-farmacia',             name: 'Módulo de Farmacia',       icon: '⚕️' },
    { id: 'ia-quirofano',            name: 'Módulo de Quirófano',      icon: '🔪' },
  ];

  for (const iaPerm of IA_PERMISSIONS) {
    sections.push({
      id:       iaPerm.id,
      name:     iaPerm.name,
      icon:     iaPerm.icon,
      category: '🤖 Perfil IA',
    });
  }

  if (!user || user?.username?.toLowerCase() === 'amendoza' || user?.role === ROLES.ADMIN || user?.role === 'ADMIN') {
    return sections;
  }
  const userPerms = user?.permisos || [];
  return sections.filter(s => userPerms.includes(s.id));
}

export const SAP_QUERY_PERMISSIONS = REPORT_QUERY_PERMISSIONS;

export function hasSapModulePermission(user, moduleId) {
  if (!user) return false;
  const username = (user.username || user.Username || '').toLowerCase();

  if (username === 'amendoza') return true;

  const permisos = user.permisos || [];
  const hasSpecificSapPerms = permisos.some(p => typeof p === 'string' && p.startsWith('sap-query-'));
  if (hasSpecificSapPerms) {
    return permisos.includes(`sap-query-${moduleId}`);
  }

  if (permisos.includes('mi-area-consultas-service-layer')) {
    return ['inventory', 'batches', 'item_prices', 'item_master_data', 'stock_transfers'].includes(moduleId);
  }

  return false;
}
