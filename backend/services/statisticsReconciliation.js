'use strict';

const references = require('../data/statistics_base_references.json');
const { SECTIONS } = require('./statisticsCatalog');
const { monthRange, roundMoney } = require('./statisticsCommon');

const day = value => value instanceof Date
  ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  : String(value || '').slice(0, 10);
const within = (rows, period) => (rows || []).filter(row => day(row.Fecha) >= period.startDate && day(row.Fecha) <= period.endDate);
const total = (rows, field) => roundMoney(rows.reduce((sum, row) => sum + Number(row[field] || 0), 0));
const keyOf = key => key === 'urgent' ? 'emergencyAccounts' : key;
const displayType = type => ({ ALL: 'General', IP: 'Hospitalización', ER: 'Urgencias' })[type];
const availableSection = section => section && typeof section.quantity === 'number' && Number.isFinite(section.quantity) && Array.isArray(section.rows);
const sectionLabel = key => SECTIONS.find(section => section.key === keyOf(key))?.label || keyOf(key);

function referencePeriod(reference) {
  if (reference.period) return reference.period;
  return reference.month ? monthRange(reference.month.slice(0, 4), Number(reference.month.slice(5, 7))) : null;
}

function covered(reference, period) {
  const range = referencePeriod(reference);
  return Boolean(range && range.startDate >= period.startDate && range.endDate <= period.endDate && reference.referenceVariant !== 'duplicate_july');
}

function referenceRows(rows, reference) {
  if (!Array.isArray(rows)) return null;
  let selected = within(rows, referencePeriod(reference));
  if (Array.isArray(reference.serviceCodes) && reference.serviceCodes.length) {
    if (selected.some(row => !String(row.Codigo || '').trim())) return null;
    const codes = new Set(reference.serviceCodes);
    selected = selected.filter(row => codes.has(row.Codigo));
  }
  if (Array.isArray(reference.excludedProcedures) && reference.excludedProcedures.length) {
    if (selected.some(row => !String(row.Servicio || '').trim())) return null;
    const excluded = new Set(reference.excludedProcedures.map(value => String(value).trim().toUpperCase()));
    selected = selected.filter(row => !excluded.has(String(row.Servicio).trim().toUpperCase()));
  }
  if (Array.isArray(reference.includedProcedures)) {
    if (selected.some(row => [1, '1', true].includes(row.ProcedimientoSinClasificar) || Number(row.TecnicasRegistradas) > 1)) return null;
    if (selected.some(row => !String(row.Servicio || '').trim())) return null;
    const included = new Set(reference.includedProcedures.map(value => String(value).trim().toUpperCase()));
    selected = selected.filter(row => included.has(String(row.Servicio).trim().toUpperCase()));
  }
  if (Array.isArray(reference.groups) && reference.groups.length) {
    if (selected.some(row => row.Grupo == null || row.Grupo === '' || !Number.isFinite(Number(row.Grupo)))) return null;
    const groups = new Set(reference.groups.map(Number));
    selected = selected.filter(row => groups.has(Number(row.Grupo)));
  }
  return selected;
}

function rowsForReference(reference, report, section) {
  if (reference.rowSource === 'financial') return referenceRows(report._financial?.rows, reference);
  if (reference.rowSource === 'billing') return referenceRows(report._financial?.billing?.rows?.filter(row => !row.ServicioSinArticulo), reference);
  if (reference.rowSource === 'sectionSourceRows') return referenceRows(section?.sourceRows, reference);
  if (reference.rowSource != null || !availableSection(section)) return null;
  return referenceRows(section.rows, reference);
}

function controlValue(control, report) {
  const range = referencePeriod(control);
  const key = keyOf(control.key);
  const documents = within(report._financial.documents, range);
  if (key === 'hospitalOrders' || key === 'emergencyOrders') {
    return total(documents.filter(row => row.TipoAtencion === (key === 'hospitalOrders' ? 'IP' : 'ER')), 'TotalOrdenVenta');
  }
  if (key === 'shock') {
    return new Set(within(report._financial.rows, range).filter(row => row.Categoria === 'choque' && row.FolioAtencion && Number(row.Cantidad) > 0).map(row => String(row.FolioAtencion))).size;
  }
  const section = report.sections[key];
  const rows = rowsForReference(control, report, section);
  if (rows === null) return null;
  if (control.metric === 'rowCount' || section?.measure === 'rowCount') return rows.length;
  return total(rows, control.measure || (section?.measure === 'IngresoNeto' ? 'IngresoNeto' : 'Cantidad'));
}

