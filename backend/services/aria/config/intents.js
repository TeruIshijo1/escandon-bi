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
  queryKardexAlmacen,
  queryRiesgoDesabasto
} = require('../handlers/almacen.handler');

const {
  queryForecastIngresos
} = require('../handlers/finanzas.handler');

const {
  queryRecetasPendientes,
  queryLibroControlados,
  queryHistorialFarmacologico
} = require('../handlers/recetas.handler');

const { hasIAPermission } = require('../core/permissions');
const { PHRASES, EXTRA_ROOTS } = require('./vocabulario');

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
      '📤 Ver salidas y dispensaciones de Farmacia',
      '💊 ¿Cuáles son las devoluciones de farmacia hoy?',
      '💊 Dime el stock actual de paracetamol',
    ],
  },
  {
    id: 'ia-almacen',
    label: 'Almacén General',
    icon: '📦',
    suggestions: [
      '📦 ¿Qué insumos están próximos a agotarse?',
      '📦 Dime el stock del Almacén General',
      '📦 ¿Cuáles son los traslados de almacén hoy?',
      '📦 Ver entradas de mercancía de proveedores',
      '📦 Consultar el Kardex de inventario',
      '📦 ¿Qué cambió en el riesgo de desabasto desde ayer?',
    ],
  },
  {
    id: 'ia-finanzas',
    label: 'Proyecciones Financieras IA',
    icon: '📈',
    suggestions: [
      '📈 ¿Cuál es el forecast de ingresos para el siguiente mes?',
      '📈 ¿Cuánto dinero ingresará el próximo mes?',
      '📈 Proyección de ingresos por área',
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
      /surtir/,
      /despacho/,
      /prescripcion/,
      /medicamentos?\s+por\s+surtirse/,
    ],
    iaPermission: 'ia-farmacia',
    sectionPerm: null,
    handler: queryRecetasPendientes,
    priority: 20,
  },
  {
    id: 'farmacia-controlados',
    patterns: [
      /salidas?\s+(de\s+)?farmacia/,
      /dispensacion(es)?\s+(de\s+)?farmacia/,
      /salidas?\s+con\s+lote/,
      /entregas?\s+con\s+lote/,
      /medicamentos?\s+controlados?/,
      /libro.*controlados/,
      /controlados?.*farmacia/,
      /registro.*controlados/,
      /registro.*salidas/,
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
      /doctor.*factur/,
      /quien\s+(factur|ingres|produc)/,
      /rendimiento.*medico/,
      /quien\s+(mas|mejor)\s+(factur|ingres|produc)/,
    ],
    iaPermission: 'ia-productividad-medica',
    sectionPerm: 'dashboard-directivo',
    handler: queryMedicosMasIngresos,
    priority: 18,
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
      /devolucion/,
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
  {
    id: 'almacen-riesgo-desabasto',
    patterns: [
      /desabast/,
      /agot/,
      /por\s+terminarse/,
      /por\s+acabarse/,
      /termina.*stock/,
      /stock.*termina/,
      /se\s+van?\s+a\s+(acabar|terminar)/,
      /sin\s+stock/,
      /falta.*stock/,
      /comprar/,
      /escas/,
      /reabastec/,
      /quedan?\s+(pocos|poco)/,
      /(volver\s+a\s+)?pedir/,
      /reponer/,
      /solicitar\s+(insumo|stock|material)/,
      /requisicion/,
      /insumos?.*(escas|termin|acab|riesgo|critic|falta)/,
      /stock.*(bajo|critico|minimo)/,
      /cambio|cambios/,
      /riesgo.*(stock|insumo|sku|existencias|inventario)/,
      /por\s?que.*riesgo/
    ],
    iaPermission: 'ia-almacen',
    sectionPerm: null,
    handler: queryRiesgoDesabasto,
    priority: 24,
  },
  
  // ── FINANZAS ────────────────────────────────────────────────
  {
    id: 'finanzas-forecast-ingresos',
    patterns: [
      /forecast.*ingresos/,
      /prediccion.*ingresos/,
      /proyeccion.*ingresos/,
      /cuanto.*dinero.*ingresara/,
      /ingresos.*siguiente.*mes/,
      /proyeccion.*(factur|dinero)/,
      /pronostico.*(ingres|factur|dinero)/,
      /vamos\s+a\s+(facturar|ganar|recibir)/,
      /cuanto.*(ingres|factur|dinero).*mes/,
      /cuanto\s+(factur|ingres|dinero)/,
      /mes\s+que\s+viene/,
      /siguiente\s+mes/,
    ],
    iaPermission: 'ia-finanzas',
    sectionPerm: null,
    handler: queryForecastIngresos,
    priority: 20,
  }
];

