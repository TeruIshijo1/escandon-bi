'use strict';

/**
 * Vocabulario ampliado de MAR-IA (100% offline, sin API de IA).
 * Frases y sinónimos en lenguaje natural por módulo/intent.
 *
 * Los patrones se prueban sobre texto NORMALIZADO (minúsculas, sin acentos,
 * sin puntuación) — por eso los patrones van sin acentos.
 *
 * - PHRASES:      frases completas (regex) con peso doble en el scoring.
 * - EXTRA_ROOTS:  raíces léxicas adicionales para el matcher difuso (typos).
 */

const PHRASES = {
  // ── ALMACÉN: RIESGO DE DESABASTO ──────────────────────────────
  'almacen-riesgo-desabasto': [
    /se\s+estan\s+acabando/,
    /se\s+estan\s+terminando/,
    /se\s+esta\s+acabando/,
    /queda\s+(muy\s+)?poco/,
    /quedan\s+(muy\s+)?pocos/,
    /va\s+a\s+faltar/,
    /van\s+a\s+faltar/,
    /casi\s+no\s+hay/,
    /ya\s+casi\s+no\s+hay/,
    /punto\s+de\s+reorden/,
    /reponer\s+(stock|insumos|material|existencias)/,
    /urgente\s+comprar/,
    /comprar\s+(mas|urgente)/,
    /stock\s+al\s+(minimo|minima)/,
    /riesgo\s+de\s+quedarse\s+sin/,
    /sin\s+existencias/,
    /desabastecimiento/,
    /faltan?\s+(insumos|material|medicamentos|productos)/,
    /faltara\s+stock/,
    /no\s+(nos\s+)?va\s+a\s+alcanzar/,
    /alcanza\s+el\s+stock/,
    /que\s+(tan\s+)?lejos\s+esta\s+el\s+desabasto/,
    /pronto\s+a\s+agotarse/,
    /cuando\s+se\s+acaba/,
    /cuando\s+se\s+agota/,
  ],

  // ── FARMACIA: RECETAS PENDIENTES ──────────────────────────────
  'farmacia-recetas-pendientes': [
    /medicinas?\s+(\w+\s+)?por\s+(surtir|dar|entregar|despachar)/,
    /medicamentos?\s+(\w+\s+)?por\s+(surtir|dar|entregar|despachar)/,
    /recetas?\s+en\s+cola/,
    /recetas?\s+por\s+(surtir|dar|entregar|despachar)/,
    /por\s+despachar/,
    /pendientes\s+de\s+surtido/,
    /ordenes\s+de\s+surtido/,
    /que\s+(hay\s+)?que\s+surtir/,
    /faltan\s+por\s+surtir/,
  ],

  // ── FARMACIA: CONTROLADOS ─────────────────────────────────────
  'farmacia-controlados': [
    /sustancias?\s+controladas?/,
    /medicamentos?\s+restringidos?/,
    /estupefacientes?/,
    /psicotropicos?/,
    /libro\s+de\s+controlados?/,
    /registro\s+de\s+controlados?/,
    /recetas?\s+restringidas?/,
  ],

  // ── FARMACIA: HISTORIAL DE PACIENTE ───────────────────────────
  'farmacia-historial-paciente': [
    /medicamentos?\s+que\s+(le\s+)?(han|han\s+ido|le)\s+(dado|dado\s+a)/,
    /que\s+(le\s+)?recetaron/,
    /que\s+(le\s+)?recetan/,
    /tratamiento\s+farmacologico/,
    /surtido\s+de\s+medicamentos?\s+(a|de)\s+un?\s+paciente/,
    /medicamentos?\s+entregados?\s+(a|de)/,
    /expediente\s+farmaceutico/,
    /medicamentos?\s+de\s+(su|un)\s+paciente/,
    /que\s+medicamentos?\s+le\s+han\s+dado/,
  ],

  // ── FARMACIA: DEVOLUCIONES ────────────────────────────────────
  'devoluciones-farmacia': [
    /medicamentos?\s+devueltos?/,
    /regresaron\s+medicamentos?/,
    /rechazos\s+de\s+farmacia/,
    /sobrantes?\s+de\s+farmacia/,
    /medicamentos?\s+que\s+regresaron/,
    /medicamentos?\s+(que\s+)?regresaron/,
    /regresaron\s+(a\s+)?farmacia/,
    /devoluciones?\s+de\s+medicamentos?/,
    /devoluciones?\s+de\s+insumos?/,
  ],

  // ── CENSO / OCUPACIÓN DE CAMAS ────────────────────────────────
  'ocupacion-camas': [
    /porcentaje\s+de\s+ocupacion/,
    /nivel\s+de\s+ocupacion/,
    /ocupacion\s+del\s+hospital/,
    /llenado\s+del\s+hospital/,
    /camas?\s+(vacia|vacias)/,
    /camas?\s+(desocupadas|disponibles|libres)/,
    /hay\s+espacio\s+en/,
    /capacidad\s+hospitalaria/,
    /cuantas\s+camas\s+hay/,
    /cuantas\s+camas\s+estan\s+ocupadas/,
    /cuantas\s+camas\s+estan\s+libres/,
    /hay\s+camas\s+disponibles/,
    /estado\s+de\s+las\s+camas/,
    /pacientes\s+hospitalizados/,
    /cuantos\s+pacientes\s+hay/,
    /cuantos\s+internados/,
  ],

  // ── QUIRÓFANO: CIRUGÍAS ───────────────────────────────────────
  'cirugias-momento': [
    /operaciones\s+de\s+hoy/,
    /operaciones\s+del\s+dia/,
    /cirugias\s+de\s+hoy/,
    /cirugias\s+del\s+dia/,
    /salas?\s+en\s+uso/,
    /procedimientos\s+programados/,
    /procedimientos\s+de\s+hoy/,
    /cirugias?\s+en\s+curso/,
    /agenda\s+de\s+quirofano/,
    /operando\s+ahora/,
    /que\s+operaciones\s+hay/,
    /que\s+cirugias\s+hay/,
    /cirugias\s+programadas/,
    /cirugias\s+del\s+momento/,
    /operaciones?\s+(que\s+)?se\s+hacen/,
    /operaciones?\s+programadas/,
  ],

  // ── QUIRÓFANO: KITS QUIRÚRGICOS ───────────────────────────────
  'kits-quirurgicos': [
    /materiales?\s+por\s+cirugia/,
    /insumos?\s+de\s+cada\s+(cirugia|operacion)/,
    /listas?\s+quirurgicas?/,
    /paquetes?\s+de\s+cirugia/,
    /kit\s+quirurgico/,
    /kit\s+(de|para)/,
    /lleva\s+(el|la)\s+kit/,
    /que\s+lleva\s+el\s+kit/,
    /material\s+para\s+la\s+(cirugia|operacion)/,
    /insumos?\s+de\s+la\s+(cirugia|operacion)/,
  ],

  // ── QUIRÓFANO: INVENTARIO ─────────────────────────────────────
  'inventario-quirofano': [
    /existencias?\s+en\s+quirofano/,
    /materiales?\s+de\s+quirofano/,
    /stock\s+de\s+qx/,
    /inventario\s+del\s+quirofano/,
    /stock\s+en\s+quirofano/,
    /insumos?\s+de\s+quirofano/,
  ],

  // ── ALMACÉN: KARDEX ───────────────────────────────────────────
  'almacen-kardex': [
    /historial\s+de\s+movimientos/,
    /movimientos?\s+de\s+inventario/,
    /trazabilidad\s+de\s+(insumos|materiales)/,
    /entradas\s+y\s+salidas?\s+de\s+almacen/,
    /movimientos?\s+del\s+almacen/,
    /historial\s+del\s+kardex/,
    /movimientos?\s+de\s+los\s+insumos/,
  ],

  // ── ALMACÉN: TRASLADOS ────────────────────────────────────────
  'almacen-traslados': [
    /movimientos?\s+entre\s+almacenes/,
    /envios?\s+a\s+servicios/,
    /transferencias?\s+de\s+insumos?/,
    /solicitudes?\s+de\s+envio/,
    /traslados?\s+de\s+insumos?/,
    /envios?\s+de\s+material/,
    /enviaron\s+a\s+servicios/,
    /enviaron\s+a/,
    /mandaron\s+a\s+servicios/,
    /pedidos?\s+de\s+los\s+servicios/,
  ],

  // ── ALMACÉN: ENTRADAS / PROVEEDORES ───────────────────────────
  'almacen-entradas': [
    /recepciones?\s+de\s+mercancia/,
    /llegadas?\s+de\s+proveedores?/,
    /compras?\s+recibidas?/,
    /compras?\s+(se\s+)?recibieron/,
    /se\s+recibieron\s+(las\s+)?(compras?|mercancia)/,
    /recibieron\s+(compras?|mercancia)/,
    /facturas?\s+de\s+compra/,
    /abastecimiento\s+nuevo/,
    /mercancia?\s+recibida?/,
    /entradas?\s+de\s+proveedores?/,
    /llego\s+(de|a)/,
    /que\s+hay\s+de\s+nuevo/,
    /lo\s+nuevo\s+que\s+llego/,
    /lo\s+que\s+llego\s+de\s+proveedores/,
  ],

  // ── AUDITORÍA DE INVENTARIOS ──────────────────────────────────
  'auditoria-inventarios': [
    /diferencias?\s+de\s+inventario/,
    /sobrantes?\s+y\s+faltantes?/,
    /conteos?\s+de\s+inventario/,
    /conciliaciones?\s+pendientes?/,
    /mermas?/,
    /diferencias?\s+en\s+el\s+almacen/,
    /que\s+falta\s+en\s+el\s+inventario/,
    /faltan\s+articulos?/,
    /sobran\s+articulos?/,
  ],

  // ── CALIDAD DE DATOS ──────────────────────────────────────────
  'calidad-datos': [
    /datos\s+sucios/,
    /errores?\s+de\s+datos/,
    /anomalias?\s+en\s+la\s+base/,
    /registros?\s+incompletos?/,
    /registros?\s+duplicados?/,
    /datos?\s+mal\s+cargados/,
    /problemas?\s+de\s+calidad/,
    /limpieza\s+de\s+datos/,
    /precios\s+en\s+cero/,
    /cargos?\s+atipicos?/,
    /base\s+de\s+datos\s+limpia/,
  ],

  // ── PRODUCTIVIDAD MÉDICA ──────────────────────────────────────
  'productividad-medica': [
    /doctor\s+(que|con|con\s+mas)\s+(genera|aporta|factura)/,
    /medico\s+(que|con|con\s+mas)\s+(genera|aporta|factura)/,
    /medico\s+que\s+mas\s+ingresos/,
    /doctor\s+que\s+mas\s+ingresos/,
    /ranking\s+de\s+medicos/,
    /mejor\s+medico/,
    /quien\s+gana\s+mas/,
    /quien\s+factura\s+mas/,
    /quien\s+aporta\s+mas/,
    /medicos?\s+con\s+mejor\s+(desempeno|rendimiento)/,
    /top\s+de\s+medicos/,
  ],

  // ── PACIENTES CON MAYOR GASTO ─────────────────────────────────
  'pacientes-mayor-gasto': [
    /paciente\s+(que|con)\s+mas\s+gasto/,
    /paciente\s+(que|con)\s+mayor\s+gasto/,
    /quien\s+gasta\s+mas/,
    /mayores\s+consumos?\s+de\s+pacientes/,
    /top\s+de\s+cuentas/,
    /pacientes?\s+con\s+mayores\s+(cargos|montos)/,
    /cuenta\s+mas\s+alta/,
    /cuentas?\s+con\s+mas\s+gasto/,
    /cual\s+paciente\s+gasta\s+mas/,
    /que\s+paciente\s+gasta\s+mas/,
    /gasta\s+mas/,
  ],

  // ── INSUMOS MÁS GASTADOS / CONSUMIDOS ─────────────────────────
  'insumos-mas-gastados': [
    /cuales\s+se\s+consumen\s+mas/,
    /insumos?\s+con\s+mayor\s+salida/,
    /materiales?\s+mas\s+usados?/,
    /medicamentos?\s+mas\s+consumidos?/,
    /insumos?\s+mas\s+consumidos?/,
    /insumos?\s+mas\s+gastados?/,
    /medicamentos?\s+(se\s+)?consumen\s+mas/,
    /medicamentos?\s+(se\s+)?gastan\s+mas/,
    /insumos?\s+(se\s+)?consumen\s+mas/,
    /insumos?\s+(se\s+)?gastan\s+mas/,
    /se\s+consumen\s+mas/,
    /se\s+gastan\s+mas/,
    /gastado\s+en\s+(medicamentos?|insumos?)/,
    /que\s+insumo\s+se\s+consume\s+mas/,
    /cuales\s+insumos\s+se\s+gastan\s+mas/,
    /top\s+de\s+consumo/,
    /mayor\s+volumen\s+de\s+consumo/,
  ],

  // ── FINANZAS: FORECAST DE INGRESOS ────────────────────────────
  'finanzas-forecast-ingresos': [
    /ingresos?\s+esperados?/,
    /cuantos?\s+ingresos?\s+esperados?/,
    /proyeccion\s+mensual/,
    /estimado\s+del\s+proximo\s+mes/,
    /cuanta\s+entrada\s+de\s+dinero/,
    /cuanto\s+ganaremos/,
    /cuanto\s+se\s+espera\s+(ganar|recibir|ingresar)/,
    /proyeccion\s+de\s+caja/,
    /presupuesto\s+estimado/,
    /cuanto\s+dinero\s+entrara/,
    /cuanto\s+dinero\s+va\s+a\s+entrar/,
    /cuanto\s+vamos\s+a\s+ganar/,
    /cuanto\s+ingresara\s+el\s+hospital/,
    /que\s+ingresos\s+se\s+esperan/,
    /siguiente\s+periodo/,
  ],

  // ── STOCK / INVENTARIO GENERAL ────────────────────────────────
  'farmacia-inventario': [
    /hay\s+de\s+(?!nuevo)/,
    /cuanto\s+hay\s+de/,
    /cuanto\s+stock\s+hay/,
    /existencias\s+de\s+/,
    /hay\s+suficiente/,
    /cuanto\s+queda\s+de/,
    /que\s+stock\s+hay/,
    /disponibilidad\s+de\s+/,
    /tienes?\s+stock\s+de/,
  ],
  'almacen-inventario': [
    /hay\s+de\s+(?!nuevo)/,
    /cuanto\s+hay\s+de/,
    /cuanto\s+stock\s+hay/,
    /existencias\s+de\s+/,
    /hay\s+suficiente/,
    /cuanto\s+queda\s+de/,
    /que\s+stock\s+hay/,
    /disponibilidad\s+de\s+/,
  ],
};