function reconcileReport(report, rankDoctors, source = references) {
  const relevant = source.controls.filter(control => covered(control, report.period));
  const controls = relevant.map(control => {
    const actual = controlValue(control, report);
    const comparable = control.comparisonStatus !== 'not_comparable' && actual !== null;
    const difference = comparable ? roundMoney(actual - control.value) : null;
    return { ControlId: `${keyOf(control.key)}:${control.month}:total:${control.metric || 'quantity'}${control.referenceVariant ? `:${control.referenceVariant}` : ''}`,
      Seccion: sectionLabel(control.key), Medida: control.metric || 'quantity', Periodo: control.month,
      Indicador: `${control.label} · ${control.month}`, Manual: control.value, Generado: actual,
      Diferencia: difference, Unidad: control.unit, Referencia: control.source, Criterio: control.criterion,
      Estado: !comparable ? 'No comparable' : difference === 0 ? 'Coincide' : 'Diferencia',
      Motivo: !comparable ? control.comparisonReason || 'No se obtuvo una medida comparable para este periodo.' : difference === 0
        ? 'Misma medida y periodo; coincide el valor consultado con la base.'
        : 'La consulta vigente difiere del archivo base. Se conserva la diferencia sin ajustes automáticos.' };
  });
  const coveredKeys = new Set(relevant.map(control => keyOf(control.key)));
  for (const section of SECTIONS) {
    if (coveredKeys.has(section.key) || ['hospitalDoctors', 'emergencyDoctors'].includes(section.key)) continue;
    controls.push({ ControlId: `${section.key}:no-reference`, Seccion: section.label, Medida: null, Periodo: null,
      Indicador: section.label, Manual: null, Generado: report.sections[section.key]?.quantity ?? null,
      Diferencia: null, Unidad: report.sections[section.key]?.unit || section.unit, Referencia: 'Excel base revisados',
      Criterio: report.sections[section.key]?.criterion || '', Estado: 'Sin referencia',
      Motivo: 'No hay una base con el mismo indicador y un periodo completo incluido en el rango solicitado.' });
  }

  for (const reference of source.serviceBreakdowns.filter(row => row.rows && covered(row, report.period))) {
    const section = report.sections[keyOf(reference.key)];
    const current = new Map();
    const comparableRows = rowsForReference(reference, report, section);
    for (const row of comparableRows || []) {
      if (!current.has(row.Codigo)) current.set(row.Codigo, { rowCount: 0, quantity: 0, amount: 0 });
      const item = current.get(row.Codigo);
      item.rowCount++;
      item.quantity += Number(row.Cantidad || 0);
      if (typeof row.ImporteLinea !== 'number' || !Number.isFinite(row.ImporteLinea)) item.amount = null;
      else if (item.amount !== null) item.amount += Number(row.ImporteLinea);
    }
    const expected = new Map(reference.rows.map(row => [row.Codigo, row]));
    for (const code of [...new Set([...expected.keys(), ...current.keys()])].sort()) {
      for (const [metric, label, unit] of [['rowCount', 'Registros', 'registros'], ['quantity', 'Unidades', 'unidades'], ['amount', 'Importe de líneas', 'MXN']]) {
        const manual = expected.get(code)?.[metric] ?? 0;
        const missingRaw = metric === 'amount' && current.get(code)?.amount === null;
        const actual = comparableRows !== null && !missingRaw ? roundMoney(current.get(code)?.[metric] ?? 0) : null;
        const comparable = reference.comparisonStatus !== 'not_comparable' && actual !== null;
        const difference = comparable ? roundMoney(actual - manual) : null;
        controls.push({ ControlId: `${keyOf(reference.key)}:${reference.month}:${code}:${metric}${reference.referenceVariant ? `:${reference.referenceVariant}` : ''}`,
          Seccion: sectionLabel(reference.key), Medida: metric, Periodo: reference.month,
          Indicador: `${sectionLabel(reference.key)} · ${code} · ${label} · ${reference.month}${reference.referenceVariant === 'institutional_consolidated' ? ' · Cierre institucional' : reference.referenceVariant ? ' · Detalle original' : ''}`, Manual: manual, Generado: actual,
          Diferencia: difference, Unidad: unit, Referencia: reference.source,
          Criterio: reference.criterion || 'Mismo código de servicio y medida del detalle base; se conserva el alcance original de cada referencia.',
          Estado: !comparable ? 'No comparable' : difference === 0 ? 'Coincide' : 'Diferencia',
          Motivo: !comparable ? reference.comparisonReason || (missingRaw
            ? 'La consulta no conserva el importe original de línea antes del descuento general; no se sustituye por ingreso neto.'
            : 'La referencia no tiene un periodo y una medida comparables con la consulta.')
            : difference === 0 ? 'Coinciden la distribución por código y la medida comparada.' : 'La distribución por código difiere; revisar el detalle de órdenes, sin compensar entre servicios.' });
      }
    }
  }
  for (const reference of (source.groupBreakdowns || []).filter(row => covered(row, report.period))) {
    const rows = rowsForReference(reference, report);
    for (const expected of reference.rows || []) {
      const matching = rows?.filter(row => Number(row.Grupo) === Number(expected.Grupo));
      const label = expected.Servicio || `Grupo ${expected.Grupo}`;
      for (const [metric, field, unit, text] of [['quantity', 'Cantidad', 'unidades', 'Unidades'],
        ['amount', reference.amountField || 'IngresoNeto', 'MXN', 'Importe neto']]) {
        const manual = expected[metric];
        const complete = matching != null && matching.every(row => typeof row[field] === 'number' && Number.isFinite(row[field]));
        const actual = complete ? total(matching, field) : null;
        const comparable = reference.comparisonStatus !== 'not_comparable' && actual !== null && typeof manual === 'number';
        const difference = comparable ? roundMoney(actual - manual) : null;
        controls.push({ ControlId: `group:${reference.month}:${expected.Grupo}:${metric}:${reference.referenceVariant || 'group_detail'}`,
          Seccion: label, Medida: metric, Periodo: reference.month,
          Indicador: `${label} · ${text} · ${reference.month}`, Manual: manual, Generado: actual,
          Diferencia: difference, Unidad: unit, Referencia: reference.source,
          Criterio: reference.criterion || 'Mismo grupo y periodo del reporte original; las unidades y el importe se comprueban por separado.',
          Estado: !comparable ? 'No comparable' : difference === 0 ? 'Coincide' : 'Diferencia',
          Motivo: !comparable ? 'No se obtuvo una clasificación o una medida completa para comparar este grupo.'
            : difference === 0 ? 'Coinciden el grupo y la medida del reporte original.'
              : 'El agregado vigente difiere del original. El reporte por grupos no identifica qué documentos explican la diferencia.' });
      }
    }
  }
  const rankingControls = [];
  for (const reference of source.doctorRankings.filter(row =>
    (row.month || ['ANUAL 2026', 'Hoja2'].includes(row.referenceVariant)) && covered(row, report.period))) {
    const periodLabel = reference.month || `${reference.period.startDate} al ${reference.period.endDate}`;
    const referenceKey = reference.month || reference.referenceVariant;
    const currentRows = rankDoctors(within(report._financial.documents, referencePeriod(reference)), reference.type);
    const expected = new Map(reference.rows.map((row, index) => [row.Medico, { ...row, Ranking: index + 1 }]));
    const current = new Map(currentRows.map(row => [row.Medico, row]));
    for (const name of new Set([...expected.keys(), ...current.keys()])) {
      const oldRow = expected.get(name), newRow = current.get(name);
      const manual = oldRow?.IngresoTotal || 0, generated = newRow?.IngresoTotal || 0;
      const ordersManual = oldRow?.Ordenes || 0, ordersGenerated = newRow?.Ordenes || 0;
      const difference = roundMoney(generated - manual), orderDifference = ordersGenerated - ordersManual;
      const sameRank = oldRow?.Ranking === newRow?.Ranking;
      rankingControls.push({ ControlId: `doctors:${referenceKey}:${reference.type}:${name}`,
        Tipo: displayType(reference.type), Periodo: periodLabel, Corte: reference.referenceVariant || null, Medico: name,
        OrdenesManual: ordersManual, OrdenesGenerado: ordersGenerated, DiferenciaOrdenes: orderDifference,
        Manual: manual, Generado: generated, Diferencia: difference,
        RankingManual: oldRow?.Ranking ?? null, RankingGenerado: newRow?.Ranking ?? null,
        TipoDiferencia: difference !== 0 ? orderDifference !== 0 ? 'Importe y órdenes' : 'Importe'
          : orderDifference !== 0 ? 'Órdenes' : !sameRank ? 'Posición' : null,
        Estado: difference === 0 && orderDifference === 0 && sameRank ? 'Coincide' : 'Diferencia', Referencia: reference.source,
        Motivo: !oldRow ? 'Este nombre literal no aparece en la base de ese periodo.' : !newRow
          ? 'Este nombre literal no aparece en la consulta vigente de ese periodo.'
          : !sameRank && difference === 0 && orderDifference === 0 ? 'Coinciden el importe y las órdenes de este médico; cambia su posición relativa respecto a los demás médicos. No es una diferencia de ingreso de este médico.'
          : reference.type === 'ALL' ? 'Nombre exacto, cuenta de órdenes e importe general de hospitalización y urgencias.'
            : 'Desglose por tipo calculado desde el detalle base; los pivotes originales combinan ambos tipos.' });
    }
  }
  const labControls = [];
  for (const reference of source.labItems.filter(row => covered(row, report.period))) {
    const current = new Map();
    const comparableRows = referenceRows(report.sections.lab?.rows, reference);
    for (const row of comparableRows || []) {
      if (!current.has(row.Codigo)) current.set(row.Codigo, { quantity: 0, amount: 0, Servicio: row.Servicio });
      const item = current.get(row.Codigo);
      item.quantity += Number(row.Cantidad || 0);
      item.amount += Number(row.IngresoNeto || 0);
    }
    const expected = new Map(reference.rows.map(row => [row.Codigo, row]));
    for (const code of [...new Set([...expected.keys(), ...current.keys()])].sort()) {
      const oldRow = expected.get(code), newRow = current.get(code);
      const quantity = newRow?.quantity || 0, manualQuantity = oldRow?.quantity || 0;
      const amount = roundMoney(newRow?.amount || 0), manualAmount = oldRow?.amount || 0;
      const difference = roundMoney(amount - manualAmount), quantityDifference = quantity - manualQuantity;
      const available = availableSection(report.sections.lab) && comparableRows !== null;
      labControls.push({ ControlId: `lab:${reference.month}:${code}`, Periodo: reference.month, Codigo: code, Servicio: oldRow?.Servicio || newRow?.Servicio,
        CantidadManual: manualQuantity, CantidadGenerada: available ? quantity : null,
        DiferenciaCantidad: available ? quantityDifference : null, Manual: manualAmount,
        Generado: available ? amount : null, Diferencia: available ? difference : null,
        Estado: !available ? 'No comparable' : difference === 0 && quantityDifference === 0 ? 'Coincide' : 'Diferencia',
        Referencia: reference.source, Motivo: 'Comparación por código de artículo. El Excel no conserva folios de facturas/notas de crédito para atribuir una diferencia a documentos específicos.' });
    }
  }
  const comparisonRows = [...controls, ...rankingControls, ...labControls];
  const summary = {
    compared: comparisonRows.filter(row => ['Coincide', 'Diferencia'].includes(row.Estado)).length,
    matching: comparisonRows.filter(row => row.Estado === 'Coincide').length,
    different: comparisonRows.filter(row => row.Estado === 'Diferencia').length,
    notComparable: comparisonRows.filter(row => ['No comparable', 'Sin referencia'].includes(row.Estado)).length,
    indicators: controls.length, doctors: rankingControls.length, laboratoryItems: labControls.length,
    differenceBreakdown: {
      indicators: controls.filter(row => row.Estado === 'Diferencia').length,
      doctorValues: rankingControls.filter(row => row.Estado === 'Diferencia' && row.TipoDiferencia !== 'Posición').length,
      doctorPositions: rankingControls.filter(row => row.Estado === 'Diferencia' && row.TipoDiferencia === 'Posición').length,
      laboratoryItems: labControls.filter(row => row.Estado === 'Diferencia').length
    },
    referencesReviewedOn: source.reviewedOn
  };
  const referenceRankings = source.doctorRankings.filter(row => row.type === 'ALL' && ['ANUAL 2026', 'Hoja2'].includes(row.referenceVariant))
    .map(reference => ({ label: reference.referenceVariant, period: reference.period, source: reference.source,
      rows: reference.rows.map((row, index) => ({ ...row, Ranking: index + 1 })), rowCount: reference.rowCount,
      totalIncome: total(reference.rows, 'IngresoTotal'), status: 'snapshot_reference' }));
  const warnings = report.warnings.filter(warning => !warning.startsWith('El periodo tiene diferencias con el archivo manual'));
  if (summary.different) warnings.push('El periodo tiene diferencias con los Excel base. Consulta las conciliaciones de indicadores, médicos y laboratorio; no se aplicaron ajustes para forzar los totales.');
  if (summary.notComparable) warnings.push('Hay indicadores sin referencia comparable para este periodo; no se consideran conciliados.');
  return { ...report, controls, rankingControls, labControls, referenceRankings, reconciliationSummary: summary,
    referenceInventory: source.sourceInventory, referenceIssues: source.sourceIssues, warnings: [...new Set(warnings)] };
}

module.exports = { reconcileReport, controlValue };
