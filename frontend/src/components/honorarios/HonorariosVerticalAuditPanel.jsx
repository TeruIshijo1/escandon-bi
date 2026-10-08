import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { API_BASE } from '../../api/config';
import { authHeaders } from '../../api/auth';
import { userMessage } from '../../utils/userMessages';
import './HonorariosVerticalAuditPanel.css';

const calendarDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const initialFilters = () => { const now = new Date(); return { startDate: calendarDate(new Date(now.getFullYear(), now.getMonth(), 1)),
  endDate: calendarDate(now), doctor: '', group: '', source: '', status: 'all', search: '', sort: 'date', direction: 'desc' }; };
const bitText = value => value == null ? 'Sin dato' : value === true || value === 1 ? 'Sí' : 'No';
const isInventoryGroup = value => /ALMACEN|FARMACIA/.test(String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase());
const money = value => value == null ? 'Sin importe' : new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(value);
const dateText = value => value ? String(value).slice(0, 10).split('-').reverse().join('/') : 'Sin fecha';
const appointmentStates = { CA: 'Cancelada', SH: 'Llegada registrada' };
const displayValue = (row, column) => {
  const value = row[column.key];
  if (column.type === 'boolean') return bitText(value);
  if (value == null || value === '') return 'Sin dato';
  if (column.type === 'money') return money(value);
  if (column.type === 'date') return `${dateText(value)} ${String(value).slice(11, 19)}`.trim();
  if (column.key === 'PCAP_ST') return appointmentStates[value] || `Estado registrado: ${value}`;
  if (column.key === 'SO_ST') return value === 'CA' ? 'Cancelada' : `Estado registrado: ${value}`;
  if (column.key === 'OrigenRenglon') return row.sourceLabel;
  return String(value);
};

