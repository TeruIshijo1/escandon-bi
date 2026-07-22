import React from 'react';

/**
 * PremiumLoader.jsx
 * Loader animado premium con el logo llenándose de color.
 */
export default function PremiumLoader({ text = "Cargando...", style = {} }) {
  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'center', 
      padding: '3rem',
      fontFamily: 'var(--font-body), system-ui, sans-serif',
      ...style
    }}>
      <div style={{ position: 'relative', width: '80px', height: '80px', marginBottom: '1.5rem' }}>
        {/* Base logo (transparent/gray) */}
        <img 
          src="/logo-escandon.png" 
          alt="Cargando base"
          style={{ 
            width: '100%', 
            height: '100%', 
            objectFit: 'contain', 
            opacity: 0.15, 
            filter: 'grayscale(100%)' 
          }}
        />
        {/* Animated fill logo */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          animation: 'logoFillRight 1.5s cubic-bezier(0.4, 0, 0.2, 1) infinite alternate'
        }}>
          <img 
            src="/logo-escandon.png" 
            alt="Cargando fill"
            style={{ 
              width: '80px', 
              height: '80px', 
              objectFit: 'contain', 
              position: 'absolute', 
              top: 0, 
              left: 0 
            }}
          />
        </div>
      </div>
      
      <style>
        {`
          @keyframes logoFillRight {
            0% { width: 0%; opacity: 0.8; }
            100% { width: 100%; opacity: 1; }
          }
          @keyframes textPulse {
            0% { opacity: 0.5; }
            50% { opacity: 1; }
            100% { opacity: 0.5; }
          }
        `}
      </style>
      
      <div style={{ 
        color: '#004687', 
        fontWeight: 600, 
        fontSize: '1rem', 
        letterSpacing: '0.5px', 
        animation: 'textPulse 2s infinite ease-in-out' 
      }}>
        {text}
      </div>
    </div>
  );
}
