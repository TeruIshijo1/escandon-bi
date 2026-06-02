/**
 * ExportButton.jsx — Botones de exportación PDF y Excel
 * Hospital Escandón BI Platform v4.0
 * Rediseño premium
 */
import { useState } from 'react';
import { API_BASE } from '../../api/config';

const CONFIG = {
  pdf: {
    label:   'Exportar PDF',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
        <polyline points="10 9 9 9 8 9"/>
      </svg>
    ),
    bg:      '#0088C9',
    shadow:  'rgba(0,136,201,0.35)',
    endpoint: 'pdf',
  },
  excel: {
    label:   'Exportar Excel',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        <line x1="9" y1="3" x2="9" y2="21"/>
        <line x1="15" y1="3" x2="15" y2="21"/>
        <line x1="3" y1="9" x2="21" y2="9"/>
        <line x1="3" y1="15" x2="21" y2="15"/>
      </svg>
    ),
    bg:      '#00974A',
    shadow:  'rgba(0,151,74,0.35)',
    endpoint: 'excel',
  },
};

export default function ExportButton({ type = 'pdf', reportId, directUrl = null, compact = false }) {
  const [loading, setLoading] = useState(false);
  const cfg = CONFIG[type] || CONFIG.pdf;

  const handleExport = async () => {
    if (loading) return;

    if (type === 'pdf') {
      window.print();
      return;
    }

    if (type === 'excel' && directUrl) {
      const a = document.createElement('a');
      a.href = directUrl.startsWith('http') ? directUrl : `/api/files/${directUrl}`;
      a.download = directUrl.split('/').pop() || 'reporte.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    setLoading(true);
    try {
      const token = sessionStorage.getItem('escandon_token');
      const res   = await fetch(`${API_BASE}/export/${cfg.endpoint}/${reportId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error('Error al exportar');

      const blob     = await res.blob();
      const url      = URL.createObjectURL(blob);
      const a        = document.createElement('a');
      a.href         = url;
      a.download     = `reporte_${reportId}_${Date.now()}.${type === 'pdf' ? 'pdf' : 'xlsx'}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[ExportButton]', err);
      alert('No se pudo generar el reporte. Intente nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleExport}
      disabled={loading}
      style={{
        display:       'inline-flex',
        alignItems:    'center',
        justifyContent: 'center',
        gap:           '0.45rem',
        padding:       compact ? '0.45rem 0.85rem' : '0.6rem 1.1rem',
        background:    loading ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.15)',
        border:        '1.5px solid rgba(255,255,255,0.22)',
        borderRadius:   10,
        color:          '#FFFFFF',
        fontFamily:    "var(--font-display)",
        fontSize:      compact ? '0.74rem' : '0.82rem',
        fontWeight:     700,
        cursor:         loading ? 'not-allowed' : 'pointer',
        backdropFilter:'var(--glass-blur)',
        WebkitBackdropFilter: 'var(--glass-blur)',
        transition:    'all var(--transition-fast)',
        opacity:        loading ? 0.7 : 1,
        whiteSpace:    'nowrap',
        boxShadow:     'var(--shadow-xs)'
      }}
      onMouseEnter={e => !loading && (e.currentTarget.style.background = 'rgba(255,255,255,0.28)')}
      onMouseLeave={e => !loading && (e.currentTarget.style.background = 'rgba(255,255,255,0.15)')}
      title={`${cfg.label} del reporte ${reportId}`}
    >
      {loading ? (
        <span style={{
          width: 14,
          height: 14,
          border: '2px solid rgba(255,255,255,0.3)',
          borderTop: '2px solid white',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
          display: 'block'
        }} />
      ) : (
        cfg.icon
      )}
      {!compact && <span style={{ letterSpacing: '0.01em' }}>{loading ? 'Generando…' : cfg.label}</span>}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </button>
  );
}
