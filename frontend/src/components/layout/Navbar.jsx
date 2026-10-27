 
import { useState, useEffect, useRef, useId } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import HospitalPulse from './HospitalPulse';
import './Navbar.css';

const ROUTE_TITLES = {
  '/':                      'Inicio',
  '/dashboard/directivo':   'Tablero directivo',
  '/dashboard/area':        'Tablero de Área',
  '/auditoria/inventarios': 'Inventarios y Consumos Clínicos',
  '/auditoria/cargos':      'Discrepancias en Consumos',
  '/auditoria/ventas-hospitalarias': 'Ventas hospitalarias',
  '/estadisticas':          'Estadísticas',
  '/admin/usuarios':        'Gestión de Usuarios',
  '/admin/auditoria-log':   'Historial de actividad',
  '/admin/configuracion':   'Configuración del Sistema',
};

const ROLE_META = {
  ADMIN: { label: 'Administrador', bg: 'rgba(0, 136, 201, .07)', color: 'var(--color-azul-fuerte)' },
  DIRECTOR: { label: 'Director', bg: 'rgba(232, 133, 61, .1)', color: '#925018' },
  JEFE_AREA: { label: 'Jefe de Área', bg: 'rgba(0, 151, 74, .08)', color: '#067440' },
  USUARIO_OPERATIVO: { label: 'Operativo', bg: 'rgba(90, 107, 124, .08)', color: '#5A6B7C' },
};

export default function Navbar({ onToggleSidebar, isSidebarCollapsed }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenu] = useState(false);
  const menuRef = useRef(null);
  const accountButtonRef = useRef(null);
  const accountMenuId = useId();
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') || 'light');

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nextTheme);
    localStorage.setItem('theme', nextTheme);
    setTheme(nextTheme);
  };

  useEffect(() => {
    setTheme(document.documentElement.getAttribute('data-theme') || 'light');
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = event => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenu(false);
    };
    const closeOnEscape = event => {
      if (event.key === 'Escape') {
        setMenu(false);
        accountButtonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

  const title = ROUTE_TITLES[location.pathname] || 'Portal del hospital';
  const currentRole = ROLE_META[user?.role] || { label: user?.role || 'Usuario', bg: 'rgba(90, 107, 124, .08)', color: 'var(--text-secondary)' };
  const displayName = user?.nombre?.split(' ')[0] || user?.username || 'Usuario';

  return (
    <nav className="navbar hospital-navbar" aria-label="Navegación principal">
      <HospitalPulse />
      <div className="hospital-navbar__identity">
        <button type="button" className="hospital-navbar__icon-button" onClick={onToggleSidebar}
          title={isSidebarCollapsed ? 'Mostrar Menú' : 'Ocultar Menú'}
          aria-label={isSidebarCollapsed ? 'Mostrar Menú' : 'Ocultar Menú'}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div className="hospital-navbar__titles">
          <div className="hospital-navbar__breadcrumb">
            <span>HE-BI</span>
            <span className="hospital-navbar__breadcrumb-separator" aria-hidden="true">/</span>
            <span className="hospital-navbar__breadcrumb-current">{title}</span>
          </div>
          <h2 className="hospital-navbar__title" title={title}>{title}</h2>
        </div>
      </div>

      <div className="hospital-navbar__controls">
        <button type="button" className="hospital-navbar__icon-button hospital-navbar__theme" onClick={toggleTheme}
          title={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
          aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            {theme === 'dark' ? <path d="M20.7 13.2A8.7 8.7 0 0 1 10.8 3.3 8.7 8.7 0 1 0 20.7 13.2Z" /> : <><circle cx="12" cy="12" r="3.7" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>}
          </svg>
        </button>
        <span className="hospital-navbar__role" style={{ '--role-background': currentRole.bg, '--role-color': currentRole.color }}>{currentRole.label}</span>
        <div className="hospital-navbar__account" ref={menuRef}>
          <button type="button" className="hospital-navbar__account-trigger" ref={accountButtonRef}
            onClick={() => setMenu(open => !open)} aria-expanded={menuOpen}
            aria-controls={menuOpen ? accountMenuId : undefined} aria-label={`Cuenta de ${displayName}`}>
            <span className="hospital-navbar__avatar" aria-hidden="true">
              {user?.nombre?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'US'}
            </span>
            <span className="hospital-navbar__name">{displayName}</span>
            <svg className="hospital-navbar__chevron" aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m7 10 5 5 5-5" /></svg>
          </button>
          {menuOpen && (
            <div className="hospital-navbar__dropdown" id={accountMenuId}>
              <div className="hospital-navbar__account-details">
                <p>{user?.nombre}</p>
                <small>{user?.email || user?.username}</small>
              </div>
              <div className="hospital-navbar__dropdown-actions">
                <button type="button" className="hospital-navbar__logout" onClick={() => { setMenu(false); logout(); }}>
                  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
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
