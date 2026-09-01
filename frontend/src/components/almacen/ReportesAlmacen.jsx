import React, { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { authHeaders } from '../../api/auth';
import { API_BASE } from '../../api/config';
import useEscapeKey from '../../hooks/useEscapeKey';

export default function ReportesAlmacen() {
  const location = useLocation();
  const today = new Date().toISOString().split('T')[0];
  
  const [activeTab, setActiveTab] = useState('kardex');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [itemCode, setItemCode] = useState('');
  
  // Entradas de Factura filters
  const [supplierSearch, setSupplierSearch] = useState('');
  const [invoiceSearch, setInvoiceSearch] = useState('');

  // Custom SAP reports state
  const [customReport, setCustomReport] = useState('cuentas-hospitalarias');
  const [docNum, setDocNum] = useState('');
  
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const isPreciosArticulos = location.pathname.includes('/almacen/precios-articulos');
  const isInterconsultas = location.pathname.includes('/interconsultas-jornadas');
  const isDedicatedView = isPreciosArticulos || isInterconsultas;

  // Set initial state based on URL
  useEffect(() => {
    if (location.pathname.includes('/almacen/precios-articulos')) {
      setActiveTab('custom-sap');
      setCustomReport('precios-articulos');
    } else if (location.pathname.includes('/interconsultas-jornadas')) {
      setActiveTab('custom-sap');
      setCustomReport('interconsultas-jornadas');
    }
  }, [location.pathname]);

  // Modal State
  const [selectedRow, setSelectedRow] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEscapeKey(() => setModalOpen(false), modalOpen);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalData, setModalData] = useState(null);

  const TABS = [
    { id: 'kardex', label: '📦 Kardex de Artículo' },
    { id: 'censo', label: '🛏️ Censo de Pacientes' },
    { id: 'entradas', label: '📄 Entradas de Factura' },
    { id: 'consumo', label: '📉 Historial de Consumo' },
    { id: 'custom-sap', label: '📋 Reportes de Soporte SAP' }
  ];

  const fetchReport = async () => {
    setLoading(true);
    setError(null);
    setData([]);
    
    try {
      let endpoint = '';
      if (activeTab === 'custom-sap') {
        const query = new URLSearchParams({ reportName: customReport });
        if (customReport !== 'precios-articulos') {
          query.append('startDate', startDate);
          query.append('endDate', endDate);
        }
        if (customReport === 'detalles-salida' && docNum) {
          query.append('docNum', docNum);
        }
        endpoint = `${API_BASE}/almacen/reportes/custom-sap?${query.toString()}`;
      } else if (activeTab === 'entradas') {
        const query = new URLSearchParams({ startDate, endDate });
        if (supplierSearch.trim()) query.append('supplierName', supplierSearch.trim());
        if (invoiceSearch.trim()) query.append('invoiceNum', invoiceSearch.trim());
        endpoint = `${API_BASE}/almacen/reportes/entradas?${query.toString()}`;
      } else {
        const query = new URLSearchParams({ startDate, endDate });
        if (itemCode) query.append('itemCode', itemCode);
        endpoint = `${API_BASE}/almacen/reportes/${activeTab}?${query.toString()}`;
      }
      
      const response = await fetch(endpoint, {
        headers: authHeaders()
      });
      
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || result.message || 'Error al obtener reporte');
      
      setData(result.data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRowClick = async (row) => {
    setSelectedRow(row);
    setModalOpen(true);
    
    if (activeTab === 'custom-sap') {
      setModalLoading(false);
      setModalData({ isCustom: true, row });
      return;
    }

    setModalLoading(true);
    setModalData(null);

    try {
      let endpoint = '';
      if (activeTab === 'kardex') {
        const code = row['Código'] || row['Documento Referencia'] || row['Descripción'];
        endpoint = `${API_BASE}/almacen/reportes/detalle/kardex/${encodeURIComponent(code)}`;
      } else if (activeTab === 'censo') {
        const cuenta = row['Cuenta Hospitalaria'] || row['Cuenta'];
        endpoint = `${API_BASE}/almacen/reportes/detalle/censo/${encodeURIComponent(cuenta)}`;
      } else if (activeTab === 'entradas') {
        const numFact = row['Numero de factura'] || row['Numero de entrada'];
        endpoint = `${API_BASE}/almacen/reportes/detalle/entradas/${encodeURIComponent(numFact)}`;
      } else if (activeTab === 'consumo') {
        const code = row['Codigo'] || row['Insumo'];
        endpoint = `${API_BASE}/almacen/reportes/detalle/kardex/${encodeURIComponent(code)}`;
      }

      if (endpoint) {
        const res = await fetch(endpoint, { headers: authHeaders() });
        const json = await res.json();
        if (res.ok) {
          setModalData(json);
        }
      }
    } catch (e) {
      console.error('Error al cargar detalle:', e);
    } finally {
      setModalLoading(false);
    }
  };

  const formatCellValue = (key, val) => {
    if (val === null || val === undefined || val === '') return '';

    const lowerKey = String(key).toLowerCase();

    // 1. Formato Moneda ($)
    if (
      lowerKey.includes('importe') || 
      lowerKey.includes('valor acumulado') || 
      lowerKey.includes('monto') || 
      lowerKey.includes('precio') ||
      lowerKey.includes('total')
    ) {
      const num = Number(val);
      if (!isNaN(num)) {
        return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(num);
      }
    }

    // 2. Formato Fecha y Hora
    if (lowerKey.includes('fecha') || lowerKey.includes('caducidad')) {
      const str = String(val).trim();
      if (!str) return '';

      // Formato 8 dígitos: YYYYMMDD
      if (/^\d{8}$/.test(str)) {
        const year = str.substring(0, 4);
        const month = str.substring(4, 6);
        const day = str.substring(6, 8);
        return `${day}/${month}/${year}`;
      }

      // Formato ISO o timestamp con hora
      if (str.includes('T') || (str.includes('-') && str.includes(':'))) {
        const d = new Date(str);
        if (!isNaN(d.getTime())) {
          const day = String(d.getDate()).padStart(2, '0');
          const month = String(d.getMonth() + 1).padStart(2, '0');
          const year = d.getFullYear();
          const hours = String(d.getHours()).padStart(2, '0');
          const minutes = String(d.getMinutes()).padStart(2, '0');
          const seconds = String(d.getSeconds()).padStart(2, '0');

          if (lowerKey.includes('hora') || (hours !== '00' || minutes !== '00' || seconds !== '00')) {
            return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
          }
          return `${day}/${month}/${year}`;
        }
      }

      // Formato YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
        const [year, month, day] = str.split('-');
        return `${day}/${month}/${year}`;
      }
    }

    return String(val);
  };

  // Filtrado reactivo en memoria sobre los datos cargados
  const filteredData = useMemo(() => {
    if (!Array.isArray(data)) return [];
    if (activeTab !== 'entradas') return data;
    
    let list = data;
    if (supplierSearch.trim()) {
      const q = supplierSearch.toLowerCase().trim();
      list = list.filter(r => String(r['Nombre proveedor'] || r['nombreproveedor'] || '').toLowerCase().includes(q));
    }
    if (invoiceSearch.trim()) {
      const q = invoiceSearch.toLowerCase().trim();
      list = list.filter(r => 
        String(r['Numero de factura'] || r['numerofactura'] || '').toLowerCase().includes(q) ||
        String(r['Numero de entrada'] || r['numeroentrada'] || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [data, activeTab, supplierSearch, invoiceSearch]);

  const exportToExcel = () => {
    const exportRows = filteredData;
    if (exportRows.length === 0) return;
    const formattedData = exportRows.map(row => {
      const newRow = {};
      Object.keys(row).forEach(key => {
        newRow[key] = formatCellValue(key, row[key]);
      });
      return newRow;
    });

    const ws = XLSX.utils.json_to_sheet(formattedData);

    // Encabezado que refleja el filtro aplicado, para que el Excel respete exactamente lo filtrado
    const reportTitle = isInterconsultas
      ? 'Interconsultas y Jornadas Especiales (SER*)'
      : isPreciosArticulos
        ? 'Lista de Precios de Artículos (SAP)'
        : activeTab === 'entradas'
          ? 'Reporte de Entradas de Factura (SAP)'
          : `Reporte Almacén - ${activeTab === 'custom-sap' ? customReport : activeTab}`;

    const usesDateFilter = (activeTab !== 'custom-sap' || customReport !== 'precios-articulos');
    const filterLine = usesDateFilter && startDate && endDate
      ? `Filtro de fechas aplicado: ${startDate} hasta ${endDate}`
      : (activeTab === 'custom-sap' && customReport === 'precios-articulos'
          ? 'Reporte sin filtro de fechas (catálogo de precios)'
          : 'Sin filtro de fechas');

    const headerRows = [[reportTitle], [filterLine]];

    if (activeTab === 'entradas') {
      if (supplierSearch.trim()) headerRows.push([`Filtro Proveedor: ${supplierSearch.trim()}`]);
      if (invoiceSearch.trim()) headerRows.push([`Filtro Factura / Entrada: ${invoiceSearch.trim()}`]);
    } else if (activeTab === 'custom-sap' && customReport === 'detalles-salida' && docNum) {
      headerRows.push([`Número de documento: ${docNum}`]);
    } else if (itemCode) {
      headerRows.push([`Código de artículo: ${itemCode}`]);
    }

    headerRows.push([]);
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
    const finalAoa = headerRows.concat(aoa);
    const wsFinal = XLSX.utils.aoa_to_sheet(finalAoa);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsFinal, 'Reporte');

    const filenamePrefix = isInterconsultas
      ? 'Interconsultas_Jornadas'
      : isPreciosArticulos
        ? 'Precios_Articulos'
        : `Almacen_${activeTab}`;
    const rangeSuffix = usesDateFilter && startDate && endDate ? `_${startDate}_a_${endDate}` : '';
    const supplierSuffix = activeTab === 'entradas' && supplierSearch.trim() ? `_${supplierSearch.trim().replace(/\s+/g, '_')}` : '';
    XLSX.writeFile(wb, `Reporte_${filenamePrefix}${rangeSuffix}${supplierSuffix}_${today}.xlsx`);
  };

  return (
    <div style={{ padding: '2rem', maxWidth: 'var(--content-max, 1400px)', margin: '0 auto', fontFamily: 'Inter, system-ui, sans-serif' }}>
      
      <header style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '2.5rem', color: '#0f172a', fontWeight: '800', letterSpacing: '-1px' }}>
            {isInterconsultas ? (
              <>🩺 Interconsultas y Jornadas Especiales <span style={{ color: '#004687' }}>(SER*)</span></>
            ) : isPreciosArticulos ? (
              <>💰 Lista de Precios de Artículos <span style={{ color: '#004687' }}>(SAP)</span></>
            ) : (
              <>📑 Reportes <span style={{ color: '#004687' }}>(SAP)</span></>
            )}
          </h1>
          <p style={{ color: '#64748b', fontSize: '1.1rem', marginTop: '0.25rem' }}>
            {isInterconsultas
              ? 'Reporte detallado de servicios de interconsulta y jornadas médicas registradas en SAP'
              : isPreciosArticulos
              ? 'Consulta de precios por artículo y servicio: Lista 1 (Hospitalización), Lista 2 (Público General) y Lista 4 (2025)'
              : 'Auditoría integral, trazabilidad de almacén y desgloses interactivos'}
          </p>
        </div>
        <button 
          onClick={exportToExcel}
          disabled={data.length === 0}
          style={{
            padding: '0.75rem 1.5rem',
            background: data.length === 0 ? '#cbd5e1' : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontWeight: '600',
            fontSize: '1rem',
            cursor: data.length === 0 ? 'not-allowed' : 'pointer',
            boxShadow: data.length === 0 ? 'none' : '0 4px 14px 0 rgba(16, 185, 129, 0.39)',
            transition: 'all 0.3s ease'
          }}
        >
          📥 Descargar Excel
        </button>
      </header>

      {/* Tabs */}
      {!isDedicatedView && (
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem', background: '#f1f5f9', padding: '0.5rem', borderRadius: '12px' }}>
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setData([]); setError(null); }}
              style={{
                flex: 1,
                padding: '1rem',
                background: activeTab === tab.id ? 'white' : 'transparent',
                color: activeTab === tab.id ? '#004687' : '#64748b',
                border: 'none',
                borderRadius: '8px',
                fontWeight: activeTab === tab.id ? '700' : '500',
                fontSize: '1.05rem',
                cursor: 'pointer',
                boxShadow: activeTab === tab.id ? '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)' : 'none',
                transition: 'all 0.2s'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Filtros */}
      <div style={{ background: 'white', padding: '2rem', borderRadius: '16px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.05)', border: '1px solid #e2e8f0', marginBottom: '2rem' }}>
        <h2 style={{ margin: '0 0 1.5rem 0', fontSize: '1.25rem', color: '#1e293b' }}>
          {isDedicatedView ? 'Parámetros de Consulta' : 'Filtros de Búsqueda'}
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', alignItems: 'flex-end' }}>
          {(activeTab === 'kardex' || activeTab === 'consumo') && (
            <div style={{ flex: '1 1 250px' }}>
              <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: '600', color: '#475569', marginBottom: '0.5rem' }}>Código Artículo (Opcional)</label>
              <input 
                type="text" 
                value={itemCode} 
                onChange={e => setItemCode(e.target.value)} 
                placeholder="Ej. MAT00123"
                style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '1rem', outline: 'none', transition: 'border-color 0.2s' }} 
              />
            </div>
          )}

          {activeTab === 'entradas' && (
            <>
              <div style={{ flex: '1 1 220px' }}>
                <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: '600', color: '#475569', marginBottom: '0.5rem' }}>
                  Nombre Proveedor (Opcional)
                </label>
                <input 
                  type="text" 
                  value={supplierSearch} 
                  onChange={e => setSupplierSearch(e.target.value)} 
                  placeholder="Ej. PHARMA PLUS o laboratorios..."
                  style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '1rem', outline: 'none', transition: 'border-color 0.2s' }} 
                />
              </div>

              <div style={{ flex: '1 1 220px' }}>
                <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: '600', color: '#475569', marginBottom: '0.5rem' }}>
                  No. Factura o Entrada (Opcional)
                </label>
                <input 
                  type="text" 
                  value={invoiceSearch} 
                  onChange={e => setInvoiceSearch(e.target.value)} 
                  placeholder="Ej. 3093251352 o 3605"
                  style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '1rem', outline: 'none', transition: 'border-color 0.2s' }} 
                />
              </div>
            </>
          )}

          {activeTab === 'custom-sap' && !isDedicatedView && (
            <div style={{ flex: '1 1 300px' }}>
              <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: '600', color: '#475569', marginBottom: '0.5rem' }}>Reporte de Soporte SAP</label>
              <select 
                value={customReport} 
                onChange={e => { setCustomReport(e.target.value); setData([]); }}
                style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '1rem', outline: 'none', background: 'white' }}
              >
                <option value="cuentas-hospitalarias">Cuentas Hospitalarias (ORDR)</option>
                <option value="atencion-medica-detalle">Detalle de Atenciones Médicas (Hospitalización/Urgencias)</option>
                <option value="consultas-medicas">Consultas Médicas por Fecha (con Folio Orden Venta)</option>
                <option value="detalles-salida">Detalle de Salidas de Almacén (IGE1/OIGE)</option>
                <option value="precios-articulos">Lista de Precios de Artículos y Servicios (Lista 1, 2, 4)</option>
              </select>
            </div>
          )}

          {activeTab === 'custom-sap' && customReport === 'detalles-salida' && (
            <div style={{ flex: '1 1 200px' }}>
              <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: '600', color: '#475569', marginBottom: '0.5rem' }}>Número de documento (Opcional)</label>
              <input 
                type="number" 
                value={docNum} 
                onChange={e => setDocNum(e.target.value)} 
                placeholder="Ej. 12345"
                style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '1rem', outline: 'none' }} 
              />
            </div>
          )}
          
          {(activeTab !== 'custom-sap' || customReport !== 'precios-articulos') && (
            <>
              <div style={{ flex: '1 1 200px' }}>
                <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: '600', color: '#475569', marginBottom: '0.5rem' }}>Fecha Desde</label>
                <input 
                  type="date" 
                  value={startDate} 
                  onChange={e => setStartDate(e.target.value)} 
                  style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '1rem', outline: 'none' }} 
                />
              </div>
              
              <div style={{ flex: '1 1 200px' }}>
                <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: '600', color: '#475569', marginBottom: '0.5rem' }}>Fecha Hasta</label>
                <input 
                  type="date" 
                  value={endDate} 
                  onChange={e => setEndDate(e.target.value)} 
                  style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '1rem', outline: 'none' }} 
                />
              </div>
            </>
          )}

          <button 
            onClick={fetchReport} 
            disabled={loading}
            style={{ 
              flex: '1 1 200px',
              background: loading ? '#94a3b8' : 'linear-gradient(135deg, #004687 0%, #0284c7 100%)', 
              color: 'white', 
              padding: '0.8rem 1.5rem', 
              borderRadius: '8px', 
              border: 'none',
              fontWeight: 'bold',
              fontSize: '1.1rem',
              cursor: loading ? 'wait' : 'pointer',
              boxShadow: '0 4px 6px -1px rgba(0, 70, 135, 0.4)',
              transition: 'transform 0.1s'
            }}
          >
            {loading ? 'Consultando...' : '🔍 Generar Reporte'}
          </button>
        </div>

        {error && (
          <div style={{ marginTop: '1.5rem', padding: '1rem', background: '#fef2f2', borderLeft: '4px solid #ef4444', color: '#991b1b', borderRadius: '4px', fontWeight: '500' }}>
            {error}
          </div>
        )}
      </div>

      {/* Resultados */}
      <div style={{ background: 'white', borderRadius: '16px', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        
        <div style={{ padding: '1.5rem', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#0f172a', fontWeight: 'bold' }}>
              Resultados de Búsqueda
            </h2>
            {filteredData.length > 0 && (
              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#0284c7', fontWeight: '600' }}>
                💡 Haz clic en cualquier fila para ver la trazabilidad y desglose detallado
              </p>
            )}
          </div>
          <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '0.25rem 0.75rem', borderRadius: '9999px', fontSize: '0.875rem', fontWeight: 'bold' }}>
            {filteredData.length} registros
          </span>
        </div>

        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 400px)' }}>
          {loading && (
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          )}
          {loading && (
            <div style={{ padding: '3rem', textAlign: 'center' }}>
              <div style={{
                width: 44, height: 44, margin: '0 auto 1.25rem',
                border: '4px solid #e2e8f0', borderTopColor: '#0284c7',
                borderRadius: '50%', animation: 'spin 0.8s linear infinite'
              }} />
              <p style={{ color: '#475569', fontWeight: 600, fontSize: '1rem', margin: 0 }}>Consultando datos...</p>
              <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: '0.35rem 0 0' }}>
                La primera consulta del día puede tardar un poco más mientras se actualizan los datos en segundo plano.
              </p>
            </div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '800px', display: loading ? 'none' : 'table' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: '#f1f5f9' }}>
              <tr style={{ background: '#f1f5f9', color: '#475569', fontSize: '0.85rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                {filteredData.length > 0 ? (
                  Object.keys(filteredData[0]).map(key => (
                    <th key={key} style={{ padding: '1.25rem 1rem', borderBottom: '2px solid #cbd5e1', fontWeight: '700' }}>
                      {key}
                    </th>
                  ))
                ) : (
                  <th style={{ padding: '1.25rem 1rem', borderBottom: '2px solid #cbd5e1' }}>Información</th>
                )}
              </tr>
            </thead>
            <tbody>
              {filteredData.length > 0 ? (
                filteredData.map((row, idx) => (
                  <tr 
                    key={idx} 
                    onClick={() => handleRowClick(row)}
                    style={{ 
                      background: idx % 2 === 0 ? 'white' : '#f8fafc', 
                      transition: 'all 0.2s', 
                      borderBottom: '1px solid #e2e8f0',
                      cursor: 'pointer' 
                    }} 
                    onMouseOver={e => e.currentTarget.style.background = '#e0f2fe'} 
                    onMouseOut={e => e.currentTarget.style.background = idx % 2 === 0 ? 'white' : '#f8fafc'}
                  >
                    {Object.entries(row).map(([key, val], i) => (
                      <td key={i} style={{ padding: '1rem', color: '#334155', fontSize: '0.95rem' }}>
                        {formatCellValue(key, val)}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td style={{ padding: '4rem', textAlign: 'center', color: '#94a3b8', fontSize: '1.1rem' }} colSpan="100%">
                    <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📭</div>
                    No hay datos para mostrar.<br />Ajusta los filtros y haz clic en "Generar Reporte".
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de Detalle y Trazabilidad */}
      {modalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.75)',
          backdropFilter: 'blur(6px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000,
          padding: '1.5rem'
        }}>
          <div style={{
            background: 'white',
            borderRadius: '20px',
            width: '100%',
            maxWidth: '900px',
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            overflow: 'hidden'
          }}>
            {/* Header Modal */}
            <div style={{ padding: '1.5rem 2rem', background: 'linear-gradient(135deg, #0f172a 0%, #004687 100%)', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.4rem', fontWeight: '700', color: 'white' }}>
                  🔍 Detalle y Trazabilidad de Movimiento
                </h3>
                <p style={{ margin: '0.25rem 0 0 0', color: '#93c5fd', fontSize: '0.9rem' }}>
                  {activeTab === 'kardex' && 'Recorrido completo e historial del insumo entre almacenes'}
                  {activeTab === 'censo' && 'Ficha del paciente y cargos de medicamentos/almacén'}
                  {activeTab === 'entradas' && 'Partidas de la factura de entrada y proveedor'}
                  {activeTab === 'consumo' && 'Trazabilidad desde almacén hasta la aplicación al paciente'}
                </p>
              </div>
              <button 
                onClick={() => setModalOpen(false)}
                style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white', fontSize: '1.5rem', borderRadius: '50%', width: '40px', height: '40px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                ✕
              </button>
            </div>

            {/* Body Modal */}
            <div style={{ padding: '2rem', overflowY: 'auto', flex: 1 }}>
              {modalLoading ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
                  <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>⏳</div>
                  Cargando trazabilidad completa...
                </div>
              ) : (
                <>
                  {/* 1. Modal Kardex / Consumo: Timeline de Trazabilidad */}
                  {(activeTab === 'kardex' || activeTab === 'consumo') && (
                    <div>
                      <div style={{ background: '#f0f9ff', padding: '1rem', borderRadius: '12px', marginBottom: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span style={{ fontSize: '0.8rem', color: '#0369a1', fontWeight: 'bold', textTransform: 'uppercase' }}>Insumo Seleccionado</span>
                          <h4 style={{ margin: '0.25rem 0 0 0', color: '#0c4a6e', fontSize: '1.2rem', fontWeight: 'bold' }}>
                            {selectedRow?.['Descripción'] || selectedRow?.['Insumo'] || 'Insumo Médico'}
                          </h4>
                          <span style={{ fontSize: '0.9rem', color: '#0284c7' }}>
                            Código: {selectedRow?.['Código'] || selectedRow?.['Codigo'] || 'N/A'} • Existencias en Almacén: <strong>{selectedRow?.['Existencias'] || 0}</strong>
                          </span>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: '0.8rem', color: '#0369a1', fontWeight: 'bold', display: 'block' }}>Movimientos Registrados</span>
                          <span style={{ fontSize: '1.5rem', fontWeight: '800', color: '#0c4a6e' }}>
                            {modalData?.data ? modalData.data.length : 0}
                          </span>
                        </div>
                      </div>

                      <h4 style={{ margin: '0 0 1rem 0', color: '#0f172a', fontSize: '1.1rem' }}>
                        🚚 Trayectoria Completa e Historial de Movimientos entre Almacenes
                      </h4>

                      {modalData?.data && modalData.data.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '400px', overflowY: 'auto' }}>
                          {modalData.data.map((mov, idx) => (
                            <div key={idx} style={{ display: 'flex', gap: '1rem', background: 'white', border: '1px solid #e2e8f0', padding: '1rem', borderRadius: '12px', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                              <div style={{ fontSize: '1.8rem', background: mov.Movimiento > 0 ? '#dcfce7' : '#fee2e2', width: '50px', height: '50px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                {mov.Movimiento > 0 ? '📦' : '🏥'}
                              </div>
                              <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                                  <span style={{ fontWeight: 'bold', color: '#0f172a' }}>{mov.Descripcion}</span>
                                  <span style={{ fontSize: '0.85rem', color: '#64748b' }}>{formatCellValue('Fecha', mov.Fecha)}</span>
                                </div>
                                <div style={{ fontSize: '0.85rem', color: '#475569', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                                  <span><strong>Origen:</strong> {mov.AlmacenOrigen || 'Almacén General'}</span>
                                  <span><strong>Destino:</strong> {mov.AlmacenDestino || mov.Servicio}</span>
                                  <span><strong>Documento:</strong> {mov.DocumentoRef || 'N/A'}</span>
                                  <span><strong>Movimiento:</strong> <span style={{ color: mov.Movimiento > 0 ? '#16a34a' : '#dc2626', fontWeight: 'bold' }}>{mov.Movimiento > 0 ? `+${mov.Movimiento}` : mov.Movimiento}</span></span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', background: '#f8fafc', borderRadius: '12px' }}>
                          🚚 No se encontraron movimientos para este insumo en el periodo.
                        </div>
                      )}
                    </div>
                  )}

                  {/* 2. Modal Censo: Cargos al Paciente */}
                  {activeTab === 'censo' && (
                    <div>
                      <div style={{ background: '#e0f2fe', padding: '1rem', borderRadius: '12px', marginBottom: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span style={{ fontSize: '0.8rem', color: '#0369a1', fontWeight: 'bold', textTransform: 'uppercase' }}>Ficha de Paciente</span>
                          <h4 style={{ margin: '0.25rem 0 0 0', color: '#0c4a6e', fontSize: '1.2rem', fontWeight: 'bold' }}>
                            {selectedRow?.['Nombre Paciente'] || modalData?.paciente?.NombrePaciente || 'Paciente'}
                          </h4>
                          <span style={{ fontSize: '0.9rem', color: '#0284c7' }}>
                            Cuenta #{selectedRow?.['Cuenta Hospitalaria'] || modalData?.paciente?.CuentaHospitalaria} • Habitación: {selectedRow?.['Habitacion'] || modalData?.paciente?.Habitacion || 'N/A'}
                          </span>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: '0.8rem', color: '#0369a1', fontWeight: 'bold', display: 'block' }}>Total Insumos Cargados</span>
                          <span style={{ fontSize: '1.5rem', fontWeight: '800', color: '#0c4a6e' }}>
                            {modalData?.cargos ? modalData.cargos.length : 0}
                          </span>
                        </div>
                      </div>

                      <h4 style={{ margin: '0 0 1rem 0', color: '#0f172a', fontSize: '1.1rem' }}>
                        💊 Historial Completo de Insumos y Medicamentos Asignados
                      </h4>

                      {modalData?.cargos && modalData.cargos.length > 0 ? (
                        <div style={{ overflowX: 'auto', maxHeight: '400px' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                            <thead style={{ position: 'sticky', top: 0, background: '#f1f5f9', zIndex: 5 }}>
                              <tr style={{ color: '#475569', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em' }}>
                                <th style={{ padding: '0.75rem' }}>Fecha</th>
                                <th style={{ padding: '0.75rem' }}>Código</th>
                                <th style={{ padding: '0.75rem' }}>Insumo</th>
                                <th style={{ padding: '0.75rem' }}>Lote</th>
                                <th style={{ padding: '0.75rem' }}>Cant.</th>
                                <th style={{ padding: '0.75rem' }}>Precio Unit.</th>
                                <th style={{ padding: '0.75rem' }}>Total</th>
                                <th style={{ padding: '0.75rem' }}>Usuario Liberó</th>
                              </tr>
                            </thead>
                            <tbody>
                              {modalData.cargos.map((c, i) => (
                                <tr key={i} style={{ borderBottom: '1px solid #e2e8f0', background: i % 2 === 0 ? 'white' : '#f8fafc' }}>
                                  <td style={{ padding: '0.75rem', whiteSpace: 'nowrap' }}>{formatCellValue('Fecha', c['Fecha Cargo'])}</td>
                                  <td style={{ padding: '0.75rem', color: '#0284c7', fontWeight: 'bold' }}>{c['Código Insumo']}</td>
                                  <td style={{ padding: '0.75rem', fontWeight: '600', color: '#0f172a' }}>{c['Descripción Insumo']}</td>
                                  <td style={{ padding: '0.75rem', fontSize: '0.8rem', color: '#64748b' }}>{c['Lote'] || 'N/A'}</td>
                                  <td style={{ padding: '0.75rem', fontWeight: 'bold' }}>{c['Cantidad']}</td>
                                  <td style={{ padding: '0.75rem' }}>{formatCellValue('Precio', c['Precio Unitario'])}</td>
                                  <td style={{ padding: '0.75rem', fontWeight: 'bold', color: '#059669' }}>{formatCellValue('Total', c['Monto Total'])}</td>
                                  <td style={{ padding: '0.75rem', fontSize: '0.85rem' }}>{c['Usuario Liberó'] || 'Cirrus'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', background: '#f8fafc', borderRadius: '12px' }}>
                          🏥 No hay cargos registrados para esta cuenta hospitalaria en el periodo consultado.
                        </div>
                      )}
                    </div>
                  )}

                  {/* 3. Modal Entradas: Partidas de Factura */}
                  {activeTab === 'entradas' && (
                    <div>
                      <div style={{ background: '#f0fdf4', padding: '1rem', borderRadius: '12px', marginBottom: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span style={{ fontSize: '0.8rem', color: '#166534', fontWeight: 'bold', textTransform: 'uppercase' }}>Factura de Entrada</span>
                          <h4 style={{ margin: '0.25rem 0 0 0', color: '#14532d', fontSize: '1.2rem', fontWeight: 'bold' }}>
                            {selectedRow?.['Numero de factura'] || selectedRow?.['Numero de entrada'] || 'Factura'}
                          </h4>
                          <span style={{ fontSize: '0.9rem', color: '#15803d' }}>
                            Proveedor: {selectedRow?.['Nombre proveedor'] || 'N/A'} • Fecha: {formatCellValue('Fecha', selectedRow?.['Fecha'])}
                          </span>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: '0.8rem', color: '#166534', fontWeight: 'bold', display: 'block' }}>Importe Total Factura</span>
                          <span style={{ fontSize: '1.5rem', fontWeight: '800', color: '#15803d' }}>
                            {formatCellValue('Importe', selectedRow?.['Importe de factura'])}
                          </span>
                        </div>
                      </div>

                      <h4 style={{ margin: '0 0 1rem 0', color: '#0f172a', fontSize: '1.1rem' }}>
                        📋 Desglose de Partidas / Artículos Recibidos ({modalData?.movimientos ? modalData.movimientos.length : 0})
                      </h4>

                      {modalData?.movimientos && modalData.movimientos.length > 0 ? (
                        <div style={{ overflowX: 'auto', maxHeight: '400px' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                            <thead style={{ position: 'sticky', top: 0, background: '#f1f5f9', zIndex: 5 }}>
                              <tr style={{ color: '#475569', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em' }}>
                                <th style={{ padding: '0.75rem' }}>Código</th>
                                <th style={{ padding: '0.75rem' }}>Descripción Insumo</th>
                                <th style={{ padding: '0.75rem' }}>Receptor</th>
                                <th style={{ padding: '0.75rem' }}>Cantidad</th>
                                <th style={{ padding: '0.75rem' }}>Precio Unit.</th>
                                <th style={{ padding: '0.75rem' }}>Importe Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {modalData.movimientos.map((m, i) => (
                                <tr key={i} style={{ borderBottom: '1px solid #e2e8f0', background: i % 2 === 0 ? 'white' : '#f8fafc' }}>
                                  <td style={{ padding: '0.75rem', color: '#0284c7', fontWeight: 'bold' }}>{m['Código']}</td>
                                  <td style={{ padding: '0.75rem', fontWeight: '600', color: '#0f172a' }}>{m['Descripción Insumo']}</td>
                                  <td style={{ padding: '0.75rem', fontSize: '0.85rem' }}>{m['Almacén Receptor'] || 'ALG'}</td>
                                  <td style={{ padding: '0.75rem', fontWeight: 'bold' }}>{m['Cantidad Recibida']}</td>
                                  <td style={{ padding: '0.75rem' }}>{formatCellValue('Precio', m['Precio Unitario'])}</td>
                                  <td style={{ padding: '0.75rem', fontWeight: 'bold', color: '#059669' }}>{formatCellValue('Importe', m['Importe Total'])}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', background: '#f8fafc', borderRadius: '12px' }}>
                          📋 No hay partidas registradas para esta factura.
                        </div>
                      )}
                    </div>
                  )}

                  {/* 4. Modal para Reportes de Soporte SAP (Custom) */}
                  {modalData?.isCustom && (
                    <div>
                      <h4 style={{ margin: '0 0 1rem 0', color: '#0f172a', fontSize: '1.1rem' }}>
                        📋 Detalle de Registro (Reporte SAP)
                      </h4>
                      <div style={{ background: '#f8fafc', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0', maxHeight: '450px', overflowY: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <tbody>
                            {Object.entries(modalData.row).map(([key, val], i) => (
                              <tr key={i} style={{ borderBottom: i < Object.entries(modalData.row).length - 1 ? '1px solid #e2e8f0' : 'none' }}>
                                <td style={{ padding: '0.75rem 0', fontWeight: 'bold', color: '#475569', width: '35%', fontSize: '0.9rem', verticalAlign: 'top' }}>{key}</td>
                                <td style={{ padding: '0.75rem 0', color: '#0f172a', fontSize: '0.95rem' }}>{formatCellValue(key, val)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                </>
              )}
            </div>

            {/* Footer Modal */}
            <div style={{ padding: '1rem 2rem', background: '#f8fafc', borderTop: '1px solid #e2e8f0', textAlign: 'right' }}>
              <button 
                onClick={() => setModalOpen(false)}
                style={{ padding: '0.6rem 1.5rem', background: '#0f172a', color: 'white', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer' }}
              >
                Cerrar Ventana
              </button>
            </div>
          </div>
        </div>
      )}
      
    </div>
  );
}
