import '../components/dashboard/DashboardVisuals.css';

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth }     from '../context/AuthContext';
import EmbeddedBI      from '../components/dashboard/EmbeddedBI';
import ExportButton    from '../components/shared/ExportButton';
import EditableKPIWrapper from '../components/shared/EditableKPIWrapper';
import PBIModal        from '../components/shared/PBIModal';
import ExportApiModal  from '../components/shared/ExportApiModal';
import PremiumLoader   from '../components/shared/PremiumLoader';
import GlobalFilterBar from '../components/dashboard/GlobalFilterBar';
import DashboardUrgenciasNativo from '../components/dashboard/DashboardUrgenciasNativo';
import DashboardQuirofanoNativo from '../components/dashboard/DashboardQuirofanoNativo';
import DashboardSitiAuxiliares from '../components/dashboard/DashboardSitiAuxiliares';
import DashboardAuxiliaresNativo from '../components/dashboard/DashboardAuxiliaresNativo';
import DashboardCunerosNativo from '../components/dashboard/DashboardCunerosNativo';
import DashboardConsultaExternaNativo from '../components/dashboard/DashboardConsultaExternaNativo';
import DashboardAseguradorasNativo from '../components/dashboard/DashboardAseguradorasNativo';
import DashboardUciNativo from '../components/dashboard/DashboardUciNativo';
import DashboardHospitalizacionNativo from '../components/dashboard/DashboardHospitalizacionNativo';
import { AREAS, AREAS_LABELS, AREA_TO_PERMISSION, ROUTE_TO_PERMISSION, can } from '../utils/rbac';
import { useKPIConfig } from '../hooks/useKPIConfig';
import AreaSwitcher from '../components/dashboard/AreaSwitcher';
import AreaIcon from '../components/dashboard/AreaIcon';
import { areaPalette } from '../components/dashboard/areaColors';
import { userMessage } from '../utils/userMessages';
import './DashboardArea.css';

const KPI_DB_MAP = {
  'Ocupación': 'ocupacion',
  'Egresos Mes': 'egresos',
  'Estancia Promedio': 'estancia',
  'Rotación Camas': 'rotacion_camas'
};

const API_BASE = '/api';

/* Config visual por área */
const AREA_CONFIG = {
  [AREAS.QUIROFANO]: { icon: 'surgery', color: '#004687', description: 'Cirugías, tiempos de atención e ingresos del área.' },
  [AREAS.UCI]: { icon: 'intensive', color: '#EF4444', chartAccent: '#0088C9', description: 'Ocupación de camas, estancias y atención de pacientes.' },
  [AREAS.URGENCIAS]: { icon: 'emergency', color: '#E8853D', description: 'Atenciones, altas y disponibilidad de camas.' },
  [AREAS.CUNEROS]: { icon: 'nursery', color: '#0088C9', description: 'Atención neonatal, alimentación y consumo de insumos.' },
  [AREAS.IMAGENOLOGIA]: { icon: 'imaging', color: '#8B5CF6', description: 'Estudios realizados, servicios más solicitados e ingresos.' },
  [AREAS.LABORATORIO]: { icon: 'laboratory', color: '#10B981', description: 'Estudios realizados, servicios más solicitados e ingresos.' },
  [AREAS.CONSULTA_EXTERNA]: { icon: 'consultation', color: '#0088C9', description: 'Consultas, asistencia y actividad de los médicos.' },
  [AREAS.FINANZAS]: { icon: 'finance', color: '#10B981', description: 'Ingresos, movimientos y resultados financieros.' },
  [AREAS.HOSPITALIZACION]: { icon: 'hospital', color: '#005FA9', description: 'Ocupación, estancias e ingresos por atención.' },
  [AREAS.ASEGURADORAS]: { icon: 'insurance', color: '#10B981', description: 'Pacientes con convenio, facturación y saldos pendientes.' },
  [AREAS.FARMACIA]: { icon: 'pharmacy', color: '#0088C9', description: 'Consumo de medicamentos e insumos del área.' },
  [AREAS.CARDIOLOGIA]: { icon: 'intensive', color: '#EF4444', chartAccent: '#0088C9', description: 'Consulta la actividad y los resultados de Cardiología.' },
  [AREAS.ALMACEN_GENERAL]: { icon: 'warehouse', color: '#005FA9', description: 'Consulta los movimientos y resultados del almacén.' },
};

const DEFAULT_AREA = AREAS.URGENCIAS;

