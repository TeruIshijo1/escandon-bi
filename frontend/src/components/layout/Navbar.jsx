/**
 * Navbar.jsx — Barra de navegación superior
 * Hospital Escandón BI Platform v4.0
 * Estilo con olas decorativas y diseño limpio
 */
import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const ROUTE_TITLES = {
  '/':                      'Inicio',
  '/dashboard/directivo':   'Dashboard Directivo',
  '/dashboard/area':        'Tablero de Área',
  '/auditoria/inventarios': 'Inventarios y Consumos Clínicos',
  '/auditoria/cargos':      'Discrepancias en Consumos',
  '/estadisticas':          'Estadísticas',
  '/admin/usuarios':        'Gestión de Usuarios',
  '/admin/auditoria-log':   'Log de Auditoría',
  '/admin/configuracion':   'Configuración del Sistema',
};

/* SVG de electrocardiograma (ECG) — estilo monitor cardíaco hospitalario */
const EcgSVG = () => {
  // Patrón de un ciclo ECG: baseline → P-wave → QRS spike → T-wave → baseline
  // Cada ciclo ocupa ~200 unidades de ancho
  const ecgCycle = (offset) => {
    const x = offset;
    return [
      // Línea base
      `L${x},35`,
      `L${x + 20},35`,
      // P-wave (pequeña onda redondeada)
      `L${x + 28},33`,
      `L${x + 35},30`,
      `L${x + 42},33`,
      `L${x + 50},35`,
      // Segmento PR
      `L${x + 60},35`,
      // Complejo QRS (pico agudo característico)
      `L${x + 65},38`,   // Q - baja leve
      `L${x + 70},8`,    // R - pico alto agudo
      `L${x + 75},45`,   // S - baja profunda
      `L${x + 80},35`,   // vuelta a baseline
      // Segmento ST
      `L${x + 95},35`,
      // T-wave (onda redondeada)
      `L${x + 105},30`,
      `L${x + 115},26`,
      `L${x + 125},30`,
      `L${x + 135},35`,
      // Línea base final del ciclo
      `L${x + 200},35`,
    ].join(' ');
  };

  // Generar múltiples ciclos para cubrir todo el ancho
  const cycles = [];
  for (let i = 0; i < 2400; i += 200) {
    cycles.push(ecgCycle(i));
  }
  const pathData = `M0,35 ${cycles.join(' ')}`;

  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '100%',
        width: '100%',
        pointerEvents: 'none',
      }}
      viewBox="0 0 2400 55"
      preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Línea ECG principal */}
      <path
        d={pathData}
        fill="none"
        stroke="var(--color-azul-claro)"
        strokeWidth="2"
        opacity="0.08"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Línea ECG secundaria (ligeramente offset para profundidad) */}
      <path
        d={pathData}
        fill="none"
        stroke="var(--color-azul-fuerte)"
        strokeWidth="1.2"
        opacity="0.03"
        strokeLinejoin="round"
        strokeLinecap="round"
        transform="translate(100, 3)"
      />
    </svg>
  );
};

