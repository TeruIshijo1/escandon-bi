/**
 * DashboardArea.jsx — Tablero por Área Hospitalaria
 * Hospital Escandón BI Platform v4.0
 * Rediseño premium con identidad de marca y micro-interacciones
 */
import { useState, useEffect } from 'react';
import { useAuth }     from '../context/AuthContext';
import EmbeddedBI      from '../components/dashboard/EmbeddedBI';
import ExportButton    from '../components/shared/ExportButton';
import EditableKPIWrapper from '../components/shared/EditableKPIWrapper';
import PBIModal        from '../components/shared/PBIModal';
import ExportApiModal  from '../components/shared/ExportApiModal';
import PremiumLoader   from '../components/shared/PremiumLoader';
import DashboardUrgenciasNativo from '../components/dashboard/DashboardUrgenciasNativo';
import DashboardQuirofanoNativo from '../components/dashboard/DashboardQuirofanoNativo';
import { AREAS, AREAS_LABELS, can } from '../utils/rbac';
import { useKPIConfig } from '../hooks/useKPIConfig';

const KPI_DB_MAP = {
  'Ocupación': 'ocupacion',
  'Egresos Mes': 'egresos',
  'Estancia Promedio': 'estancia',
  'Rotación Camas': 'rotacion_camas'
};

const API_BASE = '/api';

/* ── Config visual por área ──────────────────────────────── */
const AREA_CONFIG = {
  [AREAS.QUIROFANO]: { icon:'🔪', color:'#004687' },
  [AREAS.UCI]:       { icon:'❤️‍🩺', color:'#EF4444' },
  [AREAS.URGENCIAS]: { icon:'🚨', color:'#E8853D' }, // Warm accent for urgencias
  [AREAS.CUNEROS]:   { icon:'👶', color:'#0088C9' },
  [AREAS.IMAGENOLOGIA]: { icon:'🔬', color:'#8B5CF6' },
  [AREAS.LABORATORIO]:  { icon:'🧪', color:'#10B981' },
  [AREAS.CONSULTA_EXTERNA]: { icon:'🩺', color:'#0088C9' },
  [AREAS.CARDIOLOGIA]:      { icon:'❤️', color:'#EF4444' },
  [AREAS.HOSPITALIZACION]:  { icon:'🛏️', color:'#005FA9' },
};

const DEFAULT_AREA = AREAS.URGENCIAS;

/* ── Sub-componente KPI mini ─────────────────────────────── */
function AreaKPICard({ label, value, delta, up, accent }) {
  const deltaColor = up === true ? 'var(--color-verde-e)' : up === false ? 'var(--color-danger)' : 'var(--text-muted)';
  const arrow      = up === true ? '▲ ' : up === false ? '▼ ' : '● ';
  return (
    <div style={{
      background:   '#FFFFFF',
      borderRadius:  '14px',
      padding:      '1.1rem 1.25rem',
      border:       '1px solid rgba(0,70,135,0.05)',
      borderLeft:   `4px solid ${accent}`,
      boxShadow:    'var(--shadow-xs)',
      position:     'relative',
      overflow:     'hidden',
      transition:   'all var(--transition-base)',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      minHeight: value == null ? '80px' : 'auto'
    }}
      className="area-kpi-card"
    >
      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize:'0.64rem',
        fontWeight:700,
        textTransform:'uppercase',
        letterSpacing:'0.06em',
        color:'var(--text-muted)',
        marginBottom: value != null ? '0.35rem' : 0
      }}>{label}</div>
      {value != null && (
        <div style={{
          fontFamily:"var(--font-mono)",
          fontSize:'1.65rem',
          fontWeight:700,
          color:'var(--text-primary)',
          lineHeight:1,
          marginBottom:'0.3rem',
          letterSpacing: '-0.02em',
        }}>{value}</div>
      )}
      {value != null && delta != null && (
        <div style={{
          fontFamily: 'var(--font-body)',
          fontSize:'0.72rem',
          color:deltaColor,
          fontWeight:600
        }}>{arrow}{delta}</div>
      )}
    </div>
  );
}

