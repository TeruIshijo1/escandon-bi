'use strict';

const { getHonorariosCandidates, getProviderDirectory } = require('./honorariosSources.service');
const catalog = require('./honorariosCatalog.service');
const { honorarioRowId, reviewFingerprint } = require('../utils/honorariosReviewSource');
const { getDb } = require('../config/db');
const { ensureTables } = require('./honorariosReview.service');
const monthlyFixed = require('./honorariosMonthlyFixed.service');

const invalid = (message, status = 400) => Object.assign(new Error(message), { status });
function savedBeneficiaryFor(row, review, tariff) {
  const snapshot = review?.snapshot;
  // Una asignación humana se conserva sólo para la misma prestación clínica.
  // La tarifa por sí sola nunca elige a quién corresponde el servicio.
  if (!row.CatalogApproved || review?.action !== 'APROBAR' || review.sourceType !== 'BI_PRESTACION'
    || !snapshot || snapshot.rowId !== row.SourceIdentity || snapshot.itemCode !== row.CodigoServicio
    || snapshot.sourceType !== row.SourceType || String(snapshot.sourceLineId) !== String(row.SourceLineId)
    || snapshot.serviceDate !== String(row.FechaAtencion || '').slice(0, 10)
    || !snapshot.sourceFingerprint || snapshot.sourceFingerprint !== row.SourceFingerprint
    || snapshot.catalog?.itemCode !== row.CodigoServicio || snapshot.catalog?.status !== 'INCLUIDO'
    || !Number.isSafeInteger(Number(snapshot.providerId)) || Number(snapshot.providerId) <= 0
    || String(review.providerId) !== String(snapshot.providerId) || !String(snapshot.providerName || '').trim()
    || !['TRATANTE', 'AN', 'SURGEON', 'AY'].includes(snapshot.role)
    || !tariff || !(Number(tariff.amount) > 0)) return null;
  return { providerId: snapshot.providerId, providerName: snapshot.providerName,
    role: snapshot.role, origin: 'saved_approval',
    ...(snapshot.physicianCorrection ? { physicianCorrection: snapshot.physicianCorrection } : {}) };
}

function validatePeriod(startDate, endDate) {
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '')
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate
    || (Date.parse(endDate) - Date.parse(startDate)) / 86400000 > 366) {
    throw invalid('Selecciona un periodo válido de hasta un año.');
  }
}

