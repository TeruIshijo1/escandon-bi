import { userMessage } from '../../utils/userMessages';
import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';
import { downloadInstitutionalExcel } from '../../utils/excelInstitutionalGenerator';
import { generateHonorariosPaymentPdf } from '../../utils/honorariosPaymentPdfGenerator';

const money = amount => Number(amount).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };

export default function HonorariosLiquidationsPanel({ startDate, endDate, canManage, onChanged, initialProviderId = '', onViewApproved, onDownloadApproved, onEditFiscal }) {
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
  const [paid, setPaid] = useState({ providerId: initialProviderId, amount: '', reference: '', paymentDate: today() });
  const load = async () => { const result = await apiFetch('/honorarios/liquidations'); setList(result.liquidations || []); };
  useEffect(() => {
    load().catch(failure => setError(userMessage(failure.message)));
    apiFetch('/honorarios/providers').then(result => setProviders(result.providers || [])).catch(failure => setError(userMessage(failure.message)));
  }, []);
  useEffect(() => {
    if (!selected && initialProviderId) {
      const existing = list.find(item => String(item.provider_id) === String(initialProviderId)
        && String(item.start_date).slice(0, 10) === startDate && String(item.end_date).slice(0, 10) === endDate);
      if (existing) run(() => choose(existing.id));
    }
  }, [list]);
  const run = async action => {
    setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (failure) { setError(userMessage(failure.message)); } finally { setBusy(false); }
  };
  const choose = async id => {
    const result = await apiFetch(`/honorarios/liquidations/${id}`);
    setSelected(result.liquidation);
    setPaid(previous => ({ ...previous, providerId: String(result.liquidation.lines[0]?.providerId || ''), amount: '', reference: '' }));
    setChanges(null);
    setPaymentIssues([]);
    setEntry(previous => ({ ...previous, rowId: '', amount: '', reference: '', reason: '' }));
  };
  const exportPaymentPdf = async (current = selected) => {
    setPaymentIssues([]);
    // Consultar de nuevo evita exportar el saldo de una pantalla abierta antes de otro pago.
    const { report } = await apiFetch(`/honorarios/liquidations/${current.id}/payment-report`);
    if (String(report?.liquidation?.id) !== String(current.id)) throw new Error('No se pudo confirmar el cierre seleccionado. Vuelve a consultarlo.');
    if (report.status === 'REVIEW_REQUIRED' || report.issues?.length) {
      setPaymentIssues(report.issues?.length ? report.issues : [{ message: 'Este cierre necesita revisión antes de preparar el pago.' }]);
      return;
    }
    await generateHonorariosPaymentPdf(report);
    setMessage(report.status === 'PAID' ? 'PDF generado: este cierre ya no tiene saldo pendiente.'
      : 'PDF generado con los pagos y ajustes registrados al momento de la consulta.');
    setSelected(previous => ({ ...previous, lines: report.doctors.flatMap(doctor => doctor.lines),
      payments: report.doctors.flatMap(doctor => doctor.payments), adjustments: report.doctors.flatMap(doctor => doctor.adjustments),
      totalPaid: report.totals.paid, balance: report.totals.balance }));
  };
  const exportClosed = async () => {
    const { liquidation: current } = await apiFetch(`/honorarios/liquidations/${selected.id}`);
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
      <p>Genera el PDF con los servicios aprobados y sus impuestos. Si ya registraste pagos, se descuentan del saldo.</p>
      <div className="hon-friendly-actions"><button type="button" className="hon-friendly-button" onClick={onViewApproved}>Volver a los médicos</button></div>
      {error && <div role="alert" className="hon-friendly-message error">
        <p>Los servicios siguen aprobados. {error}</p>
        {/fiscal|SAP/i.test(error) && <button type="button" className="hon-friendly-button primary" disabled={busy} onClick={() => onEditFiscal?.(period.providerId)}>Completar datos fiscales</button>}
        {onDownloadApproved && <button type="button" className="hon-friendly-button" disabled={busy} onClick={onDownloadApproved}>PDF de servicios aprobados</button>}
      </div>}
      {message && <p role="status" style={{ color: '#15803d' }}>{message}</p>}
      <details open={!selected}><summary>{selected ? 'Preparar otro pago con servicios nuevos' : 'Generar el PDF del médico'}</summary><form onSubmit={event => { event.preventDefault(); run(async () => {
        const result = await apiFetch('/honorarios/liquidations', { method: 'POST', body: {
          ...period, confirmed: true, reason: 'Cierre solicitado desde los servicios aprobados; cálculo fiscal validado por el sistema.'
        } });
        setSelected(result.liquidation); setPaymentIssues([]); setChanges(null); await load();
        setPaid(previous => ({ ...previous, providerId: period.providerId || String(result.liquidation.lines[0]?.providerId || '') }));
        setMessage('Pago preparado. Si tienes comprobantes de pagos previos, regístralos abajo y vuelve a descargar el PDF.');
        await exportPaymentPdf(result.liquidation);
        onChanged?.();
      }); }} style={{ display: 'grid', gap: '.75rem', marginTop: '1rem' }}>
        <h3 style={{ marginBottom: 0 }}>Médico y periodo</h3>
        <p style={{ margin: 0 }}><strong>{providers.find(provider => String(provider.id) === String(period.providerId))?.name || (period.providerId ? 'Médico seleccionado' : 'Todos los médicos con aprobaciones abiertas')}</strong><br />
          Periodo: {period.startDate.split('-').reverse().join('/')} al {period.endDate.split('-').reverse().join('/')}</p>
        <details>
          <summary style={{ cursor: 'pointer' }}>Cambiar médico o fechas (opcional)</summary>
          <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap', marginTop: '.75rem' }}>
            <label>Desde<input aria-label="Cierre desde" type="date" className="hon-input" value={period.startDate} required onChange={event => setPeriod({ ...period, startDate: event.target.value })} /></label>
            <label>Hasta<input aria-label="Cierre hasta" type="date" className="hon-input" value={period.endDate} required onChange={event => setPeriod({ ...period, endDate: event.target.value })} /></label>
            <label>Médico<select className="hon-input" value={period.providerId} onChange={event => setPeriod({ ...period, providerId: event.target.value })}>
              <option value="">Todos los médicos con aprobaciones abiertas</option>
              {providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
            </select></label>
          </div>
        </details>
        <p style={{ margin: 0 }}>Se conservarán los servicios y el cálculo de impuestos para este pago. Generar el PDF no registra una transferencia.</p>
        <button className="hon-friendly-button primary" disabled={!canManage || busy}>{busy ? 'Preparando…' : 'Generar PDF para pago'}</button>
      </form></details>
    </div>
    <div className="hon-card" style={{ padding: '1rem', marginBottom: '1rem' }}>
      <details open={!initialProviderId}><summary>Consultar pagos preparados</summary><label>Pago preparado<select aria-label="Liquidación cerrada" className="hon-input" value={selected?.id || ''} disabled={busy}
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
