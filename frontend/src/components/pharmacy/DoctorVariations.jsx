import React, { useState, useEffect, useMemo } from 'react';
import { API_BASE } from '../../api/config';
import { authHeaders } from '../../api/auth';

export default function DoctorVariations() {
  const [variationsData, setVariationsData] = useState({});
  const [kits, setKits] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Selected state
  const [months, setMonths] = useState(6);
  const [selectedProcedure, setSelectedProcedure] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState('cards'); // 'cards', 'differencesTable', 'specificSurgery'
  const [selectedSurgeryFolio, setSelectedSurgeryFolio] = useState('');

  useEffect(() => {
    setLoading(true);
    setError(null);

    Promise.all([
      fetch(`${API_BASE}/pharmacy/doctor-variations?months=${months}`, { headers: authHeaders() }).then(r => r.json()),
      fetch(`${API_BASE}/pharmacy/surgical-kits?months=${months}`, { headers: authHeaders() }).then(r => r.json()),
      fetch(`${API_BASE}/pharmacy/surgical-events?days=365`, { headers: authHeaders() }).then(r => r.json())
    ])
      .then(([varJson, kitsJson, eventsJson]) => {
        if (varJson.ok) {
          setVariationsData(varJson.data || {});
          const procs = Object.keys(varJson.data || {});
          if (procs.length > 0 && !selectedProcedure) setSelectedProcedure(procs[0]);
        } else {
          setError(varJson.error || 'Error al obtener variaciones por médico');
        }

        if (kitsJson.ok) setKits(kitsJson.data || []);
        if (eventsJson.ok) setEvents(eventsJson.data || []);
        
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setError('Error de conexión con el servidor');
        setLoading(false);
      });
  }, [months]);

  const proceduresList = useMemo(() => {
    return Object.keys(variationsData).sort();
  }, [variationsData]);

  // Doctors for current procedure
  const currentDoctorsData = useMemo(() => {
    if (!selectedProcedure || !variationsData[selectedProcedure]) return {};
    return variationsData[selectedProcedure];
  }, [selectedProcedure, variationsData]);

  const doctorsList = useMemo(() => {
    return Object.keys(currentDoctorsData);
  }, [currentDoctorsData]);

  // Real events for current selected procedure
  const filteredEventsForProcedure = useMemo(() => {
    if (!selectedProcedure) return [];
    const procUpper = selectedProcedure.toUpperCase().trim();
    return events.filter(e => (e.Procedimiento || '').toUpperCase().trim().includes(procUpper));
  }, [selectedProcedure, events]);

  // Auto select first surgery folio if none selected
  useEffect(() => {
    if (filteredEventsForProcedure.length > 0) {
      if (!selectedSurgeryFolio || !filteredEventsForProcedure.some(e => String(e.PCFRNum) === String(selectedSurgeryFolio))) {
        setSelectedSurgeryFolio(String(filteredEventsForProcedure[0].PCFRNum));
      }
    }
  }, [filteredEventsForProcedure]);

  const currentSelectedSurgery = useMemo(() => {
    return events.find(e => String(e.PCFRNum) === String(selectedSurgeryFolio)) || null;
  }, [selectedSurgeryFolio, events]);

  // Hospital Average Kit matching selected procedure
  const hospitalKit = useMemo(() => {
    if (!selectedProcedure) return null;
    return kits.find(k => k.Cirugia.toUpperCase().trim() === selectedProcedure.toUpperCase().trim()) || null;
  }, [selectedProcedure, kits]);

  // Build Comparative Differences Matrix Table
  const differencesMatrix = useMemo(() => {
    if (!selectedProcedure || doctorsList.length === 0) return [];

    const itemsMap = new Map();

    doctorsList.forEach(docName => {
      const docItems = currentDoctorsData[docName]?.Items || [];
      docItems.forEach(item => {
        if (!itemsMap.has(item.Codigo)) {
          itemsMap.set(item.Codigo, {
            Codigo: item.Codigo,
            Medicamento: item.Medicamento,
            DoctorConsumptions: {},
            KitAvg: 0
          });
        }
        itemsMap.get(item.Codigo).DoctorConsumptions[docName] = item.PromedioPiezas;
      });
    });

    // Populate kit averages
    if (hospitalKit) {
      hospitalKit.Items.forEach(kItem => {
        if (itemsMap.has(kItem.Codigo)) {
          itemsMap.get(kItem.Codigo).KitAvg = kItem.PromedioPiezas;
        }
      });
    }

    const rows = Array.from(itemsMap.values());

    // Calculate max variation for each item
    rows.forEach(r => {
      const values = doctorsList.map(d => r.DoctorConsumptions[d] || 0);
      const min = Math.min(...values);
      const max = Math.max(...values);
      r.Diff = Math.round((max - min) * 10) / 10;
      r.HasHighVariation = min > 0 ? (max / min) >= 1.4 : max > 1;
    });

    return rows.sort((a,b) => b.Diff - a.Diff);
  }, [selectedProcedure, doctorsList, currentDoctorsData, hospitalKit]);

  const exportVariationsToExcel = () => {
    if (!differencesMatrix || differencesMatrix.length === 0) {
      alert('No hay datos de variaciones para exportar.');
      return;
    }

    const fechaReporte = new Date().toLocaleString('es-MX');
    const cols = [
      { header: 'Código SAP', width: 110, align: 'center' },
      { header: 'Insumo / Medicamento', width: 280, align: 'left' },
      { header: 'Kit Hospital (Promedio)', width: 140, align: 'center' },
      ...doctorsList.map(d => ({ header: `Dr(a). ${d}`, width: 160, align: 'center' })),
      { header: 'Diferencia Máx.', width: 120, align: 'center' }
    ];

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
  .high-var{background:#FEE2E2;color:#DC2626;font-weight:bold;text-align:center}
</style></head><body>
<table>
  <tr><td colspan="${cols.length}" class="title-bar">HOSPITAL ESCANDÓN</td></tr>
  <tr><td colspan="${cols.length}" class="subtitle-bar">Matriz de Variaciones de Insumos por Cirujano</td></tr>
  <tr class="info-row"><td colspan="${cols.length}">Procedimiento: ${selectedProcedure} &nbsp;|&nbsp; Período: Últimos ${months} meses &nbsp;|&nbsp; Cirujanos analizados: ${doctorsList.length} &nbsp;|&nbsp; Generado: ${fechaReporte}</td></tr>
  <tr><td colspan="${cols.length}" style="height:6px;border:none"></td></tr>
  <tr>${cols.map(c => `<th style="width:${c.width}px">${c.header}</th>`).join('')}</tr>
  ${differencesMatrix.map((r, i) => {
    return `<tr class="${i % 2 === 0 ? 'even' : 'odd'}">
      <td style="text-align:center;font-weight:bold;color:#005FA9">${r.Codigo}</td>
      <td>${String(r.Medicamento || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>
      <td style="text-align:center;font-weight:bold">${r.HospitalKitAvg > 0 ? `${r.HospitalKitAvg} pza(s)` : '—'}</td>
      ${doctorsList.map(d => {
        const val = r.DoctorConsumptions[d];
        return `<td style="text-align:center">${val !== undefined ? `${val} pza(s)` : '0'}</td>`;
      }).join('')}
      <td class="${r.HasHighVariation ? 'high-var' : ''}" style="text-align:center">${r.Diff > 0 ? `±${r.Diff}` : '0'}</td>
    </tr>`;
  }).join('')}
</table></body></html>`;

    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Variaciones_Cirujanos_${selectedProcedure.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().slice(0, 10)}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ background: 'var(--card-bg, #ffffff)', borderRadius: '16px', padding: '2rem', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.05)', border: '1px solid var(--border-color, #e2e8f0)' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', borderBottom: '2px solid var(--border-color, #e2e8f0)', paddingBottom: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.65rem', fontWeight: '800', color: 'var(--text-main, #0f172a)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>👨‍⚕️</span> Variaciones por Cirujano y Rastreo de Insumos
          </h2>
          <p style={{ color: 'var(--text-muted, #64748b)', margin: '0.35rem 0 0 0', fontSize: '0.95rem' }}>
            Comparativa exacta de consumos por médico, tabla de diferencias y rastreador de insumos sobrantes/devoluciones por cirugía específica.
          </p>
        </div>

        {!loading && !error && (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={exportVariationsToExcel}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.55rem 1rem',
                background: '#00974A',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(0, 151, 74, 0.3)',
                transition: 'all 0.2s ease'
              }}
            >
              📥 Exportar Excel
            </button>
            <button
              onClick={() => setViewMode('cards')}
              style={{
                padding: '0.55rem 1rem',
                borderRadius: '8px',
                border: 'none',
                background: viewMode === 'cards' ? '#3b82f6' : 'var(--sub-bg, #f1f5f9)',
                color: viewMode === 'cards' ? 'white' : 'var(--text-main, #0f172a)',
                fontWeight: 'bold',
                cursor: 'pointer',
                fontSize: '0.85rem'
              }}
            >
              👥 Vista Tarjetas por Médico
            </button>
            <button
              onClick={() => setViewMode('differencesTable')}
              style={{
                padding: '0.55rem 1rem',
                borderRadius: '8px',
                border: 'none',
                background: viewMode === 'differencesTable' ? '#8b5cf6' : 'var(--sub-bg, #f1f5f9)',
                color: viewMode === 'differencesTable' ? 'white' : 'var(--text-main, #0f172a)',
                fontWeight: 'bold',
                cursor: 'pointer',
                fontSize: '0.85rem'
              }}
            >
              📊 Tabla de Diferencias
            </button>
            <button
              onClick={() => setViewMode('specificSurgery')}
              style={{
                padding: '0.55rem 1rem',
                borderRadius: '8px',
                border: 'none',
                background: viewMode === 'specificSurgery' ? '#10b981' : 'var(--sub-bg, #f1f5f9)',
                color: viewMode === 'specificSurgery' ? 'white' : 'var(--text-main, #0f172a)',
                fontWeight: 'bold',
                cursor: 'pointer',
                fontSize: '0.85rem'
              }}
            >
              🔍 Rastreo por Cirugía Específica
            </button>
          </div>
        )}
      </div>

      {/* Selector Control */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '2rem', background: 'var(--sub-bg, #f8fafc)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border-color, #e2e8f0)' }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted, #64748b)', marginBottom: '0.35rem' }}>🔪 Procedimiento Quirúrgico:</label>
          <select 
            value={selectedProcedure}
            onChange={(e) => setSelectedProcedure(e.target.value)}
            style={{ width: '100%', padding: '0.65rem 1rem', borderRadius: '8px', border: '1px solid var(--border-color, #cbd5e1)', background: 'var(--input-bg, #ffffff)', color: 'var(--text-main, #0f172a)', fontSize: '0.95rem', fontWeight: 'bold' }}
          >
            {proceduresList.map((proc, idx) => (
              <option key={idx} value={proc}>{proc}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted, #64748b)', marginBottom: '0.35rem' }}>📅 Ventana Histórica:</label>
          <select 
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
            style={{ width: '100%', padding: '0.65rem 1rem', borderRadius: '8px', border: '1px solid var(--border-color, #cbd5e1)', background: 'var(--input-bg, #ffffff)', color: 'var(--text-main, #0f172a)', fontSize: '0.95rem' }}
          >
            <option value={6}>Últimos 6 meses</option>
            <option value={12}>Últimos 12 meses</option>
            <option value={24}>Últimos 24 meses</option>
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-muted, #64748b)', marginBottom: '0.35rem' }}>🔍 Buscar Insumo:</label>
          <input 
            type="text" 
            placeholder="Ej. Sutura, Gasa, Propofol, Catéter..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: '100%', padding: '0.65rem 1rem', borderRadius: '8px', border: '1px solid var(--border-color, #cbd5e1)', background: 'var(--input-bg, #ffffff)', color: 'var(--text-main, #0f172a)', fontSize: '0.95rem' }}
          />
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--text-muted, #64748b)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>⚙️</div>
          <div style={{ fontWeight: 'bold' }}>Analizando variaciones por cirujano...</div>
        </div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '12px', fontWeight: 'bold' }}>
          ⚠️ {error}
        </div>
      ) : (
        <div>

          {/* VISTA 1: CARDS POR MÉDICO */}
          {viewMode === 'cards' && (
            <div>
              <div style={{ background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.08) 0%, rgba(139, 92, 246, 0.08) 100%)', border: '1px solid rgba(99, 102, 241, 0.2)', padding: '1.25rem', borderRadius: '12px', marginBottom: '2rem' }}>
                <h3 style={{ margin: '0 0 0.5rem 0', color: '#4f46e5', fontSize: '1.2rem', fontWeight: '800' }}>
                  Procedimiento: {selectedProcedure}
                </h3>
                <p style={{ margin: 0, color: 'var(--text-muted, #64748b)', fontSize: '0.9rem' }}>
                  Se identificaron <strong>{doctorsList.length} equipos/médicos cirujanos</strong> que han ejecutado esta intervención.
                  {hospitalKit && ` El kit promedio hospitalario consta de ${hospitalKit.Items.length} insumos.`}
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '1.5rem' }}>
                {doctorsList.map((docName, idx) => {
                  const docInfo = currentDoctorsData[docName];
                  const filteredDocItems = docInfo.Items.filter(i => 
                    !searchTerm.trim() || 
                    i.Medicamento.toLowerCase().includes(searchTerm.toLowerCase()) || 
                    i.Codigo.toLowerCase().includes(searchTerm.toLowerCase())
                  );

                  return (
                    <div key={idx} style={{ background: 'var(--card-sub-bg, #f8fafc)', border: '1px solid var(--border-color, #cbd5e1)', borderRadius: '14px', padding: '1.5rem', boxShadow: '0 2px 4px rgba(0,0,0,0.03)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', borderBottom: '1px solid var(--border-color, #e2e8f0)', paddingBottom: '0.75rem' }}>
                        <div>
                          <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#8b5cf6', textTransform: 'uppercase' }}>
                            👨‍⚕️ Equipos / Cirujano
                          </div>
                          <h4 style={{ margin: '0.2rem 0 0 0', color: 'var(--text-main, #0f172a)', fontSize: '1.05rem', fontWeight: '800', lineHeight: 1.25 }}>
                            {docName}
                          </h4>
                        </div>
                        <span style={{ fontSize: '0.75rem', fontWeight: 'bold', background: '#e0e7ff', color: '#4f46e5', padding: '0.25rem 0.6rem', borderRadius: '999px', whiteSpace: 'nowrap' }}>
                          {docInfo.NumCirugias} cirugía(s)
                        </span>
                      </div>

                      <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-muted, #64748b)', marginBottom: '0.75rem' }}>
                        📦 Consumo promedio por artículo ({filteredDocItems.length} insumos):
                      </div>

                      <div style={{ maxHeight: '350px', overflowY: 'auto', paddingRight: '0.35rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          {filteredDocItems.map((item, iIdx) => (
                            <div key={iIdx} style={{ background: 'var(--card-bg, #ffffff)', border: '1px solid var(--border-color, #e2e8f0)', borderRadius: '8px', padding: '0.6rem 0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <div style={{ flex: 1, paddingRight: '0.75rem' }}>
                                <div style={{ fontSize: '0.7rem', color: '#6366f1', fontFamily: 'monospace', fontWeight: 'bold' }}>{item.Codigo}</div>
                                <div style={{ fontWeight: '600', color: 'var(--text-main, #0f172a)', fontSize: '0.8rem', marginTop: '0.1rem', lineHeight: 1.2 }}>
                                  {item.Medicamento}
                                </div>
                              </div>

                              <div style={{ textAlign: 'center', background: 'rgba(99, 102, 241, 0.1)', padding: '0.35rem 0.6rem', borderRadius: '8px', minWidth: '50px' }}>
                                <div style={{ fontSize: '1.05rem', fontWeight: '800', color: '#4f46e5', lineHeight: 1 }}>
                                  {Number(item.PromedioPiezas || 0).toFixed(1)}
                                </div>
                                <div style={{ fontSize: '0.55rem', color: 'var(--text-muted, #64748b)', textTransform: 'uppercase', fontWeight: 'bold' }}>Piezas</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* VISTA 2: TABLA DE DIFERENCIAS DIRECTA */}
          {viewMode === 'differencesTable' && (
            <div>
              <div style={{ background: 'rgba(139, 92, 246, 0.08)', border: '1px solid rgba(139, 92, 246, 0.2)', padding: '1rem 1.25rem', borderRadius: '12px', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h4 style={{ margin: 0, color: '#7c3aed', fontSize: '1.1rem', fontWeight: '800' }}>
                    📊 Tabla Comparativa Directa de Diferencias por Insumo
                  </h4>
                  <p style={{ margin: '0.2rem 0 0 0', color: 'var(--text-muted, #64748b)', fontSize: '0.85rem' }}>
                    Muestra las piezas promedio que utiliza cada médico para <strong>{selectedProcedure}</strong> y resalta las variaciones o excesos.
                  </p>
                </div>
              </div>

              <div className="custom-table-scroll" style={{ maxHeight: '65vh', overflowY: 'auto', overflowX: 'auto', border: '1px solid var(--border-color, #e2e8f0)', borderRadius: '12px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ textAlign: 'left' }}>
                      <th style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--sub-bg, #f8fafc)', borderBottom: '2px solid var(--border-color, #cbd5e1)', padding: '0.85rem 1rem', width: '130px' }}>Código SAP</th>
                      <th style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--sub-bg, #f8fafc)', borderBottom: '2px solid var(--border-color, #cbd5e1)', padding: '0.85rem 1rem' }}>Insumo / Descripción Completa</th>
                      {doctorsList.map((doc, dIdx) => (
                        <th key={dIdx} style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--sub-bg, #f8fafc)', borderBottom: '2px solid var(--border-color, #cbd5e1)', padding: '0.85rem 1rem', textAlign: 'center', minWidth: '160px' }}>
                          {doc}
                        </th>
                      ))}
                      <th style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--sub-bg, #f8fafc)', borderBottom: '2px solid var(--border-color, #cbd5e1)', padding: '0.85rem 1rem', textAlign: 'center', width: '130px' }}>Diferencia Max</th>
                      <th style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--sub-bg, #f8fafc)', borderBottom: '2px solid var(--border-color, #cbd5e1)', padding: '0.85rem 1rem', textAlign: 'center', width: '150px' }}>Estatus / Variación</th>
                    </tr>
                  </thead>
                  <tbody>
                    {differencesMatrix
                      .filter(r => !searchTerm.trim() || r.Medicamento.toLowerCase().includes(searchTerm.toLowerCase()) || r.Codigo.toLowerCase().includes(searchTerm.toLowerCase()))
                      .map((row, rIdx) => (
                        <tr key={rIdx} style={{ borderBottom: '1px solid var(--border-color, #e2e8f0)', background: row.HasHighVariation ? 'rgba(239, 68, 68, 0.04)' : 'transparent' }}>
                          <td style={{ padding: '0.75rem 1rem', fontWeight: 'bold', color: '#6366f1', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                            {row.Codigo}
                          </td>
                          <td style={{ padding: '0.75rem 1rem' }}>
                            <div style={{ fontWeight: '700', color: 'var(--text-main, #0f172a)', fontSize: '0.9rem', lineHeight: 1.3 }}>
                              {row.Medicamento}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #64748b)', marginTop: '0.15rem' }}>
                              {row.Codigo.startsWith('FAR') ? '💊 Medicamento' : '📦 Material Curación / Insumo QX'}
                            </div>
                          </td>
                          {doctorsList.map((doc, dIdx) => {
                            const qty = row.DoctorConsumptions[doc];
                            return (
                              <td key={dIdx} style={{ padding: '0.75rem 1rem', textAlign: 'center', fontWeight: qty ? 'bold' : 'normal', color: qty ? 'var(--text-main, #0f172a)' : '#94a3b8', fontSize: '0.95rem' }}>
                                {qty !== undefined ? `${Number(qty || 0).toFixed(1)} pz` : '0 pz'}
                              </td>
                            );
                          })}
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                            <span style={{
                              padding: '0.3rem 0.65rem',
                              borderRadius: '6px',
                              fontWeight: 800,
                              fontSize: '0.85rem',
                              background: row.HasHighVariation ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                              color: row.HasHighVariation ? '#dc2626' : '#16a34a'
                            }}>
                              Δ {Number(row.Diff || 0).toFixed(1)} pz
                            </span>
                          </td>
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                            {row.HasHighVariation ? (
                              <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#dc2626', background: '#fee2e2', padding: '0.25rem 0.6rem', borderRadius: '6px' }}>
                                ⚠️ Alta Diferencia
                              </span>
                            ) : (
                              <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#16a34a', background: '#dcfce7', padding: '0.25rem 0.6rem', borderRadius: '6px' }}>
                                🟢 Consumo Par
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* VISTA 3: RASTREO POR CIRUGÍA ESPECÍFICA */}
          {viewMode === 'specificSurgery' && (
            <div>
              <div style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '1.25rem', borderRadius: '12px', marginBottom: '1.5rem' }}>
                <h4 style={{ margin: '0 0 0.5rem 0', color: '#059669', fontSize: '1.1rem', fontWeight: '800' }}>
                  🔍 Rastreador de Insumos y Números Exactos por Cirugía Individual
                </h4>
                <p style={{ margin: 0, color: 'var(--text-muted, #64748b)', fontSize: '0.85rem' }}>
                  Escribe el nombre de un paciente, médico cirujano, procedimiento o número de folio para buscar la cirugía exacta y consultar todos los insumos consumidos.
                </p>
              </div>

              {/* Buscador Global de Cirugías */}
              <div style={{ marginBottom: '1.5rem', background: 'var(--sub-bg, #f8fafc)', padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-color, #cbd5e1)' }}>
                <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-main, #0f172a)', marginBottom: '0.5rem' }}>
                  🔎 Buscar Cirugía por Paciente, Médico, Procedimiento o Folio #:
                </label>
                <input
                  type="text"
                  placeholder="Ej. Rosa Maria, Juarez, Abdominoplastia, 7158..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.85rem 1.1rem',
                    borderRadius: '8px',
                    border: '2px solid #3b82f6',
                    background: 'var(--input-bg, #ffffff)',
                    color: 'var(--text-main, #0f172a)',
                    fontSize: '1rem',
                    fontWeight: 'bold',
                    outline: 'none',
                    boxShadow: '0 2px 8px rgba(59, 130, 246, 0.15)'
                  }}
                />
              </div>

              {/* Lista de Cirugías Coincidentes */}
              <div style={{ marginBottom: '2rem' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-muted, #64748b)', marginBottom: '0.75rem', textTransform: 'uppercase' }}>
                  📋 Cirugías Coincidentes ({events.filter(e => {
                    if (!searchTerm.trim()) return true;
                    const q = searchTerm.toLowerCase().trim();
                    return (e.Paciente || '').toLowerCase().includes(q) ||
                           (e.Medicos || '').toLowerCase().includes(q) ||
                           (e.Procedimiento || '').toLowerCase().includes(q) ||
                           String(e.PCFRNum || '').includes(q);
                  }).length} encontradas):
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem', maxHeight: '380px', overflowY: 'auto', paddingRight: '0.5rem' }}>
                  {events
                    .filter(e => {
                      if (!searchTerm.trim()) return true;
                      const q = searchTerm.toLowerCase().trim();
                      return (e.Paciente || '').toLowerCase().includes(q) ||
                             (e.Medicos || '').toLowerCase().includes(q) ||
                             (e.Procedimiento || '').toLowerCase().includes(q) ||
                             String(e.PCFRNum || '').includes(q);
                    })
                    .slice(0, 30) // Render first 30 matches
                    .map(ev => {
                      const isSelected = String(ev.PCFRNum) === String(selectedSurgeryFolio);
                      const totalPiezas = (ev.ActualItems || []).reduce((acc, i) => acc + i.Cantidad, 0);

                      return (
                        <div
                          key={ev.PCFRNum}
                          onClick={() => setSelectedSurgeryFolio(String(ev.PCFRNum))}
                          style={{
                            background: isSelected ? 'linear-gradient(135deg, rgba(37, 99, 235, 0.15), rgba(59, 130, 246, 0.1))' : 'var(--card-sub-bg, #ffffff)',
                            border: isSelected ? '2px solid #2563eb' : '1px solid var(--border-color, #cbd5e1)',
                            borderRadius: '12px',
                            padding: '1rem',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            boxShadow: isSelected ? '0 4px 14px rgba(37, 99, 235, 0.2)' : '0 2px 4px rgba(0,0,0,0.02)'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                            <span style={{ fontWeight: 800, color: '#2563eb', fontSize: '0.95rem' }}>
                              Folio #{ev.PCFRNum}
                            </span>
                            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted, #64748b)', background: 'var(--sub-bg, #f1f5f9)', padding: '0.2rem 0.5rem', borderRadius: '6px' }}>
                              {new Date(ev.FechaInicio).toLocaleDateString('es-MX')}
                            </span>
                          </div>

                          <div style={{ fontWeight: 800, color: 'var(--text-main, #0f172a)', fontSize: '0.95rem', marginBottom: '0.25rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            👤 {ev.Paciente}
                          </div>

                          <div style={{ fontSize: '0.8rem', color: '#4f46e5', fontWeight: 700, marginBottom: '0.25rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            👨‍⚕️ {ev.Medicos}
                          </div>

                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #64748b)', marginBottom: '0.5rem' }}>
                            🔪 {ev.Procedimiento} ({ev.Quirofano})
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.5rem', borderTop: '1px solid var(--border-color, #e2e8f0)' }}>
                            <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#15803d' }}>
                              📦 {totalPiezas} piezas ({ (ev.ActualItems || []).length } tipos)
                            </span>
                            <button style={{
                              padding: '0.25rem 0.6rem',
                              borderRadius: '6px',
                              border: 'none',
                              background: isSelected ? '#2563eb' : 'rgba(59, 130, 246, 0.1)',
                              color: isSelected ? 'white' : '#2563eb',
                              fontWeight: 800,
                              fontSize: '0.75rem',
                              cursor: 'pointer'
                            }}>
                              {isSelected ? '✓ Seleccionada' : '👁️ Ver Insumos'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Desglose de la Cirugía Seleccionada */}
              {currentSelectedSurgery ? (
                <div style={{ background: 'var(--card-sub-bg, #f8fafc)', border: '2px solid #2563eb', borderRadius: '14px', padding: '1.5rem', boxShadow: '0 8px 24px rgba(0,0,0,0.06)' }}>
                  
                  {/* Header Cirugía Seleccionada */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid var(--border-color, #cbd5e1)', paddingBottom: '0.75rem' }}>
                    <h4 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#1e40af', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span>📦</span> Insumos Consumidos en Folio #{currentSelectedSurgery.PCFRNum}
                    </h4>
                    <span style={{ background: '#dbeafe', color: '#1e40af', padding: '0.3rem 0.8rem', borderRadius: '999px', fontWeight: 800, fontSize: '0.85rem' }}>
                      {currentSelectedSurgery.Quirofano}
                    </span>
                  </div>

                  {/* Ficha técnica de la cirugía */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem', background: 'var(--card-bg, #ffffff)', padding: '1rem', borderRadius: '10px', border: '1px solid var(--border-color, #e2e8f0)' }}>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #64748b)', fontWeight: 'bold' }}>PACIENTE</div>
                      <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-main, #0f172a)' }}>{currentSelectedSurgery.Paciente}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #64748b)', fontWeight: 'bold' }}>EQUIPO MÉDICO / CIRUJANO</div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#4f46e5' }}>{currentSelectedSurgery.Medicos}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #64748b)', fontWeight: 'bold' }}>PROCEDIMIENTO</div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#059669' }}>{currentSelectedSurgery.Procedimiento}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #64748b)', fontWeight: 'bold' }}>TOTAL INSUMOS CARGADOS</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#2563eb' }}>
                        {(currentSelectedSurgery.ActualItems || []).reduce((acc, i) => acc + i.Cantidad, 0)} piezas ({(currentSelectedSurgery.ActualItems || []).length} tipos)
                      </div>
                    </div>
                  </div>

                  {/* Tabla con números exactos de insumos usados en esta cirugía */}
                  <div className="custom-table-scroll" style={{ maxHeight: '50vh', overflowY: 'auto', overflowX: 'auto', border: '1px solid var(--border-color, #e2e8f0)', borderRadius: '10px', background: 'var(--card-bg, #ffffff)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                      <thead>
                        <tr style={{ textAlign: 'left' }}>
                          <th style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--sub-bg, #f8fafc)', borderBottom: '2px solid var(--border-color, #cbd5e1)', padding: '0.85rem 1rem', width: '130px' }}>Código SAP</th>
                          <th style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--sub-bg, #f8fafc)', borderBottom: '2px solid var(--border-color, #cbd5e1)', padding: '0.85rem 1rem' }}>Insumo / Descripción Completa</th>
                          <th style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--sub-bg, #f8fafc)', borderBottom: '2px solid var(--border-color, #cbd5e1)', padding: '0.85rem 1rem', textAlign: 'right', width: '140px' }}>Cantidad Exacta</th>
                          <th style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--sub-bg, #f8fafc)', borderBottom: '2px solid var(--border-color, #cbd5e1)', padding: '0.85rem 1rem', textAlign: 'center', width: '180px' }}>Estatus / Destino</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(currentSelectedSurgery.ActualItems || []).map((item, iIdx) => (
                          <tr key={iIdx} style={{ borderBottom: '1px solid var(--border-color, #e2e8f0)' }}>
                            <td style={{ padding: '0.75rem 1rem', fontWeight: 'bold', color: '#6366f1', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                              {item.Codigo}
                            </td>
                            <td style={{ padding: '0.75rem 1rem' }}>
                              <div style={{ fontWeight: '700', color: 'var(--text-main, #0f172a)', fontSize: '0.9rem' }}>
                                {item.Medicamento}
                              </div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #64748b)', marginTop: '0.1rem' }}>
                                {item.Codigo.startsWith('FAR') ? '💊 Medicamento' : '📦 Material Curación / Insumo QX'}
                              </div>
                            </td>
                            <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 800, fontSize: '1rem', color: '#2563eb' }}>
                              {item.Cantidad} pz
                            </td>
                            <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                              <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#15803d', background: '#dcfce7', padding: '0.25rem 0.65rem', borderRadius: '6px' }}>
                                🟢 Cargado en Folio #{currentSelectedSurgery.PCFRNum}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted, #64748b)', background: 'var(--sub-bg, #f8fafc)', borderRadius: '12px' }}>
                  🔍 Selecciona una cirugía de la lista anterior para ver sus números exactos.
                </div>
              )}
            </div>
          )}

        </div>
      )}
    </div>
  );
}
