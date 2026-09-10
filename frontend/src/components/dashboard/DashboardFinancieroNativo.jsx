import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ComposedChart, Line, LineChart, PieChart, Pie, Cell
} from 'recharts';
import PremiumLoader from '../shared/PremiumLoader';
import { API_BASE } from '../../api/config';
import ExportButton from '../shared/ExportButton';
import useEscapeKey from '../../hooks/useEscapeKey';

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

  useEscapeKey(() => setAccountDetails(null), !!accountDetails);

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

  return (
    <div id="dashboard-financiero" style={{ padding: '2rem 0', fontFamily: "'Inter', sans-serif", background: 'white' }}>


      


      {/* KPIs Cards */}
      <style>{`
        .fin-kpi-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 0.9rem; margin-bottom: 2rem; }
        @media (max-width: 1400px) { .fin-kpi-grid { grid-template-columns: repeat(3, 1fr); } }
        @media (max-width: 640px) { .fin-kpi-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 420px) { .fin-kpi-grid { grid-template-columns: 1fr; } }
        .fin-kpi {
          position: relative; overflow: hidden;
          background: linear-gradient(180deg, #FFFFFF 0%, #F8FBFE 100%);
          border: 1px solid #E4EDF4; border-radius: 18px;
          padding: 1rem 1.05rem 1.05rem;
          box-shadow: 0 4px 14px rgba(0,30,60,0.06);
          transition: transform 0.22s cubic-bezier(0.16,1,0.3,1), box-shadow 0.22s ease, border-color 0.22s ease;
          min-width: 0;
        }
        .fin-kpi::before {
          content: ""; position: absolute; left: 0; right: 0; top: 0; height: 4px;
          background: var(--accent, #005FA9);
        }
        .fin-kpi::after {
          content: ""; position: absolute; width: 150px; height: 150px; right: -50px; top: -70px;
          border-radius: 50%; background: radial-gradient(circle, var(--accent, #005FA9) 0%, transparent 70%);
          opacity: 0.08; pointer-events: none;
        }
        .fin-kpi:hover { transform: translateY(-3px); box-shadow: 0 12px 28px rgba(0,30,60,0.12); border-color: #CBD5E1; }
        .fin-kpi-top { display: flex; align-items: center; gap: 0.7rem; margin-bottom: 0.55rem; }
        .fin-kpi-icon {
          width: 42px; height: 42px; border-radius: 13px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          background: var(--accentSoft, rgba(0,95,169,0.1)); color: var(--accent, #005FA9);
          box-shadow: inset 0 0 0 1px rgba(0,0,0,0.04);
        }
        .fin-kpi-title {
          color: #64748B; font-size: 0.68rem; font-weight: 800;
          text-transform: uppercase; letter-spacing: 0.08em; line-height: 1.35;
        }
        .fin-kpi-value {
          color: #0F172A; font-weight: 800; letter-spacing: -0.02em; line-height: 1.1;
          font-size: clamp(1.02rem, 1.15rem + 0.25vw, 1.3rem);
          font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .fin-kpi-sub { color: #94A3B8; font-size: 0.73rem; font-weight: 500; margin-top: 0.3rem; line-height: 1.4; }
      `}</style>
      <div className="fin-kpi-grid">
        <KPICard title="Ingresos Facturados" value={formatCurrency(kpis.ingresosAcumulados)} color="#005FA9" subtitle="Total facturado de cuentas cerradas" icon={
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" /><path d="M12 6v2m0 8v2" /></svg>
        } />
        <KPICard title="Costo Insumos y Meds" value={formatCurrency(kpis.costosAcumulados)} color="#EF4444" subtitle="Costo directo de atención" icon={
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7l6 6 4-4 8 8" /><path d="M21 10v7h-7" /></svg>
        } />
        <KPICard title="Utilidad Bruta" value={formatCurrency(kpis.utilidadAcumulada)} color="#10B981" subtitle="Ingresos menos Costo Directo" icon={
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12l4 6-10 12L2 9l4-6z" /><path d="M2 9h20" /><path d="M9 3l3 6 3-6" /></svg>
        } />
        <KPICard title="Margen Bruto" value={`${kpis.margenPromedio.toFixed(1)}%`} color="#0088C9" subtitle="Rentabilidad promedio" icon={
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="M7 15l4-6 4 3 5-8" /></svg>
        } />
        <KPICard title="Cobranza / Anticipos" value={formatCurrency(kpis.cobranzaRealizada || (kpis.ingresosAcumulados - kpis.cuentasPorCobrar))} color="#059669" subtitle="Monto total liquidado" icon={
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /><path d="M6 15h4" /></svg>
        } />
        <KPICard title="Saldos por Cobrar" value={formatCurrency(kpis.cuentasPorCobrar)} color="#F59E0B" subtitle="Cuentas con saldo pendiente" icon={
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2z" /><path d="M9 7h6M9 11h6" /></svg>
        } />
      </div>

      {/* Gráficas */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', marginBottom: '2rem' }}>
        
        {/* Gráfica de Barras: Ingresos vs Costos con Proyecciones */}
        <div style={{ flex: '1 1 500px', background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,70,135,0.1)' }}>
          <h3 style={{ margin: '0 0 0.35rem 0', color: '#0D1B2A', fontSize: '1.1rem' }}>Ingresos vs Costos y Proyección (ML/IA)</h3>
          <p style={{ margin: '0 0 1rem 0', fontSize: '0.8rem', color: '#64748B' }}>Histórico mensual de facturación real contra costos y proyección predictiva.</p>
          <div style={{ width: '100%', height: 350 }}>
            <ResponsiveContainer>
              <BarChart data={tendenciaMensual} margin={{ top: 10, right: 10, left: 20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="month" tick={{fill: '#64748B'}} tickLine={false} />
                <YAxis tickFormatter={(val) => `$${(val/1000000).toFixed(1)}M`} tick={{fill: '#64748B'}} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value) => formatCurrency(value)} labelStyle={{color: '#000'}} cursor={{fill: 'rgba(0,70,135,0.05)'}} />
                <Legend iconType="circle" />
                <Bar isAnimationActive={false} dataKey="Ingresos" name="Ingresos Facturados" fill="#005FA9" radius={[4, 4, 0, 0]} />
                <Bar isAnimationActive={false} dataKey="IngresosProyectados" name="Ingresos Proyectados" fill="rgba(0,95,169,0.4)" radius={[4, 4, 0, 0]} />
                <Bar isAnimationActive={false} dataKey="Costos" name="Costo Directo" fill="#EF4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Gráfica de Líneas: Crecimiento de Utilidad */}
        <div style={{ flex: '1 1 500px', background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,70,135,0.1)' }}>
          <h3 style={{ margin: '0 0 0.35rem 0', color: '#0D1B2A', fontSize: '1.1rem' }}>Crecimiento de Utilidad Bruta (Histórico y Predictivo)</h3>
          <p style={{ margin: '0 0 1rem 0', fontSize: '0.8rem', color: '#64748B' }}>Evolución de la utilidad operativa mensual con modelo predictivo de IA.</p>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ margin: 0, color: '#0D1B2A', fontSize: '1.1rem' }}>Antigüedad de Saldos por Cobrar (Aging de Cartera)</h3>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: '#64748B' }}>Haz clic en un segmento para filtrar las cuentas con saldo pendiente en ese rango de días.</p>
              </div>
              {selectedCartera && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#005FA9' }}>Filtrado por: {selectedCartera.name}</span>
                  <button 
                    onClick={() => setSelectedCartera(null)}
                    style={{ background: '#FEE2E2', border: '1px solid #EF4444', color: '#EF4444', padding: '0.25rem 0.6rem', borderRadius: 6, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700 }}
                  >
                    ✕ Quitar Filtro
                  </button>
                </div>
              )}
            </div>
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
        <h3 style={{ margin: '0 0 0.25rem 0', color: '#0D1B2A', fontSize: '1.1rem' }}>Auditoría Automática de Calidad de Datos (Data Quality)</h3>
        <p style={{ margin: '0 0 1rem 0', fontSize: '0.8rem', color: '#64748B' }}>Filtros de integridad aplicados para asegurar la coherencia financiera directiva ({pctValido}% de registros válidos).</p>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #E2E8F0', color: '#64748B', textAlign: 'left' }}>
              <th style={{ padding: '0.75rem 0' }}>Criterio de Validación / Exclusión</th>
              <th style={{ padding: '0.75rem 0', textAlign: 'right' }}>Registros Filtrados</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid #F1F5F9' }}>
              <td style={{ padding: '0.75rem 0', color: '#0D1B2A' }}>Cuentas abiertas / pacientes en estancia hospitalaria (No finalizadas)</td>
              <td style={{ padding: '0.75rem 0', textAlign: 'right', fontWeight: 600, color: '#F59E0B' }}>{audit.motivos.noFinalizada}</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #F1F5F9' }}>
              <td style={{ padding: '0.75rem 0', color: '#0D1B2A' }}>Importes en $0 o negativos (Garantías/Cancelaciones)</td>
              <td style={{ padding: '0.75rem 0', textAlign: 'right', fontWeight: 600, color: '#EF4444' }}>{audit.motivos.cerosONegativos}</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #F1F5F9' }}>
              <td style={{ padding: '0.75rem 0', color: '#0D1B2A' }}>Pacientes de prueba / sistemas (TEST, PRUEBA)</td>
              <td style={{ padding: '0.75rem 0', textAlign: 'right', fontWeight: 600, color: '#EF4444' }}>{audit.motivos.pacientePrueba}</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #F1F5F9' }}>
              <td style={{ padding: '0.75rem 0', color: '#0D1B2A' }}>Incoherencias temporales de alta médica</td>
              <td style={{ padding: '0.75rem 0', textAlign: 'right', fontWeight: 600, color: '#EF4444' }}>{audit.motivos.fechasIncoherentes}</td>
            </tr>
            <tr style={{ background: '#F8FAFC' }}>
              <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: '#004687' }}>Total Cuentas Evaluadas</td>
              <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700, color: '#004687' }}>{audit.totalCrudo} ({audit.valido} validadas)</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Tabla de Detalle de Cuentas */}
      {data.listaCuentas && data.listaCuentas.length > 0 && (
        <div data-html2canvas-ignore="true" style={{ background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,70,135,0.1)', marginTop: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div>
              <h3 style={{ margin: 0, color: '#004687', fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                Detalle Ejecutivo de Cuentas {selectedCartera ? <span style={{ color: '#EF4444', fontSize: '0.95rem' }}>({selectedCartera.name})</span> : ''}
              </h3>
              <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: '#64748B' }}>
                Haz clic en el número de cuenta o nombre de paciente para ver el Estado de Cuenta detallado con desglose de cargos.
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              {selectedCartera && (
                <button 
                  onClick={() => setSelectedCartera(null)}
                  style={{ background: 'transparent', border: '1px solid #EF4444', color: '#EF4444', padding: '0.35rem 0.75rem', borderRadius: 6, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700 }}
                >
                  ✕ Mostrar Todas
                </button>
              )}
              <span style={{ fontSize: '0.85rem', color: '#004687', background: 'rgba(0,70,135,0.08)', padding: '0.35rem 0.75rem', borderRadius: 6, fontWeight: 700 }}>
                {displayCuentas.length} cuentas listadas
              </span>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#F8FAFC', borderBottom: '2px solid #CBD5E1', textAlign: 'left' }}>
                  <th style={{ padding: '0.85rem 1rem', color: '#334155', fontWeight: 700 }}>Alta Médica</th>
                  <th style={{ padding: '0.85rem 1rem', color: '#334155', fontWeight: 700 }}>Cuenta</th>
                  <th style={{ padding: '0.85rem 1rem', color: '#334155', fontWeight: 700 }}>Paciente</th>
                  <th style={{ padding: '0.85rem 1rem', color: '#334155', fontWeight: 700, textAlign: 'right' }}>Total Facturado</th>
                  <th style={{ padding: '0.85rem 1rem', color: '#334155', fontWeight: 700, textAlign: 'right' }}>Costo Directo</th>
                  <th style={{ padding: '0.85rem 1rem', color: '#334155', fontWeight: 700, textAlign: 'right' }}>Utilidad</th>
                  <th style={{ padding: '0.85rem 1rem', color: '#334155', fontWeight: 700, textAlign: 'center' }}>Margen</th>
                  <th style={{ padding: '0.85rem 1rem', color: '#334155', fontWeight: 700, textAlign: 'right' }}>Pagado</th>
                  <th style={{ padding: '0.85rem 1rem', color: '#334155', fontWeight: 700, textAlign: 'right' }}>Saldo Pendiente</th>
                </tr>
              </thead>
              <tbody>
                {displayCuentas.map((c, i) => {
                  const totalAcc = c.TotalAccount !== undefined ? c.TotalAccount : (c.Balance || 0);
                  const cost = c.SubtotalCost || 0;
                  const profit = c.Profit !== undefined ? c.Profit : (totalAcc - cost);
                  const margin = c.ProfitMargin !== undefined ? c.ProfitMargin : (totalAcc > 0 ? (profit / totalAcc) * 100 : 0);
                  const pending = c.PendingBalance !== undefined ? c.PendingBalance : (c.Total > 0 ? c.Total : 0);
                  const paid = c.Paid !== undefined ? c.Paid : Math.max(0, totalAcc - pending);

                  return (
                    <tr key={i} style={{ borderBottom: '1px solid #F1F5F9', background: i % 2 === 1 ? '#FAFCFF' : 'white' }}>
                      <td style={{ padding: '0.75rem 1rem', color: '#64748B', whiteSpace: 'nowrap' }}>
                        {c.MedicalDischargeDate ? c.MedicalDischargeDate.substring(0, 10) : (c.EntryDate ? c.EntryDate.substring(0, 10) : 'N/A')}
                      </td>
                      <td 
                        onClick={() => fetchAccountDetails(c.PCNum)}
                        style={{ padding: '0.75rem 1rem', fontWeight: 700, color: '#005FA9', cursor: 'pointer', textDecoration: 'underline' }}
                        title="Ver desglose y cargos de la cuenta"
                      >
                        #{c.PCNum}
                      </td>
                      <td 
                        onClick={() => fetchAccountDetails(c.PCNum)}
                        style={{ padding: '0.75rem 1rem', cursor: 'pointer', color: '#0F172A', fontWeight: 600 }}
                        title="Ver desglose y cargos de la cuenta"
                        onMouseOver={(e) => e.currentTarget.style.color = '#005FA9'}
                        onMouseOut={(e) => e.currentTarget.style.color = '#0F172A'}
                      >
                        {c.FullName}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700, color: '#0F172A' }}>
                        {formatCurrency(totalAcc)}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 500, color: '#64748B' }}>
                        {formatCurrency(cost)}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700, color: '#005FA9' }}>
                        {formatCurrency(profit)}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                        <span style={{ 
                          display: 'inline-block',
                          padding: '0.2rem 0.5rem', 
                          borderRadius: '100px', 
                          fontSize: '0.75rem', 
                          fontWeight: 700,
                          background: margin >= 70 ? 'rgba(0,151,74,0.12)' : (margin >= 40 ? 'rgba(0,136,201,0.12)' : 'rgba(245,158,11,0.12)'),
                          color: margin >= 70 ? '#00974A' : (margin >= 40 ? '#0088C9' : '#D97706')
                        }}>
                          {margin.toFixed(1)}%
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 600, color: '#10B981' }}>
                        {formatCurrency(paid)}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                        {pending <= 0 ? (
                          <span style={{ 
                            display: 'inline-block', 
                            padding: '0.2rem 0.55rem', 
                            borderRadius: '6px', 
                            fontSize: '0.75rem', 
                            fontWeight: 700, 
                            background: '#DCFCE7', 
                            color: '#15803D' 
                          }}>
                            ✓ Liquidada
                          </span>
                        ) : (
                          <span style={{ 
                            display: 'inline-block', 
                            padding: '0.2rem 0.55rem', 
                            borderRadius: '6px', 
                            fontSize: '0.8rem', 
                            fontWeight: 700, 
                            background: '#FEE2E2', 
                            color: '#B91C1C' 
                          }}>
                            {formatCurrency(pending)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {displayCuentas.length === 0 && (
                  <tr>
                    <td colSpan="9" style={{ padding: '2rem', textAlign: 'center', color: '#64748B' }}>No hay cuentas en este rango de fechas o filtro seleccionado.</td>
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

function KPICard({ title, value, color, icon, subtitle }) {
  return (
    <div className="fin-kpi" style={{ '--accent': color, '--accentSoft': `${color}1A` }}>
      <div className="fin-kpi-top">
        <div className="fin-kpi-icon">{icon}</div>
        <div className="fin-kpi-title">{title}</div>
      </div>
      <div className="fin-kpi-value" title={value}>{value}</div>
      {subtitle && <div className="fin-kpi-sub">{subtitle}</div>}
    </div>
  );
}

