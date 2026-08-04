import React, { useState } from 'react';
import { API_BASE } from '../../api/config';
import { authHeaders } from '../../api/auth';

export default function PatientHistory() {
  const [search, setSearch] = useState('');
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState(null);

  const handleSearch = (e) => {
    e.preventDefault();
    if (!search.trim()) return;
    
    setLoading(true);
    setSearched(true);
    fetch(`${API_BASE}/pharmacy/patient-history/${encodeURIComponent(search)}`, {
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
  };

  return (
    <div style={{ background: '#fff', borderRadius: '12px', padding: '2rem', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#1e293b', marginBottom: '1rem', borderBottom: '2px solid #e2e8f0', paddingBottom: '0.5rem' }}>
        🩺 Historial Farmacológico Clínico
      </h2>
      <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>Busca a un paciente para ver la línea de tiempo exacta de los medicamentos y lotes que se le han administrado.</p>
      
      <form onSubmit={handleSearch} style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
        <input 
          type="text" 
          placeholder="Nombre completo del paciente (con apellidos)..." 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '1rem' }}
        />
        <button type="submit" style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '0.75rem 1.5rem', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
          Buscar
        </button>
      </form>
      
      {loading ? (
        <div style={{ textAlign: 'center', padding: '2rem' }}>Buscando...</div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#dc2626', fontWeight: 'bold' }}>{error}</div>
      ) : searched && data.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
          No se encontraron consumos de farmacia para "{search}".
        </div>
      ) : data.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <h3 style={{ fontSize: '1.1rem', color: '#0f172a', marginBottom: '1rem' }}>
            Resultados para <span style={{ color: '#3b82f6' }}>{data[0]?.Paciente}</span>
          </h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={{ padding: '1rem', borderBottom: '2px solid #e2e8f0' }}>Fecha/Hora</th>
                <th style={{ padding: '1rem', borderBottom: '2px solid #e2e8f0' }}>Médico Tratante</th>
                <th style={{ padding: '1rem', borderBottom: '2px solid #e2e8f0' }}>Medicamento</th>
                <th style={{ padding: '1rem', borderBottom: '2px solid #e2e8f0', textAlign: 'center' }}>Dosis/Cant.</th>
                <th style={{ padding: '1rem', borderBottom: '2px solid #e2e8f0' }}>Lote Extraído</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '1rem' }}>
                    <div style={{ fontWeight: '500' }}>{new Date(row.Fecha).toLocaleDateString()}</div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{new Date(row.Fecha).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                  </td>
                  <td style={{ padding: '1rem' }}>{row.Medico}</td>
                  <td style={{ padding: '1rem' }}>
                    <div style={{ fontWeight: '600', color: '#0f172a' }}>{row.Medicamento}</div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{row.Codigo}</div>
                  </td>
                  <td style={{ padding: '1rem', fontWeight: 'bold', textAlign: 'center', color: '#3b82f6', fontSize: '1.1rem' }}>
                    {row.Cantidad}
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <span style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '0.2rem 0.5rem', borderRadius: '4px', fontWeight: '600' }}>
                      {row.Lote}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
