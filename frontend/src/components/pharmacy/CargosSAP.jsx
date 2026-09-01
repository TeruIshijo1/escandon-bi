import { useState, useEffect, useMemo, useRef } from 'react';
import PremiumLoader from '../shared/PremiumLoader';
import { API_BASE } from '../../api/config';
import { authHeaders } from '../../api/auth';

const ColumnFilter = ({ columnKey, data, colFilters, setColFilters, label, align = 'left', maxWidth }) => {
  const uniqueVals = Array.from(new Set(data.map(item => item[columnKey]))).filter(Boolean).sort();
  const val = colFilters[columnKey] || '';
  const isActive = val !== '';
  return (
    <th style={{ 
      textAlign: align, maxWidth: maxWidth || 'none', padding: '14px 10px',
      background: '#004687', borderBottom: '3px solid #0088C9',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
        <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)', letterSpacing: '0.05em', fontWeight: '600' }}>{label}</span>
        <select
          value={val}
          onChange={(e) => setColFilters(prev => ({ ...prev, [columnKey]: e.target.value }))}
          style={{
            fontSize: '0.7rem', padding: '3px 6px', borderRadius: '4px',
            border: isActive ? '1.5px solid #38bdf8' : '1px solid rgba(255,255,255,0.2)',
            background: isActive ? 'rgba(56,189,248,0.15)' : 'rgba(255,255,255,0.1)',
            color: '#fff', outline: 'none',
            maxWidth: maxWidth || '100%', textOverflow: 'ellipsis',
          }}
        >
          <option value="" style={{ color: '#1e293b' }}>Todos</option>
          {uniqueVals.map(v => <option key={v} value={v} style={{ color: '#1e293b' }}>{v}</option>)}
        </select>
      </div>
    </th>
  );
};

const StaticTh = ({ label, align = 'center' }) => (
  <th style={{ 
    textAlign: align, padding: '14px 10px',
    background: '#004687', borderBottom: '3px solid #0088C9',
  }}>
    <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)', letterSpacing: '0.05em', fontWeight: '600' }}>{label}</span>
  </th>
);

