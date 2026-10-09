import { userMessage } from '../../utils/userMessages';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { CATALOG_STATUS_LABELS as STATUS_LABELS, CATALOG_ROLE_LABELS as ROLE_LABELS,
  isCatalogApproved as isApproved, catalogStateLabel as approvalLabel, withCatalogScope as withProfessionalScope,
  catalogItemsForView, filterCatalogItems, createCatalogExportSheets } from '../../utils/honorariosCatalogExport';
import { downloadInstitutionalExcel } from '../../utils/excelInstitutionalGenerator';
import './HonorariosCatalogPanel.css';

const PAGE_SIZE = 40;
const money = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
  ? Number(value).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }) : 'Sin importe';
const dateLabel = value => value ? String(value).slice(0, 10).split('-').reverse().join('/') : 'Sin fecha final';
const timestampLabel = value => value ? new Date(value).toLocaleString('es-MX') : '';
const referenceChangeLabel = reference => {
  const audit = reference.changeAudit;
  return audit?.available && audit.source === 'Vertical' && audit.changedBy
    ? `Última modificación en Vertical: ${audit.changedBy}${audit.changedAt ? ` · ${timestampLabel(audit.changedAt)}` : ''}`
    : '';
};
const localToday = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const blankTariff = () => ({ id: null, providerId: '', role: '', amount: '', validFrom: localToday(), validTo: '', active: true, revision: 0 });
const historyDescription = entry => {
  const current = entry.payload?.current;
  if (!current) return '';
  if (entry.entityType === 'TARIFF') return `${money(current.amount)} · ${current.providerId ? `Médico ${current.providerId}` : 'Tarifa general'}${current.role ? ` · Rol ${current.role}` : ''} · ${dateLabel(current.validFrom)}${current.validTo ? ` a ${dateLabel(current.validTo)}` : ' en adelante'} · ${current.active === false ? 'Inactiva' : 'Activa'}`;
  return `${STATUS_LABELS[current.status] || current.status || ''} · ${current.modality === 'contact_center' ? 'Contact Center' : 'Presencial'} · Por ${current.paymentUnit || 'servicio'}`;
};

