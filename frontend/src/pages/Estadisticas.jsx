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
import DashboardVidasSalvadas from '../components/dashboard/DashboardVidasSalvadas';
import PremiumLoader from '../components/shared/PremiumLoader';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  Legend 
} from 'recharts';

const SECCIONES_ESTADISTICAS = [
  { id: '01_VIDAS SALVADAS', label: '❤️ Vidas Salvadas (Sala de Choque)' },
  { id: '02_NACIMIENTOS', label: '👶 Nacimientos (Partos y Cesáreas)' },
  { id: '03_CUENTAS HOSPITALARIAS (HOSPITALIZACIÓN)', label: '🏥 Egresos de Hospitalización' },
  { id: '03_CUENTAS HOSPITALARIAS DE URGENCIAS', label: '🚨 Cuentas de Urgencias' },
  { id: '03_CUENTAS HOSPITALARIAS DE VA - SEGURO', label: '🛡️ Cuentas de VA - Seguro' },
  { id: '04_ADMISIÓN CONTINUA (CONSULTAS DE URGENCIAS)', label: '🩺 Atenciones Admisión Continua (Urgencias)' },
  { id: '05_ESTANCIA', label: '🛌 Estancia Total (Personas Hospitalizadas)' },
  { id: '06_TERAPIA INTENSIVA (SER501, SER600, SER710, SER730)', label: '⚡ Personas en Terapia Intensiva' },
  { id: '07_PERSONAS EN QX (USOQX1HR)', label: '✂️ Personas que pasaron por Quirófano' },
  { id: '08_CX ENDOSCOPIA, COLONOSCOPIA, BRONCOSCOPIA, PANENDOSCOPIA', label: '🔬 Estudios de Endoscopia' },
  { id: '09_CONSULTAS DE ESPECIALIDAD', label: '👩‍⚕️ Consultas de Especialidad' },
  { id: '10_ESTADISTICO DE EST. IMAGEN', label: '🖼️ Estudios de Imagenología' },
  { id: '11_ESTADISTICO EST. LABORA', label: '🧪 Estudios de Laboratorio' },
  { id: '13_ESTADÍSTICO DE CIRUGÍAS', label: '🔪 Cirugías Realizadas' }
];

