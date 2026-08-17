import { useState } from 'react';
import {
  AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar
} from 'recharts';

export default function DashboardConsultaExternaNativo({ data, searchFilter, setSearchFilter }) {
  const [selectedEspecialidad, setSelectedEspecialidad] = useState(null);

  if (!data) return null;

  // Filtrar la lista
  const filteredList = (data.lista || []).filter(c => {
    if (selectedEspecialidad) {
      if (c.Especialidad !== selectedEspecialidad) return false;
    }
    if (!searchFilter) return true;
    const term = searchFilter.toLowerCase();
    const pac = (c.Paciente || '').toLowerCase();
    const med = (c.Medico || '').toLowerCase();
    return pac.includes(term) || med.includes(term);
  });

  const COLORS = ['#0088C9', '#10B981', '#E8853D', '#EF4444', '#8B5CF6'];
  const formatCurrency = (val) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(val || 0);

  return (
    <div style={{ marginTop: '2rem' }}>
      {/* Tarjetas de KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ background: 'white', padding: '1.5rem', borderRadius: 12, borderLeft: '4px solid #0088C9', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>Citas Programadas</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#0D1B2A', marginTop: '0.2rem' }}>{data.kpis?.total || 0}</div>
        </div>
        <div style={{ background: 'white', padding: '1.5rem', borderRadius: 12, borderLeft: '4px solid #10B981', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>Pacientes Atendidos</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#0D1B2A', marginTop: '0.2rem' }}>{data.kpis?.asistencias || 0}</div>
        </div>
        <div style={{ background: 'white', padding: '1.5rem', borderRadius: 12, borderLeft: '4px solid #EF4444', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>Cancelaciones</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#0D1B2A', marginTop: '0.2rem' }}>{data.kpis?.cancelaciones || 0}</div>
        </div>
        <div style={{ background: 'white', padding: '1.5rem', borderRadius: 12, borderLeft: '4px solid #8B5CF6', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>Tasa de Asistencia</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#0D1B2A', marginTop: '0.2rem' }}>{data.kpis?.tasaAsistencia || 0}%</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', marginBottom: '1.5rem' }}>
        {/* Gráfica: Tendencia */}
        <div data-html2canvas-ignore="false" style={{ flex: '1 1 400px', background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,136,201,0.1)' }}>
          <h3 style={{ margin: '0 0 1rem 0', color: '#0D1B2A', fontSize: '1.1rem' }}>Tendencia de Consultas</h3>
          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer>
              <AreaChart data={data.tendencia} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorCE" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0088C9" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#0088C9" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="nombre" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748B' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748B' }} />
                <Tooltip 
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}
                  formatter={(value) => [value, 'Consultas']}
                />
                <Area type="monotone" dataKey="valor" stroke="#0088C9" strokeWidth={3} fillOpacity={1} fill="url(#colorCE)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Gráfica: Especialidades */}
        <div data-html2canvas-ignore="false" style={{ flex: '1 1 400px', background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,136,201,0.1)' }}>
          <h3 style={{ margin: '0 0 1rem 0', color: '#0D1B2A', fontSize: '1.1rem' }}>Top Especialidades</h3>
          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={data.especialidades}
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="valor"
                  nameKey="nombre"
                  isAnimationActive={false}
                  label={({ nombre, percent }) => `${nombre} ${(percent * 100).toFixed(0)}%`}
                  onClick={(entry) => setSelectedEspecialidad(entry.nombre)}
                  style={{ cursor: 'pointer' }}
                >
                  {data.especialidades?.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => [value, 'Citas']} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', marginBottom: '1.5rem' }}>
        {/* Gráfica: Top Médicos */}
        <div data-html2canvas-ignore="false" style={{ flex: '1 1 100%', background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,136,201,0.1)' }}>
          <h3 style={{ margin: '0 0 1rem 0', color: '#0D1B2A', fontSize: '1.1rem' }}>Top 10 Médicos por Consulta</h3>
          <div style={{ width: '100%', height: 350 }}>
            <ResponsiveContainer>
              <BarChart data={data.topMedicos} layout="vertical" margin={{ top: 5, right: 30, left: 100, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="nombre" type="category" width={200} tick={{ fontSize: 10 }} />
                <Tooltip 
                  formatter={(value) => [value, 'Consultas']}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}
                />
                <Bar dataKey="valor" fill="#10B981" radius={[0, 4, 4, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Tabla de Detalle */}
      <div data-html2canvas-ignore="true" style={{ background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,136,201,0.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, color: '#0D1B2A', fontSize: '1.1rem' }}>Detalle de Citas (Top 100)</h3>
          
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            {selectedEspecialidad && (
              <span style={{ fontSize: '0.85rem', color: '#005FA9', fontWeight: 600, background: '#E0F2FE', padding: '0.2rem 0.6rem', borderRadius: 12 }}>
                Especialidad: {selectedEspecialidad}
              </span>
            )}
            {(searchFilter || selectedEspecialidad) && (
              <button 
                onClick={() => { setSearchFilter(''); setSelectedEspecialidad(null); }}
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
                <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600 }}>Fecha / Hora</th>
                <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600 }}>Paciente</th>
                <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600 }}>Médico</th>
                <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600 }}>Especialidad</th>
                <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600 }}>Estatus</th>
              </tr>
            </thead>
            <tbody>
              {filteredList.slice(0, 100).map((c, i) => {
                const isCancelado = (c.PCAP_ST_Descripcion || '').toLowerCase().includes('cancelad');
                const isLlego = (c.PCAP_ST_Descripcion || '').toLowerCase().includes('lleg');
                
                return (
                  <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td style={{ padding: '0.75rem 1rem', color: '#64748B' }}>
                      {new Date(c.DesdeFecha).toLocaleString('es-MX', {
                        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                      })}
                    </td>
                    <td 
                      onClick={() => setSearchFilter(c.Paciente)}
                      style={{ padding: '0.75rem 1rem', cursor: 'pointer', color: '#0D1B2A', fontWeight: 600 }}
                      title="Filtrar por Paciente"
                    >
                      {c.Paciente}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: '#475569' }}>{c.Medico}</td>
                    <td style={{ padding: '0.75rem 1rem', color: '#475569' }}>{c.Especialidad}</td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <span style={{ 
                        background: isCancelado ? '#FEE2E2' : isLlego ? '#D1FAE5' : '#F1F5F9',
                        color: isCancelado ? '#991B1B' : isLlego ? '#065F46' : '#475569',
                        padding: '0.2rem 0.6rem',
                        borderRadius: 12,
                        fontSize: '0.75rem',
                        fontWeight: 600
                      }}>
                        {c.PCAP_ST_Descripcion || 'Programada'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
