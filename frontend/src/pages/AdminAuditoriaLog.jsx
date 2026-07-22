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
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        setLoading(true);
        const token = sessionStorage.getItem('escandon_token');
        const queryParams = new URLSearchParams();
        if (startDate) queryParams.append('start', startDate);
        if (endDate) queryParams.append('end', endDate);

        const res = await fetch(`${API_BASE}/admin/audit-logs?${queryParams.toString()}`, {
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
    
    // Polling cada 30 segundos solo si no hay filtro de fechas (vista en vivo)
    let interval;
    if (!startDate && !endDate) {
      interval = setInterval(fetchLogs, 30000);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [startDate, endDate]);

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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: '1.65rem', fontWeight: 800, color: 'white', margin: 0, letterSpacing: '-0.01em' }}>
              Log de Auditoría
            </h1>
            <button
              onClick={async () => {
                const token = sessionStorage.getItem('escandon_token');
                const queryParams = new URLSearchParams();
                if (startDate) queryParams.append('start', startDate);
                if (endDate) queryParams.append('end', endDate);

                try {
                  const res = await fetch(`${API_BASE}/admin/audit-logs/excel?${queryParams.toString()}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                  });
                  if (!res.ok) throw new Error('Error al generar Excel');
                  const blob = await res.blob();
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `LogAuditoria_${new Date().toISOString().slice(0,10)}.xlsx`;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  window.URL.revokeObjectURL(url);
                } catch(e) {
                  alert(e.message);
                }
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.2)',
                padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer', fontFamily: 'var(--font-body)',
                fontSize: '0.85rem', fontWeight: 600, transition: 'all 0.2s'
              }}
              onMouseOver={e => { e.currentTarget.style.background = 'white'; e.currentTarget.style.color = 'var(--color-azul-fuerte)'; }}
              onMouseOut={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = 'white'; }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
              Exportar Excel
            </button>
          </div>
          <p style={{ fontFamily: 'var(--font-body)', color: 'rgba(255,255,255,0.72)', fontSize: '0.85rem', margin: '0.4rem 0 0', fontWeight: 500 }}>
            Registro en tiempo real de todas las acciones operativas y administrativas del sistema
          </p>
        </div>
      </div>
      {/* Búsqueda y Filtros */}
      <div style={{
        background: 'white', borderRadius: 12, padding: '0.75rem', marginBottom: '1.5rem',
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap'
      }}>
        {/* Filtros por fecha */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderRight: '1px solid #E2E8F0', paddingRight: '1rem' }}>
          <span style={{ fontSize: '0.8rem', fontFamily: 'var(--font-display)', color: 'var(--color-azul-fuerte)', fontWeight: 600 }}>Desde:</span>
          <input 
            type="date" 
            value={startDate} 
            onChange={e => setStartDate(e.target.value)}
            style={{ padding: '0.4rem', border: '1px solid #E2E8F0', borderRadius: '6px', outline: 'none', fontFamily: 'var(--font-body)', fontSize: '0.85rem' }}
          />
          <span style={{ fontSize: '0.8rem', fontFamily: 'var(--font-display)', color: 'var(--color-azul-fuerte)', fontWeight: 600, marginLeft: '0.5rem' }}>Hasta:</span>
          <input 
            type="date" 
            value={endDate} 
            onChange={e => setEndDate(e.target.value)}
            style={{ padding: '0.4rem', border: '1px solid #E2E8F0', borderRadius: '6px', outline: 'none', fontFamily: 'var(--font-body)', fontSize: '0.85rem' }}
          />
        </div>

        <div style={{ position: 'relative', flex: 1, minWidth: '250px' }}>
          <div style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-slate-400)', pointerEvents: 'none' }}>
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <input
            type="text"
            className="search-input-field"
            placeholder="Filtrar logs por usuario, endpoint, código de respuesta..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{
              width: '100%', padding: '0.75rem 1rem 0.75rem 2.75rem',
              border: '1px solid #E2E8F0', borderRadius: '8px', background: '#F8FAFC',
              fontSize: '0.9rem', outline: 'none', transition: 'all 0.2s',
              fontFamily: 'var(--font-body)', color: 'var(--text-main)', boxSizing: 'border-box'
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
              {rows.slice(0, 500).map((r, i) => {
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
