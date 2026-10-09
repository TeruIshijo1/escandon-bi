import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { userMessage } from '../utils/userMessages';
import './AccountReopeningReview.css';

const STATUS_LABELS = { closed: 'Cerrado', open: 'Abierto', unknown: 'Sin verificar', cancelled: 'Cancelado', settled: 'Sin partidas abiertas' };
const asArray = value => Array.isArray(value) ? value : [];
const messageText = value => typeof value === 'string' ? value : value?.message || value?.reason || '';
const documentTypeLabel = node => node.typeLabel || ({ Orders: 'Orden de venta', DeliveryNotes: 'Entrega', Invoices: 'Factura de clientes', IncomingPayments: 'Pago recibido', CreditNotes: 'Nota de crédito', DownPayments: 'Anticipo', JournalEntries: 'Asiento contable', InternalReconciliations: 'Conciliación interna' }[node.entity] || 'Documento SAP');
const documentLabel = node => `${documentTypeLabel(node)} ${node.docNum ?? node.docEntry ?? 'sin número'}`;
const hasLiteralClosedStatus = node => node.sapStatus === 'bost_Close' || node.sapStatus === 'C';
const hasLiteralOpenStatus = node => node.sapStatus === 'bost_Open' || node.sapStatus === 'O';
const documentIndicatesOpen = node => node.status === 'open' || hasLiteralOpenStatus(node);
const isVerifiedInvoice = node => !documentIndicatesOpen(node) && ((node.cancelled === true && node.status === 'cancelled') || (node.cancelled === false && node.status === 'closed' && hasLiteralClosedStatus(node)));
const isVerifiedDocument = node => !documentIndicatesOpen(node) && (node.entity === 'Invoices' ? isVerifiedInvoice(node)
  : (node.status === 'cancelled' && node.cancelled === true) || (node.cancelled !== true && ['closed', 'settled'].includes(node.status)));
const displayDocumentStatus = node => documentIndicatesOpen(node) ? 'open' : isVerifiedDocument(node) ? node.status : 'unknown';
const documentStateExplanation = node => {
  const status = displayDocumentStatus(node);
  if (status === 'open') return 'Este documento sigue abierto o tiene partidas pendientes en SAP e impide la reapertura.';
  if (status === 'closed') return 'Este documento está cerrado. Que permanezca en el mapa como historial no impide la reapertura.';
  if (status === 'settled') return 'Este documento no tiene partidas abiertas verificadas. Permanece visible como parte del historial.';
  if (status === 'cancelled') return node.cancellationDocument === true
    ? 'Este documento registra una cancelación en SAP. Se conserva en el mapa como historial; la reapertura depende de que el mapa completo no tenga documentos ni saldos abiertos.'
    : 'La cancelación de este documento está confirmada. Se conserva su relación para consultar el historial.';
  return 'No se pudo confirmar el estado de este documento. Hace falta verificarlo antes de confirmar la reapertura.';
};
const MAP_NODE_WIDTH = 246;
const MAP_NODE_HEIGHT = 174;
const DETAIL_TIMEOUT_MS = 250_000;
const SEARCH_TIMEOUT_MS = 130_000;
const WRITE_TIMEOUT_MS = 250_000;
const PENDING_REOPENING_KEY = 'escandon_reopening_pending:';
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

