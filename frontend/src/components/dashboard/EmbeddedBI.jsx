/**
 * EmbeddedBI.jsx — Visor de Tableros BI Protegido
 * 
 * Implementa medidas de seguridad para "Publish to Web":
 *  1. Ofuscación de URL (Base64)
 *  2. Bloqueo de Click Derecho (ContextMenu)
 *  3. Bloqueo de Teclas de Inspección (F12, Ctrl+Shift+I/J, Ctrl+U)
 *  4. UI Premium y Limpia
 */
import { useState, useEffect, useRef } from 'react';
import { API_BASE } from '../../api/config';

export default function EmbeddedBI({ reportId, height = 480, filters = {}, multiPagina = false }) {
  const containerRef = useRef(null);
  const [state, setState] = useState('loading'); // loading | ready | error
  const [embedUrl, setEmbedUrl] = useState('');
  const [isMultiPage, setIsMultiPage] = useState(multiPagina);
  const [refreshKey, setRefreshKey] = useState(0); // Para forzar recarga del iframe

  // Función para decodificar URL si viene ofuscada (Base64)
  const getDecodedUrl = (id) => {
    if (!id) return '';
    if (id.startsWith('http')) return id;
    try {
      // Intentar decodificar Base64
      return atob(id);
    } catch (e) {
      return id;
    }
  };

  useEffect(() => {
    const decoded = getDecodedUrl(reportId);
    setEmbedUrl(decoded);
    setIsMultiPage(multiPagina);

    if (decoded.startsWith('http')) {
      setState('ready');
      
      // Auto-impresión si viene el parámetro en la URL
      const params = new URLSearchParams(window.location.search);
      if (params.get('autoPrint') === 'true') {
        setTimeout(() => {
          window.print();
        }, 2000); // Dar tiempo a que el iframe cargue el contenido interno
      }
    } else if (reportId) {
      // Flujo de PowerBI Embedded (Token)
      (async () => {
        try {
          const token = sessionStorage.getItem('escandon_token');
          const res = await fetch(`${API_BASE}/bi/token/${reportId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) throw new Error('No se pudo obtener token de BI');
          const data = await res.json();
          
          // CRITICAL: Set the real URL from the database
          if (data.embedUrl && data.embedUrl.startsWith('http')) {
            setEmbedUrl(data.embedUrl);
          } else {
            setEmbedUrl(''); // Blank state if invalid
          }
          if (data.multiPagina !== undefined) {
            setIsMultiPage(!!data.multiPagina);
          }
          
          setState('ready');

          const params = new URLSearchParams(window.location.search);
          if (params.get('autoPrint') === 'true') {
            setTimeout(() => window.print(), 2500);
          }
        } catch (err) {
          console.error('[EmbeddedBI]', err);
          setState('error');
        }
      })();
    }

    // ── Medidas de Seguridad Anti-Inspección ──
    const handleKeyDown = (e) => {
      // Bloquear F12
      if (e.keyCode === 123) {
        e.preventDefault();
        return false;
      }
      // Bloquear Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C
      if (e.ctrlKey && e.shiftKey && (e.keyCode === 73 || e.keyCode === 74 || e.keyCode === 67)) {
        e.preventDefault();
        return false;
      }
      // Bloquear Ctrl+U (Ver código fuente)
      if (e.ctrlKey && e.keyCode === 85) {
        e.preventDefault();
        return false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [reportId]);

  const handleContextMenu = (e) => {
    e.preventDefault();
    return false;
  };

  const handleRefresh = () => {
    // En lugar de window.location.reload(), solo cambiamos el key del iframe
    setRefreshKey(prev => prev + 1);
  };

  return (
    <div 
      onContextMenu={handleContextMenu}
      className="bi-container-print"
      style={{ 
        width:'100%', 
        height: height, 
        aspectRatio: height === 'auto' ? '16/9' : undefined,
        background:'white', 
        borderRadius:12, 
        overflow:'hidden', 
        border:'1px solid #E2E8F0',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <style>{`
        @media print {
          @page {
            size: landscape;
            margin: 0mm;
          }
          .bi-container-print { 
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            height: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            background: white !important;
            z-index: 9999 !important;
          }
          .bi-header-no-print { 
            display: none !important; 
          }
          .bi-print-content {
            height: 100% !important;
            width: 100% !important;
          }
          iframe {
            border: none !important;
            width: 100% !important;
            height: 100% !important;
          }
        }
      `}</style>

      {/* Header del Embebido (Seguridad) */}
      <div className="bi-header-no-print" style={{ 
        padding: '0.75rem 1.25rem', 
        background: 'linear-gradient(90deg, #004687, #0088C9)',
        color: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
          <div style={{ width:32, height:32, background:'rgba(255,255,255,0.2)', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1.1rem' }}>📊</div>
          <div>
            <h4 style={{ margin:0, fontSize:'0.85rem', fontWeight:700 }}>Visualización de Datos Corporativa</h4>
            <p style={{ margin:0, fontSize:'0.65rem', opacity:0.8, letterSpacing:'0.05em' }}>HOSPITAL ESCANDÓN · ACCESO SEGURO</p>
          </div>
        </div>
        <button 
          onClick={handleRefresh}
          style={{ 
            background: 'rgba(255,255,255,0.15)', 
            border: '1px solid rgba(255,255,255,0.3)', 
            borderRadius: 6, 
            color: 'white', 
            padding: '0.35rem 0.75rem',
            fontSize: '0.7rem',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem'
          }}
        >
          🔄 Actualizar
        </button>
      </div>

      <div className="bi-header-no-print" style={{ 
        background: '#F1F5F9', 
        padding: '0.35rem 1rem', 
        fontSize: '0.65rem', 
        color: '#64748B',
        textAlign: 'center',
        borderBottom: '1px solid #E2E8F0',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.03em'
      }}>
        🔒 Conexión Encriptada · Entorno de datos protegido por políticas de privacidad
      </div>

      {/* Área de Visualización */}
      <div 
        ref={containerRef} 
        className="bi-print-content"
        style={{ 
          width: '100%', 
          flex: 1, // Usar flexbox para ocupar el resto del espacio
          position: 'relative', 
          background: '#F8FAFC' 
        }}
      >
        
        {state === 'loading' && (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', gap:'1.25rem' }}>
            <div className="security-loader" />
            <style>{`
              .security-loader {
                width: 48px; height: 48px; border: 3px solid rgba(0,70,135,0.05);
                border-top: 3px solid #004687; border-radius: 50%;
                animation: spin 1s cubic-bezier(0.76, 0, 0.24, 1) infinite;
              }
              @keyframes spin { to { transform: rotate(360deg); } }
            `}</style>
            <div style={{ textAlign: 'center' }}>
              <p style={{ color:'#0D1B2A', fontSize:'0.9rem', fontWeight:600, marginBottom: '0.25rem' }}>Verificando Seguridad</p>
              <p style={{ color:'#8A97A8', fontSize:'0.75rem' }}>Cargando tablero protegido para Hospital Escandón...</p>
            </div>
          </div>
        )}

        {state === 'error' && (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', gap:'1rem', padding:'2rem' }}>
            <div style={{ fontSize:'3rem' }}>🛡️</div>
            <div style={{ textAlign:'center' }}>
              <p style={{ fontWeight:700, color:'#0D1B2A', fontSize:'1rem', marginBottom:'0.5rem' }}>Acceso Restringido o Error de Carga</p>
              <p style={{ color:'#8A97A8', fontSize:'0.85rem', maxWidth: '400px' }}>
                No se pudo validar el origen del tablero. Por favor, asegúrese de tener una sesión activa o contacte al soporte técnico de Sistemas.
              </p>
            </div>
          </div>
        )}

        {state === 'ready' && !embedUrl && (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', background: '#FFFFFF' }}>
            <div style={{ opacity: 0.05, fontSize: '4rem', marginBottom: '1rem' }}>📊</div>
            <p style={{ color: '#A0AEC0', fontSize: '0.75rem', fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Sin tablero configurado para esta sección
            </p>
          </div>
        )}

        {state === 'ready' && embedUrl && (
          <div key={refreshKey} style={{ 
            width: '100%', 
            height: '100%', 
            position: 'relative',
            overflow: 'hidden' // Esencial para el recorte
          }}>
            {/* 
               Contenedor del Iframe con "Recorte" (Cropping)
               Aumentamos el height del iframe y lo desplazamos para ocultar la barra inferior de PBI (aprox 36px)
               No se recorta si es multipágina para permitir la barra de navegación nativa.
            */}
            <div style={{
              width: '100%',
              height: isMultiPage ? '100%' : 'calc(100% + 36px)',
              position: 'absolute',
              top: 0,
              left: 0
            }}>
              <iframe 
                title="Escandón BI Report" 
                width="100%" 
                height="100%" 
                src={embedUrl} 
                frameBorder="0" 
                allowFullScreen={false}
                style={{ 
                  border: 'none',
                  background: 'white'
                }}
                loading="lazy"
              ></iframe>
            </div>

            {/* Capa de protección superior (Shield) */}
            <div style={{
              position: 'absolute',
              top: 0, left: 0, right: 0, bottom: 0,
              zIndex: 1,
              pointerEvents: 'none',
              background: 'transparent'
            }} />

            {/* Máscaras de seguridad para ocultar Logo y Compartir de Power BI si es multipágina */}
            {isMultiPage && (
              <>
                {/* Esquina Inferior Izquierda (Oculta "Microsoft Power BI") */}
                <div style={{
                  position: 'absolute', bottom: 0, left: 0,
                  width: '180px', height: '38px',
                  background: '#f3f2f1', zIndex: 10,
                  pointerEvents: 'auto',
                }} />
                {/* Esquina Inferior Derecha (Oculta Compartir, Facebook, Twitter y Ampliar) */}
                <div style={{
                  position: 'absolute', bottom: 0, right: 0,
                  width: '200px', height: '38px',
                  background: '#f3f2f1', zIndex: 10,
                  pointerEvents: 'auto',
                }} />
              </>
            )}
          </div>
        )}
      </div>

      {/* Footer de seguridad */}
      <div className="bi-header-no-print" style={{
        padding: '0.5rem 1.5rem',
        background: '#F1F5F9',
        borderTop: '1px solid rgba(0,70,135,0.05)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center'
      }}>
        <span style={{ fontSize: '0.65rem', color: '#94A3B8', fontWeight: 600, letterSpacing: '0.05em' }}>
          🔒 CONEXIÓN ENCRIPTADA · ENTORNO DE DATOS PROTEGIDO POR POLÍTICAS DE PRIVACIDAD
        </span>
      </div>
    </div>
  );
}
