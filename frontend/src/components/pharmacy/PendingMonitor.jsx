import React, { useState, useEffect } from 'react';
import { API_BASE } from '../../api/config';
import { authHeaders } from '../../api/auth';

export default function PendingMonitor() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedPrescription, setSelectedPrescription] = useState(null);

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
                    Hace {minsWaiting} min
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
          <div style={{ background: 'white', padding: '2rem', borderRadius: '12px', width: '90%', maxWidth: '500px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '1rem' }}>
              <div>
                <h3 style={{ margin: '0 0 0.25rem 0', color: '#0f172a', fontSize: '1.25rem' }}>Detalle de Receta</h3>
                <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem' }}>Esperando surtido desde hace {selectedPrescription.minsWaiting} minutos</p>
              </div>
              <button onClick={() => setSelectedPrescription(null)} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#94a3b8' }}>×</button>
            </div>
            
            <div style={{ marginBottom: '1rem' }}>
              <span style={{ fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>Médico Solicitante</span>
              <div style={{ fontSize: '1.1rem', color: '#0f172a', fontWeight: '600' }}>👨‍⚕️ {selectedPrescription.Medico}</div>
            </div>
            
            <div style={{ marginBottom: '1rem' }}>
              <span style={{ fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>Paciente</span>
              <div style={{ fontSize: '1rem', color: '#334155' }}>🛌 {selectedPrescription.Paciente} ({selectedPrescription.CamaCuarto || 'Ambulatorio'})</div>
            </div>
            
            <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>Artículo a Entregar</span>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
                <div>
                  <div style={{ color: '#0f172a', fontWeight: '600' }}>{selectedPrescription.Medicamento}</div>
                  <div style={{ fontSize: '0.85rem', color: '#64748b' }}>{selectedPrescription.Codigo}</div>
                </div>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#3b82f6' }}>x{selectedPrescription.Solicitado}</div>
              </div>
            </div>
            
            <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'space-between' }}>
              <button onClick={() => handleHide(selectedPrescription.Id)} style={{ padding: '0.75rem 1.5rem', background: '#fee2e2', color: '#ef4444', border: '1px solid #fca5a5', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
                🗑️ Descartar
              </button>
              <button onClick={() => setSelectedPrescription(null)} style={{ padding: '0.75rem 1.5rem', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
                Cerrar Detalle
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
