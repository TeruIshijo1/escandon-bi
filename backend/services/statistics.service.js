'use strict';

const { getClinicalStatistics, getAccountClassifications, buildClinicalStatistics } = require('./statisticsVertical.service');
const { getFinancialStatistics, CATEGORY_GROUPS } = require('./statisticsSap.service');
const { SECTIONS, BY_ID, SERVICE_CODES } = require('./statisticsCatalog');
const { dateRange, monthRange, hospitalToday, invalid, roundMoney } = require('./statisticsCommon');
const history = require('../data/excel_stats_history.json');
const { reconcileReport: applyReconciliation } = require('./statisticsReconciliation');
const LEGACY_ALIASES = Object.freeze({
  '10_INGRESOS_IMAGEN': '10_ESTADISTICO EST. IMAGEN x INGRESOS',
  '11_INGRESOS_LABORATORIO': '12_ESTADISTICO EST. LABORA x INGRESOS'
});
const historicalSeriesData = () => require('../data/statistics_historical_series.json').data;
const acceptedClosuresData = () => require('../data/statistics_historical_series.json').acceptedClosures || {};
const sum = (rows, key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
const money = (rows, key) => roundMoney(sum(rows, key));
const hasDoctorName = value => Boolean(String(value || '').trim()) && !/^sin (identificar|m[eé]dico identificado)$/i.test(String(value).trim());
const normalizedName = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
function mergeClassification(row, account) {
  if (!account) return row;
  const result = { ...row, TipoAtencion: row.TipoAtencion || account.TipoAtencion };
  if (!result.NoPaciente && account.NoPaciente) result.NoPaciente = account.NoPaciente;
  if (!result.Paciente && account.Paciente) result.Paciente = account.Paciente;
   
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

function serviceSummary(rows) {

  const stableSum = values => {
    let total = 0, correction = 0;
    for (const value of values.sort((a, b) => Math.abs(a) - Math.abs(b) || a - b)) {
      const next = total + value;
      correction += Math.abs(total) >= Math.abs(value) ? (total - next) + value : (value - next) + total;
      total = next;
    }
    return total + correction;
  };
  const fields = ['Cantidad', 'ImporteLinea', 'IngresoNeto', 'IVA', 'ImporteTotal'];
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.Codigo)) groups.set(row.Codigo, { Codigo: row.Codigo, Servicio: row.Servicio,
      Registros: 0, missingRaw: false, values: Object.fromEntries(fields.map(field => [field, []])) });
    const group = groups.get(row.Codigo);
    group.Registros++;
    if (typeof row.ImporteLinea !== 'number' || !Number.isFinite(row.ImporteLinea)) group.missingRaw = true;
    else group.values.ImporteLinea.push(row.ImporteLinea);
    for (const key of ['Cantidad', 'IngresoNeto', 'IVA', 'ImporteTotal']) group.values[key].push(Number(row[key] || 0));
  }
  return [...groups.values()].sort((a, b) => String(a.Codigo).localeCompare(String(b.Codigo)))
    .map(({ values, missingRaw, ...row }) => ({ ...row,
      ...Object.fromEntries(fields.map(field => [field, field === 'ImporteLinea'
        ? missingRaw ? null : roundMoney(stableSum(values[field])) : stableSum(values[field])])) }));
}

function doctorRanking(documents, type) {
  const groups = new Map();
  const seen = new Set();
  for (const doc of documents.filter(d => (type === 'ALL' ? ['IP', 'ER'].includes(d.TipoAtencion) : d.TipoAtencion === type) && hasDoctorName(d.Medico))) {

    const name = String(doc.Medico);
    if (doc.DocumentoId != null) {
      const documentId = String(doc.DocumentoId);
      if (seen.has(documentId)) throw new Error('La consulta contiene una orden repetida; no se puede comprobar el ranking de médicos.');
      seen.add(documentId);
    }
    if (doc.TotalOrdenVenta == null || doc.TotalOrdenVenta === '' || !Number.isFinite(Number(doc.TotalOrdenVenta))) {
      throw new Error('Una orden no tiene un importe válido para comprobar el ranking de médicos.');
    }
    if (!groups.has(name)) groups.set(name, { Medico: name, IngresoTotal: 0, Ordenes: 0, accounts: new Set(), doctorIds: new Set() });
    const row = groups.get(name);
    row.IngresoTotal += Number(doc.TotalOrdenVenta);
    row.Ordenes++;
    if (doc.FolioAtencion) row.accounts.add(String(doc.FolioAtencion));
    if (doc.NumeroMedico) row.doctorIds.add(doc.NumeroMedico);
  }
  return [...groups.values()].sort((a, b) => roundMoney(b.IngresoTotal) - roundMoney(a.IngresoTotal) || a.Medico.localeCompare(b.Medico, 'es'))
    .map(({ accounts, doctorIds, ...row }, index) => ({ Ranking: index + 1, ...row,
      NumeroMedico: doctorIds.size === 1 ? [...doctorIds][0] : null,
      IngresoTotal: roundMoney(row.IngresoTotal), Cuentas: accounts.size }));
}
const topDoctors = (documents, type) => doctorRanking(documents, type).slice(0, 10);

