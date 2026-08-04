'use strict';

const queryMedicosMasIngresos = require('../handlers/productividad.handler');
const queryCensoCamas = require('../handlers/censo.handler');
const queryAuditoriaInventarios = require('../handlers/auditoria.handler');
const queryCalidadDatos = require('../handlers/calidad.handler');
const queryInsumosMasGastados = require('../handlers/insumos.handler');
const queryPacientesMayorGasto = require('../handlers/gastos.handler');
const queryDevolucionesFarmacia = require('../handlers/devoluciones.handler');
const queryStockInsumo = require('../handlers/stock.handler');
const { hasIAPermission } = require('../core/permissions');

const IA_PERMISSION_CATALOG = [
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
    icon: '🏥',
    suggestions: [
      '🏥 Buscar al paciente García',
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
      '💊 Dime el stock actual de paracetamol',
      '💊 ¿Cuáles son las devoluciones de farmacia hoy?',
    ],
  },
  {
    id: 'ia-almacen',
    label: 'Almacén General',
    icon: '📦',
    suggestions: [
      '📦 Dime el stock de gasas en el almacén',
      '📦 Buscar insumos generales',
    ],
  },
];

const INTENT_REGISTRY = [
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
    priority: 15, // Prioridad alta para evitar conflictos con la palabra genérica devolucion
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
        // Score = prioridad base + bonus si coincide con más patrones
        const matchCount = intent.patterns.filter(p => p.test(normalizedQuery)).length;
        const score = intent.priority + matchCount;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = intent;
        }
        break; // Ya encontramos un match en esta intención, pasar a la siguiente
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

  // Si no hay sugerencias (usuario sin permisos IA), dar sugerencia genérica
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
