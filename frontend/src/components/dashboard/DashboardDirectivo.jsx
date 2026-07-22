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
import PremiumLoader from '../shared/PremiumLoader';
import DashboardFinancieroNativo from './DashboardFinancieroNativo';
import DashboardEficienciaNativo from './DashboardEficienciaNativo';
import DashboardEficaciaNativo from './DashboardEficaciaNativo';
import DashboardNuevoMapa from './DashboardNuevoMapa';
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
  const [configList, setConfigList] = useState([]);

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

      // Fetch configurations to know if current tab has JSON
      const resCfg = await fetch(`${API_BASE}/admin/config/reports`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const jsonCfg = await resCfg.json();
      if (jsonCfg.ok) {
        setConfigList(jsonCfg.data);
      }

    } catch (err) {
      console.error('[DashboardDirectivo]', err);
    } finally {
      setLoad(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <PremiumLoader text="Cargando indicadores…" />
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
            <button
              onClick={() => document.getElementById('export-pdf-btn')?.click()}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.45rem', padding: '0.6rem 1.1rem',
                background: 'rgba(255,255,255,0.15)', border: '1.5px solid rgba(255,255,255,0.22)',
                borderRadius: 10, color: '#FFFFFF', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer'
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
              Exportar PDF
            </button>
            <button
              onClick={() => document.getElementById('export-excel-btn')?.click()}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.45rem', padding: '0.6rem 1.1rem',
                background: '#00974A', border: '1.5px solid rgba(0,151,74,0.5)',
                borderRadius: 10, color: '#FFFFFF', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer'
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/></svg>
              Exportar Excel
            </button>
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
          { key:'demografia', label:'🗺️  Demografía Geográfica' },
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
            title="Tablero de Eficiencia Operativa (Nativo Directo a SQL)"
            subtitle="Acceso ultra-rápido a métricas operativas desde UDR_BI_INDICADORES_OPERATIVOS"
            accent="#0088C9"
          />
          <DashboardEficienciaNativo />
        </div>
      )}

      {activeTab === 'eficacia' && (
        <div>
          <SectionHeader
            title="Tablero de Eficacia Clínica (Nativo Directo a SQL)"
            subtitle="Acceso ultra-rápido a productividad de médicos y consultas"
            accent="#00974A"
          />
          <DashboardEficaciaNativo />
        </div>
      )}

      {activeTab === 'financiero' && (
        <div>
          <SectionHeader
            title="Macropanel Financiero (Nativo Directo a SQL)"
            subtitle="Datos en tiempo real sin Power BI. Interactivo, seguro y nativo."
            accent="#005FA9"
          />
          <DashboardFinancieroNativo />
        </div>
      )}

      {activeTab === 'demografia' && (
        <div>
          <SectionHeader
            title="Dashboard Demográfico Geográfico"
            subtitle="Distribución espacial de pacientes por estado y municipio"
            accent="#F59E0B"
          />
          <DashboardNuevoMapa />
        </div>
      )}
    </div>
  );
}
