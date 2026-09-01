import React, { useState, useEffect, useMemo, useRef } from 'react';
import PremiumLoader from '../shared/PremiumLoader';
import { API_BASE } from '../../api/config';
import { authHeaders } from '../../api/auth';
import { useAuth } from '../../context/AuthContext';

const ColumnFilter = ({ columnKey, data, colFilters, setColFilters, label, align = 'left', maxWidth }) => {
  const uniqueVals = useMemo(() => {
    return Array.from(new Set(data.map(item => item[columnKey]))).filter(val => val !== null && val !== undefined && val !== '').sort();
  }, [data, columnKey]);

  const val = colFilters[columnKey] || '';
  const isActive = val !== '';

  return (
    <th style={{
      textAlign: align,
      maxWidth: maxWidth || 'none',
      padding: '12px 10px',
      background: '#004687',
      borderBottom: '3px solid #0088C9',
      whiteSpace: 'nowrap'
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span style={{ fontSize: '0.68rem', textTransform: 'uppercase', color: 'rgba(255,255,255,0.85)', letterSpacing: '0.04em', fontWeight: '700' }}>
          {label}
        </span>
        <select
          value={val}
          onChange={(e) => setColFilters(prev => ({ ...prev, [columnKey]: e.target.value }))}
          style={{
            fontSize: '0.7rem',
            padding: '3px 6px',
            borderRadius: '4px',
            border: isActive ? '1.5px solid #38bdf8' : '1px solid rgba(255,255,255,0.25)',
            background: isActive ? 'rgba(56,189,248,0.2)' : 'rgba(255,255,255,0.12)',
            color: '#fff',
            outline: 'none',
            maxWidth: maxWidth || '100%',
            textOverflow: 'ellipsis'
          }}
        >
          <option value="" style={{ color: '#1e293b' }}>Todos ({uniqueVals.length})</option>
          {uniqueVals.map((v, i) => (
            <option key={i} value={v} style={{ color: '#1e293b' }}>{String(v)}</option>
          ))}
        </select>
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
  const [tableScrollWidth, setTableScrollWidth] = useState(1600);

  const [catalog, setCatalog] = useState([]);
  const [selectedEntityId, setSelectedEntityId] = useState('inventory');
  const [selectedFields, setSelectedFields] = useState([]);

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

  // Filtros
  const [fechaDesde, setFechaDesde] = useState(getDaysAgoStr(30));
  const [fechaHasta, setFechaHasta] = useState(getTodayStr());
  const [almacen, setAlmacen] = useState('ALL');
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
    const fetchCatalog = async () => {
      try {
        const res = await fetch(`${API_BASE}/sap-query/catalog`, { headers: authHeaders() });
        if (res.ok) {
          const json = await res.json();
          if (json.ok && json.catalog) {
            setCatalog(json.catalog);
            // Iniciar con campos default de la primera entidad
            const defaultEnt = json.catalog.find(c => c.id === 'inventory') || json.catalog[0];
            if (defaultEnt) {
              setSelectedEntityId(defaultEnt.id);
              setSelectedFields(defaultEnt.defaultFields || []);
            }
          }
        }
      } catch (err) {
        console.error('[SAP Query Builder] Error al cargar catálogo:', err);
      }
    };
    fetchCatalog();
    loadSavedQueries();
  }, []);

  const currentEntityDef = useMemo(() => {
    return catalog.find(c => c.id === selectedEntityId) || null;
  }, [catalog, selectedEntityId]);

  // Al cambiar de entidad, preseleccionar sus campos default
  const handleSelectEntity = (entId) => {
    setSelectedEntityId(entId);
    const def = catalog.find(c => c.id === entId);
    if (def) {
      setSelectedFields(def.defaultFields || def.fields.map(f => f.key));
    }
    setColFilters({});
    setPage(1);
    setQueryResult(null);
    setError(null);
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
  const handleExecute = async () => {
    if (!currentEntityDef) return;

    if (currentEntityDef.requiresDateFilter) {
      if (!fechaDesde || !fechaHasta) {
        setError(`Para evitar sobrecarga en SAP Service Layer, el módulo '${currentEntityDef.title}' requiere obligatoriamente seleccionar Fecha Desde y Fecha Hasta.`);
        return;
      }
    }

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
          entity: selectedEntityId,
          selectedFields,
          fechaDesde,
          fechaHasta,
          almacen,
          busqueda
        })
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Error al ejecutar la consulta en Service Layer');
      }

      setQueryResult(json);
    } catch (err) {
      console.error('[SAP Query Execution Error]', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
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
          filters: { fechaDesde, fechaHasta, almacen, busqueda },
          isPublic: saveIsPublic
        })
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'No se pudo guardar la consulta');

      setShowSaveFormModal(false);
      setSaveTitle('');
      setSaveDescription('');
      loadSavedQueries();
      alert('✅ Plantilla de consulta guardada con éxito.');
    } catch (err) {
      alert('❌ Error al guardar: ' + err.message);
    } finally {
      setSavingQuery(false);
    }
  };

  // Cargar una plantilla guardada
  const handleLoadSavedQuery = (sq) => {
    handleSelectEntity(sq.entity);
    if (sq.selectedFields && sq.selectedFields.length > 0) {
      setSelectedFields(sq.selectedFields);
    }
    if (sq.filters) {
      if (sq.filters.fechaDesde) setFechaDesde(sq.filters.fechaDesde);
      if (sq.filters.fechaHasta) setFechaHasta(sq.filters.fechaHasta);
      if (sq.filters.almacen) setAlmacen(sq.filters.almacen);
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
        alert('Error: ' + json.error);
      }
    } catch (err) {
      alert('Error al eliminar: ' + err.message);
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
  const columns = queryResult?.columnas || [];

  // Filtrado de cliente sobre las columnas
  const filteredRows = useMemo(() => {
    return rows.filter(row => {
      return Object.entries(colFilters).every(([key, val]) => {
        if (!val) return true;
        return String(row[key] ?? '').trim().toLowerCase() === String(val).trim().toLowerCase();
      });
    });
  }, [rows, colFilters]);

  const paginatedRows = useMemo(() => {
    return filteredRows.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  }, [filteredRows, page]);

  const totalPages = Math.ceil(filteredRows.length / PER_PAGE);

  // Totales para exportación y resumen
  const exportExcel = () => {
    if (filteredRows.length === 0 || columns.length === 0) return;

    const fmt = (val, col) => {
      if (val == null || val === '') return '';
      if (col.type === 'date') return new Date(val).toLocaleDateString('es-MX');
      if (col.type === 'datetime') return new Date(val).toLocaleString('es-MX');
      if (col.type === 'money') return `$${Number(val).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      if (col.type === 'percent') return `${Number(val).toFixed(1)}%`;
      return String(val).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };

    const fechaReporte = new Date().toLocaleString('es-MX');
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
  <tr><td colspan="${columns.length}" class="subtitle-bar">Reporte Service Layer SAP: ${currentEntityDef?.title || 'Consulta Personalizada'}</td></tr>
  <tr class="info-row"><td colspan="${columns.length}">Generado por: ${user?.nombre || user?.username} &nbsp;|&nbsp; Período: ${fechaDesde} al ${fechaHasta} &nbsp;|&nbsp; Registros: ${filteredRows.length} &nbsp;|&nbsp; Fecha: ${fechaReporte}</td></tr>
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
    a.download = `Reporte_SAP_${selectedEntityId}_${fechaDesde}_${fechaHasta}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ padding: '0.5rem 0', width: '100%', maxWidth: '100%', boxSizing: 'border-box', color: '#1e293b' }}>
      
      {/* ── Encabezado Principal ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ fontSize: '2.2rem' }}>🔌</span>
            <div>
              <h1 style={{ fontSize: '1.75rem', fontWeight: '800', color: '#004687', margin: 0, letterSpacing: '-0.02em' }}>
                Consultas SAP (Service Layer)
              </h1>
              <p style={{ margin: '2px 0 0', color: '#64748b', fontSize: '0.875rem' }}>
                Constructor visual de reportes a la medida sobre SAP Business One con nombres hospitalarios claros y exportación instantánea.
              </p>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => setShowSavedModal(true)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.45rem',
              padding: '0.6rem 1.1rem', background: '#F1F5F9', border: '1px solid #CBD5E1',
              borderRadius: 8, color: '#334155', fontWeight: 700, fontSize: '0.82rem',
              cursor: 'pointer', transition: 'all 0.15s ease'
            }}
          >
            📂 Mis Plantillas Guardadas ({savedQueries.length})
          </button>

          <button
            onClick={() => setShowSaveFormModal(true)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.45rem',
              padding: '0.6rem 1.1rem', background: '#004687', border: 'none',
              borderRadius: 8, color: '#fff', fontWeight: 700, fontSize: '0.82rem',
              cursor: 'pointer', boxShadow: '0 4px 10px rgba(0,70,135,0.25)',
              transition: 'all 0.15s ease'
            }}
          >
            💾 Guardar Consulta
          </button>
        </div>
      </div>

      {/* ── Selector de Entidades / Módulos de SAP ── */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', marginBottom: '0.6rem', letterSpacing: '0.05em' }}>
          1. Selecciona el Módulo o Tema a Consultar:
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: '0.75rem'
        }}>
          {catalog.map(ent => {
            const isSelected = ent.id === selectedEntityId;
            return (
              <div
                key={ent.id}
                onClick={() => handleSelectEntity(ent.id)}
                style={{
                  background: isSelected ? '#EFF6FF' : '#fff',
                  border: isSelected ? '2px solid #0088C9' : '1px solid #E2E8F0',
                  borderRadius: '10px',
                  padding: '0.9rem',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  boxShadow: isSelected ? '0 4px 12px rgba(0,136,201,0.15)' : 'none',
                  position: 'relative'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                  <span style={{ fontSize: '1.3rem' }}>{ent.icon}</span>
                  <span style={{ fontWeight: 700, fontSize: '0.88rem', color: isSelected ? '#004687' : '#1E293B' }}>
                    {ent.title}
                  </span>
                </div>
                <div style={{ fontSize: '0.72rem', color: '#64748B', lineHeight: '1.3' }}>
                  {ent.description}
                </div>
                {ent.requiresDateFilter && (
                  <span style={{
                    display: 'inline-block', marginTop: '6px', fontSize: '0.65rem',
                    fontWeight: 700, color: '#B45309', background: '#FEF3C7',
                    padding: '2px 6px', borderRadius: '4px'
                  }}>
                    📅 Fechas requeridas
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Panel de Configuración de Filtros y Columnas ── */}
      {currentEntityDef && (
        <div style={{
          background: '#fff',
          borderRadius: '12px',
          border: '1px solid #E2E8F0',
          padding: '1.25rem',
          marginBottom: '1.5rem',
          boxShadow: '0 2px 6px rgba(0,0,0,0.02)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #F1F5F9', paddingBottom: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.4rem' }}>{currentEntityDef.icon}</span>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#004687' }}>
                  {currentEntityDef.title}
                </h3>
                <span style={{ fontSize: '0.75rem', color: '#64748B' }}>Configura tus filtros y campos para generar el reporte</span>
              </div>
            </div>

            <button
              onClick={handleExecute}
              disabled={loading}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                padding: '0.65rem 1.5rem', background: '#0088C9', border: 'none',
                borderRadius: 8, color: '#fff', fontWeight: 800, fontSize: '0.9rem',
                cursor: loading ? 'not-allowed' : 'pointer',
                boxShadow: '0 4px 14px rgba(0,136,201,0.35)',
                transition: 'all 0.2s ease'
              }}
            >
              {loading ? '⏳ Consultando Service Layer...' : '⚡ Ejecutar Consulta SAP'}
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>
            
            {/* Columna Izquierda: Rango de Fechas y Filtros Rápidos */}
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                Filtros de Búsqueda {currentEntityDef.requiresDateFilter && <span style={{ color: '#DC2626' }}>(Fechas Obligatorias)</span>}
              </div>

              {/* Rango de Fechas */}
              <div style={{
                background: currentEntityDef.requiresDateFilter ? '#FFFBEB' : '#F8FAFC',
                border: currentEntityDef.requiresDateFilter ? '1px solid #FDE68A' : '1px solid #E2E8F0',
                borderRadius: '8px', padding: '0.85rem', marginBottom: '0.85rem'
              }}>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: '130px' }}>
                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
                      Fecha Desde
                    </label>
                    <input
                      type="date"
                      value={fechaDesde}
                      onChange={(e) => setFechaDesde(e.target.value)}
                      style={{ width: '100%', padding: '0.4rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.82rem', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: '130px' }}>
                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
                      Fecha Hasta
                    </label>
                    <input
                      type="date"
                      value={fechaHasta}
                      onChange={(e) => setFechaHasta(e.target.value)}
                      style={{ width: '100%', padding: '0.4rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.82rem', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>

                {/* Atajos Rápidos de Fecha */}
                <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
                  <button onClick={() => { setFechaDesde(getTodayStr()); setFechaHasta(getTodayStr()); }} style={{ padding: '2px 8px', fontSize: '0.7rem', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}>Hoy</button>
                  <button onClick={() => { setFechaDesde(getDaysAgoStr(7)); setFechaHasta(getTodayStr()); }} style={{ padding: '2px 8px', fontSize: '0.7rem', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}>7 Días</button>
                  <button onClick={() => { setFechaDesde(getMonthStartStr()); setFechaHasta(getTodayStr()); }} style={{ padding: '2px 8px', fontSize: '0.7rem', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}>Este Mes</button>
                  <button onClick={() => { setFechaDesde(getDaysAgoStr(30)); setFechaHasta(getTodayStr()); }} style={{ padding: '2px 8px', fontSize: '0.7rem', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}>30 Días</button>
                  <button onClick={() => { setFechaDesde(getDaysAgoStr(90)); setFechaHasta(getTodayStr()); }} style={{ padding: '2px 8px', fontSize: '0.7rem', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}>90 Días</button>
                </div>
              </div>

              {/* Filtro Almacén y Búsqueda */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
                    Almacén
                  </label>
                  <select
                    value={almacen}
                    onChange={(e) => setAlmacen(e.target.value)}
                    style={{ width: '100%', padding: '0.45rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.82rem' }}
                  >
                    <option value="ALL">Todos los Almacenes</option>
                    <option value="FAR">Farmacia Central (FAR)</option>
                    <option value="QX">Quirófano General (QX)</option>
                    <option value="QXCR">Quirófano Carro Rojo (QXCR)</option>
                    <option value="ALM">Almacén General (ALM)</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
                    Búsqueda de Texto
                  </label>
                  <input
                    type="text"
                    placeholder="Código, nombre, proveedor..."
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    style={{ width: '100%', padding: '0.45rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.82rem', boxSizing: 'border-box' }}
                  />
                </div>
              </div>
            </div>

            {/* Columna Derecha: Selector de Campos / Columnas */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>
                  Columnas a Incluir ({selectedFields.length} seleccionadas)
                </span>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button onClick={selectAllFields} style={{ fontSize: '0.68rem', background: 'none', border: 'none', color: '#0088C9', cursor: 'pointer', fontWeight: 700 }}>Todos</button>
                  <span style={{ color: '#cbd5e1' }}>|</span>
                  <button onClick={selectDefaultFields} style={{ fontSize: '0.68rem', background: 'none', border: 'none', color: '#0088C9', cursor: 'pointer', fontWeight: 700 }}>Recomendados</button>
                </div>
              </div>

              <div style={{
                maxHeight: '160px',
                overflowY: 'auto',
                border: '1px solid #E2E8F0',
                borderRadius: '8px',
                padding: '0.6rem',
                background: '#F8FAFC',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: '0.4rem'
              }}>
                {currentEntityDef.fields.map(f => {
                  const isChecked = selectedFields.includes(f.key);
                  return (
                    <label
                      key={f.key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                        padding: '3px 6px',
                        borderRadius: '4px',
                        background: isChecked ? '#EFF6FF' : 'transparent',
                        color: isChecked ? '#004687' : '#334155',
                        fontWeight: isChecked ? 700 : 500
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleField(f.key)}
                        style={{ accentColor: '#0088C9' }}
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
        <div style={{
          background: '#FEE2E2', border: '1px solid #F87171', color: '#991B1B',
          padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem', fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: '0.5rem'
        }}>
          <span>⚠️</span>
          <div>{error}</div>
        </div>
      )}

      {/* ── Panel de Resultados ── */}
      {queryResult && (
        <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #E2E8F0', overflow: 'hidden', boxShadow: '0 4px 8px -2px rgba(0,0,0,0.05)' }}>
          
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
                {queryResult.entityTitle} ({filteredRows.length.toLocaleString('es-MX')} registros)
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748B' }}>
                Consulta ejecutada en tiempo real contra SAP Service Layer
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
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
              <PremiumLoader text="Obteniendo datos de Service Layer..." />
            </div>
          ) : rows.length === 0 ? (
            <div style={{ padding: '4rem 2rem', textAlign: 'center', color: '#64748B' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📭</div>
              <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>No se encontraron registros en SAP para este período</div>
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
                          const isVencido = String(val).includes('Vencido');
                          const isProx = String(val).includes('Próximo');
                          formattedVal = (
                            <span style={{
                              padding: '2px 8px', borderRadius: '10px', fontSize: '0.7rem', fontWeight: 800,
                              background: isVencido ? '#FEE2E2' : isProx ? '#FEF3C7' : '#DCFCE7',
                              color: isVencido ? '#DC2626' : isProx ? '#B45309' : '#15803D'
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
                            Módulo: {sq.entity}
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
