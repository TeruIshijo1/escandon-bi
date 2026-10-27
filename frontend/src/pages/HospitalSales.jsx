import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { userMessage } from '../utils/userMessages';
import { downloadHospitalSalesWorkbook, filterSalesRows, linkedSalesInvoicesLabel, salesDateLabel, salesDefaultPeriod, salesDocumentLabel, SALES_STATUS_LABELS } from '../utils/hospitalSalesWorkbook';
import './HospitalSales.css';

const TIMEOUT_MS = 15 * 60 * 1000;
const PAGE_SIZE = 50;
const money = value => Number(value || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const quantity = value => Number(value || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 });
const elapsed = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const sum = (rows, key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);

function Icon({ name }) {
  const paths = {
    report: <><path d="M5 3h14v18H5zM9 7h6M9 11h6M9 15h2" /><path d="m14 17 1.5 1.5L19 15" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
    refresh: <><path d="M20 6v5h-5M4 18v-5h5" /><path d="M6.5 6.5A8 8 0 0 1 20 11M17.5 17.5A8 8 0 0 1 4 13" /></>,
    blood: <><path d="M12 2s-7 8-7 13a7 7 0 0 0 14 0c0-5-7-13-7-13Z" /><path d="M9 16h6m-3-3v6" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.report}</svg>;
}

function Status({ status }) {
  return <span className={`hs-status ${status === 'FACTURADA' ? 'hs-status--billed' : 'hs-status--pending'}`}>{SALES_STATUS_LABELS[status] || status}</span>;
}

