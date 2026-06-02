/**
 * SinAcceso.jsx — Página de error 403
 * Hospital Escandón BI Platform v4.0
 * Rediseño premium con shield animado
 */
import { useNavigate } from 'react-router-dom';
import { useAuth }     from '../context/AuthContext';

export default function SinAcceso() {
  const navigate      = useNavigate();
  const { user }      = useAuth();

  return (
    <div style={{
      minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
      background:'var(--color-bg-base)', flexDirection:'column', gap:'1rem', padding:'2rem',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <style>{`
        @keyframes shield-pulse {
          0%, 100% { transform: scale(1); filter: drop-shadow(0 0 0px rgba(220,38,38,0)); }
          50% { transform: scale(1.06); filter: drop-shadow(0 0 14px rgba(220,38,38,0.25)); }
        }
        @keyframes shield-ring {
          0% { transform: scale(1); opacity: 0.4; }
          100% { transform: scale(1.8); opacity: 0; }
        }
        @keyframes sin-acceso-in {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Background Medical Cross Pattern Grid */}
      <div style={{
        position: 'absolute',
        inset: 0,
        opacity: 0.025,
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60' viewBox='0 0 60 60'%3E%3Cpath d='M27 10h6v17h17v6H33v17h-6V33H10v-6h17V10z' fill='%23004687' fill-rule='evenodd'/%3E%3C/svg%3E")`,
        backgroundSize: '60px 60px',
        pointerEvents: 'none',
      }}/>

      <div style={{
        background:'#FFFFFF', borderRadius:24, padding:'3.5rem 2.5rem 3rem', maxWidth:460,
        width:'100%', textAlign:'center', boxShadow:'var(--shadow-xl)',
        border:'1px solid rgba(0, 70, 135, 0.08)',
        position: 'relative',
        zIndex: 1,
        animation: 'sin-acceso-in 400ms cubic-bezier(0.16,1,0.3,1) both',
      }}>
        {/* Animated Shield Icon */}
        <div style={{
          position: 'relative',
          width: 88,
          height: 88,
          margin: '0 auto 1.75rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {/* Ring animation */}
          <div style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: '2px solid rgba(220,38,38,0.3)',
            animation: 'shield-ring 2s ease-out infinite',
          }}/>
          {/* Icon container */}
          <div style={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, rgba(220,38,38,0.08), rgba(220,38,38,0.14))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-danger)',
            animation: 'shield-pulse 3s ease-in-out infinite',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6), 0 4px 14px rgba(220,38,38,0.12)',
          }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
        </div>

        {/* Error code badge */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          background: 'rgba(220,38,38,0.07)',
          border: '1px solid rgba(220,38,38,0.15)',
          borderRadius: '100px',
          padding: '0.2rem 0.75rem',
          marginBottom: '0.85rem',
        }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', fontWeight: 800, color: 'var(--color-danger)', letterSpacing: '0.08em' }}>ERROR 403</span>
        </div>

        <h1 style={{ fontFamily:"var(--font-display)", fontSize:'1.65rem', fontWeight:800, color:'var(--color-azul-fuerte)', margin:'0 0 0.65rem', letterSpacing: '-0.02em' }}>
          Acceso Restringido
        </h1>
        <p style={{ fontFamily: 'var(--font-body)', color:'var(--text-secondary)', fontSize:'0.9rem', lineHeight:1.65, margin:'0 0 2rem', fontWeight: 500 }}>
          No tienes los privilegios necesarios para ver esta sección.
          {user ? (
            <span> Tu rol actual es <strong style={{ color: 'var(--color-azul-fuerte)', fontFamily: 'var(--font-mono)', fontSize: '0.85em' }}>{user.role}</strong>.</span>
          ) : ''}
        </p>

        <div style={{ display:'flex', gap:'0.875rem', justifyContent:'center' }}>
          <button
            onClick={() => navigate(-1)}
            style={{ 
              padding:'0.7rem 1.45rem', 
              border:'1.5px solid rgba(0,70,135,0.15)', 
              borderRadius:12, 
              background:'white', 
              color:'var(--color-azul-fuerte)', 
              fontFamily:"var(--font-display)", 
              fontSize:'0.85rem', 
              fontWeight:700, 
              cursor:'pointer',
              transition: 'all 200ms ease',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#F0F5FF'; e.currentTarget.style.borderColor = 'var(--color-azul-fuerte)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'white'; e.currentTarget.style.borderColor = 'rgba(0,70,135,0.15)'; }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            Volver Atrás
          </button>
          <button
            onClick={() => navigate('/')}
            style={{ 
              padding:'0.7rem 1.45rem', 
              border:'none', 
              borderRadius:12, 
              background:'linear-gradient(135deg, var(--color-azul-fuerte), var(--color-azul-claro))',
              color:'white', 
              fontFamily:"var(--font-display)", 
              fontSize:'0.85rem', 
              fontWeight:700, 
              cursor:'pointer',
              boxShadow: '0 4px 14px rgba(0, 70, 135, 0.25)',
              transition: 'all 200ms ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.9'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'translateY(0)'; }}
          >
            Ir al Inicio
          </button>
        </div>

        {/* Footer version */}
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--text-muted)', margin: '1.75rem 0 0', letterSpacing: '0.04em' }}>
          HE-BI v4.0 · Hospital Escandón
        </p>
      </div>
    </div>
  );
}
