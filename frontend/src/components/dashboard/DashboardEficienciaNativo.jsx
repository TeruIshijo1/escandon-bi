import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ComposedChart, Line
} from 'recharts';
import { API_BASE } from '../../api/config';
import PremiumLoader from '../shared/PremiumLoader';
import ExportButton from '../shared/ExportButton';

export default function DashboardEficienciaNativo({ globalFilters, globalTrigger }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [applyTrigger, setApplyTrigger] = useState(0);

  useEffect(() => {
    fetchData();
  }, [applyTrigger, globalTrigger]);

  const fetchData = async () => {
    try {
      const token = sessionStorage.getItem('escandon_token');
      
      let url = `${API_BASE}/dashboard/eficiencia-nativo?`;
      if (globalFilters?.startDate) url += `startDate=${globalFilters.startDate}&`;
      if (globalFilters?.endDate) url += `endDate=${globalFilters.endDate}&`;

      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const jsonEfi = await res.json();
      
      if (jsonEfi.ok) {
        setData(jsonEfi.data);
      } else {
        setError(jsonEfi.error || 'Error al cargar datos');
      }
    } catch (err) {
      setError('Error de conexión con el servidor.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <PremiumLoader text="Cargando Indicadores Operativos..." style={{ height: '300px' }} />;
  }

  if (error) {
    return <div style={{ padding: 20, color: '#EF4444', background: '#FEE2E2', borderRadius: 8 }}>{error}</div>;
  }

  const { tendenciaMensual, kpis } = data;
  
  const handleApply = () => setApplyTrigger(prev => prev + 1);
  const handleClear = () => {
    setTimeout(() => setApplyTrigger(prev => prev + 1), 50);
  };

  return (
    <div id="dashboard-eficiencia" style={{ padding: '2rem 0', fontFamily: "'Inter', sans-serif", background: 'white' }}>

      {/* 🧠 Barra Inteligente Eficiencia (Removed as we use GlobalFilterBar) */}
      <div style={{ display: 'none' }}>
        <button onClick={handleApply} style={{ background: '#0088C9', color: 'white', border: 'none', padding: '0.65rem 1.5rem', borderRadius: 6, fontWeight: 600, cursor: 'pointer', height: 42 }}>Aplicar</button>
        <button onClick={handleClear} style={{ background: 'transparent', color: '#64748B', border: '1px solid #CBD5E1', padding: '0.65rem 1rem', borderRadius: 6, fontWeight: 600, cursor: 'pointer', height: 42 }}>Limpiar</button>
        
        <div style={{ display: 'none', gap: '0.5rem', borderLeft: '1px solid #E2E8F0', paddingLeft: '1rem', marginLeft: 'auto' }}>
          <ExportButton id="export-pdf-btn" type="pdf" targetId="dashboard-eficiencia" compact={true} />
          <ExportButton 
            id="export-excel-btn"
            type="excel" 
            directUrl={`/dashboard/export-excel?dashboard=eficiencia&startDate=${globalFilters?.startDate || ''}&endDate=${globalFilters?.endDate || ''}`} 
            compact={true} 
          />
        </div>
      </div>



      {/* KPIs Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <KPICard title="Camas Ocupadas (Promedio)" value={kpis.camasOcupadas} color="#0088C9" icon="🛏️" />
        <KPICard title="Quirófanos Activos" value={kpis.quirofanosActivos} color="#8B5CF6" icon="⚕️" />
        <KPICard title="Total Urgencias (6m)" value={kpis.urgencias} color="#EF4444" icon="🚑" />
        <KPICard title="Total Hospitalización (6m)" value={kpis.hospitalizacion} color="#F59E0B" icon="🏥" />
      </div>

      {/* Gráficas Principales */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        
        {/* Gráfica de Barras: Volumetría */}
        <div style={{ background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,136,201,0.1)' }}>
          <h3 style={{ margin: '0 0 1rem 0', color: '#0D1B2A', fontSize: '1.1rem' }}>Volumetría de Pacientes (Urgencias vs Piso)</h3>
          <div style={{ width: '100%', height: 350 }}>
            <ResponsiveContainer>
              <BarChart data={tendenciaMensual} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="monthStr" tick={{fill: '#64748B'}} tickLine={false} />
                <YAxis tick={{fill: '#64748B'}} axisLine={false} tickLine={false} />
                <Tooltip cursor={{fill: 'rgba(0,136,201,0.05)'}} />
                <Legend iconType="circle" />
                <Bar dataKey="Urgencias" name="Urgencias" fill="#EF4444" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Hospitalizacion" name="Hospitalización (Piso)" fill="#F59E0B" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Gráfica Composed: ALOS (Tiempo de Estancia) vs Meta */}
        <div style={{ background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,136,201,0.1)' }}>
          <h3 style={{ margin: '0 0 1rem 0', color: '#0D1B2A', fontSize: '1.1rem' }}>ALOS: Promedio Estancia Clínica (Horas)</h3>
          <div style={{ width: '100%', height: 350 }}>
            <ResponsiveContainer>
              <ComposedChart data={tendenciaMensual} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="monthStr" tick={{fill: '#64748B'}} tickLine={false} />
                <YAxis tick={{fill: '#64748B'}} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value) => `${parseFloat(value).toFixed(1)} hrs`} />
                <Legend iconType="circle" />
                <Bar dataKey="EgresoHoras" name="Tiempo Real (hrs)" fill="#0088C9" radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="EgresoMeta" name="Meta Institucional (hrs)" stroke="#EF4444" strokeWidth={3} strokeDasharray="5 5" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* Gráficas de Tiempos de Respuesta (SLA) */}
      <h2 style={{ fontSize: '1.25rem', color: '#0D1B2A', marginBottom: '1rem', paddingLeft: '0.5rem', borderLeft: '4px solid #0088C9' }}>Tiempos de Respuesta de Servicios (SLA en Minutos)</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
        
        <SLACard title="Triaje" data={tendenciaMensual} realKey="TriajeMin" metaKey="TriajeMeta" color="#8B5CF6" />
        <SLACard title="Laboratorio Clínico" data={tendenciaMensual} realKey="LaboratorioMin" metaKey="LaboratorioMeta" color="#0EA5E9" />
        <SLACard title="Imagenología" data={tendenciaMensual} realKey="ImagenologiaMin" metaKey="ImagenologiaMeta" color="#10B981" />

      </div>

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

function SLACard({ title, data, realKey, metaKey, color }) {
  return (
    <div style={{ background: 'white', padding: '1rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.03)', border: '1px solid #E2E8F0' }}>
      <h4 style={{ margin: '0 0 1rem 0', color: '#475569', fontSize: '1rem', textAlign: 'center' }}>{title} (Real vs Meta)</h4>
      <div style={{ width: '100%', height: 200 }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
            <XAxis dataKey="monthStr" tick={{fill: '#94A3B8', fontSize: 10}} tickLine={false} />
            <YAxis tick={{fill: '#94A3B8', fontSize: 10}} axisLine={false} tickLine={false} />
            <Tooltip formatter={(value) => `${parseFloat(value).toFixed(1)} min`} />
            <Line type="monotone" dataKey={realKey} name="Tiempo Real" stroke={color} strokeWidth={3} dot={{r: 4, fill: color, strokeWidth: 2, stroke: '#fff'}} />
            <Line type="monotone" dataKey={metaKey} name="Meta" stroke="#EF4444" strokeWidth={2} strokeDasharray="3 3" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