export default function HonorariosVerticalAuditPanel() {
  const [filters, setFilters] = useState(initialFilters);
  const [result, setResult] = useState(null);
  const [applied, setApplied] = useState(null);
  const [options, setOptions] = useState({ doctors: [], groups: [], sources: [] });
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState('');
  const [optionsRetry, setOptionsRetry] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [exportError, setExportError] = useState('');
  const [selected, setSelected] = useState(null);
  const request = useRef({ id: 0, controller: null });
  const exportRequest = useRef(null);
  const detail = useRef(null);
  const detailTrigger = useRef(null);
  const changed = applied && JSON.stringify(filters) !== JSON.stringify(applied);
  const availableGroups = options.groups.filter(value => !isInventoryGroup(value));

  useEffect(() => () => { request.current.id += 1; request.current.controller?.abort(); exportRequest.current?.abort(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    setOptions({ doctors: [], groups: [], sources: [] }); setOptionsError('');
    if (!filters.startDate || !filters.endDate || filters.startDate > filters.endDate) {
      setOptionsLoading(false); return;
    }
    setOptionsLoading(true);
    apiFetch('/honorarios/vertical-audit/options', { signal: controller.signal,
      params: { startDate: filters.startDate, endDate: filters.endDate } })
      .then(response => {
        if (controller.signal.aborted) return;
        setOptions(response.options);
        setFilters(previous => isInventoryGroup(previous.group) ? { ...previous, group: '' } : previous);
      })
      .catch(failure => { if (!controller.signal.aborted) setOptionsError(userMessage(failure.message)); })
      .finally(() => { if (!controller.signal.aborted) setOptionsLoading(false); });
    return () => controller.abort();
  }, [filters.startDate, filters.endDate, optionsRetry]);
  useEffect(() => {
    if (selected) detail.current?.showModal();
    else { detail.current?.close(); detailTrigger.current?.focus(); }
  }, [selected]);

  const update = (key, value) => { setFilters(previous => ({ ...previous, [key]: value })); setExportError(''); };
  const load = async (queryFilters = filters, page = 1, size = pageSize) => {
    if (!queryFilters.startDate || !queryFilters.endDate || queryFilters.startDate > queryFilters.endDate) {
      setError('Elige una fecha inicial y final válidas, en ese orden.'); return;
    }
    request.current.controller?.abort();
    const controller = new AbortController();
    const id = request.current.id + 1;
    request.current = { id, controller };
    setLoading(true); setError(''); setExportError(''); setSelected(null); setResult(null);
    try {
      const response = await apiFetch('/honorarios/vertical-audit', { signal: controller.signal,
        params: { ...queryFilters, page, pageSize: size } });
      if (request.current.id !== id || controller.signal.aborted) return;
      setResult(response); setApplied({ ...queryFilters });
    } catch (failure) {
      if (request.current.id === id && !controller.signal.aborted) setError(userMessage(failure.message));
    } finally { if (request.current.id === id) setLoading(false); }
  };
  const exportExcel = async () => {
    if (!result?.summary?.total || changed || loading || exporting) return;
    const controller = new AbortController(); exportRequest.current = controller;
    setExporting(true); setExportError('');
    try {
      const response = await fetch(`${API_BASE}/honorarios/vertical-audit/excel?${new URLSearchParams(applied)}`,
        { headers: authHeaders(), signal: controller.signal });
      if (!response.ok) { const failure = await response.json().catch(() => ({}));
        throw new Error(failure.error || 'No se pudo descargar el Excel. Intenta de nuevo.'); }
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = `Auditoria_honorarios_${applied.startDate}_${applied.endDate}.xlsx`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { if (!controller.signal.aborted) setExportError(userMessage(failure.message)); }
    finally { if (!controller.signal.aborted) setExporting(false); }
  };

  return <section className="hon-vertical-audit" aria-label="Auditoría de honorarios">
    <div className="hon-audit-heading">
      <div><h2>Auditoría</h2><p>Consulta los registros originales y sus reglas de revisión en Vertical.</p></div>
      <button type="button" className="hon-friendly-button" onClick={exportExcel}
        disabled={!result?.summary?.total || changed || loading || exporting}>{exporting ? 'Preparando Excel…' : 'Descargar Excel'}</button>
    </div>
    <form className="hon-audit-filters hon-card" onSubmit={event => { event.preventDefault(); load(filters, 1, pageSize); }}>
      <fieldset disabled={exporting}>
        <div className="hon-field"><label htmlFor="audit-start">Desde</label><input id="audit-start" type="date" required value={filters.startDate}
          onChange={event => update('startDate', event.target.value)} /></div>
        <div className="hon-field"><label htmlFor="audit-end">Hasta</label><input id="audit-end" type="date" required value={filters.endDate}
          onChange={event => update('endDate', event.target.value)} /></div>
        <div className="hon-field"><label htmlFor="audit-status">Resultado de revisión</label><select id="audit-status" value={filters.status}
          onChange={event => update('status', event.target.value)}><option value="all">Todos</option><option value="eligible">Cumple reglas</option>
          <option value="excluded">Fuera de reglas</option><option value="unknown">Sin evaluar</option></select></div>
        <div className="hon-field"><label htmlFor="audit-doctor">Médico</label><select id="audit-doctor" value={filters.doctor} disabled={optionsLoading} onChange={event => update('doctor', event.target.value)}>
          <option value="">Todos los médicos</option>{filters.doctor && !options.doctors.includes(filters.doctor) && <option value={filters.doctor}>{filters.doctor}</option>}
          {options.doctors.map(value => <option key={value} value={value}>{value}</option>)}</select></div>
        <div className="hon-field"><label htmlFor="audit-group">Grupo de servicio</label><select id="audit-group" value={filters.group} disabled={optionsLoading} onChange={event => update('group', event.target.value)}>
          <option value="">Todos los grupos</option>{filters.group && !isInventoryGroup(filters.group) && !availableGroups.includes(filters.group) && <option value={filters.group}>{filters.group}</option>}
          {availableGroups.map(value => <option key={value} value={value}>{value}</option>)}</select></div>
        <div className="hon-field"><label htmlFor="audit-source">Origen del registro</label><select id="audit-source" value={filters.source} disabled={optionsLoading} onChange={event => update('source', event.target.value)}>
          <option value="">Todos los orígenes</option>{filters.source && !options.sources.some(source => source.value === filters.source)
            && <option value={filters.source}>Origen seleccionado</option>}{options.sources.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select></div>
        <div className="hon-field hon-audit-search"><label htmlFor="audit-search">Buscar paciente, médico, servicio, folio o motivo</label>
          <input id="audit-search" type="search" maxLength={200} placeholder="Escribe un nombre, código o folio" value={filters.search} onChange={event => update('search', event.target.value)} /></div>
        <div className="hon-field"><label htmlFor="audit-sort">Ordenar por</label><select id="audit-sort" value={filters.sort} onChange={event => update('sort', event.target.value)}>
          <option value="date">Fecha</option><option value="doctor">Médico</option><option value="patient">Paciente</option>
          <option value="service">Servicio</option><option value="amount">Importe de referencia</option></select></div>
        <div className="hon-field"><label htmlFor="audit-direction">Orden</label><select id="audit-direction" value={filters.direction} onChange={event => update('direction', event.target.value)}>
          <option value="desc">Descendente</option><option value="asc">Ascendente</option></select></div>
        <div className="hon-audit-filter-actions"><button className="hon-friendly-button primary" disabled={loading} type="submit">{loading ? 'Consultando…' : 'Consultar auditoría'}</button>
          <button className="hon-friendly-button" type="button" disabled={loading} onClick={() => { setFilters(previous => ({ ...initialFilters(), startDate: previous.startDate, endDate: previous.endDate })); setError(''); }}>Limpiar filtros</button></div>
      </fieldset>
      {optionsLoading && <p className="hon-audit-note" role="status">Cargando médicos, grupos y orígenes del periodo…</p>}
      {optionsError && <p className="hon-friendly-message error" role="alert">{optionsError} <button type="button" className="hon-friendly-button"
        disabled={exporting} onClick={() => setOptionsRetry(previous => previous + 1)}>Reintentar listas</button></p>}
      {!optionsLoading && !optionsError && filters.startDate && filters.endDate && filters.startDate <= filters.endDate
        && !options.doctors.length && !options.groups.length && !options.sources.length
        && <p className="hon-audit-note" role="status">No hay médicos, grupos u orígenes disponibles para estas fechas. Prueba otro periodo.</p>}
      <p className="hon-audit-note">Los importes son referencias de Vertical. El pago se prepara en Pagos y PDF. Se excluyen los grupos de farmacia y almacenes, además de los códigos FAR y ALM.</p>
    </form>
    {error && <p className="hon-friendly-message error" role="alert">{error}</p>}
    {exportError && <p className="hon-friendly-message error" role="alert">{exportError}</p>}
    {changed && !loading && <p className="hon-friendly-message" role="status">Los filtros cambiaron. Pulsa Consultar auditoría para actualizar los resultados.</p>}
    {loading && <p className="hon-audit-empty" role="status">Consultando registros de auditoría…</p>}
    {!loading && !result && !error && <p className="hon-audit-empty">Elige el periodo y los filtros, y pulsa Consultar auditoría.</p>}
    {result && !changed && !loading && <>
      <div className="hon-audit-summary" aria-label="Resumen de auditoría">
        {[[result.summary.total, 'Registros encontrados'], [result.summary.eligible, 'Cumplen reglas'],
          [result.summary.excluded, 'Fuera de reglas'], [result.summary.unknown, 'Sin evaluar']].map(([count, label]) =>
          <div key={label}><strong>{Number(count).toLocaleString('es-MX')}</strong><span>{label}</span></div>)}
      </div>
      <div className="hon-audit-results hon-card">
        <div className="hon-audit-results-heading"><p><strong>{result.summary.total.toLocaleString('es-MX')} registros</strong> · {dateText(applied.startDate)} al {dateText(applied.endDate)}</p>
          <p>El Excel incluye todos los resultados filtrados y el detalle de sus reglas.</p></div>
        {result.rows.length === 0 ? <p className="hon-audit-empty">No se encontraron registros. Prueba otro periodo o limpia los filtros.</p> :
          <div className="hon-audit-table-wrap" tabIndex={0} aria-label="Tabla de auditoría, desplázate para ver todas las columnas">
            <table className="hon-audit-table"><thead><tr>{['Fecha', 'Paciente / Cliente', 'Médico', 'Servicio / Grupo', 'Referencia / Orden de venta',
              'Origen', 'Cantidad', 'Importe de referencia', 'Resultado', 'Motivo de exclusión', 'Detalle'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
              <tbody>{result.rows.map((row, index) => <tr key={`${result.page}-${index}`}>
                <td>{dateText(row.PCDate)}</td><td>{row.PTName || 'Sin paciente'}<small>{row.BPName || 'Sin cliente'}</small></td>
                <td>{row.Medico || 'Sin médico'}<small>{row.Especialidad || ''}</small></td>
                <td>{row.ItemDescription || 'Sin servicio'}<small>{row.ItemCode} · {row.ItemGroupName || 'Sin grupo'}</small></td>
                <td>{row.PCNum ?? 'Sin referencia'}<small>Orden: {row.SONum ?? 'Sin orden'}</small></td>
                <td>{row.sourceLabel}</td><td>{row.Quantity ?? 'Sin dato'}</td><td className="hon-audit-money">{money(row.IMPORTE)}</td>
                <td><span className={`hon-audit-status ${row.auditStatus}`}>{row.auditStatusLabel}</span></td>
                <td>{row.MotivoExclusion || 'Sin motivo registrado'}</td>
                <td><button className="hon-friendly-button" type="button" aria-label={`Ver detalle del registro ${index + 1}`}
                  onClick={event => { detailTrigger.current = event.currentTarget; setSelected(row); }}>Ver detalle</button></td>
              </tr>)}</tbody>
            </table>
          </div>}
        <div className="hon-audit-pagination">
          <span>{result.summary.total === 0 ? '0 registros' : `${(result.page - 1) * result.pageSize + 1}–${Math.min(result.page * result.pageSize, result.summary.total)} de ${result.summary.total.toLocaleString('es-MX')}`}</span>
          <label>Por página <select aria-label="Registros por página" value={pageSize} disabled={exporting} onChange={event => {
            const size = Number(event.target.value); setPageSize(size); load(applied, 1, size);
          }}>{[25, 50, 100].map(size => <option key={size}>{size}</option>)}</select></label>
          <button className="hon-friendly-button" type="button" disabled={result.page <= 1 || exporting} onClick={() => load(applied, result.page - 1)}>Anterior</button>
          <span>Página {result.page} de {Math.max(1, result.totalPages)}</span>
          <button className="hon-friendly-button" type="button" disabled={result.page >= result.totalPages || exporting} onClick={() => load(applied, result.page + 1)}>Siguiente</button>
        </div>
      </div>
    </>}
    <dialog ref={detail} className="hon-audit-dialog" aria-labelledby="audit-detail-title" onCancel={() => setSelected(null)} onClose={() => setSelected(null)}
      onClick={event => { if (event.target === event.currentTarget) setSelected(null); }}>
      {selected && <><div className="hon-audit-heading"><h2 id="audit-detail-title">Detalle del registro</h2>
        <button type="button" autoFocus className="hon-friendly-button" onClick={() => setSelected(null)}>Cerrar</button></div>
        <p className="hon-audit-note">El folio de referencia corresponde al origen del registro y puede ser una atención, cita u orden. Las tasas conservan el valor original.</p>
        <p><span className={`hon-audit-status ${selected.auditStatus}`}>{selected.auditStatusLabel}</span></p>
        <dl className="hon-audit-detail">{result.columns.map(column => <div key={column.key}><dt>{column.label}</dt><dd>{displayValue(selected, column)}</dd></div>)}</dl>
      </>}
    </dialog>
  </section>;
}