/**
 * Raíces léxicas por intent para coincidencia amplia (sinónimos y variantes).
 * Se usan como respaldo cuando ningún patrón regex acierta exactamente:
 * una palabra del usuario que empiece con la raíz (o casi la raíz, tolerando typos)
 * suma puntos al intent. Gana el intent con más coincidencias (desempatando por prioridad).
 */
const SYNONYM_ROOTS = {
  'almacen-inventario-general': ['almacen', 'inventario', 'existencia', 'stock'],
  'almacen-riesgo-desabasto': ['agot', 'desabast', 'acab', 'termin', 'reorden', 'stock', 'comprar', 'insumo', 'falt', 'escas', 'qued', 'riesgo', 'critic'],
  'almacen-traslados': ['traslad', 'envio', 'solicitud', 'movimiento'],
  'almacen-entradas': ['entrada', 'recepcion', 'factura', 'proveedor', 'mercancia'],
  'almacen-kardex': ['kardex', 'trazabilidad', 'historico'],
  'farmacia-recetas-pendientes': ['receta', 'surtir', 'despacho', 'pendiente', 'prescripcion'],
  'farmacia-controlados': ['controlado', 'psicotrop', 'libro', 'auditado'],
  'farmacia-historial-paciente': ['historial', 'farmacologic', 'medicamento', 'entregado'],
  'devoluciones-farmacia': ['devolucion', 'devuelto', 'rechazad'],
  'farmacia-inventario': ['stock', 'existencia', 'inventario', 'disponible', 'suficiente'],
  'almacen-inventario': ['stock', 'existencia', 'inventario', 'almacen'],
  'cirugias-momento': ['cirug', 'quirofan', 'operac', 'procedim', 'agenda', 'programad'],
  'kits-quirurgicos': ['kit'],
  'inventario-quirofano': ['inventario', 'stock', 'qx', 'qxcr'],
  'ocupacion-camas': ['cama', 'ocup', 'disponible', 'censo', 'disponibilidad'],
  'auditoria-inventarios': ['auditoria', 'discrepancia', 'faltante', 'conciliac', 'partida'],
  'calidad-datos': ['calidad', 'anomal', 'alerta', 'limpieza', 'precio', 'atipico'],
  'insumos-mas-gastados': ['insumo', 'consumo', 'consumid', 'gastad', 'frecuent', 'top'],
  'productividad-medica': ['medico', 'productividad', 'ingresos', 'facturac', 'aport'],
  'pacientes-mayor-gasto': ['paciente', 'gasto', 'monto', 'cargo', 'acumulad'],
  'finanzas-forecast-ingresos': ['forecast', 'proyeccion', 'prediccion', 'ingres', 'dinero', 'siguiente', 'mes', 'estimar'],
};

/**
 * Palabras demasiado genéricas para derivar raíces: contaminan el matcher
 * difuso (aparecen en patrones de muchos intents y no distinguen intención).
 */
const GENERIC_STOPLIST = new Set([
  'hay', 'stock', 'inventario', 'existencia', 'existencias', 'cuantos', 'cuantas', 'cuanto', 'cuanta',
  'cuales', 'cual', 'dime', 'muestrame', 'muestranos', 'dame', 'ver', 'buscar', 'busca', 'saber',
  'puedes', 'hoy', 'ayer', 'dia', 'mes', 'todos', 'todas', 'todo', 'registro', 'registros',
  'consulta', 'consultas', 'informacion', 'numero', 'total', 'tipo', 'nombre', 'hora', 'fecha',
  'ultimo', 'ultima', 'reciente', 'recientes', 'momento', 'actual', 'general', 'insumos', 'insumo',
  'tiene', 'tienen', 'esta', 'estan', 'hay', 'tener',
]);

/**
 * Deriva raíces léxicas automáticamente desde los patrones regex de cada intent.
 * Garantiza que TODOS los módulos tengan cobertura de vocabulario aunque no
 * estén en SYNONYM_ROOTS (intents nuevos incluidos).
 */
function autoDeriveRoots(intent) {
  const roots = new Set();
  for (const pattern of intent.patterns || []) {
    const words = pattern.source
      .replace(/\\/g, '')
      .split(/[^a-zñáéíóúü]+/)
      .filter(w => w.length >= 5 && !GENERIC_STOPLIST.has(w) && !/^(prohib|exclus|inclu)/.test(w));
    words.forEach(w => {
      roots.add(w.length > 6 ? w.replace(/s$/, '') : w);
    });
  }
  return [...roots];
}

/**
 * Construye el mapa global raíz → intent con dos pasadas:
 * 1) Sinónimos explícitos (SYNONYM_ROOTS) — tienen prioridad.
 * 2) Raíces derivadas de los patrones — solo si la raíz aún no está reclamada.
 */
