import { userMessage } from '../../utils/userMessages';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { authHeaders } from '../../api/auth';
import { API_BASE } from '../../api/config';
import useEscapeKey from '../../hooks/useEscapeKey';
import { generateDoctorHonorariosPdf, generateAllDoctorsHonorariosPdf } from '../../utils/honorariosPdfGenerator';
import { downloadInstitutionalExcel } from '../../utils/excelInstitutionalGenerator';
import { formatConfiguredWithholdings, formatHonorariosRate, formatHonorariosRates } from '../../utils/honorariosSapDisplay';
import { calculateHonorarios, summarizeHonorarios, reviewFingerprint, annotateSapInvoiceCoverage, hasPhysicianChange } from '../../utils/honorariosCalculation';
import { isHonorarioReviewEligible } from '../../utils/honorariosEligibility';
import { formatHonorarioReference, formatHonorarioSalesOrder } from '../../utils/honorariosIdentifiers';
import { isExcludedHonorariosGroup, isExcludedHonorariosService } from '../../utils/honorariosScope';
import HonorariosCatalogPanel from './HonorariosCatalogPanel';
import HonorariosDoctorReviewCard, { HonorariosPhysicianCorrection } from './HonorariosDoctorReviewCard';
import HonorariosLiquidationsPanel from './HonorariosLiquidationsPanel';
import HonorariosFiscalPanel from './HonorariosFiscalPanel';
import HonorariosVerticalAuditPanel from './HonorariosVerticalAuditPanel';
import HonorariosMonthlyFixedPanel from './HonorariosMonthlyFixedPanel';
import { apiFetch } from '../../api/client';
import { HonorariosHeader, HonorariosPeriod, HonorariosSummary, HonorariosResultsToolbar } from './HonorariosReviewToolbar';

const roundCents = value => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const HONORARIOS_PAGE_SIZE = 100;
const canSelectService = row => row.ModeBI && !row.FixedMonthly && !row.LiquidacionCerrada && !row.Cancelado
  && row._reviewStatus === 'PENDIENTE' && row.CatalogStatus === 'INCLUIDO' && Number(row.Cantidad) > 0;
const doctorGroupKey = row => `${String(row.Medico || 'Médico No Asignado').trim()}${row.ModeBI && row.MedicoId ? ` · #${row.MedicoId}` : ''}`;
const readQuantity = value => {
  if (value === null || value === undefined || value === '') return 1;
  const quantity = Number(value);
  return Number.isFinite(quantity) ? quantity : 1;
};
const quantityForTotals = row => row.ModeBI && row.Cantidad == null ? 0 : readQuantity(row.Cantidad);

