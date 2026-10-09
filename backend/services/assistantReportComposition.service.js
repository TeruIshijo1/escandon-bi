'use strict';

// Assistant capabilities describe permitted relationships, rather than cards in
// the manual topic picker. SQL/OData expressions never come from the model.
const sapCatalog = require('./sapReportCatalog.service');
const { TOPICS } = require('./reportVocabulary.service');
const resourceCatalog = require('./assistantResourceCatalog.service');
const accountFinance = require('./assistantAccountFinance.service');
const accountCase = require('./assistantAccountCase.service');
const priceLists = require('./assistantPriceLists.service');
const verticalSources = () => require('./assistantVerticalSources.service');
const relations = [
  { target: 'customers', key: 'BPCode', targetKey: 'CardCode', bases: [
    'assistant_commercial_agreements', 'assistant_patient_accounts', 'vertical_accounts',
    'vertical_sales_orders', 'vertical_service_orders'
  ] },
  { target: 'item_master_data', key: 'ItemCode', targetKey: 'ItemCode', bases: [
    'vertical_account_charges', 'vertical_clinical_supply_tickets', 'vertical_clinical_return_tickets'
  ] }
];
const prefix = target => `sap_${target}_`;
const mixedId = (base, target) => `assistant_join__${base}__${target}`;
const incomplete = result => Boolean(result.truncated || result.complete === false || result.analysisScope?.complete === false);

function createCatalog(manualCatalog) {
  const sources = { ...manualCatalog, ...verticalSources().catalog, ...resourceCatalog.catalog };
  const catalog = { ...verticalSources().catalog, ...resourceCatalog.catalog, ...accountFinance.catalog, ...accountCase.catalog, ...priceLists.catalog };
  for (const relation of relations) for (const baseId of [...new Set([...relation.bases,
    ...Object.values(resourceCatalog.catalog).filter(entity => entity.source === 'Vertical' && entity.fields.some(field => field.key === relation.key)).map(entity => entity.id)])]) {
    const base = sources[baseId], target = sapCatalog.catalog[relation.target];
    if (!base || !target || !base.fields.some(field => field.key === relation.key)) continue;
    const id = mixedId(baseId, relation.target);
    const fields = target.fields.map(field => ({ ...field, key: `${prefix(relation.target)}${field.key}`,
      label: relation.target === 'customers' ? ({ CardCode: 'Código del pagador en SAP', CardName: 'Cliente / aseguradora en SAP',
        CurrentAccountBalance: 'Saldo actual del pagador en SAP', FederalTaxID: 'RFC del pagador en SAP',
        PriceListNum: 'Lista de precios del pagador en SAP' }[field.key] || `${field.label} del pagador en SAP`)
        : `${field.label} en SAP` }));
    catalog[id] = { ...base, id, assistantOnly: true, source: 'SAP + Vertical', sources: ['SAP', 'Vertical'],
      title: `${base.title} con ${relation.target === 'customers' ? 'datos del pagador en SAP' : 'datos del artículo en SAP'}`,
      description: `${base.description} Se relaciona por código exacto con SAP. Los saldos del pagador son actuales y no representan la deuda del paciente.`,
      aliases: (base.aliases || TOPICS[base.id] || []).map(alias => `${alias} con SAP`),
      requiredPermissions: [...new Set([...(base.requiredPermissions || [baseId]), relation.target])],
      fields: [...base.fields, ...fields, { key: 'SAPLinkStatus', label: 'Relación con SAP', type: 'string', width: 180 }],
      defaultFields: [...base.defaultFields, `${prefix(relation.target)}${relation.target === 'customers' ? 'CardName' : 'ItemName'}`],
      // There is no cross-system monetary total: amounts keep their own units.
      summary: {}, composition: { base: baseId, target: relation.target }
    };
  }
  return catalog;
}

