/**
 * HomePage.jsx — Página de inicio / resumen general
 * Hospital Escandón BI Platform v4.0
 * Rediseño premium con identidad de marca y micro-interacciones
 */
import { useState, useEffect } from 'react';
import { useNavigate }         from 'react-router-dom';
import { useAuth }             from '../context/AuthContext';
import { AREAS_LABELS }        from '../utils/rbac';

import { API_BASE } from '../api/config';
import EditableKPIWrapper from '../components/shared/EditableKPIWrapper';
import PBIModal from '../components/shared/PBIModal';
import { useKPIConfig } from '../hooks/useKPIConfig';

/* ── Widget de acceso rápido ──────────────────────────────── */
function QuickCard({ icon, title, desc, path, color = '#004687', badge, index = 0 }) {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={() => navigate(path)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background:   '#FFFFFF',
        borderRadius:  '16px',
        padding:      '1.35rem 1.25rem',
        border:       '1px solid rgba(0, 70, 135, 0.08)',
        borderLeft:   `4px solid ${color}`,
        boxShadow:    hovered ? 'var(--shadow-md)' : 'var(--shadow-xs)',
        cursor:       'pointer',
        transition:   'all 280ms cubic-bezier(0.16, 1, 0.3, 1)',
        position:     'relative',
        overflow:     'hidden',
        transform:    hovered ? 'translateY(-3px)' : 'translateY(0)',
        animation:    'cardSlideIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) both',
        animationDelay: `${index * 60}ms`,
      }}
    >
      {/* Dynamic light sweep on hover */}
      {hovered && (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(circle at 10% 10%, ${color}08, transparent 60%)`,
          pointerEvents: 'none',
        }}/>
      )}

      {/* Badge opcional */}
      {badge && (
        <div style={{
          position:   'absolute', top:'1rem', right:'1rem',
          background: `${color}12`, border:`1px solid ${color}25`,
          borderRadius:100, padding:'0.15rem 0.6rem',
          fontSize:'0.65rem', fontWeight:700, color,
          fontFamily: 'var(--font-mono)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}>{badge}</div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
        {/* Large icon with gradient background */}
        <div style={{
          width: '42px',
          height: '42px',
          borderRadius: '12px',
          background: `linear-gradient(135deg, ${color}15, ${color}05)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.4rem',
          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.4), 0 2px 8px ${color}08`,
        }}>{icon}</div>
        
        <h3 style={{
          fontFamily: "var(--font-display)",
          fontSize:    '0.88rem',
          fontWeight:   700,
          color:       'var(--text-primary)',
          margin:      0,
        }}>{title}</h3>
      </div>

      <p style={{
        fontFamily: 'var(--font-body)',
        fontSize:'0.76rem',
        color:'var(--text-secondary)',
        margin:0,
        lineHeight:1.55
      }}>{desc}</p>

      {/* Ir al módulo button with underline reveal & arrow slide */}
      <div style={{
        marginTop: '0.875rem',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        fontSize: '0.74rem',
        fontWeight: 700,
        color: color,
        fontFamily: 'var(--font-display)',
        transition: 'color 0.2s',
      }}>
        <span style={{
          position: 'relative',
          paddingBottom: '2px',
        }}>
          Ir al módulo
          <span style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: hovered ? '100%' : '0%',
            height: '1.5px',
            background: color,
            transition: 'width 250ms ease',
          }}/>
        </span>
        <span style={{
          transform: hovered ? 'translateX(4px)' : 'translateX(0)',
          transition: 'transform 250ms cubic-bezier(0.16, 1, 0.3, 1)',
          display: 'inline-block',
        }}>→</span>
      </div>
    </div>
  );
}



/* ── Componente principal ─────────────────────────────────── */
export default function HomePage() {
  const { user }       = useAuth();
  const { getKPI }     = useKPIConfig();
  const navigate        = useNavigate();
  const [hora, setHora] = useState('');
  const [pbiModal, setPBIModal] = useState(null);
  const handleKPIClick = (url, title, url2, url3, multiPagina) => setPBIModal({ url, title, url2, url3, multiPagina });

  useEffect(() => {
    const tick = () => setHora(new Date().toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit', second:'2-digit' }));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const fecha = new Date().toLocaleDateString('es-MX', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  /* Tarjetas según rol */
  const cardsByRole = {
    ADMIN: [
      { icon:'📊', title:'Dashboard Directivo', desc:'KPIs globales de eficiencia, eficacia y macropanel financiero', path:'/dashboard/directivo', color:'#004687' },
      { icon:'🔍', title:'Auditoría de Inventarios', desc:'Conciliación de órdenes del almacén y consumos clínicos', path:'/auditoria/inventarios', color:'#005FA9' },
      { icon:'🏥', title:'Tablero de Área', desc:'Indicadores clínicos por área hospitalaria', path:'/dashboard/area', color:'#0088C9' },
      { icon:'📈', title:'Estadísticas', desc:'Datos demográficos y procesos por servicio', path:'/estadisticas', color:'#0088C9' },
      { icon:'👥', title:'Gestión de Usuarios', desc:'Administrar roles, accesos y permisos del sistema', path:'/admin/usuarios', color:'#00974A' },
      { icon:'🛡️', title:'Log de Auditoría', desc:'Historial completo de acciones del sistema', path:'/admin/auditoria-log', color:'#00974A' },
      { icon:'⚙️', title:'Configuración', desc:'Parámetros del sistema y conexiones BI', path:'/admin/configuracion', color:'#8A97A8' },
    ],
    DIRECTOR: [
      { icon:'📊', title:'Dashboard Directivo', desc:'KPIs globales de eficiencia, eficacia y macropanel financiero', path:'/dashboard/directivo', color:'#004687', badge:'Principal' },
      { icon:'🔍', title:'Auditoría de Inventarios', desc:'Conciliación de órdenes del almacén y consumos', path:'/auditoria/inventarios', color:'#005FA9' },
      { icon:'🏥', title:'Tablero de Área', desc:'Indicadores clínicos por área hospitalaria', path:'/dashboard/area', color:'#0088C9' },
      { icon:'📈', title:'Estadísticas', desc:'Datos demográficos y procesos por servicio', path:'/estadisticas', color:'#0088C9' },
    ],
    JEFE_AREA: [
      { icon:'🏥', title:`Tablero — ${AREAS_LABELS[user?.area] || 'Mi Área'}`, desc:'Indicadores operativos de tu área asignada', path:'/dashboard/area', color:'#004687', badge:'Mi Área' },
      { icon:'📈', title:'Estadísticas del Área', desc:'Productividad, estancias y tiempos de respuesta', path:'/estadisticas', color:'#0088C9' },
    ],
    USUARIO_OPERATIVO: [
      { icon:'🏥', title:`Tablero — ${AREAS_LABELS[user?.area] || 'Mi Área'}`, desc:'Visualización de indicadores de tu área', path:'/dashboard/area', color:'#004687', badge:'Mi Área' },
    ],
  };



  const cards  = cardsByRole[user?.role] || [];
  const isAdmin = user?.role === 'ADMIN';

  return (
    <div style={{ maxWidth:1200, margin:'0 auto' }}>
      <style>{`
        @keyframes cardSlideIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {pbiModal && (
        <PBIModal {...pbiModal} onClose={() => setPBIModal(null)} />
      )}

      {/* ── Hero / Título con ECG pattern ── */}
      <div style={{
        position: 'relative',
        background: 'linear-gradient(135deg, var(--color-azul-fuerte) 0%, #083b66 100%)',
        borderRadius: '20px',
        padding: '2rem 2.5rem',
        marginBottom: '2rem',
        boxShadow: 'var(--shadow-md)',
        overflow: 'hidden',
      }}>
        {/* ECG Pattern in Background */}
        <div style={{
          position: 'absolute',
          inset: 0,
          opacity: 0.05,
          pointerEvents: 'none',
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 120' width='800' height='120'%3E%3Cpath d='M0 60h120l10-15 15 10 10-25 15 80 10-65 15 15h120l10-15 15 10 10-25 15 80 10-65 15 15h200' fill='none' stroke='%23ffffff' stroke-width='2'/%3E%3C/svg%3E")`,
          backgroundSize: '400px 60px',
          backgroundPosition: 'left center',
          backgroundRepeat: 'repeat-x',
        }}/>

        <div style={{ position: 'relative', zIndex: 2 }}>
          <h1 style={{
            fontFamily: "var(--font-display)",
            fontSize:    '1.75rem',
            fontWeight:   800,
            color:       '#FFFFFF',
            margin:       0,
            lineHeight:   1.2,
            letterSpacing: '-0.01em',
          }}>
            Dashboard Principal
          </h1>
          <p style={{
            fontFamily: 'var(--font-body)',
            fontSize:    '0.88rem',
            color:       'rgba(255,255,255,0.72)',
            margin:      '0.5rem 0 0',
            fontWeight:   500,
          }}>
            Bienvenido de nuevo, <span style={{ color: '#FFFFFF', fontWeight: 700 }}>{user?.nombre || user?.username}</span>. Gestión clínica y administrativa en tiempo real.
          </p>
        </div>
      </div>



      {/* ── Accesos rápidos ── */}
      <div style={{ marginBottom:'2rem' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'1.25rem' }}>
          <div style={{ width:4, height:18, background:'var(--color-azul-fuerte)', borderRadius:2 }}/>
          <h2 style={{ fontFamily:"var(--font-display)", fontSize:'1rem', fontWeight:700, color:'var(--text-primary)', margin:0 }}>
            Accesos Rápidos
          </h2>
          <span style={{ fontSize:'0.75rem', color:'var(--text-muted)', fontFamily: 'var(--font-body)', fontWeight: 500 }}>— selecciona un módulo para comenzar</span>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:'1rem' }}>
          {cards.map((card, i) => <QuickCard key={card.path} {...card} index={i} />)}
        </div>
      </div>

    </div>
  );
}