/**
 * Raíces léxicas adicionales para el matcher difuso (tolerancia a typos
 * y variantes que no están en los patrones regex).
 */
const EXTRA_ROOTS = {
  'almacen-riesgo-desabasto': ['escas', 'agot', 'acab', 'termin', 'falt', 'qued', 'repon', 'pedir', 'stock', 'comprar', 'reorden', 'desabast', 'critic'],
  'farmacia-recetas-pendientes': ['surtir', 'despach', 'receta', 'prescripcion', 'pendient', 'cola', 'surtid', 'medicin'],
  'farmacia-controlados': ['controlad', 'psicotrop', 'estupefacient', 'restringid', 'libro'],
  'farmacia-historial-paciente': ['historial', 'farmacolog', 'medicament', 'entregad', 'recet'],
  'devoluciones-farmacia': ['devolucion', 'devuelt', 'regresad', 'rechaz', 'sobrant', 'regres'],
  'ocupacion-camas': ['cama', 'ocupacion', 'ocupad', 'disponib', 'libr', 'vaci', 'internad', 'hospitalizad', 'hosped', 'censo', 'espacio', 'capacidad', 'llenad'],
  'cirugias-momento': ['cirug', 'quirofan', 'operacion', 'operand', 'procedim', 'salas', 'agenda', 'programad', 'curso'],
  'kits-quirurgicos': ['kit', 'quirurgic', 'paquete', 'lista', 'material'],
  'inventario-quirofano': ['quirofan', 'existencia', 'stock', 'qx'],
  'almacen-kardex': ['kardex', 'trazabilid', 'movimiento', 'historial', 'entrad', 'salida'],
  'almacen-traslados': ['traslad', 'transferencia', 'envio', 'pedido', 'solicitud', 'envia', 'enviar', 'mand'],
  'almacen-entradas': ['entrada', 'recepcion', 'mercancia', 'proveedor', 'compra', 'factura', 'abastecimient', 'llegad', 'lleg', 'recib'],
  'auditoria-inventarios': ['auditoria', 'discrepancia', 'faltant', 'sobrant', 'conciliacion', 'merma', 'conteo', 'diferencia', 'partida'],
  'calidad-datos': ['calidad', 'anomal', 'duplicad', 'incomplet', 'sucio', 'limp', 'atipic', 'error'],
  'productividad-medica': ['medico', 'doctor', 'productividad', 'factur', 'ingreso', 'aport', 'gener', 'gana', 'ranking', 'rendimient', 'desempeno'],
  'pacientes-mayor-gasto': ['paciente', 'gasto', 'monto', 'cargo', 'acumulad', 'cuenta', 'consumo', 'mayor'],
  'insumos-mas-gastados': ['insumo', 'consum', 'gastad', 'usad', 'surtid', 'salida', 'volumen', 'frecuent'],
  'finanzas-forecast-ingresos': ['ingreso', 'forecast', 'proyeccion', 'prediccion', 'pronostico', 'dinero', 'ganar', 'factur', 'esper', 'entrar', 'estim', 'presupuesto', 'caja', 'mes'],
  'farmacia-inventario': ['stock', 'existencia', 'disponib', 'suficient', 'queda'],
  'almacen-inventario': ['stock', 'existencia', 'disponib', 'suficient', 'queda'],
};

module.exports = { PHRASES, EXTRA_ROOTS };