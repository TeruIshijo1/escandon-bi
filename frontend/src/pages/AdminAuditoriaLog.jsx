/**
 * AdminAuditoriaLog.jsx — Log de acciones del sistema
 * Hospital Escandón BI Platform v4.0
 * Rediseño premium con identidad de marca
 */
import { useState, useEffect } from 'react';
import { API_BASE } from '../api/config';

const METHOD_COLORS = { 
  GET:'#0088C9', 
  POST:'#00974A', 
  PUT:'#E8853D', 
  DELETE:'#EF4444', 
  PATCH:'#8B5CF6' 
};
const STATUS_COLORS = { 
  2:'var(--color-verde-e)', 
  4:'var(--color-danger)', 
  5:'var(--color-danger)' 
};

export default function AdminAuditoriaLog() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const token = sessionStorage.getItem('escandon_token');
        const res = await fetch(`${API_BASE}/admin/audit-logs`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!res.ok) throw new Error('Error al cargar logs de auditoría');
        
        const json = await res.json();
        setLogs(json.data || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
    // Polling cada 30 segundos
    const interval = setInterval(fetchLogs, 30000);
    return () => clearInterval(interval);
  }, []);

  const rows = logs.filter(r =>
    (r.usuario || '').toLowerCase().includes(filter.toLowerCase()) || 
    (r.ruta || '').toLowerCase().includes(filter.toLowerCase()) || 
    String(r.status).includes(filter)
  );

  return (
    <div style={{ maxWidth:1200, margin:'0 auto' }}>
      <style>{`
        .search-input-field:focus {
          border-color: var(--color-azul-claro) !important;
          box-shadow: 0 0 0 4px rgba(0, 136, 201, 0.12) !important;
          background: #FFFFFF !important;
        }
        .audit-table tr:nth-child(even) {
          background-color: #FAFBFD;
        }
        .audit-table tr:hover {
          background-color: rgba(0, 70, 135, 0.02) !important;
        }
      `}</style>

      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, var(--color-azul-fuerte) 0%, #083b66 100%)',
        borderRadius: 20, padding: '1.75rem 2.25rem', marginBottom: '2rem',
        boxShadow: 'var(--shadow-md)',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* ECG Pattern */}
        <div style={{
          position: 'absolute',
          inset: 0,
          opacity: 0.04,
          pointerEvents: 'none',
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 120' width='800' height='120'%3E%3Cpath d='M0 60h120l10-15 15 10 10-25 15 80 10-65 15 15h120l10-15 15 10 10-25 15 80 10-65 15 15h200' fill='none' stroke='%23ffffff' stroke-width='2'/%3E%3C/svg%3E")`,
          backgroundSize: '450px 60px',
          backgroundPosition: 'left center',
        }}/>

        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.64rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.65)', marginBottom: '0.35rem' }}>
            Administración del Sistema
          </div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: '1.65rem', fontWeight: 800, color: 'white', margin: 0, letterSpacing: '-0.01em' }}>
            Log de Auditoría
          </h1>
          <p style={{ fontFamily: 'var(--font-body)', color: 'rgba(255,255,255,0.72)', fontSize: '0.85rem', margin: '0.4rem 0 0', fontWeight: 500 }}>
            Registro en tiempo real de todas las acciones operativas y administrativas del sistema
          </p>
        </div>
      </div>

      {/* Filter panel */}
      <div style={{
        background:'#FFFFFF',
        borderRadius: '14px',
        padding:'0.875rem 1.25rem',
        marginBottom:'1.5rem',
        border:'1px solid rgba(0,70,135,0.05)',
        boxShadow: 'var(--shadow-xs)',
        display:'flex',
        gap:'0.75rem',
        alignItems:'center'
      }}>
        <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
          <span style={{ position: 'absolute', left: '0.875rem', color: 'var(--text-muted)', fontSize: '0.9rem', display: 'flex', alignItems: 'center' }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </span>
          <input 
            placeholder="Filtrar logs por usuario, endpoint, código de respuesta..." 
            value={filter} 
            onChange={e => setFilter(e.target.value)}
            className="search-input-field"
            style={{ 
              border:'1px solid #E2E8F0', 
              borderRadius: '10px', 
              padding:'0.6rem 1rem 0.6rem 2.5rem', 
              fontFamily:"var(--font-body)", 
              fontSize:'0.85rem', 
              outline:'none', 
              flex:1,
              background: '#F8FAFC',
              transition: 'all var(--transition-fast)'
            }} 
          />
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize:'0.72rem', color:'var(--text-muted)', fontWeight: 600 }}>
          {loading ? 'Consultando...' : `${rows.length} registros`}
        </span>
      </div>

      {error && (
        <div style={{
          padding:'1rem 1.25rem',
          background:'rgba(239,68,68,0.06)',
          border: '1.5px solid rgba(239,68,68,0.15)',
          color:'#DC2626',
          borderRadius: '12px',
          marginBottom:'1.5rem',
          fontSize:'0.82rem',
          fontFamily: 'var(--font-body)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}>
          <span>❌</span> {error}
        </div>
      )}

      {/* Table container */}
      <div style={{
        background:'#FFFFFF',
        borderRadius: '16px',
        border:'1px solid rgba(0,70,135,0.05)',
        overflow:'hidden',
        boxShadow:'var(--shadow-xs)'
      }}>
        <div style={{ overflowX:'auto' }}>
          <table className="audit-table" style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid rgba(0,70,135,0.06)' }}>
                {['Fecha / Hora','Usuario','Rol','Método','Ruta','Status','Duración','IP'].map(h => (
                  <th key={h} style={{ 
                    background:'#FAFBFD', 
                    color:'var(--text-primary)', 
                    padding:'0.85rem 1rem', 
                    textAlign:'left', 
                    fontFamily:"var(--font-display)", 
                    fontSize:'0.72rem', 
                    fontWeight:800, 
                    letterSpacing:'0.06em', 
                    textTransform:'uppercase', 
                    whiteSpace:'nowrap' 
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan="8" style={{ padding:'3rem 2rem', textAlign:'center', color:'var(--text-muted)', fontFamily: 'var(--font-body)' }}>No hay registros de auditoría disponibles en esta consulta.</td>
                </tr>
              )}
              {rows.map((r, i) => {
                const mc = METHOD_COLORS[r.metodo] || '#8A97A8';
                const sc = STATUS_COLORS[Math.floor(r.status/100)] || '#8A97A8';
                return (
                  <tr key={r.id || i} style={{ borderBottom: '1px solid rgba(0,70,135,0.04)', transition: 'background-color 150ms' }}>
                    <td style={{ padding:'0.75rem 1rem', fontFamily:'var(--font-mono)', fontSize:'0.74rem', color:'var(--text-secondary)', whiteSpace:'nowrap' }}>{r.fecha}</td>
                    <td style={{ padding:'0.75rem 1rem' }}><code style={{ fontFamily:'var(--font-mono)', fontSize:'0.74rem', color:'var(--color-azul-fuerte)', fontWeight: 600 }}>{r.usuario}</code></td>
                    <td style={{ padding:'0.75rem 1rem', fontSize:'0.74rem', color:'var(--text-muted)', fontFamily: 'var(--font-body)', fontWeight: 500 }}>{r.rol}</td>
                    <td style={{ padding:'0.75rem 1rem' }}>
                      <span style={{ 
                        background:`${mc}12`, 
                        color:mc, 
                        border:`1px solid ${mc}25`, 
                        borderRadius:'6px', 
                        padding:'0.15rem 0.5rem', 
                        fontSize:'0.68rem', 
                        fontWeight:800,
                        fontFamily: 'var(--font-mono)'
                      }}>{r.metodo}</span>
                    </td>
                    <td style={{ 
                      padding:'0.75rem 1rem', 
                      fontFamily:'var(--font-mono)', 
                      fontSize:'0.74rem', 
                      color:'var(--text-secondary)', 
                      maxWidth:280, 
                      overflow:'hidden', 
                      textOverflow:'ellipsis', 
                      whiteSpace:'nowrap' 
                    }} title={r.ruta}>{r.ruta}</td>
                    <td style={{ padding:'0.75rem 1rem' }}>
                      <span style={{ color:sc, fontWeight:800, fontSize:'0.82rem', fontFamily: 'var(--font-mono)' }}>{r.status}</span>
                    </td>
                    <td style={{ 
                      padding:'0.75rem 1rem', 
                      fontSize:'0.76rem', 
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 600,
                      color: r.ms > 500 ? 'var(--color-warning)' : 'var(--text-secondary)' 
                    }}>{r.ms}ms</td>
                    <td style={{ padding:'0.75rem 1rem', fontFamily:'var(--font-mono)', fontSize:'0.74rem', color:'var(--text-muted)' }}>{r.ip}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