export default function CargosSAP() {
  const topScrollRef = useRef(null);
  const tableScrollRef = useRef(null);
  const [tableScrollWidth, setTableScrollWidth] = useState(1400);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const getTodayStr = () => new Date().toLocaleDateString('en-CA');
  
  const [fechaDesde, setFechaDesde] = useState(getTodayStr());
  const [fechaHasta, setFechaHasta] = useState(getTodayStr());
  const [areaBusqueda, setAreaBusqueda] = useState('');

  const [colFilters, setColFilters] = useState({});
  const [page, setPage] = useState(1);
  const PER_PAGE = 100;

  useEffect(() => {
    setPage(1);
  }, [colFilters]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const q = new URLSearchParams({ 
            fechaDesde, 
            fechaHasta,
            ...(areaBusqueda ? { area: areaBusqueda } : {})
        });
        const res = await fetch(`${API_BASE}/pharmacy/cargos-sap?${q}`, {
          headers: authHeaders()
        });
        if (!res.ok) throw new Error('Error al cargar datos de cargos');
        const json = await res.json();
        setData(json);
        setPage(1);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [fechaDesde, fechaHasta, areaBusqueda]);

  useEffect(() => {
    const tableContainer = tableScrollRef.current;
    if (!tableContainer) return;

    const observer = new ResizeObserver(() => {
      if (tableContainer.scrollWidth > 0) {
        setTableScrollWidth(tableContainer.scrollWidth);
      }
    });
    
    observer.observe(tableContainer);
    if (tableContainer.firstChild) {
      observer.observe(tableContainer.firstChild);
    }

    return () => observer.disconnect();
  }, [data]);

  const rows = data?.data || [];

  const filtered = useMemo(() => {
    return rows.filter(row => {
      return Object.entries(colFilters).every(([key, val]) => {
        if (!val) return true;
        return String(row[key] ?? '').trim().toLowerCase() === String(val).trim().toLowerCase();
      });
    });
  }, [rows, colFilters]);

  const paginated = useMemo(() => {
    return filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  }, [filtered, page]);

  const totalPages = Math.ceil(filtered.length / PER_PAGE);

  const totalMonto = useMemo(() => filtered.reduce((s, r) => s + (Number(r.MontoCobrado) || 0), 0), [filtered]);
  const totalCant = useMemo(() => filtered.reduce((s, r) => s + (Number(r.CantidadCargada) || 0), 0), [filtered]);
  const uniqueAreasDestino = useMemo(() => new Set(filtered.map(r => r.AreaDestino).filter(Boolean)).size, [filtered]);
  const uniqueUsuariosCargo = useMemo(() => new Set(filtered.map(r => r.UsuarioCargo).filter(Boolean)).size, [filtered]);

  const handleTopScroll = () => {
    if (topScrollRef.current && tableScrollRef.current) {
      tableScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    }
  };

  const handleTableScroll = () => {
    if (topScrollRef.current && tableScrollRef.current) {
      topScrollRef.current.scrollLeft = tableScrollRef.current.scrollLeft;
    }
  };

  const tableStyles = `
    .cargos-row { transition: all 0.15s ease; }
    .cargos-row:hover { background: #EFF6FF !important; }
    .cargos-badge { transition: all 0.15s ease; }
    .cargos-row:hover .cargos-badge { transform: scale(1.03); }
    .cargos-btn { transition: all 0.15s ease; }
    .cargos-btn:hover:not(:disabled) { background: #004687 !important; color: #fff !important; border-color: #004687 !important; transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,70,135,0.25); }
    .cargos-export-btn { transition: all 0.2s ease; }
    .cargos-export-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,151,74,0.4) !important; }
  `;

  return (
    <div style={{ padding: '2rem', maxWidth: '1500px', margin: '0 auto' }}>
      <style>{tableStyles}</style>

      {/* ── Encabezado ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#1E293B', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '2.5rem' }}>🧾</span> Cargos a Pacientes <span style={{ fontSize: '1.25rem', color: '#0088C9', fontWeight: 'normal', marginTop: '0.5rem' }}>(Farmacia)</span>
          </h1>
          <p style={{ color: '#64748b' }}>Dispensaciones y consumos de medicamentos e insumos de Farmacia con trazabilidad de origen, destino, usuarios y lotes SAP.</p>
        </div>
        
        {rows.length > 0 && (
          <button
            className="cargos-export-btn"
            onClick={() => {
              const cols = [
                { header: 'Folio/Orden', key: 'OrdenId', align: 'center', width: 90 },
                { header: 'Fecha Cargo', key: 'FechaCargo', align: 'center', width: 140, type: 'datetime' },
                { header: 'Paciente', key: 'NombrePaciente', align: 'left', width: 220 },
                { header: 'Código', key: 'Codigo', align: 'center', width: 90 },
                { header: 'Insumo / Medicamento', key: 'Insumo', align: 'left', width: 260 },
                { header: 'Cantidad', key: 'CantidadCargada', align: 'center', width: 75, type: 'num' },
                { header: 'Total ($)', key: 'MontoCobrado', align: 'right', width: 95, type: 'money' },
                { header: 'Lote', key: 'Lote', align: 'center', width: 100 },
                { header: 'Caducidad', key: 'Caducidad', align: 'center', width: 95, type: 'date' },
                { header: 'Área Origen (Cargó)', key: 'AreaOrigen', align: 'center', width: 140 },
                { header: 'Usuario Cargo', key: 'NombreUsuarioCargo', align: 'left', width: 200 },
                { header: 'Área / Cama Destino', key: 'AreaDestino', align: 'left', width: 170 },
                { header: 'Usuario Solicitó', key: 'NombreUsuarioSolicita', align: 'left', width: 200 },
                { header: 'Médico Tratante', key: 'MedicoTratante', align: 'left', width: 190 },
              ];
              const fmt = (val, col) => {
                if (val == null || val === '') return '';
                if (col.type === 'date') return new Date(val).toLocaleDateString('es-MX');
                if (col.type === 'datetime') return new Date(val).toLocaleString('es-MX');
                if (col.type === 'money') return `$${Number(val).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                return String(val).replace(/</g, '&lt;').replace(/>/g, '&gt;');
              };
              const tMonto = filtered.reduce((s, r) => s + (Number(r.MontoCobrado) || 0), 0);
              const tCant = filtered.reduce((s, r) => s + (Number(r.CantidadCargada) || 0), 0);
              const fechaReporte = new Date().toLocaleString('es-MX');
              const html = `
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:spreadsheet" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<style>
  body{font-family:Calibri,Arial,sans-serif}table{border-collapse:collapse;width:100%}
  .title-bar{background:#004687;color:#fff;font-size:16pt;font-weight:bold;padding:12px 16px}
  .subtitle-bar{background:#0088C9;color:#fff;font-size:10pt;padding:6px 16px}
  .info-row td{font-size:9pt;color:#475569;padding:4px 16px}
  th{background:#004687;color:#fff;font-weight:bold;font-size:10pt;padding:10px 8px;border:1px solid #003366;text-align:center}
  td{padding:7px 8px;font-size:9pt;border:1px solid #D1D5DB;color:#1E293B}
  .even{background:#F4F6F9}.odd{background:#FFF}
  .lote{color:#B45309;font-weight:bold}.money{color:#15803D;font-weight:bold;text-align:right}
  .total-row td{background:#E0EAF4;font-weight:bold;color:#004687;border-top:2px solid #004687;font-size:10pt;padding:10px 8px}
</style></head><body>
<table>
  <tr><td colspan="${cols.length}" class="title-bar">HOSPITAL ESCANDÓN</td></tr>
  <tr><td colspan="${cols.length}" class="subtitle-bar">Reporte de Cargos a Pacientes — Farmacia (Trazabilidad Origen/Destino y SAP)</td></tr>
  <tr class="info-row"><td colspan="${cols.length}">Período: ${fechaDesde} al ${fechaHasta} &nbsp;|&nbsp; Filtro Área: ${areaBusqueda || 'TODAS'} &nbsp;|&nbsp; Registros: ${filtered.length} &nbsp;|&nbsp; Generado: ${fechaReporte}</td></tr>
  <tr><td colspan="${cols.length}" style="height:6px;border:none"></td></tr>
  <tr>${cols.map(c => `<th style="width:${c.width}px">${c.header}</th>`).join('')}</tr>
  ${filtered.map((row, i) => `<tr class="${i%2===0?'even':'odd'}">${cols.map(c => {
    let cls='', val=fmt(row[c.key],c);
    if(c.key==='Lote') cls=' class="lote"';
    if(c.type==='money') cls=' class="money"';
    return `<td${cls} style="text-align:${c.align}">${val}</td>`;
  }).join('')}</tr>`).join('')}
  <tr class="total-row">
    <td colspan="5" style="text-align:right">TOTALES</td>
    <td style="text-align:center">${tCant.toLocaleString('es-MX')}</td>
    <td style="text-align:right">$${tMonto.toLocaleString('es-MX',{minimumFractionDigits:2})}</td>
    <td colspan="${cols.length - 7}"></td>
  </tr>
</table></body></html>`;
              const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url; a.download = `Cargos_Farmacia_Pacientes_${fechaDesde}_${fechaHasta}.xls`;
              document.body.appendChild(a); a.click(); document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.45rem',
              padding: '0.6rem 1.1rem', background: '#00974A', border: 'none',
              borderRadius: 10, color: '#fff', fontWeight: 700, fontSize: '0.82rem',
              cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,151,74,0.35)',
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>
              <line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/>
            </svg>
            Exportar Excel
          </button>
        )}
      </div>

      {/* ── Filtros ── */}
      <div style={{ background: 'white', padding: '1.5rem', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: '600', color: '#334155', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span>🔍</span> Filtros Generales
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', color: '#64748b', marginBottom: '0.25rem' }}>Fecha Desde</label>
            <input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', color: '#64748b', marginBottom: '0.25rem' }}>Fecha Hasta</label>
            <input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', color: '#64748b', marginBottom: '0.25rem' }}>Filtrar Área Destino</label>
            <select value={areaBusqueda} onChange={e => setAreaBusqueda(e.target.value)}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: 'white' }}>
              <option value="">Todas las áreas</option>
              <option value="QUIROFANO">Quirófano</option>
              <option value="URGENCIAS">Urgencias</option>
              <option value="UCI">UCI / Terapia Intensiva</option>
              <option value="HOSPITALIZACION">Hospitalización</option>
              <option value="CUNEROS">Cuneros / Neonatal</option>
              <option value="CONSULTA_EXTERNA">Consulta Externa</option>
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <PremiumLoader text="Consultando cargos de Farmacia en Cirrus y SAP..." />
      ) : error ? (
        <div style={{ padding: '2rem', background: '#fee2e2', color: '#991b1b', borderRadius: '12px', textAlign: 'center' }}>
          <p><strong>Error:</strong> {error}</p>
          <button onClick={() => window.location.reload()} style={{ marginTop: '1rem', padding: '0.5rem 1rem', background: '#dc2626', color: 'white', borderRadius: '6px', border: 'none', cursor: 'pointer' }}>Reintentar</button>
        </div>
      ) : (
        <div style={{ background: 'white', borderRadius: '16px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
          
          {/* ── Barra de resumen ── */}
          <div style={{ 
            padding: '1rem 1.5rem', borderBottom: '1px solid #e2e8f0', 
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem',
            background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.05em', fontWeight: 600 }}>Cargos Farmacia</div>
                <div style={{ fontSize: '1.25rem', fontWeight: '700', color: '#004687' }}>{filtered.length}</div>
              </div>
              <div style={{ width: '1px', height: '32px', background: '#e2e8f0' }} />
              <div>
                <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.05em', fontWeight: 600 }}>Piezas / Unid.</div>
                <div style={{ fontSize: '1.25rem', fontWeight: '700', color: '#0088C9' }}>{totalCant.toLocaleString('es-MX')}</div>
              </div>
              <div style={{ width: '1px', height: '32px', background: '#e2e8f0' }} />
              <div>
                <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.05em', fontWeight: 600 }}>Monto Total</div>
                <div style={{ fontSize: '1.25rem', fontWeight: '700', color: '#15803d' }}>${totalMonto.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</div>
              </div>
              <div style={{ width: '1px', height: '32px', background: '#e2e8f0' }} />
              <div>
                <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.05em', fontWeight: 600 }}>Áreas Receptoras</div>
                <div style={{ fontSize: '1.25rem', fontWeight: '700', color: '#4f46e5' }}>{uniqueAreasDestino}</div>
              </div>
              <div style={{ width: '1px', height: '32px', background: '#e2e8f0' }} />
              <div>
                <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.05em', fontWeight: 600 }}>Usuarios Dispensadores</div>
                <div style={{ fontSize: '1.25rem', fontWeight: '700', color: '#0891b2' }}>{uniqueUsuariosCargo}</div>
              </div>
            </div>
            {Object.keys(colFilters).length > 0 && (
              <button onClick={() => setColFilters({})} className="cargos-btn"
                style={{ fontSize: '0.8rem', color: '#004687', background: '#EFF6FF', border: '1px solid #BFDBFE', cursor: 'pointer', padding: '6px 14px', borderRadius: '8px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '4px' }}>
                ✕ Limpiar Filtros
              </button>
            )}
          </div>
          
          {/* ── Scroll superior ── */}
          <div ref={topScrollRef} onScroll={handleTopScroll} style={{ width: '100%', overflowX: 'auto', marginBottom: '-1px' }}>
            <div style={{ height: '12px', width: `${tableScrollWidth}px` }} />
          </div>

          {/* ── Tabla ── */}
          <div ref={tableScrollRef} onScroll={handleTableScroll} style={{ overflowX: 'auto', maxHeight: '65vh' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1550px' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <ColumnFilter columnKey="OrdenId" data={rows} colFilters={colFilters} setColFilters={setColFilters} label="Folio" maxWidth="90px" />
                  <StaticTh label="Fecha Cargo" />
                  <ColumnFilter columnKey="NombrePaciente" data={rows} colFilters={colFilters} setColFilters={setColFilters} label="Paciente" maxWidth="200px" />
                  <ColumnFilter columnKey="Codigo" data={rows} colFilters={colFilters} setColFilters={setColFilters} label="Código" maxWidth="100px" />
                  <ColumnFilter columnKey="Insumo" data={rows} colFilters={colFilters} setColFilters={setColFilters} label="Insumo / Medicamento" maxWidth="260px" />
                  <StaticTh label="Cant." />
                  <StaticTh label="Total ($)" align="right" />
                  <ColumnFilter columnKey="Lote" data={rows} colFilters={colFilters} setColFilters={setColFilters} label="Lote" maxWidth="120px" />
                  <StaticTh label="Caducidad" />
                  <ColumnFilter columnKey="AreaOrigen" data={rows} colFilters={colFilters} setColFilters={setColFilters} label="Área Origen (Cargó)" maxWidth="160px" />
                  <ColumnFilter columnKey="NombreUsuarioCargo" data={rows} colFilters={colFilters} setColFilters={setColFilters} label="Usuario Cargo" maxWidth="180px" />
                  <ColumnFilter columnKey="AreaDestino" data={rows} colFilters={colFilters} setColFilters={setColFilters} label="Área / Cama Destino" maxWidth="180px" />
                  <ColumnFilter columnKey="NombreUsuarioSolicita" data={rows} colFilters={colFilters} setColFilters={setColFilters} label="Usuario Solicitó" maxWidth="180px" />
                  <ColumnFilter columnKey="MedicoTratante" data={rows} colFilters={colFilters} setColFilters={setColFilters} label="Médico" maxWidth="180px" />
                </tr>
              </thead>
              <tbody>
                {paginated.length === 0 ? (
                  <tr>
                    <td colSpan="14" style={{ textAlign: 'center', padding: '4rem 2rem', color: '#94a3b8' }}>
                      <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>💊</div>
                      <div style={{ fontWeight: '600', fontSize: '1rem', color: '#64748b' }}>Sin resultados de Farmacia</div>
                      <div style={{ fontSize: '0.85rem' }}>No hay cargos de farmacia que coincidan con los filtros seleccionados.</div>
                    </td>
                  </tr>
                ) : paginated.map((r, i) => {
                  const caducado = r.Caducidad && new Date(r.Caducidad) < new Date();
                  return (
                    <tr key={i} className="cargos-row" style={{ 
                      borderBottom: '1px solid #f1f5f9', 
                      background: i % 2 === 0 ? '#ffffff' : '#f8fafc',
                    }}>
                      {/* Folio */}
                      <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                        <span style={{ 
                          fontWeight: '700', color: '#004687', fontSize: '0.82rem',
                          background: '#EFF6FF', padding: '3px 8px', borderRadius: '6px',
                          border: '1px solid #BFDBFE', display: 'inline-block',
                        }}>{r.OrdenId}</span>
                      </td>

                      {/* Fecha */}
                      <td style={{ padding: '12px 10px', textAlign: 'center', fontSize: '0.78rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                        {r.FechaCargo ? new Date(r.FechaCargo).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                      </td>

                      {/* Paciente */}
                      <td style={{ padding: '12px 10px', maxWidth: '200px' }}>
                        <div style={{ fontWeight: '600', color: '#0f172a', fontSize: '0.82rem' }}>{r.NombrePaciente}</div>
                        {r.Cuenta && (
                          <div style={{ fontSize: '0.68rem', color: '#64748b' }}>Cuenta #{r.Cuenta} {r.TipoCuenta ? `· ${r.TipoCuenta}` : ''}</div>
                        )}
                      </td>

                      {/* Código */}
                      <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                        <span style={{ 
                          fontFamily: 'monospace', fontSize: '0.75rem', fontWeight: '700',
                          color: '#004687', background: '#f0f9ff', padding: '2px 6px', borderRadius: '4px',
                          border: '1px solid #bae6fd',
                        }}>{r.Codigo}</span>
                      </td>

                      {/* Insumo */}
                      <td style={{ padding: '12px 10px', maxWidth: '260px', whiteSpace: 'normal', wordWrap: 'break-word' }}>
                        <div style={{ fontWeight: '500', color: '#1e293b', fontSize: '0.82rem', lineHeight: '1.3' }}>{r.Insumo}</div>
                      </td>

                      {/* Cantidad */}
                      <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                        <span style={{ 
                          fontWeight: '700', fontSize: '0.88rem', color: '#334155',
                          background: '#f1f5f9', padding: '2px 8px', borderRadius: '4px',
                        }}>{r.CantidadCargada}</span>
                      </td>

                      {/* Total $ */}
                      <td style={{ padding: '12px 10px', textAlign: 'right' }}>
                        <span style={{ fontWeight: '700', color: '#15803d', fontSize: '0.88rem' }}>
                          ${(r.MontoCobrado || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                        </span>
                      </td>

                      {/* Lote */}
                      <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                        <span style={{ fontWeight: '700', color: r.Lote ? '#b45309' : '#cbd5e1', fontSize: '0.8rem' }}>
                          {r.Lote || '—'}
                        </span>
                      </td>

                      {/* Caducidad */}
                      <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                        {r.Caducidad ? (
                          <span style={{ 
                            fontSize: '0.75rem', fontWeight: '600',
                            background: caducado ? '#FEE2E2' : '#f0fdf4',
                            color: caducado ? '#991b1b' : '#166534',
                            padding: '2px 6px', borderRadius: '4px',
                          }}>
                            {new Date(r.Caducidad).toLocaleDateString('es-MX')}
                          </span>
                        ) : <span style={{ color: '#cbd5e1' }}>—</span>}
                      </td>

                      {/* Área Origen (Cargó) */}
                      <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                        <span className="cargos-badge" style={{ 
                          background: 'linear-gradient(135deg, #ecfdf5, #d1fae5)', color: '#065f46', 
                          border: '1px solid #a7f3d0',
                          padding: '3px 8px', borderRadius: '12px', fontSize: '0.7rem', 
                          fontWeight: '700', whiteSpace: 'nowrap', display: 'inline-block',
                        }}>
                          {r.AreaOrigen || 'FARMACIA'}
                        </span>
                      </td>

                      {/* Usuario que Cargó */}
                      <td style={{ padding: '12px 10px', maxWidth: '180px' }}>
                        <div style={{ fontWeight: '600', color: '#1e293b', fontSize: '0.8rem', lineHeight: '1.2' }}>
                          {r.NombreUsuarioCargo || r.UsuarioCargo || '—'}
                        </div>
                        {r.UsuarioCargo && (
                          <div style={{ fontSize: '0.68rem', color: '#64748b', fontFamily: 'monospace' }}>
                            @{r.UsuarioCargo} {r.DeptoUsuarioCargo ? `(${r.DeptoUsuarioCargo})` : ''}
                          </div>
                        )}
                      </td>

                      {/* Área / Cama Destino */}
                      <td style={{ padding: '12px 10px' }}>
                        <span className="cargos-badge" style={{ 
                          background: 'linear-gradient(135deg, #e0e7ff, #c7d2fe)', color: '#3730a3', 
                          padding: '3px 9px', borderRadius: '12px', fontSize: '0.7rem', 
                          fontWeight: '600', whiteSpace: 'nowrap', display: 'inline-block',
                          boxShadow: '0 1px 2px rgba(55,48,163,0.1)',
                        }}>
                          {r.AreaDestino || r.AreaHospitalaria || 'NO ESPECIFICADA'}
                        </span>
                      </td>

                      {/* Usuario Solicitante */}
                      <td style={{ padding: '12px 10px', maxWidth: '180px' }}>
                        <div style={{ fontWeight: '500', color: '#334155', fontSize: '0.78rem', lineHeight: '1.2' }}>
                          {r.NombreUsuarioSolicita || r.UsuarioSolicita || '—'}
                        </div>
                        {r.UsuarioSolicita && (
                          <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontFamily: 'monospace' }}>
                            @{r.UsuarioSolicita} {r.DeptoUsuarioSolicita ? `(${r.DeptoUsuarioSolicita})` : ''}
                          </div>
                        )}
                      </td>

                      {/* Médico */}
                      <td style={{ padding: '12px 10px', fontSize: '0.78rem', color: '#475569', maxWidth: '180px' }}>
                        {r.MedicoTratante || <span style={{ color: '#cbd5e1', fontStyle: 'italic' }}>No asignado</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Paginación ── */}
          <div style={{ 
            padding: '0.75rem 1.5rem', borderTop: '1px solid #e2e8f0', 
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
            background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
          }}>
            <span style={{ fontSize: '0.82rem', color: '#64748b' }}>
              Mostrando <strong>{Math.min(filtered.length, (page - 1) * PER_PAGE + 1)}</strong> – <strong>{Math.min(filtered.length, page * PER_PAGE)}</strong> de <strong>{filtered.length}</strong>
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <button className="cargos-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                style={{ padding: '6px 14px', border: '1px solid #cbd5e1', background: 'white', borderRadius: '8px', fontSize: '0.82rem', cursor: page === 1 ? 'not-allowed' : 'pointer', opacity: page === 1 ? 0.5 : 1, fontWeight: '600', color: '#334155' }}>
                ← Anterior
              </button>
              {totalPages > 0 && (
                <span style={{ padding: '6px 12px', background: '#004687', color: '#fff', borderRadius: '8px', fontSize: '0.8rem', fontWeight: '700', minWidth: '40px', textAlign: 'center' }}>
                  {page} / {totalPages}
                </span>
              )}
              <button className="cargos-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages || totalPages === 0}
                style={{ padding: '6px 14px', border: '1px solid #cbd5e1', background: 'white', borderRadius: '8px', fontSize: '0.82rem', cursor: (page === totalPages || totalPages === 0) ? 'not-allowed' : 'pointer', opacity: (page === totalPages || totalPages === 0) ? 0.5 : 1, fontWeight: '600', color: '#334155' }}>
                Siguiente →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
