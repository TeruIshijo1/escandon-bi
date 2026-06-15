/**
 * PBIModal.jsx — Modal de visualización de reporte Power BI
 * Hospital Escandón BI Platform v4.0
 *
 * Se abre cuando el usuario hace click en un KPICard con URL configurada.
 * Props:
 *   url    {string}  — URL del reporte PBI
 *   title  {string}  — Nombre del indicador
 *   onClose {fn}     — Cerrar el modal
 */
import { useEffect } from 'react';

export default function PBIModal({ url, title, multiPagina = false, onClose }) {
  // ESC para cerrar
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!url) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(13,27,42,0.7)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 2000, animation: 'pbiModalIn 220ms ease',
      }}
    >
      <style>{`
        @keyframes pbiModalIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes pbiPanelIn {
          from { opacity: 0; transform: scale(0.96) translateY(12px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>

      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '95vw', maxWidth: 1100,
          height: '90vh',
          background: 'white',
          borderRadius: 18,
          overflow: 'hidden',
          boxShadow: '0 30px 80px rgba(0,0,0,0.4)',
          display: 'flex', flexDirection: 'column',
          animation: 'pbiPanelIn 250ms ease',
        }}
      >
        {/* Header */}
        <div style={{
          background: 'linear-gradient(90deg, #004687, #0088C9)',
          padding: '0.9rem 1.5rem',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              width: 34, height: 34, borderRadius: 8,
              background: 'rgba(255,255,255,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.1rem',
            }}>📊</div>
            <div>
              <div style={{ fontSize: '0.62rem', fontWeight: 700, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Reporte Power BI
              </div>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'white' }}>
                {title}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            title="Cerrar (Esc)"
            style={{
              background: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.25)',
              borderRadius: 8, color: 'white',
              width: 36, height: 36, fontSize: '1rem',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 150ms',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.25)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
          >✕</button>
        </div>

        {/* Iframe */}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {/* Capa que recorta la barra de PBI (~36px) si no es multipágina */}
          <div style={{ width: '100%', height: multiPagina ? '100%' : 'calc(100% + 36px)', position: 'absolute', top: 0, left: 0 }}>
            <iframe
              title={title}
              src={url}
              width="100%"
              height="100%"
              frameBorder="0"
              allowFullScreen={false}
              style={{ border: 'none', background: 'white' }}
              loading="lazy"
            />
          </div>

          {/* Máscaras de seguridad para ocultar Logo y Compartir de Power BI si es multipágina */}
          {multiPagina && (
            <>
              {/* Esquina Inferior Izquierda (Oculta "Microsoft Power BI") */}
              <div style={{
                position: 'absolute', bottom: 0, left: 0,
                width: '180px', height: '36px',
                background: '#f3f2f1', zIndex: 10,
                pointerEvents: 'auto',
              }} />
              {/* Esquina Inferior Derecha (Oculta Compartir y Ampliar) */}
              <div style={{
                position: 'absolute', bottom: 0, right: 0,
                width: '120px', height: '36px',
                background: '#f3f2f1', zIndex: 10,
                pointerEvents: 'auto',
              }} />
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '0.45rem 1.5rem',
          background: '#F8FAFC',
          borderTop: '1px solid #E2E8F0',
          fontSize: '0.62rem', fontWeight: 600, color: '#94A3B8',
          textAlign: 'center', letterSpacing: '0.04em', flexShrink: 0,
        }}>
          🔒 CONEXIÓN ENCRIPTADA · HOSPITAL ESCANDÓN · PRESIONE ESC PARA CERRAR
        </div>
      </div>
    </div>
  );
}
