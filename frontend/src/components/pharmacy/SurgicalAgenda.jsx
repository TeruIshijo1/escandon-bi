import React, { useState, useEffect, useMemo } from 'react';
import { apiFetch } from '../../api/client';
import useEscapeKey from '../../hooks/useEscapeKey';

export default function SurgicalAgenda() {
  const [events, setEvents] = useState([]);
  const [kits, setKits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters & Modal State
  const [days, setDays] = useState(30);
  const [searchTerm, setSearchTerm] = useState('');
  const [quirofanoFilter, setQuirofanoFilter] = useState('ALL');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [modalTab, setModalTab] = useState('ACTUAL'); // 'ACTUAL' or 'SUGGESTED'
  const [copied, setCopied] = useState(false);

  useEscapeKey(() => setSelectedEvent(null), !!selectedEvent);

  useEffect(() => {
    setLoading(true);
    setError(null);
    
    Promise.all([
      apiFetch(`/pharmacy/surgical-events`, { params: { days } }),
      apiFetch(`/pharmacy/surgical-kits`, { params: { months: 12 } })
    ])
      .then(([eventsJson, kitsJson]) => {
        if (eventsJson.ok) setEvents(eventsJson.data || []);
        else setError(eventsJson.error || 'Error al obtener agenda quirúrgica');
        
        if (kitsJson.ok) setKits(kitsJson.data || []);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setError('Error de conexión con el servidor');
        setLoading(false);
      });
  }, [days]);

  // Create a normalized Map of Kits by Procedure Name
  const kitsMap = useMemo(() => {
    const map = new Map();
    kits.forEach(k => {
      map.set(k.Cirugia.toUpperCase().trim(), k);
    });
    return map;
  }, [kits]);

  // Helper to match an event procedure with best fitting kit
  const getMatchedKit = (procName) => {
    if (!procName) return null;
    const normProc = procName.toUpperCase().trim();
    if (kitsMap.has(normProc)) return kitsMap.get(normProc);

    for (const [kitName, kitObj] of kitsMap.entries()) {
      if (normProc.includes(kitName) || kitName.includes(normProc)) {
        return kitObj;
      }
    }
    return null;
  };

  // Filtered Events
  const filteredEvents = useMemo(() => {
    return events.filter(ev => {
      const matchSearch = !searchTerm.trim() || 
        ev.Paciente.toLowerCase().includes(searchTerm.toLowerCase()) ||
        ev.Procedimiento.toLowerCase().includes(searchTerm.toLowerCase()) ||
        ev.Medicos.toLowerCase().includes(searchTerm.toLowerCase()) ||
        String(ev.PCFRNum).includes(searchTerm);

      const matchQuirofano = quirofanoFilter === 'ALL' || ev.Quirofano === quirofanoFilter;

      return matchSearch && matchQuirofano;
    });
  }, [events, searchTerm, quirofanoFilter]);

  const uniqueQuirofanos = useMemo(() => {
    const set = new Set(events.map(e => e.Quirofano));
    return Array.from(set).sort();
  }, [events]);

  const openEventModal = (ev) => {
    setSelectedEvent(ev);
    if (ev.ActualItemsCount > 0) {
      setModalTab('ACTUAL');
    } else {
      setModalTab('SUGGESTED');
    }
  };

  const handleCopyOrder = (event, kit, currentTab) => {
    const dateStr = new Date(event.FechaInicio).toLocaleString('es-MX');
    const isActual = currentTab === 'ACTUAL' && event.ActualItemsCount > 0;
    
    const lines = [
      isActual ? `📦 CONSUMO REAL CARGADO EN CIRUGÍA (QUIRÓFANO)` : `🧰 SOLICITUD DE SURTIMIENTO / KIT SUGERIDO`,
      `================================================`,
      `📍 Ubicación: ${event.Quirofano}`,
      `👤 Paciente: ${event.Paciente} (Folio PCFR: #${event.PCFRNum})`,
      `📅 Fecha/Hora: ${dateStr}`,
      `👨‍⚕️ Equipo Médico: ${event.Medicos}`,
      `🔪 Procedimiento: ${event.Procedimiento}`,
      `------------------------------------------------`,
      isActual 
        ? `INSUMOS REALES CONSUMIDOS (${event.ActualItems.length} artículos):`
        : (kit ? `INSUMOS DEL KIT SUGERIDO PROMEDIO (${kit.Items.length} artículos):` : '⚠️ Sin kit exacto coincidente.'),
      ...(isActual 
        ? event.ActualItems.map(i => `  • [${i.Codigo}] ${i.Medicamento} -> ${i.Cantidad} pza(s)`)
        : (kit ? kit.Items.map(i => `  • [${i.Codigo}] ${i.Medicamento} -> ${i.PromedioPiezas} pza(s)`) : []))
    ];

    navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div style={{ background: 'var(--card-bg, #ffffff)', borderRadius: '16px', padding: '2rem', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.05)', border: '1px solid var(--border-color, #e2e8f0)' }}>
      {/* Header */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', borderBottom: '2px solid var(--border-color, #e2e8f0)', paddingBottom: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.65rem', fontWeight: '800', color: 'var(--text-main, #0f172a)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>📅</span> Agenda Quirúrgica y Registro de Consumos
          </h2>
          <p style={{ color: 'var(--text-muted, #64748b)', margin: '0.35rem 0 0 0', fontSize: '0.95rem' }}>
            Registro de cirugías efectuadas en Quirófano con insumos reales consumidos y proyecciones de kit para surtimiento.
          </p>
        </div>

        {!loading && !error && (
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <div style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)', padding: '0.5rem 1rem', borderRadius: '12px', textAlign: 'center' }}>
              <div style={{ fontSize: '1.25rem', fontWeight: '800', color: '#3b82f6' }}>{events.length}</div>
              <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--text-muted, #64748b)', fontWeight: 'bold' }}>Cirugías Registradas</div>
            </div>
          </div>
        )}
      </div>

      {/* Control Bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem', background: 'var(--sub-bg, #f8fafc)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border-color, #e2e8f0)' }}>
        <div style={{ gridColumn: 'span 2' }}>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-muted, #64748b)', marginBottom: '0.35rem' }}>🔍 Buscar por Paciente, Médico o Procedimiento:</label>
          <input 
            type="text"
            placeholder="Ej. Rebeca, Cesárea, Felipe Alfan, QX 2..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: '100%', padding: '0.65rem 1rem', borderRadius: '8px', border: '1px solid var(--border-color, #cbd5e1)', background: 'var(--input-bg, #ffffff)', color: 'var(--text-main, #0f172a)', fontSize: '0.95rem' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-muted, #64748b)', marginBottom: '0.35rem' }}>🏥 Quirófano:</label>
          <select 
            value={quirofanoFilter}
            onChange={(e) => setQuirofanoFilter(e.target.value)}
            style={{ width: '100%', padding: '0.65rem 1rem', borderRadius: '8px', border: '1px solid var(--border-color, #cbd5e1)', background: 'var(--input-bg, #ffffff)', color: 'var(--text-main, #0f172a)', fontSize: '0.95rem' }}
          >
            <option value="ALL">Todos los Quirófanos</option>
            {uniqueQuirofanos.map((q, idx) => (
              <option key={idx} value={q}>{q}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-muted, #64748b)', marginBottom: '0.35rem' }}>⏱️ Periodo:</label>
          <select 
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            style={{ width: '100%', padding: '0.65rem 1rem', borderRadius: '8px', border: '1px solid var(--border-color, #cbd5e1)', background: 'var(--input-bg, #ffffff)', color: 'var(--text-main, #0f172a)', fontSize: '0.95rem' }}
          >
            <option value={7}>Últimos 7 días</option>
            <option value={30}>Últimos 30 días</option>
            <option value={90}>Últimos 90 días</option>
          </select>
        </div>
      </div>

      {/* Grid of Events */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--text-muted, #64748b)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>⚙️</div>
          <div style={{ fontWeight: 'bold' }}>Cargando agenda de eventos quirúrgicos...</div>
        </div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '12px', fontWeight: 'bold' }}>
          ⚠️ {error}
        </div>
      ) : filteredEvents.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted, #64748b)' }}>
          🔍 No se encontraron registros de cirugías para los criterios seleccionados.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '1.25rem' }}>
          {filteredEvents.map((ev, idx) => {
            const matchedKit = getMatchedKit(ev.Procedimiento);
            const dateObj = new Date(ev.FechaInicio);
            const isCompleted = ev.FechaFin !== null;
            const hasActual = ev.ActualItemsCount > 0;

            return (
              <div 
                key={idx}
                onClick={() => openEventModal(ev)}
                style={{ 
                  background: 'var(--card-sub-bg, #f8fafc)',
                  border: '1px solid var(--border-color, #cbd5e1)',
                  borderRadius: '14px',
                  padding: '1.25rem',
                  cursor: 'pointer',
                  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  display: 'flex',
                  flexDirection: 'column',
                  justify: 'space-between',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.03)'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.transform = 'translateY(-3px)';
                  e.currentTarget.style.borderColor = '#3b82f6';
                  e.currentTarget.style.boxShadow = '0 10px 20px -5px rgba(59, 130, 246, 0.2)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.transform = 'none';
                  e.currentTarget.style.borderColor = 'var(--border-color, #cbd5e1)';
                  e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.03)';
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 'bold', background: '#e0f2fe', color: '#0369a1', padding: '0.2rem 0.6rem', borderRadius: '8px' }}>
                      📍 {ev.Quirofano}
                    </span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 'bold', background: isCompleted ? '#dcfce7' : '#fef3c7', color: isCompleted ? '#166534' : '#92400e', padding: '0.2rem 0.6rem', borderRadius: '999px' }}>
                      {isCompleted ? '✓ Finalizada' : '⏳ En Proceso'}
                    </span>
                  </div>

                  <h3 style={{ margin: '0 0 0.25rem 0', color: 'var(--text-main, #0f172a)', fontSize: '1.1rem', fontWeight: '800', lineHeight: 1.25 }}>
                    {ev.Paciente}
                  </h3>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #64748b)', fontFamily: 'monospace', marginBottom: '0.75rem' }}>
                    Folio PCFR: #{ev.PCFRNum}
                  </div>

                  <div style={{ background: 'var(--card-bg, #ffffff)', padding: '0.75rem', borderRadius: '10px', border: '1px solid var(--border-color, #e2e8f0)', marginBottom: '0.75rem' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#2563eb', marginBottom: '0.25rem' }}>
                      🔪 {ev.Procedimiento}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #64748b)', lineHeight: 1.3 }}>
                      👨‍⚕️ <strong>Médicos:</strong> {ev.Medicos}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.5rem', borderTop: '1px solid var(--border-color, #e2e8f0)' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #64748b)' }}>
                    🕒 {dateObj.toLocaleDateString('es-MX')} {dateObj.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                  </div>

                  {hasActual ? (
                    <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#10b981', background: 'rgba(16, 185, 129, 0.15)', padding: '0.25rem 0.6rem', borderRadius: '6px' }}>
                      📦 Consumo ({ev.ActualItemsCount} insumos)
                    </span>
                  ) : matchedKit ? (
                    <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#8b5cf6', background: 'rgba(139, 92, 246, 0.1)', padding: '0.25rem 0.5rem', borderRadius: '6px' }}>
                      🧰 Kit Sugerido
                    </span>
                  ) : (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted, #94a3b8)' }}>Ver detalles →</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail & Kit Projection Modal */}
      {selectedEvent && (() => {
        const matchedKit = getMatchedKit(selectedEvent.Procedimiento);
        const hasActual = selectedEvent.ActualItemsCount > 0;

        return (
          <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
            <div style={{ background: 'var(--card-bg, #ffffff)', padding: '2rem', borderRadius: '16px', width: '95%', maxWidth: '850px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', border: '1px solid var(--border-color, #cbd5e1)' }}>
              
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', borderBottom: '2px solid var(--border-color, #e2e8f0)', paddingBottom: '0.75rem' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#3b82f6', textTransform: 'uppercase' }}>
                      📍 {selectedEvent.Quirofano} • Folio #{selectedEvent.PCFRNum}
                    </span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 'bold', background: selectedEvent.FechaFin ? '#dcfce7' : '#fef3c7', color: selectedEvent.FechaFin ? '#166534' : '#92400e', padding: '0.15rem 0.5rem', borderRadius: '999px' }}>
                      {selectedEvent.FechaFin ? '✓ Finalizada' : '⏳ En Proceso'}
                    </span>
                  </div>
                  <h3 style={{ margin: '0.2rem 0 0.2rem 0', color: 'var(--text-main, #0f172a)', fontSize: '1.4rem', fontWeight: '800' }}>
                    {selectedEvent.Paciente}
                  </h3>
                  <div style={{ fontSize: '0.9rem', color: 'var(--text-muted, #64748b)' }}>
                    🔪 <strong>Procedimiento:</strong> {selectedEvent.Procedimiento}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted, #64748b)', marginTop: '0.15rem' }}>
                    👨‍⚕️ <strong>Equipo Médico:</strong> {selectedEvent.Medicos}
                  </div>
                </div>

                <button onClick={() => setSelectedEvent(null)} style={{ background: 'none', border: 'none', fontSize: '1.75rem', cursor: 'pointer', color: 'var(--text-muted, #94a3b8)', lineHeight: 1 }}>×</button>
              </div>

              {/* Modal Tabs Switcher */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', background: 'var(--sub-bg, #f8fafc)', padding: '0.5rem', borderRadius: '10px', border: '1px solid var(--border-color, #e2e8f0)', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button 
                    onClick={() => setModalTab('ACTUAL')}
                    disabled={!hasActual}
                    style={{
                      padding: '0.5rem 1rem',
                      borderRadius: '8px',
                      border: 'none',
                      fontWeight: 'bold',
                      fontSize: '0.85rem',
                      cursor: hasActual ? 'pointer' : 'not-allowed',
                      background: modalTab === 'ACTUAL' ? '#10b981' : (hasActual ? 'rgba(16, 185, 129, 0.15)' : '#e2e8f0'),
                      color: modalTab === 'ACTUAL' ? 'white' : (hasActual ? '#047857' : '#94a3b8')
                    }}
                  >
                    📦 Consumo Real Utilizado ({selectedEvent.ActualItemsCount})
                  </button>

                  <button 
                    onClick={() => setModalTab('SUGGESTED')}
                    style={{
                      padding: '0.5rem 1rem',
                      borderRadius: '8px',
                      border: 'none',
                      fontWeight: 'bold',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      background: modalTab === 'SUGGESTED' ? '#8b5cf6' : 'rgba(139, 92, 246, 0.15)',
                      color: modalTab === 'SUGGESTED' ? 'white' : '#6d28d9'
                    }}
                  >
                    🧰 Kit Sugerido Promedio {matchedKit ? `(${matchedKit.Items.length})` : ''}
                  </button>
                </div>

                <button 
                  onClick={() => handleCopyOrder(selectedEvent, matchedKit, modalTab)}
                  style={{ padding: '0.5rem 1.25rem', background: copied ? '#10b981' : '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '0.85rem', cursor: 'pointer' }}
                >
                  {copied ? '✓ ¡Copiado!' : `📋 Copiar Lista (${modalTab === 'ACTUAL' ? 'Real' : 'Kit Sugerido'})`}
                </button>
              </div>

              {/* Items Container */}
              <div style={{ overflowY: 'auto', flex: 1, paddingRight: '0.5rem' }}>
                {modalTab === 'ACTUAL' ? (
                  hasActual ? (
                    <div>
                      <div style={{ fontSize: '0.8rem', color: '#10b981', fontWeight: 'bold', marginBottom: '0.75rem' }}>
                        ✅ Insumos y medicamentos reales cargados a la cuenta del paciente durante el evento quirúrgico:
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '0.75rem' }}>
                        {selectedEvent.ActualItems.map((item, idx) => (
                          <div key={idx} style={{ background: 'var(--sub-bg, #f8fafc)', border: '1px solid var(--border-color, #e2e8f0)', borderRadius: '10px', padding: '0.85rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ flex: 1, paddingRight: '1rem' }}>
                              <div style={{ fontSize: '0.75rem', color: '#10b981', fontFamily: 'monospace', fontWeight: 'bold' }}>{item.Codigo}</div>
                              <div style={{ fontWeight: '600', color: 'var(--text-main, #0f172a)', fontSize: '0.85rem', marginTop: '0.15rem', lineHeight: 1.25 }}>
                                {item.Medicamento}
                              </div>
                            </div>
                            <div style={{ textAlign: 'center', background: 'rgba(16, 185, 129, 0.15)', padding: '0.4rem 0.75rem', borderRadius: '10px', minWidth: '60px' }}>
                              <div style={{ fontSize: '1.2rem', fontWeight: '800', color: '#047857', lineHeight: 1 }}>
                                {item.Cantidad}
                              </div>
                              <div style={{ fontSize: '0.6rem', color: 'var(--text-muted, #64748b)', textTransform: 'uppercase', marginTop: '0.1rem', fontWeight: 'bold' }}>Piezas</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted, #64748b)' }}>
                      ℹ️ Aún no hay consumos registrados en sistema para esta cirugía (en proceso o recién iniciada).
                    </div>
                  )
                ) : (
                  matchedKit ? (
                    <div>
                      <div style={{ fontSize: '0.8rem', color: '#8b5cf6', fontWeight: 'bold', marginBottom: '0.75rem' }}>
                        🧰 Kit promedio calculado históricamente para <strong>{matchedKit.Cirugia}</strong> ({matchedKit.NumCirugias} cirugías muestra):
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '0.75rem' }}>
                        {matchedKit.Items.map((item, idx) => (
                          <div key={idx} style={{ background: 'var(--sub-bg, #f8fafc)', border: '1px solid var(--border-color, #e2e8f0)', borderRadius: '10px', padding: '0.85rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ flex: 1, paddingRight: '1rem' }}>
                              <div style={{ fontSize: '0.75rem', color: '#8b5cf6', fontFamily: 'monospace', fontWeight: 'bold' }}>{item.Codigo}</div>
                              <div style={{ fontWeight: '600', color: 'var(--text-main, #0f172a)', fontSize: '0.85rem', marginTop: '0.15rem', lineHeight: 1.25 }}>
                                {item.Medicamento}
                              </div>
                            </div>
                            <div style={{ textAlign: 'center', background: 'rgba(139, 92, 246, 0.15)', padding: '0.4rem 0.75rem', borderRadius: '10px', minWidth: '60px' }}>
                              <div style={{ fontSize: '1.2rem', fontWeight: '800', color: '#6d28d9', lineHeight: 1 }}>
                                {item.PromedioPiezas.toFixed(1)}
                              </div>
                              <div style={{ fontSize: '0.6rem', color: 'var(--text-muted, #64748b)', textTransform: 'uppercase', marginTop: '0.1rem', fontWeight: 'bold' }}>Piezas</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted, #64748b)' }}>
                      ⚠️ No se encontró un kit precalculado específico para este nombre exacto de procedimiento. 
                      Se recomienda surtir según solicitud directa del cirujano.
                    </div>
                  )
                )}
              </div>

              {/* Modal Footer */}
              <div style={{ marginTop: '1.25rem', textAlign: 'right', paddingTop: '1rem', borderTop: '1px solid var(--border-color, #e2e8f0)' }}>
                <button onClick={() => setSelectedEvent(null)} style={{ padding: '0.65rem 1.5rem', background: '#94a3b8', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
                  Cerrar
                </button>
              </div>

            </div>
          </div>
        );
      })()}
    </div>
  );
}
