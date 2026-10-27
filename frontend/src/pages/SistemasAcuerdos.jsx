import { useState, useEffect, useMemo, useRef } from 'react';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';
import '../styles/SistemasAcuerdos.css';

const REQUEST_TIMEOUT_MS = 95000;

export default function SistemasAcuerdos() {
  const { user } = useAuth();
  const canManage = user?.role === 'ADMIN' || String(user?.username || '').toLowerCase() === 'amendoza';
  const [activeTab, setActiveTab] = useState('catalog'); // 'catalog', 'attempts', 'create'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Datos
  const [auditData, setAuditData] = useState({ metrics: {}, agreements: [] });
  const [attemptsData, setAttemptsData] = useState({ attempts: [] });
  const [loadingAttempts, setLoadingAttempts] = useState(false);
  const [attemptsError, setAttemptsError] = useState(null);

  const auditRequestId = useRef(0);
  const attemptsRequestId = useRef(0);

  // Filtros Catálogo
  const [searchCatalog, setSearchCatalog] = useState('');
  const [filterHealth, setFilterHealth] = useState('ALL'); // 'ALL', 'critical', 'healthy', 'inactive'

  // Filtros Intentos
  const [filterAttemptStatus, setFilterAttemptStatus] = useState('ALL'); // 'ALL', 'CA', 'AU'
  const [selectedAgFilter, setSelectedAgFilter] = useState('');

  // Formulario Nuevo Acuerdo
  const [formData, setFormData] = useState({
    agCode: '',
    agName: '',
    bpCode: '',
    bpName: '',
    priceListNum: 2,
    priceFactor: 1.40,
    globalDiscount: 0.0,
    suCode: 'ADM',
    patientCareAgreement: true,
    salesOrderAgreement: true
  });
  const [bpSearchTerm, setBpSearchTerm] = useState('');
  const [bpSearchResults, setBpSearchResults] = useState([]);
  const [searchingBp, setSearchingBp] = useState(false);
  const [savingAgreement, setSavingAgreement] = useState(false);
  const [repairingCode, setRepairingCode] = useState(null);

  // Carga inicial de auditoría
  const loadAudit = async () => {
    const requestId = ++auditRequestId.current;
    try {
      setLoading(true);
      setError(null);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let res;
      try {
        res = await apiFetch('/sistemas/agreements', { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (requestId !== auditRequestId.current) return;
      if (res && res.data) {
        setAuditData(res.data);
        setLastUpdated(new Date());
      }
    } catch (err) {
      if (requestId !== auditRequestId.current) return;
      setError(err?.name === 'AbortError'
        ? 'La consulta de convenios tardó demasiado. Intenta de nuevo.'
        : err.message || 'Error al conectar con el servidor de auditoría de convenios.');
    } finally {
      if (requestId === auditRequestId.current) setLoading(false);
    }
  };

  // Carga de intentos
  const loadAttempts = async (agCode = selectedAgFilter, status = filterAttemptStatus) => {
    const requestId = ++attemptsRequestId.current;
    try {
      setLoadingAttempts(true);
      setAttemptsError(null);
      const params = {};
      if (agCode) params.agCode = agCode;
      if (status !== 'ALL') params.status = status;
      params.limit = 150;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let res;
      try {
        res = await apiFetch('/sistemas/agreements/attempts', { params, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (requestId !== attemptsRequestId.current) return;
      if (res && res.data) {
        setAttemptsData(res.data);
      }
    } catch (err) {
      if (requestId !== attemptsRequestId.current) return;
      setAttemptsError(err?.name === 'AbortError'
        ? 'La consulta de intentos tardó demasiado. Intenta de nuevo.'
        : err.message || 'No se pudo cargar el historial de intentos.');
    } finally {
      if (requestId === attemptsRequestId.current) setLoadingAttempts(false);
    }
  };

  useEffect(() => {
    loadAudit();
    loadAttempts();
    return () => {
      auditRequestId.current += 1;
      attemptsRequestId.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!canManage && activeTab === 'create') setActiveTab('catalog');
  }, [canManage, activeTab]);

  // Manejar cambio de filtros en intentos
  const handleAttemptFilterChange = (status) => {
    setFilterAttemptStatus(status);
    loadAttempts(selectedAgFilter, status);
  };

  const handleAgFilterChange = (code) => {
    setSelectedAgFilter(code);
    loadAttempts(code, filterAttemptStatus);
  };

  // Buscar socios comerciales en SAP en vivo
  const handleSearchBP = async (term) => {
    setBpSearchTerm(term);
    if (!term || term.trim().length < 2) {
      setBpSearchResults([]);
      return;
    }
    try {
      setSearchingBp(true);
      const res = await apiFetch('/sistemas/agreements/partners', { params: { q: term } });
      if (res && res.partners) {
        setBpSearchResults(res.partners);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSearchingBp(false);
    }
  };

  const handleSelectBP = (bp) => {
    setFormData(prev => ({
      ...prev,
      bpCode: bp.BPCode,
      bpName: bp.BPName,
      // Si el nombre del acuerdo está vacío, sugerir el nombre del socio
      agName: prev.agName ? prev.agName : bp.BPName
    }));
    setBpSearchResults([]);
    setBpSearchTerm(`${bp.BPCode} — ${bp.BPName}`);
  };

  // Reparar acuerdo con 1 clic
  const handleRepair = async (agCode) => {
    if (!window.confirm(`¿Confirmas reparar la configuración del convenio '${agCode}' en Vertical? Se ajustará ChargeMode='LD', SUCode='ADM' y se regenerarán sus reglas tarifarias en AGITGR.`)) {
      return;
    }

    try {
      setRepairingCode(agCode);
      setError(null);
      setSuccessMsg(null);
      const res = await apiFetch(`/sistemas/agreements/repair/${encodeURIComponent(agCode)}`, { method: 'POST' });
      if (res && res.result) {
        setSuccessMsg(res.result.message);
        await Promise.all([loadAudit(), loadAttempts()]);
      }
    } catch (err) {
      setError(err.message || `Fallo al reparar el convenio '${agCode}'.`);
    } finally {
      setRepairingCode(null);
    }
  };

  // Crear nuevo acuerdo
  const handleCreateAgreement = async (e) => {
    e.preventDefault();
    if (!formData.agCode || !formData.agName || !formData.bpCode) {
      setError('Por favor completa todos los campos requeridos (Código, Nombre y Socio SAP).');
      return;
    }

    try {
      setSavingAgreement(true);
      setError(null);
      setSuccessMsg(null);
      const res = await apiFetch('/sistemas/agreements/create', {
        method: 'POST',
        body: formData
      });

      if (res && res.result) {
        setSuccessMsg(res.result.message);
        // Reset form
        setFormData({
          agCode: '',
          agName: '',
          bpCode: '',
          bpName: '',
          priceListNum: 2,
          priceFactor: 1.40,
          globalDiscount: 0.0,
          suCode: 'ADM',
          patientCareAgreement: true,
          salesOrderAgreement: true
        });
        setBpSearchTerm('');
        await loadAudit();
        setActiveTab('catalog');
      }
    } catch (err) {
      setError(err.message || 'Error al crear el convenio.');
    } finally {
      setSavingAgreement(false);
    }
  };

  // Filtrado de catálogo
  const filteredAgreements = useMemo(() => {
    const term = searchCatalog.trim().toLowerCase();
    return (auditData.agreements || []).filter(item => {
      if (filterHealth !== 'ALL' && item.health !== filterHealth) return false;
      if (!term) return true;
      return [item.AGCode, item.AGName, item.BPCode, item.RealBPNameInSAP]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(term));
    });
  }, [auditData.agreements, searchCatalog, filterHealth]);

  const metrics = auditData.metrics || {};
  const updatedLabel = lastUpdated
    ? lastUpdated.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  return (
    <div className="sistemas-acuerdos-container">
      {/* Header */}
      <div className="sistemas-header">
        <div className="sistemas-header-title">
          <span className="sistemas-header-icon" aria-hidden="true">⚙️</span>
          <div>
            <h1>Gestor de Convenios y Acuerdos (Vertical)</h1>
            <p>Auditoría en vivo, diagnóstico de fallos, reparación automática y creación asistida de convenios hospitalarios</p>
          </div>
        </div>
      </div>

      {/* Alertas */}
      {error && (
        <div className="alert-box error">
          <span>❌ {error}</span>
          <div className="alert-actions">
            <button className="alert-retry" onClick={loadAudit} disabled={loading}>Reintentar</button>
            <button className="alert-close" onClick={() => setError(null)} aria-label="Cerrar aviso">✕</button>
          </div>
        </div>
      )}
      {successMsg && (
        <div className="alert-box success">
          <span>✅ {successMsg}</span>
          <button className="alert-close" onClick={() => setSuccessMsg(null)} aria-label="Cerrar aviso">✕</button>
        </div>
      )}

      {/* Métricas Globales */}
      <div className="sistemas-metrics-grid">
        <div className="metric-card primary">
          <div className="metric-title">Total Acuerdos</div>
          <div className="metric-value">{metrics.total || 0}</div>
          <div className="metric-sub">Registrados en dbo.AG</div>
        </div>
        <div className="metric-card critical">
          <div className="metric-title">🔴 Con Fallas Críticas</div>
          <div className="metric-value">{metrics.critical || 0}</div>
          <div className="metric-sub">Bloquean descuentos o cargos</div>
        </div>
        <div className="metric-card healthy">
          <div className="metric-title">🟢 Operativos / Sanos</div>
          <div className="metric-value">{metrics.healthy || 0}</div>
          <div className="metric-sub">Listos y funcionando en admisión</div>
        </div>
        <div className="metric-card warning">
          <div className="metric-title">Intentos en Cuentas</div>
          <div className="metric-value">{metrics.totalAttempts || 0}</div>
          <div className="metric-sub">Cancelados: {metrics.totalCancelled || 0} ({metrics.successRate || 0}% éxito)</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="sistemas-tabs">
        <button
          className={`tab-btn ${activeTab === 'catalog' ? 'active' : ''}`}
          onClick={() => setActiveTab('catalog')}
        >
          📋 Catálogo y Diagnóstico de Salud
          {metrics.critical > 0 && <span className="tab-badge">{metrics.critical} con fallas</span>}
        </button>
        <button
          className={`tab-btn ${activeTab === 'attempts' ? 'active' : ''}`}
          onClick={() => setActiveTab('attempts')}
        >
          🔍 Análisis de Intentos (Correctos vs Fallidos)
        </button>
        {canManage && (
          <button
            className={`tab-btn ${activeTab === 'create' ? 'active' : ''}`}
            onClick={() => setActiveTab('create')}
          >
            ➕ Crear Nuevo Acuerdo
          </button>
        )}
      </div>

      {/* TAB 1: CATÁLOGO Y SALUD */}
      {activeTab === 'catalog' && (
        <div>
          <div className="sistemas-controls-bar">
            <div className="search-input-wrapper">
              <span className="search-icon">🔍</span>
              <input
                type="text"
                placeholder="Buscar por código, aseguradora o socio SAP..."
                value={searchCatalog}
                onChange={(e) => setSearchCatalog(e.target.value)}
                className="search-input"
              />
            </div>
            <div className="sa-controls-right">
              <div className="filter-pills">
                <button
                  className={`pill-btn ${filterHealth === 'ALL' ? 'active' : ''}`}
                  onClick={() => setFilterHealth('ALL')}
                >
                  Todos ({metrics.total || 0})
                </button>
                <button
                  className={`pill-btn ${filterHealth === 'critical' ? 'active' : ''}`}
                  onClick={() => setFilterHealth('critical')}
                >
                  🔴 Con Fallas ({metrics.critical || 0})
                </button>
                <button
                  className={`pill-btn ${filterHealth === 'healthy' ? 'active' : ''}`}
                  onClick={() => setFilterHealth('healthy')}
                >
                  🟢 Operativos ({metrics.healthy || 0})
                </button>
                <button
                  className={`pill-btn ${filterHealth === 'inactive' ? 'active' : ''}`}
                  onClick={() => setFilterHealth('inactive')}
                >
                  ⚪ Inactivos ({metrics.inactive || 0})
                </button>
              </div>
              <button className="pill-btn" onClick={loadAudit} disabled={loading}>
                {loading ? '⏳ Actualizando...' : '🔄 Actualizar'}
              </button>
              {updatedLabel && <span className="sa-updated">Actualizado {updatedLabel}</span>}
            </div>
          </div>

          <div className="table-responsive">
            <table className="sistemas-table">
              <thead>
                <tr>
                  <th>Estado</th>
                  <th>Código</th>
                  <th>Convenio / Aseguradora</th>
                  <th>Socio SAP (BP)</th>
                  <th>Modo Cobro</th>
                  <th>Grupos (AGITGR)</th>
                  <th>Factor / Descto</th>
                  <th>Unidad Serv.</th>
                  <th>Intentos / Cancelados</th>
                  <th>Diagnóstico Técnico</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="11" className="sa-table-state">
                      <span className="sa-spinner" aria-hidden="true" />
                      Cargando auditoría de acuerdos desde SQL Server...
                    </td>
                  </tr>
                ) : filteredAgreements.length === 0 ? (
                  <tr>
                    <td colSpan="11" className="sa-table-state">
                      No se encontraron acuerdos con los filtros seleccionados.
                    </td>
                  </tr>
                ) : (
                  filteredAgreements.map(ag => (
                    <tr key={ag.AGCode}>
                      <td>
                        <span className={`status-badge ${ag.health}`}>
                          {ag.health === 'critical' && '🔴 Con Fallas'}
                          {ag.health === 'healthy' && '🟢 Operativo'}
                          {ag.health === 'inactive' && '⚪ Inactivo'}
                        </span>
                      </td>
                      <td><strong>{ag.AGCode}</strong></td>
                      <td>
                        <div>{ag.AGName}</div>
                        {ag.RealBPNameInSAP && (
                          <div className="sa-subtext">
                            SAP: {ag.RealBPNameInSAP}
                          </div>
                        )}
                      </td>
                      <td>
                        {ag.BPCode ? (
                          <code className="sa-mono">{ag.BPCode}</code>
                        ) : (
                          <span className="sa-danger-text">Sin Socio</span>
                        )}
                      </td>
                      <td>
                        <span className={ag.ChargeMode === 'NL' ? 'sa-danger-text is-bold' : 'sa-info-text'}>
                          {ag.ChargeMode || '—'}
                        </span>
                        {ag.ChargeMode === 'NL' && (
                          <div className="sa-subtext sa-danger-text">(Sin desc. línea)</div>
                        )}
                      </td>
                      <td>
                        <span className={ag.AGITGR_Count === 0 ? 'sa-danger-text is-bold' : undefined}>
                          {ag.AGITGR_Count} grupos
                        </span>
                      </td>
                      <td>
                        <div>Factor: {Number(ag.PriceFactor || 0).toFixed(2)}</div>
                        <div className="sa-info-text">Desc: {ag.GlobalDiscount}%</div>
                      </td>
                      <td>
                        {ag.SUCode ? (
                          <span>{ag.SUCode}</span>
                        ) : (
                          <span className="sa-danger-text is-bold">NULL</span>
                        )}
                      </td>
                      <td>
                        <div>{ag.PCAG_TotalAttempts} intentos</div>
                        {ag.PCAG_Cancelled > 0 && (
                          <div className="sa-subtext sa-danger-text">
                            {ag.PCAG_Cancelled} cancelados
                          </div>
                        )}
                      </td>
                      <td style={{ maxWidth: '280px' }}>
                        {ag.issues && ag.issues.length > 0 ? (
                          <ul className="sa-issues">
                            {ag.issues.map((iss, i) => (
                              <li key={i}>{iss}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="sa-ok-text">✅ Sin inconsistencias</span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.4rem', flexDirection: 'column' }}>
                          {canManage && ag.canRepair && (
                            <button
                              className="btn-repair"
                              onClick={() => handleRepair(ag.AGCode)}
                              disabled={repairingCode === ag.AGCode}
                            >
                              {repairingCode === ag.AGCode ? '⏳ Reparando...' : '🔧 Reparar'}
                            </button>
                          )}
                          <button
                            className="btn-inspect"
                            onClick={() => {
                              setSelectedAgFilter(ag.AGCode);
                              setActiveTab('attempts');
                              loadAttempts(ag.AGCode, 'ALL');
                            }}
                          >
                            👁️ Ver Intentos
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: ANÁLISIS DE INTENTOS */}
      {activeTab === 'attempts' && (
        <div>
          <div className="sistemas-controls-bar">
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <div>
                <label className="sa-field-label" htmlFor="sa-ag-filter">Filtrar por convenio</label>
                <select
                  id="sa-ag-filter"
                  className="sa-select"
                  value={selectedAgFilter}
                  onChange={(e) => handleAgFilterChange(e.target.value)}
                >
                  <option value="">Todos los convenios</option>
                  {(auditData.agreements || []).map(a => (
                    <option key={a.AGCode} value={a.AGCode}>
                      {a.AGCode} — {a.AGName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="filter-pills">
                <button
                  className={`pill-btn ${filterAttemptStatus === 'ALL' ? 'active' : ''}`}
                  onClick={() => handleAttemptFilterChange('ALL')}
                >
                  Todos los Intentos
                </button>
                <button
                  className={`pill-btn ${filterAttemptStatus === 'CA' ? 'active' : ''}`}
                  onClick={() => handleAttemptFilterChange('CA')}
                >
                  🔴 Solo Fallidos / Cancelados (CA)
                </button>
                <button
                  className={`pill-btn ${filterAttemptStatus === 'AU' ? 'active' : ''}`}
                  onClick={() => handleAttemptFilterChange('AU')}
                >
                  🟢 Solo Autorizados (AU)
                </button>
              </div>
            </div>

            <button
              className="pill-btn"
              onClick={() => loadAttempts(selectedAgFilter, filterAttemptStatus)}
            >
              🔄 Actualizar Intentos
            </button>
          </div>

          {attemptsError && (
            <div className="alert-box error">
              <span>❌ {attemptsError}</span>
              <div className="alert-actions">
                <button
                  className="alert-retry"
                  onClick={() => loadAttempts(selectedAgFilter, filterAttemptStatus)}
                  disabled={loadingAttempts}
                >
                  Reintentar
                </button>
                <button className="alert-close" onClick={() => setAttemptsError(null)} aria-label="Cerrar aviso">✕</button>
              </div>
            </div>
          )}

          <div className="table-responsive">
            <table className="sistemas-table">
              <thead>
                <tr>
                  <th>Fecha Local (CDMX)</th>
                  <th>Convenio</th>
                  <th>Folio Cuenta</th>
                  <th>Estatus</th>
                  <th>Operador</th>
                  <th>Líneas con Convenio</th>
                  <th>Monto Facturado</th>
                  <th>Saldo Cuenta</th>
                  <th>Diagnóstico Operativo</th>
                </tr>
              </thead>
              <tbody>
                {loadingAttempts ? (
                  <tr>
                    <td colSpan="9" className="sa-table-state">
                      <span className="sa-spinner" aria-hidden="true" />
                      Cargando historial de intentos desde PCAG...
                    </td>
                  </tr>
                ) : attemptsError ? (
                  <tr>
                    <td colSpan="9" className="sa-table-state is-error">
                      No se pudo cargar el historial de intentos.
                    </td>
                  </tr>
                ) : (attemptsData.attempts || []).length === 0 ? (
                  <tr>
                    <td colSpan="9" className="sa-table-state">
                      No se encontraron registros de intentos con los filtros actuales.
                    </td>
                  </tr>
                ) : (
                  (attemptsData.attempts || []).map((att, i) => (
                    <tr key={`${att.PCNum}-${att.PCAGNum}-${i}`}>
                      <td>{att.localDateString}</td>
                      <td>
                        <strong>{att.AGCode}</strong>
                        <div className="sa-subtext">{att.AGName}</div>
                      </td>
                      <td>
                        <strong>#{att.PCNum}</strong>
                        <div className="sa-subtext">
                          Estado: {att.AccountStatus === 'CL' ? 'Cerrada' : 'Abierta'}
                        </div>
                      </td>
                      <td>
                        <span className={`status-badge ${att.PCAG_ST === 'CA' ? 'danger' : 'success'}`}>
                          {att.PCAG_ST === 'CA' ? '🔴 Cancelado (Falló)' : '🟢 Autorizado (AU)'}
                        </span>
                      </td>
                      <td>{att.CreatedBy}</td>
                      <td>
                        {att.BilledLinesCount > 0 ? (
                          <span className="sa-ok-text" style={{ fontWeight: 700 }}>
                            {att.BilledLinesCount} cargos
                          </span>
                        ) : (
                          <span className="sa-danger-text">0 cargos</span>
                        )}
                      </td>
                      <td>
                        {att.BilledTotalAmount > 0 ? (
                          `$${Number(att.BilledTotalAmount).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
                        ) : (
                          '$0.00'
                        )}
                      </td>
                      <td>
                        ${Number(att.AccountBalance || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                      </td>
                      <td>
                        {att.PCAG_ST === 'CA' ? (
                          <span className="sa-attempt-note is-bad">
                            Cancelado en recepción/caja por falta de aplicación de descuento o incompatibilidad.
                          </span>
                        ) : att.BilledLinesCount > 0 ? (
                          <span className="sa-attempt-note is-good">
                            ✅ Aplicó exitosamente a los cargos facturados de la cuenta.
                          </span>
                        ) : (
                          <span className="sa-attempt-note is-warn">
                            ⚠️ Autorizado en cuenta pero no absorbió líneas de cargo.
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: CREAR NUEVO ACUERDO */}
      {activeTab === 'create' && (
        <div className="form-card">
          <h2 style={{ fontSize: '1.2rem', marginTop: 0, marginBottom: '0.5rem' }}>
            ➕ Alta Asistida de Convenio en Vertical
          </h2>
          <p style={{ fontSize: '0.85rem', marginBottom: '1.5rem' }}>
            Este asistente garantiza que el nuevo convenio se cree con todas las reglas requeridas por Vertical,
            incluyendo la generación automática de sus 37 grupos de artículos en <code className="sa-inline-code">dbo.AGITGR</code> para que nunca falle en admisión ni en caja.
          </p>

          <form onSubmit={handleCreateAgreement}>
            <div className="form-grid">
              <div className="form-group">
                <label>Código del Convenio (AGCode) *</label>
                <input
                  type="text"
                  placeholder="Ej: GNP0002, MET0002, CTE02203"
                  value={formData.agCode}
                  onChange={(e) => setFormData({ ...formData, agCode: e.target.value.toUpperCase() })}
                  maxLength={20}
                  required
                />
                <span className="form-help">Máximo 20 caracteres. Alfanumérico en mayúsculas.</span>
              </div>

              <div className="form-group">
                <label>Nombre del Convenio (AGName) *</label>
                <input
                  type="text"
                  placeholder="Ej: GRUPO NACIONAL PROVINCIAL POLIZA PLUS"
                  value={formData.agName}
                  onChange={(e) => setFormData({ ...formData, agName: e.target.value })}
                  maxLength={128}
                  required
                />
                <span className="form-help">Nombre comercial visible en el desplegable de admisión.</span>
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>Socio de Negocios SAP (Business Partner) *</label>
                <input
                  type="text"
                  placeholder="Escribe el nombre o RFC para buscar en SAP..."
                  value={bpSearchTerm}
                  onChange={(e) => handleSearchBP(e.target.value)}
                  autoComplete="off"
                />
                {searchingBp && <span className="form-help">Buscando en SAP B1 / V_BP...</span>}
                {!searchingBp && bpSearchTerm.trim().length >= 2 && bpSearchResults.length === 0 && !formData.bpCode && (
                  <div className="bp-results">
                    <div className="bp-results-empty">Sin coincidencias en el catálogo de SAP.</div>
                  </div>
                )}
                {bpSearchResults.length > 0 && (
                  <div className="bp-results">
                    {bpSearchResults.map(bp => (
                      <button
                        type="button"
                        key={bp.BPCode}
                        className="bp-results-item"
                        onClick={() => handleSelectBP(bp)}
                      >
                        <strong className="bp-results-code">{bp.BPCode}</strong> — {bp.BPName}
                      </button>
                    ))}
                  </div>
                )}
                <span className="form-help">
                  Socio seleccionado: {formData.bpCode ? `${formData.bpCode} (${formData.bpName})` : 'Ninguno seleccionado'}
                </span>
              </div>

              <div className="form-group">
                <label>Lista de Precios Base</label>
                <select
                  value={formData.priceListNum}
                  onChange={(e) => setFormData({ ...formData, priceListNum: parseInt(e.target.value, 10) })}
                >
                  <option value={2}>Lista 2 — Hospitalización (Estándar)</option>
                  <option value={4}>Lista 4 — Urgencias / Autos</option>
                  <option value={1}>Lista 1 — Público General</option>
                  <option value={8}>Lista 8 — Paquetes Especiales</option>
                </select>
                <span className="form-help">Tabulador de precios de insumos y medicamentos.</span>
              </div>

              <div className="form-group">
                <label>Factor Multiplicador de Precio</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.5"
                  max="5.0"
                  value={formData.priceFactor}
                  onChange={(e) => setFormData({ ...formData, priceFactor: parseFloat(e.target.value) })}
                  required
                />
                <span className="form-help">1.40 representa un 40% adicional sobre el tabulador base.</span>
              </div>

              <div className="form-group">
                <label>Descuento Global (%)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={formData.globalDiscount}
                  onChange={(e) => setFormData({ ...formData, globalDiscount: parseFloat(e.target.value) })}
                  required
                />
                <span className="form-help">Porcentaje de descuento global que se heredará a las líneas.</span>
              </div>

              <div className="form-group">
                <label>Unidad de Servicio</label>
                <select
                  value={formData.suCode}
                  onChange={(e) => setFormData({ ...formData, suCode: e.target.value })}
                >
                  <option value="ADM">ADM — Admisión Hospitalaria</option>
                  <option value="URGE">URGE — Urgencias</option>
                  <option value="PRI">PRI — Privados</option>
                </select>
                <span className="form-help">Área que opera el convenio.</span>
              </div>

              <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.75rem', marginTop: '1.25rem' }}>
                <input
                  type="checkbox"
                  id="chkPatientCare"
                  checked={formData.patientCareAgreement}
                  onChange={(e) => setFormData({ ...formData, patientCareAgreement: e.target.checked })}
                />
                <label htmlFor="chkPatientCare" style={{ cursor: 'pointer' }}>
                  Habilitado para Cuentas Hospitalarias de Pacientes (PatientCareAgreement)
                </label>
              </div>
            </div>

            <button
              type="submit"
              className="btn-primary"
              disabled={savingAgreement}
            >
              {savingAgreement ? '⏳ Creando y Sincronizando en Vertical...' : '🚀 Crear y Publicar Convenio en Vertical'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