export default function Navbar() {
  const { user, logout }  = useAuth();
  const location           = useLocation();
  const [menuOpen, setMenu] = useState(false);
  const menuRef = useRef(null);

  // Cerrar menú al hacer click fuera
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuOpen && menuRef.current && !menuRef.current.contains(event.target)) {
        setMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  const title = ROUTE_TITLES[location.pathname] || 'Plataforma BI';

  // Role names and gradient colors
  const roleMeta = {
    ADMIN: { label: 'Administrador', bg: 'linear-gradient(135deg, rgba(0, 70, 135, 0.1), rgba(0, 136, 201, 0.15))', color: 'var(--color-azul-fuerte)' },
    DIRECTOR: { label: 'Director', bg: 'linear-gradient(135deg, rgba(232, 133, 61, 0.1), rgba(232, 133, 61, 0.2))', color: 'var(--color-accent-warm)' },
    JEFE_AREA: { label: 'Jefe de Área', bg: 'linear-gradient(135deg, rgba(0, 151, 74, 0.08), rgba(0, 151, 74, 0.15))', color: 'var(--color-verde-e)' },
    USUARIO_OPERATIVO: { label: 'Operativo', bg: 'linear-gradient(135deg, rgba(90, 107, 124, 0.08), rgba(90, 107, 124, 0.15))', color: '#5A6B7C' }
  };

  const currentRole = roleMeta[user?.role] || { label: user?.role || 'Usuario', bg: 'rgba(0,0,0,0.05)', color: '#4A5568' };

  return (
    <nav style={{
      position:       'fixed',
      top:             0,
      left:           'var(--sidebar-width)',
      right:           0,
      height:         'var(--navbar-height)',
      background:     'rgba(255, 255, 255, 0.85)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      borderBottom:   '1px solid rgba(0, 70, 135, 0.08)',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'space-between',
      padding:        '0 2rem',
      zIndex:          99,
    }}>

      {/* Electrocardiograma decorativo de fondo */}
      <EcgSVG />

      {/* Breadcrumb + Título de página */}
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          marginBottom: '0.15rem',
        }}>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.6rem',
            fontWeight: 600,
            color: 'var(--text-muted)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}>HE-BI</span>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>›</span>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.6rem',
            fontWeight: 600,
            color: 'var(--color-azul-claro)',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}>{title}</span>
        </div>
        <h2 style={{
          fontFamily: 'var(--font-display)',
          fontSize: '1rem',
          fontWeight: 800,
          color: 'var(--text-primary)',
          margin: 0,
          lineHeight: 1.2,
          letterSpacing: '-0.02em',
        }}>
          {title}
        </h2>
      </div>

      {/* Controles derechos */}
      <div style={{ display:'flex', alignItems:'center', gap:'1rem', position:'relative', zIndex:1 }}>

        {/* Rol badge con gradient */}
        <span style={{
          background:   currentRole.bg,
          border:       `1px solid ${currentRole.color}25`,
          borderRadius: '100px',
          padding:      '0.3rem 0.95rem',
          fontSize:     '0.72rem',
          color:        currentRole.color,
          fontWeight:    700,
          letterSpacing:'0.04em',
          fontFamily:   'var(--font-mono)',
          textTransform: 'uppercase',
          boxShadow:    'inset 0 1px 0 rgba(255,255,255,0.4)',
        }}>{currentRole.label}</span>

        {/* Avatar + menú desplegable */}
        <div style={{ position:'relative' }} ref={menuRef}>
          <button
            onClick={() => setMenu(o => !o)}
            style={{
              display:       'flex',
              alignItems:    'center',
              gap:           '0.55rem',
              background:    'rgba(255,255,255,0.5)',
              border:        '1px solid rgba(0, 70, 135, 0.12)',
              borderRadius:  '100px',
              padding:       '0.25rem 0.8rem 0.25rem 0.3rem',
              cursor:        'pointer',
              transition:    'all var(--transition-fast)',
              boxShadow:     'var(--shadow-xs)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = '#FFFFFF';
              e.currentTarget.style.borderColor = 'rgba(0, 136, 201, 0.3)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.5)';
              e.currentTarget.style.borderColor = 'rgba(0, 70, 135, 0.12)';
            }}
          >
            <div style={{
              width:26, height:26, borderRadius:'50%',
              background: 'linear-gradient(135deg, var(--color-azul-fuerte), var(--color-azul-claro))',
              display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:'0.65rem', fontWeight:700, color:'white', flexShrink:0,
              fontFamily: 'var(--font-display)',
              boxShadow: '0 2px 6px rgba(0, 70, 135, 0.2)',
            }}>
              {user?.nombre?.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase() || 'US'}
            </div>
            <span style={{
              fontSize:'0.82rem',
              fontWeight:600,
              color:'var(--text-primary)',
              maxWidth:125,
              overflow:'hidden',
              textOverflow:'ellipsis',
              whiteSpace:'nowrap',
              fontFamily: 'var(--font-body)',
            }}>
              {user?.nombre?.split(' ')[0] || user?.username}
            </span>
            <span style={{ 
              fontSize:'0.55rem', 
              color:'var(--text-muted)',
              transition: 'transform 250ms var(--ease-out-expo)',
              transform: menuOpen ? 'rotate(180deg)' : 'rotate(0deg)'
            }}>▼</span>
          </button>

          {/* Glassmorphic Dropdown */}
          {menuOpen && (
            <div style={{
              position:   'absolute',
              top:        'calc(100% + 8px)',
              right:       0,
              background: 'rgba(255, 255, 255, 0.94)',
              backdropFilter: 'var(--glass-blur)',
              WebkitBackdropFilter: 'var(--glass-blur)',
              borderRadius: '14px',
              border:     '1px solid rgba(0, 70, 135, 0.08)',
              boxShadow:  'var(--shadow-lg)',
              minWidth:   190,
              overflow:   'hidden',
              animation:  'fadeDown 200ms var(--ease-out-expo)',
              zIndex:     200,
            }}>
              <style>{`@keyframes fadeDown{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}`}</style>

              <div style={{ padding:'0.85rem 1.1rem', borderBottom:'1px solid rgba(0,70,135,0.05)' }}>
                <p style={{ fontSize:'0.82rem', fontWeight:700, color:'var(--text-primary)', margin:0, fontFamily: 'var(--font-body)' }}>{user?.nombre}</p>
                <p style={{ fontSize:'0.72rem', color:'var(--text-muted)', margin:'0.15rem 0 0', fontFamily: 'var(--font-mono)' }}>{user?.email || user?.username}</p>
              </div>

              <div style={{ padding:'0.5rem' }}>
                <button
                  onClick={() => { setMenu(false); logout(); }}
                  style={{
                    display:    'flex',
                    alignItems: 'center',
                    gap:        '0.6rem',
                    width:      '100%',
                    padding:    '0.6rem 0.8rem',
                    background: 'none',
                    border:     'none',
                    borderRadius: '8px',
                    cursor:     'pointer',
                    fontSize:   '0.82rem',
                    fontWeight:  600,
                    color:      'var(--color-danger)',
                    fontFamily: 'var(--font-body)',
                    textAlign:  'left',
                    transition: 'all var(--transition-fast)',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.color = '#FFFFFF';
                    e.currentTarget.style.background = 'var(--color-danger)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.color = 'var(--color-danger)';
                    e.currentTarget.style.background = 'none';
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>
                  </svg>
                  Cerrar sesión
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
