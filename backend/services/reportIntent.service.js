'use strict';

const { normalize, naturalText, WAREHOUSE_LABELS, topicPhrases, entitySources } = require('./reportVocabulary.service');
const { interpretDates } = require('./reportLanguage.service');
const { validateAnalysis, getAnalysisCapabilities } = require('./reportAnalysis.service');
const DEFAULT_FILTERS = { fechaDesde: '', fechaHasta: '', almacen: 'ALL', estatusDoc: 'ALL', clasificacionMedica: 'ALL', busqueda: '' };
const supportsFilter = (entity, key) => Array.isArray(entity.filters) ? entity.filters.includes(key) : entity.fields.some(field => ({ almacen: ['WhsCode', 'Filler', 'ToWhsCode'], estatusDoc: ['DocStatus', 'Status'], clasificacionMedica: ['MedicalClassification'] }[key] || []).includes(field.key));
const labels = value => normalize(value).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
// Units distinguish financial columns whose wording is otherwise identical.
const fieldLabel = value => normalize(value).replace(/[^a-z0-9% ]/g, ' ').replace(/\s+/g, ' ').trim();
const fieldReply = value => value.match(/^\s*me refiero a\s+[«“"]([^»”"]+)[»”"]\s*[.!]?\s*$/i)?.[1] || value;
const matchesFieldLabel = (field, value) => [field.label, ...(field.aliases || [])].some(label => fieldLabel(label) === fieldLabel(value));
const stem = word => word.replace(/s$/, '');
const FILLER = /\b(el|la|los|las|un|una|del|de|que|se|me|te|lo|le|en|a|y|por|para|con|sin|es|sea|este|esta|esten|estan|son|van|tenga|tengan|tiene|tienen|necesito|quiero|dame|dime|pasame|sacame|hazme|refiero|reporte|reportes|listado|lista|informacion|datos|dato|columna|columnas|salga|salgan|venga|vengan|nombre|nombres|ver|ahora|mejor|tambien|solo|mismo|agrega|incluye|muestra|quita|queda|quede|deja|favor|porfa|gracias|usa|ponlo|todos|todas|filtro|filtros|cualquier)\b/g;
const ACTIONS = /\b(agrega|incluye|muestra|quita|sin|solo|deja|con|cambia|sustituye)\b/g;
const ORDER_TOPICS = ['sales_order_summary', 'vertical_sales_orders', 'sales_orders', 'vertical_service_orders'];
const ORDER_SUMMARIES = ['sales_order_summary', 'vertical_sales_orders'];
const ORDER_REQUEST = /\b(?:ovs?|orden(?:es)? de ventas?)\b/;
const BOTH_SOURCES = /\b(?:ambas|ambos|las dos|los dos|sap y vertical|vertical y sap)\b/;
const MEDICATION_TYPES = [['ANTI', /\bantibioticos?\b/, 'antibióticos'], ['CON', /\bcontrolad[oa]s?\b/, 'controlados'], ['REFRI', /\brefrigerad[oa]s?\b|\brefrigeracion\b|\bvan (?:en|al) frio\b/, 'refrigerados']];
const FINANCIAL_STATES = [['UNBILLED', /\b(?:sin (?:facturas?(?: vigentes)?|facturar)|no facturad[oa]s?)\b/],
  ['BILLED', /\b(?:ya facturad[oa]s?|con facturas?(?: vigentes)?|facturad[oa]s?)\b/],
  ['UNPAID', /\b(?:sin pagar|no (?:estan )?pagad[oa]s?|sin cobros?(?: recibidos(?: registrados)?)?|falta pagar|faltan pagar)\b/],
  ['COLLECTED', /\b(?:ya (?:las |los )?pagaron|pagad[oa]s?(?: al hospital| mediante cobros registrados)?|cobrad[oa]s?|facturas cubiertas por cobros sap)\b/],
  ['PARTIAL', /\b(?:con )?cobro parcial(?: registrado)?\b/]];
const CONCEPT_NAMES = { patient: 'paciente', patientId: 'número de paciente', doctor: 'médico', doctorId: 'número de médico', phone: 'teléfono', mail: 'correo', rfc: 'RFC', birth: 'fecha de nacimiento', gender: 'sexo', expiry: 'caducidad', discharge: 'fecha de alta', closure: 'fecha de cierre', medicalDischarge: 'alta médica', start: 'ingreso', end: 'fecha de salida', procedure: 'procedimiento', date: 'fecha', quantity: 'cantidad', cost: 'costo', price: 'precio', priceList: 'lista de precios', priceListId: 'número de lista de precios', agreement: 'convenio', agreementId: 'código de convenio', payer: 'pagador', subtotal: 'subtotal', tax: 'impuesto', balance: 'saldo', discount: 'descuento', advance: 'anticipo', profit: 'utilidad', money: 'total', provider: 'proveedor', customer: 'cliente', product: 'producto', lot: 'lote', warehouse: 'almacén', specialty: 'especialidad', folio: 'folio', state: 'estado', room: 'habitación', age: 'edad', diagnosis: 'diagnóstico', currency: 'moneda', comments: 'comentarios', order: 'número de orden' };
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
  ['balance', /\bsaldos?\b|cuanto debe|cuanto deben/, /saldo/],
  ['deductible', /\bdeducibles?\b/, /deducible/],
  ['copay', /\bcopagos?\b/, /copago/],
  ['coinsurance', /\bcoaseguros?\b/, /coaseguro/],
  ['agreementId', /\b(?:numero|codigo|id)(?: de| del)?\s+(?:convenio|acuerdo comercial)\b/, /convenio|acuerdo comercial/, /numero|codigo/],
  ['agreement', /\b(?:convenios?|acuerdos? comerciales?)\b/, /convenio|acuerdo comercial/, null, /numero|codigo|estado|estatus|descuento|importe|total/],
  ['priceListId', /\b(?:numero|codigo|id)(?: de| del)?\s+(?:lista de precios|tabulador)\b/, /lista.*precio|tabulador/, /numero|codigo/],
  ['priceList', /\b(?:listas? de precios|tabuladores?)\b/, /lista.*precio|tabulador/],
  ['payer', /\b(?:pagadores?|aseguradoras?|socios? (?:de negocio|comerciales?))\b/, /pagador|aseguradora|razon social|cliente|socio/, null, /numero|codigo|saldo|rfc|lista|moneda|telefono|correo/],
  ['doctor', /\b(medico|medicos|tratante|solicitante|anestesiologo)\b/, /medico|anestesiologo/, null, /numero|codigo|folio|tipo|cedula/],
  ['patient', /\bpacientes?\b|quien se opero/, /paciente/, null, /numero|codigo|folio|tipo/],
  ['procedure', /\b(procedimientos?|operacion realizada|que le hicieron)\b/, /procedimiento/],
  ['date', /\b(fechas?|dia)\b/, /fecha|inicio|entrada.*estancia|creacion.*orden/, null, /vencimiento|caducidad|cierre|alta|modificado/],
  ['quantity', /\b(cantidad|cantidades|existencias?|stock|piezas?|unidades)\b|cuanto queda|cuantos quedan|cuanto hay/, /cantidad|cant |existencia|unidades/, null, /pendiente|devuelta/],
  ['cost', /\b(costos?|promedio)\b/, /costo/],
  ['price', /\b(precios?)\b|cuanto cuesta|en cuanto esta/, /precio/, null, /lista de precios|numero/],
  ['subtotal', /\bsubtotal\b/, /subtotal/],
  ['tax', /\b(iva|impuesto|impuestos)\b/, /iva|impuesto/],
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
  ['state', /\b(estados?|estatus)\b/, /estado|estatus/],
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
  const matches = catalog.filter(entity => topicPhrases(entity).some(phrase => labels(phrase) === title || labels(naturalText(phrase)) === labels(naturalText(choice[1]))));
  return { matches, remainder: choice[2].replace(/^[\s.!,:;]+/, '') };
}

