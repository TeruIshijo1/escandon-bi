'use strict';

// Operations and additive grains are server-owned. A model never supplies an
// expression, a join, a currency conversion, or the definition of a measure.
const numericTypes = new Set(['number', 'money', 'percent']);
const comparisonOps = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'isNull', 'notNull'];
const textOps = ['eq', 'ne', 'contains', 'isNull', 'notNull'];
const decimalPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const registry = Object.create(null);
const SAP_LOCAL = 'Moneda local de SAP';
const VERTICAL_LOCAL = 'Moneda de registro de Vertical';
function declare(ids, keys, measures, unit) {
  for (const id of ids) registry[id] = { keys, measures: Object.fromEntries(measures.map(key => [key, { unit }])) };
}
declare(['sales_invoice_summary', 'purchase_invoice_summary', 'accounts_receivable', 'accounts_payable', 'sales_down_payments', 'purchase_down_payments'],
  ['DocEntry'], ['DocTotal', 'PaidToDate', 'Balance'], SAP_LOCAL);
declare(['sales_order_summary'], ['DocEntry'], ['DocTotal'], SAP_LOCAL);
declare(['sales_orders', 'sales_quotations', 'sales_deliveries', 'sales_returns', 'purchase_credit_memos', 'purchase_quotations'],
  ['DocEntry', 'LineNum'], ['LineTotal'], SAP_LOCAL);
for (const id of ['sales_orders', 'sales_quotations', 'sales_deliveries', 'sales_returns', 'purchase_credit_memos', 'purchase_quotations']) {
  registry[id].measures.Quantity = { unit: 'Unidades registradas' };
  registry[id].measures.OpenQty = { unit: 'Unidades pendientes' };
}
declare(['incoming_payments', 'outgoing_payments'], ['DocEntry'], ['CashSum', 'TransferSum', 'PaymentTotal'], SAP_LOCAL);
declare(['journal_entries'], ['JdtNum', 'Line_ID'], ['Debit', 'Credit'], SAP_LOCAL);
declare(['vertical_accounts'], ['PCNum'], ['Total', 'Balance', 'Downpayments'], VERTICAL_LOCAL);
declare(['vertical_sales_orders'], ['SONum'], ['Subtotal', 'TaxTotal', 'Total'], VERTICAL_LOCAL);
declare(['vertical_service_orders'], ['SOLNNum'], ['LineTotal'], VERTICAL_LOCAL);
registry.vertical_service_orders.measures.Quantity = { unit: 'Unidades registradas' };
declare(['vertical_account_charges'], ['PCITNum'], ['Quantity'], 'Unidades registradas');
declare(['vertical_receivables'], ['PCNum'], ['TotalFacturado', 'TotalAbonado', 'SaldoPendiente', 'TotalDevuelto'], VERTICAL_LOCAL);
declare(['assistant_account_billing_collections'], ['PCNum'], ['AccountBalance'], VERTICAL_LOCAL);
for (const key of ['InvoiceTotal', 'InvoiceBalance', 'ReceivedAppliedAmount']) {
  registry.assistant_account_billing_collections.measures[key] = { unit: 'Moneda de facturas SAP', currencyField: 'Currency' };
}

