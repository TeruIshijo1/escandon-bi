import React, { useState, useEffect } from 'react';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar, Cell } from 'recharts';
import DashboardChart from './DashboardChart';
import { API_BASE } from '../../api/config';
import PremiumLoader from '../shared/PremiumLoader';
import ExportToolbar from '../shared/ExportToolbar';

const COLORS = ['#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#10B981', '#34D399', '#6EE7B7', '#F59E0B', '#FBBF24', '#FCD34D'];

export default function DashboardAuxiliaresNativo({ type, globalFilters, globalTrigger }) {
  const [data, setData] = useState({
    tendenciaAnual: [],
    topEstudios: []
  });
  const [loading, setLoading] = useState(true);

  const configMap = {
    laboratorio: { title: 'Laboratorio', colorBase: '#8B5CF6', colorAux: '#A78BFA', topLabel: 'Estudios' },
    imagenologia: { title: 'Imagenología', colorBase: '#F59E0B', colorAux: '#FBBF24', topLabel: 'Estudios' },
    farmacia: { title: 'Farmacia', colorBase: '#10B981', colorAux: '#34D399', topLabel: 'Medicamentos' },
    urgencias: { title: 'Urgencias/Consultas', colorBase: '#EF4444', colorAux: '#F87171', topLabel: 'Servicios' },
    hospitalizacion: { title: 'Hospitalización', colorBase: '#3B82F6', colorAux: '#60A5FA', topLabel: 'Servicios' },
    terapia: { title: 'Terapia Intensiva', colorBase: '#6366F1', colorAux: '#818CF8', topLabel: 'Servicios' }
  };

  const config = configMap[type] || configMap.laboratorio;
  const { title, colorBase, colorAux, topLabel } = config;

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const token = sessionStorage.getItem('escandon_token');
        const headers = { Authorization: `Bearer ${token}` };

        let url = `/api/dashboard/auxiliares-nativo/${type}?`;
        if (globalFilters?.startDate) url += `startDate=${globalFilters.startDate}&`;
        if (globalFilters?.endDate) url += `endDate=${globalFilters.endDate}&`;

        const res = await fetch(url, { headers });
        const json = await res.json();
        
        if (json.success) {
          setData({
            tendenciaAnual: json.tendenciaAnual || [],
            topEstudios: json.topEstudios || []
          });
        }
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [type, globalTrigger]);

  const formatMoney = (val) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(val);
  const formatNumber = (val) => new Intl.NumberFormat().format(val);

  const aggregatedAnual = React.useMemo(() => {
    const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const acc = {};
    data.tendenciaAnual.forEach(row => {
      const label = row.Mes ? `${meses[row.Mes - 1]} ${row.Yr.toString().slice(-2)}` : row.Yr;
      const key = row.Mes ? `${row.Yr}-${row.Mes}` : row.Yr;
      if (!acc[key]) acc[key] = { label, sortKey: row.Mes ? row.Yr * 100 + row.Mes : row.Yr, volumen: 0, ingresos: 0, ingresosSAP: 0 };
      acc[key].volumen += parseInt(row.volumen || 0);
      acc[key].ingresos += parseFloat(row.ingresos || 0);
      acc[key].ingresosSAP += parseFloat(row.ingresosSAP || 0);
    });
    return Object.values(acc).sort((a, b) => a.sortKey - b.sortKey);
  }, [data.tendenciaAnual]);

  const totalVolumen = data.tendenciaAnual.reduce((acc, curr) => acc + parseInt(curr.volumen || 0), 0);
  const totalIngresos = data.tendenciaAnual.reduce((acc, curr) => acc + parseFloat(curr.ingresos || 0), 0);
  const totalIngresosSAP = data.tendenciaAnual.reduce((acc, curr) => acc + parseFloat(curr.ingresosSAP || 0), 0);

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <PremiumLoader text={`Cargando información de ${title}...`} />
    </div>
  );



  return (
    <div className="fade-in area-native-dashboard dashboard-view" id={`dashboard-${type}-siti`}>
      <div className="area-native-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 className="area-text-primary" style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#111827' }}>
          Actividad de {title}
        </h2>
        <ExportToolbar 
          targetId={`dashboard-${type}-siti`} 
          fileNamePrefix={`SITI_${title}`} 
          excelData={{
            'Histórico Anual': data.tendenciaAnual,
            [`Top ${topLabel}`]: data.topEstudios
          }}
        />
      </div>
      {/* KPIs Rápidos */}
      <div className="area-metric-grid dashboard-metric-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        
        <div className="area-metric-card dashboard-metric-card" style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 10px 25px rgba(0,0,0,0.05)', borderLeft: `5px solid ${colorBase}` }}>
          <h3 className="area-metric-label area-metric-note dashboard-metric-label" style={{ fontSize: '0.8rem', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Estudios realizados</h3>
          <p className="area-metric-value dashboard-metric-value" style={{ fontSize: '1.8rem', fontWeight: 700, color: '#111827', marginTop: '0.5rem' }}>{formatNumber(totalVolumen)}</p>
          <p className="dashboard-metric-note">En el periodo seleccionado</p>
        </div>

        <div className="area-metric-card dashboard-metric-card" style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 10px 25px rgba(0,0,0,0.05)', borderLeft: `5px solid #10B981` }}>
          <h3 className="area-metric-label area-metric-note dashboard-metric-label" style={{ fontSize: '0.8rem', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ingresos de {title}</h3>
          <p className="area-metric-value area-metric-value--positive dashboard-metric-value" style={{ fontSize: '1.8rem', fontWeight: 700, color: '#10B981', marginTop: '0.5rem' }}>{formatMoney(totalIngresosSAP)}</p>
          <p className="dashboard-metric-note">Monto registrado en pesos</p>
        </div>

      </div>

      <div className="area-chart-grid area-chart-grid--single" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '2rem', marginBottom: '2rem' }}>
        {/* Gráfica de Tendencia Anual */}
        <div className="area-panel dashboard-panel" style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 10px 25px rgba(0,0,0,0.05)' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: '1.5rem', fontSize: '1.2rem' }}>Estudios e ingresos por mes</h3>
          <p className="dashboard-chart-description">Compara la actividad de cada mes y los ingresos registrados.</p>
          <div className="dashboard-chart-key">
            <span><i style={{ background: 'var(--chart-1)' }} aria-hidden="true" />Estudios · escala izquierda</span>
            <span><i style={{ background: 'var(--chart-2)' }} aria-hidden="true" />Ingresos en pesos · escala derecha</span>
          </div>
          <div className="dashboard-chart-host" style={{ height: 350 }}>
            <DashboardChart width="100%" height="100%">
              <ComposedChart data={aggregatedAnual} margin={{ top: 18, right: 8, left: 0, bottom: 12 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                <XAxis dataKey="label" tick={{fontSize: 10}} tickMargin={10} />
                <YAxis yAxisId="left" width={55} tickFormatter={formatNumber} tick={{fontSize: 12}} />
                <YAxis yAxisId="right" width={74} orientation="right" tickFormatter={(val) => val >= 1000000 ? `$${(val/1000000).toFixed(1)}M` : `$${(val/1000).toFixed(0)}k`} tick={{fontSize: 12}} />
                <Tooltip 
                  formatter={(value, name) => {
                    if (name.includes('Ingresos')) return [formatMoney(value), name];
                    return [formatNumber(value), name];
                  }} 
                />
                <Bar yAxisId="left" dataKey="volumen" name="Estudios realizados" fill={colorBase} maxBarSize={40} radius={[6, 6, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="ingresosSAP" name="Ingresos" stroke="#10B981" strokeWidth={3} dot={{ r: 3, strokeWidth: 2 }} activeDot={{ r: 6 }} />
              </ComposedChart>
            </DashboardChart>
          </div>
        </div>
      </div>

      <div className="area-chart-grid area-chart-grid--single" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '2rem' }}>
        {/* Top Estudios */}
        <div className="area-panel dashboard-panel" style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 10px 25px rgba(0,0,0,0.05)' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: '1.5rem', fontSize: '1.2rem' }}>{topLabel} más solicitados</h3>
          <p className="dashboard-chart-description">Cantidad registrada para cada servicio en el periodo seleccionado.</p>
          <div className="area-chart-scroll"><div className="dashboard-chart-host" style={{ height: 350 }}>
            <DashboardChart width="100%" height="100%">
              <BarChart layout="vertical" data={data.topEstudios} margin={{ left: 0, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} opacity={0.3} />
                <XAxis type="number" tick={{fontSize: 10}} />
                <YAxis dataKey="procedimiento" type="category" width={180} tick={{fontSize: 11}} />
                <Tooltip formatter={(value) => formatNumber(value)} />
                <Bar dataKey="cantidad" name="Volumen" fill={colorBase} radius={[0, 4, 4, 0]}>
                  {data.topEstudios.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </DashboardChart>
          </div></div>
        </div>
      </div>
    </div>
  );
}
