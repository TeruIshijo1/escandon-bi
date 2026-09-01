import React, { useState, useEffect, useMemo } from 'react';
import { API_BASE } from '../../api/config';
import { authHeaders } from '../../api/auth';
import ControlledLedger from './ControlledLedger';
import PendingMonitor from './PendingMonitor';
import PatientHistory from './PatientHistory';
import SurgicalKits from './SurgicalKits';
import useEscapeKey from '../../hooks/useEscapeKey';

export default function InventarioFarmacia() {
  const [activeTab, setActiveTab] = useState('inventory');
  const [items, setItems] = useState([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState('FAR');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const [selectedItemBatches, setSelectedItemBatches] = useState(null);
  const [batches, setBatches] = useState([]);
  const [loadingBatches, setLoadingBatches] = useState(false);

  // Estados para Modal de Historial de Lotes
  const [selectedItemHistory, setSelectedItemHistory] = useState(null);
  const [historyData, setHistoryData] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historySearchTerm, setHistorySearchTerm] = useState('');

  // Estados para Modal de Reabastecimiento
  const [showReplenishmentModal, setShowReplenishmentModal] = useState(false);

  // Estados para Modal de Ubicaciones
  const [selectedItemLocations, setSelectedItemLocations] = useState(null);
  const [locations, setLocations] = useState([]);
  const [loadingLocations, setLoadingLocations] = useState(false);

  useEscapeKey(() => setSelectedItemBatches(null), !!selectedItemBatches);
  useEscapeKey(() => setSelectedItemHistory(null), !!selectedItemHistory);
  useEscapeKey(() => setShowReplenishmentModal(false), showReplenishmentModal);
  useEscapeKey(() => setSelectedItemLocations(null), !!selectedItemLocations);

  useEffect(() => {
    fetchInventory();
  }, [selectedWarehouse]);


  const fetchInventory = async (isRefresh = false) => {
    try {
      setLoading(true);
      setError(null);
      
      const url = isRefresh
        ? `${API_BASE}/pharmacy/inventario?warehouse=${selectedWarehouse}&refresh=true`
        : `${API_BASE}/pharmacy/inventario?warehouse=${selectedWarehouse}`;

      // Llamada al backend protegido, el cual gestionará de forma invisible la sesión de SAP
      const response = await fetch(url, {
        headers: authHeaders()
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

  const fetchBatches = async (item) => {
    try {
      setSelectedItemBatches(item);
      setLoadingBatches(true);
      const warehouse = item.WhsCode || selectedWarehouse;
      const response = await fetch(`${API_BASE}/pharmacy/lotes?itemCode=${encodeURIComponent(item.ItemCode)}&warehouse=${warehouse}`, {
        headers: authHeaders()
      });
      const json = await response.json();
      if (response.ok && json.ok) {
        setBatches(json.data || []);
      } else {
        alert('Error al cargar lotes: ' + json.error);
      }
    } catch (err) {
      console.error(err);
      alert('Error de conexión al cargar lotes');
    } finally {
      setLoadingBatches(false);
    }
  };

  const fetchHistory = async (item) => {
    try {
      setSelectedItemHistory(item);
      setLoadingHistory(true);
      setHistorySearchTerm(''); // reset search
      const response = await fetch(`${API_BASE}/pharmacy/historial-lotes?itemCode=${encodeURIComponent(item.ItemCode)}`, {
        headers: authHeaders()
      });
      const json = await response.json();
      if (response.ok && json.ok) {
        setHistoryData(json.data || []);
      } else {
        alert('Error al cargar historial: ' + (json.error || 'Revise que la vista exista en SAP.'));
      }
    } catch (err) {
      console.error(err);
      alert('Error de conexión al cargar el historial');
    } finally {
      setLoadingHistory(false);
    }
  };

  const fetchLocations = async (item) => {
    try {
      setSelectedItemLocations(item);
      setLoadingLocations(true);
      const response = await fetch(`${API_BASE}/pharmacy/ubicaciones?itemCode=${encodeURIComponent(item.ItemCode)}`, {
        headers: authHeaders()
      });
      const json = await response.json();
      if (response.ok && json.ok) {
        setLocations(json.data || []);
      } else {
        alert('Error al cargar ubicaciones: ' + json.error);
      }
    } catch (err) {
      console.error(err);
      alert('Error de conexión al cargar ubicaciones');
    } finally {
      setLoadingLocations(false);
    }
  };

  // Filtrado local
  const filteredItems = useMemo(() => {
    if (!searchTerm) return items;
    
    const term = String(searchTerm).toLowerCase().trim();
    if (term === '') return items;

    return items.filter(item => {
      const code = String(item.ItemCode || '').toLowerCase();
      const name = String(item.ItemName || '').toLowerCase();
      const group = String(item.ItemGroupName || '').toLowerCase();
      const mfg = String(item.ManufacturerName || '').toLowerCase();
      const medClass = String(item.MedicalClassification || '').toLowerCase();
      const secClass = String(item.SecondaryClassification || '').toLowerCase();
      return code.includes(term) || name.includes(term) || group.includes(term) || mfg.includes(term) || medClass.includes(term) || secClass.includes(term);
    });
  }, [items, searchTerm]);

  // Helper de clasificación médica SAP
  const getMedClassificationBadge = (item) => {
    const c1 = (item.MedicalClassification || '').toUpperCase().trim();
    const c2 = (item.SecondaryClassification || '').toUpperCase().trim();
    
    if (c1 === 'CON' || c2 === 'CON') {
      return { text: '💊 CONTROLADO', bg: '#F5F3FF', color: '#7C3AED', border: '#DDD6FE' };
    }
    if (c1 === 'ANTI' || c2 === 'ANTI') {
      return { text: '💉 ANTIBIÓTICO', bg: '#EFF6FF', color: '#2563EB', border: '#BFDBFE' };
    }
    if (c1 === 'REFRI' || c2 === 'REFRI') {
      return { text: '❄️ RED FRÍA', bg: '#E0F2FE', color: '#0284C7', border: '#BAE6FD' };
    }
    if (c1 === 'AR' || c2 === 'AR') {
      return { text: '⚠️ ALTO RIESGO', bg: '#FEE2E2', color: '#DC2626', border: '#FECACA' };
    }
    if (c1 === 'LASA' || c2 === 'LASA') {
      return { text: '🏷️ LASA', bg: '#FFF7ED', color: '#EA580C', border: '#FED7AA' };
    }
    if (c1 && c1 !== 'GENERAL' && c1 !== 'NULL' && c1 !== 'N/A') {
      return { text: c1, bg: '#F1F5F9', color: '#475569', border: '#CBD5E1' };
    }
    return { text: '📦 GENERAL', bg: '#F8FAFC', color: '#64748B', border: '#E2E8F0' };
  };

  // KPIs y Reabastecimiento
  const totalItems = items.length;
  const totalValue = items.reduce((acc, curr) => acc + ((curr.QuantityOnStock || 0) * (curr.PurchaseCost || 0)), 0);
  const lowStockThreshold = 10;
  const lowStockItems = useMemo(() => items.filter(item => item.QuantityOnStock < lowStockThreshold), [items]);
  const lowStockCount = lowStockItems.length;
  const warehouseLabels = {
    FAR: '[FAR] Farmacia',
    QX: '[QX] Quirófano',
    QXCR: '[QXCR] Carro Rojo',
    FAR_QX: 'Farmacia + Quirófano + Carro Rojo',
    ALL: 'Todos los almacenes'
  };

  // Helper de formateo numérico: stock sin decimales, precios/costos con 4 decimales de SAP
  const formatStock = (val) => Number(val || 0).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const formatCurrency = (val) => `$${(Number(val) || 0).toLocaleString('es-MX', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
  const formatUtility = (val) => `$${(Number(val) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const exportFilteredInventoryToExcel = () => {
    if (filteredItems.length === 0) return;
    
    const fechaReporte = new Date().toLocaleString('es-MX');
    const warehouseName = warehouseLabels[selectedWarehouse] || selectedWarehouse;
    const cols = [
      { header: 'Código SAP', key: 'ItemCode', width: 110, align: 'left' },
      { header: 'Descripción SAP', key: 'ItemName', width: 320, align: 'left' },
      { header: 'Almacén', key: 'WarehouseName', width: 110, align: 'center' },
      { header: 'Grupo', key: 'ItemGroupName', width: 150, align: 'left' },
      { header: 'Laboratorio / Tipo', key: 'ManufacturerName', width: 150, align: 'left' },
      { header: 'Clasificación SAP', key: 'MedicalClassification', width: 140, align: 'center' },
      { header: 'Stock Actual', key: 'QuantityOnStock', width: 120, align: 'right' },
      { header: 'Costo Unitario ($)', key: 'PurchaseCost', width: 130, align: 'right' },
      { header: 'Precio PG ($)', key: 'PricePG', width: 130, align: 'right' },
      { header: 'Precio Hos ($)', key: 'PriceHos', width: 130, align: 'right' },
      { header: 'Margen PG (%)', key: 'ProfitMargin', width: 120, align: 'right' },
      { header: 'Utilidad Esperada ($)', key: 'ExpectedUtility', width: 140, align: 'right' },
      { header: 'Estatus', key: 'Estatus', width: 100, align: 'center' }
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
  .critico{color:#dc2626;font-weight:bold;}
  .ok{color:#059669;font-weight:bold;}
</style></head><body>
<table>
  <tr><td colspan="${cols.length}" class="title-bar">HOSPITAL ESCANDÓN - PLATAFORMA BI</td></tr>
  <tr><td colspan="${cols.length}" class="subtitle-bar">Reporte: Inventario de Farmacia (SAP) &nbsp;|&nbsp; Almacén: ${warehouseName}</td></tr>
  <tr class="info-row"><td colspan="${cols.length}">Fecha de exportación: ${fechaReporte} &nbsp;|&nbsp; Registros filtrados: ${filteredItems.length} ${searchTerm ? `&nbsp;|&nbsp; Filtro búsqueda: "${searchTerm}"` : ''}</td></tr>
  <tr><td colspan="${cols.length}" style="height:6px;border:none"></td></tr>
  <tr>${cols.map(c => `<th style="width:${c.width}px">${c.header}</th>`).join('')}</tr>
  ${filteredItems.map((row, i) => {
    const cost = Number(row.PurchaseCost || 0);
    const pricePG = Number(row.PricePG != null ? row.PricePG : (row.SalesPrice || 0));
    const priceHos = Number(row.PriceHos || 0);
    const stock = Number(row.QuantityOnStock || 0);
    const margin = pricePG > 0 ? (((pricePG - cost) / pricePG) * 100).toFixed(1) + '%' : '0.0%';
    const isLow = stock < 10;
    
    return `<tr class="${i % 2 === 0 ? 'even' : 'odd'}">${cols.map(c => {
      let val = row[c.key];
      if (c.key === 'WarehouseName') val = row.WarehouseName || row.WhsCode || '';
      if (c.key === 'QuantityOnStock') val = stock.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
      if (c.key === 'PurchaseCost') val = `$${cost.toLocaleString('es-MX', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
      if (c.key === 'PricePG') val = `$${pricePG.toLocaleString('es-MX', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
      if (c.key === 'PriceHos') val = `$${priceHos.toLocaleString('es-MX', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
      if (c.key === 'ProfitMargin') val = margin;
      if (c.key === 'ExpectedUtility') val = `$${((pricePG - cost) * stock).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      if (c.key === 'Estatus') val = isLow ? 'BAJO' : 'OK';
      if (val == null) val = '';
      let cls = '';
      if (c.key === 'Estatus' && isLow) cls = ' class="critico"';
      if (c.key === 'Estatus' && !isLow) cls = ' class="ok"';
      if (c.key === 'QuantityOnStock' && isLow) cls = ' class="critico"';
      return `<td${cls} style="text-align:${c.align || 'left'}">${String(val).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>`;
    }).join('')}</tr>`;
  }).join('')}
</table></body></html>`;

    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Inventario_Farmacia_SAP_${selectedWarehouse}_${new Date().toISOString().slice(0,10)}.xls`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportToExcel = () => {
    if (lowStockItems.length === 0) return;
    
    const fechaReporte = new Date().toLocaleString('es-MX');
    const cols = [
      { header: 'ItemCode', key: 'ItemCode', width: 100 },
      { header: 'Descripción', key: 'ItemName', width: 300 },
      { header: 'Clasificación SAP', key: 'MedicalClassification', width: 130 },
      { header: 'Stock Actual', key: 'QuantityOnStock', width: 110, align: 'right' },
      { header: 'Costo Unitario ($)', key: 'PurchaseCost', width: 120, align: 'right' },
      { header: 'Precio PG ($)', key: 'PricePG', width: 120, align: 'right' },
      { header: 'Precio Hos ($)', key: 'PriceHos', width: 120, align: 'right' }
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
  .critico{color:#dc2626;font-weight:bold;}
</style></head><body>
<table>
  <tr><td colspan="${cols.length}" class="title-bar">HOSPITAL ESCANDÓN - PLATAFORMA BI</td></tr>
  <tr><td colspan="${cols.length}" class="subtitle-bar">Reporte: Sugerencias de Reabastecimiento - Farmacia</td></tr>
  <tr class="info-row"><td colspan="${cols.length}">Fecha de exportación: ${fechaReporte} &nbsp;|&nbsp; Artículos Críticos: ${lowStockItems.length}</td></tr>
  <tr><td colspan="${cols.length}" style="height:6px;border:none"></td></tr>
  <tr>${cols.map(c => `<th style="width:${c.width}px">${c.header}</th>`).join('')}</tr>
  ${lowStockItems.map((row, i) => {
    const cost = Number(row.PurchaseCost || 0);
    const pricePG = Number(row.PricePG != null ? row.PricePG : (row.SalesPrice || 0));
    const priceHos = Number(row.PriceHos || 0);
    const stock = Number(row.QuantityOnStock || 0);
    return `<tr class="${i % 2 === 0 ? 'even' : 'odd'}">${cols.map(c => {
      let val = row[c.key];
      if (c.key === 'QuantityOnStock') val = stock.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
      if (c.key === 'PurchaseCost') val = `$${cost.toFixed(4)}`;
      if (c.key === 'PricePG') val = `$${pricePG.toFixed(4)}`;
      if (c.key === 'PriceHos') val = `$${priceHos.toFixed(4)}`;
      if (val == null) val = '';
      let cls = (c.key === 'QuantityOnStock' && stock < 5) ? ' class="critico"' : '';
      return `<td${cls} style="text-align:${c.align || 'left'}">${String(val).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>`;
    }).join('')}</tr>`;
  }).join('')}
</table></body></html>`;

    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Reabastecimiento_Farmacia_${new Date().toISOString().slice(0,10)}.xls`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const tabs = [
    { id: 'inventory', label: '📦 Inventario (SAP)' },
    { id: 'pending', label: '🛎️ Recetas Pendientes' },
    { id: 'ledger', label: '📤 Salidas Farmacia' },
    { id: 'history', label: '🩺 Historial de Pacientes' }
  ];

  return (
    <div style={{ padding: '2rem', maxWidth: 'var(--content-max, 1400px)', margin: '0 auto', fontFamily: 'Inter, sans-serif' }}>
      
      {/* Tabs de Navegación */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem', borderBottom: '2px solid #e2e8f0', paddingBottom: '0.5rem', overflowX: 'auto' }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '0.75rem 1.25rem',
              background: activeTab === tab.id ? '#3b82f6' : 'transparent',
              color: activeTab === tab.id ? 'white' : '#64748b',
              border: 'none',
              borderRadius: '8px',
              fontWeight: activeTab === tab.id ? 'bold' : '500',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.2s'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'inventory' && (
      <>
      <header style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '2rem', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '2.5rem' }}>📦</span> Inventario Farmacia <span style={{ fontSize: '1.25rem', color: '#64748b', fontWeight: 'normal', marginTop: '0.5rem' }}>(SAP)</span>
          </h1>
        </div>
        <button 
          onClick={() => fetchInventory(true)}
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        
        {/* Catálogo Activo */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: '0.875rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 'bold' }}>Catálogo Activo (Top 500)</div>
          <div style={{ fontSize: '2.25rem', fontWeight: 'bold', color: '#0f172a', marginTop: '0.5rem', display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
            {totalItems} <span style={{ fontSize: '1rem', color: '#64748b', fontWeight: 'normal' }}>SKUs</span>
          </div>
        </div>

        {/* Valor Total Inventario */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: '0.875rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 'bold' }}>Valor Total de Inventario</div>
          <div style={{ fontSize: '2.25rem', fontWeight: 'bold', color: '#0f172a', marginTop: '0.5rem' }}>
            {loading ? '...' : `$${totalValue.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </div>
        </div>

        {/* Artículos Bajo Stock */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', cursor: 'pointer' }} onClick={() => setShowReplenishmentModal(true)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: '0.875rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 'bold' }}>Artículos Bajo Stock</div>
            {lowStockCount > 0 && (
              <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#d97706', textDecoration: 'underline' }}>
                Ver sugerencias →
              </span>
            )}
          </div>
          <div style={{ fontSize: '2.25rem', fontWeight: 'bold', color: '#0f172a', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {lowStockCount}
            {lowStockCount > 0 && (
              <span style={{ fontSize: '0.875rem', color: '#d97706', background: '#fef3c7', padding: '0.2rem 0.6rem', borderRadius: '9999px', fontWeight: 'bold' }}>
                ⚠️ Requieren atención
              </span>
            )}
          </div>
        </div>

      </div>

      {/* Main Table Card */}
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
        
        {/* Search & Actions Header */}
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', background: '#f8fafc' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: 1, minWidth: '300px' }}>
            <span style={{ fontWeight: 'bold', color: '#0f172a', fontSize: '1.1rem' }}>
              {warehouseLabels[selectedWarehouse] || selectedWarehouse}
            </span>
            <select
              value={selectedWarehouse}
              onChange={(e) => {
                setSelectedWarehouse(e.target.value);
                setSearchTerm('');
                setSearchInput('');
              }}
              style={{
                padding: '0.6rem 0.8rem',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                fontSize: '0.9rem',
                background: '#ffffff',
                color: '#0f172a',
                minWidth: '230px'
              }}
            >
              <option value="FAR">Farmacia (FAR)</option>
              <option value="QX">Quirófano (QX)</option>
              <option value="QXCR">Carro Rojo (QXCR)</option>
              <option value="FAR_QX">FAR + QX + QXCR</option>
              <option value="ALL">Todos los almacenes</option>
            </select>
            <div style={{ position: 'relative', flex: 1, maxWidth: '450px' }}>
              <input
                type="text"
                placeholder="Buscar por código, descripción, grupo o clasificación..."
                value={searchInput}
                onChange={(e) => {
                  setSearchInput(e.target.value);
                  setSearchTerm(e.target.value);
                }}
                style={{
                  width: '100%',
                  padding: '0.6rem 2rem 0.6rem 1rem',
                  border: '1px solid #cbd5e1',
                  borderRadius: '8px',
                  fontSize: '0.9rem',
                  outline: 'none'
                }}
              />
              {searchInput && (
                <button
                  onClick={() => {
                    setSearchInput('');
                    setSearchTerm('');
                  }}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: '#e2e8f0',
                    border: 'none',
                    borderRadius: '50%',
                    width: '20px',
                    height: '20px',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    color: '#64748b',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  title="Limpiar búsqueda"
                >
                  ✕
                </button>
              )}
            </div>
            <button
              onClick={() => setSearchTerm(searchInput)}
              style={{
                padding: '0.6rem 1.25rem',
                background: '#0f172a',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'background 0.2s'
              }}
            >
              Buscar
            </button>
            <button
              onClick={exportFilteredInventoryToExcel}
              disabled={filteredItems.length === 0}
              title="Exportar inventario filtrado a Excel"
              style={{
                padding: '0.6rem 1.25rem',
                background: '#00974A',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 'bold',
                cursor: filteredItems.length === 0 ? 'not-allowed' : 'pointer',
                opacity: filteredItems.length === 0 ? 0.6 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                transition: 'background 0.2s',
                whiteSpace: 'nowrap'
              }}
            >
              📥 Exportar Excel
            </button>
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 350px)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: '#f1f5f9' }}>
              <tr style={{ background: '#f1f5f9', color: '#334155', fontSize: '0.78rem', letterSpacing: '0.025em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                <th style={{ padding: '0.75rem 0.5rem', borderBottom: '2px solid #e2e8f0', width: '90px' }}>ItemCode</th>
                <th style={{ padding: '0.75rem 0.5rem', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontWeight: '700', minWidth: '220px' }}>Descripción SAP</th>
                <th style={{ padding: '0.75rem 0.4rem', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontWeight: '700', textAlign: 'center', width: '80px' }}>Ubicación</th>
                <th style={{ padding: '0.75rem 0.4rem', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontWeight: '700', width: '135px' }}>Grupo / Lab</th>
                <th style={{ padding: '0.75rem 0.4rem', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontWeight: '700', textAlign: 'center', width: '120px' }}>Clasificación SAP</th>
                <th style={{ padding: '0.75rem 0.4rem', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontWeight: '700', textAlign: 'right', width: '95px' }}>Stock</th>
                <th style={{ padding: '0.75rem 0.4rem', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontWeight: '700', textAlign: 'right', width: '85px' }}>Costo</th>
                <th style={{ padding: '0.75rem 0.4rem', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontWeight: '700', textAlign: 'right', width: '85px' }}>Precio PG</th>
                <th style={{ padding: '0.75rem 0.4rem', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontWeight: '700', textAlign: 'right', width: '85px' }}>Precio Hos</th>
                <th style={{ padding: '0.75rem 0.4rem', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontWeight: '700', textAlign: 'center', width: '100px' }}>Margen / Utilidad</th>
                <th style={{ padding: '0.75rem 0.4rem', borderBottom: '2px solid #e2e8f0', textAlign: 'center', width: '65px' }}>Estatus</th>
                <th style={{ padding: '0.75rem 0.5rem', borderBottom: '2px solid #e2e8f0', textAlign: 'center', width: '115px' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="12" style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                      <div className="spinner" style={{ border: '4px solid #f3f3f3', borderTop: '4px solid #3b82f6', borderRadius: '50%', width: '40px', height: '40px', animation: 'spin 1s linear infinite' }}></div>
                      Conectando con SAP Service Layer...
                    </div>
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan="12" style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
                    No se encontraron artículos que coincidan con la búsqueda.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item, idx) => {
                  const stock = Number(item.QuantityOnStock || 0);
                  const purchase = Number(item.PurchaseCost || 0);
                  const pricePG = Number(item.PricePG != null ? item.PricePG : (item.SalesPrice || 0));
                  const priceHos = Number(item.PriceHos || 0);
                  const isLow = stock < 10;
                  const medBadge = getMedClassificationBadge(item);
                  const marginVal = pricePG > 0 ? ((pricePG - purchase) / pricePG) * 100 : 0;
                  const utilityVal = (pricePG - purchase) * stock;

                  return (
                    <tr key={item.ItemCode || idx} style={{ borderBottom: '1px solid #e2e8f0', transition: 'background 0.2s' }}>
                      <td style={{ padding: '0.65rem 0.5rem', color: '#0f172a', fontWeight: '600', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>{item.ItemCode}</td>
                      <td style={{ padding: '0.65rem 0.5rem', color: '#334155', fontSize: '0.85rem', fontWeight: '500' }}>{item.ItemName}</td>
                      <td style={{ padding: '0.65rem 0.4rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <span style={{
                          background: item.WhsCode === 'QXCR' ? '#fee2e2' : item.WhsCode === 'QX' ? '#dcfce7' : '#dbeafe',
                          color: item.WhsCode === 'QXCR' ? '#991b1b' : item.WhsCode === 'QX' ? '#166534' : '#1d4ed8',
                          border: `1px solid ${item.WhsCode === 'QXCR' ? '#fecaca' : item.WhsCode === 'QX' ? '#bbf7d0' : '#bfdbfe'}`,
                          padding: '0.2rem 0.45rem',
                          borderRadius: '6px',
                          fontSize: '0.72rem',
                          fontWeight: '800'
                        }}>
                          {item.WarehouseName || item.WhsCode}
                        </span>
                      </td>
                      <td style={{ padding: '0.65rem 0.4rem', color: '#475569', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: '600', color: '#334155' }}>{item.ItemGroupName || 'FARMACIA'}</div>
                        <div style={{
                          color: item.ManufacturerName?.includes('Patente') ? '#0284c7' : item.ManufacturerName?.includes('Genérico') ? '#64748b' : '#94a3b8',
                          fontSize: '0.7rem',
                          fontWeight: item.ManufacturerName?.includes('Patente') ? '600' : '500'
                        }}>
                          {item.ManufacturerName || 'General'}
                        </div>
                      </td>
                      <td style={{ padding: '0.65rem 0.4rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '0.2rem 0.55rem',
                          borderRadius: '9999px',
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          whiteSpace: 'nowrap',
                          background: medBadge.bg,
                          color: medBadge.color,
                          border: `1px solid ${medBadge.border}`
                        }}>
                          {medBadge.text}
                        </span>
                      </td>
                      <td style={{ padding: '0.65rem 0.4rem', textAlign: 'right', fontWeight: '700', color: '#0f172a', whiteSpace: 'nowrap', fontSize: '0.82rem' }}>{formatStock(stock)}</td>
                      <td style={{ padding: '0.65rem 0.4rem', textAlign: 'right', fontWeight: '600', color: '#b45309', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>{formatCurrency(purchase)}</td>
                      <td style={{ padding: '0.65rem 0.4rem', textAlign: 'right', fontWeight: '600', color: '#10b981', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>{formatCurrency(pricePG)}</td>
                      <td style={{ padding: '0.65rem 0.4rem', textAlign: 'right', fontWeight: '600', color: '#0284c7', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>{formatCurrency(priceHos)}</td>
                      <td style={{ padding: '0.65rem 0.4rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: '700', fontSize: '0.82rem', color: marginVal > 0 ? '#0ea5e9' : '#64748b' }}>
                          {marginVal.toFixed(1) + '%'}
                        </div>
                        <div style={{ color: '#64748b', fontSize: '0.7rem' }}>
                          {formatUtility(utilityVal)}
                        </div>
                      </td>
                      <td style={{ padding: '0.65rem 0.4rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {isLow ? (
                          <span style={{ padding: '0.2rem 0.5rem', background: '#fef2f2', color: '#dc2626', borderRadius: '9999px', fontSize: '0.7rem', fontWeight: 'bold' }}>BAJO</span>
                        ) : (
                          <span style={{ padding: '0.2rem 0.5rem', background: '#ecfdf5', color: '#059669', borderRadius: '9999px', fontSize: '0.7rem', fontWeight: 'bold' }}>OK</span>
                        )}
                      </td>
                      <td style={{ padding: '0.65rem 0.5rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center', justifyContent: 'center' }}>
                          <button 
                            onClick={() => fetchBatches(item)}
                            title="Ver Lotes"
                            style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '0.3rem 0.45rem', borderRadius: '6px', fontSize: '0.78rem', cursor: 'pointer', fontWeight: '600', color: '#334155' }}
                          >
                            Lotes
                          </button>
                          <button 
                            onClick={() => fetchLocations(item)}
                            title="Localizar en Hospital"
                            style={{ background: '#e0f2fe', border: '1px solid #7dd3fc', padding: '0.3rem', borderRadius: '6px', fontSize: '0.9rem', cursor: 'pointer', fontWeight: '500', color: '#0369a1', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px' }}
                          >
                            📍
                          </button>
                          <button 
                            onClick={() => fetchHistory(item)}
                            title="Historial de Salidas"
                            style={{ background: '#fef3c7', border: '1px solid #fde68a', padding: '0.3rem', borderRadius: '6px', fontSize: '0.9rem', cursor: 'pointer', fontWeight: '500', color: '#b45309', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px' }}
                          >
                            🕒
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      
      {/* Modal Lotes */}
      {selectedItemBatches && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'white', padding: '2rem', borderRadius: '12px', width: '90%', maxWidth: '700px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
              <div>
                <h2 style={{ margin: '0 0 0.5rem 0', color: '#0f172a' }}>Lotes y Caducidades</h2>
                <p style={{ margin: 0, color: '#64748b' }}>{selectedItemBatches.ItemName} ({selectedItemBatches.ItemCode})</p>
              </div>
              <button onClick={() => setSelectedItemBatches(null)} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#94a3b8' }}>×</button>
            </div>

            {loadingBatches ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>Cargando lotes de SAP...</div>
            ) : batches.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>No hay lotes registrados para este artículo.</div>
            ) : (
              <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead style={{ background: '#f8fafc', position: 'sticky', top: 0 }}>
                    <tr>
                      <th style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e2e8f0', fontSize: '0.85rem', color: '#475569' }}>Lote</th>
                      <th style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e2e8f0', fontSize: '0.85rem', color: '#475569' }}>Almacén</th>
                      <th style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e2e8f0', fontSize: '0.85rem', color: '#475569', textAlign: 'right' }}>Cantidad</th>
                      <th style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e2e8f0', fontSize: '0.85rem', color: '#475569' }}>Fecha Ingreso</th>
                      <th style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e2e8f0', fontSize: '0.85rem', color: '#475569' }}>Caducidad</th>
                      <th style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e2e8f0', fontSize: '0.85rem', color: '#475569' }}>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((b, i) => {
                      const expDate = b.ExpirationDate ? new Date(b.ExpirationDate) : null;
                      const today = new Date();
                      const daysToExpire = expDate ? Math.ceil((expDate - today) / (1000 * 60 * 60 * 24)) : null;
                      
                      let statusStyle = { color: '#059669', bg: '#ecfdf5', text: 'Vigente' };
                      if (daysToExpire !== null) {
                        if (daysToExpire < 0) statusStyle = { color: '#dc2626', bg: '#fef2f2', text: 'Caducado' };
                        else if (daysToExpire <= 90) statusStyle = { color: '#d97706', bg: '#fffbeb', text: 'Próximo (90d)' };
                      }

                      return (
                        <tr key={i} style={{ borderBottom: '1px solid #e2e8f0' }}>
                          <td style={{ padding: '0.75rem 1rem', fontWeight: '500' }}>{b.Batch}</td>
                          <td style={{ padding: '0.75rem 1rem', color: '#334155', fontWeight: '600' }}>{b.WarehouseName || b.WhsCode || '-'}</td>
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: '700', color: '#0f172a' }}>{b.Quantity != null ? formatStock(b.Quantity) : '-'}</td>
                          <td style={{ padding: '0.75rem 1rem', color: '#64748b' }}>{b.AdmissionDate ? new Date(b.AdmissionDate).toLocaleDateString() : '-'}</td>
                          <td style={{ padding: '0.75rem 1rem', fontWeight: '500', color: statusStyle.color }}>{expDate ? expDate.toLocaleDateString() : '-'}</td>
                          <td style={{ padding: '0.75rem 1rem' }}>
                            <span style={{ background: statusStyle.bg, color: statusStyle.color, padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold' }}>
                              {statusStyle.text}
                            </span>
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
      )}

      {/* Modal Historial de Salidas */}
      {selectedItemHistory && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1001 }}>
          <div style={{ background: 'white', padding: '2rem', borderRadius: '12px', width: '90%', maxWidth: '800px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
              <div>
                <h2 style={{ margin: '0 0 0.5rem 0', color: '#0f172a' }}>Historial de Entregas y Salidas</h2>
                <p style={{ margin: 0, color: '#64748b' }}>{selectedItemHistory.ItemName} ({selectedItemHistory.ItemCode})</p>
              </div>
              <button onClick={() => setSelectedItemHistory(null)} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#94a3b8' }}>×</button>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <input 
                type="text" 
                placeholder="🔍 Filtrar por paciente o lote..." 
                value={historySearchTerm}
                onChange={e => setHistorySearchTerm(e.target.value)}
                style={{ width: '100%', padding: '0.75rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.95rem' }}
              />
            </div>

            {loadingHistory ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>Consultando historial en SAP...</div>
            ) : historyData.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>No hay historial registrado para este artículo o la vista no ha sido configurada en SAP.</div>
            ) : (
              <div style={{ maxHeight: '400px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead style={{ background: '#f8fafc', position: 'sticky', top: 0 }}>
                    <tr>
                      <th style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e2e8f0', fontSize: '0.85rem', color: '#475569' }}>Fecha</th>
                      <th style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e2e8f0', fontSize: '0.85rem', color: '#475569' }}>Lote</th>
                      <th style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e2e8f0', fontSize: '0.85rem', color: '#475569', textAlign: 'right' }}>Cant.</th>
                      <th style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e2e8f0', fontSize: '0.85rem', color: '#475569' }}>Paciente / Destino</th>
                      <th style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e2e8f0', fontSize: '0.85rem', color: '#475569' }}>Movimiento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyData.filter(d => {
                      const term = historySearchTerm.toLowerCase();
                      return !term || 
                             (d.Paciente && d.Paciente.toLowerCase().includes(term)) || 
                             (d.Lote && d.Lote.toLowerCase().includes(term));
                    }).map((h, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #e2e8f0' }}>
                        <td style={{ padding: '0.75rem 1rem', color: '#64748b', fontSize: '0.9rem' }}>
                          {h.Fecha ? new Date(h.Fecha).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' }) : '-'}
                        </td>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: '500', color: '#0f172a' }}>{h.Lote}</td>
                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 'bold', color: '#b45309' }}>
                          {formatStock(h.Cantidad < 0 ? h.Cantidad * -1 : h.Cantidad)}
                        </td>
                        <td style={{ padding: '0.75rem 1rem', color: '#0f172a' }}>{h.Paciente || 'Sin especificar'}</td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <span style={{ 
                            background: h.TipoMovimiento === 'Salida a Paciente / Piso' ? '#e0e7ff' : '#f1f5f9',
                            color: h.TipoMovimiento === 'Salida a Paciente / Piso' ? '#4338ca' : '#475569',
                            padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold' 
                          }}>
                            {h.TipoMovimiento}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal Reabastecimiento Inteligente */}
      {showReplenishmentModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'white', padding: '2rem', borderRadius: '12px', width: '90%', maxWidth: '800px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
              <div>
                <h2 style={{ margin: '0 0 0.5rem 0', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  📦 Sugerencias de Reabastecimiento
                </h2>
                <p style={{ margin: 0, color: '#64748b' }}>Artículos por debajo del umbral mínimo de seguridad ({lowStockThreshold} piezas)</p>
              </div>
              <button onClick={() => setShowReplenishmentModal(false)} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#94a3b8' }}>×</button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <span style={{ color: '#0f172a', fontWeight: '500' }}>Se encontraron {lowStockCount} artículos críticos.</span>
              <button 
                onClick={exportToExcel}
                style={{ background: '#00974A', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer', fontWeight: '600' }}
              >
                📥 Exportar Excel Institucional
              </button>
            </div>

            <div style={{ maxHeight: '400px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead style={{ background: '#f8fafc', position: 'sticky', top: 0 }}>
                  <tr>
                    <th style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e2e8f0', fontSize: '0.85rem', color: '#475569' }}>ItemCode</th>
                    <th style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e2e8f0', fontSize: '0.85rem', color: '#475569' }}>Descripción</th>
                    <th style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e2e8f0', fontSize: '0.85rem', color: '#475569', textAlign: 'right' }}>Stock Actual</th>
                  </tr>
                </thead>
                <tbody>
                  {lowStockItems.length === 0 ? (
                    <tr>
                      <td colSpan="3" style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>No hay artículos bajo stock. ¡Todo excelente!</td>
                    </tr>
                  ) : (
                    lowStockItems.map((item, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #e2e8f0' }}>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: '500', color: '#0f172a' }}>{item.ItemCode}</td>
                        <td style={{ padding: '0.75rem 1rem', color: '#334155' }}>{item.ItemName}</td>
                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right', color: '#dc2626', fontWeight: 'bold' }}>{formatStock(item.QuantityOnStock)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal Localización */}
      {selectedItemLocations && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'white', padding: '2rem', borderRadius: '12px', width: '90%', maxWidth: '600px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
              <div>
                <h2 style={{ margin: '0 0 0.5rem 0', color: '#0f172a' }}>Ubicación Física</h2>
                <p style={{ margin: 0, color: '#64748b' }}>{selectedItemLocations.ItemName}</p>
              </div>
              <button onClick={() => setSelectedItemLocations(null)} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#94a3b8' }}>×</button>
            </div>

            {loadingLocations ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>Buscando existencias en el hospital...</div>
            ) : locations.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>No hay existencias en ningún almacén del hospital.</div>
            ) : (
              <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead style={{ background: '#f8fafc', position: 'sticky', top: 0 }}>
                    <tr>
                      <th style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e2e8f0', fontSize: '0.85rem', color: '#475569' }}>Código Almacén</th>
                      <th style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e2e8f0', fontSize: '0.85rem', color: '#475569', textAlign: 'right' }}>Stock Disponible</th>
                    </tr>
                  </thead>
                  <tbody>
                    {locations.map((loc, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #e2e8f0' }}>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: '600', color: '#0369a1' }}>{loc.WhsCode}</td>
                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 'bold', color: '#0f172a' }}>
                          {formatStock(loc.QuantityOnStock)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      </>
      )}

      {activeTab === 'pending' && <PendingMonitor />}
      {activeTab === 'ledger' && <ControlledLedger />}
      {activeTab === 'history' && <PatientHistory />}
      {activeTab === 'kits' && <SurgicalKits />}

      {/* Estilos inline para la animación del spinner */}
      <style>{`
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        tbody tr:hover { background-color: #f8fafc; }
      `}</style>
    </div>
  );
}