function columnResolutions(utterances, entity) {
  const choices = new Map();
  for (const utterance of utterances) {
    const reply = fieldReply(utterance);
    const exact = entity.fields.filter(field => matchesFieldLabel(field, reply));
    if (exact.length !== 1) continue;
    // Schema fields without a vocabulary rule still answer their own earlier
    // ambiguity. Only an exact authorized candidate can close that question.
    const fieldKey = `field:${exact[0].key}`;
    choices.delete(fieldKey);
    choices.set(fieldKey, exact[0].key);
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
    const exactStates = (entity.statusOptions || []).filter(option => labels(naturalText(option.label).replace(FILLER, ' ')) === body);
    if (exactStates.length === 1) choices.state = exactStates[0].value;
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
  const subject = labels(text.split(/\b(?:con|incluye|agrega|que salga|que salgan)\b/)[0]);
  const subjectIn = phrase => ` ${subject} `.includes(` ${labels(phrase)} `);
  const requestedBody = text.match(/\b(?:con|incluye|agrega|que salga|que salgan)\b\s+(.+)/)?.[1];
  const requestedColumns = requestedBody ? splitColumns(removeDates(requestedBody)) : [];
  const sources = ['sap', 'vertical'].filter(source => new RegExp(`\\b${source}\\b`).test(labels(text)));
  return catalog.map(entity => {
    const phrases = topicPhrases(entity).filter(phrase => phrase !== entity.title);
    const title = labels(entity.title);
    const titleWords = title.split(' ').map(stem);
    const phraseScore = Math.max(0, ...phrases.filter(phraseIn).map(phrase => 12 + phrase.split(' ').length * 4 + (subjectIn(phrase) ? 20 : 0)));
    let baseScore = phraseIn(entity.title) ? 100 : phraseScore + words.reduce((sum, word) => sum + (titleWords.includes(word) ? 2 : 0), 0);
    if (baseScore) {
      // A matching topic name must not win by omitting requested columns.
      // Prefer its richer authorized resource only when those columns exist.
      const richer = requestedColumns.length && catalog.some(other => other.resourceMetadata && other.id !== entity.id
        && entitySources(other).join(',') === entitySources(entity).join(',') && topicPhrases(other).some(subjectIn)
        && requestedColumns.every(part => { const found = fieldMatch(part, other, text); return !found.missing && !found.unknown; }));
      if (richer) baseScore -= requestedColumns.filter(part => { const found=fieldMatch(part,entity,text);return found.missing || found.unknown; }).length * 35;
      if (entity.resourceMetadata) baseScore -= 1;
      baseScore = Math.max(0, baseScore);
    }
    const availableSources = entitySources(entity);
    const enrichment = sources.length === 1 && new RegExp(`\\b(?:con|combina|cruza|incluye|agrega)\\b[^.!?;]*\\b${sources[0]}\\b`).test(labels(text));
    const matchesSources = sources.every(source => availableSources.includes(source)) && (sources.length !== 1 || availableSources.length === 1 || entity.assistantOnly && enrichment);
    const score = baseScore && sources.length ? matchesSources ? baseScore + 100 : 0 : baseScore;
    return { entity, score };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
}

function fieldMatch(part, entity, hints, resolutions, contextFields = []) {
  const text = labels(part);
  const exact = entity.fields.filter(field => matchesFieldLabel(field, fieldReply(part)) || matchesFieldLabel(field, fieldReply(part).replace(FILLER, ' ')));
  if (exact.length === 1) return { fields: exact };
  if (['assistant_account_case', 'assistant_account_billing_collections'].includes(entity.id)) {
    const request = text.replace(FILLER, ' ').replace(/\be\b/g, ' ').replace(/\s+/g, ' ').trim();
    const financialFields = /^(?:facturas?|facturacion)$/.test(request) ? ['BillingStatus', 'InvoiceCount', 'InvoiceFolios']
      : /^(?:pagos?|cobros?|cobranza)$/.test(request) ? ['CollectionStatus', 'PaymentFolios', 'InvoiceSettlement'] : null;
    if (financialFields) return { fields: entity.fields.filter(field => financialFields.includes(field.key)), concept: /factura/.test(request) ? 'billing' : 'collections' };
  }
  // A qualifier is part of its measure: "descuento del convenio" requests
  // the discount, just as "saldo del paciente" requests the patient balance.
  let rule = RULES.filter(([, request]) => request.test(text)).sort((a, b) => text.search(a[1]) - text.search(b[1]))[0];
  if (!rule && /\bnombre\b/.test(text)) {
    const topic = normalize(entity.title);
    rule = RULES.find(([id]) => id === (/inventario|articulo|insumo|precio/.test(topic) ? 'product' : /directorio.*medico/.test(topic) ? 'doctor' : /proveedor/.test(topic) ? 'provider' : 'patient'));
  }
  if (!rule) {
    const tokens = text.replace(FILLER, ' ').split(/\s+/).filter(word => word.length > 2);
    let matching = tokens.length ? entity.fields.filter(field => tokens.every(token => labels(field.label).split(' ').map(stem).includes(stem(token)))) : [];
    const resolved = [...(resolutions || [])].reverse().find(([key, value]) => key.startsWith('field:') && matching.some(field => field.key === value));
    if (matching.length > 1 && resolved) matching = matching.filter(field => field.key === resolved[1]);
    const retained = matching.filter(field => contextFields.includes(field.key));
    if (matching.length > 1 && retained.length === 1) matching = retained;
    return matching.length ? matching.length === 1 ? { fields: matching } : { ambiguous: matching } : { unknown: text, empty: !tokens.length };
  }
  const [id, , match, required, excluded] = rule;
  if (['patient', 'doctor', 'provider', 'customer', 'payer'].includes(id)) {
    const remainder = text.replace(rule[1], ' ').replace(FILLER, ' ').replace(/\b(completo|completa|registrados?|tratante|solicitante|anestesiologo|razon|social)\b/g, ' ').trim();
    if (remainder) return { unknown: text, question: '¿Quieres incluir el nombre como un dato del reporte o buscar una persona? Para buscar, puedes decir «busca Juan Pérez».' };
  }
  let fields = entity.fields.filter(field => match.test(normalize(field.label)) && (!required || required.test(normalize(field.label))) && (!excluded || !excluded.test(normalize(field.label))));
  if (['deductible', 'copay', 'coinsurance'].includes(id)) {
    const defaults = /\b(?:predeterminad[oa]s?|por defecto)\b/.test(text);
    fields = fields.filter(field => /\bpredeterminad[oa]s?\b/.test(normalize(field.label)) === defaults);
    if (!defaults && Array.isArray(entity.conditionFields)) fields = fields.filter(field => entity.conditionFields.includes(field.key));
  }
  if (['discount', 'deductible', 'copay', 'coinsurance'].includes(id) && /%|\bporcentajes?\b/.test(normalize(part))) fields=fields.filter(field=>field.type==='percent' || field.unit==='percent');
  // The master has distinct general and percentage references for coinsurance.
  // A generic request includes both, retaining the separate registered values.
  if (id === 'coinsurance' && entity.conditionFields && !/%|\b(?:porcentajes?|predeterminad[oa]s?|por defecto)\b/.test(normalize(part))) return fields.length ? { fields, concept: id } : { missing: text, concept: id };
  if (id === 'balance') {
    const patientBalance = /\b(?:paciente|cuenta(?: del? paciente)?|atencion)\b/.test(text) && !/\b(?:pagador|aseguradora|cliente|socio)\b/.test(text);
    const payerBalance = /\b(?:pagador|aseguradora|cliente|socio)\b/.test(text);
    if (patientBalance) fields = fields.filter(field => /cuenta|paciente|atencion/.test(normalize(field.label)) && !/pagador|aseguradora|cliente|socio/.test(normalize(field.label)));
    if (payerBalance) fields = fields.filter(field => /pagador|aseguradora|cliente|socio/.test(normalize(field.label)));
  }
  const fieldSources = ['sap', 'vertical'].filter(source => new RegExp(`\\b${source}\\b`).test(text));
  if (fieldSources.length === 1 && fields.length > 1) {
    const qualified = fields.filter(field => new RegExp(`\\b${fieldSources[0]}\\b`).test(normalize(field.label)));
    if (qualified.length) fields = qualified;
  }
  const hint = labels(hints);
  const explicit = fields.filter(field => hint.includes(labels(field.label)));
  if (explicit.length === 1) fields = explicit;
  const traits = id === 'doctor' ? ['tratante', 'solicitante', 'anestesiologo', 'registrados'] : id === 'cost' ? ['promedio', 'ultimo', 'unitario'] : id === 'price' ? ['publico', 'hospitalizacion', 'unitario'] : id === 'money' ? ['linea', 'factura', 'pedido', 'cobrado'] : [];
  const ownTraits = traits.filter(trait => new RegExp(`\\b${trait}\\b`).test(text));
  const resolved = resolutions?.get(id);
  if (fields.length > 1 && !ownTraits.length && resolved && fields.some(field => field.key === resolved)) fields = fields.filter(field => field.key === resolved);
  const retained = fields.filter(field => contextFields.includes(field.key));
  if (fields.length > 1 && !ownTraits.length && retained.length === 1) fields = retained;
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
  if (entity.id === 'assistant_account_billing_collections') {
    const states = FINANCIAL_STATES;
    // A comparison asks for the status columns of all accounts; a selection
    // asks for one financial condition, with no silent partial filtering.
    const matches = states.filter(([,pattern])=>pattern.test(text));
    const selected = matches.filter(([state])=>!(state==='BILLED'&&matches.some(([candidate])=>candidate==='UNBILLED'))&&!(state==='COLLECTED'&&matches.some(([candidate])=>candidate==='UNPAID')));
    const comparison = /\bcuales\b/.test(text) && selected.some(([state])=>['BILLED','UNBILLED'].includes(state)) && selected.some(([state])=>['COLLECTED','UNPAID','PARTIAL'].includes(state));
    const conditions = [...new Set([...selected.map(([state])=>state), ...(filters.estatusDoc && filters.estatusDoc!=='ALL'?[filters.estatusDoc]:[])])];
    if (choices.state && entity.statusOptions.some(option=>option.value===choices.state)) filters.estatusDoc=choices.state;
    else if (!comparison && conditions.length === 1) filters.estatusDoc=conditions[0];
    else if (!comparison && conditions.length>1) issues.push({ question:'¿Qué condición quieres aplicar: estado de cuenta, facturación o cobro? Puedo aplicar una a la vez.', options: conditions.map(value => {
      const label = entity.statusOptions.find(option => option.value === value).label;
      return { label, message: `Solo ${label.toLowerCase()}.` };
    }) });
    const fragments = states.flatMap(([,pattern])=>[...text.matchAll(new RegExp(pattern.source,'g'))].map(match=>match[0])).sort((a,b)=>b.length-a.length);
    for (const fragment of fragments) text=text.replace(fragment,' ');
    text=text.replace(/\bcuales\b|\bal hospital\b/g,' ');
    if (matches.length) text=text.replace(/\b(?:cuentas(?: hospitalarias)?|ya|estan|las|los)\b/g,' ');
  }
  if (/\b(pagad[oa]s?|sin pagar|falta pagar|faltan pagar)\b/.test(text) && !['accounts_receivable', 'accounts_payable', 'incoming_payments', 'outgoing_payments','assistant_account_billing_collections'].includes(entity.id)) unsupported = 'El estado abierto o cerrado no indica si una factura está pagada. Este tema no permite aplicar ese filtro de pago.';
  if (/\b(joven(?:es)?|mayores?|menores?|adultos?|ninos?|mujeres|hombres)\b|\bsolo (?:los? |las? )?(?:del? |de la )(?:medico|paciente|proveedor)\s+[^,;.]+/.test(text)) unsupported = 'Ese tema no permite aplicar ese filtro a personas. Para encontrar un nombre puedes pedir «busca Juan Pérez»; la búsqueda revisa los textos del reporte.';
  if (/mayor que|menor que|mas de \d|menos de \d|ordena|ordenar|agrupa|agrupar|sumar|\bsuma\b|promedio (?:por|de todos)|sin (?:stock|existencias)|con (?:stock|existencias)/.test(text)
    || /\b(?:combina|cruza)\b/.test(text) && entitySources(entity).length < 2) unsupported = 'Ese cálculo, orden o condición todavía no está disponible en este tema. Puedo preparar el detalle con los datos y filtros disponibles.';
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
  const chunks = body.split(/[,;+]|\s+(?:y|e)\s+|\s+mas\s+/).map(part => part.trim()).filter(Boolean);
  return chunks.flatMap(chunk => {
    const parts = [], pattern = /\s+(?=(?:pacientes?|medicos?|procedimientos?|fechas?|folios?|costos?|precios?|cantidad|existencias?|saldos?|total|descuentos?|anticipos?|pagadores?|aseguradoras?|convenios?|acuerdos? comerciales?|listas? de precios|rfc|edad|estados?|estatus|productos?|insumos?|medicamentos?|nombre|ovs?|orden(?:es)? de ventas?|cuanto queda|cuantos quedan|cuanto hay)\b)/g;
    let start = 0, match;
    while ((match = pattern.exec(chunk))) {
      const prefix = chunk.slice(start, match.index);
      const next = chunk.slice(match.index).trim();
      // A procedure starts another list item only after an existing column;
      // keep introductory wording attached to a standalone procedure request.
      if (/^procedimientos?\b/.test(next) && !RULES.some(([, request]) => request.test(prefix))) continue;
      if (/\b(del?|id)\s*$/.test(prefix) || /\b(nombre|numero|codigo|folio)\s*$/.test(prefix) && /^(pacientes?|medicos?|productos?|insumos?|medicamentos?)\b/.test(next)) continue;
      parts.push(chunk.slice(start, match.index)); start = match.index + match[0].length;
    }
    parts.push(chunk.slice(start)); return parts;
  });
}

// Recognize bounded operations separately from visible columns. Field choices
// always come from the authorized metadata; values never become expressions.
function parseAnalysis(message, entity, resolutions) {
  const literals = [];
  let dateText = String(message);
  const search = searchValue(String(message));
  let text = normalize(String(message).replace(/["“]([^"”]+)["”]/g, (_, value) => {
    literals.push(value); return `zzanalysisvalue${literals.length - 1}zz`;
  })).replace(/\s+/g, ' ').trim();
  const restore = value => value.replace(/zzanalysisvalue(\d+)zz/g, (_, index) => literals[Number(index)]);
  let searchToken;
  if (search) {
    searchToken = search.fragment;
    // The quoted literal may be masked. Global search remains a legacy filter.
    const protectedSearch = text.match(/\b(?:busca|buska|buscar|buskar|encuentra|que diga|que contenga|contengan|coincida con)\s+(?:a\s+)?zzanalysisvalue\d+zz/);
    text = protectedSearch ? text.replace(protectedSearch[0], 'zzanalysissearchzz') : text.replace(normalize(search.fragment), 'zzanalysissearchzz');
  }
  // Periods are interpreted from the original request below, so they cannot be
  // consumed by the field phrase of a later condition or aggregation.
  text = text.replace(/\b(?:el|del?|en|durante|de la)?\s*(?:este mes|mes pasado|mes anterior|esta semana|semana pasada|semana anterior|hoy|ayer|anteayer|este ano|ano actual)\b/g, ' ')
    .replace(/\b(?:de|en|durante)?\s*(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?: de)?(?: \d{4})?\b/g, ' ');
  const delta = {}, questions = [], usedFields = new Set();
  const capabilities = getAnalysisCapabilities(entity);
  let requested = false, unsupported = '';
  const ask = (key, message, fields = []) => questions.push({ key: `analysis:${key}`, message,
    options: fields.slice(0, 4).map(field => ({ label: field.label, message: `Me refiero a «${field.label}».` })) });
  const resolve = (phrase, purpose, op) => {
    const part = restore(phrase).replace(/^[\s«»"“”]+|[\s«»"“”.!?]+$/g, '').replace(/^(?:el|la|los|las|del|de)\s+/, '').trim();
    const match = fieldMatch(part, entity, part, resolutions, []);
    const fields = match.fields || match.ambiguous || [];
    if (fields.length !== 1) {
      ask(`${purpose}:${match.concept || labels(part)}`, fields.length ? `Para ${purpose}, ¿qué dato quieres usar cuando dices «${restore(phrase).trim()}»?` : `¿Qué columna disponible quieres usar para ${purpose}? No pude identificar «${restore(phrase).trim()}».`, fields);
      return null;
    }
    const field = fields[0], capability = capabilities.fields.find(item => item.key === field.key);
    if (op === 'sum' && !capability?.sumAllowed) unsupported = `«${field.label}» no tiene una suma verificada para esta fuente. Puedes consultar su detalle o contar registros.`;
    else if (op && op !== 'sum' && !capability?.ops.includes(op)) unsupported = `La comparación solicitada no está disponible para «${field.label}».`;
    usedFields.add(field.key);
    return unsupported ? null : field;
  };
  const number = value => {
    const stripped = value.replace(/[$%\s]/g, '');
    const numeric = /^[-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(stripped) ? stripped.replace(/,/g, '') : /^[-+]?\d+,\d{1,2}$/.test(stripped) ? stripped.replace(',', '.') : stripped;
    return /^[-+]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(numeric) && Number.isFinite(Number(numeric)) ? numeric : null;
  };
  const mergePredicate = condition => { (delta.predicates ||= []).push(condition); };
  const conditionPrefix = '(?:^|\\b(?:con|donde|y|filtra(?:r)?(?: por)?|solo(?: con)?))\\s*';
  const amount = '[-+]?\\$?\\s*\\d[\\d,.]*(?:\\s*%)?';
  const comparator = 'mayor(?:es)?(?: o igual(?:es)?)? (?:a|que)|menor(?:es)?(?: o igual(?:es)?)? (?:a|que)|mas de|menos de|igual(?:es)? a|distint[oa]s? de|diferente(?:s)? de';
  dateText = dateText.replace(new RegExp(`(?:${comparator})\\s+(?:${amount}|["“][^"”]+["”])`, 'gi'), ' ').replace(/\bmayor(?:es)?\b|\bmenor(?:es)?\b/gi, ' ');
  if (/\b(?:compara(?:r)?|comparativ[oa]s?|top\s*\d+|(?:primeros|ultimos|mayores|menores)\s+\d+|(?:los|las)\s+\d+\s+(?:mayores|menores)|promedia(?:r)?|calcula(?:r)? (?:el )?promedio|promedio (?:por|de todos)|having|grupos? (?:con|cuyo)|total(?:es)? (?:del? grupo|agrupad[oa]s?).*(?:mayor(?:es)?|menor(?:es)?))\b/.test(text)) {
    requested = true;
    unsupported = 'Todavía no están disponibles los promedios calculados, las comparaciones entre períodos, los primeros N ni las condiciones sobre totales de grupos. Puedes pedir filtros de detalle, agrupaciones, sumas verificadas y conteos.';
    return { text: restore(text).replace('zzanalysissearchzz', searchToken || ''), dateText, delta, questions, usedFields, requested, unsupported };
  }
  text = text.replace(/\b(?:quita (?:el |los |las )?|sin )(analisis|condiciones|agrupacion|agrupaciones|totales|orden)(?: del reporte)?\b/g, (_, operation) => {
    requested = true;
    if (operation === 'analisis') Object.assign(delta, { predicates: [], groupBy: [], measures: [], orderBy: [] });
    else delta[/condicion/.test(operation) ? 'predicates' : /agrupacion/.test(operation) ? 'groupBy' : operation === 'totales' ? 'measures' : 'orderBy'] = [];
    return ' ';
  });
  text = text.replace(/\b(?:numero de cuenta|cuenta|folio de atencion|numero de atencion|paciente numero|numero de paciente)\s*(?:n[°º.]?\s*)?(\d+)\b/g, (fragment, value) => {
    requested = true;
    const key = /paciente/.test(fragment) ? 'PTNum' : 'PCNum';
    const field = entity.fields.find(item => item.key === key);
    if (!field || !(entity.pointLookupFields || []).includes(key)) ask(`identificador:${key}`, `Este reporte no permite consultar ${key === 'PTNum' ? 'un paciente' : 'una cuenta'} por ese número. Elige una fuente que incluya ese identificador.`);
    else if (!Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > 2147483647) ask(`identificador:${key}`, 'Indica un número entero positivo de cuenta o paciente.');
    else { mergePredicate({ field: key, op: 'eq', value }); usedFields.add(key); }
    dateText = dateText.replace(new RegExp(fragment, 'i'), ' ');
    return ' ';
  });
  text = text.replace(new RegExp(`${conditionPrefix}([^,;]+?)\\s+entre\\s+(${amount})\\s+y\\s+(${amount})`, 'g'), (fragment, phrase, lower, upper) => {
    requested = true;
    const field = resolve(phrase, 'filtrar', 'between'), values = [number(lower), number(upper)];
    if (field && values.every(value => value != null)) mergePredicate({ field: field.key, op: 'between', values });
    else if (field) ask(`intervalo:${field.key}`, `Indica dos números válidos para «${field.label}».`);
    dateText = dateText.replace(new RegExp(`\\bentre\\s+${lower.replace(/[$.]/g, '\\$&')}\\s+y\\s+${upper.replace(/[$.]/g, '\\$&')}`, 'i'), ' ');
    return ' ';
  });
  text = text.replace(new RegExp(`${conditionPrefix}([^,;]+?)\\s+(${comparator})\\s+(${amount}|zzanalysisvalue\\d+zz)`, 'g'), (_, phrase, comparison, value) => {
    requested = true;
    const op = /^mayor|^mas/.test(comparison) ? /igual/.test(comparison) ? 'gte' : 'gt' : /^menor|^menos/.test(comparison) ? /igual/.test(comparison) ? 'lte' : 'lt' : /^igual/.test(comparison) ? 'eq' : 'ne';
    const field = resolve(phrase, 'filtrar', op);
    if (field) mergePredicate({ field: field.key, op, value: /zzanalysisvalue/.test(value) ? restore(value) : number(value) });
    return ' ';
  });
  text = text.replace(new RegExp(`${conditionPrefix}([^,;]+?)\\s+(?:contiene|contengan|contenga)\\s+(zzanalysisvalue\\d+zz)`, 'g'), (_, phrase, value) => {
    requested = true;
    const field = resolve(phrase, 'filtrar', 'contains');
    if (field) mergePredicate({ field: field.key, op: 'contains', value: restore(value) });
    return ' ';
  });
  text = text.replace(new RegExp(`${conditionPrefix}([^,;]+?)\\s+(no (?:es |esta )?(?:nulo|vacio)|(?:es |esta )?(?:nulo|vacio)|sin (?:dato|informacion))\\b`, 'g'), (_, phrase, missing) => {
    requested = true;
    const op = /^(?:no|con)/.test(missing) ? 'notNull' : 'isNull', field = resolve(phrase, 'filtrar', op);
    if (field) mergePredicate({ field: field.key, op });
    return ' ';
  });
  const clauseEnd = '(?=\\s+(?:y\\s+)?(?:del? mes|en (?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)|desde|durante|con|sin|ordena|ordenar|ordenado|suma|sumar|totaliza|totalizado|agrega|incluye|muestra|quita|solo)\\b|[.;]|$)';
  const aggregateRequested = /\b(?:suma(?:r)?|totaliza(?:r|do|da|dos|das)?|totalizad[oa]s?|cuantos?|contar|conteo|cantidad de registros|numero de registros)\b/.test(text) || /\btotal(?: de)?\s+.+\s+por\b/.test(text);
  const firstOperation = text.search(/\b(?:suma(?:r)?|total\w*|agrupa\w*|cuantos?|contar|conteo|ordena\w*)\b/);
  if (firstOperation >= 0) for (const phrase of topicPhrases(entity).sort((a, b) => b.length - a.length)) {
    text = text.replace(new RegExp(`\\b${labels(phrase).replace(/ /g, '\\s+')}\\b`, 'g'), (match, offset) => offset < firstOperation ? ' ' : match);
  }
  text = text.replace(new RegExp(`\\b(?:ordena(?:r|do|da|dos|das)?|ordenad[oa]s?)(?:\\s+por)?\\s+(.+?)${clauseEnd}`, 'g'), (_, phrase) => {
    requested = true; delta.orderBy = [];
    for (const part of phrase.split(/,|\s+y\s+/)) {
      const direction = /\b(?:desc|descendente|de mayor a menor|mayor primero)\b/.test(part) ? 'desc' : 'asc';
      const name = part.replace(/\b(?:asc|ascendente|desc|descendente|de mayor a menor|de menor a mayor|mayor primero|menor primero)\b/g, '').trim();
      const field = resolve(name, 'ordenar');
      if (field) delta.orderBy.push({ field: field.key, direction });
    }
    return ' ';
  });
  text = text.replace(new RegExp(`\\b(?:agrupa(?:r|do|da|dos|das)?|agrupad[oa]s?|desglosa(?:r|do|da|dos|das)?)(?:\\s+por)?\\s+(.+?)${clauseEnd}`, 'g'), (_, phrase) => {
    requested = true; delta.groupBy = [];
    for (const part of phrase.split(/,|\s+y\s+/)) { const field = resolve(part, 'agrupar'); if (field) delta.groupBy.push(field.key); }
    return ' ';
  });
  if (aggregateRequested && !('groupBy' in delta)) text = text.replace(new RegExp(`\\bpor\\s+(.+?)${clauseEnd}`, 'g'), (_, phrase) => {
    requested = true; delta.groupBy = [];
    for (const part of phrase.split(/,|\s+y\s+/)) { const field = resolve(part, 'agrupar'); if (field) delta.groupBy.push(field.key); }
    return ' ';
  });
  text = text.replace(/\b(?:cuantos?|contar|conteo de)\s+(?:los |las )?(.+?)\s+(?:distintos?|distintas?|unicos?|unicas?)\b/g, (_, phrase) => {
    requested = true; delta.measures ||= [];
    const field = resolve(phrase, 'contar valores distintos');
    if (field) delta.measures.push({ op: 'countDistinct', field: field.key });
    return ' ';
  });
  text = text.replace(/\b(?:cuantos?|contar|conteo de|cantidad de|numero de)\s+(?:los |las )?(?:registros?|cuentas|facturas|atenciones)\b/g, () => {
    requested = true; (delta.measures ||= []).push({ op: 'count' }); return ' ';
  });
  text = text.replace(new RegExp(`\\b(?:suma(?:r)?(?: de)?|totaliza(?:r|do|da|dos|das)?|totalizad[oa]s?)\\s*(.*?)${clauseEnd}`, 'g'), (_, phrase) => {
    requested = true; delta.measures ||= [];
    const summable = capabilities.fields.filter(field => field.sumAllowed);
    for (const part of phrase.split(/,|\s+y\s+/)) {
      const field = part.trim() ? resolve(part, 'sumar', 'sum') : summable.length === 1 ? entity.fields.find(field => field.key === summable[0].key) : null;
      if (field) delta.measures.push({ op: 'sum', field: field.key });
      else if (!part.trim()) ask('sumar:importe', '¿Qué importe quieres totalizar?', summable);
    }
    return ' ';
  });
  if (aggregateRequested) text = text.replace(new RegExp(`\\btotal(?: de)?\\s+(.+?)${clauseEnd}`, 'g'), (_, phrase) => {
    requested = true; delta.measures ||= [];
    const field = resolve(phrase, 'sumar', 'sum');
    if (field) delta.measures.push({ op: 'sum', field: field.key });
    return ' ';
  });
  if (/\b(?:mayor(?:es)?(?: o igual(?:es)?)? (?:a|que)|menor(?:es)?(?: o igual(?:es)?)? (?:a|que)|mas de|menos de|agrupa(?:r|do|da|dos|das)?|ordena(?:r|do|da|dos|das)?|sumar|suma|totaliza(?:r|do|da|dos|das)?)\b/.test(text)) {
    requested = true; ask('operacion', 'Indica qué columna y condición, agrupación, total u orden necesitas. Por ejemplo: «saldo mayor a 10000» o «cuántos registros por convenio».');
    text = '';
  }
  if (requested) text = text.replace(/^\s*(?:(?:necesito|quiero|dame|pasame|muestra|las|los|el|la)\s+)*(?:cuentas|facturas|atenciones|registros)\b/, ' ');
  return { text: restore(text).replace('zzanalysissearchzz', searchToken || ''), dateText, delta, questions, usedFields, requested, unsupported };
}

function mergeAnalysis(previous, delta, replaceConditions = false) {
  const result = { predicates: [...(previous?.predicates || [])], groupBy: [...(previous?.groupBy || [])], measures: [...(previous?.measures || [])], orderBy: [...(previous?.orderBy || [])] };
  for (const key of ['groupBy', 'measures', 'orderBy']) if (key in delta) result[key] = [...new Map(delta[key].map(value => [JSON.stringify(value), value])).values()];
  if ('predicates' in delta) {
    if (!delta.predicates.length) result.predicates = [];
    else for (const predicate of delta.predicates) {
      if (replaceConditions) result.predicates = result.predicates.filter(current => current.field !== predicate.field || current.op !== predicate.op);
      if (!result.predicates.some(current => JSON.stringify(current) === JSON.stringify(predicate))) result.predicates.push(predicate);
    }
  }
  // A summed field has a generated output key; source keys stay source keys.
  if (result.measures.length) result.orderBy = result.orderBy.map(order => {
    const metric = result.measures.findIndex(measure => measure.field === order.field);
    return metric >= 0 && !result.groupBy.includes(order.field) ? { ...order, field: `metric_${metric}` } : order;
  });
  return Object.values(result).some(values => values.length) ? result : null;
}

function interpretRequest({ message, pending, context, catalog, today, forcedEntity }) {
  let previous = cleanPending(pending);
  const latestSelection = topicSelection(message, catalog);
  const latestRanking = rankTopics(naturalText(message), catalog);
  const current = catalog.find(entity=>entity.id===context?.entity);
  const answerBody = labels(naturalText(message).replace(FILLER,' '));
  const stateReply = current?.statusOptions?.some(option=>labels(naturalText(option.label).replace(FILLER,' '))===answerBody);
  if (previous && !latestSelection && !stateReply && latestRanking[0]?.score >= 16 && !/\b(agrega|incluye|quita|cambia|sustituye)\b/.test(naturalText(message))) {
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
  const nextPending = { request: previous?.request || message, answers: previous ? [...previous.answers, message].slice(-4) : [] };
  let entity = forcedEntity || (chosenTitle ? selectedTopic.matches[0] : null);
  const accountId = /\b(?:numero de cuenta|cuenta|folio de atencion|numero de atencion)\s+\d+\b/.test(allTopics);
  const patientId = /\b(?:paciente numero|numero de paciente)\s+\d+\b/.test(allTopics);
  const financeRequest = /\b(?:facturas?|facturacion|cobros?|pagos?|pagad[oa]|cerrad[oa])\b/.test(allTopics);
  const chargesRequest = /\b(?:insumos?|cargos?|servicios consumidos)\b/.test(allTopics);
  const namedPatient = latestTopic.match(/\bpaciente(?: llamado| de nombre)?\s+([a-zñ]+(?:\s+[a-zñ]+){0,3})/);
  const personWords = namedPatient?.[1].split(/\s+/) || [];
  const pointNameRequest = /\b(?:dime|estado de cuenta|cuenta del paciente|datos del paciente|saldo del paciente|paciente (?:llamado|de nombre)|consulta al paciente)\b/.test(latestTopic);
  const nameIsRequest = pointNameRequest && personWords.length && !/^(?:numero|nombre|medico|paciente|procedimientos?|con|sin|y|de|del|en|que|saldo|fecha|folio|estado|total|doctor|codigo|id|mayor|mayo|menor|igual|contiene|contenga|porcentaje|edad|apellidos?|joven|adulto|hombre|mujer)$/.test(personWords[0]);
  if (nameIsRequest && !accountId && !patientId) return { proposal: { status: 'clarification', message: 'Para consultar a ese paciente, indica su número de paciente o el folio de atención. Los nombres pueden repetirse; necesito el identificador para elegir la cuenta correcta.', plan: null, choices: [] }, pending: nextPending, normalizedText: allText, confident: true, hasUnresolved: true };
  // This server-owned case resource is the only way to combine account finance
  // and item charges for a single exact account. Never infer a person by name.
  if (!entity && accountId && chargesRequest && (financeRequest || /\bsaldo\b/.test(allTopics))) entity = catalog.find(item => item.id === 'assistant_account_case');
  if (!entity && accountId && chargesRequest && !financeRequest && !/\bsaldo\b/.test(allTopics)) entity = catalog.find(item => item.id === 'vertical_account_charges');
  if (!entity && (accountId || patientId) && financeRequest && !chargesRequest) entity = catalog.find(item => item.id === 'assistant_account_billing_collections');
  if (!entity && (accountId || patientId) && /\bestado de cuenta\b/.test(allTopics)) entity = catalog.find(item => item.id === 'assistant_account_billing_collections') || catalog.find(item => item.id === 'vertical_accounts');
  const hasAction = /\b(agrega|incluye|quita|sin|solo|cambia|sustituye|deja)\b/.test(latest);
  const topicAtStart = replyRanking.length && topicPhrases(replyRanking[0].entity).some(phrase => labels(latest) === labels(phrase) || labels(latest).startsWith(`${labels(phrase)} `));
  const switchTopic = context && replyRanking.length && replyRanking[0].entity.id !== context.entity && replyRanking[0].score >= 16 && (topicAtStart || /\b(ahora|mejor|quiero|necesito|dame|pasame|otro|otra)\b/.test(latest)) && !/\b(agrega|incluye|quita|cambia|sustituye)\b/.test(latest);
  if (!entity && context && !switchTopic) entity = catalog.find(item => item.id === context.entity);
  const ranked = switchTopic ? replyRanking : ranking;
  if (!entity && ranked.length && (ranked.length === 1 || ranked[0].score > ranked[1].score)) entity = ranked[0].entity;
  if (selectedTopic && selectedTopic.matches.length !== 1) {
    return { proposal: { status: selectedTopic.matches.length ? 'clarification' : 'unsupported', message: selectedTopic.matches.length ? '¿Cuál de estos temas necesitas?' : 'El tema que elegiste no está disponible para tu usuario. Elige uno de los temas disponibles o solicita acceso al área de Sistemas.', plan: null, choices: selectedTopic.matches.map(item => item.id) }, pending: nextPending, normalizedText: allText, confident: true, hasUnresolved: true };
  }
  const replySources = ['sap', 'vertical'].filter(source => new RegExp(`\\b${source}\\b`).test(latestTopic));
  const sources = replySources.length === 1 ? replySources : ['sap', 'vertical'].filter(source => new RegExp(`\\b${source}\\b`).test(allTopics));
  const wantsBoth = BOTH_SOURCES.test(latestTopic) || !replySources.length && BOTH_SOURCES.test(allTopics);
  // "OV" exists in both catalogues. Ask for the authorized source before
  // interpreting it as a column or reusing an unrelated report's context.
  const genericOrders = ORDER_REQUEST.test(allTopics) && !/\b(?:detalle|lineas|ordenes? de servicios|ov de servicios)\b/.test(allTopics);
  // A source combination is executable only when an authorized definition
  // already implements it. An AI selection cannot silently drop one source.
  if (!chosenTitle && !genericOrders && (sources.length > 1 || wantsBoth) && entity && entitySources(entity).length < 2) {
    return { proposal: { status: 'unsupported', message: 'No tengo disponible una combinación de SAP y Vertical que reúna todos los datos de esta solicitud. Dime qué información necesitas de cada origen para revisar una combinación disponible.', plan: null, choices: [] }, pending: nextPending, normalizedText: allText, confident: true, hasUnresolved: true };
  }
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
  let selected = sameTopic ? [...context.selectedFields] : (entity.identityFields || []).filter(key => entity.fields.some(field => field.key === key));
  const filters = { ...DEFAULT_FILTERS, ...(sameTopic ? context.filters : {}) };
  let analysis = sameTopic ? context.analysis || null : null, analysisRequested = false;
  const analysisFields = new Set();
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
    const reply = fieldReply(utterance);
    const replyFields = reply !== utterance ? entity.fields.filter(field => matchesFieldLabel(field, reply)) : [];
    const exactReply = replyFields.length === 1 ? replyFields[0] : null;
    const input = choice ? choice.remainder : exactReply ? `Agrega ${exactReply.label}` : utterance;
    if (!input.trim()) continue;
    if (ORDER_TOPICS.includes(entity.id) && /^(?:ambas|ambos|las dos|los dos|(?:de )?sap|(?:de )?vertical)[.!]?$/i.test(utterance.trim())) continue;
    const operation = parseAnalysis(input, entity, resolutions);
    if (operation.requested) {
      analysisRequested = true; changes.push('analysis');
      const lookupFields = (operation.delta.predicates || []).filter(predicate => predicate.op === 'eq' && (entity.pointLookupFields || []).includes(predicate.field)).map(predicate => predicate.field);
      if (lookupFields.length && analysis) analysis = { ...analysis, predicates: (analysis.predicates || []).filter(predicate => !(entity.pointLookupFields || []).includes(predicate.field)) };
      analysis = mergeAnalysis(analysis, operation.delta, /\b(?:mejor|cambia|ajusta|ahora)\b/.test(normalize(input)));
      for (const field of operation.usedFields) analysisFields.add(field);
      for (const question of operation.questions) questions.set(question.key, question);
      if (operation.unsupported) unsupported = operation.unsupported;
    }
    // A field answer resolves the original operation on replay. It does not
    // silently replace the requested visible detail with that single column.
    if (exactReply && analysisFields.has(exactReply.key)) continue;
    let filterInput = operation.text;
    const exactLookup = (analysis?.predicates || []).some(predicate => predicate.op === 'eq' && (entity.pointLookupFields || []).includes(predicate.field));
    const pointStatusQuestion = exactLookup && ['assistant_account_billing_collections', 'assistant_account_case', 'vertical_accounts'].includes(entity.id)
      && /\b(?:dime si|si (?:la |el )?|(?:ya )?tiene|esta|hay|saber|verifica|revisa|estado de cuenta)\b/.test(naturalText(input))
      && /\b(?:facturas?|pagad[oa]s?|cerrad[oa]s?|estado de cuenta)\b/.test(naturalText(input));
    if (pointStatusQuestion) {
      // Asking whether an account is paid/closed asks for evidence. Filtering
      // it to paid/closed records would hide the very answer being requested.
      const evidenceFields = [...(entity.defaultFields || []), 'AccountStatus', 'BillingStatus', 'CollectionStatus', 'InvoiceSettlement', 'Evidence'];
      selected = [...new Set([...selected, ...evidenceFields.filter(key => entity.fields.some(field => field.key === key))])];
      explicitFields = true; changes.push('columns');
      const remaining = filterInput.search(/\b(?:con|agrega|incluye|muestra|quita|sin)\b/);
      filterInput = remaining >= 0 ? filterInput.slice(remaining) : '';
    }
    if (exactLookup && entity.id === 'vertical_account_charges') filterInput = filterInput.replace(/\b(?:detalle de )?cargos?\s+(?:e|y)\s+insumos?\b/gi, ' ');
    if (exactLookup && (accountId || patientId)) filterInput = filterInput.replace(/\bpaciente(?: llamado| de nombre)?\s+([A-ZÁÉÍÓÚÑ][\p{L}.'-]+(?:\s+[A-ZÁÉÍÓÚÑ][\p{L}.'-]+){0,3})\b/gu, ' ');
    const parsed = parseFilters(filterInput, entity, hints, filterChoices);
    Object.assign(filters, parsed.filters);
    Object.assign(requestedFilters, parsed.filters);
    if (parsed.question) questions.set(`filter:${parsed.question}`, { message: parsed.question, options: parsed.options });
    if (parsed.unsupported) unsupported = parsed.unsupported;
    if (parsed.recognized) changes.push('filters');
    const dates = interpretDates(operation.dateText, today, filters);
    if (dates.range || dates.error || dates.requested) dateInput = dates;
    if (dates.range) { Object.assign(filters, dates.range); changes.push('dates'); }
    let text = removeDates(parsed.text);
    if (entitySources(entity).length > 1) text = text.replace(/\b(?:combina|cruza|ambas|ambos|las dos|los dos)\b/g, ' ');
    if (ORDER_SUMMARIES.includes(entity.id) && /\bresumen\s+por\s+orden\b/.test(text)) {
      text = text.replace(/\bresumen\s+por\s+orden\b/g, ' ');
      changes.push('presentation');
    }
    if (dates.requested && sameTopic && !/\b(agrega|incluye|muestra|quita|con|sin)\b/.test(parsed.text)) text = '';
    const firstAction = text.search(ACTIONS);
    for (const phrase of topicPhrases(entity).sort((a, b) => b.length - a.length)) {
      const pattern = new RegExp(`\\b${labels(phrase).replace(/ /g, '[\\s·:—–-]+')}\\b`, 'g');
      text = text.replace(pattern, (match, offset) => firstAction < 0 || offset < firstAction ? ' ' : match);
    }
    if (genericOrders && ORDER_TOPICS.includes(entity.id)) text = text.replace(/\b(?:de )?(?:sap|vertical)\b/g, ' ');
    else if (entity.assistantOnly) {
      // Source descriptors identify the capability. Source words in requested
      // column labels still distinguish, for example, account and SAP balances.
      const columnAction = text.search(ACTIONS);
      text = text.replace(/\b(?:de )?(?:sap|vertical)\b/g, (match, offset) => columnAction < 0 || offset < columnAction ? ' ' : match);
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
        // The draft retains completed choices even after the bounded answer
        // history rolls over. A fresh request cannot infer choices from it.
        let field = fieldMatch(part, entity, hints, resolutions, previous && sameTopic ? context.selectedFields : []);
        if ((!field.fields && !field.ambiguous || !sameTopic && segment.mode === 'muestra') && topicPhrases(entity).some(topic => labels(part.replace(FILLER, ' ')) === labels(naturalText(topic).replace(FILLER, ' ')))) continue;
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
          questions.set(`column:${key}`, { message: `Cuando dices «${part.trim()}», ¿qué dato necesitas?`, options: field.ambiguous.slice(0, 4).map(column => { const label = column.aliases?.[0] || column.label; return { label, message: `Me refiero a «${label}».` }; }) });
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
  const requestedColumns = explicitFields || missing.size > 0 || [...questions.keys()].some(key => key.startsWith('column:'));
  if (analysis) {
    try { analysis = validateAnalysis(entity, analysis); }
    catch (error) { unsupported = error.status === 400 ? error.message : 'No pude validar las condiciones del análisis. Revisa la columna y la operación solicitadas.'; }
  }
  let baseFields = selected.length && (requestedColumns || sameTopic) ? selected : !requestedColumns ? entity.defaultFields || entity.fields.slice(0, 6).map(field => field.key) : [];
  if (!requestedColumns && analysisRequested && (!sameTopic || JSON.stringify(context.selectedFields) === JSON.stringify(entity.defaultFields))) baseFields = [...new Set([...baseFields, ...analysisFields])];
  const knownFields = [...new Set(baseFields.flatMap(key => [key, ...(entity.relatedFields?.[key] || []).filter(related => entity.fields.some(field => field.key === related))]))];
  const draftFields = knownFields.length ? knownFields : context?.selectedFields?.filter(key => entity.fields.some(field => field.key === key)) || [];
  const plan = draftFields.length ? { entity: entity.id, selectedFields: draftFields, filters, ...(analysis ? { analysis } : {}) } : null;
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
  else proposal = { status: 'ready', message: `Preparé «${entity.title}».`, plan: { entity: entity.id, selectedFields: knownFields, filters, ...(analysis ? { analysis } : {}) }, choices: [] };
  const unresolvedColumns = [...missing.values()];
  const schemaSearchNeeded = unresolvedColumns.some(column=>!column.known) && (entity.resourceMetadata || ranked.some(item=>item.entity.resourceMetadata
    && item.score>=16 && entitySources(item.entity).join(',')===entitySources(entity).join(',')));
  return { proposal, pending: nextPending, options: options.slice(0, 4), normalizedText: allText, dateInput, entity, explicitFields,
    knownRequestedFields: explicitFields ? knownFields : [], unresolvedColumns, unsupportedRequest: Boolean(unsupported), schemaSearchNeeded,
    requestedFilters, analysisRequested, changes, confident: Boolean(sameTopic || chosenTitle || ranked[0]?.score >= 16 || forcedEntity || entity.id === 'assistant_account_case'), hasUnresolved: Boolean(questions.size || missing.size || unsupported || !knownFields.length) };
}

module.exports = { interpretRequest, cleanPending, rankTopics, fieldMatch, WAREHOUSE_LABELS };