function AreaKPICard({ label, value, delta, up }) {
  const deltaColor = up === true ? 'var(--color-verde-e)' : up === false ? 'var(--color-danger)' : '#52647a';
  return (
    <div className="area-kpi-card dashboard-metric-card">
      <div className="area-kpi-card__label dashboard-metric-label">{label}</div>
      {value != null && <div className="area-kpi-card__value dashboard-metric-value">{value}</div>}
      {value != null && delta != null && (
        <div className="area-kpi-card__note dashboard-metric-note" style={{ color: deltaColor }}>
          {up === true ? '↑ ' : up === false ? '↓ ' : ''}{delta}
        </div>
      )}
    </div>
  );
}

export default function DashboardArea() {
  const { user }         = useAuth();
  const { getKPI }       = useKPIConfig();
  const isRestricted     = user?.role === 'JEFE_AREA' || user?.role === 'USUARIO_OPERATIVO';

  const permissionToArea = Object.fromEntries(
    Object.entries(AREA_TO_PERMISSION).map(([areaKey, permId]) => [permId, areaKey])
  );
  const userPermisos = user?.permisos || [];
  const allowedAreas = userPermisos
    .filter(p => p.startsWith('area-'))
    .map(p => permissionToArea[p])
    .filter(Boolean);

  // Determinar el área inicial

  const initialArea = user?.area || (allowedAreas.length > 0 ? allowedAreas[0] : DEFAULT_AREA);

  // Determinar si el usuario puede cambiar de área

  const canSwitchArea = can(user?.role, 'verTodosTableros') || (!user?.area && allowedAreas.length > 1);

  const navigate = useNavigate();
  const [area, setArea]  = useState(initialArea);
  
  const [tab,  setTab]   = useState('kpis');
  const [urgenciasSearch, setUrgenciasSearch] = useState('');

  const [toast, setToast] = useState(null);
  const [dynamicReport, setDynamicReport] = useState(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [areaData, setAreaData] = useState({ kpis: [] });
  const [quirofanoError, setQuirofanoError] = useState(null);
  const quirofanoRequest = useRef(0);
  const [pbiModal, setPBIModal] = useState(null);
  const [showExportApi, setShowExportApi] = useState(false);

  const [globalFilters, setGlobalFilters] = useState({
    search: '',
    startDate: '',
    endDate: ''
  });
  const [applyTrigger, setApplyTrigger] = useState(0);
  const quirofanoQuery = new URLSearchParams(Object.entries({ startDate: globalFilters.startDate, endDate: globalFilters.endDate, search: globalFilters.search }).filter(([, value]) => value)).toString();
  const currentQuirofanoData = areaData.quirofanoQuery === quirofanoQuery ? areaData.rawQuirofanoData : null;
  const currentQuirofanoError = quirofanoError?.key === quirofanoQuery ? quirofanoError.message : null;

  const handleApplyFilters = () => {
    setApplyTrigger(prev => prev + 1);
  };

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    const controller = area === AREAS.QUIROFANO ? new AbortController() : null;
    const id = ++quirofanoRequest.current;
    fetchAreaData(controller?.signal, id);
    fetchAreaReport();
    return () => controller?.abort();
  }, [area, applyTrigger]);

  const fetchAreaData = async (quirofanoSignal, quirofanoId) => {
    setLoadingData(true);
    setAreaData(prev => ({ ...prev, kpis: [] }));  
    try {
      const token = sessionStorage.getItem('escandon_token');
      
      if (area === AREAS.URGENCIAS) {
         
        let url = `/api/dashboard/urgencias-nativo?`;
        if (globalFilters.startDate) url += `startDate=${globalFilters.startDate}&`;
        if (globalFilters.endDate) url += `endDate=${globalFilters.endDate}&`;
        if (globalFilters.search || urgenciasSearch) url += `search=${encodeURIComponent(globalFilters.search || urgenciasSearch)}&`;

        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const json = await res.json();
        if (json.ok) {
          const kpis = json.data.kpis;
          setAreaData({
            kpis: [
              { label: 'Atenciones Médicas', value: kpis.atenciones, delta: 'pacientes mes', up: null },
              { label: 'Egresos Mes', value: kpis.egresos, delta: 'altas registradas', up: null },
              { label: 'Estancia Promedio', value: `${kpis.estanciaHoras} hrs`, delta: 'tiempo por paciente', up: null },
              { label: 'Rotación Camas', value: kpis.rotacion, delta: 'pacientes por día', up: null },
            ],
            rawUrgenciasData: json.data  
          });
        }
      } else if (area === AREAS.QUIROFANO) {
        const query = new URLSearchParams();
        if (globalFilters.startDate) query.set('startDate', globalFilters.startDate);
        if (globalFilters.endDate) query.set('endDate', globalFilters.endDate);
        if (globalFilters.search) query.set('search', globalFilters.search);
        const queryKey = query.toString();
        setQuirofanoError(null);
        setAreaData(previous => ({ kpis: [], quirofanoQuery: queryKey, rawQuirofanoData: previous.quirofanoQuery === queryKey ? previous.rawQuirofanoData : null }));
        const res = await fetch(`/api/dashboard/quirofano-nativo?${queryKey}`, {
          headers: { Authorization: `Bearer ${token}` }, signal: quirofanoSignal
        });
        const json = await res.json();
        if (quirofanoSignal?.aborted || quirofanoId !== quirofanoRequest.current) return;
        if (!res.ok || !json.ok || !json.data) throw new Error(userMessage(json.error || 'No se pudo consultar el tablero de Quirófano.', res.status));
        setAreaData(previous => {
          const next = { ...json.data, sourceStatus: json.sourceStatus || json.data.sourceStatus };
          const saved = previous.quirofanoQuery === queryKey ? previous.rawQuirofanoData : null;
          const savedValue = saved?.kpisFinancieros?.ingresosSAP;
          const savedAvailable = savedValue != null && String(savedValue).trim() !== '' && Number.isFinite(Number(savedValue))
            && (saved.sourceStatus ? saved.sourceStatus.available === true : Number(savedValue) !== 0);
          if (next.sourceStatus?.available === false && savedAvailable) {
            next.kpisFinancieros = saved.kpisFinancieros;
            next.topMedicosIngresos = saved.topMedicosIngresos;
            next.topServiciosIngresos = saved.topServiciosIngresos;
            next.sourceStatus = { ...saved.sourceStatus, status: 'stale', available: true };
          }
          return { kpis: [], quirofanoQuery: queryKey, rawQuirofanoData: next };
        });
      } else if (area === AREAS.CONSULTA_EXTERNA) {
        let url = `/api/dashboard/consulta-externa-nativo?`;
        if (globalFilters.startDate) url += `startDate=${globalFilters.startDate}&`;
        if (globalFilters.endDate) url += `endDate=${globalFilters.endDate}&`;
        if (globalFilters.search) url += `search=${encodeURIComponent(globalFilters.search)}&`;

        console.log('[DashboardArea] Fetching CEX data from:', url);
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const json = await res.json();
        if (json.ok) {
          setAreaData({ kpis: [], rawConsultaData: json.data });
        }
      } else if (area === AREAS.UCI) {
        let url = `/api/dashboard/uci-nativo?`;
        if (globalFilters.startDate) url += `startDate=${globalFilters.startDate}&`;
        if (globalFilters.endDate) url += `endDate=${globalFilters.endDate}&`;
        if (globalFilters.search) url += `search=${encodeURIComponent(globalFilters.search)}&`;

        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const json = await res.json();
        if (json.ok) {
          setAreaData({ kpis: [], rawUciData: json.data });
        }
      } else if (area === AREAS.HOSPITALIZACION) {
        let url = `/api/dashboard/hospitalizacion-nativo?`;
        if (globalFilters.startDate) url += `startDate=${globalFilters.startDate}&`;
        if (globalFilters.endDate) url += `endDate=${globalFilters.endDate}&`;
        if (globalFilters.search) url += `search=${encodeURIComponent(globalFilters.search)}&`;

        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const json = await res.json();
        if (json.ok) {
          setAreaData({ kpis: [], rawHospitalizacionData: json.data });
        }
      } else if (area === AREAS.IMAGENOLOGIA || area === AREAS.LABORATORIO || area === AREAS.FARMACIA || area === AREAS.ASEGURADORAS || area === AREAS.CUNEROS) {
         
        setAreaData({ kpis: [] });
      } else {
        // Flujo normal para otras áreas
        const res = await fetch(`/api/dashboard/area/${area}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (json.ok) {
          const { camas, egresos } = json.data;
          setAreaData({
            kpis: [
              { label: 'Ocupación',         value: camas?.PctOcupacion != null ? `${camas.PctOcupacion}%` : null,  delta: camas?.TotalCamas ? `${camas.Ocupadas}/${camas.TotalCamas} camas` : null, up: null },
              { label: 'Egresos Mes',       value: egresos?.EgresosMes || null,       delta: 'altas registradas', up: null },
              { label: 'Estancia Promedio', value: egresos?.EstanciaPromedio != null ? `${egresos.EstanciaPromedio} d` : null, delta: 'días por paciente', up: null },
              { label: 'Rotación Camas',    value: egresos?.RotacionCamas || null,    delta: 'pacientes/cama', up: null },
            ],
            rawUrgenciasData: null
          });
        }
      }
    } catch (err) {
      if (area === AREAS.QUIROFANO) {
        if (!quirofanoSignal?.aborted && quirofanoId === quirofanoRequest.current) setQuirofanoError({ key: quirofanoQuery, message: userMessage(err.message) });
      } else console.error('[DashboardArea]', err);
    } finally {
      if (area !== AREAS.QUIROFANO || (!quirofanoSignal?.aborted && quirofanoId === quirofanoRequest.current)) setLoadingData(false);
    }
  };

  const fetchAreaReport = async () => {
    setLoadingReport(true);
    try {
      const token = sessionStorage.getItem('escandon_token');
      const res = await fetch(`/api/bi/available-reports`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const json = await res.json();
      if (json.ok) {
        const filtered = json.data.filter(r => {
          const dbArea = (r.AreaRequerida || r.area || r.areaRequerida || 'GLOBAL').trim().toUpperCase();
          const currentArea = area.trim().toUpperCase();
          return dbArea === currentArea;
        });
        
        const bestReport = filtered.sort((a, b) => (b.ConfigId || b.id || 0) - (a.ConfigId || a.id || 0)).find(r => 
          (r.PbixPath || r.pbixPath) || (r.LookerDashboard || r.lookerUrl) || (r.PowerBIReportId || r.pbiReportId) || (r.ThumbnailPath || r.thumbnailPath)
        ) || filtered[0];
        
        setDynamicReport(bestReport);
      }
    } catch (err) {
      console.error('Error fetching area report:', err);
    } finally {
      setLoadingReport(false);
    }
  };

  const cfg = AREA_CONFIG[area] || AREA_CONFIG[DEFAULT_AREA];
  const selectableAreas = Object.entries(AREAS_LABELS)
                .filter(([key]) => {
                   
                  if (key === AREAS.FARMACIA || key === AREAS.FINANZAS || key === AREAS.ALMACEN_GENERAL || key === AREAS.CARDIOLOGIA) {
                    return user?.area === key;
                  }
                  // ADMIN/DIRECTOR ven todas las áreas
                  if (can(user?.role, 'verTodosTableros')) return true;
                  // Usuario con área fija: solo su área
                  if (user?.area) return key === user.area;
                  // Usuario con permisos individuales: solo sus áreas permitidas
                  if (allowedAreas.length > 0) return allowedAreas.includes(key);
                   
                  return true;
                })
    .map(([value, label]) => ({ value, label, color: (AREA_CONFIG[value] || cfg).color }));

  return (
    <div id="dashboard-container" className="area-dashboard dashboard-view" data-area={area} style={areaPalette(cfg.color, cfg.chartAccent)}>
      {pbiModal && (
        <PBIModal {...pbiModal} onClose={() => setPBIModal(null)} />
      )}

      <header className="area-dashboard__header">
        <div className="area-dashboard__identity">
          <span className="area-dashboard__icon"><AreaIcon name={cfg.icon} /></span>
          <div>
            <p className="area-dashboard__eyebrow">Hospital Escandón · Tablero de área</p>
            <h1>{AREAS_LABELS[area] || 'Mi área'}</h1>
            <p className="area-dashboard__description">{cfg.description}</p>
          </div>
        </div>
        <div className="area-dashboard__actions">
          <div className="area-dashboard__exports">
            <ExportButton type="pdf" reportId={area} />
            {area === AREAS.URGENCIAS && (
              <ExportButton 
                type="excel" 
                directUrl={`/dashboard/export-excel?dashboard=urgencias&startDate=${globalFilters.startDate || ''}&endDate=${globalFilters.endDate || ''}&search=${encodeURIComponent(urgenciasSearch || globalFilters.search || '')}`} 
              />
            )}
            {area === AREAS.QUIROFANO && (
              <ExportButton 
                type="excel" 
                directUrl={`/dashboard/export-excel?dashboard=quirofano&startDate=${globalFilters.startDate || ''}&endDate=${globalFilters.endDate || ''}&search=${encodeURIComponent(globalFilters.search || '')}`} 
              />
            )}
          </div>
          <AreaSwitcher value={area} areas={selectableAreas} onChange={setArea} disabled={!canSwitchArea} />
        </div>
      </header>

      <GlobalFilterBar 
        variant="area"
        filters={globalFilters} 
        setFilters={setGlobalFilters} 
        onApply={handleApplyFilters} 
      />

      <div className="area-dashboard__section-heading">
        <h2>Resumen del área</h2>
        <p>Indicadores y actividad del periodo consultado</p>
      </div>

      {tab === 'kpis' && (
        <>
          {loadingData && !(area === AREAS.QUIROFANO && currentQuirofanoData) ? (
            <div style={{ background: 'var(--color-bg-white, white)', borderRadius: 14, padding: '5rem 3rem', textAlign: 'center', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '350px', marginTop: '1rem' }}>
              <PremiumLoader text={`Cargando información de ${(AREAS_LABELS[area] || 'tu área').toLowerCase()}...`} />
            </div>
          ) : (
            <>
              {area !== AREAS.QUIROFANO && area !== AREAS.CUNEROS && area !== AREAS.UCI && (
                <div className="area-metric-grid dashboard-metric-grid">
                  {areaData.kpis.map((kpi, i) => {
                    const dbKey = KPI_DB_MAP[kpi.label] || kpi.label.replace(/\s+/g, '_').toLowerCase();
                    const elementId = `area.${area.toLowerCase()}.${dbKey}`;
                    const kpiConfig = getKPI(elementId, kpi.label);
                    const displayName = kpiConfig?.nombre || kpi.label;
                    return (
                      <EditableKPIWrapper 
                        key={i} 
                        elementoId={elementId} 
                        isAdmin={user?.role === 'ADMIN'} 
                        onKPIClick={(url, title, url2, url3, multiPagina, hasJson) => setPBIModal({ url, title, url2, url3, multiPagina, reportId: elementId, hasJson })}
                        accentColor={cfg.color}
                      >
                        <AreaKPICard {...kpi} label={displayName} accent={cfg.color} />
                      </EditableKPIWrapper>
                    );
                  })}
                  
                  {/* KPIs ADICIONALES ASIGNADOS AL USUARIO (solo para no admins) */}
                  {user?.role !== 'ADMIN' && user?.role !== 'DIRECTOR' && user?.permisos?.map((permId, i) => {
                     
                    if (permId.startsWith(`area.${area.toLowerCase()}`)) return null;

                    if (Object.values(ROUTE_TO_PERMISSION).includes(permId)) return null;
                    if (Object.values(AREA_TO_PERMISSION).includes(permId)) return null;
                    if (permId.startsWith('ia-')) return null;
                    
                    const kpiConfig = getKPI(permId);
                    if (!kpiConfig) return null;
                    
                    return (
                      <EditableKPIWrapper 
                        key={`custom-${i}`} 
                        elementoId={permId} 
                        isAdmin={false} 
                        onKPIClick={(url, title, url2, url3, multiPagina, hasJson) => setPBIModal({ url, title, url2, url3, multiPagina, reportId: permId, hasJson })}
                        accentColor="#8b5cf6"
                      >
                        <div style={{ 
                          background: 'linear-gradient(135deg, white, #f3e8ff)', 
                          borderRadius: 12, padding: '1.25rem', 
                          boxShadow: '0 4px 6px rgba(139, 92, 246, 0.1)',
                          border: '1px solid rgba(139, 92, 246, 0.2)',
                          display: 'flex', flexDirection: 'column', gap: '0.5rem',
                          height: '100%'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#8b5cf6', fontSize: '1.2rem' }}>
                            <span>{kpiConfig.icono || '📊'}</span>
                            <span style={{ fontSize: '0.8rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Reporte Asignado</span>
                          </div>
                          <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#1e293b' }}>
                            {kpiConfig.nombre || kpiConfig.titulo || 'Reporte Personalizado'}
                          </div>
                          <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: 'auto' }}>
                            Haz clic para ver el reporte interactivo
                          </div>
                        </div>
                      </EditableKPIWrapper>
                    );
                  })}

                  {areaData.kpis.length === 0 && ![AREAS.URGENCIAS, AREAS.QUIROFANO, AREAS.CUNEROS, AREAS.UCI, AREAS.HOSPITALIZACION, AREAS.CONSULTA_EXTERNA, AREAS.IMAGENOLOGIA, AREAS.LABORATORIO, AREAS.FARMACIA, AREAS.ASEGURADORAS].includes(area) && (!user?.permisos || user.permisos.length === 0) && (
                    <div style={{ background:'white', borderRadius:12, padding:'3rem', textAlign:'center', border:'1px solid var(--border-color)', boxShadow:'var(--shadow-sm)' }}>
                      <PremiumLoader text="Cargando indicadores..." style={{ padding: '1rem' }} />
                    </div>
                  )}
                </div>
              )}

              {/* Renderizado Condicional del Dashboard Inferior */}
              {area === AREAS.URGENCIAS ? (
                <DashboardUrgenciasNativo 
                  data={areaData.rawUrgenciasData} 
                  searchFilter={urgenciasSearch}
                  setSearchFilter={setUrgenciasSearch}
                />
              ) : area === AREAS.QUIROFANO ? (
                <>
                  {loadingData && <p role="status" className="area-text-muted">Actualizando Quirófano… Se conserva la copia consultada para estos filtros.</p>}
                  {currentQuirofanoError && <div role="alert" className="area-panel dashboard-panel" style={{ color: 'var(--dash-text)', marginBottom: '1rem' }}>
                    <p>{currentQuirofanoError}</p>
                    {currentQuirofanoData && <p>Se conserva la última copia consultada para estos filtros.</p>}
                    <button type="button" onClick={handleApplyFilters}>Reintentar</button>
                  </div>}
                  {(!currentQuirofanoError || currentQuirofanoData) && <DashboardQuirofanoNativo data={currentQuirofanoData} />}
                </>
              ) : area === AREAS.IMAGENOLOGIA ? (
                <div>
                  <DashboardAuxiliaresNativo type="imagenologia" globalFilters={globalFilters} globalTrigger={applyTrigger} />
                </div>
              ) : area === AREAS.LABORATORIO ? (
                <div>
                  <DashboardAuxiliaresNativo type="laboratorio" globalFilters={globalFilters} globalTrigger={applyTrigger} />
                </div>
              ) : area === AREAS.FARMACIA ? (
                <div>
                  <DashboardAuxiliaresNativo type="farmacia" globalFilters={globalFilters} globalTrigger={applyTrigger} />
                </div>
              ) : area === AREAS.CUNEROS ? (
                <div>
                  <DashboardCunerosNativo globalFilters={globalFilters} globalTrigger={applyTrigger} />
                </div>
              ) : area === AREAS.UCI ? (
                <DashboardUciNativo 
                  data={areaData.rawUciData} 
                />
              ) : area === AREAS.HOSPITALIZACION ? (
                <DashboardHospitalizacionNativo 
                  data={areaData.rawHospitalizacionData} 
                />
              ) : area === AREAS.CONSULTA_EXTERNA ? (
                <DashboardConsultaExternaNativo 
                  data={areaData.rawConsultaData} 
                  searchFilter={globalFilters.search}
                  setSearchFilter={(val) => setGlobalFilters(prev => ({...prev, search: val}))}
                />
              ) : area === AREAS.ASEGURADORAS ? (
                <div>
                  <DashboardAseguradorasNativo globalFilters={globalFilters} globalTrigger={applyTrigger} />
                </div>
              ) : (
                <div style={{ marginTop: '2rem' }}>
                  <EmbeddedBI
                    report={dynamicReport}
                    loading={loadingReport}
                    onExportApi={() => setShowExportApi(true)}
                  />
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Avisos */}
      {toast && (
        <div style={{
          position:'fixed', bottom:30, left:'50%', transform:'translateX(-50%)',
          background:'var(--text-primary)', color:'white', padding:'0.75rem 1.5rem',
          borderRadius:100, fontSize:'0.82rem', fontWeight:600, boxShadow:'var(--shadow-lg)',
          zIndex:2000, display:'flex', alignItems:'center', gap:'0.5rem',
          fontFamily: 'var(--font-body)',
          animation: 'slideUpToast 300ms cubic-bezier(0.16, 1, 0.3, 1)'
        }}>
          <span style={{ color: 'var(--color-success)' }}>✓</span> {toast}
        </div>
      )}

    </div>
  );
}
