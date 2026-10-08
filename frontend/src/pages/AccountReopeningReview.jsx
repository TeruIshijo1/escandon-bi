import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../api/client';
import { userMessage } from '../utils/userMessages';
import './AccountReopeningReview.css';

const STATUS_LABELS = { closed: 'Cerrado', open: 'Abierto', unknown: 'Sin verificar', cancelled: 'Cancelado', settled: 'Sin partidas abiertas' };
const asArray = value => Array.isArray(value) ? value : [];
const messageText = value => typeof value === 'string' ? value : value?.message || value?.reason || '';
const documentLabel = node => `${node.typeLabel || node.entity || 'Documento'} ${node.docNum ?? node.docEntry ?? 'sin número'}`;
const hasLiteralClosedStatus = node => node.sapStatus === 'bost_Close' || node.sapStatus === 'C';
const isVerifiedInvoice = node => (node.cancelled === true && node.status === 'cancelled') || (node.cancelled === false && node.status === 'closed' && hasLiteralClosedStatus(node));
const DETAIL_TIMEOUT_MS = 250_000;
const SEARCH_TIMEOUT_MS = 130_000;
const formatElapsed = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

function useElapsedSeconds(active, startedAt) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [active, startedAt]);
  return active && startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
}

async function boundedQuery(path, options, controller, timeoutMs) {
  let onAbort;
  const interrupted = new Promise((_, reject) => {
    onAbort = () => reject(new Error('Consulta interrumpida'));
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });
  const timeout = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try {
    return await Promise.race([apiFetch(path, { ...options, signal: controller.signal }), interrupted]);
  } finally {
    clearTimeout(timeout);
    controller.signal.removeEventListener('abort', onAbort);
  }
}

function formatDate(value, includeTime = false) {
  if (!value) return 'Sin fecha';
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';
  return date.toLocaleString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Mexico_City' } : {}),
  });
}

