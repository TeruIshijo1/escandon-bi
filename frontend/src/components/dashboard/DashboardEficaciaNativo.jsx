import DashboardMetricCard from './DashboardMetricCard';
import { userMessage } from '../../utils/userMessages';
import { useState, useEffect, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, AreaChart, Area, PieChart, Pie, Cell } from 'recharts';
import DashboardChart from './DashboardChart';
import { API_BASE } from '../../api/config';
import ExportButton from '../shared/ExportButton';
import PremiumLoader from '../shared/PremiumLoader';

export default function DashboardEficaciaNativo({ globalFilters, globalTrigger }) {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ medico: '', especialidad: '', search: '' });
  const [applyTrigger, setApplyTrigger] = useState(0);
  const [selectedEstatus, setSelectedEstatus] = useState(null);
  const requestId = useRef(0);
  const params = new URLSearchParams();
  if (globalFilters?.startDate) params.set('startDate', globalFilters.startDate);
  if (globalFilters?.endDate) params.set('endDate', globalFilters.endDate);
  const medico = globalFilters?.medico || filters.medico || '';
  const especialidad = globalFilters?.especialidad || filters.especialidad || '';
  const search = medico || especialidad || filters.search;
  if (search) params.set('search', search);
  if (especialidad) params.set('especialidad', especialidad);
  const queryKey = params.toString();
  const data = snapshot?.key === queryKey ? snapshot.data : null;
  const currentError = error?.key === queryKey ? error.message : null;

  // Cada respuesta pertenece a los filtros que la solicitaron.
  useEffect(() => {
    const controller = new AbortController();
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    setSelectedEstatus(null);
    (async () => {
      try {
        const token = sessionStorage.getItem('escandon_token');
        const res = await fetch(`${API_BASE}/dashboard/eficacia-nativo?${queryKey}`, {
          headers: { Authorization: `Bearer ${token}` }, signal: controller.signal
        });
        const json = await res.json();
        if (!res.ok || !json.ok || !json.data) throw new Error(userMessage(json.error || 'No se pudieron cargar los indicadores.'));
        if (controller.signal.aborted || id !== requestId.current) return;
        setSnapshot({ key: queryKey, data: json.data });
      } catch (err) {
        if (controller.signal.aborted || id !== requestId.current) return;
        setError({ key: queryKey, message: userMessage(err.message || 'Error de conexión con el servidor.') });
      } finally {
        if (!controller.signal.aborted && id === requestId.current) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [queryKey, applyTrigger, globalTrigger]);

  const retry = () => setApplyTrigger(value => value + 1);
  if (!data) {
    if (currentError) return <div role="alert" className="dashboard-panel" style={{ padding: 20 }}>
      <p>{currentError}</p><button type="button" onClick={retry}>Reintentar</button>
    </div>;
    return <PremiumLoader text="Cargando Indicadores de Eficacia Médica..." style={{ height: '300px' }} />;
  }

  const source = data.sourceStatus;
  const productivityAvailable = source?.productivityAvailable !== false;
  const consultationsAvailable = source?.consultationsAvailable !== false;
  const tendenciaMensual = productivityAvailable && Array.isArray(data.tendenciaMensual) ? data.tendenciaMensual : [];
  const topEspecialidades = productivityAvailable && Array.isArray(data.topEspecialidades) ? data.topEspecialidades.filter(row => numberOrNull(row.Total) !== null) : [];
  const topMedicos = productivityAvailable && Array.isArray(data.topMedicos) ? data.topMedicos.filter(row => numberOrNull(row.Total) !== null) : [];
  const estatusConsultas = consultationsAvailable && Array.isArray(data.estatusConsultas) ? data.estatusConsultas.filter(row => numberOrNull(row.valor) !== null) : [];
  const kpis = data.kpis || {};
  const dates = [source?.updatedAt && `Productividad: ${formatSnapshotDate(source.updatedAt)}`, source?.consultationsUpdatedAt && `Citas: ${formatSnapshotDate(source.consultationsUpdatedAt)}`].filter(Boolean).join(' · ');
  const STATUS_COLORS = ['#0088C9', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

  const handleBarClick = (entry) => {
    if (entry && entry.Medico) {
      setFilters(prev => ({ ...prev, medico: entry.Medico, search: entry.Medico }));
    }
  };

  return (
    <div className="dashboard-view" id="dashboard-eficacia" aria-busy={loading} style={{ padding: '2rem 0', fontFamily: "'Inter', sans-serif", background: 'var(--dash-bg, transparent)' }}>
      
      {!loading && !currentError && productivityAvailable && consultationsAvailable && <div style={{ display: 'none' }}>
        <ExportButton id="export-pdf-btn" type="pdf" targetId="dashboard-eficacia" compact={true} />
        <ExportButton 
          id="export-excel-btn"
          type="excel" 
          directUrl={`/dashboard/export-excel?dashboard=eficacia&${queryKey}`} 
          compact={true} 
        />
      </div>}

      {(source?.status === 'pending' || source?.status === 'stale' || currentError) && <div role="status" className="dashboard-panel" style={{ padding: '1rem 1.25rem', marginBottom: '1rem', color: 'var(--dash-text)', borderLeft: '4px solid #D99817' }}>
        {currentError ? <><p style={{ margin: 0 }}>No se pudo actualizar la información. Se conserva la última copia consultada para estos filtros.</p><p>{currentError}</p><button type="button" onClick={retry}>Reintentar</button></>
          : source.status === 'stale' ? <p style={{ margin: 0 }}>Se muestra la última copia guardada. La actualización más reciente no pudo completarse.</p>
          : <p style={{ margin: 0 }}>{!productivityAvailable ? 'La productividad médica está pendiente de su primera actualización. Las cifras se mostrarán cuando estén confirmadas.' : 'Hay información pendiente de actualizar.'}{!consultationsAvailable ? ' Las citas aún no tienen una copia confirmada.' : ''}</p>}
        {dates && <p style={{ margin: '0.5rem 0 0' }}>Fecha de la copia guardada · {dates}</p>}
      </div>}
      {loading && <p role="status">Actualizando información… Se conserva la copia consultada para estos filtros.</p>}
      {source?.status === 'complete' && dates && <p style={{ color: 'var(--dash-muted)', fontSize: '0.85rem' }}>Última actualización · {dates}</p>}

      {/* Indicadores confirmados de productividad. */}
      <div className="dashboard-metric-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <KPICard title="Consultas en el año" value={productivityAvailable ? formatNumber(kpis.totalConsultas) : 'No disponible'} color="#0088C9" icon="🩺" />
        <KPICard title="Top Especialidad" value={productivityAvailable && kpis.topEspecialidad ? kpis.topEspecialidad : 'No disponible'} color="#10B981" icon="🏆" isText={true} />
        <KPICard title="Primeras Veces" value={productivityAvailable ? formatNumber(kpis.primeras) : 'No disponible'} color="#8B5CF6" icon="👤" />
        <KPICard title="Subsecuentes" value={productivityAvailable ? formatNumber(kpis.subsecuentes) : 'No disponible'} color="#F59E0B" icon="🔄" />
      </div>

      {/* Gráficas Principales */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', marginBottom: '2rem' }}>

        <div className="dashboard-panel" style={{ flex: '1 1 400px', background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,136,201,0.1)' }}>
          <h3 style={{ margin: '0 0 1rem 0', color: '#0D1B2A', fontSize: '1.1rem' }}>Volumen de Consultas por Mes</h3>
          <div className="dashboard-chart-host" style={{ width: '100%', height: 300 }}>
            {productivityAvailable ? (<DashboardChart>
              <AreaChart data={tendenciaMensual} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0088C9" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#0088C9" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="monthStr" tick={{fill: '#64748B'}} tickLine={false} />
                <YAxis tick={{fill: '#64748B'}} axisLine={false} tickLine={false} />
                <Tooltip />
                <Legend iconType="circle" />
                <Area isAnimationActive={false} type="monotone" dataKey="Total" name="Consultas Totales" stroke="#0088C9" strokeWidth={3} fillOpacity={1} fill="url(#colorTotal)" />
                <Area isAnimationActive={false} type="monotone" dataKey="Primeras" name="Primeras Veces" stroke="#8B5CF6" strokeWidth={2} fillOpacity={0} />
              </AreaChart>
            </DashboardChart>) : <EmptyChart message="Productividad pendiente de confirmar." />}
          </div>
        </div>

        {/* Estatus Consultas (PieChart) */}
        <div className="dashboard-panel" style={{ flex: '1 1 400px', background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,136,201,0.1)' }}>
          <h3 style={{ margin: '0 0 1rem 0', color: '#0D1B2A', fontSize: '1.1rem' }}>Estado de Citas del Día</h3>
          <div className="dashboard-chart-host" style={{ width: '100%', height: 300 }}>
            {consultationsAvailable ? (<DashboardChart>
              <PieChart>
                <Pie
                  isAnimationActive={false}
                  data={estatusConsultas}
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="valor"
                  onClick={(entry) => setSelectedEstatus(entry.nombre)}
                  style={{ cursor: 'pointer' }}
                >
                  {estatusConsultas.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={STATUS_COLORS[index % STATUS_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={formatNumber} />
                <Legend layout="vertical" verticalAlign="middle" align="right" />
              </PieChart>
            </DashboardChart>) : <EmptyChart message="Citas pendientes de confirmar." />}
          </div>
        </div>
      </div>

      {/* Top Especialidades y Médicos */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem' }}>

        <div className="dashboard-panel" style={{ flex: '1 1 400px', background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,136,201,0.1)' }}>
          <h3 style={{ margin: '0 0 1rem 0', color: '#0D1B2A', fontSize: '1.1rem' }}>Top 10 Especialidades</h3>
          <div className="dashboard-chart-host" style={{ width: '100%', height: 350 }}>
            {productivityAvailable ? (<DashboardChart>
              <BarChart layout="vertical" data={topEspecialidades} margin={{ top: 10, right: 30, left: 100, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                <XAxis type="number" tick={{fill: '#64748B'}} axisLine={false} tickLine={false} />
                <YAxis dataKey="Especialidad" type="category" tick={{fill: '#334155', fontSize: 11}} axisLine={false} tickLine={false} width={150} />
                <Tooltip cursor={{fill: 'rgba(0,136,201,0.05)'}} />
                <Bar 
                  isAnimationActive={false}
                  dataKey="Total" 
                  name="Consultas" 
                  fill="#10B981" 
                  radius={[0, 4, 4, 0]} 
                  barSize={20} 
                  onClick={(entry) => {
                    if(entry && entry.Especialidad) {
                      setFilters(prev => ({ ...prev, especialidad: entry.Especialidad }));
                                    }
                  }} 
                  style={{ cursor: 'pointer' }}
                />
              </BarChart>
            </DashboardChart>) : <EmptyChart message="Productividad pendiente de confirmar." />}
          </div>
        </div>

        {/* Top 10 Médicos */}
        <div className="dashboard-panel" style={{ flex: '1 1 400px', background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,136,201,0.1)' }}>
          <h3 style={{ margin: '0 0 1rem 0', color: '#0D1B2A', fontSize: '1.1rem' }}>Top 10 Médicos (Productividad)</h3>
          <div className="dashboard-chart-host" style={{ width: '100%', height: 350 }}>
            {productivityAvailable ? (<DashboardChart>
              <BarChart layout="vertical" data={topMedicos} margin={{ top: 10, right: 30, left: 120, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                <XAxis type="number" tick={{fill: '#64748B'}} axisLine={false} tickLine={false} />
                <YAxis dataKey="Medico" type="category" tick={{fill: '#334155', fontSize: 10}} axisLine={false} tickLine={false} width={180} />
                <Tooltip cursor={{fill: 'rgba(0,136,201,0.05)'}} />
                <Bar isAnimationActive={false} dataKey="Total" name="Consultas" fill="#0088C9" radius={[0, 4, 4, 0]} barSize={20} onClick={handleBarClick} style={{ cursor: 'pointer' }} />
              </BarChart>
            </DashboardChart>) : <EmptyChart message="Productividad pendiente de confirmar." />}
          </div>
        </div>

      </div>

      {/* Tabla de Detalle de Pacientes/Consultas (Drill-down) */}
      {consultationsAvailable && selectedEstatus && data.detalleConsultas && data.detalleConsultas[selectedEstatus] && (
        <div data-html2canvas-ignore="true" style={{ background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,136,201,0.1)', marginTop: '1.5rem', animation: 'fadeIn 0.3s' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h3 style={{ margin: 0, color: '#0D1B2A', fontSize: '1.1rem' }}>Detalle de Consultas: <span style={{ color: '#0088C9' }}>{selectedEstatus}</span></h3>
              <div style={{ fontSize: '0.85rem', color: '#8A97A8', marginTop: '0.2rem' }}>Mostrando top {data.detalleConsultas[selectedEstatus].length} registros</div>
            </div>
            <button 
              onClick={() => setSelectedEstatus(null)}
              style={{ background: '#F1F5F9', border: 'none', padding: '0.4rem 0.8rem', borderRadius: 6, color: '#475569', fontWeight: 600, cursor: 'pointer' }}
            >
              Cerrar Detalle
            </button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#F8FAFC', borderBottom: '2px solid #E2E8F0', textAlign: 'left' }}>
                  <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600 }}>Fecha/Hora</th>
                  <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600 }}>Cita</th>
                  <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600 }}>Paciente</th>
                  <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600 }}>Médico</th>
                  <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600 }}>Especialidad</th>
                </tr>
              </thead>
              <tbody>
                {data.detalleConsultas[selectedEstatus].map((c, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td style={{ padding: '0.75rem 1rem', color: '#64748B' }}>{c.Fecha} {c.Hora && <span style={{fontSize: '0.75rem', marginLeft: '0.2rem'}}>{c.Hora.substring(0,5)}</span>}</td>
                    
                    <td 
                      onClick={() => { setFilters({...filters, search: c.Numero_Cita.toString()});  }}
                      style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#005FA9', cursor: 'pointer', textDecoration: 'underline' }}
                      title="Filtrar por Cita"
                    >
                      #{c.Numero_Cita}
                    </td>
                    
                    <td 
                      onClick={() => { setFilters({...filters, search: c.Paciente});  }}
                      style={{ padding: '0.75rem 1rem', cursor: 'pointer', color: '#0D1B2A' }}
                      title="Filtrar por Paciente"
                      onMouseOver={(e) => e.currentTarget.style.color = '#005FA9'}
                      onMouseOut={(e) => e.currentTarget.style.color = '#0D1B2A'}
                    >
                      {c.Paciente} <span style={{color: '#94A3B8', fontSize: '0.75rem'}}>({c.Edad_Anios || 'N/A'})</span>
                    </td>
                    
                    <td 
                      onClick={() => { setFilters({...filters, medico: c.Medico, search: c.Medico});  }}
                      style={{ padding: '0.75rem 1rem', color: '#005FA9', cursor: 'pointer', fontWeight: 600 }}
                      title="Filtrar por Médico"
                    >
                      {c.Medico}
                    </td>
                    
                    <td 
                      onClick={() => { setFilters({...filters, especialidad: c.Especialidad});  }}
                      style={{ padding: '0.75rem 1rem', cursor: 'pointer', color: '#0D1B2A' }}
                      title="Filtrar por Especialidad"
                      onMouseOver={(e) => e.currentTarget.style.color = '#005FA9'}
                      onMouseOut={(e) => e.currentTarget.style.color = '#0D1B2A'}
                    >
                      {c.Especialidad}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tabla de Detalle General (Top 100) */}
      {consultationsAvailable && data.listaConsultas && data.listaConsultas.length > 0 && (
        <div data-html2canvas-ignore="true" style={{ background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,136,201,0.1)', marginTop: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0, color: '#0D1B2A', fontSize: '1.1rem' }}>Últimas Consultas (General)</h3>
            <span style={{ fontSize: '0.85rem', color: '#8A97A8' }}>{data.listaConsultas.length} registros encontrados</span>
          </div>
          <div style={{ overflowX: 'auto', maxHeight: '400px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead style={{ position: 'sticky', top: 0, background: '#F8FAFC', zIndex: 1 }}>
                <tr style={{ borderBottom: '2px solid #E2E8F0', textAlign: 'left' }}>
                  <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600 }}>Fecha/Hora</th>
                  <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600 }}>Cita</th>
                  <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600 }}>Paciente</th>
                  <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600 }}>Médico</th>
                  <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600 }}>Especialidad</th>
                  <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600 }}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {data.listaConsultas.map((c, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td style={{ padding: '0.75rem 1rem', color: '#64748B' }}>{c.Fecha} {c.Hora && <span style={{fontSize: '0.75rem', marginLeft: '0.2rem'}}>{c.Hora.substring(0,5)}</span>}</td>
                    
                    <td 
                      onClick={() => { setFilters({...filters, search: c.Numero_Cita.toString()});  }}
                      style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#005FA9', cursor: 'pointer', textDecoration: 'underline' }}
                      title="Filtrar por Cita"
                    >
                      #{c.Numero_Cita}
                    </td>
                    
                    <td 
                      onClick={() => { setFilters({...filters, search: c.Paciente});  }}
                      style={{ padding: '0.75rem 1rem', cursor: 'pointer', color: '#0D1B2A' }}
                      title="Filtrar por Paciente"
                      onMouseOver={(e) => e.currentTarget.style.color = '#005FA9'}
                      onMouseOut={(e) => e.currentTarget.style.color = '#0D1B2A'}
                    >
                      {c.Paciente} <span style={{color: '#94A3B8', fontSize: '0.75rem'}}>({c.Edad_Anios})</span>
                    </td>
                    
                    <td 
                      onClick={() => { setFilters({...filters, medico: c.Medico, search: c.Medico});  }}
                      style={{ padding: '0.75rem 1rem', color: '#005FA9', cursor: 'pointer', fontWeight: 600 }}
                      title="Filtrar por Médico"
                    >
                      {c.Medico}
                    </td>
                    
                    <td 
                      onClick={() => { setFilters({...filters, especialidad: c.Especialidad});  }}
                      style={{ padding: '0.75rem 1rem', cursor: 'pointer', color: '#0D1B2A' }}
                      title="Filtrar por Especialidad"
                      onMouseOver={(e) => e.currentTarget.style.color = '#005FA9'}
                      onMouseOut={(e) => e.currentTarget.style.color = '#0D1B2A'}
                    >
                      {c.Especialidad}
                    </td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <span style={{ 
                        background: c.Estatus_Orden_Venta === 'Confirmada' ? '#D1FAE5' : c.Estatus_Orden_Venta === 'Procesada' ? '#E0F2FE' : '#FEE2E2',
                        color: c.Estatus_Orden_Venta === 'Confirmada' ? '#065F46' : c.Estatus_Orden_Venta === 'Procesada' ? '#0369A1' : '#991B1B',
                        padding: '0.2rem 0.6rem',
                        borderRadius: 12,
                        fontSize: '0.75rem',
                        fontWeight: 600
                      }}>
                        {c.Estatus_Orden_Venta}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}

function KPICard(props) {
  return <DashboardMetricCard {...props} />;
}

function numberOrNull(value) {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim()) || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatNumber(value) {
  const number = numberOrNull(value);
  return number === null ? 'No disponible' : number.toLocaleString('es-MX');
}

function formatSnapshotDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Fecha no disponible' : date.toLocaleString('es-MX');
}

function EmptyChart({ message }) {
  return <div className="dashboard-chart-empty" style={{ height: '100%', display: 'grid', placeItems: 'center', color: 'var(--dash-muted)', textAlign: 'center' }}>{message}</div>;
}