function generalDoctorSection(financial, range) {
  const allRows = doctorRanking(inRange(financial.documents || [], range), 'ALL');
  const rows = allRows.slice(0, 10);
  return { rows, allRows, quantity: money(rows, 'IngresoTotal'), allQuantity: money(allRows, 'IngresoTotal'),
    unit: 'MXN', measure: 'IngresoTotal', warnings: [],
    criterion: 'Ingreso general de hospitalización y urgencias por nombre exacto de médico: suma de TotalOrdenVenta con IVA si aplica y cuenta de órdenes vigentes por fecha de documento. Combina ambos tipos como los pivotes generales del archivo base; no incorpora órdenes sin tipo de atención confirmado. Los rankings de hospitalización y urgencias son desgloses independientes.' };
}

function financialSections(financial, range) {
  const rows = inRange(financial.rows || [], range);
  const billedRows = financial.billing ? inRange(financial.billing.rows, range) : null;
  const documents = inRange(financial.documents || [], range);
  const criterion = 'Órdenes de venta vigentes de SAP, por fecha de documento; incluye abiertas y cerradas, excluye canceladas. Importe de línea conserva el total del servicio sin IVA antes del descuento general; ingreso neto descuenta también el descuento general de la orden. El prorrateo conserva su precisión y los totales monetarios se redondean al final. No representa cobros ni facturación.';
  const billingCriterion = 'Movimientos facturados de SAP por su propia fecha de contabilización. Las facturas suman y sus cancelaciones restan; las notas de crédito restan y sus cancelaciones suman. Se conserva la emisión original aunque se cancele en otro mes. Importes netos sin IVA y después de descuentos; el prorrateo conserva su precisión y los totales monetarios se redondean al final.';
  const studiesNote = 'Unidades facturadas menos unidades de notas de crédito, incluidos pacientes externos. Un paquete cuenta como una unidad; no se desglosa en pruebas. No acredita por sí solo la realización del estudio.';
  const result = {};
  for (const key of ['emergencyConsultations', 'stay', 'intensive']) {
    const matching = rows.filter(row => SERVICE_CODES[key].includes(row.Codigo));
    result[key] = { rows: matching, quantity: matching.length, rowCount: matching.length,
      serviceSummary: serviceSummary(matching),
      unitQuantity: sum(matching, 'Cantidad'), attentionCount: new Set(matching.map(row => row.FolioAtencion).filter(Boolean)).size,
      measure: 'rowCount', unit: 'registros de servicio', warnings: [],
      criterion: `${criterion} Cuenta de líneas de servicio, como los pivotes de los Excel base; cada línea cuenta una vez aunque tenga varias unidades. La suma de Cantidad se conserva por separado. ${key === 'intensive' ? 'Sólo servicios de terapia intensiva, intermedia y neonatal.' : key === 'emergencyConsultations' ? 'Sólo los códigos de consulta de urgencias, sin interconsultas.' : 'Servicios de estancia hospitalaria, ambulatoria y cunero. La terapia intensiva, intermedia y neonatal se presenta por separado; sin estancia por hora de urgencias.'}` };
  }
  for (const [key, category, label] of [['image', 'imagen', 'imagenología'], ['lab', 'laboratorio', 'laboratorio']]) {
    const matching = (billedRows || []).filter(row => row.Grupo != null
      ? CATEGORY_GROUPS[category].includes(Number(row.Grupo)) : row.Categoria === category);
    const scope = key === 'lab' ? 'Incluye laboratorio, patología y banco de sangre. Los paquetes del grupo separado se presentan como complemento.' : `Servicios de ${label}; ultrasonido estructural se presenta por separado.`;
    result[key] = measured(matching, 'estudios facturados netos', `${billingCriterion} ${scope}`, 'Cantidad', [studiesNote]);
    result[`${key}Income`] = measured(matching, 'MXN', `${billingCriterion} ${scope}`, 'IngresoNeto');
    if (key === 'lab') {
      result[key].scopeLabel = 'Laboratorio · Patología · Banco de sangre';
      result[`${key}Income`].scopeLabel = result[key].scopeLabel;
    }
    result[key].serviceSummary = serviceSummary(matching);
    result[`${key}Income`].serviceSummary = result[key].serviceSummary;
    if (!billedRows) {
      for (const section of [result[key], result[`${key}Income`]]) {
        section.quantity = null;
        section.warnings.push('No se consultó la facturación y sus notas de crédito para este periodo.');
      }
    }
  }
  for (const [key, category, label] of [['structuralUltrasound', 'ultrasonidoEstructural', 'Ultrasonido estructural'],
    ['laboratoryPackages', 'paquetesLaboratorio', 'Paquetes de laboratorio']]) {
    const matching = (billedRows || []).filter(row => row.Grupo != null
      ? CATEGORY_GROUPS[category].includes(Number(row.Grupo)) : row.Categoria === category);
    result[key] = measured(matching, 'estudios facturados netos', `${billingCriterion} ${label}, presentado como complemento del estadístico institucional.`, 'Cantidad', [studiesNote]);
    result[key].serviceSummary = serviceSummary(matching);
    if (!billedRows) {
      result[key].quantity = null;
      result[key].warnings.push('No se consultó la facturación y sus notas de crédito para este periodo.');
    }
  }
  for (const [key, type] of [['hospitalDoctors', 'IP'], ['emergencyDoctors', 'ER']]) {
    const allRows = doctorRanking(documents, type);
    const ranking = allRows.slice(0, 10);
    result[key] = measured(ranking, 'MXN', 'Top 10 por suma del total de órdenes de venta vigentes, con IVA si aplica, por fecha de documento. Se agrupa por el nombre exacto registrado, conservando sus variantes, como el pivote de los Excel base. Cada orden cuenta una vez en el importe y en la cuenta de nombre de médico; las cuentas de atención distintas se muestran por separado.', 'IngresoTotal');
    result[key].quantity = money(ranking, 'IngresoTotal');
    result[key].allRows = allRows;
    result[key].allQuantity = money(allRows, 'IngresoTotal');
  }
  const shock = rows.filter(row => row.Categoria === 'choque' && Number(row.Cantidad) > 0);
  const shockByAccount = new Map();
  for (const row of shock) {
    const accountId = row.FolioAtencion;
    if (!accountId) continue;
    const key = String(accountId);
    if (!shockByAccount.has(key)) {
      shockByAccount.set(key, {
        FolioAtencion: accountId,
        NoPaciente: row.NoPaciente || null,
        Paciente: row.Paciente || null,
        Fecha: row.Fecha,
        OrdenesVenta: new Set(),
        CantidadTotal: 0,
        ImporteTotal: 0,
        Servicio: row.Servicio || 'Sala de choque'
      });
    }
    const acc = shockByAccount.get(key);
    if (!acc.Paciente && row.Paciente) acc.Paciente = row.Paciente;
    if (!acc.NoPaciente && row.NoPaciente) acc.NoPaciente = row.NoPaciente;
    if (row.Documento) acc.OrdenesVenta.add(row.Documento);
    acc.CantidadTotal += Number(row.Cantidad || 0);
    acc.ImporteTotal += Number(row.ImporteTotal ?? row.IngresoNeto ?? 0);
    if (new Date(row.Fecha) < new Date(acc.Fecha)) acc.Fecha = row.Fecha;
  }
  const shockAccounts = [...shockByAccount.values()].map(a => ({
    FolioAtencion: a.FolioAtencion,
    NoPaciente: a.NoPaciente,
    Paciente: a.Paciente,
    Fecha: a.Fecha,
    Ordenes: a.OrdenesVenta.size || 1,
    CantidadTotal: a.CantidadTotal,
    ImporteTotal: roundMoney(a.ImporteTotal),
    Cantidad: 1,
    Servicio: a.Servicio
  }));
  result.shock = measured(shockAccounts, 'atenciones', 'Atenciones con servicio de sala de choque en órdenes vigentes del periodo; una vez por atención. El nombre institucional del indicador no acredita el desenlace clínico.');
  if (shock.some(row => !row.FolioAtencion)) result.shock.warnings.push('Hay servicios de sala de choque sin folio de atención; no se incluyeron en el conteo de atenciones.');
  result.specialtyServices = measured(rows.filter(row => row.Categoria === 'consulta'), 'unidades de servicios de consulta', 'Servicios de consulta de especialidad en órdenes de venta vigentes, por fecha de documento. Es un complemento financiero distinto del indicador institucional de citas programadas.', 'Cantidad');
  return result;
}

