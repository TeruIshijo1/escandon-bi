import React, { useState, useEffect } from 'react';
import { API_BASE } from '../../api/config';
import { authHeaders } from '../../api/auth';
import useEscapeKey from '../../hooks/useEscapeKey';

function formatTimeAgo(totalMins) {
  if (!totalMins || isNaN(totalMins) || totalMins <= 0) return '0 min';

  const days = Math.floor(totalMins / 1440);
  const hours = Math.floor((totalMins % 1440) / 60);
  const mins = totalMins % 60;

  const parts = [];

  if (days > 0) {
    parts.push(`${days} ${days === 1 ? 'día' : 'días'}`);
  }
  if (hours > 0) {
    parts.push(`${hours} ${hours === 1 ? 'hora' : 'horas'}`);
  }
  if (mins > 0 || parts.length === 0) {
    parts.push(`${mins} min`);
  }

  return parts.join(' ');
}

export default function PendingMonitor() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedPrescription, setSelectedPrescription] = useState(null);

  useEscapeKey(() => setSelectedPrescription(null), !!selectedPrescription);

  const fetchData = () => {
    fetch(`${API_BASE}/pharmacy/pending-prescriptions`, {
      headers: authHeaders()
    })
      .then(res => {
        if (!res.ok) throw new Error('Error al conectar con el servidor');
        return res.json();
      })
      .then(json => {
        if (json.ok) {
           setData(json.data);
           setError(null);
        } else {
           setError(json.error || 'Error al cargar recetas');
        }
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setError('Error de red al cargar recetas');
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // Auto refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const handleHide = async (id) => {
    if (window.confirm('¿Seguro que deseas descartar esta receta de la plataforma? (No afectará Vertical)')) {
      try {
        await fetch(`${API_BASE}/pharmacy/pending-prescriptions/hide/${id}`, { 
          method: 'POST',
          headers: authHeaders()
        });
        setData(prev => prev.filter(r => r.Id !== id));
        setSelectedPrescription(null);
      } catch (err) {
        console.error(err);
        alert('Error al descartar receta');
      }
    }
  };

  return (
    <div style={{ background: '#fff', borderRadius: '12px', padding: '2rem', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '2px solid #e2e8f0', paddingBottom: '0.5rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#1e293b', margin: 0 }}>
          🛎️ Monitor de Recetas Pendientes
        </h2>
        {!loading && (
          <div style={{ background: '#ef4444', color: 'white', padding: '0.5rem 1rem', borderRadius: '999px', fontWeight: 'bold', fontSize: '0.9rem' }}>
            {data.length} En Cola
          </div>
        )}
      </div>
      <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>Recetas creadas por médicos/enfermería que aún no han sido surtidas en sistema (sin lote asignado).</p>
      
      {loading && data.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem' }}>Cargando recetas pendientes...</div>
      ) : error && data.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#dc2626', fontWeight: 'bold' }}>{error}</div>
      ) : data.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', background: '#f8fafc', borderRadius: '8px', color: '#94a3b8' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎉</div>
          No hay recetas pendientes de surtir en farmacia.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1rem' }}>
          {data.map((row, idx) => {
            const minsWaiting = Math.floor((new Date() - new Date(row.FechaSolicitud)) / 60000);
            const isUrgent = minsWaiting > 60;
            return (
              <div 
                key={idx} 
                onClick={() => setSelectedPrescription({ ...row, minsWaiting })}
                style={{ 
                  background: isUrgent ? '#fef2f2' : '#f8fafc', 
                  border: `1px solid ${isUrgent ? '#f87171' : '#e2e8f0'}`, 
                  borderRadius: '8px', 
                  padding: '1.25rem',
                  borderLeft: `5px solid ${isUrgent ? '#ef4444' : '#3b82f6'}`,
                  cursor: 'pointer',
                  transition: 'transform 0.2s, boxShadow 0.2s'
                }}
                onMouseOver={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)'; }}
                onMouseOut={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span style={{ fontWeight: 'bold', color: '#0f172a' }}>{row.CamaCuarto || 'Ambulatorio'}</span>
                  <span style={{ color: isUrgent ? '#ef4444' : '#64748b', fontSize: '0.85rem', fontWeight: 'bold' }}>
                    Hace {formatTimeAgo(minsWaiting)}
                  </span>
                </div>
                <div style={{ color: '#475569', fontSize: '0.9rem', marginBottom: '1rem', textTransform: 'uppercase', minHeight: '40px' }}>
                  {row.Paciente}
                </div>
                
                <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{row.Codigo}</div>
                    <div style={{ fontWeight: '600', color: '#0f172a', fontSize: '0.85rem' }}>{row.Medicamento}</div>
                  </div>
                  <div style={{ background: '#3b82f6', color: 'white', padding: '0.25rem 0.75rem', borderRadius: '999px', fontWeight: 'bold' }}>
                    {row.Solicitado}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedPrescription && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'white', padding: '2rem', borderRadius: '16px', width: '90%', maxWidth: '580px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)' }}>
            
            {/* Header Modal */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '1rem' }}>
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Solicitud de Farmacia</span>
                <h3 style={{ margin: '0.25rem 0 0 0', color: '#0f172a', fontSize: '1.35rem', fontWeight: 'bold' }}>
                  Detalle de Receta #{selectedPrescription.Requisicion || selectedPrescription.Id}
                </h3>
                <p style={{ margin: '0.25rem 0 0 0', color: '#ef4444', fontSize: '0.9rem', fontWeight: 'bold' }}>
                  ⏱️ Esperando surtido desde hace {formatTimeAgo(selectedPrescription.minsWaiting)}
                </p>
              </div>
              <button onClick={() => setSelectedPrescription(null)} style={{ background: '#f1f5f9', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: '#64748b', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>
            
            {/* Referencias Documentales Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '1.25rem', background: '#f8fafc', padding: '0.85rem', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              <div>
                <span style={{ display: 'block', fontSize: '0.7rem', color: '#64748b', fontWeight: 'bold', textTransform: 'uppercase' }}>No. Requisición</span>
                <strong style={{ fontSize: '0.95rem', color: '#0f172a', fontFamily: 'var(--font-mono)' }}>#{selectedPrescription.Requisicion || 'N/A'}</strong>
              </div>
              <div>
                <span style={{ display: 'block', fontSize: '0.7rem', color: '#64748b', fontWeight: 'bold', textTransform: 'uppercase' }}>Cuenta Paciente</span>
                <strong style={{ fontSize: '0.95rem', color: '#0284c7', fontFamily: 'var(--font-mono)' }}>#{selectedPrescription.Cuenta || 'N/A'}</strong>
              </div>
              <div>
                <span style={{ display: 'block', fontSize: '0.7rem', color: '#64748b', fontWeight: 'bold', textTransform: 'uppercase' }}>Capturó Solicitud</span>
                <strong style={{ fontSize: '0.9rem', color: '#334155' }}>{selectedPrescription.UsuarioSolicito || 'Cirrus'}</strong>
              </div>
            </div>

            {/* Ficha Paciente y Médico */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <div style={{ borderLeft: '4px solid #3b82f6', paddingLeft: '0.75rem' }}>
                <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>Paciente</span>
                <div style={{ fontSize: '1.05rem', color: '#0f172a', fontWeight: 'bold' }}>🛌 {selectedPrescription.Paciente}</div>
                <span style={{ fontSize: '0.85rem', color: '#475569' }}>Habitación / Ubicación: <strong>{selectedPrescription.CamaCuarto || 'Ambulatorio'}</strong></span>
              </div>
              
              <div style={{ borderLeft: '4px solid #10b981', paddingLeft: '0.75rem' }}>
                <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>Médico Tratante</span>
                <div style={{ fontSize: '1rem', color: '#0f172a', fontWeight: '600' }}>👨‍⚕️ {selectedPrescription.Medico}</div>
                {selectedPrescription.FechaSolicitud && (
                  <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                    Solicitado el: {new Date(selectedPrescription.FechaSolicitud).toLocaleDateString('es-MX')} a las {new Date(selectedPrescription.FechaSolicitud).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
            </div>
            
            {/* Artículo y Disponibilidad en SAP */}
            <div style={{ background: '#f0f9ff', padding: '1.25rem', borderRadius: '12px', border: '1px solid #bae6fd', marginBottom: '1.25rem' }}>
              <span style={{ fontSize: '0.75rem', color: '#0369a1', textTransform: 'uppercase', fontWeight: 'bold' }}>Artículo Solicitado</span>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', marginBottom: '0.75rem' }}>
                <div>
                  <div style={{ color: '#0c4a6e', fontWeight: 'bold', fontSize: '1.05rem' }}>{selectedPrescription.Medicamento}</div>
                  <div style={{ fontSize: '0.85rem', color: '#0284c7', fontWeight: 'bold', fontFamily: 'var(--font-mono)' }}>{selectedPrescription.Codigo}</div>
                </div>
                <div style={{ fontSize: '1.75rem', fontWeight: '800', color: '#0284c7', background: 'white', padding: '0.2rem 0.8rem', borderRadius: '8px', border: '1px solid #7dd3fc' }}>
                  x{selectedPrescription.Solicitado}
                </div>
              </div>

              {/* Indicador de Stock en SAP */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.75rem', borderTop: '1px border #e0f2fe', fontSize: '0.85rem' }}>
                <span style={{ color: '#0369a1' }}>Disponibilidad en Farmacia (SAP):</span>
                <span style={{ fontWeight: 'bold', color: selectedPrescription.StockActual >= selectedPrescription.Solicitado ? '#16a34a' : '#dc2626' }}>
                  {selectedPrescription.StockActual >= selectedPrescription.Solicitado ? '🟢 Stock Suficiente' : '🔴 Stock Insuficiente'} ({selectedPrescription.StockActual || 0} disponibles)
                </span>
              </div>
            </div>

            {/* Lotes Disponibles en SAP */}
            {selectedPrescription.LotesDisponibles && selectedPrescription.LotesDisponibles.length > 0 && (
              <div style={{ marginBottom: '1.25rem' }}>
                <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold', display: 'block', marginBottom: '0.5rem' }}>
                  📦 Lotes Disponibles en Farmacia ({selectedPrescription.LotesDisponibles.length})
                </span>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {selectedPrescription.LotesDisponibles.map((b, i) => (
                    <span key={i} style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '0.3rem 0.6rem', borderRadius: '6px', fontSize: '0.8rem', color: '#334155' }}>
                      Lote: <strong>{b.lote}</strong> ({b.cant} pzas)
                    </span>
                  ))}
                </div>
              </div>
            )}
            
            {/* Acciones */}
            <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
              <button onClick={() => handleHide(selectedPrescription.Id)} style={{ padding: '0.75rem 1.25rem', background: '#fee2e2', color: '#ef4444', border: '1px solid #fca5a5', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.9rem' }}>
                🗑️ Descartar Receta
              </button>
              <button onClick={() => setSelectedPrescription(null)} style={{ padding: '0.75rem 1.5rem', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.9rem' }}>
                Cerrar Detalle
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
