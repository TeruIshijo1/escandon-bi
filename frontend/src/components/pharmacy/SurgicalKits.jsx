import React, { useState, useEffect, useMemo } from 'react';
import { API_BASE } from '../../api/config';
import { authHeaders } from '../../api/auth';

export default function SurgicalKits() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedKit, setSelectedKit] = useState(null);
  
  // Filters & State
  const [months, setMonths] = useState(12);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('freq'); // 'freq', 'items', 'alpha'
  const [modalSearch, setModalSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const [displayCount, setDisplayCount] = useState(30);

  const fetchKits = (m) => {
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/pharmacy/surgical-kits?months=${m}`, {
      headers: authHeaders()
    })
      .then(res => {
        if (!res.ok) throw new Error('Error al conectar con el servidor');
        return res.json();
      })
      .then(json => {
        if (json.ok) {
          setData(json.data);
        } else {
          setError(json.error || 'Error al obtener datos');
        }
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setError('Fallo de conexión o de red');
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchKits(months);
  }, [months]);

  // Filtered & Sorted Kits
  const filteredKits = useMemo(() => {
    let result = [...data];
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter(kit => 
        kit.Cirugia.toLowerCase().includes(term) ||
        kit.Items.some(i => i.Medicamento.toLowerCase().includes(term) || i.Codigo.toLowerCase().includes(term))
      );
    }

    if (sortBy === 'freq') {
      result.sort((a, b) => b.NumCirugias - a.NumCirugias || b.ItemsCount - a.ItemsCount);
    } else if (sortBy === 'items') {
      result.sort((a, b) => b.ItemsCount - a.ItemsCount);
    } else if (sortBy === 'alpha') {
      result.sort((a, b) => a.Cirugia.localeCompare(b.Cirugia));
    }

    return result;
  }, [data, searchTerm, sortBy]);

  const visibleKits = useMemo(() => {
    return filteredKits.slice(0, displayCount);
  }, [filteredKits, displayCount]);

  // Modal Items Search
  const filteredModalItems = useMemo(() => {
    if (!selectedKit) return [];
    if (!modalSearch.trim()) return selectedKit.Items;
    const term = modalSearch.toLowerCase();
    return selectedKit.Items.filter(item => 
      item.Medicamento.toLowerCase().includes(term) ||
      item.Codigo.toLowerCase().includes(term)
    );
  }, [selectedKit, modalSearch]);

  const handleCopyKit = () => {
    if (!selectedKit) return;
    const lines = [
      `🧰 KIT QUIRÚRGICO: ${selectedKit.Cirugia}`,
      `Cirugías analizadas en muestra: ${selectedKit.NumCirugias || 1}`,
      `Total de artículos: ${selectedKit.Items.length}`,
      '----------------------------------------',
      ...selectedKit.Items.map(i => `• [${i.Codigo}] ${i.Medicamento} - ${i.PromedioPiezas} pza(s)`)
    ];
    navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div style={{ background: 'var(--card-bg, #ffffff)', borderRadius: '16px', padding: '2rem', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.05), 0 8px 10px -6px rgba(0,0,0,0.01)', border: '1px solid var(--border-color, #e2e8f0)' }}>
      {/* Header & Stats Banner */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', borderBottom: '2px solid var(--border-color, #e2e8f0)', paddingBottom: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.65rem', fontWeight: '800', color: 'var(--text-main, #0f172a)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>🔪</span> Calculadora de Kits Quirúrgicos
          </h2>
          <p style={{ color: 'var(--text-muted, #64748b)', margin: '0.35rem 0 0 0', fontSize: '0.95rem' }}>
            Kits promedio calculados estadísticamente del consumo real en Quirófano (QX) en los últimos {months} meses.
          </p>
        </div>

        {/* Stats Pills */}
        {!loading && !error && (
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <div style={{ background: 'rgba(99, 102, 241, 0.1)', border: '1px solid rgba(99, 102, 241, 0.2)', padding: '0.5rem 1rem', borderRadius: '12px', textAlign: 'center' }}>
              <div style={{ fontSize: '1.25rem', fontWeight: '800', color: '#6366f1' }}>{data.length}</div>
              <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--text-muted, #64748b)', fontWeight: 'bold' }}>Kits Totales</div>
            </div>
            <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '0.5rem 1rem', borderRadius: '12px', textAlign: 'center' }}>
              <div style={{ fontSize: '1.25rem', fontWeight: '800', color: '#10b981' }}>{filteredKits.length}</div>
              <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--text-muted, #64748b)', fontWeight: 'bold' }}>Coincidencias</div>
            </div>
          </div>
        )}
      </div>

      {/* Controls Bar: Search, Filters, Timeframe */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '2rem', background: 'var(--sub-bg, #f8fafc)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border-color, #e2e8f0)' }}>
        
        {/* Search Bar */}
        <div style={{ gridColumn: 'span 2' }}>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-muted, #64748b)', marginBottom: '0.35rem' }}>🔍 Buscar por Cirugía o Insumo:</label>
          <input 
            type="text" 
            placeholder="Ej. Apendicitis, Endoscopia, Gasas, Sutura..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ 
              width: '100%', 
              padding: '0.65rem 1rem', 
              borderRadius: '8px', 
              border: '1px solid var(--border-color, #cbd5e1)', 
              background: 'var(--input-bg, #ffffff)', 
              color: 'var(--text-main, #0f172a)',
              outline: 'none',
              fontSize: '0.95rem'
            }}
          />
        </div>

        {/* Timeframe selector */}
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-muted, #64748b)', marginBottom: '0.35rem' }}>📅 Ventana de Consumo:</label>
          <select 
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
            style={{ 
              width: '100%', 
              padding: '0.65rem 1rem', 
              borderRadius: '8px', 
              border: '1px solid var(--border-color, #cbd5e1)', 
              background: 'var(--input-bg, #ffffff)', 
              color: 'var(--text-main, #0f172a)',
              fontSize: '0.95rem'
            }}
          >
            <option value={6}>Últimos 6 meses</option>
            <option value={12}>Últimos 12 meses (Recomendado)</option>
            <option value={24}>Últimos 24 meses</option>
          </select>
        </div>

        {/* Sorting options */}
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-muted, #64748b)', marginBottom: '0.35rem' }}>↕️ Ordenar por:</label>
          <select 
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={{ 
              width: '100%', 
              padding: '0.65rem 1rem', 
              borderRadius: '8px', 
              border: '1px solid var(--border-color, #cbd5e1)', 
              background: 'var(--input-bg, #ffffff)', 
              color: 'var(--text-main, #0f172a)',
              fontSize: '0.95rem'
            }}
          >
            <option value="freq">Más frecuentes (Cirugías)</option>
            <option value="items">Más artículos en kit</option>
            <option value="alpha">Nombre de Cirugía (A-Z)</option>
          </select>
        </div>

      </div>
      
      {/* Content Area */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--text-muted, #64748b)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem', animation: 'spin 1.5s infinite linear' }}>⚙️</div>
          <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>Procesando estadísticas históricas de Quirófano...</div>
          <div style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>Analizando consumos acumulados por diagnóstico en los últimos {months} meses</div>
        </div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '12px', fontWeight: 'bold' }}>
          ⚠️ {error}
        </div>
      ) : filteredKits.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted, #64748b)' }}>
          🔍 No se encontraron kits quirúrgicos que coincidan con <strong>"{searchTerm}"</strong>.
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.25rem' }}>
            {visibleKits.map((kit, idx) => (
              <div 
                key={idx} 
                onClick={() => { setSelectedKit(kit); setModalSearch(''); }}
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
                  e.currentTarget.style.transform = 'translateY(-4px)'; 
                  e.currentTarget.style.boxShadow = '0 12px 20px -5px rgba(139, 92, 246, 0.25)'; 
                  e.currentTarget.style.borderColor = '#8b5cf6'; 
                }}
                onMouseOut={(e) => { 
                  e.currentTarget.style.transform = 'none'; 
                  e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.03)'; 
                  e.currentTarget.style.borderColor = 'var(--border-color, #cbd5e1)'; 
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <span style={{ fontSize: '1.75rem' }}>🧰</span>
                    <span style={{ 
                      fontSize: '0.75rem', 
                      fontWeight: 'bold', 
                      background: 'rgba(139, 92, 246, 0.15)', 
                      color: '#8b5cf6', 
                      padding: '0.2rem 0.6rem', 
                      borderRadius: '999px' 
                    }}>
                      {kit.NumCirugias ? `${kit.NumCirugias} cirugías` : 'Histórico'}
                    </span>
                  </div>
                  <h3 style={{ margin: '0 0 0.75rem 0', color: 'var(--text-main, #0f172a)', fontSize: '1.05rem', fontWeight: '700', lineHeight: '1.3' }}>
                    {kit.Cirugia}
                  </h3>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color, #e2e8f0)', marginTop: '0.5rem' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted, #64748b)', fontWeight: '600' }}>
                    📦 {kit.Items.length} Artículos
                  </div>
                  <span style={{ fontSize: '0.85rem', color: '#8b5cf6', fontWeight: 'bold' }}>Ver Kit →</span>
                </div>
              </div>
            ))}
          </div>

          {/* Load More Button */}
          {visibleKits.length < filteredKits.length && (
            <div style={{ textAlign: 'center', marginTop: '2rem' }}>
              <button 
                onClick={() => setDisplayCount(prev => prev + 30)}
                style={{ 
                  padding: '0.85rem 2rem', 
                  background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)', 
                  color: 'white', 
                  border: 'none', 
                  borderRadius: '12px', 
                  fontWeight: 'bold', 
                  fontSize: '0.95rem',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)'
                }}
              >
                Cargar más Kits ({filteredKits.length - visibleKits.length} restantes)
              </button>
            </div>
          )}
        </>
      )}

      {/* Selected Kit Modal */}
      {selectedKit && (
        <div style={{ 
          position: 'fixed', 
          top: 0, 
          left: 0, 
          width: '100%', 
          height: '100%', 
          background: 'rgba(15, 23, 42, 0.75)', 
          backdropFilter: 'blur(4px)',
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          zIndex: 1000, 
          padding: '1rem' 
        }}>
          <div style={{ 
            background: 'var(--card-bg, #ffffff)', 
            padding: '2rem', 
            borderRadius: '16px', 
            width: '95%', 
            maxWidth: '800px', 
            maxHeight: '90vh', 
            display: 'flex', 
            flexDirection: 'column', 
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
            border: '1px solid var(--border-color, #cbd5e1)'
          }}>
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', borderBottom: '2px solid var(--border-color, #e2e8f0)', paddingBottom: '1rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                  <span style={{ fontSize: '1.75rem' }}>🧰</span>
                  <h3 style={{ margin: 0, color: 'var(--text-main, #0f172a)', fontSize: '1.35rem', fontWeight: '800' }}>
                    Kit: {selectedKit.Cirugia}
                  </h3>
                </div>
                <p style={{ margin: 0, color: 'var(--text-muted, #64748b)', fontSize: '0.9rem' }}>
                  Calculado de {selectedKit.NumCirugias || 1} cirugía(s) registradas históricamente. {selectedKit.Items.length} insumos totales.
                </p>
              </div>
              <button 
                onClick={() => setSelectedKit(null)} 
                style={{ background: 'none', border: 'none', fontSize: '1.75rem', cursor: 'pointer', color: 'var(--text-muted, #94a3b8)', lineHeight: 1 }}
              >
                ×
              </button>
            </div>

            {/* Filter inside modal */}
            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
              <input 
                type="text" 
                placeholder="Filtrar artículos de este kit..."
                value={modalSearch}
                onChange={(e) => setModalSearch(e.target.value)}
                style={{ 
                  flex: 1, 
                  padding: '0.5rem 0.85rem', 
                  borderRadius: '8px', 
                  border: '1px solid var(--border-color, #cbd5e1)', 
                  background: 'var(--input-bg, #ffffff)', 
                  color: 'var(--text-main, #0f172a)',
                  fontSize: '0.85rem'
                }}
              />
              <button 
                onClick={handleCopyKit}
                style={{ 
                  padding: '0.5rem 1rem', 
                  background: copied ? '#10b981' : '#6366f1', 
                  color: 'white', 
                  border: 'none', 
                  borderRadius: '8px', 
                  fontWeight: 'bold', 
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                {copied ? '✓ ¡Copiado!' : '📋 Copiar Lista'}
              </button>
            </div>
            
            {/* Modal Items List */}
            <div style={{ overflowY: 'auto', flex: 1, paddingRight: '0.5rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '0.75rem' }}>
                {filteredModalItems.map((row, idx) => (
                  <div key={idx} style={{ 
                    background: 'var(--sub-bg, #f8fafc)', 
                    border: '1px solid var(--border-color, #e2e8f0)', 
                    borderRadius: '10px', 
                    padding: '0.85rem 1rem', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justify: 'space-between' 
                  }}>
                    <div style={{ flex: 1, paddingRight: '1rem' }}>
                      <div style={{ fontSize: '0.75rem', color: '#8b5cf6', fontFamily: 'monospace', fontWeight: 'bold' }}>{row.Codigo}</div>
                      <div style={{ fontWeight: '600', color: 'var(--text-main, #0f172a)', fontSize: '0.85rem', marginTop: '0.15rem', lineHeight: 1.25 }}>
                        {row.Medicamento}
                      </div>
                    </div>
                    <div style={{ textAlign: 'center', background: 'rgba(139, 92, 246, 0.15)', padding: '0.4rem 0.75rem', borderRadius: '10px', minWidth: '60px' }}>
                      <div style={{ fontSize: '1.2rem', fontWeight: '800', color: '#8b5cf6', lineHeight: 1 }}>
                        {row.PromedioPiezas.toFixed(1)}
                      </div>
                      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted, #64748b)', textTransform: 'uppercase', marginTop: '0.1rem', fontWeight: 'bold' }}>Piezas</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            {/* Modal Footer */}
            <div style={{ marginTop: '1.25rem', textAlign: 'right', paddingTop: '1rem', borderTop: '1px solid var(--border-color, #e2e8f0)' }}>
              <button 
                onClick={() => setSelectedKit(null)} 
                style={{ 
                  padding: '0.65rem 1.5rem', 
                  background: 'var(--button-cancel-bg, #94a3b8)', 
                  color: 'white', 
                  border: 'none', 
                  borderRadius: '8px', 
                  fontWeight: 'bold', 
                  cursor: 'pointer' 
                }}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
