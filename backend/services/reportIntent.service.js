'use strict';

const { normalize, naturalText, TOPICS, WAREHOUSE_LABELS } = require('./reportVocabulary.service');
const { interpretDates } = require('./reportLanguage.service');
const DEFAULT_FILTERS = { fechaDesde: '', fechaHasta: '', almacen: 'ALL', estatusDoc: 'ALL', clasificacionMedica: 'ALL', busqueda: '' };
const supportsFilter = (entity, key) => Array.isArray(entity.filters) ? entity.filters.includes(key) : entity.fields.some(field => ({ almacen: ['WhsCode', 'Filler', 'ToWhsCode'], estatusDoc: ['DocStatus', 'Status'], clasificacionMedica: ['MedicalClassification'] }[key] || []).includes(field.key));
const labels = value => normalize(value).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const stem = word => word.replace(/s$/, '');
const FILLER = /\b(el|la|los|las|un|una|del|de|que|se|me|te|lo|le|en|a|y|por|para|con|sin|es|sea|este|esta|esten|estan|son|van|tenga|tengan|tiene|tienen|necesito|quiero|dame|pasame|sacame|hazme|refiero|reporte|reportes|listado|lista|informacion|datos|dato|columna|columnas|salga|salgan|venga|vengan|nombre|nombres|ver|ahora|mejor|tambien|solo|mismo|agrega|incluye|muestra|quita|queda|quede|deja|favor|porfa|gracias|usa|ponlo|todos|todas|filtro|filtros|cualquier)\b/g;
const ACTIONS = /\b(agrega|incluye|muestra|quita|sin|solo|deja|con|cambia|sustituye)\b/g;
const ORDER_TOPICS = ['sales_order_summary', 'vertical_sales_orders', 'sales_orders', 'vertical_service_orders'];
const ORDER_SUMMARIES = ['sales_order_summary', 'vertical_sales_orders'];
const ORDER_REQUEST = /\b(?:ovs?|orden(?:es)? de ventas?)\b/;
const BOTH_SOURCES = /\b(?:ambas|ambos|las dos|los dos|sap y vertical|vertical y sap)\b/;
const MEDICATION_TYPES = [['ANTI', /\bantibioticos?\b/, 'antibióticos'], ['CON', /\bcontrolad[oa]s?\b/, 'controlados'], ['REFRI', /\brefrigerad[oa]s?\b|\brefrigeracion\b|\bvan (?:en|al) frio\b/, 'refrigerados']];
const CONCEPT_NAMES = { patient: 'paciente', patientId: 'número de paciente', doctor: 'médico', doctorId: 'número de médico', phone: 'teléfono', mail: 'correo', rfc: 'RFC', birth: 'fecha de nacimiento', gender: 'sexo', expiry: 'caducidad', discharge: 'fecha de alta', closure: 'fecha de cierre', medicalDischarge: 'alta médica', start: 'ingreso', end: 'fecha de salida', procedure: 'procedimiento', date: 'fecha', quantity: 'cantidad', cost: 'costo', price: 'precio', subtotal: 'subtotal', tax: 'impuesto', balance: 'saldo', discount: 'descuento', advance: 'anticipo', profit: 'utilidad', money: 'total', provider: 'proveedor', customer: 'cliente', product: 'producto', lot: 'lote', warehouse: 'almacén', specialty: 'especialidad', folio: 'folio', state: 'estado', room: 'habitación', age: 'edad', diagnosis: 'diagnóstico', currency: 'moneda', comments: 'comentarios', order: 'número de orden' };
const RULES = [
  ['order', /\b(?:ovs?|orden(?:es)? de ventas?|(?:numero|folio)(?: de)? (?:la )?(?:orden|ov))\b/, /^numero de orden$|^folio sap$/],
  ['patientId', /\b(numero|codigo|id|folio)\s+(?:del?\s+)?paciente\b/, /paciente/, /numero|codigo|folio/],
  ['doctorId', /\b(numero|codigo|id|folio)\s+(?:del?\s+)?medico\b/, /medico/, /numero|codigo|folio/],
  ['phone', /\b(telefono|telefonos|tel|celular|celulares)\b/, /telefono|celular/],
  ['mail', /\b(correo|correos|email|mail)\b/, /correo|email/],
  ['rfc', /\brfc\b/, /rfc/],
  ['birth', /\bnacimiento\b/, /nacimiento/],
  ['gender', /\b(sexo|genero)\b/, /sexo|genero/],
  ['expiry', /\b(caducidad|caduca|caducan|vencimiento)\b/, /fecha.*caducidad|fecha.*vencimiento|caducidad/],
  ['discharge', /\b(fecha\s+(?:de\s+)?alta|cuando salio|cuando se fue)\b/, /fecha.*alta/],
  ['closure', /\b(fecha (?:de )?cierre|cierre de cuenta)\b/, /fecha.*cierre/],
  ['medicalDischarge', /\balta (?:medica|registrada)\b/, /alta.*medica|alta.*registrada/, null, /fecha/],
  ['start', /\b(inicio|entrada|ingreso|cuando entro)\b/, /inicio|entrada|ingreso/, null, /numero|codigo/],
  ['end', /\b(fin|fecha de salida)\b/, /fin|fecha.*salida/],
  ['doctor', /\b(medico|medicos|tratante|solicitante|anestesiologo)\b/, /medico|anestesiologo/, null, /numero|codigo|folio|tipo|cedula/],
  ['patient', /\bpacientes?\b|quien se opero/, /paciente/, null, /numero|codigo|folio|tipo/],
  ['procedure', /\b(procedimientos?|operacion realizada|que le hicieron)\b/, /procedimiento/],
  ['date', /\b(fechas?|dia)\b/, /fecha|inicio|entrada.*estancia|creacion.*orden/, null, /vencimiento|caducidad|cierre|alta|modificado/],
  ['quantity', /\b(cantidad|cantidades|existencias?|stock|piezas?|unidades)\b|cuanto queda|cuantos quedan|cuanto hay/, /cantidad|cant |existencia|unidades/, null, /pendiente|devuelta/],
  ['cost', /\b(costos?|promedio)\b/, /costo/],
  ['price', /\b(precios?)\b|cuanto cuesta|en cuanto esta/, /precio/, null, /lista de precios|numero/],
  ['subtotal', /\bsubtotal\b/, /subtotal/],
  ['tax', /\b(iva|impuesto|impuestos)\b/, /iva|impuesto/],
  ['balance', /\bsaldos?\b|cuanto debe|cuanto deben/, /saldo/],
  ['discount', /\bdescuentos?\b/, /descuento/],
  ['advance', /\banticipos?\b/, /anticipo/],
  ['profit', /\b(utilidad|ganancia)\b/, /utilidad|ganancia/],
  ['money', /\b(total|importe|monto|dinero)\b/, /total|importe|monto/, null, /subtotal|unitario|referencia|observacion|cantidad/],
  ['provider', /\b(proveedores?|razon social)\b/, /proveedor|razon social/, null, /codigo|cod\.|tipo|grupo/],
  ['customer', /\bclientes?\b/, /cliente|razon social/, null, /codigo|cod\.|tipo|grupo/],
  ['product', /\b(insumos?|medicamentos?|productos?|articulos?|descripcion)\b/, /descripcion|insumo|medicamento|articulo|servicio/, null, /codigo|grupo|tipo|clasificacion|cantidad|numero|precio|compra|venta|inventario/],
  ['lot', /\blotes?\b/, /lote/, null, /cantidad|estatus/],
  ['warehouse', /\balmacenes?\b|\balmacen\b/, /almacen/],
  ['specialty', /\bespecialidad\b/, /especialidad/, null, /codigo/],
  ['folio', /\b(folios?|numero de cuenta|numero de atencion)\b/, /folio|numero de cuenta|numero de atencion/],
  ['state', /\b(estado|estatus)\b/, /estado|estatus/],
  ['room', /\b(habitacion|cuarto|cama)\b/, /habitacion|recurso/],
  ['age', /\bedad\b/, /edad/],
  ['diagnosis', /\bdiagnostico\b/, /diagnostico/],
  ['currency', /\bmoneda\b/, /moneda/],
  ['comments', /\b(comentarios?|observaciones?)\b/, /comentario|observacion/],
];

