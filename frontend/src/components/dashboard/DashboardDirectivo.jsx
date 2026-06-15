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
import ExportApiModal from '../shared/ExportApiModal';
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


export default function DashboardDirectivo() {
  const { user }             = useAuth();
  const [fecha,  setFecha]   = useState('');
  const [loading, setLoad]   = useState(true);
  const [activeTab, setTab]  = useState('eficiencia');
  const [data, setData]      = useState({ censo: [] });
  const [showExportApi, setShowExportApi] = useState(false);

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
      {/* <ExportApiModal isOpen={showExportApi} onClose={() => setShowExportApi(false)} /> */}

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
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
        gap: '0.75rem',
        marginBottom: '1.5rem',
        width: '100%'
      }}>
        {[
          { key:'eficiencia', label:'⚙️  Eficiencia Operativa' },
          { key:'eficacia',   label:'🎯  Eficacia Clínica' },
          { key:'financiero', label:'💼  Macropanel Financiero' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setTab(tab.key)}
            style={{
              display:       'flex',
              alignItems:    'center',
              justifyContent:'center',
              gap:           '0.75rem',
              padding:       '1.25rem 2rem',
              borderRadius:  12,
              border:        activeTab === tab.key ? '1.5px solid #005FA9' : '1px solid rgba(0,70,135,0.12)',
              background:    activeTab === tab.key ? '#005FA9' : 'white',
              color:         activeTab === tab.key ? 'white' : '#4A5568',
              fontFamily:    "'DM Sans', sans-serif",
              fontSize:      '1.1rem',
              fontWeight:    700,
              cursor:        'pointer',
              transition:    'all 150ms ease',
              boxShadow:     activeTab === tab.key ? '0 4px 15px rgba(0,95,169,0.2)' : '0 2px 5px rgba(0,0,0,0.02)',
              minHeight:     '60px'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Contenido de tabs ── */}

      {activeTab === 'eficiencia' && (
        <div>
          <SectionHeader
            title="Tablero de Eficiencia Operativa"
            subtitle="Acceso seguro a analítica avanzada de ocupación, tiempos y recursos"
            accent="#0088C9"
          />
          <EmbeddedBI reportId="directivo-eficiencia" height="calc(100vh - 140px)" />
        </div>
      )}

      {activeTab === 'eficacia' && (
        <div>
          <SectionHeader
            title="Tablero de Eficacia Clínica"
            subtitle="Acceso seguro a analítica avanzada de eficacia y calidad médica"
            accent="#00974A"
          />
          <EmbeddedBI reportId="directivo-eficacia" height="calc(100vh - 140px)" />
        </div>
      )}

      {activeTab === 'financiero' && (
        <div>
          <SectionHeader
            title="Macropanel Financiero"
            subtitle="Acceso seguro a analítica financiera y presupuestos"
            accent="#005FA9"
          />
          <EmbeddedBI reportId="directivo-financiero" height="calc(100vh - 140px)" />
        </div>
      )}
    </div>
  );
}
