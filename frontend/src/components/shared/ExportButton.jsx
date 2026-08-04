/**
 * ExportButton.jsx — Botones de exportación PDF y Excel
 * Hospital Escandón BI Platform v4.0
 */
import { useState } from 'react';
import { API_BASE } from '../../api/config';
import { authHeaders, getAuthToken } from '../../api/auth';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';

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

export default function ExportButton({
  id,
  type = 'pdf',
  reportId,
  queryParams = null,
  directUrl = null,
  compact = false,
  variant = 'glass', // 'glass' | 'solid'
  onClickOverride,
  targetId = 'dashboard-container',
  useServerPdf = false,
}) {
  const [loading, setLoading] = useState(false);
  const cfg = CONFIG[type] || CONFIG.pdf;
  
  // Define styles based on variant
  const bgIdle = variant === 'solid' ? cfg.bg : 'rgba(255,255,255,0.15)';
  const bgHover = variant === 'solid' ? cfg.bg : 'rgba(255,255,255,0.28)';
  const borderStyle = variant === 'solid' ? 'none' : '1.5px solid rgba(255,255,255,0.22)';
  const shadowStyle = variant === 'solid' ? `0 4px 12px ${cfg.shadow}` : 'var(--shadow-xs)';

  const buildQueryString = () => {
    // ... [existing logic inside buildQueryString] ...
    const token = getAuthToken();
    const cleanParams = queryParams
      ? Object.fromEntries(Object.entries(queryParams).filter(([, v]) => v !== undefined && v !== null && v !== ''))
      : {};

    if (token) {
      cleanParams.token = token;
    }

    const params = new URLSearchParams(cleanParams).toString();
    return params ? `?${params}` : '';
  };

  const handleExport = async () => {
    if (loading) return;
    // ... [existing handleExport logic] ...
    if (onClickOverride) {
      onClickOverride();
      return;
    }

    const token = getAuthToken();
    const qStr = buildQueryString();

    if (type === 'pdf' && !useServerPdf) {
      const element = document.getElementById(targetId);
      if (element) {
        setLoading(true);
        try {
          const originalScroll = window.scrollY;
          window.scrollTo(0, 0);
          await new Promise(r => setTimeout(r, 300));

          const origMaxWidth = element.style.maxWidth;
          const origMargin = element.style.margin;
          element.style.maxWidth = 'none';
          element.style.margin = '0';

          await new Promise(r => setTimeout(r, 100));

          const dataUrl = await toPng(element, { quality: 1, pixelRatio: 2, cacheBust: true });

          element.style.maxWidth = origMaxWidth || '';
          element.style.margin = origMargin || '';
          window.scrollTo(0, originalScroll);

          const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
          const pdfW = pdf.internal.pageSize.getWidth();

          pdf.setFillColor(0, 70, 135);
          pdf.rect(0, 0, pdfW, 16, 'F');
          pdf.setTextColor(255, 255, 255);
          pdf.setFontSize(11);
          pdf.setFont('helvetica', 'bold');
          pdf.text('Hospital Escandón', 6, 11);
          pdf.setFontSize(9);
          pdf.text('Reporte de BI - ' + new Date().toLocaleDateString('es-MX'), pdfW - 6, 11, { align: 'right' });

          const imgProps = pdf.getImageProperties(dataUrl);
          const m = 3;
          const fW = pdfW - m * 2;
          const fH = (imgProps.height * fW) / imgProps.width;
          pdf.addImage(dataUrl, 'PNG', m, 17, fW, fH);

          pdf.save(`Reporte_${reportId || 'Escandon'}_${Date.now()}.pdf`);
          setLoading(false);
          return;
        } catch (err) {
          console.warn('Captura DOM PDF falló, usando PDF del servidor...', err);
        }
      }
    }

    setLoading(true);
    try {
      let endpointUrl = directUrl;
      if (!endpointUrl) {
        const endpointPath = reportId ? `${cfg.endpoint}/${reportId}` : cfg.endpoint;
        endpointUrl = `${API_BASE}/export/${endpointPath}${qStr}`;
      } else {
        endpointUrl = endpointUrl.startsWith('http') ? endpointUrl : `${API_BASE}${endpointUrl.startsWith('/') ? endpointUrl : '/' + endpointUrl}`;
        if (qStr) endpointUrl += (endpointUrl.includes('?') ? '&' : '?') + qStr.slice(1);
      }

      const res = await fetch(endpointUrl, {
        headers: authHeaders(),
      });

      if (!res.ok) {
        if (res.status === 401) {
          alert('Su sesión ha caducado o el token es inválido. Por favor recargue la página o vuelva a iniciar sesión.');
          setLoading(false);
          return;
        }
        const errText = await res.text();
        throw new Error(errText || 'Error al comunicarse con el servidor de exportación.');
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      const disposition = res.headers.get('Content-Disposition');
      let filename = `reporte_${reportId || 'escandon'}_${Date.now()}.${type === 'pdf' ? 'pdf' : 'xlsx'}`;
      if (disposition && disposition.includes('filename=')) {
        const match = disposition.match(/filename="?([^";]+)"?/);
        if (match && match[1]) filename = match[1];
      }

      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[ExportButton]', err);
      alert('Error al generar la descarga: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      id={id}
      onClick={handleExport}
      disabled={loading}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.45rem',
        padding: compact ? '0.45rem 0.85rem' : '0.6rem 1.1rem',
        background: bgIdle,
        border: borderStyle,
        borderRadius: 10,
        color: '#FFFFFF',
        fontFamily: 'var(--font-display)',
        fontSize: compact ? '0.74rem' : '0.82rem',
        fontWeight: 700,
        cursor: loading ? 'not-allowed' : 'pointer',
        backdropFilter: variant === 'glass' ? 'var(--glass-blur)' : 'none',
        WebkitBackdropFilter: variant === 'glass' ? 'var(--glass-blur)' : 'none',
        transition: 'all var(--transition-fast)',
        opacity: loading ? 0.7 : 1,
        whiteSpace: 'nowrap',
        boxShadow: shadowStyle,
      }}
      onMouseEnter={e => !loading && (e.currentTarget.style.background = bgHover)}
      onMouseLeave={e => !loading && (e.currentTarget.style.background = bgIdle)}
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
