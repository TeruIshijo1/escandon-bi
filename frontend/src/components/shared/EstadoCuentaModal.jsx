import React, { useState, useEffect } from 'react';

const formatCurrency = (val) => {
  if (val == null) return '-';
  return '$' + parseFloat(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatDate = (dateStr) => {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit' });
};

export default function EstadoCuentaModal({ pcNum, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ESC para cerrar
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    if (!pcNum) return;
    const fetchData = async () => {
      try {
        setLoading(true);
        const token = sessionStorage.getItem('escandon_token');
        const res = await fetch(`/api/dashboard/financiero-nativo/cuenta/${pcNum}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        const json = await res.json();
        if (json.success) {
          setData(json.data);
        } else {
          setError(json.error || 'Error al obtener datos');
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [pcNum]);

  if (!pcNum) return null;

  const total = data ? data.reduce((acc, row) => acc + parseFloat(row.Total || 0), 0) : 0;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(13,27,42,0.7)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 2000, animation: 'fadeIn 220ms ease',
      }}
    >
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes panelIn { from { opacity: 0; transform: scale(0.96) translateY(12px); } to { opacity: 1; transform: scale(1) translateY(0); } }
      `}</style>

      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '95vw', maxWidth: 1000, height: '90vh',
          background: 'white', borderRadius: 18, overflow: 'hidden',
          boxShadow: '0 30px 80px rgba(0,0,0,0.4)',
          display: 'flex', flexDirection: 'column',
          animation: 'panelIn 250ms ease',
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
            }}>📄</div>
            <div>
              <div style={{ fontSize: '0.62rem', fontWeight: 700, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Detalle de Cargos
              </div>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'white' }}>
                Estado de Cuenta - Paciente {pcNum}
              </div>
            </div>
          </div>
          
          <button
            onClick={onClose}
            title="Cerrar (Esc)"
            style={{
              background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)',
              borderRadius: 8, color: 'white', width: 36, height: 36, fontSize: '1rem',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >✕</button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', background: '#f8fafc' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>Cargando estado de cuenta...</div>
          ) : error ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#ef4444' }}>Error: {error}</div>
          ) : (
            <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
              <div style={{ padding: '1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ margin: 0, color: '#0f172a' }}>Cargos Registrados</h3>
                  <p style={{ margin: 0, color: '#64748b', fontSize: '0.85rem' }}>{data.length} movimientos</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Total Cargos</div>
                  <div style={{ fontSize: '1.5rem', color: '#004687', fontWeight: 700 }}>{formatCurrency(total)}</div>
                </div>
              </div>
              
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ background: '#f1f5f9', color: '#475569', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                      <th style={{ padding: '0.75rem 1rem' }}>Fecha</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Código</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Descripción</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Cantidad</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Precio Unit.</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((row, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0' }}>
                        <td style={{ padding: '0.75rem 1rem', color: '#64748b' }}>{formatDate(row.ChargeDate)}</td>
                        <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', color: '#94a3b8' }}>{row.ItemCode}</td>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#334155' }}>{row.ItemDescription || 'Sin descripción'}</td>
                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>{row.Quantity}</td>
                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right', color: '#64748b' }}>{formatCurrency(row.UnitPrice)}</td>
                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700, color: '#0f172a' }}>{formatCurrency(row.Total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
