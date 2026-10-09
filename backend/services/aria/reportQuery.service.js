'use strict';

const builder = require('../sapQueryBuilder.service');
const assistant = require('../reportAssistant.service');
const { interpretRequest } = require('../reportIntent.service');
const { interpretDates, isFollowup, colloquialText } = require('../reportLanguage.service');
const { checkSapModuleAccess } = require('../../utils/reportAccess');

const PREVIEW_LIMIT = 20;
const QUERY_LIMIT = 200;

function reportIAPermissions(entity) {
  const category = colloquialText(entity.category || '');
  if (entity.id === 'vertical_physicians') return ['ia-busqueda-medicos'];
  if (['item_prices', 'item_master_data', 'price_lists'].includes(entity.id)) return ['ia-almacen', 'ia-farmacia', 'ia-quirofano', 'ia-busqueda-insumos'];
  if (category.includes('quirofano')) return ['ia-quirofano'];
  if (category.includes('farmacia')) return ['ia-farmacia'];
  if (category.includes('productividad') || category.includes('honorarios')) return ['ia-productividad-medica'];
  if (category.includes('hospitalizacion') || category.includes('consulta externa') || category.includes('estudios')) return ['ia-busqueda-pacientes'];
  if (category.includes('catalogos clinicos')) return entity.id.includes('doctor') ? ['ia-busqueda-medicos'] : ['ia-busqueda-pacientes', 'ia-busqueda-insumos'];
  if (/inventario|caducidad|articulo|precios|almacen/.test(category)) return ['ia-almacen', 'ia-farmacia', 'ia-quirofano', 'ia-busqueda-insumos'];
  return ['ia-busqueda-financiera', 'ia-finanzas'];
}

function canUseReport(user, entity) {
  if (!checkSapModuleAccess(user, entity.id, entity)) return false;
  if (user.role === 'ADMIN' || user.role === 'DIRECTOR') return true;
  const permissions = Array.isArray(user.permisos) ? user.permisos : [];
  const explicitIA = permissions.some(permission => typeof permission === 'string' && permission.startsWith('ia-'));
  // A report permission is already an explicit grant; legacy profiles without
  // an IA profile retain precisely those grants, not all reports.
  return !explicitIA || reportIAPermissions(entity).some(permission => permissions.includes(permission));
}

