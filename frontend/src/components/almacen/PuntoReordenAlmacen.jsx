import React, { useState, useEffect, useMemo } from 'react';
import { API_BASE } from '../../api/config';
import { authHeaders } from '../../api/auth';

export default function PuntoReordenAlmacen() {
  const [activeTab, setActiveTab] = useState('reorden'); // 'reorden' | 'pedidos'
  const [items, setItems] = useState([]);
  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingPedidos, setLoadingPedidos] = useState(false);
  const [error, setError] = useState(null);
  
  // Filtros
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL'); // ALL | CRITICO | REORDEN | OPTIMO | CON_PEDIDO | CON_NOTA

  // Modal para editar Min/Max, Notita y Solicitud Compra
  const [editingItem, setEditingItem] = useState(null);
  const [minInput, setMinInput] = useState(0);
  const [maxInput, setMaxInput] = useState(0);
  const [noteInput, setNoteInput] = useState('');
  const [solicitudInput, setSolicitudInput] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Edición Inline rápida de Solicitud Compra
  const [inlineEditCode, setInlineEditCode] = useState(null);
  const [inlineSolicitudVal, setInlineSolicitudVal] = useState('');

  // Modal para ver detalle de Pedidos SAP de un SKU
  const [selectedItemOrders, setSelectedItemOrders] = useState(null);

  useEffect(() => {
    fetchReorderData();
    fetchPedidosData();
  }, []);

  const fetchReorderData = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${API_BASE}/almacen/punto-reorden`, {
        headers: authHeaders()
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Error al obtener punto de reorden');
      setItems(json.data || []);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchPedidosData = async () => {
    try {
      setLoadingPedidos(true);
      const res = await fetch(`${API_BASE}/almacen/pedidos-sap`, {
        headers: authHeaders()
      });
      const json = await res.json();
      if (res.ok && json.ok) {
        setPedidos(json.data || []);
      }
    } catch (err) {
      console.error('Error al cargar pedidos SAP:', err);
    } finally {
      setLoadingPedidos(false);
    }
  };

  const handleOpenEdit = (item) => {
    setEditingItem(item);
    setMinInput(item.MinStock || 0);
    setMaxInput(item.MaxStock || 0);
    setNoteInput(item.Note || '');
    setSolicitudInput(item.SolicitudCompra || 0);
  };

  const handleSaveEdit = async (customValOverride = undefined) => {
    if (!editingItem) return;
    try {
      setSavingNote(true);
      const valToSend = customValOverride !== undefined ? customValOverride : solicitudInput;
      const res = await fetch(`${API_BASE}/almacen/punto-reorden/${encodeURIComponent(editingItem.ItemCode)}`, {
        method: 'PUT',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          minStock: parseInt(minInput) || 0,
          maxStock: parseInt(maxInput) || 0,
          note: noteInput.trim(),
          customSolicitud: valToSend === '' || valToSend === 'RESET' ? null : parseInt(valToSend)
        })
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Error al guardar notita');

      // Actualizar estado local
      setItems(prev => prev.map(i => {
        if (i.ItemCode === editingItem.ItemCode) {
          const newMin = parseInt(minInput) || 0;
          const newMax = parseInt(maxInput) || 0;
          const stock = i.StockActual || 0;
          const isReset = valToSend === '' || valToSend === 'RESET';
          const sug = !isReset ? parseInt(valToSend) : ((stock <= newMin && newMax > 0) ? Math.max(0, newMax - stock) : 0);
          
          let newEst = 'OPTIMO';
          if (stock === 0 && newMin > 0) newEst = 'CRITICO';
          else if (stock <= newMin && newMin > 0) newEst = 'REORDEN';
          else if (stock > newMax && newMax > 0) newEst = 'SOBRESTOCK';

          return {
            ...i,
            MinStock: newMin,
            MaxStock: newMax,
            CalculoPromedio: newMax - stock,
            SolicitudCompra: sug,
            EsPersonalizada: !isReset,
            Estatus: newEst,
            Note: noteInput.trim()
          };
        }
        return i;
      }));

      setEditingItem(null);
    } catch (err) {
      alert('Error guardando cambios: ' + err.message);
    } finally {
      setSavingNote(false);
    }
  };

  // Guardar rápido edicion inline en celda Solicitud Compra
  const handleSaveInlineSolicitud = async (item, newQty) => {
    try {
      const parsedVal = newQty === '' || newQty === 'RESET' ? null : Math.max(0, parseInt(newQty) || 0);
      const res = await fetch(`${API_BASE}/almacen/punto-reorden/${encodeURIComponent(item.ItemCode)}`, {
        method: 'PUT',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          customSolicitud: parsedVal
        })
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Error al guardar solicitud');

      setItems(prev => prev.map(i => {
        if (i.ItemCode === item.ItemCode) {
          const stock = i.StockActual || 0;
          const minStock = i.MinStock || 0;
          const maxStock = i.MaxStock || 0;
          const sug = parsedVal !== null ? parsedVal : ((stock <= minStock && maxStock > 0) ? Math.max(0, maxStock - stock) : 0);
          return {
            ...i,
            SolicitudCompra: sug,
            EsPersonalizada: parsedVal !== null
          };
        }
        return i;
      }));
      setInlineEditCode(null);
    } catch (err) {
      alert('Error al guardar solicitud: ' + err.message);
    }
  };

  // Filtrado de items
  const filteredItems = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    return items.filter(item => {
      // Filtro de texto
      const matchText = !term || 
        (item.ItemCode && item.ItemCode.toLowerCase().includes(term)) ||
        (item.ItemDescription && item.ItemDescription.toLowerCase().includes(term)) ||
        (item.Note && item.Note.toLowerCase().includes(term));

      if (!matchText) return false;

      // Filtro por Estatus
      if (statusFilter === 'CRITICO') return item.Estatus === 'CRITICO' || item.Estatus === 'REORDEN';
      if (statusFilter === 'OPTIMO') return item.Estatus === 'OPTIMO';
      if (statusFilter === 'CON_PEDIDO') return item.PedidosEnCurso && item.PedidosEnCurso.length > 0;
      if (statusFilter === 'CON_NOTA') return !!item.Note && item.Note.trim() !== '';

      return true;
    });
  }, [items, searchTerm, statusFilter]);

  // KPIs
  const stats = useMemo(() => {
    let reordenCount = 0;
    let criticoCount = 0;
    let pedidosCount = 0;
    let totalImporteSugerido = 0;

    items.forEach(i => {
      if (i.SolicitudCompra > 0) {
        reordenCount++;
        totalImporteSugerido += (i.ImporteSugerido || 0);
      }
      if (i.Estatus === 'CRITICO') criticoCount++;
      if (i.PedidosEnCurso && i.PedidosEnCurso.length > 0) pedidosCount++;
    });

    return { reordenCount, criticoCount, pedidosCount, totalImporteSugerido };
  }, [items]);

  const exportToExcel = () => {
    const fechaReporte = new Date().toLocaleString('es-MX');
    const rowsToExport = filteredItems;
    
    let html = `
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:spreadsheet" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<style>
  body{font-family:Calibri,Arial,sans-serif}table{border-collapse:collapse;width:100%;}
  .title-bar{background:#004687;color:#fff;font-size:16pt;font-weight:bold;padding:12px 16px}
  .subtitle-bar{background:#0088C9;color:#fff;font-size:12pt;font-weight:bold;padding:8px 16px}
  th{background:#004687;color:#fff;font-weight:bold;font-size:10pt;padding:10px 8px;border:1px solid #003366;text-align:center}
  td{padding:7px 8px;font-size:9pt;border:1px solid #D1D5DB;color:#1E293B}
  .sugerido{background:#22c55e;color:#ffffff;font-weight:bold;text-align:center}
  .critico{color:#dc2626;font-weight:bold;}
  .pedido{color:#0284c7;font-weight:bold;}
</style></head><body>
<table>
  <tr><td colspan="9" class="title-bar">HOSPITAL ESCANDÓN - PLATAFORMA BI</td></tr>
  <tr><td colspan="9" class="subtitle-bar">Control de Inventario - Punto de Reorden y Pedidos SAP</td></tr>
  <tr><td colspan="9" style="font-size:9pt;color:#64748b;padding:6px 0">Fecha de reporte: ${fechaReporte} | Insumos Requeridos: ${stats.reordenCount}</td></tr>
  <tr>
    <th>CODIGO SAP</th>
    <th>DESCRIPCION DE MATERIAL</th>
    <th>INSUMOS MINIMOS</th>
    <th>INSUMOS MAXIMOS</th>
    <th>EXISTENCIAS SISTEMA</th>
    <th>CALCULO PROMEDIO</th>
    <th>SOLICITUD COMPRA</th>
    <th>PEDIDOS SAP EN CURSO</th>
    <th>NOTAS DE ALMACEN</th>
  </tr>
  ${rowsToExport.map(r => {
    const pedidosStr = (r.PedidosEnCurso || []).map(p => `${p.tipo} #${p.folio} (${p.cantPendiente} pzas por ${p.usuario})`).join('; ');
    return `<tr>
      <td>${r.ItemCode}</td>
      <td>${r.ItemDescription}</td>
      <td style="text-align:center">${r.MinStock}</td>
      <td style="text-align:center">${r.MaxStock}</td>
      <td style="text-align:center" class="${r.StockActual <= r.MinStock ? 'critico' : ''}">${r.StockActual}</td>
      <td style="text-align:center">${r.CalculoPromedio}</td>
      <td class="${r.SolicitudCompra > 0 ? 'sugerido' : ''}">${r.SolicitudCompra > 0 ? r.SolicitudCompra : ''}</td>
      <td class="pedido">${pedidosStr || 'Sin pedidos'}</td>
      <td>${r.Note || ''}</td>
    </tr>`;
  }).join('')}
</table></body></html>`;

    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Punto_de_Reorden_Almacen_${new Date().toISOString().slice(0,10)}.xls`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '1450px', margin: '0 auto', fontFamily: 'Inter, sans-serif' }}>
      
      {/* Estilos dinámicos para soporte de tema claro/oscuro */}
      <style>{`
        /* KPIs */
        .reorder-kpi-card {
          background: var(--color-bg-white, white) !important;
          border: 1px solid var(--border-color, #e2e8f0) !important;
          box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05) !important;
          padding: 1.25rem !important;
          border-radius: 12px !important;
          transition: transform var(--transition-base), box-shadow var(--transition-base);
        }
        .reorder-kpi-card:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-md) !important;
        }

        /* Pulsación de carga premium */
        .skeleton-pulse {
          display: inline-block;
          height: 2.2rem;
          background: rgba(226, 232, 240, 0.4);
          border-radius: 6px;
          animation: skeletonPulse 1.5s ease-in-out infinite;
          vertical-align: middle;
        }
        [data-theme="dark"] .skeleton-pulse {
          background: rgba(255, 255, 255, 0.08);
        }
        @keyframes skeletonPulse {
          0% { opacity: 0.5; }
          50% { opacity: 1; }
          100% { opacity: 0.5; }
        }

        /* Pestañas */
        .tabs-container {
          display: flex;
          gap: 0.5rem;
          background: var(--color-bg-base, #f1f5f9) !important;
          padding: 0.3rem !important;
          border-radius: 10px !important;
          border: 1px solid var(--border-color, #cbd5e1) !important;
        }
        .tab-btn {
          padding: 0.6rem 1.25rem;
          border-radius: 8px;
          border: none;
          font-weight: bold;
          cursor: pointer;
          font-size: 0.9rem;
          transition: all 0.2s;
          background: transparent;
          color: var(--text-secondary, #64748b);
        }
        .tab-btn.active {
          background: var(--text-primary, #0f172a) !important;
          color: var(--color-bg-white, white) !important;
        }

        /* Tarjetas de Pedido SAP */
        .sap-pedido-card-po {
          border: 1px solid #bae6fd !important;
          background: linear-gradient(135deg, #f0f9ff 0%, #ffffff 100%) !important;
          color: #0f172a !important;
          border-radius: 12px;
          padding: 1.25rem;
          box-shadow: 0 4px 10px rgba(0,0,0,0.03);
          transition: transform var(--transition-base), box-shadow var(--transition-base);
        }
        .sap-pedido-card-po:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 20px rgba(2, 132, 199, 0.15);
        }
        [data-theme="dark"] .sap-pedido-card-po {
          border: 1px solid rgba(56, 189, 248, 0.25) !important;
          background: linear-gradient(135deg, rgba(3, 105, 161, 0.15) 0%, rgba(15, 23, 42, 0.4) 100%) !important;
          color: #f1f5f9 !important;
          box-shadow: 0 4px 20px rgba(0,0,0,0.25);
        }
        [data-theme="dark"] .sap-pedido-card-po:hover {
          border-color: rgba(56, 189, 248, 0.4) !important;
          box-shadow: 0 10px 30px rgba(2, 132, 199, 0.25);
        }

        .sap-pedido-card-pr {
          border: 1px solid #fef08a !important;
          background: linear-gradient(135deg, #fefce8 0%, #ffffff 100%) !important;
          color: #0f172a !important;
          border-radius: 12px;
          padding: 1.25rem;
          box-shadow: 0 4px 10px rgba(0,0,0,0.03);
          transition: transform var(--transition-base), box-shadow var(--transition-base);
        }
        .sap-pedido-card-pr:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 20px rgba(202, 138, 4, 0.15);
        }
        [data-theme="dark"] .sap-pedido-card-pr {
          border: 1px solid rgba(234, 179, 8, 0.25) !important;
          background: linear-gradient(135deg, rgba(202, 138, 4, 0.15) 0%, rgba(15, 23, 42, 0.4) 100%) !important;
          color: #f1f5f9 !important;
          box-shadow: 0 4px 20px rgba(0,0,0,0.25);
        }
        [data-theme="dark"] .sap-pedido-card-pr:hover {
          border-color: rgba(234, 179, 8, 0.4) !important;
          box-shadow: 0 10px 30px rgba(202, 138, 4, 0.25);
        }

        /* Modals */
        .reorder-modal-content {
          background: var(--color-bg-white, white) !important;
          color: var(--text-primary, #0f172a) !important;
          border: 1px solid var(--border-color, #e2e8f0) !important;
          box-shadow: var(--shadow-xl, 0 25px 50px -12px rgba(0,0,0,0.25)) !important;
        }

        .reorder-input-field {
          width: 100%;
          padding: 0.65rem;
          border-radius: 8px;
          border: 1px solid var(--border-color, #cbd5e1) !important;
          background: var(--input-bg, white) !important;
          color: var(--text-primary, #0f172a) !important;
          font-size: 1rem;
          outline: none;
        }
        .reorder-input-field:focus {
          border-color: #0284c7 !important;
        }
      `}</style>
      
      {/* Encabezado */}
      <header style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '2rem', color: 'var(--text-primary, #0f172a)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '2.4rem' }}>📋</span> Punto de Reorden y Pedidos SAP
          </h1>
          <p style={{ margin: '0.35rem 0 0 0', color: 'var(--text-secondary, #64748b)', fontSize: '0.95rem' }}>
            Auditoría de mínimos/máximos, alertas automáticas, notas operativas y prevención de pedidos duplicados.
          </p>
        </div>

        {/* Nivel de Pestañas Superior */}
        <div className="tabs-container">
          <button
            onClick={() => setActiveTab('reorden')}
            className={`tab-btn ${activeTab === 'reorden' ? 'active' : ''}`}
          >
            📦 Matriz de Reorden ({items.length})
          </button>
          <button
            onClick={() => setActiveTab('pedidos')}
            className={`tab-btn ${activeTab === 'pedidos' ? 'active' : ''}`}
          >
            🚚 Pedidos SAP en Curso ({pedidos.length})
          </button>
        </div>
      </header>

      {error && (
        <div style={{ padding: '1rem', background: '#fef2f2', borderLeft: '4px solid #ef4444', color: '#991b1b', marginBottom: '2rem', borderRadius: '8px' }}>
          <strong>Error de Carga: </strong> {error}
        </div>
      )}

      {/* KPI Cards Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.25rem', marginBottom: '2rem' }}>
        
        <div className="reorder-kpi-card" style={{ borderTop: '4px solid #ef4444' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-secondary, #64748b)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Requieren Solicitud</span>
          <div style={{ fontSize: '2.2rem', fontWeight: '800', color: 'var(--text-primary, #dc2626)', marginTop: '0.2rem' }}>
            {loading ? (
              <span className="skeleton-pulse" style={{ width: '70px' }}></span>
            ) : (
              stats.reordenCount
            )} <span style={{ fontSize: '0.9rem', color: 'var(--text-muted, #94a3b8)', fontWeight: 'normal' }}>SKUs</span>
          </div>
          <span style={{ fontSize: '0.8rem', color: '#ef4444', fontWeight: '600' }}>⚠️ Stock por debajo del Mínimo</span>
        </div>

        <div className="reorder-kpi-card" style={{ borderTop: '4px solid #0284c7' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-secondary, #64748b)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pedidos Activos en SAP</span>
          <div style={{ fontSize: '2.2rem', fontWeight: '800', color: 'var(--text-primary, #0284c7)', marginTop: '0.2rem' }}>
            {loading ? (
              <span className="skeleton-pulse" style={{ width: '70px' }}></span>
            ) : (
              stats.pedidosCount
            )} <span style={{ fontSize: '0.9rem', color: 'var(--text-muted, #94a3b8)', fontWeight: 'normal' }}>SKUs</span>
          </div>
          <span style={{ fontSize: '0.8rem', color: '#0369a1', fontWeight: '600' }}>🚚 Evita duplicados entre turnos</span>
        </div>

        <div className="reorder-kpi-card" style={{ borderTop: '4px solid #10b981' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-secondary, #64748b)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Importe Sugerido de Compra</span>
          <div style={{ fontSize: '2rem', fontWeight: '800', color: 'var(--text-primary, #059669)', marginTop: '0.2rem' }}>
            {loading ? (
              <span className="skeleton-pulse" style={{ width: '125px' }}></span>
            ) : (
              `$${stats.totalImporteSugerido.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            )}
          </div>
          <span style={{ fontSize: '0.8rem', color: '#10b981', fontWeight: '600' }}>💰 Basado en Costo de Lista SAP</span>
        </div>

        <div className="reorder-kpi-card" style={{ borderTop: '4px solid #6366f1' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-secondary, #64748b)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Insumos Mapeados</span>
          <div style={{ fontSize: '2.2rem', fontWeight: '800', color: 'var(--text-primary, #4f46e5)', marginTop: '0.2rem' }}>
            {loading ? (
              <span className="skeleton-pulse" style={{ width: '70px' }}></span>
            ) : (
              items.length
            )} <span style={{ fontSize: '0.9rem', color: 'var(--text-muted, #94a3b8)', fontWeight: 'normal' }}>SKUs</span>
          </div>
          <span style={{ fontSize: '0.8rem', color: '#6366f1', fontWeight: '600' }}>⚙️ Configuración Dinámica de Reorden</span>
        </div>

      </div>

      {/* Pestaña 1: Matriz de Punto de Reorden */}
      {activeTab === 'reorden' && (
        <div style={{ background: 'var(--color-bg-white, white)', borderRadius: '14px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', border: '1px solid var(--border-color, #e2e8f0)', overflow: 'hidden' }}>
          
          {/* Toolbar de Filtros */}
          <div style={{ padding: '1.25rem', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', flex: 1 }}>
              <input
                type="text"
                placeholder="🔍 Buscar por Código, Descripción o Notita..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ padding: '0.65rem 1rem', borderRadius: '8px', border: '1px solid #cbd5e1', width: '280px', fontSize: '0.9rem' }}
              />

              {/* Botones de Filtro por Estado */}
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                <button
                  onClick={() => setStatusFilter('ALL')}
                  style={{ padding: '0.5rem 0.85rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.8rem', fontWeight: 'bold', cursor: 'pointer', background: statusFilter === 'ALL' ? '#334155' : 'white', color: statusFilter === 'ALL' ? 'white' : '#475569' }}
                >
                  Todos ({items.length})
                </button>
                <button
                  onClick={() => setStatusFilter('CRITICO')}
                  style={{ padding: '0.5rem 0.85rem', borderRadius: '6px', border: '1px solid #fca5a5', fontSize: '0.8rem', fontWeight: 'bold', cursor: 'pointer', background: statusFilter === 'CRITICO' ? '#ef4444' : '#fee2e2', color: statusFilter === 'CRITICO' ? 'white' : '#b91c1c' }}
                >
                  ⚠️ Reorden / Críticos
                </button>
                <button
                  onClick={() => setStatusFilter('CON_PEDIDO')}
                  style={{ padding: '0.5rem 0.85rem', borderRadius: '6px', border: '1px solid #7dd3fc', fontSize: '0.8rem', fontWeight: 'bold', cursor: 'pointer', background: statusFilter === 'CON_PEDIDO' ? '#0284c7' : '#e0f2fe', color: statusFilter === 'CON_PEDIDO' ? 'white' : '#0369a1' }}
                >
                  🚚 Con Pedido SAP
                </button>
                <button
                  onClick={() => setStatusFilter('CON_NOTA')}
                  style={{ padding: '0.5rem 0.85rem', borderRadius: '6px', border: '1px solid #fde047', fontSize: '0.8rem', fontWeight: 'bold', cursor: 'pointer', background: statusFilter === 'CON_NOTA' ? '#ca8a04' : '#fef9c3', color: statusFilter === 'CON_NOTA' ? 'white' : '#854d0e' }}
                >
                  📝 Con Notita
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={exportToExcel}
                style={{ padding: '0.65rem 1.25rem', background: '#00974A', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.88rem' }}
              >
                📥 Exportar Matriz (Excel)
              </button>
              <button
                onClick={fetchReorderData}
                style={{ padding: '0.65rem 1rem', background: '#0284c7', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.88rem' }}
              >
                ↻ Refrescar
              </button>
            </div>

          </div>

          {/* Tabla de Punto de Reorden */}
          <div style={{ overflowX: 'auto', maxHeight: '650px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
              <thead style={{ background: '#f1f5f9', position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ padding: '0.85rem 1rem', color: '#475569', fontWeight: 'bold', borderBottom: '2px solid #cbd5e1' }}>CÓDIGO SAP</th>
                  <th style={{ padding: '0.85rem 1rem', color: '#475569', fontWeight: 'bold', borderBottom: '2px solid #cbd5e1' }}>DESCRIPCIÓN DE MATERIAL</th>
                  <th style={{ padding: '0.85rem 1rem', color: '#0369a1', fontWeight: 'bold', borderBottom: '2px solid #cbd5e1', textAlign: 'center' }}>MÍNIMO</th>
                  <th style={{ padding: '0.85rem 1rem', color: '#0369a1', fontWeight: 'bold', borderBottom: '2px solid #cbd5e1', textAlign: 'center' }}>MÁXIMO</th>
                  <th style={{ padding: '0.85rem 1rem', color: '#475569', fontWeight: 'bold', borderBottom: '2px solid #cbd5e1', textAlign: 'center' }}>EXISTENCIAS</th>
                  <th style={{ padding: '0.85rem 1rem', color: '#475569', fontWeight: 'bold', borderBottom: '2px solid #cbd5e1', textAlign: 'center' }}>FALTANTE</th>
                  <th style={{ padding: '0.85rem 1rem', color: '#15803d', fontWeight: 'bold', borderBottom: '2px solid #cbd5e1', textAlign: 'center', background: '#dcfce7' }}>SOLICITUD COMPRA</th>
                  <th style={{ padding: '0.85rem 1rem', color: '#0369a1', fontWeight: 'bold', borderBottom: '2px solid #cbd5e1' }}>PEDIDOS EN CURSO (SAP)</th>
                  <th style={{ padding: '0.85rem 1rem', color: '#475569', fontWeight: 'bold', borderBottom: '2px solid #cbd5e1' }}>NOTITA ALMACÉN</th>
                  <th style={{ padding: '0.85rem 1rem', color: '#475569', fontWeight: 'bold', borderBottom: '2px solid #cbd5e1', textAlign: 'center' }}>ACCIONES</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="10" style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
                      Cargando matriz de reorden y sincronizando stock SAP...
                    </td>
                  </tr>
                ) : filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan="10" style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
                      No se encontraron artículos con el filtro seleccionado.
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item, idx) => {
                    const isReorden = item.SolicitudCompra > 0;
                    const hasPedidos = item.PedidosEnCurso && item.PedidosEnCurso.length > 0;

                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0', background: idx % 2 === 0 ? 'white' : '#f8fafc' }}>
                        
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 'bold', fontFamily: 'var(--font-mono)', color: '#0f172a' }}>
                          {item.ItemCode}
                        </td>

                        <td style={{ padding: '0.75rem 1rem', color: '#334155', fontWeight: '500' }}>
                          {item.ItemDescription}
                        </td>

                        <td style={{ padding: '0.75rem 1rem', textAlign: 'center', fontWeight: 'bold', color: '#0284c7' }}>
                          {item.MinStock}
                        </td>

                        <td style={{ padding: '0.75rem 1rem', textAlign: 'center', fontWeight: 'bold', color: '#0284c7' }}>
                          {item.MaxStock}
                        </td>

                        <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                          <span style={{
                            padding: '0.25rem 0.65rem',
                            borderRadius: '9999px',
                            fontWeight: 'bold',
                            fontSize: '0.85rem',
                            background: item.StockActual === 0 && item.MinStock > 0 ? '#fee2e2' : (isReorden ? '#fef3c7' : '#dcfce7'),
                            color: item.StockActual === 0 && item.MinStock > 0 ? '#dc2626' : (isReorden ? '#d97706' : '#16a34a')
                          }}>
                            {item.StockActual}
                          </span>
                        </td>

                        <td style={{ padding: '0.75rem 1rem', textAlign: 'center', fontWeight: 'bold', color: item.CalculoPromedio > 0 ? '#ef4444' : '#64748b' }}>
                          {item.CalculoPromedio}
                        </td>

                        {/* Solicitud Compra (Verde destacado como en Excel, editable por el usuario) */}
                        <td 
                          style={{ 
                            padding: '0.5rem 0.75rem', 
                            textAlign: 'center', 
                            fontWeight: '800', 
                            fontSize: '1rem',
                            background: isReorden ? '#22c55e' : 'transparent', 
                            color: isReorden ? 'white' : '#cbd5e1',
                            position: 'relative'
                          }}
                        >
                          {inlineEditCode === item.ItemCode ? (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}>
                              <input
                                type="number"
                                autoFocus
                                value={inlineSolicitudVal}
                                onChange={(e) => setInlineSolicitudVal(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveInlineSolicitud(item, inlineSolicitudVal);
                                  if (e.key === 'Escape') setInlineEditCode(null);
                                }}
                                style={{ width: '70px', padding: '0.35rem', borderRadius: '6px', border: '2px solid #0284c7', fontSize: '0.95rem', fontWeight: 'bold', textAlign: 'center' }}
                              />
                              <button
                                onClick={() => handleSaveInlineSolicitud(item, inlineSolicitudVal)}
                                title="Guardar"
                                style={{ background: '#0f172a', color: 'white', border: 'none', borderRadius: '4px', padding: '0.3rem 0.5rem', cursor: 'pointer', fontSize: '0.8rem' }}
                              >
                                💾
                              </button>
                              <button
                                onClick={() => setInlineEditCode(null)}
                                title="Cancelar"
                                style={{ background: '#cbd5e1', color: '#334155', border: 'none', borderRadius: '4px', padding: '0.3rem 0.5rem', cursor: 'pointer', fontSize: '0.8rem' }}
                              >
                                ✕
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                              <span 
                                onClick={() => {
                                  setInlineEditCode(item.ItemCode);
                                  setInlineSolicitudVal(item.SolicitudCompra || 0);
                                }}
                                title="Haga clic para editar la cantidad de compra solicitada"
                                style={{ cursor: 'pointer', textDecoration: 'underline decoration-dashed', textUnderlineOffset: '4px' }}
                              >
                                {item.SolicitudCompra > 0 ? item.SolicitudCompra : '-'}
                              </span>

                              {item.EsPersonalizada && (
                                <span style={{ fontSize: '0.68rem', background: 'rgba(255,255,255,0.3)', padding: '0.15rem 0.4rem', borderRadius: '4px', fontWeight: 'normal' }}>
                                  ✏️ Manual
                                </span>
                              )}

                              <button
                                onClick={() => {
                                  setInlineEditCode(item.ItemCode);
                                  setInlineSolicitudVal(item.SolicitudCompra || 0);
                                }}
                                title="Editar Solicitud de Compra"
                                style={{ background: 'none', border: 'none', color: isReorden ? 'white' : '#64748b', cursor: 'pointer', fontSize: '0.85rem', opacity: 0.85 }}
                              >
                                ✏️
                              </button>

                              {item.EsPersonalizada && (
                                <button
                                  onClick={() => handleSaveInlineSolicitud(item, 'RESET')}
                                  title="Restablecer a cálculo automático por fórmula"
                                  style={{ background: 'none', border: 'none', color: isReorden ? 'white' : '#ef4444', cursor: 'pointer', fontSize: '0.85rem' }}
                                >
                                  ↺
                                </button>
                              )}
                            </div>
                          )}
                        </td>

                        {/* Pedidos SAP en Curso (Crucial para evitar duplicados en el turno tarde) */}
                        <td style={{ padding: '0.75rem 1rem' }}>
                          {hasPedidos ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                              {item.PedidosEnCurso.map((p, pIdx) => (
                                <button
                                  key={pIdx}
                                  onClick={() => setSelectedItemOrders({ item, order: p })}
                                  style={{
                                    textAlign: 'left',
                                    background: p.estatus.includes('camino') ? '#e0f2fe' : '#fef9c3',
                                    border: `1px solid ${p.estatus.includes('camino') ? '#7dd3fc' : '#fde047'}`,
                                    color: p.estatus.includes('camino') ? '#0369a1' : '#854d0e',
                                    padding: '0.35rem 0.65rem',
                                    borderRadius: '6px',
                                    fontSize: '0.78rem',
                                    fontWeight: 'bold',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: '0.5rem'
                                  }}
                                >
                                  <span>{p.estatus} #{p.folio} ({p.cantPendiente} pzas)</span>
                                  <span style={{ fontSize: '0.7rem', opacity: 0.8 }}>Por: {p.usuario}</span>
                                </button>
                              ))}
                            </div>
                          ) : (
                            <span style={{ fontSize: '0.8rem', color: '#94a3b8', italic: true }}>Sin pedido activo</span>
                          )}
                        </td>

                        {/* Notita de Almacén */}
                        <td style={{ padding: '0.75rem 1rem' }}>
                          {item.Note ? (
                            <span style={{ background: '#fef9c3', border: '1px solid #fef08a', color: '#854d0e', padding: '0.3rem 0.6rem', borderRadius: '6px', fontSize: '0.82rem', fontWeight: '500', display: 'inline-block' }}>
                              📝 {item.Note}
                            </span>
                          ) : (
                            <span style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>—</span>
                          )}
                        </td>

                        {/* Acciones */}
                        <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                          <button
                            onClick={() => handleOpenEdit(item)}
                            title="Editar Mínimo, Máximo o Notita"
                            style={{
                              background: '#f1f5f9',
                              border: '1px solid #cbd5e1',
                              color: '#334155',
                              padding: '0.4rem 0.75rem',
                              borderRadius: '6px',
                              fontWeight: 'bold',
                              fontSize: '0.8rem',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.3rem'
                            }}
                          >
                            ✏️ Editar
                          </button>
                        </td>

                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

        </div>
      )}

      {/* Pestaña 2: Módulo de Pedidos y Solicitudes SAP en Curso */}
      {activeTab === 'pedidos' && (
        <div style={{ background: 'var(--color-bg-white, white)', borderRadius: '14px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', border: '1px solid var(--border-color, #e2e8f0)', padding: '1.5rem' }}>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <div>
              <h2 style={{ margin: 0, color: 'var(--text-primary, #0f172a)', fontSize: '1.35rem', fontWeight: 'bold' }}>
                🚚 Rastreador de Ordenes de Compra y Requisiciones SAP
              </h2>
              <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-secondary, #64748b)', fontSize: '0.9rem' }}>
                Consulta el estatus en tiempo real de todos los pedidos emitidos en SAP para evitar duplicados entre turnos.
              </p>
            </div>
            <button
              onClick={fetchPedidosData}
              style={{ padding: '0.65rem 1.25rem', background: '#0284c7', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
            >
              ↻ Refrescar Pedidos
            </button>
          </div>

          {loadingPedidos ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary, #64748b)' }}>Consultando pedidos activos desde SAP Service Layer...</div>
          ) : pedidos.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary, #64748b)' }}>No hay ordenes de compra ni solicitudes abiertas en SAP actualmente.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: '1.25rem' }}>
              {pedidos.map((p, i) => (
                <div key={i} className={p.tipoCod === 'PO' ? 'sap-pedido-card-po' : 'sap-pedido-card-pr'}>
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                    <div>
                      <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: p.tipoCod === 'PO' ? 'var(--color-azul-medio, #0284c7)' : 'var(--text-secondary, #ca8a04)', textTransform: 'uppercase' }}>
                        {p.tipo}
                      </span>
                      <h3 style={{ margin: '0.2rem 0 0 0', fontSize: '1.2rem', color: 'inherit' }}>
                        Folio SAP #{p.folio}
                      </h3>
                    </div>
                    <span style={{ background: p.tipoCod === 'PO' ? '#0284c7' : '#ca8a04', color: 'white', padding: '0.3rem 0.75rem', borderRadius: '9999px', fontSize: '0.8rem', fontWeight: 'bold' }}>
                      {p.estatus}
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.85rem', marginBottom: '1rem', color: 'var(--text-secondary, #334155)', background: 'var(--color-bg-white, white)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color, #e2e8f0)' }}>
                    <div>
                      <strong style={{ display: 'block', color: 'var(--text-muted, #64748b)', fontSize: '0.72rem', textTransform: 'uppercase' }}>Solicitante / Creador</strong>
                      👤 {p.usuario}
                    </div>
                    <div>
                      <strong style={{ display: 'block', color: 'var(--text-muted, #64748b)', fontSize: '0.72rem', textTransform: 'uppercase' }}>Fecha de Emisión</strong>
                      📅 {p.fecha}
                    </div>
                    {p.proveedor && (
                      <div style={{ gridColumn: '1 / -1' }}>
                        <strong style={{ display: 'block', color: 'var(--text-muted, #64748b)', fontSize: '0.72rem', textTransform: 'uppercase' }}>Proveedor</strong>
                        🏢 {p.proveedor}
                      </div>
                    )}
                  </div>

                  {/* Detalle de partidas */}
                  <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-secondary, #475569)', textTransform: 'uppercase', display: 'block', marginBottom: '0.5rem' }}>
                    Partidas en el pedido ({p.items.length})
                  </span>

                  <div style={{ maxHeight: '180px', overflowY: 'auto', background: 'var(--color-bg-white, white)', borderRadius: '8px', border: '1px solid var(--border-color, #e2e8f0)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                      <thead style={{ background: 'var(--color-bg-base, #f8fafc)', position: 'sticky', top: 0 }}>
                        <tr>
                          <th style={{ padding: '0.4rem 0.6rem', borderBottom: '1px solid var(--border-color, #e2e8f0)', color: 'var(--text-muted)' }}>Código</th>
                          <th style={{ padding: '0.4rem 0.6rem', borderBottom: '1px solid var(--border-color, #e2e8f0)', color: 'var(--text-muted)' }}>Descripción</th>
                          <th style={{ padding: '0.4rem 0.6rem', borderBottom: '1px solid var(--border-color, #e2e8f0)', color: 'var(--text-muted)', textAlign: 'right' }}>Pendiente</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.items.map((it, itIdx) => (
                          <tr key={itIdx} style={{ borderBottom: '1px solid var(--border-color, #f1f5f9)' }}>
                            <td style={{ padding: '0.4rem 0.6rem', fontWeight: 'bold', color: 'var(--text-primary, #0f172a)' }}>{it.itemCode}</td>
                            <td style={{ padding: '0.4rem 0.6rem', color: 'var(--text-secondary, #475569)' }}>{it.description}</td>
                            <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', fontWeight: 'bold', color: p.tipoCod === 'PO' ? '#0284c7' : '#ca8a04' }}>{it.openQuantity} pzas</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                </div>
              ))}
            </div>
          )}

        </div>
      )}

      {/* Modal Editar Notita / Min / Max */}
      {editingItem && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'white', padding: '2rem', borderRadius: '16px', width: '90%', maxWidth: '520px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '1rem' }}>
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#0284c7', textTransform: 'uppercase' }}>Editar Parámetros de Reorden</span>
                <h3 style={{ margin: '0.2rem 0 0 0', color: '#0f172a', fontSize: '1.2rem' }}>
                  {editingItem.ItemCode} - {editingItem.ItemDescription}
                </h3>
              </div>
              <button onClick={() => setEditingItem(null)} style={{ background: '#f1f5f9', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: '#64748b', borderRadius: '50%', width: '32px', height: '32px' }}>✕</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', color: '#475569', marginBottom: '0.4rem' }}>
                  Insumo Mínimo
                </label>
                <input
                  type="number"
                  value={minInput}
                  onChange={(e) => setMinInput(e.target.value)}
                  style={{ width: '100%', padding: '0.65rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '1rem', fontWeight: 'bold' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', color: '#475569', marginBottom: '0.4rem' }}>
                  Insumo Máximo
                </label>
                <input
                  type="number"
                  value={maxInput}
                  onChange={(e) => setMaxInput(e.target.value)}
                  style={{ width: '100%', padding: '0.65rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '1rem', fontWeight: 'bold' }}
                />
              </div>
            </div>

            <div style={{ marginBottom: '1.25rem', background: '#f0fdf4', padding: '1rem', borderRadius: '10px', border: '1px solid #bbf7d0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#166534' }}>
                  Solicitud de Compra (Cantidad Personalizada)
                </label>
                {editingItem.EsPersonalizada && (
                  <button
                    type="button"
                    onClick={() => {
                      setSolicitudInput('');
                      handleSaveEdit('RESET');
                    }}
                    style={{ background: '#fee2e2', color: '#b91c1c', border: 'none', padding: '0.2rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 'bold', cursor: 'pointer' }}
                  >
                    ↺ Restablecer a Fórmula
                  </button>
                )}
              </div>
              <input
                type="number"
                placeholder="Ej. 50 (o deje en blanco para cálculo automático)"
                value={solicitudInput}
                onChange={(e) => setSolicitudInput(e.target.value)}
                style={{ width: '100%', padding: '0.65rem', borderRadius: '8px', border: '1px solid #86efac', fontSize: '1.05rem', fontWeight: '800', color: '#15803d' }}
              />
              <span style={{ fontSize: '0.75rem', color: '#15803d', display: 'block', marginTop: '0.3rem' }}>
                💡 Escriba una cantidad específica para ajustar la solicitud independientemente del cálculo automático.
              </span>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', color: '#475569', marginBottom: '0.4rem' }}>
                Notita de Almacén (Operativa / Observaciones)
              </label>
              <textarea
                rows="3"
                placeholder="Ej. Solicitar cada que quirófano tenga pocas / Se compra con proveedor X..."
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                style={{ width: '100%', padding: '0.65rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.9rem', fontFamily: 'inherit' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                onClick={() => setEditingItem(null)}
                style={{ padding: '0.65rem 1.25rem', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={savingNote}
                style={{ padding: '0.65rem 1.5rem', background: '#0284c7', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', opacity: savingNote ? 0.7 : 1 }}
              >
                {savingNote ? 'Guardando...' : '💾 Guardar Cambios'}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Modal Detalle de Pedidos de un Artículo */}
      {selectedItemOrders && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'white', padding: '2rem', borderRadius: '16px', width: '90%', maxWidth: '500px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '1rem' }}>
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#0284c7', textTransform: 'uppercase' }}>
                  Estatus de Pedido en SAP
                </span>
                <h3 style={{ margin: '0.2rem 0 0 0', color: '#0f172a', fontSize: '1.2rem' }}>
                  {selectedItemOrders.item.ItemCode} - {selectedItemOrders.item.ItemDescription}
                </h3>
              </div>
              <button onClick={() => setSelectedItemOrders(null)} style={{ background: '#f1f5f9', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: '#64748b', borderRadius: '50%', width: '32px', height: '32px' }}>✕</button>
            </div>

            <div style={{ background: '#f0f9ff', padding: '1.25rem', borderRadius: '12px', border: '1px solid #bae6fd', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <strong style={{ color: '#0369a1' }}>{selectedItemOrders.order.tipo} #{selectedItemOrders.order.folio}</strong>
                <span style={{ background: '#0284c7', color: 'white', padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 'bold' }}>
                  {selectedItemOrders.order.estatus}
                </span>
              </div>
              
              <div style={{ fontSize: '0.9rem', color: '#334155', display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.75rem' }}>
                <div><strong>Piezas Pendientes:</strong> {selectedItemOrders.order.cantPendiente} unidades</div>
                <div><strong>Usuario que realizó el pedido:</strong> 👤 {selectedItemOrders.order.usuario}</div>
                <div><strong>Fecha de registro:</strong> 📅 {selectedItemOrders.order.fecha}</div>
                <div><strong>Proveedor asignado:</strong> 🏢 {selectedItemOrders.order.proveedor}</div>
              </div>
            </div>

            <p style={{ fontSize: '0.85rem', color: '#059669', background: '#dcfce7', padding: '0.75rem', borderRadius: '8px', border: '1px solid #86efac', margin: '0 0 1.25rem 0', fontWeight: '600' }}>
              💡 Este insumo ya cuenta con un pedido activo en curso. Evita generar una duplicidad de pedido.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setSelectedItemOrders(null)}
                style={{ padding: '0.65rem 1.5rem', background: '#0f172a', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
              >
                Entendido
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
