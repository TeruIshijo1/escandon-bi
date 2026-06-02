/**
 * Reportes.jsx — Centro de Exportación de Reportes
 * Hospital Escandón BI Platform v4.0
 * Rediseño premium con identidad de marca y micro-interacciones
 */
import { useState, useEffect } from 'react';
import { useAuth }  from '../context/AuthContext';
import { can }      from '../utils/rbac';
import EmbeddedBI   from '../components/dashboard/EmbeddedBI';

const API_BASE = '/api';

// El catálogo se cargará dinámicamente desde la BD
const STATIC_REPORTS = [
  {
    id:          'estadisticas-global',
    title:       'Estadísticas Demográficas',
    desc:        'Top diagnósticos, distribución por edad, género, servicio y tipo de egreso.',
    icon:        '📈',
    tienesPDF:   true,
    tieneExcel:  true,
    roles:       ['ADMIN','DIRECTOR','JEFE_AREA'],
  },
];

function ReporteCard({ reporte, userRole, userArea, userPermisos, onPrintPDF }) {
  const [downloading, setDl] = useState(null);

  // 1. Reglas generales de Rol y Área
  const rolesPermitidos = Array.isArray(reporte.roles) ? reporte.roles : [];
  
  // El ADMIN siempre ve todo
  if (userRole === 'ADMIN') {
    // Continuar con el renderizado
  } else {
    const tieneAccesoPorRol = rolesPermitidos.length === 0 || rolesPermitidos.includes(userRole);
    const mismaArea   = !reporte.area || reporte.area === userArea || userRole === 'DIRECTOR';
    
    if (!tieneAccesoPorRol || !mismaArea) return null;
  }

  const canPDF   = can(userRole, 'exportarPDF');
  const canExcel = can(userRole, 'exportarExcel');

  const handleDownload = async (tipo) => {
    if (downloading) return;

    if (tipo === 'pdf') {
      onPrintPDF();
      return;
    }

    if (tipo === 'excel') {
      if (reporte.excelPath) {
        const a = document.createElement('a');
        a.href = `/api/files/${reporte.excelPath}`;
        a.download = reporte.excelPath.split('/').pop() || 'reporte.xlsx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return;
      }
    }

    // Fallback: Generación dinámica vía API (si no hay archivo subido)
    setDl(tipo);
    try {
      const token = sessionStorage.getItem('escandon_token');
      const res   = await fetch(`${API_BASE}/export/${tipo}/${reporte.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Error al generar reporte');
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `${reporte.id}_${Date.now()}.${tipo === 'pdf' ? 'pdf' : 'xlsx'}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('No se pudo generar el reporte. Intente de nuevo.');
    } finally {
      setDl(null);
    }
  };

  return (
    <div 
      className="report-card"
      style={{
        background:   '#FFFFFF',
        borderRadius:  '16px',
        border:       '1px solid rgba(0,70,135,0.05)',
        boxShadow:    'var(--shadow-xs)',
        overflow:     'hidden',
        transition:   'all var(--transition-base)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      <div style={{ padding:'1.5rem 1.5rem 1.25rem' }}>
        <div style={{ display:'flex', alignItems:'flex-start', gap:'1rem' }}>
          {/* Circular icon container */}
          <div style={{
            width:48, height:48, borderRadius:'50%',
            background:'rgba(0,136,201,0.08)', display:'flex', alignItems:'center',
            justifyContent:'center', fontSize:'1.4rem', flexShrink:0,
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.4)',
          }}>{reporte.icon}</div>
          
          <div>
            <h3 style={{ fontFamily:"var(--font-display)", fontSize:'0.95rem', fontWeight:800, color:'var(--text-primary)', margin:'0 0 0.4rem', letterSpacing: '-0.01em' }}>
              {reporte.title}
            </h3>
            <p style={{ fontFamily: 'var(--font-body)', fontSize:'0.78rem', color:'var(--text-secondary)', margin:0, lineHeight:1.5 }}>{reporte.desc}</p>
          </div>
        </div>
      </div>

      {/* Action buttons with subtle top divider */}
      <div style={{
        display:'flex',
        gap:'0.75rem',
        borderTop:'1px solid rgba(0,70,135,0.06)',
        padding:'1rem 1.5rem 1.5rem',
        background: '#FAFBFD',
      }}>
        {(reporte.tienesPDF || reporte.hasPDF) && canPDF && (
          <button
            onClick={() => handleDownload('pdf')}
            disabled={!!downloading}
            style={{
              flex:1, padding:'0.55rem 0.85rem',
              background: downloading==='pdf' ? 'rgba(0,136,201,0.12)' : 'rgba(0,70,135,0.05)',
              border:'1.5px solid rgba(0,70,135,0.1)',
              borderRadius: '10px',
              color:'var(--color-azul-fuerte)',
              fontFamily:"var(--font-display)",
              fontSize:'0.76rem',
              fontWeight:700,
              cursor: downloading ? 'not-allowed' : 'pointer',
              transition:'all var(--transition-fast)',
              display:'flex',
              alignItems:'center',
              justifyContent:'center',
              gap:'0.45rem',
            }}
            onMouseEnter={e => { if(!downloading) { e.currentTarget.style.background = 'var(--color-azul-fuerte)'; e.currentTarget.style.color = '#FFFFFF'; } }}
            onMouseLeave={e => { if(!downloading) { e.currentTarget.style.background = 'rgba(0,70,135,0.05)'; e.currentTarget.style.color = 'var(--color-azul-fuerte)'; } }}
          >
            {downloading==='pdf' ? (
              <span className="spinner" style={{ width:12, height:12, border:'2px solid rgba(0,0,0,0.2)', borderTop:'2px solid currentColor', borderRadius:'50%', animation:'spin 0.8s linear infinite', display:'inline-block' }}/>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            )}
            PDF
          </button>
        )}
        {(reporte.tieneExcel || reporte.hasExcel) && canExcel && (
          <button
            onClick={() => handleDownload('excel')}
            disabled={!!downloading}
            style={{
              flex:1, padding:'0.55rem 0.85rem',
              background: downloading==='excel' ? 'rgba(0,151,74,0.12)' : 'rgba(0,151,74,0.05)',
              border:'1.5px solid rgba(0,151,74,0.12)',
              borderRadius: '10px',
              color:'var(--color-verde-e)',
              fontFamily:"var(--font-display)",
              fontSize:'0.76rem',
              fontWeight:700,
              cursor: downloading ? 'not-allowed' : 'pointer',
              transition:'all var(--transition-fast)',
              display:'flex',
              alignItems:'center',
              justifyContent:'center',
              gap:'0.45rem',
            }}
            onMouseEnter={e => { if(!downloading) { e.currentTarget.style.background = 'var(--color-verde-e)'; e.currentTarget.style.color = '#FFFFFF'; } }}
            onMouseLeave={e => { if(!downloading) { e.currentTarget.style.background = 'rgba(0,151,74,0.05)'; e.currentTarget.style.color = 'var(--color-verde-e)'; } }}
          >
            {downloading==='excel' ? (
              <span className="spinner" style={{ width:12, height:12, border:'2px solid rgba(0,0,0,0.2)', borderTop:'2px solid currentColor', borderRadius:'50%', animation:'spin 0.8s linear infinite', display:'inline-block' }}/>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            )}
            EXCEL
          </button>
        )}
      </div>
    </div>
  );
}

// Mapeo de URLs ofuscadas para reportes principales (Publish to Web)
const HARDCODED_URLS = {
  'directivo-main': 'aHR0cHM6Ly9hcHAucG93ZXJiaS5jb20vbGlua3MvaldKc3NHRWphVz9jdGlkPTYzMTA1NTAyLTc0YmItNGQ1ZC04NjE3LTExMWI2NmYxOTljMCZwYmlfc291cmNlPWxpbmtTaGFyZQ==',
  'directivo':      'aHR0cHM6Ly9hcHAucG93ZXJiaS5jb20vbGlua3MvaldKc3NHRWphVz9jdGlkPTYzMTA1NTAyLTc0YmItNGQ1ZC04NjE3LTExMWI2NmYxOTljMCZwYmlfc291cmNlPWxpbmtTaGFyZQ==',
};

export default function Reportes() {
  const { user } = useAuth();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [printModal, setPrintModal] = useState(null); // Reporte activo para imprimir

  useEffect(() => {
    const fetchCatalog = async () => {
      try {
        const token = sessionStorage.getItem('escandon_token');
        const res = await fetch(`${API_BASE}/admin/config-bi`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const json = await res.json();
        if (json.ok) {
          const dynamic = json.data.map(r => ({
            id:         r.reportId,
            title:      r.name,
            desc:       `Reporte integrado desde la configuración central. ID: ${r.reportId}`,
            icon:       r.reportId.includes('area') ? '🏢' : '📊',
            tienesPDF:  true,
            tieneExcel: true,
            roles:      r.roles,
            area:       r.area,
            pbixPath:   r.pbixPath,
            excelPath:  r.excelPath,
            lookerUrl:   HARDCODED_URLS[r.reportId] || r.lookerUrl || r.pbiReportId,
          }));
          setReports([...dynamic, ...STATIC_REPORTS]);
        }
      } catch (err) {
        console.error('Error loading report catalog:', err);
        setReports(STATIC_REPORTS);
      } finally {
        setLoading(false);
      }
    };
    fetchCatalog();
  }, []);

  return (
    <div style={{ maxWidth:'1200px', width:'100%', margin:'0 auto' }}>
      <style>{`
        .report-card:hover {
          transform: translateY(-2.5px);
          box-shadow: var(--shadow-md) !important;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      {/* Header */}
      <div className="no-print" style={{
        background: 'linear-gradient(135deg, var(--color-azul-fuerte) 0%, #083b66 100%)',
        borderRadius: 20, padding: '1.75rem 2.25rem', marginBottom: '2rem',
        boxShadow: 'var(--shadow-md)',
        position: 'relative',
        overflow: 'hidden',
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

        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.64rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.65)', marginBottom: '0.35rem' }}>
            Centro de Exportación
          </div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: '1.65rem', fontWeight: 800, color: 'white', margin: 0, letterSpacing: '-0.01em' }}>
            Reportes y Data Explorer
          </h1>
          <p style={{ fontFamily: 'var(--font-body)', color: 'rgba(255,255,255,0.72)', fontSize: '0.85rem', margin: '0.4rem 0 0', fontWeight: 500 }}>
            Accede a tableros ejecutivos interactivos, descargas de Excel y análisis históricos
          </p>
        </div>
      </div>

      {/* Nota de permisos */}
      <div className="no-print" style={{
        background:'rgba(0,70,135,0.03)', border:'1.5px solid rgba(0,70,135,0.08)',
        borderRadius: '12px', padding:'0.85rem 1.25rem', marginBottom:'2rem',
        display:'flex', alignItems:'center', gap:'0.75rem',
      }}>
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-azul-fuerte)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        <p style={{ fontFamily: 'var(--font-body)', fontSize:'0.8rem', color:'var(--text-secondary)', margin:0, fontWeight: 500 }}>
          Mostrando reportes disponibles para el rol <strong style={{ color:'var(--color-azul-fuerte)' }}>{user?.role}</strong>
          {user?.area ? ` en el área de ${user.area}` : ''}. Los reportes se generan en tiempo real con datos actualizados de la base de datos.
        </p>
      </div>

      {/* Grid de reportes */}
      <div className="no-print" style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(340px,1fr))', gap:'1.25rem' }}>
        {loading ? (
          <div style={{ padding:'2rem', color:'var(--text-muted)', fontFamily: 'var(--font-body)', fontSize: '0.9rem' }}>Cargando catálogo dinámico...</div>
        ) : (
          reports.map(r => (
            <ReporteCard
              key={r.id}
              reporte={r}
              userRole={user?.role}
              userArea={user?.area}
              userPermisos={user?.permisos}
              onPrintPDF={() => setPrintModal(r)}
            />
          ))
        )}
      </div>

      {/* ── Modal de Impresión PDF (Carga el tablero antes de imprimir) ── */}
      {printModal && (
        <div style={{
          position:'fixed', top:0, left:0, right:0, bottom:0,
          background:'rgba(15, 26, 46, 0.4)', backdropFilter:'var(--glass-blur)',
          WebkitBackdropFilter: 'var(--glass-blur)',
          display:'flex', alignItems:'center', justifyContent:'center', zIndex:2000,
          padding: '2rem'
        }}>
          <div style={{
            background:'#FFFFFF', borderRadius:'20px', width:'100%', maxWidth:1100,
            height: '88vh', display:'flex', flexDirection:'column', overflow:'hidden',
            boxShadow: 'var(--shadow-xl)', position:'relative'
          }}>
            {/* Header del Modal */}
            <div className="no-print" style={{ 
              padding: '1.25rem 1.75rem', borderBottom: '1px solid rgba(0,70,135,0.06)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              background: '#FAFBFD'
            }}>
              <div>
                <h3 style={{ margin:0, fontSize:'1.1rem', color:'var(--color-azul-fuerte)', fontWeight:800, fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}>Generando Reporte PDF</h3>
                <p style={{ margin:'0.15rem 0 0', fontSize:'0.75rem', color:'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{printModal.title}</p>
              </div>
              <div style={{ display:'flex', gap:'0.75rem' }}>
                <button 
                  onClick={() => window.print()}
                  style={{ padding:'0.55rem 1.15rem', background:'var(--color-verde-e)', color:'white', border:'none', borderRadius:10, fontWeight:700, fontFamily: 'var(--font-display)', fontSize: '0.82rem', cursor:'pointer', boxShadow: '0 4px 12px rgba(0, 151, 74, 0.25)' }}
                >🖨️ Imprimir Ahora</button>
                <button 
                  onClick={() => setPrintModal(null)}
                  style={{ padding:'0.55rem 1.15rem', background:'#EDF2F7', color:'var(--text-secondary)', border:'none', borderRadius:10, fontWeight:700, fontFamily: 'var(--font-display)', fontSize: '0.82rem', cursor:'pointer' }}
                >Cerrar</button>
              </div>
            </div>

            {/* Cuerpo del Modal (Tablero) */}
            <div style={{ 
              flex:1, 
              display:'flex', 
              flexDirection:'column', 
              overflow:'hidden', 
              background:'#F2F5FA' 
            }}>
               <EmbeddedBI 
                 reportId={printModal.lookerUrl || printModal.pbiReportId || printModal.id} 
                 height="100%" 
               />
            </div>

            <div className="no-print" style={{ padding:'0.85rem', textAlign:'center', background:'#FAFBFD', borderTop:'1px solid rgba(0,70,135,0.06)' }}>
               <p style={{ fontSize:'0.72rem', color:'var(--text-muted)', margin:0, fontFamily: 'var(--font-body)', fontWeight: 500 }}>
                 Espere a que el tablero cargue completamente antes de imprimir para asegurar la captura de todos los datos en el documento.
               </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
