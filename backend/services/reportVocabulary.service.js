'use strict';

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const TOPICS = {
  inventory: ['inventario', 'stock', 'existencias', 'lo que hay en farmacia', 'lo que tengo en farmacia', 'que hay en farmacia', 'cuanto hay en farmacia', 'cuanto queda en farmacia', 'medicamentos de farmacia'],
  batches: ['lotes', 'caducidades', 'caducidad', 'caducados', 'vencidos', 'medicamentos vencidos'],
  item_prices: ['lista de precios', 'listas de precios', 'precios por lista', 'precios de articulos', 'precios de publico general', 'precios de hospitalizacion'],
  item_master_data: ['catalogo de articulos', 'catalogo de medicamentos', 'maestro de articulos'],
  stock_availability: ['disponibilidad proyectada', 'stock comprometido', 'existencias en pedido'],
  purchase_invoices: ['facturas de compras', 'facturas de proveedores', 'compras facturadas'],
  purchase_invoice_summary: ['resumen de facturas de proveedores', 'facturas de proveedores por documento'],
  purchase_orders: ['ordenes de compra', 'pedidos a proveedores', 'pedidos de compras'],
  goods_receipts_po: ['entradas de proveedores', 'mercancia recibida', 'recepciones de mercancia'],
  goods_returns: ['devoluciones a proveedores'],
  stock_transfers: ['traslados de almacen', 'traspasos entre almacenes', 'movimientos entre almacenes'],
  transfer_requests: ['solicitudes de traslado', 'solicitudes de traspaso'],
  goods_issues: ['mermas', 'bajas de inventario', 'salidas de inventario'],
  goods_receipts_inv: ['entradas directas', 'ajustes positivos de inventario'],
  purchase_requests: ['requisiciones', 'solicitudes de compra'],
  sales_invoices: ['facturacion hospitalaria', 'facturas de pacientes', 'facturas de ventas'],
  sales_invoice_summary: ['resumen de facturas de clientes', 'facturas de clientes por documento', 'facturas de clientes', 'facturas clientes'],
  credit_memos: ['notas de credito de clientes', 'cancelaciones de facturas de clientes', 'notas de credito'],
  purchase_credit_memos: ['notas de credito de proveedores'],
  business_partners: ['directorio de socios', 'socios de negocio', 'socios comerciales', 'socios de negocios'],
  customers: ['directorio de clientes', 'lista de clientes', 'directorio de aseguradoras', 'clientes y aseguradoras', 'directorio de pagadores'],
  suppliers: ['directorio de proveedores', 'lista de proveedores'],
  accounts_receivable: ['cuentas por cobrar', 'clientes que deben', 'facturas de clientes sin pagar'],
  accounts_payable: ['cuentas por pagar', 'lo que debemos', 'facturas de proveedores sin pagar'],
  incoming_payments: ['cobros recibidos', 'pagos de clientes', 'dinero recibido'],
  outgoing_payments: ['pagos a proveedores', 'pagos realizados a proveedores'],
  sales_down_payments: ['anticipos de clientes'], purchase_down_payments: ['anticipos a proveedores'],
  sales_order_summary: ['ordenes de venta', 'ordenes de ventas', 'orden de venta', 'ov', 'ovs', 'ordenes de venta sap', 'ov sap', 'resumen de pedidos de clientes'],
  sales_orders: ['pedidos de clientes', 'detalle de ordenes de venta sap', 'detalle ov sap'], sales_quotations: ['cotizaciones a clientes'],
  purchase_quotations: ['cotizaciones de proveedores'], sales_deliveries: ['entregas a clientes'],
  sales_returns: ['devoluciones de clientes'], journal_entries: ['asientos contables', 'movimientos contables'],
  chart_accounts: ['cuentas contables'], cost_centers: ['centros de costo'],
  warehouses: ['lista de almacenes', 'catalogo de almacenes'], item_groups: ['grupos de articulos'],
  vertical_surgeries: ['cirugias', 'operaciones', 'pacientes operados', 'quien se opero', 'uso de quirofano'],
  vertical_accounts: ['cuentas hospitalarias', 'atenciones hospitalarias'],
  vertical_account_charges: ['cargos de cuentas', 'detalle de cargos'],
  vertical_service_charges: ['cargos por servicio', 'cargos de servicios'],
  vertical_consultation_schedule: ['citas', 'agenda', 'citas programadas', 'agenda de consulta'],
  vertical_consultations_day: ['consulta del dia', 'ordenes vinculadas a consulta'],
  vertical_study_requests: ['solicitudes de estudios', 'estudios solicitados'],
  vertical_auxiliary_charges: ['cobros de imagenologia', 'cobros de estudios'],
  vertical_physicians: ['directorio de medicos', 'lista de doctores', 'directorio de doctores'],
  vertical_physician_productivity: ['productividad medica', 'atenciones por medico'],
  vertical_physician_revenue_monthly: ['ingresos por medico por mes', 'consultas e ingresos por medico'],
  vertical_operational_indicators: ['indicadores operativos', 'indicadores del hospital'],
  vertical_fee_reference: ['calculo de honorarios', 'referencia de honorarios'],
  vertical_fee_audit: ['auditoria de honorarios', 'revision de honorarios'],
  vertical_sales_orders: ['ordenes de venta', 'ordenes de ventas', 'orden de venta', 'ov', 'ovs', 'ordenes de venta vertical', 'ov vertical'],
  vertical_service_orders: ['ordenes de servicios', 'detalle de ordenes de servicios', 'detalle ov de servicios'], vertical_service_catalog: ['catalogo de servicios'],
  vertical_receivables: ['cartera hospitalaria', 'saldos de pacientes', 'cuentas hospitalarias pendientes'],
  vertical_discharges: ['altas hospitalarias', 'egresos hospitalarios', 'pacientes dados de alta'],
  vertical_room_stays: ['habitaciones', 'estancias', 'cuartos'],
  vertical_prescriptions: ['recetas', 'tratamientos'],
  vertical_returns_monthly: ['devoluciones clinicas por mes'],
  vertical_subcontracted_services: ['subrogados', 'servicios subrogados'],
  vertical_clinical_supply_tickets: ['tickets de farmacia', 'tickets de insumos', 'insumos por atencion'],
  vertical_clinical_return_tickets: ['tickets de devolucion', 'devoluciones de insumos por atencion'],
};