export default function HospitalSales() {
  const { user } = useAuth();
  const id = useId();
  const [period, setPeriod] = useState(salesDefaultPeriod);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [view, setView] = useState('general');
  const [status, setStatus] = useState('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [seconds, setSeconds] = useState(0);
  const activeRequest = useRef(null);
  const requestId = useRef(0);
  const today = salesDefaultPeriod().endDate;
  const validPeriod = period.startDate && period.endDate && period.startDate <= period.endDate && period.endDate <= today;

  useEffect(() => () => { requestId.current += 1; activeRequest.current?.abort('unmount'); }, []);
  useEffect(() => {
    if (!loading) return;
    const start = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [loading]);
  useEffect(() => { setPage(1); }, [view, status, search, data]);

  function changeDate(key, value) {
    requestId.current += 1;
    activeRequest.current?.abort('filters');
    activeRequest.current = null;
    setLoading(false);
    setData(null);
    setError('');
    setNotice('');
    setPeriod(previous => ({ ...previous, [key]: value }));
  }

  async function consult(event) {
    event?.preventDefault();
    if (!validPeriod) return;
    const currentId = ++requestId.current;
    activeRequest.current?.abort('replaced');
    const controller = new AbortController();
    activeRequest.current = controller;
    setData(null);
    setError('');
    setNotice('');
    setSeconds(0);
    setLoading(true);
    const timeout = setTimeout(() => controller.abort('timeout'), TIMEOUT_MS);
    let abortListener;
    try {
      const aborted = new Promise((_, reject) => {
        abortListener = () => reject(new DOMException('Consulta interrumpida', 'AbortError'));
        controller.signal.addEventListener('abort', abortListener, { once: true });
      });
      const response = await Promise.race([apiFetch('/audit/sales', { params: period, signal: controller.signal }), aborted]);
      if (currentId !== requestId.current) return;
      if (response?.success !== true || response?.data?.complete !== true || !Array.isArray(response?.data?.rows)
        || response.data.period?.startDate !== period.startDate || response.data.period?.endDate !== period.endDate) {
        throw new Error('No se pudo completar el reporte. Intenta consultar de nuevo.');
      }
      setData(response.data);
    } catch (err) {
      if (currentId !== requestId.current) return;
      if (controller.signal.aborted) {
        if (controller.signal.reason === 'timeout') setError('La consulta superó el tiempo de espera. Prueba un periodo más corto y vuelve a consultar.');
        else setNotice('Consulta cancelada. Puedes consultar de nuevo cuando lo necesites.');
      } else setError(userMessage(err));
    } finally {
      clearTimeout(timeout);
      if (abortListener) controller.signal.removeEventListener('abort', abortListener);
      if (currentId === requestId.current) { setLoading(false); activeRequest.current = null; }
    }
  }

  const rows = useMemo(() => {
    if (!data) return [];
    if (view === 'review') return filterSalesRows(data.reviewRows || [], { search });
    return filterSalesRows(data.rows, { status, search, bloodBank: view === 'blood' });
  }, [data, view, status, search]);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visibleRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const months = data?.period?.months || [];
  const totals = useMemo(() => ({ quantity: sum(rows, 'quantity'), netAmount: sum(rows, 'netAmount') }), [rows]);

  async function download() {
    if (!data || loading) return;
    setExporting(true);
    setError('');
    try { await downloadHospitalSalesWorkbook(data, { user: user?.nombre || user?.username || '' }); }
    catch (err) { setError(userMessage(err)); }
    finally { setExporting(false); }
  }

  return <main className="hospital-sales">
    <header className="hs-header">
      <span className="hs-header-icon"><Icon name="report" /></span>
      <div><span className="hs-eyebrow">AUDITORÍA</span><h1>Ventas hospitalarias</h1><p>Artículos, cantidades e importes por mes, con su acumulado y estado de facturación.</p></div>
      <span className="hs-read-only">Consulta</span>
    </header>

    <section className="hs-card hs-period-card" aria-labelledby={`${id}-period-title`}>
      <div className="hs-section-heading"><h2 id={`${id}-period-title`}>Periodo del reporte</h2><span>Importes en MXN sin IVA</span></div>
      <form onSubmit={consult} className="hs-form">
        <label className="hs-field" htmlFor={`${id}-start`}>Desde<input id={`${id}-start`} type="date" required value={period.startDate} max={period.endDate || today} onChange={event => changeDate('startDate', event.target.value)} /></label>
        <label className="hs-field" htmlFor={`${id}-end`}>Hasta<input id={`${id}-end`} type="date" required value={period.endDate} min={period.startDate} max={today} onChange={event => changeDate('endDate', event.target.value)} /></label>
        <button className="hs-button hs-button--primary" disabled={!validPeriod || loading}><Icon name="refresh" />{loading ? 'Consultando…' : data ? 'Actualizar reporte' : 'Consultar reporte'}</button>
        <button type="button" className="hs-button" disabled={!data || loading || exporting} onClick={download}><Icon name="download" />{exporting ? 'Preparando Excel…' : 'Descargar Excel completo'}</button>
      </form>
      <p className="hs-helper">El Excel incluye General, Banco de Sangre, Resumen mensual y Por revisar. La búsqueda, el estado y la paginación de pantalla no recortan la descarga.</p>
      {!validPeriod && <p className="hs-error" role="alert">Selecciona un periodo válido, con fecha final hasta hoy.</p>}
      {loading && <div className="hs-loading" role="status"><div><strong>Reuniendo las ventas del periodo… <span>{elapsed(seconds)}</span></strong><p>La consulta completa puede tardar varios minutos. Puedes cancelarla o elegir un periodo más corto.</p></div><button type="button" className="hs-button" onClick={() => activeRequest.current?.abort('cancelled')}>Cancelar consulta</button></div>}
      {error && <p className="hs-error" role="alert">{error}</p>}
      {notice && <p className="hs-notice" role="status">{notice}</p>}
    </section>

    {!data && !loading && <section className="hs-empty hs-card"><Icon name="report" /><h2>Consulta las ventas del hospital</h2><p>Selecciona las fechas y presiona Consultar reporte. Verás las ventas facturadas en verde y las no facturadas en rojo, además del detalle de Banco de Sangre.</p></section>}

    {data && <>
      <div className="hs-cutoff"><span>Periodo consultado: <strong>{salesDateLabel(data.period.startDate)} al {salesDateLabel(data.period.endDate)}</strong></span><span>Consulta: {new Date(data.period.asOf).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'short', timeStyle: 'short' })}</span></div>
      <section className="hs-kpis" aria-label="Totales de todo el periodo">
        <article className="hs-kpi hs-kpi--billed"><span>Facturada neta</span><strong>{money(data.summary.billedNet)}</strong><small>{quantity(data.summary.billedQuantity)} unidades · Facturas menos notas de crédito</small></article>
        <article className="hs-kpi hs-kpi--pending"><span>No facturada</span><strong>{money(data.summary.pendingNet)}</strong><small>{quantity(data.summary.pendingQuantity)} unidades · Saldo abierto actual</small></article>
        <article className="hs-kpi hs-kpi--review"><span>Por revisar</span><strong>{money(data.summary.reviewNet)}</strong><small>{quantity(data.summary.reviewQuantity)} unidades · Fuera de las no facturadas</small></article>
      </section>
      <p className="hs-method">Las no facturadas corresponden al saldo abierto actual de documentos del periodo. Banco de Sangre forma parte de General. Los totales superiores corresponden a todo el periodo.</p>
      {data.warnings?.length > 0 && <aside className="hs-warning"><strong>Observaciones del reporte</strong><ul>{data.warnings.map((warning, index) => <li key={index}>{userMessage(warning)}</li>)}</ul></aside>}

      <section className="hs-card hs-results" aria-labelledby={`${id}-detail-title`}>
        <div className="hs-tabs" role="group" aria-label="Vista del reporte">
          <button type="button" aria-pressed={view === 'general'} className={view === 'general' ? 'is-active' : ''} onClick={() => setView('general')}>General <span>{data.rows.length}</span></button>
          <button type="button" aria-pressed={view === 'blood'} className={view === 'blood' ? 'is-active' : ''} onClick={() => setView('blood')}><Icon name="blood" />Banco de Sangre <span>{data.rows.filter(row => row.isBloodBank === true).length}</span></button>
          <button type="button" aria-pressed={view === 'review'} className={view === 'review' ? 'is-active' : ''} onClick={() => setView('review')}>Por revisar <span>{data.reviewRows?.length || 0}</span></button>
        </div>
        <div className="hs-detail-toolbar"><div><h2 id={`${id}-detail-title`}>{view === 'review' ? 'Partidas por revisar' : view === 'blood' ? 'Ventas de Banco de Sangre' : 'Ventas por artículo'}</h2><p>{rows.length.toLocaleString('es-MX')} registros en esta vista</p></div>
          <div className="hs-local-filters"><label className="hs-search" htmlFor={`${id}-search`}><Icon name="search" /><span className="hs-sr-only">Buscar artículo, código o descripción</span><input id={`${id}-search`} type="search" value={search} placeholder="Artículo, código o descripción" onChange={event => setSearch(event.target.value)} /></label>
            {view !== 'review' && <label className="hs-field hs-status-field" htmlFor={`${id}-status`}><span className="hs-sr-only">Estado de facturación</span><select id={`${id}-status`} value={status} onChange={event => setStatus(event.target.value)}><option value="ALL">Ambas</option><option value="FACTURADA">Facturadas</option><option value="NO_FACTURADA">No facturadas</option></select></label>}</div>
        </div>
        {view === 'review' && <p className="hs-review-explanation">Estas partidas requieren conciliación por sus relaciones con facturas. Su importe está separado para evitar duplicarlo dentro de las no facturadas.</p>}
        <div className="hs-table-scroll" tabIndex={0} role="region" aria-label={view === 'review' ? 'Detalle de partidas por revisar' : 'Cantidades y montos mensuales por artículo'}>
          <table className={`hs-table ${view === 'review' ? 'hs-table--review' : ''}`}>
            {view !== 'review' ? <>
              <thead><tr><th rowSpan={2} scope="col">Artículo / código</th><th rowSpan={2} scope="col">Descripción del artículo</th><th rowSpan={2} scope="col">Estado</th>{months.map(month => <th key={month.key} colSpan={2} scope="colgroup">{month.label}{month.partial && <small>Periodo parcial</small>}</th>)}<th colSpan={2} scope="colgroup" className="hs-accumulated">Acumulado</th></tr><tr>{[...months, { key: 'total' }].map(month => <ReactMonthHead key={month.key} />)}</tr></thead>
              <tbody>{visibleRows.map(row => <tr key={row.id} className={row.status === 'NO_FACTURADA' ? 'hs-row--pending' : 'hs-row--billed'}><td className="hs-code">{row.code}</td><td className="hs-description">{row.description}</td><td><Status status={row.status} /></td>{months.map(month => { const value = row.months.find(item => item.key === month.key); return <ReactMonthCells key={month.key} quantityValue={value?.quantity} amountValue={value?.netAmount} />; })}<td className="hs-number hs-accumulated">{quantity(row.quantity)}</td><td className="hs-number hs-amount hs-accumulated">{money(row.netAmount)}</td></tr>)}</tbody>
              {rows.length > 0 && <tfoot><tr><th colSpan={3} scope="row">Total de esta vista ({rows.length.toLocaleString('es-MX')} registros)</th>{months.map(month => <ReactMonthCells key={month.key} quantityValue={rows.reduce((total, row) => total + Number(row.months.find(item => item.key === month.key)?.quantity || 0), 0)} amountValue={rows.reduce((total, row) => total + Number(row.months.find(item => item.key === month.key)?.netAmount || 0), 0)} />)}<td className="hs-number hs-accumulated">{quantity(totals.quantity)}</td><td className="hs-number hs-accumulated">{money(totals.netAmount)}</td></tr></tfoot>}
            </> : <>
              <thead><tr><th scope="col">Artículo / código</th><th scope="col">Descripción</th><th scope="col">Fecha</th><th scope="col">Documento</th><th scope="col">Cantidad</th><th scope="col">Monto sin IVA</th><th scope="col">Motivo de revisión</th><th scope="col">Facturas relacionadas</th></tr></thead>
              <tbody>{visibleRows.map(row => <tr key={row.id}><td className="hs-code">{row.code}</td><td className="hs-description">{row.description}</td><td>{salesDateLabel(row.date)}</td><td>{salesDocumentLabel(row)}</td><td className="hs-number">{quantity(row.quantity)}</td><td className="hs-number">{money(row.netAmount)}</td><td className="hs-review-reason">{row.reason}</td><td>{linkedSalesInvoicesLabel(row.linkedInvoices) || 'Sin factura identificada'}</td></tr>)}</tbody>
              {rows.length > 0 && <tfoot><tr><th colSpan={4} scope="row">Total de esta vista</th><td className="hs-number">{quantity(totals.quantity)}</td><td className="hs-number">{money(totals.netAmount)}</td><td colSpan={2}>Fuera de las no facturadas</td></tr></tfoot>}
            </>}
          </table>
          {!rows.length && <p className="hs-no-rows">{view === 'review' && !search ? 'No hay partidas por revisar en este periodo.' : 'No hay registros para los filtros seleccionados.'}</p>}
        </div>
        <div className="hs-pagination"><span>{rows.length ? `${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, rows.length)} de ${rows.length.toLocaleString('es-MX')}` : '0 registros'}</span><div><button type="button" className="hs-button" disabled={currentPage <= 1} onClick={() => setPage(value => value - 1)}>Anterior</button><span>Página {currentPage} de {totalPages}</span><button type="button" className="hs-button" disabled={currentPage >= totalPages} onClick={() => setPage(value => value + 1)}>Siguiente</button></div></div>
      </section>
    </>}
  </main>;
}

function ReactMonthHead() { return <><th scope="col">Cantidad</th><th scope="col">Monto sin IVA</th></>; }
function ReactMonthCells({ quantityValue, amountValue }) { return <><td className="hs-number">{quantity(quantityValue)}</td><td className="hs-number hs-amount">{money(amountValue)}</td></>; }