async function enrichFinancial(financial, options = {}) {
  const docs = financial.documents || [];
  const unresolved = [...(financial.rows || []), ...docs].filter(row => row.FolioAtencion);
  const classifications = unresolved.length ? await getAccountClassifications(unresolved.map(row => row.FolioAtencion), options) : {};
  const enrich = row => {
    const account = classifications[String(row.FolioAtencion)];
    return mergeClassification(row, account);
  };
  return { ...financial, rows: (financial.rows || []).map(enrich), documents: docs.map(enrich) };
}

const { createSnapshotStore, MODEL_VERSION, monthsFor, monthPeriod } = require('./statisticsSnapshot.service');
const snapshotStore = createSnapshotStore({ pool: require('../config/db').getDb().pool, legacyHistory: history,
  loadMonth: async (range, { signal } = {}) => {
    const clinical = await getClinicalStatistics(range, { includeRaw: true, signal });
    const financial = await enrichFinancial(await getFinancialStatistics({ ...range, includeBilling: true, signal }), { signal });
    const report = assembleReport(range, { clinical, financial });
    const summary = Object.fromEntries(SECTIONS.map(({ id, key }) => [id, {
      quantity: report.sections[key].quantity, unit: report.sections[key].unit,
      criterion: report.sections[key].criterion, warnings: [...new Set([...(report.sections[key].warnings || []), ...report.warnings])]
    }]));
    return { clinical: { _raw: clinical._raw }, financial, summary };
  }
});

