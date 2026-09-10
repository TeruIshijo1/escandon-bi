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
import DashboardFinanzasNativo from './DashboardFinanzasNativo';
import DashboardEficienciaNativo from './DashboardEficienciaNativo';
import DashboardEficaciaNativo from './DashboardEficaciaNativo';
import DashboardVidasSalvadas from './DashboardVidasSalvadas';
import DashboardNuevoMapa from './DashboardNuevoMapa';
import GlobalFilterBar from './GlobalFilterBar';
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


const TAB_DETAILS = {
  eficiencia: {
    tag: 'Dashboard de Mando Directivo',
    title: 'Eficiencia Operativa',
    color: '#0088C9', // Cyan
  },
  eficacia: {
    tag: 'Dashboard de Mando Directivo',
    title: 'Eficacia Clínica',
    color: '#00974A', // Green
  },
  financiero: {
    tag: 'Dashboard de Mando Directivo',
    title: 'Macropanel Financiero',
    color: '#005FA9', // Blue
  },
  finanzas: {
    tag: 'Dashboard de Mando Directivo',
    title: 'Ingresos y Egresos',
    color: '#E8853D', // Orange
  },
  demografia: {
    tag: 'Dashboard de Mando Directivo',
    title: 'Demografía Geográfica',
    color: '#F59E0B', // Amber
  }
};

