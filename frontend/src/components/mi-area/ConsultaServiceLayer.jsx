import { userMessage } from '../../utils/userMessages';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import PremiumLoader from '../shared/PremiumLoader';
import { API_BASE } from '../../api/config';
import { authHeaders } from '../../api/auth';
import { useAuth } from '../../context/AuthContext';
import { hasSapModulePermission } from '../../utils/rbac';
import ReportBuilderIcon, { reportTopicIcon } from './ReportBuilderIcon';
import ReportAssistant from './ReportAssistant';
import './ConsultaServiceLayer.css';

const normalizeSearch = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const entitySource = entity => entity?.source === 'Vertical' ? 'Vertical' : 'SAP';
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
      whiteSpace: 'nowrap'
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '4px' }}>
          <span style={{ fontSize: '0.68rem', textTransform: 'uppercase', color: 'rgba(255,255,255,0.9)', letterSpacing: '0.04em', fontWeight: '700' }}>
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
  const configurationRef = useRef(null);
  const resultsRef = useRef(null);
  const [reportMode, setReportMode] = useState('assistant');
  const [tableScrollWidth, setTableScrollWidth] = useState(1600);

  const [catalog, setCatalog] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(null);
  const [catalogRefresh, setCatalogRefresh] = useState(0);
  const [selectedEntityId, setSelectedEntityId] = useState('');
  const [selectedFields, setSelectedFields] = useState([]);
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

  // Plantillas guardadas
  const [savedQueries, setSavedQueries] = useState([]);
  const [showSavedModal, setShowSavedModal] = useState(false);
  const [showSaveFormModal, setShowSaveFormModal] = useState(false);
  const [saveTitle, setSaveTitle] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  const [saveIsPublic, setSaveIsPublic] = useState(false);
  const [savingQuery, setSavingQuery] = useState(false);

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
        if (!controller.signal.aborted) setCatalog(json.catalog);
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
    loadSavedQueries();
  }, []);

  const userAllowedCatalog = useMemo(() => {
    return catalog.filter(c => hasSapModulePermission(user, c.id));
  }, [catalog, user]);

  const currentEntityDef = useMemo(() => {
    return userAllowedCatalog.find(c => c.id === selectedEntityId) || null;
  }, [userAllowedCatalog, selectedEntityId]);

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
    if (userAllowedCatalog.length > 0 && !userAllowedCatalog.some(c => c.id === selectedEntityId)) {
      if (manualTopicRequired && !selectedEntityId) return;
      handleSelectEntity((userAllowedCatalog.find(c => c.id === 'inventory') || userAllowedCatalog[0]).id);
    } else if (userAllowedCatalog.length === 0 && selectedEntityId) {
      queryRequestRef.current += 1;
      setSelectedEntityId('');
      setSelectedFields([]);
      setQueryResult(null);
      setLoading(false);
    }
  }, [userAllowedCatalog, selectedEntityId, manualTopicRequired]);

  // Al cambiar de entidad, preseleccionar sus campos default y limpiar filtros no aplicables
  const handleSelectEntity = (entId) => {
    const def = userAllowedCatalog.find(c => c.id === entId);
    if (!def) return;
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
    try {
      const res = await fetch(`${API_BASE}/sap-query/saved`, { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        if (json.ok) setSavedQueries(json.queries || []);
      }
    } catch (err) {
      console.warn('[SAP Query Builder] Error al cargar consultas guardadas:', err);
    }
  };

  // Ejecutar consulta dinámica
  const handleExecute = async (configuration) => {
    const definition = configuration ? userAllowedCatalog.find(entity => entity.id === configuration.entity) : currentEntityDef;
    if (!definition) return;
    const fields = configuration?.selectedFields || selectedFields;
    const filters = configuration?.filters || { fechaDesde, fechaHasta, busqueda, almacen, estatusDoc, clasificacionMedica };

    if (!Array.isArray(fields) || !fields.length || fields.some(key => !definition.fields.some(field => field.key === key))) {
      setError('Las columnas disponibles cambiaron. Elige de nuevo los datos que quieres incluir.');
      return;
    }

    if (definition.requiresDateFilter) {
      if (!filters.fechaDesde || !filters.fechaHasta) {
        setError(`Elige las fechas de inicio y fin para consultar ${definition.title}.`);
        return;
      }
      if (filters.fechaDesde > filters.fechaHasta) {
        setError('La fecha de inicio debe ser anterior o igual a la fecha de fin.');
        return;
      }
    }

    const requestId = ++queryRequestRef.current;
    const requestedFilters = { fechaDesde: filters.fechaDesde || '', fechaHasta: filters.fechaHasta || '', busqueda: filters.busqueda || '', almacen: supportsFilter(definition, 'almacen') ? filters.almacen || 'ALL' : 'ALL', estatusDoc: supportsFilter(definition, 'estatusDoc') ? filters.estatusDoc || 'ALL' : 'ALL', clasificacionMedica: supportsFilter(definition, 'clasificacionMedica') ? filters.clasificacionMedica || 'ALL' : 'ALL' };
    setLoading(true);
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
          ...requestedFilters
        })
      });

      const json = await res.json();
      if (requestId !== queryRequestRef.current) return;
      if (!res.ok || !json.ok) {
        throw new Error(userMessage(json.error || 'No se pudo consultar la información. Intenta de nuevo.'));
      }

      setQueryResult({ ...json, requestedFilters });
      return { total: json.data?.length || 0, truncated: Boolean(json.truncated) };
    } catch (err) {
      if (requestId !== queryRequestRef.current) return;
      console.error('[SAP Query Execution Error]', err);
      setError(userMessage(err.message));
      if (configuration) throw err;
    } finally {
      if (requestId === queryRequestRef.current) setLoading(false);
    }
  };

  const handleAssistantGenerate = async (plan) => {
    const definition = userAllowedCatalog.find(entity => entity.id === plan.entity);
    if (!definition || plan.selectedFields.some(key => !definition.fields.some(field => field.key === key))) throw new Error('Ese tema o alguna columna ya no está disponible. Intenta con otro reporte.');
    handleSelectEntity(plan.entity);
    setSelectedFields(plan.selectedFields);
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
    const definition = draft && userAllowedCatalog.find(entity => entity.id === draft.entity);
    const filters = draft?.filters && typeof draft.filters === 'object' && !Array.isArray(draft.filters) ? draft.filters : {};
    const choices = {
      almacen: supportsFilter(definition, 'almacen') ? ['ALL', 'FAR', 'QX', 'QXCR', 'QXRCR', 'TERACR', 'PPBCR', 'PPACR', 'IMAGCR', 'CARDIOCR', 'CUNACR', 'QXCM', 'URG1CM', 'ALG'] : ['ALL'],
      estatusDoc: supportsFilter(definition, 'estatusDoc') ? definition.statusOptions?.map(option => option.value) || ['ALL', 'OPEN', 'CLOSED'] : ['ALL'],
      clasificacionMedica: supportsFilter(definition, 'clasificacionMedica') ? ['ALL', 'CON', 'ANTI', 'REFRI'] : ['ALL'],
    };
    const valid = definition && Array.isArray(draft.selectedFields) && draft.selectedFields.length > 0
      && draft.selectedFields.every(key => definition.fields.some(field => field.key === key))
      && (draft.filters == null || typeof draft.filters === 'object' && !Array.isArray(draft.filters))
      && Object.keys(filters).every(key => ['fechaDesde', 'fechaHasta', 'busqueda', 'almacen', 'estatusDoc', 'clasificacionMedica'].includes(key))
      && validDraftDate(filters.fechaDesde) && validDraftDate(filters.fechaHasta)
      && (!filters.fechaDesde || !filters.fechaHasta || filters.fechaDesde <= filters.fechaHasta)
      && Object.entries(choices).every(([key, values]) => values.includes(filters[key] || 'ALL'))
      && (filters.busqueda == null || typeof filters.busqueda === 'string' && filters.busqueda.length <= 200);
    if (!valid) {
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
          filters: { fechaDesde, fechaHasta, almacen: hasWhsField ? almacen : 'ALL', estatusDoc: hasStatusField ? estatusDoc : 'ALL', clasificacionMedica: hasMedClassField ? clasificacionMedica : 'ALL', busqueda },
          isPublic: saveIsPublic
        })
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(userMessage(json.error || 'No se pudo guardar la consulta'));

      setShowSaveFormModal(false);
      setSaveTitle('');
      setSaveDescription('');
      loadSavedQueries();
      alert('✅ Plantilla de consulta guardada con éxito.');
    } catch (err) {
      alert(userMessage('❌ Error al guardar: ' + err.message));
    } finally {
      setSavingQuery(false);
    }
  };

  // Cargar una plantilla guardada
  const handleLoadSavedQuery = (sq) => {
    const entity = userAllowedCatalog.find(def => def.id === sq.entity);
    if (!entity) {
      setError('Este módulo no está disponible para tu usuario. Solicita acceso al área de Sistemas.');
      setShowSavedModal(false);
      return;
    }
    handleSelectEntity(sq.entity);
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
    if (!confirm('¿Estás seguro de eliminar esta plantilla de consulta?')) return;

    try {
      const res = await fetch(`${API_BASE}/sap-query/saved/${sqId}`, {
        method: 'DELETE',
        headers: authHeaders()
      });
      if (res.ok) {
        loadSavedQueries();
      } else {
        const json = await res.json();
        alert(userMessage('Error: ' + json.error));
      }
    } catch (err) {
      alert(userMessage('Error al eliminar: ' + err.message));
    }
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

  // Columnas dinámicas activas según los checkboxes seleccionados por el usuario
  const columns = useMemo(() => {
    if (!currentEntityDef) return queryResult?.columnas || [];
    const activeKeys = (selectedFields && selectedFields.length > 0)
      ? selectedFields
      : (queryResult?.columnas ? queryResult.columnas.map(c => c.key) : currentEntityDef.fields.map(f => f.key));
    
    // Obtener las definiciones completas de las columnas seleccionadas
    const activeDefs = [...new Set(activeKeys)].map(key => currentEntityDef.fields.find(field => field.key === key)).filter(Boolean);
    return activeDefs.length > 0 ? activeDefs : (queryResult?.columnas || currentEntityDef.fields);
  }, [currentEntityDef, selectedFields, queryResult]);

  // Filtrado reactivo en tiempo real (Búsqueda general, almacén, estatus, clasificación sanitaria y filtros de columna)
  const filteredRows = useMemo(() => {
    const rawList = queryResult?.data || [];
    if (!rawList || rawList.length === 0) return [];

    return rawList.filter(row => {
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

  const hasActiveFilters = Boolean(
    busqueda || (hasWhsField && almacen && almacen !== 'ALL') || (hasStatusField && estatusDoc && estatusDoc !== 'ALL') ||
    (hasMedClassField && clasificacionMedica && clasificacionMedica !== 'ALL') || Object.values(colFilters).some(Boolean)
  );

  const handleClearFilters = () => {
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
    if (filteredRows.length === 0 || columns.length === 0) return;

    const fmt = (val, col) => {
      if (val == null || val === '') return '';
      if (typeof val === 'boolean') return val ? 'Sí' : 'No';
      if (col.type === 'date') return formatReportDate(val);
      if (col.type === 'datetime') return formatReportDate(val, true);
      if (col.type === 'money') return `$${Number(val).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      if (col.type === 'percent') return `${Number(val).toFixed(1)}%`;
      return String(val).replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
  <tr class="info-row"><td colspan="${columns.length}">Generado por: ${user?.nombre || user?.username} &nbsp;|&nbsp; ${currentEntityDef?.requiresDateFilter ? `${currentEntityDef.dateFieldLabel || 'Período'}: ${reportDates.fechaDesde} al ${reportDates.fechaHasta} &nbsp;|&nbsp; ` : ''}Registros: ${filteredRows.length} &nbsp;|&nbsp; Fecha: ${fechaReporte}</td></tr>
  ${currentEntityDef?.grain ? `<tr class="info-row"><td colspan="${columns.length}">Cada fila representa: ${fmt(currentEntityDef.grain, {})}</td></tr>` : ''}
  ${queryResult?.truncated ? `<tr class="info-row"><td colspan="${columns.length}">${fmt(queryResult.message || `Se alcanzó el límite de ${queryResult.limit || rows.length} registros. Reduce el período o los filtros para revisar el resto.`, {})}</td></tr>` : ''}
  <tr><td colspan="${columns.length}" style="height:6px;border:none"></td></tr>
  <tr>${columns.map(c => `<th style="width:${c.width || 120}px">${c.label}</th>`).join('')}</tr>
  ${filteredRows.map((row, i) => `<tr class="${i%2===0?'even':'odd'}">${columns.map(c => {
    let cls = '';
    let val = fmt(row[c.key], c);
    if (c.type === 'money') cls = ' class="money"';
    return `<td${cls} style="text-align:${c.align || 'left'}">${val}</td>`;
  }).join('')}</tr>`).join('')}
  <tr class="total-row">
    <td colspan="${columns.length}">Total Registros: ${filteredRows.length.toLocaleString('es-MX')}</td>
  </tr>
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

  return (
    <div className="report-builder">
      
      {/* ── Encabezado Principal ── */}
      <header className="report-builder__header">
        <div className="report-builder__intro">
          <span className="report-builder__hero-icon"><ReportBuilderIcon /></span>
          <div>
            <p className="report-builder__eyebrow">Hospital Escandón · Reportes</p>
            <h1>Crear reporte personalizado</h1>
            <p className="report-builder__subtitle">{reportMode === 'assistant' ? 'Describe lo que necesitas y crea tu reporte con ayuda del asistente.' : 'Elige un tema, ajusta los filtros y descarga la información que necesitas.'}</p>
          </div>
        </div>

        <div className="report-builder__header-actions">
          <button
            type="button"
            onClick={() => setShowSavedModal(true)}
            className="report-builder__button report-builder__button--secondary"
          >
            <ReportBuilderIcon name="folder" /> Mis plantillas guardadas <span className="report-builder__button-count">{savedQueries.length}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowSaveFormModal(true)}
            disabled={!currentEntityDef || catalogLoading || (reportMode === 'assistant' && !queryResult)}
            className="report-builder__button report-builder__button--primary"
          >
            <ReportBuilderIcon name="save" /> Guardar consulta
          </button>
        </div>
      </header>

      <div className="report-builder__modes" role="group" aria-label="Cómo crear tu reporte">
        <button type="button" className={`report-builder__mode${reportMode === 'assistant' ? ' is-active' : ''}`} aria-pressed={reportMode === 'assistant'} onClick={() => setReportMode('assistant')}><ReportBuilderIcon name="chat" /> Crear con asistente</button>
        <button type="button" className={`report-builder__mode${reportMode === 'manual' ? ' is-active' : ''}`} aria-pressed={reportMode === 'manual'} onClick={() => setReportMode('manual')}><ReportBuilderIcon name="grid" /> Elegir un tema</button>
      </div>

      <div hidden={reportMode !== 'assistant'}>
        <ReportAssistant catalog={userAllowedCatalog} catalogLoading={catalogLoading} catalogError={catalogError} onGenerate={handleAssistantGenerate} onViewReport={showResults} onManual={handleAssistantManual} onReset={resetAssistantReport} />
      </div>

      {/* ── Selector de módulos y temas de SAP / Vertical ── */}
      <section hidden={reportMode !== 'manual'} className="report-catalog" aria-label="Módulos y temas disponibles" aria-busy={catalogLoading}>
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
                <p>Elige los filtros y las columnas que quieres incluir.</p>
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

          {currentEntityDef.grain && <div className="report-builder__grain"><strong>Cada fila representa:</strong> {currentEntityDef.grain}</div>}

          <div className="report-builder__configuration">
            
            {/* Columna Izquierda: Rango de Fechas y Filtros Rápidos */}
            <div>
              <div className="report-builder__field-heading">
                Filtros de búsqueda {currentEntityDef.requiresDateFilter && <span className="report-builder__required-dates">Elige un período</span>}
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
                {queryResult.entityTitle} ({filteredRows.length.toLocaleString('es-MX')} {filteredRows.length === 1 ? 'registro' : 'registros'}{filteredRows.length !== rows.length ? ` ${filteredRows.length === 1 ? 'filtrado' : 'filtrados'} de ${rows.length.toLocaleString('es-MX')}` : ''})
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748B' }}>
                Información de {entitySource(currentEntityDef)} · {columns.length} columnas visibles
                {currentEntityDef?.requiresDateFilter && queryResult.requestedFilters && <> · {formatReportDate(queryResult.requestedFilters.fechaDesde)} al {formatReportDate(queryResult.requestedFilters.fechaHasta)}</>}
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
                  🧹 Limpiar Filtros
                </button>
              )}
              <button
                onClick={exportExcel}
                disabled={filteredRows.length === 0}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.45rem',
                  padding: '0.55rem 1.2rem', background: '#00974A', border: 'none',
                  borderRadius: 8, color: '#fff', fontWeight: 700, fontSize: '0.82rem',
                  cursor: filteredRows.length === 0 ? 'not-allowed' : 'pointer',
                  boxShadow: '0 4px 10px rgba(0,151,74,0.3)',
                  transition: 'all 0.15s ease'
                }}
              >
                📥 Descargar Excel Oficial
              </button>
            </div>
          </div>

          {queryResult.truncated && <div className="report-builder__limit" role="status">{queryResult.message || `Se alcanzó el límite de ${Number(queryResult.limit || rows.length).toLocaleString('es-MX')} registros. Reduce el período o los filtros para revisar el resto.`}</div>}

          {/* Tarjetas de Métricas KPI Dinámicas */}
          {queryResult.kpis && queryResult.kpis.length > 0 && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(auto-fit, minmax(180px, 1fr))`,
              gap: '0.75rem',
              padding: '1rem 1.25rem',
              background: '#F1F5F9',
              borderBottom: '1px solid #E2E8F0'
            }}>
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

                        if (val == null || val === '') {
                          formattedVal = '-';
                          cellStyle.color = '#94A3B8';
                        } else if (typeof val === 'boolean') {
                          formattedVal = val ? 'Sí' : 'No';
                        } else if (col.type === 'date' || col.type === 'datetime') {
                          formattedVal = formatReportDate(val, col.type === 'datetime');
                        } else if (col.type === 'money') {
                          formattedVal = `$${Number(val).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                          cellStyle.fontWeight = 700;
                          cellStyle.color = '#15803D';
                        } else if (col.type === 'percent') {
                          formattedVal = `${Number(val).toFixed(1)}%`;
                          cellStyle.fontWeight = 600;
                        } else if (col.type === 'number') {
                          formattedVal = Number(val).toLocaleString('es-MX');
                          cellStyle.fontWeight = 700;
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
                Mostrando {((page - 1) * PER_PAGE) + 1} a {Math.min(page * PER_PAGE, filteredRows.length)} de {filteredRows.length} registros
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

      {/* ── Modal: Mis Consultas Guardadas ── */}
      {showSavedModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem'
        }}>
          <div style={{
            background: '#fff', borderRadius: '16px', maxWidth: '650px', width: '100%',
            maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)'
          }}>
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 800, fontSize: '1.15rem', color: '#004687' }}>
                📂 Plantillas de Consulta Guardadas
              </div>
              <button onClick={() => setShowSavedModal(false)} style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: '#64748B' }}>✕</button>
            </div>

            <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
              {savedQueries.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#64748B', padding: '2rem' }}>
                  No tienes consultas guardadas aún. Configura tus filtros y haz clic en "Guardar Consulta".
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {savedQueries.map(sq => (
                    <div
                      key={sq.id}
                      onClick={() => handleLoadSavedQuery(sq)}
                      style={{
                        padding: '1rem', border: '1px solid #E2E8F0', borderRadius: '10px',
                        background: '#F8FAFC', cursor: 'pointer', transition: 'all 0.15s ease',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#004687' }}>
                          {sq.title}
                        </div>
                        {sq.description && (
                          <div style={{ fontSize: '0.75rem', color: '#64748B', marginTop: '2px' }}>{sq.description}</div>
                        )}
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '6px' }}>
                          <span style={{ fontSize: '0.68rem', background: '#E0F2FE', color: '#0369A1', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>
                            Sección: {catalog.find(section => section.id === sq.entity)?.title || 'Consulta guardada'}
                          </span>
                          <span style={{ fontSize: '0.68rem', color: '#94A3B8' }}>
                            Por: {sq.username} | {new Date(sq.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <button
                          onClick={(e) => handleDeleteSavedQuery(sq.id, e)}
                          title="Eliminar plantilla"
                          style={{ background: '#FEE2E2', border: 'none', color: '#DC2626', borderRadius: '6px', padding: '6px 10px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700 }}
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid #E2E8F0', textAlign: 'right' }}>
              <button
                onClick={() => setShowSavedModal(false)}
                style={{ padding: '0.5rem 1.2rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontWeight: 600 }}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Guardar Consulta Actual ── */}
      {showSaveFormModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem'
        }}>
          <div style={{
            background: '#fff', borderRadius: '16px', maxWidth: '500px', width: '100%',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)'
          }}>
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 800, fontSize: '1.15rem', color: '#004687' }}>
                💾 Guardar Plantilla de Consulta
              </div>
              <button onClick={() => setShowSaveFormModal(false)} style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: '#64748B' }}>✕</button>
            </div>

            <form onSubmit={handleSaveQuery} style={{ padding: '1.5rem' }}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  Nombre / Título de la Consulta *
                </label>
                <input
                  type="text"
                  required
                  placeholder="ej. Insumos con Caducidad Próxima de Quirófano"
                  value={saveTitle}
                  onChange={(e) => setSaveTitle(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  Descripción (Opcional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Notas adicionales o uso del reporte..."
                  value={saveDescription}
                  onChange={(e) => setSaveDescription(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ background: '#F8FAFC', padding: '0.8rem', borderRadius: '8px', border: '1px solid #E2E8F0', fontSize: '0.75rem', color: '#64748B', marginBottom: '1.25rem' }}>
                🔒 <strong>Privacidad:</strong> Esta consulta será visible únicamente para tu usuario y el área de Sistemas/Administradores.
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => setShowSaveFormModal(false)}
                  style={{ padding: '0.55rem 1.2rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontWeight: 600 }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingQuery}
                  style={{
                    padding: '0.55rem 1.5rem', borderRadius: '6px', border: 'none',
                    background: '#004687', color: '#fff', fontWeight: 700, cursor: 'pointer'
                  }}
                >
                  {savingQuery ? 'Guardando...' : 'Guardar Plantilla'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