function combineSnapshots(snapshots, range) {
  const raw = { charges: [], accounts: [], surgeries: [], births: [], specialtyAppointments: [], specialtyConsultations: [], operatingRoomActivity: [] };
  const financial = { rows: [], documents: [], warnings: [], billing: { rows: [], documents: [], warnings: [] } };
  const append = (target, rows) => { for (const row of rows) target.push(row); };
  for (const snapshot of snapshots) {
    const payload = snapshot.payload;
    for (const key of Object.keys(raw)) append(raw[key], inRange(payload.clinical._raw[key], range));
    append(financial.rows, inRange(payload.financial.rows, range));
    append(financial.documents, inRange(payload.financial.documents, range));
    financial.warnings.push(...(payload.financial.warnings || []));
    append(financial.billing.rows, inRange(payload.financial.billing.rows, range));
    append(financial.billing.documents, inRange(payload.financial.billing.documents || [], range));
    financial.billing.warnings.push(...(payload.financial.billing.warnings || []));
  }

  for (const [rows, field] of [[raw.charges, 'NumeroCargo'], [raw.accounts, 'FolioAtencion'],
    [raw.surgeries, 'FolioEstancia'], [raw.births, 'NoPaciente'], [raw.specialtyAppointments, 'NumeroCita'],
    [raw.specialtyConsultations, 'NumeroCita'], [financial.documents, 'DocumentoId']]) {
    const keys = rows.map(row => String(row[field]));
    if (new Set(keys).size !== keys.length) throw Object.assign(new Error('Hay referencias entre meses pendientes de conciliar. Actualiza los meses del periodo.'), { code: 'STATISTICS_RECONCILIATION_PENDING' });
  }
  const activityKeys = raw.operatingRoomActivity.map(row => `${row.FolioAtencion}:${sourceDate(row.Fecha)}`);
  if (new Set(activityKeys).size !== activityKeys.length) throw Object.assign(new Error('Hay cargos de quirófano entre meses pendientes de conciliar. Actualiza los meses del periodo.'), { code: 'STATISTICS_RECONCILIATION_PENDING' });
  for (const [rows, withLine] of [[financial.rows, true], [financial.billing.documents, false], [financial.billing.rows, true]]) {
    const keys = rows.map(row => `${row.TipoDocumento}:${row.DocumentoId}${withLine ? `:${row.Linea}` : ''}`);
    if (new Set(keys).size !== keys.length) throw Object.assign(new Error('Hay documentos o servicios entre meses pendientes de conciliar.'), { code: 'STATISTICS_RECONCILIATION_PENDING' });
  }
  return { clinical: buildClinicalStatistics(raw), financial };
}

function storageWarnings(storage) {
  const warnings = [];
  if (storage.pendingMonths.length) warnings.push('Hay meses actualizándose en segundo plano; las cifras disponibles conservan la última extracción completa.');
  if (storage.failedMonths.length) warnings.push('No se pudieron actualizar algunos meses. Se conserva su última extracción completa; consulta la fecha de actualización.');
  return warnings;
}

