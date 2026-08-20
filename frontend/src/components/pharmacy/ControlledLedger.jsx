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

  // Filtrado local en base al tab de clasificación y búsqueda
  const filteredData = useMemo(() => {
    return data.filter(item => {
      // Filtro de clasificación médica
      let matchClass = true;
      if (activeFilter === 'CON') matchClass = item.EsControlado;
      else if (activeFilter === 'ANTI') matchClass = item.EsAntibiotico;
      else if (activeFilter === 'REFRI') matchClass = item.EsRedFria;
      else if (activeFilter === 'AR') matchClass = item.EsAltoRiesgo;

      // Filtro de búsqueda de texto
      const term = searchQuery.toLowerCase().trim();
      const matchText = !term ||
        (item.Paciente || '').toLowerCase().includes(term) ||
        (item.Medico || '').toLowerCase().includes(term) ||
        (item.Medicamento || '').toLowerCase().includes(term) ||
        (item.Codigo || '').toLowerCase().includes(term) ||
        (item.Lote || '').toLowerCase().includes(term);

      return matchClass && matchText;
    });
  }, [data, activeFilter, searchQuery]);

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
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

      {/* Tarjetas KPI Interactivas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
        
        {/* Card 1: Total Salidas */}
        <div 
          onClick={() => setActiveFilter('ALL')}
          style={{ 
            background: activeFilter === 'ALL' ? '#F0F9FF' : '#FFFFFF', 
            border: activeFilter === 'ALL' ? '2px solid #0077B6' : '1px solid #E2E8F0', 
            borderRadius: '14px', 
            padding: '1.25rem', 
            boxShadow: '0 2px 8px rgba(0, 70, 135, 0.05)',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ fontSize: '0.78rem', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700 }}>Total Salidas (Lotes)</div>
            {activeFilter === 'ALL' && (
              <span style={{ fontSize: '0.7rem', background: '#0077B6', color: '#FFFFFF', padding: '0.15rem 0.5rem', borderRadius: '9999px', fontWeight: 700 }}>VER TODO</span>
            )}
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#0077B6', marginTop: '0.25rem' }}>
            {stats.totalSalidas || data.length}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#94A3B8', marginTop: '0.25rem', fontWeight: 500 }}>Dispensaciones con lote registradas</div>
        </div>

        {/* Card 2: Controlados (CON) */}
        <div 
          onClick={() => setActiveFilter(activeFilter === 'CON' ? 'ALL' : 'CON')}
          style={{ 
            background: activeFilter === 'CON' ? '#FEF2F2' : '#FFFFFF', 
            border: activeFilter === 'CON' ? '2px solid #DC2626' : '1px solid #E2E8F0', 
            borderRadius: '14px', 
            padding: '1.25rem', 
            boxShadow: activeFilter === 'CON' ? '0 4px 14px rgba(220, 38, 38, 0.15)' : '0 2px 8px rgba(0, 70, 135, 0.05)',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ fontSize: '0.78rem', color: activeFilter === 'CON' ? '#991B1B' : '#64748B', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700 }}>
              Medicamentos Controlados
            </div>
            <span style={{ 
              fontSize: '0.7rem', 
              background: activeFilter === 'CON' ? '#DC2626' : '#FEE2E2', 
              color: activeFilter === 'CON' ? '#FFFFFF' : '#DC2626', 
              padding: '0.2rem 0.55rem', 
              borderRadius: '9999px', 
              fontWeight: 700 
            }}>
              {activeFilter === 'CON' ? '✓ FILTRADO' : '💊 SOLO CONTROLADOS'}
            </span>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#DC2626', marginTop: '0.25rem' }}>
            {stats.totalControlados || data.filter(d => d.EsControlado).length}
          </div>
          <div style={{ fontSize: '0.8rem', color: activeFilter === 'CON' ? '#B91C1C' : '#94A3B8', marginTop: '0.25rem', fontWeight: 500 }}>
            {stats.articulosControladosCatalogo || 20} psicotrópicos catalogados en SAP
          </div>
        </div>

        {/* Card 3: Antibióticos (ANTI) */}
        <div 
          onClick={() => setActiveFilter(activeFilter === 'ANTI' ? 'ALL' : 'ANTI')}
          style={{ 
            background: activeFilter === 'ANTI' ? '#EFF6FF' : '#FFFFFF', 
            border: activeFilter === 'ANTI' ? '2px solid #2563EB' : '1px solid #E2E8F0', 
            borderRadius: '14px', 
            padding: '1.25rem', 
            boxShadow: activeFilter === 'ANTI' ? '0 4px 14px rgba(37, 99, 235, 0.15)' : '0 2px 8px rgba(0, 70, 135, 0.05)',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ fontSize: '0.78rem', color: activeFilter === 'ANTI' ? '#1E40AF' : '#64748B', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700 }}>
              Antibióticos
            </div>
            <span style={{ 
              fontSize: '0.7rem', 
              background: activeFilter === 'ANTI' ? '#2563EB' : '#DBEAFE', 
              color: activeFilter === 'ANTI' ? '#FFFFFF' : '#1D4ED8', 
              padding: '0.2rem 0.55rem', 
              borderRadius: '9999px', 
              fontWeight: 700 
            }}>
              {activeFilter === 'ANTI' ? '✓ FILTRADO' : '💉 VER ANTI'}
            </span>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#2563EB', marginTop: '0.25rem' }}>
            {stats.totalAntibioticos || data.filter(d => d.EsAntibiotico).length}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#94A3B8', marginTop: '0.25rem', fontWeight: 500 }}>Clasificación ANTI en SAP</div>
        </div>

        {/* Card 4: Red Fría (REFRI) */}
        <div 
          onClick={() => setActiveFilter(activeFilter === 'REFRI' ? 'ALL' : 'REFRI')}
          style={{ 
            background: activeFilter === 'REFRI' ? '#F0FDF4' : '#FFFFFF', 
            border: activeFilter === 'REFRI' ? '2px solid #059669' : '1px solid #E2E8F0', 
            borderRadius: '14px', 
            padding: '1.25rem', 
            boxShadow: activeFilter === 'REFRI' ? '0 4px 14px rgba(5, 150, 105, 0.15)' : '0 2px 8px rgba(0, 70, 135, 0.05)',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ fontSize: '0.78rem', color: activeFilter === 'REFRI' ? '#065F46' : '#64748B', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700 }}>
              Red Fría / Refrigerados
            </div>
            <span style={{ 
              fontSize: '0.7rem', 
              background: activeFilter === 'REFRI' ? '#059669' : '#D1FAE5', 
              color: activeFilter === 'REFRI' ? '#FFFFFF' : '#047857', 
              padding: '0.2rem 0.55rem', 
              borderRadius: '9999px', 
              fontWeight: 700 
            }}>
              {activeFilter === 'REFRI' ? '✓ FILTRADO' : '❄️ VER REFRI'}
            </span>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#059669', marginTop: '0.25rem' }}>
            {stats.totalRedFria || data.filter(d => d.EsRedFria).length}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#94A3B8', marginTop: '0.25rem', fontWeight: 500 }}>Control de temperatura 2°C - 8°C</div>
        </div>

      </div>

      {/* Barra de Filtros y Búsqueda */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', background: '#FFFFFF', padding: '1rem 1.25rem', borderRadius: '14px', border: '1px solid #E2E8F0', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
        
        {/* Botones de filtro rápido */}
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          <button
            onClick={() => setActiveFilter('ALL')}
            style={{
              padding: '0.55rem 1rem',
              borderRadius: '8px',
              border: activeFilter === 'ALL' ? '2px solid #004687' : '1px solid #CBD5E1',
              background: activeFilter === 'ALL' ? '#004687' : '#FFFFFF',
              color: activeFilter === 'ALL' ? '#FFFFFF' : '#334155',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            📋 Todos ({data.length})
          </button>

          <button
            onClick={() => setActiveFilter('CON')}
            style={{
              padding: '0.55rem 1rem',
              borderRadius: '8px',
              border: activeFilter === 'CON' ? '2px solid #DC2626' : '1px solid #FECACA',
              background: activeFilter === 'CON' ? '#DC2626' : '#FEF2F2',
              color: activeFilter === 'CON' ? '#FFFFFF' : '#DC2626',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            💊 Solo Controlados ({data.filter(d => d.EsControlado).length})
          </button>

          <button
            onClick={() => setActiveFilter('ANTI')}
            style={{
              padding: '0.55rem 1rem',
              borderRadius: '8px',
              border: activeFilter === 'ANTI' ? '2px solid #2563EB' : '1px solid #BFDBFE',
              background: activeFilter === 'ANTI' ? '#2563EB' : '#EFF6FF',
              color: activeFilter === 'ANTI' ? '#FFFFFF' : '#2563EB',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            💉 Antibióticos ({data.filter(d => d.EsAntibiotico).length})
          </button>

          <button
            onClick={() => setActiveFilter('REFRI')}
            style={{
              padding: '0.55rem 1rem',
              borderRadius: '8px',
              border: activeFilter === 'REFRI' ? '2px solid #059669' : '1px solid #A7F3D0',
              background: activeFilter === 'REFRI' ? '#059669' : '#ECFDF5',
              color: activeFilter === 'REFRI' ? '#FFFFFF' : '#059669',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            ❄️ Red Fría ({data.filter(d => d.EsRedFria).length})
          </button>
        </div>

        {/* Campo de búsqueda */}
        <div style={{ flex: 1, minWidth: '240px' }}>
          <input
            type="text"
            placeholder="🔍 Buscar por Paciente, Médico, Medicamento, Código o Lote..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '0.65rem 1rem',
              background: '#F8FAFC',
              border: '1px solid #CBD5E1',
              borderRadius: '8px',
              color: '#0F172A',
              fontWeight: 500,
              fontSize: '0.9rem',
              outline: 'none',
              transition: 'border-color 0.2s ease'
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = '#0088C9'; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = '#CBD5E1'; }}
          />
        </div>

      </div>

      {/* Tabla Principal */}
      <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.04)' }}>
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
                <tr style={{ background: '#F8FAFC', borderBottom: '2px solid #E2E8F0' }}>
                  <th style={{ padding: '0.9rem 1.25rem', color: '#475569', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Fecha y Hora</th>
                  <th style={{ padding: '0.9rem 1.25rem', color: '#475569', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Médico Autoriza</th>
                  <th style={{ padding: '0.9rem 1.25rem', color: '#475569', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Paciente</th>
                  <th style={{ padding: '0.9rem 1.25rem', color: '#475569', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Insumo / Medicamento</th>
                  <th style={{ padding: '0.9rem 1.25rem', textAlign: 'center', color: '#475569', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Clasificación SAP</th>
                  <th style={{ padding: '0.9rem 1.25rem', textAlign: 'center', color: '#475569', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Lote</th>
                  <th style={{ padding: '0.9rem 1.25rem', textAlign: 'right', color: '#475569', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Cant.</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.map((row, idx) => {
                  let badge = { text: '📦 GENERAL', bg: '#F1F5F9', color: '#475569', border: '#E2E8F0' };
                  if (row.EsControlado) {
                    badge = { text: '💊 CONTROLADO', bg: '#FEE2E2', color: '#DC2626', border: '#FECACA' };
                  } else if (row.EsAntibiotico) {
                    badge = { text: '💉 ANTIBIÓTICO', bg: '#EFF6FF', color: '#2563EB', border: '#BFDBFE' };
                  } else if (row.EsRedFria) {
                    badge = { text: '❄️ RED FRÍA', bg: '#ECFDF5', color: '#059669', border: '#A7F3D0' };
                  } else if (row.EsAltoRiesgo) {
                    badge = { text: '⚠️ ALTO RIESGO', bg: '#FEF3C7', color: '#D97706', border: '#FDE68A' };
                  } else if (row.EsLasa) {
                    badge = { text: '🏷️ LASA', bg: '#F5F3FF', color: '#7C3AED', border: '#DDD6FE' };
                  }

                  return (
                    <tr 
                      key={idx} 
                      style={{ 
                        borderBottom: '1px solid #F1F5F9',
                        background: row.EsControlado ? '#FFFDFD' : idx % 2 === 0 ? '#FFFFFF' : '#FBFDFF',
                        transition: 'background 0.15s ease'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = row.EsControlado ? '#FEF2F2' : '#F0F7FF'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = row.EsControlado ? '#FFFDFD' : idx % 2 === 0 ? '#FFFFFF' : '#FBFDFF'; }}
                    >
                      <td style={{ padding: '0.85rem 1.25rem', color: '#475569', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {new Date(row.Fecha).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' })} <span style={{ color: '#94A3B8', fontSize: '0.8rem' }}>{new Date(row.Fecha).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                      </td>
                      <td style={{ padding: '0.85rem 1.25rem', color: '#1E293B', fontWeight: 600 }}>
                        {row.Medico}
                      </td>
                      <td style={{ padding: '0.85rem 1.25rem', color: '#0F172A', fontWeight: 700 }}>
                        {row.Paciente}
                      </td>
                      <td style={{ padding: '0.85rem 1.25rem' }}>
                        <span style={{ fontSize: '0.75rem', color: '#005FA9', fontWeight: 700, display: 'block' }}>{row.Codigo}</span>
                        <span style={{ fontWeight: 600, color: row.EsControlado ? '#991B1B' : '#0F172A' }}>{row.Medicamento}</span>
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
                        <span style={{ background: '#F1F5F9', color: '#334155', padding: '0.25rem 0.6rem', borderRadius: '6px', fontWeight: 700, fontSize: '0.82rem', fontFamily: 'monospace', border: '1px solid #E2E8F0' }}>
                          {row.Lote}
                        </span>
                      </td>
                      <td style={{ padding: '0.85rem 1.25rem', fontWeight: 800, textAlign: 'right', fontSize: '1.05rem', color: row.EsControlado ? '#DC2626' : '#0F172A' }}>
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