function failure(message) { const error = new Error(message); error.status = 400; error.code = 'REPORT_ANALYSIS_VALIDATION'; return error; }
function object(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) {
    throw failure(`La configuración de ${label} no es válida.`);
  }
}
function list(value, maximum, label) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maximum) throw failure(`Revisa ${label} y su cantidad de condiciones.`);
  return value;
}
function measureDefinition(entity, key) {
  const definition = registry[entity.id] || (entity.composition?.base && registry[entity.composition.base]);
  if (!definition || (entity.nonAdditiveFields || []).includes(key) || !definition.keys.every(k => entity.fields.some(f => f.key === k))) return null;
  const measure = definition.measures[key];
  return measure && (!measure.currencyField || entity.fields.some(f => f.key === measure.currencyField)) ? { ...measure, keys: definition.keys } : null;
}
function getAnalysisCapabilities(entity) {
  return { predicatesLimit: 8, groupsLimit: 4, measuresLimit: 6, ordersLimit: 2,
    fields: (entity.fields || []).map(field => ({ key: field.key, label: field.label, type: field.type,
      ops: numericTypes.has(field.type) || ['date', 'datetime'].includes(field.type) ? comparisonOps : textOps,
      sumAllowed: Boolean(measureDefinition(entity, field.key)),
      ...(measureDefinition(entity, field.key) ? { unit: measureDefinition(entity, field.key).unit,
        ...(measureDefinition(entity, field.key).currencyField ? { currencyField: measureDefinition(entity, field.key).currencyField } : {}) } : {}) })),
    measures: ['count', 'countDistinct', 'sum'] };
}
// Fixed six-decimal arithmetic matches the declared financial source scale.
// Round at the boundary once; sum and compare using integers, including negatives.
function scaled(value) {
  if (!['number', 'string'].includes(typeof value) || typeof value === 'number' && !Number.isFinite(value)) return null;
  const text = String(value).trim();
  if (text.length > 100 || !decimalPattern.test(text)) return null;
  const match = /^([+-]?)([\d.]+)(?:e([+-]?\d+))?$/i.exec(text);
  const exponent = Number(match[3] || 0);
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 30) return null;
  const [whole = '', fractional = ''] = match[2].split('.');
  const digits = (whole + fractional).replace(/^0+/, '') || '0';
  const shift = exponent - fractional.length + 6;
  let amount;
  if (shift >= 0) amount = BigInt(digits) * 10n ** BigInt(shift);
  else {
    const divisor = 10n ** BigInt(-shift);
    const raw = BigInt(digits);
    amount = raw / divisor + (raw % divisor * 2n >= divisor ? 1n : 0n);
  }
  return match[1] === '-' ? -amount : amount;
}
function decimal(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const fraction = String(absolute % 1000000n).padStart(6, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${absolute / 1000000n}${fraction ? `.${fraction}` : ''}`;
}
function dateValue(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null;
  if (typeof value !== 'string') return null;
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day ? day : null;
}
function operand(field, value) {
  if (numericTypes.has(field.type)) {
    const result = scaled(value);
    if (result == null) throw failure(`Indica un número válido para «${field.label}».`);
    return decimal(result);
  }
  if (['date', 'datetime'].includes(field.type)) {
    if (typeof value !== 'string' || value.length !== 10 || !dateValue(value)) throw failure(`Indica una fecha válida para «${field.label}».`);
    return value;
  }
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw failure(`Revisa el valor de «${field.label}».`);
  return value.trim();
}
function validateAnalysis(entity, input) {
  if (input == null) return null;
  object(input, ['predicates', 'groupBy', 'measures', 'orderBy'], 'análisis');
  const fields = new Map(entity.fields.map(field => [field.key, field]));
  const fieldFor = key => { if (typeof key !== 'string' || !fields.has(key)) throw failure('El análisis solicita una columna que no está disponible en este reporte.'); return fields.get(key); };
  const predicates = list(input.predicates, 8, 'los filtros').map(condition => {
    object(condition, ['field', 'op', 'value', 'values'], 'filtros');
    const field = fieldFor(condition.field);
    const ops = numericTypes.has(field.type) || ['date', 'datetime'].includes(field.type) ? comparisonOps : textOps;
    if (!ops.includes(condition.op)) throw failure(`La comparación solicitada no está disponible para «${field.label}».`);
    const output = { field: field.key, op: condition.op };
    if (['isNull', 'notNull'].includes(condition.op)) {
      if ('value' in condition || 'values' in condition) throw failure('Un filtro de datos faltantes no admite un importe.');
    } else if (condition.op === 'between') {
      if ('value' in condition || !Array.isArray(condition.values) || condition.values.length !== 2) throw failure('Indica los dos límites del intervalo.');
      output.values = condition.values.map(value => operand(field, value));
      if (numericTypes.has(field.type) ? scaled(output.values[0]) > scaled(output.values[1]) : output.values[0] > output.values[1]) throw failure('El límite inferior debe ser menor o igual al superior.');
    } else {
      if ('values' in condition || !('value' in condition)) throw failure('El filtro requiere un valor.');
      output.value = operand(field, condition.value);
    }
    return output;
  });
  const groupBy = list(input.groupBy, 4, 'las agrupaciones').map(key => fieldFor(key).key);
  if (new Set(groupBy).size !== groupBy.length) throw failure('Una columna no puede repetirse en las agrupaciones.');
  const measures = list(input.measures, 6, 'los totales').map(measure => {
    object(measure, ['op', 'field'], 'totales');
    if (measure.op === 'count' && !('field' in measure)) return { op: 'count' };
    if (!['sum', 'countDistinct'].includes(measure.op)) throw failure('El tipo de total no está disponible.');
    const field = fieldFor(measure.field);
    if (measure.op === 'sum' && !measureDefinition(entity, field.key)) throw failure(`«${field.label}» no tiene una suma verificada para esta fuente. Puedes consultar su detalle o contar registros.`);
    return { op: measure.op, field: field.key };
  });
  // Monetary fields with an actual currency always expose that dimension,
  // including a null/unknown currency. Never label a foreign amount as MXN.
  for (const measure of measures.filter(item => item.op === 'sum')) {
    const currency = measureDefinition(entity, measure.field).currencyField;
    if (currency && !groupBy.includes(currency)) {
      if (groupBy.length === 4) throw failure('Reserva una agrupación para la moneda de los importes.');
      groupBy.push(currency);
    }
  }
  if (groupBy.length && !measures.length) measures.push({ op: 'count' });
  const orderBy = list(input.orderBy, 2, 'el orden').map(order => {
    object(order, ['field', 'direction'], 'orden');
    const allowed = measures.length ? [...groupBy, ...measures.map((_, index) => `metric_${index}`)] : [...fields.keys()];
    if (!allowed.includes(order.field) || !['asc', 'desc'].includes(order.direction)) throw failure('Revisa la columna y dirección del orden solicitado.');
    return { field: order.field, direction: order.direction };
  });
  if (!predicates.length && !groupBy.length && !measures.length && !orderBy.length) throw failure('Indica al menos un filtro, una agrupación o un total.');
  return { predicates, groupBy, measures, orderBy };
}
function getPointLookup(entity, analysis) {
  const candidates = (entity.pointLookupFields || []).flatMap(field => (analysis?.predicates || []).filter(predicate => predicate.field === field && predicate.op === 'eq'));
  for (const predicate of candidates) {
    const value = Number(predicate.value);
    if (Number.isSafeInteger(value) && value > 0 && value <= 2147483647) return { field: predicate.field, value };
  }
  return null;
}
function requiredAnalysisFields(entity, input) {
  const analysis = validateAnalysis(entity, input);
  if (!analysis) return [];
  return [...new Set([...analysis.predicates.map(c => c.field), ...analysis.groupBy, ...analysis.orderBy.filter(order => !/^metric_\d+$/.test(order.field)).map(order => order.field),
    ...analysis.measures.flatMap(measure => measure.field ? [measure.field, ...(measure.op === 'sum' ? measureDefinition(entity, measure.field).keys : []),
      ...(measure.op === 'sum' && measureDefinition(entity, measure.field).currencyField ? [measureDefinition(entity, measure.field).currencyField] : [])] : [])])];
}
function summary(entity, analysis) {
  const label = key => entity.fields.find(field => field.key === key)?.label || key;
  const operators = { eq: '=', ne: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤', contains: 'contiene', isNull: 'sin información', notNull: 'con información' };
  const conditions = analysis.predicates.map(condition => `${label(condition.field)} ${condition.op === 'between' ? `entre ${condition.values.join(' y ')}` : `${operators[condition.op]}${condition.value == null ? '' : ` ${condition.value}`}`}`);
  const groups = analysis.groupBy.map(label);
  const measures = analysis.measures.map(measure => measure.op === 'count' ? 'Registros' : `${measure.op === 'sum' ? 'Total de' : 'Valores distintos de'} ${label(measure.field)}${measure.op === 'sum' ? ` (${measureDefinition(entity, measure.field).unit})` : ''}`);
  const order = analysis.orderBy.map(item => `${/^metric_\d+$/.test(item.field) ? measures[Number(item.field.slice(7))] : label(item.field)}: ${item.direction === 'asc' ? 'ascendente' : 'descendente'}`);
  return { description: [...conditions, ...(groups.length ? [`Agrupado por ${groups.join(', ')}`] : []), ...measures, ...order].join('; '), conditions, groups, measures, order };
}
function applyAnalysis(entity, result, input, { selectedFields = entity.defaultFields, limit = 10000 } = {}) {
  const analysis = validateAnalysis(entity, input);
  if (!analysis) return result;
  if (result.truncated || result.complete === false || result.analysisScope?.complete === false) throw failure('La fuente supera el alcance de una consulta completa. Reduce el período o los filtros antes de calcular este análisis.');
  const fields = new Map(entity.fields.map(field => [field.key, field]));
  const valueFor = (key, value) => numericTypes.has(fields.get(key).type) ? scaled(value) : ['date', 'datetime'].includes(fields.get(key).type) ? dateValue(value) : value == null || value === '' ? null : String(value).normalize('NFKC').toLocaleLowerCase('es-MX');
  let unknownValues = 0;
  const source = result.data || [];
  const matching = source.filter(row => analysis.predicates.every(condition => {
    const raw = row[condition.field];
    const actual = valueFor(condition.field, raw);
    if (condition.op === 'isNull') return actual == null;
    if (condition.op === 'notNull') return actual != null;
    if (actual == null) { unknownValues++; return false; }
    const expected = condition.value == null ? null : valueFor(condition.field, condition.value);
    switch (condition.op) {
      case 'eq': return actual === expected;
      case 'ne': return actual !== expected;
      case 'gt': return actual > expected;
      case 'gte': return actual >= expected;
      case 'lt': return actual < expected;
      case 'lte': return actual <= expected;
      case 'contains': return actual.includes(expected);
      case 'between': return actual >= valueFor(condition.field, condition.values[0]) && actual <= valueFor(condition.field, condition.values[1]);
      default: return false;
    }
  }));
  // Even an identical duplicate would allocate one financial owner to multiple
  // groups. Refuse instead of deduplicating or distributing its balance.
  for (const measure of analysis.measures.filter(measure => measure.op === 'sum')) {
    const metadata = measureDefinition(entity, measure.field);
    const seen = new Set();
    for (const row of matching) {
      if (metadata.keys.some(key => row[key] == null || row[key] === '')) throw failure('Falta la identificación de un importe. Consulta el detalle antes de totalizar.');
      const owner = metadata.keys.map(key => scaled(row[key]));
      if (owner.some(value => value == null || value < 0n || value % 1000000n !== 0n)) throw failure('No se pudo verificar el identificador de un importe antes de totalizar.');
      const identity = JSON.stringify(owner.map(value => decimal(value)));
      if (seen.has(identity)) throw failure('Un importe aparece en varias filas de la fuente. Consulta el detalle para evitar sumarlo más de una vez.');
      seen.add(identity);
    }
    if (metadata.currencyField && !analysis.groupBy.includes(metadata.currencyField)) {
      const currencies = new Set(matching.map(row => row[metadata.currencyField]).filter(value => value != null && value !== ''));
      if (currencies.size > 1) throw failure('Hay varias monedas. Agrupa también por moneda para obtener totales separados.');
    }
  }
  const analysisSummary = summary(entity, analysis);
  let columns, data, grain = entity.grain;
  if (analysis.measures.length) {
    columns = [...analysis.groupBy.map(key => fields.get(key)), ...analysis.measures.map((measure, index) => ({ key: `metric_${index}`, label: analysisSummary.measures[index],
      type: measure.op === 'sum' ? fields.get(measure.field).type : 'number', align: 'right', width: 210 }))];
    const groups = new Map();
    const empty = () => analysis.measures.map(() => ({ total: 0n, unknown: 0, seen: new Set() }));
    if (!analysis.groupBy.length) groups.set('[]', { row: {}, states: empty() });
    for (const row of matching) {
      const groupValues = analysis.groupBy.map(key => row[key] ?? null);
      const key = JSON.stringify(analysis.groupBy.map((field, index) => numericTypes.has(fields.get(field).type) && scaled(groupValues[index]) != null
        ? ['number', decimal(scaled(groupValues[index]))] : [typeof groupValues[index], groupValues[index]]));
      if (!groups.has(key)) groups.set(key, { row: Object.fromEntries(analysis.groupBy.map((field, i) => [field, groupValues[i]])), states: empty() });
      const group = groups.get(key);
      analysis.measures.forEach((measure, index) => {
        const state = group.states[index];
        if (measure.op === 'count') state.total++;
        else if (measure.op === 'countDistinct') {
          const raw = row[measure.field];
          const numeric = numericTypes.has(fields.get(measure.field).type);
          const value = numeric ? scaled(raw) : raw;
          if (value != null && value !== '') state.seen.add(JSON.stringify(numeric ? decimal(value) : value));
          else state.unknown++;
        } else {
          const metadata = measureDefinition(entity, measure.field);
          const amount = scaled(row[measure.field]);
          if (amount == null || metadata.currencyField && !row[metadata.currencyField]) state.unknown++;
          else state.total += amount;
        }
      });
    }
    data = [...groups.values()].map(group => {
      analysis.measures.forEach((measure, index) => {
        const state = group.states[index];
        unknownValues += state.unknown;
        group.row[`metric_${index}`] = measure.op === 'sum' ? state.unknown ? null : decimal(state.total) : measure.op === 'countDistinct' ? state.seen.size : Number(state.total);
      });
      return group.row;
    });
    grain = analysis.groupBy.length ? `Una fila por combinación de ${analysisSummary.groups.join(', ')}. Los totales corresponden a los registros que cumplen los filtros.` : 'Una fila con los totales de los registros que cumplen los filtros.';
  } else { columns = selectedFields.map(key => fields.get(key)).filter(Boolean); data = matching.slice(); }
  data.sort((left, right) => {
    for (const order of analysis.orderBy) {
      const output = columns.find(field => field.key === order.field) || fields.get(order.field);
      const a = left[order.field], b = right[order.field];
      if (a == null || b == null) { if (a == null && b != null) return 1; if (a != null && b == null) return -1; continue; }
      const av = numericTypes.has(output.type) ? scaled(a) : String(a);
      const bv = numericTypes.has(output.type) ? scaled(b) : String(b);
      const compared = av < bv ? -1 : av > bv ? 1 : 0;
      if (compared) return order.direction === 'asc' ? compared : -compared;
    }
    return 0;
  });
  if (!analysis.measures.length) data = data.map(row => Object.fromEntries(columns.map(field => [field.key, row[field.key] ?? null])));
  const outputRows = data.length;
  const effectiveLimit = Math.max(1, Math.min(10000, Number.isInteger(Number(limit)) ? Number(limit) : 10000));
  const kpis = [{ label: 'Registros que cumplen los filtros', value: matching.length.toLocaleString('es-MX'), color: '#004687' }];
  if (analysis.measures.length) kpis.push({ label: 'Grupos del reporte', value: outputRows.toLocaleString('es-MX'), color: '#0088C9' });
  if (unknownValues) kpis.push({ label: 'Valores sin información para el análisis', value: unknownValues.toLocaleString('es-MX'), color: '#D97706' });
  return { ...result, data: data.slice(0, effectiveLimit), columnas: columns, kpis, grain, analysis, analysisSummary, limit: effectiveLimit,
    truncated: outputRows > effectiveLimit, totalRegistros: outputRows,
    analysisScope: { complete: true, sourceRows: source.length, matchingRows: matching.length, groups: analysis.measures.length ? outputRows : undefined, unknownValues,
      note: unknownValues ? 'Los totales con importes o moneda sin verificar permanecen sin información; no se sustituyen por cero.' : 'Análisis sobre todos los registros de la consulta, antes del límite de salida.' } };
}

module.exports = { validateAnalysis, getAnalysisCapabilities, requiredAnalysisFields, applyAnalysis, getPointLookup, describeAnalysis: summary };
