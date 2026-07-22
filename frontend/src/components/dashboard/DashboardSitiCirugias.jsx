import React, { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend, PieChart, Pie, Cell } from 'recharts';
import { API_BASE } from '../../api/config';
import PremiumLoader from '../shared/PremiumLoader';
import ExportToolbar from '../shared/ExportToolbar';

const COLORS = ['#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#10B981', '#34D399', '#6EE7B7', '#F59E0B', '#FBBF24', '#FCD34D'];

export default function DashboardSitiCirugias() {
  const [data, setData] = useState({
    tendenciaAnual: [],
    topCirugias: [],
    topMedicos: []
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const token = sessionStorage.getItem('escandon_token');
        const headers = { Authorization: `Bearer ${token}` };

        const res = await fetch(`${API_BASE}/siti/cirugias`, { headers });
        const json = await res.json();
        
        if (json.success) {
          setData({
            tendenciaAnual: json.tendenciaAnual || [],
            topCirugias: json.topCirugias || [],
            topMedicos: json.topMedicos || []
          });
        }
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const formatMoney = (val) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(val);
  const formatNumber = (val) => new Intl.NumberFormat().format(val);

  const aggregatedAnual = React.useMemo(() => {
    const acc = {};
    data.tendenciaAnual.forEach(row => {
      if (!acc[row.Yr]) acc[row.Yr] = { Yr: row.Yr, volumen: 0, ingresos: 0 };
      acc[row.Yr].volumen += parseInt(row.volumen || 0);
      acc[row.Yr].ingresos += parseFloat(row.ingresos || 0);
    });
    return Object.values(acc).sort((a, b) => a.Yr - b.Yr);
  }, [data.tendenciaAnual]);

  const totalVolumen = data.tendenciaAnual.reduce((acc, curr) => acc + parseInt(curr.volumen || 0), 0);
  const totalIngresos = data.tendenciaAnual.reduce((acc, curr) => acc + parseFloat(curr.ingresos || 0), 0);

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <PremiumLoader text="Sincronizando Módulo Quirófanos..." />
    </div>
  );



  return (
    <div id="dashboard-cirugias-siti">
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
        <ExportToolbar 
          targetId="dashboard-cirugias-siti" 
          fileNamePrefix="SITI_Quirofanos" 
          excelData={{
            'Tendencia Quirúrgica': data.tendenciaAnual,
            'Top Cirugías': data.topCirugias,
            'Top Cirujanos': data.topMedicos
          }}
        />
      </div>
      {/* KPIs Rápidos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        
        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 10px 25px rgba(0,0,0,0.05)', borderLeft: '5px solid #2563EB' }}>
          <h3 style={{ fontSize: '0.8rem', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Volumen de Cirugías (Histórico)</h3>
          <p style={{ fontSize: '1.8rem', fontWeight: 700, color: '#111827', marginTop: '0.5rem' }}>{formatNumber(totalVolumen)}</p>
        </div>

        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 10px 25px rgba(0,0,0,0.05)', borderLeft: '5px solid #10B981' }}>
          <h3 style={{ fontSize: '0.8rem', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ingresos por Cirugías</h3>
          <p style={{ fontSize: '1.8rem', fontWeight: 700, color: '#111827', marginTop: '0.5rem' }}>{formatMoney(totalIngresos)}</p>
        </div>

      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '2rem', marginBottom: '2rem' }}>
        {/* Gráfica de Tendencia Anual */}
        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 10px 25px rgba(0,0,0,0.05)' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: '1.5rem', fontSize: '1.2rem' }}>Tendencia de Cirugías e Ingresos por Año</h3>
          <div style={{ height: 350 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={aggregatedAnual}>
                <defs>
                  <linearGradient id="colorIngresosQx" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                <XAxis dataKey="Yr" tick={{fontSize: 10}} tickMargin={10} />
                <YAxis yAxisId="left" tickFormatter={(val) => `${(val/1000).toFixed(0)}k`} tick={{fontSize: 10}} />
                <YAxis yAxisId="right" orientation="right" tickFormatter={(val) => `$${(val/1000000).toFixed(1)}M`} tick={{fontSize: 10}} />
                <Tooltip 
                  formatter={(value, name) => {
                    if (name === 'Ingresos') return [formatMoney(value), name];
                    return [formatNumber(value), name];
                  }} 
                />
                <Legend />
                <Bar yAxisId="left" dataKey="volumen" name="Volumen de Cirugías" fill="#2563EB" radius={[4, 4, 0, 0]} />
                <Area yAxisId="right" type="monotone" dataKey="ingresos" name="Ingresos" stroke="#10B981" strokeWidth={3} fillOpacity={1} fill="url(#colorIngresosQx)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
        {/* Top Médicos */}
        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 10px 25px rgba(0,0,0,0.05)' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: '1.5rem', fontSize: '1.2rem' }}>Top 10 Cirujanos (Volumen de Procedimientos)</h3>
          <div style={{ height: 350 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={data.topMedicos} margin={{ left: 50 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} opacity={0.3} />
                <XAxis type="number" tick={{fontSize: 10}} />
                <YAxis dataKey="medico" type="category" width={100} tick={{fontSize: 9}} />
                <Tooltip formatter={(value) => formatNumber(value)} />
                <Bar dataKey="volumen" name="Procedimientos" fill="#3B82F6" radius={[0, 4, 4, 0]}>
                  {data.topMedicos.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top Cirugías */}
        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 10px 25px rgba(0,0,0,0.05)' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: '1.5rem', fontSize: '1.2rem' }}>Top 10 Procedimientos Quirúrgicos</h3>
          <div style={{ height: 350 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={data.topCirugias} margin={{ left: 50 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} opacity={0.3} />
                <XAxis type="number" tick={{fontSize: 10}} />
                <YAxis dataKey="procedimiento" type="category" width={120} tick={{fontSize: 9}} />
                <Tooltip formatter={(value) => formatNumber(value)} />
                <Bar dataKey="cantidad" name="Volumen" fill="#10B981" radius={[0, 4, 4, 0]}>
                  {data.topCirugias.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[(index + 4) % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
