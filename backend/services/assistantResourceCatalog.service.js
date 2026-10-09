'use strict';

const manifest = require('../config/assistant-report-resources.json');
const { connectRemoteDB, sql } = require('../config/remote-db');
const sap = require('./sap.service');
const { TOPICS } = require('./reportVocabulary.service');
const catalog = Object.create(null);
const definitions = Object.create(null);
const quoted = value => `[${value.replace(/]/g, ']]')}]`;
const keyOrder = resource => resource.uniqueKeys[0] || [resource.fields[0].key];
const preferred = ['PCNum', 'PTNum', 'FullName', 'AGCode', 'AGName', 'BPCode', 'BPName', 'PC_ST', 'PCAG_ST', 'GlobalDiscount',
  'DocNum', 'DocDate', 'CardCode', 'CardName', 'PriceListNum', 'PriceListName', 'DiscountPercent', 'DocTotal', 'Balance', 'Total'];
const fieldMetadata = ({ sourceType: _type, ...field }) => ({ ...field, width: ['money', 'number', 'percent'].includes(field.type) ? 160 : 220 });
const commonAliases = { BusinessPartners: 'business_partners', Invoices: 'sales_invoice_summary', CreditNotes: 'credit_memos',
  PurchaseInvoices: 'purchase_invoice_summary', IncomingPayments: 'incoming_payments', VendorPayments: 'outgoing_payments',
  JournalEntries: 'journal_entries', ChartOfAccounts: 'chart_accounts', PriceLists: 'item_prices', ProfitCenters: 'cost_centers' };
function add(resource, relation) {
  const base = resource;
  const target = relation && manifest.resources.find(item => item.id === relation.target);
  const id = target ? `${base.id}__related__${relation.name}` : base.id;
  const fields = base.fields.map(fieldMetadata);
  if (target) fields.push(...target.fields.map(column => ({ ...fieldMetadata(column), key: `related_${target.object}_${column.key}`,
    label: `${column.label} · ${target.title}` })));
  const defaults = preferred.filter(key => fields.some(field => field.key === key)).slice(0, 10);
  if (!defaults.length) defaults.push(...fields.slice(0, 8).map(field => field.key));
  catalog[id] = { id, assistantOnly: true, resourceMetadata: true, source: base.source,
    title: target ? `${base.title} con ${target.title}` : base.title,
    description: `Datos disponibles para solicitudes específicas. ${base.dateField ? `El período filtra ${base.fields.find(field => field.key === base.dateField).label}; los estados y saldos son actuales.` : 'Información actual; no reconstruye cortes históricos.'}`,
    aliases: target ? base.aliases.map(alias => `${alias} con ${target.title}`) : [...base.aliases, ...(base.source === 'SAP' ? TOPICS[commonAliases[base.endpoint]] || [] : [])],
    category: 'Recursos financieros y administrativos', requiresDateFilter: Boolean(base.dateField),
    dateFieldLabel: base.fields.find(field => field.key === base.dateField)?.label,
    fields, defaultFields: defaults, filters: [], summary: {},
    grain: `Una fila del recurso ${base.title}. ${target ? 'La relación admite como máximo una coincidencia y conserva filas sin vínculo. ' : ''}Los importes conservan su significado original; no se suman automáticamente.`,
    requiredPermissions: [base.source === 'SAP' ? 'assistant_sap_resources' : 'assistant_vertical_resources'] };
  definitions[id] = { base, target, relation };
}
for (const resource of manifest.resources) add(resource);
for (const relation of manifest.relationships) add(manifest.resources.find(item => item.id === relation.source), relation);

