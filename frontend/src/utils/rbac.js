/**
 * rbac.js — Mapa de permisos por rol
 * Hospital Escandón BI Platform v3.5
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
 * Para JEFE_AREA y USUARIO_OPERATIVO se valida también el área.
 */
export const ROUTE_PERMISSIONS = {
  '/':                      [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO, ROLES.ALMACEN_GENERAL],
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
  '/almacen/inventario':    [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.ALMACEN_GENERAL],
  '/almacen/traslados':     [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.ALMACEN_GENERAL],
  '/calidad-datos':         [ROLES.ADMIN, ROLES.DIRECTOR],
  '/estadisticas':          [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA],
  '/admin/usuarios':        [ROLES.ADMIN],
  '/admin/auditoria-log':   [ROLES.ADMIN],
  '/admin/configuracion':   [ROLES.ADMIN],
  '/admin/prueba-sap':      [ROLES.ADMIN],
};

/**
 * ROUTE_TO_PERMISSION
 * Mapea cada ruta de la plataforma al ID de permiso que se asigna en AdminUsuarios.
 * Las rutas de admin no necesitan mapeo porque solo ADMIN accede (sin filtro individual).
 */
export const ROUTE_TO_PERMISSION = {
  '/':                      'home',
  '/dashboard/directivo':   'dashboard-directivo',
  '/dashboard/ocupacion':   'dashboard-ocupacion',
  '/dashboard/area':        'dashboard-area',   // Se valida adicionalmente por área
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
  '/almacen/inventario':    'almacen-inventario',
  '/almacen/traslados':     'almacen-traslados',
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
 * ADMIN siempre tiene acceso total (no se filtra por permisos individuales).
 * @param {object} user - Objeto de usuario con { role, permisos, area }
 * @param {string} path - Ruta a verificar
 * @returns {boolean}
 */
export function hasPermission(user, path) {
  if (!user) return false;
  
  // El inicio siempre es visible, los módulos adentro se filtran
  if (path === '/') return true;

  // ADMIN siempre tiene acceso total
  if (user.role === ROLES.ADMIN) return true;

  const permisos = user.permisos || [];

  // Si no tiene permisos asignados, no restringir (compatibilidad con usuarios sin permisos configurados)
  if (permisos.length === 0) return true;

  const permId = ROUTE_TO_PERMISSION[path];

  // Rutas de admin o sin mapeo de permiso → solo se valida por rol
  if (!permId) return true;

  // Para /dashboard/area, verificar permisos de área:
  // 1) Si el usuario tiene área fija, verificar el permiso de su área
  // 2) Si no tiene área fija, verificar si tiene CUALQUIER permiso area-*
  if (path === '/dashboard/area') {
    if (user.area) {
      const areaPermId = AREA_TO_PERMISSION[user.area];
      if (areaPermId) return permisos.includes(areaPermId);
    }
    // Sin área fija → permitir si tiene cualquier permiso de área individual
    const allAreaPermIds = Object.values(AREA_TO_PERMISSION);
    const hasAnyAreaPerm = permisos.some(p => allAreaPermIds.includes(p));
    if (hasAnyAreaPerm) return true;
    // Fallback: verificar si tiene 'dashboard-area' explícito
    return permisos.includes(permId);
  }

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
  },
  [ROLES.JEFE_AREA]: {
    verTodosTableros:    false,  // Solo su área
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
    exportarExcel:       true,  // Solo descarga básica
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
};

/**
 * Verifica si un usuario puede acceder a una ruta.
 * @param {string} role
 * @param {string} path
 * @param {string|null} userArea
 * @param {string|null} routeArea
 * @returns {boolean}
 */
export function canAccessRoute(role, path, userArea = null, routeArea = null) {
  const allowed = ROUTE_PERMISSIONS[path];
  if (!allowed) return false;
  if (!allowed.includes(role)) return false;

  // Validación adicional de área para roles restringidos
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
 * @param {string} role
 * @param {string} capability
 * @returns {boolean}
 */
export function can(role, capability) {
  return CAPABILITIES[role]?.[capability] ?? false;
}

/**
 * Menú de navegación filtrado por rol.
 * @param {string} role
 * @param {string|null} area
 * @param {string|null} username
 * @returns {Array}
 */
export function getNavItems(role, area = null, username = null) {
  const areaLabel = area ? AREAS_LABELS[area] ?? area : '';

  const allItems = [
    // Acceso universal
    {
      section: 'Principal',
      icon:    '🏠',
      label:   'Inicio',
      path:    '/',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO, ROLES.ALMACEN_GENERAL],
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
    {
      section: 'Farmacia',
      icon:    '💊',
      label:   'Devoluciones',
      path:    '/farmacia/devoluciones',
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
      icon:    '📦',
      label:   'Inventario (SAP)',
      path:    '/farmacia/inventario',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA],
    },
    {
      section: 'Almacén General',
      icon:    '📦',
      label:   'Inventario General (SAP)',
      path:    '/almacen/inventario',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.ALMACEN_GENERAL],
      areas:   [AREAS.ALMACEN_GENERAL]
    },
    {
      section: 'Almacén General',
      icon:    '🚚',
      label:   'Traslados (SAP)',
      path:    '/almacen/traslados',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.ALMACEN_GENERAL],
      areas:   [AREAS.ALMACEN_GENERAL]
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

  return allItems.filter(item => {
    if (!item.roles.includes(role)) return false;
    if (item.requiredUsername && item.requiredUsername !== username) return false;
    return true;
  });
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
 * getPermissionSections()
 * Genera dinámicamente la lista de secciones asignables como permisos individuales.
 * Se nutre de getNavItems() para que siempre esté sincronizada con la navegación real.
 * Las rutas de Administración se excluyen porque solo ADMIN accede a ellas.
 * Las rutas de área se expanden en 9 tableros individuales.
 */
export function getPermissionSections() {
  // Obtenemos todos los items de navegación como ADMIN (para ver el máximo)
  const navItems = getNavItems(ROLES.ADMIN, null, null);

  // Filtrar secciones de administración (ADMIN tiene acceso implícito total)
  const permItems = navItems.filter(item => item.section !== 'Administración');

  const sections = [];
  const seen = new Set();

  for (const item of permItems) {
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
