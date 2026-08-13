import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area, PieChart, Pie, Cell
} from 'recharts';

export default function DashboardUrgenciasNativo({ data, searchFilter, setSearchFilter }) {
  const [selectedEstatus, setSelectedEstatus] = useState(null);

  if (!data) return null;

  const [selectedPatientDetail, setSelectedPatientDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailItems, setDetailItems] = useState([]);
  const [detailSearchQuery, setDetailSearchQuery] = useState('');
  const [detailSelectedGroup, setDetailSelectedGroup] = useState(null);

  useEffect(() => {
    if (!selectedPatientDetail) {
      setDetailItems([]);
      setDetailSearchQuery('');
      setDetailSelectedGroup(null);
      return;
    }

    const fetchDetail = async () => {
      setDetailLoading(true);
      try {
        const token = sessionStorage.getItem('escandon_token');
        const res = await fetch(`/api/dashboard/cuenta-detalle/${selectedPatientDetail.folio}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const json = await res.json();
        if (json.ok) {
          setDetailItems(json.data || []);
        }
      } catch (err) {
        console.error('Error fetching account details:', err);
      } finally {
        setDetailLoading(false);
      }
    };

    fetchDetail();
  }, [selectedPatientDetail]);

  const filteredDetailItems = detailItems.filter(item => {
    if (detailSelectedGroup && item.grupo !== detailSelectedGroup) return false;
    if (detailSearchQuery) {
      const q = detailSearchQuery.toLowerCase();
      const insumo = (item.insumo || '').toLowerCase();
      const codigo = (item.codigo || '').toLowerCase();
      const grupo = (item.grupo || '').toLowerCase();
      return insumo.includes(q) || codigo.includes(q) || grupo.includes(q);
    }
    return true;
  });

  const formatDateStr = (dateStr) => {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    return d.toLocaleString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  
  const getDaysBetween = (start, end) => {
    if (!start) return '-';
    const s = new Date(start);
    const e = end ? new Date(end) : new Date();
    const diff = Math.max(0, Math.ceil((e - s) / (1000 * 60 * 60 * 24)));
    return `${diff} ${diff === 1 ? 'día' : 'días'}`;
  };

  const censoCamas = data.censoCamas || [];
  const totalBeds = censoCamas.length;
  const occupiedBedsCount = censoCamas.filter(b => b.Estado === 'OCUPADA').length;
  const freeBedsCount = totalBeds - occupiedBedsCount;


  // Filtrar la tabla de pacientes localmente
  const filteredList = data.lista.filter(c => {
    // Filtro por estatus de la gráfica
    if (selectedEstatus) {
      const e = c.Estatus === 'CL' ? 'Alta (Cerrada)' : (c.Estatus === 'OP' ? 'En Piso (Abierta)' : c.Estatus);
      if (e !== selectedEstatus) return false;
    }

    // Filtro de búsqueda
    if (!searchFilter) return true;
    const term = searchFilter.toLowerCase();
    const pcnum = (c.PCNum || '').toString().toLowerCase();
    const pac = (c.Paciente || '').toLowerCase();
    return pcnum.includes(term) || pac.includes(term);
  });

  const COLORS = ['#E8853D', '#005FA9', '#10B981', '#EF4444', '#8B5CF6'];

  const formatCurrency = (val) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(val);

  return (
    <div style={{ marginTop: '2rem' }}>
      

      {/* ── SECCIÓN: CENSO DE CAMAS EN VIVO ── */}
      {censoCamas.length > 0 && (
      <div style={{ background: '#FFFFFF', padding: '1.75rem', borderRadius: '16px', border: '1px solid #E2E8F0', marginBottom: '2rem', marginTop: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h3 style={{ margin: 0, fontFamily: "var(--font-display)", color: '#0F172A', fontSize: '1.2rem', fontWeight: 800 }}>Censo Clínico en Vivo — Camas Urgencias</h3>
            <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: '#64748B' }}>
              Estado actual de las camas y cubículos de Urgencias. Haz clic en una ocupada para ver su cuenta.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.8rem', fontSize: '0.75rem', fontWeight: 700 }}>
            <span style={{ padding: '0.35rem 0.75rem', background: '#ECFDF5', color: '#047857', borderRadius: '20px', border: '1px solid rgba(16,185,129,0.2)' }}>
              🟢 DISPONIBLES: {freeBedsCount}
            </span>
            <span style={{ padding: '0.35rem 0.75rem', background: '#FEF2F2', color: '#B91C1C', borderRadius: '20px', border: '1px solid rgba(239,68,68,0.2)' }}>
              🔴 OCUPADAS: {occupiedBedsCount}
            </span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
          {censoCamas.map((bed, idx) => {
            const isOcupada = bed.Estado === 'OCUPADA';
            return (
              <div 
                key={idx}
                className={isOcupada ? "uci-card-glow bed-card-ocupada" : "uci-card-glow bed-card-libre"}
                onClick={() => {
                  if (isOcupada) {
                    setSelectedPatientDetail({
                      folio: bed.PCNum,
                      paciente: bed.Paciente,
                      room: bed.RoomName,
                      total: bed.totalCargos,
                      entrydate: bed.FechaIngreso
                    });
                  }
                }}
                style={{
                  background: '#FFFFFF',
                  borderRadius: '12px',
                  padding: '1.25rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.6rem',
                  position: 'relative',
                  border: isOcupada ? '1px solid rgba(239, 68, 68, 0.15)' : '1px solid rgba(16, 185, 129, 0.15)',
                  borderLeft: isOcupada ? '5px solid #EF4444' : '5px solid #10B981',
                  cursor: isOcupada ? 'pointer' : 'default',
                  boxShadow: '0 4px 6px rgba(0,0,0,0.03)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.8rem', fontWeight: 750, color: '#64748B', letterSpacing: '0.04em' }}>
                    {bed.RoomCode}
                  </div>
                  <span style={{
                    fontSize: '0.64rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em',
                    padding: '0.15rem 0.5rem', borderRadius: '20px',
                    background: isOcupada ? '#FEF2F2' : '#ECFDF5',
                    color: isOcupada ? '#EF4444' : '#10B981'
                  }}>
                    {isOcupada ? '🔴 Ocupado' : '🟢 Libre'}
                  </span>
                </div>

                <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.98rem', fontWeight: 800, color: '#0F172A', margin: '0.1rem 0' }}>
                  {bed.RoomName}
                </div>

                {isOcupada ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', borderTop: '1px solid #F1F5F9', paddingTop: '0.6rem', marginTop: '0.2rem' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#1E293B' }}>👤 {bed.Paciente}</div>
                    <div style={{ fontSize: '0.78rem', color: '#64748B', display: 'flex', gap: '0.25rem' }}>
                      <span style={{ fontWeight: 600 }}>Folio:</span> <span style={{ fontFamily: 'var(--font-mono)' }}>{bed.PCNum}</span>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#64748B' }}>🩺 <span style={{ fontWeight: 600 }}>Médico:</span> {bed.Medico || 'N/A'}</div>
                    <div style={{ fontSize: '0.78rem', color: '#64748B' }}>📅 <span style={{ fontWeight: 600 }}>Ingreso:</span> {formatDateStr(bed.FechaIngreso)}</div>
                    
                    <div style={{ 
                      marginTop: '0.3rem', background: 'rgba(5, 150, 105, 0.04)', padding: '0.5rem 0.75rem', 
                      borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      border: '1.5px dashed rgba(5, 150, 105, 0.2)'
                    }}>
                      <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#047857', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Cargos Urgencias</span>
                      <span style={{ fontSize: '0.9rem', fontWeight: 850, color: '#059669', fontFamily: 'var(--font-mono)' }}>
                        {formatCurrency(bed.totalCargos)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', padding: '1.5rem 0', color: '#94A3B8', gap: '0.4rem', borderTop: '1px solid #F1F5F9', marginTop: '0.2rem' }}>
                    <span style={{ fontSize: '1.5rem' }}>🛏️</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>Cama disponible</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      )}

      {/* Tarjeta de Ingresos Totales */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ background: 'linear-gradient(135deg, #10B981, #059669)', padding: '1.5rem', borderRadius: 12, color: 'white', boxShadow: '0 4px 6px rgba(16,185,129,0.2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.9 }}>Ingresos Urgencias (SAP)</div>
              <div style={{ fontSize: '2rem', fontWeight: 800, marginTop: '0.5rem' }}>{formatCurrency(data.kpisFinancieros?.ingresosSAP || 0)}</div>
              <div style={{ fontSize: '0.8rem', opacity: 0.8, marginTop: '0.5rem' }}>Contabilidad Oficial Grupo 104 (AMBULANCIAS / URGENCIAS)</div>
            </div>
            <div style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.2)', borderRadius: 10 }}>
              <span style={{ fontSize: '1.5rem' }}>💰</span>
            </div>
          </div>
        </div>
      </div>

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
                  onClick={(entry) => setSelectedEstatus(entry.nombre)}
                  style={{ cursor: 'pointer' }}
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

      {/* Gráficas de Ingresos */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', marginBottom: '1.5rem' }}>
        <div data-html2canvas-ignore="false" style={{ flex: '1 1 400px', background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,136,201,0.1)' }}>
          <h3 style={{ margin: '0 0 1rem 0', color: '#0D1B2A', fontSize: '1.1rem' }}>Top 10 Médicos por Ingreso</h3>
          <div style={{ width: '100%', height: 350 }}>
            <ResponsiveContainer>
              <BarChart layout="vertical" data={data.topMedicos} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                <XAxis type="number" tickFormatter={(val) => `$${(val/1000).toFixed(0)}k`} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748B' }} />
                <YAxis dataKey="nombre" type="category" width={150} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#475569' }} />
                <Tooltip 
                  formatter={(value) => [formatCurrency(value), 'Ingresos']}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}
                />
                <Bar dataKey="ingresos" fill="#f97316" radius={[0, 4, 4, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div data-html2canvas-ignore="false" style={{ flex: '1 1 400px', background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,136,201,0.1)' }}>
          <h3 style={{ margin: '0 0 1rem 0', color: '#0D1B2A', fontSize: '1.1rem' }}>Top 10 Servicios Facturados</h3>
          <div style={{ width: '100%', height: 350 }}>
            <ResponsiveContainer>
              <BarChart layout="vertical" data={data.topServicios} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                <XAxis type="number" tickFormatter={(val) => `$${(val/1000).toFixed(0)}k`} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748B' }} />
                <YAxis dataKey="nombre" type="category" width={150} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#475569' }} />
                <Tooltip 
                  formatter={(value) => [formatCurrency(value), 'Ingresos']}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}
                />
                <Bar dataKey="ingresos" fill="#10B981" radius={[0, 4, 4, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Tabla de Detalle */}
      <div data-html2canvas-ignore="true" style={{ background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,136,201,0.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, color: '#0D1B2A', fontSize: '1.1rem' }}>Detalle de Pacientes (Top 100)</h3>
          
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            {selectedEstatus && (
              <span style={{ fontSize: '0.85rem', color: '#005FA9', fontWeight: 600, background: '#E0F2FE', padding: '0.2rem 0.6rem', borderRadius: 12 }}>
                Estatus: {selectedEstatus}
              </span>
            )}
            {(searchFilter || selectedEstatus) && (
              <button 
                onClick={() => { setSearchFilter(''); setSelectedEstatus(null); }}
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

      {/* ── MODAL: ESTADO DE CUENTA DETALLADO ── */}
      {selectedPatientDetail && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(8px)',
          zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '2rem'
        }}>
          <div style={{
            background: 'white', borderRadius: '20px', width: '100%', maxWidth: '900px', maxHeight: '90vh',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', border: '1px solid rgba(226, 232, 240, 0.8)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden'
          }}>
            <div style={{ padding: '1.5rem 1.75rem', borderBottom: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', background: 'linear-gradient(135deg, #FFF, #F8FAFC)' }}>
              <div>
                <span style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748B' }}>
                  Desglose de Cuenta — {selectedPatientDetail.room || 'Urgencias'}
                </span>
                <h2 style={{ margin: '0.2rem 0 0 0', fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 800, color: '#0F172A' }}>
                  {selectedPatientDetail.paciente}
                </h2>
                <div style={{ display: 'flex', gap: '1rem', marginTop: '0.25rem', fontSize: '0.78rem', color: '#64748B' }}>
                  <span>Cuenta: <strong style={{ fontFamily: 'var(--font-mono)' }}>{selectedPatientDetail.folio}</strong></span>
                  {selectedPatientDetail.entrydate && <span>Ingreso: <strong>{formatDateStr(selectedPatientDetail.entrydate)}</strong></span>}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', color: '#94A3B8' }}>Total Cargado</span>
                <div style={{ fontSize: '1.6rem', fontWeight: 850, color: '#059669', fontFamily: 'var(--font-mono)' }}>
                  {formatCurrency(selectedPatientDetail.total)}
                </div>
              </div>
            </div>
            <div style={{ padding: '0.75rem 1.75rem', borderBottom: '1px solid #F1F5F9', display: 'flex', gap: '1rem' }}>
              <input type="text" placeholder="Filtrar cargos..." value={detailSearchQuery} onChange={(e) => setDetailSearchQuery(e.target.value)} style={{ padding: '0.45rem 0.85rem', borderRadius: '8px', border: '1.5px solid #CBD5E1', fontSize: '0.8rem', flex: 1 }} />
              <select value={detailSelectedGroup || ''} onChange={(e) => setDetailSelectedGroup(e.target.value || null)} style={{ padding: '0.45rem 1.5rem 0.45rem 0.6rem', borderRadius: '8px', border: '1.5px solid #CBD5E1', fontSize: '0.8rem' }}>
                <option value="">Todas las categorías</option>
                {Array.from(new Set(detailItems.map(item => item.grupo))).filter(Boolean).sort().map(grp => <option key={grp} value={grp}>{grp}</option>)}
              </select>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.75rem' }}>
              {detailLoading ? (
                <div style={{ textAlign: 'center', padding: '5rem 0', color: '#64748B' }}>Cargando estado de cuenta...</div>
              ) : filteredDetailItems.length > 0 ? (
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.82rem' }}>
                  <thead>
                    <tr>
                      <th style={{ position: 'sticky', top: 0, zIndex: 10 }}>Fecha</th>
                      <th style={{ position: 'sticky', top: 0, zIndex: 10 }}>Categoría</th>
                      <th style={{ position: 'sticky', top: 0, zIndex: 10 }}>Código</th>
                      <th style={{ position: 'sticky', top: 0, zIndex: 10 }}>Concepto</th>
                      <th style={{ position: 'sticky', top: 0, zIndex: 10, textAlign: 'right' }}>Cant.</th>
                      <th style={{ position: 'sticky', top: 0, zIndex: 10, textAlign: 'right' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDetailItems.map((item, idx) => (
                      <tr key={idx}>
                        <td style={{ color: '#64748B', fontSize: '0.76rem' }}>{formatDateStr(item.fecha)}</td>
                        <td style={{ color: '#64748B', fontSize: '0.76rem' }}>{item.grupo}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem' }}>{item.codigo}</td>
                        <td style={{ fontWeight: 600 }}>{item.insumo}</td>
                        <td style={{ textAlign: 'right' }}>{item.cantidad}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatCurrency(item.total_cobrado)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{ textAlign: 'center', padding: '5rem 0', color: '#94A3B8' }}>No se encontraron cargos.</div>
              )}
            </div>
            <div style={{ padding: '1.25rem 1.75rem', borderTop: '1px solid #F1F5F9', textAlign: 'right' }}>
              <button onClick={() => setSelectedPatientDetail(null)} style={{ background: '#EF4444', color: 'white', border: 'none', padding: '0.55rem 1.5rem', borderRadius: '10px', cursor: 'pointer', fontWeight: 700 }}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