function buildRootMap() {
  const intentByRoot = new Map();
  const claimRoot = (root, intentId) => {
    if (!intentByRoot.has(root)) intentByRoot.set(root, intentId);
  };
  for (const intent of INTENT_REGISTRY) {
    for (const root of SYNONYM_ROOTS[intent.id] || []) claimRoot(root, intent.id);
  }
  for (const intent of INTENT_REGISTRY) {
    for (const root of EXTRA_ROOTS[intent.id] || []) claimRoot(root, intent.id);
  }
  for (const intent of INTENT_REGISTRY) {
    for (const root of autoDeriveRoots(intent)) claimRoot(root, intent.id);
  }
  return intentByRoot;
}

const ROOT_MAP = buildRootMap();

/**
 * Encuentra la mejor intención que coincide con la consulta del usuario
 * @param {string} normalizedQuery - Consulta ya normalizada
 * @returns {{ intent: object, score: number } | null}
 */
function matchIntent(normalizedQuery) {
  let bestMatch = null;
  let bestScore = 0;

  // 1. Patrones regex del intent + frases del vocabulario offline
  //    (las frases pesan el doble: son señales lingüísticas más fuertes)
  for (const intent of INTENT_REGISTRY) {
    const regexHits = intent.patterns.filter(p => p.test(normalizedQuery)).length;
    const phraseHits = (PHRASES[intent.id] || []).filter(p => p.test(normalizedQuery)).length;
    if (regexHits > 0 || phraseHits > 0) {
      const score = intent.priority + regexHits + phraseHits * 2;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = intent;
      }
    }
  }

  // Capa difusa: corrige typos y variantes léxicas. Solo decide cuando la señal
  // es fuerte (>= 2 raíces) o la consulta es corta; nunca desplaza un match
  // regex salvo que tenga más prioridad (intent más específico).
  const fuzzy = fuzzyMatchIntent(normalizedQuery);
  if (fuzzy) {
    const tokenCount = normalizedQuery.split(/\s+/).length;
    const minHits = tokenCount <= 3 ? 1 : 2;
    if (fuzzy.hits >= minHits) {
      if (!bestMatch) {
        bestMatch = fuzzy.intent;
        bestScore = fuzzy.intent.priority;
      } else if (fuzzy.hits >= 2 && fuzzy.intent.priority > bestMatch.priority) {
        bestMatch = fuzzy.intent;
        bestScore = fuzzy.intent.priority;
      }
    }
  }

  return bestMatch ? { intent: bestMatch, score: bestScore } : null;
}

/**
 * Coincidencia difusa: tolera typos y variantes léxicas usando las raíces
 * de SYNONYM_ROOTS (distancia de Levenshtein para palabras >= 4 letras).
 */
function fuzzyMatchIntent(normalizedQuery) {
  const { levenshtein } = require('../utils/nlp');
  const tokens = normalizedQuery.split(/\s+/).filter(t => t.length >= 4);

  if (tokens.length === 0) return null;

  const intentByRoot = ROOT_MAP;

  const scores = new Map();
  for (const token of tokens) {
    let bestRoot = null;
    let bestDist = Infinity;
    for (const [root] of intentByRoot) {
      // Coincidencia por raíz: la palabra empieza con la raíz (o la raíz empieza con la palabra)
      const isPrefix = token.startsWith(root) || root.startsWith(token);
      if (isPrefix && Math.abs(token.length - root.length) <= 3) {
        bestRoot = root;
        bestDist = 0;
        break;
      }
      // Coincidencia difusa para typos
      const threshold = token.length >= 6 ? 2 : 1;
      const dist = levenshtein(token, root);
      if (dist <= threshold && dist < bestDist) {
        bestRoot = root;
        bestDist = dist;
      }
    }
    if (bestRoot) {
      const intentId = intentByRoot.get(bestRoot);
      scores.set(intentId, (scores.get(intentId) || 0) + 1);
    }
  }

  const bestHits = Math.max(0, ...scores.values());
  if (bestHits < 1) return null;

  // Desempatar por prioridad si hay empate de hits
  const candidates = [...scores.entries()].filter(([, h]) => h === bestHits);
  let chosen = null;
  for (const [id] of candidates) {
    const intent = INTENT_REGISTRY.find(i => i.id === id);
    if (intent && (!chosen || intent.priority > chosen.priority)) chosen = intent;
  }
  return chosen ? { intent: chosen, hits: bestHits } : null;
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
  getSuggestionsForUser,
  ROOT_MAP,
  SYNONYM_ROOTS,
  EXTRA_ROOTS,
};
