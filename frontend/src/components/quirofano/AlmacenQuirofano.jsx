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
    const q = (searchQuery || '').toLowerCase().trim();
    return stockItems.filter(item => {
      const matchSearch = !q ||
                          (item.ItemCode || '').toLowerCase().includes(q) ||
                          (item.ItemName || '').toLowerCase().includes(q) ||
                          (item.ItemGroupName || '').toLowerCase().includes(q);
      const matchWhs = warehouseFilter === 'ALL' || item.WhsCode === warehouseFilter;
      return matchSearch && matchWhs;
    });
  }, [stockItems, searchQuery, warehouseFilter]);

  // Filtered Movements List
  const filteredMovements = useMemo(() => {
    const q = (searchQuery || '').toLowerCase().trim();
    return movements.filter(m => {
      const matchSearch = !q ||
                          (m.Codigo || '').toLowerCase().includes(q) ||
                          (m.Medicamento || '').toLowerCase().includes(q) ||
                          (m.Paciente || '').toLowerCase().includes(q) ||
                          (m.Procedimiento || '').toLowerCase().includes(q) ||
                          (m.Medicos || '').toLowerCase().includes(q) ||
                          String(m.PCFRNum || '').includes(q) ||
                          String(m.PCNum || '').includes(q);
      const matchWhs = warehouseFilter === 'ALL' || 
                       m.Almacen === warehouseFilter || 
                       (warehouseFilter === 'QX' && (m.Almacen === 'CQX' || m.Almacen === 'QX'));
      return matchSearch && matchWhs;
    });
  }, [movements, searchQuery, warehouseFilter]);

  const exportToExcel = () => {
    const fechaReporte = new Date().toLocaleString('es-MX');
    const whsLabel = warehouseFilter === 'ALL' ? 'Todos los Almacenes QX (QX / QXCR)' : warehouseFilter === 'QXCR' ? 'Quirófano Carro Rojo (QXCR)' : 'Quirófano General (QX)';

    if (subTab === 'inventory') {
      if (filteredStock.length === 0) {
        alert('No hay registros de inventario para exportar con los filtros seleccionados.');
        return;
      }

      const totalPiezas = filteredStock.reduce((acc, item) => acc + (Number(item.QuantityOnStock) || 0), 0);
      const totalValor = filteredStock.reduce((acc, item) => acc + ((Number(item.QuantityOnStock) || 0) * (Number(item.SalesPrice) || 0)), 0);

      const cols = [
        { header: 'Código SAP', key: 'ItemCode', width: 110, align: 'left' },
        { header: 'Descripción / Insumo', key: 'ItemName', width: 320, align: 'left' },
        { header: 'Almacén', key: 'WhsCode', width: 130, align: 'center' },
        { header: 'Stock Físico', key: 'QuantityOnStock', width: 100, align: 'right', type: 'num' },
        { header: 'Precio Unitario ($)', key: 'SalesPrice', width: 130, align: 'right', type: 'money' },
        { header: 'Valor Total ($)', key: 'ValorTotal', width: 140, align: 'right', type: 'money' },
        { header: 'Grupo SAP', key: 'ItemGroupName', width: 160, align: 'left' }
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
  .money{color:#15803D;font-weight:bold;text-align:right}
  .code{color:#005FA9;font-weight:bold}
  .qxcr{background:#FEE2E2;color:#DC2626;font-weight:bold}
  .qx{background:#EFF6FF;color:#1D4ED8;font-weight:bold}
  .total-row td{background:#E0EAF4;font-weight:bold;color:#004687;border-top:2px solid #004687;font-size:10pt;padding:10px 8px}
</style></head><body>
<table>
  <tr><td colspan="${cols.length}" class="title-bar">HOSPITAL ESCANDÓN</td></tr>
  <tr><td colspan="${cols.length}" class="subtitle-bar">Reporte de Existencias — Almacén Quirófano (${whsLabel})</td></tr>
  <tr class="info-row"><td colspan="${cols.length}">Almacén: ${whsLabel} &nbsp;|&nbsp; Búsqueda: ${searchQuery ? `"${searchQuery}"` : 'TODOS'} &nbsp;|&nbsp; Registros: ${filteredStock.length} &nbsp;|&nbsp; Generado: ${fechaReporte}</td></tr>
  <tr><td colspan="${cols.length}" style="height:6px;border:none"></td></tr>
  <tr>${cols.map(c => `<th style="width:${c.width}px">${c.header}</th>`).join('')}</tr>
  ${filteredStock.map((row, i) => {
    const stock = Number(row.QuantityOnStock) || 0;
    const price = Number(row.SalesPrice) || 0;
    const totalVal = stock * price;
    const whsText = row.WhsCode === 'QXCR' ? 'QXCR (Carro Rojo)' : 'QX (General)';
    return `<tr class="${i % 2 === 0 ? 'even' : 'odd'}">
      <td class="code">${row.ItemCode || ''}</td>
      <td>${String(row.ItemName || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>
      <td style="text-align:center" class="${row.WhsCode === 'QXCR' ? 'qxcr' : 'qx'}">${whsText}</td>
      <td style="text-align:right;font-weight:bold">${stock.toLocaleString('es-MX')}</td>
      <td class="money">$${price.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      <td class="money">$${totalVal.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      <td>${row.ItemGroupName || 'General'}</td>
    </tr>`;
  }).join('')}
  <tr class="total-row">
    <td colspan="3" style="text-align:right">TOTALES</td>
    <td style="text-align:right">${totalPiezas.toLocaleString('es-MX')}</td>
    <td></td>
    <td style="text-align:right">$${totalValor.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
    <td></td>
  </tr>
</table></body></html>`;

      const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Stock_Almacen_Quirofano_${warehouseFilter}_${new Date().toISOString().slice(0, 10)}.xls`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } else {
      if (filteredMovements.length === 0) {
        alert('No hay registros de movimientos para exportar con los filtros seleccionados.');
        return;
      }

      const tipoTabTitle = subTab === 'salidas' ? 'Salidas a Pacientes' : 'Devoluciones y Retornos QX';
      const totalPiezasMov = filteredMovements.reduce((acc, m) => acc + (Number(m.Cantidad) || 0), 0);

      const cols = [
        { header: 'Fecha', key: 'Fecha', width: 140 },
        { header: 'Folio Quirófano', key: 'Folio', width: 120, align: 'center' },
        { header: 'Paciente', key: 'Paciente', width: 220 },
        { header: 'Procedimiento', key: 'Procedimiento', width: 240 },
        { header: 'Médico / Equipo', key: 'Medicos', width: 200 },
        { header: 'Código', key: 'Codigo', width: 110, align: 'center' },
        { header: 'Insumo', key: 'Medicamento', width: 260 },
        { header: 'Almacén', key: 'Almacen', width: 100, align: 'center' },
        { header: 'Tipo', key: 'TipoMovimiento', width: 130, align: 'center' },
        { header: 'Cantidad', key: 'Cantidad', width: 100, align: 'right', type: 'num' }
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
  .salida{color:#15803D;font-weight:bold;text-align:right}
  .devolucion{color:#DC2626;font-weight:bold;text-align:right}
  .code{color:#005FA9;font-weight:bold;text-align:center}
  .total-row td{background:#E0EAF4;font-weight:bold;color:#004687;border-top:2px solid #004687;font-size:10pt;padding:10px 8px}
</style></head><body>
<table>
  <tr><td colspan="${cols.length}" class="title-bar">HOSPITAL ESCANDÓN</td></tr>
  <tr><td colspan="${cols.length}" class="subtitle-bar">Reporte de Movimientos — Almacén Quirófano (${tipoTabTitle})</td></tr>
  <tr class="info-row"><td colspan="${cols.length}">Período: Últimos ${daysFilter} días &nbsp;|&nbsp; Almacén: ${whsLabel} &nbsp;|&nbsp; Búsqueda: ${searchQuery ? `"${searchQuery}"` : 'TODOS'} &nbsp;|&nbsp; Registros: ${filteredMovements.length} &nbsp;|&nbsp; Generado: ${fechaReporte}</td></tr>
  <tr><td colspan="${cols.length}" style="height:6px;border:none"></td></tr>
  <tr>${cols.map(c => `<th style="width:${c.width}px">${c.header}</th>`).join('')}</tr>
  ${filteredMovements.map((m, i) => {
    const fechaStr = m.Fecha ? new Date(m.Fecha).toLocaleString('es-MX') : '';
    const folioStr = `Folio #${m.PCFRNum || m.PCNum || ''}`;
    const esDevolucion = m.Cantidad < 0;
    return `<tr class="${i % 2 === 0 ? 'even' : 'odd'}">
      <td style="white-space:nowrap">${fechaStr}</td>
      <td style="text-align:center;font-weight:bold;color:#005FA9">${folioStr}</td>
      <td style="font-weight:bold">${String(m.Paciente || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>
      <td>${String(m.Procedimiento || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>
      <td>${String(m.Medicos || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>
      <td class="code">${m.Codigo || ''}</td>
      <td>${String(m.Medicamento || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>
      <td style="text-align:center">${m.Almacen || 'QX'}</td>
      <td style="text-align:center;font-weight:bold;color:${esDevolucion ? '#DC2626' : '#15803D'}">${esDevolucion ? 'DEVOLUCIÓN' : 'SALIDA CARGO'}</td>
      <td class="${esDevolucion ? 'devolucion' : 'salida'}">${m.Cantidad > 0 ? `+${m.Cantidad}` : m.Cantidad}</td>
    </tr>`;
  }).join('')}
  <tr class="total-row">
    <td colspan="9" style="text-align:right">TOTAL PIEZAS</td>
    <td style="text-align:right;font-weight:bold;color:${totalPiezasMov < 0 ? '#DC2626' : '#15803D'}">${totalPiezasMov > 0 ? `+${totalPiezasMov}` : totalPiezasMov}</td>
  </tr>
</table></body></html>`;

      const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Movimientos_Almacen_Quirofano_${subTab}_${new Date().toISOString().slice(0, 10)}.xls`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Banner de bienvenida e indicador del Almacén Quirófano */}
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
            <span>🏥</span> Almacén Quirófano (QX / QXCR — Carro Rojo)
          </h2>
          <p style={{ margin: '0.4rem 0 0 0', color: '#E0F2FE', fontSize: '0.95rem', fontWeight: 500 }}>
            Gestión en tiempo real de insumos en stock, cargos a cirugías y registro de devoluciones/retornos.
          </p>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
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
            onClick={() => subTab === 'inventory' ? fetchStock() : fetchMovements()}
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
              transition: 'all 0.2s ease',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.28)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.18)'; }}
          >
            🔄 Actualizar Datos
          </button>
        </div>
      </div>

      {/* Tarjetas resumen de estadísticas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
        <div 
          onClick={() => {
            setWarehouseFilter('ALL');
            setSubTab('inventory');
          }}
          style={{ 
            background: warehouseFilter === 'ALL' && subTab === 'inventory' ? '#F0F9FF' : '#FFFFFF', 
            border: warehouseFilter === 'ALL' && subTab === 'inventory' ? '2px solid #0077B6' : '1px solid #E2E8F0', 
            borderRadius: '14px', 
            padding: '1.25rem', 
            boxShadow: '0 2px 8px rgba(0, 70, 135, 0.05)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            position: 'relative'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(0, 119, 182, 0.12)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 70, 135, 0.05)'; }}
          title="Clic para ver todos los artículos de Quirófano (QX y QXCR)"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ fontSize: '0.78rem', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700 }}>Artículos en Stock</div>
            {warehouseFilter === 'ALL' && subTab === 'inventory' && (
              <span style={{ fontSize: '0.7rem', background: '#0077B6', color: '#FFFFFF', padding: '0.15rem 0.5rem', borderRadius: '9999px', fontWeight: 700 }}>TODOS</span>
            )}
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#0077B6', marginTop: '0.25rem' }}>
            {stockStats.totalItems || 0}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#94A3B8', marginTop: '0.25rem', fontWeight: 500 }}>Con existencia disponible en QX/QXCR</div>
        </div>

        <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', padding: '1.25rem', boxShadow: '0 2px 8px rgba(0, 70, 135, 0.05)' }}>
          <div style={{ fontSize: '0.78rem', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700 }}>Total Piezas Físicas</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#059669', marginTop: '0.25rem' }}>
            {(stockStats.totalStock || 0).toLocaleString()}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#94A3B8', marginTop: '0.25rem', fontWeight: 500 }}>Insumos físicos en anaqueles</div>
        </div>

        <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', padding: '1.25rem', boxShadow: '0 2px 8px rgba(0, 70, 135, 0.05)' }}>
          <div style={{ fontSize: '0.78rem', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700 }}>Valor Total Stock</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#D97706', marginTop: '0.25rem' }}>
            ${(stockStats.totalValue || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#94A3B8', marginTop: '0.25rem', fontWeight: 500 }}>Valuación de inventario en anaqueles</div>
        </div>

        <div 
          onClick={() => {
            if (warehouseFilter === 'QXCR' && subTab === 'inventory') {
              setWarehouseFilter('ALL');
            } else {
              setWarehouseFilter('QXCR');
              setSubTab('inventory');
            }
          }}
          style={{ 
            background: warehouseFilter === 'QXCR' && subTab === 'inventory' ? '#FEF2F2' : '#FFFFFF', 
            border: warehouseFilter === 'QXCR' && subTab === 'inventory' ? '2px solid #DC2626' : '1px solid #E2E8F0', 
            borderRadius: '14px', 
            padding: '1.25rem', 
            boxShadow: warehouseFilter === 'QXCR' && subTab === 'inventory' ? '0 4px 14px rgba(220, 38, 38, 0.15)' : '0 2px 8px rgba(0, 70, 135, 0.05)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            position: 'relative'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(220, 38, 38, 0.18)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = warehouseFilter === 'QXCR' && subTab === 'inventory' ? '0 4px 14px rgba(220, 38, 38, 0.15)' : '0 2px 8px rgba(0, 70, 135, 0.05)'; }}
          title="Clic para filtrar y ver los artículos de Quirófano Carro Rojo (QXCR)"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ fontSize: '0.78rem', color: warehouseFilter === 'QXCR' && subTab === 'inventory' ? '#991B1B' : '#64748B', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700 }}>
              Quirófano Carro Rojo
            </div>
            <span style={{ 
              fontSize: '0.7rem', 
              background: warehouseFilter === 'QXCR' && subTab === 'inventory' ? '#DC2626' : '#FEE2E2', 
              color: warehouseFilter === 'QXCR' && subTab === 'inventory' ? '#FFFFFF' : '#DC2626', 
              padding: '0.2rem 0.55rem', 
              borderRadius: '9999px', 
              fontWeight: 700 
            }}>
              {warehouseFilter === 'QXCR' && subTab === 'inventory' ? '✓ FILTRADO' : '🔍 VER LISTA'}
            </span>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#DC2626', marginTop: '0.25rem' }}>
            {stockStats.qxcrCount || 0} artículos
          </div>
          <div style={{ fontSize: '0.8rem', color: warehouseFilter === 'QXCR' && subTab === 'inventory' ? '#B91C1C' : '#94A3B8', marginTop: '0.25rem', fontWeight: 500 }}>
            {warehouseFilter === 'QXCR' && subTab === 'inventory' ? 'Mostrando insumos QXCR en tabla ↓' : 'Almacén QXCR (Insumos Carro de Paro)'}
          </div>
        </div>
      </div>

      {/* Pestañas secundarias de navegación interna de Almacén QX */}
      <div style={{ display: 'flex', gap: '0.5rem', background: '#F1F5F9', padding: '0.35rem', borderRadius: '12px', width: 'fit-content', flexWrap: 'wrap' }}>
        <button
          onClick={() => setSubTab('inventory')}
          style={{
            padding: '0.6rem 1.25rem',
            background: subTab === 'inventory' ? '#FFFFFF' : 'transparent',
            color: subTab === 'inventory' ? '#004687' : '#64748B',
            border: 'none',
            borderRadius: '9px',
            fontWeight: subTab === 'inventory' ? 800 : 600,
            cursor: 'pointer',
            fontSize: '0.9rem',
            boxShadow: subTab === 'inventory' ? '0 2px 6px rgba(0,0,0,0.08)' : 'none',
            transition: 'all 0.2s ease'
          }}
        >
          📦 Stock Actual ({filteredStock.length})
        </button>

        <button
          onClick={() => setSubTab('salidas')}
          style={{
            padding: '0.6rem 1.25rem',
            background: subTab === 'salidas' ? '#FFFFFF' : 'transparent',
            color: subTab === 'salidas' ? '#059669' : '#64748B',
            border: 'none',
            borderRadius: '9px',
            fontWeight: subTab === 'salidas' ? 800 : 600,
            cursor: 'pointer',
            fontSize: '0.9rem',
            boxShadow: subTab === 'salidas' ? '0 2px 6px rgba(0,0,0,0.08)' : 'none',
            transition: 'all 0.2s ease'
          }}
        >
          📤 Salidas a Pacientes {subTab === 'salidas' && !loadingMovements ? `(${filteredMovements.length})` : ''}
        </button>

        <button
          onClick={() => setSubTab('devoluciones')}
          style={{
            padding: '0.6rem 1.25rem',
            background: subTab === 'devoluciones' ? '#FFFFFF' : 'transparent',
            color: subTab === 'devoluciones' ? '#DC2626' : '#64748B',
            border: 'none',
            borderRadius: '9px',
            fontWeight: subTab === 'devoluciones' ? 800 : 600,
            cursor: 'pointer',
            fontSize: '0.9rem',
            boxShadow: subTab === 'devoluciones' ? '0 2px 6px rgba(0,0,0,0.08)' : 'none',
            transition: 'all 0.2s ease'
          }}
        >
          🔄 Devoluciones y Retornos QX {subTab === 'devoluciones' && !loadingMovements ? `(${filteredMovements.length})` : ''}
        </button>
      </div>

      {/* Barra de Filtros y Búsqueda */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', background: '#FFFFFF', padding: '1rem 1.25rem', borderRadius: '14px', border: '1px solid #E2E8F0', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
        <div style={{ flex: 1, minWidth: '240px' }}>
          <input
            type="text"
            placeholder="🔍 Buscar por código, medicamento, paciente, médico o procedimiento..."
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

        <div>
          <select
            value={warehouseFilter}
            onChange={(e) => setWarehouseFilter(e.target.value)}
            style={{
              padding: '0.65rem 1rem',
              background: '#F8FAFC',
              border: '1px solid #CBD5E1',
              borderRadius: '8px',
              color: '#0F172A',
              fontWeight: 600,
              fontSize: '0.9rem',
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value="ALL">🏢 Todos los almacenes QX</option>
            <option value="QX">QX — Quirófano General</option>
            <option value="QXCR">QXCR — Quirófano Carro Rojo</option>
          </select>
        </div>

        {(subTab === 'salidas' || subTab === 'devoluciones') && (
          <div>
            <select
              value={daysFilter}
              onChange={(e) => setDaysFilter(Number(e.target.value))}
              style={{
                padding: '0.65rem 1rem',
                background: '#F8FAFC',
                border: '1px solid #CBD5E1',
                borderRadius: '8px',
                color: '#0F172A',
                fontWeight: 600,
                fontSize: '0.9rem',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value={7}>📅 Últimos 7 días</option>
              <option value={30}>📅 Últimos 30 días</option>
              <option value={90}>📅 Últimos 90 días</option>
              <option value={180}>📅 Últimos 180 días</option>
            </select>
          </div>
        )}
      </div>

      {/* VISTA 1: STOCK ACTUAL */}
      {subTab === 'inventory' && (
        <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.04)' }}>
          {loadingStock ? (
            <div style={{ padding: '3.5rem', textAlign: 'center', color: '#64748B', fontWeight: 600, fontSize: '1rem' }}>⏳ Cargando existencias en Almacén Quirófano…</div>
          ) : filteredStock.length === 0 ? (
            <div style={{ padding: '3.5rem', textAlign: 'center', color: '#64748B', fontWeight: 600, fontSize: '1rem' }}>⚠️ No se encontraron artículos con el filtro seleccionado.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: '#F8FAFC', borderBottom: '2px solid #E2E8F0' }}>
                    <th style={{ padding: '0.9rem 1.25rem', color: '#475569', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Código</th>
                    <th style={{ padding: '0.9rem 1.25rem', color: '#475569', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Descripción / Insumo</th>
                    <th style={{ padding: '0.9rem 1.25rem', color: '#475569', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Almacén</th>
                    <th style={{ padding: '0.9rem 1.25rem', textAlign: 'right', color: '#475569', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Stock Físico</th>
                    <th style={{ padding: '0.9rem 1.25rem', textAlign: 'right', color: '#475569', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Precio Unit.</th>
                    <th style={{ padding: '0.9rem 1.25rem', textAlign: 'right', color: '#475569', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Valor Total ($)</th>
                    <th style={{ padding: '0.9rem 1.25rem', color: '#475569', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Grupo SAP</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStock.map((item, idx) => (
                    <tr
                      key={`${item.ItemCode}-${item.WhsCode}-${idx}`}
                      style={{
                        borderBottom: '1px solid #F1F5F9',
                        background: idx % 2 === 0 ? '#FFFFFF' : '#FBFDFF',
                        transition: 'background 0.15s ease'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#F0F7FF'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = idx % 2 === 0 ? '#FFFFFF' : '#FBFDFF'; }}
                    >
                      <td style={{ padding: '0.85rem 1.25rem', fontWeight: 700, color: '#005FA9' }}>{item.ItemCode}</td>
                      <td style={{ padding: '0.85rem 1.25rem', fontWeight: 600, color: '#0F172A' }}>{item.ItemName}</td>
                      <td style={{ padding: '0.85rem 1.25rem' }}>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '0.3rem 0.75rem',
                          borderRadius: '9999px',
                          fontSize: '0.78rem',
                          fontWeight: 700,
                          whiteSpace: 'nowrap',
                          background: item.WhsCode === 'QXCR' ? '#FEE2E2' : '#EFF6FF',
                          color: item.WhsCode === 'QXCR' ? '#DC2626' : '#1D4ED8',
                          border: item.WhsCode === 'QXCR' ? '1px solid #FECACA' : '1px solid #BFDBFE'
                        }}>
                          {item.WhsCode === 'QXCR' ? '🚨 QXCR (Carro Rojo)' : '🏥 QX (General)'}
                        </span>
                      </td>
                      <td style={{ padding: '0.85rem 1.25rem', textAlign: 'right', fontWeight: 800, fontSize: '1rem', color: item.QuantityOnStock > 5 ? '#15803D' : '#D97706' }}>
                        {item.QuantityOnStock}
                      </td>
                      <td style={{ padding: '0.85rem 1.25rem', textAlign: 'right', fontWeight: 600, color: '#334155' }}>
                        ${(item.SalesPrice || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '0.85rem 1.25rem', textAlign: 'right', fontWeight: 800, color: '#0F172A' }}>
                        ${((item.QuantityOnStock || 0) * (item.SalesPrice || 0)).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '0.85rem 1.25rem', color: '#64748B', fontSize: '0.85rem', fontWeight: 500 }}>
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
        <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.04)' }}>
          {loadingMovements ? (
            <div style={{ padding: '3.5rem', textAlign: 'center', color: '#64748B', fontWeight: 600, fontSize: '1rem' }}>⏳ Cargando historial de movimientos de Quirófano…</div>
          ) : filteredMovements.length === 0 ? (
            <div style={{ padding: '3.5rem', textAlign: 'center', color: '#64748B', fontWeight: 600, fontSize: '1rem' }}>⚠️ No hay registros de movimientos en el periodo seleccionado.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: '#F8FAFC', borderBottom: '2px solid #E2E8F0' }}>
                    <th style={{ padding: '0.9rem 1.25rem', color: '#475569', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Fecha</th>
                    <th style={{ padding: '0.9rem 1.25rem', color: '#475569', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Folio Quirófano</th>
                    <th style={{ padding: '0.9rem 1.25rem', color: '#475569', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Paciente</th>
                    <th style={{ padding: '0.9rem 1.25rem', color: '#475569', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Procedimiento</th>
                    <th style={{ padding: '0.9rem 1.25rem', color: '#475569', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Médico / Equipo</th>
                    <th style={{ padding: '0.9rem 1.25rem', color: '#475569', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Insumo</th>
                    <th style={{ padding: '0.9rem 1.25rem', textAlign: 'center', color: '#475569', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Tipo</th>
                    <th style={{ padding: '0.9rem 1.25rem', textAlign: 'right', color: '#475569', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Cantidad</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMovements.map((m, idx) => (
                    <tr
                      key={`${m.PCNum}-${m.Codigo}-${idx}`}
                      style={{
                        borderBottom: '1px solid #F1F5F9',
                        background: idx % 2 === 0 ? '#FFFFFF' : '#FBFDFF',
                        transition: 'background 0.15s ease'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#F0F7FF'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = idx % 2 === 0 ? '#FFFFFF' : '#FBFDFF'; }}
                    >
                      <td style={{ padding: '0.85rem 1.25rem', color: '#475569', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {new Date(m.Fecha).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td style={{ padding: '0.85rem 1.25rem', fontWeight: 700, color: '#005FA9' }}>
                        Folio #{m.PCFRNum || m.PCNum}
                      </td>
                      <td style={{ padding: '0.85rem 1.25rem', fontWeight: 700, color: '#0F172A' }}>
                        {m.Paciente}
                      </td>
                      <td style={{ padding: '0.85rem 1.25rem', color: '#334155', fontWeight: 500 }}>
                        {m.Procedimiento}
                      </td>
                      <td style={{ padding: '0.85rem 1.25rem', color: '#64748B', fontWeight: 500, fontSize: '0.85rem' }}>
                        {m.Medicos}
                      </td>
                      <td style={{ padding: '0.85rem 1.25rem' }}>
                        <span style={{ fontWeight: 700, color: '#005FA9' }}>{m.Codigo}</span>
                        <span style={{ color: '#94A3B8', margin: '0 0.35rem' }}>—</span>
                        <span style={{ fontWeight: 600, color: '#0F172A' }}>{m.Medicamento}</span>
                      </td>
                      <td style={{ padding: '0.85rem 1.25rem', textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          padding: '0.35rem 0.8rem',
                          borderRadius: '9999px',
                          fontSize: '0.78rem',
                          fontWeight: 700,
                          whiteSpace: 'nowrap',
                          background: m.Cantidad < 0 ? '#FEE2E2' : '#DCFCE7',
                          color: m.Cantidad < 0 ? '#DC2626' : '#15803D',
                          border: m.Cantidad < 0 ? '1px solid #FECACA' : '1px solid #BBF7D0'
                        }}>
                          <span>{m.Cantidad < 0 ? '🔄' : '📤'}</span>
                          <span>{m.Cantidad < 0 ? 'DEVOLUCIÓN' : 'SALIDA CARGO'}</span>
                        </span>
                      </td>
                      <td style={{
                        padding: '0.85rem 1.25rem',
                        textAlign: 'right',
                        fontWeight: 800,
                        fontSize: '1.05rem',
                        color: m.Cantidad < 0 ? '#DC2626' : '#16A34A'
                      }}>
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