async function getPeriodCandidates(pool, startDate, endDate, { includeUnconfigured = false } = {}) {
  validatePeriod(startDate, endDate);
  await catalog.ensureCatalogReady(pool);
  const result = await getHonorariosCandidates(pool, startDate, endDate);
  await catalog.discoverCandidates(result.rows);
  const candidates = (await catalog.enrichCandidates(result.rows)).filter(row => !row.ScopeExcluded && !catalog.isExcludedHonorariosService(row));
  const fixedRows = await monthlyFixed.getPeriodRows(startDate, endDate);
  await ensureTables();
  const [finalized, reviewed] = await Promise.all([
    getDb().pool.query(`SELECT row_id,liquidation_id,snapshot FROM bi_honorarios_finalized_rows
      WHERE snapshot->>'serviceDate' BETWEEN $1 AND $2
        OR (snapshot->>'sourceType'='BI_FIJO_MENSUAL' AND snapshot->>'month' BETWEEN $3 AND $4)`,
    [startDate, endDate, startDate.slice(0, 7), endDate.slice(0, 7)]),
    getDb().pool.query('SELECT row_id,payload FROM bi_honorarios_reviews WHERE row_id=ANY($1::text[])',
      [[...candidates, ...fixedRows].map(row => row.SourceIdentity)])
  ]);
  const closed = new Map(finalized.rows.map(item => [item.row_id, item]));
  const approved = reviewed.rows.filter(item => item.payload?.action === 'APROBAR' && item.payload.snapshot
    && item.payload.sourceType !== 'BI_FIJO_MENSUAL');
  const appliedTariffs = approved.length ? await catalog.resolveTariffs(approved.map(item => ({
    itemCode: item.payload.snapshot.itemCode, providerId: item.payload.snapshot.providerId,
    role: item.payload.snapshot.role, serviceDate: item.payload.snapshot.serviceDate
  }))) : [];
  const reviews = new Map(approved.map((item, index) => [item.row_id, { review: item.payload, tariff: appliedTariffs[index]?.tariff }]));
  const invalidated = new Set(approved.filter((item, index) => appliedTariffs[index]?.tariff?.id !== item.payload.snapshot.tariff?.id
    || appliedTariffs[index]?.tariff?.revision !== item.payload.snapshot.tariff?.revision).map(item => item.row_id));
  const available = candidates.map(row => {
    const saved = reviews.get(row.SourceIdentity);
    const beneficiary = savedBeneficiaryFor(row, saved?.review, saved?.tariff);
    if (saved && saved.review.fingerprint !== reviewFingerprint(row)) invalidated.add(row.SourceIdentity);
    // Los datos de fuente y su firma permanecen intactos. Estos campos sólo
    // identifican el beneficiario confirmado y la tarifa vigente de revisión.
    return beneficiary ? { ...row, ReviewEligible: true, ReviewBeneficiary: beneficiary,
      ReviewEligibilityTariff: saved.tariff } : row;
  });
  const rows = available.filter(row => includeUnconfigured || row.ReviewEligible === true);
  const clinicalRows = rows.map(row => {
    const saved = closed.get(row.SourceIdentity);
    return { ...row, ModeBI: true, TipoCalculo: 'BI_PRESTACION', ReviewInvalidated: !saved && invalidated.has(row.SourceIdentity),
      ...(saved ? { LiquidacionCerrada: saved.liquidation_id, SnapshotCierre: saved.snapshot,
        CambiosTrasCierre: saved.snapshot.sourceFingerprint !== row.SourceFingerprint } : {}) };
  });
  const monthlyRows = fixedRows.map(row => {
    const saved = closed.get(row.SourceIdentity);
    const review = reviewed.rows.find(item => item.row_id === row.SourceIdentity)?.payload;
    const changed = review?.action === 'APROBAR' && (review.fingerprint !== reviewFingerprint(row)
      || review.snapshot?.fixed?.revision !== row.FixedMonthlySnapshot?.revision);
    return { ...row, ReviewInvalidated: !saved && Boolean(changed), ...(saved ? { LiquidacionCerrada: saved.liquidation_id, SnapshotCierre: saved.snapshot,
      BaseImporte: saved.snapshot.baseAmount, CambiosTrasCierre: false } : {}) };
  });
  return { rows: [...clinicalRows, ...monthlyRows], coverage: { ...result.coverage,
    sourceCounts: Object.fromEntries(['orderLines', 'clinicalCharges', 'standaloneAppointments', 'surgicalProcedures', 'contactCenter']
      .map(key => [key, Number(result.coverage?.[key]) || 0])),
    candidates: rows.length + monthlyRows.length, sourceCandidates: available.length + monthlyRows.length,
    fixedMonthly: monthlyRows.length, monthlyFixed: monthlyRows.length,
    omittedFromReview: available.filter(row => row.ReviewEligible !== true).length,
    pendingCatalog: available.filter(row => !row.CatalogApproved).length,
    pendingTariff: available.filter(row => row.CatalogApproved && !row.ReviewEligible && !row.TariffSnapshot).length,
    pendingProvider: available.filter(row => row.CatalogApproved && row.TariffSnapshot && !row.ReviewEligible).length,
    orderLines: new Set(rows.filter(row => row.SourceType === 'SOLN').map(row => row.SourceLineId)).size,
    clinicalCharges: rows.filter(row => row.SourceType === 'PCBL').length,
    standaloneAppointments: rows.filter(row => row.SourceType === 'PCAP').length,
    surgicalProcedures: rows.filter(row => row.SourceType === 'PCFRCP').length,
    absentInAudit: rows.filter(row => !row.EnVistaAuditoria).length,
    absentInPayment: rows.filter(row => !row.EnVistaPago).length } };
}