export default function HonorariosCatalogPanel({ canManage = false, onChanged, onReviewServices }) {
  const [items, setItems] = useState([]);
  const [sync, setSync] = useState(null);
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [providerError, setProviderError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('TODOS');
  const [catalogView, setCatalogView] = useState('RECOMENDADOS');
  const [reviewOtherConcepts, setReviewOtherConcepts] = useState(false);
  const [page, setPage] = useState(0);
  const [selectedCode, setSelectedCode] = useState(null);
  const [config, setConfig] = useState(null);
  const [tariffs, setTariffs] = useState([]);
  const [history, setHistory] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [saving, setSaving] = useState(false);
  const [tariff, setTariff] = useState(blankTariff);
  const [tariffEditorOpen, setTariffEditorOpen] = useState(false);
  const catalogRequest = useRef(0);
  const detailRequest = useRef(0);
  const detailCache = useRef(new Map());
  const selectedCodeRef = useRef(selectedCode);
  selectedCodeRef.current = selectedCode;
  const workingItems = useMemo(() => catalogItemsForView(items, { reviewOtherConcepts }),
  [items, reviewOtherConcepts]);
  const approvedItems = useMemo(() => workingItems.filter(isApproved), [workingItems]);
  const recommendedItems = useMemo(() => workingItems.filter(item => !isApproved(item) && item.status !== 'EXCLUIDO'
    && Array.isArray(item.referencePrices) && item.referencePrices.length > 0), [workingItems]);
  const scopedItems = catalogView === 'APROBADOS' ? approvedItems : catalogView === 'RECOMENDADOS' ? recommendedItems : workingItems;
  const selected = workingItems.find(item => item.itemCode === selectedCode) || null;
  const changeCatalogView = view => {
    if (view === catalogView) return;
    setCatalogView(view);
    setStatus('TODOS');
    setPage(0);
    setSelectedCode(null);
    setMessage('');
  };

  const loadCatalog = useCallback(async () => {
    const request = ++catalogRequest.current;
    setLoading(true);
    setError('');
    try {
      const result = await apiFetch('/honorarios/catalog');
      if (request === catalogRequest.current) {
        setItems((result.items || []).map(withProfessionalScope));
        setSync(result.sync || null);
      }
      return result;
    } catch (failure) {
      if (request === catalogRequest.current) setError(userMessage(failure.message));
      throw failure;
    } finally {
      if (request === catalogRequest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCatalog().catch(() => {});
    let alive = true;
    apiFetch('/honorarios/providers').then(result => {
      if (alive) setProviders(result.providers || []);
    }).catch(failure => { if (alive) setProviderError(userMessage(failure.message)); });
    return () => { alive = false; catalogRequest.current += 1; detailRequest.current += 1; };
  }, [loadCatalog]);

  useEffect(() => {
    setConfig(selected ? { status: selected.status, modality: selected.modality || 'presencial',
      revision: selected.revision } : null);
  }, [selected?.itemCode, selected?.revision, selected?.status, selected?.modality]);

  const loadDetails = useCallback(async (code, force = false) => {
    const request = ++detailRequest.current;
    const cached = detailCache.current.get(code);
    setDetailError('');
    if (!force && cached && Date.now() - cached.at < 60000) {
      setTariffs(cached.tariffs); setHistory(cached.history); setDetailLoading(false);
      return;
    }
    setDetailLoading(true);
    await Promise.allSettled([
      apiFetch(`/honorarios/catalog/${encodeURIComponent(code)}/tariffs`).then(result => {
        if (request !== detailRequest.current) return;
        setTariffs(result.tariffs || []);
        detailCache.current.set(code, { ...detailCache.current.get(code), tariffs: result.tariffs || [],
          history: detailCache.current.get(code)?.history || [], at: Date.now() });
      }).catch(failure => { if (request === detailRequest.current) setDetailError(userMessage(failure.message)); })
        .finally(() => { if (request === detailRequest.current) setDetailLoading(false); }),
      apiFetch(`/honorarios/catalog/${encodeURIComponent(code)}/history`).then(result => {
        if (request !== detailRequest.current) return;
        setHistory(result.history || []);
        const current = detailCache.current.get(code);
        if (current) detailCache.current.set(code, { ...current, history: result.history || [] });
      }).catch(() => {})
    ]);
  }, []);

  const refreshHistory = code => {
    apiFetch(`/honorarios/catalog/${encodeURIComponent(code)}/history`).then(result => {
      const current = detailCache.current.get(code);
      if (current) detailCache.current.set(code, { ...current, history: result.history || [] });
      if (selectedCodeRef.current === code) setHistory(result.history || []);
    }).catch(() => {});
  };
  const updateItem = value => {
    if (!value) throw new Error('No se recibió el servicio actualizado. Usa Actualizar para comprobar el cambio.');
    const updated = withProfessionalScope(value);
    setItems(previous => previous.map(item => item.itemCode === updated.itemCode ? updated : item));
    return updated;
  };

  useEffect(() => {
    setTariffs([]);
    setHistory([]);
    setTariff(blankTariff());
    setTariffEditorOpen(false);
    if (selectedCode) loadDetails(selectedCode);
    else { detailRequest.current += 1; setDetailLoading(false); }
  }, [selectedCode, loadDetails]);

  const filtered = useMemo(() => filterCatalogItems(scopedItems, { search, status }), [scopedItems, search, status]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visiblePage = Math.min(page, pageCount - 1);
  const visibleItems = filtered.slice(visiblePage * PAGE_SIZE, (visiblePage + 1) * PAGE_SIZE);
  const counts = useMemo(() => scopedItems.reduce((result, item) => {
    result[item.status] = (result[item.status] || 0) + 1;
    return result;
  }, {}), [scopedItems]);
  const providerNames = useMemo(() => new Map(providers.map(provider => [String(provider.id), provider.name])), [providers]);
  const exportCatalog = async () => {
    const filters = { view: catalogView, status, search, reviewOtherConcepts };
    setExporting(true); setExportError('');
    try {
      const result = await apiFetch('/honorarios/catalog/export-data');
      if (!Array.isArray(result?.items) || result.items.some(item => !Array.isArray(item?.tariffs))) {
        throw new Error('No se recibió la lista completa de precios. Intenta descargarla nuevamente.');
      }
      const workbook = createCatalogExportSheets(result.items, filters, providerNames, result.snapshotAt);
      if (!workbook.servicesCount) throw new Error('No hay servicios con los filtros elegidos. Actualiza el catálogo o cambia los filtros.');
      await downloadInstitutionalExcel({ filename: `Catalogo_Precios_Honorarios_${localToday()}_${filters.view.toLowerCase()}.xlsx`, sheets: workbook.sheets });
    } catch (failure) { setExportError(userMessage(failure.message)); }
    finally { setExporting(false); }
  };

  const notifyChange = () => { if (onChanged) onChanged(); };
  const finishSave = (updated, action) => {
    const code = updated.itemCode;
    setMessage(isApproved(updated)
      ? `${action} guardada. ${code} ya está en Aprobados y sus servicios aparecerán al médico según la tarifa y las fechas autorizadas.`
      : `${action} guardada. ${code} ${updated.status === 'EXCLUIDO' ? 'quedó excluido.'
        : updated.status === 'INCLUIDO' ? 'necesita una tarifa autorizada para pasar a Aprobados.' : 'sigue por configurar.'}`);
  };
  const handleSync = async () => {
    if (syncing || saving) return;
    setSyncing(true);
    setMessage('');
    setError('');
    try {
      const result = await apiFetch('/honorarios/catalog/sync', { method: 'POST' });
      detailCache.current.clear();
      notifyChange();
      if (result.items) { setItems(result.items.map(withProfessionalScope)); setSync(result.sync || null); }
      else await loadCatalog();
      setMessage('Catálogo actualizado. Los servicios nuevos quedan por configurar.');
    } catch (failure) { setError(userMessage(failure.message)); }
    finally { setSyncing(false); }
  };

  const handleSaveConfig = async event => {
    event.preventDefault();
    if (!selected || !config || saving || !canManage) return;
    setSaving(true);
    setDetailError('');
    setMessage('');
    try {
      const result = await apiFetch(`/honorarios/catalog/${encodeURIComponent(selected.itemCode)}`, {
        method: 'PUT', body: { expectedRevision: config.revision, status: config.status,
          modality: config.modality }
      });
      const updated = updateItem(result.item);
      notifyChange();
      refreshHistory(selected.itemCode);
      finishSave(updated, 'Configuración');
    } catch (failure) {
      setDetailError(userMessage(failure.status === 409
        ? `${failure.message} Actualiza el catálogo para revisar la versión actual antes de guardar.` : failure.message));
    } finally { setSaving(false); }
  };

  const handleSaveTariff = async event => {
    event.preventDefault();
    if (!selected || saving || !canManage) return;
    const amount = Number(tariff.amount);
    if (!Number.isFinite(amount) || amount <= 0) { setDetailError('El honorario debe ser mayor a cero.'); return; }
    if (!tariff.validFrom || (tariff.validTo && tariff.validTo < tariff.validFrom)) {
      setDetailError(!tariff.validFrom ? 'Indica la fecha inicial de la tarifa.'
        : 'La fecha final debe ser igual o posterior a la fecha inicial.'); return;
    }
    setSaving(true);
    setDetailError('');
    setMessage('');
    try {
      const result = await apiFetch(`/honorarios/catalog/${encodeURIComponent(selected.itemCode)}/tariffs`, {
        method: 'POST', body: { ...(tariff.id ? { id: tariff.id } : {}), providerId: tariff.providerId || null,
          role: tariff.role.trim() || null, amount, validFrom: tariff.validFrom, validTo: tariff.validTo || null,
          expectedRevision: tariff.revision, active: tariff.active }
      });
      const updated = updateItem(result.item);
      const updatedTariffs = [...tariffs.filter(value => value.id !== result.tariff.id), result.tariff];
      setTariffs(updatedTariffs);
      detailRequest.current += 1;
      detailCache.current.set(selected.itemCode, { tariffs: updatedTariffs, history, at: Date.now() });
      notifyChange();
      refreshHistory(selected.itemCode);
      setTariff(blankTariff());
      setTariffEditorOpen(false);
      finishSave(updated, 'Tarifa');
    } catch (failure) {
      setDetailError(userMessage(failure.status === 409
        ? `${failure.message} Actualiza el catálogo y revisa las vigencias antes de guardar.` : failure.message));
    } finally { setSaving(false); }
  };

  const editTariff = value => {
    setTariff({ id: value.id, providerId: value.providerId === null || value.providerId === undefined ? '' : String(value.providerId),
      role: value.role || '', amount: String(value.amount), validFrom: String(value.validFrom).slice(0, 10),
      validTo: value.validTo ? String(value.validTo).slice(0, 10) : '', active: value.active !== false,
      revision: value.revision });
    setTariffEditorOpen(true);
    setDetailError('');
  };

  return (
    <section className="hon-catalog" aria-label="Catálogo de servicios y tarifas de honorarios">
      <div className="hon-card hon-catalog-intro">
        <div className="hon-catalog-intro-copy">
          <h2>Servicios y tarifas para pago</h2>
          <p>Elige los servicios que se pagarán a los médicos y cuánto se pagará por cada uno.</p>
          <p className="hon-catalog-muted">Al incluir un servicio y guardar su tarifa, aparecerá en Aprobados y quedará disponible para revisar las atenciones del médico.</p>
        </div>
        <div className="hon-catalog-sync">
          <div className="hon-catalog-sync-actions">
            <button type="button" className="hon-catalog-button hon-catalog-primary" disabled={!canManage || syncing || saving || loading}
              onClick={handleSync}>{syncing ? 'Actualizando…' : 'Buscar servicios nuevos'}</button>
            <button type="button" className="hon-catalog-button" disabled={loading || syncing || saving} onClick={() => loadCatalog().then(() => {
              if (selectedCode) loadDetails(selectedCode, true);
            }).catch(() => {})}>Actualizar</button>
          </div>
          <span className="hon-catalog-muted">{sync?.lastSuccess ? `Última actualización: ${timestampLabel(sync.lastSuccess)}` : 'Aún no se ha actualizado el catálogo'}</span>
        </div>
      </div>
      {sync?.lastError && <div className="hon-catalog-alert" role="alert">No se pudo actualizar el catálogo. Puedes consultar los servicios guardados e intentar de nuevo más tarde.</div>}
      {error && <div className="hon-catalog-alert" role="alert">{userMessage(error)}</div>}
      {message && <div className="hon-catalog-success" role="status">{message}</div>}
      {!canManage && <p className="hon-catalog-muted">Tu acceso permite consultar el catálogo. Los cambios requieren permiso para administrar honorarios.</p>}
      <div className="hon-catalog-layout">
        <div className="hon-card hon-catalog-list">
          <div className="hon-catalog-view-toggle" role="group" aria-label="Apartados del catálogo">
            <button type="button" className={`hon-catalog-button${catalogView === 'APROBADOS' ? ' hon-catalog-primary' : ''}`}
              aria-pressed={catalogView === 'APROBADOS'} onClick={() => changeCatalogView('APROBADOS')}>
              Aprobados ({approvedItems.length.toLocaleString()})
            </button>
            <button type="button" className={`hon-catalog-button${catalogView === 'RECOMENDADOS' ? ' hon-catalog-primary' : ''}`}
              aria-pressed={catalogView === 'RECOMENDADOS'} onClick={() => changeCatalogView('RECOMENDADOS')}>
              Recomendados ({recommendedItems.length.toLocaleString()})
            </button>
            <button type="button" className={`hon-catalog-button${catalogView === 'TODOS' ? ' hon-catalog-primary' : ''}`}
              aria-pressed={catalogView === 'TODOS'} onClick={() => changeCatalogView('TODOS')}>
              Todos los servicios ({workingItems.length.toLocaleString()})
            </button>
          </div>
          {catalogView === 'RECOMENDADOS' && <p className="hon-catalog-muted hon-catalog-view-description">
            Servicios con un precio de referencia que aún necesitan configuración. Al aprobarlos, pasarán a la lista de Aprobados.
          </p>}
          {catalogView === 'APROBADOS' && <p className="hon-catalog-muted hon-catalog-view-description">
            Estos servicios ya tienen configuración y tarifa autorizada. En Revisar servicios aparecerán las atenciones del médico al que aplica la tarifa, dentro de sus fechas de vigencia.
          </p>}
          <div className="hon-catalog-filters">
            <label className="hon-catalog-search">Buscar servicio
              <input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} placeholder="Código, descripción o grupo" />
            </label>
            <label>Estado
              <select value={status} onChange={event => { setStatus(event.target.value); setPage(0); }}>
                <option value="TODOS">Todos ({scopedItems.length.toLocaleString()})</option>
                {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label} ({(counts[value] || 0).toLocaleString()})</option>)}
              </select>
            </label>
          </div>
          <div className="hon-catalog-other-concepts">
            <label className="hon-catalog-checkbox"><input type="checkbox" checked={reviewOtherConcepts}
              onChange={event => { setReviewOtherConcepts(event.target.checked); setPage(0); }} />Revisar otros conceptos</label>
            <p className="hon-catalog-muted">Permite revisar servicios cuya relación con el pago a médicos aún debe confirmarse.</p>
          </div>
          <div className="hon-catalog-export">
            <p className="hon-catalog-muted">Incluye todos los resultados de estos filtros, de todas las páginas.</p>
            <button type="button" className="hon-catalog-button" disabled={loading || syncing || saving || exporting || !filtered.length}
              onClick={exportCatalog}>{exporting ? 'Preparando Excel…' : 'Descargar Excel'}</button>
          </div>
          {exportError && <p className="hon-catalog-alert hon-catalog-export-error" role="alert">{exportError}</p>}
          <div className="hon-catalog-table-scroll">
            <table className="hon-catalog-table">
              <thead><tr><th>Servicio</th><th>Configuración</th><th>Tarifas</th><th><span className="hon-catalog-visually-hidden">Seleccionar</span></th></tr></thead>
              <tbody>
                {visibleItems.map(item => <tr key={item.itemCode} className={item.itemCode === selectedCode ? 'hon-catalog-selected' : ''}>
                  <td><strong>{item.description || item.name || item.itemCode}</strong><span className="hon-catalog-muted">{item.itemCode} · {item.groupName || 'Grupo sin informar'}</span>
                    {item.active === false && <span className="hon-catalog-muted">Servicio inactivo</span>}</td>
                  <td><span className={`hon-catalog-badge hon-catalog-status-${isApproved(item) ? 'configurado' : item.status === 'EXCLUIDO' || item.active === false ? 'excluido' : 'pendiente'}`}>{approvalLabel(item)}</span>
                    {item.professionalCandidate === false && item.status !== 'INCLUIDO'
                      && <span className="hon-catalog-warning">Revisar si genera honorarios</span>}
                    {item.modality === 'contact_center' && <span className="hon-catalog-muted">Contact Center</span>}
                    {item.referenceChanged && <span className="hon-catalog-reference-change">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                        <path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 7a7 7 0 0 1 11.7-1L20 9M4 15l2.2 3A7 7 0 0 0 17.9 17" />
                      </svg><span>Cambió el precio de referencia en Vertical</span>
                    </span>}</td>
                  <td>{Number(item.tariffCount) > 0 ? `${item.tariffCount} registrada${Number(item.tariffCount) === 1 ? '' : 's'}` : 'Por definir'}</td>
                  <td><button type="button" className="hon-catalog-button" disabled={saving || syncing} onClick={() => { setSelectedCode(item.itemCode); setMessage(''); }}
                    aria-label={`Configurar ${item.itemCode}`} aria-pressed={item.itemCode === selectedCode}>Ver</button></td>
                </tr>)}
                {!visibleItems.length && <tr><td colSpan="4" className="hon-catalog-empty">{loading ? 'Cargando servicios…' : 'No hay servicios con estos filtros.'}</td></tr>}
              </tbody>
            </table>
          </div>
          <nav className="hon-catalog-pagination" aria-label="Páginas del catálogo">
            <span>{filtered.length.toLocaleString()} servicios{loading ? ' · actualizando…' : ''}</span>
            <div><button type="button" className="hon-catalog-button" disabled={visiblePage === 0} onClick={() => setPage(visiblePage - 1)}>Anterior</button>
              <span>{visiblePage + 1} / {pageCount}</span>
              <button type="button" className="hon-catalog-button" disabled={visiblePage + 1 >= pageCount} onClick={() => setPage(visiblePage + 1)}>Siguiente</button></div>
          </nav>
        </div>
        <aside className="hon-card hon-catalog-detail" aria-label="Configuración del servicio seleccionado">
          {!selected || !config ? <div className="hon-catalog-empty"><h3>Selecciona un servicio</h3><p>Revisa sus precios, elige si se pagará y registra la tarifa y las fechas en que se aplicará.</p></div> : <>
            <div className="hon-catalog-detail-heading"><span className="hon-catalog-muted">{selected.itemCode}</span><h3>{selected.description || selected.name}</h3><p>{selected.groupName}</p></div>
            <div className={`hon-catalog-readiness${isApproved(selected) ? ' is-approved' : ''}`}>
              <strong>{isApproved(selected) ? 'Aprobado para revisar servicios' : 'Completa la configuración'}</strong>
              <ol>
                <li className={selected.status === 'INCLUIDO' ? 'is-complete' : ''}>
                  <span aria-hidden="true">{selected.status === 'INCLUIDO' ? '✓' : '1'}</span>Servicio incluido para pago
                </li>
                <li className={Number(selected.approvedTariffCount ?? selected.tariffCount) > 0 ? 'is-complete' : ''}>
                  <span aria-hidden="true">{Number(selected.approvedTariffCount ?? selected.tariffCount) > 0 ? '✓' : '2'}</span>Tarifa autorizada registrada
                </li>
              </ol>
              {isApproved(selected) && onReviewServices && <button type="button" className="hon-catalog-button hon-catalog-primary"
                disabled={saving || syncing} onClick={() => onReviewServices(selected)}>Ver servicios de este concepto</button>}
            </div>
            {detailError && <div className="hon-catalog-alert" role="alert">{userMessage(detailError)}</div>}
            {selected.professionalCandidate === false && selected.status !== 'INCLUIDO' && <div className="hon-catalog-note">
              Confirma si este servicio corresponde al trabajo de un médico y quién recibe el honorario antes de incluirlo.
              {selected.scopeReason && <p>{selected.scopeReason}</p>}
            </div>}
            <form onSubmit={handleSaveConfig} className="hon-catalog-form">
              <fieldset disabled={!canManage || saving || syncing}>
                <label>Incluir en honorarios
                  <select value={config.status} onChange={event => setConfig({ ...config, status: event.target.value })}>
                    {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}
                      disabled={value === 'INCLUIDO' && (selected.scopeExcluded || selected.active === false)}>{label}</option>)}
                  </select>
                </label>
                <label>Tipo de atención
                  <select value={config.modality} onChange={event => setConfig({ ...config, modality: event.target.value })}>
                    <option value="presencial">Presencial</option><option value="contact_center">Contact Center / en línea</option>
                  </select>
                </label>
                {config.modality === 'contact_center' && <p className="hon-catalog-note">Para las sesiones en línea, confirma que la sesión se realizó. Revisa cada servicio antes de aprobar el pago.</p>}
                <button className="hon-catalog-button hon-catalog-primary" type="submit">{saving ? 'Guardando…' : 'Guardar configuración'}</button>
              </fieldset>
              {selected.updatedAt && <p className="hon-catalog-muted">Último cambio: {selected.updatedBy || 'Responsable registrado'} · {timestampLabel(selected.updatedAt)}</p>}
            </form>
            <details className="hon-catalog-reference">
              <summary>Precios de referencia ({selected.referencePrices?.length || 0})</summary>
              <p className="hon-catalog-muted">Estos precios se consultan desde Vertical. Úsalos como guía y registra el importe autorizado para pagar al médico.</p>
              {(selected.referencePrices || []).map((reference, index) => <div className="hon-catalog-reference-row" key={reference.id ?? index}>
                <strong>{money(reference.amount)}</strong>{reference.notes && <p>{reference.notes}</p>}
                {referenceChangeLabel(reference) && <p className="hon-catalog-muted hon-catalog-reference-audit">{referenceChangeLabel(reference)}</p>}
              </div>)}
              {!selected.referencePrices?.length && <p>Sin precio de referencia.</p>}
              {(selected.referenceWarnings || []).map((warning, index) => <p key={index} className="hon-catalog-warning">{userMessage(warning)}</p>)}
            </details>
            <div className="hon-catalog-tariffs">
              <div className="hon-catalog-section-heading"><h3>Tarifas autorizadas</h3>
                <button type="button" className="hon-catalog-button" disabled={!canManage || saving || syncing || detailLoading || selected.scopeExcluded || selected.active === false}
                  onClick={() => { setTariff(blankTariff()); setTariffEditorOpen(true); setDetailError(''); }}>Agregar tarifa</button>
              </div>
              <p className="hon-catalog-muted">El importe se aplica según la fecha del servicio. Puedes definir una tarifa para todos los médicos o una para un médico o función en particular.</p>
              {detailLoading ? <p>Cargando tarifas…</p> : !tariffs.length ? <p className="hon-catalog-note">Aún no hay una tarifa autorizada. Regístrala para poder calcular el pago.</p>
                : <div className="hon-catalog-tariff-list">{tariffs.map(value => <div key={value.id} className={`hon-catalog-tariff-card${value.active === false ? ' hon-catalog-tariff-inactive' : ''}`}>
                  <div><strong>{money(value.amount)}</strong><span className="hon-catalog-muted">{value.providerId ? providerNames.get(String(value.providerId)) || `Médico ${value.providerId}` : 'Tarifa general'}{value.role ? ` · ${ROLE_LABELS[value.role] || value.role}` : ''}</span></div>
                  <span>{dateLabel(value.validFrom)} — {value.validTo ? dateLabel(value.validTo) : 'sin fecha final'}</span>
                  <div className="hon-catalog-tariff-footer"><span className="hon-catalog-muted">{value.active === false ? 'Inactiva' : 'Activa'}{value.updatedBy ? ` · ${value.updatedBy}` : ''}</span>
                    <button type="button" className="hon-catalog-button" disabled={!canManage || saving || syncing} onClick={() => editTariff(value)}>Editar</button></div>
                </div>)}</div>}
              {tariffEditorOpen && <form className="hon-catalog-form hon-catalog-tariff-editor" onSubmit={handleSaveTariff}>
                <h4>{tariff.id ? 'Editar tarifa' : 'Nueva tarifa'}</h4>
                <fieldset disabled={!canManage || saving || syncing}>
                  <label>Médico
                    <select value={tariff.providerId} onChange={event => setTariff({ ...tariff, providerId: event.target.value })}>
                      <option value="">Tarifa general para todos los médicos</option>
                      {tariff.providerId && !providerNames.has(tariff.providerId) && <option value={tariff.providerId}>Médico {tariff.providerId}</option>}
                      {providers.map(provider => <option key={provider.id} value={String(provider.id)}>{provider.name}</option>)}
                    </select>
                  </label>
                  {providerError && <p className="hon-catalog-warning">No se pudo cargar la lista de médicos: {userMessage(providerError)}</p>}
                  <div className="hon-catalog-form-columns">
                    <label>Función del médico (opcional)
                      <select aria-label="Función del médico (opcional)" value={tariff.role} onChange={event => setTariff({ ...tariff, role: event.target.value })}>
                        <option value="">Todas las funciones</option>
                        {tariff.role && !ROLE_LABELS[tariff.role] && <option value={tariff.role}>{tariff.role}</option>}
                        {Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    <label>Honorario por unidad ($)<input type="number" min="0.01" max="1000000000" step="0.01" required value={tariff.amount}
                      onChange={event => setTariff({ ...tariff, amount: event.target.value })} /></label>
                  </div>
                  <div className="hon-catalog-form-columns">
                    <label>Se aplica desde<input type="date" required value={tariff.validFrom} onChange={event => setTariff({ ...tariff, validFrom: event.target.value })} /></label>
                    <label>Se aplica hasta (opcional)<input type="date" value={tariff.validTo} min={tariff.validFrom} onChange={event => setTariff({ ...tariff, validTo: event.target.value })} /></label>
                  </div>
                  <p className="hon-catalog-muted">Las atenciones anteriores a Se aplica desde quedan fuera de esta tarifa. Para revisar un periodo histórico, indica la fecha inicial autorizada.</p>
                  <label className="hon-catalog-checkbox"><input type="checkbox" checked={tariff.active} onChange={event => setTariff({ ...tariff, active: event.target.checked })} />Tarifa activa</label>
                  <p className="hon-catalog-muted">Usa una sola tarifa por médico y función para cada fecha. Si el precio cambia, indica cuándo termina la tarifa anterior y cuándo empieza la nueva.</p>
                  <div className="hon-catalog-actions"><button className="hon-catalog-button hon-catalog-primary" type="submit">{saving ? 'Guardando…' : 'Guardar tarifa'}</button>
                    <button className="hon-catalog-button" type="button" onClick={() => setTariffEditorOpen(false)}>Cancelar</button></div>
                </fieldset>
              </form>}
            </div>
            {!!history.length && <details className="hon-catalog-history"><summary>Historial de cambios ({history.length})</summary>
              {history.map((entry, index) => <div key={entry.id ?? index} className="hon-catalog-history-row">
                <strong>{entry.reason || entry.payload?.current?.reason || entry.motivo || 'Cambio registrado'}</strong>
                <span>{historyDescription(entry)}</span>
                <span className="hon-catalog-muted">{entry.updatedBy || entry.actor || entry.createdBy || 'Responsable registrado'} · {timestampLabel(entry.updatedAt || entry.createdAt || entry.timestamp)}</span>
              </div>)}
            </details>}
          </>}
        </aside>
      </div>
    </section>
  );
}
