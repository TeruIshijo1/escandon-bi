'use strict';
// API completa con PostgreSQL aislado. Vertical y SAP se sustituyen por fuentes
// sintéticas; ninguna decisión de prueba alcanza las tablas operativas.
require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const request = require('supertest');
const express = require('express');
const schema = `test_honorarios_management_${Date.now()}`;
const config = { user: process.env.PGUSER || 'postgres', host: process.env.PGHOST || 'localhost',
  database: process.env.PGDATABASE || 'escandon_bi', port: Number(process.env.PGPORT || 5432), password: process.env.PGPASSWORD };
const admin = new Pool(config);
const pool = new Pool({ ...config, options: `-c search_path=${schema}` });
const cache = (modulePath, exports) => {
  const id = require.resolve(modulePath); require.cache[id] = { id, filename: id, loaded: true, exports };
};
cache('../config/db', { getDb: () => ({ pool }) });
const sources = require('../services/honorariosSources.service');
const catalog = require('../services/honorariosCatalog.service');
const { reviewFingerprint } = require('../utils/honorariosReviewSource');
let fiftyMode=false, directoryReads=0, remoteReads=0, sapReads=0;
let surgical=false;
let referenceRows = [{ Id_UT: 1, ITEMCODE: 'SER1471', IMPORTE: 1, NOTAS: 'Referencia nominal; revisar' }];
const procedure=()=>({PCFRNum:400,CPCode:'CXQ175',PCNum:300,PTNum:100,ServiceDate:'2026-10-03',
  ItemDescription:'CESAREA',ItemGroupName:'PROCEDIMIENTO EN QUIROFANO',SourceProcedureCount:1,
  SurgeryRole:'SURGEON',ProviderCount:1,ProviderId:7,ProviderName:'MÉDICO PRUEBA',PCFR_ST:'CL',PC_ST:'CL'});
let cancelled = false;
const orders = () => fiftyMode ? Array.from({ length: 50 }, (_, i) => ({ SONum: 9000+i, SOLNNum: 5000+i,
  ItemCode: 'SER1471', ItemDescription: 'Sesión de Psicología Afirma', ItemGroupName: 'CONSULTA EXTERNA',
  Quantity: 1, ServiceDate: '2026-09-02', ServiceDateType: 'FECHA_SERVICIO_ORDEN', RequesterId: 7,
  RequesterName: 'MÉDICO PRUEBA', AppointmentCount: 0, ServiceLineCount: 1, SO_ST: 'PR', SOLN_ST: 'PR', UDF_Realizado: null
})) : [{ SONum: 181, SOLNNum: 91, ItemCode: 'SER1471', ItemDescription: 'Sesión de Psicología Afirma',
  ItemGroupName: 'CONSULTA EXTERNA', Quantity: 1, ServiceDate: '2026-09-02', ServiceDateType: 'FECHA_SERVICIO_ORDEN',
  RequesterId: 8, RequesterName: 'SOLICITANTE PRUEBA', AppointmentCount: 0, ServiceLineCount: 1,
  SO_ST: cancelled ? 'CA' : 'PR', SOLN_ST: 'PR', UDF_Realizado: null },
  ...[211, 212].map((id, index) => ({ SONum: 182, SOLNNum: 92, ItemCode: 'SER1471', ItemDescription: 'Sesión de Psicología Afirma',
    ItemGroupName: 'CONSULTA EXTERNA', Quantity: 1, ServiceDate: `2026-09-0${2 + index}`, ServiceDateType: 'CITA_PROGRAMADA',
    PCAPNum: id, AppointmentDoctorId: 7, AppointmentDoctorName: 'MÉDICO PRUEBA', AppointmentCount: 2,
    ServiceLineCount: 1, PCAP_ST: 'SH', UDF_Ejecutada: true, SO_ST: 'PR', SOLN_ST: 'PR' }))];
const remote = { request() { const params = {}; return { input(key, value) { params[key] = value; return this; },
  async query(sql) {
    remoteReads++;
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|CREATE|TRUNCATE|EXEC|INTO)\b/i);
    let rows = [];
    if (sql === catalog.CATALOG_SQL) rows = [
      ...(surgical?[{ItemCode:'CXQ175',ItemDescription:'CESAREA',ItemType:'S',ItemGroupName:'PROCEDIMIENTO EN QUIROFANO',Enabled:true}]:[]),
      { ItemCode: 'SER1471', ItemDescription: 'Sesión de Psicología Afirma', ItemType: 'S', ItemGroupName: 'CONSULTA EXTERNA', Enabled: true },
      { ItemCode: 'A-CEYE', ItemDescription: 'ARTICULO CEYE', ItemType: 'S', ItemGroupName: 'ALIAS', Enabled: true },
      { ItemCode: 'PQX0002', ItemDescription: 'FISTULECTOMIA PAQUETE QX', ItemType: 'S', ItemGroupName: 'PAQUETE DE CIRUGIA', Enabled: true },
      { ItemCode: 'SER0713', ItemDescription: 'SERVICIOS ADMINISTRATIVOS', ItemType: 'S', ItemGroupName: 'ANALISIS DE CUENTAS', Enabled: true },
      { ItemCode: 'SER0715', ItemDescription: 'JORNADA VIGILANCIA ESPECIALIDAD MEDICA PROYECTO HSBC', ItemType: 'S', ItemGroupName: 'ANALISIS DE CUENTAS', Enabled: true },
      { ItemCode: 'SER_NUEVO', ItemDescription: 'CONCEPTO NUEVO POR CLASIFICAR', ItemType: 'S', ItemGroupName: '', Enabled: true }
    ];
    else if (sql === catalog.REFERENCE_SQL) rows = referenceRows;
    else if (sql === sources.ORDER_CANDIDATES_SQL) rows = orders().filter(row => row.ServiceDate >= params.startDate && row.ServiceDate <= params.endDate);
    else if(sql === sources.PROCEDURE_CANDIDATES_SQL) rows=surgical?[procedure()].filter(row=>row.ServiceDate>=params.startDate&&row.ServiceDate<=params.endDate):[];
    else if (/FROM PR WHERE Role='P'/.test(sql)) { directoryReads++; rows = [{ PRNum: 7, FullName: 'MÉDICO PRUEBA', Role: 'P' }, { PRNum: 8, FullName: 'SOLICITANTE PRUEBA', Role: 'P' }]; }
    return { recordset: rows };
  } }; } };
