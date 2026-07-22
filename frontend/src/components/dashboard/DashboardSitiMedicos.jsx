import React, { useState, useEffect } from 'react';
import { 
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';
import { API_BASE } from '../../api/config';
import PremiumLoader from '../shared/PremiumLoader';
import ExportToolbar from '../shared/ExportToolbar';

const COLORS = ['#0891b2', '#06b6d4', '#22d3ee', '#67e8f9', '#a5f3fc', '#cffafe'];

export default function DashboardSitiMedicos() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState('Histórico'); // 'Histórico' by default

  useEffect(() => {
    setLoading(true);
    const query = year !== 'Histórico' ? `?year=${year}` : '';
    fetch(`${API_BASE}/siti/medicos${query}`)
      .then(res => res.json())
      .then(res => {
        if(res.success) {
          setData(res);
        }
      })
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, [year]);

  if (loading) return <PremiumLoader message="Calculando productividad médica..." />;
  if (!data) return <div className="p-8 text-center text-red-500">Error al cargar datos de médicos.</div>;

  const { resumen, topMedicos } = data;

  const formatCurrency = (num) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(num || 0);
  const formatNumber = (num) => new Intl.NumberFormat('es-MX').format(num || 0);

  // Generar lista de años del 2010 al 2025
  const years = ['Histórico'];
  for (let i = 2025; i >= 2010; i--) years.push(i.toString());

  // Transformar datos para ExportToolbar
  const exportData = {
    "Resumen": [
      { Métrica: "Médicos Únicos", Valor: resumen.total_medicos },
      { Métrica: "Promedio Ingreso por Médico", Valor: resumen.promedio_ingreso_medico }
    ],
    "Top Médicos": topMedicos.map(m => ({ Médico: m.medico, Pacientes: m.pacientes_ingresados, "Ingresos Generados": m.ingresos_generados }))
  };

  return (
    <div id="dashboard-medicos-siti">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <label style={{ fontWeight: 'bold', color: '#1e293b' }}>Filtrar por Año:</label>
          <select 
            value={year} 
            onChange={(e) => setYear(e.target.value)}
            style={{ 
              padding: '8px 12px', 
              borderRadius: '6px', 
              border: '1px solid #cbd5e1', 
              background: 'white', 
              color: '#0f172a',
              fontWeight: '500',
              cursor: 'pointer'
            }}
          >
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <ExportToolbar 
          targetId="dashboard-medicos-siti" 
          fileNamePrefix={`SITI_Medicos_${year}`} 
          excelData={exportData}
        />
      </div>

      {/* KPIs Rápidos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <div className="siti-card" style={{ background: 'linear-gradient(135deg, #0891b2, #0e7490)', color: 'white' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', opacity: 0.9 }}>Total de Médicos ({year})</h3>
          <p style={{ margin: '10px 0 0', fontSize: '2rem', fontWeight: 'bold' }}>
            {formatNumber(resumen.total_medicos)}
          </p>
        </div>
        <div className="siti-card" style={{ background: 'linear-gradient(135deg, #0284c7, #0369a1)', color: 'white' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', opacity: 0.9 }}>Ingreso Promedio por Médico</h3>
          <p style={{ margin: '10px 0 0', fontSize: '2rem', fontWeight: 'bold' }}>
            {formatCurrency(resumen.promedio_ingreso_medico)}
          </p>
        </div>
      </div>

      {/* Gráfica Top Médicos */}
      <div className="siti-card" style={{ marginBottom: '2rem' }}>
        <h3 style={{ marginBottom: '1.5rem', color: '#1e293b' }}>Top 15 Médicos por Ingresos Generados</h3>
        <div style={{ height: 450 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={topMedicos} layout="vertical" margin={{ top: 5, right: 30, left: 150, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
              <XAxis type="number" tickFormatter={(v) => formatCurrency(v)} />
              <YAxis type="category" dataKey="medico" width={150} tick={{ fontSize: 11 }} />
              <Tooltip 
                formatter={(value, name) => [name === 'Ingresos (MXN)' || name === 'ingresos_generados' ? formatCurrency(value) : formatNumber(value), name === 'Ingresos (MXN)' || name === 'ingresos_generados' ? 'Ingresos' : 'Pacientes']}
                cursor={{fill: '#f1f5f9'}} 
              />
              <Legend />
              <Bar dataKey="ingresos_generados" name="Ingresos (MXN)" fill="#0891b2" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      
    </div>
  );
}