/* ── Componente principal ────────────────────────────────── */
export default function DashboardArea() {
  const { user }         = useAuth();
  const { getKPI }       = useKPIConfig();
  const isRestricted     = user?.role === 'JEFE_AREA' || user?.role === 'USUARIO_OPERATIVO';
  const [area, setArea]  = useState(user?.area || DEFAULT_AREA);
  const [tab,  setTab]   = useState('kpis');
  const [urgenciasSearch, setUrgenciasSearch] = useState('');

  const [toast, setToast] = useState(null);
  const [dynamicReport, setDynamicReport] = useState(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [areaData, setAreaData] = useState({ kpis: [] });
  const [pbiModal, setPBIModal] = useState(null);
  const [showExportApi, setShowExportApi] = useState(false);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    fetchAreaData();
    fetchAreaReport();
  }, [area]);

  const fetchAreaData = async () => {
    try {
      const token = sessionStorage.getItem('escandon_token');
      
      if (area === AREAS.URGENCIAS) {
        // Para Urgencias usamos el endpoint nativo especializado
        const res = await fetch('/api/dashboard/urgencias-nativo', {
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
            rawUrgenciasData: json.data // Guardamos la data completa para pasarla al DashboardUrgenciasNativo
          });
        }
      } else if (area === AREAS.QUIROFANO) {
        // Endpoint nativo para Quirófanos
        const res = await fetch('/api/dashboard/quirofano-nativo', {
          headers: { Authorization: `Bearer ${token}` }
        });
        const json = await res.json();
        if (json.ok) {
          setAreaData({
            kpis: [], // No renderizamos las tarjetas estandar, usaremos custom cards en el nativo
            rawQuirofanoData: json.data
          });
        }
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
      console.error('[DashboardArea]', err);
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

  return (
    <div id="dashboard-container" style={{ maxWidth:1200, margin:'0 auto' }}>
      <style>{`
        .area-kpi-card:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-md) !important;
        }
        .area-action-btn:hover {
          transform: translateY(-1.5px);
          box-shadow: var(--shadow-xs);
        }
        .custom-select-area::-ms-expand {
          display: none;
        }
      `}</style>

      {pbiModal && (
        <PBIModal {...pbiModal} onClose={() => setPBIModal(null)} />
      )}
      {/* <ExportApiModal isOpen={showExportApi} onClose={() => setShowExportApi(false)} /> */ }

      {/* Header Panel */}
      <div style={{ 
        background: `linear-gradient(135deg, ${cfg.color} 0%, #0d253f 100%)`, 
        borderRadius: '20px', padding: '1.75rem 2.25rem', color: 'white', marginBottom: '2rem', 
        boxShadow: 'var(--shadow-md)', position: 'relative', overflow: 'hidden',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        flexWrap: 'wrap', gap: '1.25rem'
      }}>
        {/* ECG visual details */}
        <div style={{
          position: 'absolute',
          inset: 0,
          opacity: 0.04,
          pointerEvents: 'none',
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 120' width='800' height='120'%3E%3Cpath d='M0 60h120l10-15 15 10 10-25 15 80 10-65 15 15h120l10-15 15 10 10-25 15 80 10-65 15 15h200' fill='none' stroke='%23ffffff' stroke-width='2'/%3E%3C/svg%3E")`,
          backgroundSize: '450px 60px',
          backgroundPosition: 'left center',
        }}/>

        {/* Título */}
        <div style={{ position:'relative', zIndex:1 }}>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize:'0.64rem',
            fontWeight:700,
            letterSpacing:'0.12em',
            textTransform:'uppercase',
            color:'rgba(255,255,255,0.65)',
            marginBottom:'0.35rem'
          }}>
            Plataforma HE-BI · Gestión de Área
          </div>
          <h1 style={{
            fontFamily:"var(--font-display)",
            fontSize:'1.65rem',
            fontWeight:800,
            color:'white',
            margin:0,
            display:'flex',
            alignItems:'center',
            gap:'0.75rem',
            letterSpacing: '-0.01em'
          }}>
            <span style={{ fontSize:'1.8rem' }}>{cfg.icon}</span>
            {AREAS_LABELS[area]}
          </h1>
        </div>

        {/* Acciones */}
        <div style={{ display:'flex', gap:'0.875rem', alignItems:'center', position:'relative', zIndex:1, flexWrap: 'wrap' }}>
          
          {/* Acciones de Exportación */}
          <div style={{ display:'flex', gap:'0.5rem', marginRight:'0.25rem', paddingRight:'0.875rem', borderRight:'1px solid rgba(255,255,255,0.18)' }}>
            <ExportButton type="pdf" reportId={area} />
            {area === AREAS.URGENCIAS && (
              <ExportButton 
                type="excel" 
                directUrl={`/dashboard/export-excel?dashboard=urgencias&search=${encodeURIComponent(urgenciasSearch)}`} 
              />
            )}
            {area === AREAS.QUIROFANO && (
              <ExportButton 
                type="excel" 
                directUrl={`/dashboard/export-excel?dashboard=quirofano`} 
              />
            )}
          </div>

          {/* Selector de Área */}
          <div style={{ position: 'relative' }}>
            <select 
              value={area} 
              onChange={(e) => setArea(e.target.value)}
              disabled={!can(user?.role, 'verTodosTableros')}
              className="custom-select-area"
              style={{
                padding: '0.55rem 2.25rem 0.55rem 1rem',
                borderRadius: '12px',
                border: '1.5px solid rgba(255,255,255,0.25)',
                background: 'rgba(255,255,255,0.15)',
                color: 'white',
                fontSize: '0.82rem',
                fontWeight: 700,
                fontFamily: 'var(--font-display)',
                outline: 'none',
                cursor: can(user?.role, 'verTodosTableros') ? 'pointer' : 'not-allowed',
                minWidth: 160,
                appearance: 'none',
                WebkitAppearance: 'none',
              }}
            >
              {Object.entries(AREAS_LABELS).map(([key, label]) => (
                <option key={key} value={key} style={{ color:'var(--text-primary)', background: '#FFFFFF', fontWeight: 600 }}>{label}</option>
              ))}
            </select>
            <span style={{
              position: 'absolute',
              right: '0.875rem',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'white',
              fontSize: '0.6rem',
              pointerEvents: 'none',
            }}>▼</span>
          </div>
        </div>
      </div>

      {/* Sliding Underline Tabs */}
      <div style={{
        display: 'flex',
        gap: '2rem',
        marginBottom: '1.5rem',
        borderBottom: '1px solid rgba(0, 70, 135, 0.08)',
        paddingBottom: '2px',
        position: 'relative',
      }}>
        {[
          { key:'kpis',     label:'📊 Indicadores'    },
        ].map(t => {
          const isActive = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                padding: '0.6rem 0.25rem',
                border: 'none',
                background: 'none',
                color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                fontFamily: "var(--font-display)",
                fontSize: '0.88rem',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 200ms ease',
                position: 'relative',
              }}
            >
              {t.label}
              <span style={{
                position: 'absolute',
                bottom: -2,
                left: 0,
                right: 0,
                height: 3,
                background: isActive ? cfg.color : 'transparent',
                borderRadius: '3px 3px 0 0',
                transition: 'background-color 200ms ease',
              }}/>
            </button>
          );
        })}
      </div>

      {/* KPIs Grid */}
      {tab === 'kpis' && (
        <>
          {area !== AREAS.QUIROFANO && (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:'1rem', marginBottom:'1.5rem' }}>
              {areaData.kpis.map((kpi, i) => {
                const dbKey = KPI_DB_MAP[kpi.label] || kpi.label.replace(/\s+/g, '_').toLowerCase();
                const elementId = `area.${area.toLowerCase()}.${dbKey}`;
                const kpiConfig = getKPI(elementId);
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
                // No duplicar los KPIs que ya se muestran en el área actual
                if (permId.startsWith(`area.${area.toLowerCase()}`)) return null;
                
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

              {areaData.kpis.length === 0 && (!user?.permisos || user.permisos.length === 0) && (
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
            <DashboardQuirofanoNativo 
              data={areaData.rawQuirofanoData} 
            />
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





      {/* Toast Notification */}
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