const WAREHOUSE_LABELS = { ALL: 'Todos los almacenes', FAR: 'Farmacia central', QX: 'Quirófano general', QXCR: 'Carro rojo de quirófano', QXRCR: 'Carro rojo de recuperación', TERACR: 'Carro rojo de terapia intensiva', PPBCR: 'Carro rojo de privados PB', PPACR: 'Carro rojo de privados PA', IMAGCR: 'Carro rojo de imagenología', CARDIOCR: 'Carro rojo de cardiología', CUNACR: 'Carro rojo de cuneros', QXCM: 'Quirófano de Código Mater', URG1CM: 'Urgencias de Código Mater', ALG: 'Almacén general' };

const TYPOS = { kiero: 'quiero', qiero: 'quiero', nesesito: 'necesito', nececito: 'necesito', nesecito: 'necesito', pasiente: 'paciente', pasientes: 'pacientes', pacinte: 'paciente', pacietne: 'paciente', mediko: 'medico', medicos: 'medicos', medcio: 'medico', medicoo: 'medico', sirugia: 'cirugia', sirujia: 'cirugia', sirugias: 'cirugias', sirujias: 'cirugias', cirujias: 'cirugias', cirujia: 'cirugia', prosedimiento: 'procedimiento', prosedimientos: 'procedimientos', presio: 'precio', presios: 'precios', esistencias: 'existencias', exsistencias: 'existencias', invntario: 'inventario', inbentario: 'inventario', alamsen: 'almacen', almasen: 'almacen', antivioticos: 'antibioticos', antibiotiko: 'antibiotico', antibiotikos: 'antibioticos', qe: 'que', q: 'que', k: 'que', tmb: 'tambien', tb: 'tambien', xfa: 'por favor', x: 'por', pa: 'para', pal: 'para el', farma: 'farmacia', refri: 'refrigeracion', dr: 'medico', dra: 'medico', doc: 'medico', docs: 'medicos' };
Object.assign(TYPOS, { nomas: 'solo', solamente: 'solo', porfa: 'por favor', porfis: 'por favor', ponle: 'agrega', ponme: 'agrega', metele: 'agrega', anadele: 'agrega', sacale: 'quita', quitale: 'quita', quitame: 'quita', muestras: 'muestra', hasme: 'hazme', asme: 'hazme', medicina: 'medicamento', medicinas: 'medicamentos', materiales: 'insumos', cant: 'cantidad', antiviotico: 'antibiotico', medikoo: 'medico' });
const COMMON_WORDS = new Set(('primera segunda primero quince veinte treinta ultimo ultimos ultima ultimas actual actualiza generado genera generarlo nuevo nuevos nueva nuevas mejor ahora mismo misma todos todas cualquier ninguno ninguna cuando donde cuales quienes como para desde hasta entre durante despues antes porque favor gracias refiero tratante solicitante registrados hospitalizacion publico unitario promedio general central nacimiento sexo genero persona personas joven mayores menores filtro filtros lados van').split(' '));
Object.assign(TYPOS, { status: 'estatus', estatuss: 'estatus', estatuz: 'estatus' });
Object.assign(TYPOS, { dedicible: 'deducible', dedicibles: 'deducibles' });
['medica', 'medicas', 'cuenta', 'cuentas', 'cierre', 'registrada', 'registradas', 'cancelada', 'canceladas', 'tenga', 'tengan', 'tiene', 'tienen'].forEach(word => COMMON_WORDS.add(word));
['acuerdo', 'acuerdos', 'comercial', 'comerciales', 'convenio', 'convenios', 'pagador', 'pagadores', 'aseguradora', 'aseguradoras',
  'socio', 'socios', 'negocio', 'negocios', 'descuento', 'descuentos', 'deducible', 'deducibles', 'copago', 'copagos', 'coaseguro', 'coaseguros',
  'tabulador', 'tabuladores', 'conciliacion', 'contador', 'contralor', 'auditor', 'estados', 'facturar', 'facturado', 'facturada', 'facturados', 'facturadas',
  'pagaron', 'cobrado', 'cobrada', 'cobrados', 'cobradas', 'cubiertas', 'vigentes', 'liquidada', 'liquidadas', 'deducible', 'coaseguro', 'retencion', 'retenciones'].forEach(word => COMMON_WORDS.add(word));
