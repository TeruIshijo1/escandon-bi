import { useState, useEffect } from 'react';
import PremiumLoader from '../shared/PremiumLoader';
import { API_BASE } from '../../api/config';
import * as XLSX from 'xlsx';

export default function DashboardVidasSalvadas({ periodo }) {
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const [selectedAtencion, setSelectedAtencion] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    fetchData();
  }, [periodo]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const token = sessionStorage.getItem('escandon_token');
      
      let url = `${API_BASE}/dashboard/sap/vidas-salvadas?periodo=${periodo || 'mes'}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      const json = await res.json();
      
      if (!json.ok) {
        throw new Error(json.error || 'Error al obtener vidas salvadas');
      }

      let listData = json.data || [];
      listData.sort((a, b) => {
        if (a.FechaPrimeraOV !== b.FechaPrimeraOV) {
          return b.FechaPrimeraOV > a.FechaPrimeraOV ? 1 : -1;
        }
        return b.AtencionMedica > a.AtencionMedica ? 1 : -1;
      });

      setData(listData);
      setTotal(json.totalVidasSalvadas || 0);

    } catch (err) {
      console.error('[DashboardVidasSalvadas]', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchDetail = async (atencion) => {
    setSelectedAtencion(atencion);
    setLoadingDetail(true);
    try {
      const token = sessionStorage.getItem('escandon_token');
      const res = await fetch(`${API_BASE}/dashboard/sap/vidas-salvadas/${atencion}/detalle`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json();
      if (json.ok) {
        setDetailData(json);
      } else {
        alert(json.error || 'Error al cargar detalle');
        setSelectedAtencion(null);
      }
    } catch (e) {
      console.error(e);
      alert('Error de conexión');
      setSelectedAtencion(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(val);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    
    let y, m, d;
    if (typeof dateStr === 'string' && /^\d{8}$/.test(dateStr)) {
      y = dateStr.substring(0, 4);
      m = parseInt(dateStr.substring(4, 6), 10) - 1;
      d = dateStr.substring(6, 8);
    } else if (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
      y = dateStr.substring(0, 4);
      m = parseInt(dateStr.substring(5, 7), 10) - 1;
      d = dateStr.substring(8, 10);
    } else {
      const dt = new Date(dateStr);
      if (isNaN(dt.getTime())) return 'Invalid Date';
      return dt.toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: '2-digit' });
    }
    
    const dt = new Date(y, m, d);
    return dt.toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: '2-digit' });
  };

  const exportDetailToExcel = () => {
    if (!detailData) return;
    const wb = XLSX.utils.book_new();
    
    if (detailData.sap && detailData.sap.length > 0) {
      const wsSap = XLSX.utils.json_to_sheet(detailData.sap);
      XLSX.utils.book_append_sheet(wb, wsSap, 'Facturas SAP');
    }
    if (detailData.vertical && detailData.vertical.length > 0) {
      const wsVert = XLSX.utils.json_to_sheet(detailData.vertical);
      XLSX.utils.book_append_sheet(wb, wsVert, 'Cargos Vertical');
    }
    
    XLSX.writeFile(wb, `Detalle_Atencion_${selectedAtencion}.xlsx`);
  };

  if (loading) {
    return <PremiumLoader text="Consultando SAP Business One..." style={{ height: '400px' }} />;
  }

  if (error) {
    return <div style={{ padding: 20, color: '#EF4444', background: '#FEE2E2', borderRadius: 8 }}>{error}</div>;
  }

  return (
    <div style={{ padding: '0', fontFamily: "'Inter', sans-serif" }}>
      {/* Tabla de Detalles */}
      <div style={{ background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,70,135,0.1)' }}>
        <h3 style={{ margin: '0 0 1rem 0', color: '#0D1B2A', fontSize: '1.1rem' }}>Detalle de Atenciones - SAP B1</h3>
        
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', minWidth: '800px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #E2E8F0', color: '#64748B', textAlign: 'left' }}>
                <th style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>Atención Médica</th>
                <th style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>No. Paciente</th>
                <th style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>Nombre Paciente</th>
                <th style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>Primera Orden</th>
                <th style={{ padding: '0.75rem 1rem', fontWeight: 600, textAlign: 'center' }}>Órdenes</th>
                <th style={{ padding: '0.75rem 1rem', fontWeight: 600, textAlign: 'center' }}>Cant. Choque</th>
                <th style={{ padding: '0.75rem 1rem', fontWeight: 600, textAlign: 'right' }}>Importe Total Choque</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row, idx) => (
                <tr 
                  key={`${row.AtencionMedica}-${idx}`} 
                  onClick={() => fetchDetail(row.AtencionMedica)}
                  style={{ borderBottom: '1px solid #F1F5F9', transition: 'background 0.2s', cursor: 'pointer' }} 
                  onMouseOver={e => e.currentTarget.style.background = '#F8FAFC'} 
                  onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#005FA9', textDecoration: 'underline' }}>{row.AtencionMedica}</td>
                  <td style={{ padding: '0.75rem 1rem', color: '#64748B' }}>{row.NoPaciente}</td>
                  <td style={{ padding: '0.75rem 1rem', color: '#0D1B2A', fontWeight: 500 }}>{row.NombrePaciente}</td>
                  <td style={{ padding: '0.75rem 1rem', color: '#64748B' }}>{formatDate(row.FechaPrimeraOV)}</td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'center', color: '#64748B' }}>{row.OrdenesDeVenta}</td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'center', fontWeight: 600, color: '#E63946' }}>{row.CantidadTotalSalaChoque}</td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 600, color: '#10B981' }}>{formatCurrency(row.ImporteTotalSalaChoque)}</td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr>
                  <td colSpan="7" style={{ padding: '2rem 1rem', textAlign: 'center', color: '#64748B' }}>
                    No se encontraron registros de Sala de Choque en el periodo seleccionado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedAtencion && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000
        }}>
          <div style={{ background: 'white', padding: '2rem', borderRadius: 12, width: '90%', maxWidth: '900px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ margin: 0, color: '#0D1B2A' }}>Detalle de Atención: {selectedAtencion}</h2>
              <div>
                <button onClick={exportDetailToExcel} style={{ padding: '0.5rem 1rem', background: '#10B981', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', marginRight: '1rem', fontWeight: 600 }}>Exportar a Excel</button>
                <button onClick={() => { setSelectedAtencion(null); setDetailData(null); }} style={{ padding: '0.5rem 1rem', background: '#EF4444', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>Cerrar</button>
              </div>
            </div>
            
            {loadingDetail ? (
              <PremiumLoader text="Cargando detalles..." style={{ height: '200px' }} />
            ) : detailData ? (
              <div>
                <h3 style={{ borderBottom: '2px solid #E2E8F0', paddingBottom: '0.5rem' }}>Facturas / Órdenes SAP</h3>
                {detailData.sap && detailData.sap.length > 0 ? (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', marginBottom: '2rem' }}>
                    <thead>
                      <tr style={{ background: '#F8FAFC', textAlign: 'left' }}>
                        <th style={{ padding: '0.5rem' }}>Folio SAP</th>
                        <th style={{ padding: '0.5rem' }}>Fecha</th>
                        <th style={{ padding: '0.5rem' }}>Código</th>
                        <th style={{ padding: '0.5rem' }}>Descripción</th>
                        <th style={{ padding: '0.5rem' }}>Cant.</th>
                        <th style={{ padding: '0.5rem' }}>Total Línea</th>
                      </tr>
                    </thead>
                      <tbody>
                        {detailData.sap.map((s, i) => {
                          const isChoque = s.CodigoArticulo === 'SER0515' || s.CodigoArticulo === 'SER0533';
                          return (
                            <tr key={i} style={{ 
                              borderBottom: '1px solid #E2E8F0', 
                              color: isChoque ? '#E63946' : 'inherit',
                              fontWeight: isChoque ? 600 : 'inherit',
                              backgroundColor: isChoque ? 'rgba(230, 57, 70, 0.03)' : 'transparent'
                            }}>
                              <td style={{ padding: '0.5rem' }}>{s.FolioSAP}</td>
                              <td style={{ padding: '0.5rem' }}>{formatDate(s.Fecha)}</td>
                              <td style={{ padding: '0.5rem' }}>{s.CodigoArticulo}</td>
                              <td style={{ padding: '0.5rem' }}>{s.Descripcion}</td>
                              <td style={{ padding: '0.5rem' }}>{s.Cantidad}</td>
                              <td style={{ padding: '0.5rem' }}>{formatCurrency(s.TotalLinea)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                  </table>
                ) : <p>No se encontraron registros en SAP para esta atención.</p>}

                <h3 style={{ borderBottom: '2px solid #E2E8F0', paddingBottom: '0.5rem' }}>Cargos Vertical</h3>
                {detailData.vertical && detailData.vertical.length > 0 ? (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ background: '#F8FAFC', textAlign: 'left' }}>
                        <th style={{ padding: '0.5rem' }}>Fecha</th>
                        <th style={{ padding: '0.5rem' }}>Código</th>
                        <th style={{ padding: '0.5rem' }}>Descripción</th>
                        <th style={{ padding: '0.5rem' }}>Cant.</th>
                        <th style={{ padding: '0.5rem' }}>Total Línea</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailData.vertical.map((v, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #E2E8F0' }}>
                          <td style={{ padding: '0.5rem' }}>{formatDate(v.ChargeDate)}</td>
                          <td style={{ padding: '0.5rem' }}>{v.ItemCode || v.SUCode}</td>
                          <td style={{ padding: '0.5rem' }}>{v.ItemDescription || 'N/A'}</td>
                          <td style={{ padding: '0.5rem' }}>{v.Quantity}</td>
                          <td style={{ padding: '0.5rem' }}>{formatCurrency(v.Total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <p>No se encontraron cargos en Vertical para esta atención.</p>}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
