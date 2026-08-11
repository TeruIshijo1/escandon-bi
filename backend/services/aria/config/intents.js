'use strict';

const queryMedicosMasIngresos = require('../handlers/productividad.handler');
const queryCensoCamas = require('../handlers/censo.handler');
const queryAuditoriaInventarios = require('../handlers/auditoria.handler');
const queryCalidadDatos = require('../handlers/calidad.handler');
const queryInsumosMasGastados = require('../handlers/insumos.handler');
const queryPacientesMayorGasto = require('../handlers/gastos.handler');
const queryDevolucionesFarmacia = require('../handlers/devoluciones.handler');
const queryStockInsumo = require('../handlers/stock.handler');

// NUEVOS HANDLERS
const {
  queryCirugiasDelMomento,
  queryKitsQuirurgicos,
  queryInventarioQuirofano
} = require('../handlers/quirofano.handler');

const {
  queryInventarioAlmacenGeneral,
  queryTrasladosAlmacen,
  queryEntradasAlmacen,
  queryKardexAlmacen
} = require('../handlers/almacen.handler');

const {
  queryRecetasPendientes,
  queryLibroControlados,
  queryHistorialFarmacologico
} = require('../handlers/recetas.handler');

const { hasIAPermission } = require('../core/permissions');

const IA_PERMISSION_CATALOG = [
  {
    id: 'ia-quirofano',
    label: 'Quirófano y Cirugías',
    icon: '🏥',
    suggestions: [
      '🏥 ¿Cuáles son las cirugías del momento?',
      '🏥 ¿Qué materiales incluye el kit quirúrgico?',
      '🏥 Dime el inventario de Quirófano QX/QXCR',
    ],
  },
  {
    id: 'ia-productividad-medica',
    label: 'Productividad Médica',
    icon: '👨‍⚕️',
    suggestions: [
      '👨‍⚕️ ¿Quién es el médico que más ingresos aporta?',
      '👨‍⚕️ ¿Cuál es el médico con mayor productividad?',
    ],
  },
  {
    id: 'ia-ocupacion-camas',
    label: 'Censo y Ocupación',
    icon: '🛏️',
    suggestions: [
      '🛏️ ¿Cómo está la ocupación de camas por área?',
      '🛏️ ¿Cuántas camas hay disponibles?',
    ],
  },
  {
    id: 'ia-auditoria-inventarios',
    label: 'Auditoría e Inventarios',
    icon: '🔍',
    suggestions: [
      '🔍 ¿Cuáles son las partidas con faltantes hoy?',
      '💊 ¿Cuáles son los 5 insumos más consumidos?',
    ],
  },
  {
    id: 'ia-calidad-datos',
    label: 'Calidad de Datos',
    icon: '🛡️',
    suggestions: [
      '🛡️ ¿Qué anomalías de calidad se detectaron?',
    ],
  },
  {
    id: 'ia-busqueda-pacientes',
    label: 'Búsqueda de Pacientes',
    icon: '👤',
    suggestions: [
      '👤 Buscar al paciente García',
    ],
  },
  {
    id: 'ia-busqueda-medicos',
    label: 'Búsqueda de Médicos',
    icon: '⚕️',
    suggestions: [
      '⚕️ Buscar cargos del Dr. López',
    ],
  },
  {
    id: 'ia-busqueda-insumos',
    label: 'Búsqueda de Insumos',
    icon: '💊',
    suggestions: [
      '💊 Buscar el insumo paracetamol',
    ],
  },
  {
    id: 'ia-busqueda-financiera',
    label: 'Datos Financieros',
    icon: '💰',
    suggestions: [
      '💰 ¿Quién es el paciente con mayor gasto acumulado?',
    ],
  },
  {
    id: 'ia-farmacia',
    label: 'Farmacia e Inventarios',
    icon: '💊',
    suggestions: [
      '💊 ¿Qué recetas están pendientes en Farmacia?',
      '💊 Ver el libro de medicamentos controlados',
      '💊 ¿Cuáles son las devoluciones de farmacia hoy?',
      '💊 Dime el stock actual de paracetamol',
    ],
  },
  {
    id: 'ia-almacen',
    label: 'Almacén General',
    icon: '📦',
    suggestions: [
      '📦 Dime el stock del Almacén General',
      '📦 ¿Cuáles son los traslados de almacén hoy?',
      '📦 Ver entradas de mercancía de proveedores',
      '📦 Consultar el Kardex de inventario',
    ],
  },
];

