import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area, PieChart, Pie, Cell, LineChart, Line, ComposedChart
} from 'recharts';
import { API_BASE } from '../../api/config';
import ExportButton from '../shared/ExportButton';
import PremiumLoader from '../shared/PremiumLoader';

export default function DashboardEficaciaNativo() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [options, setOptions] = useState({ medicos: [], especialidades: [] });
  const [filters, setFilters] = useState({
    medico: '',
    especialidad: '',
    startDate: '',
    endDate: '',
    search: ''
  });

  const [applyTrigger, setApplyTrigger] = useState(0);

  useEffect(() => {
    fetchOptions();
  }, []);

  useEffect(() => {
    fetchData();
  }, [applyTrigger]);

  const fetchOptions = async () => {
    try {
      const token = sessionStorage.getItem('escandon_token');
      const res = await fetch(`${API_BASE}/dashboard/filtros-eficacia`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json();
      if (json.ok) {
        setOptions(json.data);
      }
    } catch (err) {
      console.error('Error fetching options', err);
    }
  };

  const fetchData = async () => {
    try {
      const token = sessionStorage.getItem('escandon_token');

      let url = `${API_BASE}/dashboard/eficacia-nativo?`;
      if (filters.startDate) url += `startDate=${filters.startDate}&`;
      if (filters.endDate) url += `endDate=${filters.endDate}&`;
      
      // We will combine 'medico' and 'search' conceptually in the backend by just passing the exact Medico if selected.
      // But we can just use the search parameter for both text search and exact dropdown selection for now.
      // Actually, if we have a specific Medico, let's pass it as search. 
      // If we have an especialidad, we need to update the backend to accept 'especialidad' filter. Wait, backend efficacy doesn't accept 'especialidad' yet.
      
      let searchQuery = filters.search || filters.medico || filters.especialidad; // For now, we will just use 'search'
      if (searchQuery) url += `search=${encodeURIComponent(searchQuery)}&`;
      if (filters.especialidad) url += `especialidad=${encodeURIComponent(filters.especialidad)}&`; // We will need to update backend to support this if we want specific specialty filtering

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

  if (loading) {
    return <PremiumLoader text="Cargando Indicadores de Eficacia Médica..." style={{ height: '300px' }} />;
  }

  if (error) {
    return <div style={{ padding: 20, color: '#EF4444', background: '#FEE2E2', borderRadius: 8 }}>{error}</div>;
  }

  const { tendenciaMensual, topEspecialidades, topMedicos, estatusConsultas, kpis } = data;
  const STATUS_COLORS = ['#0088C9', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

  const handleApply = () => setApplyTrigger(prev => prev + 1);
  const handleClear = () => {
    setFilters({ medico: '', especialidad: '', startDate: '', endDate: '', search: '' });
    setTimeout(() => setApplyTrigger(prev => prev + 1), 50);
  };

  const handleBarClick = (entry) => {
    if (entry && entry.Medico) {
      setFilters(prev => ({ ...prev, medico: entry.Medico, search: entry.Medico }));
      setTimeout(() => setApplyTrigger(prev => prev + 1), 50);
    }
  };

  return (
    <div id="dashboard-eficacia" style={{ padding: '2rem 0', fontFamily: "'Inter', sans-serif", background: 'white' }}>
      
      {/* 🧠 Barra Inteligente (Slicers) */}
      <div style={{
        background: 'white', borderRadius: 12, padding: '1rem 1.5rem', marginBottom: '1.5rem',
        boxShadow: '0 2px 10px rgba(0,0,0,0.03)', border: '1px solid rgba(0,136,201,0.2)',
        display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap'
      }}>
        <div style={{ flex: '1 1 200px' }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748B', marginBottom: '0.3rem' }}>
            MÉDICO
          </label>
          <input
            list="medicos-list"
            value={filters.medico}
            onChange={e => setFilters({...filters, medico: e.target.value, search: e.target.value})}
            placeholder="Seleccionar o buscar..."
            style={{ width: '100%', padding: '0.6rem', borderRadius: 6, border: '1px solid #CBD5E1', outline: 'none' }}
          />
          <datalist id="medicos-list">
            {options.medicos.map((m, i) => <option key={i} value={m} />)}
          </datalist>
        </div>

        <div style={{ flex: '1 1 200px' }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748B', marginBottom: '0.3rem' }}>
            ESPECIALIDAD
          </label>
          <input
            list="esp-list"
            value={filters.especialidad}
            onChange={e => setFilters({...filters, especialidad: e.target.value})}
            placeholder="Seleccionar o buscar..."
            style={{ width: '100%', padding: '0.6rem', borderRadius: 6, border: '1px solid #CBD5E1', outline: 'none' }}
          />
          <datalist id="esp-list">
            {options.especialidades.map((e, i) => <option key={i} value={e} />)}
          </datalist>
        </div>

        <div style={{ flex: '1 1 150px' }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748B', marginBottom: '0.3rem' }}>
            DESDE
          </label>
          <input type="date" value={filters.startDate} onChange={e => setFilters({...filters, startDate: e.target.value})} style={{ width: '100%', padding: '0.6rem', borderRadius: 6, border: '1px solid #CBD5E1', outline: 'none' }} />
        </div>
        
        <div style={{ flex: '1 1 150px' }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748B', marginBottom: '0.3rem' }}>
            HASTA
          </label>
          <input type="date" value={filters.endDate} onChange={e => setFilters({...filters, endDate: e.target.value})} style={{ width: '100%', padding: '0.6rem', borderRadius: 6, border: '1px solid #CBD5E1', outline: 'none' }} />
        </div>

        <button onClick={handleApply} style={{ background: '#0088C9', color: 'white', border: 'none', padding: '0.65rem 1.5rem', borderRadius: 6, fontWeight: 600, cursor: 'pointer', height: 42 }}>Aplicar</button>
        <button onClick={handleClear} style={{ background: 'transparent', color: '#64748B', border: '1px solid #CBD5E1', padding: '0.65rem 1rem', borderRadius: 6, fontWeight: 600, cursor: 'pointer', height: 42 }}>Limpiar</button>
        
        <div style={{ display: 'none', gap: '0.5rem', borderLeft: '1px solid #E2E8F0', paddingLeft: '1rem', marginLeft: 'auto' }}>
          <ExportButton id="export-pdf-btn" type="pdf" targetId="dashboard-eficacia" compact={true} />
          <ExportButton 
            id="export-excel-btn"
            type="excel" 
            directUrl={`/dashboard/export-excel?dashboard=eficacia&startDate=${filters.startDate}&endDate=${filters.endDate}&search=${encodeURIComponent(filters.search)}&especialidad=${encodeURIComponent(filters.especialidad)}`} 
            compact={true} 
          />
        </div>
      </div>
      
      {/* Banner Superior */}
      <div style={{ background: '#0D1B2A', color: 'white', padding: '1.25rem', borderRadius: 12, marginBottom: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 4px 15px rgba(0,0,0,0.1)' }}>
        <div>
          <div style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#8A97A8' }}>Control de Rendimiento Médico</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '0.2rem' }}>
            <span style={{ color: '#0088C9' }}>⚡ UDR_BI_PRODUCTIVIDAD_MEDICOS & V_UDR_CONSULTA_DIA</span>
          </div>
          <div style={{ fontSize: '0.85rem', color: '#CBD5E1', marginTop: '0.3rem' }}>
            Análisis comparativo de consultas y productividad hospitalaria (100% Nativo).
          </div>
        </div>
      </div>

      {/* Tarjetas de KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <KPICard title="Total de Consultas (YTD)" value={kpis.totalConsultas.toLocaleString()} color="#0088C9" icon="🩺" />
        <KPICard title="Top Especialidad" value={kpis.topEspecialidad} color="#10B981" icon="🏆" isText={true} />
        <KPICard title="Primeras Veces" value={kpis.primeras.toLocaleString()} color="#8B5CF6" icon="👤" />
        <KPICard title="Subsecuentes" value={kpis.subsecuentes.toLocaleString()} color="#F59E0B" icon="🔄" />
      </div>

      {/* Gráficas Principales */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', marginBottom: '2rem' }}>
        
        {/* Tendencia Mensual (AreaChart) */}
        <div style={{ flex: '1 1 400px', background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,136,201,0.1)' }}>
          <h3 style={{ margin: '0 0 1rem 0', color: '#0D1B2A', fontSize: '1.1rem' }}>Volumen de Consultas por Mes</h3>
          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer>
              <AreaChart data={tendenciaMensual} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0088C9" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#0088C9" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="monthStr" tick={{fill: '#64748B'}} tickLine={false} />
                <YAxis tick={{fill: '#64748B'}} axisLine={false} tickLine={false} />
                <Tooltip />
                <Legend iconType="circle" />
                <Area isAnimationActive={false} type="monotone" dataKey="Total" name="Consultas Totales" stroke="#0088C9" strokeWidth={3} fillOpacity={1} fill="url(#colorTotal)" />
                <Area isAnimationActive={false} type="monotone" dataKey="Primeras" name="Primeras Veces" stroke="#8B5CF6" strokeWidth={2} fillOpacity={0} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Estatus Consultas (PieChart) */}
        <div style={{ flex: '1 1 400px', background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,136,201,0.1)' }}>
          <h3 style={{ margin: '0 0 1rem 0', color: '#0D1B2A', fontSize: '1.1rem' }}>Estatus de Citas del Día</h3>
          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  isAnimationActive={false}
                  data={estatusConsultas}
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="valor"
                >
                  {estatusConsultas.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={STATUS_COLORS[index % STATUS_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => value.toLocaleString()} />
                <Legend layout="vertical" verticalAlign="middle" align="right" />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Top Especialidades y Médicos */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem' }}>
        
        {/* Top 10 Especialidades */}
        <div style={{ flex: '1 1 400px', background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,136,201,0.1)' }}>
          <h3 style={{ margin: '0 0 1rem 0', color: '#0D1B2A', fontSize: '1.1rem' }}>Top 10 Especialidades</h3>
          <div style={{ width: '100%', height: 350 }}>
            <ResponsiveContainer>
              <BarChart layout="vertical" data={topEspecialidades} margin={{ top: 10, right: 30, left: 100, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                <XAxis type="number" tick={{fill: '#64748B'}} axisLine={false} tickLine={false} />
                <YAxis dataKey="Especialidad" type="category" tick={{fill: '#334155', fontSize: 11}} axisLine={false} tickLine={false} width={150} />
                <Tooltip cursor={{fill: 'rgba(0,136,201,0.05)'}} />
                <Bar 
                  isAnimationActive={false}
                  dataKey="Total" 
                  name="Consultas" 
                  fill="#10B981" 
                  radius={[0, 4, 4, 0]} 
                  barSize={20} 
                  onClick={(entry) => {
                    if(entry && entry.Especialidad) {
                      setFilters(prev => ({ ...prev, especialidad: entry.Especialidad }));
                      setTimeout(() => setApplyTrigger(prev => prev + 1), 50);
                    }
                  }} 
                  style={{ cursor: 'pointer' }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top 10 Médicos */}
        <div style={{ flex: '1 1 400px', background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,136,201,0.1)' }}>
          <h3 style={{ margin: '0 0 1rem 0', color: '#0D1B2A', fontSize: '1.1rem' }}>Top 10 Médicos (Productividad)</h3>
          <div style={{ width: '100%', height: 350 }}>
            <ResponsiveContainer>
              <BarChart layout="vertical" data={topMedicos} margin={{ top: 10, right: 30, left: 120, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                <XAxis type="number" tick={{fill: '#64748B'}} axisLine={false} tickLine={false} />
                <YAxis dataKey="Medico" type="category" tick={{fill: '#334155', fontSize: 10}} axisLine={false} tickLine={false} width={180} />
                <Tooltip cursor={{fill: 'rgba(0,136,201,0.05)'}} />
                <Bar isAnimationActive={false} dataKey="Total" name="Consultas" fill="#0088C9" radius={[0, 4, 4, 0]} barSize={20} onClick={handleBarClick} style={{ cursor: 'pointer' }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* Tabla de Detalle de Pacientes/Consultas */}
      {data.listaConsultas && data.listaConsultas.length > 0 && (
        <div data-html2canvas-ignore="true" style={{ background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,136,201,0.1)', marginTop: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0, color: '#0D1B2A', fontSize: '1.1rem' }}>Detalle de Consultas (Top 100)</h3>
            <span style={{ fontSize: '0.85rem', color: '#8A97A8' }}>{data.listaConsultas.length} registros encontrados</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#F8FAFC', borderBottom: '2px solid #E2E8F0', textAlign: 'left' }}>
                  <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600 }}>Fecha/Hora</th>
                  <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600 }}>Cita</th>
                  <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600 }}>Paciente</th>
                  <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600 }}>Médico</th>
                  <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600 }}>Especialidad</th>
                  <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600 }}>Estatus</th>
                </tr>
              </thead>
              <tbody>
                {data.listaConsultas.map((c, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td style={{ padding: '0.75rem 1rem', color: '#64748B' }}>{c.Fecha} {c.Hora && <span style={{fontSize: '0.75rem', marginLeft: '0.2rem'}}>{c.Hora.substring(0,5)}</span>}</td>
                    
                    <td 
                      onClick={() => { setFilters({...filters, search: c.Numero_Cita.toString()}); setTimeout(() => setApplyTrigger(p => p + 1), 50); }}
                      style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#005FA9', cursor: 'pointer', textDecoration: 'underline' }}
                      title="Filtrar por Cita"
                    >
                      #{c.Numero_Cita}
                    </td>
                    
                    <td 
                      onClick={() => { setFilters({...filters, search: c.Paciente}); setTimeout(() => setApplyTrigger(p => p + 1), 50); }}
                      style={{ padding: '0.75rem 1rem', cursor: 'pointer', color: '#0D1B2A' }}
                      title="Filtrar por Paciente"
                      onMouseOver={(e) => e.currentTarget.style.color = '#005FA9'}
                      onMouseOut={(e) => e.currentTarget.style.color = '#0D1B2A'}
                    >
                      {c.Paciente} <span style={{color: '#94A3B8', fontSize: '0.75rem'}}>({c.Edad_Anios})</span>
                    </td>
                    
                    <td 
                      onClick={() => { setFilters({...filters, medico: c.Medico, search: c.Medico}); setTimeout(() => setApplyTrigger(p => p + 1), 50); }}
                      style={{ padding: '0.75rem 1rem', color: '#005FA9', cursor: 'pointer', fontWeight: 600 }}
                      title="Filtrar por Médico"
                    >
                      {c.Medico}
                    </td>
                    
                    <td 
                      onClick={() => { setFilters({...filters, especialidad: c.Especialidad}); setTimeout(() => setApplyTrigger(p => p + 1), 50); }}
                      style={{ padding: '0.75rem 1rem', cursor: 'pointer', color: '#0D1B2A' }}
                      title="Filtrar por Especialidad"
                      onMouseOver={(e) => e.currentTarget.style.color = '#005FA9'}
                      onMouseOut={(e) => e.currentTarget.style.color = '#0D1B2A'}
                    >
                      {c.Especialidad}
                    </td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <span style={{ 
                        background: c.Estatus_Orden_Venta === 'Confirmada' ? '#D1FAE5' : c.Estatus_Orden_Venta === 'Procesada' ? '#E0F2FE' : '#FEE2E2',
                        color: c.Estatus_Orden_Venta === 'Confirmada' ? '#065F46' : c.Estatus_Orden_Venta === 'Procesada' ? '#0369A1' : '#991B1B',
                        padding: '0.2rem 0.6rem',
                        borderRadius: 12,
                        fontSize: '0.75rem',
                        fontWeight: 600
                      }}>
                        {c.Estatus_Orden_Venta}
                      </span>
                    </td>
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

function KPICard({ title, value, color, icon, isText = false }) {
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
      <div style={{ overflow: 'hidden' }}>
        <div style={{ color: '#64748B', fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{title}</div>
        <div style={{ 
          color: '#0D1B2A', 
          fontSize: isText ? '1.1rem' : '1.5rem', 
          fontWeight: 800, 
          marginTop: '0.2rem',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}>
          {value}
        </div>
      </div>
    </div>
  );
}
