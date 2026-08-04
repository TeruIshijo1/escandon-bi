import React, { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend, Cell } from 'recharts';
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
      <PremiumLoader text={`Sincronizando Módulo ${title}...`} />
    </div>
  );



  return (
    <div className="fade-in" id={`dashboard-${type}-siti`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#111827' }}>
          Módulo {title}
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        
        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 10px 25px rgba(0,0,0,0.05)', borderLeft: `5px solid ${colorBase}` }}>
          <h3 style={{ fontSize: '0.8rem', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Volumen de Estudios (Histórico)</h3>
          <p style={{ fontSize: '1.8rem', fontWeight: 700, color: '#111827', marginTop: '0.5rem' }}>{formatNumber(totalVolumen)}</p>
        </div>

        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 10px 25px rgba(0,0,0,0.05)', borderLeft: `5px solid #10B981` }}>
          <h3 style={{ fontSize: '0.8rem', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ingresos {title} (SAP)</h3>
          <p style={{ fontSize: '1.8rem', fontWeight: 700, color: '#10B981', marginTop: '0.5rem' }}>{formatMoney(totalIngresosSAP)}</p>
        </div>

      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '2rem', marginBottom: '2rem' }}>
        {/* Gráfica de Tendencia Anual */}
        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 10px 25px rgba(0,0,0,0.05)' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: '1.5rem', fontSize: '1.2rem' }}>Tendencia de Estudios e Ingresos (Mensual)</h3>
          <div style={{ height: 350 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={aggregatedAnual}>
                <defs>
                  <linearGradient id={`colorIngresos${type}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={colorAux} stopOpacity={0.3}/>
                    <stop offset="95%" stopColor={colorAux} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                <XAxis dataKey="label" tick={{fontSize: 10}} tickMargin={10} />
                <YAxis yAxisId="left" tickFormatter={(val) => `${(val/1000).toFixed(0)}k`} tick={{fontSize: 10}} />
                <YAxis yAxisId="right" orientation="right" tickFormatter={(val) => `$${(val/1000000).toFixed(1)}M`} tick={{fontSize: 10}} />
                <Tooltip 
                  formatter={(value, name) => {
                    if (name.includes('Ingresos')) return [formatMoney(value), name];
                    return [formatNumber(value), name];
                  }} 
                />
                <Legend />
                <Bar yAxisId="left" dataKey="volumen" name={`Volumen de ${title}`} fill={colorBase} radius={[4, 4, 0, 0]} />
                <Area yAxisId="right" type="monotone" dataKey="ingresosSAP" name="Ingresos (SAP)" stroke="#10B981" strokeWidth={3} fillOpacity={0.4} fill="#10B981" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '2rem' }}>
        {/* Top Estudios */}
        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 10px 25px rgba(0,0,0,0.05)' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: '1.5rem', fontSize: '1.2rem' }}>Top 10 {topLabel} Solicitados</h3>
          <div style={{ height: 350 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={data.topEstudios} margin={{ left: 80 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} opacity={0.3} />
                <XAxis type="number" tick={{fontSize: 10}} />
                <YAxis dataKey="procedimiento" type="category" width={180} tick={{fontSize: 9}} />
                <Tooltip formatter={(value) => formatNumber(value)} />
                <Bar dataKey="cantidad" name="Volumen" fill={colorBase} radius={[0, 4, 4, 0]}>
                  {data.topEstudios.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
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