function wantsReport(query, options, catalog, today) {
  const text = colloquialText(query);
  if (/\b(?:cuenta|folio de atencion|paciente(?: numero)?)\s*(?:numero|no|num|#)?\s*\d+\b/.test(text)) return true;
  if (/\b(reporte|reportes|listado|lista|columnas|excel)\b/.test(text)) return true;
  const date = interpretDates(query, today, options.context?.filters || {});
  if ((options.context || options.pending) && (isFollowup(query) || date.requested ||
      /^(?:si|sap|vertical|ambas|ambos|las dos|los dos)\b/.test(text) ||
      /\b(genera|intenta|consulta|reintenta) (?:de )?nuevo\b|\bme refiero a\b|\bel tema que quiero\b/.test(text))) return true;
  const currentOnly = !date.requested || date.range?.fechaDesde === today && date.range?.fechaHasta === today;
  const explicitFields = /\b(con|columnas|incluye|agrega)\b/.test(text);
  // Keep operational shortcuts (pending prescriptions, returns, census, stock)
  // on their existing section grants. Historical/column requests use reports.
  if (options.operationalIntent && options.operationalIntent !== 'cirugias-momento' && currentOnly && !explicitFields) return false;
  const intent = interpretRequest({ message: query, catalog, today });
  if (options.pending && !intent.entity && !intent.proposal?.choices?.length) return true;
  // A historical request must never fall through to a handler for current data.
  return Boolean(intent.entity?.requiresDateFilter && !/\b(del momento|en curso|recientes)\b/.test(text)) ||
    Boolean(intent.entity && /\bcon\b|\b(solo|nomas|unicamente)\b/.test(text)) ||
    date.requested && Boolean(intent.entity || intent.proposal?.choices?.length);
}

const emptyResponse = (message, status = 'unsupported', plan = null) => ({
  topic: 'Consulta con MAR-IA', answer: message, kpis: [], engine: 'guided',
  report: { status, plan, choices: [] },
});

function readableCell(value, field) {
  if (value == null || value === '') return 'Sin información';
  if (typeof value === 'number' || ['money', 'number', 'percent'].includes(field?.type) && typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 'Sin información';
    const formatted = numeric.toLocaleString('es-MX', { maximumFractionDigits: field?.type === 'money' ? 2 : 6 });
    return field?.type === 'money' ? `$${formatted}` : field?.type === 'percent' ? `${formatted}%` : formatted;
  }
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'object') return 'Sin información';
  return String(value).slice(0, 500);
}

async function processReportQuery(query, user, options = {}) {
  const availableCatalog = () => typeof builder.getAssistantCatalog === 'function' ? builder.getAssistantCatalog() : builder.getEntityCatalog();
  const allCatalog = availableCatalog();
  const today = assistant.todayInMexico(options.now || new Date());
  if (!wantsReport(query, options, allCatalog, today)) return null;
  const catalog = allCatalog.filter(entity => canUseReport(user, entity));
  if (!catalog.length) return emptyResponse('Para consultar reportes con MAR-IA necesitas acceso a los temas del generador de reportes. Solicita al área de Sistemas los temas que necesitas.');
  if (options.context?.entity && !catalog.some(entity => entity.id === options.context.entity) &&
      (isFollowup(query) || options.pending || /de nuevo/.test(colloquialText(query)))) {
    return emptyResponse('Tu acceso al reporte anterior cambió. Inicia una nueva consulta con uno de tus temas disponibles.');
  }
  const result = await assistant.prepareReport({ message: query, catalog,
    history: options.history || [], context: options.context, pending: options.pending,
    ...(options.now ? { now: options.now } : {}),
  });
  const report = { status: result.status, plan: result.plan || null, choices: result.choices || [],
    ...(result.options ? { options: result.options } : {}), ...(result.pending ? { pending: result.pending } : {}),
  };
  const response = { topic: result.plan?.entityTitle || 'Consulta con MAR-IA', answer: result.message,
    kpis: [], engine: result.engine, ...(result.notice ? { notice: result.notice } : {}), report };
  if (result.status !== 'ready' || !result.plan) return response;
  const entity = availableCatalog().find(entity => entity.id === result.plan.entity);
  // Recheck after preparing, immediately before any hospital data is read.
  if (!entity || !canUseReport(user, entity)) return emptyResponse('No tienes acceso a este tema. Elige uno de tus temas disponibles.');
  const checked = assistant.validateProposal({ status: 'ready', plan: {
    entity: result.plan.entity, selectedFields: result.plan.selectedFields, filters: result.plan.filters,
    ...(result.plan.analysis ? { analysis: result.plan.analysis } : {}),
  } }, [entity]);
  if (checked.status !== 'ready') return emptyResponse(checked.message, checked.status, checked.plan);
  const plan = checked.plan;
  const { fechaDesde, fechaHasta } = plan.filters;
  if (fechaDesde && fechaHasta && (Date.parse(fechaHasta) - Date.parse(fechaDesde)) / 86400000 > 366) {
    return { ...response, answer: 'Elige un período de hasta 366 días para consultar este reporte.',
      report: { ...report, status: 'clarification', pending: null, plan: { ...plan, filters: { ...plan.filters, fechaDesde: '', fechaHasta: '' } } } };
  }
  try {
    const data = await builder.executeQuery({ entity: plan.entity, selectedFields: plan.selectedFields,
      ...plan.filters, ...(plan.analysis ? { analysis: plan.analysis } : {}), limit: QUERY_LIMIT });
    if (!Array.isArray(data?.data)) throw new Error('Invalid report result');
    const currentEntity = availableCatalog().find(item => item.id === plan.entity);
    if (!currentEntity || !canUseReport(user, currentEntity)) return emptyResponse('Tu acceso a estos datos cambió durante la consulta. Solicita al área de Sistemas que revise tus accesos.');
    const rows = data.data;
    const limited = Boolean(data.truncated) || !data.analysisScope && rows.length >= QUERY_LIMIT;
    const period = fechaDesde && fechaHasta ? `Período: ${fechaDesde.split('-').reverse().join('/')} al ${fechaHasta.split('-').reverse().join('/')}.` : 'Información actual de la cuenta o paciente identificado.';
    const filters = plan.appliedFilters.map(filter => `${filter.label}: ${filter.value}`).join('; ');
    response.answer = `Consulté **${plan.entityTitle}**. ${period}${filters ? `\n${filters}.` : ''}\n\n` +
      (rows.length ? `Se obtuvieron **${rows.length} registros${limited ? ' como máximo en esta consulta' : ''}**. ` +
        (rows.length > PREVIEW_LIMIT ? `Muestro los primeros ${PREVIEW_LIMIT}. ` : '') +
        (limited ? 'Para consultar el detalle completo, usa el generador de reportes. ' : '') +
        'Puedes pedir varios datos, cambiar los filtros o precisar la cuenta en el siguiente mensaje.' : 'No se encontraron registros con estas fechas y filtros. Puedes ajustar la consulta.');
    if (data.grain || entity.grain) response.answer += `\n\n${data.grain || entity.grain}`;
    if (data.analysisSummary?.description) response.answer += `\n${data.analysisSummary.description}.`;
    if (data.analysisScope) response.answer += `\nSe analizaron ${data.analysisScope.sourceRows} registros de la consulta; ${data.analysisScope.matchingRows} cumplen los filtros. ${data.analysisScope.note || ''}`;
    response.report = { ...report, plan, rowCount: rows.length, limited, ...(data.analysisScope ? { analysisScope: data.analysisScope } : {}) };
    response.kpis = data.analysisScope && Array.isArray(data.kpis) ? data.kpis : [{ label: limited ? 'Registros consultados (limitado)' : 'Registros consultados', value: rows.length }];
    const allowedOutput = plan.analysis?.measures?.length ? [...plan.analysis.groupBy, ...plan.analysis.measures.map((_, index) => `metric_${index}`)] : plan.selectedFields;
    const columns = allowedOutput.map(key => (data.columnas || []).find(field => field.key === key) || entity.fields.find(field => field.key === key)).filter(Boolean);
    if (rows.length) response.table = { headers: columns.map(field => field.label),
      rows: rows.slice(0, PREVIEW_LIMIT).map(row => columns.map(field => readableCell(row[field.key], field))) };
    return response;
  } catch (error) {
    return { ...response, answer: error.code === 'REPORT_ANALYSIS_VALIDATION' ? error.message : 'Entendí la consulta, pero no pude obtener los datos en este momento. Puedes reintentar y conservaré las fechas, los filtros y las columnas.',
      report: { ...report, plan, status: 'error' } };
  }
}

module.exports = { processReportQuery, wantsReport, canUseReport, PREVIEW_LIMIT, QUERY_LIMIT };
