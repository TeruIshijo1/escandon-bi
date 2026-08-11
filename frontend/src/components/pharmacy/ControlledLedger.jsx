import React, { useState, useEffect } from 'react';
import { API_BASE } from '../../api/config';
import { authHeaders } from '../../api/auth';

export default function ControlledLedger() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/pharmacy/controlled-ledger`, {
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
        📘 Libro Electrónico de Controlados
      </h2>
      <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>Registro automatizado de medicamentos con lote, cruzando SAP y Vertical.</p>
      
      {loading ? (
        <div style={{ textAlign: 'center', padding: '2rem' }}>Cargando datos...</div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#dc2626', fontWeight: 'bold' }}>{error}</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={{ padding: '1rem', borderBottom: '2px solid #e2e8f0' }}>Fecha</th>
                <th style={{ padding: '1rem', borderBottom: '2px solid #e2e8f0' }}>Médico Tratante</th>
                <th style={{ padding: '1rem', borderBottom: '2px solid #e2e8f0' }}>Paciente</th>
                <th style={{ padding: '1rem', borderBottom: '2px solid #e2e8f0' }}>Artículo</th>
                <th style={{ padding: '1rem', borderBottom: '2px solid #e2e8f0' }}>Lote</th>
                <th style={{ padding: '1rem', borderBottom: '2px solid #e2e8f0' }}>Cant.</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '1rem' }}>{new Date(row.Fecha).toLocaleDateString()} {new Date(row.Fecha).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
                  <td style={{ padding: '1rem', fontWeight: '500' }}>{row.Medico}</td>
                  <td style={{ padding: '1rem' }}>{row.Paciente}</td>
                  <td style={{ padding: '1rem' }}>
                    <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block' }}>{row.Codigo}</span>
                    {row.Medicamento}
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <span className="lote-badge" style={{ background: '#e2e8f0', color: '#334155', padding: '0.2rem 0.5rem', borderRadius: '4px', fontWeight: 'bold', fontSize: '0.82rem' }}>{row.Lote}</span>
                  </td>
                  <td style={{ padding: '1rem', fontWeight: 'bold', textAlign: 'center' }}>{row.Cantidad}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
