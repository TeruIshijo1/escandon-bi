import React, { useState, useEffect } from 'react';
import { API_BASE } from '../../api/config';
import { authHeaders } from '../../api/auth';

export default function SurgicalKits() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedKit, setSelectedKit] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/pharmacy/surgical-kits`, {
      headers: authHeaders()
    })
      .then(res => {
        if (!res.ok) throw new Error('Error al conectar con el servidor');
        return res.json();
      })
      .then(json => {
        if (json.ok) setData(json.data);
        else setError(json.error || 'Error al obtener datos');
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setError('Fallo de conexión o de red');
        setLoading(false);
      });
  }, []);

  return (
    <div style={{ background: '#fff', borderRadius: '12px', padding: '2rem', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#1e293b', marginBottom: '1rem', borderBottom: '2px solid #e2e8f0', paddingBottom: '0.5rem' }}>
        🔪 Calculadora de Kits Quirúrgicos
      </h2>
      <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>
        Kits promedio agrupados por Cirugía, calculados estadísticamente en base al consumo real de Quirófano en los últimos 6 meses.
      </p>
      
      {loading ? (
        <div style={{ textAlign: 'center', padding: '2rem' }}>Calculando estadística histórica por cirugía...</div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#dc2626', fontWeight: 'bold' }}>{error}</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
          {data.map((kit, idx) => (
            <div 
              key={idx} 
              onClick={() => setSelectedKit(kit)}
              style={{ 
                background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)', 
                border: '1px solid #cbd5e1', 
                borderRadius: '12px', 
                padding: '1.5rem', 
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
              }}
              onMouseOver={(e) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(139, 92, 246, 0.2)'; e.currentTarget.style.borderColor = '#8b5cf6'; }}
              onMouseOut={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.05)'; e.currentTarget.style.borderColor = '#cbd5e1'; }}
            >
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🧰</div>
              <h3 style={{ margin: '0 0 0.5rem 0', color: '#0f172a', fontSize: '1.1rem', lineHeight: 1.2 }}>{kit.Cirugia}</h3>
              <div style={{ display: 'inline-block', background: '#e0e7ff', color: '#4f46e5', padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.8rem', fontWeight: 'bold' }}>
                {kit.Items.length} Artículos en Kit
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedKit && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div style={{ background: 'white', padding: '2rem', borderRadius: '12px', width: '90%', maxWidth: '700px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', borderBottom: '2px solid #e2e8f0', paddingBottom: '1rem' }}>
              <div>
                <h3 style={{ margin: '0 0 0.25rem 0', color: '#0f172a', fontSize: '1.5rem' }}>🧰 Kit: {selectedKit.Cirugia}</h3>
                <p style={{ margin: 0, color: '#64748b', fontSize: '0.95rem' }}>Promedio de materiales consumidos históricamente para esta cirugía.</p>
              </div>
              <button onClick={() => setSelectedKit(null)} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#94a3b8' }}>×</button>
            </div>
            
            <div style={{ overflowY: 'auto', flex: 1, paddingRight: '0.5rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem' }}>
                {selectedKit.Items.map((row, idx) => (
                  <div key={idx} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ flex: 1, paddingRight: '1rem' }}>
                      <div style={{ fontSize: '0.75rem', color: '#64748b', fontFamily: 'monospace' }}>{row.Codigo}</div>
                      <div style={{ fontWeight: '600', color: '#0f172a', fontSize: '0.85rem', marginTop: '0.1rem', lineHeight: 1.2 }}>{row.Medicamento}</div>
                    </div>
                    <div style={{ textAlign: 'center', background: '#f5f3ff', padding: '0.4rem 0.6rem', borderRadius: '8px', minWidth: '50px' }}>
                      <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#8b5cf6', lineHeight: 1 }}>
                        {row.PromedioPiezas.toFixed(1)}
                      </div>
                      <div style={{ fontSize: '0.6rem', color: '#64748b', textTransform: 'uppercase', marginTop: '0.1rem', fontWeight: 'bold' }}>Piezas</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            <div style={{ marginTop: '1.5rem', textAlign: 'right', paddingTop: '1rem', borderTop: '1px solid #e2e8f0' }}>
              <button onClick={() => setSelectedKit(null)} style={{ padding: '0.75rem 1.5rem', background: '#8b5cf6', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
                Cerrar Kit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