function assembleReport(range, { clinical, financial }) {
  const sections = { ...clinical.sections, ...financialSections(financial, range) };
  const warnings = [...new Set([...(clinical.warnings || []), ...(financial.warnings || []), ...(financial.billing?.warnings || []), ...SECTIONS.flatMap(({ key }) => sections[key]?.warnings || [])])];
  const missingDoctorDocuments = (financial.documents || []).filter(d => ['IP', 'ER'].includes(d.TipoAtencion) && !hasDoctorName(d.Medico));
  const missingDoctors = missingDoctorDocuments.length;
  if (missingDoctors) warnings.push(`${missingDoctors} órdenes, por ${money(missingDoctorDocuments, 'TotalOrdenVenta').toFixed(2)} MXN, no tienen médico identificado y no se asignaron a los Top 10.`);
  const unknownType = (financial.documents || []).filter(d => d.FolioAtencion && !d.TipoAtencion).length;
  if (unknownType) warnings.push(`${unknownType} órdenes con atención no tienen tipo confirmado y no se asignaron a los Top 10.`);
  const financialCriterion = 'Los Top 10 agrupan el nombre exacto de médico y suman el total de órdenes de venta vigentes, con IVA si aplica, por fecha de documento. Su coincidencia con los Excel base se informa en la conciliación. Imagen y laboratorio conservan facturas, notas de crédito y sus cancelaciones, sin IVA, en el mes de contabilización de cada movimiento. Cada base se concilia por separado; no se suman órdenes y facturas entre sí.';
  const report = {
    period: range, generatedAt: new Date().toISOString(), sections, warnings, financialCriterion,
    complements: { ...(clinical.complements || {}), structuralUltrasound: sections.structuralUltrasound,
      laboratoryPackages: sections.laboratoryPackages },
    doctorRankings: { general: generalDoctorSection(financial, range) },
    doctorDocuments: financial.documents.map(d => ({
      Fecha: d.Fecha, Documento: d.Documento, FolioAtencion: d.FolioAtencion, TipoAtencion: d.TipoAtencion,
      Medico: d.Medico, NumeroMedico: d.NumeroMedico, IngresoTotal: d.TotalOrdenVenta,
      IVA: d.IVA, EstadoDocumento: d.EstadoDocumento, AtencionesMultiples: d.AtencionesMultiples ? 'Sí' : 'No',
      AlcanceRanking: !['IP', 'ER'].includes(d.TipoAtencion) ? 'Fuera de IP/ER' : !hasDoctorName(d.Medico) ? 'Sin médico identificado' : d.TipoAtencion === 'IP' ? 'Hospitalización' : 'Urgencias'
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
  return applyReconciliation(report, doctorRanking);
}

function annualDoctorCoverage(range, saved = {}) {
  const period = dateRange(`${range.endDate.slice(0, 4)}-01-01`, range.endDate);
  const requiredMonths = monthsFor(period.startDate, period.endDate);
  const storage = saved.storage || {};
  const snapshots = Array.isArray(saved.snapshots) ? saved.snapshots : [];
  const metadata = Array.isArray(storage.months) ? storage.months : [];
  const availableMonths = requiredMonths.filter(month => {
    const entries = metadata.filter(entry => entry.month === month);
    const sources = snapshots.filter(snapshot => snapshot.month === month);
    const through = month === period.endDate.slice(0, 7) ? period.endDate : monthPeriod(month, period.endDate).endDate;
    return entries.length === 1 && entries[0].available && entries[0].throughDate >= through &&
      sources.length === 1 && sources[0].model_version === MODEL_VERSION;
  });
  const missingMonths = requiredMonths.filter(month => !availableMonths.includes(month));
  const pendingMonths = (storage.pendingMonths || []).filter(month => requiredMonths.includes(month));
  const failedMonths = (storage.failedMonths || []).filter(month => requiredMonths.includes(month));
  return { period, modelVersion: MODEL_VERSION, requiredMonths, availableMonths, missingMonths,
    updatedAt: storage.updatedAt || null, complete: missingMonths.length === 0, pendingMonths, failedMonths,
    refreshStatus: pendingMonths.length ? 'refreshing' : failedMonths.length ? 'failed' : 'complete' };
}

function annualDoctorRanking(range, saved = {}) {
  // Metadata establishes coverage before any annual JSONB document projection.
  // Payload integrity is checked separately only when all months are available.
  const coverage = annualDoctorCoverage(range, saved);
  const { period, requiredMonths, missingMonths } = coverage;
  const metadata = saved.storage?.months || [];
  const snapshots = Array.isArray(saved.snapshots) ? saved.snapshots : [];
  const unavailable = (status, warning) => ({ period, rows: [], allRows: [], quantity: null, allQuantity: null,
    unit: 'MXN', measure: 'IngresoTotal', limit: 20, exportAllRows: false, complete: false, status, coverage,
    scopeLabel: 'Cobertura anual pendiente', warnings: [warning],
    criterion: 'Top 20 acumulado desde el 1 de enero hasta la fecha final del informe. Requiere todos los meses completos; no se calcula con sólo el mes seleccionado ni con la suma de rankings mensuales.' });
  if (missingMonths.length) {
    const failed = missingMonths.some(month => metadata.find(entry => entry.month === month)?.status === 'failed');
    return unavailable(failed ? 'failed' : 'pending', 'El ranking anual no está disponible porque falta información completa de uno o más meses.');
  }
  try {
    const documents = [], identifiers = new Set();
    for (const month of requiredMonths) {
      const source = snapshots.find(snapshot => snapshot.month === month);
      if (!Array.isArray(source?.payload?.financial?.documents)) throw new Error('No se pudieron leer las referencias de órdenes del mes.');
      for (const document of source.payload.financial.documents) {
        const day = sourceDate(document.Fecha);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(`${day}T00:00:00Z`)) ||
          new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day || document.DocumentoId == null || String(document.DocumentoId).trim() === '') {
          throw new Error('La copia anual no conserva referencias completas de las órdenes.');
        }
        if (day < period.startDate || day >= period.endExclusive) continue;
        const identifier = String(document.DocumentoId);
        if (identifiers.has(identifier)) throw new Error('Hay órdenes repetidas entre meses.');
        identifiers.add(identifier);
        documents.push(document);
      }
    }
    const allRows = doctorRanking(documents, 'ALL');
    const rows = allRows.slice(0, 20);
    return { period, rows, allRows, quantity: money(rows, 'IngresoTotal'), allQuantity: money(allRows, 'IngresoTotal'),
      unit: 'MXN', measure: 'IngresoTotal', limit: 20, exportAllRows: false, complete: true, status: coverage.refreshStatus, coverage,
      warnings: [], criterion: 'Top 20 acumulado desde el 1 de enero hasta la fecha final del informe. Agrupa el nombre exacto del médico y suma una vez cada orden vigente de hospitalización y urgencias, con IVA si aplica, por fecha de documento. Se calcula desde todas las órdenes de los meses completos; no suma los Top 10 mensuales.' };
  } catch {
    return unavailable('failed', 'No se pudo confirmar el ranking anual con las referencias de órdenes disponibles.');
  }
}

function buildMonthlyComparison(range, { saved = {}, reportSections = {}, historyData = historicalSeriesData(),
  acceptedClosures = acceptedClosuresData(), generatedAt = null } = {}) {
  const period = dateRange(range.startDate, range.endDate);
  const lastYear = Number(period.endDate.slice(0, 4));
  const years = Array.from({ length: 8 }, (_, index) => lastYear - 7 + index);
  const months = Array.from({ length: 12 }, (_, index) => index + 1);
  const definitions = SECTIONS.filter(({ key }) => !['hospitalDoctors', 'emergencyDoctors'].includes(key));
  const requiredMonths = monthsFor(`${Math.max(2026, years[0])}-01-01`, period.endDate);
  const snapshots = Array.isArray(saved.snapshots) ? saved.snapshots : [];
  const entries = Array.isArray(saved.storage?.months) ? saved.storage.months : [];
  const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const calendarEnd = month => { const [year, number] = month.split('-'); return monthRange(year, number).endDate; };
  const selectedMonth = period.endDate.slice(0, 7);
  const selectedStartMonth = period.startDate.slice(0, 7);
  const acceptedThroughMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(acceptedClosures?.throughMonth || '')
    ? acceptedClosures.throughMonth : null;
  const partialEnd = period.endDate < calendarEnd(selectedMonth);
  const canUseReport = period.startDate === `${selectedMonth}-01`;
  const eligible = new Map();
  for (const month of requiredMonths) {
    const metadata = entries.filter(entry => entry.month === month);
    const sources = snapshots.filter(snapshot => snapshot.month === month);
    const throughDate = metadata[0]?.throughDate;
    const expected = month === selectedMonth && partialEnd ? period.endDate : calendarEnd(month);
    // A later saved total cannot represent an earlier cut, and a partial month is never prorated.
    if (metadata.length === 1 && metadata[0].available === true && sources.length === 1 &&
      sources[0].model_version === MODEL_VERSION && throughDate === expected) {
      eligible.set(month, { snapshot: sources[0], throughDate, updatedAt: metadata[0].updatedAt || null });
    }
  }
  const sections = {};
  const allPartialMonths = new Map();
  const allAcceptedMonths = new Set();
  for (const definition of definitions) {
    const partialMonths = [];
    const acceptedMonths = [];
    const series = years.map(year => {
      const values = months.map(month => year < 2026
        ? finite(historyData[LEGACY_ALIASES[definition.id] || definition.id]?.[year]?.[month]) : null);
      const throughDates = months.map(() => null);
      const sources = months.map((month, index) => values[index] == null ? null : 'historical');
      if (year >= 2026) {
        for (const month of months) {
          const monthId = `${year}-${String(month).padStart(2, '0')}`;
          const acceptedYear = acceptedClosures?.data?.[LEGACY_ALIASES[definition.id] || definition.id]?.[year];
          // Accepted institutional closures fill only calendar months before the
          // selected period. A selected month always retains platform figures.
          if (acceptedThroughMonth && monthId < selectedStartMonth && monthId <= acceptedThroughMonth &&
            Object.prototype.hasOwnProperty.call(acceptedYear || {}, month)) {
            values[month - 1] = finite(acceptedYear[month]);
            throughDates[month - 1] = calendarEnd(monthId);
            sources[month - 1] = 'accepted-close';
            acceptedMonths.push(monthId);
            allAcceptedMonths.add(monthId);
            continue;
          }
          const source = eligible.get(monthId);
          if (!source) continue;
          const summary = source.snapshot.summary?.[definition.id];
          values[month - 1] = finite(summary?.quantity);
          if (values[month - 1] != null) {
            throughDates[month - 1] = source.throughDate;
            sources[month - 1] = 'snapshot-summary';
          }
        }
      }
      if (year === lastYear && canUseReport && Object.prototype.hasOwnProperty.call(reportSections[definition.key] || {}, 'quantity')) {
        const index = Number(period.endDate.slice(5, 7)) - 1;
        values[index] = finite(reportSections[definition.key].quantity);
        throughDates[index] = values[index] == null ? null : period.endDate;
        sources[index] = values[index] == null ? null : 'current-report';
      }
      for (const month of months) {
        if (values[month - 1] == null || !throughDates[month - 1] ||
          throughDates[month - 1] === calendarEnd(`${year}-${String(month).padStart(2, '0')}`)) continue;
        const entry = { year, month, throughDate: throughDates[month - 1], source: sources[month - 1] };
        partialMonths.push(entry);
        const key = `${year}-${String(month).padStart(2, '0')}`;
        if (!allPartialMonths.has(key) || entry.source === 'current-report') allPartialMonths.set(key, entry);
      }
      return { year, values, throughDates, sources, partialMonths: partialMonths.filter(row => row.year === year).map(row => row.month) };
    });
    const availableMonths = requiredMonths.filter(month => {
      const [year, number] = month.split('-').map(Number);
      return series.find(row => row.year === year)?.values[number - 1] != null;
    });
    sections[definition.key] = { id: definition.id, label: definition.label, unit: definition.unit, series,
      coverage: { availableMonths, missingMonths: requiredMonths.filter(month => !availableMonths.includes(month)), acceptedMonths }, partialMonths };
  }
  const availableMonths = requiredMonths.filter(month => definitions.every(definition => sections[definition.key].coverage.availableMonths.includes(month)));
  return { period, years, months, sections, acceptedThroughMonth, partialMonths: [...allPartialMonths.values()],
    coverage: { modelVersion: MODEL_VERSION, requiredMonths, availableMonths,
      missingMonths: requiredMonths.filter(month => !availableMonths.includes(month)),
      acceptedMonths: [...allAcceptedMonths].sort(),
      updatedAt: saved.storage?.updatedAt || null, status: saved.status || 'unavailable',
      historicalThroughYear: 2025, currentPeriodGeneratedAt: generatedAt,
      complete: availableMonths.length === requiredMonths.length } };
}

async function getReport(startDate, endDate, { includeAnnual = false } = {}) {
  const range = dateRange(startDate, endDate);
  if (range.endDate > hospitalToday()) throw invalid('La fecha final no puede ser posterior a hoy.');
  const saved = await snapshotStore.readRange(range);
  const uncovered = saved.storage.months.filter(month => !month.available || !month.throughDate || month.throughDate <
    (month.month === endDate.slice(0, 7) ? endDate : require('./statisticsSnapshot.service').monthPeriod(month.month, hospitalToday()).endDate));
  if (uncovered.length) {
    const failed = uncovered.every(month => month.status === 'failed') && saved.storage.pendingMonths.length === 0;
    throw Object.assign(new Error(failed ? 'No se pudo completar la incorporación del periodo. Solicita actualizar para reintentar.' : 'El periodo se está incorporando a la base local.'), {
      code: failed ? 'STATISTICS_SNAPSHOT_FAILED' : 'STATISTICS_PENDING', storage: saved.storage, status: failed ? 503 : 202
    });
  }
  const report = assembleReport(range, combineSnapshots(saved.snapshots, range));
  report.storage = saved.storage;
  report.warnings.push(...storageWarnings(saved.storage));
  if (includeAnnual) {
    const annualRange = dateRange(`${endDate.slice(0, 4)}-01-01`, endDate);
    let comparisonSaved = {};
    try {
      const firstYear = Math.max(2026, Number(endDate.slice(0, 4)) - 7);
      comparisonSaved = await snapshotStore.state(monthsFor(`${firstYear}-01-01`, endDate), { includePayload: false });
    } catch {
      comparisonSaved = { status: 'failed' };
    }
    // The lightweight comparison state also answers whether an annual ranking
    // is possible. Missing or obsolete months must not trigger a year of JSONB.
    const selectedCoversAnnual = annualRange.startDate === range.startDate;
    let annualSaved = selectedCoversAnnual ? saved : comparisonSaved.storage ? comparisonSaved : saved;
    if (!selectedCoversAnnual && comparisonSaved.storage && annualDoctorCoverage(range, annualSaved).complete) {
      try { annualSaved = await snapshotStore.readDoctorDocumentsRange(annualRange); }
      catch {
        report.annualDoctorRanking = annualDoctorRanking(range, annualSaved);
      }
    }
    if (!report.annualDoctorRanking) report.annualDoctorRanking = annualDoctorRanking(range, annualSaved);
    report.monthlyComparison = buildMonthlyComparison(range, { saved: comparisonSaved, reportSections: report.sections, generatedAt: report.generatedAt });
  }
  return report;
}

async function getHistory(sectionId) { return getHistoryForDisplay(sectionId); }

async function getHistoryForDisplay(sectionId, { retryFailed = false } = {}) {
  const definition = BY_ID[sectionId];
  if (!definition) throw invalid('Selecciona un estadístico válido.');
  const today = hospitalToday();
  if (retryFailed) await snapshotStore.schedule({ retry: true });
  const saved = await snapshotStore.readRange({ startDate: '2026-01-01', endDate: today }, { includePayload: false });
  const legacyId = LEGACY_ALIASES[sectionId] || sectionId;
  const data = JSON.parse(JSON.stringify(await snapshotStore.readLegacy(legacyId)));
  for (const [year, months] of Object.entries(historicalSeriesData()[legacyId] || {})) {
    if (Number(year) < 2026) data[year] = { ...(data[year] || {}), ...months };
  }
  for (let year = 2026; year <= Number(today.slice(0, 4)); year++) data[year] = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [index + 1, null]));
  const warnings = storageWarnings(saved.storage);
  warnings.push('Los años anteriores a 2026 son agregados históricos de Excel conservados en la base local; no acreditan detalle de SAP o Vertical.');
  let criterion = '', unit = definition.unit;
  for (const snapshot of saved.snapshots) {
    const summary = snapshot.summary?.[sectionId];
    if (!summary) continue;
    const [year, month] = snapshot.month.split('-').map(Number);
    data[year][month] = summary.quantity;
    criterion = summary.criterion || criterion; unit = summary.unit || unit;
    warnings.push(...(summary.warnings || []));
  }
  return { data, warnings: [...new Set(warnings)], criterion, unit, status: saved.status, storage: saved.storage };
}

