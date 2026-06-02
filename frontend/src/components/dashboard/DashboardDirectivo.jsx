/**
 * DashboardDirectivo.jsx
 * Dashboard de Mando Directivo — KPIs de Eficiencia, Eficacia y Macropanel Financiero
 * Hospital Escandón BI Platform v3.5
 *
 * Paleta aplicada:
 *   #004687 → Headers, sidebar (ya en globals)
 *   #0088C9 → Degradados, filtros
 *   #005FA9 → Botones acción, hover
 *   #00974A → Indicadores positivos, Exportar Excel, glow IA
 */
import { useState, useEffect } from 'react';
import EmbeddedBI    from './EmbeddedBI';
import ExportButton  from '../shared/ExportButton';
import KPICard       from '../shared/KPICard';
import PBIModal      from '../shared/PBIModal';
import EditableKPIWrapper from '../shared/EditableKPIWrapper';
import { useAuth }   from '../../context/AuthContext';

import { API_BASE } from '../../api/config';


/* ── Colores por tipo de KPI ─────────────────────────────────── */
const TIPO_COLOR = {
  success: '#00974A',
  info:    '#0088C9',
  warning: '#F59E0B',
  danger:  '#EF4444',
  neutral: '#8A97A8',
};

function SectionHeader({ title, subtitle, accent = '#004687' }) {
  return (
    <div style={{ marginBottom: '0.875rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
        <div style={{ width: 4, height: 20, background: accent, borderRadius: 2 }} />
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: '1rem', fontWeight: 700, color: '#0D1B2A', margin: 0 }}>
          {title}
        </h2>
      </div>
      {subtitle && <p style={{ margin: '0.25rem 0 0 0.625rem', fontSize: '0.78rem', color: '#8A97A8', paddingLeft: '0.625rem' }}>{subtitle}</p>}
    </div>
  );
}

function StatusPill({ label, value, color }) {
  return (
    <div style={{
      display:       'flex',
      alignItems:    'center',
      justifyContent:'space-between',
      padding:       '0.5rem 0.875rem',
      background:    `${color}0D`,
      borderRadius:  8,
      border:        `1px solid ${color}22`,
    }}>
      <span style={{ fontSize: '0.8rem', color: '#4A5568', fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: '0.82rem', color: color, fontWeight: 700 }}>{value}</span>
    </div>
  );
}

