import React, { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend
} from 'recharts';
import PremiumLoader from '../shared/PremiumLoader';

const COLORS = ['#F472B6', '#60A5FA', '#34D399', '#A78BFA', '#FBBF24', '#F87171', '#34D399', '#38BDF8'];

export default function DashboardCunerosNativo({ globalFilters, globalTrigger }) {
  const [data, setData] = useState({
    totalRN: 0,
    totalIngresos: 0,
    totalFormulas: 0,
    topInsumos: [],
    topServicios: []
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const token = sessionStorage.getItem('escandon_token');
        const headers = { Authorization: `Bearer ${token}` };

        let url = `/api/dashboard/cuneros-nativo?`;
        if (globalFilters?.startDate) url += `startDate=${globalFilters.startDate}&`;
        if (globalFilters?.endDate) url += `endDate=${globalFilters.endDate}&`;

        const res = await fetch(url, { headers });
        const json = await res.json();
        
        if (json.success) {
          setData(json.data);
        } else {
          console.error(json.error);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [globalTrigger]);

  const formatNumber = (val) => new Intl.NumberFormat().format(val);
  const formatCurrency = (val) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(val);

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <PremiumLoader text="Cargando Módulo de Cuneros..." />
    </div>
  );

  return (
    <div style={{ padding: '1rem', background: '#F8FAFC', borderRadius: '16px' }}>
      
      {/* KPIs Principales */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        
        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)', borderLeft: `6px solid #F472B6` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <span style={{ color: '#64748b', fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Recién Nacidos</span>
            <span style={{ fontSize: '24px' }}>👶</span>
          </div>
          <div style={{ fontSize: '2.5rem', fontWeight: 700, color: '#0f172a', fontFamily: 'var(--font-display)' }}>
            {formatNumber(data.totalRN)}
          </div>
          <div style={{ fontSize: '0.85rem', color: '#10B981', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            Pacientes Únicos
          </div>
        </div>

        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)', borderLeft: `6px solid #60A5FA` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <span style={{ color: '#64748b', fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Biberones (Fórmulas)</span>
            <span style={{ fontSize: '24px' }}>🍼</span>
          </div>
          <div style={{ fontSize: '2.5rem', fontWeight: 700, color: '#0f172a', fontFamily: 'var(--font-display)' }}>
            {formatNumber(data.totalFormulas)}
          </div>
          <div style={{ fontSize: '0.85rem', color: '#64748B', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            Fórmulas administradas
          </div>
        </div>

        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)', borderLeft: `6px solid #10B981` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <span style={{ color: '#64748b', fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ingreso Cuneros (SAP)</span>
            <span style={{ fontSize: '24px' }}>💰</span>
          </div>
          <div style={{ fontSize: '2.5rem', fontWeight: 700, color: '#0f172a', fontFamily: 'var(--font-display)' }}>
            {formatCurrency(data.ingresosSAP || 0)}
          </div>
          <div style={{ fontSize: '0.85rem', color: '#10B981', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            Contabilidad Oficial Grupo 109 (CUNEROS)
          </div>
        </div>

        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)', borderLeft: `6px solid #A78BFA` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <span style={{ color: '#64748b', fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ingreso UCIN (Vertical)</span>
            <span style={{ fontSize: '24px' }}>📋</span>
          </div>
          <div style={{ fontSize: '2.5rem', fontWeight: 700, color: '#0f172a', fontFamily: 'var(--font-display)' }}>
            {formatCurrency(data.totalIngresos || 0)}
          </div>
          <div style={{ fontSize: '0.85rem', color: '#A78BFA', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            Complemento — UCIN Vertical
          </div>
        </div>

      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginBottom: '2rem' }}>
        
        {/* Top Insumos */}
        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 10px 25px rgba(0,0,0,0.05)' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: '1.5rem', fontSize: '1.2rem' }}>Top 10 Insumos y Medicamentos</h3>
          <div style={{ height: 350 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.topInsumos} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.3} />
                <XAxis type="number" />
                <YAxis dataKey="item" type="category" width={150} tick={{fontSize: 10}} />
                <RechartsTooltip 
                  formatter={(value, name) => [name === 'ingresos' ? formatCurrency(value) : formatNumber(value), name === 'ingresos' ? 'Ingreso' : 'Cantidad']}
                  cursor={{fill: '#f1f5f9'}} 
                />
                <Bar dataKey="cantidad" fill="#F472B6" radius={[0, 4, 4, 0]}>
                  {
                    data.topInsumos.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))
                  }
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Distribucion de Servicios */}
        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 10px 25px rgba(0,0,0,0.05)' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: '1.5rem', fontSize: '1.2rem' }}>Distribución de Servicios Neonatales</h3>
          <div style={{ height: 350 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.topServicios}
                  cx="50%"
                  cy="50%"
                  nameKey="servicio"
                  outerRadius={90}
                  fill="#8884d8"
                  dataKey="cantidad"
                >
                  {data.topServicios.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <RechartsTooltip formatter={(value) => [formatNumber(value), 'Frecuencia']} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

    </div>
  );
}