const INTENT_REGISTRY = [
  // ── QUIRÓFANO ────────────────────────────────────────────────
  {
    id: 'cirugias-momento',
    patterns: [
      /cirugias?\s+(del\s+momento|hoy|en\s+curso|recientes?|programadas?)/,
      /agenda\s+quirurgica/,
      /quirofano\s+(hoy|actual|evento)/,
      /uso\s+de?\s*quirofano/,
      /cirugias?\s+de?\s*hoy/,
      /procedimientos?\s+quirurgicos?/,
      /que\s+cirugias?\s+hay/,
      /cirugias?\s+activas?/,
    ],
    iaPermission: 'ia-quirofano',
    sectionPerm: null,
    handler: queryCirugiasDelMomento,
    priority: 25,
  },
  {
    id: 'kits-quirurgicos',
    patterns: [
      /kit.*quirurgico/,
      /materiales?.*cirugia/,
      /insumos?.*cirugia/,
      /receta.*quirofano/,
      /plantilla.*cirugia/,
    ],
    iaPermission: 'ia-quirofano',
    sectionPerm: null,
    handler: queryKitsQuirurgicos,
    priority: 22,
  },
  {
    id: 'inventario-quirofano',
    patterns: [
      /stock.*quirofano/,
      /inventario.*quirofano/,
      /material.*quirofano/,
      /quirofano.*stock/,
      /quirofano.*inventario/,
      /existencia.*quirofano/,
    ],
    iaPermission: 'ia-quirofano',
    sectionPerm: null,
    handler: queryInventarioQuirofano,
    priority: 22,
  },

  // ── ALMACÉN GENERAL ──────────────────────────────────────────
  {
    id: 'almacen-inventario-general',
    patterns: [
      /stock.*almacen\s*general/,
      /inventario.*almacen\s*general/,
      /existencias?.*almacen\s*general/,
      /almacen\s+general.*stock/,
      /almacen\s+general.*inventario/,
    ],
    iaPermission: 'ia-almacen',
    sectionPerm: null,
    handler: queryInventarioAlmacenGeneral,
    priority: 22,
  },
  {
    id: 'almacen-traslados',
    patterns: [
      /traslados?.*almacen/,
      /solicitud.*traslado/,
      /envios?.*almacen/,
      /movimientos?.*almacen/,
      /traslados?\s+entre\s+almacenes/,
    ],
    iaPermission: 'ia-almacen',
    sectionPerm: null,
    handler: queryTrasladosAlmacen,
    priority: 20,
  },
  {
    id: 'almacen-entradas',
    patterns: [
      /entradas?.*almacen/,
      /facturas?.*proveedor/,
      /recepcion.*almacen/,
      /compras?.*almacen/,
      /ordenes?\s+de\s+compra/,
    ],
    iaPermission: 'ia-almacen',
    sectionPerm: null,
    handler: queryEntradasAlmacen,
    priority: 20,
  },
  {
    id: 'almacen-kardex',
    patterns: [
      /kardex/,
      /trazabilidad.*insumo/,
      /historial.*almacen/,
      /movimientos.*kardex/,
    ],
    iaPermission: 'ia-almacen',
    sectionPerm: null,
    handler: queryKardexAlmacen,
    priority: 20,
  },

  // ── FARMACIA AVANZADA ─────────────────────────────────────────
  {
    id: 'farmacia-recetas-pendientes',
    patterns: [
      /recetas?\s+pendientes?/,
      /recetas?\s+por\s+surtir/,
      /cola.*despacho/,
      /pendientes?.*farmacia/,
      /surtir.*receta/,
    ],
    iaPermission: 'ia-farmacia',
    sectionPerm: null,
    handler: queryRecetasPendientes,
    priority: 20,
  },
  {
    id: 'farmacia-controlados',
    patterns: [
      /medicamentos?\s+controlados?/,
      /libro.*controlados/,
      /controlados?.*farmacia/,
      /registro.*controlados/,
    ],
    iaPermission: 'ia-farmacia',
    sectionPerm: null,
    handler: queryLibroControlados,
    priority: 20,
  },
  {
    id: 'farmacia-historial-paciente',
    patterns: [
      /historial\s+farmacologico/,
      /medicamentos?\s+de?\s+paciente/,
      /historial\s+de\s+recetas/,
    ],
    iaPermission: 'ia-farmacia',
    sectionPerm: null,
    handler: queryHistorialFarmacologico,
    priority: 20,
  },

  // ── OTROS INTENTS EXISTENTES ─────────────────────────────────
  {
    id: 'productividad-medica',
    patterns: [
      /medico.*mas/,
      /doctor.*mas/,
      /mas\s+ingresos/,
      /productividad/,
      /top\s*\d*\s*medico/,
      /medico.*ingreso/,
      /doctor.*ingreso/,
      /mejores?\s+medico/,
      /medico.*factur/,
      /rendimiento.*medico/,
      /quien\s+(mas|mejor)\s+(factur|ingres|produc)/,
    ],
    iaPermission: 'ia-productividad-medica',
    sectionPerm: 'dashboard-directivo',
    handler: queryMedicosMasIngresos,
    priority: 10,
  },
  {
    id: 'ocupacion-camas',
    patterns: [
      /ocupacion.*cama/,
      /cama.*ocupad/,
      /cama.*libr/,
      /cama.*disponib/,
      /censo/,
      /habitacion.*libr/,
      /cuantas\s+camas/,
      /estado.*camas/,
      /camas\s+por\s+area/,
      /hospedados/,
      /pacientes?\s+internados/,
    ],
    iaPermission: 'ia-ocupacion-camas',
    sectionPerm: 'dashboard-ocupacion',
    handler: queryCensoCamas,
    priority: 10,
  },
  {
    id: 'auditoria-inventarios',
    patterns: [
      /discrepancia/,
      /faltante/,
      /auditoria.*inventario/,
      /inventario.*cargo/,
      /cargo.*inventario/,
      /conciliacion/,
      /partidas.*faltante/,
      /que\s+falta/,
      /falta\s+algo/,
      /disputa/,
    ],
    iaPermission: 'ia-auditoria-inventarios',
    sectionPerm: 'auditoria-inventarios',
    handler: queryAuditoriaInventarios,
    priority: 10,
  },
  {
    id: 'calidad-datos',
    patterns: [
      /anomalia.*calidad/,
      /calidad.*dato/,
      /score.*limpieza/,
      /alerta.*calidad/,
      /dato.*anomal/,
      /control.*calidad/,
      /limpieza.*dato/,
      /dato.*limpio/,
      /precio.*cero/,
      /cargo.*atipico/,
    ],
    iaPermission: 'ia-calidad-datos',
    sectionPerm: 'calidad-datos',
    handler: queryCalidadDatos,
    priority: 10,
  },
  {
    id: 'insumos-mas-gastados',
    patterns: [
      /insumo.*consumid/,
      /insumo.*gastado/,
      /insumo.*frecuent/,
      /\d+\s*insumo/,
      /top\s*\d*\s*insumo/,
      /mas\s+(usado|consumido|gastado|surtido)/,
      /mayor\s+consumo/,
      /que\s+se\s+consume\s+mas/,
      /articulo.*consumid/,
    ],
    iaPermission: 'ia-auditoria-inventarios',
    sectionPerm: 'auditoria-inventarios',
    handler: queryInsumosMasGastados,
    priority: 10,
  },
  {
    id: 'pacientes-mayor-gasto',
    patterns: [
      /paciente.*mayor\s+gasto/,
      /paciente.*mas\s+gast/,
      /mayor\s+consumo.*paciente/,
      /cuenta.*mas\s+alta/,
      /quien.*mas\s+gasta/,
      /paciente.*mas\s+caro/,
      /top\s*\d*\s*paciente/,
    ],
    iaPermission: 'ia-busqueda-financiera',
    sectionPerm: 'dashboard-directivo',
    handler: queryPacientesMayorGasto,
    priority: 10,
  },
  {
    id: 'devoluciones-farmacia',
    patterns: [
      /devolucion.*farmacia/,
      /devolucion.*medicamento/,
      /devolucion.*insumo/,
      /regreso.*farmacia/,
      /retorno.*farmacia/,
      /farmacia.*devolucion/,
    ],
    iaPermission: 'ia-farmacia',
    sectionPerm: 'farmacia-devoluciones',
    handler: queryDevolucionesFarmacia,
    priority: 15,
  },
  {
    id: 'farmacia-inventario',
    patterns: [
      /stock/,
      /inventario/,
      /existencia/,
      /cuantos? hay/,
      /cuantas? hay/,
      /hay en farmacia/,
      /hay en almacen/,
      /hay en almacén/
    ],
    iaPermission: 'ia-farmacia',
    sectionPerm: 'farmacia-inventario',
    handler: queryStockInsumo,
    priority: 16,
  },
  {
    id: 'almacen-inventario',
    patterns: [
      /stock.*almacen/,
      /inventario.*almacen/,
      /existencia.*almacen/
    ],
    iaPermission: 'ia-almacen',
    sectionPerm: null,
    handler: queryStockInsumo,
    priority: 16,
  },
];

