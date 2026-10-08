/**
 * honorarios.routes.js — Reporte Unificado de Liquidación y Auditoría de Honorarios Médicos
 * Hospital Escandón BI Platform
 *
 * Unifica las dos vistas del motor de honorarios de Vertical:
 * 1. UDR_HON_PAGO_Audit: Universo total de atenciones, cargos y diagnóstico de reglas de negocio
 * 2. UDR_HON_PAGO: Motor de liquidación con tabulador, impuestos, retenciones ISR y neto a pagar
 */
'use strict';

const express = require('express');
const router = express.Router();
const { getRemoteDb, connectRemoteDB } = require('../config/remote-db');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { reconcileHonorariosWithSap } = require('../services/honorariosSapReconciliation.service');
const { recoverHonorariosCoverage, getClinicalProviderDirectory } = require('../services/honorariosCoverage.service');
const { readReviews, saveReview, canReview } = require('../services/honorariosReview.service');
const catalog = require('../services/honorariosCatalog.service');
const workflow = require('../services/honorariosWorkflow.service');
const { getProviderDirectory } = require('../services/honorariosSources.service');
const liquidation = require('../services/honorariosLiquidation.service');
const paymentReport = require('../services/honorariosPaymentReport.service');
const fiscalProfiles = require('../services/honorariosFiscalProfile.service');
const { getFiscalDirectory } = require('../services/honorariosFiscalDirectory.service');
const verticalAudit = require('../services/honorariosVerticalAudit.service');
const monthlyFixed = require('../services/honorariosMonthlyFixed.service');

const ALLOWED_ROLES = [
  'ADMIN',
  'DIRECTOR',
  'JEFE_AREA',
  'USUARIO_OPERATIVO',
  'CONSULTA_EXTERNA',
  'ALMACEN_GENERAL'
];

router.use(authenticate, (req, res, next) => canReview(req.user) ? next()
  : res.status(403).json({ error: 'No tienes acceso al módulo Honorarios Médicos.' }));

router.get('/vertical-audit/options', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    verticalAudit.validateFilters(req.query);
    return res.json({ ok: true, options: await verticalAudit.readOptions(await connectRemoteDB(), req.query) });
  } catch (error) {
    console.error('[Honorarios] Opciones de auditoría Vertical:', error.message);
    return res.status(error.status === 400 ? 400 : 503).json({ ok: false,
      error: error.status === 400 ? error.message : 'No se pudieron cargar las listas de médicos, grupos y orígenes. Intenta nuevamente.' });
  }
});

router.get('/vertical-audit', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    verticalAudit.validateFilters(req.query);
    return res.json({ ok: true, ...await verticalAudit.readAudit(await connectRemoteDB(), req.query) });
  } catch (error) {
    console.error('[Honorarios] Auditoría Vertical:', error.message);
    return res.status(error.status === 400 ? 400 : 503).json({ ok: false,
      error: error.status === 400 ? error.message : 'No se pudo consultar la auditoría. Intenta nuevamente o solicita revisión a Sistemas.' });
  }
});

