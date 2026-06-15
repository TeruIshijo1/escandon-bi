/**
 * Estadisticas.jsx — Estadísticas Demográficas y por Proceso
 * Hospital Escandón BI Platform v4.0
 * DATOS REALES DESDE BD - Rediseño premium
 */
import { useState, useEffect } from 'react';
import { useAuth }  from '../context/AuthContext';
import { AREAS_LABELS } from '../utils/rbac';
import EditableKPIWrapper from '../components/shared/EditableKPIWrapper';
import PBIModal from '../components/shared/PBIModal';
import { useKPIConfig } from '../hooks/useKPIConfig';

export default function Estadisticas() {
  const { user }              = useAuth();
  const { getKPI }            = useKPIConfig();
  const [periodo, setPeriodo] = useState('mes');
  const [loading, setLoading] = useState(false);
  const [toast, setToast]     = useState(null);
  const [data, setData]       = useState({ stats: [], dx: [], areas: [], totalEgresos: 0, maxDx: 0, maxArea: 0 });
  const [pbiModal, setPBIModal] = useState(null);
  const handleKPIClick = (url, title, url2, url3, multiPagina) => setPBIModal({ url, title, url2, url3, multiPagina });

  const isRestricted = user?.role === 'JEFE_AREA';
  const areaLabel    = user?.area ? AREAS_LABELS[user.area] : '';

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    fetchRealStats();
  }, [periodo]);

  const fetchRealStats = async () => {
    setLoading(true);
    try {
      const token = sessionStorage.getItem('escandon_token');
      const res = await fetch(`/api/dashboard/stats?periodo=${periodo}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const json = await res.json();
      
      if (json.ok) {
        const { general, diagnosticos, servicios } = json.data;

        const newStats = [
          { id: 'stats.egresos_total',   label:`Egresos (${periodo})`, value: general.TotalEgresos, pct: 'Total real', up: null },
          { id: 'stats.promedio_edad',   label:'Promedio Edad', value: (general.PromedioEdad || 0) + ' a', pct: 'Basado en Pacientes', up: null },
          { id: 'stats.genero_femenino', label:'% Género Femenino', value: (general.pctFemenino || 0) + '%', pct: 'Distribución real', up: null },
          { id: 'stats.defunciones',     label:'Defunciones', value: general.Defunciones || 0, pct: 'Egresos mortandad', up: false },
          { id: 'stats.nacimientos',     label:'Nacimientos', value: general.Nacimientos || 0, pct: 'Servicio Cuneros', up: true },
          { id: 'stats.estancia_global', label:'Estancia Prom. Global', value: (general.EstanciaPromedio || 0) + ' d', pct: 'Días cama', up: null },
        ];

        setData({
          stats: newStats,
          dx: diagnosticos,
          areas: servicios.map(s => ({ 
            area: AREAS_LABELS[s.area] || s.area, 
            n: s.n, 
            color: s.area === 'URGENCIAS' ? 'var(--color-accent-warm)' : 'var(--color-azul-fuerte)' 
          })),
          totalEgresos: general.TotalEgresos,
          maxDx: diagnosticos[0]?.n || 1,
          maxArea: servicios[0]?.n || 1
        });
        
        showToast(`Datos reales actualizados: ${periodo}`);
      }
    } catch (err) {
      console.error('Error fetching stats:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth:1200, margin:'0 auto' }}>
      <style>{`
        .est-kpi-card:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-md) !important;
        }
      `}</style>

      {pbiModal && (
        <PBIModal {...pbiModal} onClose={() => setPBIModal(null)} />
      )}

      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, var(--color-azul-fuerte) 0%, #083b66 100%)',
        borderRadius: 20, padding: '1.5rem 2.25rem', marginBottom: '2rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        boxShadow: 'var(--shadow-md)',
        position: 'relative',
        overflow: 'hidden',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        {/* ECG Pattern */}
        <div style={{
          position: 'absolute',
          inset: 0,
          opacity: 0.04,
          pointerEvents: 'none',
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 120' width='800' height='120'%3E%3Cpath d='M0 60h120l10-15 15 10 10-25 15 80 10-65 15 15h120l10-15 15 10 10-25 15 80 10-65 15 15h200' fill='none' stroke='%23ffffff' stroke-width='2'/%3E%3C/svg%3E")`,
          backgroundSize: '450px 60px',
          backgroundPosition: 'left center',
        }}/>

        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.64rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.65)', marginBottom: '0.35rem' }}>
            {isRestricted ? `Estadísticas — ${areaLabel}` : 'Estadísticas Globales'}
          </div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: '1.65rem', fontWeight: 800, color: 'white', margin: 0, letterSpacing: '-0.01em' }}>
            Análisis Demográfico y por Proceso
          </h1>
        </div>

        {/* Filtro de período capsule style */}
        <div style={{
          display: 'flex',
          background: 'rgba(255, 255, 255, 0.12)',
          padding: '3px',
          borderRadius: '12px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          position: 'relative',
          zIndex: 1
        }}>
          {['semana','mes','trimestre','año'].map(p => {
            const isSelected = periodo === p;
            return (
              <button key={p} onClick={() => setPeriodo(p)} style={{
                padding:'0.45rem 1rem',
                background: isSelected ? '#FFFFFF' : 'transparent',
                border:'none',
                borderRadius: 9,
                color: isSelected ? 'var(--color-azul-fuerte)' : '#FFFFFF',
                fontFamily: "var(--font-display)",
                fontSize: '0.78rem',
                fontWeight: isSelected ? 700 : 500,
                cursor: 'pointer',
                transition: 'all 200ms ease',
                textTransform: 'capitalize',
                boxShadow: isSelected ? '0 2px 8px rgba(0,0,0,0.15)' : 'none',
              }}>{p}</button>
            );
          })}
        </div>
      </div>

      {/* KPIs demográficos */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:'1rem', marginBottom:'2rem', opacity: loading ? 0.55 : 1, transition: 'opacity 0.3s ease' }}>
        {data.stats.map(s => {
          const kpiConfig = getKPI(s.id);
          const displayName = kpiConfig?.nombre || s.label;
          const displayIcon = kpiConfig?.icono;
          const accentColor = s.up === true ? 'var(--color-verde-e)' : s.up === false ? 'var(--color-danger)' : 'var(--color-azul-fuerte)';
          return (
            <EditableKPIWrapper 
              key={s.id} 
              elementoId={s.id} 
              isAdmin={user?.role === 'ADMIN'} 
              onKPIClick={handleKPIClick}
              accentColor={accentColor}
              style={{height: '100%'}}
            >
              <div
                className="est-kpi-card"
                style={{
                  background:'#FFFFFF', borderRadius:'14px', padding:'1.1rem 1.25rem',
                  border:'1px solid rgba(0,70,135,0.05)',
                  borderLeft: `4px solid ${accentColor}`,
                  boxShadow:'var(--shadow-xs)',
                  height: '100%', boxSizing: 'border-box',
                  display: 'flex', flexDirection: 'column', justifyContent: 'center',
                  transition: 'all var(--transition-base)',
                  position: 'relative',
                }}
              >
                {displayIcon && (
                  <div style={{ position: 'absolute', right: 12, top: 12, fontSize: '1.2rem', opacity: 0.1, pointerEvents: 'none' }}>{displayIcon}</div>
                )}
                <div style={{ fontFamily: 'var(--font-display)', fontSize:'0.64rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--text-muted)', marginBottom:'0.35rem' }}>{displayName}</div>
                <div style={{ fontFamily:"var(--font-mono)", fontSize:'1.65rem', fontWeight:700, color:'var(--text-primary)', lineHeight:1, marginBottom:'0.25rem', letterSpacing: '-0.02em' }}>{s.value}</div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize:'0.72rem', fontWeight:600, color: s.up===true ? 'var(--color-verde-e)' : s.up===false ? 'var(--color-danger)' : 'var(--text-muted)' }}>
                  {s.up===true ? '▲ ' : s.up===false ? '▼ ' : '● '}{s.pct}
                </div>
              </div>
            </EditableKPIWrapper>
          );
        })}
      </div>

      {/* Diagnósticos top & Distribución */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(450px, 1fr))', gap:'1.5rem', opacity: loading ? 0.55 : 1, transition: 'opacity 0.3s ease' }}>
        
        {/* Diagnósticos top */}
        <EditableKPIWrapper elementoId="stats.top_diagnosticos" isAdmin={user?.role === 'ADMIN'} onKPIClick={handleKPIClick} accentColor="var(--color-azul-fuerte)">
          <div style={{ background:'#FFFFFF', borderRadius:'16px', padding:'1.5rem', border:'1px solid rgba(0,70,135,0.05)', boxShadow:'var(--shadow-xs)', height: '100%', boxSizing: 'border-box' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'1.25rem' }}>
              <div style={{ width:4, height:18, background:'var(--color-azul-fuerte)', borderRadius:2 }}/>
              <span style={{ fontFamily:"var(--font-display)", fontSize:'0.95rem', fontWeight:700, color: 'var(--text-primary)' }}>{getKPI('stats.top_diagnosticos')?.nombre || "Top Diagnósticos del Período"}</span>
            </div>
            {data.dx.length > 0 ? data.dx.map((d, i) => (
              <div key={d.dx} style={{ marginBottom:'0.875rem' }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'0.3rem', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize:'0.82rem', color:'var(--text-primary)', fontWeight:600, maxWidth:'75%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', color:'var(--text-muted)', marginRight:'0.5rem', fontSize: '0.78rem' }}>#{i+1}</span>{d.dx}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize:'0.8rem', fontWeight:700, color:'var(--color-azul-fuerte)', flexShrink:0 }}>{d.n} <span style={{ color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.72rem' }}>({d.pct}%)</span></span>
                </div>
                <div style={{ height:6, background:'rgba(0,70,135,0.04)', borderRadius:100, overflow:'hidden' }}>
                  <div style={{
                    height:'100%',
                    width:`${(d.n/data.maxDx)*100}%`,
                    background:`linear-gradient(90deg, var(--color-azul-fuerte), var(--color-azul-claro))`,
                    borderRadius:100,
                    transition:'width 0.8s ease',
                  }}/>
                </div>
              </div>
            )) : (
              <p style={{ textAlign:'center', color:'var(--text-muted)', fontSize:'0.85rem', padding:'2.5rem 0', fontFamily: 'var(--font-body)' }}>Sin datos de egresos en este periodo.</p>
            )}
          </div>
        </EditableKPIWrapper>

        {/* Distribución por área */}
        <EditableKPIWrapper elementoId="stats.egresos_servicio" isAdmin={user?.role === 'ADMIN'} onKPIClick={handleKPIClick} accentColor="var(--color-azul-claro)">
          <div style={{ background:'#FFFFFF', borderRadius:'16px', padding:'1.5rem', border:'1px solid rgba(0,70,135,0.05)', boxShadow:'var(--shadow-xs)', height: '100%', boxSizing: 'border-box' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'1.25rem' }}>
              <div style={{ width:4, height:18, background:'var(--color-azul-claro)', borderRadius:2 }}/>
              <span style={{ fontFamily:"var(--font-display)", fontSize:'0.95rem', fontWeight:700, color: 'var(--text-primary)' }}>{getKPI('stats.egresos_servicio')?.nombre || "Egresos por Servicio"}</span>
            </div>
            {data.areas.length > 0 ? data.areas.map(a => (
              <div key={a.area} style={{ marginBottom:'0.875rem' }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'0.3rem', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize:'0.82rem', color:'var(--text-primary)', fontWeight:600 }}>{a.area}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize:'0.8rem', fontWeight:700, color: a.color }}>{a.n} <span style={{ color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.72rem' }}>({((a.n/data.totalEgresos)*100).toFixed(1)}%)</span></span>
                </div>
                <div style={{ height:6, background:'rgba(0,70,135,0.04)', borderRadius:100, overflow:'hidden' }}>
                  <div style={{ height:'100%', width:`${(a.n/data.maxArea)*100}%`, background:a.color, borderRadius:100, transition:'width 0.8s ease' }}/>
                </div>
              </div>
            )) : (
              <p style={{ textAlign:'center', color:'var(--text-muted)', fontSize:'0.85rem', padding:'2.5rem 0', fontFamily: 'var(--font-body)' }}>Sin registros de servicios.</p>
            )}
          </div>
        </EditableKPIWrapper>
      </div>
      
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