cache('../config/remote-db', { connectRemoteDB: async () => remote, getRemoteDb: async () => remote });
cache('../middleware/auth.middleware', { authenticate(req, _res, next) { req.user = { id: 7, nombre: 'REVISOR PRUEBA', role: 'ADMIN', permisos: ['interconsultas-jornadas'] }; next(); }, authorize: () => (_req, _res, next) => next() });
cache('../services/honorariosSapReconciliation.service', { reconcileHonorariosWithSap: async ({ doctors, startDate, endDate }) => {
  sapReads++;
  return {
  ok: true, asOf: new Date().toISOString(), period: { startDate, endDate }, additionalProviders: [],
  providers: Object.fromEntries(doctors.map(name => [name, { linkStatus: 'candidato_unico', invoices: [],
    candidates: [{ subjectToWithholding: true, federalTaxId: 'AAAA800101AAA', configuredWithholdings: [
      { inactive: false, estimateRule: 'isr_on_fee', rate: 10, appliesAt: 'factura', codeEffectiveFrom: '2025-01-01' }
    ] }] }])) };
} });
const app = express(); app.use(express.json()); app.use('/api/honorarios', require('../routes/honorarios.routes'));
const api = async (method, path, body, status = 200) => {
  const result = await request(app)[method](`/api/honorarios${path}`).send(body);
  assert.equal(result.status, status, JSON.stringify(result.body)); return result.body;
};
const availableInput = { startDate: '2026-09-01', endDate: '2026-09-30', providerId: 7 };
const financialSnapshot = async () => Object.fromEntries(await Promise.all([
  ['bi_honorarios_reviews', 'row_id'], ['bi_honorarios_review_history', 'id'],
  ['bi_honorarios_fiscal_profiles', 'provider_id'], ['bi_honorarios_fiscal_profile_history', 'id'],
  ['bi_honorarios_tariffs', 'id'], ['bi_honorarios_liquidations', 'id'],
  ['bi_honorarios_finalized_rows', 'row_id'], ['bi_honorarios_payment_applications', 'id'],
  ['bi_honorarios_liquidation_adjustments', 'id']
].map(async ([table, order]) => [table, (await pool.query(`SELECT * FROM ${table} ORDER BY ${order}`)).rows])));
const availableWithoutMutations = async (body = availableInput, status = 200) => {
  const before = await financialSnapshot(), sapBefore = sapReads;
  const result = await api('post', '/available-payment-report', body, status);
  assert.deepEqual(await financialSnapshot(), before, 'Consultar el reporte disponible conserva tarifas, aprobaciones, fichas, cierres y pagos');
  assert.equal(sapReads, sapBefore, 'El reporte disponible no consulta SAP');
  return result.report || result;
};
const audit = async () => (await api('get', '/audit?startDate=2026-09-01&endDate=2026-09-30')).data;
const approve = (row, changes = {}) => ({ rowId: row.SourceIdentity, serviceDate: row.FechaAtencion.slice(0, 10), expectedRevision: 0,
  decision: { action: 'APROBAR', customAmount: 999999, fingerprint: reviewFingerprint(row), motivo: 'Servicio y beneficiario revisados',
    providerId: 7, quantity: 1, executionConfirmed: true, evidenceReference: 'CC-TEST', vatRate: 0,
    physicianChangeReason: Number(row.ReviewBeneficiary?.providerId ?? row.MedicoId) !== 7
      ? 'Corrección del médico por captura errónea en la prueba aislada.' : '',
    quotedTariffId: row.TariffSnapshot?.id, quotedTariffRevision: row.TariffSnapshot?.revision, ...changes } });

