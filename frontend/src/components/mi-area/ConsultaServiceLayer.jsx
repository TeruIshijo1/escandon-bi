import { userMessage } from '../../utils/userMessages';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import PremiumLoader from '../shared/PremiumLoader';
import { API_BASE } from '../../api/config';
import { authHeaders } from '../../api/auth';
import { useAuth } from '../../context/AuthContext';
import { hasSapModulePermission } from '../../utils/rbac';
import ReportBuilderIcon, { reportTopicIcon } from './ReportBuilderIcon';
import ReportAssistant, { ReportAnalysisSummary, hasReportAnalysis, getReportPointLookup } from './ReportAssistant';
import { formatReportNumeric, reportNumber, escapeReportHtml } from '../../utils/reportValueFormatting';
import './ConsultaServiceLayer.css';

const normalizeSearch = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const entitySource = entity => entity?.source || 'SAP';
const analysisFingerprint = (entity, fields, filters, analysis) => JSON.stringify({ entity, fields, filters, analysis: hasReportAnalysis(analysis) ? analysis : null });
const validDraftDate = value => {
  if (value == null || value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const formatReportDate = (value, withTime = false) => {
  const dateOnly = !withTime && String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  const date = dateOnly ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return withTime ? date.toLocaleString('es-MX', { hourCycle: 'h23' }) : date.toLocaleDateString('es-MX');
};
const supportsFilter = (entity, filter) => {
  if (!entity) return false;
  if (Array.isArray(entity.filters)) return entity.filters.includes(filter);
  const fieldKeys = {
    almacen: ['WhsCode', 'Filler', 'ToWhsCode'],
    estatusDoc: ['DocStatus', 'Status'],
    clasificacionMedica: ['MedicalClassification', 'SecondaryClassification'],
  };
  return Boolean(entity.fields?.some(field => fieldKeys[filter]?.includes(field.key)));
};
const executionFilters = (entity, filters = {}) => ({ fechaDesde: filters.fechaDesde || '', fechaHasta: filters.fechaHasta || '', busqueda: filters.busqueda || '', almacen: supportsFilter(entity, 'almacen') ? filters.almacen || 'ALL' : 'ALL', estatusDoc: supportsFilter(entity, 'estatusDoc') ? filters.estatusDoc || 'ALL' : 'ALL', clasificacionMedica: supportsFilter(entity, 'clasificacionMedica') ? filters.clasificacionMedica || 'ALL' : 'ALL' });

const ReportModal = ({ title, children, onClose, busy = false, width = 720 }) => <div role="dialog" aria-modal="true" aria-label={title} onKeyDown={event => { if (event.key === 'Escape' && !busy) onClose(); }} style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, .65)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
  <div style={{ background: 'var(--report-surface)', color: 'var(--report-text)', border: '1px solid var(--report-border)', borderRadius: 16, maxWidth: width, width: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 30px rgba(0,0,0,.2)' }}>
    <div style={{ padding: '1.1rem 1.4rem', borderBottom: '1px solid var(--report-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}><h2 style={{ margin: 0, fontSize: '1.1rem' }}>{title}</h2><button type="button" aria-label={`Cerrar ${title}`} disabled={busy} onClick={onClose} className="report-catalog__chip">×</button></div>
    <div style={{ padding: '1.3rem', overflowY: 'auto', minHeight: 0 }}>{children}</div>
  </div>
</div>;

const RecipientPicker = ({ users, loading, error, search, onSearch, selectedIds, onChange, onRetry }) => {
  const terms = normalizeSearch(search).trim().split(/\s+/).filter(Boolean);
  const matching = users.filter(person => terms.every(term => normalizeSearch([person.nombre, person.username, person.area].join(' ')).includes(term)));
  return <fieldset style={{ margin: '1rem 0', padding: '1rem', border: '1px solid var(--report-border)', borderRadius: 10 }}>
    <legend style={{ fontWeight: 700, fontSize: '.85rem' }}>Personas que podrán usar el reporte</legend>
    <p style={{ margin: '0 0 .8rem', fontSize: '.78rem', color: 'var(--report-muted)' }}>Las personas elegidas verán este reporte en «Mis reportes» con la configuración guardada.</p>
    {loading ? <p role="status">Cargando personas…</p> : error ? <div role="alert"><p>{error}</p><button type="button" className="report-catalog__chip" onClick={onRetry}>Reintentar lista de personas</button></div> : <>
      <label style={{ display: 'grid', gap: 5, fontSize: '.78rem' }}>Buscar personas<input type="search" value={search} onChange={event => onSearch(event.target.value)} placeholder="Nombre, usuario o área" style={{ width: '100%', padding: '.6rem', color: 'var(--report-text)', background: 'var(--report-soft)', border: '1px solid var(--report-border)', borderRadius: 7 }} /></label>
      <div style={{ maxHeight: 210, overflowY: 'auto', marginTop: '.75rem', display: 'grid', gap: '.5rem' }}>
        {matching.map(person => <label key={person.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '.55rem', borderRadius: 7, background: 'var(--report-soft)', fontSize: '.82rem' }}><input type="checkbox" checked={selectedIds.some(id => String(id) === String(person.id))} onChange={() => onChange(selectedIds.some(id => String(id) === String(person.id)) ? selectedIds.filter(id => String(id) !== String(person.id)) : [...selectedIds, person.id])} /><span>{person.nombre || person.username}<span style={{ display: 'block', color: 'var(--report-muted)', fontSize: '.73rem' }}>{person.username}{person.area ? ` · ${person.area}` : ''}</span></span></label>)}
        {!matching.length && <p style={{ fontSize: '.78rem' }}>{search.trim() ? 'No encontré personas con esa búsqueda.' : 'No hay personas disponibles para asignar.'}</p>}
      </div>
    </>}
    <p role="status" style={{ margin: '.75rem 0 0', fontSize: '.75rem', color: 'var(--report-muted)' }}>{selectedIds.length} {selectedIds.length === 1 ? 'persona elegida' : 'personas elegidas'}</p>
  </fieldset>;
};

const ColumnFilter = ({ columnKey, data, colFilters, setColFilters, label, align = 'left', maxWidth }) => {
  const val = colFilters[columnKey] || '';
  const isActive = val !== '';

  // Determinar si la columna tiene pocos valores discretos (<= 25). Si tiene muchos, usar input de búsqueda directo para evitar saturar el DOM.
  const isDiscreteSelect = useMemo(() => {
    if (!data || data.length === 0) return false;
    const sample = new Set();
    for (let i = 0; i < data.length; i++) {
      const v = data[i][columnKey];
      if (v != null && v !== '') {
        sample.add(v);
        if (sample.size > 25) return false;
      }
    }
    return sample.size <= 25 && sample.size > 0;
  }, [data, columnKey]);

  const uniqueVals = useMemo(() => {
    if (!isDiscreteSelect) return [];
    const raw = Array.from(new Set(data.map(item => item[columnKey])))
      .filter(val => val !== null && val !== undefined && val !== '');
    return raw.sort((a, b) => {
      if (typeof a === 'number' && typeof b === 'number') return a - b;
      return String(a).localeCompare(String(b), 'es', { numeric: true });
    });
  }, [data, columnKey, isDiscreteSelect]);

  return (
    <th style={{
      textAlign: align,
      maxWidth: maxWidth || 'none',
      padding: '8px 6px',
      background: '#004687',
      borderBottom: '3px solid #0088C9',
      whiteSpace: 'normal',
      minWidth: maxWidth || 120
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '4px' }}>
          <span style={{ fontSize: '0.68rem', textTransform: 'uppercase', color: 'rgba(255,255,255,0.9)', letterSpacing: '0.04em', fontWeight: '700', overflowWrap: 'anywhere', lineHeight: 1.35, minWidth: 0 }}>
            {label}
          </span>
          {isActive && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setColFilters(prev => {
                  const next = { ...prev };
                  delete next[columnKey];
                  return next;
                });
              }}
              title="Quitar filtro de columna"
              style={{
                background: '#ef4444',
                color: '#fff',
                border: 'none',
                borderRadius: '50%',
                width: '14px',
                height: '14px',
                fontSize: '9px',
                lineHeight: '14px',
                cursor: 'pointer',
                padding: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 'bold'
              }}
            >
              ✕
            </button>
          )}
        </div>
        {isDiscreteSelect ? (
          <select
            value={val}
            onChange={(e) => setColFilters(prev => ({ ...prev, [columnKey]: e.target.value }))}
            style={{
              fontSize: '0.7rem',
              padding: '2px 4px',
              borderRadius: '4px',
              border: isActive ? '2px solid #38bdf8' : '1px solid rgba(255,255,255,0.25)',
              background: isActive ? 'rgba(56,189,248,0.25)' : 'rgba(255,255,255,0.12)',
              color: '#fff',
              outline: 'none',
              maxWidth: maxWidth || '100%',
              textOverflow: 'ellipsis'
            }}
          >
            <option value="" style={{ color: '#1e293b' }}>Todos ({uniqueVals.length})</option>
            {uniqueVals.map((v, i) => (
              <option key={i} value={String(v)} style={{ color: '#1e293b' }}>{typeof v === 'boolean' ? (v ? 'Sí' : 'No') : String(v)}</option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            placeholder="Filtrar..."
            value={val}
            onChange={(e) => setColFilters(prev => ({ ...prev, [columnKey]: e.target.value }))}
            style={{
              fontSize: '0.7rem',
              padding: '2px 6px',
              borderRadius: '4px',
              border: isActive ? '2px solid #38bdf8' : '1px solid rgba(255,255,255,0.25)',
              background: isActive ? 'rgba(56,189,248,0.25)' : 'rgba(255,255,255,0.15)',
              color: '#fff',
              outline: 'none',
              width: '100%',
              boxSizing: 'border-box'
            }}
          />
        )}
      </div>
    </th>
  );
};

const StaticTh = ({ label, align = 'center', width }) => (
  <th style={{
    textAlign: align,
    width: width || 'auto',
    padding: '12px 10px',
    background: '#004687',
    borderBottom: '3px solid #0088C9',
    whiteSpace: 'nowrap'
  }}>
    <span style={{ fontSize: '0.68rem', textTransform: 'uppercase', color: 'rgba(255,255,255,0.85)', letterSpacing: '0.04em', fontWeight: '700' }}>
      {label}
    </span>
  </th>
);

export default function ConsultaServiceLayer() {
  const { user } = useAuth();
  const topScrollRef = useRef(null);
  const tableScrollRef = useRef(null);
  const queryRequestRef = useRef(0);
  const savedRequestRef = useRef(0);
  const configurationRef = useRef(null);
  const resultsRef = useRef(null);
  const [reportMode, setReportMode] = useState('assistant');
  const [tableScrollWidth, setTableScrollWidth] = useState(1600);

  const [catalog, setCatalog] = useState([]);
  const [assistantCatalog, setAssistantCatalog] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(null);
  const [catalogRefresh, setCatalogRefresh] = useState(0);
  const [selectedEntityId, setSelectedEntityId] = useState('');
  const [selectedFields, setSelectedFields] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [analysisSummary, setAnalysisSummary] = useState(null);
  const [manualTopicRequired, setManualTopicRequired] = useState(false);

  // Helpers de fecha
  const getTodayStr = () => new Date().toLocaleDateString('en-CA');
  const getDaysAgoStr = (days) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toLocaleDateString('en-CA');
  };
  const getMonthStartStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  };
  const getYearStartStr = () => {
    return `${new Date().getFullYear()}-01-01`;
  };

  // Filtros
  const [activeCategory, setActiveCategory] = useState('ALL');
  const [activeSource, setActiveSource] = useState('ALL');
  const [moduleSearch, setModuleSearch] = useState('');
  const [fechaDesde, setFechaDesde] = useState(getDaysAgoStr(30));
  const [fechaHasta, setFechaHasta] = useState(getTodayStr());
  const [almacen, setAlmacen] = useState('ALL');
  const [estatusDoc, setEstatusDoc] = useState('ALL');
  const [clasificacionMedica, setClasificacionMedica] = useState('ALL');
  const [busqueda, setBusqueda] = useState('');

  // Estado de resultados
  const [queryResult, setQueryResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [executionFailed, setExecutionFailed] = useState(false);

  // Plantillas guardadas
  const [savedQueries, setSavedQueries] = useState([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedError, setSavedError] = useState('');
  const [savedNotice, setSavedNotice] = useState('');
  const [activeSavedReport, setActiveSavedReport] = useState(null);
  const [showSavedModal, setShowSavedModal] = useState(false);
  const [showSaveFormModal, setShowSaveFormModal] = useState(false);
  const [saveTitle, setSaveTitle] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  const [savingQuery, setSavingQuery] = useState(false);
  const [recipientUsers, setRecipientUsers] = useState([]);
  const [recipientsLoading, setRecipientsLoading] = useState(false);
  const [recipientsError, setRecipientsError] = useState('');
  const [recipientSearch, setRecipientSearch] = useState('');
  const [saveUserIds, setSaveUserIds] = useState([]);
  const [assignmentTarget, setAssignmentTarget] = useState(null);
  const [assignmentUserIds, setAssignmentUserIds] = useState([]);
  const [assignmentError, setAssignmentError] = useState('');
  const [assigningReport, setAssigningReport] = useState(false);
  const [canChooseRecipients, setCanChooseRecipients] = useState(false);

  // Filtros de tabla y paginación
  const [colFilters, setColFilters] = useState({});
  const [page, setPage] = useState(1);
  const PER_PAGE = 100;

  // Cargar catálogo de entidades
  useEffect(() => {
    const controller = new AbortController();
    const fetchCatalog = async () => {
      setCatalogLoading(true);
      setCatalogError(null);
      try {
        const res = await fetch(`${API_BASE}/sap-query/catalog`, { headers: authHeaders(), signal: controller.signal });
        const json = await res.json();
        if (!res.ok || !json.ok || !Array.isArray(json.catalog)) throw new Error('No se pudo cargar la lista de módulos.');
        if (!controller.signal.aborted) {
          setCatalog(json.catalog.filter(entity => !entity.assistantOnly));
          setAssistantCatalog(Array.isArray(json.assistantCatalog) ? json.assistantCatalog : json.catalog);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error('[Report Builder] Error al cargar catálogo:', err);
        setCatalogError('No se pudo cargar la lista de módulos de SAP y Vertical. Intenta de nuevo.');
      } finally {
        if (!controller.signal.aborted) setCatalogLoading(false);
      }
    };
    fetchCatalog();
    return () => controller.abort();
  }, [catalogRefresh]);

  useEffect(() => {
    setSavedQueries([]);
    setActiveSavedReport(null);
    setAnalysis(null); setAnalysisSummary(null); setExecutionFailed(false);
    setCanChooseRecipients(false);
    setShowSavedModal(false); setShowSaveFormModal(false); setAssignmentTarget(null);
    setRecipientUsers([]); setSavedNotice('');
    queryRequestRef.current += 1;
    setQueryResult(null); setLoading(false);
    loadSavedQueries();
  }, [user?.id, user?.username]);

  const userAllowedCatalog = useMemo(() => {
    return catalog.filter(c => hasSapModulePermission(user, c.id));
  }, [catalog, user]);

  const userAllowedAssistantCatalog = useMemo(() => {
    return assistantCatalog.filter(entity => Array.isArray(entity.requiredPermissions) && entity.requiredPermissions.length
      ? entity.requiredPermissions.every(moduleId => hasSapModulePermission(user, moduleId))
      : hasSapModulePermission(user, entity.id));
  }, [assistantCatalog, user]);

  const currentEntityDef = useMemo(() => {
    if (activeSavedReport?.entity === selectedEntityId) return activeSavedReport.definition;
    return userAllowedAssistantCatalog.find(c => c.id === selectedEntityId) || null;
  }, [activeSavedReport, userAllowedAssistantCatalog, selectedEntityId]);

  const hasStatusField = useMemo(() => {
    return supportsFilter(currentEntityDef, 'estatusDoc');
  }, [currentEntityDef]);

  const hasWhsField = useMemo(() => {
    return supportsFilter(currentEntityDef, 'almacen');
  }, [currentEntityDef]);

  const hasMedClassField = useMemo(() => {
    return supportsFilter(currentEntityDef, 'clasificacionMedica');
  }, [currentEntityDef]);

  const searchMatchedCatalog = useMemo(() => {
    const terms = normalizeSearch(moduleSearch).trim().split(/\s+/).filter(Boolean);
    return userAllowedCatalog.filter(entity => {
      const searchable = normalizeSearch([entity.title, entity.description, entity.category, entitySource(entity), ...(entity.keywords || [])].join(' '));
      return terms.every(term => searchable.includes(term));
    });
  }, [userAllowedCatalog, moduleSearch]);

  const sourceMatchedCatalog = useMemo(() => {
    return searchMatchedCatalog.filter(entity => activeSource === 'ALL' || entitySource(entity) === activeSource);
  }, [searchMatchedCatalog, activeSource]);

  const filteredCatalog = useMemo(() => {
    return sourceMatchedCatalog.filter(entity => activeCategory === 'ALL' || entity.category === activeCategory);
  }, [sourceMatchedCatalog, activeCategory]);

  const categories = useMemo(() => {
    const cats = new Set(userAllowedCatalog.filter(entity => activeSource === 'ALL' || entitySource(entity) === activeSource).map(c => c.category).filter(Boolean));
    return ['ALL', ...Array.from(cats)];
  }, [userAllowedCatalog, activeSource]);

  useEffect(() => {
    if (!categories.includes(activeCategory)) setActiveCategory('ALL');
  }, [categories, activeCategory]);

  // Si cambia la lista de módulos permitidos, asegurar que selectedEntityId sea válido
  useEffect(() => {
    if (activeSavedReport?.entity === selectedEntityId) return;
    if (userAllowedAssistantCatalog.length > 0 && !userAllowedAssistantCatalog.some(c => c.id === selectedEntityId)) {
      if (manualTopicRequired && !selectedEntityId) return;
      handleSelectEntity((userAllowedCatalog.find(c => c.id === 'inventory') || userAllowedCatalog[0] || userAllowedAssistantCatalog[0]).id);
    } else if (userAllowedAssistantCatalog.length === 0 && selectedEntityId) {
      queryRequestRef.current += 1;
      setSelectedEntityId('');
      setSelectedFields([]);
      setQueryResult(null);
      setLoading(false);
    }
  }, [activeSavedReport, userAllowedAssistantCatalog, userAllowedCatalog, selectedEntityId, manualTopicRequired]);

  // Al cambiar de entidad, preseleccionar sus campos default y limpiar filtros no aplicables
  const handleSelectEntity = (entId) => {
    const def = userAllowedAssistantCatalog.find(c => c.id === entId);
    if (!def) return;
    setActiveSavedReport(null);
    setAnalysis(null); setAnalysisSummary(null); setExecutionFailed(false);
    setManualTopicRequired(false);
    setSelectedEntityId(entId);
    if (def) {
      setSelectedFields(def.defaultFields || def.fields.map(f => f.key));
    }
    setColFilters({});
    setBusqueda('');
    setPage(1);
    setQueryResult(null);
    setError(null);
    queryRequestRef.current += 1;
    setLoading(false);
    // Limpiar estatus si la nueva entidad no lo maneja
    if (!supportsFilter(def, 'estatusDoc') || !(def.statusOptions?.map(option => option.value) || ['ALL', 'OPEN', 'CLOSED']).includes(estatusDoc)) {
      setEstatusDoc('ALL');
    }
    // Limpiar clasificación médica si la nueva entidad no la maneja
    if (!supportsFilter(def, 'clasificacionMedica')) {
      setClasificacionMedica('ALL');
    }
    // Si la entidad no tiene almacén, resetear almacén
    if (!supportsFilter(def, 'almacen')) {
      setAlmacen('ALL');
    }
  };

  const toggleField = (fieldKey) => {
    setSelectedFields(prev => {
      if (prev.includes(fieldKey)) {
        if (prev.length === 1) return prev; // Mantener al menos 1
        return prev.filter(k => k !== fieldKey);
      }
      return [...prev, fieldKey];
    });
  };

  const selectAllFields = () => {
    if (!currentEntityDef) return;
    setSelectedFields(currentEntityDef.fields.map(f => f.key));
  };

  const selectDefaultFields = () => {
    if (!currentEntityDef) return;
    setSelectedFields(currentEntityDef.defaultFields || currentEntityDef.fields.slice(0, 6).map(f => f.key));
  };

  // Cargar consultas guardadas
  const loadSavedQueries = async () => {
    const requestId = ++savedRequestRef.current;
    setSavedLoading(true); setSavedError('');
    try {
      const res = await fetch(`${API_BASE}/sap-query/saved`, { headers: authHeaders() });
      const json = await res.json();
      if (requestId !== savedRequestRef.current) return;
      if (!res.ok || !json.ok || !Array.isArray(json.queries)) throw new Error(userMessage(json.error || 'No se pudieron cargar tus reportes. Intenta de nuevo.'));
      setSavedQueries(json.queries);
      setCanChooseRecipients(Boolean(json.canAssign));
    } catch (err) {
      if (requestId === savedRequestRef.current) setSavedError(userMessage(err.message));
    } finally {
      if (requestId === savedRequestRef.current) setSavedLoading(false);
    }
  };

  const loadRecipients = async () => {
    setRecipientsLoading(true); setRecipientsError('');
    try {
      const res = await fetch(`${API_BASE}/sap-query/saved/recipients`, { headers: authHeaders() });
      const json = await res.json();
      if (!res.ok || !json.ok || !Array.isArray(json.users)) throw new Error(userMessage(json.error || 'No se pudo cargar la lista de personas. Intenta de nuevo.'));
      setRecipientUsers(json.users);
    } catch (err) { setRecipientsError(userMessage(err.message)); }
    finally { setRecipientsLoading(false); }
  };

  const openSaveReport = () => {
    setSaveUserIds([]); setRecipientSearch(''); setSavedNotice('');
    setShowSaveFormModal(true);
    if (canChooseRecipients) loadRecipients();
  };

  const openAssignments = (saved) => {
    setAssignmentTarget(saved); setAssignmentUserIds((saved.assignedUsers || []).filter(person => person.activo !== false).map(person => person.id));
    setAssignmentError(''); setRecipientSearch('');
    loadRecipients();
  };

  const replaceAssignments = async (id, userIds) => {
    const res = await fetch(`${API_BASE}/sap-query/saved/${encodeURIComponent(id)}/assignments`, {
      method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ userIds }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(userMessage(json.error || 'No se pudieron guardar los accesos. Intenta de nuevo.'));
    return json;
  };

  const handleSaveAssignments = async () => {
    if (!assignmentTarget || assigningReport || recipientsLoading || recipientsError) return;
    setAssigningReport(true); setAssignmentError('');
    try {
      await replaceAssignments(assignmentTarget.id, assignmentUserIds);
      setAssignmentTarget(null); setSavedNotice('Los accesos del reporte quedaron actualizados.');
      await loadSavedQueries();
    } catch (err) { setAssignmentError(userMessage(err.message)); }
    finally { setAssigningReport(false); }
  };

  const handleExecuteSavedReport = async (saved) => {
    const requestId = ++queryRequestRef.current;
    setLoading(true); setError(null); setExecutionFailed(false); setQueryResult(null); setColFilters({}); setPage(1);
    try {
      const res = await fetch(`${API_BASE}/sap-query/execute`, {
        method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ savedQueryId: saved.id }),
      });
      const json = await res.json();
      if (requestId !== queryRequestRef.current) return;
      if (!res.ok || !json.ok) throw new Error(userMessage(json.error || 'No se pudo consultar este reporte. Intenta de nuevo.'));
      if (hasReportAnalysis(json.analysis || saved.filters?.analysis) && json.analysisScope?.complete !== true) throw new Error('No se pudieron calcular resultados completos. Ajusta el período o los filtros y vuelve a consultar.');
      setAnalysis(json.analysis || saved.filters?.analysis || null); setAnalysisSummary(json.analysisSummary || null);
      setQueryResult({ ...json, entityTitle: saved.title, requestedFilters: saved.filters || {}, loadedFields: json.loadedFields || saved.selectedFields });
    } catch (err) { if (requestId === queryRequestRef.current) { setExecutionFailed(true); setError(userMessage(err.message)); } }
    finally { if (requestId === queryRequestRef.current) setLoading(false); }
  };

  const handleOpenSavedReport = (saved) => {
    const definition = saved.definition;
    if (!definition || !Array.isArray(definition.fields) || !Array.isArray(saved.selectedFields) || !saved.selectedFields.length
      || saved.selectedFields.some(key => !definition.fields.some(field => field.key === key))) {
      setSavedError('No se pudo preparar este reporte. Actualiza «Mis reportes» e intenta de nuevo.');
      return;
    }
    const snapshot = { ...saved, definition: { ...definition, id: saved.entity } };
    setActiveSavedReport(snapshot); setReportMode('saved'); setSelectedEntityId(saved.entity); setSelectedFields([...saved.selectedFields]);
    setAnalysis(saved.filters?.analysis || null); setAnalysisSummary(saved.analysisSummary || null);
    setFechaDesde(saved.filters?.fechaDesde || ''); setFechaHasta(saved.filters?.fechaHasta || ''); setBusqueda(saved.filters?.busqueda || '');
    setAlmacen(saved.filters?.almacen || 'ALL'); setEstatusDoc(saved.filters?.estatusDoc || 'ALL'); setClasificacionMedica(saved.filters?.clasificacionMedica || 'ALL');
    setShowSavedModal(false); handleExecuteSavedReport(snapshot);
  };

  // Ejecutar consulta dinámica
  const handleExecute = async (configuration) => {
    if (activeSavedReport && !configuration) return handleExecuteSavedReport(activeSavedReport);
    const definition = configuration ? userAllowedAssistantCatalog.find(entity => entity.id === configuration.entity) : currentEntityDef;
    if (!definition) return;
    const fields = configuration?.selectedFields || selectedFields;
    const filters = configuration?.filters || { fechaDesde, fechaHasta, busqueda, almacen, estatusDoc, clasificacionMedica };
    const requestedAnalysis = configuration ? configuration.analysis || configuration.filters?.analysis || null : analysis;

    if (!Array.isArray(fields) || !fields.length || fields.some(key => !definition.fields.some(field => field.key === key))) {
      setExecutionFailed(true);
      setError('Las columnas disponibles cambiaron. Elige de nuevo los datos que quieres incluir.');
      return;
    }

    if (definition.requiresDateFilter && (filters.fechaDesde || filters.fechaHasta || !getReportPointLookup(definition, requestedAnalysis))) {
      if (!filters.fechaDesde || !filters.fechaHasta) {
        setExecutionFailed(true);
        setError(`Elige las fechas de inicio y fin para consultar ${definition.title}.`);
        return;
      }
      if (filters.fechaDesde > filters.fechaHasta) {
        setExecutionFailed(true);
        setError('La fecha de inicio debe ser anterior o igual a la fecha de fin.');
        return;
      }
    }

    const requestId = ++queryRequestRef.current;
    const requestedFilters = executionFilters(definition, filters);
    setLoading(true);
    setExecutionFailed(false);
    setError(null);
    setPage(1);
    setColFilters({});

    try {
      const res = await fetch(`${API_BASE}/sap-query/execute`, {
        method: 'POST',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          entity: definition.id,
          selectedFields: fields,
          ...requestedFilters,
          ...(hasReportAnalysis(requestedAnalysis) ? { analysis: requestedAnalysis } : {})
        })
      });

      const json = await res.json();
      if (requestId !== queryRequestRef.current) return;
      if (!res.ok || !json.ok) {
        throw new Error(userMessage(json.error || 'No se pudo consultar la información. Intenta de nuevo.'));
      }
      if (hasReportAnalysis(json.analysis || requestedAnalysis) && json.analysisScope?.complete !== true) throw new Error('No se pudieron calcular resultados completos. Ajusta el período o los filtros y vuelve a consultar.');
      const canonicalAnalysis = json.analysis || requestedAnalysis;
      setAnalysis(canonicalAnalysis || null); setAnalysisSummary(json.analysisSummary || null);
      setQueryResult({ ...json, requestedFilters, requestedConfiguration: analysisFingerprint(definition.id, fields, requestedFilters, canonicalAnalysis) });
      return { total: json.data?.length || 0, truncated: Boolean(json.truncated), analysis: canonicalAnalysis, analysisSummary: json.analysisSummary };
    } catch (err) {
      if (requestId !== queryRequestRef.current) return;
      console.error('[SAP Query Execution Error]', err);
      setExecutionFailed(true);
      setError(userMessage(err.message));
      if (configuration) throw err;
    } finally {
      if (requestId === queryRequestRef.current) setLoading(false);
    }
  };

  const handleAssistantGenerate = async (plan) => {
    const definition = userAllowedAssistantCatalog.find(entity => entity.id === plan.entity);
    if (!definition || plan.selectedFields.some(key => !definition.fields.some(field => field.key === key))) throw new Error('Ese tema o alguna columna ya no está disponible. Intenta con otro reporte.');
    handleSelectEntity(plan.entity);
    setSelectedFields(plan.selectedFields);
    setAnalysis(plan.analysis || null); setAnalysisSummary(plan.analysisSummary || null);
    setFechaDesde(plan.filters.fechaDesde || '');
    setFechaHasta(plan.filters.fechaHasta || '');
    setAlmacen(plan.filters.almacen || 'ALL');
    setEstatusDoc(plan.filters.estatusDoc || 'ALL');
    setClasificacionMedica(plan.filters.clasificacionMedica || 'ALL');
    setBusqueda(plan.filters.busqueda || '');
    return handleExecute(plan);
  };

  const showResults = () => {
    resultsRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    resultsRef.current?.focus({ preventScroll: true });
  };

  const resetAssistantReport = () => {
    queryRequestRef.current += 1;
    setQueryResult(null);
    setExecutionFailed(false);
    setError(null);
    setLoading(false);
    setColFilters({});
    setPage(1);
  };

  const handleAssistantManual = (draft) => {
    setReportMode('manual');
    resetAssistantReport();
    setModuleSearch('');
    setActiveCategory('ALL');
    setActiveSource('ALL');
    const definition = draft && userAllowedAssistantCatalog.find(entity => entity.id === draft.entity);
    const filters = draft?.filters && typeof draft.filters === 'object' && !Array.isArray(draft.filters) ? draft.filters : {};
    const choices = {
      almacen: supportsFilter(definition, 'almacen') ? ['ALL', 'FAR', 'QX', 'QXCR', 'QXRCR', 'TERACR', 'PPBCR', 'PPACR', 'IMAGCR', 'CARDIOCR', 'CUNACR', 'QXCM', 'URG1CM', 'ALG'] : ['ALL'],
      estatusDoc: supportsFilter(definition, 'estatusDoc') ? definition.statusOptions?.map(option => option.value) || ['ALL', 'OPEN', 'CLOSED'] : ['ALL'],
      clasificacionMedica: supportsFilter(definition, 'clasificacionMedica') ? ['ALL', 'CON', 'ANTI', 'REFRI'] : ['ALL'],
    };
    const valid = definition && Array.isArray(draft.selectedFields) && draft.selectedFields.length > 0
      && draft.selectedFields.every(key => definition.fields.some(field => field.key === key))
      && (draft.filters == null || typeof draft.filters === 'object' && !Array.isArray(draft.filters))
      && Object.keys(filters).every(key => ['fechaDesde', 'fechaHasta', 'busqueda', 'almacen', 'estatusDoc', 'clasificacionMedica', 'analysis'].includes(key))
      && validDraftDate(filters.fechaDesde) && validDraftDate(filters.fechaHasta)
      && (!filters.fechaDesde || !filters.fechaHasta || filters.fechaDesde <= filters.fechaHasta)
      && Object.entries(choices).every(([key, values]) => values.includes(filters[key] || 'ALL'))
      && (filters.busqueda == null || typeof filters.busqueda === 'string' && filters.busqueda.length <= 200);
    if (!valid) {
      setAnalysis(null); setAnalysisSummary(null);
      setManualTopicRequired(true);
      setSelectedEntityId(''); setSelectedFields([]);
      setFechaDesde(''); setFechaHasta(''); setBusqueda('');
      setAlmacen('ALL'); setEstatusDoc('ALL'); setClasificacionMedica('ALL');
      if (draft) setError('El tema o las columnas cambiaron. Elige un tema disponible para continuar.');
      return;
    }
    // Only fill the form. The user completes it and explicitly starts the query.
    handleSelectEntity(definition.id);
    setSelectedFields([...new Set(draft.selectedFields)]);
    setAnalysis(draft.analysis || filters.analysis || null); setAnalysisSummary(draft.analysisSummary || null);
    setFechaDesde(definition.requiresDateFilter ? filters.fechaDesde || '' : '');
    setFechaHasta(definition.requiresDateFilter ? filters.fechaHasta || '' : '');
    setBusqueda(filters.busqueda || '');
    setAlmacen(filters.almacen || 'ALL');
    setEstatusDoc(filters.estatusDoc || 'ALL');
    setClasificacionMedica(filters.clasificacionMedica || 'ALL');
  };

  // Guardar consulta
  const handleSaveQuery = async (e) => {
    e.preventDefault();
    if (!saveTitle.trim()) return;

    setSavingQuery(true);
    setSavedNotice('');
    try {
      const res = await fetch(`${API_BASE}/sap-query/saved`, {
        method: 'POST',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: saveTitle.trim(),
          description: saveDescription.trim(),
          entity: selectedEntityId,
          selectedFields,
          filters: { fechaDesde, fechaHasta, almacen: hasWhsField ? almacen : 'ALL', estatusDoc: hasStatusField ? estatusDoc : 'ALL', clasificacionMedica: hasMedClassField ? clasificacionMedica : 'ALL', busqueda, ...(hasReportAnalysis(analysis) ? { analysis } : {}) },
          isPublic: false
        })
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(userMessage(json.error || 'No se pudo guardar el reporte. Intenta de nuevo.'));

      let notice = 'El reporte quedó guardado en «Mis reportes».';
      if (saveUserIds.length) {
        try {
          const id = json.saved?.id || json.saved?.queryid;
          if (!id) throw new Error('No se recibió la confirmación del reporte guardado.');
          await replaceAssignments(id, saveUserIds);
          notice = 'El reporte quedó guardado y disponible para las personas elegidas.';
        } catch (err) { notice = `El reporte quedó guardado. No se pudieron asignar sus accesos: ${userMessage(err.message)} Revisa «Administrar accesos» en Mis reportes.`; }
      }

      setShowSaveFormModal(false);
      setSaveTitle('');
      setSaveDescription('');
      setSaveUserIds([]); setSavedNotice(notice);
      await loadSavedQueries();
    } catch (err) {
      setSavedNotice(userMessage(err.message));
    } finally {
      setSavingQuery(false);
    }
  };

  // Cargar una plantilla guardada
  const handleLoadSavedQuery = (sq) => {
    if (sq.isAssigned && !sq.isOwner) { handleOpenSavedReport(sq); return; }
    const entity = userAllowedAssistantCatalog.find(def => def.id === sq.entity);
    if (!entity) {
      if (sq.definition) { handleOpenSavedReport(sq); return; }
      setError('Este módulo no está disponible para tu usuario. Solicita acceso al área de Sistemas.');
      setShowSavedModal(false);
      return;
    }
    setReportMode('manual');
    handleSelectEntity(sq.entity);
    setAnalysis(sq.filters?.analysis || null); setAnalysisSummary(sq.analysisSummary || null);
    if (hasReportAnalysis(sq.filters?.analysis)) { setFechaDesde(sq.filters?.fechaDesde || ''); setFechaHasta(sq.filters?.fechaHasta || ''); }
    if (sq.selectedFields && sq.selectedFields.length > 0) {
      const availableFields = sq.selectedFields.filter(key => entity.fields.some(field => field.key === key));
      if (availableFields.length) setSelectedFields(availableFields);
    }
    if (sq.filters) {
      if (sq.filters.fechaDesde) setFechaDesde(sq.filters.fechaDesde);
      if (sq.filters.fechaHasta) setFechaHasta(sq.filters.fechaHasta);
      setAlmacen(supportsFilter(entity, 'almacen') ? (sq.filters.almacen || 'ALL') : 'ALL');
      setEstatusDoc(supportsFilter(entity, 'estatusDoc') && (entity.statusOptions?.map(option => option.value) || ['ALL', 'OPEN', 'CLOSED']).includes(sq.filters.estatusDoc) ? sq.filters.estatusDoc : 'ALL');
      setClasificacionMedica(supportsFilter(entity, 'clasificacionMedica') ? (sq.filters.clasificacionMedica || 'ALL') : 'ALL');
      if (sq.filters.busqueda) setBusqueda(sq.filters.busqueda);
    }
    setShowSavedModal(false);
  };

  // Eliminar plantilla guardada
  const handleDeleteSavedQuery = async (sqId, e) => {
    e.stopPropagation();
    if (!confirm('¿Eliminar este reporte guardado? Las personas asignadas dejarán de verlo.')) return;

    try {
      const res = await fetch(`${API_BASE}/sap-query/saved/${sqId}`, {
        method: 'DELETE',
        headers: authHeaders()
      });
      if (res.ok) {
        loadSavedQueries();
        setSavedNotice('El reporte quedó eliminado.');
      } else {
        const json = await res.json();
        alert(userMessage('Error: ' + json.error));
      }
    } catch (err) {
      alert(userMessage('Error al eliminar: ' + err.message));
    }
  };

  const changeReportMode = (mode) => {
    if (activeSavedReport) {
      setActiveSavedReport(null); resetAssistantReport(); setSelectedEntityId(''); setSelectedFields([]); setManualTopicRequired(true);
    }
    setReportMode(mode);
  };

  // Sincronizar scroll superior e inferior
  useEffect(() => {
    const tableContainer = tableScrollRef.current;
    if (!tableContainer) return;

    const observer = new ResizeObserver(() => {
      if (tableContainer.scrollWidth > 0) {
        setTableScrollWidth(tableContainer.scrollWidth);
      }
    });

    observer.observe(tableContainer);
    if (tableContainer.firstChild) observer.observe(tableContainer.firstChild);

    return () => observer.disconnect();
  }, [queryResult]);

  const rows = queryResult?.data || [];
  const analyzedResult = hasReportAnalysis(queryResult?.analysis);
  const resultDates = queryResult?.requestedFilters || {};
  const resultWithoutPeriod = !resultDates.fechaDesde && !resultDates.fechaHasta;
  const resultPointLookupLabel = resultWithoutPeriod && getReportPointLookup(currentEntityDef, queryResult?.analysis)
    ? 'Consulta de cuenta/paciente por identificador'
    : resultWithoutPeriod && queryResult?.analysisScope?.complete && currentEntityDef?.requiresDateFilter ? 'Consulta puntual, información actual' : '';
  const limitMessage = analyzedResult && queryResult.analysisScope?.complete === true
    ? `El análisis usa todos los registros de la consulta. Se muestran ${rows.length.toLocaleString('es-MX')} de ${Number(queryResult.totalRegistros || queryResult.analysisScope.groups || rows.length).toLocaleString('es-MX')} ${queryResult.analysis.groupBy?.length ? 'grupos' : 'resultados'} por el límite de salida. Ajusta los filtros para revisar el resto.`
    : queryResult?.message || `Se alcanzó el límite de ${Number(queryResult?.limit || rows.length).toLocaleString('es-MX')} registros. Reduce el período o los filtros para revisar el resto.`;
  const analysisConfigurationChanged = Boolean(queryResult && !activeSavedReport && (hasReportAnalysis(analysis) || analyzedResult)
    && queryResult.requestedConfiguration !== analysisFingerprint(selectedEntityId, selectedFields, executionFilters(currentEntityDef, { fechaDesde, fechaHasta, busqueda, almacen, estatusDoc, clasificacionMedica }), analysis));
  const hasUnloadedColumns = !analyzedResult && Array.isArray(queryResult?.loadedFields) && selectedFields.some(key => !queryResult.loadedFields.includes(key));
  const needsSourceRefresh = analysisConfigurationChanged || hasUnloadedColumns || (currentEntityDef?.serverSideFilters?.includes('estatusDoc')
    && queryResult && estatusDoc !== queryResult.requestedFilters?.estatusDoc);
  const exportBlocked = loading || executionFailed || needsSourceRefresh;

  // Columnas dinámicas activas según los checkboxes seleccionados por el usuario
  const columns = useMemo(() => {
    if (hasReportAnalysis(queryResult?.analysis) && Array.isArray(queryResult.columnas)) return queryResult.columnas;
    if (!currentEntityDef) return queryResult?.columnas || [];
    const activeKeys = (selectedFields && selectedFields.length > 0)
      ? selectedFields
      : (queryResult?.columnas ? queryResult.columnas.map(c => c.key) : currentEntityDef.fields.map(f => f.key));
    
    // Obtener las definiciones completas de las columnas seleccionadas
    const activeDefs = [...new Set(activeKeys)].filter(key => !Array.isArray(queryResult?.loadedFields) || queryResult.loadedFields.includes(key))
      .map(key => currentEntityDef.fields.find(field => field.key === key)).filter(Boolean);
    return activeDefs.length > 0 ? activeDefs : (queryResult?.columnas || currentEntityDef.fields);
  }, [currentEntityDef, selectedFields, queryResult]);

  // Filtrado reactivo en tiempo real (Búsqueda general, almacén, estatus, clasificación sanitaria y filtros de columna)
  const filteredRows = useMemo(() => {
    const rawList = queryResult?.data || [];
    if (!rawList || rawList.length === 0) return [];

    return rawList.filter(row => {
      if (hasReportAnalysis(queryResult.analysis)) return Object.entries(colFilters).every(([key, value]) => !value?.trim() || String(row[key] ?? '').toLowerCase().includes(value.trim().toLowerCase()));
      // 1. Filtro de búsqueda general de texto (en todas las propiedades del objeto)
      if (busqueda && busqueda.trim() && busqueda !== queryResult.requestedFilters?.busqueda) {
        const q = busqueda.trim().toLowerCase();
        const matchesSearch = Object.values(row).some(val => 
          val != null && String(val).toLowerCase().includes(q)
        );
        if (!matchesSearch) return false;
      }

      // 2. Filtro de almacén
      if (hasWhsField && almacen && almacen !== 'ALL' && almacen !== queryResult.requestedFilters?.almacen && (row.WhsCode != null || row.FillerCode != null || row.ToWhsCodeRaw != null || row.WhsName != null || row.Filler != null || row.ToWhsCode != null)) {
        const alm = almacen.trim().toUpperCase();
        const rowWhs = String(row.WhsCode || row.FillerCode || row.ToWhsCodeRaw || '').toUpperCase();
        const rowWhsName = String(row.WhsName || row.Filler || row.ToWhsCode || '').toUpperCase();
        const matchesWhs = rowWhs === alm || rowWhsName.includes(alm) || rowWhsName.includes(`(${alm})`);
        if (!matchesWhs) return false;
      }

      // 3. Filtro de estatus de documento (solo si la fila realmente contiene estatus)
      if (hasStatusField && estatusDoc && estatusDoc !== 'ALL' && estatusDoc !== queryResult.requestedFilters?.estatusDoc) {
        const hasStatus = row.DocStatus != null || row.Status != null || row[currentEntityDef?.statusField] != null;
        if (hasStatus) {
          const s = String(row[currentEntityDef?.statusField] || row.DocStatus || row.Status || '').toUpperCase();
          if (estatusDoc === 'OPEN') {
            const isOpen = s.includes('ABIERTA') || s.includes('ACTIVO') || s.includes('PRÓXIMO') || s === 'O' || s === 'OPEN' || s === 'BOST_OPEN' || s === 'Y';
            if (!isOpen) return false;
          } else if (estatusDoc === 'CLOSED') {
            const isClosed = s.includes('CERRADA') || s.includes('VENCIDO') || s === 'C' || s === 'CLOSED' || s === 'BOST_CLOSE' || s === 'N';
            if (!isClosed) return false;
          } else if (estatusDoc === 'CANCELED' && !s.includes('CANCELAD')) return false;
        }
        const discharge = row[currentEntityDef?.medicalDischargeField];
        if (estatusDoc === 'MEDICAL_DISCHARGE' && discharge != null && discharge !== 'Sí') return false;
        if (estatusDoc === 'NO_MEDICAL_DISCHARGE' && discharge != null && discharge !== 'No') return false;
      }

      // 4. Filtro de clasificación sanitaria (solo si la fila la contiene)
      if (hasMedClassField && clasificacionMedica && clasificacionMedica !== 'ALL' && clasificacionMedica !== queryResult.requestedFilters?.clasificacionMedica) {
        if ('MedicalClassification' in row || 'SecondaryClassification' in row) {
          const c = `${row.MedicalClassification || ''} ${row.SecondaryClassification || ''}`.toUpperCase();
          if (clasificacionMedica === 'CON' && !(c.includes('CON') || c.includes('CONTROL'))) return false;
          if (clasificacionMedica === 'ANTI' && !(c.includes('ANTI') || c.includes('ANTIBIOT'))) return false;
          if (clasificacionMedica === 'REFRI' && !(c.includes('REFRI') || c.includes('FRIO'))) return false;
        }
      }

      // 5. Filtros por encabezado de columna individual (búsqueda parcial insensible a mayúsculas)
      return Object.entries(colFilters).every(([key, val]) => {
        if (!val || !val.trim()) return true;
        const needle = val.trim().toLowerCase();
        const hay = String(row[key] ?? '').trim().toLowerCase();
        return hay.includes(needle);
      });
    });
  }, [queryResult, busqueda, almacen, estatusDoc, clasificacionMedica, colFilters, hasWhsField, hasStatusField, hasMedClassField, currentEntityDef]);

  // Resetear página a 1 cuando cambie cualquier filtro
  useEffect(() => {
    setPage(1);
  }, [busqueda, almacen, estatusDoc, clasificacionMedica, colFilters, selectedFields]);

  const hasActiveFilters = analyzedResult ? Object.values(colFilters).some(Boolean) : Boolean(
    busqueda || (hasWhsField && almacen && almacen !== 'ALL') || (hasStatusField && estatusDoc && estatusDoc !== 'ALL') ||
    (hasMedClassField && clasificacionMedica && clasificacionMedica !== 'ALL') || Object.values(colFilters).some(Boolean)
  );

  const handleClearFilters = () => {
    if (analyzedResult) { setColFilters({}); return; }
    setBusqueda('');
    setAlmacen('ALL');
    setEstatusDoc('ALL');
    setClasificacionMedica('ALL');
    setColFilters({});
  };

  const paginatedRows = useMemo(() => {
    return filteredRows.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  }, [filteredRows, page]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PER_PAGE));

  // Totales para exportación y resumen
  const exportExcel = () => {
    if (exportBlocked || filteredRows.length === 0 || columns.length === 0) return;

    const fmt = (val, col) => {
      if (val == null || typeof val === 'string' && !val.trim()) return '';
      let formatted = typeof val === 'boolean' ? val ? 'Sí' : 'No' : String(val);
      if (col.type === 'date') formatted = formatReportDate(val);
      if (col.type === 'datetime') formatted = formatReportDate(val, true);
      if (['money', 'percent', 'number'].includes(col.type)) formatted = formatReportNumeric(val, col.type, '');
      return escapeReportHtml(formatted);
    };

    const fechaReporte = new Date().toLocaleString('es-MX');
    const reportDates = queryResult?.requestedFilters || { fechaDesde, fechaHasta };
    const html = `
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:spreadsheet" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<style>
  body{font-family:Calibri,Arial,sans-serif}table{border-collapse:collapse;width:100%}
  .title-bar{background:#004687;color:#fff;font-size:16pt;font-weight:bold;padding:12px 16px}
  .subtitle-bar{background:#0088C9;color:#fff;font-size:10pt;padding:6px 16px}
  .info-row td{font-size:9pt;color:#475569;padding:4px 16px}
  th{background:#004687;color:#fff;font-weight:bold;font-size:9.5pt;padding:9px 8px;border:1px solid #003366;text-align:center}
  td{padding:6px 8px;font-size:8.5pt;border:1px solid #D1D5DB;color:#1E293B}
  .even{background:#F4F6F9}.odd{background:#FFF}
  .money{color:#15803D;font-weight:bold;text-align:right}
  .total-row td{background:#E0EAF4;font-weight:bold;color:#004687;border-top:2px solid #004687;font-size:9.5pt;padding:10px 8px}
</style></head><body>
<table>
  <tr><td colspan="${columns.length}" class="title-bar">HOSPITAL ESCANDÓN</td></tr>
  <tr><td colspan="${columns.length}" class="subtitle-bar">Reporte de ${entitySource(currentEntityDef)}: ${currentEntityDef?.title || 'Consulta Personalizada'}</td></tr>
  <tr class="info-row"><td colspan="${columns.length}">Generado por: ${user?.nombre || user?.username} &nbsp;|&nbsp; ${resultPointLookupLabel ? `${fmt(resultPointLookupLabel, {})} &nbsp;|&nbsp; ` : currentEntityDef?.requiresDateFilter && (reportDates.fechaDesde || reportDates.fechaHasta) ? `${currentEntityDef.dateFieldLabel || 'Período'}: ${reportDates.fechaDesde} al ${reportDates.fechaHasta} &nbsp;|&nbsp; ` : ''}Registros: ${filteredRows.length} &nbsp;|&nbsp; Fecha: ${fechaReporte}</td></tr>
  ${queryResult?.grain || currentEntityDef?.grain ? `<tr class="info-row"><td colspan="${columns.length}">Cada fila representa: ${fmt(queryResult?.grain || currentEntityDef.grain, {})}</td></tr>` : ''}
  ${analyzedResult ? [['conditions', 'Condiciones'], ['groups', 'Agrupado por'], ['measures', 'Cálculos'], ['order', 'Orden']].filter(([key]) => queryResult.analysisSummary?.[key]?.length).map(([key, label]) => `<tr class="info-row"><td colspan="${columns.length}">${label}: ${fmt(queryResult.analysisSummary[key].join(' · '), {})}</td></tr>`).join('') : ''}
  ${analyzedResult && queryResult.analysisScope?.complete ? `<tr class="info-row"><td colspan="${columns.length}">Datos completos: ${fmt(queryResult.analysisScope.sourceRows, {})} registros consultados; ${fmt(queryResult.analysisScope.matchingRows, {})} cumplen las condiciones. ${fmt(queryResult.analysisScope.note || 'Los totales corresponden al reporte completo; los filtros de columnas sólo cambian las filas visibles.', {})}</td></tr>` : ''}
  ${queryResult?.truncated ? `<tr class="info-row"><td colspan="${columns.length}">${fmt(limitMessage, {})}</td></tr>` : ''}
  <tr><td colspan="${columns.length}" style="height:6px;border:none"></td></tr>
  <tr>${columns.map(c => `<th style="width:${c.width || 120}px">${fmt(c.label, {})}</th>`).join('')}</tr>
  ${filteredRows.map((row, i) => `<tr class="${i%2===0?'even':'odd'}">${columns.map(c => {
    const raw = row[c.key];
    const val = fmt(raw, c);
    const numericColumn = ['money', 'percent', 'number'].includes(c.type);
    const numericValue = reportNumber(raw);
    const cls = c.type === 'money' && numericValue != null ? ' class="money"' : '';
    const asText = val !== '' && typeof raw === 'string' && !['date', 'datetime'].includes(c.type) && (!numericColumn || numericValue == null);
    return `<td${cls}${asText ? ' x:str' : ''} style="text-align:${c.align || 'left'}${asText ? ";mso-number-format:'\\@'" : ''}">${val}</td>`;
  }).join('')}</tr>`).join('')}
  <tr class="total-row">
    <td colspan="${columns.length}">${analyzedResult && queryResult.analysis?.groupBy?.length ? 'Grupos exportados' : 'Total Registros'}: ${filteredRows.length.toLocaleString('es-MX')}</td>
  </tr>
  ${analyzedResult ? (queryResult.kpis || []).map(kpi => `<tr class="total-row"><td colspan="${columns.length}">Total del reporte · ${fmt(kpi.label, {})}: ${fmt(kpi.value, {})}</td></tr>`).join('') : ''}
</table></body></html>`;

    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Reporte_${entitySource(currentEntityDef)}_${selectedEntityId}_${reportDates.fechaDesde}_${reportDates.fechaHasta}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const onlySavedReports = !catalogLoading && !catalogError && userAllowedAssistantCatalog.length === 0 && savedQueries.length > 0;

  return (
    <div className="report-builder">
      
      {/* ── Encabezado Principal ── */}
      <header className="report-builder__header">
        <div className="report-builder__intro">
          <span className="report-builder__hero-icon"><ReportBuilderIcon /></span>
          <div>
            <p className="report-builder__eyebrow">Hospital Escandón · Reportes</p>
            <h1>{onlySavedReports ? 'Mis reportes' : 'Crear reporte personalizado'}</h1>
            <p className="report-builder__subtitle">{onlySavedReports ? 'Consulta y descarga los reportes que tienes disponibles.' : reportMode === 'assistant' ? 'Describe lo que necesitas y crea tu reporte con ayuda del asistente.' : 'Elige un tema, ajusta los filtros y descarga la información que necesitas.'}</p>
          </div>
        </div>

        <div className="report-builder__header-actions">
          <button
            type="button"
            onClick={() => { setShowSavedModal(true); loadSavedQueries(); }}
            className="report-builder__button report-builder__button--secondary"
          >
            <ReportBuilderIcon name="folder" /> Mis reportes <span className="report-builder__button-count">{savedQueries.length}</span>
          </button>

          <button
            type="button"
            onClick={openSaveReport}
            disabled={Boolean(activeSavedReport) || !currentEntityDef || catalogLoading || (reportMode === 'assistant' && !queryResult)}
            className="report-builder__button report-builder__button--primary"
          >
            <ReportBuilderIcon name="save" /> Guardar reporte
          </button>
        </div>
      </header>

      {savedNotice && <p role="status" style={{ padding: '1rem', border: '1px solid var(--report-border)', borderRadius: 10, background: 'var(--report-soft)' }}>{savedNotice}</p>}
      {!onlySavedReports && <div className="report-builder__modes" role="group" aria-label="Cómo crear tu reporte">
        <button type="button" className={`report-builder__mode${reportMode === 'assistant' ? ' is-active' : ''}`} aria-pressed={reportMode === 'assistant'} onClick={() => changeReportMode('assistant')}><ReportBuilderIcon name="chat" /> Crear con asistente</button>
        <button type="button" className={`report-builder__mode${reportMode === 'manual' ? ' is-active' : ''}`} aria-pressed={reportMode === 'manual'} onClick={() => changeReportMode('manual')}><ReportBuilderIcon name="grid" /> Elegir un tema</button>
      </div>}
      {onlySavedReports && !activeSavedReport && <p className="report-builder__subtitle">Selecciona «Mis reportes» para abrir uno de tus reportes guardados o asignados.</p>}

      {activeSavedReport && <section className="report-catalog" aria-label="Configuración guardada del reporte">
        <div className="report-builder__configuration-heading"><div><h2 style={{ margin: 0 }}>{activeSavedReport.title}</h2><p style={{ color: 'var(--report-muted)', fontSize: '.82rem' }}>{activeSavedReport.isAssigned && !activeSavedReport.isOwner ? 'Reporte asignado para ti' : 'Reporte guardado'} · Creado por {activeSavedReport.username} · {entitySource(currentEntityDef)}</p></div><button type="button" className="report-builder__button report-builder__button--primary" disabled={loading} onClick={() => handleExecuteSavedReport(activeSavedReport)}>{loading ? 'Consultando…' : 'Actualizar reporte'}</button></div>
        <p style={{ color: 'var(--report-muted)', fontSize: '.82rem' }}>Este reporte usa sus columnas y filtros guardados. Puedes revisarlo y descargarlo en Excel.</p>
        {activeSavedReport.filters?.fechaDesde && <p style={{ fontSize: '.82rem' }}>Período guardado: {formatReportDate(activeSavedReport.filters.fechaDesde)}{activeSavedReport.filters.fechaHasta ? ` al ${formatReportDate(activeSavedReport.filters.fechaHasta)}` : ''}</p>}
        <p style={{ fontSize: '.8rem' }}><strong>Columnas:</strong> {selectedFields.map(key => currentEntityDef?.fields.find(field => field.key === key)?.label).filter(Boolean).join(' · ')}</p>
        <ReportAnalysisSummary analysis={analysis} summary={analysisSummary} entity={currentEntityDef} label="Análisis guardado" />
      </section>}

      <div hidden={onlySavedReports || reportMode !== 'assistant'}>
        <ReportAssistant assistantCatalog={userAllowedAssistantCatalog} catalogLoading={catalogLoading} catalogError={catalogError} onGenerate={handleAssistantGenerate} onViewReport={showResults} onManual={handleAssistantManual} onReset={resetAssistantReport} />
      </div>

      {/* ── Selector de módulos y temas de SAP / Vertical ── */}
      <section hidden={onlySavedReports || reportMode !== 'manual'} className="report-catalog" aria-label="Módulos y temas disponibles" aria-busy={catalogLoading}>
        <div className="report-catalog__heading">
          <div className="report-builder__section-title">
            <span className="report-builder__step" aria-hidden="true">01</span>
            <div><h2>Elige qué quieres consultar</h2><p>Busca un tema o explora las categorías.</p></div>
          </div>
          {!catalogLoading && !catalogError && <span className="report-catalog__count" role="status">{filteredCatalog.length} de {userAllowedCatalog.length} módulos disponibles</span>}
        </div>

        {!catalogLoading && !catalogError && userAllowedCatalog.length > 0 && <>
          <div className="report-catalog__tools">
            <label className="report-catalog__search">
              <span>Buscar módulos o temas</span>
              <span className="report-catalog__search-field"><ReportBuilderIcon name="search" /><input type="search" value={moduleSearch} onChange={event => setModuleSearch(event.target.value)} placeholder="Ej. cuentas, médicos, cirugías, pagos…" /></span>
            </label>
            <div className="report-catalog__sources" role="group" aria-label="Fuente de información">
              <span>Fuente de información</span>
              <div className="report-catalog__chips">
                {['ALL', 'SAP', 'Vertical'].map(source => (
                  <button
                    type="button" key={source} aria-pressed={activeSource === source}
                    aria-label={`${source === 'ALL' ? 'Todas las fuentes' : source} (${source === 'ALL' ? searchMatchedCatalog.length : searchMatchedCatalog.filter(entity => entitySource(entity) === source).length})`}
                    className={`report-catalog__chip${activeSource === source ? ' is-active' : ''}`}
                    onClick={() => { setActiveSource(source); setActiveCategory('ALL'); }}
                  >
                    {source === 'ALL' ? 'Todas' : source}<span className="report-catalog__chip-count">{source === 'ALL' ? searchMatchedCatalog.length : searchMatchedCatalog.filter(entity => entitySource(entity) === source).length}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

        </>}

        <div className="report-catalog__layout">
          {!catalogLoading && !catalogError && userAllowedCatalog.length > 0 && <aside className="report-catalog__categories" aria-label="Categorías de reportes">
            <div className="report-catalog__category-heading"><ReportBuilderIcon name="grid" /><h3>Categorías</h3></div>
            <label className="report-catalog__category-select">
              <span>Filtrar por categoría</span>
              <select aria-label="Filtrar por categoría" value={activeCategory} onChange={event => setActiveCategory(event.target.value)}>
                {categories.map(cat => <option key={cat} value={cat}>{cat === 'ALL' ? 'Todos los módulos' : cat} ({cat === 'ALL' ? sourceMatchedCatalog.length : sourceMatchedCatalog.filter(entity => entity.category === cat).length})</option>)}
              </select>
            </label>
            <div className="report-catalog__category-list" role="group" aria-label="Elegir categoría">
            {categories.map(cat => {
              const isCatActive = activeCategory === cat;
              const count = cat === 'ALL' ? sourceMatchedCatalog.length : sourceMatchedCatalog.filter(c => c.category === cat).length;
              return (
                <button
                  type="button"
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  aria-pressed={isCatActive}
                  aria-label={`${cat === 'ALL' ? 'Todos los módulos' : cat} (${count})`}
                  className={`report-catalog__category${isCatActive ? ' is-active' : ''}`}
                >
                  <span>{cat === 'ALL' ? 'Todos los módulos' : cat}</span><span className="report-catalog__category-count">{count}</span>
                </button>
              );
            })}
            </div>
          </aside>}

          <div className="report-catalog__content">
            {!catalogLoading && !catalogError && userAllowedCatalog.length > 0 && <div className="report-catalog__results-heading"><h3 id="report-catalog-results">{moduleSearch.trim() ? 'Resultados de tu búsqueda' : activeCategory === 'ALL' ? 'Temas disponibles' : activeCategory}</h3><span>Selecciona una tarjeta para preparar tu reporte</span></div>}
            <div className="report-catalog__results" role="region" aria-label="Lista de temas para tu reporte" tabIndex={0} key={`${activeCategory}-${activeSource}-${moduleSearch}`}>

        {catalogLoading ? (
          <div className="report-catalog__state" role="status">Cargando módulos de SAP y Vertical…</div>
        ) : catalogError ? (
          <div className="report-catalog__state" role="alert">
            <p>{catalogError}</p>
            <button type="button" className="report-catalog__chip" onClick={() => setCatalogRefresh(value => value + 1)}>Reintentar carga</button>
          </div>
        ) : userAllowedCatalog.length === 0 ? (
          <div className="report-catalog__state" role="status">No hay módulos disponibles para tu usuario. Solicita acceso al área de Sistemas.</div>
        ) : filteredCatalog.length === 0 ? (
          <div className="report-catalog__state" role="status">
            <strong>No hay módulos que coincidan con tu búsqueda y filtros.</strong>
            <p>Prueba otro tema o vuelve a ver todos los módulos disponibles.</p>
            <button type="button" className="report-catalog__chip" onClick={() => { setModuleSearch(''); setActiveSource('ALL'); setActiveCategory('ALL'); }}>Limpiar búsqueda de módulos</button>
          </div>
        ) : <div className="report-catalog__grid">
          {filteredCatalog.map(ent => {
            const isSelected = ent.id === selectedEntityId;
            return (
              <button
                type="button"
                key={ent.id}
                onClick={() => handleSelectEntity(ent.id)}
                aria-label={`Seleccionar módulo: ${ent.title}`}
                aria-pressed={isSelected}
                className={`report-catalog__card${isSelected ? ' is-selected' : ''}`}
              >
                <span className="report-catalog__card-top">
                  <span className={`report-catalog__badge report-catalog__badge--${entitySource(ent).toLowerCase()}`}>{entitySource(ent)}</span>
                  <span className={`report-catalog__selection${isSelected ? ' is-selected' : ''}`} aria-hidden="true">{isSelected && <ReportBuilderIcon name="check" />}</span>
                </span>
                <span className="report-catalog__card-title"><span className="report-catalog__topic-icon"><ReportBuilderIcon name={reportTopicIcon(ent)} /></span><span>{ent.title}</span></span>
                <span className="report-catalog__description">
                  {ent.description}
                </span>
                <span className="report-catalog__badges">
                  <span className="report-catalog__category-label">{ent.category}</span>
                  {ent.requiresDateFilter && (
                    <span className="report-catalog__date-note"><ReportBuilderIcon name="calendar" /> Elegir fechas</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>}
            </div>
          </div>
        </div>
        {!catalogLoading && !catalogError && currentEntityDef && <div className="report-catalog__selected-report">
          <span className="report-catalog__selected-icon"><ReportBuilderIcon name="check" /></span>
          <div><span>Reporte seleccionado</span><strong>{currentEntityDef.title}</strong></div>
          <button type="button" className="report-builder__button report-builder__button--primary" onClick={() => { configurationRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }); configurationRef.current?.focus({ preventScroll: true }); }}>Configurar reporte <ReportBuilderIcon name="arrow" /></button>
        </div>}
      </section>

      {/* ── Panel de Configuración de Filtros y Columnas ── */}
      {currentEntityDef && (
        <div hidden={reportMode !== 'manual'} className="report-builder__configuration-panel">
          <div className="report-builder__configuration-heading">
            <div className="report-builder__section-title">
              <span className="report-builder__step" aria-hidden="true">02</span>
              <div>
                <h3 ref={configurationRef} tabIndex={-1}>
                  {currentEntityDef.title}
                </h3>
                <p>Información de {entitySource(currentEntityDef)}. Elige los filtros y las columnas que quieres incluir.</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => handleExecute()}
              disabled={loading}
              className="report-builder__button report-builder__button--primary"
            >
              <ReportBuilderIcon name="search" /> {loading ? 'Buscando información…' : 'Buscar información'}
            </button>
          </div>

          {!hasReportAnalysis(analysis) && currentEntityDef.grain && <div className="report-builder__grain"><strong>Cada fila representa:</strong> {currentEntityDef.grain}</div>}
          <ReportAnalysisSummary analysis={analysis} summary={analysisSummary} entity={currentEntityDef} onRemove={() => { setAnalysis(null); setAnalysisSummary(null); }} label="Análisis configurado" />

          <div className="report-builder__configuration">
            
            {/* Columna Izquierda: Rango de Fechas y Filtros Rápidos */}
            <div>
              <div className="report-builder__field-heading">
                Filtros de búsqueda {currentEntityDef.requiresDateFilter && <span className="report-builder__required-dates">{getReportPointLookup(currentEntityDef, analysis) ? 'Período opcional para la consulta exacta' : 'Elige un período'}</span>}
              </div>

              {/* Rango de Fechas */}
              {currentEntityDef.requiresDateFilter ? (
                <div className="report-builder__dates">
                  {currentEntityDef.dateFieldLabel && <div className="report-builder__date-label" style={{ marginBottom: '0.5rem', fontWeight: 700, fontSize: '0.78rem' }}>Período según: {currentEntityDef.dateFieldLabel}</div>}
                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ flex: 1, minWidth: '130px' }}>
                      <label htmlFor="report-date-from" style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
                        Fecha Desde
                      </label>
                      <input
                        id="report-date-from"
                        type="date"
                        value={fechaDesde}
                        onChange={(e) => setFechaDesde(e.target.value)}
                        style={{ width: '100%', padding: '0.4rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.82rem', boxSizing: 'border-box' }}
                      />
                    </div>
                    <div style={{ flex: 1, minWidth: '130px' }}>
                      <label htmlFor="report-date-to" style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
                        Fecha Hasta
                      </label>
                      <input
                        id="report-date-to"
                        type="date"
                        value={fechaHasta}
                        onChange={(e) => setFechaHasta(e.target.value)}
                        style={{ width: '100%', padding: '0.4rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.82rem', boxSizing: 'border-box' }}
                      />
                    </div>
                  </div>

                  {/* Atajos Rápidos de Fecha */}
                  <div className="report-builder__date-shortcuts" style={{ display: 'flex', gap: '0.3rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
                    <button onClick={() => { setFechaDesde(getTodayStr()); setFechaHasta(getTodayStr()); }} style={{ padding: '2px 8px', fontSize: '0.7rem', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}>Hoy</button>
                    <button onClick={() => { setFechaDesde(getDaysAgoStr(7)); setFechaHasta(getTodayStr()); }} style={{ padding: '2px 8px', fontSize: '0.7rem', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}>7 Días</button>
                    <button onClick={() => { setFechaDesde(getMonthStartStr()); setFechaHasta(getTodayStr()); }} style={{ padding: '2px 8px', fontSize: '0.7rem', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}>Este Mes</button>
                    <button onClick={() => { setFechaDesde(getDaysAgoStr(30)); setFechaHasta(getTodayStr()); }} style={{ padding: '2px 8px', fontSize: '0.7rem', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}>30 Días</button>
                    <button onClick={() => { setFechaDesde(getDaysAgoStr(90)); setFechaHasta(getTodayStr()); }} style={{ padding: '2px 8px', fontSize: '0.7rem', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}>90 Días</button>
                    <button onClick={() => { setFechaDesde(getYearStartStr()); setFechaHasta(getTodayStr()); }} style={{ padding: '2px 8px', fontSize: '0.7rem', borderRadius: '4px', border: '1px solid #0088C9', background: '#E0F2FE', color: '#0369A1', cursor: 'pointer', fontWeight: 700 }}>📅 Todo el Año ({new Date().getFullYear()})</button>
                  </div>
                </div>
              ) : (
                <div className="report-builder__current-data">
                  <ReportBuilderIcon name="report" />
                  <div>
                    <strong>Información actual:</strong> Puedes consultar este tema sin elegir fechas.
                  </div>
                </div>
              )}

              {/* Filtros de Almacén, Estatus, Clasificación y Búsqueda */}
              <div className="report-builder__filters">
                {hasWhsField && <div>
                  <label htmlFor="report-warehouse" style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
                    Almacén
                  </label>
                  <select
                    id="report-warehouse"
                    value={almacen}
                    onChange={(e) => setAlmacen(e.target.value)}
                    style={{
                      width: '100%', padding: '0.45rem', borderRadius: '6px',
                      border: '1px solid #cbd5e1', fontSize: '0.82rem',
                      background: '#fff', color: '#1e293b', cursor: 'pointer'
                    }}
                  >
                        <option value="ALL">Todos los Almacenes</option>
                        <option value="FAR">Farmacia Central (FAR)</option>
                        <option value="QX">Quirófano General (QX)</option>
                        <option value="QXCR">Quirófano Carro Rojo (QXCR)</option>
                        <option value="QXRCR">Recuperación Carro Rojo (QXRCR)</option>
                        <option value="TERACR">Terapia Intensiva Carro Rojo (TERACR)</option>
                        <option value="PPBCR">Privados PB Carro Rojo (PPBCR)</option>
                        <option value="PPACR">Privados PA Carro Rojo (PPACR)</option>
                        <option value="IMAGCR">Imagen Carro Rojo (IMAGCR)</option>
                        <option value="CARDIOCR">Cardio Carro Rojo (CARDIOCR)</option>
                        <option value="CUNACR">Cunas Carro Rojo (CUNACR)</option>
                        <option value="QXCM">Quirófano Código Mater (QXCM)</option>
                        <option value="URG1CM">Urgencias 1 Código Mater (URG1CM)</option>
                        <option value="ALG">Almacén General (ALG)</option>
                  </select>
                </div>}

                {hasStatusField && <div>
                  <label htmlFor="report-status" style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
                    {currentEntityDef.statusLabel || 'Estado del registro'}
                  </label>
                  <select
                    id="report-status"
                    value={estatusDoc}
                    onChange={(e) => setEstatusDoc(e.target.value)}
                    style={{
                      width: '100%', padding: '0.45rem', borderRadius: '6px',
                      border: '1px solid #cbd5e1', fontSize: '0.82rem',
                      background: '#fff', color: '#1e293b', cursor: 'pointer'
                    }}
                  >
                    {(currentEntityDef.statusOptions || [{ value: 'ALL', label: 'Todos los estados' }, { value: 'OPEN', label: 'Abiertos / Pendientes / Activos' }, { value: 'CLOSED', label: 'Cerrados / Vencidos' }]).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  {currentEntityDef.statusDescription && <p className="report-builder__status-note">{currentEntityDef.statusDescription}</p>}
                </div>}

                {hasMedClassField && <div>
                  <label htmlFor="report-classification" style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
                    Clasificación Sanitaria
                  </label>
                  <select
                    id="report-classification"
                    value={clasificacionMedica}
                    onChange={(e) => setClasificacionMedica(e.target.value)}
                    style={{
                      width: '100%', padding: '0.45rem', borderRadius: '6px',
                      border: '1px solid #cbd5e1', fontSize: '0.82rem',
                      background: '#fff', color: '#1e293b', cursor: 'pointer'
                    }}
                  >
                        <option value="ALL">Todas las Clasificaciones</option>
                        <option value="CON">Controlados (Grupo I, II, III)</option>
                        <option value="ANTI">Antibióticos (Grupo IV)</option>
                        <option value="REFRI">Red Fría / Refrigerados</option>
                  </select>
                </div>}

                <div>
                  <label htmlFor="report-record-search" style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
                    Buscar en los registros
                  </label>
                  <input
                    id="report-record-search"
                    type="text"
                    placeholder="Código, nombre, médico, proveedor..."
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    style={{ width: '100%', padding: '0.45rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.82rem', boxSizing: 'border-box' }}
                  />
                </div>
              </div>
            </div>

            {/* Columna Derecha: Selector de Campos / Columnas */}
            <div>
              <div className="report-builder__field-heading">
                <span>
                  Columnas del reporte <span className="report-catalog__category-count">{selectedFields.length}</span>
                </span>
                <div className="report-builder__field-actions">
                  <button type="button" onClick={selectAllFields}>Todas</button>
                  <button type="button" onClick={selectDefaultFields}>Recomendadas</button>
                </div>
              </div>

              <div className="report-builder__fields">
                {currentEntityDef.fields.map(f => {
                  const isChecked = selectedFields.includes(f.key);
                  return (
                    <label
                      key={f.key}
                      className={`report-builder__field${isChecked ? ' is-checked' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleField(f.key)}
                      />
                      <span>{f.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ── Mensajes de Alerta / Error ── */}
      {error && (
        <div role="alert" style={{
          background: '#FEE2E2', border: '1px solid #F87171', color: '#991B1B',
          padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem', fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: '0.5rem'
        }}>
          <span>⚠️</span>
          <div>{userMessage(error)}</div>
        </div>
      )}

      {/* ── Panel de Resultados ── */}
      {queryResult && (
        <div ref={resultsRef} tabIndex={-1} aria-label="Reporte generado" style={{ background: '#fff', borderRadius: '12px', border: '1px solid #E2E8F0', overflow: 'hidden', boxShadow: '0 4px 8px -2px rgba(0,0,0,0.05)', scrollMarginTop: '100px' }}>
          
          {/* Barra de Acciones del Resultado */}
          <div style={{
            padding: '1rem 1.25rem',
            background: '#F8FAFC',
            borderBottom: '1px solid #E2E8F0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.75rem'
          }}>
            <div>
              <div style={{ fontWeight: 800, color: '#004687', fontSize: '1.05rem' }}>
                {queryResult.entityTitle} ({filteredRows.length.toLocaleString('es-MX')} {analyzedResult && queryResult.analysis.groupBy?.length ? filteredRows.length === 1 ? 'grupo' : 'grupos' : filteredRows.length === 1 ? 'registro' : 'registros'}{filteredRows.length !== rows.length ? ` ${analyzedResult ? 'visibles' : filteredRows.length === 1 ? 'filtrado' : 'filtrados'} de ${rows.length.toLocaleString('es-MX')}` : ''})
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748B' }}>
                Información de {entitySource(currentEntityDef)} · {columns.length} columnas visibles
                {resultPointLookupLabel ? <> · {resultPointLookupLabel}</> : currentEntityDef?.requiresDateFilter && (resultDates.fechaDesde || resultDates.fechaHasta) && <> · {formatReportDate(resultDates.fechaDesde)} al {formatReportDate(resultDates.fechaHasta)}</>}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              {hasActiveFilters && (
                <button
                  onClick={handleClearFilters}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                    padding: '0.55rem 1rem', background: '#FEE2E2', border: '1px solid #FCA5A5',
                    borderRadius: 8, color: '#B91C1C', fontWeight: 700, fontSize: '0.82rem',
                    cursor: 'pointer', transition: 'all 0.15s ease'
                  }}
                  title="Restablecer todos los filtros aplicados"
                >
                  🧹 {analyzedResult ? 'Limpiar filtros de vista' : 'Limpiar Filtros'}
                </button>
              )}
              <button
                onClick={exportExcel}
                disabled={filteredRows.length === 0 || exportBlocked}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.45rem',
                  padding: '0.55rem 1.2rem', background: '#00974A', border: 'none',
                  borderRadius: 8, color: '#fff', fontWeight: 700, fontSize: '0.82rem',
                  cursor: filteredRows.length === 0 || exportBlocked ? 'not-allowed' : 'pointer',
                  boxShadow: '0 4px 10px rgba(0,151,74,0.3)',
                  transition: 'all 0.15s ease'
                }}
              >
                📥 Descargar Excel Oficial
              </button>
            </div>
          </div>

          {queryResult.truncated && <div className="report-builder__limit" role="status">{limitMessage}</div>}
          <div style={{ padding: '0 1.25rem' }}><ReportAnalysisSummary analysis={queryResult.analysis} summary={queryResult.analysisSummary} entity={currentEntityDef} scope={queryResult.analysisScope} grain={queryResult.grain} label="Análisis ejecutado" /></div>
          {executionFailed && <div className="report-builder__limit" role="status">La nueva consulta no terminó. Actualiza el reporte antes de descargarlo.</div>}
          {needsSourceRefresh && <div className="report-builder__limit" role="status">
            Cambiaste datos o filtros que requieren una nueva consulta. Actualiza el reporte para verlos y descargarlo.
            {' '}<button type="button" disabled={loading} onClick={() => handleExecute()}>Consultar los nuevos datos</button>
          </div>}

          {/* Tarjetas de Métricas KPI Dinámicas */}
          {queryResult.kpis && queryResult.kpis.length > 0 && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(auto-fit, minmax(180px, 1fr))`,
              gap: '0.75rem',
              padding: '1rem 1.25rem',
              background: '#F1F5F9',
              borderBottom: '1px solid #E2E8F0'
            }} aria-label={analyzedResult ? 'Totales del reporte completo' : 'Indicadores del reporte'}>
              {queryResult.kpis.map((kpi, idx) => (
                <div
                  key={idx}
                  style={{
                    background: '#fff',
                    borderRadius: '8px',
                    padding: '0.75rem 1rem',
                    border: '1px solid #E2E8F0',
                    borderLeft: `4px solid ${kpi.color || '#004687'}`,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
                  }}
                >
                  <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', marginBottom: '2px' }}>
                    {kpi.label}
                  </div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: kpi.color || '#004687' }}>
                    {kpi.value}
                  </div>
                </div>
              ))}
            </div>
          )}
          
          {/* Scrollbar Superior Sincronizada */}
          <div
            ref={topScrollRef}
            onScroll={() => {
              if (topScrollRef.current && tableScrollRef.current) {
                tableScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
              }
            }}
            style={{ overflowX: 'auto', overflowY: 'hidden', height: '14px', background: '#F1F5F9' }}
          >
            <div style={{ width: `${tableScrollWidth}px`, height: '14px' }}></div>
          </div>

          {loading ? (
            <div style={{ padding: '4rem 2rem', textAlign: 'center' }}>
              <PremiumLoader text="Cargando información…" />
            </div>
          ) : rows.length === 0 ? (
            <div style={{ padding: '4rem 2rem', textAlign: 'center', color: '#64748B' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📭</div>
              <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>No se encontraron registros en {entitySource(currentEntityDef)} con estos filtros</div>
              <p style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>Prueba ampliando el rango de fechas o cambiando los filtros.</p>
            </div>
          ) : (
            <div
              ref={tableScrollRef}
              onScroll={() => {
                if (topScrollRef.current && tableScrollRef.current) {
                  topScrollRef.current.scrollLeft = tableScrollRef.current.scrollLeft;
                }
              }}
              style={{ overflowX: 'auto' }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr>
                    {columns.map(col => (
                      <ColumnFilter
                        key={col.key}
                        columnKey={col.key}
                        data={rows}
                        colFilters={colFilters}
                        setColFilters={setColFilters}
                        label={col.label}
                        align={col.align || 'left'}
                        maxWidth={`${col.width || 120}px`}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paginatedRows.map((row, i) => (
                    <tr
                      key={i}
                      style={{
                        background: i % 2 === 0 ? '#FFFFFF' : '#F8FAFC',
                        borderBottom: '1px solid #E2E8F0',
                        transition: 'background 0.1s ease'
                      }}
                    >
                      {columns.map(col => {
                        const val = row[col.key];
                        let formattedVal = val;
                        let cellStyle = { padding: '8px 10px', textAlign: col.align || 'left', color: '#1E293B' };

                        if (val == null || typeof val === 'string' && !val.trim()) {
                          formattedVal = '-';
                          cellStyle.color = '#94A3B8';
                        } else if (typeof val === 'boolean') {
                          formattedVal = val ? 'Sí' : 'No';
                        } else if (col.type === 'date' || col.type === 'datetime') {
                          formattedVal = formatReportDate(val, col.type === 'datetime');
                        } else if (col.type === 'money') {
                          formattedVal = formatReportNumeric(val, col.type);
                          if (reportNumber(val) !== null) {
                            cellStyle.fontWeight = 700;
                            cellStyle.color = '#15803D';
                          }
                        } else if (col.type === 'percent') {
                          formattedVal = formatReportNumeric(val, col.type);
                          if (reportNumber(val) !== null) cellStyle.fontWeight = 600;
                        } else if (col.type === 'number') {
                          formattedVal = formatReportNumeric(val, col.type);
                          if (reportNumber(val) !== null) cellStyle.fontWeight = 700;
                        } else if (col.type === 'status') {
                          const sStr = String(val);
                          const isVencido = sStr.includes('Vencido') || sStr === 'Inactivo';
                          const isProx = sStr.includes('Próximo');
                          const isAbierta = sStr.includes('Abierta') || sStr.includes('Abierto') || sStr === 'O';
                          const isCerrada = sStr.includes('Cerrada') || sStr.includes('Cerrado') || sStr === 'C';
                          
                          let bg = '#DCFCE7';
                          let color = '#15803D';

                          if (isVencido) {
                            bg = '#FEE2E2';
                            color = '#DC2626';
                          } else if (isProx) {
                            bg = '#FEF3C7';
                            color = '#B45309';
                          } else if (isAbierta) {
                            bg = '#EFF6FF';
                            color = '#0284C7';
                          } else if (isCerrada) {
                            bg = '#F1F5F9';
                            color = '#64748B';
                          }

                          formattedVal = (
                            <span style={{
                              padding: '2px 8px', borderRadius: '10px', fontSize: '0.7rem', fontWeight: 800,
                              background: bg,
                              color: color
                            }}>
                              {val}
                            </span>
                          );
                        }

                        return (
                          <td key={col.key} style={cellStyle}>
                            {formattedVal}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Paginador */}
          {!loading && filteredRows.length > PER_PAGE && (
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '1rem', background: '#F8FAFC', borderTop: '1px solid #E2E8F0', fontSize: '0.85rem'
            }}>
              <div style={{ color: '#64748B' }}>
                Mostrando {((page - 1) * PER_PAGE) + 1} a {Math.min(page * PER_PAGE, filteredRows.length)} de {filteredRows.length} {analyzedResult && queryResult.analysis.groupBy?.length ? 'grupos' : 'registros'}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  style={{ padding: '0.35rem 0.75rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: page === 1 ? '#e2e8f0' : '#fff', cursor: page === 1 ? 'not-allowed' : 'pointer' }}
                >
                  Anterior
                </button>
                <span style={{ padding: '0.35rem 0.75rem', fontWeight: 700, color: '#004687' }}>
                  Página {page} de {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  style={{ padding: '0.35rem 0.75rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: page === totalPages ? '#e2e8f0' : '#fff', cursor: page === totalPages ? 'not-allowed' : 'pointer' }}
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}

        </div>
      )}

      {showSavedModal && <ReportModal title="Mis reportes" onClose={() => setShowSavedModal(false)}>
        <p style={{ marginTop: 0, fontSize: '.83rem', color: 'var(--report-muted)' }}>Aquí encontrarás tus reportes guardados y los que te hayan asignado.</p>
        {savedLoading ? <p role="status">Cargando tus reportes…</p> : savedError ? <div role="alert"><p>{savedError}</p><button type="button" className="report-catalog__chip" onClick={loadSavedQueries}>Reintentar mis reportes</button></div> : !savedQueries.length ? <p>No tienes reportes guardados o asignados. Crea un reporte y selecciona «Guardar reporte».</p> : <div style={{ display: 'grid', gap: '.85rem' }}>{savedQueries.map(sq => <article key={sq.id} aria-label={`Reporte: ${sq.title}`} style={{ padding: '1rem', border: '1px solid var(--report-border)', borderRadius: 10, background: 'var(--report-soft)', minWidth: 0 }}>
          <button type="button" onClick={() => handleLoadSavedQuery(sq)} style={{ padding: 0, border: 0, background: 'transparent', color: 'var(--report-blue)', font: 'inherit', fontWeight: 750, textAlign: 'left', cursor: 'pointer' }}>{sq.title}</button>
          {sq.isAssigned && !sq.isOwner && <span style={{ display: 'inline-block', marginLeft: 8, padding: '3px 7px', borderRadius: 6, fontSize: '.7rem', background: 'var(--report-selected)' }}>Asignado a ti</span>}
          {sq.description && <p style={{ margin: '.4rem 0', fontSize: '.8rem' }}>{sq.description}</p>}
          <p style={{ margin: '.5rem 0', fontSize: '.73rem', color: 'var(--report-muted)' }}>Sección: {sq.definition?.title || assistantCatalog.find(section => section.id === sq.entity)?.title || 'Reporte guardado'}</p>
          <p style={{ margin: '.4rem 0', fontSize: '.73rem', color: 'var(--report-muted)' }}>Creado por {sq.username}{sq.createdAt ? ` · ${formatReportDate(sq.createdAt)}` : ''}</p>
          {sq.canAssign && <p style={{ fontSize: '.75rem', color: 'var(--report-muted)' }}>{sq.assignedUsers?.some(person => person.activo !== false) ? `Disponible para: ${sq.assignedUsers.filter(person => person.activo !== false).map(person => person.nombre || person.username).join(', ')}` : 'Sin personas activas asignadas.'}{sq.assignedUsers?.some(person => person.activo === false) && <span style={{ display: 'block', marginTop: '.3rem' }}>Usuarios inactivos: {sq.assignedUsers.filter(person => person.activo === false).map(person => person.nombre || person.username).join(', ')}</span>}</p>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', marginTop: '.75rem' }}>
            {sq.definition && <button type="button" className="report-builder__button report-builder__button--primary" onClick={() => handleOpenSavedReport(sq)}>Ver reporte</button>}
            {!(sq.isAssigned && !sq.isOwner) && userAllowedAssistantCatalog.some(entity => entity.id === sq.entity) && <button type="button" className="report-builder__button" onClick={() => handleLoadSavedQuery(sq)}>Ajustar una copia</button>}
            {sq.canAssign && <button type="button" className="report-builder__button" onClick={() => openAssignments(sq)}>Administrar accesos</button>}
            {sq.canDelete && <button type="button" className="report-builder__button" onClick={event => handleDeleteSavedQuery(sq.id, event)}>Eliminar reporte</button>}
          </div>
        </article>)}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}><button type="button" className="report-builder__button" onClick={() => setShowSavedModal(false)}>Cerrar</button></div>
      </ReportModal>}

      {showSaveFormModal && <ReportModal title="Guardar reporte" width={620} busy={savingQuery} onClose={() => setShowSaveFormModal(false)}>
        <form onSubmit={handleSaveQuery}>
          <label style={{ display: 'grid', gap: 6, marginBottom: '1rem', fontSize: '.82rem', fontWeight: 700 }}>Nombre del reporte *<input type="text" required autoFocus maxLength={200} placeholder="Ej. Condiciones de convenios" value={saveTitle} onChange={event => setSaveTitle(event.target.value)} style={{ width: '100%', padding: '.65rem', borderRadius: 7, border: '1px solid var(--report-border)', background: 'var(--report-soft)', color: 'var(--report-text)', font: 'inherit' }} /></label>
          <label style={{ display: 'grid', gap: 6, marginBottom: '1rem', fontSize: '.82rem', fontWeight: 700 }}>Descripción (opcional)<textarea rows={2} maxLength={1000} placeholder="Para qué sirve este reporte" value={saveDescription} onChange={event => setSaveDescription(event.target.value)} style={{ width: '100%', padding: '.65rem', borderRadius: 7, border: '1px solid var(--report-border)', background: 'var(--report-soft)', color: 'var(--report-text)', font: 'inherit' }} /></label>
          <p style={{ padding: '.8rem', background: 'var(--report-soft)', borderRadius: 8, fontSize: '.78rem', color: 'var(--report-muted)' }}>Se guardan las columnas y los filtros actuales. El reporte estará disponible para ti y para Sistemas{canChooseRecipients ? ', además de las personas que elijas.' : '.'}</p>
          {canChooseRecipients && <RecipientPicker users={recipientUsers} loading={recipientsLoading} error={recipientsError} search={recipientSearch} onSearch={setRecipientSearch} selectedIds={saveUserIds} onChange={setSaveUserIds} onRetry={loadRecipients} />}
          {savedNotice && <p role="alert">{savedNotice}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: '.65rem' }}><button type="button" className="report-builder__button" disabled={savingQuery} onClick={() => setShowSaveFormModal(false)}>Cancelar</button><button type="submit" className="report-builder__button report-builder__button--primary" disabled={savingQuery}>{savingQuery ? 'Guardando…' : 'Guardar reporte'}</button></div>
        </form>
      </ReportModal>}

      {assignmentTarget && <ReportModal title="Administrar accesos" width={620} busy={assigningReport} onClose={() => setAssignmentTarget(null)}>
        <strong>{assignmentTarget.title}</strong>
        {assignmentTarget.assignedUsers?.some(person => person.activo === false) && <p role="status" style={{ padding: '.8rem', background: 'var(--report-soft)', borderRadius: 8, fontSize: '.78rem' }}>Al guardar se retirarán las asignaciones de estas personas inactivas: {assignmentTarget.assignedUsers.filter(person => person.activo === false).map(person => person.nombre || person.username).join(', ')}.</p>}
        <RecipientPicker users={recipientUsers} loading={recipientsLoading} error={recipientsError} search={recipientSearch} onSearch={setRecipientSearch} selectedIds={assignmentUserIds} onChange={setAssignmentUserIds} onRetry={loadRecipients} />
        <p style={{ color: 'var(--report-muted)', fontSize: '.78rem' }}>Al quitar una persona, dejará de ver este reporte en «Mis reportes». Sus otros accesos permanecen igual.</p>
        {assignmentError && <p role="alert">{assignmentError}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: '.65rem' }}><button type="button" className="report-builder__button" disabled={assigningReport} onClick={() => setAssignmentTarget(null)}>Cancelar</button><button type="button" className="report-builder__button report-builder__button--primary" disabled={assigningReport || recipientsLoading || Boolean(recipientsError)} onClick={handleSaveAssignments}>{assigningReport ? 'Guardando…' : 'Guardar accesos'}</button></div>
      </ReportModal>}
    </div>
  );
}
