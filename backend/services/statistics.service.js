'use strict';

const { getClinicalStatistics, getAccountClassifications } = require('./statisticsVertical.service');
const { getFinancialStatistics } = require('./statisticsSap.service');
const { SECTIONS, BY_ID } = require('./statisticsCatalog');
const { ACTIVE_START, dateRange, monthRange, hospitalToday, invalid, roundMoney } = require('./statisticsCommon');
const history = require('../data/excel_stats_history.json');
const manualControls = require('../data/statistics_manual_controls.json');
const cache = new Map();
const TTL = 120000;

function pruneCache(limit) {
  // Pending requests are also the deduplication registry. Removing one does
  // not stop its source read and would let a retry start that same read again.
  for (const [key, entry] of cache) {
    if (cache.size <= limit) break;
    if (entry.expires !== Infinity) cache.delete(key);
  }
}

const sum = (rows, key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
const money = (rows, key) => roundMoney(sum(rows, key));
const hasDoctorName = value => Boolean(String(value || '').trim()) && !/^sin (identificar|m[eé]dico identificado)$/i.test(String(value).trim());
const normalizedName = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
function mergeClassification(row, account) {
  if (!account) return row;
  const result = { ...row, TipoAtencion: row.TipoAtencion || account.TipoAtencion };
  // Médico es una identidad completa. No emparejar un nombre SAP con el ID de otro tratante.
  if (!hasDoctorName(row.Medico) && !row.NumeroMedico) {
    result.Medico = account.Medico;
    result.NumeroMedico = account.NumeroMedico;
  } else if (row.NumeroMedico && String(row.NumeroMedico) === String(account.NumeroMedico) && !hasDoctorName(row.Medico)) {
    result.Medico = account.Medico;
  } else if (!row.NumeroMedico && hasDoctorName(row.Medico) && normalizedName(row.Medico) === normalizedName(account.Medico)) {
    result.NumeroMedico = account.NumeroMedico;
  }
  return result;
}
function sourceDate(value) {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  return String(value || '').slice(0, 10);
}
const inRange = (rows, range) => rows.filter(row => sourceDate(row.Fecha) >= range.startDate && sourceDate(row.Fecha) < range.endExclusive);

function measured(rows, unit, criterion, measure = 'Cantidad', warnings = []) {
  return { rows, unit, criterion, quantity: measure === 'IngresoNeto' ? money(rows, measure) : sum(rows, measure), measure, warnings };
}

function topDoctors(documents, type) {
  const groups = new Map();
  for (const doc of documents.filter(d => d.TipoAtencion === type && hasDoctorName(d.Medico))) {
    const name = String(doc.Medico || '').trim() || 'Sin médico identificado';
    const key = doc.NumeroMedico ? `id:${doc.NumeroMedico}` : `nombre:${name}`;
    if (!groups.has(key)) groups.set(key, { Medico: name, NumeroMedico: doc.NumeroMedico || null, IngresoTotal: 0, Ordenes: 0, accounts: new Set() });
    const row = groups.get(key);
    row.IngresoTotal += Number(doc.TotalOrdenVenta || 0);
    row.Ordenes++;
    if (doc.FolioAtencion) row.accounts.add(String(doc.FolioAtencion));
  }
  return [...groups.values()].sort((a, b) => b.IngresoTotal - a.IngresoTotal || a.Medico.localeCompare(b.Medico, 'es') || String(a.NumeroMedico).localeCompare(String(b.NumeroMedico)))
    .slice(0, 10).map(({ accounts, ...row }, index) => ({ Ranking: index + 1, ...row, IngresoTotal: roundMoney(row.IngresoTotal), Cuentas: accounts.size }));
}

function financialSections(financial, range) {
  const rows = inRange(financial.rows || [], range);
  const billedRows = financial.billing ? inRange(financial.billing.rows, range) : null;
  const documents = inRange(financial.documents || [], range);
  const criterion = 'Órdenes de venta vigentes de SAP, por fecha de documento; incluye abiertas y cerradas, excluye canceladas. Importes de líneas sin IVA y después de descuentos. No representa cobros ni facturación.';
  const billingCriterion = 'Facturas menos notas de crédito vigentes de SAP, por fecha de contabilización; excluye documentos cancelados. Importes netos sin IVA y después de descuentos.';
  const studiesNote = 'Unidades facturadas menos unidades de notas de crédito, incluidos pacientes externos. Un paquete cuenta como una unidad; no se desglosa en pruebas. No acredita por sí solo la realización del estudio.';
  const result = {};
  for (const [key, category, label] of [['image', 'imagen', 'imagenología'], ['lab', 'laboratorio', 'laboratorio']]) {
    const matching = (billedRows || []).filter(row => row.Categoria === category);
    result[key] = measured(matching, 'estudios facturados netos', `${billingCriterion} Servicios de ${label}.`, 'Cantidad', [studiesNote]);
    result[`${key}Income`] = measured(matching, 'MXN', billingCriterion, 'IngresoNeto');
    if (!billedRows) {
      for (const section of [result[key], result[`${key}Income`]]) {
        section.quantity = null;
        section.warnings.push('No se consultó la facturación y sus notas de crédito para este periodo.');
      }
    }
  }
  for (const [key, type] of [['hospitalDoctors', 'IP'], ['emergencyDoctors', 'ER']]) {
    const ranking = topDoctors(documents, type);
    result[key] = measured(ranking, 'MXN', 'Top 10 por suma del total de órdenes de venta vigentes, con IVA si aplica, por fecha de documento. Cada orden se cuenta una vez y se atribuye al médico registrado; misma base que las hojas manuales.', 'IngresoTotal');
    result[key].quantity = money(ranking, 'IngresoTotal');
  }
  const shock = rows.filter(row => row.Categoria === 'choque' && Number(row.Cantidad) > 0);
  const seen = new Set();
  const shockAccounts = shock.filter(row => {
    if (!row.FolioAtencion || seen.has(String(row.FolioAtencion))) return false;
    seen.add(String(row.FolioAtencion)); return true;
  }).map(row => ({ FolioAtencion: row.FolioAtencion, Fecha: row.Fecha, Cantidad: 1, Servicio: 'Sala de choque' }));
  result.shock = measured(shockAccounts, 'atenciones', 'Atenciones con servicio de sala de choque en órdenes vigentes del periodo; una vez por atención. El nombre institucional del indicador no acredita el desenlace clínico.');
  if (shock.some(row => !row.FolioAtencion)) result.shock.warnings.push('Hay servicios de sala de choque sin folio de atención; no se incluyeron en el conteo de atenciones.');
  result.specialty = measured(rows.filter(row => row.Categoria === 'consulta'), 'consultas registradas', 'Servicios específicos de consulta de especialidad en órdenes de venta vigentes, por fecha de documento. Excluye rentas, insumos e interconsultas.', 'Cantidad', ['Un servicio registrado no acredita por sí solo que la consulta haya concluido.']);
  return result;
}

async function enrichFinancial(financial) {
  const docs = financial.documents || [];
  const unresolved = [...(financial.rows || []), ...docs].filter(row => row.FolioAtencion && (!row.TipoAtencion || !hasDoctorName(row.Medico) || !row.NumeroMedico));
  const classifications = unresolved.length ? await getAccountClassifications(unresolved.map(row => row.FolioAtencion)) : {};
  const enrich = row => {
    const account = classifications[String(row.FolioAtencion)];
    return mergeClassification(row, account);
  };
  return { ...financial, rows: (financial.rows || []).map(enrich), documents: docs.map(enrich) };
}

async function loadSources(range) {
  const key = `${range.startDate}:${range.endDate}`;
  const current = cache.get(key);
  if (current && current.expires > Date.now()) return current.promise;
  const promise = Promise.all([getClinicalStatistics(range), getFinancialStatistics({ ...range, includeBilling: true })])
    .then(async ([clinical, rawFinancial]) => ({ clinical, financial: await enrichFinancial(rawFinancial) }));
  const entry = { expires: Infinity, promise };
  cache.set(key, entry);
  pruneCache(3);
  try { const result = await promise; entry.expires = Date.now() + TTL; pruneCache(3); return result; }
  catch (error) { if (cache.get(key) === entry) cache.delete(key); throw error; }
}

async function loadHistorySource(range, key) {
  const financialKey = ['shock', 'specialty', 'image', 'imageIncome', 'lab', 'labIncome', 'hospitalDoctors', 'emergencyDoctors'].includes(key);
  const billing = ['image', 'imageIncome', 'lab', 'labIncome'].includes(key);
  const cacheKey = `history:${financialKey ? billing ? 'billing' : 'orders' : 'clinical'}:${range.startDate}:${range.endDate}`;
  const current = cache.get(cacheKey);
  if (current && current.expires > Date.now()) return current.promise;
  const promise = financialKey ? getFinancialStatistics({ ...range, includeBilling: billing, includeOrders: !billing }).then(enrichFinancial) : getClinicalStatistics(range);
  const entry = { expires: Infinity, promise };
  cache.set(cacheKey, entry);
  pruneCache(5);
  try { const result = await promise; entry.expires = Date.now() + TTL; pruneCache(5); return result; }
  catch (error) { if (cache.get(cacheKey) === entry) cache.delete(cacheKey); throw error; }
}

function assembleReport(range, { clinical, financial }) {
  const sections = { ...clinical.sections, ...financialSections(financial, range) };
  const warnings = [...new Set([...(clinical.warnings || []), ...(financial.warnings || []), ...(financial.billing?.warnings || []), ...SECTIONS.flatMap(({ key }) => sections[key]?.warnings || [])])];
  const missingDoctorDocuments = (financial.documents || []).filter(d => ['IP', 'ER'].includes(d.TipoAtencion) && !hasDoctorName(d.Medico));
  const missingDoctors = missingDoctorDocuments.length;
  if (missingDoctors) warnings.push(`${missingDoctors} órdenes, por ${money(missingDoctorDocuments, 'TotalOrdenVenta').toFixed(2)} MXN, no tienen médico identificado y no se asignaron a los Top 10.`);
  const unknownType = (financial.documents || []).filter(d => d.FolioAtencion && !d.TipoAtencion).length;
  if (unknownType) warnings.push(`${unknownType} órdenes con atención no tienen tipo confirmado y no se asignaron a los Top 10.`);
  const fullMonth = monthRange(range.startDate.slice(0, 4), Number(range.startDate.slice(5, 7)));
  const controls = range.startDate === fullMonth.startDate && range.endDate === fullMonth.endDate
    ? manualControls.controls.filter(control => control.month === range.startDate.slice(0, 7)).map(control => {
      const actual = control.key === 'hospitalOrders' ? money(financial.documents.filter(d => d.TipoAtencion === 'IP'), 'TotalOrdenVenta')
        : control.key === 'emergencyOrders' ? money(financial.documents.filter(d => d.TipoAtencion === 'ER'), 'TotalOrdenVenta') : sections[control.key].quantity;
      return { Indicador: control.label, Manual: control.value, Generado: actual, Diferencia: actual === null ? null : roundMoney(actual - control.value), Unidad: control.unit, Referencia: control.source };
    }) : [];
  const discrepancies = controls.filter(control => control.Diferencia !== null && control.Diferencia !== 0);
  if (discrepancies.length) warnings.push('El periodo tiene diferencias con el archivo manual de referencia. Consulta Conciliación manual antes de enviar el estadístico; no se aplicaron ajustes para forzar los totales.');
  const financialCriterion = 'Los Top 10 reproducen el total de órdenes de venta vigentes de los archivos manuales, con IVA si aplica, por fecha de documento. Imagen y laboratorio usan facturas menos notas de crédito, sin IVA, por fecha de contabilización. Cada base se concilia por separado; no se suman órdenes y facturas entre sí.';
  return {
    period: range, generatedAt: new Date().toISOString(), sections, warnings, financialCriterion, controls,
    doctorDocuments: financial.documents.filter(d => ['IP', 'ER'].includes(d.TipoAtencion) || d.AtencionesMultiples).map(d => ({
      Fecha: d.Fecha, Documento: d.Documento, FolioAtencion: d.FolioAtencion, TipoAtencion: d.TipoAtencion,
      Medico: d.Medico, NumeroMedico: d.NumeroMedico, IngresoTotal: d.TotalOrdenVenta,
      IVA: d.IVA, EstadoDocumento: d.EstadoDocumento, AtencionesMultiples: d.AtencionesMultiples ? 'Sí' : 'No'
    })),
    general: { ...clinical.general, Nacimientos: sections.births.quantity, VidasSalvadas: sections.shock.quantity },
    reconciliation: [
      { label: 'Órdenes de hospitalización', description: `${financial.documents.filter(d => d.TipoAtencion === 'IP').length} órdenes; total ${money(financial.documents.filter(d => d.TipoAtencion === 'IP'), 'TotalOrdenVenta').toFixed(2)} MXN. El Top 10 puede ser menor porque sólo incluye diez médicos.` },
      { label: 'Órdenes de urgencias', description: `${financial.documents.filter(d => d.TipoAtencion === 'ER').length} órdenes; total ${money(financial.documents.filter(d => d.TipoAtencion === 'ER'), 'TotalOrdenVenta').toFixed(2)} MXN. El Top 10 puede ser menor porque sólo incluye diez médicos.` },
      { label: 'Órdenes sin médico identificado', description: `${missingDoctors} órdenes, por ${money(missingDoctorDocuments, 'TotalOrdenVenta').toFixed(2)} MXN, se conservan fuera de los Top 10.` },
      { label: 'Cargos clínicos de imagen', description: `${clinical.sections.image?.quantity ?? 'No disponible'} unidades en cuentas; es un control separado de la facturación, que también incluye pacientes externos.` },
      { label: 'Cargos clínicos de laboratorio', description: `${clinical.sections.lab?.quantity ?? 'No disponible'} unidades en cuentas; no se suman nuevamente a la facturación.` }
    ],
    _financial: financial
  };
}

async function getReport(startDate, endDate) {
  const range = dateRange(startDate, endDate);
  if (range.endDate > hospitalToday()) throw invalid('La fecha final no puede ser posterior a hoy.');
  return assembleReport(range, await loadSources(range));
}

async function getHistory(sectionId) {
  const definition = BY_ID[sectionId];
  if (!definition) throw invalid('Selecciona un estadístico válido.');
  const today = hospitalToday();
  const currentYear = Number(today.slice(0, 4));
  const data = JSON.parse(JSON.stringify(history[sectionId] || {}));
  const warnings = [];
  let criterion = '', unit = definition.unit;
  for (let year = 2026; year <= currentYear; year++) {
    data[year] ||= {};
    const firstMonth = year === 2026 ? 4 : 1;
    const startDate = `${year}-${String(firstMonth).padStart(2, '0')}-01`;
    const endDate = year === currentYear ? today : `${year}-12-31`;
    const range = dateRange(startDate, endDate);
    const financialKey = ['shock', 'specialty', 'image', 'imageIncome', 'lab', 'labIncome', 'hospitalDoctors', 'emergencyDoctors'].includes(definition.key);
    const source = await loadHistorySource(range, definition.key);
    const section = financialKey ? financialSections(source, range)[definition.key] : source.sections[definition.key];
    criterion = section.criterion; unit = section.unit;
    warnings.push(...(section.warnings || []));
    warnings.push(...(source.warnings || []), ...(source.billing?.warnings || []));
    for (let month = firstMonth; month <= 12; month++) {
      const prefix = `${year}-${String(month).padStart(2, '0')}`;
      if (`${prefix}-01` > today || section.quantity === null) { data[year][month] = null; continue; }
      if (definition.key.endsWith('Doctors')) {
        const docs = source.documents.filter(row => sourceDate(row.Fecha).startsWith(prefix));
        data[year][month] = money(topDoctors(docs, definition.key === 'hospitalDoctors' ? 'IP' : 'ER'), 'IngresoTotal');
      } else {
        const rows = section.rows.filter(row => sourceDate(row.Fecha).startsWith(prefix));
        const distinctAccount = ['operatingRoom', 'shock'].includes(definition.key);
        // La unicidad por mes requiere el conjunto original, no una deduplicación anual.
        if (distinctAccount && definition.key === 'shock') {
          data[year][month] = new Set(source.rows.filter(r => r.Categoria === 'choque' && r.FolioAtencion && Number(r.Cantidad)>0 && sourceDate(r.Fecha).startsWith(prefix)).map(r => String(r.FolioAtencion))).size;
        } else if (distinctAccount) {
          data[year][month] = new Set(source.sections.surgeries.rows.filter(r => sourceDate(r.Fecha).startsWith(prefix)).map(r => String(r.FolioAtencion))).size;
        } else data[year][month] = section.measure === 'IngresoNeto' ? money(rows, 'IngresoNeto') : sum(rows, 'Cantidad');
      }
    }
  }
  if (['births', 'vasSeguro', 'emergencyConsultations', 'stay', 'intensive', 'ambulatory', 'image', 'lab'].includes(definition.key)) {
    warnings.push('Los meses anteriores a abril de 2026 conservan los totales manuales originales. Su criterio puede diferir del cálculo actual.');
  }
  return { data, warnings: [...new Set(warnings)], criterion, unit };
}

function dashboardData(report) {
  const groups = new Map();
  for (const row of report._financial.rows) {
    const label = ({ imagen: 'Imagenología', laboratorio: 'Laboratorio', consulta: 'Consulta de especialidad', choque: 'Sala de choque' })[row.Categoria] || 'Otros servicios y artículos';
    groups.set(label, (groups.get(label) || 0) + Number(row.IngresoNeto || 0));
  }
  const total = [...groups.values()].reduce((a, b) => a + b, 0);
  const toChart = section => section.rows.map(row => ({ area: row.Medico, n: row.IngresoTotal, especialidad: `${row.Ordenes} órdenes · ${row.Cuentas} atenciones` }));
  return { general: report.general, period: report.period, warnings: report.warnings,
    diagnosticos: [...groups].map(([dx, n]) => ({ dx, n: roundMoney(n), pct: total ? roundMoney(n / total * 100) : 0 })).sort((a,b) => b.n-a.n),
    servicios: toChart(report.sections.hospitalDoctors), medicosHospitalizacion: toChart(report.sections.hospitalDoctors), medicosUrgencias: toChart(report.sections.emergencyDoctors),
    criteria: { ingresos: report.financialCriterion, nacimientos: report.sections.births.criterion }
  };
}

module.exports = { getReport, getHistory, dashboardData, assembleReport, financialSections, topDoctors, sourceDate, mergeClassification, clearCache: () => cache.clear() };