async function execute(entity, options, catalog, executeBase) {
  const definition = catalog[entity];
  if (!definition) throw new Error('La combinación solicitada no está disponible.');
  if (Object.keys(options).some(key => !['selectedFields', 'searchFields', 'pointLookup', 'fechaDesde', 'fechaHasta', 'almacen', 'proveedor', 'busqueda', 'estatusDoc', 'clasificacionMedica', 'limit'].includes(key))) throw new Error('La configuración del reporte no es válida.');
  const fields = options.selectedFields?.length ? [...new Set(options.selectedFields)] : definition.defaultFields;
  if (!Array.isArray(fields) || !fields.length || fields.some(key => !definition.fields.some(field => field.key === key))) throw new Error('Alguna columna solicitada no está disponible para este reporte.');
  if (options.searchFields != null && (!Array.isArray(options.searchFields) || !options.searchFields.length
    || options.searchFields.some(key => !fields.includes(key)))) throw new Error('Los campos de búsqueda no son válidos.');
  if ((options.busqueda || '').length > 200) throw new Error('Usa una búsqueda de hasta 200 caracteres.');
  for (const key of ['almacen', 'estatusDoc', 'clasificacionMedica']) {
    if (options[key] && options[key] !== 'ALL' && !definition.filters?.includes(key)) throw new Error('Ese filtro no está disponible para este reporte.');
  }
  if (!definition.requiresDateFilter && (options.fechaDesde || options.fechaHasta)) throw new Error('Este recurso muestra información actual y no admite un período histórico.');
  let result;
  if (!definition.composition) result = accountCase.catalog[entity] ? await accountCase.execute(entity, options)
    : accountFinance.catalog[entity] ? await accountFinance.execute(entity, options)
    : priceLists.catalog[entity] ? await priceLists.execute(entity, options)
    : resourceCatalog.catalog[entity] ? await resourceCatalog.execute(entity, options) : await verticalSources().execute(entity, options);
  else {
    const { base, target } = definition.composition;
    const relation = relations.find(item => item.target === target && (item.bases.includes(base) || resourceCatalog.catalog[base]?.fields.some(field => field.key === item.key)));
    if (!relation) throw new Error('No existe una relación comprobada para esos datos.');
    // Search follows enrichment, so a payer's RFC or SAP name is searchable.
    const requestedBaseFields = fields.filter(key => !key.startsWith(prefix(target)) && key !== 'SAPLinkStatus');
    const baseOptions = { ...options, selectedFields: [...new Set([relation.key, ...requestedBaseFields])], busqueda: '', limit: 10000 };
    if (options.searchFields) {
      const baseSearchFields = options.searchFields.filter(key => requestedBaseFields.includes(key));
      if (baseSearchFields.length) baseOptions.searchFields = baseSearchFields;
      else delete baseOptions.searchFields;
    }
    const baseResult = verticalSources().catalog[base] ? await verticalSources().execute(base, baseOptions)
      : resourceCatalog.catalog[base] ? await resourceCatalog.execute(base, baseOptions) : await executeBase({ entity: base, ...baseOptions });
    const baseRows = baseResult.rows || baseResult.data;
    const values = [...new Set(baseRows.map(row => row[relation.key]).filter(value => value != null && String(value).trim() !== '').map(String))];
    const lookup = await sapCatalog.lookup(target, relation.targetKey, values);
    if (incomplete(lookup)) throw new Error('No se pudo completar la relación con SAP. Reduce el período y vuelve a intentarlo.');
    const index = new Map();
    for (const row of lookup.rows) {
      const key = String(row[relation.targetKey]);
      if (index.has(key)) throw new Error('SAP devolvió más de un registro para el mismo código. No pude relacionarlo de forma segura.');
      index.set(key, row);
    }
    const enriched = baseRows.map(row => {
      const linked = row[relation.key] == null ? null : index.get(String(row[relation.key]));
      return { ...row, ...Object.fromEntries(sapCatalog.catalog[target].fields.map(field => [`${prefix(target)}${field.key}`, linked?.[field.key] ?? null])),
        SAPLinkStatus: linked ? 'Vinculado por código' : 'Sin vínculo en SAP' };
    });
    const search = (options.busqueda || '').trim().toLocaleLowerCase('es-MX');
    const matching = search ? enriched.filter(row => (options.searchFields ? options.searchFields.map(key => row[key]) : Object.values(row)).some(value => value != null && String(value).toLocaleLowerCase('es-MX').includes(search))) : enriched;
    result = { rows: matching.slice(0, options.limit), truncated: Boolean(incomplete(baseResult) || matching.length > options.limit) };
  }
  result = { ...result, truncated: incomplete(result) };
  const data = result.rows.map(row => Object.fromEntries(definition.fields.map(field => [field.key, row[field.key] ?? null])));
  return { entity, entityTitle: definition.title, source: definition.source, grain: definition.grain,
    ejecutadoEn: new Date().toISOString(), totalRegistros: data.length, data, limit: options.limit,
    requestedFilters: { fechaDesde: options.fechaDesde || '', fechaHasta: options.fechaHasta || '', busqueda: options.busqueda || '', estatusDoc: options.estatusDoc || 'ALL' },
    truncated: result.truncated, message: result.message || (result.truncated ? 'Se alcanzó el límite de consulta; los resultados pueden estar incompletos. Reduce el período o ajusta los filtros.' : null),
    loadedFields: definition.resourceMetadata ? fields : definition.fields.map(field => field.key),
    columnas: fields.map(key => definition.fields.find(field => field.key === key)),
    kpis: [{ label: 'Total Registros', value: data.length.toLocaleString('es-MX'), color: '#004687' }] };
}

async function executeSafely(...args) {
  try { return await execute(...args); }
  catch (error) {
    if (error.code || error.error || error.status >= 500 || [401,403].includes(error.status)) throw new Error('No se pudo completar la consulta en el sistema de origen. Intenta de nuevo o reduce el período.');
    throw error;
  }
}
module.exports = { createCatalog, execute: executeSafely };
