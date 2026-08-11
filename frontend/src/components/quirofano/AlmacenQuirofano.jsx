import React, { useState, useEffect, useMemo } from 'react';
import { API_BASE } from '../../api/config';
import { authHeaders } from '../../api/auth';

export default function AlmacenQuirofano() {
  const [subTab, setSubTab] = useState('inventory'); // 'inventory', 'salidas', 'devoluciones'
  
  // Stock State
  const [stockItems, setStockItems] = useState([]);
  const [stockStats, setStockStats] = useState({ totalItems: 0, totalStock: 0, totalValue: 0, qxcrCount: 0 });
  const [loadingStock, setLoadingStock] = useState(true);
  
  // Movements State
  const [movements, setMovements] = useState([]);
  const [movementStats, setMovementStats] = useState({ totalMovimientos: 0, totalSalidas: 0, totalDevoluciones: 0, piezasSalidas: 0, piezasDevueltas: 0 });
  const [loadingMovements, setLoadingMovements] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('ALL'); // 'ALL', 'QX', 'QXCR'
  const [daysFilter, setDaysFilter] = useState(30);

  useEffect(() => {
    fetchStock();
  }, []);

  useEffect(() => {
    if (subTab === 'salidas' || subTab === 'devoluciones') {
      fetchMovements();
    }
  }, [subTab, daysFilter]);

  const fetchStock = async () => {
    setLoadingStock(true);
    try {
      const res = await fetch(`${API_BASE}/pharmacy/quirofano-inventory`, { headers: authHeaders() });
      const json = await res.json();
      if (json.ok) {
        setStockItems(json.data || []);
        setStockStats(json.stats || {});
      }
    } catch (err) {
      console.error('Error cargando inventario QX:', err);
    } finally {
      setLoadingStock(false);
    }
  };

  const fetchMovements = async () => {
    setLoadingMovements(true);
    try {
      const typeParam = subTab === 'salidas' ? 'salidas' : subTab === 'devoluciones' ? 'devoluciones' : 'all';
      const res = await fetch(`${API_BASE}/pharmacy/quirofano-movements?type=${typeParam}&days=${daysFilter}`, { headers: authHeaders() });
      const json = await res.json();
      if (json.ok) {
        setMovements(json.data || []);
        setMovementStats(json.stats || {});
      }
    } catch (err) {
      console.error('Error cargando movimientos QX:', err);
    } finally {
      setLoadingMovements(false);
    }
  };

  // Filtered Stock List
  const filteredStock = useMemo(() => {
    return stockItems.filter(item => {
      const matchSearch = (item.ItemCode || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (item.ItemName || '').toLowerCase().includes(searchQuery.toLowerCase());
      const matchWhs = warehouseFilter === 'ALL' || item.WhsCode === warehouseFilter;
      return matchSearch && matchWhs;
    });
  }, [stockItems, searchQuery, warehouseFilter]);

  // Filtered Movements List
  const filteredMovements = useMemo(() => {
    return movements.filter(m => {
      const matchSearch = (m.Codigo || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (m.Medicamento || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (m.Paciente || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (m.Procedimiento || '').toLowerCase().includes(searchQuery.toLowerCase());
      const matchWhs = warehouseFilter === 'ALL' || m.Almacen === warehouseFilter;
      return matchSearch && matchWhs;
    });
  }, [movements, searchQuery, warehouseFilter]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Banner de bienvenida e indicador del Almacén Quirófano */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(30,41,59,0.8), rgba(15,23,42,0.9))',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '16px',
        padding: '1.5rem',
        backdropFilter: 'blur(10px)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700, color: 'white', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>🏥</span> Almacén Quirófano (QX / QXCR)
          </h2>
          <p style={{ margin: '0.35rem 0 0 0', color: '#94a3b8', fontSize: '0.9rem' }}>
            Gestión en tiempo real de insumos en stock, cargos a cirugías y registro de devoluciones/retornos.
          </p>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={() => subTab === 'inventory' ? fetchStock() : fetchMovements()}
            style={{
              padding: '0.6rem 1rem',
              background: '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem'
            }}
          >
            🔄 Actualizar Datos
          </button>
        </div>
      </div>

      {/* Tarjetas resumen de estadísticas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
        <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '1.25rem' }}>
          <div style={{ fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Artículos en Stock</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#38bdf8', marginTop: '0.25rem' }}>
            {stockStats.totalItems || 0}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>Con existencia disponible en QX/QXCR</div>
        </div>

        <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '1.25rem' }}>
          <div style={{ fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Piezas Físicas</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#4ade80', marginTop: '0.25rem' }}>
            {(stockStats.totalStock || 0).toLocaleString()}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>Insumos físicos en anaqueles</div>
        </div>

        <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '1.25rem' }}>
          <div style={{ fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Valor Estimado Stock</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#facc15', marginTop: '0.25rem' }}>
            ${(stockStats.totalValue || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>Valuación a precio de catálogo</div>
        </div>

        <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '1.25rem' }}>
          <div style={{ fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Quirófano Controlados</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#f43f5e', marginTop: '0.25rem' }}>
            {stockStats.qxcrCount || 0} artículos
          </div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>Almacén QXCR (Medicamentos controlados)</div>
        </div>
      </div>

      {/* Pestañas secundarias de navegación interna de Almacén QX */}
      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', paddingBottom: '0.5rem' }}>
        <button
          onClick={() => setSubTab('inventory')}
          style={{
            padding: '0.6rem 1.2rem',
            background: subTab === 'inventory' ? '#3b82f6' : 'rgba(30,41,59,0.5)',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontWeight: subTab === 'inventory' ? 'bold' : 'normal',
            cursor: 'pointer',
            fontSize: '0.9rem',
            transition: 'all 0.2s ease'
          }}
        >
          📦 Stock Actual ({filteredStock.length})
        </button>

        <button
          onClick={() => setSubTab('salidas')}
          style={{
            padding: '0.6rem 1.2rem',
            background: subTab === 'salidas' ? '#10b981' : 'rgba(30,41,59,0.5)',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontWeight: subTab === 'salidas' ? 'bold' : 'normal',
            cursor: 'pointer',
            fontSize: '0.9rem',
            transition: 'all 0.2s ease'
          }}
        >
          📤 Salidas a Pacientes
        </button>

        <button
          onClick={() => setSubTab('devoluciones')}
          style={{
            padding: '0.6rem 1.2rem',
            background: subTab === 'devoluciones' ? '#f43f5e' : 'rgba(30,41,59,0.5)',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontWeight: subTab === 'devoluciones' ? 'bold' : 'normal',
            cursor: 'pointer',
            fontSize: '0.9rem',
            transition: 'all 0.2s ease'
          }}
        >
          🔄 Devoluciones y Retornos QX
        </button>
      </div>

      {/* Barra de Filtros y Búsqueda */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', background: 'rgba(15, 23, 42, 0.4)', padding: '1rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ flex: 1, minWidth: '240px' }}>
          <input
            type="text"
            placeholder="🔍 Buscar por código, medicamento, paciente o procedimiento..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '0.65rem 1rem',
              background: 'rgba(30, 41, 59, 0.8)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '8px',
              color: 'white',
              fontSize: '0.9rem',
              outline: 'none'
            }}
          />
        </div>

        <div>
          <select
            value={warehouseFilter}
            onChange={(e) => setWarehouseFilter(e.target.value)}
            style={{
              padding: '0.65rem 1rem',
              background: 'rgba(30, 41, 59, 0.8)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '8px',
              color: 'white',
              fontSize: '0.9rem',
              outline: 'none'
            }}
          >
            <option value="ALL">🏢 Todos los almacenes QX</option>
            <option value="QX">QX — Quirófano General</option>
            <option value="QXCR">QXCR — Quirófano Controlados</option>
          </select>
        </div>

        {(subTab === 'salidas' || subTab === 'devoluciones') && (
          <div>
            <select
              value={daysFilter}
              onChange={(e) => setDaysFilter(Number(e.target.value))}
              style={{
                padding: '0.65rem 1rem',
                background: 'rgba(30, 41, 59, 0.8)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '8px',
                color: 'white',
                fontSize: '0.9rem',
                outline: 'none'
              }}
            >
              <option value={7}>📅 Últimos 7 días</option>
              <option value={30}>📅 Últimos 30 días</option>
              <option value={90}>📅 Últimos 90 días</option>
            </select>
          </div>
        )}
      </div>

      {/* VISTA 1: STOCK ACTUAL */}
      {subTab === 'inventory' && (
        <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', overflow: 'hidden' }}>
          {loadingStock ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>Cargando existencias en Almacén Quirófano…</div>
          ) : filteredStock.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>No se encontraron artículos con el filtro seleccionado.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', color: 'white', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ background: 'rgba(30, 41, 59, 0.8)', textAlign: 'left', borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
                    <th style={{ padding: '0.85rem 1rem' }}>Código</th>
                    <th style={{ padding: '0.85rem 1rem' }}>Descripción / Insumo</th>
                    <th style={{ padding: '0.85rem 1rem' }}>Almacén</th>
                    <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>Stock Físico</th>
                    <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>Precio Unit.</th>
                    <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>Valor Total ($)</th>
                    <th style={{ padding: '0.85rem 1rem' }}>Grupo SAP</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStock.map((item, idx) => (
                    <tr key={`${item.ItemCode}-${item.WhsCode}-${idx}`} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)', background: idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.02)' }}>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#38bdf8' }}>{item.ItemCode}</td>
                      <td style={{ padding: '0.75rem 1rem' }}>{item.ItemName}</td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <span style={{
                          padding: '0.2rem 0.6rem',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: 'bold',
                          background: item.WhsCode === 'QXCR' ? 'rgba(244, 63, 94, 0.2)' : 'rgba(59, 130, 246, 0.2)',
                          color: item.WhsCode === 'QXCR' ? '#f43f5e' : '#60a5fa'
                        }}>
                          {item.WhsCode === 'QXCR' ? 'QXCR (Controlados)' : 'QX (General)'}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 'bold', color: item.QuantityOnStock > 5 ? '#4ade80' : '#facc15' }}>
                        {item.QuantityOnStock}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                        ${(item.SalesPrice || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 'bold' }}>
                        ${((item.QuantityOnStock || 0) * (item.SalesPrice || 0)).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', color: '#94a3b8', fontSize: '0.8rem' }}>
                        {item.ItemGroupName || 'General'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* VISTA 2 y 3: SALIDAS Y DEVOLUCIONES */}
      {(subTab === 'salidas' || subTab === 'devoluciones') && (
        <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', overflow: 'hidden' }}>
          {loadingMovements ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>Cargando historial de movimientos de Quirófano…</div>
          ) : filteredMovements.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>No hay registros de movimientos en el periodo seleccionado.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', color: 'white', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: 'rgba(30, 41, 59, 0.8)', textAlign: 'left', borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
                    <th style={{ padding: '0.85rem 1rem' }}>Fecha</th>
                    <th style={{ padding: '0.85rem 1rem' }}>Folio Quirófano</th>
                    <th style={{ padding: '0.85rem 1rem' }}>Paciente</th>
                    <th style={{ padding: '0.85rem 1rem' }}>Procedimiento</th>
                    <th style={{ padding: '0.85rem 1rem' }}>Médico / Equipo</th>
                    <th style={{ padding: '0.85rem 1rem' }}>Insumo</th>
                    <th style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>Tipo</th>
                    <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>Cantidad</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMovements.map((m, idx) => (
                    <tr key={`${m.PCNum}-${m.Codigo}-${idx}`} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)', background: idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.02)' }}>
                      <td style={{ padding: '0.75rem 1rem', color: '#94a3b8', whiteSpace: 'nowrap' }}>
                        {new Date(m.Fecha).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#38bdf8' }}>
                        Folio #{m.PCFRNum || m.PCNum}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>{m.Paciente}</td>
                      <td style={{ padding: '0.75rem 1rem', color: '#e2e8f0' }}>{m.Procedimiento}</td>
                      <td style={{ padding: '0.75rem 1rem', color: '#94a3b8', fontSize: '0.8rem' }}>{m.Medicos}</td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <span style={{ fontWeight: 600 }}>{m.Codigo}</span> — {m.Medicamento}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                        <span style={{
                          padding: '0.25rem 0.6rem',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: 'bold',
                          background: m.Cantidad < 0 ? 'rgba(244, 63, 94, 0.25)' : 'rgba(16, 185, 129, 0.25)',
                          color: m.Cantidad < 0 ? '#f43f5e' : '#34d399'
                        }}>
                          {m.Cantidad < 0 ? '🔄 DEVOLUCIÓN' : '📤 SALIDA CARGO'}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 800, fontSize: '1rem', color: m.Cantidad < 0 ? '#f43f5e' : '#34d399' }}>
                        {m.Cantidad > 0 ? `+${m.Cantidad}` : m.Cantidad}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
