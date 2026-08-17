/**
 * rbac.js — Mapa de permisos por rol
 * Hospital Escandón BI Platform v4.0
 *
 * ROLES:
 *   ADMIN           → Acceso total + auditoría + gestión de usuarios
 *   DIRECTOR        → Dashboard de Mando, KPIs globales, Macropanel financiero
 *   JEFE_AREA       → Solo tableros de su área asignada
 *   USUARIO_OPERATIVO → Solo visualización y descarga en su área
 */

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

/**
 * ROUTE_PERMISSIONS
 * Mapea cada ruta a los roles que pueden accederla.
 */
export const ROUTE_PERMISSIONS = {
  '/':                      [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO, ROLES.ALMACEN_GENERAL, ROLES.CONSULTA_EXTERNA],
  '/dashboard/directivo':   [ROLES.ADMIN, ROLES.DIRECTOR],
  '/dashboard/ocupacion':   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA],
  '/dashboard/area':        [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO],
  '/siti/dashboard':        [ROLES.ADMIN, ROLES.DIRECTOR],
  '/siti/comparativo':      [ROLES.ADMIN, ROLES.DIRECTOR],
  '/auditoria/inventarios': [ROLES.ADMIN, ROLES.DIRECTOR],
  '/auditoria/cargos':      [ROLES.ADMIN, ROLES.DIRECTOR],
  '/farmacia/devoluciones': [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA],
  '/farmacia/cargos-sap':   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO],
  '/farmacia/resumen-maestro': [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO],
  '/farmacia/inventario':   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA],
  '/quirofano':             [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO, ROLES.ALMACEN_GENERAL],
  '/quirofano/agenda':      [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO, ROLES.ALMACEN_GENERAL],
  '/quirofano/kits':        [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO, ROLES.ALMACEN_GENERAL],
  '/quirofano/variaciones': [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO, ROLES.ALMACEN_GENERAL],
  '/quirofano/almacen':     [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO, ROLES.ALMACEN_GENERAL],
  '/almacen/inventario':    [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.ALMACEN_GENERAL],
  '/almacen/reorden':       [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.ALMACEN_GENERAL, ROLES.USUARIO_OPERATIVO],
  '/almacen/traslados':     [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.ALMACEN_GENERAL],
  '/almacen/reportes':      [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.ALMACEN_GENERAL],
  '/consulta-externa':      [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.CONSULTA_EXTERNA],
  '/calidad-datos':         [ROLES.ADMIN, ROLES.DIRECTOR],
  '/estadisticas':          [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA],
  '/admin/usuarios':        [ROLES.ADMIN],
  '/admin/auditoria-log':   [ROLES.ADMIN],
  '/admin/configuracion':   [ROLES.ADMIN],
  '/admin/prueba-sap':      [ROLES.ADMIN],
};

/**
 * ROUTE_TO_PERMISSION
 * Mapea cada ruta de la plataforma al ID de permiso que asigna amendoza en AdminUsuarios.
 */
export const ROUTE_TO_PERMISSION = {
  '/':                      'home',
  '/dashboard/directivo':   'dashboard-directivo',
  '/dashboard/ocupacion':   'dashboard-ocupacion',
  '/dashboard/area':        'dashboard-area',
  '/estadisticas':          'estadisticas',
  '/siti/dashboard':        'siti-dashboard',
  '/siti/comparativo':      'siti-comparativo',
  '/auditoria/inventarios': 'auditoria-inventarios',
  '/auditoria/cargos':      'auditoria-cargos',
  '/calidad-datos':         'calidad-datos',
  '/farmacia/devoluciones': 'farmacia-devoluciones',
  '/farmacia/cargos-sap':   'farmacia-cargos-sap',
  '/farmacia/resumen-maestro': 'farmacia-resumen-maestro',
  '/farmacia/inventario':   'farmacia-inventario',
  '/quirofano':             'quirofano',
  '/quirofano/agenda':      'quirofano-agenda',
  '/quirofano/kits':        'quirofano-kits',
  '/quirofano/variaciones': 'quirofano-variaciones',
  '/quirofano/almacen':     'quirofano-almacen',
  '/almacen/inventario':    'almacen-inventario',
  '/almacen/reorden':       'almacen-reorden',
  '/almacen/traslados':     'almacen-traslados',
  '/almacen/reportes':      'almacen-reportes',
  '/consulta-externa':      'consulta-externa',
  '/admin/usuarios':        'admin-usuarios',
  '/admin/auditoria-log':   'admin-auditoria-log',
  '/admin/configuracion':   'admin-configuracion',
};

