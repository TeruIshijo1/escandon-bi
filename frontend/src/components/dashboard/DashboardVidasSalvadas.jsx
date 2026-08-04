import { useState, useEffect } from 'react';
import PremiumLoader from '../shared/PremiumLoader';
import { API_BASE } from '../../api/config';

export default function DashboardVidasSalvadas({ periodo }) {
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
      // Client side sort since Service Layer SQLQuery blocked ORDER BY
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

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(val);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    
    // SAP a veces devuelve la fecha como 'YYYYMMDD' (ej. '20260121')
    if (typeof dateStr === 'string' && /^\\d{8}$/.test(dateStr)) {
      const y = dateStr.substring(0, 4);
      const m = parseInt(dateStr.substring(4, 6), 10) - 1;
      const d = dateStr.substring(6, 8);
      const dt = new Date(y, m, d);
      return dt.toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: '2-digit' });
    }
    
    const d = new Date(dateStr);
    return d.toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: '2-digit' });
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
                <tr key={`${row.AtencionMedica}-${idx}`} style={{ borderBottom: '1px solid #F1F5F9', transition: 'background 0.2s' }} onMouseOver={e => e.currentTarget.style.background = '#F8FAFC'} onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#005FA9' }}>{row.AtencionMedica}</td>
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

    </div>
  );
}
