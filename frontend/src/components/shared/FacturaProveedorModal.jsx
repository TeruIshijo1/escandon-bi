import React, { useState, useEffect } from 'react';
import PremiumLoader from './PremiumLoader';

export default function FacturaProveedorModal({ docNum, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchFactura() {
      setLoading(true);
      setError(null);
      try {
        const token = sessionStorage.getItem('escandon_token');
        const res = await fetch(`/api/dashboard/finanzas-nativo/factura/${docNum}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const json = await res.json();
        if (json.success) {
          setData(json.data);
        } else {
          setError(json.error || 'No se pudo cargar el detalle de la factura.');
        }
      } catch (err) {
        setError('Error al consultar el servidor.');
      } finally {
        setLoading(false);
      }
    }
    if (docNum) fetchFactura();
  }, [docNum]);

  const formatCurrency = (val) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(val || 0);
  const formatDate = (dStr) => dStr ? new Date(dStr).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: '2-digit' }) : '-';

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 2000, padding: '1rem'
    }}>
      <div style={{
        background: '#FFFFFF', borderRadius: '20px', width: '100%', maxWidth: '750px',
        maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          background: 'linear-gradient(135deg, #0F172A, #1E293B)',
          padding: '1.25rem 1.5rem', color: '#FFF',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.05em', color: '#EF4444', textTransform: 'uppercase' }}>
              🔴 Factura de Proveedor (SAP B1)
            </span>
            <h2 style={{ margin: '0.2rem 0 0 0', fontSize: '1.25rem', fontWeight: 700, color: '#FFF' }}>
              Folio SAP: #{docNum}
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.1)', border: 'none', color: '#FFF',
              borderRadius: '50%', width: 36, height: 36, cursor: 'pointer',
              fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
          {loading && <PremiumLoader text="Consultando factura en SAP Service Layer..." style={{ height: '200px' }} />}
          {error && <div style={{ padding: '1.5rem', background: '#FEE2E2', color: '#991B1B', borderRadius: '12px' }}>{error}</div>}

          {!loading && !error && data && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* Proveedor Info */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', background: '#F8FAFC', padding: '1.25rem', borderRadius: '12px', border: '1px solid #E2E8F0' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#64748B', fontWeight: 600, textTransform: 'uppercase' }}>Proveedor</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0F172A' }}>{data.CardName}</div>
                  <div style={{ fontSize: '0.8rem', color: '#64748B', fontFamily: 'monospace' }}>Código: {data.CardCode}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#64748B', fontWeight: 600, textTransform: 'uppercase' }}>Fecha Emisión</div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#0F172A' }}>{formatDate(data.DocDate)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#64748B', fontWeight: 600, textTransform: 'uppercase' }}>Total Factura</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#EF4444', fontFamily: 'var(--font-mono)' }}>{formatCurrency(data.DocTotal)}</div>
                </div>
              </div>

              {/* Items Table */}
              <div>
                <h4 style={{ margin: '0 0 0.75rem 0', color: '#334155', fontSize: '0.95rem', fontWeight: 700 }}>Conceptos de la Factura</h4>
                <div style={{ overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: '12px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ background: '#F1F5F9', color: '#475569', textAlign: 'left' }}>
                        <th style={{ padding: '0.75rem 1rem' }}>Concepto / Artículo</th>
                        <th style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>Cant.</th>
                        <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>P. Unitario</th>
                        <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.DocumentLines.map((line, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #F1F5F9' }}>
                          <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#0F172A' }}>
                            {line.ItemDescription}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'center', color: '#475569' }}>
                            {line.Quantity}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'right', color: '#475569' }}>
                            {formatCurrency(line.Price)}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700, color: '#0F172A' }}>
                            {formatCurrency(line.LineTotal)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Comentarios */}
              {data.Comments && (
                <div style={{ fontSize: '0.8rem', color: '#64748B', fontStyle: 'italic', background: '#F8FAFC', padding: '0.75rem 1rem', borderRadius: '8px' }}>
                  💬 {data.Comments}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '1rem 1.5rem', background: '#F8FAFC', borderTop: '1px solid #E2E8F0', textAlign: 'right' }}>
          <button
            onClick={onClose}
            style={{
              padding: '0.5rem 1.25rem', borderRadius: '8px', background: '#0F172A',
              color: '#FFF', border: 'none', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem'
            }}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
