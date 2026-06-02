/**
 * InventarioVsCargos.jsx — Módulo de Auditoría Prioridad 1
 * Compara Órdenes surtidas por Almacén y Consumos en Cuenta del Paciente
 * Hospital Escandón BI Platform v3.5
 */
import { useState, useEffect } from 'react';
import ExportButton from '../shared/ExportButton';

import { API_BASE } from '../../api/config';

const ESTADO_CONFIG = {
  COINCIDE:    { label:'Coincide',     class:'badge-ok'      },
  DIFERENCIA:  { label:'Diferencia',   class:'badge-warning' },
  FALTANTE:    { label:'Faltante',     class:'badge-danger'  },
  EXCEDENTE:   { label:'Excedente',    class:'badge-warning' },
};

export default function InventarioVsCargos({ defaultEstado = '' }) {
  const [data,    setData]   = useState(null);
  const [loading, setLoad]   = useState(true);
  const [filters, setFilters] = useState({ area:'', estado: defaultEstado, fechaDesde:'', fechaHasta:'' });
  const [page,    setPage]   = useState(1);
  const PER_PAGE = 12;

  useEffect(() => {
    fetchData();
  }, [filters]);

  const fetchData = async () => {
    setLoad(true);
    try {
      const token  = sessionStorage.getItem('escandon_token');
      const params = new URLSearchParams(
        Object.fromEntries(Object.entries(filters).filter(([, v]) => v))
      );
      const res    = await fetch(`${API_BASE}/audit/inventarios-vs-cargos?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      setData(json);
      setPage(1);
    } catch (err) {
      console.error('[Auditoría]', err);
    } finally {
      setLoad(false);
    }
  };

  const rows      = data?.partidas ?? MOCK_ROWS;
  const filtered  = rows.filter(r => {
    if (filters.area && r.area !== filters.area) return false;
    if (filters.estado && r.estado !== filters.estado) return false;
    if (filters.fechaDesde && r.fecha < filters.fechaDesde) return false;
    if (filters.fechaHasta && r.fecha > filters.fechaHasta) return false;
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const paginated  = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  return (
    <div style={{ maxWidth: 1280, margin:'0 auto' }}>

      {/* Header */}
      <div style={{
        background:   'linear-gradient(135deg, #004687 0%, #005FA9 100%)',
        borderRadius:  16,
        padding:      '1.5rem 1.75rem',
        marginBottom: '1.25rem',
        display:      'flex',
        alignItems:   'center',
        justifyContent:'space-between',
      }}>
        <div>
          <div style={{ fontSize:'0.68rem', fontWeight:700, letterSpacing:'0.12em', textTransform:'uppercase', color:'rgba(255,255,255,0.6)', marginBottom:'0.25rem' }}>
            Auditoría — Prioridad 1
          </div>
          <h1 style={{ fontFamily:"var(--font-display)", fontSize:'1.5rem', fontWeight:800, color:'white', margin:0 }}>
            {defaultEstado ? 'Discrepancias en Consumos' : 'Inventarios y Consumos Clínicos'}
          </h1>
          <p style={{ color:'rgba(255,255,255,0.7)', fontSize:'0.82rem', marginTop:'0.25rem', margin:'0.25rem 0 0' }}>
            {defaultEstado 
              ? 'Revisión y resolución de partidas con diferencias o faltantes'
              : 'Conciliación de órdenes del Almacén contra consumos clínicos en la cuenta del paciente'}
          </p>
        </div>
        <div style={{ display:'flex', gap:'0.5rem' }}>
          <ExportButton type="excel" reportId="auditoria-inventarios" />
          <ExportButton type="pdf"   reportId="auditoria-inventarios" />
        </div>
      </div>

      {/* KPIs de resumen */}
      {data?.resumen && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'0.875rem', marginBottom:'1.25rem' }}>
          {[
            { label:'Total Partidas',    value: data.resumen.totalPartidas,   color:'#004687', icon:'📋' },
            { label:'Coincidencias',     value: data.resumen.coincidencias,   color:'#00974A', icon:'✅' },
            { label:'Con Diferencia',    value: data.resumen.diferencias,     color:'#F59E0B', icon:'⚠️' },
            { label:'Monto en Disputa',  value:`$${data.resumen.montoDisputa?.toLocaleString('es-MX')}`, color:'#EF4444', icon:'💰' },
          ].map(k => (
            <div key={k.label} style={{ background:'white', borderRadius:12, padding:'1rem', border:'1px solid rgba(0,70,135,0.07)', boxShadow:'0 2px 6px rgba(0,70,135,0.05)' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'0.4rem' }}>
                <span style={{ fontSize:'0.68rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'#8A97A8' }}>{k.label}</span>
                <span style={{ fontSize:'1.1rem' }}>{k.icon}</span>
              </div>
              <div style={{ fontFamily:"var(--font-mono)", fontSize:'1.4rem', fontWeight:700, color: k.color }}>{k.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filtros */}
      <div style={{ background:'white', borderRadius:12, padding:'1rem 1.25rem', marginBottom:'1rem', border:'1px solid rgba(0,70,135,0.07)', display:'flex', gap:'0.75rem', flexWrap:'wrap', alignItems:'center' }}>
        <span style={{ fontSize:'0.8rem', fontWeight:600, color:'#4A5568', marginRight:'0.25rem' }}>🔍 Filtros:</span>

        {[
          { key:'area', placeholder:'Área…', options:['','Quirófano','UCI','Urgencias','Cuneros','Hospitalización'] },
          { key:'estado', placeholder:'Estado…', options:['','COINCIDE','DIFERENCIA','FALTANTE','EXCEDENTE'] },
        ].map(f => (
          <select
            key={f.key}
            value={filters[f.key]}
            onChange={e => setFilters(prev => ({ ...prev, [f.key]: e.target.value }))}
            style={{
              border:      '1px solid rgba(0,70,135,0.15)',
              borderRadius: 8,
              padding:     '0.4rem 0.625rem',
              fontSize:    '0.83rem',
              color:       '#4A5568',
              fontFamily:  "'DM Sans', sans-serif",
              outline:     'none',
              background:  'white',
              cursor:      'pointer',
            }}
          >
            {f.options.map(o => <option key={o} value={o}>{o || f.placeholder}</option>)}
          </select>
        ))}

        {[
          { key:'fechaDesde', type:'date', label:'Desde' },
          { key:'fechaHasta', type:'date', label:'Hasta' },
        ].map(f => (
          <div key={f.key} style={{ display:'flex', alignItems:'center', gap:'0.35rem' }}>
            <span style={{ fontSize:'0.75rem', color:'#8A97A8' }}>{f.label}</span>
            <input
              type={f.type}
              value={filters[f.key]}
              onChange={e => setFilters(prev => ({ ...prev, [f.key]: e.target.value }))}
              style={{ border:'1px solid rgba(0,70,135,0.15)', borderRadius:8, padding:'0.4rem 0.625rem', fontSize:'0.83rem', fontFamily:"'DM Sans', sans-serif", outline:'none' }}
            />
          </div>
        ))}

        <button
          onClick={() => setFilters({ area:'', estado:'', fechaDesde:'', fechaHasta:'' })}
          style={{ marginLeft:'auto', fontSize:'0.78rem', color:'#8A97A8', background:'none', border:'1px solid rgba(0,70,135,0.1)', borderRadius:8, padding:'0.4rem 0.75rem', cursor:'pointer', fontFamily:"'DM Sans', sans-serif" }}
        >
          Limpiar
        </button>
      </div>

      {/* Tabla */}
      <div style={{ background:'white', borderRadius:14, border:'1px solid rgba(0,70,135,0.07)', boxShadow:'0 2px 8px rgba(0,70,135,0.05)', overflow:'hidden' }}>
        {loading ? (
          <div style={{ padding:'3rem', textAlign:'center', color:'#8A97A8' }}>
            <div style={{ width:36, height:36, border:'3px solid rgba(0,70,135,0.1)', borderTop:'3px solid #004687', borderRadius:'50%', animation:'spin 0.9s linear infinite', margin:'0 auto 1rem' }} />
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            Cargando datos de auditoría…
          </div>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table className="audit-table">
              <thead>
                <tr>
                  {['# Orden','Paciente','Área','Insumo / Medicamento','Cant. Almacén','Cant. Consumo','Diferencia','Monto ($)','Estado','Responsable','Fecha'].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginated.map((row, i) => {
                  const est = ESTADO_CONFIG[row.estado] || ESTADO_CONFIG.COINCIDE;
                  return (
                    <tr key={i}>
                      <td><code style={{ fontSize:'0.75rem', color:'#005FA9' }}>{row.orden}</code></td>
                      <td style={{ fontWeight:500 }}>{row.paciente}</td>
                      <td>{row.area}</td>
                      <td>{row.insumo}</td>
                      <td style={{ textAlign:'center', fontWeight:600 }}>{row.cantAlmacen}</td>
                      <td style={{ textAlign:'center', fontWeight:600 }}>{row.cantCargo}</td>
                      <td style={{ textAlign:'center', fontWeight:700, color: row.diferencia !== 0 ? '#EF4444' : '#00974A' }}>
                        {row.diferencia > 0 ? `+${row.diferencia}` : row.diferencia}
                      </td>
                      <td style={{ textAlign:'right', fontWeight:600 }}>${row.monto.toLocaleString('es-MX', { minimumFractionDigits:2 })}</td>
                      <td><span className={`badge ${est.class}`}>{est.label}</span></td>
                      <td style={{ fontSize:'0.8rem', color:'#4A5568' }}>{row.enfermera}</td>
                      <td style={{ fontSize:'0.78rem', color:'#8A97A8', whiteSpace:'nowrap' }}>{row.fecha}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Paginación */}
        {!loading && totalPages > 1 && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0.75rem 1.25rem', borderTop:'1px solid rgba(0,70,135,0.06)' }}>
            <span style={{ fontSize:'0.78rem', color:'#8A97A8' }}>
              {filtered.length} registros · página {page} de {totalPages}
            </span>
            <div style={{ display:'flex', gap:'0.35rem' }}>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(p => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  style={{
                    width:36, height:32,
                    borderRadius:8,
                    border:      p === page ? 'none' : '1px solid rgba(0,70,135,0.12)',
                    background:  p === page ? '#004687' : 'white',
                    color:       p === page ? 'white' : '#4A5568',
                    cursor:      'pointer',
                    fontSize:   '0.82rem',
                    fontWeight:  p === page ? 700 : 400,
                    fontFamily: "'DM Sans', sans-serif",
                  }}
                >{p}</button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Datos mock (Vacío para producción) ─────────────────────── */
const MOCK_ROWS = [];