function formatTotal(node) {
  if (node.total === null || node.total === undefined || node.total === '' || !Number.isFinite(Number(node.total))) return '—';
  const amount = Number(node.total).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${amount}${node.currency ? ` ${node.currency}` : ''}`;
}

function Icon({ name, ...props }) {
  const paths = {
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
    invoice: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 7h6M9 11h6M9 15h3" /></>,
    map: <><rect x="8" y="3" width="8" height="5" rx="1" /><rect x="2" y="16" width="8" height="5" rx="1" /><rect x="14" y="16" width="8" height="5" rx="1" /><path d="M12 8v4M6 16v-4h12v4" /></>,
    refresh: <><path d="M20 6v5h-5M4 18v-5h5" /><path d="M6.5 6.5a7.8 7.8 0 0 1 13 4.5M17.5 17.5A7.8 7.8 0 0 1 4.5 13" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    alert: <><path d="m12 3 10 18H2L12 3Z" /><path d="M12 9v5M12 17h.01" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name] || paths.invoice}</svg>;
}

function StatusBadge({ status }) {
  const known = Object.hasOwn(STATUS_LABELS, status) ? status : 'unknown';
  return <span className={`arr-status arr-status--${known}`}><span aria-hidden="true" />{STATUS_LABELS[known]}</span>;
}

// Topological layers preserve source → target direction. Cyclic or disconnected
// documents are still displayed; the relation list retains every valid edge.
function layoutDocuments(nodes, edges) {
  const nodeById = new Map(nodes.map(node => [String(node.id), node]));
  const incoming = new Map(nodes.map(node => [String(node.id), 0]));
  const outgoing = new Map(nodes.map(node => [String(node.id), []]));
  const validEdges = edges.filter(edge => nodeById.has(String(edge.source)) && nodeById.has(String(edge.target)));
  for (const edge of validEdges) {
    incoming.set(String(edge.target), incoming.get(String(edge.target)) + 1);
    outgoing.get(String(edge.source)).push(String(edge.target));
  }
  const levels = new Map();
  const queue = [...incoming.keys()].filter(id => incoming.get(id) === 0);
  queue.forEach(id => levels.set(id, 0));
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index];
    for (const target of outgoing.get(id)) {
      levels.set(target, Math.max(levels.get(target) || 0, (levels.get(id) || 0) + 1));
      incoming.set(target, incoming.get(target) - 1);
      if (incoming.get(target) === 0) queue.push(target);
    }
  }
  const columns = new Map();
  for (const node of nodes) {
    const level = levels.get(String(node.id)) || 0;
    if (!columns.has(level)) columns.set(level, []);
    columns.get(level).push(node);
  }
  const positions = new Map();
  let height = 180;
  let width = 310;
  [...columns.entries()].sort(([a], [b]) => a - b).forEach(([level, items]) => {
    items.forEach((node, row) => {
      positions.set(String(node.id), { x: 32 + level * 322, y: 32 + row * 146 });
    });
    height = Math.max(height, 64 + items.length * 146);
    width = Math.max(width, 64 + level * 322 + 238);
  });
  return { positions, edges: validEdges, nodeById, width, height };
}

function RelationshipMap({ nodes, edges }) {
  const [selectedId, setSelectedId] = useState(null);
  const [zoom, setZoom] = useState(1);
  const markerId = `arr-arrow-${useId().replace(/:/g, '')}`;
  const layout = useMemo(() => layoutDocuments(nodes, edges), [nodes, edges]);
  const selected = layout.nodeById.get(String(selectedId));
  const selectedEdges = selected ? layout.edges.filter(edge => String(edge.source) === String(selected.id) || String(edge.target) === String(selected.id)) : [];
  const highlighted = new Set(selected ? [String(selected.id), ...selectedEdges.flatMap(edge => [String(edge.source), String(edge.target)])] : []);

  if (!nodes.length) return <p className="arr-inline-empty">No se pudo obtener el mapa de relación. La cuenta queda sin verificar.</p>;

  return <>
    <div className="arr-map-toolbar">
      <p>Selecciona un documento para consultar su estado y sus relaciones. Las flechas indican origen → destino.</p>
      <div className="arr-zoom" aria-label="Escala del mapa">
        <button type="button" aria-label="Reducir mapa" onClick={() => setZoom(value => Math.max(0.65, value - 0.15))} disabled={zoom <= 0.65}>−</button>
        <button type="button" onClick={() => setZoom(1)} aria-label="Restablecer escala del mapa">{Math.round(zoom * 100)}%</button>
        <button type="button" aria-label="Ampliar mapa" onClick={() => setZoom(value => Math.min(1.45, value + 0.15))} disabled={zoom >= 1.45}>+</button>
      </div>
    </div>
    <div className="arr-map-viewport" tabIndex={0} role="region" aria-label={`Mapa SAP con ${nodes.length} documentos y ${layout.edges.length} relaciones; puedes desplazarte para verlos todos`}>
      <div style={{ width: layout.width * zoom, height: layout.height * zoom }}>
        <div className="arr-map-canvas" style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})` }}>
          <svg width={layout.width} height={layout.height} className="arr-map-lines" aria-hidden="true">
            <defs><marker id={markerId} markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" fill="#648ba7" /></marker></defs>
            {layout.edges.map((edge, index) => {
              const source = layout.positions.get(String(edge.source));
              const target = layout.positions.get(String(edge.target));
              const sx = source.x + 238;
              const sy = source.y + 56;
              const tx = target.x;
              const ty = target.y + 56;
              const active = selectedEdges.includes(edge);
              const sameColumn = source.x === target.x;
              const bend = sameColumn ? sx + 44 : (sx + tx) / 2;
              const path = sameColumn ? `M ${sx} ${sy} C ${bend} ${sy}, ${bend} ${ty - 30}, ${tx + 238} ${ty - 30} L ${tx + 238} ${ty}` : `M ${sx} ${sy} C ${bend} ${sy}, ${bend} ${ty}, ${tx - 3} ${ty}`;
              return <g key={`${edge.source}-${edge.target}-${index}`} opacity={selected && !active ? 0.25 : 1}>
                <path d={path} stroke={active ? '#0088a3' : '#648ba7'} strokeWidth={active ? 2.5 : 1.7} fill="none" markerEnd={`url(#${markerId})`}><title>{`${documentLabel(layout.nodeById.get(String(edge.source)))} → ${documentLabel(layout.nodeById.get(String(edge.target)))}${edge.label ? `: ${edge.label}` : ''}`}</title></path>
                {!sameColumn && edge.label && <text x={bend} y={(sy + ty) / 2 - 8} textAnchor="middle" className="arr-edge-label">{edge.label.length > 22 ? `${edge.label.slice(0, 20)}…` : edge.label}</text>}
              </g>;
            })}
          </svg>
          {nodes.map(node => {
            const position = layout.positions.get(String(node.id));
            return <button type="button" key={node.id} className={`arr-map-node${String(selectedId) === String(node.id) ? ' is-selected' : ''}${selected && !highlighted.has(String(node.id)) ? ' is-dimmed' : ''}`} style={{ left: position.x, top: position.y }} aria-pressed={String(selectedId) === String(node.id)} onClick={() => setSelectedId(node.id)}>
              <span className="arr-node-type">{node.typeLabel || node.entity || 'Documento'}</span>
              <strong>#{node.docNum ?? node.docEntry ?? '—'}</strong>
              <StatusBadge status={node.status} />
              <span className="arr-node-sap">SAP: {node.sapStatus || 'Sin estado disponible'}</span>
            </button>;
          })}
        </div>
      </div>
    </div>
    <div className="arr-map-legend"><StatusBadge status="closed" /><StatusBadge status="open" /><StatusBadge status="settled" /><StatusBadge status="cancelled" /><StatusBadge status="unknown" /></div>
    {selected && <div className="arr-document-detail" aria-live="polite">
      <div className="arr-document-detail-head"><h3>{documentLabel(selected)}</h3><button type="button" className="arr-text-button" onClick={() => setSelectedId(null)}>Ver todo el mapa</button></div>
      <dl className="arr-document-facts">
        <div><dt>Estado en SAP</dt><dd><StatusBadge status={selected.status} /> <code>{selected.sapStatus || 'Sin estado'}</code></dd></div>
        <div><dt>Fecha</dt><dd>{formatDate(selected.date)}</dd></div>
        <div><dt>Importe</dt><dd>{formatTotal(selected)}</dd></div>
        <div><dt>Referencia SAP</dt><dd>{selected.entity || '—'} · DocEntry {selected.docEntry ?? '—'}</dd></div>
      </dl>
      <h4>Relaciones del documento</h4>
      {selectedEdges.length ? <ul className="arr-relation-list">{selectedEdges.map((edge, index) => <li key={index}>
        <button type="button" onClick={() => setSelectedId(edge.source)}>{documentLabel(layout.nodeById.get(String(edge.source)))}</button>
        <span className="arr-relation-direction">{edge.label || 'Relacionado'} <span aria-hidden="true">→</span></span>
        <button type="button" onClick={() => setSelectedId(edge.target)}>{documentLabel(layout.nodeById.get(String(edge.target)))}</button>
      </li>)}</ul> : <p className="arr-inline-empty">Este documento no tiene relaciones registradas en el mapa consultado.</p>}
    </div>}
    <details className="arr-all-relations"><summary>Ver lista de todas las relaciones ({layout.edges.length})</summary>
      {layout.edges.length ? <ul>{layout.edges.map((edge, index) => <li key={index}>{documentLabel(layout.nodeById.get(String(edge.source)))} <span aria-hidden="true">→</span> {documentLabel(layout.nodeById.get(String(edge.target)))}{edge.label ? ` · ${edge.label}` : ''}</li>)}</ul> : <p className="arr-inline-empty">No hay vínculos entre los documentos consultados.</p>}
    </details>
  </>;
}

