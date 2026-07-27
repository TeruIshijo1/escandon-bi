/**
 * Sidebar.jsx — Navegación lateral con control RBAC
 * Hospital Escandón BI Platform v4.0
 * Rediseño premium con identidad de marca y micro-interacciones
 */
import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth }                  from '../../context/AuthContext';
import { getNavItems, AREAS_LABELS, hasPermission } from '../../utils/rbac';

export default function Sidebar() {
  const { user, logout }    = useAuth();
  const navigate            = useNavigate();
  const location            = useLocation();
  const [collapsed, setCol] = useState(false);

  if (!user) return null;

  const navItems = getNavItems(user.role, user.area, user.username)
    .filter(item => hasPermission(user, item.path));

  // Agrupar por sección
  const sections = navItems.reduce((acc, item) => {
    if (!acc[item.section]) acc[item.section] = [];
    acc[item.section].push(item);
    return acc;
  }, {});

  const initials = user.nombre
    ? user.nombre.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase()
    : user.username?.slice(0,2).toUpperCase() ?? 'US';

  return (
    <aside className="sidebar">
      {/* Logo Section */}
      <div className="sidebar-logo">
        <div style={{
          background:    '#FFFFFF',
          borderRadius:  '20px',
          padding:       '6px 16px',
          display:       'flex',
          alignItems:    'center',
          justifyContent:'center',
          boxShadow:     '0 4px 12px rgba(0,0,0,0.15), inset 0 -1px 0 rgba(0,0,0,0.05)',
          transition:    'transform var(--transition-base)',
          cursor:        'pointer',
        }}
        onClick={() => navigate('/')}
        onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.03)'}
        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
        >
          <img
            src="/logo-escandon.png"
            alt="Hospital Escandón"
            style={{ height: 30, width: 'auto', objectFit: 'contain', display: 'block' }}
          />
        </div>
        <div className="sidebar-logo-text">
          <span className="sidebar-logo-title" style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.02em', fontSize: '0.9rem' }}>Hospital Escandón</span>
          <span className="sidebar-logo-sub" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', letterSpacing: '0.08em', marginTop: '2px' }}>Plataforma HE-BI</span>
        </div>
      </div>

      {/* Navegación */}
      <nav className="sidebar-nav">
        {Object.entries(sections).map(([section, items]) => (
          <div key={section}>
            <div className="nav-section-label" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.12em', paddingLeft: '1.25rem' }}>{section}</div>
            {items.map(item => (
              <button
                key={item.path}
                className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
                onClick={() => navigate(item.path)}
                title={item.label}
                style={{ fontFamily: 'var(--font-body)' }}
              >
                <span className="nav-item-icon">{item.icon}</span>
                <span style={{ fontSize: '0.82rem', letterSpacing: '0.01em' }}>{item.label}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>

      {/* Footer de usuario */}
      <div className="sidebar-footer">
        <div className="user-badge">
          <div className="user-avatar">{initials}</div>
          <div className="user-info">
            <div className="user-name" style={{ fontFamily: 'var(--font-body)' }}>{user.nombre || user.username}</div>
            <div className="user-role" style={{ fontFamily: 'var(--font-mono)' }}>
              {user.role}
              {user.area ? ` · ${AREAS_LABELS[user.area] ?? user.area}` : ''}
            </div>
          </div>
        </div>
        <button
          onClick={logout}
          title="Cerrar sesión"
          style={{
            display:       'flex',
            alignItems:    'center',
            justifyContent: 'center',
            gap:           '0.5rem',
            background:    'none',
            border:        'none',
            cursor:        'pointer',
            color:         'rgba(255,255,255,0.55)',
            fontSize:      '0.75rem',
            padding:       '0.6rem 0.625rem',
            borderRadius:  '8px',
            transition:    'all var(--transition-fast)',
            fontFamily:    'var(--font-body)',
            fontWeight:    600,
            width:         '100%',
            marginTop:     '0.5rem',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.color = '#FFFFFF';
            e.currentTarget.style.background = 'rgba(220, 38, 38, 0.18)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color = 'rgba(255,255,255,0.55)';
            e.currentTarget.style.background = 'none';
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>
          </svg>
          Cerrar sesión
        </button>
        <div style={{ 
          marginTop: '1.2rem', 
          textAlign: 'center', 
          fontSize: '0.6rem', 
          fontFamily: 'var(--font-mono)', 
          color: 'rgba(255,255,255,0.3)',
          letterSpacing: '0.05em'
        }}>
          Autor: <a href="https://github.com/TeruIshijo1" target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none', transition: 'color 0.2s' }} onMouseEnter={e => e.target.style.color = 'rgba(255,255,255,0.8)'} onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.3)'}>Ing. Alberto García M.</a>
        </div>
      </div>
    </aside>
  );
}