async function getCurrentCandidate(pool, rowId, serviceDate) {
  validatePeriod(serviceDate, serviceDate);
  const { rows } = await getPeriodCandidates(pool, serviceDate, serviceDate);
  const row = rows.find(candidate => honorarioRowId(candidate) === rowId);
  if (!row) throw invalid('El servicio ya no aparece en esta fecha. Actualiza el reporte.', 409);
  return row;
}

// Sólo se reutiliza dentro de esta petición. saveReview vuelve a bloquear y
// comprobar la revisión de catálogo/tarifa de cada prestación antes de escribir.
async function loadApprovalContext(pool) {
  const [providers, pricing] = await Promise.all([getProviderDirectory(pool), catalog.loadPricingContext()]);
  return { providers, pricing };
}

async function approvalPreview(pool, input, originalRow, approvalContext) {
  const row = originalRow || await getCurrentCandidate(pool, input.rowId, input.serviceDate);
  if (row.FixedMonthly === true) throw invalid('El pago fijo mensual se administra desde su configuración, sin aprobar servicios clínicos.');
  const providerId = Number(input.providerId || row.ReviewBeneficiary?.providerId || row.MedicoId);
  const providers = approvalContext?.providers || await getProviderDirectory(pool);
  const provider = providers.find(item => Number(item.id) === providerId);
  if (!provider) throw invalid('Selecciona un médico del directorio clínico.');
  const quantity = Number(input.quantity ?? row.Cantidad);
  const role = input.role || row.ReviewBeneficiary?.role || row.RolMedico || 'TRATANTE';
  if (!['TRATANTE', 'AN', 'SURGEON', 'AY'].includes(role)) throw invalid("Selecciona la función del médico en este servicio.");
  const maximum = Number(row.CantidadMaxima ?? row.CantidadOriginal ?? row.Cantidad);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > maximum || !Number.isFinite(maximum)) {
    throw invalid("La cantidad a pagar debe ser mayor a cero y no superar los servicios realizados.");
  }
  const { ReviewBeneficiary, ReviewEligibilityTariff, ...source } = row;
  const [enriched] = await catalog.enrichCandidates([{ ...source, MedicoId: providerId,
    Medico: provider.name, MedicoConfirmado: true, Cantidad: quantity, CantidadReconocida: quantity,
    CantidadConfirmada: true, RolMedico: role }], approvalContext?.pricing);
  return { row: enriched, provider, quantity, maximum };
}

