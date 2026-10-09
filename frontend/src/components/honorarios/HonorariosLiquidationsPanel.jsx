import { userMessage } from '../../utils/userMessages';
import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { downloadInstitutionalExcel } from '../../utils/excelInstitutionalGenerator';
import { generateHonorariosPaymentPdf } from '../../utils/honorariosPaymentPdfGenerator';
import { generateHonorariosAvailablePaymentPdf, validateHonorariosAvailablePaymentReport } from '../../utils/honorariosAvailablePaymentPdfGenerator';

const money = amount => Number(amount).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
const REQUEST_TIMEOUT_MS = 120000;
const readPendingPreparation = storageKey => {
  try {
    const value = storageKey ? JSON.parse(sessionStorage.getItem(storageKey) || 'null') : null;
    return value?.period?.startDate && value?.period?.endDate && Array.isArray(value.knownIds) ? value : null;
  } catch { return null; }
};

export default function HonorariosLiquidationsPanel({ startDate, endDate, canManage, onChanged, initialProviderId = '', onViewApproved, onDownloadApproved, onEditFiscal, preparationOwnerId = '' }) {
  const preparationStorageKey = preparationOwnerId ? `honorarios_pending_preparation_${encodeURIComponent(preparationOwnerId)}` : '';
  const [list, setList] = useState([]);
  const [selected, setSelected] = useState(null);
  const [providers, setProviders] = useState([]);
  const [period, setPeriod] = useState({ startDate, endDate, providerId: initialProviderId });
  const [entry, setEntry] = useState({ rowId: '', amount: '', reference: '', reason: '', paymentDate: today(), type: 'payments' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [changes, setChanges] = useState(null);
  const [paymentIssues, setPaymentIssues] = useState([]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [fiscalPending, setFiscalPending] = useState(false);
  const [pendingPreparation, setPendingPreparation] = useState(() => readPendingPreparation(preparationStorageKey));
  const pendingProvider = pendingPreparation && (providers.find(provider => String(provider.id) === String(pendingPreparation.period.providerId))?.name
    || (pendingPreparation.period.providerId ? 'Médico seleccionado' : 'Todos los médicos con aprobaciones abiertas'));
  const busyRef = useRef(false);
  const activeRequest = useRef(null);
  const mounted = useRef(true);
  const [paid, setPaid] = useState({ providerId: initialProviderId, amount: '', reference: '', paymentDate: today() });
  const markPreparation = value => {
    setPendingPreparation(value);
    try {
      if (!preparationStorageKey) return;
      if (value) sessionStorage.setItem(preparationStorageKey, JSON.stringify(value));
      else sessionStorage.removeItem(preparationStorageKey);
    } catch { /* El bloqueo en pantalla se conserva si el navegador no permite guardar la sesión. */ }
  };
  const request = async (endpoint, options = {}, label = 'Consultando el pago…') => {
    const controller = new AbortController();
    const operation = { controller, timedOut: false };
    if (busyRef.current) { activeRequest.current = operation; setPhase(label); }
    let timer, interrupted;
    const deadline = new Promise((_resolve, reject) => {
      interrupted = () => reject(new Error(operation.timedOut
        ? 'La consulta tardó demasiado. La espera se detuvo; puedes volver a consultar el pago preparado.'
        : 'La espera se detuvo. Puedes volver a consultar el pago preparado.'));
      controller.signal.addEventListener('abort', interrupted, { once: true });
      timer = setTimeout(() => { operation.timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
    });
    try { return await Promise.race([apiFetch(endpoint, { ...options, signal: controller.signal }), deadline]); }
    finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', interrupted);
      if (activeRequest.current === operation) activeRequest.current = null;
    }
  };
  const load = async () => {
    const result = await request('/honorarios/liquidations', {}, 'Actualizando pagos preparados…');
    if (!Array.isArray(result?.liquidations)) throw new Error('No se pudo consultar la lista de pagos preparados. Vuelve a consultarla antes de continuar.');
    const current = result.liquidations;
    if (mounted.current) setList(current);
    return current;
  };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; activeRequest.current?.controller.abort(); };
  }, []);
  useEffect(() => {
    load().catch(failure => setError(userMessage(failure.message)));
    apiFetch('/honorarios/providers').then(result => setProviders(result.providers || [])).catch(failure => setError(userMessage(failure.message)));
  }, []);
  useEffect(() => {
    if (!selected && initialProviderId && !pendingPreparation) {
      const existing = list.find(item => String(item.provider_id) === String(initialProviderId)
        && String(item.start_date).slice(0, 10) === startDate && String(item.end_date).slice(0, 10) === endDate);
      if (existing) run(() => choose(existing.id));
    }
  }, [list]);
  const run = async action => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (failure) { if (mounted.current) setError(userMessage(failure.message)); }
    finally { busyRef.current = false; if (mounted.current) { setBusy(false); setPhase(''); } }
  };
  const matchesPreparation = candidate => pendingPreparation && candidate
    && !pendingPreparation.knownIds.includes(String(candidate.id))
    && String(candidate.start_date).slice(0, 10) === pendingPreparation.period.startDate
    && String(candidate.end_date).slice(0, 10) === pendingPreparation.period.endDate
    && String(candidate.provider_id || '') === String(pendingPreparation.period.providerId || '');
  const choose = async (id, listed = list.find(item => String(item.id) === String(id))) => {
    const result = await request(`/honorarios/liquidations/${id}`);
    setSelected(result.liquidation);
    setFiscalPending(false);
    setPaid(previous => ({ ...previous, providerId: String(result.liquidation.lines[0]?.providerId || ''), amount: '', reference: '' }));
    setChanges(null);
    setPaymentIssues([]);
    setEntry(previous => ({ ...previous, rowId: '', amount: '', reference: '', reason: '' }));
    if (String(result.liquidation.id) === String(id) && matchesPreparation(listed)) {
      markPreparation(null); onChanged?.();
      setMessage('El pago ya estaba preparado. Puedes descargar su PDF sin volver a generarlo.');
    }
  };
  const exportPaymentPdf = async (current = selected) => {
    setPaymentIssues([]);
    // Consultar de nuevo evita exportar el saldo de una pantalla abierta antes de otro pago.
    const { report } = await request(`/honorarios/liquidations/${current.id}/payment-report`, {}, 'Comprobando el PDF para pago…');
    if (String(report?.liquidation?.id) !== String(current.id)) throw new Error('No se pudo confirmar el cierre seleccionado. Vuelve a consultarlo.');
    if (report.status === 'REVIEW_REQUIRED' || report.issues?.length) {
      setPaymentIssues(report.issues?.length ? report.issues : [{ message: 'Este cierre necesita revisión antes de preparar el pago.' }]);
      return;
    }
    setPhase('Generando el PDF…');
    await generateHonorariosPaymentPdf(report);
    setMessage(report.status === 'PAID' ? 'PDF generado: este cierre ya no tiene saldo pendiente.'
      : 'PDF generado con los pagos y ajustes registrados al momento de la consulta.');
    setSelected(previous => ({ ...previous, lines: report.doctors.flatMap(doctor => doctor.lines),
      payments: report.doctors.flatMap(doctor => doctor.payments), adjustments: report.doctors.flatMap(doctor => doctor.adjustments),
      totalPaid: report.totals.paid, balance: report.totals.balance }));
  };
  const confirmPreparation = async () => {
    const current = await load();
    if (!pendingPreparation) return;
    const prepared = current.filter(matchesPreparation);
    if (!prepared.length) {
      setMessage('Todavía no se puede confirmar la preparación. Consulta los pagos preparados más tarde; la solicitud no se enviará nuevamente.');
      return;
    }
    if (prepared.length > 1) {
      setMessage('Hay varios pagos preparados para ese médico y periodo. Selecciona el que corresponde en Consultar pagos preparados; la solicitud no se enviará nuevamente.');
      return;
    }
    await choose(prepared[0].id, prepared[0]);
  };
  const availablePaymentReport = async requested => {
    const { report } = await request('/honorarios/available-payment-report', { method: 'POST', body: requested }, 'Comprobando los datos disponibles…');
    if (!['FISCAL_PENDING', 'AVAILABLE'].includes(report?.status)
      || report.period?.startDate !== requested.startDate || report.period?.endDate !== requested.endDate
      || !Array.isArray(report.doctors) || !report.doctors.length
      || (Number(requested.providerId) > 0 && report.doctors.some(doctor => String(doctor.providerId) !== String(requested.providerId)))) {
      throw new Error('No se pudieron confirmar los servicios del médico y periodo seleccionados. Vuelve a consultar.');
    }
    return validateHonorariosAvailablePaymentReport(report);
  };
  const downloadAvailablePayment = async () => {
    const report = await availablePaymentReport({ ...period });
    setPhase('Generando el PDF…');
    await generateHonorariosAvailablePaymentPdf(report);
    setFiscalPending(report.status === 'FISCAL_PENDING');
    setMessage(report.status === 'FISCAL_PENDING'
      ? 'PDF generado con los servicios y datos disponibles. Falta completar los datos fiscales para calcular el neto y preparar el pago.'
      : 'PDF generado con los servicios y datos disponibles. Puedes continuar para preparar el pago.');
  };
  const preparePayment = async (useSap = false) => {
    if (pendingPreparation) return;
    const requested = { ...period };
    const available = await availablePaymentReport(requested);
    setFiscalPending(available.status === 'FISCAL_PENDING');
    if (available.status === 'FISCAL_PENDING' && !useSap) {
      setPhase('Generando el PDF…');
      await generateHonorariosAvailablePaymentPdf(available);
      setFiscalPending(true);
      setMessage('PDF generado con los servicios y datos disponibles. Falta completar los datos fiscales para calcular el neto y preparar el pago.');
      return;
    }
    const baseline = await load();
    markPreparation({ period: requested, knownIds: baseline.map(item => String(item.id)) });
    let result;
    try {
      result = await request('/honorarios/liquidations', { method: 'POST', body: {
        ...requested, confirmed: true, reason: 'Cierre solicitado desde los servicios aprobados; cálculo fiscal validado por el sistema.'
      } }, 'Preparando el pago…');
      if (!result?.liquidation?.id) throw new Error('No se recibió la confirmación del pago preparado.');
      markPreparation(null);
    } catch (failure) {
      if (failure.data?.preparationStatus === 'NOT_CREATED') {
        markPreparation(null); throw failure;
      }
      throw new Error('No se pudo confirmar si el pago quedó preparado. Consulta pagos preparados antes de continuar; la solicitud no se enviará nuevamente.');
    }
    setSelected(result.liquidation); setFiscalPending(false); setPaymentIssues([]); setChanges(null);
    setPaid(previous => ({ ...previous, providerId: requested.providerId || String(result.liquidation.lines[0]?.providerId || '') }));
    setMessage('Pago preparado. Si tienes comprobantes de pagos previos, regístralos abajo y vuelve a descargar el PDF.');
    onChanged?.();
    await load();
    await exportPaymentPdf(result.liquidation);
  };
  const exportClosed = async () => {
    const { liquidation: current } = await request(`/honorarios/liquidations/${selected.id}`);
    if (String(current?.id) !== String(selected.id)) throw new Error('No se pudo confirmar el cierre seleccionado. Vuelve a consultarlo.');
    const rows = current.lines.map(line => ({ ...line, tariffId: line.tariff?.id, tariffFrom: line.tariff?.validFrom,
      executionReference: line.execution?.reference, closedBy: current.created_by }));
    await downloadInstitutionalExcel({ filename: `Honorarios_Cierre_${selected.id}.xlsx`,
      sheets: [{ name: 'Liquidación cerrada', titulo: `Honorarios · cierre #${selected.id}`,
        subtitulo: current.snapshot.fiscalNote, columnas: [
          { header: 'Registro', key: 'rowId', width: 32 }, { header: 'Fecha servicio', key: 'serviceDate', width: 15 },
          { header: 'Folio Atención', key: 'attention', width: 18 }, { header: 'Folio Cita', key: 'appointment', width: 16 },
          { header: 'Folio Orden Venta', key: 'salesOrder', width: 20 }, { header: 'Servicio', key: 'description', width: 42 },
          { header: 'Médico', key: 'providerName', width: 32 }, { header: 'Rol', key: 'role', width: 16 },
          { header: 'Cantidad', key: 'quantity', width: 12, type: 'number', decimals: true },
          ...[['Tarifa por servicio', 'unitAmount'], ['Honorario', 'baseAmount'], ['IVA', 'vat'], ['ISR', 'isr'],
            ['Retención IVA', 'vatWithholding'], ['Importe neto cerrado', 'netAmount'], ['Ajustes', 'adjustmentAmount'],
            ['Pagos aplicados', 'paidAmount'], ['Saldo', 'balance']].map(([header, key]) => ({ header, key, width: 22, type: 'currency' })),
          { header: 'Número de tarifa', key: 'tariffId', width: 15 }, { header: 'Vigencia tarifa', key: 'tariffFrom', width: 18 },
          { header: 'Referencia realización', key: 'executionReference', width: 35 }, { header: 'Revisor', key: 'reviewer', width: 30 },
          { header: 'Motivo', key: 'reason', width: 42 }, { header: 'Responsable cierre', key: 'closedBy', width: 30 }
        ], filas: rows }] });
    setSelected(current);
  };
  return <section>
    <div className="hon-card" style={{ padding: '1rem', marginBottom: '1rem' }}>
      <h2 style={{ margin: '0 0 .5rem' }}>Preparar pago</h2>
      <p>Descarga los servicios aprobados con los datos disponibles. Si falta información fiscal, el PDF mostrará los impuestos y el neto como pendientes.</p>
      <div className="hon-friendly-actions"><button type="button" className="hon-friendly-button" onClick={onViewApproved}>Volver a los médicos</button></div>
      {busy && phase && <div role="status" className="hon-friendly-message"><p>{phase}</p>
        {phase !== 'Generando el PDF…' && <button type="button" className="hon-friendly-button" onClick={() => activeRequest.current?.controller.abort()}>Detener espera</button>}
      </div>}
      {pendingPreparation && !busy && <p role="status" className="hon-friendly-message">La preparación sigue sin confirmar para <strong>{pendingProvider}</strong>, del {pendingPreparation.period.startDate.split('-').reverse().join('/')} al {pendingPreparation.period.endDate.split('-').reverse().join('/')}. Consulta los pagos preparados; volver a esta pantalla no envía otra solicitud.</p>}
      {error && <div role="alert" className="hon-friendly-message error">
        <p>Los servicios siguen aprobados. {error}</p>
        {!fiscalPending && /fiscal|SAP/i.test(error) && <button type="button" className="hon-friendly-button primary" disabled={busy} onClick={() => onEditFiscal?.(period.providerId)}>Completar datos fiscales</button>}
        {onDownloadApproved && <button type="button" className="hon-friendly-button" disabled={busy} onClick={() => run(downloadAvailablePayment)}>PDF de servicios aprobados</button>}
      </div>}
      {message && <p role="status" style={{ color: '#15803d' }}>{message}</p>}
      {fiscalPending && <button type="button" className="hon-friendly-button" disabled={busy} onClick={() => onEditFiscal?.(period.providerId)}>Completar datos fiscales</button>}
      {fiscalPending && <p style={{ color: 'var(--text-muted, #64748b)' }}>El PDF disponible no descuenta pagos registrados ni indica un saldo por pagar.</p>}
      {fiscalPending && <details style={{ marginTop: '.75rem' }}><summary>Opciones para preparar el pago</summary>
        <p>Si los datos fiscales del médico ya están configurados en SAP, puedes usarlos para preparar el pago completo.</p>
        <button type="button" className="hon-friendly-button" disabled={!canManage || busy || Boolean(pendingPreparation)} onClick={() => run(() => preparePayment(true))}>Preparar pago con datos de SAP</button>
      </details>}
      <details open={!selected}><summary>{selected ? 'Preparar otro pago con servicios nuevos' : 'Generar el PDF del médico'}</summary><form onSubmit={event => { event.preventDefault(); run(preparePayment); }} style={{ display: 'grid', gap: '.75rem', marginTop: '1rem' }}>
        <h3 style={{ marginBottom: 0 }}>Médico y periodo</h3>
        <p style={{ margin: 0 }}><strong>{providers.find(provider => String(provider.id) === String(period.providerId))?.name || (period.providerId ? 'Médico seleccionado' : 'Todos los médicos con aprobaciones abiertas')}</strong><br />
          Periodo: {period.startDate.split('-').reverse().join('/')} al {period.endDate.split('-').reverse().join('/')}</p>
        <details>
          <summary style={{ cursor: 'pointer' }}>Cambiar médico o fechas (opcional)</summary>
          <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap', marginTop: '.75rem' }}>
            <label>Desde<input aria-label="Cierre desde" type="date" className="hon-input" value={period.startDate} required disabled={busy || Boolean(pendingPreparation)} onChange={event => setPeriod({ ...period, startDate: event.target.value })} /></label>
            <label>Hasta<input aria-label="Cierre hasta" type="date" className="hon-input" value={period.endDate} required disabled={busy || Boolean(pendingPreparation)} onChange={event => setPeriod({ ...period, endDate: event.target.value })} /></label>
            <label>Médico<select className="hon-input" value={period.providerId} disabled={busy || Boolean(pendingPreparation)} onChange={event => setPeriod({ ...period, providerId: event.target.value })}>
              <option value="">Todos los médicos con aprobaciones abiertas</option>
              {providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
            </select></label>
          </div>
        </details>
        <p style={{ margin: 0 }}>Al preparar el pago completo, se conservarán los servicios y el cálculo de impuestos. Generar el PDF no registra una transferencia.</p>
        <button className="hon-friendly-button primary" disabled={!canManage || busy || Boolean(pendingPreparation)}>{busy ? 'Preparando…' : 'Generar PDF para pago'}</button>
      </form></details>
    </div>
    <div className="hon-card" style={{ padding: '1rem', marginBottom: '1rem' }}>
      <button type="button" className="hon-friendly-button" disabled={busy} onClick={() => run(confirmPreparation)}>Consultar pagos preparados</button>
      <details open={!initialProviderId || Boolean(pendingPreparation)}><summary>Consultar pagos preparados</summary><label>Pago preparado<select aria-label="Liquidación cerrada" className="hon-input" value={selected?.id || ''} disabled={busy}
        onChange={event => { if (event.target.value) run(() => choose(event.target.value)); else setSelected(null); }}>
        <option value="">Selecciona un pago preparado</option>
        {list.map(item => <option key={item.id} value={item.id}>#{item.id} · {String(item.start_date).slice(0, 10)} a {String(item.end_date).slice(0, 10)} · {item.lines} servicios · {money(item.total_net)}</option>)}
      </select></label>
      {!list.length && <p>Aún no hay pagos preparados.</p>}</details>
    </div>
    {selected && <div className="hon-card" style={{ padding: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.75rem' }}>
        <h3>Pago #{selected.id} · Neto {money(selected.snapshot.totalNet)} · Pagado {money(selected.totalPaid)} · Saldo {money(selected.balance)}</h3>
        <button type="button" className="hon-friendly-button primary" onClick={() => run(exportPaymentPdf)} disabled={busy}>{busy ? 'Comprobando…' : 'Descargar PDF para pago'}</button>
        <button type="button" className="hon-view-btn" onClick={() => run(exportClosed)} disabled={busy}>Descargar Excel del cierre</button>
        <details><summary>Opciones del pago</summary><button type="button" className="hon-view-btn" disabled={busy} onClick={() => run(async () => {
          const result = await apiFetch(`/honorarios/liquidations/${selected.id}/check`, { method: 'POST' }); setChanges(result.changes || []);
        })}>Verificar cambios de origen</button></details>
      </div>
      <p>{selected.snapshot.fiscalNote}</p>
      <p style={{ color: 'var(--text-muted, #64748b)' }}>El PDF comprueba el cierre y sus movimientos antes de descargarse. Incluye únicamente los pagos registrados aquí; captura cualquier pago previo que falte.</p>
      {paymentIssues.length > 0 && <div role="alert" className="hon-friendly-message error">
        <strong>El PDF para pago necesita revisión.</strong>
        <ul>{paymentIssues.map((issue, index) => <li key={`${issue.code || 'issue'}-${index}`}>{userMessage(issue.message)}</li>)}</ul>
      </div>}
      {changes && <div role="status">{changes.length ? changes.map(item => <p key={item.rowId} style={{ color: '#b45309' }}>{item.description}: {item.reason} Revisa si corresponde un ajuste.</p>) : 'No se detectaron cambios clínicos en los servicios del cierre.'}</div>}
      <details><summary>Ver servicios incluidos</summary><div style={{ overflowX: 'auto' }}><table style={{ width: '100%', textAlign: 'left', fontSize: '.85rem' }}>
        <thead><tr>{['Servicio / orden', 'Médico', 'Cantidad', 'Neto cerrado', 'Ajustes', 'Pagado', 'Saldo'].map(label => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{selected.lines.map(line => <tr key={line.rowId}>
          <td>{line.description}<br /><small>{line.sourceType === 'BI_FIJO_MENSUAL' ? `Pago mensual completo · ${line.month}` : <>Orden {line.salesOrder || 'sin vínculo'}{line.sourceLineId ? ` · ${line.sourceType === 'PCBL' ? 'Cargo' : 'Línea'} ${line.sourceLineId}` : ''}</>}</small></td><td>{line.providerName} · {line.role}</td>
          <td>{line.quantity}</td><td>{money(line.netAmount)}</td><td>{money(line.adjustmentAmount)}</td><td>{money(line.paidAmount)}</td><td>{money(line.balance)}</td>
        </tr>)}</tbody>
      </table></div></details>
      <details style={{ marginTop: '1rem' }}><summary>Registrar un pago ya realizado</summary>
        <form style={{ display: 'grid', gap: '.75rem', marginTop: '1rem' }} onSubmit={event => { event.preventDefault(); run(async () => {
          const result = await apiFetch(`/honorarios/liquidations/${selected.id}/provider-payment`, { method: 'POST', body: { ...paid, amount: Number(paid.amount) } });
          setSelected(result.liquidation); setPaid(previous => ({ ...previous, amount: '', reference: '' })); setPaymentIssues([]);
          setMessage('Pago registrado. El siguiente PDF mostrará el saldo actualizado.');
        }); }}>
          <p>Captura el total del comprobante. Se reparte automáticamente entre los servicios pendientes del médico.</p>
          <label>Médico<select aria-label="Médico del pago" className="hon-input" required value={paid.providerId} onChange={event => setPaid({ ...paid, providerId: event.target.value })}>
            <option value="">Selecciona</option>{[...new Map(selected.lines.map(line => [String(line.providerId), line.providerName])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select></label>
          <label>Importe del pago<input aria-label="Importe del pago" className="hon-input" type="number" step="0.01" min="0.01" required value={paid.amount} onChange={event => setPaid({ ...paid, amount: event.target.value })} /></label>
          <label>Fecha del pago<input aria-label="Fecha del pago" className="hon-input" type="date" required value={paid.paymentDate} onChange={event => setPaid({ ...paid, paymentDate: event.target.value })} /></label>
          <label>Referencia o comprobante<input aria-label="Referencia del pago" className="hon-input" maxLength={1000} required value={paid.reference} onChange={event => setPaid({ ...paid, reference: event.target.value })} /></label>
          <button className="hon-friendly-button primary" disabled={busy || !canManage}>Guardar pago realizado</button>
        </form>
      </details>
      <details style={{ marginTop: '1rem' }}><summary>Ajustes o pagos por servicio (opcional)</summary><form style={{ display: 'grid', gap: '.75rem', marginTop: '1.25rem' }} onSubmit={event => { event.preventDefault(); run(async () => {
        const result = await apiFetch(`/honorarios/liquidations/${selected.id}/${entry.type}`, { method: 'POST', body: { ...entry, amount: Number(entry.amount) } });
        setSelected(result.liquidation); setPaymentIssues([]); setEntry(previous => ({ ...previous, amount: '', reference: '', reason: '' }));
        setMessage(entry.type === 'payments' ? 'Pago aplicado al servicio.' : 'Ajuste registrado con historial.');
      }); }}>
        <h4 style={{ margin: 0 }}>Registrar comprobante o ajuste</h4>
        <select aria-label="Tipo de registro" className="hon-input" value={entry.type} onChange={event => setEntry({ ...entry, type: event.target.value })}>
          <option value="payments">Pago ya realizado</option><option value="adjustments">Ajuste al neto de la obligación</option>
        </select>
        <label>Servicio<select aria-label="Servicio del cierre" className="hon-input" required value={entry.rowId} onChange={event => setEntry({ ...entry, rowId: event.target.value })}>
          <option value="">Selecciona el servicio al que se aplica</option>
          {selected.lines.map(line => <option key={line.rowId} value={line.rowId}>{line.providerName} · {line.description} · saldo {money(line.balance)}</option>)}
        </select></label>
        <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap' }}>
          <label>Importe MXN<input className="hon-input" type="number" step="0.01" min={entry.type === 'payments' ? '0.01' : undefined} required value={entry.amount} onChange={event => setEntry({ ...entry, amount: event.target.value })} /></label>
          {entry.type === 'payments' && <label>Fecha del pago<input className="hon-input" type="date" required value={entry.paymentDate} onChange={event => setEntry({ ...entry, paymentDate: event.target.value })} /></label>}
        </div>
        {entry.type === 'adjustments' && <small>Un importe negativo reduce la obligación; uno positivo la aumenta. El cierre original y los pagos anteriores se conservan.</small>}
        <label>Referencia o comprobante<input className="hon-input" required maxLength={1000} value={entry.reference} onChange={event => setEntry({ ...entry, reference: event.target.value })} /></label>
        <label>Motivo<input className="hon-input" required maxLength={2000} value={entry.reason} onChange={event => setEntry({ ...entry, reason: event.target.value })} /></label>
        <button className="hon-view-btn" disabled={busy || !canManage}>{entry.type === 'payments' ? 'Aplicar pago registrado' : 'Guardar ajuste'}</button>
      </form></details>
      <details style={{ marginTop: '1rem' }}><summary>Historial de pagos y ajustes</summary>
        {[...selected.payments.map(item => ({ ...item, kind: 'Pago' })), ...selected.adjustments.map(item => ({ ...item, kind: 'Ajuste' }))]
          .map(item => <p key={`${item.kind}-${item.id}`}>{item.kind} · {money(item.amount)} · {item.reference} · {item.reason} · {item.created_by}</p>)}
      </details>
    </div>}
  </section>;
}