function dashboardData(report) {
  const groups = new Map();
  for (const row of report._financial.rows) {
    const label = ({ imagen: 'Imagenología', laboratorio: 'Laboratorio', ultrasonidoEstructural: 'Ultrasonido estructural',
      paquetesLaboratorio: 'Paquetes de laboratorio', consulta: 'Consulta de especialidad', choque: 'Sala de choque' })[row.Categoria] || 'Otros servicios y artículos';
    groups.set(label, (groups.get(label) || 0) + Number(row.IngresoNeto || 0));
  }
  const total = [...groups.values()].reduce((a, b) => a + b, 0);
  const toChart = section => section.rows.map(row => ({ area: row.Medico, n: row.IngresoTotal,
    ranking: row.Ranking, ordenes: row.Ordenes, cuentas: row.Cuentas, numeroMedico: row.NumeroMedico,
    especialidad: `${row.Ordenes} órdenes · ${row.Cuentas} atenciones` }));
  return { general: report.general, period: report.period, warnings: report.warnings, storage: report.storage,
    diagnosticos: [...groups].map(([dx, n]) => ({ dx, n: roundMoney(n), pct: total ? roundMoney(n / total * 100) : 0 })).sort((a,b) => b.n-a.n),
    servicios: toChart(report.sections.hospitalDoctors), medicosGeneral: toChart(report.doctorRankings.general),
    medicosHospitalizacion: toChart(report.sections.hospitalDoctors), medicosUrgencias: toChart(report.sections.emergencyDoctors),
    reconciliationSummary: report.reconciliationSummary,
    pendingIndicators: SECTIONS.filter(definition => report.sections[definition.key]?.quantity == null)
      .map(({ id, label }) => ({ id, label })),
    criteria: { ingresos: report.financialCriterion, nacimientos: report.sections.births.criterion,
      medicosGeneral: report.doctorRankings.general.criterion,
      medicosHospitalizacion: report.sections.hospitalDoctors.criterion, medicosUrgencias: report.sections.emergencyDoctors.criterion }
  };
}

module.exports = { startStatisticsSync: () => snapshotStore.start(), stopStatisticsSync: () => snapshotStore.stop(), combineSnapshots, getReport, getHistory, getHistoryForDisplay, dashboardData, assembleReport, financialSections, generalDoctorSection, annualDoctorCoverage, annualDoctorRanking, buildMonthlyComparison, serviceSummary, topDoctors, doctorRanking, sourceDate, mergeClassification,
  reconcileReport: report => applyReconciliation(report, doctorRanking), clearCache: () => {} };
