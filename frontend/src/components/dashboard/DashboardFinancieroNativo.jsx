import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ComposedChart, Line, LineChart
} from 'recharts';
import PremiumLoader from '../shared/PremiumLoader';
import { API_BASE } from '../../api/config';
import ExportButton from '../shared/ExportButton';

export default function DashboardFinancieroNativo() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [filters, setFilters] = useState({
    search: '',
    startDate: '',
    endDate: ''
  });

  const [applyTrigger, setApplyTrigger] = useState(0);

  useEffect(() => {
    fetchData();
  }, [applyTrigger]);

  const fetchData = async () => {
    try {
      const token = sessionStorage.getItem('escandon_token');
      
      let url = `${API_BASE}/dashboard/financiero-nativo?`;
      if (filters.startDate) url += `startDate=${filters.startDate}&`;
      if (filters.endDate) url += `endDate=${filters.endDate}&`;
      if (filters.search) url += `search=${encodeURIComponent(filters.search)}&`;

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

  const { tendenciaMensual, kpis, audit } = data;
  const pctValido = ((audit.valido / audit.totalCrudo) * 100).toFixed(1);
  
  const handleApply = () => setApplyTrigger(prev => prev + 1);
  const handleClear = () => {
    setFilters({ search: '', startDate: '', endDate: '' });
    setTimeout(() => setApplyTrigger(prev => prev + 1), 50);
  };

  return (
    <div id="dashboard-financiero" style={{ padding: '2rem 0', fontFamily: "'Inter', sans-serif", background: 'white' }}>

      {/* 🧠 Barra Inteligente Financiera */}
      <div style={{
        background: 'white', borderRadius: 12, padding: '1rem 1.5rem', marginBottom: '1.5rem',
        boxShadow: '0 2px 10px rgba(0,0,0,0.03)', border: '1px solid rgba(0,70,135,0.2)',
        display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap'
      }}>
        <div style={{ flex: '2 1 300px' }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748B', marginBottom: '0.3rem' }}>
            BÚSQUEDA DE PACIENTE O CUENTA (#)
          </label>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: 10, color: '#94A3B8' }}>🔍</span>
            <input
              type="text"
              value={filters.search}
              onChange={e => setFilters({...filters, search: e.target.value})}
              placeholder="Ej: Perez, 102030..."
              style={{ width: '100%', padding: '0.6rem 1rem 0.6rem 2.2rem', borderRadius: 6, border: '1px solid #CBD5E1', outline: 'none' }}
            />
          </div>
        </div>

        <div style={{ flex: '1 1 150px' }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748B', marginBottom: '0.3rem' }}>
            DESDE (ALTA MÉDICA)
          </label>
          <input type="date" value={filters.startDate} onChange={e => setFilters({...filters, startDate: e.target.value})} style={{ width: '100%', padding: '0.6rem', borderRadius: 6, border: '1px solid #CBD5E1', outline: 'none' }} />
        </div>
        
        <div style={{ flex: '1 1 150px' }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748B', marginBottom: '0.3rem' }}>
            HASTA
          </label>
          <input type="date" value={filters.endDate} onChange={e => setFilters({...filters, endDate: e.target.value})} style={{ width: '100%', padding: '0.6rem', borderRadius: 6, border: '1px solid #CBD5E1', outline: 'none' }} />
        </div>

        <button onClick={handleApply} style={{ background: '#005FA9', color: 'white', border: 'none', padding: '0.65rem 1.5rem', borderRadius: 6, fontWeight: 600, cursor: 'pointer', height: 42 }}>Aplicar</button>
        <button onClick={handleClear} style={{ background: 'transparent', color: '#64748B', border: '1px solid #CBD5E1', padding: '0.65rem 1rem', borderRadius: 6, fontWeight: 600, cursor: 'pointer', height: 42 }}>Limpiar</button>
        
        <div style={{ display: 'none', gap: '0.5rem', borderLeft: '1px solid #E2E8F0', paddingLeft: '1rem', marginLeft: 'auto' }}>
          <ExportButton id="export-pdf-btn" type="pdf" targetId="dashboard-financiero" compact={true} />
          <ExportButton 
            id="export-excel-btn"
            type="excel" 
            directUrl={`/dashboard/export-excel?dashboard=financiero&startDate=${filters.startDate}&endDate=${filters.endDate}&search=${encodeURIComponent(filters.search)}&area=${encodeURIComponent(filters.area)}`} 
            compact={true} 
          />
        </div>
      </div>
      
      {/* Tarjeta de Data Quality Especial */}
      <div style={{ background: '#0D1B2A', color: 'white', padding: '1.25rem', borderRadius: 12, marginBottom: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 4px 15px rgba(0,0,0,0.1)' }}>
        <div>
          <div style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#8A97A8' }}>Pipeline Data Science - Calidad de Datos</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 700, marginTop: '0.2rem' }}>
            <span style={{ color: '#00974A' }}>✓ {pctValido}%</span> Registros Válidos Analizados
          </div>
          <div style={{ fontSize: '0.85rem', color: '#CBD5E1', marginTop: '0.5rem' }}>
            Se excluyeron anomalías y cancelaciones matemáticamente para reflejar actividad real.
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#F59E0B' }}>{audit.outliersEncontrados}</div>
          <div style={{ fontSize: '0.8rem', color: '#8A97A8' }}>Posibles Outliers (IQR) Detectados</div>
        </div>
      </div>

      {/* KPIs Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <KPICard title="Ingresos Netos Validados" value={formatCurrency(kpis.ingresosAcumulados)} color="#005FA9" icon="💰" />
        <KPICard title="Cuentas por Cobrar" value={formatCurrency(kpis.cuentasPorCobrar)} color="#F59E0B" icon="🧾" />
        <KPICard title="Margen Promedio Real" value={`${kpis.margenPromedio.toFixed(1)}%`} color="#00974A" icon="📈" />
        <KPICard title="Utilidad Operativa" value={formatCurrency(kpis.utilidadAcumulada)} color="#8B5CF6" icon="💎" />
      </div>

      {/* Gráficas */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', marginBottom: '2rem' }}>
        
        {/* Gráfica de Barras: Ingresos vs Costos con Proyecciones */}
        <div style={{ flex: '1 1 500px', background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,70,135,0.1)' }}>
          <h3 style={{ margin: '0 0 1rem 0', color: '#0D1B2A', fontSize: '1.1rem' }}>Ingresos vs Costos y Proyección (RLS)</h3>
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
                <Bar isAnimationActive={false} dataKey="Costos" name="Costos Operativos" fill="#EF4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Gráfica de Líneas: Crecimiento de Utilidad */}
        <div style={{ flex: '1 1 500px', background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,70,135,0.1)' }}>
          <h3 style={{ margin: '0 0 1rem 0', color: '#0D1B2A', fontSize: '1.1rem' }}>Crecimiento de Utilidad Neta (Histórico y Predictivo)</h3>
          <div style={{ width: '100%', height: 350 }}>
            <ResponsiveContainer>
              <LineChart data={tendenciaMensual} margin={{ top: 10, right: 10, left: 20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="month" tick={{fill: '#64748B'}} tickLine={false} />
                <YAxis tickFormatter={(val) => `$${(val/1000000).toFixed(1)}M`} tick={{fill: '#64748B'}} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value) => formatCurrency(value)} />
                <Legend iconType="circle" />
                <Line isAnimationActive={false} type="monotone" dataKey="Utilidad" name="Utilidad Histórica" stroke="#00974A" strokeWidth={4} dot={{r: 6, fill: '#00974A', strokeWidth: 2, stroke: '#fff'}} activeDot={{r: 8}} connectNulls />
                <Line isAnimationActive={false} type="monotone" dataKey="UtilidadProyectada" name="Utilidad Proyectada" stroke="#00974A" strokeWidth={3} strokeDasharray="5 5" dot={{r: 5, fill: '#fff', strokeWidth: 2, stroke: '#00974A'}} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

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
            <h3 style={{ margin: 0, color: '#004687', fontSize: '1.1rem' }}>Detalle de Cuentas (Top 100)</h3>
            <span style={{ fontSize: '0.85rem', color: '#8A97A8' }}>{data.listaCuentas.length} registros encontrados</span>
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
                {data.listaCuentas.map((c, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td style={{ padding: '0.75rem 1rem', color: '#64748B' }}>{c.MedicalDischargeDate ? c.MedicalDischargeDate.substring(0, 10) : 'N/A'}</td>
                    <td 
                      onClick={() => { setFilters({...filters, search: c.PCNum.toString()}); setTimeout(() => setApplyTrigger(p => p + 1), 50); }}
                      style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#005FA9', cursor: 'pointer', textDecoration: 'underline' }}
                      title="Filtrar por Cuenta"
                    >
                      {c.PCNum}
                    </td>
                    <td 
                      onClick={() => { setFilters({...filters, search: c.FullName}); setTimeout(() => setApplyTrigger(p => p + 1), 50); }}
                      style={{ padding: '0.75rem 1rem', cursor: 'pointer', color: '#0D1B2A' }}
                      title="Filtrar por Paciente"
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
              </tbody>
            </table>
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
        <div style={{ color: '#0D1B2A', fontSize: '1.5rem', fontWeight: 800, marginTop: '0.2rem' }}>{value}</div>
      </div>
    </div>
  );
}
