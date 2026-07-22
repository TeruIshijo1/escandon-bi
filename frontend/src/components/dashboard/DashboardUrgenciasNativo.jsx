import { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area, PieChart, Pie, Cell
} from 'recharts';

export default function DashboardUrgenciasNativo({ data, searchFilter, setSearchFilter }) {
  if (!data) return null;

  // Filtrar la tabla de pacientes localmente si el usuario hace clic en una fila
  const filteredList = data.lista.filter(c => {
    if (!searchFilter) return true;
    const term = searchFilter.toLowerCase();
    const pcnum = (c.PCNum || '').toString().toLowerCase();
    const pac = (c.Paciente || '').toLowerCase();
    return pcnum.includes(term) || pac.includes(term);
  });

  const COLORS = ['#E8853D', '#005FA9', '#10B981', '#EF4444', '#8B5CF6'];

  return (
    <div style={{ marginTop: '2rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', marginBottom: '1.5rem' }}>
        
        {/* Gráfica: Tendencia de Llegadas */}
        <div data-html2canvas-ignore="false" style={{ flex: '1 1 400px', background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,136,201,0.1)' }}>
          <h3 style={{ margin: '0 0 1rem 0', color: '#0D1B2A', fontSize: '1.1rem' }}>Volumen de Llegadas (Últimos Días)</h3>
          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer>
              <AreaChart data={data.tendencia} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorUrgencias" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#E8853D" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#E8853D" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="nombre" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748B' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748B' }} />
                <Tooltip 
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}
                  formatter={(value) => [value, 'Pacientes']}
                />
                <Area type="monotone" dataKey="valor" stroke="#E8853D" strokeWidth={3} fillOpacity={1} fill="url(#colorUrgencias)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Gráfica: Estatus de Pacientes */}
        <div data-html2canvas-ignore="false" style={{ flex: '1 1 400px', background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,136,201,0.1)' }}>
          <h3 style={{ margin: '0 0 1rem 0', color: '#0D1B2A', fontSize: '1.1rem' }}>Distribución de Estatus</h3>
          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={data.estatus}
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="valor"
                  nameKey="nombre"
                  isAnimationActive={false}
                  label={({ nombre, percent }) => `${nombre} ${(percent * 100).toFixed(0)}%`}
                >
                  {data.estatus.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => [value, 'Pacientes']} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* Tabla de Detalle */}
      <div data-html2canvas-ignore="true" style={{ background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,136,201,0.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, color: '#0D1B2A', fontSize: '1.1rem' }}>Detalle de Pacientes (Top 100)</h3>
          
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            {searchFilter && (
              <button 
                onClick={() => setSearchFilter('')}
                style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}
              >
                Limpiar filtro
              </button>
            )}
            <span style={{ fontSize: '0.85rem', color: '#8A97A8' }}>{filteredList.length} registros</span>
          </div>
        </div>
        
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ background: '#F8FAFC', borderBottom: '2px solid #E2E8F0', textAlign: 'left' }}>
                <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600 }}>Admisión</th>
                <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600 }}>Alta Médica</th>
                <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600 }}>Cuenta</th>
                <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600 }}>Paciente</th>
                <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600 }}>Estancia</th>
                <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600 }}>Estatus</th>
              </tr>
            </thead>
            <tbody>
              {filteredList.slice(0, 100).map((c, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                  <td style={{ padding: '0.75rem 1rem', color: '#64748B' }}>{c.IngresoFormat}</td>
                  <td style={{ padding: '0.75rem 1rem', color: '#64748B' }}>{c.EgresoFormat}</td>
                  <td 
                    onClick={() => setSearchFilter(c.PCNum.toString())}
                    style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#005FA9', cursor: 'pointer', textDecoration: 'underline' }}
                    title="Filtrar por Cuenta"
                  >
                    {c.PCNum}
                  </td>
                  <td 
                    onClick={() => setSearchFilter(c.Paciente)}
                    style={{ padding: '0.75rem 1rem', cursor: 'pointer', color: '#0D1B2A' }}
                    title="Filtrar por Paciente"
                    onMouseOver={(e) => e.currentTarget.style.color = '#E8853D'}
                    onMouseOut={(e) => e.currentTarget.style.color = '#0D1B2A'}
                  >
                    {c.Paciente}
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    {c.MinutosEstancia > 0 ? `${(c.MinutosEstancia / 60).toFixed(1)} hrs` : '-'}
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <span style={{ 
                      background: c.Estatus === 'CL' ? '#D1FAE5' : c.Estatus === 'OP' ? '#FEF3C7' : '#FEE2E2',
                      color: c.Estatus === 'CL' ? '#065F46' : c.Estatus === 'OP' ? '#B45309' : '#991B1B',
                      padding: '0.2rem 0.6rem',
                      borderRadius: 12,
                      fontSize: '0.75rem',
                      fontWeight: 600
                    }}>
                      {c.Estatus === 'CL' ? 'Alta' : c.Estatus === 'OP' ? 'En Piso' : c.Estatus}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
