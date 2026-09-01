import React, { useState, useEffect, useMemo } from 'react';
import { API_BASE } from '../../api/config';
import { authHeaders } from '../../api/auth';

export default function ControlledLedger() {
  const [data, setData] = useState([]);
  const [stats, setStats] = useState({ totalSalidas: 0, totalControlados: 0, totalAntibioticos: 0, totalRedFria: 0, totalAltoRiesgo: 0, articulosControladosCatalogo: 20 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Filtros
  const [activeFilter, setActiveFilter] = useState('ALL'); // 'ALL', 'CON', 'ANTI', 'REFRI', 'AR'
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchSalidas();
  }, []);

  const fetchSalidas = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/pharmacy/salidas-farmacia`, {
        headers: authHeaders()
      });
      if (!res.ok) throw new Error('Error al conectar con el servidor');
      const json = await res.json();
      if (json.ok) {
        setData(json.data || []);
        setStats(json.stats || {});
      } else {
        setError(json.error || 'Error al obtener datos');
      }
    } catch (err) {
      console.error(err);
      setError('Fallo de conexión al cargar salidas');
    } finally {
      setLoading(false);
    }
  };

  // 1. Filtrado base por término de búsqueda (Paciente, Médico, Medicamento, Código, Lote)
  const searchFilteredData = useMemo(() => {
    const term = searchQuery.toLowerCase().trim();
    if (!term) return data;
    return data.filter(item => {
      return (item.Paciente || '').toLowerCase().includes(term) ||
             (item.Medico || '').toLowerCase().includes(term) ||
             (item.Medicamento || '').toLowerCase().includes(term) ||
             (item.Codigo || '').toLowerCase().includes(term) ||
             (item.Lote || '').toLowerCase().includes(term);
    });
  }, [data, searchQuery]);

  // 2. KPIs dinámicos calculados directamente con base en la información filtrada
  const kpis = useMemo(() => {
    const totalSalidas = searchFilteredData.length;
    const totalControlados = searchFilteredData.filter(d => d.EsControlado).length;
    const totalAntibioticos = searchFilteredData.filter(d => d.EsAntibiotico).length;
    const totalRedFria = searchFilteredData.filter(d => d.EsRedFria).length;
    const totalAltoRiesgo = searchFilteredData.filter(d => d.EsAltoRiesgo).length;
    return {
      totalSalidas,
      totalControlados,
      totalAntibioticos,
      totalRedFria,
      totalAltoRiesgo
    };
  }, [searchFilteredData]);

  // 3. Filtrado final por categoría médica para la tabla
  const filteredData = useMemo(() => {
    if (activeFilter === 'CON') return searchFilteredData.filter(d => d.EsControlado);
    if (activeFilter === 'ANTI') return searchFilteredData.filter(d => d.EsAntibiotico);
    if (activeFilter === 'REFRI') return searchFilteredData.filter(d => d.EsRedFria);
    if (activeFilter === 'AR') return searchFilteredData.filter(d => d.EsAltoRiesgo);
    return searchFilteredData;
  }, [searchFilteredData, activeFilter]);

  const exportToExcel = () => {
    if (filteredData.length === 0) return;
    
    const fechaReporte = new Date().toLocaleString('es-MX');
    const cols = [
      { header: 'Fecha', key: 'Fecha', width: 140 },
      { header: 'Médico Autoriza', key: 'Medico', width: 220 },
      { header: 'Paciente', key: 'Paciente', width: 220 },
      { header: 'Código', key: 'Codigo', width: 100 },
      { header: 'Medicamento / Insumo', key: 'Medicamento', width: 260 },
      { header: 'Clasificación SAP', key: 'Clasificacion', width: 140 },
      { header: 'Lote', key: 'Lote', width: 110, align: 'center' },
      { header: 'Cantidad', key: 'Cantidad', width: 90, align: 'right' }
    ];

    let html = `
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:spreadsheet" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<style>
  body{font-family:Calibri,Arial,sans-serif}table{border-collapse:collapse;width:100%;margin-bottom:20px;}
  .title-bar{background:#004687;color:#fff;font-size:16pt;font-weight:bold;padding:12px 16px}
  .subtitle-bar{background:#0088C9;color:#fff;font-size:12pt;font-weight:bold;padding:8px 16px}
  .info-row td{font-size:9pt;color:#475569;padding:4px 16px}
  th{background:#004687;color:#fff;font-weight:bold;font-size:10pt;padding:10px 8px;border:1px solid #003366;text-align:center}
  td{padding:7px 8px;font-size:9pt;border:1px solid #D1D5DB;color:#1E293B}
  .even{background:#F4F6F9}.odd{background:#FFF}
  .con{color:#dc2626;font-weight:bold;}
</style></head><body>
<table>
  <tr><td colspan="${cols.length}" class="title-bar">HOSPITAL ESCANDÓN - PLATAFORMA BI</td></tr>
  <tr><td colspan="${cols.length}" class="subtitle-bar">Reporte Oficial: Salidas de Farmacia y Medicamentos Controlados</td></tr>
  <tr class="info-row"><td colspan="${cols.length}">Fecha de exportación: ${fechaReporte} &nbsp;|&nbsp; Registros: ${filteredData.length} &nbsp;|&nbsp; Filtro: ${activeFilter}</td></tr>
  <tr><td colspan="${cols.length}" style="height:6px;border:none"></td></tr>
  <tr>${cols.map(c => `<th style="width:${c.width}px">${c.header}</th>`).join('')}</tr>
  ${filteredData.map((row, i) => `<tr class="${i % 2 === 0 ? 'even' : 'odd'}">${cols.map(c => {
    let val = row[c.key];
    if (c.key === 'Fecha' && val) val = new Date(val).toLocaleString('es-MX');
    if (val == null) val = '';
    let cls = row.EsControlado ? ' class="con"' : '';
    return `<td${cls} style="text-align:${c.align || 'left'}">${String(val).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>`;
  }).join('')}</tr>`).join('')}
</table></body></html>`;

    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Salidas_Farmacia_${activeFilter}_${new Date().toISOString().slice(0,10)}.xls`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="controlled-ledger-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      <style>{`
        /* ── Base Cards ── */
        .cl-card {
          background: #FFFFFF;
          border: 1px solid #E2E8F0;
          border-radius: 14px;
          padding: 1.25rem;
          box-shadow: 0 2px 8px rgba(0, 70, 135, 0.05);
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .cl-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 16px rgba(0, 0, 0, 0.08);
        }
        .cl-card-title {
          font-size: 0.78rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #64748B;
        }
        .cl-card-subtitle {
          font-size: 0.8rem;
          font-weight: 500;
          color: #94A3B8;
          margin-top: 0.25rem;
        }

        /* ── Active Cards (Light Mode) ── */
        .cl-card-all.active {
          background: #F0F9FF;
          border: 2px solid #0077B6;
          box-shadow: 0 4px 14px rgba(0, 119, 182, 0.15);
        }
        .cl-card-con.active {
          background: #F5F3FF;
          border: 2px solid #7C3AED;
          box-shadow: 0 4px 14px rgba(124, 58, 237, 0.15);
        }
        .cl-card-anti.active {
          background: #EFF6FF;
          border: 2px solid #2563EB;
          box-shadow: 0 4px 14px rgba(37, 99, 235, 0.15);
        }
        .cl-card-refri.active {
          background: #E0F2FE;
          border: 2px solid #0284C7;
          box-shadow: 0 4px 14px rgba(2, 132, 199, 0.15);
        }

        /* ── KPI Numbers (Light Mode) ── */
        .cl-num-all { color: #0077B6; }
        .cl-num-con { color: #7C3AED; }
        .cl-num-anti { color: #2563EB; }
        .cl-num-refri { color: #0284C7; }

        /* ── Badges in Cards (Light Mode) ── */
        .cl-card-badge {
          font-size: 0.7rem;
          padding: 0.2rem 0.55rem;
          border-radius: 9999px;
          font-weight: 700;
        }
        .cl-badge-all { background: #0077B6; color: #FFFFFF; }
        .cl-badge-con { background: #F5F3FF; color: #7C3AED; }
        .cl-badge-con.active { background: #7C3AED; color: #FFFFFF; }
        .cl-badge-anti { background: #DBEAFE; color: #1D4ED8; }
        .cl-badge-anti.active { background: #2563EB; color: #FFFFFF; }
        .cl-badge-refri { background: #E0F2FE; color: #0284C7; }
        .cl-badge-refri.active { background: #0284C7; color: #FFFFFF; }

        /* ══════════════════════════════════════════════════════════════════
           DARK MODE STYLES
           ══════════════════════════════════════════════════════════════════ */
        [data-theme="dark"] .cl-card {
          background: #0F172A !important;
          border: 1px solid rgba(255, 255, 255, 0.1) !important;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4) !important;
        }
        [data-theme="dark"] .cl-card-title {
          color: #E2E8F0 !important;
        }
        [data-theme="dark"] .cl-card-subtitle {
          color: #94A3B8 !important;
        }

        /* Active Glows in Dark Mode */
        [data-theme="dark"] .cl-card-all.active {
          background: rgba(0, 119, 182, 0.25) !important;
          border: 2px solid #38BDF8 !important;
          box-shadow: 0 0 20px rgba(56, 189, 248, 0.3) !important;
        }
        [data-theme="dark"] .cl-card-con.active {
          background: rgba(124, 58, 237, 0.25) !important;
          border: 2px solid #A78BFA !important;
          box-shadow: 0 0 20px rgba(167, 139, 250, 0.3) !important;
        }
        [data-theme="dark"] .cl-card-anti.active {
          background: rgba(37, 99, 235, 0.25) !important;
          border: 2px solid #60A5FA !important;
          box-shadow: 0 0 20px rgba(96, 165, 250, 0.3) !important;
        }
        [data-theme="dark"] .cl-card-refri.active {
          background: rgba(2, 132, 199, 0.25) !important;
          border: 2px solid #38BDF8 !important;
          box-shadow: 0 0 20px rgba(56, 189, 248, 0.3) !important;
        }

        /* Numbers in Dark Mode */
        [data-theme="dark"] .cl-num-all { color: #38BDF8 !important; }
        [data-theme="dark"] .cl-num-con { color: #A78BFA !important; }
        [data-theme="dark"] .cl-num-anti { color: #60A5FA !important; }
        [data-theme="dark"] .cl-num-refri { color: #38BDF8 !important; }

        /* Badges in Dark Mode */
        [data-theme="dark"] .cl-badge-all {
          background: #0284C7 !important;
          color: #FFFFFF !important;
        }
        [data-theme="dark"] .cl-badge-con {
          background: rgba(124, 58, 237, 0.25) !important;
          color: #C4B5FD !important;
          border: 1px solid rgba(167, 139, 250, 0.4) !important;
        }
        [data-theme="dark"] .cl-badge-con.active {
          background: #7C3AED !important;
          color: #FFFFFF !important;
          border: none !important;
        }
        [data-theme="dark"] .cl-badge-anti {
          background: rgba(37, 99, 235, 0.25) !important;
          color: #93C5FD !important;
          border: 1px solid rgba(96, 165, 250, 0.4) !important;
        }
        [data-theme="dark"] .cl-badge-anti.active {
          background: #2563EB !important;
          color: #FFFFFF !important;
          border: none !important;
        }
        [data-theme="dark"] .cl-badge-refri {
          background: rgba(2, 132, 199, 0.25) !important;
          color: #7DD3FC !important;
          border: 1px solid rgba(56, 189, 248, 0.4) !important;
        }
        [data-theme="dark"] .cl-badge-refri.active {
          background: #0284C7 !important;
          color: #FFFFFF !important;
          border: none !important;
        }

        /* Search bar in Dark Mode */
        [data-theme="dark"] .cl-search-box {
          background: #0F172A !important;
          border-color: rgba(255, 255, 255, 0.1) !important;
        }
        [data-theme="dark"] .cl-search-input {
          background: #1E293B !important;
          border-color: rgba(255, 255, 255, 0.15) !important;
          color: #F8FAFC !important;
        }
        [data-theme="dark"] .cl-search-input::placeholder {
          color: #94A3B8 !important;
        }
        [data-theme="dark"] .cl-table-container {
          background: #0F172A !important;
          border-color: rgba(255, 255, 255, 0.1) !important;
        }
        [data-theme="dark"] .cl-thead {
          background: #1E293B !important;
          border-bottom: 2px solid rgba(255, 255, 255, 0.15) !important;
        }
        [data-theme="dark"] .cl-th {
          color: #CBD5E1 !important;
        }
        [data-theme="dark"] .cl-row-even {
          background: #0F172A !important;
        }
        [data-theme="dark"] .cl-row-odd {
          background: rgba(255, 255, 255, 0.02) !important;
        }
        [data-theme="dark"] .cl-row-con {
          background: rgba(220, 38, 38, 0.08) !important;
        }
        [data-theme="dark"] .cl-row-hover:hover {
          background: rgba(255, 255, 255, 0.05) !important;
        }
        [data-theme="dark"] .cl-text-primary {
          color: #F8FAFC !important;
        }
        [data-theme="dark"] .cl-text-secondary {
          color: #CBD5E1 !important;
        }
        [data-theme="dark"] .cl-text-code {
          color: #38BDF8 !important;
        }
        [data-theme="dark"] .cl-lote-box {
          background: #1E293B !important;
          color: #E2E8F0 !important;
          border-color: rgba(255, 255, 255, 0.15) !important;
        }
      `}</style>
      
      {/* Banner Superior */}
      <div style={{
        background: 'linear-gradient(135deg, #004687 0%, #0077B6 100%)',
        borderRadius: '16px',
        padding: '1.5rem 1.75rem',
        boxShadow: '0 8px 24px rgba(0, 70, 135, 0.15)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.45rem', fontWeight: 800, color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span>📤</span> Salidas de Farmacia y Libro de Controlados
          </h2>
          <p style={{ margin: '0.4rem 0 0 0', color: '#E0F2FE', fontSize: '0.95rem', fontWeight: 500 }}>
            Trazabilidad completa de dispensaciones con lote y medicamentos controlados cruzando SAP y Cirrus.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={exportToExcel}
            style={{
              padding: '0.65rem 1.25rem',
              background: '#00974A',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: '10px',
              fontWeight: 700,
              cursor: 'pointer',
              fontSize: '0.9rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              boxShadow: '0 2px 8px rgba(0, 151, 74, 0.3)',
              transition: 'all 0.2s ease'
            }}
          >
            📥 Exportar Excel
          </button>
          <button
            onClick={fetchSalidas}
            style={{
              padding: '0.65rem 1.25rem',
              background: 'rgba(255, 255, 255, 0.18)',
              color: '#FFFFFF',
              border: '1px solid rgba(255, 255, 255, 0.35)',
              borderRadius: '10px',
              fontWeight: 700,
              cursor: 'pointer',
              fontSize: '0.9rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              backdropFilter: 'blur(8px)',
              transition: 'all 0.2s ease'
            }}
          >
            🔄 Actualizar
          </button>
        </div>
      </div>

      {/* Tarjetas KPI Interactivas (Filtros Principales con soporte Dark Mode) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
        
        {/* Card 1: Total Salidas */}
        <div 
          onClick={() => setActiveFilter('ALL')}
          className={`cl-card cl-card-all ${activeFilter === 'ALL' ? 'active' : ''}`}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div className="cl-card-title">Total Salidas (Lotes)</div>
            {activeFilter === 'ALL' && (
              <span className="cl-card-badge cl-badge-all">✓ ACTIVO</span>
            )}
          </div>
          <div className="cl-num-all" style={{ fontSize: '2.1rem', fontWeight: 800, marginTop: '0.25rem' }}>
            {kpis.totalSalidas}
          </div>
          <div className="cl-card-subtitle">
            {searchQuery ? `Salidas para "${searchQuery}"` : 'Dispensaciones con lote registradas'}
          </div>
        </div>

        {/* Card 2: Controlados (CON) */}
        <div 
          onClick={() => setActiveFilter(activeFilter === 'CON' ? 'ALL' : 'CON')}
          className={`cl-card cl-card-con ${activeFilter === 'CON' ? 'active' : ''}`}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div className="cl-card-title">Medicamentos Controlados</div>
            <span className={`cl-card-badge cl-badge-con ${activeFilter === 'CON' ? 'active' : ''}`}>
              {activeFilter === 'CON' ? '✓ FILTRADO' : '💊 SOLO CONTROLADOS'}
            </span>
          </div>
          <div className="cl-num-con" style={{ fontSize: '2.1rem', fontWeight: 800, marginTop: '0.25rem' }}>
            {kpis.totalControlados}
          </div>
          <div className="cl-card-subtitle">
            {searchQuery ? `Controlados para el filtro actual` : `${stats.articulosControladosCatalogo || 20} psicotrópicos catalogados en SAP`}
          </div>
        </div>

        {/* Card 3: Antibióticos (ANTI) */}
        <div 
          onClick={() => setActiveFilter(activeFilter === 'ANTI' ? 'ALL' : 'ANTI')}
          className={`cl-card cl-card-anti ${activeFilter === 'ANTI' ? 'active' : ''}`}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div className="cl-card-title">Antibióticos</div>
            <span className={`cl-card-badge cl-badge-anti ${activeFilter === 'ANTI' ? 'active' : ''}`}>
              {activeFilter === 'ANTI' ? '✓ FILTRADO' : '💉 VER ANTI'}
            </span>
          </div>
          <div className="cl-num-anti" style={{ fontSize: '2.1rem', fontWeight: 800, marginTop: '0.25rem' }}>
            {kpis.totalAntibioticos}
          </div>
          <div className="cl-card-subtitle">
            {searchQuery ? `Antibióticos para el filtro actual` : 'Clasificación ANTI en SAP'}
          </div>
        </div>

        {/* Card 4: Red Fría (REFRI) */}
        <div 
          onClick={() => setActiveFilter(activeFilter === 'REFRI' ? 'ALL' : 'REFRI')}
          className={`cl-card cl-card-refri ${activeFilter === 'REFRI' ? 'active' : ''}`}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div className="cl-card-title">Red Fría / Refrigerados</div>
            <span className={`cl-card-badge cl-badge-refri ${activeFilter === 'REFRI' ? 'active' : ''}`}>
              {activeFilter === 'REFRI' ? '✓ FILTRADO' : '❄️ VER REFRI'}
            </span>
          </div>
          <div className="cl-num-refri" style={{ fontSize: '2.1rem', fontWeight: 800, marginTop: '0.25rem' }}>
            {kpis.totalRedFria}
          </div>
          <div className="cl-card-subtitle">
            {searchQuery ? `Refrigerados para el filtro actual` : 'Control de temperatura 2°C - 8°C'}
          </div>
        </div>

      </div>

      {/* Barra de Búsqueda y Estado de Filtro */}
      <div className="cl-search-box" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', background: '#FFFFFF', padding: '1rem 1.25rem', borderRadius: '14px', border: '1px solid #E2E8F0', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
        
        {/* Campo de búsqueda grande y limpio */}
        <div style={{ flex: 1, minWidth: '280px', position: 'relative' }}>
          <input
            type="text"
            className="cl-search-input"
            placeholder="🔍 Buscar por Paciente, Médico, Medicamento, Código o Lote..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '0.75rem 2.5rem 0.75rem 1rem',
              background: '#F8FAFC',
              border: '1px solid #CBD5E1',
              borderRadius: '10px',
              color: '#0F172A',
              fontWeight: 500,
              fontSize: '0.95rem',
              outline: 'none',
              transition: 'border-color 0.2s ease, box-shadow 0.2s ease'
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = '#0088C9'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0, 136, 201, 0.15)'; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = '#CBD5E1'; e.currentTarget.style.boxShadow = 'none'; }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{
                position: 'absolute',
                right: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: '#E2E8F0',
                border: 'none',
                borderRadius: '50%',
                width: '22px',
                height: '22px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: '#64748B',
                fontSize: '0.75rem',
                fontWeight: 'bold'
              }}
              title="Limpiar búsqueda"
            >
              ✕
            </button>
          )}
        </div>

        {/* Indicador de estado activo si hay filtro */}
        {(searchQuery || activeFilter !== 'ALL') && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span className="cl-text-secondary" style={{ fontSize: '0.85rem', color: '#64748B', fontWeight: 600 }}>
              Mostrando <strong className="cl-text-primary" style={{ color: '#0F172A' }}>{filteredData.length}</strong> resultados
            </span>
            {activeFilter !== 'ALL' && (
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.3rem 0.65rem',
                background: '#EFF6FF',
                color: '#1D4ED8',
                borderRadius: '8px',
                fontSize: '0.78rem',
                fontWeight: 700,
                border: '1px solid #BFDBFE'
              }}>
                Filtro: {activeFilter === 'CON' ? '💊 Controlados' : activeFilter === 'ANTI' ? '💉 Antibióticos' : activeFilter === 'REFRI' ? '❄️ Red Fría' : activeFilter}
                <button
                  onClick={() => setActiveFilter('ALL')}
                  style={{ background: 'none', border: 'none', color: '#1D4ED8', cursor: 'pointer', fontWeight: 'bold', padding: 0, marginLeft: '4px' }}
                >
                  ✕
                </button>
              </span>
            )}
            <button
              onClick={() => { setSearchQuery(''); setActiveFilter('ALL'); }}
              style={{
                padding: '0.4rem 0.75rem',
                background: '#F1F5F9',
                border: '1px solid #CBD5E1',
                borderRadius: '8px',
                color: '#475569',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Restablecer todo
            </button>
          </div>
        )}

      </div>

      {/* Tabla Principal */}
      <div className="cl-table-container" style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.04)' }}>
        {loading ? (
          <div style={{ padding: '3.5rem', textAlign: 'center', color: '#64748B', fontWeight: 600, fontSize: '1rem' }}>⏳ Cargando registro de salidas y trazabilidad de lotes…</div>
        ) : error ? (
          <div style={{ padding: '3.5rem', textAlign: 'center', color: '#DC2626', fontWeight: 700, fontSize: '1rem' }}>⚠️ {error}</div>
        ) : filteredData.length === 0 ? (
          <div style={{ padding: '3.5rem', textAlign: 'center', color: '#64748B', fontWeight: 600, fontSize: '1rem' }}>
            ⚠️ No se encontraron registros con el filtro seleccionado ({activeFilter}).
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
              <thead>
                <tr className="cl-thead" style={{ background: '#F8FAFC', borderBottom: '2px solid #E2E8F0' }}>
                  <th className="cl-th" style={{ padding: '0.9rem 1.25rem', color: '#475569', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Fecha y Hora</th>
                  <th className="cl-th" style={{ padding: '0.9rem 1.25rem', color: '#475569', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Médico Autoriza</th>
                  <th className="cl-th" style={{ padding: '0.9rem 1.25rem', color: '#475569', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Paciente</th>
                  <th className="cl-th" style={{ padding: '0.9rem 1.25rem', color: '#475569', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Insumo / Medicamento</th>
                  <th className="cl-th" style={{ padding: '0.9rem 1.25rem', textAlign: 'center', color: '#475569', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Clasificación SAP</th>
                  <th className="cl-th" style={{ padding: '0.9rem 1.25rem', textAlign: 'center', color: '#475569', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Lote</th>
                  <th className="cl-th" style={{ padding: '0.9rem 1.25rem', textAlign: 'right', color: '#475569', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Cant.</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.map((row, idx) => {
                  let badge = { text: '📦 GENERAL', bg: '#F1F5F9', color: '#475569', border: '#E2E8F0' };
                  if (row.EsControlado) {
                    badge = { text: '💊 CONTROLADO', bg: '#F5F3FF', color: '#7C3AED', border: '#DDD6FE' };
                  } else if (row.EsAntibiotico) {
                    badge = { text: '💉 ANTIBIÓTICO', bg: '#EFF6FF', color: '#2563EB', border: '#BFDBFE' };
                  } else if (row.EsRedFria) {
                    badge = { text: '❄️ RED FRÍA', bg: '#E0F2FE', color: '#0284C7', border: '#BAE6FD' };
                  } else if (row.EsAltoRiesgo) {
                    badge = { text: '⚠️ ALTO RIESGO', bg: '#FEE2E2', color: '#DC2626', border: '#FECACA' };
                  } else if (row.EsLasa) {
                    badge = { text: '🏷️ LASA', bg: '#FFF7ED', color: '#EA580C', border: '#FED7AA' };
                  }

                  const rowClass = row.EsControlado ? 'cl-row-con' : idx % 2 === 0 ? 'cl-row-even' : 'cl-row-odd';

                  return (
                    <tr 
                      key={idx} 
                      className={`cl-row-hover ${rowClass}`}
                      style={{ 
                        borderBottom: '1px solid #F1F5F9',
                        background: row.EsControlado ? '#FFFDFD' : idx % 2 === 0 ? '#FFFFFF' : '#FBFDFF',
                        transition: 'background 0.15s ease'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = row.EsControlado ? '#FEF2F2' : '#F0F7FF'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = row.EsControlado ? '#FFFDFD' : idx % 2 === 0 ? '#FFFFFF' : '#FBFDFF'; }}
                    >
                      <td className="cl-text-secondary" style={{ padding: '0.85rem 1.25rem', color: '#475569', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {new Date(row.Fecha).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' })} <span style={{ color: '#94A3B8', fontSize: '0.8rem' }}>{new Date(row.Fecha).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                      </td>
                      <td className="cl-text-primary" style={{ padding: '0.85rem 1.25rem', color: '#1E293B', fontWeight: 600 }}>
                        {row.Medico}
                      </td>
                      <td className="cl-text-primary" style={{ padding: '0.85rem 1.25rem', color: '#0F172A', fontWeight: 700 }}>
                        {row.Paciente}
                      </td>
                      <td style={{ padding: '0.85rem 1.25rem' }}>
                        <span className="cl-text-code" style={{ fontSize: '0.75rem', color: '#005FA9', fontWeight: 700, display: 'block' }}>{row.Codigo}</span>
                        <span className="cl-text-primary" style={{ fontWeight: 600, color: row.EsControlado ? '#991B1B' : '#0F172A' }}>{row.Medicamento}</span>
                      </td>
                      <td style={{ padding: '0.85rem 1.25rem', textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '0.3rem 0.75rem',
                          borderRadius: '9999px',
                          fontSize: '0.75rem',
                          fontWeight: 800,
                          whiteSpace: 'nowrap',
                          background: badge.bg,
                          color: badge.color,
                          border: `1px solid ${badge.border}`
                        }}>
                          {badge.text}
                        </span>
                      </td>
                      <td style={{ padding: '0.85rem 1.25rem', textAlign: 'center' }}>
                        <span className="cl-lote-box" style={{ background: '#F1F5F9', color: '#334155', padding: '0.25rem 0.6rem', borderRadius: '6px', fontWeight: 700, fontSize: '0.82rem', fontFamily: 'monospace', border: '1px solid #E2E8F0' }}>
                          {row.Lote}
                        </span>
                      </td>
                      <td style={{ padding: '0.85rem 1.25rem', fontWeight: 800, textAlign: 'right', fontSize: '1.05rem', color: row.EsControlado ? '#7C3AED' : '#0F172A' }}>
                        {row.Cantidad}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}

