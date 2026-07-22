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
};

/**
 * ROUTE_PERMISSIONS
 * Mapea cada ruta a los roles que pueden accederla.
 * Para JEFE_AREA y USUARIO_OPERATIVO se valida también el área.
 */
export const ROUTE_PERMISSIONS = {
  '/':                      [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO],
  '/dashboard/directivo':   [ROLES.ADMIN, ROLES.DIRECTOR],
  '/dashboard/ocupacion':   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA],
  '/dashboard/area':        [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO],
  '/siti/dashboard':        [ROLES.ADMIN, ROLES.DIRECTOR],
  '/siti/comparativo':      [ROLES.ADMIN, ROLES.DIRECTOR],
  '/auditoria/inventarios': [ROLES.ADMIN, ROLES.DIRECTOR],
  '/auditoria/cargos':      [ROLES.ADMIN, ROLES.DIRECTOR],
  '/calidad-datos':         [ROLES.ADMIN, ROLES.DIRECTOR],
  '/estadisticas':          [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA],
  '/admin/usuarios':        [ROLES.ADMIN],
  '/admin/auditoria-log':   [ROLES.ADMIN],
  '/admin/configuracion':   [ROLES.ADMIN],
};

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
 * @returns {Array}
 */
export function getNavItems(role, area = null) {
  const areaLabel = area ? AREAS_LABELS[area] ?? area : '';

  const allItems = [
    // Acceso universal
    {
      section: 'Principal',
      icon:    '🏠',
      label:   'Inicio',
      path:    '/',
      roles:   [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA, ROLES.USUARIO_OPERATIVO],
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
  ];

  return allItems.filter(item => item.roles.includes(role));
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
};
