import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ComposedChart, Line, LineChart, PieChart, Pie, Cell
} from 'recharts';
import PremiumLoader from '../shared/PremiumLoader';
import { API_BASE } from '../../api/config';
import ExportButton from '../shared/ExportButton';

export default function DashboardFinancieroNativo({ globalFilters, globalTrigger }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [applyTrigger, setApplyTrigger] = useState(0);
  const [selectedCartera, setSelectedCartera] = useState(null);

  // Estados para Detalle de Cuenta (Estado de Cuenta)
  const [accountDetails, setAccountDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState(null);

  useEffect(() => {
    fetchData();
  }, [applyTrigger, globalTrigger]);

  const fetchData = async () => {
    try {
      const token = sessionStorage.getItem('escandon_token');
      
      let url = `${API_BASE}/dashboard/financiero-nativo?`;
      if (globalFilters?.startDate) url += `startDate=${globalFilters.startDate}&`;
      if (globalFilters?.endDate) url += `endDate=${globalFilters.endDate}&`;
      if (globalFilters?.search) url += `search=${encodeURIComponent(globalFilters.search)}&`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json();
      
      if (json.ok) {
        setData(json.data);
      } else {
        setError(json.error || 'Error al cargar datos');
      }
    } catch (err) {
      setError('Error de conexión con el servidor.');
    } finally {
      setLoading(false);
    }
  };

  const fetchAccountDetails = async (pcNum) => {
    try {
      setLoadingDetails(true);
      setDetailsError(null);
      setAccountDetails({ pcNum, data: [] }); // Set initially to show modal immediately
      
      const token = sessionStorage.getItem('escandon_token');
      const url = `${API_BASE}/dashboard/financiero-nativo/cuenta/${pcNum}`;
      
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json();
      
      if (json.success) {
        setAccountDetails({ pcNum, data: json.data });
      } else {
        setDetailsError(json.error || 'Error al cargar detalles de la cuenta');
      }
    } catch (err) {
      setDetailsError('Error de conexión con el servidor.');
    } finally {
      setLoadingDetails(false);
    }
  };

  const formatCurrency = (val) => {
    if (val === null || val === undefined) return '';
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(val);
  };

  if (loading) {
    return <PremiumLoader text="Ejecutando Pipeline de Data Science..." style={{ height: '400px' }} />;
  }

  if (error) {
    return <div style={{ padding: 20, color: '#EF4444', background: '#FEE2E2', borderRadius: 8 }}>{error}</div>;
  }

  const { tendenciaMensual, kpis, audit, carteraCobranza } = data;
  const pctValido = ((audit.valido / audit.totalCrudo) * 100).toFixed(1);
  
  const carteraData = carteraCobranza ? [
    { name: 'Corriente (0-30 días)', bucket: '0-30 días', value: Math.round(carteraCobranza['0-30 días'] || 0) },
    { name: 'Atraso (31-60 días)', bucket: '31-60 días', value: Math.round(carteraCobranza['31-60 días'] || 0) },
    { name: 'Mora (61-90 días)', bucket: '61-90 días', value: Math.round(carteraCobranza['61-90 días'] || 0) },
    { name: 'Vencida (+90 días)', bucket: '90+ días', value: Math.round(carteraCobranza['90+ días'] || 0) },
  ].filter(d => d.value > 0) : [];

  const COLORS = ['#10B981', '#F59E0B', '#F97316', '#EF4444'];
  
  const displayCuentas = selectedCartera && data.carteraCobranzaDetalle && data.carteraCobranzaDetalle[selectedCartera.bucket]
    ? data.carteraCobranzaDetalle[selectedCartera.bucket]
    : (data.listaCuentas || []);

  const handleApply = () => setApplyTrigger(prev => prev + 1);
  const handleClear = () => {
    setFilters({ search: '', startDate: '', endDate: '' });
    setTimeout(() => setApplyTrigger(prev => prev + 1), 50);
  };

  const handleQuickDate = (type) => {
    const today = new Date();
    let start = new Date();
    let end = new Date();

    if (type === 'hoy') {
      // both start and end are today
    } else if (type === 'semana') {
      const day = today.getDay(); 
      const diff = today.getDate() - day + (day === 0 ? -6 : 1); 
      start = new Date(today.setDate(diff));
      end = new Date();
    } else if (type === 'mes') {
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      end = new Date();
    } else if (type === 'mes_pasado') {
      start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      end = new Date(today.getFullYear(), today.getMonth(), 0);
    } else if (type === 'anio') {
      start = new Date(today.getFullYear(), 0, 1);
      end = new Date();
    }

    const formatDate = (d) => {
      const offset = d.getTimezoneOffset() * 60000;
      return new Date(d.getTime() - offset).toISOString().split('T')[0];
    };
    
    setFilters(prev => ({
      ...prev,
      startDate: formatDate(start),
      endDate: formatDate(end)
    }));
    
    setTimeout(() => setApplyTrigger(prev => prev + 1), 50);
  };

  const quickBtnStyle = {
    background: '#F1F5F9',
    color: '#005FA9',
    border: '1px solid #CBD5E1',
    padding: '0.4rem 0.8rem',
    borderRadius: 20,
    fontSize: '0.75rem',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s'
  };

  return (
    <div id="dashboard-financiero" style={{ padding: '2rem 0', fontFamily: "'Inter', sans-serif", background: 'white' }}>


      


      {/* KPIs Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <KPICard title="Ingresos Netos Validados" value={formatCurrency(kpis.ingresosAcumulados)} color="#005FA9" icon="💰" />
        <KPICard title="Costo Directo (Venta)" value={formatCurrency(kpis.costosAcumulados)} color="#EF4444" icon="📉" />
        <KPICard title="Utilidad Bruta" value={formatCurrency(kpis.utilidadAcumulada)} color="#8B5CF6" icon="💎" />
        <KPICard title="Cuentas por Cobrar" value={formatCurrency(kpis.cuentasPorCobrar)} color="#F59E0B" icon="🧾" />
        <KPICard title="Margen Bruto" value={`${kpis.margenPromedio.toFixed(1)}%`} color="#00974A" icon="📈" />
      </div>

      {/* Gráficas */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', marginBottom: '2rem' }}>
        
        {/* Gráfica de Barras: Ingresos vs Costos con Proyecciones */}
        <div style={{ flex: '1 1 500px', background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,70,135,0.1)' }}>
          <h3 style={{ margin: '0 0 1rem 0', color: '#0D1B2A', fontSize: '1.1rem' }}>Ingresos vs Costos y Proyección (ML/IA)</h3>
          <div style={{ width: '100%', height: 350 }}>
            <ResponsiveContainer>
              <BarChart data={tendenciaMensual} margin={{ top: 10, right: 10, left: 20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="month" tick={{fill: '#64748B'}} tickLine={false} />
                <YAxis tickFormatter={(val) => `$${(val/1000000).toFixed(1)}M`} tick={{fill: '#64748B'}} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value) => formatCurrency(value)} labelStyle={{color: '#000'}} cursor={{fill: 'rgba(0,70,135,0.05)'}} />
                <Legend iconType="circle" />
                <Bar isAnimationActive={false} dataKey="Ingresos" name="Ingresos Reales" fill="#005FA9" radius={[4, 4, 0, 0]} />
                <Bar isAnimationActive={false} dataKey="IngresosProyectados" name="Ingresos Proyectados" fill="rgba(0,95,169,0.4)" radius={[4, 4, 0, 0]} />
                <Bar isAnimationActive={false} dataKey="Costos" name="Costo Directo" fill="#EF4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Gráfica de Líneas: Crecimiento de Utilidad */}
        <div style={{ flex: '1 1 500px', background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,70,135,0.1)' }}>
          <h3 style={{ margin: '0 0 1rem 0', color: '#0D1B2A', fontSize: '1.1rem' }}>Crecimiento de Utilidad Bruta (Histórico y Predictivo)</h3>
          <div style={{ width: '100%', height: 350 }}>
            <ResponsiveContainer>
              <LineChart data={tendenciaMensual} margin={{ top: 10, right: 10, left: 20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="month" tick={{fill: '#64748B'}} tickLine={false} />
                <YAxis tickFormatter={(val) => `$${(val/1000000).toFixed(1)}M`} tick={{fill: '#64748B'}} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value) => formatCurrency(value)} />
                <Legend iconType="circle" />
                <Line isAnimationActive={false} type="monotone" dataKey="Utilidad" name="Utilidad Histórica" stroke="#00974A" strokeWidth={4} dot={{r: 6, fill: '#00974A', strokeWidth: 2, stroke: '#fff'}} activeDot={{r: 8}} connectNulls />
                <Line isAnimationActive={false} type="monotone" dataKey="UtilidadProyectada" name="Utilidad Proyectada" stroke="#005FA9" strokeWidth={3} strokeDasharray="5 5" dot={{r: 5, fill: '#fff', strokeWidth: 2, stroke: '#005FA9'}} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* Gráficas Adicionales (Cartera de Cobranza) */}
      {carteraData.length > 0 && (
        <>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', marginBottom: '2rem' }}>
          <div style={{ flex: '1 1 100%', background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,70,135,0.1)' }}>
            <h3 style={{ margin: '0 0 1rem 0', color: '#0D1B2A', fontSize: '1.1rem' }}>Antigüedad de Saldos (Cartera de Cobranza)</h3>
            <div style={{ width: '100%', height: 350 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie 
                    data={carteraData} 
                    cx="50%" cy="50%" 
                    innerRadius={90} outerRadius={130} 
                    paddingAngle={5} 
                    dataKey="value"
                    label={({ name, percent }) => `${name} (${(percent * 100).toFixed(1)}%)`}
                    onClick={(entry) => setSelectedCartera({ bucket: entry.bucket, name: entry.name })}
                    style={{ cursor: 'pointer' }}
                  >
                    {carteraData.map((entry, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={COLORS[index % COLORS.length]} 
                        onClick={() => setSelectedCartera({ bucket: entry.bucket, name: entry.name })}
                        style={{ cursor: 'pointer', opacity: selectedCartera && selectedCartera.bucket !== entry.bucket ? 0.3 : 1 }}
                      />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatCurrency(value)} />
                  <Legend verticalAlign="bottom" height={36}/>
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>


        </>
      )}

      {/* Tabla de Auditoría Data Quality */}
      <div style={{ background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,70,135,0.1)' }}>
        <h3 style={{ margin: '0 0 1rem 0', color: '#0D1B2A', fontSize: '1.1rem' }}>Auditoría Automática de Exclusiones</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #E2E8F0', color: '#64748B', textAlign: 'left' }}>
              <th style={{ padding: '0.75rem 0' }}>Motivo de Exclusión</th>
              <th style={{ padding: '0.75rem 0', textAlign: 'right' }}>Registros Filtrados</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid #F1F5F9' }}>
              <td style={{ padding: '0.75rem 0', color: '#0D1B2A' }}>Cuentas no finalizadas (En piso o abiertas)</td>
              <td style={{ padding: '0.75rem 0', textAlign: 'right', fontWeight: 600, color: '#EF4444' }}>{audit.motivos.noFinalizada}</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #F1F5F9' }}>
              <td style={{ padding: '0.75rem 0', color: '#0D1B2A' }}>Importes $0 o negativos (Garantías/Errores)</td>
              <td style={{ padding: '0.75rem 0', textAlign: 'right', fontWeight: 600, color: '#EF4444' }}>{audit.motivos.cerosONegativos}</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #F1F5F9' }}>
              <td style={{ padding: '0.75rem 0', color: '#0D1B2A' }}>Pacientes de Prueba (TEST, PRUEBA)</td>
              <td style={{ padding: '0.75rem 0', textAlign: 'right', fontWeight: 600, color: '#EF4444' }}>{audit.motivos.pacientePrueba}</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #F1F5F9' }}>
              <td style={{ padding: '0.75rem 0', color: '#0D1B2A' }}>Fechas Incoherentes (Errores de captura)</td>
              <td style={{ padding: '0.75rem 0', textAlign: 'right', fontWeight: 600, color: '#EF4444' }}>{audit.motivos.fechasIncoherentes}</td>
            </tr>
            <tr style={{ background: '#F8FAFC' }}>
              <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: '#004687' }}>Total Data Cruda Evaluada</td>
              <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700, color: '#004687' }}>{audit.totalCrudo}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Tabla de Detalle de Cuentas */}
      {data.listaCuentas && data.listaCuentas.length > 0 && (
        <div data-html2canvas-ignore="true" style={{ background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,70,135,0.1)', marginTop: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <h3 style={{ margin: 0, color: '#004687', fontSize: '1.1rem' }}>
                Detalle de Cuentas (Top {selectedCartera ? '50' : '100'}) {selectedCartera ? <span style={{ color: '#EF4444' }}>- {selectedCartera.name}</span> : ''}
              </h3>
              {selectedCartera && (
                <button 
                  onClick={() => setSelectedCartera(null)}
                  style={{ background: 'transparent', border: '1px solid #EF4444', color: '#EF4444', padding: '0.2rem 0.5rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
                >
                  Limpiar Filtro
                </button>
              )}
            </div>
            <span style={{ fontSize: '0.85rem', color: '#8A97A8' }}>{displayCuentas.length} registros encontrados</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#F8FAFC', borderBottom: '2px solid #E2E8F0', textAlign: 'left' }}>
                  <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600 }}>Alta Médica</th>
                  <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600 }}>Cuenta</th>
                  <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600 }}>Paciente</th>
                  <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600, textAlign: 'right' }}>Ingresos</th>
                  <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600, textAlign: 'right' }}>Utilidad</th>
                  <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600, textAlign: 'right' }}>Saldo</th>
                </tr>
              </thead>
              <tbody>
                {displayCuentas.map((c, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td style={{ padding: '0.75rem 1rem', color: '#64748B' }}>{c.MedicalDischargeDate ? c.MedicalDischargeDate.substring(0, 10) : (c.EntryDate ? c.EntryDate.substring(0, 10) : 'N/A')}</td>
                    <td 
                      onClick={() => fetchAccountDetails(c.PCNum)}
                      style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#005FA9', cursor: 'pointer', textDecoration: 'underline' }}
                      title="Ver Estado de Cuenta"
                    >
                      {c.PCNum}
                    </td>
                    <td 
                      onClick={() => fetchAccountDetails(c.PCNum)}
                      style={{ padding: '0.75rem 1rem', cursor: 'pointer', color: '#0D1B2A' }}
                      title="Ver Estado de Cuenta"
                      onMouseOver={(e) => e.currentTarget.style.color = '#005FA9'}
                      onMouseOut={(e) => e.currentTarget.style.color = '#0D1B2A'}
                    >
                      {c.FullName}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 500, color: '#10B981' }}>{formatCurrency(c.Total || 0)}</td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 500, color: '#3B82F6' }}>{formatCurrency(c.Profit || 0)}</td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 500, color: c.Balance > 0 ? '#EF4444' : '#64748B' }}>{formatCurrency(c.Balance || 0)}</td>
                  </tr>
                ))}
                {displayCuentas.length === 0 && (
                  <tr>
                    <td colSpan="6" style={{ padding: '1rem', textAlign: 'center', color: '#64748B' }}>No hay cuentas en esta categoría.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Estado de Cuenta */}
      {accountDetails && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          background: 'rgba(0,0,0,0.5)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem'
        }}>
          <div style={{
            background: 'white', borderRadius: '12px', width: '100%', maxWidth: '800px', 
            maxHeight: '90vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)'
          }}>
            <div style={{ padding: '1.5rem', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, color: '#004687', fontSize: '1.25rem' }}>Estado de Cuenta - {accountDetails.pcNum}</h3>
              <button onClick={() => setAccountDetails(null)} style={{ background: 'transparent', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#64748B' }}>&times;</button>
            </div>
            <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
              {loadingDetails ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#64748B' }}>Cargando detalles de cuenta...</div>
              ) : detailsError ? (
                <div style={{ padding: '1rem', background: '#FEE2E2', color: '#EF4444', borderRadius: '8px' }}>{detailsError}</div>
              ) : accountDetails.data.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#64748B' }}>No se encontraron cargos para esta cuenta.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ background: '#F8FAFC', borderBottom: '2px solid #E2E8F0', textAlign: 'left' }}>
                      <th style={{ padding: '0.75rem', color: '#475569' }}>Fecha</th>
                      <th style={{ padding: '0.75rem', color: '#475569' }}>Área</th>
                      <th style={{ padding: '0.75rem', color: '#475569' }}>Código</th>
                      <th style={{ padding: '0.75rem', color: '#475569' }}>Descripción</th>
                      <th style={{ padding: '0.75rem', color: '#475569', textAlign: 'right' }}>Cant.</th>
                      <th style={{ padding: '0.75rem', color: '#475569', textAlign: 'right' }}>Precio</th>
                      <th style={{ padding: '0.75rem', color: '#475569', textAlign: 'right' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accountDetails.data.map((row, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #F1F5F9' }}>
                        <td style={{ padding: '0.75rem', color: '#64748B' }}>{row.ChargeDate ? new Date(row.ChargeDate).toLocaleDateString() : 'N/A'}</td>
                        <td style={{ padding: '0.75rem', fontWeight: 600, color: '#005FA9' }}>{row.SUCode}</td>
                        <td style={{ padding: '0.75rem' }}>{row.ItemCode}</td>
                        <td style={{ padding: '0.75rem', color: '#334155', maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={row.ItemDescription || 'Sin descripción'}>
                          {row.ItemDescription || <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>Sin descripción ({row.ItemCode})</span>}
                        </td>
                        <td style={{ padding: '0.75rem', textAlign: 'right' }}>{row.Quantity}</td>
                        <td style={{ padding: '0.75rem', textAlign: 'right' }}>{formatCurrency(row.UnitPrice)}</td>
                        <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 600 }}>{formatCurrency(row.Total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#F8FAFC', borderTop: '2px solid #CBD5E1' }}>
                      <td colSpan="6" style={{ padding: '1rem 0.75rem', textAlign: 'right', fontWeight: 'bold', color: '#0F172A' }}>Total Cobrado:</td>
                      <td style={{ padding: '1rem 0.75rem', textAlign: 'right', fontWeight: 'bold', color: '#004687' }}>
                        {formatCurrency(accountDetails.data.reduce((sum, row) => sum + (row.Total || 0), 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function KPICard({ title, value, color, icon }) {
  return (
    <div style={{
      background: 'white',
      padding: '1.25rem',
      borderRadius: 12,
      borderLeft: `5px solid ${color}`,
      boxShadow: '0 2px 10px rgba(0,0,0,0.03)',
      display: 'flex',
      alignItems: 'center',
      gap: '1rem'
    }}>
      <div style={{ fontSize: '2rem' }}>{icon}</div>
      <div>
        <div style={{ color: '#64748B', fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</div>
        <div style={{ color: '#0D1B2A', fontSize: '1.25rem', fontWeight: 800, marginTop: '0.2rem' }}>{value}</div>
      </div>
    </div>
  );
}
