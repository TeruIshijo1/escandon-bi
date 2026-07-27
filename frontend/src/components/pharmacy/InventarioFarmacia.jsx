import React, { useState, useEffect, useMemo } from 'react';

export default function InventarioFarmacia() {
  const [items, setItems] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState('FAR');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchWarehouses();
  }, []);

  useEffect(() => {
    if (selectedWarehouse) {
      fetchInventory();
    }
  }, [selectedWarehouse]);

  const fetchWarehouses = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('http://localhost:4000/api/sap/warehouses', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const json = await response.json();
      if (response.ok && json.success) {
        setWarehouses(json.data);
        // Intentar autoseleccionar FAR si existe
        if (!json.data.find(w => w.WarehouseCode === 'FAR')) {
          if (json.data.length > 0) setSelectedWarehouse(json.data[0].WarehouseCode);
        }
      }
    } catch (err) {
      console.error('Error fetching warehouses', err);
    }
  };

  const fetchInventory = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const token = localStorage.getItem('token');
      // Llamada al backend protegido, el cual gestionará de forma invisible la sesión de SAP
      const response = await fetch(`http://localhost:4000/api/pharmacy/inventario?warehouse=${selectedWarehouse}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      const json = await response.json();
      
      if (!response.ok || !json.ok) {
        throw new Error(json.error || 'Error al obtener inventario desde SAP');
      }
      
      setItems(json.data || []);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Filtrado local
  const filteredItems = useMemo(() => {
    return items.filter(item => 
      item.ItemCode?.toLowerCase().includes(searchTerm.toLowerCase()) || 
      item.ItemName?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [items, searchTerm]);

  // KPIs
  const totalItems = items.length;
  const totalValue = items.reduce((acc, curr) => acc + ((curr.QuantityOnStock || 0) * (curr.MovingAveragePrice || 0)), 0);
  const lowStockCount = items.filter(item => item.QuantityOnStock < 10).length; // Umbral de ejemplo

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <header style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '2rem', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '2.5rem' }}>📦</span> Inventario en Vivo (SAP)
          </h1>
          <p style={{ margin: '0.5rem 0 0 0', color: '#64748b', fontSize: '1.1rem' }}>
            Extrayendo datos operativos directamente desde Service Layer (Solo Lectura)
          </p>
        </div>
        <button 
          onClick={fetchInventory}
          disabled={loading}
          style={{
            padding: '0.75rem 1.5rem',
            background: '#0284c7',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontWeight: '600',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1,
            transition: 'background 0.2s'
          }}
        >
          {loading ? 'Sincronizando...' : '↻ Refrescar SAP'}
        </button>
      </header>

      {error && (
        <div style={{ padding: '1rem', background: '#fef2f2', borderLeft: '4px solid #ef4444', color: '#991b1b', marginBottom: '2rem', borderRadius: '4px' }}>
          <strong>Error de Conexión: </strong> {error}
        </div>
      )}

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        
        {/* Card 1 */}
        <div style={{ background: 'white', padding: '1.5rem', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)', border: '1px solid #e2e8f0', borderTop: '4px solid #3b82f6' }}>
          <h3 style={{ margin: '0 0 0.5rem 0', color: '#64748b', fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Catálogo Activo (Top 500)
          </h3>
          <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#0f172a' }}>
            {loading ? '...' : totalItems.toLocaleString()} <span style={{ fontSize: '1rem', color: '#94a3b8', fontWeight: 'normal' }}>SKUs</span>
          </div>
        </div>

        {/* Card 2 */}
        <div style={{ background: 'white', padding: '1.5rem', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)', border: '1px solid #e2e8f0', borderTop: '4px solid #10b981' }}>
          <h3 style={{ margin: '0 0 0.5rem 0', color: '#64748b', fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Valor Total de Inventario
          </h3>
          <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#0f172a' }}>
            {loading ? '...' : `$${totalValue.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </div>
        </div>

        {/* Card 3 */}
        <div style={{ background: 'white', padding: '1.5rem', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)', border: '1px solid #e2e8f0', borderTop: '4px solid #f59e0b' }}>
          <h3 style={{ margin: '0 0 0.5rem 0', color: '#64748b', fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Artículos Bajo Stock
          </h3>
          <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#0f172a', display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
            {loading ? '...' : lowStockCount}
            <span style={{ fontSize: '1rem', color: '#f59e0b', fontWeight: '500' }}>⚠️ Requieren atención</span>
          </div>
        </div>

      </div>

      {/* Main Table Area */}
      <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        
        {/* Toolbar */}
        <div style={{ padding: '1.25rem', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <select 
            value={selectedWarehouse}
            onChange={(e) => setSelectedWarehouse(e.target.value)}
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              background: 'white',
              fontSize: '0.95rem',
              minWidth: '250px',
              fontWeight: '600',
              color: '#0f172a',
              cursor: 'pointer'
            }}
          >
            {warehouses.map(w => (
              <option key={w.WarehouseCode} value={w.WarehouseCode}>
                [{w.WarehouseCode}] {w.WarehouseName}
              </option>
            ))}
            {warehouses.length === 0 && <option value="FAR">[FAR] Farmacia</option>}
          </select>

          <input 
            type="text" 
            placeholder="🔍 Buscar por Código o Nombre..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              width: '100%',
              maxWidth: '400px',
              fontSize: '0.95rem'
            }}
          />
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: '#f1f5f9', color: '#334155', fontSize: '0.875rem', letterSpacing: '0.025em', textTransform: 'uppercase' }}>
                <th style={{ padding: '1rem 1.25rem', borderBottom: '2px solid #e2e8f0' }}>ItemCode</th>
                <th style={{ padding: '1rem 1.25rem', borderBottom: '2px solid #e2e8f0' }}>Descripción SAP</th>
                <th style={{ padding: '1rem 1.25rem', borderBottom: '2px solid #e2e8f0', textAlign: 'right' }}>Stock Actual</th>
                <th style={{ padding: '1rem 1.25rem', borderBottom: '2px solid #e2e8f0', textAlign: 'right' }}>Costo Prom.</th>
                <th style={{ padding: '1rem 1.25rem', borderBottom: '2px solid #e2e8f0', textAlign: 'center' }}>Estatus</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="5" style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                      <div className="spinner" style={{ border: '4px solid #f3f3f3', borderTop: '4px solid #3b82f6', borderRadius: '50%', width: '40px', height: '40px', animation: 'spin 1s linear infinite' }}></div>
                      Conectando con SAP Service Layer...
                    </div>
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan="5" style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
                    No se encontraron artículos que coincidan con la búsqueda.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item, idx) => {
                  const stock = item.QuantityOnStock || 0;
                  const price = item.MovingAveragePrice || 0;
                  const isLow = stock < 10;

                  return (
                    <tr key={item.ItemCode || idx} style={{ borderBottom: '1px solid #e2e8f0', transition: 'background 0.2s', ':hover': { background: '#f8fafc' } }}>
                      <td style={{ padding: '1rem 1.25rem', color: '#0f172a', fontWeight: '500' }}>{item.ItemCode}</td>
                      <td style={{ padding: '1rem 1.25rem', color: '#334155' }}>{item.ItemName}</td>
                      <td style={{ padding: '1rem 1.25rem', color: isLow ? '#dc2626' : '#0f172a', textAlign: 'right', fontWeight: isLow ? 'bold' : 'normal' }}>
                        {stock.toLocaleString()}
                      </td>
                      <td style={{ padding: '1rem 1.25rem', color: '#334155', textAlign: 'right' }}>
                        ${price.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '1rem 1.25rem', textAlign: 'center' }}>
                        {isLow ? (
                          <span style={{ padding: '0.25rem 0.75rem', background: '#fef2f2', color: '#dc2626', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 'bold' }}>BAJO</span>
                        ) : (
                          <span style={{ padding: '0.25rem 0.75rem', background: '#ecfdf5', color: '#059669', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 'bold' }}>OK</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      
      {/* Estilos inline para la animación del spinner */}
      <style>{`
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        tbody tr:hover { background-color: #f8fafc; }
      `}</style>
    </div>
  );
}