async function prepareSourceReview(pool, input, currentRow, approvalContext) {
  const row = currentRow || await getCurrentCandidate(pool, input.rowId, input.serviceDate);
  if (row.FixedMonthly === true) throw invalid('El pago fijo mensual se administra desde su configuración, sin aprobar servicios clínicos.');
  const decision = input.decision || {};
  if (decision.fingerprint !== reviewFingerprint(row)) {
    throw invalid('Cambió el servicio, su configuración o su tarifa. Actualiza el reporte antes de decidir.', 409);
  }
  if (decision.action !== 'APROBAR') return { ...input, decision: { ...decision,
    sourceType: 'BI_PRESTACION', snapshot: null, physicianChangeReason: null } };
  if (row.Cancelado || row.ScopeExcluded) throw invalid('El servicio está cancelado o pertenece a un grupo excluido.');
  if (row.CatalogStatus !== 'INCLUIDO') throw invalid('Configura el servicio como incluido en el catálogo antes de aprobarlo.');
  if (decision.executionConfirmed !== true) throw invalid('Confirma que el servicio se realizó.');
  // La confirmación directa registra la declaración del revisor, sin inventar
  // un folio de evidencia ni marcar la fuente clínica como realizada.
  const directApproval = decision.confirmationMode === 'DIRECT_APPROVAL';
  if (directApproval && ![0, 0.08, 0.16].includes(decision.vatRate)) {
    throw invalid('Selecciona el IVA antes de aprobar el honorario.');
  }
  if (!row.EjecucionConfirmada && !String(decision.evidenceReference || '').trim() && !directApproval) {
    throw invalid('Registra una referencia que respalde la realización del servicio o sesión.');
  }
  if (row.PosibleDuplicado && decision.duplicateConfirmed !== true) {
    throw invalid('Confirma que este servicio es distinto de los posibles duplicados.');
  }
  const { row: priced, provider, quantity, maximum } = await approvalPreview(pool, decision, row, approvalContext);
  // La identidad anterior procede de la fuente o de una aprobación compatible,
  // nunca del navegador. El motivo de aprobación no sustituye al de corrección.
  const previousProvider = row.ReviewBeneficiary || { providerId: row.MedicoId, providerName: row.Medico };
  const physicianChanged = Number(previousProvider.providerId) !== Number(provider.id);
  const physicianChangeReason = typeof decision.physicianChangeReason === 'string' ? decision.physicianChangeReason.trim() : '';
  if (physicianChanged && (!physicianChangeReason || physicianChangeReason.length > 2000)) {
    throw invalid('Escribe el motivo de la corrección del médico (máximo 2000 caracteres).');
  }
  const physicianCorrection = physicianChanged ? {
    fromProviderId: previousProvider.providerId ?? null, fromProviderName: previousProvider.providerName || '',
    toProviderId: provider.id, toProviderName: provider.name, reason: physicianChangeReason
  } : previousProvider.physicianCorrection || null;
  if (!priced.CatalogApproved || !priced.ReviewEligible) {
    throw invalid('Aprueba el servicio y su tarifa en el catálogo para el médico y la fecha seleccionados.');
  }
  if (!(Number(priced.PrecioUnitarioBI) > 0) || !priced.TariffSnapshot) {
    throw invalid("Registra una tarifa para este médico y función que cubra la fecha del servicio.");
  }
  if (Number(decision.quotedTariffId) !== priced.TariffSnapshot.id
    || Number(decision.quotedTariffRevision) !== priced.TariffSnapshot.revision) {
    throw invalid('La tarifa cambió o falta calcularla para este médico. Calcula el honorario y vuelve a confirmar.', 409);
  }
  // La aprobación conserva exactamente el cálculo que se mostró al revisar,
  // incluido el redondeo de cantidades fraccionadas a centavos.
  const baseAmount = priced.BaseImporte;
  const snapshot = {
    rowId: input.rowId, sourceType: row.SourceType, sourceLineId: row.SourceLineId,
    occurrenceId: row.OccurrenceId, allocationKey: `${row.SourceAllocationKey || `${row.SourceType}|${row.SourceLineId}`}|${priced.RolMedico}`,
    maximumQuantity: maximum, serviceDate: input.serviceDate, dateBasis: row.FechaReferenciaTipo,
    itemCode: row.CodigoServicio, description: row.Servicio, groupName: row.GrupoServicio,
    providerId: provider.id, providerName: provider.name, role: priced.RolMedico || 'TRATANTE', quantity,
    unitAmount: Number(priced.PrecioUnitarioBI), baseAmount,
    attention: row.FolioAtencion, appointment: row.FolioCita, salesOrder: row.FolioOrdenVenta,
    catalog: priced.CatalogSnapshot, tariff: priced.TariffSnapshot,
    execution: { confirmed: true, confirmationMethod: directApproval ? 'REVIEWER_APPROVAL' : 'REFERENCE', source: row.EvidenciaEjecucion,
      reference: String(decision.evidenceReference || '').trim(), confirmedInBI: !row.EjecucionConfirmada },
    duplicateConfirmed: decision.duplicateConfirmed === true, sourceFingerprint: row.SourceFingerprint,
    ...(physicianCorrection ? { physicianCorrection } : {})
  };
  return { ...input, decision: { ...decision, customAmount: baseAmount, sourceType: 'BI_PRESTACION',
    providerId: provider.id, quantity, snapshot,
    physicianChangeReason: physicianCorrection?.reason || null } };
}

module.exports = { validatePeriod, getPeriodCandidates, getCurrentCandidate, loadApprovalContext, approvalPreview, prepareSourceReview };