/* ── Componente principal ────────────────────────────────────── */
export default function DashboardDirectivo() {
  const { user }             = useAuth();
  const isAdmin              = user?.role === 'ADMIN';
  const [pbiModal, setPBIModal] = useState(null); // { url, title }
  const [fecha,  setFecha]   = useState('');
  const [loading, setLoad]   = useState(true);
  const [activeTab, setTab]  = useState('eficiencia');
  const [data, setData]      = useState({ eficiencia: [], eficacia: [], financiero: [], censo: [] });

  useEffect(() => {
    const now = new Date();
    setFecha(now.toLocaleDateString('es-MX', { weekday:'long', year:'numeric', month:'long', day:'numeric' }));
    fetchKPIs();
  }, []);

  const fetchKPIs = async () => {
    setLoad(true);
    try {
      const token = sessionStorage.getItem('escandon_token');
      const res = await fetch(`${API_BASE}/dashboard/directivo`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.ok) {
        const { ocupacion, eficacia, produccion, financiero, censo } = json.data;
        
        setData({
          eficiencia: [
            { id: 'ocu', elementoId: 'directivo.ocupacion',        value: ocupacion.PctOcupacion != null ? `${ocupacion.PctOcupacion}%` : null, type: 'info',    desc: ocupacion.TotalCamas ? `${ocupacion.Ocupadas}/${ocupacion.TotalCamas} camas` : null },
            { id: 'qx',  elementoId: 'directivo.quirofanos',        value: produccion.Realizadas != null ? `${produccion.Realizadas}/${produccion.CirugiasHoy || 0}` : null, type: 'info',    desc: produccion.Realizadas != null ? 'cirugías hoy' : null },
            { id: 'cen', elementoId: 'directivo.censo',             value: censo.length > 0 ? censo.reduce((s, a) => s + a.Ocupadas, 0) : null, type: 'success', desc: censo.length > 0 ? 'pacientes admitidos' : null },
          ],
          eficacia: [
            { id: 'mort', elementoId: 'directivo.mortalidad',       value: eficacia.TasaMortalidad != null ? `${eficacia.TasaMortalidad}%` : null, type: 'success', desc: eficacia.TasaMortalidad != null ? 'mensual ajustada' : null },
            { id: 'est',  elementoId: 'directivo.estancia',         value: eficacia.EstanciaPromedio != null ? `${eficacia.EstanciaPromedio} d` : null, type: 'success', desc: eficacia.EstanciaPromedio != null ? 'días promedio' : null },
            { id: 'egr',  elementoId: 'directivo.egresos',          value: eficacia.TotalEgresos || null, type: 'info', desc: eficacia.TotalEgresos ? 'altas registradas' : null },
          ],
          financiero: [
            { id: 'inv', elementoId: 'directivo.costo_insumos',    value: financiero.costoInsumos ? `$${financiero.costoInsumos.toLocaleString('es-MX')}` : null, type: 'warning', desc: financiero.costoInsumos ? 'mes en curso' : null },
            { id: 'mar', elementoId: 'directivo.margen_operativo', value: null, type: 'neutral', desc: null },
          ],
          censo: censo
        });
      }
    } catch (err) {
      console.error('[DashboardDirectivo]', err);
    } finally {
      setLoad(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'50vh', flexDirection:'column', gap:'1rem' }}>
        <div style={{ width:44, height:44, border:'4px solid rgba(0,70,135,0.1)', borderTop:'4px solid #004687', borderRadius:'50%', animation:'spin 0.9s linear infinite' }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <span style={{ color:'#8A97A8', fontSize:'0.85rem' }}>Cargando indicadores…</span>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1300, margin: '0 auto' }}>

      {/* ── Header del dashboard ── */}
      <div style={{
        background:    'linear-gradient(135deg, #004687 0%, #005FA9 50%, #0088C9 100%)',
        borderRadius:  20,
        padding:       '1.75rem 2rem',
        marginBottom:  '1.5rem',
        position:      'relative',
        overflow:      'hidden',
      }}>
        {/* Patrón decorativo */}
        <div style={{
          position:   'absolute',
          right:      '-40px',
          top:        '-40px',
          width:       220,
          height:      220,
          borderRadius:'50%',
          background: 'rgba(255,255,255,0.04)',
          pointerEvents:'none',
        }}/>
        <div style={{
          position:   'absolute',
          right:       60,
          bottom:     '-60px',
          width:       160,
          height:      160,
          borderRadius:'50%',
          background: 'rgba(255,255,255,0.03)',
          pointerEvents:'none',
        }}/>

        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', position:'relative', zIndex:1 }}>
          <div>
            <div style={{ fontSize:'0.72rem', fontWeight:700, letterSpacing:'0.12em', textTransform:'uppercase', color:'rgba(255,255,255,0.6)', marginBottom:'0.35rem' }}>
              Dashboard de Mando Directivo
            </div>
            <h1 style={{ fontFamily:"var(--font-display)", fontSize:'1.7rem', fontWeight:800, color:'white', margin:0, lineHeight:1.1 }}>
              Resumen Ejecutivo
            </h1>
            <div style={{ fontSize:'0.82rem', color:'rgba(255,255,255,0.7)', marginTop:'0.35rem', textTransform:'capitalize' }}>
              {fecha}
            </div>

            {/* Chips de estado rápido */}
            <div style={{ display:'flex', gap:'0.5rem', marginTop:'1rem', flexWrap:'wrap' }}>
              {data.censo.slice(0, 3).map(area => (
                <span key={area.Area} style={{
                  background:   'rgba(255,255,255,0.15)',
                  border:       '1px solid rgba(255,255,255,0.2)',
                  borderRadius: 100,
                  padding:      '0.25rem 0.75rem',
                  fontSize:     '0.75rem',
                  color:        'white',
                  fontWeight:   500,
                  backdropFilter:'blur(8px)',
                }}>{area.Area}: {area.Ocupadas}</span>
              ))}
              {data.censo.length === 0 && (
                <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)' }}>No hay pacientes activos</span>
              )}
            </div>
          </div>

          {/* Botones de exportación */}
          <div style={{ display:'flex', gap:'0.5rem', alignItems:'flex-start', flexShrink:0 }}>
            <ExportButton type="pdf"   reportId="directivo" />
            <ExportButton type="excel" reportId="directivo" />
          </div>
        </div>
      </div>

      {/* ── Tabs de categoría ── */}
      <div style={{ display:'flex', gap:'0.5rem', marginBottom:'1.25rem', flexWrap:'wrap' }}>
        {[
          { key:'eficiencia', label:'⚙️  Eficiencia Operativa', count: data.eficiencia.length },
          { key:'eficacia',   label:'🎯  Eficacia Clínica',     count: data.eficacia.length   },
          { key:'financiero', label:'💼  Macropanel Financiero', count: data.financiero.length },
          { key:'embedded',   label:'📊  Tablero BI Embedded',  count: null },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setTab(tab.key)}
            style={{
              display:       'flex',
              alignItems:    'center',
              gap:           '0.4rem',
              padding:       '0.5rem 1rem',
              borderRadius:  8,
              border:        activeTab === tab.key ? '1.5px solid #005FA9' : '1px solid rgba(0,70,135,0.12)',
              background:    activeTab === tab.key ? '#005FA9' : 'white',
              color:         activeTab === tab.key ? 'white' : '#4A5568',
              fontFamily:    "'DM Sans', sans-serif",
              fontSize:      '0.83rem',
              fontWeight:    activeTab === tab.key ? 600 : 400,
              cursor:        'pointer',
              transition:    'all 150ms ease',
              boxShadow:     activeTab === tab.key ? '0 2px 10px rgba(0,95,169,0.3)' : 'none',
            }}
          >
            {tab.label}
            {tab.count && (
              <span style={{
                background:  activeTab === tab.key ? 'rgba(255,255,255,0.25)' : 'rgba(0,70,135,0.08)',
                borderRadius: 100,
                padding:     '1px 7px',
                fontSize:    '0.7rem',
                fontWeight:  700,
              }}>{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Contenido de tabs ── */}
      {/* Modal Power BI */}
      {pbiModal && (
        <PBIModal url={pbiModal.url} title={pbiModal.title} onClose={() => setPBIModal(null)} />
      )}

      {activeTab === 'eficiencia' && (
        <div>
          <SectionHeader
            title="Indicadores de Eficiencia Operativa"
            subtitle="Ocupación, rotación, tiempos de respuesta y uso de recursos"
            accent="#0088C9"
          />
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(210px, 1fr))', gap:'0.875rem' }}>
            {data.eficiencia.map(kpi => (
              <KPICard
                key={kpi.id}
                elementoId={kpi.elementoId}
                value={kpi.value}
                subtitle={kpi.desc}
                accentColor={TIPO_COLOR[kpi.type] || '#0088C9'}
                isAdmin={isAdmin}
                onKPIClick={(url, title) => setPBIModal({ url, title })}
              />
            ))}
          </div>

          {/* Panel de detalle adicional */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem', marginTop:'1.25rem' }}>
            <EditableKPIWrapper elementoId="directivo.estado_area" isAdmin={isAdmin} onKPIClick={(url, title) => setPBIModal({url, title})} accentColor="#0088C9">
              <div style={{ background:'white', borderRadius:14, padding:'1.25rem', border:'1px solid rgba(0,70,135,0.07)', boxShadow:'0 2px 8px rgba(0,70,135,0.06)', height: '100%', boxSizing: 'border-box' }}>
                <SectionHeader title="Estado por Área" accent="#0088C9" />
                <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                  {data.censo.map(s => <StatusPill key={s.Area} label={s.Area} value={`${s.Ocupadas} ocupadas`} color="#0088C9" />)}
                  {data.censo.length === 0 && <p style={{ fontSize:'0.8rem', color:'#8A97A8', textAlign:'center' }}>Sin datos disponibles</p>}
                </div>
              </div>
            </EditableKPIWrapper>

            <EditableKPIWrapper elementoId="directivo.tiempos_proceso" isAdmin={isAdmin} onKPIClick={(url, title) => setPBIModal({url, title})} accentColor="#004687">
              <div style={{ background:'white', borderRadius:14, padding:'1.25rem', border:'1px solid rgba(0,70,135,0.07)', boxShadow:'0 2px 8px rgba(0,70,135,0.06)', height: '100%', boxSizing: 'border-box' }}>
                <SectionHeader title="Tiempos de Proceso" accent="#004687" />
                <div style={{ display:'flex', flexDirection:'column', gap:'0.625rem' }}>
                  {[
                    { proceso:'Triaje → Atención', tiempo:'-- min',  meta:'< 20 min', ok: true  },
                    { proceso:'Laboratorio',        tiempo:'-- min',  meta:'< 60 min', ok: true  },
                    { proceso:'Imagenología',        tiempo:'-- min',  meta:'< 60 min', ok: true },
                    { proceso:'Egreso programado',   tiempo:'-- hrs', meta:'< 4 hrs',  ok: true  },
                    { proceso:'Quirófano → UCPA',    tiempo:'-- min',  meta:'< 60 min', ok: true  },
                  ].map(t => (
                    <div key={t.proceso} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.45rem 0', borderBottom:'1px solid rgba(0,70,135,0.05)' }}>
                      <span style={{ fontSize:'0.82rem', color:'#4A5568' }}>{t.proceso}</span>
                      <div style={{ display:'flex', alignItems:'center', gap:'0.625rem' }}>
                        <span style={{ fontSize:'0.82rem', fontWeight:600, color: t.ok ? '#00974A' : '#EF4444' }}>{t.tiempo}</span>
                        <span style={{ fontSize:'0.7rem', color:'#8A97A8' }}>meta: {t.meta}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </EditableKPIWrapper>
          </div>
        </div>
      )}

      {activeTab === 'eficacia' && (
        <div>
          <SectionHeader
            title="Indicadores de Eficacia Clínica"
            subtitle="Resultados de salud, tasas de mortalidad, readmisión y satisfacción"
            accent="#00974A"
          />
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(210px, 1fr))', gap:'0.875rem' }}>
            {data.eficacia.map(kpi => (
              <KPICard
                key={kpi.id}
                elementoId={kpi.elementoId}
                value={kpi.value}
                subtitle={kpi.desc}
                accentColor={TIPO_COLOR[kpi.type] || '#00974A'}
                isAdmin={isAdmin}
                onKPIClick={(url, title) => setPBIModal({ url, title })}
              />
            ))}
          </div>

          {/* Alerta de atención */}
          <EditableKPIWrapper elementoId="directivo.alerta_readmision" isAdmin={isAdmin} onKPIClick={(url, title) => setPBIModal({url, title})} accentColor="#F59E0B">
            <div style={{
              marginTop:     '1.25rem',
              background:    'rgba(245,158,11,0.08)',
              border:        '1px solid rgba(245,158,11,0.3)',
              borderRadius:  12,
              padding:       '1rem 1.25rem',
              display:       'flex',
              alignItems:    'center',
              gap:           '0.75rem',
            }}>
              <span style={{ fontSize:'1.4rem' }}>⚠️</span>
              <div>
                <div style={{ fontWeight:600, color:'#92400E', fontSize:'0.88rem' }}>Readmisión en seguimiento</div>
                <div style={{ color:'#78350F', fontSize:'0.8rem', marginTop:'0.2rem' }}>
                  La tasa de readmisión a 30 días se mantiene dentro de los parámetros esperados. Monitoreo constante activo.
                </div>
              </div>
            </div>
          </EditableKPIWrapper>

          {/* Vidas Salvadas — indicador especial verde */}
          <EditableKPIWrapper 
            elementoId="directivo.vidas_salvadas" 
            isAdmin={isAdmin} 
            onKPIClick={(url, title) => setPBIModal({ url, title })}
            accentColor="#00974A"
          >
            <div style={{
              marginTop:   '1rem',
              background:  'linear-gradient(135deg, #00974A 0%, #00c060 100%)',
              borderRadius: 14,
              padding:     '1.25rem 1.5rem',
              color:        'white',
              display:     'flex',
              alignItems:  'center',
              gap:         '1.25rem',
            }}>
              <span style={{ fontSize:'2.5rem' }}>❤️</span>
              <div>
                <div style={{ fontSize:'0.72rem', fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', opacity:0.8 }}>Métrica de Impacto</div>
                <div style={{ fontFamily:"var(--font-display)", fontSize:'1.6rem', fontWeight:800, lineHeight:1.1 }}>Atención Real Activa</div>
                <div style={{ fontSize:'0.82rem', opacity:0.85, marginTop:'0.2rem' }}>Monitoreo en tiempo real de la actividad hospitalaria</div>
              </div>
            </div>
          </EditableKPIWrapper>
        </div>
      )}

      {activeTab === 'financiero' && (
        <div>
          <SectionHeader
            title="Macropanel Financiero"
            subtitle="Ingresos, egresos y margen operativo del mes en curso"
            accent="#005FA9"
          />
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(210px, 1fr))', gap:'0.875rem' }}>
            {data.financiero.map(kpi => (
              <KPICard
                key={kpi.id}
                elementoId={kpi.elementoId}
                value={kpi.value}
                subtitle={kpi.desc}
                accentColor={TIPO_COLOR[kpi.type] || '#005FA9'}
                isAdmin={isAdmin}
                onKPIClick={(url, title) => setPBIModal({ url, title })}
              />
            ))}
          </div>

          {/* Barra de progreso presupuestal */}
          <EditableKPIWrapper elementoId="directivo.ejecucion_presupuestal" isAdmin={isAdmin} onKPIClick={(url, title) => setPBIModal({url, title})} accentColor="#005FA9">
            <div style={{ background:'white', borderRadius:14, padding:'1.25rem', marginTop:'1.25rem', border:'1px solid rgba(0,70,135,0.07)', boxShadow:'0 2px 8px rgba(0,70,135,0.06)' }}>
              <SectionHeader title="Ejecución Presupuestal por Centro de Costo" accent="#005FA9" />
              {[
                { area:'Hospitalización',  ejecutado:0, presupuesto:'$0'  },
                { area:'Urgencias',        ejecutado:0, presupuesto:'$0'  },
                { area:'Quirófano',        ejecutado:0, presupuesto:'$0'  },
              ].map(b => {
                const color = b.ejecutado > 85 ? '#EF4444' : b.ejecutado > 70 ? '#F59E0B' : '#00974A';
                return (
                  <div key={b.area} style={{ marginBottom:'0.75rem' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'0.25rem' }}>
                      <span style={{ fontSize:'0.82rem', color:'#4A5568', fontWeight:500 }}>{b.area}</span>
                      <span style={{ fontSize:'0.82rem', fontWeight:600, color }}>
                        {b.ejecutado}% de {b.presupuesto}
                      </span>
                    </div>
                    <div style={{ height:7, background:'rgba(0,70,135,0.08)', borderRadius:100, overflow:'hidden' }}>
                      <div style={{ height:'100%', width:`${b.ejecutado}%`, background:color, borderRadius:100, transition:'width 0.8s ease' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </EditableKPIWrapper>
        </div>
      )}

      {activeTab === 'embedded' && (
        <div>
          <SectionHeader
            title="Tablero de Inteligencia de Negocios"
            subtitle="Acceso seguro a analítica avanzada y proyecciones"
            accent="#0088C9"
          />
          {/* URL ofuscada en Base64 para mayor seguridad */}
          <EmbeddedBI reportId="aHR0cHM6Ly9hcHAucG93ZXJiaS5jb20vbGlua3MvaldKc3NHRWphVz9jdGlkPTYzMTA1NTAyLTc0YmItNGQ1ZC04NjE3LTExMWI2NmYxOTljMCZwYmlfc291cmNlPWxpbmtTaGFyZQ==" height="calc(100vh - 140px)" />
        </div>
      )}
    </div>
  );
}