export default function HonorariosAuditView() {
  const { user } = useAuth();
  const pdfGeneratedBy = user?.nombre || user?.NombreCompleto || user?.username || user?.Username || 'Usuario no identificado';
  const today = new Date().toISOString().split('T')[0];
  const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

  const [startDate, setStartDate] = useState(firstDayOfMonth);
  const [workspace, setWorkspace] = useState('review');
  const [catalogVisited, setCatalogVisited] = useState(false);
  const [paymentProviderId, setPaymentProviderId] = useState('');
  const [fiscalProviderId, setFiscalProviderId] = useState('');
  const [fiscalProfiles, setFiscalProfiles] = useState({});
  const [fiscalError, setFiscalError] = useState('');
  const loadFiscalProfiles = async () => {
    try { const result = await apiFetch('/honorarios/fiscal-profiles'); setFiscalProfiles(result.profiles || {}); setFiscalError(''); }
    catch (failure) { setFiscalError(userMessage(failure.message)); }
  };
  useEffect(() => { loadFiscalProfiles(); }, []);
  const canManage = String(user?.username || '').toLowerCase() === 'amendoza'
    || user?.permisos?.includes('interconsultas-jornadas') === true;
  const [providers, setProviders] = useState([]);
  const [providerError, setProviderError] = useState(null);
  const [endDate, setEndDate] = useState(today);
  
  const [data, setData] = useState([]);
  const [coverage, setCoverage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sapLoading, setSapLoading] = useState(false);
  const [sapError, setSapError] = useState(null);
  const [sapReconciliation, setSapReconciliation] = useState(null);
  const [error, setError] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);
  const reportRequest = useRef({ id: 0, controller: null });
  const catalogChanged = useRef(false);
  const sapRequests = useRef(0);
  const pendingSapDoctors = useRef(new Set());
  useEffect(() => () => { reportRequest.current.controller?.abort(); reportRequest.current.id += 1; }, []);

  // Filtros reactivos en memoria
  const [statusTab, setStatusTab] = useState('pendientes');
  const [grupoFilter, setGrupoFilter] = useState('TODOS');
  const [medicoFilter, setMedicoFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState('medicos'); // 'medicos' | 'inteligente' | 'plana'
  const [detailPage, setDetailPage] = useState(0);
  const [doctorPages, setDoctorPages] = useState({});

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchTerm(searchTerm), 250);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Modal de Detalle / Ficha de Auditoría
  const [selectedRow, setSelectedRow] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  useEscapeKey(() => setModalOpen(false), modalOpen);

  // Acordeones expandidos en vista por médico
  const [expandedMedicos, setExpandedMedicos] = useState({});

  // ── Estado de Ajustes Manuales (Overrides de Auditoría) ──
  // Estructura: { [rowId]: { action: 'APROBAR' | 'EXCLUIR', customAmount: number, motivo: string, timestamp: string } }
  const [overrides, setOverrides] = useState({});

  // Modal para capturar Justificación y Monto de Ajuste Manual
  const [overrideModal, setOverrideModal] = useState({
    isOpen: false,
    row: null,
    action: 'APROBAR', // 'APROBAR' | 'EXCLUIR'
    customAmount: '',
    motivo: '',
    error: null
  });
  useEscapeKey(() => setOverrideModal(prev => ({ ...prev, isOpen: false })), overrideModal.isOpen);

  const [reviewReady, setReviewReady] = useState(false);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewError, setReviewError] = useState(null);
  const [canReview, setCanReview] = useState(false);
  const [selectedServices, setSelectedServices] = useState({});
  const [bulkMessage, setBulkMessage] = useState('');
  const [bulkDialog, setBulkDialog] = useState({ open: false, rows: [], action: 'APROBAR', providerId: '', motivo: '', evidenceReference: '', vatRate: '', confirmed: false, duplicateConfirmed: false, preview: null, error: null });
  const overridePhysicianChanged = overrideModal.action === 'APROBAR' && overrideModal.row?.ModeBI && !overrideModal.row.FixedMonthly
    && hasPhysicianChange(overrideModal.row.MedicoId, overrideModal.providerId);
  const bulkPhysicianChanged = bulkDialog.action === 'APROBAR'
    && bulkDialog.rows.some(row => hasPhysicianChange(row.providerId, bulkDialog.providerId));
  const overrideChangeReasonMissing = overridePhysicianChanged && !String(overrideModal.evidenceReference || '').trim();
  const bulkChangeReasonMissing = bulkPhysicianChanged && !bulkDialog.evidenceReference.trim();
  useEscapeKey(() => setBulkDialog(previous => ({ ...previous, open: false })), bulkDialog.open);
  useEffect(() => {
    fetch(API_BASE + '/honorarios/providers', { headers: authHeaders() }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(userMessage(result.error || 'No se pudo consultar el directorio de médicos.'));
      setProviders(result.providers || []);
    }).catch(failure => setProviderError(userMessage(failure.message)));
  }, []);
  useEffect(() => {
    setDetailPage(0);
    setDoctorPages({});
  }, [debouncedSearchTerm, statusTab, grupoFilter, medicoFilter, startDate, endDate]);
  const effectiveData = useMemo(() => calculateHonorarios(data, overrides, sapReconciliation?.providers, startDate, fiscalProfiles)
    .filter(isHonorarioReviewEligible), [data, overrides, sapReconciliation, startDate, fiscalProfiles]);
  useEffect(() => {
    setSelectedRow(previous => previous ? effectiveData.find(row => row._rowId === previous._rowId) || null : null);
  }, [effectiveData]);

  const suggestedVatFor = row => {
    const profile = fiscalProfiles[row.MedicoId];
    return profile?.enabled && profile.confirmed && String(profile.providerId) === String(row.MedicoId)
      && profile.validFrom <= String(row.FechaAtencion).slice(0, 10) && [0, 0.08, 0.16].includes(profile.defaultVatRate)
      ? String(profile.defaultVatRate) : '';
  };
  const handleOpenOverrideDialog = (row, action) => {
    if (action === 'APROBAR' && row._reviewStatus !== 'PENDIENTE') return;
    const base = Number(row.BaseImporte) > 0 ? row.BaseImporte : row.BasePropuesta;
    const previousProvider = row._previousApproval?.providerId || row.MedicoId;
    const mustReprice = row.ModeBI && (row._reviewStale || previousProvider !== row.MedicoId);
    setOverrideModal({ isOpen: true, row, action, customAmount: base > 0 ? String(base) : '',
      providerId: previousProvider ? String(previousProvider) : '', quantity: row._previousApproval?.quantity ?? row.Cantidad ?? '',
      quotedTariffId: mustReprice ? null : row.TariffSnapshot?.id,
      quotedTariffRevision: mustReprice ? null : row.TariffSnapshot?.revision,
      role: row.RolMedico || 'TRATANTE',
      executionConfirmed: action === 'APROBAR', evidenceReference: '', duplicateConfirmed: false,
      vatRate: suggestedVatFor({ ...row, MedicoId: previousProvider }), separateServicesConfirmed: false,
      motivo: action === 'APROBAR' ? row.FixedMonthly ? 'Pago fijo mensual completo autorizado por quien revisa.' : 'Servicio e IVA confirmados al aprobar el honorario.' : '', error: null });
  };
  const persistReview = async (row, decision) => {
    if (!reviewReady || !canReview || reviewSaving) throw new Error('Actualiza el reporte antes de revisar honorarios.');
    const response = await fetch(API_BASE + '/honorarios/reviews', {
      method: 'PUT', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ rowId: row._rowId, serviceDate: String(row.FechaAtencion).slice(0,10),
        expectedRevision: row._revision || 0,
        decision: { ...decision, fingerprint: reviewFingerprint(row), sourceType: row.TipoCalculo || 'CLINICO' } })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(userMessage(result.error || 'No se pudo guardar la decisión.'));
    setOverrides(previous => ({ ...previous, [row._rowId]: result.review }));
    setSelectedServices(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => id !== row._rowId)));
    if (decision.action === 'APROBAR') {
      setBulkMessage('Servicio aprobado. Puedes verlo y descargar su PDF en Pagos y PDF.');
      if (workspace === 'review') setStatusTab('pendientes');
    }
    refreshSapForReviews({ [row._rowId]: result.review });
    if (result.review.snapshot?.providerName) setExpandedMedicos(previous => previous[doctorGroupKey(row)]
      ? { ...previous, [doctorGroupKey({ ModeBI: true, Medico: result.review.snapshot.providerName, MedicoId: result.review.snapshot.providerId })]: true }
      : previous);
    setData(previous => previous.map(source => (source.SourceIdentity || source.UDRKey) === row._rowId
      ? { ...source, ReviewInvalidated: false } : source));
  };
  const refreshSapForReviews = reviews => {
    const names = [...new Set(Object.values(reviews || {}).map(review => review.snapshot?.providerName).filter(Boolean))]
      .filter(name => !sapReconciliation?.providers?.[name] && !pendingSapDoctors.current.has(name));
    if (!names.length) return;
    const { id, controller } = reportRequest.current;
    names.forEach(name => pendingSapDoctors.current.add(name));
    sapRequests.current += 1; setSapLoading(true);
    fetch(API_BASE + '/honorarios/sap-reconciliation', { method: 'POST', signal: controller?.signal,
      headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ startDate, endDate, doctors: names })
    }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(userMessage(result.error));
      if (reportRequest.current.id !== id || controller?.signal.aborted) return;
      setSapReconciliation(previous => ({ ...previous, ...result,
        providers: { ...previous?.providers, ...result.providers },
        additionalProviders: result.additionalProviders || previous?.additionalProviders || [] }));
    }).catch(failure => {
      if (reportRequest.current.id === id && !controller?.signal.aborted) setSapError(userMessage(failure.message));
    }).finally(() => {
      if (reportRequest.current.id !== id) return;
      names.forEach(name => pendingSapDoctors.current.delete(name));
      sapRequests.current = Math.max(0, sapRequests.current - 1); setSapLoading(sapRequests.current > 0);
    });
  };
  const handleConfirmOverride = async () => {
    const row = overrideModal.row;
    if (!row || reviewSaving) return;
    if (overrideChangeReasonMissing) {
      setOverrideModal(previous => ({ ...previous, error: 'Escribe el motivo del cambio de médico antes de aprobar.' })); return;
    }
    const amount = Number(overrideModal.customAmount);
    if (!row.ModeBI && overrideModal.action === 'APROBAR' && row.TipoCalculo !== 'SAP_DOCUMENTO'
      && (!Number.isFinite(amount) || amount <= 0 || !String(row.Medico || '').trim())) {
      setOverrideModal(previous => ({ ...previous, error: 'Selecciona un médico y registra un honorario mayor a cero. Usa la tarifa autorizada para el médico; el importe cobrado al paciente puede ser diferente.' })); return;
    }
    if (row.ModeBI && overrideModal.action === 'APROBAR' && (!overrideModal.providerId
      || !(Number(overrideModal.quantity) > 0) || !overrideModal.executionConfirmed)) {
      setOverrideModal(previous => ({ ...previous, error: 'Selecciona el médico, confirma la cantidad y la realización del servicio.' })); return;
    }
    if (row.ModeBI && !row.FixedMonthly && overrideModal.action === 'APROBAR' && !overrideModal.quotedTariffId) {
      setOverrideModal(previous => ({ ...previous, error: 'Calcula el honorario con la tarifa que corresponde a la fecha del servicio antes de confirmar.' })); return;
    }
    if (row.ModeBI && overrideModal.action === 'APROBAR' && overrideModal.vatRate === '') {
      setOverrideModal(previous => ({ ...previous, error: 'Selecciona el IVA antes de aprobar.' })); return;
    }
    if (!overrideModal.motivo.trim()) {
      setOverrideModal(previous => ({ ...previous, error: 'Registra el motivo y la evidencia de tu decisión.' })); return;
    }
    setReviewSaving(true);
    try {
      await persistReview(row, { action: overrideModal.action, customAmount: roundCents(amount),
        vatRate: overrideModal.vatRate === '' ? null : Number(overrideModal.vatRate),
        providerId: Number(overrideModal.providerId) || null, quantity: Number(overrideModal.quantity),
        role: overrideModal.role,
        quotedTariffId: overrideModal.quotedTariffId, quotedTariffRevision: overrideModal.quotedTariffRevision,
        executionConfirmed: overrideModal.executionConfirmed, confirmationMode: row.ModeBI ? 'DIRECT_APPROVAL' : null,
        evidenceReference: overridePhysicianChanged ? '' : String(overrideModal.evidenceReference || '').trim(),
        physicianChangeReason: overridePhysicianChanged ? overrideModal.evidenceReference.trim() : undefined,
        duplicateConfirmed: overrideModal.duplicateConfirmed,
        separateServicesConfirmed: overrideModal.separateServicesConfirmed, motivo: overrideModal.motivo.trim() });
      setOverrideModal(previous => ({ ...previous, isOpen: false }));

    } catch (error) { setOverrideModal(previous => ({ ...previous, error: userMessage(error.message) })); }
    finally { setReviewSaving(false); }
  };
  useEffect(() => {
    if (!overrideModal.isOpen || overrideModal.action !== 'APROBAR' || !overrideModal.row?.ModeBI || overrideModal.row.FixedMonthly
      || overrideModal.quotedTariffId || !overrideModal.providerId || !(Number(overrideModal.quantity) > 0)) return;
    const controller = new AbortController();
    setOverrideModal(previous => ({ ...previous, pricing: true }));
    fetch(API_BASE + '/honorarios/approval-preview', { method: 'POST', signal: controller.signal,
      headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({
        rowId: overrideModal.row._rowId, serviceDate: String(overrideModal.row.FechaAtencion).slice(0, 10),
        providerId: Number(overrideModal.providerId), quantity: Number(overrideModal.quantity), role: overrideModal.role })
    }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(userMessage(result.error));
      if (!(result.row.BaseImporte > 0) || !result.row.TariffSnapshot) throw new Error('Falta configurar una tarifa vigente para este médico y servicio.');
      if (!controller.signal.aborted) setOverrideModal(previous => ({ ...previous,
        customAmount: String(result.row.BaseImporte), quotedTariffId: result.row.TariffSnapshot.id,
        quotedTariffRevision: result.row.TariffSnapshot.revision, pricing: false, error: null }));
    }).catch(failure => {
      if (!controller.signal.aborted) setOverrideModal(previous => ({ ...previous, pricing: false, error: userMessage(failure.message) }));
    });
    return () => controller.abort();
  }, [overrideModal.isOpen, overrideModal.action, overrideModal.row?._rowId, overrideModal.providerId,
    overrideModal.quantity, overrideModal.role, overrideModal.quotedTariffId]);

  const handleRestoreRow = async row => {
    if (reviewSaving) return;
    setReviewSaving(true);
    try { await persistReview(row, { action: 'PENDIENTE', motivo: 'Devuelto a revisión', customAmount: null, vatRate: null }); }
    catch (error) { setReviewError(userMessage(error.message)); }
    finally { setReviewSaving(false); }
  };
  const reviewButtons = row => <>
    {row._reviewStatus === 'PENDIENTE' && <>
    {row.ModeBI && !row.FixedMonthly && !row.LiquidacionCerrada && <input type="checkbox" aria-label={`Seleccionar servicio ${row.SourceLineId}`}
      title="Seleccionar para una decisión conjunta" checked={!!selectedServices[row._rowId]} disabled={!reviewReady || !canReview || !canSelectService(row)}
      onChange={event => setSelectedServices(previous => ({ ...previous, [row._rowId]: event.target.checked }))} />}
    <button disabled={!!row.LiquidacionCerrada || row.Cancelado || (row.ModeBI && !row.FixedMonthly && row.CatalogStatus !== 'INCLUIDO') || !reviewReady || !canReview || reviewSaving || (row.TipoCalculo === 'SAP_DOCUMENTO' && (row.SapDocumento?.cancelled || row.SapDocumento?.currency !== 'MXN' || row.SapDocumento?.documentTotal === null || row.SapDocumento?.documentTotal === undefined))}
      title={row.TipoCalculo === 'SAP_DOCUMENTO' && row.SapDocumento?.cancelled ? 'La factura está cancelada y no se puede aprobar.' : row.TipoCalculo === 'SAP_DOCUMENTO' && row.SapDocumento?.currency !== 'MXN' ? 'La factura no está en pesos mexicanos y requiere revisión.' : row.TipoCalculo === 'SAP_DOCUMENTO' && (row.SapDocumento?.documentTotal === null || row.SapDocumento?.documentTotal === undefined) ? 'Falta el total de la factura y requiere revisión.' : 'Aprobar'}
      className="hon-btn-override-approve" onClick={() => handleOpenOverrideDialog(row, 'APROBAR')}>{row.FixedMonthly ? 'Incluir pago mensual' : 'Aprobar'}</button>
    </>}
    {row._reviewStatus !== 'RECHAZADO' && <button disabled={!!row.LiquidacionCerrada || !reviewReady || !canReview || reviewSaving} className="hon-btn-override-exclude" onClick={() => handleOpenOverrideDialog(row, 'EXCLUIR')}>Excluir</button>}
  </>;
  const openBulk = (action, directRows) => {
    const selected = (directRows || effectiveData.filter(row => selectedServices[row._rowId])).filter(canSelectService);
    setReviewError(null);
    if (!selected.length || selected.length > 100) { setReviewError('Selecciona entre 1 y 100 servicios para cada revisión conjunta.'); return; }
    const suggestedRates = [...new Set(selected.map(suggestedVatFor))];
    setBulkDialog({ open: true, action, providerId: '', motivo: action === 'APROBAR' ? 'Servicios e IVA confirmados en aprobación múltiple.' : '', evidenceReference: '', vatRate: suggestedRates.length === 1 ? suggestedRates[0] : '', confirmed: false,
      duplicateConfirmed: false, preview: null, pricing: action === 'APROBAR', error: null, rows: selected.map(row => ({ rowId: row._rowId,
        sourceLineId: row.SourceLineId, expectedRevision: row._revision || 0, fingerprint: reviewFingerprint(row),
        providerId: row.MedicoId, providerName: row.Medico, role: row.RolMedico, quantity: row.Cantidad,
        salesOrder: row.FolioOrdenVenta, description: row.Servicio, serviceDate: String(row.FechaAtencion).slice(0, 10),
        possibleDuplicate: row.PosibleDuplicado })) });
  };
  const bulkRequest = async (endpoint, body, signal) => {
    const response = await fetch(API_BASE + endpoint, { method: 'POST', signal, headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
    const result = await response.json(); if (!response.ok) throw new Error(userMessage(result.error || 'No se pudo completar la revisión conjunta.')); return result;
  };
  useEffect(() => {
    if (!bulkDialog.open || bulkDialog.action !== 'APROBAR') return;
    const controller = new AbortController();
    setBulkDialog(previous => ({ ...previous, pricing: true, preview: null, error: null }));
    bulkRequest('/honorarios/reviews/bulk-preview', { startDate, endDate, rows: bulkDialog.rows,
      providerId: bulkDialog.providerId || null }, controller.signal).then(result => {
      if (!controller.signal.aborted) setBulkDialog(previous => ({ ...previous, preview: result.rows, pricing: false }));
    }).catch(failure => {
      if (!controller.signal.aborted) setBulkDialog(previous => ({ ...previous, pricing: false, error: userMessage(failure.message) }));
    });
    return () => controller.abort();
  }, [bulkDialog.open, bulkDialog.action, bulkDialog.providerId, bulkDialog.rows, startDate, endDate]);
  const selectRows = rows => {
    const selectable = rows.filter(canSelectService);
    setSelectedServices(Object.fromEntries(selectable.slice(0, 100).map(row => [row._rowId, true])));
    setReviewError(null);
    setBulkMessage(selectable.length > 100 ? 'Se seleccionaron los primeros 100 servicios de estos filtros. Después puedes continuar con los siguientes.' : '');
  };
  const saveBulk = async () => {
    if (reviewSaving) return;
    if (bulkChangeReasonMissing) {
      setBulkDialog(previous => ({ ...previous, error: 'Escribe el motivo del cambio de médico antes de aprobar la selección.' })); return;
    }
    const approving = bulkDialog.action === 'APROBAR';
    if (!bulkDialog.motivo.trim() || (approving ? (!bulkDialog.preview || bulkDialog.pricing || bulkDialog.vatRate === '') : !bulkDialog.confirmed)) {
      setBulkDialog(previous => ({ ...previous, error: approving ? 'Espera el cálculo y selecciona el IVA para aprobar.' : 'Registra el motivo y confirma la exclusión.' })); return;
    }
    if (approving && bulkDialog.rows.some(row => row.possibleDuplicate) && !bulkDialog.duplicateConfirmed) {
      setBulkDialog(previous => ({ ...previous, error: 'Revisa los posibles duplicados antes de aprobar.' })); return;
    }
    setReviewSaving(true);
    try {
      const result = await bulkRequest('/honorarios/reviews/bulk', { startDate, endDate,
        rows: bulkDialog.action === 'APROBAR' ? bulkDialog.preview : bulkDialog.rows,
        decision: { action: bulkDialog.action, motivo: bulkDialog.motivo.trim(), executionConfirmed: approving || bulkDialog.confirmed,
          confirmationMode: approving ? 'DIRECT_APPROVAL' : null,
          evidenceReference: bulkPhysicianChanged ? '' : bulkDialog.evidenceReference.trim(),
          physicianChangeReason: bulkPhysicianChanged ? bulkDialog.evidenceReference.trim() : undefined,
          duplicateConfirmed: bulkDialog.duplicateConfirmed,
          vatRate: bulkDialog.vatRate === '' ? null : Number(bulkDialog.vatRate) } });
      setOverrides(previous => ({ ...previous, ...result.reviews }));
      refreshSapForReviews(result.reviews);
      const savedIds = new Set(Object.keys(result.reviews || {}));
      setData(previous => previous.map(row => savedIds.has(row.SourceIdentity || row.UDRKey) ? { ...row, ReviewInvalidated: false } : row));
      setBulkDialog(previous => ({ ...previous, open: false }));
      setSelectedServices(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => !savedIds.has(id))));
      setBulkMessage(`${result.savedCount} servicios ${approving ? 'aprobados' : 'excluidos'}.${result.errors.length ? ` ${result.errors.length} requieren otra revisión.` : ''}`);
      if (approving && result.savedCount > 0 && workspace === 'review') setStatusTab('pendientes');
      if (result.errors.length) setReviewError(userMessage(result.errors.slice(0, 3).map(item => item.message).join(' · ')));
    } catch (failure) { setBulkDialog(previous => ({ ...previous, error: userMessage(failure.message) })); }
    finally { setReviewSaving(false); }
  };
  const reviewLabel = row => row.LiquidacionCerrada ? `Cierre #${row.LiquidacionCerrada}${row.CambiosTrasCierre ? ' · Revisar cambio clínico' : ''}` : row.ReviewInvalidated ? 'Pendiente: cambió la tarifa del médico aprobado' : row._reviewStale ? 'Pendiente: cambiaron los datos o la tarifa'
    : row._reviewSource === 'VERTICAL' && row._reviewStatus === 'APROBADO' ? 'Aprobado en el sistema de atenciones'
      : row._reviewSource === 'VERTICAL' && row._reviewStatus === 'RECHAZADO' ? 'Rechazado en el sistema de atenciones'
        : row.ModeBI && row._reviewStatus === 'PENDIENTE' ? (row.BIStatusReasons || []).join(' · ') || 'Pendiente de aprobación'
          : ({ APROBADO: 'Aprobado', RECHAZADO: 'Excluido', PENDIENTE: 'Pendiente de revisión' })[row._reviewStatus];
  const sourceLabel = row => row.TipoCalculo === 'SAP_DOCUMENTO'
    ? row.SapDocumento?.cancelled ? 'Factura cancelada · no se puede aprobar' : 'Factura adicional · no relacionada con una atención'
    : row.FuenteHonorario === 'Cita sin orden de venta' ? 'Cita recuperada de la agenda'
      : row.FolioAtencion ? 'Atención registrada' : row.FolioCita ? 'Cita registrada'
        : row.FolioOrdenVenta ? 'Orden de venta registrada' : 'Registro clínico';
  const renderSapLineDetails = row => row.TipoCalculo === 'SAP_DOCUMENTO' && row.SapDocumento?.lines?.length > 0 && (
    <div style={{ marginTop: '0.25rem', color: '#6b21a8', fontSize: '0.72rem', fontWeight: '500' }}>
      {row.SapDocumento.lines.map((line, index) => (
        <div key={`${line.lineNumber ?? index}-${line.description}`}>
          {line.description || 'Concepto de factura'} · cantidad {Number(line.quantity) > 0 ? line.quantity : 'sin informar'} · importe registrado {formatSapMoney(line.recordedAmount, row.SapDocumento.currency)}
          <div style={{ marginLeft: '0.4rem', color: row.SapDocumento.verticalLineCoverage?.[index]?.status === 'NO_LOCALIZADO' ? '#b45309' : '#64748b' }}>
            {row.SapDocumento.verticalLineCoverage?.[index]?.label || 'Aún no se comparó con las atenciones'}
          </div>
        </div>
      ))}
      <div>Las atenciones son la fuente principal. Esta comparación es una guía; revisa que la factura no incluya un servicio ya registrado.</div>
    </div>
  );
  const renderPagination = ({ page, pageCount, total, onPageChange, itemLabel = 'registros' }) => pageCount > 1 && (
    <nav aria-label="Paginación de registros" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', padding: '0.7rem 1rem', borderTop: '1px solid var(--table-border, #e2e8f0)', color: 'var(--text-muted, #64748b)', fontSize: '0.8rem' }}>
      <span>Mostrando {(page * HONORARIOS_PAGE_SIZE + 1).toLocaleString()}–{Math.min(total, (page + 1) * HONORARIOS_PAGE_SIZE).toLocaleString()} de {total.toLocaleString()} {itemLabel}. Los totales consideran todos los resultados.</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <button type="button" className="hon-view-btn" disabled={page === 0} onClick={() => onPageChange(page - 1)}>Anterior</button>
        <span>Página {page + 1} de {pageCount}</span>
        <button type="button" className="hon-view-btn" disabled={page + 1 >= pageCount} onClick={() => onPageChange(page + 1)}>Siguiente</button>
      </div>
    </nav>
  );
  const reviewBadgeStyle = row => row._reviewStatus === 'APROBADO'
    ? { background: '#dcfce7', color: '#15803d' }
    : row._reviewStatus === 'RECHAZADO'
      ? { background: '#fee2e2', color: '#b91c1c' }
      : { background: '#fef3c7', color: '#92400e' };

  const toggleMedico = (medicoName) => {
    setExpandedMedicos(prev => ({
      ...prev,
      [medicoName]: !prev[medicoName]
    }));
  };

  const expandAllMedicos = () => {
    const visibleRowCount = groupedByMedico.reduce((sum, group) => sum + Math.min(group.filas.length, HONORARIOS_PAGE_SIZE), 0);
    if (visibleRowCount > 500) return;
    const all = {};
    groupedByMedico.forEach(g => { all[g.medico] = true; });
    setExpandedMedicos(all);
  };

  const collapseAllMedicos = () => {
    setExpandedMedicos({});
  };

  const fetchReport = async () => {
    reportRequest.current.controller?.abort();
    const controller = new AbortController();
    const id = reportRequest.current.id + 1;
    reportRequest.current = { id, controller };
    const current = () => reportRequest.current.id === id && !controller.signal.aborted;
    catalogChanged.current = false;
    sapRequests.current = 0; pendingSapDoctors.current.clear();
    setLoading(true);
    setError(null);
    setData([]);
    setExpandedMedicos({});
    setDoctorPages({});
    setDetailPage(0);
    setCoverage(null);
    setReviewReady(false);
    setReviewError(null);
    setOverrides({});
    setSelectedServices({}); setBulkMessage('');
    setSapReconciliation(null);
    setSapError(null);
    setSapLoading(false);
    setHasSearched(true);
    
    let loadedReviews = {};
    try {
      const query = new URLSearchParams({
        startDate,
        endDate
      });
      
      const [response, reviewResponse] = await Promise.all([
        fetch(`${API_BASE}/honorarios/audit?${query.toString()}`, { headers: authHeaders(), signal: controller.signal }),
        fetch(API_BASE + '/honorarios/reviews?' + query, { headers: authHeaders(), signal: controller.signal }).catch(() => null)
      ]);
      
      const result = await response.json();
      if (!current()) return;
      if (!response.ok) throw new Error(userMessage(result.error || result.message || 'Error al consultar Vertical'));
      
      const reportRows = (result.data || []).filter(row => (row.FixedMonthly === true || !isExcludedHonorariosService(row)) && isHonorarioReviewEligible(row));
      setCoverage(result.coverage || null);
      try {
        if (!reviewResponse) throw new Error('No se pudieron consultar las revisiones guardadas. Actualiza e intenta de nuevo.');
        const reviewResult = await reviewResponse.json();
        if (!current()) return;
        if (!reviewResponse.ok) throw new Error(userMessage(reviewResult.error || 'No se pudieron leer las revisiones.'));
        loadedReviews = reviewResult.reviews || {};
        setData(reportRows);
        setOverrides(loadedReviews); setCanReview(reviewResult.canReview === true); setReviewReady(true);
      } catch (error) { if (!current()) return; setReviewError(userMessage(error.message)); }

      setLoading(false);

      // El reporte principal permanece disponible si SAP no responde; la conciliación es una lectura aparte.
      const doctorNames = [...new Set(reportRows.flatMap(row => [String(row.Medico || '').trim(),
        row.ReviewBeneficiary?.providerName, loadedReviews[row.SourceIdentity || row.UDRKey]?.snapshot?.providerName]).filter(Boolean))];
      if (doctorNames.length) {
        sapRequests.current += 1;
        setSapLoading(true);
        try {
          const sapResponse = await fetch(`${API_BASE}/honorarios/sap-reconciliation`, {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            signal: controller.signal,
            body: JSON.stringify({ startDate, endDate, doctors: doctorNames })
          });
          const sapResult = await sapResponse.json();
          if (!current()) return;
          if (!sapResponse.ok) throw new Error(userMessage(sapResult.error || 'No se pudieron consultar las facturas de SAP.'));
          setSapReconciliation(previous => ({ ...previous, ...sapResult, providers: { ...previous?.providers, ...sapResult.providers } }));
        } catch (sapErr) {
          if (!current()) return;
          setSapError(userMessage(sapErr.message || 'No se pudo consultar SAP.'));
        } finally {
          if (current()) { sapRequests.current = Math.max(0, sapRequests.current - 1); setSapLoading(sapRequests.current > 0); }
        }
      }
    } catch (err) {
      if (current()) setError(userMessage(err.message));
    } finally {
      if (current()) setLoading(false);
    }
  };

  const onCatalogChanged = () => {
    catalogChanged.current = true;
    reportRequest.current.controller?.abort();
    reportRequest.current.id += 1;
    setData([]); setSapReconciliation(null); setReviewReady(false); setSelectedServices({});
    setLoading(false); setSapLoading(false); setReviewError(null); setError(null); setSapError(null);
  };
  const changeWorkspace = next => {
    if (next === 'liquidations') setPaymentProviderId('');
    if (next === 'catalog') setCatalogVisited(true);
    if (next === 'approved') { setStatusTab('elegibles'); setViewMode('medicos'); setSelectedServices({}); }
    if (next === 'review' && workspace === 'approved') setStatusTab('pendientes');
    setWorkspace(next);
    if (['review', 'approved'].includes(next) && catalogChanged.current) fetchReport();
  };
  const reviewCatalogService = item => {
    setStatusTab('todos'); setGrupoFilter('TODOS'); setMedicoFilter('');
    setSearchTerm(item.itemCode); setDebouncedSearchTerm(item.itemCode);
    setWorkspace('review'); fetchReport();
  };

  // Formateadores
  const formatMoney = (val) => {
    if (val === null || val === undefined || !Number.isFinite(Number(val))) return 'Pendiente';
    const num = Number(val);
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(num);
  };

  const formatSapMoney = (val, currency = 'MXN') => {
    if (val === null || val === undefined || val === '' || !Number.isFinite(Number(val))) return 'No disponible';
    if (currency === 'LCY') {
      const amount = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(val) || 0);
      return `${amount} - moneda local SAP`;
    }
    const safeCurrency = /^[A-Z]{3}$/.test(String(currency || '')) ? currency : 'MXN';
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: safeCurrency }).format(Number(val) || 0);
  };

  const formatDate = (val) => {
    if (!val) return '-';
    const str = String(val).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
      const [year, month, day] = str.substring(0, 10).split('-');
      return `${day}/${month}/${year}`;
    }
    return str;
  };

  // Lista única de los grupos incluidos en Honorarios Médicos.
  const uniqueGrupos = useMemo(() => {
    const set = new Set();
    effectiveData.forEach(item => {
      const g = item.GrupoServicio;
      if (g && g.trim() && !isExcludedHonorariosGroup(g)) {
        set.add(g.trim());
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [effectiveData]);

  // Lista única de Médicos
  const uniqueMedicos = useMemo(() => {
    const set = new Set();
    effectiveData.forEach(item => {
      const med = item.Medico;
      if (med && med.trim()) set.add(med.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [effectiveData]);

  // Filtros de búsqueda compartidos por las pestañas de estado.
  const filteredByCriteria = useMemo(() => {
    if (!Array.isArray(effectiveData)) return [];
    let list = effectiveData;
    if (grupoFilter !== 'TODOS') {
      list = list.filter(r => (r.GrupoServicio || '').trim() === grupoFilter.trim());
    }
    if (medicoFilter) {
      list = list.filter(r => (r.Medico || '').trim() === medicoFilter.trim());
    }
    if (debouncedSearchTerm.trim()) {
      const q = debouncedSearchTerm.toLowerCase().trim();
      list = list.filter(r => 
        String(r.Medico || '').toLowerCase().includes(q) ||
        String(r.Paciente || '').toLowerCase().includes(q) ||
        String(r.FolioAtencion || '').toLowerCase().includes(q) ||
        String(r.FolioCita || '').toLowerCase().includes(q) ||
        String(r.FolioOrdenVenta || '').toLowerCase().includes(q) ||
        String(r.Servicio || '').toLowerCase().includes(q) ||
        String(r.CodigoServicio || '').toLowerCase().includes(q) ||
        String(r.Cliente || '').toLowerCase().includes(q) ||
        String(r.Especialidad || '').toLowerCase().includes(q) ||
        String(r._effectiveMotivo || '').toLowerCase().includes(q) ||
        String(r.MensajeAuditoria || '').toLowerCase().includes(q)
      );
    }

    return list;
  }, [effectiveData, grupoFilter, medicoFilter, debouncedSearchTerm]);

  // La pestaña filtra después de conservar el universo coincidente, para poder
  // explicar cuántos resultados de esa búsqueda están en las otras pestañas.
  const filteredData = useMemo(() => {
    if (statusTab === 'elegibles') return filteredByCriteria.filter(r => !!r._effectiveElegible);
    if (statusTab === 'exclusiones') return filteredByCriteria.filter(r => r._reviewStatus === 'RECHAZADO');
    if (statusTab === 'pendientes') return filteredByCriteria.filter(r => r._reviewStatus === 'PENDIENTE');
    return filteredByCriteria;
  }, [filteredByCriteria, statusTab]);
  const detailPageCount = Math.max(1, Math.ceil(filteredData.length / HONORARIOS_PAGE_SIZE));
  const activeDetailPage = Math.min(detailPage, detailPageCount - 1);
  const visibleFilteredData = useMemo(() => filteredData.slice(
    activeDetailPage * HONORARIOS_PAGE_SIZE, (activeDetailPage + 1) * HONORARIOS_PAGE_SIZE
  ), [filteredData, activeDetailPage]);

  const matchingReviewCounts = useMemo(() => filteredByCriteria.reduce((counts, row) => {
    counts.total += 1;
    if (row._reviewStatus === 'APROBADO') counts.approved += 1;
    else if (row._reviewStatus === 'RECHAZADO') counts.rejected += 1;
    else counts.pending += 1;
    return counts;
  }, { approved: 0, rejected: 0, pending: 0, total: 0 }), [filteredByCriteria]);
  const hasNarrowFilters = !!debouncedSearchTerm.trim() || !!medicoFilter || grupoFilter !== 'TODOS';
  const activeStatusLabel = ({ pendientes: 'Por revisar', elegibles: 'Aprobados', exclusiones: 'Excluidos' })[statusTab] || 'Todos';

  // Cálculos de KPIs unificados
  const kpis = useMemo(() => {
    let totalElegibles = 0;
    let totalOverridden = 0;
    const medicosSet = new Set();
    const pacientesSet = new Set();

    effectiveData.forEach(row => {
      if (row.Medico) medicosSet.add(row.Medico.trim());
      if (row.Paciente && row.TipoCalculo !== 'SAP_DOCUMENTO') pacientesSet.add(row.Paciente.trim());
      if (row._isOverridden) {
        totalOverridden += 1;
      }

      if (row._effectiveElegible) {
        totalElegibles += 1;

      }
    });

    return {
      totalElegibles,
      totalExclusiones: effectiveData.filter(row => row._reviewStatus === 'RECHAZADO').length,
      totalPendientes: effectiveData.filter(row => row._reviewStatus === 'PENDIENTE').length,
      totalOverridden,
      totalMedicos: medicosSet.size,
      totalPacientes: pacientesSet.size,
      totalGeneral: effectiveData.length,
      ...summarizeHonorarios(effectiveData)
    };
  }, [effectiveData]);

  // Agrupación por Médico para la vista de liquidación
  const groupedByMedico = useMemo(() => {
    const groups = {};
    const rowsByMedico = new Map();
    const sourceRowsByMedico = new Map();
    data.forEach(row => {
      const medicoKey = doctorGroupKey(row);
      if (!sourceRowsByMedico.has(medicoKey)) sourceRowsByMedico.set(medicoKey, []);
      sourceRowsByMedico.get(medicoKey).push(row);
    });
    filteredByCriteria.forEach(row => {
      const medicoKey = doctorGroupKey(row);
      if (!rowsByMedico.has(medicoKey)) rowsByMedico.set(medicoKey, []);
      rowsByMedico.get(medicoKey).push(row);
    });
    filteredData.forEach(row => {
      const medicoKey = doctorGroupKey(row);
      if (!groups[medicoKey]) {
        groups[medicoKey] = {
          medico: medicoKey,
          providerName: String(row.Medico || '').trim(),
          especialidad: row.Especialidad || 'Sin Especialidad',
          tipoMedico: row.TipoMedico || 'HN',
          tasaISR: row._effectiveISRRate,
          tasasISR: new Set(),
          serviciosCount: 0,
          approvedCount: 0,
          excludedCount: 0,
          pendingReviewCount: 0,
          rejectedCount: 0,
          filas: []
        };
      }
      const cant = quantityForTotals(row);
      if (row._effectiveElegible) {
          groups[medicoKey].approvedCount += 1;
      } else if (row._reviewStatus === 'RECHAZADO') {
        groups[medicoKey].excludedCount += 1;
        groups[medicoKey].rejectedCount += 1;
      } else {
        groups[medicoKey].pendingReviewCount += 1;
      }
      groups[medicoKey].serviciosCount += cant;
      if (row._effectiveISRRate !== null) groups[medicoKey].tasasISR.add(row._effectiveISRRate);
      groups[medicoKey].filas.push(row);
    });

    Object.values(groups).forEach(g => {
      // El cuerpo principal respeta la pestaña elegida; el anexo del PDF conserva
      // también los registros del médico que coinciden con los demás filtros.
      g.filasRevision = rowsByMedico.get(g.medico) || [];
      const allMatchingRows = g.filasRevision;
      g.approvedCount = allMatchingRows.filter(row => row._effectiveElegible).length;
      g.rejectedCount = allMatchingRows.filter(row => row._reviewStatus === 'RECHAZADO').length;
      g.excludedCount = g.rejectedCount;
      g.pendingReviewCount = allMatchingRows.filter(row => row._reviewStatus === 'PENDIENTE').length;
      g.serviciosCount = allMatchingRows.reduce((sum, row) => sum + quantityForTotals(row), 0);
      g.tasasISR = [...new Set(allMatchingRows.map(row => row._effectiveISRRate).filter(rate => rate !== null))].sort((a, b) => a - b);
      g.tasaISR = g.tasasISR.length === 1 ? g.tasasISR[0] : null;
      Object.assign(g, summarizeHonorarios(allMatchingRows));
      const sapProvider = sapReconciliation?.providers?.[g.providerName || g.medico] || sapReconciliation?.additionalProviders?.find(provider => provider.medico === (g.providerName || g.medico)) || null;
      g.sap = sapProvider ? { ...sapProvider, invoices: (sapProvider.invoices || []).map(invoice =>
        annotateSapInvoiceCoverage(invoice, g.providerName || g.medico, sourceRowsByMedico.get(g.medico) || [])) } : null;
      g.sapPeriod = sapReconciliation?.period;
    });

    return Object.values(groups).sort((a, b) => b.totalNeto - a.totalNeto);
  }, [filteredData, filteredByCriteria, sapReconciliation, data]);
  const expandAllVisibleRows = groupedByMedico.reduce((sum, group) => sum + Math.min(group.filas.length, HONORARIOS_PAGE_SIZE), 0);
  const allowExpandAll = expandAllVisibleRows <= 500;

  // El PDF de revisión conserva el contexto de todos los estados coincidentes.
  // El Excel usa filteredData y respeta también la pestaña activa.
  const exportGroups = useMemo(() => {
    const groups = new Map();
    const sourceRowsByMedico = new Map();
    data.forEach(row => {
      const medicoKey = doctorGroupKey(row);
      if (!sourceRowsByMedico.has(medicoKey)) sourceRowsByMedico.set(medicoKey, []);
      sourceRowsByMedico.get(medicoKey).push(row);
    });
    filteredByCriteria.forEach(row => {
      const medicoKey = doctorGroupKey(row);
      if (!groups.has(medicoKey)) groups.set(medicoKey, {
        medico: medicoKey,
        providerName: String(row.Medico || '').trim(),
        especialidad: row.Especialidad || 'Sin Especialidad',
        tipoMedico: row.TipoMedico || 'HN',
        tasasISR: new Set(),
        serviciosCount: 0,
        approvedCount: 0,
        excludedCount: 0,
        pendingReviewCount: 0,
        rejectedCount: 0,
        filas: [],
        filasRevision: []
      });
      const group = groups.get(medicoKey);
      group.filas.push(row);
      group.filasRevision.push(row);
      group.serviciosCount += quantityForTotals(row);
      if (row._effectiveElegible) group.approvedCount += 1;
      else if (row._reviewStatus === 'RECHAZADO') {
        group.rejectedCount += 1;
        group.excludedCount += 1;
      } else group.pendingReviewCount += 1;
      if (row._effectiveISRRate !== null) group.tasasISR.add(row._effectiveISRRate);
    });

    return [...groups.values()].map(group => {
      group.tasasISR = [...group.tasasISR].sort((a, b) => a - b);
      group.tasaISR = group.tasasISR.length === 1 ? group.tasasISR[0] : null;
      Object.assign(group, summarizeHonorarios(group.filasRevision));
      const sapProvider = sapReconciliation?.providers?.[group.providerName || group.medico]
        || sapReconciliation?.additionalProviders?.find(provider => provider.medico === (group.providerName || group.medico)) || null;
      group.sap = sapProvider ? { ...sapProvider, invoices: (sapProvider.invoices || []).map(invoice =>
        annotateSapInvoiceCoverage(invoice, group.providerName || group.medico, sourceRowsByMedico.get(group.medico) || [])) } : null;
      group.sapPeriod = sapReconciliation?.period;
      return group;
    }).sort((a, b) => (Number(b.totalNeto) || 0) - (Number(a.totalNeto) || 0));
  }, [filteredByCriteria, sapReconciliation, data]);

  const approvedExportGroups = exportGroups.filter(group => group.approvedCount > 0);
  const pdfExportGroups = workspace === 'approved' ? approvedExportGroups : exportGroups;
  const downloadApprovedPdf = (group, detailed = true) => generateDoctorHonorariosPdf(group, startDate, endDate, detailed, pdfGeneratedBy, true);

  const sapSummary = useMemo(() => {
    const providers = [...Object.values(sapReconciliation?.providers || {}), ...(sapReconciliation?.additionalProviders || [])];
    const invoices = providers.flatMap(provider => provider.invoices || []);
    return {
      matched: providers.filter(provider => provider.linkStatus === 'candidato_unico').length,
      ambiguous: providers.filter(provider => provider.linkStatus === 'ambiguo').length,
      unmatched: providers.filter(provider => provider.linkStatus === 'sin_coincidencia').length,
      invoiceCount: new Set(invoices.filter(invoice => !invoice.cancelled).map(invoice => String(invoice.docEntry))).size,
      paymentCount: new Set(providers.flatMap(provider => (provider.paymentsInPeriod || []).map(payment => String(payment.paymentDocEntry)))).size
    };
  }, [sapReconciliation]);

  // Exportación a Excel completa y unificada con Estilo Institucional Escandón
  const exportToExcel = async () => {
    if (!filteredData.length || searchTerm !== debouncedSearchTerm || loading || sapLoading || !reviewReady) return;

    try {
      const exportData = filteredData;
      const excelGroups = groupedByMedico.map(group => ({ ...group,
        ...summarizeHonorarios(group.filas),
        tasaISR: null,
        tasasISR: [...new Set(group.filas.map(row => row._effectiveISRRate).filter(rate => rate !== null))].sort((a, b) => a - b),
        serviciosCount: group.filas.reduce((sum, row) => sum + quantityForTotals(row), 0),
        approvedCount: group.filas.filter(row => row._effectiveElegible).length,
        excludedCount: group.filas.filter(row => row._reviewStatus === 'RECHAZADO').length,
        pendingReviewCount: group.filas.filter(row => row._reviewStatus === 'PENDIENTE').length
      }));
      const appliedFilters = [`Estado: ${activeStatusLabel}`,
        grupoFilter !== 'TODOS' && `Grupo: ${grupoFilter}`,
        medicoFilter && `Médico: ${medicoFilter}`,
        debouncedSearchTerm.trim() && `Búsqueda: ${debouncedSearchTerm.trim()}`].filter(Boolean).join(' | ');
      const periodoTexto = `Del ${formatDate(startDate)} al ${formatDate(endDate)} | ${appliedFilters}`;
      const summary = summarizeHonorarios(exportData);
      const filteredTotals = { base: summary.totalBase, iva: summary.totalIVA, isr: summary.totalISR,
        retIVA: summary.totalRetIVA, net: summary.totalNeto };

      // 1. Datos para Hoja 1: Liquidación y Auditoría Detallada
      const filasDetalle = exportData.map(row => {
        let ajusteTexto = 'Sin modificación';
        if (row._isOverridden) {
          ajusteTexto = row._overrideAction === 'APROBAR' ? 'APROBADO MANUALMENTE' : 'EXCLUIDO MANUALMENTE';
        }

        return {
          UDRKey: row.UDRKey || '',
          RenglonAuditoria: Number(row.RenglonAuditoria) || '',
          OrigenRenglon: row.OrigenRenglon || '',
          SourceLineId: row.SourceLineId || '', RolMedico: row.RolMedico || '', MedicoId: row.MedicoId || '',
          PrecioUnitarioBI: row.PrecioUnitarioBI ?? '', FechaReferenciaTipo: row.FechaReferenciaTipo || '',
          Realizacion: overrides[row._rowId]?.snapshot?.execution?.reference || row.EvidenciaEjecucion || '',
          TariffId: row.TariffSnapshot?.id || '', LiquidacionCerrada: row.LiquidacionCerrada || '',
          ConciliacionVertical: row.ModeBI ? `Auditoría: ${row.EnVistaAuditoria ? 'presente' : 'ausente'}; pago: ${row.EnVistaPago ? 'presente' : 'ausente'}` : '',
          FuenteHonorario: row.FuenteHonorario || 'Liquidación clínica',
          ObservacionCobertura: row.ObservacionCobertura || '',
          FolioAtencion: row.TipoCalculo === 'SAP_DOCUMENTO' ? 'No aplica' : row.FolioAtencion ?? (row.ModeBI ? '' : 'Sin atención vinculada'),
          FolioCita: row.TipoCalculo === 'SAP_DOCUMENTO' ? 'No aplica' : row.FolioCita ?? (row.ModeBI ? '' : 'Sin cita vinculada'),
          FechaAtencion: formatDate(row.FechaAtencion),
          Medico: row.Medico || 'NO ESPECIFICADO',
          Especialidad: row.Especialidad || 'GENERAL',
          TipoMedico: row.TipoMedico || 'HN',
          Paciente: row.Paciente || 'NO ESPECIFICADO',
          Cliente: row.Cliente || 'VENTA GENERAL',
          GrupoServicio: row.GrupoServicio || '',
          Servicio: row.Servicio || '',
          Cantidad: row.ModeBI && row.Cantidad == null ? 'Pendiente' : readQuantity(row.Cantidad),
          PrecioCobradoPaciente: row.PrecioCobradoPaciente ?? 'No disponible',
          BaseImporte: row._effectiveBase ?? 'Pendiente',
          IvaLinea: row._effectiveIVA ?? 'Pendiente',
          TasaISR: row._effectiveISRRate,
          RetencionISR: row._effectiveISR ?? 'Pendiente',
          RetencionIVA: row._effectiveRetIVA ?? 'Pendiente',
          CriterioFiscal: row._fiscalNote,
          NetoAPagar: row._effectiveNeto ?? 'Pendiente',
          FolioOrdenVenta: row.TipoCalculo === 'SAP_DOCUMENTO' ? 'No aplica' : row.FolioOrdenVenta ?? (row.ModeBI ? '' : 'Sin orden de venta'),
          Elegibilidad: reviewLabel(row), Revisor: row._reviewer || '', MonedaOrigen: row.SapDocumento?.currency || 'MXN', TotalDocumentoSAP: row.SapDocumento?.documentTotal ?? '', FacturaSAP: row.SapDocumento?.docNum || '',
          FechaDecision: row._overrideTimestamp || '',
          AjusteManual: ajusteTexto,
          Diagnostico: row._effectiveMotivo || row.MensajeAuditoria || row.MotivoExclusionOriginal || ''
        };
      });

      const columnasDetalle = [
        { header: 'Clave de registro', key: 'UDRKey', width: 22 },
        { header: 'Número de registro', key: 'RenglonAuditoria', width: 16, type: 'number' },
        { header: 'Origen del registro', key: 'OrigenRenglon', width: 20 },
        { header: 'Línea o cargo origen', key: 'SourceLineId', width: 20 },
        { header: 'Número de médico', key: 'MedicoId', width: 15 },
        { header: 'Rol médico', key: 'RolMedico', width: 18 },
        { header: 'Fecha utilizada para corte', key: 'FechaReferenciaTipo', width: 28 },
        { header: 'Honorario por servicio', key: 'PrecioUnitarioBI', width: 24, type: 'currency' },
        { header: 'Número de tarifa', key: 'TariffId', width: 16 },
        { header: 'Referencia realización', key: 'Realizacion', width: 35 },
        { header: 'Cierre', key: 'LiquidacionCerrada', width: 16 },
        { header: 'Comparación de registros del servicio', key: 'ConciliacionVertical', width: 38 },
        { header: 'Fuente del honorario', key: 'FuenteHonorario', width: 26 },
        { header: 'Atención relacionada', key: 'ObservacionCobertura', width: 50 },
        { header: 'Folio Atención (Vertical)', key: 'FolioAtencion', width: 24, align: 'center' },
        { header: 'Folio Cita (Vertical)', key: 'FolioCita', width: 22, align: 'center' },
        { header: 'Folio Orden Venta', key: 'FolioOrdenVenta', width: 22, align: 'center' },
        { header: 'Fecha', key: 'FechaAtencion', width: 13, align: 'center' },
        { header: 'Médico', key: 'Medico', width: 30 },
        { header: 'Especialidad', key: 'Especialidad', width: 22 },
        { header: 'Tipo de médico', key: 'TipoMedico', width: 16, align: 'center' },
        { header: 'Paciente', key: 'Paciente', width: 28 },
        { header: 'Cliente / Aseguradora', key: 'Cliente', width: 22 },
        { header: 'Grupo de Servicio', key: 'GrupoServicio', width: 24 },
        { header: 'Descripción del Servicio', key: 'Servicio', width: 36 },
        { header: 'Cant.', key: 'Cantidad', width: 8, type: 'number', decimals: true },
        { header: 'Precio Paciente', key: 'PrecioCobradoPaciente', width: 15, type: 'currency' },
        { header: 'Honorario antes de impuestos', key: 'BaseImporte', width: 27, type: 'currency' },
        { header: 'IVA registrado', key: 'IvaLinea', width: 15, type: 'currency' },
        { header: 'Porcentaje de ISR', key: 'TasaISR', width: 18, type: 'percent' },
        { header: 'ISR estimada', key: 'RetencionISR', width: 18, type: 'currency' },
        { header: 'Retención IVA estimada', key: 'RetencionIVA', width: 23, type: 'currency' },
        { header: 'Cómo se calculó', key: 'CriterioFiscal', width: 65 },
        { header: 'Importe final aprobado MXN', key: 'NetoAPagar', width: 27, type: 'currency' },
        { header: 'Estado del cálculo', key: 'Elegibilidad', width: 24 },
        { header: 'Revisor', key: 'Revisor', width: 32 },
        { header: 'Fecha decisión', key: 'FechaDecision', width: 26 },
        { header: 'Moneda origen', key: 'MonedaOrigen', width: 14 },
        { header: 'Factura SAP', key: 'FacturaSAP', width: 16 },
        { header: 'Total original factura', key: 'TotalDocumentoSAP', width: 23, type: 'currency' },
        { header: 'Cambio realizado', key: 'AjusteManual', width: 24 },
        { header: 'Motivo de revisión', key: 'Diagnostico', width: 45 }
      ];

      const totalesDetalle = {
        Medico: 'TOTALES GENERALES',
        Cantidad: exportData.reduce((acc, r) => acc + quantityForTotals(r), 0),
        PrecioCobradoPaciente: exportData.reduce((acc, r) => acc + (Number(r.PrecioCobradoPaciente) || 0), 0),
        BaseImporte: filteredTotals.base ?? 'Pendiente',
        IvaLinea: filteredTotals.iva ?? 'Pendiente',
        RetencionISR: filteredTotals.isr ?? 'Pendiente',
        RetencionIVA: filteredTotals.retIVA ?? 'Pendiente',
        NetoAPagar: filteredTotals.net ?? 'Pendiente'
      };

      const resumenKPIs = {
        'Honorarios antes de impuestos': formatMoney(filteredTotals.base),
        'IVA registrado': formatMoney(filteredTotals.iva),
        'Retención de ISR estimada': formatMoney(filteredTotals.isr),
        'Retención de IVA estimada': formatMoney(filteredTotals.retIVA),
        'Importe final aprobado MXN': formatMoney(filteredTotals.net),
        'Servicios con cálculo pendiente': String(summary.pendingCount),
        'Incluidos en el total aprobado': `${exportData.filter(row => row._effectiveElegible).length}`,
        'Rechazados en filtro': `${exportData.filter(row => row._reviewStatus === 'RECHAZADO').length}`,
        'Pendientes de revisión': `${exportData.filter(row => row._reviewStatus === 'PENDIENTE').length}`,
        'Cambios hechos durante la revisión': `${exportData.filter(row => row._isOverridden).length}`,
        'Total Médicos en filtro': `${excelGroups.length}`
      };

      // 2. Datos para Hoja 2: Resumen por Médico
      const filasMedicos = excelGroups.map(g => ({
        medico: g.medico,
        especialidad: g.especialidad,
        tipoMedico: g.tipoMedico,
        tasaISR: formatHonorariosRates(g),
        serviciosCount: g.serviciosCount,
        approvedCount: g.approvedCount,
        excludedCount: g.excludedCount,
        totalBase: g.totalBase ?? 'Pendiente',
        totalIVA: g.totalIVA ?? 'Pendiente',
        totalISR: g.totalISR ?? 'Pendiente',
        totalRetIVA: g.totalRetIVA ?? 'Pendiente',
        clinicalNet: g.clinicalNet ?? 'Pendiente', sapDocumentNet: g.sapDocumentNet ?? 'Pendiente',
        criterioFiscal: g.fiscalNotes.join(' '),
        totalNeto: g.totalNeto ?? 'Pendiente'
      }));

      const columnasMedicos = [
        { header: 'Médico', key: 'medico', width: 32 },
        { header: 'Especialidad', key: 'especialidad', width: 24 },
        { header: 'Tipo de médico', key: 'tipoMedico', width: 16, align: 'center' },
        { header: 'Retención de ISR estimada', key: 'tasaISR', width: 24 },
        { header: 'Servicios', key: 'serviciosCount', width: 13, type: 'number' },
        { header: 'Aprobados', key: 'approvedCount', width: 12, type: 'number' },
        { header: 'Rechazados', key: 'excludedCount', width: 12, type: 'number' },
        { header: 'Honorarios antes de impuestos', key: 'totalBase', width: 27, type: 'currency' },
        { header: 'IVA registrado', key: 'totalIVA', width: 16, type: 'currency' },
        { header: 'ISR estimada', key: 'totalISR', width: 20, type: 'currency' },
        { header: 'Retención IVA estimada', key: 'totalRetIVA', width: 23, type: 'currency' },
        { header: 'Cómo se calculó', key: 'criterioFiscal', width: 65 },
        { header: 'Importe final de atenciones aprobadas', key: 'clinicalNet', width: 34, type: 'currency' },
        { header: 'Importe final de facturas aprobadas', key: 'sapDocumentNet', width: 34, type: 'currency' },
        { header: 'Importe final aprobado MXN', key: 'totalNeto', width: 27, type: 'currency' }
      ];

      const totalesMedicos = {
        medico: 'TOTAL CONCENTRADO',
        serviciosCount: excelGroups.reduce((acc, g) => acc + g.serviciosCount, 0),
        approvedCount: excelGroups.reduce((acc, g) => acc + g.approvedCount, 0),
        excludedCount: excelGroups.reduce((acc, g) => acc + g.excludedCount, 0),
        totalBase: filteredTotals.base ?? 'Pendiente',
        totalIVA: filteredTotals.iva ?? 'Pendiente',
        totalISR: filteredTotals.isr ?? 'Pendiente',
        totalRetIVA: filteredTotals.retIVA ?? 'Pendiente',
        clinicalNet: summary.clinicalNet ?? 'Pendiente', sapDocumentNet: summary.sapDocumentNet ?? 'Pendiente',
        totalNeto: filteredTotals.net ?? 'Pendiente'
      };

      const filasSAP = excelGroups.flatMap(grupo => {
        const provider = grupo.sap;
        const base = { medicoKH: grupo.medico };
        if (!provider) return [{ ...base, estadoVinculo: sapLoading ? 'Consultando facturas' : (sapError || 'Sin información de facturas') }];
        const candidates = provider.candidates || [];
        const candidateLabel = candidates.map(item => item.cardName).join(' / ');
        if (['candidato_unico', 'solo_sap'].includes(provider.linkStatus)) {
          base.rfcSAP = candidates[0]?.federalTaxId || 'No registrado';
          base.grupoSAP = candidates[0]?.groupName || 'No registrado';
          base.regimenFiscalSAP = candidates[0]?.fiscalRegime || 'No registrado';
          base.vigenciaFiscal = 'Pendiente de comprobar';
          base.retencionesConfiguradasSAP = formatConfiguredWithholdings(candidates[0]);
        }
        if (!['candidato_unico', 'solo_sap'].includes(provider.linkStatus)) {
          return [{ ...base, estadoVinculo: provider.linkStatus === 'ambiguo' ? 'Hay varios proveedores posibles' : 'No se encontró al proveedor', proveedorCandidato: candidateLabel, observacion: 'No se asignaron facturas porque no se pudo confirmar el proveedor.' }];
        }
        if (!provider.invoices?.length && !provider.paymentsInPeriod?.length) {
          return [{ ...base, estadoVinculo: grupo.accountingOnly ? 'Factura sin atención relacionada' : 'Proveedor encontrado por nombre; confirmar que sea el correcto', proveedorCandidato: candidateLabel, observacion: 'No se encontraron facturas en estas fechas.' }];
        }
        const invoiceRows = (provider.invoices || []).map(invoice => ({
          ...base,
          tipoRegistro: 'Factura de proveedor',
          estadoVinculo: grupo.accountingOnly ? 'Factura sin atención relacionada' : 'Proveedor encontrado por nombre; confirmar que sea el correcto',
          proveedorCandidato: invoice.cardName,
          invoiceDocEntry: invoice.docEntry,
          sapDocEntry: invoice.docEntry,
          sapDocNum: invoice.docNum,
          referenciaProveedor: invoice.supplierReference,
          uuidCFDISAP: invoice.cfdiUuid || 'No disponible',
          fechaFiscalSAP: formatDate(invoice.taxDate),
          fechaContabilizacion: formatDate(invoice.postingDate),
          moneda: invoice.currency,
          totalDocumento: invoice.documentTotal,
          ivaRegistradoSAP: invoice.vatRecorded,
          retencionesPorCodigo: (invoice.retentions || []).map(item => `${item.description || 'Impuesto sin nombre'}: importe ${item.amount === null ? 'No disponible' : `${item.amount.toFixed(2)} ${invoice.currency}`}; importe considerado ${item.taxableBase === null ? 'No disponible' : `${item.taxableBase.toFixed(2)} ${invoice.currency}`}; porcentaje ${item.rate === null ? 'No disponible' : item.rate}`).join(' | '),
          pagadoAcumuladoSAP: invoice.paidToDate,
          saldoSAP: invoice.openBalance,
          pagosAplicadosEnRango: (invoice.paymentsInPeriod || []).map(payment => `${formatDate(payment.paymentDate)} - SAP ${payment.paymentDocNum}: ${payment.amount.toFixed(2)} ${payment.currency}`).join(' | '),
          cancelada: invoice.cancelled ? 'Sí' : 'No',
          conceptosSAP: (invoice.lines || []).map(line => `${line.description} | cantidad ${line.quantity ?? 'No disponible'} | importe ${line.recordedAmount ?? 'No disponible'} ${invoice.currency}`).join(' / '),
          observacion: invoice.comments || 'Sin observaciones registradas en SAP.'
        }));
        const invoiceEntries = new Set((provider.invoices || []).map(invoice => String(invoice.docEntry)));
        const paymentRows = (provider.paymentsInPeriod || [])
          .filter(payment => !invoiceEntries.has(String(payment.invoiceDocEntry)))
          .map(payment => ({
            ...base,
          tipoRegistro: 'Pago de una factura anterior',
            estadoVinculo: grupo.accountingOnly ? 'Factura sin atención relacionada' : 'Proveedor encontrado por nombre; confirmar que sea el correcto',
            proveedorCandidato: candidateLabel,
            invoiceDocEntry: payment.invoiceDocEntry,
            pagoSAPDocNum: payment.paymentDocNum,
            fechaPagoSAP: formatDate(payment.paymentDate),
            importePagoAplicado: payment.amount,
            moneda: payment.currency,
            observacion: `Pago relacionado con esta factura según el registro de SAP; moneda: ${payment.currencyBasis}.`
          }));
        return [...invoiceRows, ...paymentRows];
      });

      const columnasSAP = [
        { header: 'Médico', key: 'medicoKH', width: 30 },
        { header: 'Tipo de registro', key: 'tipoRegistro', width: 34 },
        { header: 'Relación con el médico', key: 'estadoVinculo', width: 42 },
        { header: 'Proveedor encontrado en SAP', key: 'proveedorCandidato', width: 34 },
        { header: 'RFC registrado en SAP', key: 'rfcSAP', width: 20 },
        { header: 'Grupo del proveedor', key: 'grupoSAP', width: 22 },
        { header: 'Régimen fiscal registrado', key: 'regimenFiscalSAP', width: 24 },
        { header: 'Datos fiscales vigentes', key: 'vigenciaFiscal', width: 26 },
        { header: 'Impuestos que SAP indica que se retienen', key: 'retencionesConfiguradasSAP', width: 60 },
        { header: 'Número interno de factura relacionada', key: 'invoiceDocEntry', width: 34, type: 'number' },
        { header: 'Número interno SAP', key: 'sapDocEntry', width: 22, type: 'number' },
        { header: 'Número de factura', key: 'sapDocNum', width: 18, type: 'number' },
        { header: 'Número de pago', key: 'pagoSAPDocNum', width: 16, type: 'number' },
        { header: 'Fecha de pago', key: 'fechaPagoSAP', width: 15 },
        { header: 'Importe aplicado', key: 'importePagoAplicado', width: 16, type: 'number', decimals: true },
        { header: 'Referencia proveedor', key: 'referenciaProveedor', width: 20 },
        { header: 'UUID de la factura', key: 'uuidCFDISAP', width: 40 },
        { header: 'Fecha de la factura', key: 'fechaFiscalSAP', width: 15 },
        { header: 'Fecha de registro', key: 'fechaContabilizacion', width: 17 },
        { header: 'Moneda', key: 'moneda', width: 10 },
        { header: 'Total de la factura', key: 'totalDocumento', width: 17, type: 'number', decimals: true },
        { header: 'IVA de la factura', key: 'ivaRegistradoSAP', width: 17, type: 'number', decimals: true },
        { header: 'Impuestos retenidos en la factura', key: 'retencionesPorCodigo', width: 48 },
        { header: 'Pagado a la fecha', key: 'pagadoAcumuladoSAP', width: 18, type: 'number', decimals: true },
        { header: 'Saldo pendiente', key: 'saldoSAP', width: 15, type: 'number', decimals: true },
        { header: 'Pagos durante el periodo', key: 'pagosAplicadosEnRango', width: 38 },
        { header: 'Cancelada', key: 'cancelada', width: 12 },
        { header: 'Conceptos de la factura', key: 'conceptosSAP', width: 65 },
        { header: 'Observación', key: 'observacion', width: 48 }
      ];

      const filename = `Resumen_Honorarios_Escandon_${startDate}_a_${endDate}_todos.xlsx`;

      await downloadInstitutionalExcel({
        filename,
        sheets: [
          {
            name: 'Resumen y revisión',
            titulo: 'HOSPITAL ESCANDÓN - HONORARIOS MÉDICOS',
            subtitulo: 'Solo los registros aprobados se suman. Atenciones: honorario + IVA - ISR - retención de IVA. Facturas: se usa el importe que aparece en SAP sin volver a descontar impuestos. Un cálculo pendiente significa que falta información; no es $0.',
            periodo: periodoTexto,
            resumen: resumenKPIs,
            columnas: columnasDetalle,
            filas: filasDetalle,
            totales: totalesDetalle
          },
          {
            name: 'Resumen por Médico',
            titulo: 'HOSPITAL ESCANDÓN - RESUMEN DE HONORARIOS POR MÉDICO',
            subtitulo: 'El importe final suma las atenciones y facturas aprobadas. Los impuestos del resumen corresponden a las atenciones. Revisa que una factura no incluya un servicio ya registrado como atención.',
            periodo: periodoTexto,
            resumen: resumenKPIs,
            columnas: columnasMedicos,
            filas: filasMedicos,
            totales: totalesMedicos
          },
          {
            name: 'Facturas en SAP',
            titulo: 'HOSPITAL ESCANDÓN - FACTURAS CONSULTADAS',
            subtitulo: 'Los importes se muestran por moneda. El nombre es una referencia y no confirma por sí solo que la factura corresponda al médico o que ya se haya pagado.',
            periodo: `Servicios: ${periodoTexto}. Se consultan facturas hasta ${formatDate(sapReconciliation?.period?.endDate || endDate)}.`,
            resumen: { ...resumenKPIs, 'Datos consultados el': sapReconciliation?.asOf || 'No disponible' },
            columnas: columnasSAP,
            filas: filasSAP
          }
        ]
      });
    } catch (err) {
      console.error('Error al exportar Excel institucional:', err);
      alert(userMessage('Ocurrió un error al generar el archivo Excel institucional: ' + err.message));
    }
  };

  const handleOpenDetail = (row) => {
    setSelectedRow(row);
    setModalOpen(true);
  };

  const selectedServiceCount = effectiveData.filter(row => selectedServices[row._rowId] && canSelectService(row)).length;
  const configuredRows = filteredData.filter(canSelectService);
  const selectionAvailable = reviewReady && canReview && !reviewSaving;

  return (
    <div className="hon-page-container">
      {/* ── Estilos Scoped con Soporte Completo para Modo Oscuro y Modo Claro ── */}
      <style>{`
        .hon-page-container {
          padding: 1.5rem 2rem;
          max-width: 1600px;
          margin: 0 auto;
          font-family: var(--font-body, 'Inter', system-ui, sans-serif);
          color: var(--text-primary, #0f172a);
        }

        /* ── Tarjetas y Paneles ── */
        .hon-card {
          background: var(--surface-raised, #ffffff);
          border: 1px solid var(--table-border, #e2e8f0);
          border-radius: 16px;
          box-shadow: var(--shadow-sm, 0 4px 6px -1px rgba(0,0,0,0.05));
          transition: background 0.3s ease, border-color 0.3s ease;
        }

        .hon-summary-grid {
          display: grid;
          grid-template-columns: minmax(250px, 0.9fr) minmax(360px, 1.6fr);
          gap: 0.75rem;
          margin-bottom: 0.85rem;
        }
        .hon-summary-breakdown {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          align-items: center;
          gap: 0.5rem;
        }
        .hon-optional-details summary { list-style-position: inside; }
        .hon-optional-details summary:hover { color: #0369a1 !important; }

        @media (max-width: 860px) {
          .hon-page-container { padding: 1rem; }
          .hon-summary-grid { grid-template-columns: minmax(0, 1fr); }
          .hon-summary-breakdown { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 520px) {
          .hon-page-container { padding: 0.75rem; }
          .hon-summary-breakdown { grid-template-columns: minmax(0, 1fr); }
        }

        /* ── Controles e Inputs ── */
        .hon-input, .hon-select {
          width: 100%;
          box-sizing: border-box;
          padding: 0.65rem 0.9rem;
          border-radius: 8px;
          border: 1px solid var(--table-border, #cbd5e1);
          font-size: 0.95rem;
          outline: none;
          background: var(--surface-raised, #ffffff);
          color: var(--text-primary, #0f172a);
          transition: border-color 0.2s, background-color 0.3s;
        }
        .hon-input:focus, .hon-select:focus {
          border-color: #0088C9;
          box-shadow: 0 0 0 3px rgba(0, 136, 201, 0.15);
        }

        /* ── Píldoras de Estado (Aprobados / Exclusiones / Todos) ── */
        .hon-status-tabs-container {
          display: flex;
          gap: 0.4rem;
          background: var(--surface-1, #f1f5f9);
          padding: 0.35rem;
          border-radius: 12px;
          border: 1px solid var(--table-border, transparent);
        }
        .hon-status-btn {
          padding: 0.5rem 1rem;
          border-radius: 8px;
          border: none;
          font-weight: 700;
          font-size: 0.85rem;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 0.35rem;
          transition: all 0.2s ease;
          background: transparent;
          color: var(--text-muted, #64748b);
        }
        .hon-status-btn:hover {
          color: var(--text-primary, #0f172a);
        }
        .hon-status-btn.active-elegibles {
          background: #059669;
          color: #ffffff !important;
          box-shadow: 0 2px 8px rgba(5, 150, 105, 0.35);
        }
        .hon-status-btn.active-exclusiones {
          background: #d97706;
          color: #ffffff !important;
          box-shadow: 0 2px 8px rgba(217, 119, 6, 0.35);
        }
        .hon-status-btn.active-todos {
          background: #004687;
          color: #ffffff !important;
          box-shadow: 0 2px 8px rgba(0, 70, 135, 0.35);
        }

        /* ── Selector de Modo de Vista (Por Médico / Detallada / Matriz) ── */
        .hon-view-switcher {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          background: var(--surface-1, #e2e8f0);
          padding: 0.35rem;
          border-radius: 12px;
          border: 1px solid var(--table-border, transparent);
        }
        .hon-view-switcher-label {
          font-size: 0.75rem;
          font-weight: 800;
          color: var(--text-muted, #475569);
          padding: 0 0.5rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .hon-view-btn {
          padding: 0.45rem 0.85rem;
          border-radius: 8px;
          border: none;
          font-weight: 700;
          font-size: 0.85rem;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 0.35rem;
          transition: all 0.2s ease;
          background: transparent;
          color: var(--text-secondary, #334155);
        }
        .hon-view-btn:hover {
          background: rgba(0, 0, 0, 0.04);
          color: var(--text-primary, #0f172a);
        }
        .hon-view-btn.active {
          background: #004687;
          color: #ffffff !important;
          box-shadow: 0 2px 8px rgba(0, 70, 135, 0.3);
        }

        /* ── Tarjetas de Médicos / Acordeón ── */
        .hon-doc-item {
          border: 1px solid var(--table-border, #e2e8f0);
          border-radius: 12px;
          overflow: hidden;
          background: var(--surface-raised, #ffffff);
          transition: all 0.2s ease;
        }
        .hon-doc-item.expanded {
          border-color: #0284c7;
          box-shadow: 0 4px 14px rgba(2, 132, 199, 0.15);
        }
        .hon-doc-header {
          background: var(--surface-1, #f8fafc);
          padding: 1.1rem 1.5rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
          cursor: pointer;
          flex-wrap: wrap;
          gap: 1rem;
          transition: background 0.2s ease;
        }
        .hon-doc-item.expanded .hon-doc-header {
          background: rgba(2, 132, 199, 0.06);
        }

        /* ── Tablas ── */
        .hon-table-wrapper {
          overflow-x: auto;
          overflow-y: auto;
          max-height: 500px;
          background: var(--surface-raised, #ffffff);
        }
        .hon-table {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          text-align: left;
        }
        .hon-thead th {
          background: var(--surface-1, #f8fafc);
          border-bottom: 2px solid var(--table-border, #e2e8f0);
          color: var(--text-muted, #475569);
          font-size: 0.78rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          position: sticky;
          top: 0;
          z-index: 10;
        }
        .hon-tbody tr {
          border-bottom: 1px solid var(--table-border, #f1f5f9);
          transition: background-color 0.15s ease;
        }
        .hon-tbody tr:hover {
          background-color: var(--table-row-hover-bg, rgba(2, 132, 199, 0.05)) !important;
        }

        /* ── Botones de Acción de Auditoría ── */
        .hon-btn-override-approve {
          background: rgba(16, 185, 129, 0.12);
          color: #059669;
          border: 1px solid rgba(16, 185, 129, 0.3);
          border-radius: 6px;
          padding: 0.35rem 0.65rem;
          font-weight: 700;
          font-size: 0.78rem;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
          transition: all 0.2s;
        }
        .hon-btn-override-approve:hover {
          background: #059669;
          color: #ffffff !important;
          border-color: #059669;
        }

        .hon-btn-override-exclude {
          background: rgba(239, 68, 68, 0.12);
          color: #dc2626;
          border: 1px solid rgba(239, 68, 68, 0.3);
          border-radius: 6px;
          padding: 0.35rem 0.65rem;
          font-weight: 700;
          font-size: 0.78rem;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
          transition: all 0.2s;
        }
        .hon-btn-override-exclude:hover {
          background: #dc2626;
          color: #ffffff !important;
          border-color: #dc2626;
        }

        .hon-btn-override-restore {
          background: rgba(100, 116, 139, 0.12);
          color: #475569;
          border: 1px solid rgba(100, 116, 139, 0.3);
          border-radius: 6px;
          padding: 0.35rem 0.65rem;
          font-weight: 700;
          font-size: 0.78rem;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
          transition: all 0.2s;
        }
        .hon-btn-override-restore:hover {
          background: #475569;
          color: #ffffff !important;
        }

        /* ── Chips para motivos sugeridos ── */
        .hon-reason-chip {
          background: var(--surface-1, #f1f5f9);
          border: 1px solid var(--table-border, #cbd5e1);
          color: var(--text-secondary, #334155);
          border-radius: 20px;
          padding: 0.3rem 0.75rem;
          font-size: 0.78rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
        }
        .hon-reason-chip:hover {
          background: #0088C9;
          color: #ffffff;
          border-color: #0088C9;
        }

        /* ══════════════════════════════════════════════════════════════════
           MODO OSCURO ([data-theme="dark"])
           ══════════════════════════════════════════════════════════════════ */
        [data-theme="dark"] .hon-card {
          background: #0F172A !important;
          border: 1px solid rgba(255, 255, 255, 0.08) !important;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4) !important;
        }

        [data-theme="dark"] .hon-input,
        [data-theme="dark"] .hon-select {
          background: #1E293B !important;
          border: 1px solid rgba(255, 255, 255, 0.12) !important;
          color: #F1F5F9 !important;
        }
        [data-theme="dark"] .hon-input::placeholder {
          color: #64748B !important;
        }

        [data-theme="dark"] .hon-status-tabs-container {
          background: #1E293B !important;
          border: 1px solid rgba(255, 255, 255, 0.08) !important;
        }
        [data-theme="dark"] .hon-status-btn {
          color: #94A3B8 !important;
        }
        [data-theme="dark"] .hon-status-btn:hover {
          color: #F1F5F9 !important;
        }
        [data-theme="dark"] .hon-status-btn.active-elegibles {
          background: #059669 !important;
          color: #FFFFFF !important;
          box-shadow: 0 0 14px rgba(16, 185, 129, 0.4) !important;
        }
        [data-theme="dark"] .hon-status-btn.active-exclusiones {
          background: #D97706 !important;
          color: #FFFFFF !important;
          box-shadow: 0 0 14px rgba(217, 119, 6, 0.4) !important;
        }
        [data-theme="dark"] .hon-status-btn.active-todos {
          background: #0284C7 !important;
          color: #FFFFFF !important;
          box-shadow: 0 0 14px rgba(2, 132, 199, 0.4) !important;
        }

        [data-theme="dark"] .hon-view-switcher {
          background: #1E293B !important;
          border: 1px solid rgba(255, 255, 255, 0.08) !important;
        }
        [data-theme="dark"] .hon-view-switcher-label {
          color: #94A3B8 !important;
        }
        [data-theme="dark"] .hon-view-btn {
          color: #94A3B8 !important;
        }
        [data-theme="dark"] .hon-view-btn:hover {
          background: rgba(255, 255, 255, 0.06) !important;
          color: #F1F5F9 !important;
        }
        [data-theme="dark"] .hon-view-btn.active {
          background: #0284C7 !important;
          color: #FFFFFF !important;
          box-shadow: 0 0 12px rgba(2, 132, 199, 0.4) !important;
        }

        [data-theme="dark"] .hon-doc-item {
          background: #0F172A !important;
          border: 1px solid rgba(255, 255, 255, 0.08) !important;
        }
        [data-theme="dark"] .hon-doc-item.expanded {
          border-color: #38BDF8 !important;
          box-shadow: 0 0 16px rgba(56, 189, 248, 0.15) !important;
        }
        [data-theme="dark"] .hon-doc-header {
          background: #1E293B !important;
        }
        [data-theme="dark"] .hon-doc-item.expanded .hon-doc-header {
          background: rgba(2, 132, 199, 0.18) !important;
        }

        [data-theme="dark"] .hon-table-wrapper {
          background: #0F172A !important;
        }
        [data-theme="dark"] .hon-thead th {
          background: #1E293B !important;
          border-bottom: 2px solid rgba(255, 255, 255, 0.08) !important;
          color: #94A3B8 !important;
        }
        [data-theme="dark"] .hon-tbody tr {
          border-bottom: 1px solid rgba(255, 255, 255, 0.04) !important;
        }
        [data-theme="dark"] .hon-tbody tr:hover {
          background-color: rgba(2, 132, 199, 0.15) !important;
        }

        [data-theme="dark"] .hon-badge-specialty {
          background: rgba(99, 102, 241, 0.2) !important;
          color: #A5B4FC !important;
          border: 1px solid rgba(165, 180, 252, 0.3) !important;
        }
        [data-theme="dark"] .hon-badge-group {
          background: rgba(2, 132, 199, 0.2) !important;
          color: #7DD3FC !important;
          border: 1px solid rgba(125, 211, 252, 0.3) !important;
        }
        [data-theme="dark"] .hon-badge-approved {
          background: rgba(16, 185, 129, 0.2) !important;
          color: #6EE7B7 !important;
          border: 1px solid rgba(110, 231, 183, 0.3) !important;
        }
        [data-theme="dark"] .hon-badge-excluded {
          background: rgba(239, 68, 68, 0.2) !important;
          color: #FCA5A5 !important;
          border: 1px solid rgba(252, 165, 165, 0.3) !important;
        }
        [data-theme="dark"] .hon-badge-pending {
          background: rgba(245, 158, 11, 0.2) !important;
          color: #FCD34D !important;
          border: 1px solid rgba(252, 211, 77, 0.3) !important;
        }
        [data-theme="dark"] .hon-badge-manual {
          background: rgba(139, 92, 246, 0.25) !important;
          color: #C4B5FD !important;
          border: 1px solid rgba(167, 139, 250, 0.4) !important;
        }

        [data-theme="dark"] .hon-modal-content {
          background: #0F172A !important;
          border: 1px solid rgba(255, 255, 255, 0.15) !important;
        }
        [data-theme="dark"] .hon-modal-block-neutral {
          background: #1E293B !important;
          border: 1px solid rgba(255, 255, 255, 0.08) !important;
        }
        [data-theme="dark"] .hon-modal-block-patient {
          background: rgba(2, 132, 199, 0.12) !important;
          border: 1px solid rgba(56, 189, 248, 0.25) !important;
        }
        [data-theme="dark"] .hon-modal-block-service {
          background: rgba(16, 185, 129, 0.12) !important;
          border: 1px solid rgba(52, 211, 153, 0.25) !important;
        }
        [data-theme="dark"] .hon-modal-block-audit-ok {
          background: #1E293B !important;
          border: 1px solid rgba(255, 255, 255, 0.08) !important;
        }
        [data-theme="dark"] .hon-modal-block-audit-bad {
          background: rgba(220, 38, 38, 0.15) !important;
          border: 1px solid rgba(248, 113, 113, 0.3) !important;
        }
        [data-theme="dark"] .hon-reason-chip {
          background: #1E293B !important;
          border: 1px solid rgba(255, 255, 255, 0.12) !important;
          color: #CBD5E1 !important;
        }
        [data-theme="dark"] .hon-reason-chip:hover {
          background: #0284C7 !important;
          color: #FFFFFF !important;
        }
      `}</style>
      
      <HonorariosHeader workspace={workspace} onWorkspaceChange={changeWorkspace}
        canExport={pdfExportGroups.length > 0 && !loading && !sapLoading && reviewReady && searchTerm === debouncedSearchTerm}
        canExportExcel={filteredData.length > 0 && !loading && !sapLoading && reviewReady && searchTerm === debouncedSearchTerm}
        onExportSummary={() => generateAllDoctorsHonorariosPdf(pdfExportGroups, startDate, endDate, false, pdfGeneratedBy, workspace === 'approved')}
        onExportDetail={() => generateAllDoctorsHonorariosPdf(pdfExportGroups, startDate, endDate, true, pdfGeneratedBy, workspace === 'approved')}
        onExportExcel={exportToExcel} />
      {['catalog', 'fiscal', 'monthly-fixed'].includes(workspace) && <div className="hon-friendly-actions" style={{ marginBottom: '1rem' }}>
        <button type="button" className="hon-friendly-button" aria-pressed={workspace === 'fiscal'} onClick={() => { setFiscalProviderId(''); changeWorkspace('fiscal'); }}>Datos fiscales</button>
        <button type="button" className="hon-friendly-button" aria-pressed={workspace === 'catalog'} onClick={() => changeWorkspace('catalog')}>Catálogo y precios</button>
        <button type="button" className="hon-friendly-button" aria-pressed={workspace === 'monthly-fixed'} onClick={() => changeWorkspace('monthly-fixed')}>Jefes de área</button>
      </div>}
      {workspace === 'audit' && <HonorariosVerticalAuditPanel />}
      {workspace === 'monthly-fixed' && <HonorariosMonthlyFixedPanel canManage={canManage} referenceMonth={startDate.slice(0, 7)} onChanged={onCatalogChanged} />}
      {fiscalError && <p role="alert" className="hon-friendly-message error">No se pudieron consultar las fichas fiscales internas. {fiscalError} <button type="button" onClick={loadFiscalProfiles}>Reintentar</button></p>}
      {workspace === 'fiscal' && <HonorariosFiscalPanel key={fiscalProviderId} providers={providers} profiles={fiscalProfiles} initialProviderId={fiscalProviderId} referenceDate={startDate} canManage={canManage}
        onSaved={profile => { setFiscalProfiles(previous => ({ ...previous, [profile.providerId]: profile })); setFiscalError(''); }}
        onBack={paymentProviderId ? () => setWorkspace('liquidations') : undefined} />}
      {catalogVisited && <div hidden={workspace !== 'catalog'}><HonorariosCatalogPanel canManage={canManage} onChanged={onCatalogChanged} onReviewServices={reviewCatalogService} /></div>}
      {workspace === 'liquidations' && <HonorariosLiquidationsPanel canManage={canManage} startDate={startDate} endDate={endDate} initialProviderId={paymentProviderId}
        onViewApproved={() => changeWorkspace('approved')} onEditFiscal={id => { setFiscalProviderId(String(id || '')); setWorkspace('fiscal'); }}
        onDownloadApproved={paymentProviderId && approvedExportGroups.find(group => String(group.filasRevision[0]?.MedicoId) === paymentProviderId)
          ? () => downloadApprovedPdf(approvedExportGroups.find(group => String(group.filasRevision[0]?.MedicoId) === paymentProviderId)) : null}
        onChanged={() => { if (hasSearched) fetchReport(); }} />}
      <div style={{ display: ['review', 'approved'].includes(workspace) ? 'block' : 'none' }}>
        <HonorariosPeriod startDate={startDate} endDate={endDate} loading={loading}
          onStartDateChange={value => { setStartDate(value); setData([]); setSapReconciliation(null); setHasSearched(false); setSelectedServices({}); }}
          onEndDateChange={value => { setEndDate(value); setData([]); setSapReconciliation(null); setHasSearched(false); setSelectedServices({}); }}
          onSearch={fetchReport} coverage={coverage} error={error} />

        {hasSearched && sapError && <div role="alert" className="hon-sap-notice">
          No se pudieron consultar las facturas y los impuestos. Puedes revisar los servicios; los importes que dependen de esa información quedan pendientes. Vuelve a buscar para intentar de nuevo.
        </div>}

        {hasSearched && !loading && effectiveData.length > 0 && <>
          <HonorariosSummary approvedView={workspace === 'approved'} kpis={kpis} loading={sapLoading} reviewReady={reviewReady} formatMoney={formatMoney} />
          <HonorariosResultsToolbar approvedView={workspace === 'approved'} onViewApproved={() => changeWorkspace('approved')} kpis={kpis} statusTab={statusTab} onStatusChange={status => { if (status === 'elegibles') changeWorkspace('approved'); else setStatusTab(status); }}
            searchTerm={searchTerm} onSearchChange={setSearchTerm} searchUpdating={searchTerm !== debouncedSearchTerm}
            medicoFilter={medicoFilter} onMedicoChange={setMedicoFilter} uniqueMedicos={uniqueMedicos}
            grupoFilter={grupoFilter} onGrupoChange={setGrupoFilter} uniqueGrupos={uniqueGrupos}
            viewMode={viewMode} onViewChange={setViewMode} allowExpandAll={allowExpandAll}
            onExpandAll={expandAllMedicos} onCollapseAll={collapseAllMedicos}
            canSelect={selectionAvailable} configuredCount={configuredRows.length}
            onSelectConfigured={() => selectRows(filteredData)}
            selectedCount={selectedServiceCount} onApproveSelection={() => openBulk('APROBAR')}
            onExcludeSelection={() => openBulk('EXCLUIR')} onClearSelection={() => setSelectedServices({})}
            bulkMessage={bulkMessage} resultsCount={filteredData.length} />
        </>}
        {reviewError && <div role="alert" className="hon-card" style={{ padding: 16, color: '#b91c1c', marginBottom: '1rem' }}>{userMessage(reviewError)}
          {!reviewReady && <button type="button" className="hon-friendly-button" style={{ marginLeft: 12 }}
            disabled={loading} onClick={fetchReport}>Reintentar consulta</button>}
        </div>}
        {workspace !== 'approved' && hasSearched && !loading && hasNarrowFilters && statusTab !== 'todos' && matchingReviewCounts.total > 0 && (
          <div className="hon-card" style={{ padding: '0.85rem 1rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', borderLeft: '3px solid #0088C9' }}>
            <div style={{ color: 'var(--text-secondary, #475569)', fontSize: '0.84rem' }}>
              La lista muestra <strong>{activeStatusLabel.toLowerCase()}</strong>. Estos filtros también encuentran
              {' '}{matchingReviewCounts.approved.toLocaleString()} aprobados, {matchingReviewCounts.rejected.toLocaleString()} excluidos y {matchingReviewCounts.pending.toLocaleString()} por revisar.
            </div>
            <button type="button" onClick={() => setStatusTab('todos')} className="hon-friendly-button subtle">Ver todos ({matchingReviewCounts.total.toLocaleString()})</button>
          </div>
        )}

      {/* 5. Área Principal de Contenido */}
      <div className="hon-card" style={{ overflow: 'hidden' }}>
        
        {/* Loader */}
        {loading && (
          <div style={{ padding: '4.5rem 2rem', textAlign: 'center' }}>
            <div style={{
              width: 50, height: 50, margin: '0 auto 1.25rem',
              border: '4px solid var(--table-border, #e2e8f0)', borderTopColor: '#0088C9',
              borderRadius: '50%', animation: 'spin 0.8s linear infinite'
            }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <h3 style={{ fontWeight: '700', margin: '0 0 0.5rem 0' }}>Buscando servicios...</h3>
            <p style={{ color: 'var(--text-muted, #64748b)', fontSize: '0.9rem', margin: 0 }}>
              Buscando médicos para el reporte y sus revisiones guardadas.
            </p>
          </div>
        )}

        {/* Estado Inicial */}
        {!hasSearched && !loading && (
          <div style={{ padding: '5rem 2rem', textAlign: 'center', color: 'var(--text-muted, #64748b)' }}>
            <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>📋</div>
            <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.3rem', color: 'var(--text-primary)' }}>
              Elige el periodo que quieres revisar
            </h3>
            <p style={{ maxWidth: '600px', margin: '0 auto', fontSize: '0.95rem' }}>
              Selecciona las fechas y pulsa <strong>Buscar servicios</strong>. Verás las atenciones de los servicios aprobados en el catálogo, con la tarifa que corresponde a cada médico.
            </p>
          </div>
        )}

        {/* Estado Vacío */}
        {hasSearched && !loading && reviewReady && filteredData.length === 0 && (
          <div style={{ padding: '4rem 2rem', textAlign: 'center', color: 'var(--text-muted, #64748b)' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📭</div>
            <h3 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-primary)' }}>No se encontraron registros</h3>
            <p style={{ fontSize: '0.95rem', margin: 0 }}>
              {effectiveData.length === 0 ? 'Para aparecer aquí, el servicio debe estar en Aprobados del catálogo y tener una tarifa que corresponda al médico y a la fecha de la atención.' : statusTab === 'pendientes'
                ? 'No hay registros pendientes por revisar con estos filtros. Puedes consultar los aprobados o ver todo el historial.'
                : 'No hay servicios aprobados del catálogo que coincidan con estos filtros en el periodo.'}
            </p>
            {statusTab === 'pendientes' && !bulkMessage && matchingReviewCounts.approved > 0 && <button type="button" className="hon-friendly-button primary" style={{ margin: '.75rem' }} onClick={() => changeWorkspace('approved')}>Ir a Pagos y PDF</button>}
            {statusTab === 'pendientes' && <button onClick={() => setStatusTab('todos')} style={{ marginTop: '0.75rem', padding: '0.55rem 0.9rem', borderRadius: '8px', border: '1px solid #93c5fd', background: '#eff6ff', color: '#1d4ed8', fontWeight: '700', cursor: 'pointer' }}>Ver todo el historial</button>}
            {effectiveData.length === 0 && <button type="button" className="hon-friendly-button primary" style={{ margin: '.75rem' }}
              onClick={() => setWorkspace('catalog')}>Configurar servicios y tarifas</button>}
          </div>
        )}

        {/* ========================================================================= */}
        {/* VISTA 1: AGRUPADA POR MÉDICO (MODO LIQUIDACIÓN) */}
        {/* ========================================================================= */}
        {!loading && hasSearched && filteredData.length > 0 && viewMode === 'medicos' && (
          <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            
            <p className="hon-review-next-step">{workspace === 'approved' ? <>Aquí están los servicios aprobados. Pulsa <strong>Preparar pago y PDF</strong> junto al médico. Para consultar la lista, pulsa <strong>Ver servicios</strong>.</> : <>Busca al médico y pulsa <strong>Aprobar pendientes</strong>. Elige el IVA y guarda. Si necesitas revisar o elegir solo algunos servicios, abre <strong>Ver servicios</strong>.</>}</p>

            {groupedByMedico.map((grupo) => {
              const isExpanded = !!expandedMedicos[grupo.medico];
              const pendingDoctorRows = grupo.filas.filter(row => canSelectService(row) && row._reviewStatus === 'PENDIENTE');
              const selectedDoctorRows = grupo.filas.filter(row => canSelectService(row) && selectedServices[row._rowId]);
              const doctorPageCount = Math.max(1, Math.ceil(grupo.filas.length / HONORARIOS_PAGE_SIZE));
              const activeDoctorPage = Math.min(doctorPages[grupo.medico] || 0, doctorPageCount - 1);
              const visibleDoctorRows = grupo.filas.slice(activeDoctorPage * HONORARIOS_PAGE_SIZE,
                (activeDoctorPage + 1) * HONORARIOS_PAGE_SIZE);
              const sapDoctor = grupo.sap;
              const sapLinkLabel = sapDoctor?.linkStatus === 'solo_sap'
                ? 'Hay facturas en SAP, pero no están relacionadas con estas atenciones'
                : sapDoctor?.linkStatus === 'candidato_unico'
                ? 'Proveedor encontrado por nombre; confirma que sea el correcto'
                : sapDoctor?.linkStatus === 'ambiguo'
                  ? 'Hay más de un proveedor posible'
                  : sapDoctor?.linkStatus === 'sin_coincidencia'
                    ? 'No se encontró al médico en SAP'
                    : 'Consulta SAP pendiente';
              const rateText = formatHonorariosRates(grupo);
              return <HonorariosDoctorReviewCard key={grupo.medico} group={grupo} rows={visibleDoctorRows}
                onEditFiscal={() => { setFiscalProviderId(String(grupo.providerId || grupo.filasRevision[0]?.MedicoId || '')); setWorkspace('fiscal'); }}
                approvedView={workspace === 'approved'} onDownloadApproved={detailed => downloadApprovedPdf(exportGroups.find(item => item.medico === grupo.medico) || grupo, detailed)}
                pendingRows={pendingDoctorRows} selectedRows={selectedDoctorRows} expanded={isExpanded} onToggle={() => toggleMedico(grupo.medico)}
                onApprove={() => openBulk('APROBAR', selectedDoctorRows.length ? selectedDoctorRows : pendingDoctorRows.slice(0, 100))}
                onSelectRows={() => selectRows(grupo.filas)} canSelect={selectionAvailable}
                canExport={(!sapLoading || fiscalProfiles[grupo.providerId || grupo.filasRevision[0]?.MedicoId]?.enabled) && reviewReady} sapLoading={sapLoading} rateText={rateText} sapLinkLabel={sapLinkLabel}
                onPreparePayment={() => { setPaymentProviderId(String(grupo.providerId || grupo.filasRevision[0]?.MedicoId || '')); setWorkspace('liquidations'); }}
                onExportSummary={() => generateDoctorHonorariosPdf(exportGroups.find(item => item.medico === grupo.medico) || grupo, startDate, endDate, false, pdfGeneratedBy)}
                onExportDetail={() => generateDoctorHonorariosPdf(exportGroups.find(item => item.medico === grupo.medico) || grupo, startDate, endDate, true, pdfGeneratedBy)}
                formatMoney={formatMoney} formatSapMoney={formatSapMoney} formatDate={formatDate} reviewButtons={reviewButtons} reviewLabel={reviewLabel}
                onOpenDetail={handleOpenDetail} onRestore={handleRestoreRow} canRestore={!reviewSaving && reviewReady && canReview}
                pagination={renderPagination({ page: activeDoctorPage, pageCount: doctorPageCount, total: grupo.filas.length,
                  onPageChange: page => setDoctorPages(previous => ({ ...previous, [grupo.medico]: page })) })} />;
            })}
          </div>
        )}

        {/* ========================================================================= */}
        {/* VISTA 2: TABLA DETALLADA INTELIGENTE */}
        {/* ========================================================================= */}
        {!loading && hasSearched && filteredData.length > 0 && viewMode === 'inteligente' && (
          <>
          <div className="hon-table-wrapper">
            <table className="hon-table" style={{ minWidth: '1200px' }}>
              <thead className="hon-thead">
                <tr>
                  <th style={{ padding: '1rem' }}>Médico Tratante</th>
                  <th style={{ padding: '1rem' }}>Servicio & Grupo</th>
                  <th style={{ padding: '1rem' }}>Paciente o documento</th>
                  <th style={{ padding: '1rem' }}>Estado de revisión</th>
                  <th style={{ padding: '1rem', textAlign: 'right' }}>Honorario ($)</th>
                  <th style={{ padding: '1rem', textAlign: 'right' }}>ISR ($)</th>
                  <th style={{ padding: '1rem', textAlign: 'right' }}>IVA ($)</th>
                            <th style={{ padding: '1rem', textAlign: 'right' }}>Retención de IVA ($)</th>
                            <th style={{ padding: '1rem', textAlign: 'right' }}>Importe final aprobado ($ MXN)</th>
                  <th style={{ padding: '1rem', textAlign: 'center' }}>Acción de revisión</th>
                  <th style={{ padding: '1rem', textAlign: 'center' }}>Ficha</th>
                </tr>
              </thead>
              <tbody className="hon-tbody">
                {visibleFilteredData.map((row, idx) => (
                  <tr
                    key={row._rowId || idx}
                    onClick={() => handleOpenDetail(row)}
                    style={{ cursor: 'pointer' }}
                  >
                    {/* Médico */}
                    <td style={{ padding: '1rem' }}>
                      <div style={{ fontWeight: '700', fontSize: '0.95rem' }}>
                        👨‍⚕️ {row.Medico || 'Sin Asignar'}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #64748b)', marginTop: '0.15rem' }}>
                        {row.Especialidad || 'Medicina'} | <span style={{ fontWeight: '600' }}>ISR: {formatHonorariosRate(row._effectiveISRRate)}</span>
                      </div>
                    </td>

                    {/* Servicio y Grupo */}
                    <td style={{ padding: '1rem' }}>
                      <div style={{ fontWeight: '600', fontSize: '0.9rem' }}>
                        {row.Servicio}
                      </div>
                      <div style={{ color: row.TipoCalculo === 'SAP_DOCUMENTO' ? '#7c3aed' : '#0369a1', fontSize: '0.72rem', fontWeight: '700' }}>{sourceLabel(row)}</div>
                      {renderSapLineDetails(row)}
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.2rem' }}>
                        <span className="hon-badge-group" style={{ background: '#e0f2fe', color: '#0369a1', padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: '700' }}>
                          {row.GrupoServicio || 'S/G'}
                        </span>
                      </div>
                    </td>

                    {/* Paciente y Atención */}
                    <td style={{ padding: '1rem' }}>
                      <div style={{ fontWeight: '700', fontSize: '0.9rem' }}>
                        {row.Paciente}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: '#0088C9', marginTop: '0.15rem' }}>
                        {formatHonorarioReference(row)} | {formatDate(row.FechaAtencion)}
                      </div>
                      {row.TipoCalculo !== 'SAP_DOCUMENTO' && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted, #64748b)', marginTop: '0.15rem' }}>{formatHonorarioSalesOrder(row)}</div>}
                    </td>

                    {/* Estado Auditoría */}
                    <td style={{ padding: '1rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', alignItems: 'flex-start' }}>
                        <span className={row._reviewStatus === 'APROBADO' ? 'hon-badge-approved' : row._reviewStatus === 'RECHAZADO' ? 'hon-badge-excluded' : 'hon-badge-pending'} style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.3rem',
                          ...reviewBadgeStyle(row),
                          padding: '0.25rem 0.6rem',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: '700'
                        }}>
                          {reviewLabel(row)}
                        </span>

                        {row._isOverridden && !row.LiquidacionCerrada && (
                          <span className="hon-badge-manual" style={{
                            fontSize: '0.7rem',
                            padding: '0.15rem 0.45rem',
                            borderRadius: '4px',
                            fontWeight: '700',
                            background: '#ede9fe',
                            color: '#6d28d9'
                          }}>
                            👤 {row._overrideAction === 'APROBAR' ? 'Incluido manualmente' : 'Excluido manualmente'}
                          </span>
                        )}

                        {row._effectiveMotivo && (
                          <div style={{ fontSize: '0.75rem', color: row._effectiveElegible ? '#059669' : '#ef4444', marginTop: '0.15rem', maxWidth: '240px' }}>
                            {row._effectiveMotivo}
                          </div>
                        )}
                        <HonorariosPhysicianCorrection correction={row._physicianCorrection} />
                      </div>
                    </td>

                    {/* Base Honorario */}
                    <td style={{ padding: '1rem', textAlign: 'right' }}>
                      <div style={{ fontSize: '1rem', fontWeight: '700' }}>
                        {row.TipoCalculo === 'SAP_DOCUMENTO' ? 'Según factura' : formatMoney(row._effectiveElegible ? row._effectiveBase : Number(row.BaseImporte) > 0 ? row.BaseImporte : row.BasePropuesta)}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #64748b)' }}>
                        Cobrado: {formatMoney(row.PrecioCobradoPaciente)}
                      </div>
                    </td>

                    {/* Retención ISR */}
                    <td style={{ padding: '1rem', textAlign: 'right', color: '#dc2626' }}>
                      <div style={{ fontSize: '0.95rem', fontWeight: '600' }}>
                        -{formatMoney(row._effectiveISR)}
                      </div>
                    </td>

                    {/* Neto a Pagar */}
                    <td style={{ padding: '1rem', textAlign: 'right' }}>{formatMoney(row._effectiveIVA)}</td>
                    <td style={{ padding: '1rem', textAlign: 'right', color: '#dc2626' }}>{row._effectiveRetIVA === null ? row.TipoCalculo === 'SAP_DOCUMENTO' ? 'Sin desglose' : 'Pendiente' : '-' + formatMoney(row._effectiveRetIVA)}</td>
                    <td style={{ padding: '1rem', textAlign: 'right' }}>
                      <div style={{ fontSize: '1.1rem', fontWeight: '800', color: row._effectiveElegible ? '#10b981' : 'var(--text-muted, #64748b)' }}>
                        {formatMoney(row._effectiveNeto)}
                      </div>
                    </td>

                    {/* Botón de Acción Auditor */}
                    <td style={{ padding: '1rem', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center', alignItems: 'center' }}>
                        {reviewButtons(row)}
                                  {row._isOverridden && !row.LiquidacionCerrada && (
                          <button
                            disabled={reviewSaving || !reviewReady || !canReview}
                                      onClick={() => handleRestoreRow(row)}
                            className="hon-btn-override-restore"
                            title="Restaurar a valor original"
                          >
                            ↩️
                          </button>
                        )}
                      </div>
                    </td>

                    {/* Ficha */}
                    <td style={{ padding: '1rem', textAlign: 'center' }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleOpenDetail(row); }}
                        className="hon-view-btn"
                        style={{
                          border: '1px solid var(--table-border, #cbd5e1)',
                          padding: '0.45rem 0.8rem',
                          fontSize: '0.8rem',
                          color: '#0088C9'
                        }}
                      >
                        🔍 Ficha
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {renderPagination({
            page: activeDetailPage, pageCount: detailPageCount, total: filteredData.length,
            onPageChange: setDetailPage
          })}
          </>
        )}

        {/* ========================================================================= */}
        {/* VISTA 3: MATRIZ COMPLETA (TODAS LAS COLUMNAS UNIFICADAS) */}
        {/* ========================================================================= */}
        {!loading && hasSearched && filteredData.length > 0 && viewMode === 'plana' && (
          <>
          <div className="hon-table-wrapper" style={{ maxHeight: '600px' }}>
            <table className="hon-table" style={{ minWidth: '1800px', fontSize: '0.85rem' }}>
              <thead className="hon-thead" style={{ position: 'sticky', top: 0, zIndex: 5 }}>
                <tr>
                  <th style={{ padding: '0.85rem 0.75rem' }}>Folio o factura</th>
                  <th style={{ padding: '0.85rem 0.75rem' }}>Folio Cita</th>
                  <th style={{ padding: '0.85rem 0.75rem' }}>Folio Orden Venta</th>
                  <th style={{ padding: '0.85rem 0.75rem' }}>Fecha</th>
                  <th style={{ padding: '0.85rem 0.75rem' }}>Médico</th>
                  <th style={{ padding: '0.85rem 0.75rem' }}>Especialidad</th>
                  <th style={{ padding: '0.85rem 0.75rem' }}>Paciente</th>
                  <th style={{ padding: '0.85rem 0.75rem' }}>Cliente</th>
                  <th style={{ padding: '0.85rem 0.75rem' }}>Grupo</th>
                  <th style={{ padding: '0.85rem 0.75rem' }}>Servicio</th>
                  <th style={{ padding: '0.85rem 0.75rem' }}>Cant.</th>
                  <th style={{ padding: '0.85rem 0.75rem' }}>Cobrado ($)</th>
                  <th style={{ padding: '0.85rem 0.75rem' }}>Honorario ($)</th>
                  <th style={{ padding: '0.85rem 0.75rem' }}>ISR (%)</th>
                  <th style={{ padding: '0.85rem 0.75rem' }}>ISR ($)</th>
                  <th style={{ padding: '0.85rem 0.75rem' }}>IVA ($)</th>
                            <th style={{ padding: '0.85rem 0.75rem' }}>Retención de IVA ($)</th>
                            <th style={{ padding: '0.85rem 0.75rem' }}>Importe final aprobado ($ MXN)</th>
                  <th style={{ padding: '0.85rem 0.75rem' }}>Estado</th>
                  <th style={{ padding: '0.85rem 0.75rem' }}>Ajuste</th>
                  <th style={{ padding: '0.85rem 0.75rem', textAlign: 'center' }}>Acción</th>
                </tr>
              </thead>
              <tbody className="hon-tbody">
                {visibleFilteredData.map((row, idx) => (
                  <tr
                    key={row._rowId || idx}
                    onClick={() => handleOpenDetail(row)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td style={{ padding: '0.75rem', fontWeight: 'bold', color: '#0088C9' }}>{row.TipoCalculo === 'SAP_DOCUMENTO' ? formatHonorarioReference(row) : row.FolioAtencion ? `#${row.FolioAtencion}` : 'Sin atención vinculada'}</td>
                    <td style={{ padding: '0.75rem' }}>{row.TipoCalculo === 'SAP_DOCUMENTO' ? 'No aplica' : row.FolioCita ?? 'Sin cita vinculada'}</td>
                    <td style={{ padding: '0.75rem' }}>{row.TipoCalculo === 'SAP_DOCUMENTO' ? 'No aplica' : row.FolioOrdenVenta ?? 'Sin orden de venta'}</td>
                    <td style={{ padding: '0.75rem' }}>{formatDate(row.FechaAtencion)}</td>
                    <td style={{ padding: '0.75rem', fontWeight: '600' }}>{row.Medico}</td>
                    <td style={{ padding: '0.75rem' }}>{row.Especialidad}</td>
                    <td style={{ padding: '0.75rem' }}>{row.Paciente}</td>
                    <td style={{ padding: '0.75rem' }}>{row.Cliente}</td>
                    <td style={{ padding: '0.75rem' }}>{row.GrupoServicio}</td>
                    <td style={{ padding: '0.75rem' }}>{row.Servicio}<div style={{ color: row.TipoCalculo === 'SAP_DOCUMENTO' ? '#7c3aed' : '#0369a1', fontSize: '0.72rem', fontWeight: '700' }}>{sourceLabel(row)}</div>{renderSapLineDetails(row)}</td>
                    <td style={{ padding: '0.75rem' }}>{row.Cantidad ?? 'Pendiente'}</td>
                    <td style={{ padding: '0.75rem' }}>{formatMoney(row.PrecioCobradoPaciente)}</td>
                    <td style={{ padding: '0.75rem', fontWeight: '600' }}>{row.TipoCalculo === 'SAP_DOCUMENTO' ? 'Según factura' : formatMoney(row._effectiveElegible ? row._effectiveBase : Number(row.BaseImporte) > 0 ? row.BaseImporte : row.BasePropuesta)}</td>
                    <td style={{ padding: '0.75rem' }}>{formatHonorariosRate(row._effectiveISRRate)}</td>
                    <td style={{ padding: '0.75rem', color: '#dc2626' }}>-{formatMoney(row._effectiveISR)}</td>
                    <td style={{ padding: '1rem', textAlign: 'right' }}>{formatMoney(row._effectiveIVA)}</td>
                    <td style={{ padding: '1rem', textAlign: 'right', color: '#dc2626' }}>{row._effectiveRetIVA === null ? row.TipoCalculo === 'SAP_DOCUMENTO' ? 'Sin desglose' : 'Pendiente' : '-' + formatMoney(row._effectiveRetIVA)}</td>
                    <td style={{ padding: '0.75rem', fontWeight: 'bold', color: row._effectiveElegible ? '#10b981' : 'var(--text-muted, #64748b)' }}>
                      {formatMoney(row._effectiveNeto)}
                    </td>
                    <td style={{ padding: '0.75rem' }}>
                      <span style={{ color: row._reviewStatus === 'APROBADO' ? '#15803d' : row._reviewStatus === 'RECHAZADO' ? '#b91c1c' : '#92400e', fontWeight: 'bold' }}>
                        {reviewLabel(row)}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem' }}>
                      {row._isOverridden ? (
                        <span style={{ color: '#8b5cf6', fontWeight: '700', fontSize: '0.75rem' }}>
                          ⚡ {row._overrideAction}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted, #94a3b8)', fontSize: '0.75rem' }}>Sistema</span>
                      )}
                      <HonorariosPhysicianCorrection correction={row._physicianCorrection} />
                    </td>
                    <td style={{ padding: '0.75rem', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'center' }}>
                        {reviewButtons(row)}
                                  {row._isOverridden && !row.LiquidacionCerrada && (
                          <button
                            disabled={reviewSaving || !reviewReady || !canReview}
                                      onClick={() => handleRestoreRow(row)}
                            className="hon-btn-override-restore"
                            style={{ padding: '0.25rem 0.4rem', fontSize: '0.72rem' }}
                          >
                            ↩️
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {renderPagination({
            page: activeDetailPage, pageCount: detailPageCount, total: filteredData.length,
            onPageChange: setDetailPage
          })}
          </>
        )}

      </div>

      {/* ========================================================================= */}
      {/* 6. MODAL DIÁLOGO DE AJUSTE MANUAL (APROBAR O EXCLUIR) */}
      {/* ========================================================================= */}
      </div>
      {bulkDialog.open && <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
        <section role="dialog" aria-modal="true" aria-label="Revisar selección" className="hon-card" style={{ width: '100%', maxWidth: 680, maxHeight: 'calc(100dvh - 2rem)', overflowY: 'auto', padding: '1.25rem' }}>
          <h2>{bulkDialog.action === 'APROBAR' ? 'Aprobar' : 'Excluir'} {bulkDialog.rows.length} servicios</h2>
          {bulkDialog.action === 'APROBAR' && <>
            <p>Elige el IVA una sola vez para todos los servicios seleccionados.</p>
            <div className="hon-bulk-summary" style={{ padding: '1rem', margin: '1rem 0', background: 'var(--surface-1, #f8fafc)', borderRadius: 10 }}>
              <strong>{[...new Set((bulkDialog.preview || bulkDialog.rows).map(row => row.providerName || 'Médico pendiente'))].join(' · ')}</strong>
              <p style={{ margin: '.4rem 0 0' }}>{bulkDialog.rows.length} servicios · Total antes de impuestos: <strong>{bulkDialog.pricing ? 'Calculando…' : bulkDialog.preview ? formatMoney(bulkDialog.preview.reduce((sum, row) => sum + roundCents(row.customAmount), 0)) : 'Pendiente de cálculo'}</strong></p>
            </div>
            <label>IVA para toda la selección<select aria-label="IVA de la selección" className="hon-input" value={bulkDialog.vatRate} disabled={reviewSaving}
              onChange={event => setBulkDialog(previous => ({ ...previous, vatRate: event.target.value }))}>
              <option value="">Selecciona el IVA</option><option value="0">Sin IVA, confirmado por el responsable</option><option value="0.16">16%</option><option value="0.08">8% con soporte del tratamiento aplicable</option>
            </select></label>
            <p style={{ fontSize: '.85rem', color: 'var(--text-muted, #64748b)' }}>Al guardar confirmas que los médicos indicados realizaron estos servicios. El mismo IVA se aplicará a todos; si requieren IVA distinto, apruébalos en grupos separados.</p>
            <details style={{ margin: '.8rem 0' }}><summary>Corregir médico de la selección (opcional)</summary>
              <label>Médico para toda la selección
                <select aria-label="Médico de la selección" className="hon-input" value={bulkDialog.providerId} disabled={reviewSaving}
                  onChange={event => setBulkDialog(previous => ({ ...previous, providerId: event.target.value, preview: null, pricing: true }))}>
                  <option value="">Conservar el médico mostrado en cada servicio</option>
                  {providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name} · #{provider.id}</option>)}
                </select>
              </label>
              <label>{bulkPhysicianChanged ? 'Motivo del cambio de médico (obligatorio)' : 'Nota o referencia (opcional)'}
                <input aria-label={bulkPhysicianChanged ? 'Motivo del cambio de médico' : 'Referencia de la selección'} className="hon-input"
                  value={bulkDialog.evidenceReference} maxLength={1000} disabled={reviewSaving} required={bulkPhysicianChanged}
                  aria-describedby={bulkPhysicianChanged ? 'hon-bulk-physician-reason-help' : undefined}
                  onChange={event => setBulkDialog(previous => ({ ...previous, evidenceReference: event.target.value, error: null }))} />
              </label>
              {bulkPhysicianChanged && <p id="hon-bulk-physician-reason-help" className={`hon-friendly-message${bulkChangeReasonMissing ? ' error' : ''}`}>
                El motivo y tu usuario quedarán registrados en los servicios cuyo médico cambie. Escribe el motivo para aprobar.</p>}
            </details>
            {bulkDialog.rows.some(row => row.possibleDuplicate) && <label><input type="checkbox" checked={bulkDialog.duplicateConfirmed} disabled={reviewSaving} onChange={event => setBulkDialog(previous => ({ ...previous, duplicateConfirmed: event.target.checked }))} /> Revisé las coincidencias y confirmé que son servicios distintos.</label>}
          </>}
          <details style={{ margin: '1rem 0' }}><summary>Ver los {bulkDialog.rows.length} servicios seleccionados</summary>
            <div style={{ overflowX: 'auto', maxHeight: 300, margin: '.8rem 0' }}><table style={{ width: '100%', textAlign: 'left', fontSize: '.8rem' }}>
              <thead><tr><th>Fecha / orden</th><th>Servicio</th><th>Médico</th><th>Cantidad</th><th>Honorario</th></tr></thead>
              <tbody>{(bulkDialog.preview || bulkDialog.rows).map(row => <tr key={row.rowId}><td>{row.serviceDate}<br />Orden {row.salesOrder || 'sin vínculo'}</td><td>{row.description}</td><td>{row.providerName || 'Pendiente'}</td><td>{row.quantity ?? 'Pendiente'}</td><td>{row.customAmount ? formatMoney(row.customAmount) : 'Por calcular'}</td></tr>)}</tbody>
            </table></div>
          </details>
          {bulkDialog.action === 'EXCLUIR' && <>
            <label>Motivo de la selección<input aria-label="Motivo de la selección" className="hon-input" value={bulkDialog.motivo} maxLength={2000} onChange={event => setBulkDialog(previous => ({ ...previous, motivo: event.target.value }))} /></label>
            <label style={{ display: 'block', margin: '1rem 0' }}><input type="checkbox" checked={bulkDialog.confirmed} onChange={event => setBulkDialog(previous => ({ ...previous, confirmed: event.target.checked }))} /> Revisé los servicios seleccionados y confirmo su exclusión.</label>
          </>}
          {bulkDialog.error && <p role="alert" style={{ color: '#b91c1c' }}>{userMessage(bulkDialog.error)}</p>}
          <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap' }}>
            <button className="hon-view-btn" disabled={reviewSaving} onClick={() => setBulkDialog(previous => ({ ...previous, open: false }))}>Cancelar</button>
            <button className="hon-friendly-button primary" disabled={reviewSaving || bulkChangeReasonMissing || (bulkDialog.action === 'APROBAR'
              ? (bulkDialog.pricing || !bulkDialog.preview || bulkDialog.vatRate === '' || (bulkDialog.rows.some(row => row.possibleDuplicate) && !bulkDialog.duplicateConfirmed))
              : !bulkDialog.confirmed)} onClick={saveBulk}>
              {reviewSaving ? 'Guardando…' : bulkDialog.action === 'APROBAR' ? 'Aprobar servicios' : 'Guardar exclusión de la selección'}
            </button>
          </div>
        </section>
      </div>}
      {overrideModal.isOpen && overrideModal.row && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(6px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1100,
          padding: '1.5rem'
        }}>
          <div className="hon-modal-content" role="dialog" aria-modal="true" aria-label={overrideModal.action === 'APROBAR' ? 'Aprobar honorario' : 'Excluir honorario'} style={{
            background: 'var(--surface-raised, #ffffff)',
            borderRadius: '16px',
            width: '100%',
            maxWidth: '560px',
            maxHeight: 'calc(100dvh - 3rem)',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            overflowY: 'auto'
          }}>
            <div style={{
              padding: '1.25rem 1.75rem',
              background: overrideModal.action === 'APROBAR' 
                ? 'linear-gradient(135deg, #065f46 0%, #059669 100%)' 
                : 'linear-gradient(135deg, #991b1b 0%, #dc2626 100%)',
              color: 'white',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.4rem' }}>
                  {overrideModal.action === 'APROBAR' ? '➕' : '⚠️'}
                </span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: '800', color: 'white' }}>
                        {overrideModal.action === 'APROBAR' ? overrideModal.row.FixedMonthly ? 'Incluir pago fijo mensual' : 'Aprobar honorario' : 'Excluir honorario'}
                  </h3>
                  <span style={{ fontSize: '0.78rem', color: '#e2e8f0' }}>
                    Se guarda quién hizo la revisión, cuándo y por qué.
                  </span>
                </div>
              </div>
              <button 
                onClick={() => setOverrideModal(prev => ({ ...prev, isOpen: false }))}
                style={{ background: 'transparent', border: 'none', color: 'white', fontSize: '1.3rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '1.5rem 1.75rem', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
              
              {/* Información del Renglón */}
              <div className="hon-modal-block-neutral" style={{ padding: '0.9rem 1.1rem', borderRadius: '10px', background: 'var(--surface-1, #f8fafc)', border: '1px solid var(--table-border, #e2e8f0)', fontSize: '0.85rem' }}>
                <div style={{ fontWeight: '700', fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                  {overrideModal.row.Servicio}
                </div>
                <div style={{ color: 'var(--text-muted, #64748b)', marginTop: '0.2rem' }}>
                  👨‍⚕️ <strong>{overrideModal.row.ModeBI && overrideModal.action === 'APROBAR' ? providers.find(provider => String(provider.id) === String(overrideModal.providerId))?.name || (String(overrideModal.providerId) === String(overrideModal.row.MedicoId) ? overrideModal.row.Medico : `Médico #${overrideModal.providerId}`) : overrideModal.row.Medico}</strong> | {overrideModal.row.FixedMonthly ? `Mes: ${overrideModal.row.FeeMonth}` : overrideModal.row.TipoCalculo === 'SAP_DOCUMENTO' ? formatHonorarioReference(overrideModal.row) : `Paciente: ${overrideModal.row.Paciente} | ${formatHonorarioReference(overrideModal.row)} | ${formatHonorarioSalesOrder(overrideModal.row)}`}
                </div>
              </div>

              {/* Si se va a aprobar, capturar o validar el Monto Base */}
              {overrideModal.action === 'APROBAR' && overrideModal.row.ModeBI && !overrideModal.row.FixedMonthly && <details open={overridePhysicianChanged || undefined}>
                <summary>Corregir médico o cantidad (opcional)</summary>
                <label>Médico beneficiario
                  <select aria-label="Médico beneficiario" className="hon-input" value={overrideModal.providerId}
                    onChange={event => setOverrideModal(previous => ({ ...previous, providerId: event.target.value, customAmount: '', quotedTariffId: null, error: null }))}>
                    <option value="">Selecciona el médico</option>
                    {providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name} · #{provider.id}</option>)}
                  </select>
                </label>
                {providerError && <div role="alert">{userMessage(providerError)}</div>}
                <label>Rol médico
                  <select aria-label="Rol médico" className="hon-input" value={overrideModal.role}
                    onChange={event => setOverrideModal(previous => ({ ...previous, role: event.target.value, customAmount: '', quotedTariffId: null, error: null }))}>
                    <option value="TRATANTE">Tratante / consulta</option><option value="AN">Anestesiólogo</option>
                    <option value="SURGEON">Cirujano</option><option value="AY">Ayudante</option>
                  </select>
                </label>
                <label>Cantidad reconocida (máximo {overrideModal.row.CantidadMaxima ?? overrideModal.row.CantidadOriginal ?? overrideModal.row.Cantidad})
                  <input aria-label="Cantidad reconocida" type="number" min="0.001" step="0.001" className="hon-input" value={overrideModal.quantity}
                    onChange={event => setOverrideModal(previous => ({ ...previous, quantity: event.target.value, customAmount: '', quotedTariffId: null, error: null }))} />
                </label>
                <label>{overridePhysicianChanged ? 'Motivo del cambio de médico (obligatorio)' : 'Nota o referencia (opcional)'}
                  <input aria-label={overridePhysicianChanged ? 'Motivo del cambio de médico' : 'Referencia de realización'} className="hon-input" value={overrideModal.evidenceReference}
                    maxLength={1000} required={!!overridePhysicianChanged} aria-describedby={overridePhysicianChanged ? 'hon-physician-reason-help' : undefined}
                    onChange={event => setOverrideModal(previous => ({ ...previous, evidenceReference: event.target.value, error: null }))} />
                </label>
                {overridePhysicianChanged && <p id="hon-physician-reason-help" className={`hon-friendly-message${overrideChangeReasonMissing ? ' error' : ''}`}>
                  El motivo y tu usuario quedarán registrados en este servicio. Escribe el motivo para aprobar.</p>}
              </details>}
              {overrideModal.action === 'APROBAR' && overrideModal.row.FixedMonthly && <>
                <p style={{ margin: 0 }}><strong>Pago mensual completo antes de impuestos: {formatMoney(overrideModal.row.BaseImporte)}</strong></p>
                <p style={{ margin: 0 }}>Este pago es adicional a sus servicios. Al guardarlo autorizas el importe completo del mes indicado, aunque hayas consultado sólo parte del mes. Se incluye una sola vez por médico y mes.</p>
              </>}
              {overrideModal.action === 'APROBAR' && overrideModal.row.ModeBI && !overrideModal.row.FixedMonthly && <>
                <p style={{ margin: 0, fontSize: '0.9rem' }}><strong>Honorario: {overrideModal.pricing ? 'Calculando…' : formatMoney(overrideModal.customAmount || null)}</strong>
                  <br />Cantidad: {overrideModal.quantity} · Función: {({ TRATANTE: 'Tratante / consulta', AN: 'Anestesiólogo', SURGEON: 'Cirujano', AY: 'Ayudante' })[overrideModal.role]}</p>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted, #64748b)' }}>Al guardar la aprobación confirmas que este médico realizó el servicio indicado.</p>
                {overrideModal.row.PosibleDuplicado && <label><input type="checkbox" checked={overrideModal.duplicateConfirmed === true}
                  onChange={event => setOverrideModal(previous => ({ ...previous, duplicateConfirmed: event.target.checked }))} /> Revisé las coincidencias y confirmo que se trata de un servicio distinto, sin repetir cantidad.</label>}
              </>}
              {overrideModal.action === 'APROBAR' && !overrideModal.row.ModeBI && overrideModal.row.TipoCalculo !== 'SAP_DOCUMENTO' && (
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', marginBottom: '0.4rem', color: 'var(--text-secondary, #475569)' }}>
                    💵 Importe del honorario antes de impuestos ($ MXN):
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={overrideModal.customAmount}
                    readOnly={overrideModal.row.ModeBI}
                    onChange={e => setOverrideModal(prev => ({ ...prev, customAmount: e.target.value, error: null }))}
                    className="hon-input"
                    style={{ fontSize: '1.1rem', fontWeight: '700', color: '#059669' }}
                    placeholder={overrideModal.row.ModeBI ? 'Calcula el honorario para ver el importe' : 'Ej. 225.00'}
                  />
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #64748b)', marginTop: '0.3rem', display: 'flex', justifyContent: 'space-between' }}>
                    <span>Precio Cobrado: {formatMoney(overrideModal.row.PrecioCobradoPaciente)}</span>
                    <span>Retención de ISR estimada: {formatHonorariosRate(overrideModal.row._effectiveISRRate)}</span>
                  </div>
                </div>
              )}

              {/* Motivo o Justificación */}
              {overrideModal.action === 'APROBAR' && overrideModal.row.TipoCalculo !== 'SAP_DOCUMENTO' && <label style={{ fontSize: '0.85rem' }}>
                Confirma el IVA de este honorario
                <select aria-label="IVA confirmado" className="hon-input" value={overrideModal.vatRate ?? ''}
                  onChange={event => setOverrideModal(previous => ({ ...previous, vatRate: event.target.value }))}>
                  <option value="">{overrideModal.row.ModeBI ? 'Selecciona el IVA' : 'Conservar el IVA registrado; si falta, quedará pendiente'}</option>
                  <option value="0">Sin IVA, confirmado por quien revisa</option>
                  <option value="0.16">16%</option>
                  <option value="0.08">8% (requiere soporte del tratamiento aplicable)</option>
                </select>
              </label>}
              {overrideModal.row.TipoCalculo === 'SAP_DOCUMENTO' && <div style={{ fontSize: '0.85rem' }}>
                <strong>Total de la factura: {formatSapMoney(overrideModal.row.SapDocumento.documentTotal, overrideModal.row.SapDocumento.currency)}</strong>
                <p>Pagado a la fecha: {formatSapMoney(overrideModal.row.SapDocumento.paidToDate, overrideModal.row.SapDocumento.currency)}.
                  Saldo pendiente: {formatSapMoney(overrideModal.row.SapDocumento.openBalance, overrideModal.row.SapDocumento.currency)}. Aprobar incluye el total de la factura; no ordena otro pago.</p>
                {overrideModal.action === 'APROBAR' && <label>
                  <input type="checkbox" checked={overrideModal.separateServicesConfirmed === true}
                    onChange={event => setOverrideModal(previous => ({ ...previous, separateServicesConfirmed: event.target.checked }))} />
                  Revisé que esta factura corresponde a servicios distintos de las atenciones aprobadas de este médico. Si incluye una atención ya aprobada, aprobar solo una vez.
                </label>}
              </div>}
              {overrideModal.error && <div role="alert" style={{ color: '#b91c1c', fontSize: '0.85rem' }}>{userMessage(overrideModal.error)}</div>}
              {!(overrideModal.row.ModeBI && overrideModal.action === 'APROBAR') && <>
              <div style={{ fontSize: '0.8rem', color: '#92400e' }}>{overrideModal.row.MensajeAuditoria}</div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', marginBottom: '0.4rem', color: 'var(--text-secondary, #475569)' }}>
                  📝 Justificación y evidencia de la decisión:
                </label>
                <input
                  type="text"
                  value={overrideModal.motivo}
                  onChange={e => setOverrideModal(prev => ({ ...prev, motivo: e.target.value, error: null }))}
                  className="hon-input"
                  placeholder="Escribe el motivo del cambio..."
                />
                {overrideModal.error && (
                  <div role="alert" style={{ color: '#b91c1c', fontSize: '0.8rem', fontWeight: '700', marginTop: '0.4rem' }}>
                    {userMessage(overrideModal.error)}
                  </div>
                )}

                {/* Chips rápidos de motivos sugeridos */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.6rem' }}>
                  {overrideModal.action === 'APROBAR' ? (
                    <>
                      <button type="button" onClick={() => setOverrideModal(p => ({ ...p, motivo: 'Autorizado por Dirección Médica' }))} className="hon-reason-chip">
                        Dirección Médica
                      </button>
                      <button type="button" onClick={() => setOverrideModal(p => ({ ...p, motivo: 'Interconsulta médica validada' }))} className="hon-reason-chip">
                        Interconsulta validada
                      </button>
                      <button type="button" onClick={() => setOverrideModal(p => ({ ...p, motivo: 'Excepción de catálogo autorizada' }))} className="hon-reason-chip">
                        Excepción de catálogo
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => setOverrideModal(p => ({ ...p, motivo: 'Ya liquidado en periodo anterior' }))} className="hon-reason-chip">
                        Ya liquidado
                      </button>
                      <button type="button" onClick={() => setOverrideModal(p => ({ ...p, motivo: 'Descuento por cargo administrativo' }))} className="hon-reason-chip">
                        Cargo administrativo
                      </button>
                      <button type="button" onClick={() => setOverrideModal(p => ({ ...p, motivo: 'No corresponde a este médico' }))} className="hon-reason-chip">
                        Médico incorrecto
                      </button>
                    </>
                  )}
                </div>
              </div>
              </>}

            </div>

            <div style={{ padding: '1rem 1.75rem', background: 'var(--surface-1, #f8fafc)', borderTop: '1px solid var(--table-border, #e2e8f0)', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                onClick={() => setOverrideModal(prev => ({ ...prev, isOpen: false }))}
                className="hon-view-btn"
                style={{ border: '1px solid var(--table-border, #cbd5e1)', padding: '0.6rem 1.2rem' }}
              >
                Cancelar
              </button>

              <button
                onClick={handleConfirmOverride}
                disabled={reviewSaving || !reviewReady || !canReview || overrideChangeReasonMissing || (overrideModal.action === 'APROBAR' && overrideModal.row.ModeBI
                  && (overrideModal.pricing || (!overrideModal.row.FixedMonthly && !overrideModal.quotedTariffId) || overrideModal.vatRate === '' || (overrideModal.row.PosibleDuplicado && !overrideModal.duplicateConfirmed)))}
                style={{
                  background: overrideModal.action === 'APROBAR' ? '#059669' : '#dc2626',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '0.6rem 1.4rem',
                  fontWeight: '700',
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  boxShadow: overrideModal.action === 'APROBAR' ? '0 4px 10px rgba(5, 150, 105, 0.3)' : '0 4px 10px rgba(220, 38, 38, 0.3)'
                }}
              >
                {overrideModal.action === 'APROBAR' ? 'Guardar aprobación' : 'Guardar exclusión'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 7. MODAL FICHA DE AUDITORÍA MÉDICA */}
      {/* ========================================================================= */}
      {modalOpen && selectedRow && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000,
          padding: '1.5rem'
        }}>
          <div className="hon-modal-content" style={{
            background: 'var(--surface-raised, #ffffff)',
            borderRadius: '20px',
            width: '100%',
            maxWidth: '900px',
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            overflow: 'hidden'
          }}>
            {/* Header Modal */}
            <div style={{
              padding: '1.5rem 2rem',
              background: 'linear-gradient(135deg, #0f172a 0%, #004687 100%)',
              color: 'white',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <span style={{ fontSize: '0.8rem', color: '#93c5fd', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Ficha de revisión
                </span>
                <h3 style={{ margin: '0.25rem 0 0 0', fontSize: '1.4rem', fontWeight: '700', color: 'white' }}>
                  {selectedRow.Servicio}
                </h3>
              </div>
              <button 
                onClick={() => setModalOpen(false)}
                style={{
                  background: 'rgba(255,255,255,0.15)',
                  border: 'none',
                  color: 'white',
                  fontSize: '1.3rem',
                  borderRadius: '50%',
                  width: '38px',
                  height: '38px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                ✕
              </button>
            </div>

            {/* Body Modal */}
            <div style={{ padding: '1.75rem 2rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              
              {/* Sección de Ajuste Manual Activo en Modal */}
              <div style={{
                padding: '1rem 1.25rem',
                borderRadius: '12px',
                background: selectedRow._effectiveElegible ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                border: selectedRow._effectiveElegible ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '1rem'
              }}>
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--text-muted, #64748b)', textTransform: 'uppercase' }}>
                    Estado actual de revisión
                  </div>
                  <div style={{ fontSize: '1.15rem', fontWeight: '800', color: selectedRow._effectiveElegible ? '#059669' : '#dc2626', display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.15rem' }}>
                    {reviewLabel(selectedRow)}
                    {selectedRow._isOverridden && !selectedRow.LiquidacionCerrada && (
                      <span style={{ fontSize: '0.75rem', padding: '0.1rem 0.4rem', borderRadius: '4px', background: '#8b5cf6', color: 'white' }}>
                        Manual
                      </span>
                    )}
                  </div>
                  {selectedRow._effectiveMotivo && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #475569)', marginTop: '0.2rem' }}>
                      <strong>Motivo:</strong> {selectedRow._effectiveMotivo}
                    </div>
                  )}
                  <HonorariosPhysicianCorrection correction={selectedRow._physicianCorrection} expanded />
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {reviewButtons(selectedRow)}
                                  {selectedRow._isOverridden && !selectedRow.LiquidacionCerrada && (
                    <button
                      disabled={reviewSaving || !reviewReady || !canReview}
                                      onClick={() => handleRestoreRow(selectedRow)}
                      className="hon-btn-override-restore"
                      style={{ padding: '0.5rem 0.8rem', fontSize: '0.85rem' }}
                      title="Restaurar el valor original"
                    >
                      ↩️ Revertir
                    </button>
                  )}
                </div>
              </div>

              {/* Bloque 1: Médico */}
              <div className="hon-modal-block-neutral" style={{ background: '#f8fafc', padding: '1.25rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem', fontWeight: '700', color: '#0088C9', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  👨‍⚕️ Profesional Médico
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', fontSize: '0.9rem' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted, #64748b)', fontSize: '0.78rem', display: 'block' }}>Nombre del Médico</span>
                    <strong>{selectedRow.Medico || 'N/A'}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted, #64748b)', fontSize: '0.78rem', display: 'block' }}>Especialidad</span>
                    <strong>{selectedRow.Especialidad || 'N/A'}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted, #64748b)', fontSize: '0.78rem', display: 'block' }}>Tasa ISR usada</span>
                    <strong>{formatHonorariosRate(selectedRow._effectiveISRRate)}</strong>
                  </div>
                </div>
              </div>

              {/* Bloque 2: Paciente y Atención */}
              <div className="hon-modal-block-patient" style={{ background: '#f0f9ff', padding: '1.25rem', borderRadius: '12px', border: '1px solid #bae6fd' }}>
                <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem', fontWeight: '700', color: '#0284c7', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  👤 Paciente y folios
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', fontSize: '0.9rem' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted, #64748b)', fontSize: '0.78rem', display: 'block' }}>Nombre del Paciente</span>
                    <strong>{selectedRow.Paciente || 'N/A'}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted, #64748b)', fontSize: '0.78rem', display: 'block' }}>{selectedRow.TipoCalculo === 'SAP_DOCUMENTO' ? 'Factura SAP' : 'Folio de Atención (Vertical)'}</span>
                    <strong style={{ color: '#0088C9', fontSize: '1.1rem' }}>{selectedRow.TipoCalculo === 'SAP_DOCUMENTO' ? formatHonorarioReference(selectedRow) : selectedRow.FolioAtencion ? `#${selectedRow.FolioAtencion}` : 'Sin atención vinculada'}</strong>
                  </div>
                  {selectedRow.TipoCalculo !== 'SAP_DOCUMENTO' && <>
                    <div>
                      <span style={{ color: 'var(--text-muted, #64748b)', fontSize: '0.78rem', display: 'block' }}>Folio de Cita (Vertical)</span>
                      <strong>{selectedRow.FolioCita ? `#${selectedRow.FolioCita}` : 'Sin cita vinculada'}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted, #64748b)', fontSize: '0.78rem', display: 'block' }}>Folio Orden Venta</span>
                      <strong>{selectedRow.FolioOrdenVenta ? `#${selectedRow.FolioOrdenVenta}` : 'Sin orden de venta'}</strong>
                    </div>
                  </>}
                  <div>
                    <span style={{ color: 'var(--text-muted, #64748b)', fontSize: '0.78rem', display: 'block' }}>Fecha de Atención</span>
                    <strong>{formatDate(selectedRow.FechaAtencion)}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted, #64748b)', fontSize: '0.78rem', display: 'block' }}>Cliente / Aseguradora</span>
                    <strong>{selectedRow.Cliente || 'VENTA GENERAL'}</strong>
                  </div>
                </div>
              </div>

              {/* Bloque 3: Servicio y Desglose Financiero */}
              <div className="hon-modal-block-service" style={{ background: '#f0fdf4', padding: '1.25rem', borderRadius: '12px', border: '1px solid #bbf7d0' }}>
                <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem', fontWeight: '700', color: '#10b981', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  🩺 Detalle de honorarios
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', fontSize: '0.9rem' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted, #64748b)', fontSize: '0.78rem', display: 'block' }}>Grupo de Servicio</span>
                    <strong>{selectedRow.GrupoServicio}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted, #64748b)', fontSize: '0.78rem', display: 'block' }}>Importe cobrado al paciente</span>
                    <strong>{formatMoney(selectedRow.PrecioCobradoPaciente)}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted, #64748b)', fontSize: '0.78rem', display: 'block' }}>Honorario según tarifa</span>
                    <strong style={{ color: '#0284c7' }}>{formatMoney(selectedRow._effectiveBase)}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted, #64748b)', fontSize: '0.78rem', display: 'block' }}>Retención de ISR estimada</span>
                    <strong style={{ color: '#dc2626' }}>-{formatMoney(selectedRow._effectiveISR)}</strong>
                  </div>
                  <div><span>IVA del honorario</span><br /><strong>{formatMoney(selectedRow._effectiveIVA)}</strong></div>
                  <div><span>Retención de IVA estimada</span><br /><strong>-{formatMoney(selectedRow._effectiveRetIVA)}</strong></div>
                  <div>
                    <span style={{ color: 'var(--text-muted, #64748b)', fontSize: '0.78rem', display: 'block' }}>Importe final estimado</span>
                    <strong style={{ color: '#10b981', fontSize: '1.2rem', fontWeight: '800' }}>
                      {formatMoney(selectedRow._effectiveNeto)}
                    </strong>
                  </div>
                </div>
              </div>

              <p style={{ fontSize: '0.85rem' }}>{selectedRow._fiscalNote}</p>
              {selectedRow._reviewer && <p>Revisado por {selectedRow._reviewer} | {formatDate(selectedRow._overrideTimestamp)} | {selectedRow._overrideMotivo}</p>}
              {selectedRow.SapDocumento && <p>Total de la factura: {formatSapMoney(selectedRow.SapDocumento.documentTotal, selectedRow.SapDocumento.currency)}. Pagado a la fecha: {formatSapMoney(selectedRow.SapDocumento.paidToDate, selectedRow.SapDocumento.currency)}. Saldo pendiente: {formatSapMoney(selectedRow.SapDocumento.openBalance, selectedRow.SapDocumento.currency)}.</p>}
              {renderSapLineDetails(selectedRow)}
              {selectedRow.ObservacionCobertura && <p style={{ fontSize: '0.85rem', color: '#0f766e' }}>{selectedRow.ObservacionCobertura}</p>}
              {/* Bloque 4: Motor de Auditoría y Reglas */}
              <div className={selectedRow._effectiveElegible ? 'hon-modal-block-audit-ok' : 'hon-modal-block-audit-bad'} style={{ background: selectedRow._effectiveElegible ? '#f8fafc' : '#fef2f2', padding: '1.25rem', borderRadius: '12px', border: selectedRow._effectiveElegible ? '1px solid #e2e8f0' : '1px solid #fecaca' }}>
                <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem', fontWeight: '700', color: selectedRow._effectiveElegible ? 'var(--text-primary)' : '#ef4444', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  🛡️ Resultado de la revisión
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', fontSize: '0.85rem' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted, #64748b)', display: 'block' }}>Atención Cerrada:</span>
                    <strong>{selectedRow.PasaAtencionCerrada ? '✅ Sí' : '❌ No'}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted, #64748b)', display: 'block' }}>Es un servicio médico:</span>
                    <strong>{selectedRow.PasaTipoServicio ? '✅ Sí' : '❌ No'}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted, #64748b)', display: 'block' }}>Está en la lista de honorarios:</span>
                    <strong>{selectedRow.PasaCatalogoHonorarios ? '✅ Sí' : '❌ No'}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted, #64748b)', display: 'block' }}>Tiene cita u orden de venta:</span>
                    <strong>{selectedRow.TieneCita || selectedRow.TieneSO ? '✅ Sí' : '❌ No'}</strong>
                  </div>
                </div>
                {(selectedRow.MensajeAuditoria || selectedRow.MotivoExclusionOriginal) && (
                  <div style={{ marginTop: '0.75rem', padding: '0.6rem 0.9rem', background: selectedRow._effectiveElegible ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)', borderRadius: '6px', color: selectedRow._effectiveElegible ? '#10b981' : '#f87171', fontSize: '0.85rem', fontWeight: '600' }}>
                    📌 <strong>Observación del cálculo:</strong> {selectedRow.MensajeAuditoria || selectedRow.MotivoExclusionOriginal}
                  </div>
                )}
              </div>

            </div>

            {/* Footer Modal */}
            <div style={{ padding: '1rem 2rem', background: 'var(--surface-1, #f8fafc)', borderTop: '1px solid var(--table-border, #e2e8f0)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              {/* Botón de descarga de PDF individual desde la Ficha */}
              <button 
                onClick={() => {
                  const docGroup = exportGroups.find(g => g.medico === doctorGroupKey(selectedRow)) || {
                    medico: doctorGroupKey(selectedRow), providerId: selectedRow.MedicoId, providerName: selectedRow.Medico,
                    especialidad: selectedRow.Especialidad,
                    tipoMedico: selectedRow.TipoMedico,
                    tasaISR: selectedRow._effectiveISRRate,
                    ...summarizeHonorarios([selectedRow]),
                    sap: sapReconciliation?.providers?.[selectedRow.Medico?.trim()],
                    sapPeriod: sapReconciliation?.period,
                    filas: [selectedRow],
                    filasRevision: effectiveData.filter(row => doctorGroupKey(row) === doctorGroupKey(selectedRow))
                  };
                  generateDoctorHonorariosPdf(docGroup, startDate, endDate, true, pdfGeneratedBy);
                }}
                disabled={sapLoading || !reviewReady}
                style={{
                  padding: '0.6rem 1.4rem',
                  background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  boxShadow: '0 4px 10px rgba(5, 150, 105, 0.3)'
                }}
              >
                <span>📄</span> Descargar resumen de honorarios PDF
              </button>

              <button 
                onClick={() => setModalOpen(false)}
                style={{ padding: '0.6rem 1.6rem', background: '#004687', color: 'white', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '0.9rem' }}
              >
                Cerrar Ficha
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
