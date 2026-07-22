import React, { useState, useEffect } from 'react';
import { 
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';
import { API_BASE } from '../../api/config';
import PremiumLoader from '../shared/PremiumLoader';
import ExportToolbar from '../shared/ExportToolbar';

const COLORS = ['#8b5cf6', '#a78bfa', '#c4b5fd', '#ddd6fe', '#ede9fe', '#f5f3ff'];
const PIE_COLORS = ['#ec4899', '#3b82f6', '#10b981', '#f59e0b']; // Pink for F, Blue for M
const RETENCION_COLORS = ['#f59e0b', '#10b981']; // Orange for new, green for recurring

export default function DashboardSitiPacientes() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = sessionStorage.getItem('escandon_token');
    const headers = { Authorization: `Bearer ${token}` };

    fetch(`${API_BASE}/siti/pacientes-demografia`, { headers })
      .then(res => res.json())
      .then(res => {
        if(res.success) {
          setData(res);
        }
      })
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <PremiumLoader message="Analizando datos demográficos..." />;
  if (!data) return <div className="p-8 text-center text-red-500">Error al cargar datos.</div>;

  const { resumen, topMotivos, genero, retencion } = data;

  const formatNumber = (num) => new Intl.NumberFormat('es-MX').format(num || 0);

  // Transformar datos para retención
  const retencionData = [
    { name: 'Nuevos (1 Ingreso)', value: parseInt(retencion?.pacientes_nuevos || 0) },
    { name: 'Recurrentes (2+ Ingresos)', value: parseInt(retencion?.pacientes_recurrentes || 0) }
  ];

  // Transformar datos para ExportToolbar
  const exportData = {
    "Resumen": [
      { Métrica: "Pacientes Únicos Históricos", Valor: resumen.pacientes_unicos },
      { Métrica: "Total Admisiones", Valor: resumen.total_admisiones },
      { Métrica: "Pacientes Nuevos", Valor: retencion?.pacientes_nuevos },
      { Métrica: "Pacientes Recurrentes", Valor: retencion?.pacientes_recurrentes }
    ],
    "Distribución por Género": genero.map(g => ({ Género: g.genero, Cantidad: g.cantidad })),
    "Top Motivos Ingreso": topMotivos.map(m => ({ Motivo: m.motivo, Cantidad: m.cantidad }))
  };

  return (
    <div id="dashboard-pacientes-siti">
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
        <ExportToolbar 
          targetId="dashboard-pacientes-siti" 
          fileNamePrefix="SITI_Pacientes" 
          excelData={exportData}
        />
      </div>

      {/* KPIs Rápidos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <div className="siti-card" style={{ background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', color: 'white' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', opacity: 0.9 }}>Pacientes Únicos</h3>
          <p style={{ margin: '10px 0 0', fontSize: '1.8rem', fontWeight: 'bold' }}>
            {formatNumber(resumen.pacientes_unicos)}
          </p>
        </div>
        <div className="siti-card" style={{ background: 'linear-gradient(135deg, #10b981, #059669)', color: 'white' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', opacity: 0.9 }}>Total Admisiones</h3>
          <p style={{ margin: '10px 0 0', fontSize: '1.8rem', fontWeight: 'bold' }}>
            {formatNumber(resumen.total_admisiones)}
          </p>
        </div>
        <div className="siti-card" style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: 'white' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', opacity: 0.9 }}>Nuevos (1 Ingreso)</h3>
          <p style={{ margin: '10px 0 0', fontSize: '1.8rem', fontWeight: 'bold' }}>
            {formatNumber(retencion?.pacientes_nuevos)}
          </p>
        </div>
        <div className="siti-card" style={{ background: 'linear-gradient(135deg, #0ea5e9, #0284c7)', color: 'white' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', opacity: 0.9 }}>Recurrentes (2+ Ingresos)</h3>
          <p style={{ margin: '10px 0 0', fontSize: '1.8rem', fontWeight: 'bold' }}>
            {formatNumber(retencion?.pacientes_recurrentes)}
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: '2rem', marginBottom: '2rem' }}>
        {/* Gráfica Género */}
        <div className="siti-card">
          <h3 style={{ marginBottom: '1.5rem', color: '#1e293b' }}>Por Género</h3>
          <div style={{ height: 250 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={genero}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="cantidad"
                  nameKey="genero"
                >
                  {genero.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatNumber(value)} />
                <Legend verticalAlign="bottom" height={36}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Gráfica Retención (Nuevos vs Recurrentes) */}
        <div className="siti-card">
          <h3 style={{ marginBottom: '1.5rem', color: '#1e293b' }}>Nuevos vs Recurrentes</h3>
          <div style={{ height: 250 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={retencionData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                  nameKey="name"
                >
                  {retencionData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={RETENCION_COLORS[index % RETENCION_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatNumber(value)} />
                <Legend verticalAlign="bottom" height={36}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Gráfica Motivos Ingreso */}
        <div className="siti-card">
          <h3 style={{ marginBottom: '1.5rem', color: '#1e293b' }}>Top 10 Motivos de Ingreso</h3>
          <div style={{ height: 250 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topMotivos} layout="vertical" margin={{ top: 5, right: 30, left: 100, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tickFormatter={(v) => formatNumber(v)} />
                <YAxis type="category" dataKey="motivo" width={100} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value) => formatNumber(value)} cursor={{fill: '#f1f5f9'}} />
                <Bar dataKey="cantidad" name="Admisiones" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
