import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { userMessage } from '../../utils/userMessages';
import './HonorariosMonthlyFixedPanel.css';

const initialList = [
  ['ALFAN GUZMAN FELIPE', 'GINECOLOGÍA', 2500],
  ['GARCIA TORRES LUIS JERONIMO', 'CIRUGÍA GENERAL', 2500],
  ['ORRICO GALVEZ RUBEN DARIO', 'ORTOPEDIA', 2500],
  ['MEDINA PEREZ JUAN JOSE', 'ANESTESIOLOGÍA', 2500],
  ['MERAYO CHALICO FRANCISCO JAVIER', 'MEDICINA INTERNA', 2500],
  ['LOPEZ VEJAR CESAR EMMANUEL', 'INFECTOLOGÍA', 4500],
];
const nameKey = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
const money = value => Number(value).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const monthLabel = value => /^\d{4}-\d{2}$/.test(value || '') ? `${value.slice(5)}/${value.slice(0, 4)}` : 'Sin mes final';
const currentMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }).slice(0, 7);
const blank = month => ({ providerId: '', area: '', amount: '', validFromMonth: month, validToMonth: '', confirmed: false });

function AssignmentFields({ value, onChange, providers, disabled, editing = false, removing = false, suffix = '' }) {
  const change = (key, next) => onChange({ ...value, [key]: next, ...(key === 'providerId' ? { confirmed: false } : {}) });
  return <>
    {!removing && <div className="hon-monthly-grid">
      <label>Médico<select aria-label={`Médico del pago mensual${suffix}`} required value={value.providerId} disabled={disabled || editing}
        onChange={event => change('providerId', event.target.value)}>
        <option value="">Selecciona al médico del directorio</option>
        {providers.map(provider => <option key={provider.id} value={String(provider.id)}>{provider.name} · #{provider.id}</option>)}
        {editing && !providers.some(provider => String(provider.id) === value.providerId) && <option value={value.providerId}>{value.providerName} · #{value.providerId}</option>}
      </select></label>
      <label>Área<input aria-label={`Área del jefe${suffix}`} required maxLength={120} value={value.area} disabled={disabled}
        onChange={event => change('area', event.target.value)} /></label>
      <label>Pago mensual antes de impuestos<input aria-label={`Pago mensual antes de impuestos${suffix}`} type="number" min="0.01" step="0.01" required
        value={value.amount} disabled={disabled} onChange={event => change('amount', event.target.value)} /></label>
      <label>Aplicar desde el mes<input aria-label={`Aplicar desde el mes${suffix}`} type="month" required value={value.validFromMonth} disabled={disabled}
        onChange={event => change('validFromMonth', event.target.value)} /></label>
      <label>Aplicar hasta el mes (opcional)<input aria-label={`Aplicar hasta el mes${suffix}`} type="month" min={value.validFromMonth} value={value.validToMonth || ''}
        disabled={disabled} onChange={event => change('validToMonth', event.target.value)} /></label>
    </div>}
    {removing && <label>Quitar desde el mes<input aria-label="Quitar desde el mes" type="month" required value={value.deactivatedFromMonth} disabled={disabled}
      onChange={event => change('deactivatedFromMonth', event.target.value)} /></label>}
    {!editing && !removing && <label className="hon-monthly-confirm"><input type="checkbox" required checked={value.confirmed} disabled={disabled}
      onChange={event => change('confirmed', event.target.checked)} />Confirmo que el médico seleccionado corresponde a esta jefatura.</label>}
  </>;
}

export default function HonorariosMonthlyFixedPanel({ canManage = false, onChanged, referenceMonth }) {
  const month = /^\d{4}-\d{2}$/.test(referenceMonth || '') ? referenceMonth : currentMonth();
  const [assignments, setAssignments] = useState([]);
  const [providers, setProviders] = useState([]);
  const [serverCanManage, setServerCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [providerError, setProviderError] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const request = useRef(0);
  const formRef = useRef(null);
  const allowed = canManage && serverCanManage && !loading && !loadError;

  const load = useCallback(async signal => {
    const id = ++request.current;
    setLoading(true); setLoadError(''); setProviderError(''); setServerCanManage(false);
    const results = await Promise.allSettled([
      apiFetch('/honorarios/monthly-fixed', { signal }),
      apiFetch('/honorarios/providers', { signal }),
    ]);
    if (id !== request.current || signal?.aborted) return;
    if (results[0].status === 'fulfilled') {
      setAssignments(results[0].value.assignments || []); setServerCanManage(results[0].value.canManage === true);
    } else { setAssignments([]); setLoadError(userMessage(results[0].reason.message)); }
    if (results[1].status === 'fulfilled') setProviders(results[1].value.providers || []);
    else { setProviders([]); setProviderError(userMessage(results[1].reason.message)); }
    setLoading(false);
  }, []);
  useEffect(() => {
    const controller = new AbortController(); load(controller.signal);
    return () => { request.current++; controller.abort(); };
  }, [load]);
  useEffect(() => { formRef.current?.querySelector('input:not(:disabled),select:not(:disabled)')?.focus(); }, [editor?.id, editor?.mode]);

  const begin = (assignment, mode = 'edit') => {
    setError(''); setMessage('');
    setEditor(assignment ? { ...assignment, providerId: String(assignment.providerId), validToMonth: assignment.validToMonth || '',
      confirmed: true, mode, deactivatedFromMonth: month } : { ...blank(month), mode: 'add' });
  };
  const save = async (event, value, proposalKey) => {
    event.preventDefault();
    if (!allowed || busy) return;
    setError(''); setMessage('');
    const removing = value.mode === 'remove';
    if (!removing && (!providers.some(provider => String(provider.id) === value.providerId) || (!value.id && !value.confirmed))) {
      setError('Selecciona y confirma al médico del directorio antes de guardar.'); return;
    }
    if (!removing && (!value.area.trim() || !Number.isFinite(Number(value.amount)) || Number(value.amount) <= 0)) {
      setError('Escribe el área y un pago mensual mayor a cero.'); return;
    }
    if (!/^\d{4}-\d{2}$/.test(removing ? value.deactivatedFromMonth : value.validFromMonth)
      || (!removing && value.validToMonth && value.validToMonth < value.validFromMonth)) {
      setError('Revisa los meses de vigencia del pago.'); return;
    }
    setBusy(true);
    try {
      const body = { providerId: value.providerId, area: value.area.trim(), amount: Number(value.amount), amountBasis: 'BASE',
        monthPolicy: 'FULL_MONTH', validFromMonth: value.validFromMonth, validToMonth: value.validToMonth || null,
        active: !removing, expectedRevision: value.id ? value.revision : 0 };
      if (removing) Object.assign(body, { deactivatedFromMonth: value.deactivatedFromMonth, reason: 'Pago mensual retirado de la jefatura desde el mes seleccionado.' });
      const result = await apiFetch(`/honorarios/monthly-fixed${value.id ? `/${encodeURIComponent(value.id)}` : ''}`, {
        method: value.id ? 'PUT' : 'POST', body,
      });
      if (!result.assignment?.id) throw new Error('No se pudo confirmar el cambio guardado. Actualiza la lista para revisarlo.');
      const assignment = result.assignment;
      await load();
      if (proposalKey !== undefined) setProposals(previous => previous.filter(item => item.key !== proposalKey));
      else setEditor(null);
      setMessage(removing ? `El pago de ${assignment.providerName} se dejó de aplicar desde ${monthLabel(value.deactivatedFromMonth)}.`
        : value.id ? `Pago mensual de ${assignment.providerName} actualizado. Si aún no preparas el pago, revisa nuevamente su aprobación.`
          : `Pago mensual de ${assignment.providerName} guardado. Cada mes debes elegir si lo apruebas en Servicios.`);
      onChanged?.(assignment);
    } catch (failure) { setError(userMessage(failure.message)); }
    finally { setBusy(false); }
  };
  const importList = () => {
    setError(''); setMessage('');
    setProposals(initialList.map(([name, area, amount], key) => {
      const matches = providers.filter(provider => nameKey(provider.name) === nameKey(name));
      return { ...blank(month), key, name, area, amount: String(amount), providerId: matches.length === 1 ? String(matches[0].id) : '',
        matchCount: matches.length };
    }));
  };
  const previousMonth = item => !!item.validToMonth && item.validToMonth < month;
  const filtered = assignments.filter(item => (showInactive || (item.active !== false && !previousMonth(item)))
    && nameKey(search).split(' ').filter(Boolean).every(token => nameKey(`${item.providerName} ${item.area}`).includes(token)));

  return <section className="hon-card hon-monthly-panel">
    <div className="hon-monthly-heading"><div><h2>Jefes de área</h2>
      <p>Configura el pago mensual antes de impuestos. Cada mes eliges si lo apruebas. Si lo apruebas, se suma a sus consultas.</p>
      <p className="hon-monthly-help">Cada importe corresponde a un mes completo. Cambiar el precio o quitar una jefatura conserva los pagos ya preparados.</p></div>
      <button type="button" className="hon-friendly-button subtle" disabled={loading || busy} onClick={() => load()}>{loading ? 'Consultando…' : 'Actualizar lista'}</button>
    </div>
    {(loadError || providerError) && <div role="alert" className="hon-monthly-error"><p>{loadError || providerError}</p>
      <button type="button" className="hon-friendly-button" disabled={busy || loading} onClick={() => load()}>Reintentar consulta</button></div>}
    {error && <p role="alert" className="hon-monthly-error">{error}</p>}
    {message && <p role="status" className="hon-monthly-success">{message}</p>}
    {!loading && !loadError && !allowed && <p className="hon-monthly-help">Puedes consultar los pagos mensuales. Tu acceso no permite cambiarlos.</p>}
    <div className="hon-monthly-tools">
      {allowed && <><button type="button" className="hon-friendly-button primary" disabled={busy || !!providerError} onClick={() => begin(null)}>Agregar jefe de área</button>
        <button type="button" className="hon-friendly-button" disabled={busy || !!providerError || proposals.length > 0} onClick={importList}>Cargar listado inicial</button></>}
      <label>Buscar<input aria-label="Buscar jefe de área" value={search} onChange={event => setSearch(event.target.value)} placeholder="Médico o área" /></label>
      <label className="hon-monthly-inline"><input type="checkbox" checked={showInactive} onChange={event => setShowInactive(event.target.checked)} />Ver anteriores y desactivados</label>
    </div>
    {editor && <form className="hon-monthly-editor" onSubmit={event => save(event, editor)} ref={formRef}>
      <h3>{editor.mode === 'remove' ? 'Quitar pago mensual' : editor.id ? 'Cambiar pago mensual' : 'Agregar jefe de área'}</h3>
      {editor.id && <p><strong>{editor.providerName}</strong> · {editor.area}</p>}
      <p className="hon-monthly-help">{editor.mode === 'remove' ? 'Se dejará de presentar este pago desde el mes elegido. Los pagos ya preparados conservan sus valores.'
        : 'Indica el mes desde el que debe usarse este importe. Los pagos ya preparados conservan sus valores. Si cambias una configuración pendiente de pago, revisa nuevamente su aprobación.'}</p>
      <AssignmentFields value={editor} onChange={setEditor} providers={providers} disabled={busy || !allowed || (editor.mode !== 'remove' && !!providerError)}
        editing={!!editor.id} removing={editor.mode === 'remove'} />
      <div className="hon-monthly-actions"><button type="submit" className="hon-friendly-button primary" disabled={busy || !allowed || (editor.mode !== 'remove' && !!providerError)}>
        {busy ? 'Guardando…' : editor.mode === 'remove' ? 'Confirmar baja' : 'Guardar pago mensual'}</button>
        <button type="button" className="hon-friendly-button" disabled={busy} onClick={() => setEditor(null)}>Cancelar</button></div>
    </form>}
    {proposals.length > 0 && <div className="hon-monthly-proposals">
      <div className="hon-monthly-heading"><div><h3>Confirmar listado inicial</h3><p>Son propuestas sin guardar. Vincula y confirma cada médico del directorio antes de agregar su pago.</p></div>
        <button type="button" className="hon-friendly-button" disabled={busy} onClick={() => setProposals([])}>Cerrar propuestas</button></div>
      {proposals.map(proposal => <form key={proposal.key} className="hon-monthly-proposal" onSubmit={event => save(event, proposal, proposal.key)}>
        <h4>{proposal.name}</h4><p className="hon-monthly-help">{proposal.matchCount === 1 ? 'Se sugiere una coincidencia del directorio. Confirma que sea el médico correcto.'
          : proposal.matchCount > 1 ? 'Hay varios médicos con ese nombre. Elige el número correcto del directorio.' : 'No hay una coincidencia exacta. Busca y elige al médico del directorio.'}</p>
        <AssignmentFields value={proposal} onChange={next => setProposals(previous => previous.map(item => item.key === proposal.key ? next : item))}
          providers={providers} disabled={busy || !allowed || !!providerError} suffix={` de ${proposal.name}`} />
        <button type="submit" className="hon-friendly-button primary" disabled={busy || !allowed || !!providerError || !proposal.providerId || !proposal.confirmed}>Guardar jefe de área</button>
      </form>)}
    </div>}
    {loading ? <p role="status">Consultando jefes de área…</p> : !loadError && <>
      <div className="hon-monthly-table-wrap"><table className="hon-monthly-table"><thead><tr><th>Médico</th><th>Área</th><th>Pago mensual antes de impuestos</th><th>Vigencia</th><th>Estado</th><th><span className="hon-monthly-sr-only">Acciones</span></th></tr></thead>
        <tbody>{filtered.map(item => <tr key={item.id} data-assignment-id={item.id}>
          <td data-label="Médico"><strong>{item.providerName}</strong><span className="hon-monthly-help">#{item.providerId}</span></td>
          <td data-label="Área">{item.area}</td><td data-label="Pago mensual antes de impuestos">{money(item.amount)}</td>
          <td data-label="Vigencia">Desde {monthLabel(item.validFromMonth)}{item.validToMonth && <> hasta {monthLabel(item.validToMonth)}</>}
            {item.deactivatedFromMonth && <span className="hon-monthly-help">Baja desde {monthLabel(item.deactivatedFromMonth)}</span>}</td>
          <td data-label="Estado"><span className={`hon-monthly-status ${item.active === false || previousMonth(item) ? 'inactive' : 'active'}`}>
            {item.active === false ? 'Desactivado' : previousMonth(item) ? 'Anterior' : item.validFromMonth > month ? 'Programado' : 'Configurado'}</span></td>
          <td data-label="Acciones">{allowed && item.active !== false && !previousMonth(item) && <div className="hon-monthly-actions">
            <button type="button" className="hon-friendly-button" disabled={busy || !!providerError} onClick={() => begin(item)}>Editar</button>
            <button type="button" className="hon-friendly-button" disabled={busy} onClick={() => begin(item, 'remove')}>Quitar</button></div>}</td>
        </tr>)}</tbody></table></div>
      {filtered.length === 0 && <p className="hon-monthly-empty">{assignments.length ? 'No hay jefes de área con estos filtros.' : 'Aún no hay pagos mensuales configurados.'}</p>}
    </>}
  </section>;
}
