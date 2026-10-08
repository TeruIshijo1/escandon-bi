import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { userMessage } from '../../utils/userMessages';
import { fiscalCategories, fiscalCategory } from '../../utils/honorariosFiscalDirectory';

const empty = { federalTaxId: '', fiscalRegime: '', validFrom: '', isrRate: '', vatFraction: '', defaultVatRate: '', enabled: true };
const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const fields = data => ({ ...empty, ...data, isrRate: data?.isrRate ?? '', vatFraction: data?.vatFraction ?? '', defaultVatRate: data?.defaultVatRate ?? '' });

export default function HonorariosFiscalPanel({ providers, profiles, initialProviderId = '', referenceDate, canManage, onSaved, onBack }) {
  const [providerId, setProviderId] = useState(initialProviderId);
  const [category, setCategory] = useState('pending');
  const [search, setSearch] = useState('');
  const [directory, setDirectory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [directoryError, setDirectoryError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [form, setForm] = useState(empty);
  const [expectedRevision, setExpectedRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const initialCategory = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState(null);
  const historyRequest = useRef(0);
  const profile = profiles[providerId];
  const provider = providers.find(item => String(item.id) === providerId);
  const entries = providers.map(item => {
    const doctor = directory?.doctors?.find(row => String(row.providerId) === String(item.id)) || { providerId: String(item.id) };
    return { ...item, doctor, status: fiscalCategory(doctor, profiles[item.id], referenceDate) };
  });
  const selected = entries.find(item => String(item.id) === providerId);
  const sapSuggestion = selected?.doctor.suggestedProfile;
  const hasSapData = selected?.doctor.sap?.linkStatus === 'candidato_unico';

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setDirectoryError('');
    apiFetch('/honorarios/fiscal-directory', { params: { date: referenceDate, refresh: refresh > 0 ? 'true' : undefined }, signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setDirectory(result); })
      .catch(failure => { if (!controller.signal.aborted) { setDirectory(null); setDirectoryError(userMessage(failure.message)); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [referenceDate, refresh]);

  useEffect(() => {
    historyRequest.current += 1;
    dirtyRef.current = false; setDirty(false); setError(''); setMessage(''); setHistory(null);
  }, [providerId]);
  useEffect(() => () => { historyRequest.current += 1; }, []);
  useEffect(() => {
    // Actualizar SAP no borra una captura ni cambia su revisión de guardado.
    if (dirtyRef.current) return;
    setForm(fields(profile || sapSuggestion)); setExpectedRevision(profile?.revision || 0);
  }, [providerId, profile, sapSuggestion]);
  useEffect(() => {
    if (!initialCategory.current && directory && selected && initialProviderId) {
      setCategory(selected.status.key); initialCategory.current = true;
    }
  }, [directory, selected, initialProviderId]);
  const field = (key, value) => { dirtyRef.current = true; setDirty(true); setForm(previous => ({ ...previous, [key]: value })); };
  const filtered = entries.filter(item => (category === 'all' || item.status.key === category)
    && normalize(`${item.name} ${item.id}`).includes(normalize(search)));
  const save = async event => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const result = await apiFetch(`/honorarios/fiscal-profiles/${providerId}`, { method: 'PUT', body: {
        ...form, expectedRevision,
        isrRate: form.isrRate === '' ? null : Number(form.isrRate), vatFraction: form.vatFraction === '' ? null : Number(form.vatFraction),
        defaultVatRate: form.defaultVatRate === '' ? null : Number(form.defaultVatRate)
      } });
      dirtyRef.current = false; setDirty(false); setExpectedRevision(result.profile.revision); setForm(fields(result.profile));
      onSaved(result.profile); setCategory(result.profile.enabled ? 'internal' : 'all'); setHistory(null);
      setMessage(result.profile.enabled ? 'Datos guardados internamente. Ya puedes volver a Pagos y PDF.' : 'Ficha interna desactivada. Se vuelve a utilizar SAP cuando sus datos están completos.');
    } catch (failure) { setError(userMessage(failure.message)); } finally { setBusy(false); }
  };
  return <section className="hon-card hon-fiscal-panel" style={{ padding: '1.25rem' }}>
    <h2>Datos fiscales de médicos</h2>
    <p>Elige un grupo y busca al médico. Puedes corregir sus datos de SAP y guardarlos internamente.</p>
    <div className="hon-fiscal-categories" role="group" aria-label="Grupos de datos fiscales">
      {fiscalCategories.map(item => <button key={item.key} type="button" aria-pressed={category === item.key} disabled={busy}
        className={`hon-fiscal-category ${item.key}`} onClick={() => { setCategory(item.key); setSearch(''); }}>
        <strong>{item.label}</strong><span>{loading && item.key === 'sap' ? 'Consultando…' : entries.filter(row => row.status.key === item.key).length}</span>
      </button>)}
    </div>
    <div className="hon-fiscal-tools">
      <button type="button" className="hon-friendly-button subtle" aria-pressed={category === 'all'} disabled={busy} onClick={() => { setCategory('all'); setSearch(''); }}>Ver todos ({entries.length})</button>
      <button type="button" className="hon-friendly-button subtle" disabled={loading || busy} onClick={() => setRefresh(value => value + 1)}>{loading ? 'Consultando SAP…' : 'Actualizar SAP'}</button>
    </div>
    <p className="hon-fiscal-help">Estado para servicios desde {referenceDate?.split('-').reverse().join('/')}. Listos con SAP incluye retenciones para servicios con y sin IVA.
      {directory?.asOf && <> Consulta: {new Date(directory.asOf).toLocaleString('es-MX')}.</>}</p>
    {(directoryError || directory?.warning) && <p role="alert" className="hon-friendly-message error">{directoryError || directory.warning}</p>}
    <label>Buscar médico<input aria-label="Buscar médico fiscal" className="hon-input" value={search} disabled={busy} onChange={event => setSearch(event.target.value)} placeholder="Escribe su nombre o número" /></label>
    <label>Médico<select aria-label="Médico fiscal" className="hon-input" value={providerId} disabled={busy} onChange={event => setProviderId(event.target.value)}>
      <option value="">Selecciona al médico</option>
      {filtered.map(item => <option key={item.id} value={item.id}>{item.name} · #{item.id}</option>)}
      {provider && !filtered.some(item => String(item.id) === providerId) && <option value={providerId}>{provider.name} · #{provider.id} · Selección actual</option>}
    </select></label>
    {!loading && !filtered.length && <p role="status">No hay médicos en este grupo con esa búsqueda. Puedes pulsar Ver todos.</p>}
    {error && <p role="alert" className="hon-friendly-message error">{error}</p>}
    {message && <p role="status" className="hon-friendly-message">{message}</p>}
    {provider && <form onSubmit={save} style={{ display: 'grid', gap: '1rem', marginTop: '1rem' }}>
      <div className={`hon-fiscal-source ${selected.status.key}`}>
        <strong>{provider.name} · #{provider.id}</strong><p>{selected.status.detail}</p>
        {hasSapData && <p>Proveedor SAP: {selected.doctor.sap.candidates[0].cardName} ({selected.doctor.sap.candidates[0].cardCode}).</p>}
        <p>{profile ? 'Se muestra tu ficha interna guardada.' : hasSapData ? 'Datos disponibles de SAP precargados. Completa los campos vacíos y confirma los datos antes de guardar.' : 'Completa los datos con la constancia fiscal y la información confirmada por Contabilidad.'} Al guardar se usa la ficha interna. SAP conserva sus datos.</p>
        {profile && hasSapData && canManage && <button type="button" className="hon-friendly-button" disabled={busy} onClick={() => {
          dirtyRef.current = true; setDirty(true); setForm(fields(sapSuggestion)); setMessage('Datos de SAP copiados a la ficha. Completa los campos vacíos y guarda para aplicar el cambio.');
        }}>Copiar datos de SAP a la ficha</button>}
      </div>
      <div className="hon-fiscal-grid">
        <label>RFC<input aria-label="RFC del médico" className="hon-input" required={form.enabled} maxLength={13} value={form.federalTaxId} disabled={busy || !canManage} onChange={event => field('federalTaxId', event.target.value.toUpperCase())} /></label>
        <label>Régimen fiscal<input aria-label="Régimen fiscal del médico" className="hon-input" required={form.enabled} pattern="[0-9]{3}" maxLength={3} placeholder="Código de 3 dígitos de la constancia" value={form.fiscalRegime} disabled={busy || !canManage} onChange={event => field('fiscalRegime', event.target.value)} /></label>
        <label>Aplicar a servicios desde<input aria-label="Vigencia fiscal" className="hon-input" type="date" required={form.enabled} value={form.validFrom} disabled={busy || !canManage} onChange={event => field('validFrom', event.target.value)} /></label>
        <label>IVA habitual<select aria-label="IVA habitual" className="hon-input" required={form.enabled} value={form.defaultVatRate} disabled={busy || !canManage} onChange={event => field('defaultVatRate', event.target.value)}>
          <option value="">Selecciona</option><option value="0">Sin IVA</option><option value="0.16">16%</option><option value="0.08">8%</option>
        </select></label>
        <label>Retención de ISR<select aria-label="ISR del médico" className="hon-input" required={form.enabled} value={form.isrRate} disabled={busy || !canManage} onChange={event => field('isrRate', event.target.value)}>
          <option value="">Selecciona</option><option value="0">Sin retención</option><option value="0.1">10%</option><option value="0.0125">1.25%</option>
        </select></label>
        <label>Retención de IVA<select aria-label="Retención IVA del médico" className="hon-input" required={form.enabled} value={form.vatFraction} disabled={busy || !canManage} onChange={event => field('vatFraction', event.target.value)}>
          <option value="">Selecciona</option><option value="0">Sin retención</option><option value={2 / 3}>Dos terceras partes del IVA</option>
        </select></label>
      </div>
      <p className="hon-fiscal-help">El IVA y su retención son distintos. El IVA habitual se propone en nuevas aprobaciones. El IVA ya aprobado y los pagos preparados se conservan.</p>
      {dirty && <p role="status" className="hon-fiscal-help">Tienes cambios sin guardar.</p>}
      <div className="hon-friendly-actions"><button className="hon-friendly-button primary" disabled={busy || !canManage}>{busy ? 'Guardando…' : 'Guardar datos fiscales'}</button>
        {onBack && <button type="button" className="hon-friendly-button" disabled={busy} onClick={onBack}>Volver al pago</button>}</div>
      <details><summary>Opciones e historial</summary>
        <label className="hon-fiscal-enable"><input type="checkbox" checked={form.enabled} disabled={busy || !canManage} onChange={event => field('enabled', event.target.checked)} /> Usar esta ficha interna para calcular impuestos</label>
        <p>Al desactivarla se vuelve a consultar SAP. Los cambios conservan responsable, fecha e historial.</p>
        {profile && <p>Último cambio: {profile.updatedBy} · {new Date(profile.updatedAt).toLocaleString('es-MX')}</p>}
        <button type="button" className="hon-friendly-button subtle" disabled={busy} onClick={async () => {
          const request = ++historyRequest.current;
          try {
            const result = await apiFetch(`/honorarios/fiscal-profiles/${providerId}/history`);
            if (request === historyRequest.current) setHistory(result.history);
          } catch (failure) {
            if (request === historyRequest.current) setError(userMessage(failure.message));
          }
        }}>Ver historial</button>
        {history?.map(item => <p key={item.revision}>Versión {item.revision} · {item.updated_by} · {new Date(item.updated_at).toLocaleString('es-MX')} · {item.payload.enabled ? `RFC ${item.payload.federalTaxId}, régimen ${item.payload.fiscalRegime}, ISR ${item.payload.isrRate * 100}%, retención IVA ${item.payload.vatFraction ? 'dos tercios' : 'sin retención'}` : 'Ficha desactivada'}</p>)}
      </details>
    </form>}
  </section>;
}
