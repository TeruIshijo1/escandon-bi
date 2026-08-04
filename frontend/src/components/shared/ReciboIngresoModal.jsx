import React, { useState, useEffect } from 'react';
import PremiumLoader from './PremiumLoader';

export default function ReciboIngresoModal({ docNum, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchIngreso() {
      setLoading(true);
      setError(null);
      try {
        const token = sessionStorage.getItem('escandon_token');
        const res = await fetch(`/api/dashboard/finanzas-nativo/ingreso/${docNum}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const json = await res.json();
        if (json.success) {
          setData(json.data);
        } else {
          setError(json.error || 'No se pudo cargar el detalle del recibo.');
        }
      } catch (err) {
        setError('Error al consultar el servidor.');
      } finally {
        setLoading(false);
      }
    }
    if (docNum) fetchIngreso();
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
            <span style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.05em', color: '#10B981', textTransform: 'uppercase' }}>
              💵 Recibo de Ingreso (SAP B1)
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
          {loading && <PremiumLoader text="Consultando recibo en SAP Service Layer..." style={{ height: '200px' }} />}
          {error && <div style={{ padding: '1.5rem', background: '#FEE2E2', color: '#991B1B', borderRadius: '12px' }}>{error}</div>}

          {!loading && !error && data && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* Cliente Info */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', background: '#F8FAFC', padding: '1.25rem', borderRadius: '12px', border: '1px solid #E2E8F0' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#64748B', fontWeight: 600, textTransform: 'uppercase' }}>Cliente / Paciente</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0F172A' }}>{data.CardName}</div>
                  <div style={{ fontSize: '0.8rem', color: '#64748B', fontFamily: 'monospace' }}>Código: {data.CardCode}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#64748B', fontWeight: 600, textTransform: 'uppercase' }}>Fecha</div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#0F172A' }}>{formatDate(data.DocDate)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#64748B', fontWeight: 600, textTransform: 'uppercase' }}>Referencia</div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#0F172A' }}>{data.CounterReference || '-'}</div>
                </div>
              </div>

              {/* Totales y Metodos */}
              <div>
                <h4 style={{ margin: '0 0 0.75rem 0', color: '#334155', fontSize: '0.95rem', fontWeight: 700 }}>Desglose del Pago</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem' }}>
                  <div style={{ padding: '1rem', borderRadius: '10px', background: '#FFF', border: '1px solid #E2E8F0', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: '#64748B', fontWeight: 600, marginBottom: '0.25rem' }}>Efectivo</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0F172A', fontFamily: 'var(--font-mono)' }}>{formatCurrency(data.CashSum)}</div>
                  </div>
                  <div style={{ padding: '1rem', borderRadius: '10px', background: '#FFF', border: '1px solid #E2E8F0', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: '#64748B', fontWeight: 600, marginBottom: '0.25rem' }}>Transferencia</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0F172A', fontFamily: 'var(--font-mono)' }}>{formatCurrency(data.TransferSum)}</div>
                  </div>
                  <div style={{ padding: '1rem', borderRadius: '10px', background: '#FFF', border: '1px solid #E2E8F0', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: '#64748B', fontWeight: 600, marginBottom: '0.25rem' }}>Tarjeta</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0F172A', fontFamily: 'var(--font-mono)' }}>{formatCurrency(data.CreditSum)}</div>
                  </div>
                  <div style={{ padding: '1rem', borderRadius: '10px', background: '#ECFDF5', border: '1px solid #10B981', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: '#047857', fontWeight: 700, marginBottom: '0.25rem', textTransform: 'uppercase' }}>Total Pagado</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#047857', fontFamily: 'var(--font-mono)' }}>{formatCurrency(data.DocTotal)}</div>
                  </div>
                </div>
              </div>

              {/* Facturas Ligadas Table */}
              {data.PaymentInvoices && data.PaymentInvoices.length > 0 && (
                <div>
                  <h4 style={{ margin: '0 0 0.75rem 0', color: '#334155', fontSize: '0.95rem', fontWeight: 700 }}>Facturas Pagadas (A/R Invoices)</h4>
                  <div style={{ overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: '12px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                      <thead>
                        <tr style={{ background: '#F1F5F9', color: '#475569', textAlign: 'left' }}>
                          <th style={{ padding: '0.75rem 1rem' }}>DocEntry (Factura)</th>
                          <th style={{ padding: '0.75rem 1rem' }}>Tipo</th>
                          <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Monto Aplicado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.PaymentInvoices.map((inv, idx) => (
                          <React.Fragment key={idx}>
                            <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                              <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#0F172A' }}>
                                Factura SAP: {inv.DocEntry}
                              </td>
                              <td style={{ padding: '0.75rem 1rem', color: '#475569' }}>
                                {inv.InvoiceType === 'it_Invoice' ? 'Factura Cliente' : inv.InvoiceType}
                              </td>
                              <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700, color: '#10B981' }}>
                                Aplicado: {formatCurrency(inv.SumApplied)}
                              </td>
                            </tr>
                            {inv.DocumentLines && inv.DocumentLines.length > 0 && (
                              <tr>
                                <td colSpan="3" style={{ padding: 0 }}>
                                  <div style={{ padding: '0.5rem 1rem 1.5rem 2rem', background: '#FFF' }}>
                                    <h5 style={{ margin: '0 0 0.5rem 0', fontSize: '0.8rem', color: '#64748B', textTransform: 'uppercase' }}>Detalle de Factura</h5>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                                      <thead>
                                        <tr style={{ borderBottom: '1px solid #E2E8F0', color: '#64748B' }}>
                                          <th style={{ padding: '0.4rem', textAlign: 'left' }}>Concepto</th>
                                          <th style={{ padding: '0.4rem', textAlign: 'center' }}>Cant.</th>
                                          <th style={{ padding: '0.4rem', textAlign: 'right' }}>P. Unitario</th>
                                          <th style={{ padding: '0.4rem', textAlign: 'right' }}>Total</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {inv.DocumentLines.map((line, lidx) => (
                                          <tr key={lidx} style={{ borderBottom: '1px dotted #E2E8F0' }}>
                                            <td style={{ padding: '0.4rem', color: '#334155' }}>{line.ItemDescription}</td>
                                            <td style={{ padding: '0.4rem', textAlign: 'center', color: '#64748B' }}>{line.Quantity}</td>
                                            <td style={{ padding: '0.4rem', textAlign: 'right', color: '#64748B' }}>{formatCurrency(line.Price)}</td>
                                            <td style={{ padding: '0.4rem', textAlign: 'right', fontWeight: 600, color: '#0F172A' }}>{formatCurrency(line.LineTotal)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Cuentas Pagadas Table */}
              {data.PaymentAccounts && data.PaymentAccounts.length > 0 && (
                <div>
                  <h4 style={{ margin: '0 0 0.75rem 0', color: '#334155', fontSize: '0.95rem', fontWeight: 700 }}>Pagos a Cuenta (Payment Accounts)</h4>
                  <div style={{ overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: '12px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                      <thead>
                        <tr style={{ background: '#F1F5F9', color: '#475569', textAlign: 'left' }}>
                          <th style={{ padding: '0.75rem 1rem' }}>Cuenta Contable</th>
                          <th style={{ padding: '0.75rem 1rem' }}>Nombre</th>
                          <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Monto Pagado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.PaymentAccounts.map((acc, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid #F1F5F9' }}>
                            <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#0F172A', fontFamily: 'monospace' }}>
                              {acc.AccountCode}
                            </td>
                            <td style={{ padding: '0.75rem 1rem', color: '#475569' }}>
                              {acc.AccountName}
                            </td>
                            <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700, color: '#10B981' }}>
                              {formatCurrency(acc.SumPaid)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Tarjetas Table */}
              {data.PaymentCreditCards && data.PaymentCreditCards.length > 0 && (
                <div>
                  <h4 style={{ margin: '0 0 0.75rem 0', color: '#334155', fontSize: '0.95rem', fontWeight: 700 }}>Tarjetas de Crédito / Débito</h4>
                  <div style={{ overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: '12px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                      <thead>
                        <tr style={{ background: '#F1F5F9', color: '#475569', textAlign: 'left' }}>
                          <th style={{ padding: '0.75rem 1rem' }}>Tarjeta</th>
                          <th style={{ padding: '0.75rem 1rem' }}>ID Tarjeta</th>
                          <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Monto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.PaymentCreditCards.map((card, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid #F1F5F9' }}>
                            <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#0F172A' }}>
                              {card.CreditCardName || 'Tarjeta'}
                            </td>
                            <td style={{ padding: '0.75rem 1rem', color: '#475569', fontFamily: 'monospace' }}>
                              {card.CreditCard}
                            </td>
                            <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700, color: '#0F172A' }}>
                              {formatCurrency(card.CreditSum)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Comentarios */}
              {data.Remarks && (
                <div style={{ fontSize: '0.8rem', color: '#64748B', fontStyle: 'italic', background: '#F8FAFC', padding: '0.75rem 1rem', borderRadius: '8px' }}>
                  💬 {data.Remarks}
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