// A slow write may still commit on the server. Stop waiting at the deadline,
// retain its token for a status query, and never abort or replay the mutation.
async function reopeningRequest(path, body) {
  let timeout;
  try {
    return await Promise.race([
      apiFetch(path, { method: 'POST', body }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(Object.assign(new Error('La respuesta de la reapertura sigue pendiente.'), { status: 0 })), WRITE_TIMEOUT_MS); }),
    ]);
  } finally { clearTimeout(timeout); }
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
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3" /></>,
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
  const stage = node => ({ SalesQuotations: 0, Quotations: 0, Orders: 1, DeliveryNotes: 2, DownPayments: 2, Invoices: 3, CreditNotes: 4, IncomingPayments: 4, JournalEntries: 5, InternalReconciliations: 6 }[node?.entity] ?? 3);
  // SAP can include an invoice → journal link and its journal → invoice origin.
  // Keep both for inspection, but only the forward link determines the columns.
  // Otherwise a reciprocal accounting link collapses the commercial chain.
  const layeringEdges = validEdges.filter((edge, index) => {
    if (String(edge.source) === String(edge.target)) return false;
    const reverseIndex = validEdges.findIndex(candidate => String(candidate.source) === String(edge.target) && String(candidate.target) === String(edge.source));
    if (reverseIndex < 0) return true;
    const difference = stage(nodeById.get(String(edge.source))) - stage(nodeById.get(String(edge.target)));
    return difference < 0 || (difference === 0 && index < reverseIndex);
  });
  for (const edge of layeringEdges) {
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
    const level = levels.get(String(node.id)) ?? stage(node);
    if (!columns.has(level)) columns.set(level, []);
    columns.get(level).push(node);
  }
  const positions = new Map();
  let height = 238;
  let width = 310;
  [...columns.entries()].sort(([a], [b]) => a - b).forEach(([level, items]) => {
    items.forEach((node, row) => {
      positions.set(String(node.id), { x: 32 + level * 346, y: 32 + row * (MAP_NODE_HEIGHT + 36) });
    });
    height = Math.max(height, 64 + items.length * (MAP_NODE_HEIGHT + 36));
    width = Math.max(width, 64 + level * 346 + MAP_NODE_WIDTH);
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
  const partners = [...new Map(nodes.filter(node => node.cardCode).map(node => [node.cardCode, { code: node.cardCode, name: node.cardName }])).values()];

  if (!nodes.length) return <p className="arr-inline-empty">No se pudo obtener el mapa de relación. La cuenta queda sin verificar.</p>;

  return <>
    {partners.length > 0 && <div className="arr-map-partners" aria-label="Socios de negocios en SAP">{partners.map(partner => <div key={partner.code}><span>Socio de negocios</span><strong>{partner.name || partner.code}</strong>{partner.name && <small>{partner.code}</small>}</div>)}</div>}
    <div className="arr-map-toolbar">
      <p>Selecciona un documento para consultar su estado y sus relaciones. Las flechas indican origen → destino. Desplázate dentro del mapa para ver todos los documentos.</p>
      <div className="arr-zoom" aria-label="Escala del mapa">
        <button type="button" aria-label="Reducir mapa" onClick={() => setZoom(value => Math.max(0.65, value - 0.15))} disabled={zoom <= 0.65}>−</button>
        <button type="button" onClick={() => setZoom(1)} aria-label="Restablecer escala del mapa">{Math.round(zoom * 100)}%</button>
        <button type="button" aria-label="Ampliar mapa" onClick={() => setZoom(value => Math.min(1.45, value + 0.15))} disabled={zoom >= 1.45}>+</button>
      </div>
    </div>
    <div className="arr-map-viewport" tabIndex={0} role="region" aria-label={`Mapa SAP con ${nodes.length} ${nodes.length === 1 ? 'documento' : 'documentos'} y ${layout.edges.length} ${layout.edges.length === 1 ? 'relación' : 'relaciones'}; puedes desplazarte para verlos todos`}>
      <div style={{ width: layout.width * zoom, height: layout.height * zoom }}>
        <div className="arr-map-canvas" style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})` }}>
          <svg width={layout.width} height={layout.height} className="arr-map-lines" aria-hidden="true">
            <defs><marker id={markerId} markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" fill="#648ba7" /></marker></defs>
            {layout.edges.map((edge, index) => {
              const source = layout.positions.get(String(edge.source));
              const target = layout.positions.get(String(edge.target));
              const sx = source.x + MAP_NODE_WIDTH;
              const sy = source.y + MAP_NODE_HEIGHT / 2;
              const tx = target.x;
              const ty = target.y + MAP_NODE_HEIGHT / 2;
              const active = selectedEdges.includes(edge);
              const sameColumn = source.x === target.x;
              const backwards = source.x > target.x;
              const bend = sameColumn ? sx + 44 : (sx + tx) / 2;
              const returnLane = Math.min(source.y, target.y) - 15 - (index % 3) * 5;
              const path = sameColumn ? `M ${sx} ${sy} C ${bend} ${sy}, ${bend} ${ty - 30}, ${tx + MAP_NODE_WIDTH} ${ty - 30} L ${tx + MAP_NODE_WIDTH} ${ty}`
                : backwards ? `M ${source.x + MAP_NODE_WIDTH / 2} ${source.y} C ${source.x + MAP_NODE_WIDTH / 2} ${returnLane}, ${target.x + MAP_NODE_WIDTH / 2} ${returnLane}, ${target.x + MAP_NODE_WIDTH / 2} ${target.y - 3}`
                  : `M ${sx} ${sy} C ${bend} ${sy}, ${bend} ${ty}, ${tx - 3} ${ty}`;
              return <g key={`${edge.source}-${edge.target}-${index}`} opacity={selected && !active ? 0.25 : 1}>
                <path d={path} stroke={active ? '#0088a3' : '#648ba7'} strokeWidth={active ? 2.5 : 1.7} fill="none" markerEnd={`url(#${markerId})`}><title>{`${documentLabel(layout.nodeById.get(String(edge.source)))} → ${documentLabel(layout.nodeById.get(String(edge.target)))}${edge.label ? `: ${edge.label}` : ''}`}</title></path>
                {!sameColumn && !backwards && edge.label && <text x={bend} y={(sy + ty) / 2 - 8} textAnchor="middle" className="arr-edge-label">{edge.label.length > 22 ? `${edge.label.slice(0, 20)}…` : edge.label}</text>}
              </g>;
            })}
          </svg>
          {nodes.map(node => {
            const position = layout.positions.get(String(node.id));
            const status = displayDocumentStatus(node);
            return <button type="button" key={node.id} className={`arr-map-node arr-map-node--${status}${String(selectedId) === String(node.id) ? ' is-selected' : ''}${selected && !highlighted.has(String(node.id)) ? ' is-dimmed' : ''}`} style={{ left: position.x, top: position.y }} aria-pressed={String(selectedId) === String(node.id)} onClick={() => setSelectedId(node.id)}>
              <span className="arr-node-type" title={documentTypeLabel(node)}>{documentTypeLabel(node)}</span>
              <strong>#{node.docNum ?? node.docEntry ?? '—'}</strong>
              <Icon name={status === 'closed' ? 'lock' : status === 'settled' || status === 'cancelled' ? 'check' : status === 'open' ? 'alert' : 'clock'} className="arr-node-state-icon" />
              <StatusBadge status={status} />
              <span className="arr-node-date">{formatDate(node.date)}</span>
              <span className="arr-node-total">{formatTotal(node)}</span>
              <span className="arr-node-sap">SAP: {node.sapStatus || 'Sin estado disponible'}</span>
            </button>;
          })}
        </div>
      </div>
    </div>
    <div className="arr-map-legend"><StatusBadge status="closed" /><StatusBadge status="open" /><StatusBadge status="settled" /><StatusBadge status="cancelled" /><StatusBadge status="unknown" /></div>
    {selected && <div className="arr-document-detail" aria-live="polite">
      <div className="arr-document-detail-head"><h3>{documentLabel(selected)}</h3><button type="button" className="arr-text-button" onClick={() => setSelectedId(null)}>Ver todo el mapa</button></div>
      <p className={`arr-document-explanation arr-document-explanation--${displayDocumentStatus(selected)}`}>{documentStateExplanation(selected)}</p>
      <dl className="arr-document-facts">
        <div><dt>Estado en SAP</dt><dd><StatusBadge status={displayDocumentStatus(selected)} /> <code>{selected.sapStatus || 'Sin estado'}</code></dd></div>
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

function ReopeningReceipt({ receipt }) {
  return <section className="arr-card arr-reopening-success" aria-labelledby="arr-reopening-success-title" role="status"><h2 id="arr-reopening-success-title"><Icon name="check" />Cuenta reaperturada en Vertical</h2><p>La cuenta {receipt.account} cambió de cerrada a abierta. Se respaldó y retiró el registro confirmado.</p><dl className="arr-reopening-facts"><div><dt>Folio de operación</dt><dd>{receipt.operationId}</dd></div><div><dt>Registro retirado</dt><dd>{receipt.deletedRecordId ?? 'Confirmado en el folio de operación'}</dd></div><div><dt>Fecha de reapertura</dt><dd>{formatDate(receipt.reopenedAt, true)}</dd></div></dl><div className="arr-reopening-backup"><strong>Respaldo guardado</strong><code>{receipt.backupFile}</code></div></section>;
}

function ReopeningProgress({ phase, attempt, message, onStatus, canRead }) {
  return <section className="arr-card arr-reopening-progress" aria-labelledby="arr-reopening-progress-title" role="status"><h2 id="arr-reopening-progress-title"><Icon name="clock" />{phase === 'executing' ? 'Respaldando y reaperturando cuenta…' : 'Resultado de la reapertura por confirmar'}</h2><p>{phase === 'executing' ? `Se está respaldando el registro y procesando la reapertura de la cuenta ${attempt?.account} en Vertical. Espera el resultado para continuar.` : message}</p>{phase !== 'executing' && <button type="button" className="arr-secondary-button" disabled={!canRead || phase === 'checking'} onClick={onStatus}><Icon name="refresh" />{phase === 'checking' ? 'Consultando estado…' : 'Consultar estado de la reapertura'}</button>}</section>;
}

export default function AccountReopeningReview() {
  const { user } = useAuth();
  const canReopen = String(user?.username || '').trim().toLowerCase() === 'amendoza' || asArray(user?.permisos).includes('ejecutar-reapertura-cuentas');
  const sessionOwner = String(user?.id || user?.username || '').trim().toLowerCase();
  const pendingStorageKey = sessionOwner ? `${PENDING_REOPENING_KEY}${sessionOwner}` : null;
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
  const [reopeningPreview, setReopeningPreview] = useState(null);
  const [confirmedAccount, setConfirmedAccount] = useState('');
  const [preparingReopening, setPreparingReopening] = useState(false);
  const [reopeningPhase, setReopeningPhase] = useState('idle');
  const [reopeningError, setReopeningError] = useState('');
  const [pendingReopening, setPendingReopening] = useState(null);
  const [reopeningReceipts, setReopeningReceipts] = useState(() => new Map());
  const [previewNow, setPreviewNow] = useState(() => Date.now());
  const prepareSequence = useRef(0);
  const prepareController = useRef(null);
  const writeInFlight = useRef(false);
  const searchSequence = useRef(0);
  const detailSequence = useRef(0);
  const searchController = useRef(null);
  const detailController = useRef(null);
  const searchElapsed = useElapsedSeconds(searchLoading, searchStartedAt);
  const detailElapsed = useElapsedSeconds(detailLoading, detailStartedAt);
  const contextLocked = ['executing', 'pending', 'checking'].includes(reopeningPhase);

  useEffect(() => {
    if (!pendingStorageKey) return;
    try {
      const stored = sessionStorage.getItem(pendingStorageKey);
      if (!stored) return;
      const attempt = JSON.parse(stored);
      if (!attempt?.account || typeof attempt.previewToken !== 'string' || !attempt.previewToken) throw new Error('Intento pendiente sin datos para consultar su estado.');
      setPendingReopening({ account: String(attempt.account), previewToken: attempt.previewToken });
      setSelectedAccount({ account: String(attempt.account), patientName: 'Reapertura de esta sesión', invoiceCount: 0 });
      setReopeningPhase('pending');
      setReopeningError('Se recuperó una reapertura pendiente de esta sesión. Consulta su estado antes de continuar.');
    } catch {
      setReopeningError('No se pudo recuperar el resultado pendiente de esta sesión. Permite el almacenamiento de la sesión y revisa la operación en Vertical antes de continuar.');
    }
  }, [pendingStorageKey]);

  useEffect(() => {
    if (!reopeningPreview) return;
    setPreviewNow(Date.now());
    const timer = setInterval(() => setPreviewNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [reopeningPreview]);

  useEffect(() => () => {
    searchSequence.current += 1;
    detailSequence.current += 1;
    searchController.current?.abort('cancelled');
    detailController.current?.abort('cancelled');
    prepareSequence.current += 1;
    prepareController.current?.abort('cancelled');
  }, []);

  function invalidatePreview() {
    prepareSequence.current += 1;
    prepareController.current?.abort('cancelled');
    prepareController.current = null;
    setPreparingReopening(false);
    setReopeningPreview(null);
    setConfirmedAccount('');
    setReopeningError('');
  }

  function clearSearch() {
    if (writeInFlight.current || contextLocked) return;
    invalidatePreview();
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
    if (writeInFlight.current || contextLocked) return;
    invalidatePreview();
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

  async function searchAccounts(event, { searchMode = mode } = {}) {
    event.preventDefault();
    if (writeInFlight.current || contextLocked) return;
    const value = query.trim();
    if (!value || (searchMode === 'patient' && value.length < 2)) {
      setSearchError(searchMode === 'patient' ? 'Escribe al menos dos letras del nombre del paciente.' : searchMode === 'order' ? 'Escribe el número de orden de venta SAP.' : 'Escribe el número de cuenta.');
      return;
    }
    clearSearch();
    const request = ++searchSequence.current;
    const controller = new AbortController();
    searchController.current = controller;
    setSearchStartedAt(Date.now());
    setSearchLoading(true);
    try {
      const response = await boundedQuery('/sap/account-review/search', { params: { mode: searchMode, q: value } }, controller, SEARCH_TIMEOUT_MS);
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
  const searchWarnings = asArray(searchData?.warnings).map(messageText).filter(Boolean);
  const confirmedPatientName = detail?.patientName && detail.patientName.trim().toLowerCase() !== 'sin nombre de paciente en sap'
    ? detail.patientName : selectedAccount?.patientName || 'Paciente sin nombre registrado';
  const invoices = asArray(detail?.invoices);
  const nodes = asArray(detail?.nodes);
  const edges = asArray(detail?.edges);
  const openDocuments = [...new Map([...asArray(detail?.openDocuments), ...nodes.filter(documentIndicatesOpen), ...invoices.filter(documentIndicatesOpen)].map((node, index) => [node.id || `${node.entity}-${node.docEntry ?? index}`, node])).values()];
  const warnings = asArray(detail?.warnings).map(messageText).filter(Boolean);
  const invoiceIds = new Set(invoices.map(invoice => String(invoice.id)));
  const mapNotRequested = detail?.mapState === 'not_requested' || detail?.mapSkipped === true;
  const mapIncomplete = mapNotRequested || detail?.complete !== true;
  const unknownDocuments = [...new Map([...asArray(detail?.unknownDocuments), ...nodes.filter(node => displayDocumentStatus(node) === 'unknown')].map((node, index) => [node.id || `${node.entity}-${node.docEntry ?? index}`, node])).values()];
  const missingRelations = edges.some(edge => !nodes.some(node => String(node.id) === String(edge.source)) || !nodes.some(node => String(node.id) === String(edge.target)));
  const openCountUnverified = mapIncomplete || missingRelations || unknownDocuments.length > 0;
  const currentInvoices = invoices.filter(invoice => invoice.cancelled === false);
  const closedInvoices = invoices.every(isVerifiedInvoice);
  const everyInvoiceMapped = invoices.every(invoice => invoice.id !== undefined && invoice.id !== null && nodes.some(node => String(node.id) === String(invoice.id) && node.cancelled === invoice.cancelled && isVerifiedInvoice(node)));
  const verifiedMap = nodes.length > 0 && nodes.every(node => invoiceIds.has(String(node.id)) ? isVerifiedInvoice(node) : isVerifiedDocument(node));
  const accountConfirmed = (detail?.accountFound === true || (detail?.accountFound === undefined && invoices.length > 0)) && (detail?.accountDocumentCount === undefined || Number(detail.accountDocumentCount) > 0);
  const eligible = !detailLoading && !detailError && accountConfirmed && !mapIncomplete && !missingRelations && detail?.eligible === true && detail?.status === 'eligible' && closedInvoices && everyInvoiceMapped && verifiedMap && openDocuments.length === 0 && unknownDocuments.length === 0;
  const blocked = !eligible && (detail?.status === 'blocked' || openDocuments.length > 0 || invoices.some(invoice => invoice.status === 'open') || nodes.some(node => node.status === 'open'));
  const diagnostic = eligible ? 'eligible' : blocked ? 'blocked' : 'unverified';
  const reasons = asArray(detail?.reasons).map(messageText).filter(Boolean);
  if (detail && !eligible && !reasons.length) reasons.push(openDocuments.length ? 'Hay documentos o saldos abiertos en el mapa de relación que impiden la reapertura.' : 'No se pudo confirmar que el mapa de relación de esta cuenta esté completo y sin documentos ni saldos abiertos.');
  if (detail && !accountConfirmed) reasons.push('No se confirmó ningún documento propio de esta cuenta en SAP. Verifica el número de cuenta antes de decidir la reapertura.');
  if (missingRelations) reasons.push('Hay relaciones cuyos documentos todavía no se han obtenido. Completa la consulta del mapa antes de decidir la reapertura.');
  const reopeningReceipt = reopeningReceipts.get(String(selectedAccount?.account));
  const previewExpired = reopeningPreview && previewNow >= Date.parse(reopeningPreview.expiresAt);
  const previewUsable = canReopen && eligible && !contextLocked && !reopeningReceipt && reopeningPreview && String(reopeningPreview.account) === String(selectedAccount?.account) && !previewExpired;

  useEffect(() => {
    if (reopeningPreview && (!eligible || !canReopen || String(reopeningPreview.account) !== String(selectedAccount?.account))) {
      setReopeningPreview(null);
      setConfirmedAccount('');
    }
  }, [eligible, canReopen, selectedAccount?.account, reopeningPreview]);

  useEffect(() => {
    if (previewExpired) {
      setReopeningPreview(null);
      setConfirmedAccount('');
      setReopeningError('La preparación expiró. Prepara nuevamente la reapertura para volver a verificar la cuenta.');
    }
  }, [previewExpired]);

  async function prepareReopening() {
    if (!canReopen || !eligible || writeInFlight.current || contextLocked || preparingReopening || prepareController.current || reopeningReceipt) return;
    invalidatePreview();
    const sequence = ++prepareSequence.current;
    const controller = new AbortController();
    prepareController.current = controller;
    const account = String(selectedAccount.account);
    setPreparingReopening(true);
    try {
      const response = await boundedQuery(`/sap/account-review/${encodeURIComponent(account)}/reopening/prepare`, { method: 'POST' }, controller, DETAIL_TIMEOUT_MS);
      if (sequence !== prepareSequence.current) return;
      const preview = response?.data;
      if (!response?.success || !preview || String(preview.account) !== account || preview.status !== 'ready' || preview.verticalStatus !== 'CL' || preview.recordCount !== 1 || preview.record?.id === undefined || !preview.previewToken || !preview.backupDirectory || !Number.isFinite(Date.parse(preview.expiresAt)) || Date.parse(preview.expiresAt) <= Date.now()) throw new Error('No se obtuvo una preparación válida. Actualiza la revisión de SAP y vuelve a preparar la reapertura.');
      setReopeningPreview(preview);
      setPreviewNow(Date.now());
    } catch (error) {
      if (sequence === prepareSequence.current) {
        setReopeningError(userMessage(error));
        setDetailError('La preparación no se completó. Actualiza la consulta de SAP antes de volver a preparar la reapertura.');
      }
    } finally {
      if (sequence === prepareSequence.current) {
        setPreparingReopening(false);
        prepareController.current = null;
      }
    }
  }

  function saveReopeningReceipt(receipt, account) {
    if (receipt?.status !== 'reopened' || String(receipt.account) !== account || !receipt.operationId || !receipt.backupFile) throw new Error('No se recibió una confirmación completa de la reapertura.');
    setReopeningReceipts(previous => new Map(previous).set(account, receipt));
    setReopeningPhase('idle');
    setPendingReopening(null);
    setReopeningError('');
    if (pendingStorageKey) {
      try { sessionStorage.removeItem(pendingStorageKey); } catch { /* A retained token can only query the terminal receipt on reload. */ }
    }
  }

  async function executeReopening() {
    if (!previewUsable || writeInFlight.current || Date.now() >= Date.parse(reopeningPreview.expiresAt) || confirmedAccount.trim() !== String(reopeningPreview.account)) return;
    const attempt = { account: String(reopeningPreview.account), previewToken: reopeningPreview.previewToken };
    try {
      if (!pendingStorageKey) throw new Error('Sin identidad de sesión.');
      const stored = JSON.stringify(attempt);
      sessionStorage.setItem(pendingStorageKey, stored);
      if (sessionStorage.getItem(pendingStorageKey) !== stored) throw new Error('No se conservó el intento.');
    } catch {
      setReopeningError('No se pudo conservar la operación en esta sesión. Permite el almacenamiento de la sesión antes de reaperturar la cuenta.');
      return;
    }
    writeInFlight.current = true;
    setPendingReopening(attempt);
    setReopeningPhase('executing');
    invalidatePreview();
    try {
      const response = await reopeningRequest(`/sap/account-review/${encodeURIComponent(attempt.account)}/reopening/execute`, { previewToken: attempt.previewToken, confirmedAccount: confirmedAccount.trim() });
      if (!response?.success) throw Object.assign(new Error(response?.message || 'No se recibió la confirmación de la reapertura.'), { status: 0 });
      saveReopeningReceipt(response.data, attempt.account);
    } catch (error) {
      if (!error.status || error.status >= 500 || error.data?.code === 'OPERATION_STATUS_UNKNOWN') {
        setReopeningPhase('pending');
        setReopeningError('No se recibió una confirmación. La operación podría haber terminado; consulta su estado antes de intentar cualquier otra reapertura.');
      } else {
        setReopeningPhase('pending');
        setReopeningError(`${userMessage(error)} Consulta el estado de la reapertura antes de continuar.`);
        setDetailError('La revisión o las condiciones de la cuenta cambiaron. Actualiza la consulta de SAP antes de continuar.');
      }
    } finally { writeInFlight.current = false; }
  }

  async function checkReopeningStatus() {
    if (!canReopen || !pendingReopening || writeInFlight.current || reopeningPhase === 'checking') return;
    const attempt = pendingReopening;
    writeInFlight.current = true;
    setReopeningPhase('checking');
    try {
      const response = await reopeningRequest(`/sap/account-review/${encodeURIComponent(attempt.account)}/reopening/status`, { previewToken: attempt.previewToken });
      if (!response?.success || String(response.data?.account) !== attempt.account) throw new Error('No se pudo consultar el estado de la reapertura.');
      if (response.data.status === 'reopened') saveReopeningReceipt(response.data, attempt.account);
      else if (['rolled_back', 'not_started'].includes(response.data.status)) {
        setReopeningPhase('idle');
        setPendingReopening(null);
        setReopeningError(response.data.status === 'not_started' ? 'La reapertura no llegó a iniciarse. Actualiza la consulta y prepara nuevamente la cuenta.' : 'La reapertura no se completó y los cambios fueron revertidos. Actualiza la consulta y revisa la cuenta antes de preparar otro intento.');
        setDetailError('Hace falta consultar nuevamente SAP y el estado de la cuenta antes de preparar otro intento.');
        if (pendingStorageKey) {
          try { sessionStorage.removeItem(pendingStorageKey); } catch { /* Keep the terminal receipt available through the retained token. */ }
        }
      } else {
        setReopeningPhase('pending');
        setReopeningError(response.data.status === 'pending' ? 'La operación sigue pendiente. Consulta de nuevo su estado; no inicies otra reapertura.' : 'El resultado todavía no se puede confirmar. Revisa la operación en Vertical antes de iniciar otra reapertura.');
      }
    } catch {
      setReopeningPhase('pending');
      setReopeningError('No se pudo confirmar el resultado. Revisa la operación en Vertical o consulta de nuevo su estado antes de continuar.');
    } finally { writeInFlight.current = false; }
  }

  return <div className="account-reopening-review">
    <header className="arr-header">
      <div className="arr-header-icon"><Icon name="invoice" /></div>
      <div><span className="arr-eyebrow">AUDITORÍA · SAP</span><h1>Facturas y reapertura de cuentas</h1><p>Consulta el estado real de las facturas y todos sus documentos relacionados.</p></div>
      <span className="arr-read-only">{canReopen ? 'Consulta y reapertura' : 'Solo consulta'}</span>
    </header>

    <div className="arr-rules" aria-label="Condiciones de reapertura">
      <div><Icon name="invoice" /><p><strong>Facturas verificadas, si existen</strong><span>Cerradas o con cancelación confirmada.</span></p></div>
      <span className="arr-rule-plus" aria-hidden="true">+</span>
      <div><Icon name="map" /><p><strong>Mapa sin documentos abiertos</strong><span>Todas las relaciones deben estar verificadas.</span></p></div>
    </div>
    <p className="arr-history-note">Los documentos cerrados o cancelados pueden seguir apareciendo en el mapa como historial. Si todo está cancelado y el mapa completo no tiene documentos ni saldos pendientes, se puede confirmar la reapertura. Si queda algo abierto, no cumple las condiciones; un mapa parcial o sin verificar tampoco permite confirmarla.</p>

    <section className="arr-card arr-search-card" aria-labelledby="arr-search-title">
      <h2 id="arr-search-title">Buscar una cuenta</h2>
      <form onSubmit={searchAccounts} className="arr-search-form">
        <div className="arr-field arr-mode-field"><label htmlFor="arr-search-mode">Buscar por</label><select id="arr-search-mode" value={mode} disabled={contextLocked} onChange={event => { if (contextLocked || writeInFlight.current) return; clearSearch(); setMode(event.target.value); setQuery(''); }}><option value="patient">Nombre del paciente</option><option value="account">Número de cuenta</option><option value="order">Número de orden de venta SAP</option></select></div>
        <div className="arr-field arr-query-field"><label htmlFor="arr-search-query">{mode === 'patient' ? 'Nombre del paciente' : mode === 'order' ? 'Número de orden de venta SAP' : 'Número de cuenta'}</label><input id="arr-search-query" value={query} disabled={contextLocked} onChange={event => { if (contextLocked || writeInFlight.current) return; clearSearch(); setQuery(event.target.value); }} placeholder={mode === 'patient' ? 'Escribe el nombre o los apellidos' : mode === 'order' ? 'Escribe el número de la orden en SAP' : 'Escribe el número de cuenta'} autoComplete="off" maxLength={120} aria-describedby="arr-search-hint" /></div>
        <button type="submit" className="arr-primary-button" disabled={searchLoading || !query.trim() || contextLocked}><Icon name="search" />{searchLoading ? 'Buscando…' : 'Buscar'}</button>
      </form>
      <p id="arr-search-hint" className="arr-helper">{mode === 'patient' ? 'Busca por una parte del nombre y selecciona la cuenta que deseas revisar.' : mode === 'order' ? 'Busca la orden de venta por su número exacto en SAP y consulta la cuenta del hospital asociada. Los dos números pueden ser diferentes.' : 'La búsqueda por número de cuenta es exacta. Si tienes el número de una orden de venta de SAP, elige esa opción en Buscar por.'}</p>
      {searchError && <p className="arr-error" role="alert"><Icon name="alert" />{searchError}</p>}
      {searchLoading && <div className="arr-search-loading"><div role="status"><p>Consultando cuentas en SAP…</p><span>Tiempo transcurrido: {formatElapsed(searchElapsed)} · Límite de espera: 2 min 10 s</span></div><button type="button" className="arr-secondary-button" onClick={cancelSearch}>Cancelar búsqueda</button></div>}
      {searchData && <div className="arr-search-results">
        <div className="arr-results-heading"><h3>{accounts.length ? `${accounts.length} ${accounts.length === 1 ? 'cuenta encontrada' : 'cuentas encontradas'}` : 'No se encontraron cuentas'}</h3>{accounts.length > 1 && <span>Selecciona una cuenta para revisar</span>}</div>
        {searchData.lookup?.mode === 'order' && accounts.length > 0 && <p className="arr-order-match">Orden de venta SAP #{searchData.lookup.number}: {accounts.length === 1 ? `cuenta del hospital ${accounts[0].account}` : `${accounts.length} cuentas del hospital asociadas`}. La revisión corresponde a la cuenta del hospital.</p>}
        {searchWarnings.length > 0 && <div className="arr-warning"><ul>{searchWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
        {searchData.truncated && <p className="arr-warning">Hay más coincidencias. Escribe un nombre más completo para acotar los resultados.</p>}
        {!accounts.length ? <div><p className="arr-inline-empty">{mode === 'order' ? 'No se encontró una cuenta asociada a esta orden de venta de SAP.' : 'Revisa el nombre o el número de cuenta e intenta de nuevo.'} Una búsqueda sin resultados no confirma que se pueda reaperturar.</p>{mode === 'account' && <div className="arr-empty-account-help"><p>El número de cuenta del hospital y el número de orden de venta de SAP pueden ser diferentes.</p><button type="button" className="arr-secondary-button" disabled={contextLocked} onClick={event => { setMode('order'); searchAccounts(event, { searchMode: 'order' }); }}>Buscar como orden de venta SAP</button></div>}</div> : <div className="arr-account-list">{accounts.map(account => <button type="button" key={account.account} className={`arr-account-option${String(selectedAccount?.account) === String(account.account) ? ' is-selected' : ''}`} aria-pressed={String(selectedAccount?.account) === String(account.account)} disabled={contextLocked} onClick={() => loadAccount(account)}>
          <span className="arr-account-number">Cuenta {account.account}</span><strong>{account.patientName || 'Paciente sin nombre registrado'}</strong>{asArray(account.matchedOrders).length > 0 && <span className="arr-account-matched-order">Orden de venta SAP: {account.matchedOrders.map(order => `#${order.docNum}`).join(', ')}</span>}<span>{Number(account.invoiceCount) || 0} {(Number(account.invoiceCount) || 0) === 1 ? 'factura' : 'facturas'} <span aria-hidden="true">→</span></span>
        </button>)}</div>}
      </div>}
    </section>

    {!selectedAccount && !searchLoading && !searchData && <div className="arr-start-state"><Icon name="map" /><h2>Verifica una cuenta antes de reaperturar</h2><p>Busca al paciente o su cuenta para consultar las facturas, el mapa de relación y los documentos que impiden la reapertura.</p></div>}

    {selectedAccount && <section className="arr-account-heading" aria-label="Cuenta seleccionada"><div><span>CUENTA {selectedAccount.account}</span><h2>{confirmedPatientName}</h2><p className="arr-account-preview">{!searchData && !detail ? 'Resultado recuperado de la reapertura de esta sesión.' : `${Number(selectedAccount.invoiceCount) || 0} ${(Number(selectedAccount.invoiceCount) || 0) === 1 ? 'factura localizada' : 'facturas localizadas'} en la búsqueda inicial`}</p></div><button type="button" className="arr-secondary-button" onClick={() => loadAccount(selectedAccount, { fullMap: detailFullMap })} disabled={detailLoading || contextLocked}><Icon name="refresh" />{detailLoading ? 'Consultando…' : 'Actualizar desde SAP'}</button></section>}
    {detailLoading && <div className="arr-card arr-detail-loading"><div className="arr-spinner" aria-hidden="true" /><div role="status"><h3>{detailFullMap ? 'Consultando el mapa completo de relación en SAP…' : 'Verificando facturas y relaciones en SAP…'}</h3><p>Tiempo transcurrido: <strong>{formatElapsed(detailElapsed)}</strong> · Límite de espera: 4 min 10 s</p><p className="arr-wait-explanation">{detailElapsed >= 60 ? 'La consulta lleva un minuto o más. Puedes cancelarla y volver a intentar.' : detailElapsed >= 30 ? 'Todavía no se ha recibido la respuesta de SAP. La cuenta sigue sin verificar.' : 'La cuenta sigue sin verificar mientras esperamos la respuesta de SAP.'}</p></div>{!detail && Number(selectedAccount?.invoiceCount) === 0 && <p className="arr-pending-no-invoice">La búsqueda inicial no localizó facturas. Estamos confirmando ese resultado; todavía no se ha verificado el mapa.</p>}<button type="button" className="arr-secondary-button" onClick={cancelDetail}>Cancelar consulta</button></div>}
    {detailError && <div className="arr-error arr-detail-error" role="alert"><Icon name="alert" /><div><strong>Cuenta sin verificar</strong><p>{detailError}</p><button type="button" className="arr-secondary-button" disabled={contextLocked} onClick={() => loadAccount(selectedAccount, { fullMap: detailFullMap })}>Reintentar consulta</button></div></div>}
    {contextLocked && <ReopeningProgress phase={reopeningPhase} attempt={pendingReopening} message={reopeningError} onStatus={checkReopeningStatus} canRead={canReopen && Boolean(pendingReopening)} />}
    {!detail && reopeningReceipt && <ReopeningReceipt receipt={reopeningReceipt} />}
    {detail && (detailLoading || detailError) && <div className="arr-warning arr-previous-result"><strong>Datos de la consulta anterior</strong><p>Consulta: {formatDate(detail.checkedAt, true)}. Se conservan las facturas y documentos ya observados; estos datos no confirman el resultado de la actualización pendiente.</p></div>}

    {detail && <>
      {!detailLoading && !detailError && !contextLocked && !reopeningReceipt && <section className={`arr-diagnostic arr-diagnostic--${diagnostic}`} aria-labelledby="arr-diagnostic-title" role="status">
        <div className="arr-diagnostic-icon"><Icon name={eligible ? 'check' : blocked ? 'alert' : 'clock'} /></div>
        <div className="arr-diagnostic-body"><span className="arr-eyebrow">REVISIÓN DE REAPERTURA</span><h2 id="arr-diagnostic-title">{eligible ? 'Cumple condiciones para reapertura' : blocked ? 'No cumple condiciones para reapertura' : 'No se puede confirmar la reapertura'}</h2>
          {eligible ? <p>{detail.reopeningScenario === 'all_cancelled' ? 'Los documentos de la cuenta están cancelados y el mapa completo está verificado, sin documentos ni saldos abiertos. Cumple condiciones para reapertura.' : <>El mapa completo de la cuenta está verificado y no contiene documentos ni saldos abiertos. {currentInvoices.length ? 'Las facturas vigentes están cerradas en SAP.' : 'No hay facturas vigentes; el resultado se confirma con los documentos y saldos del mapa completo.'}</>}</p> : <ul>{reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>}
          <p className="arr-check-time"><Icon name="clock" />Consulta: {formatDate(detail.checkedAt, true)} · Hora de Ciudad de México</p>
        </div>
      </section>}
      {reopeningReceipt ? <ReopeningReceipt receipt={reopeningReceipt} />
        : !contextLocked && (eligible || reopeningError) && <section className="arr-card arr-reopening-card" aria-labelledby="arr-reopening-title"><div className="arr-section-heading"><h2 id="arr-reopening-title">Reapertura en Vertical</h2><span>SAP valida los documentos y saldos</span></div>
            {reopeningError && <p className="arr-error" role="alert">{reopeningError}</p>}
            {!reopeningPreview ? <><p>Prepara la reapertura para volver a verificar SAP, confirmar que la cuenta está cerrada en Vertical y revisar el registro que se respaldará.</p>{eligible && <button type="button" className="arr-primary-button" disabled={!canReopen || preparingReopening} onClick={prepareReopening}><Icon name="refresh" />{preparingReopening ? 'Preparando reapertura…' : 'Preparar reapertura'}</button>}{!canReopen && <p className="arr-helper">Tu acceso permite consultar. Necesitas el permiso de ejecutar reaperturas para realizar esta acción.</p>}</>
              : <div className="arr-reopening-preview"><h3>Revisa y confirma la cuenta {reopeningPreview.account}</h3><p>La cuenta cambiará de <strong>cerrada a abierta</strong> en Vertical. Se guardará un respaldo completo y se retirará <strong>1 registro</strong> después de verificarlo.</p><dl className="arr-reopening-facts"><div><dt>Identificador del registro</dt><dd>{reopeningPreview.record.id}</dd></div><div><dt>Documento</dt><dd>{reopeningPreview.record.documentType || 'Sin tipo registrado'} · {reopeningPreview.record.documentNumber ?? 'Sin número'}</dd></div><div><dt>Referencia</dt><dd>{reopeningPreview.record.reference || 'Sin referencia registrada'}</dd></div></dl><div className="arr-reopening-backup"><strong>Destino del respaldo</strong><code>{reopeningPreview.backupDirectory}</code></div><p className="arr-helper">SAP verificado: {formatDate(reopeningPreview.sapCheckedAt, true)}. Preparación válida hasta {formatDate(reopeningPreview.expiresAt, true)}.</p><div className="arr-field arr-confirm-account"><label htmlFor="arr-confirm-account">Escribe el número de cuenta {reopeningPreview.account} para confirmar</label><input id="arr-confirm-account" value={confirmedAccount} onChange={event => setConfirmedAccount(event.target.value)} autoComplete="off" inputMode="numeric" /></div><div className="arr-reopening-actions"><button type="button" className="arr-primary-button" disabled={!previewUsable || confirmedAccount.trim() !== String(reopeningPreview.account)} onClick={executeReopening}>Respaldar y reaperturar cuenta</button><button type="button" className="arr-secondary-button" onClick={invalidatePreview}>Descartar preparación</button></div></div>}
          </section>}
      <div className="arr-metrics"><div><span>Facturas de la cuenta</span><strong>{invoices.length}</strong></div><div><span>Documentos en el mapa</span><strong className={mapIncomplete ? 'arr-metric-text' : undefined}>{mapIncomplete ? `${nodes.length} ${nodes.length === 1 ? 'conocido' : 'conocidos'}` : nodes.length}</strong></div><div className={openDocuments.length ? 'arr-metric-alert' : ''}><span>Documentos abiertos</span><strong className={openCountUnverified ? 'arr-metric-text' : undefined}>{openCountUnverified ? openDocuments.length ? `${openDocuments.length} ${openDocuments.length === 1 ? 'detectado' : 'detectados'}` : 'Sin verificar' : openDocuments.length}</strong>{openCountUnverified && <small>El total depende de completar el mapa y sus estados.</small>}</div><div><span>Verificación del mapa</span><strong className="arr-metric-text">{mapIncomplete || missingRelations ? 'Parcial' : unknownDocuments.length ? 'Estados pendientes' : 'Completa'}</strong>{unknownDocuments.length > 0 && <small>{unknownDocuments.length} {(unknownDocuments.length === 1 ? 'documento sin verificar' : 'documentos sin verificar')}</small>}</div></div>
      {warnings.length > 0 && <div className="arr-warning"><strong>Observaciones de la consulta</strong><ul>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
      {openDocuments.length > 0 && <section className="arr-card arr-open-documents" aria-labelledby="arr-open-title"><h2 id="arr-open-title"><Icon name="alert" />Documentos abiertos que impiden la reapertura</h2><ul>{openDocuments.map((node, index) => <li key={node.id || index}><strong>{documentLabel(node)}</strong><StatusBadge status="open" /><span>SAP: <code>{node.sapStatus || 'Sin estado disponible'}</code></span></li>)}</ul></section>}
      {unknownDocuments.length > 0 && <section className="arr-card arr-unknown-documents" aria-labelledby="arr-unknown-title"><h2 id="arr-unknown-title"><Icon name="clock" />Documentos pendientes de verificar</h2><p>No podemos confirmar la reapertura mientras falte conocer el estado de estos documentos.</p><ul>{unknownDocuments.map((node, index) => <li key={node.id || index}><strong>{documentLabel(node)}</strong><StatusBadge status="unknown" /><span>SAP: <code>{node.sapStatus || 'Sin estado disponible'}</code></span></li>)}</ul></section>}
      <section className="arr-card" aria-labelledby="arr-invoices-title"><div className="arr-section-heading"><h2 id="arr-invoices-title"><Icon name="invoice" />Estado de las facturas</h2><span>{invoices.length} {(invoices.length === 1 ? 'factura' : 'facturas')}</span></div>
        {invoices.length ? <div className="arr-table-scroll"><table className="arr-invoice-table"><thead><tr><th scope="col">Factura</th><th scope="col">Fecha</th><th scope="col">Estado</th><th scope="col">Estado literal SAP</th><th scope="col">Importe</th><th scope="col">Referencia SAP</th></tr></thead><tbody>{invoices.map((invoice, index) => <tr key={invoice.id || index}><td><strong>#{invoice.docNum ?? invoice.docEntry ?? '—'}</strong>{invoice.typeLabel && <span className="arr-cell-sub">{invoice.typeLabel}</span>}</td><td>{formatDate(invoice.date)}</td><td><StatusBadge status={displayDocumentStatus(invoice)} /></td><td><code>{invoice.sapStatus || 'Sin estado disponible'}</code></td><td className="arr-money">{formatTotal(invoice)}</td><td>{invoice.entity || '—'}<span className="arr-cell-sub">DocEntry {invoice.docEntry ?? '—'}</span></td></tr>)}</tbody></table></div> : <p className="arr-inline-empty">No se localizaron facturas en esta cuenta. La evaluación de reapertura depende del mapa completo y de que no existan documentos ni saldos abiertos.</p>}
      </section>
      <section className="arr-card arr-map-card" aria-labelledby="arr-map-title"><div className="arr-section-heading"><h2 id="arr-map-title"><Icon name="map" />Mapa de relación SAP</h2><span>{nodes.length} {nodes.length === 1 ? 'documento' : 'documentos'} · {edges.length} {edges.length === 1 ? 'relación' : 'relaciones'}{mapIncomplete ? ' · Mapa parcial' : ''}</span></div>
        {(mapIncomplete || missingRelations) && <div className="arr-map-not-requested"><h3>{mapNotRequested ? 'Mapa completo no consultado' : 'Mapa de relación parcial'}</h3><p>{!invoices.length ? 'No se localizaron facturas; para evaluar la reapertura hace falta revisar el mapa completo. ' : ''}{nodes.length ? 'Se muestran los documentos y vínculos conocidos hasta ahora. Todavía faltan relaciones por consultar; este mapa parcial no confirma que no haya documentos abiertos.' : 'Todavía no se han obtenido los documentos relacionados. Hace falta consultar el mapa completo para conocer su estado.'}</p><button type="button" className="arr-secondary-button" disabled={detailLoading || contextLocked} onClick={() => loadAccount(selectedAccount, { fullMap: true })}><Icon name="map" />Consultar mapa completo</button></div>}
        {nodes.length > 0 ? <RelationshipMap key={`${detail.account}-${detail.checkedAt}`} nodes={nodes} edges={edges} /> : !mapIncomplete && <p className="arr-inline-empty">No se pudo obtener el mapa de relación. La cuenta queda sin verificar.</p>}
      </section>
      <p className="arr-consultation-note">SAP se consulta para validar los documentos y saldos. La reapertura cambia el estado de la cuenta en Vertical y respalda el registro confirmado antes de retirarlo.</p>
    </>}
  </div>;
}