/**
 * Mapea área del usuario al ID de permiso de su tablero de área.
 */
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

/**
 * Verifica si un usuario tiene permiso individual para acceder a una ruta.
 * REGLA MAESTRA: Solo amendoza tiene acceso total sin requerir permisos otorgados.
 * Todos los demás usuarios (incluyendo ADMINs) requieren que amendoza les otorgue permiso explícito.
 * @param {object} user - Objeto de usuario con { role, permisos, area, username }
 * @param {string} path - Ruta a verificar
 * @returns {boolean}
 */
export function hasPermission(user, path) {
  if (!user) return false;
  
  const username = (user.username || user.Username || '').toLowerCase();

  // REGLA MAESTRA: Solo el usuario amendoza tiene acceso total absoluto a todas las implementaciones sin requerir permisos explícitos
  if (username === 'amendoza') return true;

  // El inicio siempre es accesible
  if (path === '/') return true;

  // Ruta exclusiva de pruebas de amendoza
  if (path === '/admin/prueba-sap') return username === 'amendoza';

  const permisos = user.permisos || [];
  const permId = ROUTE_TO_PERMISSION[path];

  // Si la ruta no requiere permiso específico
  if (!permId) return true;

  // Para /dashboard/area, verificar permisos de área:
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

  // Absolutamente TODOS los demás usuarios (incluso con rol 'ADMIN') requieren que amendoza les otorgue el permiso explícito
  return permisos.includes(permId);
}

/**
 * CAPABILITIES — Acciones que puede realizar cada rol
 */
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

/**
 * Verifica si un usuario puede acceder a una ruta por su rol/área.
 */
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

/**
 * Verifica si un usuario tiene una capacidad específica.
 */
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

/**
 * Menú de navegación filtrado por rol y username.
 * @param {string|object} roleOrUser
 * @param {string|null} areaArg
 * @param {string|null} usernameArg
 * @returns {Array}
 */
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
    // Acceso universal
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
      label:   'Dashboard Directivo',
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
      icon:    '📈',
      label:   'Estadísticas',
      path:    '/estadisticas',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA],
    },
    // Legado SITI
    {
      section: 'Históricos SITI',
      icon:    '⏳',
      label:   'Dashboard SITI',
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
    /*
    {
      section: 'Auditoría',
      icon:    '📋',
      label:   'Auditoría: Análisis de Cargos (Cirrus/SAP)',
      path:    '/auditoria/cargos',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR],
    },
    */
    {
      section: 'Farmacia',
      icon:    '📦',
      label:   'Inventario (SAP)',
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
      label:   'Inventario General (SAP)',
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
      label:   'Traslados (SAP)',
      path:    '/almacen/traslados',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.ALMACEN_GENERAL],
    },
    {
      section: 'Almacén General',
      icon:    '📑',
      label:   'Reportes (SAP)',
      path:    '/almacen/reportes',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.ALMACEN_GENERAL],
    },
    // Consulta Externa Operativa
    {
      section: 'Consulta Externa',
      icon:    '🩺',
      label:   'Agenda',
      path:    '/consulta-externa',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.CONSULTA_EXTERNA],
    },
    {
      section: 'Auditoría',
      icon:    '🛡️',
      label:   'Control de Calidad de Datos',
      path:    '/calidad-datos',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR],
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
      label:   'Log de Auditoría',
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

  // REGLA MAESTRA: Solo el usuario amendoza ve todo en el menú automáticamente.
  if (uName === 'amendoza') {
    return allItems;
  }

  // Filtrar items por rol y username. El filtrado granular por permisos individuales (user.permisos) lo realiza hasPermission(user, item.path).
  return allItems.filter(item => {
    if (role !== ROLES.ADMIN && !item.roles.includes(role)) return false;
    if (item.requiredUsername && item.requiredUsername !== uName) return false;
    return true;
  });
}

/**
 * getPermissionSections()
 * Genera dinámicamente la lista de secciones asignables como permisos individuales por amendoza en AdminUsuarios.
 */
export function getPermissionSections() {
  const navItems = getNavItems({ username: 'amendoza', role: ROLES.ADMIN });
  const sections = [];
  const seen = new Set();

  for (const item of navItems) {
    const permId = ROUTE_TO_PERMISSION[item.path];
    if (!permId) continue;

    // Expandir "Tablero de Área" en tableros individuales por cada área
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

  // ── Permisos IA (ia-*) — Controlan qué módulos de MAR-IA puede usar el usuario ──
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

  return sections;
}