export default function Estadisticas() {
  const { user }              = useAuth();
  const { getKPI }            = useKPIConfig();
  const [periodo, setPeriodo] = useState('mes');
  const [loading, setLoading] = useState(false);
  const [toast, setToast]     = useState(null);
  const [data, setData]       = useState({ stats: [], dx: [], areas: [], totalEgresos: 0, maxDx: 0, maxArea: 0 });
  const [pbiModal, setPBIModal] = useState(null);
  const [showVidasSalvadasModal, setShowVidasSalvadasModal] = useState(false);

  // Estados para el explorador histórico de Excel
  const [selectedSeccion, setSelectedSeccion] = useState('01_VIDAS SALVADAS');
  const [seccionData, setSeccionData] = useState(null);
  const [loadingHist, setLoadingHist] = useState(false);
  const [activeTab, setActiveTab] = useState('tabla');
  const [selectedYearGraf, setSelectedYearGraf] = useState(2025);

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

  useEffect(() => {
    fetchSeccionHistorica();
  }, [selectedSeccion]);

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
          { id: 'stats.vidas_salvadas',  label:'❤️ Vidas Salvadas', value: general.VidasSalvadas || 0, pct: 'Sala Choque (SAP)', up: true },
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

  const fetchSeccionHistorica = async () => {
    setLoadingHist(true);
    try {
      const token = sessionStorage.getItem('escandon_token');
      const res = await fetch(`/api/dashboard/stats-historico?seccion=${encodeURIComponent(selectedSeccion)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const json = await res.json();
      if (json.ok) {
        setSeccionData(json.data);
      }
    } catch (e) {
      console.error('Error fetching stats historico:', e);
    } finally {
      setLoadingHist(false);
    }
  };

  // Cálculo de matrices para la tabla del explorador histórico
  const añosList = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
  const mesesNombres = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];

  const totalAnual = {};
  const totalMensual = {};
  let granTotal = 0;

  añosList.forEach(año => {
    totalAnual[año] = 0;
  });
  for (let m = 1; m <= 12; m++) {
    totalMensual[m] = 0;
  }

  if (seccionData) {
    añosList.forEach(año => {
      const añoData = seccionData[año] || {};
      for (let m = 1; m <= 12; m++) {
        const val = parseFloat(añoData[m]) || 0;
        totalAnual[año] += val;
        totalMensual[m] += val;
        granTotal += val;
      }
    });
  }

  const dataGrafAnual = añosList.map(año => ({
    name: año.toString(),
    Total: totalAnual[año]
  }));

  const dataGrafMensual = mesesNombres.map((name, idx) => {
    const m = idx + 1;
    const añoData = seccionData?.[selectedYearGraf] || {};
    return {
      name,
      Cantidad: parseFloat(añoData[m]) || 0
    };
  });

  return (
    <div style={{ maxWidth:'var(--content-max, 1200px)', margin:'0 auto' }}>
      <style>{`
        .est-kpi-card:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-md) !important;
        }
        .table-row-hover:hover {
          background: rgba(0,70,135,0.02) !important;
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
      {loading && data.stats.length === 0 ? (
        <div style={{ padding: '4rem', display: 'flex', justifyContent: 'center' }}>
          <PremiumLoader />
        </div>
      ) : (
        <>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:'1rem', marginBottom:'2rem', opacity: loading ? 0.55 : 1, transition: 'opacity 0.3s ease' }}>
        {data.stats.map(s => {
          const kpiConfig = getKPI(s.id);
          const displayName = kpiConfig?.nombre || s.label;
          const displayIcon = kpiConfig?.icono;
          const accentColor = s.up === true ? 'var(--color-verde-e)' : s.up === false ? 'var(--color-danger)' : 'var(--color-azul-fuerte)';
          return (
            <div
              key={s.id}
              className={`est-kpi-card ${s.id === 'stats.vidas_salvadas' ? 'kpi-clickable' : ''}`}
              onClick={() => {
                if (s.id === 'stats.vidas_salvadas') {
                  setShowVidasSalvadasModal(true);
                }
              }}
              style={{
                background:'#FFFFFF', borderRadius:'14px', padding:'1.1rem 1.25rem',
                border:'1px solid rgba(0,70,135,0.05)',
                borderLeft: `4px solid ${accentColor}`,
                boxShadow:'var(--shadow-xs)',
                height: '100%', boxSizing: 'border-box',
                display: 'flex', flexDirection: 'column', justifyContent: 'center',
                transition: 'all var(--transition-base)',
                position: 'relative',
                cursor: s.id === 'stats.vidas_salvadas' ? 'pointer' : 'default',
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
          );
        })}
          </div>

          {/* Diagnósticos top & Distribución */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(450px, 1fr))', gap:'1.5rem', opacity: loading ? 0.55 : 1, transition: 'opacity 0.3s ease', marginBottom: '2rem' }}>
        
        {/* Facturación por Área */}
        <EditableKPIWrapper elementoId="stats.top_diagnosticos" isAdmin={user?.role === 'ADMIN'} onKPIClick={handleKPIClick} accentColor="var(--color-azul-fuerte)">
          <div style={{ background:'#FFFFFF', borderRadius:'16px', padding:'1.5rem', border:'1px solid rgba(0,70,135,0.05)', boxShadow:'var(--shadow-xs)', height: '100%', boxSizing: 'border-box' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'1.25rem' }}>
              <div style={{ width:4, height:18, background:'var(--color-azul-fuerte)', borderRadius:2 }}/>
              <span style={{ fontFamily:"var(--font-display)", fontSize:'0.95rem', fontWeight:700, color: 'var(--text-primary)' }}>Facturación Global por Área</span>
            </div>
            {data.dx.length > 0 ? data.dx.map((d, i) => (
              <div key={d.dx} style={{ marginBottom:'0.875rem' }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'0.3rem', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize:'0.82rem', color:'var(--text-primary)', fontWeight:600, maxWidth:'65%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', color:'var(--text-muted)', marginRight:'0.5rem', fontSize: '0.78rem' }}>#{i+1}</span>{d.dx}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize:'0.8rem', fontWeight:700, color:'var(--color-azul-fuerte)', flexShrink:0 }}>
                    ${d.n?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 
                    <span style={{ color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.72rem', marginLeft:'4px' }}>({d.pct}%)</span>
                  </span>
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
            )) : loading ? (
              <p style={{ textAlign:'center', color:'var(--text-muted)', fontSize:'0.85rem', padding:'2.5rem 0', fontFamily: 'var(--font-body)' }}>Cargando datos de facturación...</p>
            ) : (
              <p style={{ textAlign:'center', color:'var(--text-muted)', fontSize:'0.85rem', padding:'2.5rem 0', fontFamily: 'var(--font-body)' }}>Sin datos de facturación en este periodo.</p>
            )}
          </div>
        </EditableKPIWrapper>

        {/* Top Médicos */}
        <EditableKPIWrapper elementoId="stats.egresos_servicio" isAdmin={user?.role === 'ADMIN'} onKPIClick={handleKPIClick} accentColor="var(--color-azul-claro)">
          <div style={{ background:'#FFFFFF', borderRadius:'16px', padding:'1.5rem', border:'1px solid rgba(0,70,135,0.05)', boxShadow:'var(--shadow-xs)', height: '100%', boxSizing: 'border-box' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'1.25rem' }}>
              <div style={{ width:4, height:18, background:'var(--color-azul-claro)', borderRadius:2 }}/>
              <span style={{ fontFamily:"var(--font-display)", fontSize:'0.95rem', fontWeight:700, color: 'var(--text-primary)' }}>Top 10 Médicos por Ingreso</span>
            </div>
            {data.areas.length > 0 ? data.areas.map((a, i) => (
              <div key={a.area} style={{ marginBottom:'0.875rem' }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'0.3rem', alignItems: 'center' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', maxWidth: '65%' }}>
                    <span style={{ fontFamily: 'var(--font-body)', fontSize:'0.82rem', color:'var(--text-primary)', fontWeight:600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', color:'var(--text-muted)', marginRight:'0.5rem', fontSize: '0.78rem' }}>#{i+1}</span>{a.area}
                    </span>
                    <span style={{ fontFamily: 'var(--font-body)', fontSize:'0.65rem', color:'var(--text-muted)', marginTop:'0.1rem', marginLeft: '1.4rem' }}>{a.especialidad || 'SIN ESPECIALIDAD'}</span>
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize:'0.8rem', fontWeight:700, color: 'var(--color-accent-warm)' }}>
                    ${a.n?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div style={{ height:6, background:'rgba(0,70,135,0.04)', borderRadius:100, overflow:'hidden' }}>
                  <div style={{ height:'100%', width:`${(a.n/data.maxArea)*100}%`, background:a.color, borderRadius:100, transition:'width 0.8s ease' }}/>
                </div>
              </div>
            )) : loading ? (
              <p style={{ textAlign:'center', color:'var(--text-muted)', fontSize:'0.85rem', padding:'2.5rem 0', fontFamily: 'var(--font-body)' }}>Cargando médicos...</p>
            ) : (
              <p style={{ textAlign:'center', color:'var(--text-muted)', fontSize:'0.85rem', padding:'2.5rem 0', fontFamily: 'var(--font-body)' }}>Sin registros de médicos.</p>
            )}
          </div>
        </EditableKPIWrapper>
      </div>
      </>
      )}

      {/* Explorador de Estadísticas Históricas */}
      <div style={{ background: '#FFFFFF', borderRadius: '16px', padding: '2rem', border: '1px solid rgba(0,70,135,0.05)', boxShadow: 'var(--shadow-sm)', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid #F1F5F9', paddingBottom: '1rem', marginBottom: '1.5rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
              <div style={{ width: 4, height: 20, background: 'var(--color-azul-fuerte)', borderRadius: 2 }}/>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                Explorador de Estadísticas Institucionales
              </h2>
            </div>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
              Consolidado histórico. De marzo 2026 hacia atrás de Excel, de abril 2026 en adelante conectado en vivo a SAP B1/HIS.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <select
              value={selectedSeccion}
              onChange={(e) => setSelectedSeccion(e.target.value)}
              style={{
                padding: '0.45rem 1rem',
                borderRadius: '10px',
                border: '1px solid #CBD5E1',
                fontFamily: 'var(--font-body)',
                fontSize: '0.82rem',
                color: 'var(--text-primary)',
                fontWeight: 600,
                outline: 'none',
                cursor: 'pointer',
                boxShadow: 'var(--shadow-xs)',
                background: '#FFFFFF'
              }}
            >
              {SECCIONES_ESTADISTICAS.map(sec => (
                <option key={sec.id} value={sec.id}>{sec.label}</option>
              ))}
            </select>

            <div style={{ display: 'flex', background: '#F1F5F9', padding: '3px', borderRadius: '10px' }}>
              <button
                onClick={() => setActiveTab('tabla')}
                style={{
                  padding: '0.4rem 0.85rem',
                  border: 'none',
                  background: activeTab === 'tabla' ? '#FFFFFF' : 'transparent',
                  borderRadius: '7px',
                  fontFamily: 'var(--font-display)',
                  fontSize: '0.78rem',
                  fontWeight: activeTab === 'tabla' ? 700 : 500,
                  color: activeTab === 'tabla' ? 'var(--color-azul-fuerte)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  boxShadow: activeTab === 'tabla' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.2s'
                }}
              >
                Tabla
              </button>
              <button
                onClick={() => setActiveTab('grafico')}
                style={{
                  padding: '0.4rem 0.85rem',
                  border: 'none',
                  background: activeTab === 'grafico' ? '#FFFFFF' : 'transparent',
                  borderRadius: '7px',
                  fontFamily: 'var(--font-display)',
                  fontSize: '0.78rem',
                  fontWeight: activeTab === 'grafico' ? 700 : 500,
                  color: activeTab === 'grafico' ? 'var(--color-azul-fuerte)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  boxShadow: activeTab === 'grafico' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.2s'
                }}
              >
                Gráfico
              </button>
            </div>
          </div>
        </div>

        {loadingHist ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem 0' }}>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Cargando datos históricos...</span>
          </div>
        ) : (
          activeTab === 'tabla' ? (
            <div style={{ overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: '12px', background: '#FFFFFF' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.76rem' }}>
                <thead>
                  <tr style={{ background: '#F8FAFC', borderBottom: '2px solid #E2E8F0' }}>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontFamily: 'var(--font-display)', color: 'var(--text-primary)', fontWeight: 700 }}>Mes</th>
                    {añosList.map(año => (
                      <th key={año} style={{ padding: '0.75rem 0.6rem', color: 'var(--text-primary)', fontWeight: 700 }}>{año}</th>
                    ))}
                    <th style={{ padding: '0.75rem 1rem', fontFamily: 'var(--font-display)', color: 'var(--color-azul-fuerte)', fontWeight: 700 }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {mesesNombres.map((mesNombre, mIdx) => {
                    const m = mIdx + 1;
                    return (
                      <tr key={m} style={{ borderBottom: '1px solid #E2E8F0', transition: 'background 100ms' }} className="table-row-hover">
                        <td style={{ padding: '0.65rem 1rem', textAlign: 'left', fontFamily: 'var(--font-display)', color: 'var(--text-primary)', fontWeight: 600 }}>{mesNombre}</td>
                        {añosList.map(año => {
                          const val = seccionData?.[año]?.[m];
                          const isSap = año === 2026 && m >= 4;
                          return (
                            <td key={año} style={{ padding: '0.65rem 0.6rem', color: isSap ? 'var(--color-azul-claro)' : 'var(--text-primary)', fontWeight: isSap ? 700 : 400 }}>
                              {val != null ? (selectedSeccion.includes('INGRESOS') ? `$${val.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : val.toLocaleString('en-US')) : '-'}
                            </td>
                          );
                        })}
                        <td style={{ padding: '0.65rem 1rem', fontWeight: 700, color: 'var(--color-azul-fuerte)' }}>
                          {selectedSeccion.includes('INGRESOS') ? `$${totalMensual[m].toLocaleString('en-US', { maximumFractionDigits: 0 })}` : totalMensual[m].toLocaleString('en-US')}
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={{ background: '#F8FAFC', borderTop: '2px solid #E2E8F0', fontWeight: 700 }}>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'left', fontFamily: 'var(--font-display)', color: 'var(--color-azul-fuerte)' }}>Total Anual</td>
                    {añosList.map(año => (
                      <td key={año} style={{ padding: '0.75rem 0.6rem', color: 'var(--color-azul-fuerte)' }}>
                        {selectedSeccion.includes('INGRESOS') ? `$${totalAnual[año].toLocaleString('en-US', { maximumFractionDigits: 0 })}` : totalAnual[año].toLocaleString('en-US')}
                      </td>
                    ))}
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--color-accent-warm)', fontSize: '0.8rem' }}>
                      {selectedSeccion.includes('INGRESOS') ? `$${granTotal.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : granTotal.toLocaleString('en-US')}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '1.5rem' }}>
              <div style={{ background: '#F8FAFC', borderRadius: '12px', padding: '1.25rem', border: '1px solid #E2E8F0' }}>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 1rem 0' }}>
                  Tendencia Histórica Anual (2016 - 2026)
                </h3>
                <div style={{ height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dataGrafAnual} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                      <XAxis dataKey="name" stroke="#64748B" fontSize={10} tickLine={false} />
                      <YAxis stroke="#64748B" fontSize={10} tickLine={false} />
                      <RechartsTooltip formatter={(value) => [selectedSeccion.includes('INGRESOS') ? `$${value.toLocaleString('en-US')}` : value.toLocaleString('en-US'), 'Total']} />
                      <Bar dataKey="Total" fill="var(--color-azul-fuerte)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div style={{ background: '#F8FAFC', borderRadius: '12px', padding: '1.25rem', border: '1px solid #E2E8F0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                    Distribución Mensual del Año
                  </h3>
                  <select
                    value={selectedYearGraf}
                    onChange={(e) => setSelectedYearGraf(parseInt(e.target.value))}
                    style={{
                      padding: '0.25rem 0.6rem',
                      borderRadius: '6px',
                      border: '1px solid #CBD5E1',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      outline: 'none',
                      cursor: 'pointer',
                      background: '#FFFFFF'
                    }}
                  >
                    {añosList.map(a => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </div>
                <div style={{ height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={dataGrafMensual} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                      <XAxis dataKey="name" stroke="#64748B" fontSize={9} tickLine={false} />
                      <YAxis stroke="#64748B" fontSize={10} tickLine={false} />
                      <RechartsTooltip formatter={(value) => [selectedSeccion.includes('INGRESOS') ? `$${value.toLocaleString('en-US')}` : value.toLocaleString('en-US'), 'Cantidad']} />
                      <Line type="monotone" dataKey="Cantidad" stroke="var(--color-accent-warm)" strokeWidth={3} dot={{ r: 3, strokeWidth: 2 }} activeDot={{ r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )
        )}
      </div>

      {/* Vidas Salvadas Modal Overlay */}
      {showVidasSalvadasModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(13, 27, 42, 0.7)', backdropFilter: 'blur(4px)',
          zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <div style={{
            background: 'white', borderRadius: 20, width: '90%', maxWidth: 1000,
            maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            position: 'relative', animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
          }}>
            {/* Header Modal */}
            <div style={{
              padding: '1.5rem 2rem', borderBottom: '1px solid #E2E8F0',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              background: '#F8FAFC'
            }}>
              <div>
                <h2 style={{ margin: 0, color: '#0D1B2A', fontSize: '1.4rem', fontFamily: "'DM Sans', sans-serif" }}>
                  ❤️ Detalle de Vidas Salvadas (SAP B1)
                </h2>
                <p style={{ margin: '0.25rem 0 0 0', color: '#64748B', fontSize: '0.9rem' }}>
                  Mostrando detalle del periodo seleccionado: <b>{periodo}</b>
                </p>
              </div>
              <button 
                onClick={() => setShowVidasSalvadasModal(false)}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  width: 40, height: 40, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#64748B', transition: 'all 0.2s'
                }}
                onMouseOver={e => { e.currentTarget.style.background = '#E2E8F0'; e.currentTarget.style.color = '#EF4444'; }}
                onMouseOut={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#64748B'; }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            
            {/* Body Modal */}
            <div style={{ padding: '0 1rem 1rem 1rem', overflowY: 'auto' }}>
              <DashboardVidasSalvadas periodo={periodo} />
            </div>
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