function date(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
function civilDate(value) {
  if (!(value instanceof Date)) return value;
  const pad = value => String(value).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}
function validate(id, options) {
  const definition = definitions[id];
  if (!definition) throw new Error('El recurso solicitado no está disponible.');
  const metadata = catalog[id];
  const fields = options.selectedFields?.length ? [...new Set(options.selectedFields)] : metadata.defaultFields;
  if (!Array.isArray(fields) || !fields.length || fields.some(key => !metadata.fields.some(field => field.key === key))) throw new Error('La selección de datos no pertenece al recurso solicitado.');
  const searchFields = options.searchFields == null ? fields : options.searchFields;
  if (!Array.isArray(searchFields) || !searchFields.length || searchFields.some(key => !fields.includes(key))) throw new Error('Los campos de búsqueda no son válidos.');
  const limit = options.limit ?? 10000;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Error('El límite debe estar entre 1 y 10000 registros.');
  if (options.busqueda != null && (typeof options.busqueda !== 'string' || options.busqueda.length > 200)) throw new Error('Usa una búsqueda de hasta 200 caracteres.');
  if (definition.base.dateField && (!date(options.fechaDesde) || !date(options.fechaHasta) || options.fechaDesde > options.fechaHasta
    || (Date.parse(options.fechaHasta) - Date.parse(options.fechaDesde)) / 86400000 > 366)) throw new Error('Indica un período válido de hasta 366 días.');
  return { definition, metadata, fields, searchFields, limit };
}

async function executeVertical(validated, options) {
  const { definition: { base, target, relation }, fields, searchFields, limit } = validated;
  const expression = key => base.fields.some(field => field.key === key) ? `v.${quoted(key)}`
    : `r.${quoted(key.slice(`related_${target.object}_`.length))}`;
  const pool = await connectRemoteDB();
  const request = pool.request().input('rowLimit', sql.Int, limit + 1);
  const conditions = [];
  if (base.dateField) {
    request.input('fechaDesde', sql.VarChar(10), options.fechaDesde).input('fechaHasta', sql.VarChar(10), options.fechaHasta);
    conditions.push(`v.${quoted(base.dateField)} >= CAST(@fechaDesde AS date)`, `v.${quoted(base.dateField)} < DATEADD(day,1,CAST(@fechaHasta AS date))`);
  }
  if (options.busqueda?.trim()) {
    request.input('busqueda', sql.NVarChar(402), `%${options.busqueda.trim().replace(/[\\%_[]/g, '\\$&')}%`);
    conditions.push(`(${searchFields.map(key => `CONVERT(nvarchar(4000),${expression(key)},126) LIKE @busqueda ESCAPE '\\'`).join(' OR ')})`);
  }
  const from = `${quoted(base.schema)}.${quoted(base.object)} v${target ? ` LEFT JOIN ${quoted(target.schema)}.${quoted(target.object)} r ON ${relation.columns.map(([source, destination]) => `v.${quoted(source)} = r.${quoted(destination)}`).join(' AND ')}` : ''}`;
  const result = await request.query(`SELECT TOP (@rowLimit) ${fields.map(key => `${expression(key)} AS ${quoted(key)}`).join(',')}
    FROM ${from} ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    ORDER BY ${keyOrder(base).map(key => /^(n?text)$/i.test(base.fields.find(field => field.key === key).sourceType) ? `CONVERT(nvarchar(4000),v.${quoted(key)})` : `v.${quoted(key)}`).join(',')}`);
  const rows = result.recordset || [];
  return { rows: rows.slice(0, limit).map(row => Object.fromEntries(fields.map(key => [key, civilDate(row[key])]))), truncated: rows.length > limit };
}

function nextPath(link, endpoint) {
  const path = String(link).replace(/^https?:\/\/[^/]+\/b1s\/v[12]\//, '/').replace(/^\/?b1s\/v[12]\//, '/');
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (!normalized.startsWith(`/${endpoint}?`) || /[\r\n]/.test(normalized)) throw new Error('SAP devolvió una continuación no válida.');
  return normalized;
}
async function executeSap(validated, options) {
  const { definition: { base }, fields, searchFields, limit } = validated;
  const query = [`$select=${encodeURIComponent(fields.join(','))}`, `$orderby=${encodeURIComponent(keyOrder(base).join(','))}`];
  if (base.dateField) query.push(`$filter=${encodeURIComponent(`${base.dateField} ge '${options.fechaDesde}' and ${base.dateField} le '${options.fechaHasta}'`)}`);
  if (query.join('&').length > 1800) throw new Error('Esta selección reúne demasiadas columnas para una sola consulta. Elige menos datos y vuelve a generar el reporte.');
  let path = `/${base.endpoint}?${query.join('&')}`;
  const seen = new Set(), rows = [];
  const search = options.busqueda?.trim().toLocaleLowerCase('es-MX');
  let scanned = 0;
  while (path) {
    if (seen.has(path)) throw new Error('SAP repitió una página de resultados.');
    if (seen.size >= 100) return { rows, truncated: true };
    seen.add(path);
    const response = await sap.get(path, { Prefer: 'odata.maxpagesize=200' });
    if (!Array.isArray(response.data?.value)) throw new Error('No se pudo leer la información del recurso SAP.');
    for (const document of response.data.value) {
      scanned++;
      const row = Object.fromEntries(fields.map(key => [key, document[key] ?? null]));
      if (!search || searchFields.some(key => row[key] != null && String(row[key]).toLocaleLowerCase('es-MX').includes(search))) rows.push(row);
      if (rows.length > limit) return { rows: rows.slice(0, limit), truncated: true };
    }
    const link = response.data['@odata.nextLink'] || response.data['odata.nextLink'];
    if (link && scanned >= 20000) return { rows, truncated: true };
    path = link ? nextPath(link, base.endpoint) : null;
  }
  return { rows, truncated: false };
}
async function execute(id, options = {}) {
  const validated = validate(id, options);
  try { return await (validated.definition.base.source === 'SAP' ? executeSap(validated, options) : executeVertical(validated, options)); }
  catch (error) {
    if (error.code || error.status) throw new Error('No se pudo consultar este recurso en el sistema de origen. Intenta de nuevo o pide otro período.');
    throw error;
  }
}
module.exports = { catalog, execute };
