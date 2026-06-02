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
import { AREAS, AREAS_LABELS, can } from '../utils/rbac';

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
  const isRestricted     = user?.role === 'JEFE_AREA' || user?.role === 'USUARIO_OPERATIVO';
  const [area, setArea]  = useState(user?.area || DEFAULT_AREA);
  const [tab,  setTab]   = useState('kpis');
  const [modal, setModal] = useState(null); // 'incidencia', 'metas'
  const [toast, setToast] = useState(null);
  const [dynamicReport, setDynamicReport] = useState(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [areaData, setAreaData] = useState({ kpis: [] });
  const [pbiModal, setPBIModal] = useState(null);

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
          ]
        });
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
    <div style={{ maxWidth:1200, margin:'0 auto' }}>
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
        <PBIModal url={pbiModal.url} title={pbiModal.title} onClose={() => setPBIModal(null)} />
      )}

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
            <ExportButton type="pdf" reportId={area} compact />
            {dynamicReport && (dynamicReport.ExcelPath || dynamicReport.excelPath) && (
              <ExportButton 
                type="excel" 
                reportId={area} 
                directUrl={dynamicReport.ExcelPath || dynamicReport.excelPath} 
                compact 
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
          { key:'embedded', label:'📈 Tablero BI'     },
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
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:'1rem', marginBottom:'1.5rem' }}>
            {areaData.kpis.map((kpi, i) => (
              <EditableKPIWrapper 
                key={i} 
                elementoId={`area.${area.toLowerCase()}.${kpi.label.replace(/\s+/g, '_').toLowerCase()}`} 
                isAdmin={user?.role === 'ADMIN'} 
                onKPIClick={(url, title) => setPBIModal({ url, title })}
                accentColor={cfg.color}
              >
                <AreaKPICard {...kpi} accent={cfg.color} />
              </EditableKPIWrapper>
            ))}
            {areaData.kpis.length === 0 && (
              <p style={{ color:'var(--text-muted)', fontSize:'0.85rem', fontFamily: 'var(--font-body)' }}>Cargando indicadores...</p>
            )}
          </div>

          {/* Acciones rápidas */}
          {user?.role !== 'USUARIO_OPERATIVO' && (
            <div style={{
              background:'#FFFFFF',
              borderRadius:'16px',
              padding:'1.25rem 1.5rem',
              border:'1px solid rgba(0,70,135,0.05)',
              boxShadow:'var(--shadow-xs)'
            }}>
              <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'1rem' }}>
                <div style={{ width:4, height:18, background:cfg.color, borderRadius:2 }}/>
                <span style={{ fontFamily:"var(--font-display)", fontSize:'0.9rem', fontWeight:700, color: 'var(--text-primary)' }}>Acciones del Área</span>
              </div>
              <div style={{ display:'flex', gap:'0.75rem', flexWrap:'wrap' }}>
                {[
                  { label: 'Registrar Incidencia', action: () => setModal('incidencia') },
                  { label: 'Ver Histórico',        action: () => setTab('embedded') },
                  { label: 'Comparar con Meta',    action: () => setModal('metas') },
                  { label: 'Solicitar Análisis IA', action: () => window.dispatchEvent(new CustomEvent('toggle-aria')) },
                ].map(btn => (
                  <button
                    key={btn.label}
                    onClick={btn.action}
                    className="area-action-btn"
                    style={{
                      padding:      '0.55rem 1.1rem',
                      border:       `1.5px solid ${cfg.color}25`,
                      borderRadius:  '10px',
                      background:   `${cfg.color}05`,
                      color:         cfg.color,
                      fontFamily:  "var(--font-body)",
                      fontSize:    '0.8rem',
                      fontWeight:   600,
                      cursor:      'pointer',
                      transition:  'all 200ms ease',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background=`${cfg.color}10`; }}
                    onMouseLeave={e => { e.currentTarget.style.background=`${cfg.color}05`; }}
                  >{btn.label}</button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'embedded' && (
        loadingReport ? (
          <div style={{ height:500, display:'flex', alignItems:'center', justifyContent:'center', background:'white', borderRadius:14 }}>
            <p style={{ color:'var(--text-muted)', fontSize:'0.9rem', fontFamily: 'var(--font-body)' }}>Cargando tablero del área...</p>
          </div>
        ) : dynamicReport ? (
          (() => {
            const looker = dynamicReport.LookerDashboard || dynamicReport.lookerUrl || dynamicReport.LookerUrl;
            const pbi    = dynamicReport.PowerBIReportId || dynamicReport.pbiReportId || dynamicReport.reportId;
            const thumb  = dynamicReport.ThumbnailPath   || dynamicReport.thumbnailPath;
            const pbix   = dynamicReport.PbixPath        || dynamicReport.pbixPath;
            const title  = dynamicReport.Titulo          || dynamicReport.name || 'Reporte del Área';

            return (looker || pbi) ? (
              <EmbeddedBI reportId={looker || pbi} height="calc(100vh - 140px)" />
            ) : (thumb) ? (
              <div style={{ 
                height:600, display:'flex', flexDirection:'column', alignItems:'center', 
                justifyContent:'center', background:'#f8f9fa', borderRadius:14, 
                border:'1px solid rgba(0,70,135,0.08)', position:'relative', overflow:'hidden'
              }}>
                <img 
                   src={`/api/files/${thumb}`} 
                   alt="Previsualización" 
                   style={{ width:'100%', height:'100%', objectFit:'contain', background:'white' }} 
                />
              </div>
            ) : (pbix) ? (
               <div style={{ height:400, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', background:'white', borderRadius:14, border:'1px solid rgba(0,70,135,0.08)', boxShadow: 'var(--shadow-xs)' }}>
                 <div style={{ width:80, height:80, borderRadius:'50%', background:'rgba(0,70,135,0.05)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'2.5rem', marginBottom:'1.5rem' }}>📊</div>
                 <h3 style={{ fontFamily:"var(--font-display)", fontSize:'1.2rem', color:'var(--color-azul-fuerte)', margin:'0 0 0.5rem', fontWeight: 800 }}>{title}</h3>
                 <p style={{ color:'var(--text-muted)', fontSize:'0.85rem', textAlign:'center', maxWidth:350, fontFamily: 'var(--font-body)' }}>Reporte de Escritorio listo para descarga.</p>
               </div>
            ) : (
              <EmbeddedBI reportId={dynamicReport.ReporteId || dynamicReport.reportId} height="calc(100vh - 140px)" />
            )
          })()
        ) : (
          <div style={{ height:500, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', background:'white', borderRadius:14, border:'1px dashed rgba(0,70,135,0.18)' }}>
            <span style={{ fontSize:'2.25rem', marginBottom:'1rem' }}>📋</span>
            <p style={{ color:'var(--text-primary)', fontWeight:700, margin:0, fontFamily: 'var(--font-display)', fontSize: '0.95rem' }}>Sin tablero configurado para {AREAS_LABELS[area]}</p>
            <p style={{ color:'var(--text-muted)', fontSize:'0.82rem', marginTop:'0.35rem', fontFamily: 'var(--font-body)' }}>El administrador debe asignar un reporte al área en Configuración.</p>
          </div>
        )
      )}

      {/* ── Modales de Acción ── */}
      {modal && (
        <div style={{
          position:'fixed', top:0, left:0, right:0, bottom:0,
          background:'rgba(15, 26, 46, 0.4)', backdropFilter:'var(--glass-blur)',
          WebkitBackdropFilter: 'var(--glass-blur)',
          display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000,
          animation: 'fadeIn 200ms ease'
        }}>
          <div style={{
            background:'#FFFFFF', borderRadius:'18px', width:'90%', maxWidth:450,
            padding:'1.75rem 1.5rem 1.5rem', boxShadow:'var(--shadow-xl)',
            position:'relative', animation: 'slideUp 300ms cubic-bezier(0.16, 1, 0.3, 1)'
          }}>
            <button onClick={() => setModal(null)} style={{ position:'absolute', top:18, right:18, background:'none', border:'none', fontSize:'1.2rem', cursor:'pointer', color:'var(--text-muted)', display: 'flex', alignItems: 'center' }}>✕</button>
            
            {modal === 'incidencia' && (
              <div>
                <h3 style={{ fontFamily:"var(--font-display)", fontWeight: 800, margin:'0 0 0.85rem', color:cfg.color, fontSize: '1.25rem' }}>Registrar Incidencia</h3>
                <p style={{ fontSize:'0.85rem', color:'var(--text-secondary)', marginBottom:'1.25rem', fontFamily: 'var(--font-body)' }}>Complete los detalles del evento en {AREAS_LABELS[area]}.</p>
                <textarea placeholder="Descripción de la incidencia..." style={{ width:'100%', height:110, borderRadius:10, border:'1.5px solid #E2E8F0', padding:'0.75rem', fontSize:'0.85rem', marginBottom:'1.25rem', fontFamily:'var(--font-body)', outline:'none', resize: 'none' }} />
                <button 
                  onClick={() => { setModal(null); showToast('Incidencia registrada correctamente'); }}
                  style={{ width:'100%', padding:'0.75rem', background:cfg.color, color:'white', border:'none', borderRadius:10, fontWeight:700, fontFamily: 'var(--font-display)', cursor:'pointer', boxShadow: `0 4px 14px ${cfg.color}35` }}
                >Enviar Reporte</button>
              </div>
            )}

            {modal === 'metas' && (
              <div>
                <h3 style={{ fontFamily:"var(--font-display)", fontWeight: 800, margin:'0 0 1.25rem', color:cfg.color, fontSize: '1.25rem' }}>Comparativa con Metas</h3>
                <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>
                  {[
                    { l:'T. Atención', v:'18min', m:'20min', p:90 },
                    { l:'Ocupación', v:'93%', m:'85%', p:110, warn:true },
                    { l:'Altas', v:'41', m:'35', p:117 },
                  ].map(m => (
                    <div key={m.l}>
                      <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.75rem', fontWeight:700, marginBottom:6, fontFamily: 'var(--font-body)' }}>
                        <span style={{ color: 'var(--text-primary)' }}>{m.l}</span>
                        <span style={{ color: m.warn ? 'var(--color-danger)' : 'var(--color-success)', fontFamily: 'var(--font-mono)' }}>{m.v} / {m.m}</span>
                      </div>
                      <div style={{ height:7, background:'#F1F5F9', borderRadius:100, overflow:'hidden' }}>
                        <div style={{ width:`${Math.min(m.p, 100)}%`, height:'100%', background: m.warn ? 'var(--color-danger)' : cfg.color, borderRadius: 100 }} />
                      </div>
                    </div>
                  ))}
                </div>
                <button onClick={() => setModal(null)} style={{ width:'100%', marginTop:'1.75rem', padding:'0.65rem', border:`1.5px solid ${cfg.color}40`, color:cfg.color, background:'none', borderRadius:10, fontWeight:700, fontFamily: 'var(--font-display)', fontSize: '0.88rem', cursor:'pointer' }}>Cerrar</button>
              </div>
            )}
          </div>
        </div>
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