function cleanPending(pending) {
  if (!pending || typeof pending.request !== 'string' || pending.request.length > 1500 || !Array.isArray(pending.answers) || pending.answers.length > 4 || pending.answers.some(answer => typeof answer !== 'string' || answer.length > 1500)) return null;
  return { request: pending.request, answers: pending.answers };
}

function topicSelection(message, catalog) {
  const choice = message.match(/^\s*(?:el\s+(?:tema|reporte|opci[oó]n)\s+que\s+necesito\s+es|(?:quiero|necesito)\s+el\s+(?:tema|reporte)|(?:elijo|selecciono)\s+(?:(?:el|la)\s+)?(?:tema|reporte|opci[oó]n))\s*[«“"]([^»”"]+)[»”"]\s*(.*)$/i);
  if (!choice) return null;
  const title = labels(choice[1]);
  const matches = catalog.filter(entity => [entity.title, ...(TOPICS[entity.id] || [])].some(phrase => labels(phrase) === title));
  return { matches, remainder: choice[2].replace(/^[\s.!,:;]+/, '') };
}

function columnResolutions(utterances, entity) {
  const choices = new Map();
  for (const utterance of utterances) {
    const reply = utterance.match(/^\s*me refiero a\s+[«“"]([^»”"]+)[»”"]\s*[.!]?\s*$/i)?.[1] || utterance;
    const exact = entity.fields.filter(field => labels(field.label) === labels(reply));
    if (exact.length !== 1) continue;
    for (const [id, , match, required, excluded] of RULES) {
      const label = normalize(exact[0].label);
      if (match.test(label) && (!required || required.test(label)) && (!excluded || !excluded.test(label))) choices.set(id, exact[0].key);
    }
  }
  return choices;
}

function medicationResolution(answers) {
  let choice;
  for (const answer of answers) {
    const text = naturalText(answer);
    const matches = MEDICATION_TYPES.filter(([, pattern]) => pattern.test(text));
    if (matches.length === 1 && !labels(text.replace(matches[0][1], ' ').replace(FILLER, ' '))) choice = matches[0][0];
  }
  return choice;
}

function filterResolutions(answers, entity) {
  const choices = { medication: medicationResolution(answers) };
  const states = [['OPEN', /\b(pendientes?|abiert[oa]s?)\b/], ['CLOSED', /\b(cerrad[oa]s?|caducad[oa]s?|vencid[oa]s?)\b/], ['CANCELED', /\bcancelad[oa]s?\b/], ['MEDICAL_DISCHARGE', /\b(?:con|(?:dados?|dadas?) de) alta(?: medica)?\b/], ['NO_MEDICAL_DISCHARGE', /\bsin alta(?: medica)?\b/]];
  for (const answer of answers) {
    const text = naturalText(answer);
    const body = labels(text.replace(FILLER, ' '));
    const warehouses = Object.entries(WAREHOUSE_LABELS).filter(([code, label]) => labels(label.replace(FILLER, ' ')) === body || labels(code) === body);
    if (warehouses.length === 1) choices.warehouse = warehouses[0][0];
    if (/^(?:todos los almacenes|de todos lados|cualquier almacen|quita (?:el )?filtro (?:de )?almacen)[.!]?$/.test(text)) choices.warehouse = 'ALL';
    if (/^(?:todos los estados|quita (?:el )?filtro (?:de )?estado)[.!]?$/.test(text)) choices.state = 'ALL';
    if (/^(?:todos los tipos|todos los medicamentos|quita (?:el )?filtro (?:de )?tipo)[.!]?$/.test(text)) choices.medication = 'ALL';
    const matches = states.filter(([, pattern]) => pattern.test(text));
    if (matches.length === 1 && !labels(text.replace(matches[0][1], ' ').replace(FILLER, ' '))) {
      const allowed = entity.statusOptions?.some(option => option.value === matches[0][0]) || !entity.statusOptions && ['OPEN', 'CLOSED'].includes(matches[0][0]);
      if (allowed) choices.state = matches[0][0];
    }
  }
  return choices;
}

function rankTopics(text, catalog) {
  const search = searchValue(text);
  if (search) text = text.replace(search.fragment, ' ');
  const words = labels(text).split(' ').filter(word => word.length > 3 && !/^(paciente|pacientes|medico|medicos|nombre|fecha|fechas|quiero|necesito|reporte|datos|mes|pasado|columna|columnas)$/.test(word)).map(stem);
  const phraseIn = phrase => ` ${labels(text)} `.includes(` ${labels(phrase)} `);
  const sources = ['sap', 'vertical'].filter(source => new RegExp(`\\b${source}\\b`).test(labels(text)));
  return catalog.map(entity => {
    const phrases = TOPICS[entity.id] || [];
    const title = labels(entity.title);
    const titleWords = title.split(' ').map(stem);
    const phraseScore = Math.max(0, ...phrases.filter(phraseIn).map(phrase => 12 + phrase.split(' ').length * 4));
    const baseScore = phraseIn(entity.title) ? 100 : phraseScore + words.reduce((sum, word) => sum + (titleWords.includes(word) ? 2 : 0), 0);
    const score = baseScore && sources.length === 1 ? normalize(entity.source || 'SAP') === sources[0] ? baseScore + 100 : 0 : baseScore;
    return { entity, score };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
}

function fieldMatch(part, entity, hints, resolutions) {
  const text = labels(part);
  const exact = entity.fields.filter(field => labels(field.label) === text || labels(field.label) === labels(text.replace(FILLER, ' ')));
  if (exact.length === 1) return { fields: exact };
  let rule = RULES.find(([, request]) => request.test(text));
  if (!rule && /\bnombre\b/.test(text)) {
    const topic = normalize(entity.title);
    rule = RULES.find(([id]) => id === (/inventario|articulo|insumo|precio/.test(topic) ? 'product' : /directorio.*medico/.test(topic) ? 'doctor' : /proveedor/.test(topic) ? 'provider' : 'patient'));
  }
  if (!rule) {
    const tokens = text.replace(FILLER, ' ').split(/\s+/).filter(word => word.length > 2);
    const matching = tokens.length ? entity.fields.filter(field => tokens.every(token => labels(field.label).split(' ').map(stem).includes(stem(token)))) : [];
    return matching.length ? matching.length === 1 ? { fields: matching } : { ambiguous: matching } : { unknown: text, empty: !tokens.length };
  }
  const [id, , match, required, excluded] = rule;
  if (['patient', 'doctor', 'provider', 'customer'].includes(id)) {
    const remainder = text.replace(rule[1], ' ').replace(FILLER, ' ').replace(/\b(completo|completa|registrados?|tratante|solicitante|anestesiologo|razon|social)\b/g, ' ').trim();
    if (remainder) return { unknown: text, question: '¿Quieres incluir el nombre como un dato del reporte o buscar una persona? Para buscar, puedes decir «busca Juan Pérez».' };
  }
  let fields = entity.fields.filter(field => match.test(normalize(field.label)) && (!required || required.test(normalize(field.label))) && (!excluded || !excluded.test(normalize(field.label))));
  const hint = labels(hints);
  const explicit = fields.filter(field => hint.includes(labels(field.label)));
  if (explicit.length === 1) fields = explicit;
  const traits = id === 'doctor' ? ['tratante', 'solicitante', 'anestesiologo', 'registrados'] : id === 'cost' ? ['promedio', 'ultimo', 'unitario'] : id === 'price' ? ['publico', 'hospitalizacion', 'unitario'] : id === 'money' ? ['linea', 'factura', 'pedido', 'cobrado'] : [];
  const ownTraits = traits.filter(trait => new RegExp(`\\b${trait}\\b`).test(text));
  const resolved = resolutions?.get(id);
  if (fields.length > 1 && !ownTraits.length && resolved && fields.some(field => field.key === resolved)) fields = fields.filter(field => field.key === resolved);
  const selectedTraits = ownTraits.length ? ownTraits : traits.filter(trait => new RegExp(`\\b${trait}\\b`).test(hint));
  if (selectedTraits.length === 1) fields = fields.filter(field => normalize(field.label).includes(selectedTraits[0]));
  if (id === 'date' && fields.length > 1) {
    const primary = fields.filter(field => labels(field.label) === labels(entity.dateFieldLabel));
    if (primary.length === 1) fields = primary;
    else { const defaults = fields.filter(field => (entity.defaultFields || []).includes(field.key)); if (defaults.length === 1) fields = defaults; }
  }
  if (id === 'quantity' && fields.length > 1) {
    const primary = fields.filter(field => field.key === entity.summary?.quantityField || /^cantidad$|existencias|^cant\. (comprada|pedida|solicitada|recibida)/i.test(field.label));
    if (primary.length === 1) fields = primary;
  }
  if (id === 'warehouse' && fields.length > 1) { const names = fields.filter(field => /nombre/i.test(field.label)); if (names.length === 1) fields = names; }
  if (['cost', 'price', 'balance', 'money', 'subtotal', 'tax', 'discount', 'advance', 'profit'].includes(id) && fields.length > 1) {
    const amounts = fields.filter(field => field.type === 'money');
    if (amounts.length) fields = amounts;
  }
  return fields.length === 1 ? { fields, concept: id } : fields.length ? { ambiguous: fields, concept: id } : { missing: text, concept: id };
}

function searchValue(message) {
  const quoted = message.match(/\b(?:busca|buska|buscar|buskar|encuentra|que diga|que contenga|contengan|coincida con)\s+(?:a\s+)?["“]([^"”]+)["”]/i);
  if (quoted) return { value: quoted[1], fragment: quoted[0] };
  const plain = message.match(/\b(?:busca|buska|buscar|buskar|encuentra|que diga|que contenga)\s+(?:a\s+)?(.+?)(?=\s+y\s+(?:agrega|quita|quitale|quitame|sacale|pon|ponle|ponme|metele|incluye|saca|muestra)\b|[,;\n]|$)/i);
  return plain ? { value: plain[1].trim().replace(/[.!?]+$/, ''), fragment: plain[0] } : null;
}

function parseFilters(message, entity, hints = '', choices = {}) {
  const search = searchValue(message);
  let text = naturalText(search ? message.replace(search.fragment, '') : message);
  const filters = {}, issues = [];
  let options = [];
  let question = '', unsupported = '';
  const clearAll = /quita (?:todos )?(?:los )?filtros|sin filtros/.test(text);
  if (clearAll) Object.assign(filters, { almacen: 'ALL', estatusDoc: 'ALL', clasificacionMedica: 'ALL', busqueda: '' });
  if (/todos los almacenes|de todos lados|cualquier almacen|quita (?:el )?filtro (?:de )?(?:almacen|farmacia)/.test(text)) filters.almacen = 'ALL';
  if (/todos los estados|abiert[oa]s? y cerrad[oa]s?|quita (?:el )?filtro (?:de )?estado/.test(text)) filters.estatusDoc = 'ALL';
  if (/todos los (?:tipos|medicamentos)|quita (?:el )?filtro (?:de )?tipo/.test(text)) filters.clasificacionMedica = 'ALL';
  if (/quita (?:la )?busqueda|sin busqueda|todos los pacientes|todos los proveedores/.test(text)) filters.busqueda = '';
  const warehousePatterns = [
    ['FAR', /\bfarmacia(?: central)?\b/], ['ALG', /\balmacen general\b|\bbodega general\b/],
    ['QX', /\bquirofano general\b/], ['QXCR', /\bcarro rojo (?:de )?quirofano\b/],
    ['QXRCR', /\bcarro rojo (?:de )?recuperacion\b/], ['TERACR', /\bcarro rojo (?:de )?terapia(?: intensiva)?\b/],
    ['IMAGCR', /\bcarro rojo (?:de )?imagenologia\b/], ['CUNACR', /\bcarro rojo (?:de )?cuneros\b/],
  ];
  const warehouses = new Set();
  for (const [code, pattern] of warehousePatterns) if (pattern.test(text)) { warehouses.add(code); text = text.replace(pattern, ' '); }
  for (const code of Object.keys(WAREHOUSE_LABELS).filter(code => code !== 'ALL')) {
    const pattern = new RegExp(`\\b${code}\\b`, 'i');
    if (pattern.test(text)) { warehouses.add(code); text = text.replace(pattern, ' '); }
  }
  const hintText = naturalText(hints);
  const hintCodes = new Set(warehousePatterns.filter(([, pattern]) => pattern.test(hintText)).map(([code]) => code));
  for (const code of Object.keys(WAREHOUSE_LABELS).filter(code => code !== 'ALL')) if (new RegExp(`\\b${code}\\b`, 'i').test(hintText)) hintCodes.add(code);
  if (filters.almacen !== 'ALL' && warehouses.size === 1) filters.almacen = [...warehouses][0];
  if (filters.almacen !== 'ALL' && warehouses.size > 1) {
    const chosen = choices.warehouse || (hintCodes.size === 1 ? [...hintCodes][0] : null);
    if (chosen && (chosen === 'ALL' || warehouses.has(chosen))) filters.almacen = chosen;
    else { question = '¿De qué almacén necesitas el reporte? Puedo consultar uno a la vez.'; options.push(...[...warehouses].map(code => ({ label: WAREHOUSE_LABELS[code], message: `Usa ${WAREHOUSE_LABELS[code]}.` }))); }
  }
  if (/\b(?:del?|en|solo)\s+(?:el\s+)?(?:almacen|bodega|quirofano)\b/.test(text) && !warehouses.size && !clearAll) {
    const chosen = choices.warehouse || (hintCodes.size === 1 ? [...hintCodes][0] : /\bquirofano\b/.test(text) && /^(?:el )?general[.!]?$/i.test(hintText) ? 'QX' : null);
    if (chosen) { filters.almacen = chosen; text = text.replace(/\b(?:del?|en|solo)\s+(?:el\s+)?(?:almacen|bodega|quirofano)\b/g, ' '); }
    else { question = '¿Qué almacén quieres consultar?'; options.push(...(text.includes('quirofano') ? ['QX', 'QXCR', 'QXRCR'] : ['FAR', 'ALG', 'QX']).map(code => ({ label: WAREHOUSE_LABELS[code], message: `Usa ${WAREHOUSE_LABELS[code]}.` }))); }
  }
  if (question) issues.push({ question, options });
  question = ''; options = [];
  const open = /\b(pendientes?|abiert[oa]s?)\b/, closed = /\b(cerrad[oa]s?|caducad[oa]s?|vencid[oa]s?)\b/;
  if (filters.estatusDoc !== 'ALL' && open.test(text)) filters.estatusDoc = 'OPEN';
  if (filters.estatusDoc !== 'ALL' && closed.test(text)) filters.estatusDoc = 'CLOSED';
  if (open.test(text) && closed.test(text) && filters.estatusDoc !== 'ALL') question = '¿Quieres documentos abiertos, cerrados o todos?';
  text = text.replace(open, ' ').replace(closed, ' ');
  const canceled = /\bcancelad[oa]s?\b/;
  const discharged = /\b(?:con|(?:dados?|dadas?) de) alta(?: medica)?\b/;
  const notDischarged = /\bsin alta(?: medica)?\b/;
  if (canceled.test(text) || discharged.test(text) || notDischarged.test(text)) {
    const state = canceled.test(text) ? 'CANCELED' : notDischarged.test(text) ? 'NO_MEDICAL_DISCHARGE' : 'MEDICAL_DISCHARGE';
    if (!entity.statusOptions?.some(option => option.value === state)) unsupported = 'Este tema no permite aplicar ese estado. Puedes elegir otro tema o revisar los estados disponibles.';
    else if ((filters.estatusDoc && filters.estatusDoc !== 'ALL' && filters.estatusDoc !== state) || (canceled.test(text) && (discharged.test(text) || notDischarged.test(text))) || (discharged.test(text) && notDischarged.test(text))) question = '¿Qué filtro quieres usar: cuentas abiertas, cerradas, canceladas, con alta médica o sin alta médica? Puedo aplicar uno de estos filtros a la vez.';
    else filters.estatusDoc = state;
    text = text.replace(canceled, ' ').replace(discharged, ' ').replace(notDischarged, ' ');
  }
  if (/^¿Qué filtro quieres usar: cuentas|^¿Quieres documentos abiertos/.test(question)) {
    const hintStates = [open.test(hintText) && 'OPEN', closed.test(hintText) && 'CLOSED', canceled.test(hintText) && 'CANCELED', discharged.test(hintText) && 'MEDICAL_DISCHARGE', notDischarged.test(hintText) && 'NO_MEDICAL_DISCHARGE'].filter(Boolean);
    if (choices.state || hintStates.length === 1) { filters.estatusDoc = choices.state || hintStates[0]; question = ''; }
    else options.push(...(entity.statusOptions || [{ value: 'OPEN', label: 'Abiertos' }, { value: 'CLOSED', label: 'Cerrados' }]).filter(option => option.value !== 'ALL').map(option => ({ label: option.label, message: `Solo ${option.label.toLowerCase()}.` })));
  }
  if (question) issues.push({ question, options });
  question = ''; options = [];
  const selectedTypes = MEDICATION_TYPES.filter(([, pattern]) => pattern.test(text));
  if (filters.clasificacionMedica !== 'ALL' && selectedTypes.length === 1) filters.clasificacionMedica = selectedTypes[0][0];
  if (selectedTypes.length > 1) {
    if (choices.medication) filters.clasificacionMedica = choices.medication;
    else {
      question = '¿Qué tipo de medicamento quieres consultar? Puedo aplicar uno a la vez.';
      options.splice(0, options.length, ...selectedTypes.map(([, , label]) => ({ label: `Sólo ${label}`, message: `Sólo ${label}.` })));
    }
  }
  if (question) issues.push({ question, options });
  for (const [, pattern] of MEDICATION_TYPES) text = text.replace(pattern, ' ');
  if (search) filters.busqueda = search.value;
  if (/\b(pagad[oa]s?|sin pagar|falta pagar|faltan pagar)\b/.test(text) && !['accounts_receivable', 'accounts_payable', 'incoming_payments', 'outgoing_payments'].includes(entity.id)) unsupported = 'El estado abierto o cerrado no indica si una factura está pagada. Este tema no permite aplicar ese filtro de pago.';
  if (/\b(joven(?:es)?|mayores?|menores?|adultos?|ninos?|mujeres|hombres)\b|\bsolo (?:los? |las? )?(?:del? |de la )(?:medico|paciente|proveedor)\s+[^,;.]+/.test(text)) unsupported = 'Ese tema no permite aplicar ese filtro a personas. Para encontrar un nombre puedes pedir «busca Juan Pérez»; la búsqueda revisa los textos del reporte.';
  if (/mayor que|menor que|mas de \d|menos de \d|ordena|ordenar|agrupa|agrupar|combina|cruza|sumar|\bsuma\b|promedio (?:por|de todos)|sin (?:stock|existencias)|con (?:stock|existencias)/.test(text)) unsupported = 'Ese cálculo, orden o condición todavía no está disponible en este tema. Puedo preparar el detalle con los datos y filtros disponibles.';
  for (const key of ['almacen', 'estatusDoc', 'clasificacionMedica']) if (filters[key] && filters[key] !== 'ALL' && !supportsFilter(entity, key)) unsupported = `El tema «${entity.title}» no permite filtrar por ${key === 'almacen' ? 'almacén' : key === 'estatusDoc' ? 'estado' : 'tipo de medicamento'}. Puedes elegir otro tema.`;
  text = text.replace(/quita (?:todos )?(?:los )?filtros|sin filtros|todos los almacenes|de todos lados|cualquier almacen|todos los estados|todos los tipos|todos los medicamentos|quita (?:el )?filtro (?:de )?\w+|quita (?:la )?busqueda|sin busqueda|todos los pacientes|todos los proveedores/g, ' ');
  const active = issues.at(-1) || { question: '', options: [] };
  return { filters, text, ...active, unsupported, recognized: Object.keys(filters).length > 0 };
}

function removeDates(text) {
  return text.replace(/\b(?:del?|entre|desde)\s+(?:el\s+)?(?:\d|primero|uno|quince).*/g, fragment => {
    const columns = fragment.search(/\b(con|sin|agrega|incluye|muestra|quita|solo|pacientes?|medicos?|nombre|productos?|insumos?|folios?|costos?|precios?|cantidad|existencias)\b/);
    return columns < 0 ? ' ' : ` ${fragment.slice(columns)}`;
  })
    .replace(/\b(?:primera|segunda) quincena(?: de)? (?:\w+)(?: de \d{4})?/g, ' ')
    .replace(/\b(?:el|del?|en|durante|de la)?\s*(?:este mes|mes pasado|mes anterior|esta semana|semana pasada|semana anterior|hoy|ayer|anteayer|este ano|ano actual)\b/g, ' ')
    .replace(/\b(?:de|en|durante)?\s*(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?: de)?(?: \d{4})?\b/g, ' ')
    .replace(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}(?:\/\d{4})?\b/g, ' ');
}

function splitColumns(body) {
  const chunks = body.split(/[,;+]|\s+y\s+|\s+mas\s+/).map(part => part.trim()).filter(Boolean);
  return chunks.flatMap(chunk => {
    const parts = [], pattern = /\s+(?=(?:pacientes?|medicos?|fechas?|folios?|costos?|precios?|cantidad|existencias?|saldo|total|edad|estados?|estatus|productos?|insumos?|medicamentos?|nombre|ovs?|orden(?:es)? de ventas?|cuanto queda|cuantos quedan|cuanto hay)\b)/g;
    let start = 0, match;
    while ((match = pattern.exec(chunk))) {
      const prefix = chunk.slice(start, match.index);
      const next = chunk.slice(match.index).trim();
      if (/\b(del?|id)\s*$/.test(prefix) || /\b(nombre|numero|codigo|folio)\s*$/.test(prefix) && /^(pacientes?|medicos?|productos?|insumos?|medicamentos?)\b/.test(next)) continue;
      parts.push(chunk.slice(start, match.index)); start = match.index + match[0].length;
    }
    parts.push(chunk.slice(start)); return parts;
  });
}

function interpretRequest({ message, pending, context, catalog, today, forcedEntity }) {
  let previous = cleanPending(pending);
  const latestSelection = topicSelection(message, catalog);
  const latestRanking = rankTopics(naturalText(message), catalog);
  if (previous && !latestSelection && latestRanking[0]?.score >= 16 && !/\b(agrega|incluye|quita|cambia|sustituye)\b/.test(naturalText(message))) {
    const earlierTopics = rankTopics(naturalText(previous.request), catalog);
    if (!earlierTopics.some(item => item.entity.id === latestRanking[0].entity.id)) previous = null;
  }
  const utterances = previous ? [previous.request, ...previous.answers, message] : [message];
  const texts = utterances.map(naturalText);
  const topicTexts = utterances.map(utterance => {
    const search = searchValue(utterance);
    return naturalText(search ? utterance.replace(search.fragment, ' ') : utterance);
  });
  const latest = texts.at(-1);
  const allText = texts.join('. ');
  const latestTopic = topicTexts.at(-1);
  const allTopics = topicTexts.join('. ');
  const ranking = rankTopics(allTopics, catalog);
  const replyRanking = rankTopics(latestTopic, catalog);
  // Topic buttons are conversation answers, not column requests. Keep the
  // last exact authorized selection when a later answer supplies the dates.
  const selections = utterances.map(utterance => {
    const selection = topicSelection(utterance, catalog);
    if (selection) return selection;
    const source = utterance.trim().match(/^(?:de )?(sap|vertical)[.!]?$/i)?.[1];
    if (source && ORDER_REQUEST.test(allTopics)) return { matches: catalog.filter(item => ORDER_SUMMARIES.includes(item.id) && normalize(item.source || 'SAP') === normalize(source)), remainder: '' };
    return null;
  });
  const selectedTopic = selections.filter(Boolean).at(-1);
  const chosenTitle = selectedTopic?.matches.length === 1 ? selectedTopic.matches[0].title : null;
  let entity = forcedEntity || (chosenTitle ? selectedTopic.matches[0] : null);
  const hasAction = /\b(agrega|incluye|quita|sin|solo|cambia|sustituye|deja)\b/.test(latest);
  const topicAtStart = replyRanking.length && [replyRanking[0].entity.title, ...(TOPICS[replyRanking[0].entity.id] || [])].some(phrase => labels(latest) === labels(phrase) || labels(latest).startsWith(`${labels(phrase)} `));
  const switchTopic = context && replyRanking.length && replyRanking[0].entity.id !== context.entity && replyRanking[0].score >= 16 && (topicAtStart || /\b(ahora|mejor|quiero|necesito|dame|pasame|otro|otra)\b/.test(latest)) && !/\b(agrega|incluye|quita|cambia|sustituye)\b/.test(latest);
  if (!entity && context && !switchTopic) entity = catalog.find(item => item.id === context.entity);
  const ranked = switchTopic ? replyRanking : ranking;
  if (!entity && ranked.length && (ranked.length === 1 || ranked[0].score > ranked[1].score)) entity = ranked[0].entity;
  const nextPending = { request: previous?.request || message, answers: previous ? [...previous.answers, message].slice(-4) : [] };
  if (selectedTopic && selectedTopic.matches.length !== 1) {
    return { proposal: { status: selectedTopic.matches.length ? 'clarification' : 'unsupported', message: selectedTopic.matches.length ? '¿Cuál de estos temas necesitas?' : 'El tema que elegiste no está disponible para tu usuario. Elige uno de los temas disponibles o solicita acceso al área de Sistemas.', plan: null, choices: selectedTopic.matches.map(item => item.id) }, pending: nextPending, normalizedText: allText, confident: true, hasUnresolved: true };
  }
  const replySources = ['sap', 'vertical'].filter(source => new RegExp(`\\b${source}\\b`).test(latestTopic));
  const sources = replySources.length === 1 ? replySources : ['sap', 'vertical'].filter(source => new RegExp(`\\b${source}\\b`).test(allTopics));
  const wantsBoth = BOTH_SOURCES.test(latestTopic) || !replySources.length && BOTH_SOURCES.test(allTopics);
  // "OV" exists in both catalogues. Ask for the authorized source before
  // interpreting it as a column or reusing an unrelated report's context.
  const genericOrders = ORDER_REQUEST.test(allTopics) && !/\b(?:detalle|lineas|ordenes? de servicios|ov de servicios)\b/.test(allTopics);
  const columnChange = /\b(?:agrega|incluye|quita|sin|cambia|sustituye)\b/.test(latestTopic);
  const orderChoices = catalog.filter(item => ORDER_SUMMARIES.includes(item.id));
  if (!chosenTitle && genericOrders && context && !ORDER_TOPICS.includes(context.entity) && columnChange) {
    return { proposal: { status: 'unsupported', message: 'Este tema no reúne las órdenes de venta con los datos del reporte actual. Puedes iniciar un reporte nuevo de órdenes de venta o conservar el tema actual.', plan: null, choices: [] }, pending: nextPending, normalizedText: allText, confident: true, hasUnresolved: true };
  }
  if (!chosenTitle && genericOrders && (wantsBoth && orderChoices.length < 2 || !orderChoices.length)) {
    return { proposal: { status: 'unsupported', message: wantsBoth ? 'Para preparar las órdenes de venta de ambos orígenes necesitas acceso a los dos reportes. Solicita acceso al área de Sistemas o elige un origen disponible.' : 'El resumen de todas las órdenes de venta no está disponible para tu usuario. Solicita acceso al área de Sistemas o elige un tema de detalle disponible.', plan: null, choices: orderChoices.map(item => item.id) }, pending: nextPending, normalizedText: allText, confident: true, hasUnresolved: true };
  }
  if (!chosenTitle && genericOrders && (wantsBoth || sources.length !== 1 && (!context || previous || !ORDER_TOPICS.includes(context.entity))) && orderChoices.length > 1) {
    return { proposal: { status: 'clarification', message: wantsBoth ? 'Puedo preparar las órdenes de venta de SAP y de Vertical por separado. ¿Cuál quieres generar primero?' : '¿Las órdenes de venta que necesitas son de SAP o de Vertical?', plan: null, choices: orderChoices.map(item => item.id) }, pending: nextPending, normalizedText: allText, confident: true, hasUnresolved: true };
  }
  if (!chosenTitle && genericOrders && sources.length === 1 && !orderChoices.some(item => normalize(item.source || 'SAP') === sources[0])) {
    return { proposal: { status: 'unsupported', message: 'Las órdenes de venta de ese origen no están disponibles para tu usuario. Solicita acceso al área de Sistemas o elige otro tema.', plan: null, choices: [] }, pending: nextPending, normalizedText: allText, confident: true, hasUnresolved: true };
  }
  if (!chosenTitle && genericOrders && sources.length === 1) entity = orderChoices.find(item => normalize(item.source || 'SAP') === sources[0]);
  else if (!chosenTitle && genericOrders && orderChoices.length === 1) entity = orderChoices[0];
  if (!entity) return { proposal: { status: 'clarification', message: ranked.length ? '¿Cuál de estos temas necesitas?' : '¿Qué quieres consultar: cirugías, inventario, citas, facturas u otro tema?', plan: null, choices: ranked.slice(0, 4).map(item => item.entity.id) }, pending: nextPending, normalizedText: allText, confident: Boolean(ranked.length) };
  const sameTopic = context?.entity === entity.id;
  let selected = sameTopic ? [...context.selectedFields] : [];
  const filters = { ...DEFAULT_FILTERS, ...(sameTopic ? context.filters : {}) };
  const missing = new Map(), questions = new Map(), changes = [], requestedFilters = {};
  let explicitFields = false, dateInput = { range: null, requested: false, error: '' }, unsupported = '';
  const hints = previous ? latest : allText;
  const toProcess = switchTopic ? [message] : utterances;
  const resolutions = columnResolutions(toProcess, entity);
  const filterChoices = filterResolutions(previous ? [...previous.answers, message] : [], entity);
  for (const utterance of toProcess) {
    // A topic choice answers the earlier question; its title is not a new
    // request for columns or filters, even when replaying pending answers.
    // Any additional request after that choice still needs interpretation.
    const choice = topicSelection(utterance, catalog);
    const input = choice ? choice.remainder : utterance;
    if (!input.trim()) continue;
    if (ORDER_TOPICS.includes(entity.id) && /^(?:ambas|ambos|las dos|los dos|(?:de )?sap|(?:de )?vertical)[.!]?$/i.test(utterance.trim())) continue;
    const parsed = parseFilters(input, entity, hints, filterChoices);
    Object.assign(filters, parsed.filters);
    Object.assign(requestedFilters, parsed.filters);
    if (parsed.question) questions.set(`filter:${parsed.question}`, { message: parsed.question, options: parsed.options });
    if (parsed.unsupported) unsupported = parsed.unsupported;
    if (parsed.recognized) changes.push('filters');
    const dates = interpretDates(input, today, filters);
    if (dates.range || dates.error || dates.requested) dateInput = dates;
    if (dates.range) { Object.assign(filters, dates.range); changes.push('dates'); }
    let text = removeDates(parsed.text);
    if (genericOrders && ORDER_TOPICS.includes(entity.id)) text = text.replace(/\b(?:de )?(?:sap|vertical)\b/g, ' ');
    if (ORDER_SUMMARIES.includes(entity.id) && /\bresumen\s+por\s+orden\b/.test(text)) {
      text = text.replace(/\bresumen\s+por\s+orden\b/g, ' ');
      changes.push('presentation');
    }
    if (dates.requested && sameTopic && !/\b(agrega|incluye|muestra|quita|con|sin)\b/.test(parsed.text)) text = '';
    const firstAction = text.search(ACTIONS);
    for (const phrase of [...(TOPICS[entity.id] || []), entity.title].sort((a, b) => b.length - a.length)) {
      const pattern = new RegExp(`\\b${labels(phrase).replace(/ /g, '[\\s·:—–-]+')}\\b`, 'g');
      text = text.replace(pattern, (match, offset) => firstAction < 0 || offset < firstAction ? ' ' : match);
    }
    // A change from A to B is two independent column operations.
    text = text.replace(/\b(?:cambia|sustituye)\s+(.+?)\s+por\s+(.+)/g, 'quita $1 agrega $2');
    const markers = [...text.matchAll(ACTIONS)];
    let segments = markers.map((match, index) => ({ mode: match[1], body: text.slice(match.index + match[0].length, markers[index + 1]?.index ?? text.length) }));
    const prefix = markers.length ? text.slice(0, markers[0].index) : '';
    if (prefix && RULES.some(([, request]) => request.test(prefix))) segments.unshift({ mode: 'agrega', body: prefix });
    if (!markers.length && (!sameTopic || previous || RULES.some(([, request]) => request.test(text)))) segments = [{ mode: 'agrega', body: text }];
    for (const segment of segments) {
      const parts = splitColumns(segment.body).map(part => part.replace(/[.!?]+$/, '').trim()).filter(Boolean);
      let replacing = segment.mode === 'solo' || segment.mode === 'deja';
      for (const part of parts) {
        let field = fieldMatch(part, entity, hints, resolutions);
        if ((!field.fields && !field.ambiguous || !sameTopic && segment.mode === 'muestra') && [entity.title, ...(TOPICS[entity.id] || [])].some(topic => labels(part.replace(FILLER, ' ')) === labels(naturalText(topic).replace(FILLER, ' ')))) continue;
        if (field.empty) continue;
        const removing = segment.mode === 'quita' || segment.mode === 'sin';
        const key = field.concept || labels(part.replace(FILLER, ' '));
        if (removing && field.ambiguous) {
          const included = field.ambiguous.filter(column => selected.includes(column.key));
          if (included.length === 1) field = { ...field, ambiguous: undefined, fields: included };
          else if (!included.length) { questions.delete(`column:${key}`); missing.delete(key); changes.push('columns'); continue; }
        }
        if (field.missing || field.unknown) {
          if (removing) { missing.delete(key); questions.delete(`column:${key}`); }
          else {
            missing.set(key, { text: field.missing || field.unknown, known: Boolean(field.missing), concept: field.concept });
            if (field.question) questions.set(`column:${key}`, { message: field.question, options: [] });
          }
          continue;
        }
        if (field.ambiguous) {
          questions.set(`column:${key}`, { message: `Cuando dices «${part.trim()}», ¿qué dato necesitas?`, options: field.ambiguous.slice(0, 4).map(column => ({ label: column.label, message: `Me refiero a «${column.label}».` })) });
          continue;
        }
        if (replacing) {
          selected = []; replacing = false; missing.clear();
          for (const questionKey of questions.keys()) if (questionKey.startsWith('column:')) questions.delete(questionKey);
        }
        questions.delete(`column:${key}`);
        explicitFields = true; changes.push('columns');
        for (const column of field.fields) {
          if (removing) selected = selected.filter(key => key !== column.key);
          else if (!selected.includes(column.key)) selected.push(column.key);
        }
      }
    }
  }
  const knownFields = selected.length ? selected : !explicitFields ? entity.defaultFields || entity.fields.slice(0, 6).map(field => field.key) : [];
  const draftFields = knownFields.length ? knownFields : context?.selectedFields?.filter(key => entity.fields.some(field => field.key === key)) || [];
  const plan = draftFields.length ? { entity: entity.id, selectedFields: draftFields, filters } : null;
  const question = questions.values().next().value;
  let proposal, options = question?.options || [];
  if (unsupported) proposal = { status: 'unsupported', message: unsupported, plan: null, choices: [] };
  else if (dateInput.error) proposal = { status: 'clarification', message: dateInput.error, plan, choices: [] };
  else if (sameTopic && dateInput.requested && !dateInput.range && !explicitFields) proposal = { status: 'clarification', message: 'No pude identificar el nuevo período. ¿Desde qué día y hasta qué día necesitas el reporte?', plan, choices: [] };
  else if (question) proposal = { status: 'clarification', message: question.message, plan, choices: [] };
  else if (missing.size) {
    const unknown = [...missing.values()];
    const names = unknown.map(item => `«${item.text.trim()}»`).join(', ');
    const allKnown = unknown.every(item => item.known);
    proposal = { status: allKnown ? 'unsupported' : 'clarification', message: allKnown ? `Este tema no reúne todos los datos que pediste. No tiene ${names}. Puedes pedirlo sin esos datos o elegir otro tema.` : `No pude identificar ${names}. Para corregir ese dato, elige una columna disponible o abre «Elegir filtros y columnas».`, plan, choices: [] };
    if (allKnown) options = unknown.slice(0, 3).map(item => { const name = CONCEPT_NAMES[item.concept] || labels(item.text.replace(FILLER, ' ')); return { label: `Continuar sin ${name}`, message: `Sin ${name}.` }; });
    else {
      const unresolved = unknown.find(item => !item.known);
      options = entity.fields.filter(field => !(selected || []).includes(field.key)).slice(0, 4).map(column => ({ label: `Usar ${column.label}`, message: `Cambia «${unresolved.text.trim()}» por «${column.label}».` }));
    }
  } else if (!knownFields.length) proposal = { status: 'clarification', message: 'El reporte necesita al menos una columna. ¿Qué dato quieres conservar?', plan, choices: [] };
  else if (sameTopic && !changes.length && hasAction) proposal = { status: 'clarification', message: dateInput.requested ? 'No pude identificar el nuevo período. ¿Desde qué día y hasta qué día necesitas el reporte?' : '¿Qué cambio quieres aplicar al reporte?', plan, choices: [] };
  else proposal = { status: 'ready', message: `Preparé «${entity.title}».`, plan: { entity: entity.id, selectedFields: knownFields, filters }, choices: [] };
  return { proposal, pending: nextPending, options: options.slice(0, 4), normalizedText: allText, dateInput, entity, explicitFields, requestedFilters, changes, confident: Boolean(sameTopic || chosenTitle || ranked[0]?.score >= 16 || forcedEntity), hasUnresolved: Boolean(questions.size || missing.size || unsupported || !knownFields.length) };
}

module.exports = { interpretRequest, cleanPending, rankTopics, fieldMatch, WAREHOUSE_LABELS };