export default function DashboardDirectivo() {
  const { user }             = useAuth();
  const [fecha,  setFecha]   = useState('');
  const [loading, setLoad]   = useState(true);
  const [activeTab, setTab]  = useState('eficiencia');
  const [data, setData]      = useState({ censo: [] });
  const [showExportApi, setShowExportApi] = useState(false);
  const [configList, setConfigList] = useState([]);
  
  // Global filters
  const [globalFilters, setGlobalFilters] = useState({
    search: '',
    startDate: '',
    endDate: '',
    medico: '',
    especialidad: ''
  });
  const [applyTrigger, setApplyTrigger] = useState(0);

  const handleApplyFilters = () => {
    setApplyTrigger(prev => prev + 1);
  };

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
    <div style={{ maxWidth: 'var(--content-max, 1300px)', margin: '0 auto' }}>
      {/* <ExportApiModal isOpen={showExportApi} onClose={() => setShowExportApi(false)} /> */}

      {/* ── Header del dashboard ── */}
      <div style={{
        background:    '#0B132B', // Deep navy black
        borderRadius:  20,
        padding:       '2rem 2.25rem',
        marginBottom:  '1.5rem',
        position:      'relative',
        overflow:      'hidden',
        boxShadow:     '0 10px 30px rgba(0, 70, 135, 0.15)',
        border:        '1px solid rgba(255, 255, 255, 0.05)',
        borderTop:     '1.5px solid rgba(255, 255, 255, 0.12)'
      }}>
        {/* Glowing mesh gradient background shapes */}
        <div style={{
          position: 'absolute',
          top: '-50%',
          right: '-10%',
          width: '350px',
          height: '350px',
          borderRadius: '50%',
          background: `radial-gradient(circle, ${TAB_DETAILS[activeTab]?.color || '#0088C9'}33 0%, rgba(13, 70, 135, 0) 70%)`,
          filter: 'blur(40px)',
          pointerEvents: 'none',
          transition: 'background 0.5s ease'
        }} />
        <div style={{
          position: 'absolute',
          bottom: '-30%',
          right: '20%',
          width: '250px',
          height: '250px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255, 255, 255, 0.03) 0%, rgba(0, 0, 0, 0) 70%)',
          filter: 'blur(30px)',
          pointerEvents: 'none'
        }} />

        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', position:'relative', zIndex:1, flexWrap: 'wrap', gap: '1.5rem' }}>
          <div>
            <div style={{ 
              fontSize:'0.75rem', 
              fontWeight:700, 
              letterSpacing:'0.15em', 
              textTransform:'uppercase', 
              color: TAB_DETAILS[activeTab]?.color || '#38BDF8', 
              marginBottom:'0.4rem',
              fontFamily: "'Inter', sans-serif",
              transition: 'color 0.3s ease'
            }}>
              {TAB_DETAILS[activeTab]?.tag || 'Dashboard de Mando Directivo'}
            </div>
            <h1 style={{ 
              fontFamily:"'Outfit', sans-serif", 
              fontSize:'2rem', 
              fontWeight:800, 
              color:'white', 
              margin:0, 
              lineHeight:1.1
            }}>
              {TAB_DETAILS[activeTab]?.title || 'Resumen Ejecutivo'}
            </h1>
            <div style={{ 
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize:'0.82rem', 
              color:'#94A3B8', 
              marginTop:'0.5rem', 
              textTransform:'capitalize' 
            }}>
              📅 {fecha}
            </div>

            {/* Chips de estado rápido */}
            <div style={{ display:'flex', gap:'0.5rem', marginTop:'1.25rem', flexWrap:'wrap' }}>
              {data.censo.slice(0, 3).map(area => (
                <span key={area.Area} style={{
                  background:   'rgba(0, 136, 201, 0.12)',
                  border:       '1px solid rgba(0, 136, 201, 0.25)',
                  borderRadius: 100,
                  padding:      '0.3rem 0.8rem',
                  fontSize:     '0.75rem',
                  color:        '#38BDF8',
                  fontWeight:   600,
                  backdropFilter:'blur(8px)',
                }}>{area.Area}: {area.Ocupadas}</span>
              ))}

            </div>
          </div>

          {/* Botones de exportación */}
          <div style={{ display:'flex', gap:'0.75rem', alignItems:'center', flexShrink:0 }}>
            <ExportButton
              type="pdf"
              targetId="dashboard-directivo-content"
              compact={false}
              variant="solid"
            />
            <ExportButton
              type="excel"
              directUrl={`/dashboard/export-excel?dashboard=${activeTab}&startDate=${globalFilters.startDate || ''}&endDate=${globalFilters.endDate || ''}&search=${encodeURIComponent(globalFilters.search || '')}&especialidad=${encodeURIComponent(globalFilters.especialidad || '')}`}
              compact={false}
              variant="solid"
            />
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
          { key:'finanzas',   label:'💰  Ingresos y Egresos' },
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

      <GlobalFilterBar 
        filters={globalFilters} 
        setFilters={setGlobalFilters} 
        onApply={handleApplyFilters} 
        showSearch={activeTab !== 'eficacia' && activeTab !== 'eficiencia'}
        activeTab={activeTab}
      />

      {/* ── Contenido de tabs ── */}
      <div id="dashboard-directivo-content">
        {activeTab === 'eficiencia' && (
          <div>
            <SectionHeader
              title="Tablero de Eficiencia Operativa (Nativo Directo a SQL)"
              subtitle="Acceso ultra-rápido a métricas operativas desde UDR_BI_INDICADORES_OPERATIVOS"
              accent="#0088C9"
            />
            <DashboardEficienciaNativo globalFilters={globalFilters} globalTrigger={applyTrigger} />
          </div>
        )}

        {activeTab === 'eficacia' && (
          <div>
            <SectionHeader
              title="Tablero de Eficacia Clínica (Nativo Directo a SQL)"
              subtitle="Acceso ultra-rápido a productividad de médicos y consultas"
              accent="#00974A"
            />
            <DashboardEficaciaNativo globalFilters={globalFilters} globalTrigger={applyTrigger} />
          </div>
        )}

        {activeTab === 'financiero' && (
          <div>
            <DashboardFinancieroNativo globalFilters={globalFilters} globalTrigger={applyTrigger} />
          </div>
        )}

        {activeTab === 'finanzas' && (
          <div>
            <SectionHeader
              title="Ingresos y Egresos"
              subtitle="Detalle financiero de ingresos en caja y egresos en SAP"
              accent="#E8853D"
            />
            <DashboardFinanzasNativo globalFilters={globalFilters} globalTrigger={applyTrigger} />
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
    </div>
  );
}