/**
 * Encuentra la mejor intención que coincide con la consulta del usuario
 * @param {string} normalizedQuery - Consulta ya normalizada
 * @returns {{ intent: object, score: number } | null}
 */
function matchIntent(normalizedQuery) {
  let bestMatch = null;
  let bestScore = 0;

  for (const intent of INTENT_REGISTRY) {
    for (const pattern of intent.patterns) {
      if (pattern.test(normalizedQuery)) {
        const matchCount = intent.patterns.filter(p => p.test(normalizedQuery)).length;
        const score = intent.priority + matchCount;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = intent;
        }
        break;
      }
    }
  }

  return bestMatch ? { intent: bestMatch, score: bestScore } : null;
}

/**
 * Obtiene sugerencias filtradas por los permisos IA del usuario
 * @param {object} user
 * @returns {string[]}
 */
function getSuggestionsForUser(user) {
  const suggestions = [];

  for (const perm of IA_PERMISSION_CATALOG) {
    if (hasIAPermission(user, perm.id)) {
      suggestions.push(...perm.suggestions);
    }
  }

  if (suggestions.length === 0) {
    suggestions.push('📊 Muéstrame un resumen general de mis áreas.');
  }

  return suggestions.slice(0, 6);
}

module.exports = {
  IA_PERMISSION_CATALOG,
  INTENT_REGISTRY,
  matchIntent,
  getSuggestionsForUser
};