export default function AccountReopeningReview() {
  const [mode, setMode] = useState('patient');
  const [query, setQuery] = useState('');
  const [searchData, setSearchData] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [searchStartedAt, setSearchStartedAt] = useState(null);
  const [detailStartedAt, setDetailStartedAt] = useState(null);
  const [detailFullMap, setDetailFullMap] = useState(false);
  const searchSequence = useRef(0);
  const detailSequence = useRef(0);
  const searchController = useRef(null);
  const detailController = useRef(null);
  const searchElapsed = useElapsedSeconds(searchLoading, searchStartedAt);
  const detailElapsed = useElapsedSeconds(detailLoading, detailStartedAt);

  useEffect(() => () => {
    searchSequence.current += 1;
    detailSequence.current += 1;
    searchController.current?.abort('cancelled');
    detailController.current?.abort('cancelled');
  }, []);

  function clearSearch() {
    searchSequence.current += 1;
    detailSequence.current += 1;
    searchController.current?.abort('cancelled');
    detailController.current?.abort('cancelled');
    searchController.current = null;
    detailController.current = null;
    setSearchData(null);
    setSearchLoading(false);
    setSearchError('');
    setSelectedAccount(null);
    setDetail(null);
    setDetailLoading(false);
    setDetailError('');
    setDetailFullMap(false);
  }

  function cancelDetail() {
    detailSequence.current += 1;
    detailController.current?.abort('cancelled');
    detailController.current = null;
    setDetailLoading(false);
    setDetailError('Consulta cancelada. La cuenta sigue sin verificar; puedes reintentar cuando lo necesites.');
  }

  function cancelSearch() {
    searchSequence.current += 1;
    searchController.current?.abort('cancelled');
    searchController.current = null;
    setSearchLoading(false);
    setSearchError('Búsqueda cancelada. Puedes intentarlo de nuevo.');
  }

  async function loadAccount(account, { fullMap = false } = {}) {
    const request = ++detailSequence.current;
    detailController.current?.abort('cancelled');
    const controller = new AbortController();
    detailController.current = controller;
    setSelectedAccount(account);
    // Keep this account's previous observations visible during a new map request.
    // The prior diagnostic is hidden until a fresh response has been verified.
    setDetail(previous => previous && String(previous.account) === String(account.account) ? previous : null);
    setDetailError('');
    setDetailFullMap(fullMap);
    setDetailStartedAt(Date.now());
    setDetailLoading(true);
    try {
      const response = await boundedQuery(`/sap/account-review/${encodeURIComponent(account.account)}`, { params: fullMap ? { fullMap: true } : undefined }, controller, DETAIL_TIMEOUT_MS);
      if (request !== detailSequence.current) return;
      if (!response?.success || !response.data || String(response.data.account) !== String(account.account)) throw new Error(response?.message || 'No se pudo verificar la cuenta. Actualiza la consulta.');
      setDetail(response.data);
    } catch (error) {
      if (request === detailSequence.current) setDetailError(controller.signal.reason === 'timeout'
        ? 'La consulta alcanzó el límite de espera de 4 min 10 s. La cuenta sigue sin verificar. Puedes reintentar la consulta.'
        : userMessage(error));
    } finally {
      if (request === detailSequence.current) {
        setDetailLoading(false);
        detailController.current = null;
      }
    }
  }

  async function searchAccounts(event) {
    event.preventDefault();
    const value = query.trim();
    if (!value || (mode === 'patient' && value.length < 2)) {
      setSearchError(mode === 'patient' ? 'Escribe al menos dos letras del nombre del paciente.' : 'Escribe el número de cuenta.');
      return;
    }
    clearSearch();
    const request = ++searchSequence.current;
    const controller = new AbortController();
    searchController.current = controller;
    setSearchStartedAt(Date.now());
    setSearchLoading(true);
    try {
      const response = await boundedQuery('/sap/account-review/search', { params: { mode, q: value } }, controller, SEARCH_TIMEOUT_MS);
      if (request !== searchSequence.current) return;
      if (!response?.success || !Array.isArray(response.data?.accounts)) throw new Error(response?.message || 'No se pudieron consultar las cuentas. Intenta de nuevo.');
      setSearchData(response.data);
      if (response.data.accounts.length === 1) loadAccount(response.data.accounts[0]);
    } catch (error) {
      if (request === searchSequence.current) setSearchError(controller.signal.reason === 'timeout'
        ? 'La búsqueda alcanzó el límite de espera de 2 min 10 s. Puedes intentarlo de nuevo.'
        : userMessage(error));
    } finally {
      if (request === searchSequence.current) {
        setSearchLoading(false);
        searchController.current = null;
      }
    }
  }

  const accounts = asArray(searchData?.accounts);
  const confirmedPatientName = detail?.patientName && detail.patientName.trim().toLowerCase() !== 'sin nombre de paciente en sap'
    ? detail.patientName : selectedAccount?.patientName || 'Paciente sin nombre registrado';
  const invoices = asArray(detail?.invoices);
  const nodes = asArray(detail?.nodes);
  const edges = asArray(detail?.edges);
  const openDocuments = [...new Map([...asArray(detail?.openDocuments), ...nodes.filter(node => node.status === 'open')].map((node, index) => [node.id || `${node.entity}-${node.docEntry ?? index}`, node])).values()];
  const warnings = asArray(detail?.warnings).map(messageText).filter(Boolean);
  const invoiceIds = new Set(invoices.map(invoice => String(invoice.id)));
  const mapNotRequested = detail?.mapState === 'not_requested' || detail?.mapSkipped === true;
  const currentInvoices = invoices.filter(invoice => invoice.cancelled === false);
  const closedInvoices = currentInvoices.length > 0 && invoices.every(isVerifiedInvoice);
  const everyInvoiceMapped = invoices.every(invoice => invoice.id !== undefined && invoice.id !== null && nodes.some(node => String(node.id) === String(invoice.id) && node.cancelled === invoice.cancelled && isVerifiedInvoice(node)));
  const verifiedMap = nodes.length > 0 && nodes.every(node => invoiceIds.has(String(node.id)) || node.entity === 'Invoices'
    ? isVerifiedInvoice(node)
    // SAP omits cancellation flags on some non-invoice entities. Their verified
    // native or ledger status is authoritative; invoices require explicit flags.
    : (node.status === 'cancelled' && node.cancelled === true) || (node.cancelled !== true && ['closed', 'settled'].includes(node.status)));
  const eligible = !detailLoading && !detailError && !mapNotRequested && detail?.eligible === true && detail?.complete === true && detail?.status === 'eligible' && closedInvoices && everyInvoiceMapped && verifiedMap && openDocuments.length === 0;
  const blocked = !eligible && (detail?.status === 'blocked' || openDocuments.length > 0 || invoices.some(invoice => invoice.status === 'open') || nodes.some(node => node.status === 'open'));
  const diagnostic = eligible ? 'eligible' : blocked ? 'blocked' : 'unverified';
  const reasons = asArray(detail?.reasons).map(messageText).filter(Boolean);
  if (detail && !eligible && !reasons.length) reasons.push(!invoices.length ? 'No se encontraron facturas para verificar el cierre de esta cuenta.' : 'No se pudo confirmar que las facturas estén cerradas y que el mapa de relación esté completo y sin documentos abiertos.');

  return <div className="account-reopening-review">
    <header className="arr-header">
      <div className="arr-header-icon"><Icon name="invoice" /></div>
      <div><span className="arr-eyebrow">AUDITORÍA · SAP</span><h1>Facturas y reapertura de cuentas</h1><p>Consulta el estado real de las facturas y todos sus documentos relacionados.</p></div>
      <span className="arr-read-only">Solo consulta</span>
    </header>

    <div className="arr-rules" aria-label="Condiciones de reapertura">
      <div><Icon name="invoice" /><p><strong>Facturas cerradas en SAP</strong><span>El estado debe indicar Cerrado.</span></p></div>
      <span className="arr-rule-plus" aria-hidden="true">+</span>
      <div><Icon name="map" /><p><strong>Mapa sin documentos abiertos</strong><span>Todas las relaciones deben estar verificadas.</span></p></div>
    </div>

    <section className="arr-card arr-search-card" aria-labelledby="arr-search-title">
      <h2 id="arr-search-title">Buscar una cuenta</h2>
      <form onSubmit={searchAccounts} className="arr-search-form">
        <div className="arr-field arr-mode-field"><label htmlFor="arr-search-mode">Buscar por</label><select id="arr-search-mode" value={mode} onChange={event => { clearSearch(); setMode(event.target.value); setQuery(''); }}><option value="patient">Nombre del paciente</option><option value="account">Número de cuenta</option></select></div>
        <div className="arr-field arr-query-field"><label htmlFor="arr-search-query">{mode === 'patient' ? 'Nombre del paciente' : 'Número de cuenta'}</label><input id="arr-search-query" value={query} onChange={event => { clearSearch(); setQuery(event.target.value); }} placeholder={mode === 'patient' ? 'Escribe el nombre o los apellidos' : 'Escribe el número de cuenta'} autoComplete="off" maxLength={120} aria-describedby="arr-search-hint" /></div>
        <button type="submit" className="arr-primary-button" disabled={searchLoading || !query.trim()}><Icon name="search" />{searchLoading ? 'Buscando…' : 'Buscar'}</button>
      </form>
      <p id="arr-search-hint" className="arr-helper">{mode === 'patient' ? 'Busca por una parte del nombre y selecciona la cuenta que deseas revisar.' : 'La búsqueda por número de cuenta es exacta.'}</p>
      {searchError && <p className="arr-error" role="alert"><Icon name="alert" />{searchError}</p>}
      {searchLoading && <div className="arr-search-loading"><div role="status"><p>Consultando cuentas en SAP…</p><span>Tiempo transcurrido: {formatElapsed(searchElapsed)} · Límite de espera: 2 min 10 s</span></div><button type="button" className="arr-secondary-button" onClick={cancelSearch}>Cancelar búsqueda</button></div>}
      {searchData && <div className="arr-search-results">
        <div className="arr-results-heading"><h3>{accounts.length ? `${accounts.length} ${accounts.length === 1 ? 'cuenta encontrada' : 'cuentas encontradas'}` : 'No se encontraron cuentas'}</h3>{accounts.length > 1 && <span>Selecciona una cuenta para revisar</span>}</div>
        {searchData.truncated && <p className="arr-warning">Hay más coincidencias. Escribe un nombre más completo para acotar los resultados.</p>}
        {!accounts.length ? <p className="arr-inline-empty">Revisa el nombre o el número de cuenta e intenta de nuevo. Una búsqueda sin resultados no confirma que se pueda reaperturar.</p> : <div className="arr-account-list">{accounts.map(account => <button type="button" key={account.account} className={`arr-account-option${String(selectedAccount?.account) === String(account.account) ? ' is-selected' : ''}`} aria-pressed={String(selectedAccount?.account) === String(account.account)} onClick={() => loadAccount(account)}>
          <span className="arr-account-number">Cuenta {account.account}</span><strong>{account.patientName || 'Paciente sin nombre registrado'}</strong><span>{Number(account.invoiceCount) || 0} {(Number(account.invoiceCount) || 0) === 1 ? 'factura' : 'facturas'} <span aria-hidden="true">→</span></span>
        </button>)}</div>}
      </div>}
    </section>

    {!selectedAccount && !searchLoading && !searchData && <div className="arr-start-state"><Icon name="map" /><h2>Verifica una cuenta antes de reaperturar</h2><p>Busca al paciente o su cuenta para consultar las facturas, el mapa de relación y los documentos que impiden la reapertura.</p></div>}

    {selectedAccount && <section className="arr-account-heading" aria-label="Cuenta seleccionada"><div><span>CUENTA {selectedAccount.account}</span><h2>{confirmedPatientName}</h2><p className="arr-account-preview">{Number(selectedAccount.invoiceCount) || 0} {(Number(selectedAccount.invoiceCount) || 0) === 1 ? 'factura localizada' : 'facturas localizadas'} en la búsqueda inicial</p></div><button type="button" className="arr-secondary-button" onClick={() => loadAccount(selectedAccount, { fullMap: detailFullMap })} disabled={detailLoading}><Icon name="refresh" />{detailLoading ? 'Consultando…' : 'Actualizar desde SAP'}</button></section>}
    {detailLoading && <div className="arr-card arr-detail-loading"><div className="arr-spinner" aria-hidden="true" /><div role="status"><h3>{detailFullMap ? 'Consultando el mapa completo de relación en SAP…' : 'Verificando facturas y relaciones en SAP…'}</h3><p>Tiempo transcurrido: <strong>{formatElapsed(detailElapsed)}</strong> · Límite de espera: 4 min 10 s</p><p className="arr-wait-explanation">{detailElapsed >= 60 ? 'La consulta lleva un minuto o más. Puedes cancelarla y volver a intentar.' : detailElapsed >= 30 ? 'Todavía no se ha recibido la respuesta de SAP. La cuenta sigue sin verificar.' : 'La cuenta sigue sin verificar mientras esperamos la respuesta de SAP.'}</p></div>{!detail && Number(selectedAccount?.invoiceCount) === 0 && <p className="arr-pending-no-invoice">La búsqueda inicial no localizó facturas. Estamos confirmando ese resultado; todavía no se ha verificado el mapa.</p>}<button type="button" className="arr-secondary-button" onClick={cancelDetail}>Cancelar consulta</button></div>}
    {detailError && <div className="arr-error arr-detail-error" role="alert"><Icon name="alert" /><div><strong>Cuenta sin verificar</strong><p>{detailError}</p><button type="button" className="arr-secondary-button" onClick={() => loadAccount(selectedAccount, { fullMap: detailFullMap })}>Reintentar consulta</button></div></div>}
    {detail && (detailLoading || detailError) && <div className="arr-warning arr-previous-result"><strong>Datos de la consulta anterior</strong><p>Consulta: {formatDate(detail.checkedAt, true)}. Se conservan las facturas y documentos ya observados; estos datos no confirman el resultado de la actualización pendiente.</p></div>}

    {detail && <>
      {!detailLoading && !detailError && <section className={`arr-diagnostic arr-diagnostic--${diagnostic}`} aria-labelledby="arr-diagnostic-title" role="status">
        <div className="arr-diagnostic-icon"><Icon name={eligible ? 'check' : blocked ? 'alert' : 'clock'} /></div>
        <div className="arr-diagnostic-body"><span className="arr-eyebrow">REVISIÓN DE REAPERTURA</span><h2 id="arr-diagnostic-title">{eligible ? 'Cumple condiciones para reapertura' : blocked ? 'No cumple condiciones para reapertura' : 'No se puede confirmar la reapertura'}</h2>
          {eligible ? <p>Las facturas vigentes están cerradas en SAP y el mapa completo no contiene documentos abiertos.</p> : <ul>{reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>}
          <p className="arr-check-time"><Icon name="clock" />Consulta: {formatDate(detail.checkedAt, true)} · Hora de Ciudad de México</p>
        </div>
      </section>}
      <div className="arr-metrics"><div><span>Facturas de la cuenta</span><strong>{invoices.length}</strong></div><div><span>Documentos en el mapa</span><strong className={mapNotRequested ? 'arr-metric-text' : undefined}>{mapNotRequested ? 'Sin consultar' : nodes.length}</strong></div><div className={openDocuments.length ? 'arr-metric-alert' : ''}><span>Documentos abiertos</span><strong className={mapNotRequested ? 'arr-metric-text' : undefined}>{mapNotRequested ? 'Sin verificar' : openDocuments.length}</strong></div><div><span>Verificación del mapa</span><strong className="arr-metric-text">{mapNotRequested ? 'Sin consultar' : detail.complete === true ? 'Completa' : 'Incompleta'}</strong></div></div>
      {warnings.length > 0 && <div className="arr-warning"><strong>Observaciones de la consulta</strong><ul>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
      {openDocuments.length > 0 && <section className="arr-card arr-open-documents" aria-labelledby="arr-open-title"><h2 id="arr-open-title"><Icon name="alert" />Documentos abiertos que impiden la reapertura</h2><ul>{openDocuments.map((node, index) => <li key={node.id || index}><strong>{documentLabel(node)}</strong><StatusBadge status="open" /><span>SAP: <code>{node.sapStatus || 'Sin estado disponible'}</code></span></li>)}</ul></section>}
      <section className="arr-card" aria-labelledby="arr-invoices-title"><div className="arr-section-heading"><h2 id="arr-invoices-title"><Icon name="invoice" />Estado de las facturas</h2><span>{invoices.length} {(invoices.length === 1 ? 'factura' : 'facturas')}</span></div>
        {invoices.length ? <div className="arr-table-scroll"><table className="arr-invoice-table"><thead><tr><th scope="col">Factura</th><th scope="col">Fecha</th><th scope="col">Estado</th><th scope="col">Estado literal SAP</th><th scope="col">Importe</th><th scope="col">Referencia SAP</th></tr></thead><tbody>{invoices.map((invoice, index) => <tr key={invoice.id || index}><td><strong>#{invoice.docNum ?? invoice.docEntry ?? '—'}</strong>{invoice.typeLabel && <span className="arr-cell-sub">{invoice.typeLabel}</span>}</td><td>{formatDate(invoice.date)}</td><td><StatusBadge status={invoice.status} /></td><td><code>{invoice.sapStatus || 'Sin estado disponible'}</code></td><td className="arr-money">{formatTotal(invoice)}</td><td>{invoice.entity || '—'}<span className="arr-cell-sub">DocEntry {invoice.docEntry ?? '—'}</span></td></tr>)}</tbody></table></div> : <p className="arr-inline-empty">No se encontraron facturas para confirmar el cierre. Esta cuenta no puede considerarse apta para reapertura.</p>}
      </section>
      <section className="arr-card arr-map-card" aria-labelledby="arr-map-title"><div className="arr-section-heading"><h2 id="arr-map-title"><Icon name="map" />Mapa de relación SAP</h2><span>{mapNotRequested ? 'Consulta completa pendiente' : `${nodes.length} documentos · ${edges.length} relaciones`}</span></div>{mapNotRequested ? <div className="arr-map-not-requested"><h3>Mapa completo no consultado</h3><p>La cuenta no tiene una factura localizada en SAP y no cumple el requisito para reapertura. Un mapa sin consultar no acredita que todos los documentos estén cerrados.</p><button type="button" className="arr-secondary-button" disabled={detailLoading} onClick={() => loadAccount(selectedAccount, { fullMap: true })}><Icon name="map" />Consultar mapa completo</button></div> : <RelationshipMap key={`${detail.account}-${detail.checkedAt}`} nodes={nodes} edges={edges} />}</section>
      <p className="arr-consultation-note">Esta revisión muestra las condiciones observadas durante la consulta. La reapertura de la cuenta se realiza en SAP conforme al procedimiento del hospital.</p>
    </>}
  </div>;
}