router.get('/vertical-audit/excel', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    verticalAudit.validateFilters(req.query);
    const report = await verticalAudit.readExport(await connectRemoteDB(), req.query);
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="Auditoria_honorarios_${report.filters.startDate}_${report.filters.endDate}.xlsx"`);
    await verticalAudit.writeExcel(res, report, req.user);
  } catch (error) {
    console.error('[Honorarios] Excel auditoría Vertical:', error.message);
    if (res.headersSent) return res.destroy();
    return res.status(error.status === 400 ? 400 : 503).json({ ok: false,
      error: error.status === 400 ? error.message : 'No se pudo descargar el Excel. Intenta de nuevo.' });
  }
});

router.get('/reviews', authenticate, authorize(ALLOWED_ROLES), async (req, res) => {
  const { startDate, endDate } = req.query;
  if (![startDate, endDate].every(value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value))) || startDate > endDate) {
    return res.status(400).json({ error: 'Periodo de revisión inválido.' });
  }
  try {
    workflow.validatePeriod(startDate, endDate);
    const [clinicalReviews, monthlyReviews] = await Promise.all([readReviews(startDate, endDate), monthlyFixed.readMonthlyReviews(startDate, endDate)]);
    return res.json({ ok: true, reviews: { ...clinicalReviews, ...monthlyReviews }, canReview: canReview(req.user) });
  }
  catch (error) { console.error('[Honorarios] Revisiones BI:', error.message); return res.status(error.status || 503).json({ error: error.status ? error.message : "No se pudieron consultar las revisiones guardadas. Actualiza el reporte e intenta de nuevo." }); }
});

router.put('/reviews', authenticate, authorize(ALLOWED_ROLES), async (req, res) => {
  try {
    if (String(req.body?.rowId || '').startsWith('FIXED|')) {
      return res.json({ ok: true, review: await monthlyFixed.saveMonthlyReview(await connectRemoteDB(), req.body, req.user) });
    }
    const isSource = String(req.body?.rowId || '').startsWith('BI|');
    const input = isSource ? await workflow.prepareSourceReview(await connectRemoteDB(), req.body) : req.body;
    if (!isSource && ['BI_PRESTACION', 'BI_FIJO_MENSUAL'].includes(input?.decision?.sourceType)) return res.status(400).json({ error: 'Registro de servicio inválido.' });
    return res.json({ ok: true, review: await saveReview(input, req.user, { sourceValidated: isSource }) });
  }
  catch (error) { return res.status(error.status || 503).json({ error: error.status ? error.message : "No se pudo guardar la revisión. Intenta de nuevo; el servicio conserva su estado anterior." }); }
});

const api = handler => async (req, res) => {
  try { return res.json({ ok: true, ...await handler(req) }); }
  catch (error) {
    console.error('[Honorarios BI]', error.message);
    return res.status(error.status || 503).json({ ok: false, error: error.status ? error.message : 'No se pudo completar la consulta de honorarios. Intenta actualizar.' });
  }
};

async function bulkSources(req) {
  const inputs = req.body?.rows;
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 100
    || inputs.some(item => !String(item?.rowId || '').startsWith('BI|'))
    || new Set(inputs.map(item => item.rowId)).size !== inputs.length) {
    throw Object.assign(new Error('Selecciona entre 1 y 100 servicios distintos.'), { status: 400 });
  }
  const pool = await connectRemoteDB();
  const result = await workflow.getPeriodCandidates(pool, req.body.startDate, req.body.endDate);
  return { pool, inputs, sources: new Map(result.rows.map(row => [row.SourceIdentity, row])) };
}
router.post('/reviews/bulk-preview', api(async req => {
  const { pool, inputs, sources } = await bulkSources(req);
  const approvalContext = await workflow.loadApprovalContext(pool);
  const rows = [];
  for (const input of inputs) {
    const source = sources.get(input.rowId);
    if (!source || source.Cancelado || source.CatalogStatus !== 'INCLUIDO') throw Object.assign(new Error('La selección contiene un servicio cancelado, sin configurar o fuera del periodo.'), { status: 400 });
    const preview = await workflow.approvalPreview(pool, { ...input, providerId: req.body.providerId || input.providerId }, source, approvalContext);
    if (!preview.row.TariffSnapshot) throw Object.assign(new Error(`Falta tarifa vigente de ${source.CodigoServicio} para el médico seleccionado.`), { status: 400 });
    rows.push({ ...input, providerId: preview.provider.id, providerName: preview.provider.name, quantity: preview.quantity,
      role: preview.row.RolMedico, description: source.Servicio, salesOrder: source.FolioOrdenVenta,
      serviceDate: source.FechaAtencion.slice(0, 10), customAmount: preview.row.BaseImporte,
      quotedTariffId: preview.row.TariffSnapshot.id, quotedTariffRevision: preview.row.TariffSnapshot.revision,
      fingerprint: require('../utils/honorariosReviewSource').reviewFingerprint(source) });
  }
  return { rows };
}));
router.post('/reviews/bulk', api(async req => {
  const { pool, inputs, sources } = await bulkSources(req);
  const approvalContext = req.body.decision?.action === 'APROBAR' ? await workflow.loadApprovalContext(pool) : undefined;
  const reviews = {}, errors = [];
  for (const input of inputs) {
    try {
      const source = sources.get(input.rowId);
      if (!source) throw Object.assign(new Error('El servicio ya no aparece en el periodo.'), { status: 409 });
      const prepared = await workflow.prepareSourceReview(pool, { rowId: input.rowId, serviceDate: source.FechaAtencion.slice(0, 10),
        expectedRevision: input.expectedRevision, decision: { ...req.body.decision, ...input } }, source, approvalContext);
      reviews[input.rowId] = await saveReview(prepared, req.user, { sourceValidated: true });
    } catch (error) { errors.push({ rowId: input.rowId, message: error.status ? error.message : 'No se pudo guardar este servicio.' }); }
  }
  return { reviews, errors, savedCount: Object.keys(reviews).length };
}));

router.get('/catalog', api(async req => {
  const cached = await catalog.listCatalog({ ...req.query, autoSync: false });
  if (cached.sync.lastSuccess) return cached;
  try {
    await catalog.ensureCatalogReady(await connectRemoteDB());
    return catalog.listCatalog({ ...req.query, autoSync: false });
  } catch {
    return { ...cached, sync: { ...cached.sync, lastError: 'Vertical no está disponible para actualizar el catálogo.' } };
  }
}));
router.post('/catalog/sync', api(async req => {
  await catalog.syncCatalog(await connectRemoteDB(), req.user);
  return catalog.listCatalog({ autoSync: false });
}));
router.put('/catalog/:itemCode', api(async req => ({ item: await catalog.saveCatalogConfig({ ...req.body, itemCode: req.params.itemCode }, req.user) })));
router.get('/catalog/:itemCode/tariffs', api(async req => ({ tariffs: await catalog.listTariffs({ itemCode: req.params.itemCode }) })));
router.post('/catalog/:itemCode/tariffs', api(async req => {
  const tariff = await catalog.saveTariff({ ...req.body, itemCode: req.params.itemCode }, req.user);
  return { tariff, item: await catalog.getCatalogItem(req.params.itemCode) };
}));
router.get('/catalog/:itemCode/history', api(async req => ({ history: await catalog.getCatalogHistory(req.params.itemCode) })));
router.get('/providers', api(async () => ({ providers: await getProviderDirectory(await connectRemoteDB()) })));
router.get('/monthly-fixed', api(async req => ({ assignments: await monthlyFixed.listAssignments(), canManage: canReview(req.user) })));
router.post('/monthly-fixed', api(async req => ({ assignment: await monthlyFixed.saveAssignment(await connectRemoteDB(),
  { ...req.body, id: undefined }, req.user) })));
router.put('/monthly-fixed/:id', api(async req => ({ assignment: await monthlyFixed.saveAssignment(await connectRemoteDB(),
  { ...req.body, id: req.params.id }, req.user) })));
router.get('/fiscal-profiles', api(async () => ({ profiles: await fiscalProfiles.readProfiles() })));
router.get('/fiscal-directory', api(async req => getFiscalDirectory(await getProviderDirectory(await connectRemoteDB()),
  { date: req.query.date, refresh: req.query.refresh === 'true' })));
router.put('/fiscal-profiles/:providerId', api(async req => {
  const providers = await getProviderDirectory(await connectRemoteDB());
  const provider = providers.find(item => String(item.id) === req.params.providerId);
  return { profile: await fiscalProfiles.saveProfile({ ...req.body, providerId: req.params.providerId }, provider, req.user) };
}));
router.get('/fiscal-profiles/:providerId/history', api(async req => ({ history: await fiscalProfiles.readHistory(req.params.providerId) })));
router.post('/approval-preview', api(async req => {
  const result = await workflow.approvalPreview(await connectRemoteDB(), req.body);
  return { row: result.row, provider: result.provider };
}));

router.get('/audit', api(async req => {
  const result = await workflow.getPeriodCandidates(await connectRemoteDB(), req.query.startDate, req.query.endDate);
  const rows = result.rows.filter(row => row.FixedMonthly === true || !catalog.isExcludedHonorariosService(row))
    .filter(row => (!req.query.grupoServicio || req.query.grupoServicio === 'TODOS' || row.GrupoServicio === req.query.grupoServicio)
      && (!req.query.medico || (row.ReviewBeneficiary?.providerName || row.Medico) === req.query.medico));
  return { data: rows, total: rows.length, coverage: { ...result.coverage, candidates: rows.length }, canReview: canReview(req.user) };
}));

router.get('/liquidations', api(async () => ({ liquidations: await liquidation.listLiquidations() })));
router.post('/liquidations', api(async req => ({ liquidation: await liquidation.closeLiquidation(await connectRemoteDB(), req.body, req.user) })));
router.get('/liquidations/:id', api(async req => ({ liquidation: await liquidation.getLiquidation(req.params.id) })));
router.get('/liquidations/:id/payment-report', api(async req => ({ report: await paymentReport.getPaymentReport(req.params.id, connectRemoteDB) })));
router.post('/liquidations/:id/check', api(async req => {
  const saved = await liquidation.getLiquidation(req.params.id);
  const clinical = saved.lines.some(line => line.sourceType !== 'BI_FIJO_MENSUAL');
  return { changes: await liquidation.checkLiquidationChanges(clinical ? await connectRemoteDB() : null, saved) };
}));
router.post('/liquidations/:id/provider-payment', api(async req => ({ liquidation: await liquidation.recordProviderPayment(req.params.id, req.body, req.user) })));
router.post('/liquidations/:id/payments', api(async req => ({ liquidation: await liquidation.recordApplication(req.params.id, req.body, req.user) })));
router.post('/liquidations/:id/adjustments', api(async req => ({ liquidation: await liquidation.recordApplication(req.params.id, req.body, req.user, true) })));

/**
 * POST /api/honorarios/sap-reconciliation
 * Lee documentos y aplicaciones de pago de SAP sin modificar datos de SAP.
 * Los nombres recibidos son solo candidatos para localizar proveedores; no validan identidad.
 */
router.post('/sap-reconciliation', authenticate, authorize(ALLOWED_ROLES), async (req, res) => {
  const { startDate, endDate, doctors } = req.body || {};
  if (!Array.isArray(doctors) || doctors.length > 500) {
    return res.status(400).json({ ok: false, error: 'La lista de médicos no es válida.' });
  }

  try {
    const pool = await connectRemoteDB();
    const clinicalDirectory = await getClinicalProviderDirectory(pool);
    const result = await reconcileHonorariosWithSap({ startDate, endDate, doctors, clinicalDirectory, includeAdditional: true });
    return res.json(result);
  } catch (err) {
    console.error('[Honorarios] Error en conciliación SAP (solo lectura):', err);
    const clientInputError = /periodo|período|fecha|lista|médicos|medicos|nombre|máximo/i.test(err.message || '');
    return res.status(clientInputError ? 400 : 502).json({
      ok: false,
      error: clientInputError ? err.message : 'No se pudo completar la consulta de SAP. El reporte de honorarios permanece disponible.'
    });
  }
});

/**
 * GET /api/honorarios/audit
 * Consulta unificada de honorarios médicos con cálculo de liquidación y diagnóstico de exclusiones
 * Parámetros de consulta:
 *  - startDate (YYYY-MM-DD)
 *  - endDate (YYYY-MM-DD)
 *  - status ('elegibles' | 'exclusiones' | 'todos')
 *  - grupoServicio (opcional)
 *  - medico (opcional)
 */
router.get('/audit-vertical', authenticate, authorize(ALLOWED_ROLES), async (req, res) => {
  try {
    const { startDate, endDate, status, grupoServicio, medico } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        ok: false,
        error: 'Los parámetros startDate y endDate son obligatorios (formato YYYY-MM-DD).'
      });
    }

    let pool;
    try {
      pool = await getRemoteDb();
    } catch {
      pool = await connectRemoteDB();
    }

    let query = `
      ;WITH AuditSource AS (
        SELECT a.*,
          COUNT(*) OVER (PARTITION BY a.UDRKey, a.ItemCode) AS AuditRowsForPaymentKey,
          SUM(CASE WHEN a.IMPORTE IS NOT NULL THEN a.IMPORTE ELSE 0 END)
            OVER (PARTITION BY a.UDRKey, a.ItemCode) AS AuditImporteKeyTotal,
          ROW_NUMBER() OVER (
            PARTITION BY a.UDRKey, a.ItemCode
            ORDER BY a.PCDate, a.PCNum, a.Medico, a.OrigenRenglon
          ) AS AuditRowNumber
        FROM UDR_HON_PAGO_Audit a
      ), AuditPayment AS (
        SELECT a.*,
          p.SONum AS PaymentSONum,
          p.BPName AS PaymentBPName,
          p.PTName AS PaymentPTName,
          p.Medico AS PaymentMedico,
          p.Especialidad AS PaymentEspecialidad,
          p.UDF_TIPO_MEDICO AS PaymentTipoMedico,
          p.Quantity AS PaymentQuantity,
          p.BaseImporte AS PaymentBaseImporte,
          p.IvaLinea AS PaymentIvaLinea,
          p.ISRRateNorm AS PaymentISRRateNorm,
          p.SinTabulador AS PaymentSinTabulador,
          p.Tiene_SO AS PaymentTieneSO,
          p.Tiene_Cita AS PaymentTieneCita,
          p.MatchPaciente AS PaymentMatchPaciente,
          p.MatchMedico AS PaymentMatchMedico,
          p.AuditMsg AS PaymentAuditMsg
        FROM AuditSource a
        LEFT JOIN UDR_HON_PAGO p ON a.UDRKey = p.UDRKey AND a.ItemCode = p.ItemCode
      ), AuditComputed AS (
        SELECT a.*,
          CASE
            WHEN a.PaymentBaseImporte IS NOT NULL AND a.PaymentBaseImporte > 0 AND a.AuditRowsForPaymentKey = 1 THEN a.PaymentBaseImporte
            WHEN a.PaymentBaseImporte IS NOT NULL AND a.PaymentBaseImporte > 0 AND a.AuditRowsForPaymentKey > 1
                 AND ABS(a.PaymentBaseImporte - a.AuditImporteKeyTotal) <= 0.01 THEN COALESCE(a.IMPORTE, 0)
            ELSE 0
          END AS CalculatedBaseImporte,
          CASE
            WHEN a.PaymentBaseImporte IS NOT NULL AND a.PaymentBaseImporte > 0 AND a.AuditRowsForPaymentKey = 1 THEN 1
            WHEN a.PaymentBaseImporte IS NOT NULL AND a.PaymentBaseImporte > 0 AND a.AuditRowsForPaymentKey > 1
                 AND a.AuditImporteKeyTotal IS NOT NULL AND ABS(a.PaymentBaseImporte - a.AuditImporteKeyTotal) <= 0.01 THEN 1
            ELSE 0
          END AS BaseIntegrityValid,
          CASE
            WHEN a.PaymentBaseImporte IS NOT NULL AND a.PaymentBaseImporte > 0
                 AND a.AuditRowsForPaymentKey > 1 AND ABS(a.PaymentBaseImporte - a.AuditImporteKeyTotal) <= 0.01
                 AND a.PaymentIvaLinea IS NOT NULL AND a.PaymentIvaLinea <> 0 AND a.AuditImporteKeyTotal > 0
            THEN CASE
              WHEN a.AuditRowNumber < a.AuditRowsForPaymentKey
              THEN ROUND(a.PaymentIvaLinea * COALESCE(a.IMPORTE, 0) / NULLIF(a.AuditImporteKeyTotal, 0), 2)
              ELSE ROUND(a.PaymentIvaLinea - (
                SUM(ROUND(a.PaymentIvaLinea * COALESCE(a.IMPORTE, 0) / NULLIF(a.AuditImporteKeyTotal, 0), 2))
                  OVER (PARTITION BY a.UDRKey, a.ItemCode)
                - ROUND(a.PaymentIvaLinea * COALESCE(a.IMPORTE, 0) / NULLIF(a.AuditImporteKeyTotal, 0), 2)
              ), 2)
            END
            WHEN a.PaymentBaseImporte IS NOT NULL AND a.PaymentBaseImporte > 0 AND a.AuditRowsForPaymentKey = 1
            THEN a.PaymentIvaLinea
            WHEN a.PaymentBaseImporte > 0 AND a.AuditRowsForPaymentKey > 1
                 AND ABS(a.PaymentBaseImporte - a.AuditImporteKeyTotal) <= 0.01
                 AND a.PaymentIvaLinea = 0 THEN 0
            ELSE NULL
          END AS CalculatedIvaLinea
        FROM AuditPayment a
      )
      SELECT 
        -- Identificadores de Atención y Documento
        -- PCNum en la vista es una referencia: PC, CITA o SO según UDRKey.
        -- Se conserva para las decisiones BI; sólo los vínculos explícitos aportan una atención.
        a.PCNum AS "FolioReferenciaOrigen",
        CASE
          WHEN a.UDRKey LIKE 'PC-%' THEN a.PCNum
          WHEN a.UDRKey LIKE 'CITA-%' THEN COALESCE(NULLIF(cita.PCNum, 0), NULLIF(orden.PCNum, 0))
          WHEN a.UDRKey LIKE 'SO-%' THEN NULLIF(orden.PCNum, 0)
          ELSE NULL
        END AS "FolioAtencion",
        cita.PCAPNum AS "FolioCita",
        a.PCDate AS "FechaAtencion",
        a.UDRKey AS "UDRKey",
        a.AuditRowNumber AS "RenglonAuditoria",
        COALESCE(a.PaymentSONum, a.SONum) AS "FolioOrdenVenta",
        a.OrigenRenglon AS "OrigenRenglon",
        
        -- Paciente y Cliente / Aseguradora
        COALESCE(a.BPName, a.PaymentBPName, 'VENTA GENERAL') AS "Cliente",
        COALESCE(a.PTName, a.PaymentPTName, 'PACIENTE NO ESPECIFICADO') AS "Paciente",
        
        -- Datos del Médico Tratante
        COALESCE(a.Medico, a.PaymentMedico) AS "Medico",
        COALESCE(a.Especialidad, a.PaymentEspecialidad, 'MEDICINA GENERAL') AS "Especialidad",
        COALESCE(a.UDF_TIPO_MEDICO, a.PaymentTipoMedico, 'HN') AS "TipoMedico",
        
        -- Detalle del Servicio
        a.ItemGroupName AS "GrupoServicio",
        a.ItemCode AS "CodigoServicio",
        a.ItemDescription AS "Servicio",
        COALESCE(a.Quantity, a.PaymentQuantity, 1) AS "Cantidad",
        COALESCE(a.UnitPrice, 0) AS "PrecioCobradoPaciente",
        
        -- Importe Base del Tabulador de Honorarios
        a.CalculatedBaseImporte AS "BaseImporte",
        a.IMPORTE AS "BasePropuesta",
        a.BaseIntegrityValid AS "IntegridadBaseValida",

        -- Impuestos de Línea
        a.CalculatedIvaLinea AS "IvaLinea",
        
        -- Tasa ISR Normalizada (ej. 0.10 para 10%, 0.0125 para 1.25%, 0.0 si exento)
        CASE
          WHEN a.PaymentISRRateNorm IS NOT NULL AND a.PaymentISRRateNorm > 0 AND a.PaymentISRRateNorm <= 1 THEN a.PaymentISRRateNorm
          WHEN a.ISRRateRaw IS NOT NULL AND a.ISRRateRaw > 1 THEN a.ISRRateRaw / 100.0
          WHEN a.ISRRateRaw IS NOT NULL AND a.ISRRateRaw > 0 THEN a.ISRRateRaw
          ELSE 0.0
        END AS "TasaISR",

        -- Estado actual en Vertical; BI lo usa como estado inicial de la revisión.
        CASE
          WHEN a.Elegible_V_HON_PAGO = 1
               AND (a.MotivoExclusion IS NULL OR a.MotivoExclusion = '' OR a.MotivoExclusion NOT LIKE 'No entra%')
          THEN 'APROBADO'
          WHEN a.Elegible_V_HON_PAGO = 0 OR a.MotivoExclusion LIKE 'No entra%'
          THEN 'RECHAZADO'
          ELSE NULL
        END AS "EstadoVertical",
        -- Elegibilidad para cálculo: requiere además médico e importe íntegros.
        CASE 
          WHEN a.Elegible_V_HON_PAGO = 1 
               AND (a.MotivoExclusion IS NULL OR a.MotivoExclusion = '' OR a.MotivoExclusion NOT LIKE 'No entra%')
               AND a.Medico IS NOT NULL AND a.Medico <> ''
               AND a.BaseIntegrityValid = 1 AND a.CalculatedBaseImporte > 0
          THEN 1
          ELSE 0
        END AS "ElegiblePago",

        -- Campos de Diagnóstico y Auditoría de Cita/Orden
        CASE WHEN a.PaymentBaseImporte IS NULL OR a.PaymentBaseImporte <= 0
          THEN 1 ELSE COALESCE(a.PaymentSinTabulador, 0) END AS "SinTabulador",
        a.PaymentTieneSO AS "TieneSO",
        a.PaymentTieneCita AS "TieneCita",
        a.PaymentMatchPaciente AS "MatchPaciente",
        a.PaymentMatchMedico AS "MatchMedico",
        CASE 
          WHEN a.Elegible_V_HON_PAGO = 1
               AND (a.MotivoExclusion IS NULL OR a.MotivoExclusion = '' OR a.MotivoExclusion NOT LIKE 'No entra%')
               AND a.Medico IS NOT NULL AND a.Medico <> '' AND (a.PaymentBaseImporte IS NULL OR a.PaymentBaseImporte <= 0)
          THEN 'No existe una base positiva en la liquidación clínica; no se usa el precio al paciente como honorario. Requiere revisar tabulador y vínculo.'
          WHEN a.Elegible_V_HON_PAGO = 1
               AND (a.MotivoExclusion IS NULL OR a.MotivoExclusion = '' OR a.MotivoExclusion NOT LIKE 'No entra%')
               AND a.Medico IS NOT NULL AND a.Medico <> '' AND a.BaseIntegrityValid = 0
          THEN 'Base agregada de liquidación no conciliada con el detalle de auditoría; requiere revisión antes de incluirla.'
          WHEN a.Elegible_V_HON_PAGO = 1
               AND (a.MotivoExclusion IS NULL OR a.MotivoExclusion = '' OR a.MotivoExclusion NOT LIKE 'No entra%')
               AND a.Medico IS NOT NULL AND a.Medico <> '' AND a.CalculatedBaseImporte <= 0
          THEN 'No hay base positiva de honorario en la fuente; requiere revisión antes de incluirla.'
          WHEN a.Elegible_V_HON_PAGO = 1 
               AND (a.MotivoExclusion IS NULL OR a.MotivoExclusion = '' OR a.MotivoExclusion NOT LIKE 'No entra%')
               AND a.Medico IS NOT NULL AND a.Medico <> ''
          THEN COALESCE(a.PaymentAuditMsg, 'Cumple con todas las reglas de liquidación')
          ELSE COALESCE(a.MotivoExclusion, a.PaymentAuditMsg, 'Excluido por reglas de negocio')
        END AS "MensajeAuditoria",
        
        -- Banderas de Reglas de Negocio
        a.Pasa_PC_ST AS "PasaAtencionCerrada",
        a.Pasa_ItemType AS "PasaTipoServicio",
        a.Pasa_UT_Honorarios AS "PasaCatalogoHonorarios",
        a.Pasa_Incluido_Honorarios AS "PasaIncluidoHonorarios",
        a.MotivoExclusion AS "MotivoExclusionOriginal"
      FROM AuditComputed a
      LEFT JOIN SO orden ON orden.SONum = COALESCE(a.PaymentSONum, a.SONum)
      LEFT JOIN PCAP cita ON cita.PCAPNum = CASE
        WHEN a.UDRKey LIKE 'CITA-%' THEN TRY_CONVERT(int, SUBSTRING(a.UDRKey, 6, 30))
        ELSE NULLIF(orden.PCAPNum, 0)
      END
      WHERE a.PCDate >= CAST(@startDate AS DATETIME) 
        AND a.PCDate < DATEADD(day, 1, CAST(@endDate AS DATETIME))
        AND (a.ItemGroupName IS NULL OR LTRIM(RTRIM(a.ItemGroupName)) COLLATE Latin1_General_CI_AI
          NOT IN ('ALMACEN GENERAL', 'FARMACIA', 'LABORATORIO', 'ESTUDIOS DE LABORATORIO', 'IMAGENOLOGIA'))
    `;

    const request = pool.request();
    request.input('startDate', startDate);
    request.input('endDate', endDate);

    /* Los filtros se aplican después de recuperar citas para que el mismo
       universo se use en Todos, Incluidos y Exclusiones. */
    query += ` ORDER BY a.PCDate DESC, a.Medico ASC, a.PCNum DESC`;

    const result = await request.query(query);

    const recovered = await recoverHonorariosCoverage(pool, result.recordset, startDate, endDate);
    const data = recovered.rows.filter(row => {
      if (status === 'elegibles' && !row.ElegiblePago) return false;
      if (status === 'exclusiones' && row.ElegiblePago) return false;
      if (grupoServicio && grupoServicio !== 'TODOS' && String(row.GrupoServicio || '').trim() !== grupoServicio.trim()) return false;
      return !medico || String(row.Medico || '').trim() === medico.trim();
    }).sort((a,b) => new Date(b.FechaAtencion) - new Date(a.FechaAtencion) || String(a.Medico).localeCompare(String(b.Medico)));

    return res.json({
      ok: true,
      data,
      total: data.length,
      coverage: recovered.coverage
    });

  } catch (err) {
    console.error('[Honorarios] Error al consultar reporte unificado en Vertical:', err);
    return res.status(500).json({
      ok: false,
      error: 'No se pudo consultar el reporte clínico de honorarios. Intenta nuevamente o solicita revisión a Sistemas.'
    });
  }
});

module.exports = router;
