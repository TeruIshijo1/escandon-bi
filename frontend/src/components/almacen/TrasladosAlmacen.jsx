import React, { useState, useEffect } from 'react';
import { API_BASE } from '../../api/config';
import { authHeaders } from '../../api/auth';
import '../../styles/print-receipt.css';

export default function TrasladosAlmacen() {
  const [traslados, setTraslados] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const [selectedTraslado, setSelectedTraslado] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Filtros
  const today = new Date().toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchTraslados();
  }, [startDate, endDate]);

  const fetchTraslados = async () => {
    try {
      setLoading(true);
      setError(null);
      const queryParams = new URLSearchParams();
      if (startDate) queryParams.append('startDate', startDate);
      if (endDate) queryParams.append('endDate', endDate);

      const response = await fetch(`${API_BASE}/almacen/traslados?${queryParams.toString()}`, {
        headers: authHeaders()
      });
      const json = await response.json();
      if (response.ok && json.ok) {
        setTraslados(json.data);
      } else {
        throw new Error(json.error || 'Error al cargar traslados');
      }
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchDetail = async (id) => {
    try {
      setLoadingDetail(true);
      const response = await fetch(`${API_BASE}/almacen/traslados/${id}`, {
        headers: authHeaders()
      });
      const json = await response.json();
      if (response.ok && json.ok) {
        setSelectedTraslado(json.data);
      } else {
        alert('Error al cargar detalles de la solicitud');
      }
    } catch (err) {
      console.error(err);
      alert('Error de conexión al cargar la solicitud');
    } finally {
      setLoadingDetail(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const filteredTraslados = traslados.filter(t => {
    const term = searchTerm.toLowerCase();
    return !term || 
           (t.DocNum && t.DocNum.toString().includes(term)) || 
           (t.ToWarehouse && t.ToWarehouse.toLowerCase().includes(term)) ||
           (t.Comments && t.Comments.toLowerCase().includes(term));
  });

  return (
    <div className="traslados-container" style={{ padding: '2rem' }}>
      
      {/* ─── VISTA PRINCIPAL (Oculta al imprimir) ─── */}
      <div className="no-print">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <div>
            <h1 style={{ margin: '0 0 0.5rem 0', color: '#0f172a', fontSize: '2rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span>🚚</span> Solicitudes de Traslado <span style={{ fontSize: '1rem', color: '#64748b', fontWeight: 'normal', marginTop: '0.5rem' }}>(SAP)</span>
            </h1>
            <p style={{ margin: 0, color: '#64748b' }}>Historial de requisiciones y envíos a departamentos</p>
          </div>
          <button 
            onClick={fetchTraslados}
            style={{ padding: '0.75rem 1.5rem', background: '#0f172a', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            ↻ Actualizar
          </button>
        </div>

        {/* Filtros */}
        <div style={{ background: 'white', padding: '1.5rem', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            
            {/* Buscador de texto */}
            <div style={{ flex: 1, minWidth: '250px', position: 'relative' }}>
              <span style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}>🔍</span>
              <input 
                type="text" 
                placeholder="Buscar por Folio, Destino o Comentarios..." 
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                style={{ width: '100%', padding: '0.75rem 1rem 0.75rem 2.5rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none' }}
              />
            </div>

            {/* Filtros de Fecha */}
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <label style={{ fontSize: '0.875rem', color: '#64748b', fontWeight: 'bold' }}>Desde:</label>
              <input 
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none' }}
              />
              <label style={{ fontSize: '0.875rem', color: '#64748b', fontWeight: 'bold', marginLeft: '0.5rem' }}>Hasta:</label>
              <input 
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none' }}
              />
            </div>
            
          </div>
        </div>

        {/* Tabla */}
        <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: '4rem', textAlign: 'center', color: '#64748b' }}>Cargando solicitudes desde SAP...</div>
          ) : error ? (
            <div style={{ padding: '4rem', textAlign: 'center', color: '#ef4444' }}>{error}</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ background: '#f8fafc' }}>
                <tr>
                  <th style={{ padding: '1rem 1.5rem', fontSize: '0.85rem', color: '#475569', borderBottom: '1px solid #e2e8f0' }}>Folio SAP</th>
                  <th style={{ padding: '1rem 1.5rem', fontSize: '0.85rem', color: '#475569', borderBottom: '1px solid #e2e8f0' }}>Fecha</th>
                  <th style={{ padding: '1rem 1.5rem', fontSize: '0.85rem', color: '#475569', borderBottom: '1px solid #e2e8f0' }}>Origen</th>
                  <th style={{ padding: '1rem 1.5rem', fontSize: '0.85rem', color: '#475569', borderBottom: '1px solid #e2e8f0' }}>Destino</th>
                  <th style={{ padding: '1rem 1.5rem', fontSize: '0.85rem', color: '#475569', borderBottom: '1px solid #e2e8f0' }}>Estatus</th>
                  <th style={{ padding: '1rem 1.5rem', fontSize: '0.85rem', color: '#475569', borderBottom: '1px solid #e2e8f0' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredTraslados.map(t => (
                  <tr key={t.DocEntry} style={{ borderBottom: '1px solid #e2e8f0', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                    <td style={{ padding: '1rem 1.5rem', fontWeight: 'bold', color: '#0f172a' }}>{t.DocNum}</td>
                    <td style={{ padding: '1rem 1.5rem', color: '#475569' }}>
                      {t.DocDate ? new Date(t.DocDate).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' }) : '-'}
                    </td>
                    <td style={{ padding: '1rem 1.5rem', color: '#0f172a' }}>{t.FromWarehouse}</td>
                    <td style={{ padding: '1rem 1.5rem', color: '#0f172a', fontWeight: '500' }}>{t.ToWarehouse}</td>
                    <td style={{ padding: '1rem 1.5rem' }}>
                      <span style={{ 
                        background: t.DocumentStatus === 'bost_Open' ? '#fef3c7' : '#ecfdf5',
                        color: t.DocumentStatus === 'bost_Open' ? '#b45309' : '#059669',
                        padding: '0.3rem 0.6rem', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 'bold' 
                      }}>
                        {t.DocumentStatus === 'bost_Open' ? 'Abierto' : 'Cerrado'}
                      </span>
                    </td>
                    <td style={{ padding: '1rem 1.5rem' }}>
                      <button 
                        onClick={() => fetchDetail(t.DocEntry)}
                        style={{ background: '#e0e7ff', color: '#4338ca', border: 'none', padding: '0.5rem 1rem', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}
                      >
                        Ver Detalle
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ─── MODAL DE DETALLE / VISTA DE IMPRESIÓN ─── */}
      {selectedTraslado && (
        <div className="receipt-modal-overlay">
          <div className="receipt-modal-content print-only-area">
            
            {/* Controles del Modal (Ocultos al imprimir) */}
            <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '1rem' }}>
              <h2 style={{ margin: 0, color: '#0f172a' }}>Detalle de Solicitud</h2>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button onClick={handlePrint} style={{ background: '#059669', color: 'white', border: 'none', padding: '0.5rem 1.5rem', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span>🖨️</span> Imprimir
                </button>
                <button onClick={() => setSelectedTraslado(null)} style={{ background: '#ef4444', color: 'white', border: 'none', padding: '0.5rem 1.5rem', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
                  Cerrar
                </button>
              </div>
            </div>

            {/* Formato de Impresión */}
            <div className="receipt-body">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <img src="/logo-escandon.png" alt="Logo" className="print-only-logo" style={{ height: '35px', objectFit: 'contain', marginBottom: '0.5rem', alignSelf: 'flex-start' }} />
                  <h2 style={{ fontSize: '1.8rem', color: '#0f172a', margin: 0 }}>Solicitud # {selectedTraslado.DocNum}</h2>
                  {selectedTraslado.DocEntry && <span style={{ color: '#059669', fontSize: '0.85rem', fontWeight: '500', marginTop: '0.2rem' }}>✓ Subido a SAP</span>}
                </div>
                <div style={{ textAlign: 'right', color: '#475569', fontSize: '0.85rem', lineHeight: '1.4' }}>
                  <div><strong>ID SAP:</strong> {selectedTraslado.DocEntry}</div>
                  <div><strong>Fecha de Creación:</strong> {selectedTraslado.DocDate ? new Date(selectedTraslado.DocDate).toLocaleDateString() : '-'}</div>
                  <div><strong>Fecha de Vencimiento:</strong> {selectedTraslado.DueDate ? new Date(selectedTraslado.DueDate).toLocaleDateString() : '-'}</div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem', background: '#f8fafc', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.85rem' }}>
                <div style={{ lineHeight: '1.5' }}>
                  <div><strong>Almacén Origen:</strong> {selectedTraslado.FromWarehouse}</div>
                  <div><strong>Almacén Destino:</strong> {selectedTraslado.ToWarehouse}</div>
                  <div style={{ marginTop: '0.5rem' }}><strong>Estatus en SAP:</strong> {selectedTraslado.DocumentStatus === 'bost_Open' ? 'Abierto' : 'Cerrado'}</div>
                  <div><strong>Comentarios:</strong> {selectedTraslado.Comments || 'N/A'}</div>
                </div>
                <div style={{ lineHeight: '1.5' }}>
                  <div><strong>ID Solicitante:</strong> {selectedTraslado.Requester || '-'}</div>
                  <div><strong>Nombre Solicitante:</strong> {selectedTraslado.RequesterName || '-'}</div>
                </div>
              </div>

              <div>
                <h3 style={{ borderBottom: '2px solid #e2e8f0', paddingBottom: '0.25rem', margin: '0 0 0.5rem 0', color: '#0f172a', fontSize: '1.1rem' }}>Contenido</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                  <thead>
                    <tr style={{ background: '#f1f5f9' }}>
                      <th style={{ padding: '0.4rem', border: '1px solid #cbd5e1', width: '5%' }}>#</th>
                      <th style={{ padding: '0.4rem', border: '1px solid #cbd5e1', width: '15%' }}>Artículo</th>
                      <th style={{ padding: '0.4rem', border: '1px solid #cbd5e1', width: '50%' }}>Descripción</th>
                      <th style={{ padding: '0.4rem', border: '1px solid #cbd5e1', width: '15%', textAlign: 'right' }}>Cantidad</th>
                      <th style={{ padding: '0.4rem', border: '1px solid #cbd5e1', width: '15%' }}>U.M.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedTraslado.StockTransferLines?.map((line, idx) => (
                      <tr key={idx}>
                        <td style={{ padding: '0.4rem', border: '1px solid #cbd5e1', textAlign: 'center' }}>{line.LineNum + 1}</td>
                        <td style={{ padding: '0.4rem', border: '1px solid #cbd5e1' }}>{line.ItemCode}</td>
                        <td style={{ padding: '0.4rem', border: '1px solid #cbd5e1' }}>{line.ItemDescription}</td>
                        <td style={{ padding: '0.4rem', border: '1px solid #cbd5e1', textAlign: 'right', fontWeight: 'bold' }}>{line.Quantity}</td>
                        <td style={{ padding: '0.4rem', border: '1px solid #cbd5e1' }}>{line.MeasureUnit || 'PIEZA'}</td>
                      </tr>
                    ))}
                    {(!selectedTraslado.StockTransferLines || selectedTraslado.StockTransferLines.length === 0) && (
                      <tr>
                        <td colSpan="5" style={{ padding: '0.75rem', textAlign: 'center', border: '1px solid #cbd5e1', color: '#64748b' }}>Sin artículos</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Espacio para firmas en la impresión */}
              <div className="print-signatures" style={{ marginTop: '3rem', breakInside: 'avoid', fontSize: '0.85rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-around', textAlign: 'center' }}>
                  <div style={{ width: '200px' }}>
                    <div style={{ borderBottom: '1px solid black', height: '40px' }}></div>
                    <div style={{ marginTop: '0.5rem', fontWeight: 'bold' }}>Firma Solicitante</div>
                  </div>
                  <div style={{ width: '200px' }}>
                    <div style={{ borderBottom: '1px solid black', height: '40px' }}></div>
                    <div style={{ marginTop: '0.5rem', fontWeight: 'bold' }}>Firma Almacén</div>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

    </div>
  );
}
