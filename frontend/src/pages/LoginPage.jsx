/**
 * LoginPage.jsx — Página de autenticación
 * Hospital Escandón BI Platform v4.0
 * Rediseño premium con identidad de marca y micro-interacciones
 */
import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { login, user, loading, error } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();
  const from      = location.state?.from?.pathname || '/';

  const [form,       setForm]       = useState({ username: '', password: '' });
  const [submitting, setSubmitting] = useState(false);
  const [showPass,   setShowPass]   = useState(false);
  const [localError, setLocalError] = useState('');

  // Si ya está autenticado, redirigir
  useEffect(() => {
    if (!loading && user) navigate(from, { replace: true });
  }, [user, loading]);

  const handleChange = (e) => {
    setLocalError('');
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.username.trim() || !form.password.trim()) {
      setLocalError('Ingrese usuario y contraseña.');
      return;
    }
    setSubmitting(true);
    const ok = await login(form.username.trim().toLowerCase(), form.password);
    setSubmitting(false);
    if (ok) navigate(from, { replace: true });
    else setLocalError(error || 'Credenciales incorrectas. Intente de nuevo.');
  };

  return (
    <div style={{
      minHeight:     '100vh',
      background:    'radial-gradient(circle at 80% 20%, #083b66 0%, #002347 100%)',
      display:       'flex',
      alignItems:    'center',
      justifyContent:'center',
      padding:       '1.5rem',
      position:      'relative',
      overflow:      'hidden',
    }}>
      {/* Background Medical Cross Pattern Grid */}
      <div style={{
        position: 'absolute',
        inset: 0,
        opacity: 0.03,
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60' viewBox='0 0 60 60'%3E%3Cpath d='M27 10h6v17h17v6H33v17h-6V33H10v-6h17V10z' fill='%23ffffff' fill-rule='evenodd'/%3E%3C/svg%3E")`,
        backgroundSize: '60px 60px',
        pointerEvents: 'none',
      }}/>

      {/* Decorative Orbs */}
      {[
        { w:500, h:500, top:'-150px', left:'-100px', bg:'radial-gradient(circle, rgba(0,184,163,0.1) 0%, rgba(0,0,0,0) 70%)' },
        { w:400, h:400, bottom:'-100px', right:'-50px', bg:'radial-gradient(circle, rgba(0,70,135,0.2) 0%, rgba(0,0,0,0) 70%)' },
      ].map((s, i) => (
        <div key={i} style={{
          position:     'absolute',
          width:         s.w,
          height:        s.h,
          top:           s.top,
          bottom:        s.bottom,
          left:          s.left,
          right:         s.right,
          background:    s.bg,
          borderRadius: '50%',
          pointerEvents:'none',
        }}/>
      ))}

      {/* Login Card Wrapper with rotating border effect simulated via premium styling */}
      <div className="login-card-wrapper" style={{
        position: 'relative',
        padding: '3px',
        borderRadius: '24px',
        background: 'linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.03))',
        boxShadow: '0 32px 80px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.15)',
        width: '100%',
        maxWidth: '430px',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        animation: 'cardEntrance 0.7s cubic-bezier(0.16, 1, 0.3, 1) both',
      }}>
        <div style={{
          background: '#ffffff',
          borderRadius: '21px',
          padding: '2.75rem 2.25rem 2.25rem',
        }}>
          {/* Internal animations and styles */}
          <style>{`
            @keyframes cardEntrance {
              from { opacity: 0; transform: scale(0.96) translateY(15px); }
              to { opacity: 1; transform: scale(1) translateY(0); }
            }
            .login-field-group {
              margin-bottom: 1.25rem;
            }
            .login-label {
              display: block;
              font-family: var(--font-display);
              font-size: 0.75rem;
              font-weight: 700;
              color: var(--color-azul-oscuro);
              margin-bottom: 0.45rem;
              letter-spacing: 0.06em;
              text-transform: uppercase;
            }
            .login-input-container {
              position: relative;
              display: flex;
              align-items: center;
            }
            .login-icon-left {
              position: absolute;
              left: 0.875rem;
              color: #A0AEC0;
              display: flex;
              align-items: center;
              pointer-events: none;
              transition: color 0.2s;
            }
            .login-input-field {
              width: 100%;
              padding: 0.75rem 1rem 0.75rem 2.5rem;
              border: 1.5px solid #E2E8F0;
              border-radius: 12px;
              font-family: var(--font-body);
              font-size: 0.92rem;
              outline: none;
              transition: all 250ms ease;
              background: #F8FAFC;
              color: var(--color-navy);
            }
            .login-input-field:focus {
              border-color: var(--color-verde-e);
              background: #FFFFFF;
              box-shadow: 0 0 0 4px rgba(0, 184, 163, 0.12);
            }
            .login-input-field:focus + .login-icon-left {
              color: var(--color-verde-e);
            }
            .login-btn-submit {
              position: relative;
              width: 100%;
              padding: 0.8rem;
              background: linear-gradient(135deg, var(--color-azul-claro) 0%, var(--color-azul-fuerte) 100%);
              border: none;
              border-radius: 12px;
              color: white;
              font-family: var(--font-display);
              font-size: 0.95rem;
              font-weight: 700;
              letter-spacing: 0.02em;
              cursor: pointer;
              transition: all 250ms cubic-bezier(0.16, 1, 0.3, 1);
              margin-top: 1.5rem;
              overflow: hidden;
            }
            .login-btn-submit:hover:not(:disabled) {
              transform: translateY(-2px);
              box-shadow: 0 8px 24px rgba(0, 70, 135, 0.35);
            }
            .login-btn-submit:active:not(:disabled) {
              transform: translateY(0);
            }
            .login-btn-submit::after {
              content: '';
              position: absolute;
              top: 0; left: -50%; width: 30%; height: 100%;
              background: linear-gradient(to right, rgba(255,255,255,0) 0%, rgba(255,255,255,0.3) 50%, rgba(255,255,255,0) 100%);
              transform: skewX(-25deg);
              transition: 0.75s;
            }
            .login-btn-submit:hover::after {
              left: 120%;
            }
            .login-btn-submit:disabled {
              opacity: 0.7;
              cursor: not-allowed;
              transform: none !important;
              box-shadow: none !important;
            }
            .pass-toggle-btn {
              position: absolute;
              right: 0.875rem;
              background: none;
              border: none;
              cursor: pointer;
              color: #A0AEC0;
              padding: 4px;
              display: flex;
              align-items: center;
              transition: color 0.2s;
            }
            .pass-toggle-btn:hover {
              color: var(--color-azul-medio);
            }
          `}</style>

          {/* Logo & Subtitle */}
          <div style={{ textAlign:'center', marginBottom:'2rem' }}>
            <img
              src="/logo-escandon.png"
              alt="Hospital Escandón"
              style={{
                height:       76,
                width:        'auto',
                margin:       '0 auto 0.75rem',
                display:      'block',
                objectFit:    'contain',
              }}
            />
            <p style={{
              fontFamily: 'var(--font-display)',
              fontSize: '0.8rem',
              fontWeight: 600,
              color: '#8A97A8',
              margin: 0,
              letterSpacing: '0.02em',
            }}>
              Inteligencia de Negocios · Hospital Escandón
            </p>
          </div>

          {/* Formulario */}
          <form onSubmit={handleSubmit} noValidate>
            {/* Usuario */}
            <div className="login-field-group">
              <label className="login-label">Usuario</label>
              <div className="login-input-container">
                <input
                  className="login-input-field"
                  type="text"
                  name="username"
                  value={form.username}
                  onChange={handleChange}
                  placeholder="Ingrese su usuario"
                  autoComplete="off"
                  autoFocus
                  disabled={submitting}
                />
                <span className="login-icon-left">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </span>
              </div>
            </div>

            {/* Contraseña */}
            <div className="login-field-group" style={{ marginBottom: '0.75rem' }}>
              <label className="login-label">Contraseña</label>
              <div className="login-input-container">
                <input
                  className="login-input-field"
                  style={{ paddingRight: '2.75rem' }}
                  type={showPass ? 'text' : 'password'}
                  name="password"
                  value={form.password}
                  onChange={handleChange}
                  placeholder="Ingrese su contraseña"
                  autoComplete="off"
                  disabled={submitting}
                />
                <span className="login-icon-left">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </span>
                <button
                  type="button"
                  onClick={() => setShowPass(s => !s)}
                  className="pass-toggle-btn"
                  tabIndex={-1}
                >
                  {showPass ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Error */}
            {localError && (
              <div style={{
                background:  'rgba(239,68,68,0.06)',
                border:      '1.5px solid rgba(239,68,68,0.15)',
                borderRadius: '10px',
                padding:     '0.65rem 0.875rem',
                fontSize:    '0.8rem',
                color:       '#E53E3E',
                marginTop:   '1rem',
                display:     'flex',
                alignItems:  'center',
                fontFamily:  'var(--font-body)',
              }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px', flexShrink: 0 }}>
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                {localError}
              </div>
            )}

            {/* Botón */}
            <button className="login-btn-submit" type="submit" disabled={submitting}>
              {submitting ? (
                <span style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:'0.6rem' }}>
                  <span style={{
                    width: 16,
                    height: 16,
                    border: '2px solid rgba(255,255,255,0.3)',
                    borderTop: '2px solid white',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                    display: 'block'
                  }}/>
                  <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                  Validando accesos…
                </span>
              ) : (
                'Entrar'
              )}
            </button>
          </form>

          {/* Footer */}
          <div style={{ textAlign:'center', marginTop:'1.75rem', borderTop:'1px solid #EDF2F7', paddingTop:'1.25rem' }}>
            <p style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.68rem',
              color: '#A0AEC0',
              margin: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px'
            }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7 }}>
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              Acceso restringido · HE-BI v<span style={{ fontWeight: 600 }}>4.0</span> · {new Date().getFullYear()}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