const VOCABULARY = [...new Set([...Object.values(TOPICS).flat().flatMap(phrase => phrase.split(' ')), ...Object.values(TYPOS).flatMap(phrase => phrase.split(' ')), ...('paciente pacientes medico medicos procedimiento procedimientos nombre nombres apellido fecha fechas cantidad existencias precio precios costo costos promedio unitario saldo total importe subtotal impuesto iva proveedor cliente insumo medicamento producto articulo lote caducidad almacen especialidad folio telefono correo edad diagnostico habitacion codigo moneda descuento anticipo utilidad estado comentarios descripcion agrega agregar incluye incluir quita quitar elimina quitar cambia cambiar sustituye solo unicamente tambien pendientes pendiente abiertos abiertas cerrados cerradas vencidos vencidas antibioticos controlados refrigerados semana mes pasado anterior septiembre octubre noviembre diciembre enero febrero marzo abril mayo junio julio agosto quincena primero quince busca buscar filtra muestra cirugias inventario farmacia central general').split(' ')])].filter(word => word.length >= 4);

function distance(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => i ? (j ? 0 : i) : j));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
  }
  return rows[a.length][b.length];
}

function normalizeWords(message) {
  const protectedValues = [];
  const masked = String(message || '').replace(/["“][^"”]*["”]|\b(?:busca|buska|buscar|encuentra|que diga|que contenga)\s+[^,;\n]+/gi, value => { protectedValues.push(value); return `ZZVALUE${protectedValues.length - 1}ZZ`; });
  const corrected = normalize(masked).replace(/\b[a-z]+\b/g, word => {
    if (TYPOS[word]) return TYPOS[word];
    if (word.length < 5 || COMMON_WORDS.has(word) || VOCABULARY.includes(word)) return word;
    const limit = word.length >= 9 ? 2 : 1;
    const candidates = VOCABULARY.filter(candidate => Math.abs(candidate.length - word.length) <= limit).map(candidate => ({ candidate, score: distance(word, candidate) })).filter(item => item.score <= limit).sort((a, b) => a.score - b.score);
    return candidates.length && (candidates.length === 1 || candidates[0].score < candidates[1].score) ? candidates[0].candidate : word;
  });
  return corrected.replace(/zzvalue(\d+)zz/g, (_, index) => protectedValues[Number(index)]);
}

function naturalText(message) {
  return normalize(normalizeWords(message))
    .replace(/\b(por favor|porfa|porfis|gracias|porfis|oye|hola)\b/g, '')
    .replace(/\b(ponle|ponme|metele|anade|anadele|sumale|incluyele|incluyeme|pon|mete)\b/g, 'agrega')
    .replace(/\b(que (?:salga|salgan|venga|vengan|traiga|traigan|aparezca|aparezcan)|quiero ver|muestrame|ensen[ae]me)\b/g, 'muestra')
    .replace(/\b(sacale|borra|quitale|quitame|no pongas|ya no quiero|no quiero ver)\b/g, 'quita')
    .replace(/\b(doc|docs|doctores|doctora|doctoras|doctor)\b/g, 'medico')
    .replace(/\b(nomas|solamente|nada mas|unicamente)\b/g, 'solo')
    .replace(/\b(fecha (?:en )?que entro|cuando entro)\b/g, 'fecha ingreso')
    .replace(/\b(fecha (?:en )?que salio|cuando salio)\b/g, 'fecha alta')
    .replace(/\s+/g, ' ').trim();
}

function topicPhrases(entity) {
  return [...new Set([entity.title, ...(TOPICS[entity.id] || []),
    ...(Array.isArray(entity.aliases) ? entity.aliases.filter(alias => typeof alias === 'string' && alias.trim()) : [])])].filter(Boolean);
}

function entitySources(entity) {
  const supplied = Array.isArray(entity?.sources) ? entity.sources.join(' ') : entity?.source || 'SAP';
  return ['sap', 'vertical'].filter(source => new RegExp(`\\b${source}\\b`).test(normalize(supplied)));
}

module.exports = { normalize, normalizeWords, naturalText, TOPICS, WAREHOUSE_LABELS, distance, topicPhrases, entitySources };