(async () => {
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    const first = await api('get', '/catalog');
    const psychology = first.items.find(item => item.itemCode === 'SER1471');
    assert.equal(psychology.status, 'PENDIENTE'); assert.equal(psychology.modality, 'contact_center');
    assert.equal(first.items.find(item => item.itemCode === 'SER0715').professionalCandidate, true);
    assert.equal(first.items.find(item => item.itemCode === 'SER_NUEVO').professionalCandidate, false);
    // Reproduce los formularios simplificados en un servicio sin movimientos.
    const other = first.items.find(item => item.itemCode === 'SER0715');
    await pool.query("UPDATE bi_honorarios_catalog SET payment_unit='sesión' WHERE item_code='SER0715'");
    const simplified = await api('put', '/catalog/SER0715', { expectedRevision: other.revision,
      status: 'PENDIENTE', modality: 'presencial' });
    assert.equal(simplified.item.paymentUnit, 'sesión'); assert.equal(simplified.item.reason, '');
    const datedInput = { expectedRevision: 0, amount: 600, validFrom: '2026-10-06', validTo: '2026-10-31', role: 'AN (anestesiólogo)' };
    const dated = (await api('post', '/catalog/SER0715/tariffs', datedInput)).tariff;
    assert.equal(dated.role, 'AN'); assert.equal(dated.validTo, '2026-10-31'); assert.equal(dated.reason, '');
    const edited = (await api('post', '/catalog/SER0715/tariffs', { ...datedInput, id: dated.id,
      expectedRevision: dated.revision, role: 'AN', validTo: '2026-11-30' })).tariff;
    const stored = (await api('get', '/catalog/SER0715/tariffs')).tariffs;
    assert.equal(stored[0].validFrom, '2026-10-06'); assert.equal(stored[0].validTo, '2026-11-30');
    assert.equal(catalog.resolveTariff({ itemCode: 'SER0715', role: 'AN', serviceDate: '2026-11-30' }, stored).tariff.id, dated.id);
    assert.equal(catalog.resolveTariff({ itemCode: 'SER0715', role: 'AN', serviceDate: '2026-12-01' }, stored).tariff, null);
    await api('post', '/catalog/SER0715/tariffs', { ...datedInput, id: dated.id, expectedRevision: edited.revision, validTo: '2026-10-05' }, 400);
    await api('post', '/catalog/SER0715/tariffs', datedInput, 409);
    await api('post', '/catalog/SER0715/tariffs', { ...datedInput, id: dated.id, expectedRevision: dated.revision }, 409);
    const datedHistory = (await api('get', '/catalog/SER0715/history')).history;
    assert.equal(datedHistory.length, 3);
    assert.ok(datedHistory.every(entry => entry.updatedBy.includes('REVISOR PRUEBA')));
    console.log('PASS: formularios sin motivos, unidad existente conservada, función con acentos, fecha final inclusiva, edición, historial y conflictos.');
    const excludedCodes = ['A-CEYE', 'PQX0002', 'SER0713'];
    assert.equal(first.items.some(item => excludedCodes.includes(item.itemCode)), false);
    // Simula caché creada antes de la regla: lectura y guardas recalculan alcance.
    await pool.query("UPDATE bi_honorarios_catalog SET scope_excluded=false,status='INCLUIDO' WHERE item_code=ANY($1::text[])", [excludedCodes]);
    assert.equal((await api('get', '/catalog')).items.some(item => excludedCodes.includes(item.itemCode)), false);
    for (const code of excludedCodes) {
      await api('put', `/catalog/${code}`, { expectedRevision: 0, status: 'INCLUIDO', modality: 'presencial', paymentUnit: 'servicio', reason: 'Intento fuera del alcance' }, 400);
      await api('post', `/catalog/${code}/tariffs`, { expectedRevision: 0, amount: 250, validFrom: '2026-01-01', reason: 'Intento fuera del alcance' }, 400);
    }
    let rows = await audit(); assert.equal(rows.length, 0);
    assert.equal((await api('get', '/catalog?approvalStatus=APROBADO')).items.length, 0);
    const pending = await api('get', '/audit?startDate=2026-09-01&endDate=2026-09-30');
    assert.equal(pending.coverage.pendingCatalog, 3); assert.equal(pending.coverage.omittedFromReview, 3);
    await api('put', '/reviews', { rowId: 'BI|SOLN|91|ORDEN', serviceDate: '2026-09-02', expectedRevision: 0,
      decision: { action: 'APROBAR', fingerprint: 'inventada' } }, 409);
    const included = await api('put', '/catalog/SER1471', { expectedRevision: psychology.revision, status: 'INCLUIDO', modality: 'contact_center', paymentUnit: 'sesión', reason: 'Acuerdo validado por responsable' });
    assert.equal(included.item.approvalStatus, 'PENDIENTE');
    assert.equal((await audit()).length, 0);
    const future = await api('post', '/catalog/SER1471/tariffs', { expectedRevision: 0, amount: 250, validFrom: '2027-01-01', reason: 'Convenio para el próximo año' });
    const futureApproved = await api('get', '/catalog?approvalStatus=APROBADO');
    assert.equal(futureApproved.items.length, 1); assert.equal(futureApproved.items[0].approvedTariffCount, 1);
    const futurePeriod = await api('get', '/audit?startDate=2026-09-01&endDate=2026-09-30');
    assert.equal(futurePeriod.data.length, 0); assert.equal(futurePeriod.coverage.pendingTariff, 3);
    await api('post', '/catalog/SER1471/tariffs', { id: future.tariff.id, expectedRevision: 1, amount: 250,
      validFrom: '2027-01-01', active: false, reason: 'Retiro de prueba futura' });
    const created = await api('post', '/catalog/SER1471/tariffs', { expectedRevision: 0, amount: 250, validFrom: '2026-01-01', reason: 'Tarifa de prueba' });
    assert.equal(created.item.approvalStatus, 'APROBADO');
    assert.equal(created.item.approvedTariffCount, 1);
    const refreshedConfig = await api('put', '/catalog/SER1471', { expectedRevision: included.item.revision, status: 'INCLUIDO', modality: 'contact_center' });
    assert.equal(refreshedConfig.item.paymentUnit, 'sesión');
    assert.equal(refreshedConfig.item.approvalStatus, 'APROBADO'); assert.equal(refreshedConfig.item.approvedTariffCount, 1);
    rows = await audit(); let online = rows.find(row => row.SourceLineId === 91);
    assert.equal(rows.length, 3); assert.equal(online.CatalogApproved, true); assert.equal(online.ReviewEligible, true);
    assert.equal(online.ElegiblePago, 0); assert.equal(online.MedicoConfirmado, false);
    // Una baja de Vertical entre la preparación y la escritura no cambia la
    // revisión BI, pero debe bloquear también el guardado transaccional.
    const preparedBeforeDeactivation = await require('../services/honorariosWorkflow.service')
      .prepareSourceReview(remote, approve(online));
    await pool.query("UPDATE bi_honorarios_catalog SET source_active=false WHERE item_code='SER1471'");
    await assert.rejects(require('../services/honorariosReview.service').saveReview(preparedBeforeDeactivation,
      { id: 7, nombre: 'REVISOR PRUEBA', permisos: ['interconsultas-jornadas'] }, { sourceValidated: true }),
    error => error.status === 409);
    assert.equal((await pool.query('SELECT count(*)::integer AS count FROM bi_honorarios_reviews')).rows[0].count, 0);
    assert.equal((await pool.query('SELECT count(*)::integer AS count FROM bi_honorarios_review_history')).rows[0].count, 0);
    await pool.query("UPDATE bi_honorarios_catalog SET source_active=true WHERE item_code='SER1471'");
    console.log('PASS: servicio desactivado después de preparar la aprobación rechazado, sin revisión ni historial nuevos.');
    await api('put', '/reviews', approve(online, { evidenceReference: '' }), 400);
    const approved = await api('put', '/reviews', approve(online, { confirmationMode: 'DIRECT_APPROVAL', evidenceReference: '' }));
    assert.equal(approved.review.customAmount, 250); assert.equal(approved.review.snapshot.providerId, 7);
    assert.equal(approved.review.snapshot.execution.confirmedInBI, true);
    assert.equal(approved.review.snapshot.execution.confirmationMethod, 'REVIEWER_APPROVAL');
    assert.equal(approved.review.snapshot.execution.reference, '');
    const batchPreview = await api('post', '/reviews/bulk-preview', { startDate: '2026-09-01', endDate: '2026-09-30',
      rows: [{ rowId: online.SourceIdentity, expectedRevision: 1, providerId: 7, quantity: 1, role: 'TRATANTE' }] });
    const batchApproved = await api('post', '/reviews/bulk', { startDate: '2026-09-01', endDate: '2026-09-30', rows: batchPreview.rows,
      decision: { action: 'APROBAR', executionConfirmed: true, evidenceReference: 'CONTACT-CENTER-LOTE', motivo: 'Selección verificada', vatRate: 0 } });
    assert.equal(batchApproved.savedCount, 1); assert.equal(batchApproved.reviews[online.SourceIdentity].revision, 2);
    const exception = await api('post', '/catalog/SER1471/tariffs', { expectedRevision: 0, providerId: 7, amount: 275, validFrom: '2026-01-01', reason: 'Excepción posterior para el médico asignado' });
    assert.equal((await audit()).find(row => row.SourceLineId === 91).ReviewInvalidated, true);
    await api('post', '/liquidations', { startDate: '2026-09-01', endDate: '2026-09-30', providerId: 7, confirmed: true, reason: 'Debe revisar cambio de tarifa' }, 409);
    const withdrawnGeneral = await api('post', '/catalog/SER1471/tariffs', { id: created.tariff.id,
      expectedRevision: created.tariff.revision, amount: 250, validFrom: '2026-01-01', active: false,
      reason: 'Se conserva únicamente la tarifa del médico beneficiario' });
    const assigned = (await audit()).find(row => row.SourceLineId === 91);
    assert.ok(assigned); assert.equal(assigned.MedicoId, 8); assert.equal(assigned.TariffSnapshot, null);
    assert.equal(assigned.ReviewEligible, true); assert.equal(assigned.ReviewInvalidated, true);
    assert.equal(assigned.ReviewBeneficiary.providerId, 7); assert.equal(assigned.ReviewEligibilityTariff.id, exception.tariff.id);
    const beneficiaryReport = await api('get', `/audit?startDate=2026-09-01&endDate=2026-09-30&medico=${encodeURIComponent('MÉDICO PRUEBA')}`);
    assert.ok(beneficiaryReport.data.some(row => row.SourceLineId === 91));
    const assignedPreview = await api('post', '/approval-preview', { rowId: assigned.SourceIdentity,
      serviceDate: assigned.FechaAtencion.slice(0, 10), quantity: 1 });
    assert.equal(assignedPreview.provider.id, 7); assert.equal(assignedPreview.row.TariffSnapshot.id, exception.tariff.id);
    cancelled = true;
    assert.equal((await audit()).some(row => row.SourceLineId === 91), false);
    cancelled = false;
    await api('put', '/reviews', { ...approve(assigned, { quotedTariffId: exception.tariff.id,
      quotedTariffRevision: exception.tariff.revision }), expectedRevision: 2 });
    assert.equal((await audit()).find(row => row.SourceLineId === 91).ReviewInvalidated, false);
    const restoredGeneral = await api('post', '/catalog/SER1471/tariffs', { id: created.tariff.id,
      expectedRevision: withdrawnGeneral.tariff.revision, amount: 250, validFrom: '2026-01-01', active: true,
      reason: 'Reactivación de tarifa general para la revisión final' });
    await api('post', '/catalog/SER1471/tariffs', { id: exception.tariff.id, expectedRevision: exception.tariff.revision,
      providerId: 7, amount: 275, validFrom: '2026-01-01', active: false, reason: 'Retiro de excepción de prueba' });
    const finalOnline = (await audit()).find(row => row.SourceLineId === 91);
    assert.equal(finalOnline.ReviewInvalidated, true);
    await api('put', '/reviews', { ...approve(finalOnline), expectedRevision: 3 });
    assert.equal((await audit()).find(row => row.SourceLineId === 91).ReviewInvalidated, false);
    await api('get', '/liquidations');
    await api('get', '/fiscal-profiles');
    const firstAvailable = await availableWithoutMutations();
    assert.equal(firstAvailable.status, 'FISCAL_PENDING');
    assert.deepEqual(firstAvailable.totals, { base: 250, vat: 0, isr: null, vatWithholding: null, net: null });
    assert.equal(firstAvailable.doctors.length, 1);
    assert.equal(firstAvailable.doctors[0].providerId, 7, 'Se usa el médico asignado en la aprobación y no el solicitante de Vertical');
    assert.deepEqual(firstAvailable.doctors[0].fiscal, { federalTaxId: null, fiscalRegime: null, ready: false });
    assert.equal(firstAvailable.doctors[0].lines.length, 1);
    assert.equal(firstAvailable.doctors[0].lines[0].rowId, online.SourceIdentity);
    assert.equal(firstAvailable.doctors[0].lines[0].baseAmount, 250);
    assert.equal(firstAvailable.doctors[0].lines[0].vatRate, 0);
    assert.equal(firstAvailable.doctors[0].lines[0].vat, 0);
    assert.equal(firstAvailable.doctors[0].lines[0].netAmount, null);
    assert.equal(Object.hasOwn(firstAvailable, 'liquidationId'), false);
    console.log('PASS: reporte disponible con fiscal pendiente conserva médico, honorario e IVA aprobado, sin consultar SAP ni modificar datos financieros.');
    const closed = await api('post', '/liquidations', { startDate: '2026-09-01', endDate: '2026-09-30', providerId: 7, confirmed: true, reason: 'Cierre revisado' });
    const id = closed.liquidation.id; assert.equal(closed.liquidation.snapshot.totalNet, 225);
    const noAvailableAfterClose = await availableWithoutMutations(availableInput, 400);
    assert.match(noAvailableAfterClose.error, /No hay servicios aprobados disponibles/);
    const paymentReport = (await api('get', `/liquidations/${id}/payment-report`)).report;
    assert.equal(paymentReport.status, 'READY'); assert.equal(paymentReport.totals.payable, 225);
    assert.equal(paymentReport.doctors[0].providerId, 7); assert.equal(paymentReport.totals.base, 250);
    for (const [path, amount] of [['payments', 1.005], ['adjustments', 1.005], ['adjustments', -1.005]]) {
      const rejected = await api('post', `/liquidations/${id}/${path}`, { rowId: online.SourceIdentity, amount,
        paymentDate: '2026-09-30', reference: `PRECISION-${path}-${amount}`, reason: 'Debe rechazar fracciones de centavo' }, 400);
      assert.match(rejected.error, /máximo de dos decimales/);
    }
    await api('put', '/reviews', { ...approve(online), expectedRevision: 1, decision: { ...approve(online).decision, action: 'EXCLUIR' } }, 409);
    const paid = await api('post', `/liquidations/${id}/payments`, { rowId: online.SourceIdentity, amount: 100, paymentDate: '2026-09-30', reference: 'COMPROBANTE-1', reason: 'Pago verificado' });
    assert.equal(paid.liquidation.balance, 125);
    await api('post', `/liquidations/${id}/payments`, { rowId: online.SourceIdentity, amount: 126, paymentDate: '2026-09-30', reference: 'COMPROBANTE-2', reason: 'Excede saldo' }, 400);
    await api('post', `/liquidations/${id}/payments`, { rowId: online.SourceIdentity, amount: 100, paymentDate: '2026-09-30', reference: 'COMPROBANTE-1', reason: 'Duplicado' }, 409);
    const adjusted = await api('post', `/liquidations/${id}/adjustments`, { rowId: online.SourceIdentity, amount: -50, reference: 'NOTA-1', reason: 'Ajuste documentado' });
    assert.equal(adjusted.liquidation.balance, 75); assert.equal(adjusted.liquidation.snapshot.totalNet, 225);
    const partialReport = (await api('get', `/liquidations/${id}/payment-report`)).report;
    assert.equal(partialReport.totals.net, 225); assert.equal(partialReport.totals.paid, 100);
    assert.equal(partialReport.totals.adjustments, -50); assert.equal(partialReport.totals.payable, 75);
    rows = await audit(); const shared = rows.filter(row => row.SourceLineId === 92);
    assert.equal(shared[0].Cantidad, null); await api('put', '/reviews', approve(shared[0]));
    await api('put', '/reviews', approve(shared[1]), 409);
    const changedTariff = await api('post', '/catalog/SER1471/tariffs', { id: created.tariff.id, expectedRevision: restoredGeneral.tariff.revision, amount: 350, validFrom: '2026-01-01', reason: 'Cambio posterior al cierre' });
    assert.equal((await api('get', `/liquidations/${id}`)).liquidation.snapshot.totalNet, 225);
    assert.equal((await api('get', `/liquidations/${id}/payment-report`)).report.totals.net, 225);
    cancelled = true;
    const changes = await api('post', `/liquidations/${id}/check`);
    assert.equal(changes.changes.length, 1); assert.match(changes.changes[0].reason, /cancelada/);
    const blocked = (await api('get', `/liquidations/${id}/payment-report`)).report;
    assert.equal(blocked.status, 'REVIEW_REQUIRED'); assert.equal(blocked.totals.payable, 0);
    assert.equal(blocked.issues[0].code, 'CLINICAL_SOURCE_CANCELLED');
    const currentShared = (await audit()).find(row => row.SourceIdentity === shared[0].SourceIdentity);
    const batch = await api('post', '/reviews/bulk', { startDate: '2026-09-01', endDate: '2026-09-30',
      rows: [{ rowId: currentShared.SourceIdentity, expectedRevision: 1, fingerprint: reviewFingerprint(currentShared) },
        { rowId: 'BI|MISSING|9|X', expectedRevision: 0, fingerprint: 'missing' }],
      decision: { action: 'EXCLUIR', motivo: 'Revisión conjunta documentada', vatRate: null } });
    assert.equal(batch.savedCount, 1); assert.equal(batch.errors.length, 1);
    await api('post', '/catalog/SER1471/tariffs', { id: changedTariff.tariff.id, expectedRevision: changedTariff.tariff.revision,
      amount: 350, validFrom: '2026-01-01', active: false, reason: 'Retiro de tarifa después del cierre' });
    assert.equal((await audit()).length, 0);
    assert.equal((await api('get', '/catalog?approvalStatus=APROBADO')).items.length, 0);
    const history = (await api('get', `/liquidations/${id}`)).liquidation;
    assert.equal(history.snapshot.totalNet, 225); assert.equal(history.balance, 75);
    cancelled = false;
    assert.equal((await api('post', `/liquidations/${id}/check`)).changes.length, 0);
    assert.equal((await api('get', `/liquidations/${id}/payment-report`)).report.totals.payable, 75);
    await api('post', `/liquidations/${id}/payments`, { rowId: online.SourceIdentity, amount: 75,
      paymentDate: '2026-09-30', reference: 'PAGO-SALDO', reason: 'Liquidación del saldo' });
    assert.equal((await api('get', `/liquidations/${id}/payment-report`)).report.status, 'PAID');
    await api('post', `/liquidations/${id}/adjustments`, { rowId: online.SourceIdentity, amount: -1.01,
      reference: 'CORRECCION-CENTAVOS', reason: 'Crédito después de pagar' });
    const credit = (await api('get', `/liquidations/${id}/payment-report`)).report;
    assert.equal(credit.status, 'REVIEW_REQUIRED'); assert.equal(credit.totals.balance, -1.01); assert.equal(credit.totals.payable, 0);
    await api('post', `/liquidations/${id}/adjustments`, { rowId: online.SourceIdentity, amount: 1.01,
      reference: 'CORRECCION-CENTAVOS', reason: 'Corrección documentada de la misma referencia' });
    assert.equal((await api('get', `/liquidations/${id}/payment-report`)).report.status, 'PAID');

    // Una cantidad fraccionada conserva el mismo centavo en preview, aprobación,
    // cierre y reporte de pago generado exclusivamente desde datos congelados.
    const latestTariff = (await api('get', '/catalog/SER1471/tariffs')).tariffs.find(item => item.id === created.tariff.id);
    await api('post', '/catalog/SER1471/tariffs', { id: latestTariff.id, expectedRevision: latestTariff.revision,
      amount: 33.5, validFrom: '2026-01-01', active: true, reason: 'Tarifa para prueba de cantidad fraccionada' });
    const fractionalRow = (await audit()).find(row => row.SourceIdentity === shared[1].SourceIdentity);
    const fractionalPreview = (await api('post', '/approval-preview', { rowId: fractionalRow.SourceIdentity,
      serviceDate: fractionalRow.FechaAtencion.slice(0, 10), providerId: 7, quantity: 0.03 })).row;
    assert.equal(fractionalPreview.BaseImporte, 1.01);
    const fractionalApproval = await api('put', '/reviews', approve(fractionalRow, { quantity: 0.03 }));
    assert.equal(fractionalApproval.review.snapshot.baseAmount, 1.01);
    const fractionalClosed = (await api('post', '/liquidations', { startDate: '2026-09-01', endDate: '2026-09-30',
      providerId: 7, confirmed: true, reason: 'Cierre de cantidad fraccionada' })).liquidation;
    assert.equal(fractionalClosed.snapshot.totalBase, 1.01); assert.equal(fractionalClosed.snapshot.totalNet, 0.91);
    const fractionalReport = (await api('get', `/liquidations/${fractionalClosed.id}/payment-report`)).report;
    assert.equal(fractionalReport.totals.base, 1.01); assert.equal(fractionalReport.totals.net, 0.91);

    // Un pago confirmado después de leer la cabecera no se mezcla con una
    // versión anterior del cierre dentro de la misma lectura consistente.
    const originalConnect = pool.connect.bind(pool);
    const concurrentClient = await originalConnect();
    let concurrentInserted = false;
    pool.connect = async () => {
      const client = await originalConnect(), originalQuery = client.query.bind(client);
      client.query = async (sql, values) => {
        const result = await originalQuery(sql, values);
        if (!concurrentInserted && String(sql).includes('transaction_timestamp() AS report_generated_at')) {
          concurrentInserted = true;
          await concurrentClient.query(`INSERT INTO bi_honorarios_payment_applications
            (liquidation_id,row_id,amount,payment_date,reference,reason,created_by)
            VALUES($1,$2,0.01,'2026-09-30','CONCURRENT-READ','Pago concurrente de prueba','1: Prueba')`,
          [fractionalClosed.id, fractionalRow.SourceIdentity]);
        }
        return result;
      };
      const release = client.release.bind(client);
      client.release = (...args) => { client.query = originalQuery; return release(...args); };
      return client;
    };
    try {
      const beforeConcurrentPayment = (await api('get', `/liquidations/${fractionalClosed.id}/payment-report`)).report;
      assert.equal(beforeConcurrentPayment.totals.paid, 0); assert.equal(beforeConcurrentPayment.totals.balance, 0.91);
    } finally { pool.connect = originalConnect; concurrentClient.release(); }
    const afterConcurrentPayment = (await api('get', `/liquidations/${fractionalClosed.id}/payment-report`)).report;
    assert.equal(afterConcurrentPayment.totals.paid, 0.01); assert.equal(afterConcurrentPayment.totals.balance, 0.9);
    surgical=true;await api('post','/catalog/sync');
    await api('put','/catalog/CXQ175',{status:'INCLUIDO',expectedRevision:0,modality:'presencial',
      paymentUnit:'procedimiento',reason:'Honorario quirúrgico confirmado para prueba'});
    await api('post','/catalog/CXQ175/tariffs',{expectedRevision:0,amount:1000,role:'SURGEON',
      providerId:7,validFrom:'2026-01-01',active:true,reason:'Convenio quirúrgico de prueba'});
    const surgicalRows=(await api('get','/audit?startDate=2026-10-01&endDate=2026-10-05')).data;
    assert.equal(surgicalRows.length,1);const surgicalRow=surgicalRows[0];
    assert.equal(surgicalRow.SourceType,'PCFRCP');assert.equal(surgicalRow.RolMedico,'SURGEON');
    assert.equal(surgicalRow.BaseImporte,1000);assert.equal(surgicalRow.ElegiblePago,0);
    await api('put','/reviews',approve(surgicalRow,{role:'SURGEON'}));
    const surgeryClosed=(await api('post','/liquidations',{startDate:'2026-10-01',endDate:'2026-10-05',
      providerId:7,confirmed:true,reason:'Cierre quirúrgico de prueba'})).liquidation;
    const surgeryReport=(await api('get',`/liquidations/${surgeryClosed.id}/payment-report`)).report;
    assert.equal(surgeryReport.status,'READY');assert.equal(surgeryReport.totals.base,1000);
    assert.equal(surgeryReport.totals.net,900);assert.equal(surgeryReport.doctors[0].lines[0].sourceType,'PCFRCP');
    fiftyMode=true;
    const batchItem=(await api('get','/catalog')).items.find(item=>item.itemCode==='SER1471');
    await api('put','/catalog/SER1471',{status:'INCLUIDO',expectedRevision:batchItem.revision,
      modality:'contact_center',paymentUnit:'sesión',reason:'Cincuenta servicios ficticios para aprobación múltiple'});
    const batchTariffs=(await api('get','/catalog/SER1471/tariffs')).tariffs;
    const activeGeneral=batchTariffs.find(tariff=>tariff.active&&!tariff.providerId&&!tariff.role);
    await api('post','/catalog/SER1471/tariffs',{id:activeGeneral.id,expectedRevision:activeGeneral.revision,
      amount:250,validFrom:'2026-01-01',active:true,reason:'Importe uniforme para prueba de cincuenta servicios'});
    const fiftySources=await audit();assert.equal(fiftySources.length,50);
    const directoryBeforePreview=directoryReads;
    const fiftyPreview=await api('post','/reviews/bulk-preview',{startDate:'2026-09-01',endDate:'2026-09-30',
      rows:fiftySources.map(row=>({rowId:row.SourceIdentity,expectedRevision:0,providerId:7,quantity:1,role:'TRATANTE'}))});
    assert.equal(fiftyPreview.rows.length,50);assert.equal(directoryReads-directoryBeforePreview,1);
    const directoryBeforeSave=directoryReads;
    const fiftySaved=await api('post','/reviews/bulk',{startDate:'2026-09-01',endDate:'2026-09-30',rows:fiftyPreview.rows,
      decision:{action:'APROBAR',vatRate:0.16,executionConfirmed:true,confirmationMode:'DIRECT_APPROVAL',
        motivo:'Servicios e IVA confirmados en aprobación múltiple.'}});
    assert.equal(fiftySaved.savedCount,50);assert.deepEqual(fiftySaved.errors,[]);
    assert.equal(directoryReads-directoryBeforeSave,1);
    assert.ok(Object.values(fiftySaved.reviews).every(review=>review.vatRate===0.16&&review.snapshot.baseAmount===250
      &&review.snapshot.providerId===7&&review.snapshot.execution.confirmationMethod==='REVIEWER_APPROVAL'));
    const storedFifty=await pool.query("SELECT count(*)::integer AS count FROM bi_honorarios_reviews WHERE row_id LIKE 'BI|SOLN|50%|ORDEN' AND payload->>'vatRate'='0.16'");
    assert.equal(storedFifty.rows[0].count,50);
    const rereadFifty = await audit();
    const rereadReviews = (await api('get', '/reviews?startDate=2026-09-01&endDate=2026-09-30')).reviews;
    const { calculateHonorarios, reviewFingerprint: clientReviewFingerprint } = await import('../../frontend/src/utils/honorariosCalculation.js');
    for (const row of rereadFifty) {
      assert.equal(row.ReviewInvalidated, false, 'Una aprobación sin cambios sigue vigente después de recargar');
      assert.equal(clientReviewFingerprint(row), reviewFingerprint(row), 'Cliente y servidor conservan la misma firma tras serializar la API');
      assert.equal(rereadReviews[row.SourceIdentity].fingerprint, reviewFingerprint(row));
    }
    const restoredFifty = calculateHonorarios(rereadFifty, rereadReviews);
    assert.equal(restoredFifty.filter(row => row._reviewStatus === 'APROBADO' && row._effectiveElegible).length, 50);
    assert.equal(restoredFifty.filter(row => row._reviewStatus === 'PENDIENTE' || row._reviewStale).length, 0);
    const fiftyAvailablePending = await availableWithoutMutations();
    assert.equal(fiftyAvailablePending.status, 'FISCAL_PENDING');
    assert.deepEqual(fiftyAvailablePending.totals, { base: 12500, vat: 2000, isr: null, vatWithholding: null, net: null });
    assert.equal(fiftyAvailablePending.doctors[0].lines.length, 50);
    assert.ok(fiftyAvailablePending.doctors[0].lines.every(line => line.quantity === 1 && line.unitAmount === 250
      && line.baseAmount === 250 && line.vatRate === 0.16 && line.vat === 40
      && line.isr === null && line.vatWithholding === null && line.netAmount === null));
    console.log('PASS: 50 servicios aprobados con IVA 16% generan reporte disponible fiscal pendiente con base e IVA exactos, sin alteraciones.');
    console.log('PASS: cincuenta aprobaciones leídas desde PostgreSQL conservan firma, estado aprobado y elegibilidad en el cálculo real del cliente.');
    {
      // Reproduce referencias guardadas antes del enriquecimiento de auditoría,
      // sin modificar las aprobaciones ni tarifas del esquema operativo.
      const beforeConfig = (await pool.query("SELECT status,modality,payment_unit,reason,revision FROM bi_honorarios_catalog WHERE item_code='SER1471'")).rows;
      const beforeTariffs = (await pool.query("SELECT * FROM bi_honorarios_tariffs WHERE item_code='SER1471' ORDER BY id")).rows;
      const beforeReviews = (await pool.query('SELECT row_id,payload,revision FROM bi_honorarios_reviews ORDER BY row_id')).rows;
      await pool.query(`UPDATE bi_honorarios_catalog SET reference_changed=false,
        reference_prices=(SELECT jsonb_agg(ref - 'changeAudit') FROM jsonb_array_elements(reference_prices) ref)
        WHERE item_code='SER1471'`);
      assert.equal((await pool.query("SELECT reference_prices FROM bi_honorarios_catalog WHERE item_code='SER1471'")).rows[0].reference_prices[0].changeAudit, undefined);
      await catalog.syncCatalog(remote);
      let storedReference = (await pool.query("SELECT reference_changed,reference_prices FROM bi_honorarios_catalog WHERE item_code='SER1471'")).rows[0];
      assert.equal(storedReference.reference_changed, false, 'Enriquecer referencias heredadas no anuncia un cambio de precio');
      assert.deepEqual(storedReference.reference_prices[0].changeAudit, { available: false, source: 'Vertical', reason: 'not_recorded', changedBy: null, changedAt: null });
      const original = referenceRows.map(row => ({ ...row }));
      for (const changedReferences of [
        [{ ...original[0], IMPORTE: 275 }],
        [{ ...original[0], NOTAS: 'Nota de referencia modificada' }],
        [{ ...original[0], ITEMDESCRIPTION: 'Descripción de referencia modificada' }],
        [...original, { ...original[0], Id_UT: 2, IMPORTE: 300 }],
        []
      ]) {
        await pool.query("UPDATE bi_honorarios_catalog SET reference_changed=false WHERE item_code='SER1471'");
        referenceRows = changedReferences;
        await catalog.syncCatalog(remote);
        assert.equal((await pool.query("SELECT reference_changed FROM bi_honorarios_catalog WHERE item_code='SER1471'")).rows[0].reference_changed, true,
          'Cambios de importe, notas, descripción, altas y bajas conservan el aviso');
      }
      referenceRows = original;
      await catalog.syncCatalog(remote);
      await catalog.syncCatalog(remote);
      assert.equal((await pool.query("SELECT reference_changed FROM bi_honorarios_catalog WHERE item_code='SER1471'")).rows[0].reference_changed, true,
        'Una sincronización idéntica no borra avisos existentes');
      assert.deepEqual((await pool.query("SELECT status,modality,payment_unit,reason,revision FROM bi_honorarios_catalog WHERE item_code='SER1471'")).rows, beforeConfig);
      assert.deepEqual((await pool.query("SELECT * FROM bi_honorarios_tariffs WHERE item_code='SER1471' ORDER BY id")).rows, beforeTariffs);
      assert.deepEqual((await pool.query('SELECT row_id,payload,revision FROM bi_honorarios_reviews ORDER BY row_id')).rows, beforeReviews);
      const afterReferences = await audit();
      const currentReviews = (await api('get', '/reviews?startDate=2026-09-01&endDate=2026-09-30')).reviews;
      assert.ok(afterReferences.every(row => row.ReviewInvalidated === false));
      const calculated = calculateHonorarios(afterReferences, currentReviews);
      assert.equal(calculated.filter(row => row._reviewStatus === 'APROBADO' && row._effectiveElegible).length, 50);
      assert.equal(calculated.filter(row => row._reviewStale).length, 0);
      console.log('PASS: referencias heredadas enriquecidas sin falso aviso; importe/notas/descripción/altas/bajas detectados; tarifas, revisiones y 50 aprobaciones conservadas.');
    }
    {
      await pool.query(`INSERT INTO bi_honorarios_catalog(item_code,name,group_name,source_active,status,scope_excluded,revision)
        SELECT 'SER_EXPORT_'||n,'Consulta exportación prueba '||n,'CONSULTA EXTERNA',n<>2,
          CASE WHEN n=3 THEN 'EXCLUIDO' WHEN n=4 THEN 'PENDIENTE' ELSE 'INCLUIDO' END,n=305,2
        FROM generate_series(1,305) n`);
      await pool.query(`INSERT INTO bi_honorarios_tariffs(item_code,amount,valid_from,active,reason,updated_by)
        SELECT 'SER_EXPORT_'||n,100,'2026-01-01',true,'Tarifa de exportación aislada','REVISOR PRUEBA'
        FROM generate_series(1,305) n WHERE n<>4`);
      await pool.query(`INSERT INTO bi_honorarios_tariffs(item_code,provider_id,role,amount,valid_from,valid_to,active,reason,updated_by)
        VALUES('SER_EXPORT_1','77','AN',250,'2026-01-01','2026-04-30',false,'Tarifa específica anterior','REVISOR PRUEBA'),
          ('SER_EXPORT_1','88','SURGEON',350,'2026-10-01',NULL,true,'Tarifa específica vigente','REVISOR PRUEBA')`);
      const beforeCatalog = (await pool.query('SELECT * FROM bi_honorarios_catalog ORDER BY item_code')).rows;
      const beforeTariffs = (await pool.query('SELECT * FROM bi_honorarios_tariffs ORDER BY id')).rows;
      const beforeReviews = (await pool.query('SELECT * FROM bi_honorarios_reviews ORDER BY row_id')).rows;
      const beforeRemote = remoteReads;
      const statements = [], query = pool.query;
      let exported;
      pool.query = function (...args) { statements.push(args[0]); return query.apply(this, args); };
      try {
        exported = await api('get', '/catalog/export-data?search=' + encodeURIComponent('Consulta exportación prueba'));
      } finally { pool.query = query; }
      assert.equal(statements.length, 1, 'El endpoint toma catálogo y todas sus tarifas en una consulta snapshot');
      assert.match(statements[0], /statement_timestamp\(\)/);
      assert.doesNotMatch(statements[0], /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|LIMIT)\b/i);
      assert.equal(exported.items.length, 304, 'Exporta todas las páginas y conserva la exclusión de alcance');
      assert.ok(Number.isFinite(Date.parse(exported.snapshotAt)));
      const specific = exported.items.find(item => item.itemCode === 'SER_EXPORT_1');
      assert.equal(specific.tariffs.length, 3);
      const inactiveSpecific = specific.tariffs.find(rate => rate.providerId === '77');
      assert.equal(inactiveSpecific.role, 'AN');
      assert.equal(inactiveSpecific.amount, 250);
      assert.equal(inactiveSpecific.active, false);
      assert.equal(inactiveSpecific.validFrom, '2026-01-01');
      assert.equal(inactiveSpecific.validTo, '2026-04-30');
      assert.ok(specific.tariffs.some(rate => rate.providerId === '88' && rate.role === 'SURGEON' && rate.amount === 350 && rate.active));
      assert.equal(exported.items.find(item => item.itemCode === 'SER_EXPORT_2').active, false);
      assert.equal(exported.items.find(item => item.itemCode === 'SER_EXPORT_3').approvalStatus, 'EXCLUIDO');
      assert.equal(exported.items.find(item => item.itemCode === 'SER_EXPORT_4').approvalStatus, 'PENDIENTE');
      const approved = await catalog.readCatalogExport({ search: 'Consulta exportación prueba', includeInactive: false, approvalStatus: 'APROBADO' });
      assert.equal(approved.items.length, 301);
      assert.ok(approved.items.every(item => item.active && item.approvalStatus === 'APROBADO'));
      assert.deepEqual((await catalog.readCatalogExport({ search: 'Consulta exportación prueba', status: 'EXCLUIDO' })).items.map(item => item.itemCode), ['SER_EXPORT_3']);
      const empty = await catalog.readCatalogExport({ search: 'NO_EXISTE_EXPORT_TEST' });
      assert.deepEqual(empty.items, []); assert.ok(Number.isFinite(Date.parse(empty.snapshotAt)));
      assert.equal(remoteReads, beforeRemote, 'Exportar no consulta ni sincroniza Vertical');
      assert.deepEqual((await pool.query('SELECT * FROM bi_honorarios_catalog ORDER BY item_code')).rows, beforeCatalog);
      assert.deepEqual((await pool.query('SELECT * FROM bi_honorarios_tariffs ORDER BY id')).rows, beforeTariffs);
      assert.deepEqual((await pool.query('SELECT * FROM bi_honorarios_reviews ORDER BY row_id')).rows, beforeReviews);
      const afterExport = calculateHonorarios(await audit(), (await api('get', '/reviews?startDate=2026-09-01&endDate=2026-09-30')).reviews);
      assert.equal(afterExport.filter(row => row._reviewStatus === 'APROBADO' && row._effectiveElegible).length, 50);
      assert.equal(afterExport.filter(row => row._reviewStale).length, 0);
      console.log('PASS: exportación de 304 servicios en un snapshot, filtros, estados, tarifas generales/específicas/inactivas, sin lecturas Vertical ni cambios de precios/aprobaciones.');
    }
    { // Ficha interna: completa un proveedor sin retención IVA en SAP, sin tocar SAP.
    const fiscal = { expectedRevision: 0, enabled: true, federalTaxId: 'AAAA800101AAA', fiscalRegime: '612',
      validFrom: '2026-01-01', isrRate: 0.1, vatFraction: 2 / 3, defaultVatRate: 0.16 };
    await api('put', '/fiscal-profiles/9999', fiscal, 400);
    await api('put', '/fiscal-profiles/7', { ...fiscal, isrRate: null }, 400);
    await api('put', '/fiscal-profiles/7', { ...fiscal, validFrom: '2026-02-30' }, 400);
    const profile = (await api('put', '/fiscal-profiles/7', fiscal)).profile;
    assert.equal(profile.revision, 1); assert.equal(profile.source, 'BI_INTERNO');
    await api('put', '/fiscal-profiles/7', fiscal, 409);
    assert.equal((await api('get', '/fiscal-profiles')).profiles['7'].defaultVatRate, 0.16);
    assert.equal((await api('get', '/fiscal-profiles/7/history')).history.length, 1);
    const fiftyAvailableComplete = await availableWithoutMutations();
    assert.equal(fiftyAvailableComplete.status, 'AVAILABLE');
    assert.deepEqual(fiftyAvailableComplete.totals, { base: 12500, vat: 2000, isr: 1250, vatWithholding: 1333.33, net: 11916.67 });
    assert.deepEqual(fiftyAvailableComplete.doctors[0].fiscal, { federalTaxId: fiscal.federalTaxId,
      fiscalRegime: fiscal.fiscalRegime, ready: true });
    assert.equal(fiftyAvailableComplete.doctors[0].lines.length, 50);
    assert.ok(fiftyAvailableComplete.doctors[0].lines.every(line => line.baseAmount === 250 && line.vat === 40
      && line.vatRate === 0.16 && line.isr === 25 && line.fiscalSnapshot.revision === 1));
    const allClosed = (await api('post', '/liquidations', { startDate: '2026-09-01', endDate: '2026-09-30',
      providerId: 7, confirmed: true, reason: 'Pago preparado con ficha interna de prueba aislada' })).liquidation;
    assert.equal(allClosed.lines.length, 50); assert.equal(allClosed.snapshot.totalBase, 12500);
    assert.equal(allClosed.snapshot.totalNet, 11916.67);
    assert.ok(allClosed.lines.every(line => line.vat === 40 && line.fiscalSnapshot.source === 'BI_INTERNO'
      && line.fiscalSnapshot.revision === 1 && line.vatRate === 0.16));
    const availableById = new Map(fiftyAvailableComplete.doctors[0].lines.map(line => [line.rowId, line]));
    for (const line of allClosed.lines) {
      const available = availableById.get(line.rowId);
      for (const field of ['baseAmount', 'vat', 'isr', 'vatWithholding', 'netAmount']) {
        assert.equal(line[field], available[field], `El cierre conserva ${field} del reporte disponible, centavo por centavo`);
      }
    }
    await availableWithoutMutations(availableInput, 400);
    console.log('PASS: 50 servicios pasan de fiscal pendiente a AVAILABLE tras ficha interna; reporte y cierre coinciden por centavo y los cerrados quedan excluidos.');
    const internalPaymentId = allClosed.id;
    const paymentInput = { providerId: '7', amount: 1000.01, paymentDate: '2026-10-05', reference: 'COMPROBANTE-UNICO' };
    const paid = (await api('post', `/liquidations/${internalPaymentId}/provider-payment`, paymentInput)).liquidation;
    assert.equal(paid.totalPaid, 1000.01); assert.equal(paid.balance, 10916.66);
    assert.ok(paid.payments.length > 1);
    await api('post', `/liquidations/${internalPaymentId}/provider-payment`, paymentInput, 409);
    await api('post', `/liquidations/${internalPaymentId}/provider-payment`, { ...paymentInput, reference: 'EXCESIVO', amount: 12000 }, 400);
    await api('post', `/liquidations/${internalPaymentId}/provider-payment`, { ...paymentInput, reference: 'MEDICO-AJENO', providerId: '8' }, 400);
    await api('put', '/fiscal-profiles/7', { ...fiscal, expectedRevision: 1, isrRate: 0.0125, vatFraction: 0 });
    const frozen = (await api('get', `/liquidations/${internalPaymentId}/payment-report`)).report;
    assert.equal(frozen.status, 'READY'); assert.equal(frozen.totals.vat, 2000);
    assert.equal(frozen.totals.isr, 1250); assert.equal(frozen.totals.vatWithholding, 1333.33);
    assert.equal(frozen.totals.balance, 10916.66, 'La nueva ficha no cambia el pago preparado');
    await api('put', '/fiscal-profiles/7', { ...fiscal, enabled: false, expectedRevision: 2 });
    assert.equal((await api('get', '/fiscal-profiles/7/history')).history.length, 3);
    assert.equal((await api('get', `/liquidations/${internalPaymentId}/payment-report`)).report.totals.balance, 10916.66);
    console.log('PASS: ficha fiscal interna, validación, historial, conflictos, 50 servicios con IVA 16%, comprobante total distribuido, rechazo de duplicados/sobrepago y cierre histórico inmutable.');
    }
    console.log('PASS: API + PostgreSQL aislado: catálogo aprobado, reasignación humana, cierres históricos, reporte READY/PAID/bloqueado, centavos exactos, pagos, ajustes y lectura concurrente consistente.');
  } finally {
    await pool.end();
    if (!/^test_honorarios_management_\d+$/.test(schema)) throw Error('Esquema de prueba inesperado');
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
