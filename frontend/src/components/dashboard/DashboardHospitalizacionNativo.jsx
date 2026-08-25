import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import useEscapeKey from '../../hooks/useEscapeKey';

export default function DashboardHospitalizacionNativo({ data }) {
  const [selectedStatus, setSelectedStatus] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Modal details states
  const [selectedPatientDetail, setSelectedPatientDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailItems, setDetailItems] = useState([]);
  const [detailSearchQuery, setDetailSearchQuery] = useState('');
  const [detailSelectedGroup, setDetailSelectedGroup] = useState(null);

  useEscapeKey(() => setSelectedPatientDetail(null), !!selectedPatientDetail);

  if (!data) return null;

  const { kpis, censoCamas, ingresosPorGrupo, topInsumos, listaPacientes } = data;

  const COLORS = ['#0EA5E9', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#6B7280'];

  const formatCurrency = (val) => 
    new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(val);

  const formatDateStr = (dateStr) => {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    return d.toLocaleString('es-MX', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getDaysBetween = (start, end) => {
    if (!start) return '-';
    const s = new Date(start);
    const e = end ? new Date(end) : new Date();
    const diff = Math.max(0, Math.ceil((e - s) / (1000 * 60 * 60 * 24)));
    return `${diff} ${diff === 1 ? 'día' : 'días'}`;
  };

  // Fetch detailed account charges on click
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

  // Filter patients list
  const filteredPatients = listaPacientes.filter(p => {
    if (selectedStatus) {
      if (selectedStatus === 'ACTIVO' && p.status !== 'OP') return false;
      if (selectedStatus === 'ALTA' && p.status === 'OP') return false;
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const folio = (p.folio || '').toString().toLowerCase();
      const name = (p.paciente || '').toLowerCase();
      const doctor = (p.medico || '').toLowerCase();
      const room = (p.room || '').toLowerCase();
      return folio.includes(q) || name.includes(q) || doctor.includes(q) || room.includes(q);
    }
    return true;
  });

  // Filter detail items in modal
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

  // Calculate some counts for censo status
  const totalBeds = censoCamas.length;
  const occupiedBedsCount = censoCamas.filter(b => b.Estado === 'OCUPADA').length;
  const freeBedsCount = totalBeds - occupiedBedsCount;

  return (
    <div style={{ marginTop: '2rem', fontFamily: 'var(--font-body)' }}>
      <style>{`
        .hos-card-glow {
          box-shadow: 0 4px 6px rgba(0,0,0,0.03);
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .hos-card-glow:hover {
          transform: translateY(-3px);
          box-shadow: 0 10px 20px rgba(239, 68, 68, 0.08);
        }
        .bed-card-libre {
          border: 1px solid rgba(16, 185, 129, 0.15);
          border-left: 5px solid #10B981;
        }
        .bed-card-libre:hover {
          box-shadow: 0 8px 16px rgba(16, 185, 129, 0.08);
        }
        .bed-card-ocupada {
          border: 1px solid rgba(239, 68, 68, 0.15);
          border-left: 5px solid #EF4444;
          cursor: pointer;
        }
        .bed-card-ocupada:hover {
          box-shadow: 0 8px 16px rgba(239, 68, 68, 0.15);
          transform: translateY(-3px);
        }
        .patients-table th {
          font-family: var(--font-display);
          font-size: 0.78rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #475569;
          padding: 0.75rem 1rem;
          background: #F8FAFC;
        }
        .patients-table td {
          padding: 0.75rem 1rem;
          color: #334155;
          border-bottom: 1px solid #E2E8F0;
        }
        .patients-table tr:hover {
          background-color: #F8FAFC;
        }
        
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes modalSlideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>

      {/* ── SECCIÓN 1: METRICAS CLAVE ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem', marginBottom: '2rem' }}>
        
        {/* KPI: Facturación Total */}
        <div className="hos-card-glow" style={{ background: 'linear-gradient(135deg, #1E293B, #0F172A)', color: 'white', padding: '1.5rem', borderRadius: '16px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: '-15px', bottom: '-15px', opacity: 0.08, fontSize: '6rem' }}>💰</div>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94A3B8' }}>Facturación Hospitalización (Acumulada)</div>
          <div style={{ fontSize: '1.85rem', fontWeight: 800, fontFamily: 'var(--font-mono)', margin: '0.5rem 0' }}>
            {formatCurrency(kpis.totalFacturado || 0)}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#64748B', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <span>🏥</span> <span>Cargos a {kpis.totalPacientes || 0} pacientes en el periodo</span>
          </div>
        </div>

        {/* KPI: Ocupación */}
        <div className="hos-card-glow" style={{ background: 'white', padding: '1.5rem', borderRadius: '16px', border: '1px solid #E2E8F0', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: '-10px', bottom: '-15px', opacity: 0.05, fontSize: '6rem' }}>🛏️</div>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748B' }}>Ocupación de Camas Hospitalización</div>
          <div style={{ fontSize: '2.1rem', fontWeight: 800, margin: '0.5rem 0', color: '#EF4444', display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
            {kpis.ocupacionPct || 0}%
            <span style={{ fontSize: '0.9rem', color: '#64748B', fontWeight: 600 }}>({kpis.camasOcupadas}/{kpis.totalCamas} camas)</span>
          </div>
          <div style={{ fontSize: '0.8rem', color: '#64748B', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ height: 8, width: 8, borderRadius: '50%', background: '#10B981', display: 'inline-block' }}></span>
            <span>{freeBedsCount} camas libres en este momento</span>
          </div>
        </div>

        {/* KPI: Estancia Promedio */}
        <div className="hos-card-glow" style={{ background: 'white', padding: '1.5rem', borderRadius: '16px', border: '1px solid #E2E8F0', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: '-10px', bottom: '-15px', opacity: 0.05, fontSize: '6rem' }}>⏱️</div>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748B' }}>Estancia Promedio Hospitalización</div>
          <div style={{ fontSize: '2.1rem', fontWeight: 800, margin: '0.5rem 0', color: '#0F172A' }}>
            {kpis.estanciaPromedio || 0} <span style={{ fontSize: '1.1rem', fontWeight: 600, color: '#64748B' }}>días</span>
          </div>
          <div style={{ fontSize: '0.8rem', color: '#64748B', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <span>⏱️</span> <span>Promedio por paciente egresado de Hospitalización</span>
          </div>
        </div>

        {/* KPI: Mortalidad */}
        <div className="hos-card-glow" style={{ background: 'white', padding: '1.5rem', borderRadius: '16px', border: '1px solid #E2E8F0', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: '-10px', bottom: '-15px', opacity: 0.05, fontSize: '6rem' }}>🩺</div>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748B' }}>Tasa de Mortalidad Hospitalización</div>
          <div style={{ fontSize: '2.1rem', fontWeight: 800, margin: '0.5rem 0', color: '#0F172A' }}>
            {kpis.tasaMortalidad || 0}%
          </div>
          <div style={{ fontSize: '0.8rem', color: '#64748B', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <span>⚠️</span> <span>Egresados fallecidos en Hospitalización</span>
          </div>
        </div>

      </div>

      {/* ── SECCIÓN 2: CENSO DE CAMAS EN VIVO ── */}
      <div style={{ background: '#FFFFFF', padding: '1.75rem', borderRadius: '16px', border: '1px solid #E2E8F0', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', justifycontent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h3 style={{ margin: 0, fontFamily: "var(--font-display)", color: '#0F172A', fontSize: '1.2rem', fontWeight: 800 }}>Censo Clínico en Vivo — Monitor de Hospitalización</h3>
            <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: '#64748B' }}>
              Estado actual de los cubículos de Hospitalización (Piso). Haz clic en una cama ocupada para ver el desglose detallado de su cuenta.
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

        {/* Camas Grid */}
        {occupiedBedsCount === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#64748B', background: '#F8FAFC', borderRadius: '12px', border: '1px dashed #CBD5E1' }}>
            <span style={{ fontSize: '2rem', display: 'block', marginBottom: '0.5rem' }}>🛏️</span>
            No hay pacientes ingresados en este momento.
          </div>
        ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem' }}>
          {censoCamas.filter(bed => bed.Estado === 'OCUPADA').map((bed, idx) => {
            const isOcupada = bed.Estado === 'OCUPADA';
            return (
              <div 
                key={idx}
                className={isOcupada ? "hos-card-glow bed-card-ocupada" : "hos-card-glow bed-card-libre"}
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
                  position: 'relative'
                }}
              >
                {/* Header Camas */}
                <div style={{ display: 'flex', justifycontent: 'space-between', alignItems: 'center' }}>
                  <div style={{ 
                    fontFamily: 'var(--font-display)', 
                    fontSize: '0.8rem', 
                    fontWeight: 750, 
                    color: '#64748B',
                    letterSpacing: '0.04em'
                  }}>
                    {bed.RoomCode}
                  </div>
                  <span style={{
                    fontSize: '0.64rem',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    padding: '0.15rem 0.5rem',
                    borderRadius: '20px',
                    background: isOcupada ? '#FEF2F2' : '#ECFDF5',
                    color: isOcupada ? '#EF4444' : '#10B981'
                  }}>
                    {isOcupada ? '🔴 Ocupado' : '🟢 Libre'}
                  </span>
                </div>

                <div style={{ 
                  fontFamily: 'var(--font-display)',
                  fontSize: '0.98rem', 
                  fontWeight: 800, 
                  color: '#0F172A',
                  margin: '0.1rem 0'
                }}>
                  {bed.RoomName.replace('TERAPIA INTENSIVA', '').replace('CUBICULO', 'Cubículo').trim()}
                </div>

                {isOcupada ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', borderTop: '1px solid #F1F5F9', paddingTop: '0.6rem', marginTop: '0.2rem' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#1E293B' }}>
                      👤 {bed.Paciente}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#64748B', display: 'flex', gap: '0.25rem' }}>
                      <span style={{ fontWeight: 600 }}>Folio:</span> 
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{bed.PCNum}</span>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#64748B' }}>
                      🩺 <span style={{ fontWeight: 600 }}>Médico:</span> {bed.Medico || 'No especificado'}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#64748B' }}>
                      📅 <span style={{ fontWeight: 600 }}>Ingreso:</span> {formatDateStr(bed.FechaIngreso)}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#64748B' }}>
                      ⏳ <span style={{ fontWeight: 600 }}>Estancia:</span> {getDaysBetween(bed.FechaIngreso)}
                    </div>
                    
                    {/* Accumulated charges for this active patient */}
                    <div style={{ 
                      marginTop: '0.3rem', 
                      background: 'rgba(5, 150, 105, 0.04)', 
                      padding: '0.5rem 0.75rem', 
                      borderRadius: '8px', 
                      display: 'flex', 
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      border: '1.5px dashed rgba(5, 150, 105, 0.2)'
                    }}>
                      <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#047857', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Cargos Hospitalización</span>
                      <span style={{ fontSize: '0.9rem', fontWeight: 850, color: '#059669', fontFamily: 'var(--font-mono)' }}>
                        {formatCurrency(bed.totalCargos)}
                      </span>
                    </div>
                    
                    <div style={{ 
                      fontSize: '0.68rem', 
                      color: '#059669', 
                      textAlign: 'center', 
                      marginTop: '0.15rem', 
                      fontWeight: 700, 
                      letterSpacing: '0.02em'
                    }}>
                      🔍 Haz clic para ver desglose de cuenta
                    </div>
                  </div>
                ) : (
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    flexDirection: 'column', 
                    padding: '1.5rem 0',
                    color: '#94A3B8',
                    gap: '0.4rem',
                    borderTop: '1px solid #F1F5F9',
                    marginTop: '0.2rem'
                  }}>
                    <span style={{ fontSize: '1.5rem' }}>🛌</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#94A3B8' }}>Cama disponible</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        )}
      </div>

      {/* ── SECCIÓN 3: GRAFICAS ANALÍTICAS ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', marginBottom: '2rem' }}>
        
        {/* Gráfica 1: Distribución Financiera */}
        <div style={{ flex: '1 1 400px', background: 'white', padding: '1.75rem', borderRadius: '16px', border: '1px solid #E2E8F0', boxShadow: '0 4px 6px rgba(0,0,0,0.02)' }}>
          <h3 style={{ margin: '0 0 1rem 0', fontFamily: 'var(--font-display)', color: '#0F172A', fontSize: '1.1rem', fontWeight: 800 }}>Distribución de Cargos</h3>
          <div style={{ width: '100%', height: 320, display: 'flex', flexDirection: 'column', justifycontent: 'center' }}>
            {ingresosPorGrupo && ingresosPorGrupo.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={ingresosPorGrupo}
                    cx="50%"
                    cy="45%"
                    innerRadius={65}
                    outerRadius={95}
                    paddingAngle={3}
                    dataKey="total"
                    nameKey="grupo"
                    isAnimationActive={false}
                  >
                    {ingresosPorGrupo.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => [formatCurrency(value), 'Total Cargado']} />
                  <Legend 
                    verticalAlign="bottom" 
                    align="center"
                    iconSize={8}
                    wrapperStyle={{ fontSize: '0.72rem', paddingTop: '10px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ textAlign: 'center', color: '#64748B', fontSize: '0.85rem' }}>No hay cargos registrados en este periodo</div>
            )}
          </div>
        </div>

        {/* Gráfica 2: Top Insumos y Medicamentos */}
        <div style={{ flex: '1 1 400px', background: 'white', padding: '1.75rem', borderRadius: '16px', border: '1px solid #E2E8F0', boxShadow: '0 4px 6px rgba(0,0,0,0.02)' }}>
          <h3 style={{ margin: '0 0 1rem 0', fontFamily: 'var(--font-display)', color: '#0F172A', fontSize: '1.1rem', fontWeight: 800 }}>Top 10 Insumos y Medicamentos de Mayor Costo</h3>
          <div style={{ width: '100%', height: 320 }}>
            {topInsumos && topInsumos.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={topInsumos}
                  margin={{ top: 5, right: 10, left: 15, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                  <XAxis 
                    type="number" 
                    tickFormatter={(val) => `$${(val/1000).toFixed(0)}k`} 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 11, fill: '#64748B' }} 
                  />
                  <YAxis 
                    dataKey="nombre" 
                    type="category" 
                    width={130} 
                    axisLine={false} 
                    tickLine={false} 
                    tickFormatter={(val) => val.length > 18 ? `${val.substring(0, 16)}...` : val}
                    tick={{ fontSize: 10.5, fill: '#334155', fontWeight: 550 }} 
                  />
                  <Tooltip 
                    formatter={(value, name, props) => [
                      formatCurrency(value), 
                      `Costo Total (${props.payload.cantidad} pzs)`
                    ]}
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 10px rgba(0,0,0,0.1)' }}
                  />
                  <Bar dataKey="total" fill="#059669" radius={[0, 4, 4, 0]} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ textAlign: 'center', padding: '5rem 0', color: '#64748B', fontSize: '0.85rem' }}>No hay consumos de insumos registrados</div>
            )}
          </div>
        </div>

      </div>

      {/* ── SECCIÓN 4: DETALLE HISTÓRICO DE PACIENTES ── */}
      <div style={{ background: 'white', padding: '1.75rem', borderRadius: '16px', border: '1px solid #E2E8F0', boxShadow: '0 4px 6px rgba(0,0,0,0.02)' }}>
        <div style={{ display: 'flex', justifycontent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', color: '#0F172A', fontSize: '1.15rem', fontWeight: 800 }}>Historial Clínico y Facturación de Pacientes</h3>
            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.78rem', color: '#64748B' }}>
              Muestra todas las cuentas de pacientes que recibieron atención en Hospitalización durante el periodo seleccionado. Haz clic en el monto de cargos para ver el desglose de su cuenta.
            </p>
          </div>

          {/* Filtros y Buscador */}
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <input 
              type="text"
              placeholder="Buscar paciente, médico, folio..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                padding: '0.45rem 1rem',
                borderRadius: '10px',
                border: '1.5px solid #CBD5E1',
                fontSize: '0.82rem',
                outline: 'none',
                minWidth: '220px'
              }}
            />

            <select
              value={selectedStatus || ''}
              onChange={(e) => setSelectedStatus(e.target.value || null)}
              style={{
                padding: '0.45rem 1.5rem 0.45rem 0.75rem',
                borderRadius: '10px',
                border: '1.5px solid #CBD5E1',
                fontSize: '0.82rem',
                outline: 'none',
                background: '#FFFFFF',
                cursor: 'pointer'
              }}
            >
              <option value="">Todos los Estatus</option>
              <option value="ACTIVO">Activos (En Piso)</option>
              <option value="ALTA">Egresados (Alta)</option>
            </select>

            {(searchQuery || selectedStatus) && (
              <button
                onClick={() => { setSearchQuery(''); setSelectedStatus(null); }}
                style={{
                  background: '#F1F5F9',
                  border: 'none',
                  color: '#EF4444',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  padding: '0.45rem 0.75rem',
                  borderRadius: '8px',
                  cursor: 'pointer'
                }}
              >
                Limpiar Filtros
              </button>
            )}
            <span style={{ fontSize: '0.8rem', color: '#64748B', fontWeight: 600 }}>
              {filteredPatients.length} pacientes
            </span>
          </div>
        </div>

        {/* Tabla */}
        <div style={{ overflowX: 'auto' }}>
          {filteredPatients.length > 0 ? (
            <table className="patients-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr>
                  <th>Folio</th>
                  <th>Paciente</th>
                  <th>Ubicación / Habitación</th>
                  <th>Ingreso</th>
                  <th>Egreso / Alta</th>
                  <th>Días Estancia</th>
                  <th>Médico Tratante</th>
                  <th style={{ textAlign: 'right' }}>Cargos Hospitalización</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {filteredPatients.map((p, idx) => {
                  const isActivo = p.status === 'OP';
                  return (
                    <tr key={idx}>
                      <td style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: '#0F172A' }}>
                        {p.folio}
                      </td>
                      <td style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                        {p.paciente}
                      </td>
                      <td style={{ fontSize: '0.8rem', color: '#64748B' }}>
                        {p.room ? p.room.replace('TERAPIA INTENSIVA', 'Terap. Intensiva').replace('CUBICULO', 'Cubículo') : 'Hospitalización'}
                      </td>
                      <td style={{ fontSize: '0.8rem', color: '#64748B' }}>
                        {formatDateStr(p.entrydate)}
                      </td>
                      <td style={{ fontSize: '0.8rem', color: '#64748B' }}>
                        {p.medicaldischargedate ? formatDateStr(p.medicaldischargedate) : '—'}
                      </td>
                      <td style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                        {getDaysBetween(p.entrydate, p.medicaldischargedate)}
                      </td>
                      <td style={{ fontSize: '0.8rem' }}>
                        {p.medico || 'No especificado'}
                      </td>
                      <td 
                        onClick={() => setSelectedPatientDetail({
                          folio: p.folio,
                          paciente: p.paciente,
                          room: p.room,
                          total: p.total_cargos,
                          entrydate: p.entrydate
                        })}
                        style={{ 
                          textAlign: 'right', 
                          fontWeight: 750, 
                          fontFamily: 'var(--font-mono)', 
                          fontSize: '0.86rem', 
                          color: '#059669', 
                          cursor: 'pointer', 
                          textDecoration: 'underline' 
                        }}
                        title="Ver desglose de cuenta"
                      >
                        {formatCurrency(p.total_cargos)}
                      </td>
                      <td>
                        <span style={{
                          fontSize: '0.72rem',
                          fontWeight: 750,
                          padding: '0.2rem 0.55rem',
                          borderRadius: '12px',
                          background: isActivo ? '#FEF3C7' : '#ECFDF5',
                          color: isActivo ? '#D97706' : '#059669',
                          display: 'inline-block',
                          textAlign: 'center',
                          minWidth: '70px'
                        }}>
                          {isActivo ? 'En Piso' : 'Egreso (Alta)'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div style={{ textAlign: 'center', padding: '3.5rem 0', color: '#94A3B8', fontSize: '0.85rem' }}>
              No se encontraron registros de pacientes que coincidan con la búsqueda.
            </div>
          )}
        </div>
      </div>

      {/* ── MODAL: ESTADO DE CUENTA DETALLADO ── */}
      {selectedPatientDetail && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(8px)',
          zIndex: 9999,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '2rem'
        }}>
          <div style={{
            background: 'white',
            borderRadius: '20px',
            width: '100%',
            maxWidth: '900px',
            maxHeight: '90vh',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            border: '1px solid rgba(226, 232, 240, 0.8)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            animation: 'modalSlideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
          }}>
            {/* Modal Header */}
            <div style={{
              padding: '1.5rem 1.75rem',
              borderBottom: '1px solid #F1F5F9',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              background: 'linear-gradient(135deg, #FFF, #F8FAFC)'
            }}>
              <div>
                <span style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748B' }}>
                  Desglose de Cuenta Hospitalaria — {selectedPatientDetail.room ? selectedPatientDetail.room.replace('CUBICULO', 'Cubículo') : 'Hospitalización'}
                </span>
                <h2 style={{ margin: '0.2rem 0 0 0', fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 800, color: '#0F172A' }}>
                  {selectedPatientDetail.paciente}
                </h2>
                <div style={{ display: 'flex', gap: '1rem', marginTop: '0.25rem', fontSize: '0.78rem', color: '#64748B' }}>
                  <span>Cuenta: <strong style={{ fontFamily: 'var(--font-mono)' }}>{selectedPatientDetail.folio}</strong></span>
                  {selectedPatientDetail.entrydate && (
                    <span>Ingreso: <strong>{formatDateStr(selectedPatientDetail.entrydate)}</strong></span>
                  )}
                </div>
              </div>
              
              {/* Right side: Amount highlighted */}
              <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94A3B8' }}>Total Cargado</span>
                <div style={{ fontSize: '1.6rem', fontWeight: 850, color: '#059669', fontFamily: 'var(--font-mono)' }}>
                  {formatCurrency(selectedPatientDetail.total)}
                </div>
              </div>
            </div>

            {/* Modal Filters Toolbar */}
            <div style={{
              padding: '0.75rem 1.75rem',
              borderBottom: '1px solid #F1F5F9',
              background: '#FFF',
              display: 'flex',
              gap: '1rem',
              alignItems: 'center',
              flexWrap: 'wrap'
            }}>
              <input 
                type="text"
                placeholder="Filtrar cargos (ej: glucosa, estancia, etc)..."
                value={detailSearchQuery}
                onChange={(e) => setDetailSearchQuery(e.target.value)}
                style={{
                  flex: '1 1 200px',
                  padding: '0.45rem 0.85rem',
                  borderRadius: '8px',
                  border: '1.5px solid #CBD5E1',
                  fontSize: '0.8rem',
                  outline: 'none'
                }}
              />

              <select
                value={detailSelectedGroup || ''}
                onChange={(e) => setDetailSelectedGroup(e.target.value || null)}
                style={{
                  padding: '0.45rem 1.5rem 0.45rem 0.6rem',
                  borderRadius: '8px',
                  border: '1.5px solid #CBD5E1',
                  fontSize: '0.8rem',
                  outline: 'none',
                  background: '#FFFFFF',
                  cursor: 'pointer'
                }}
              >
                <option value="">Todas las categorías</option>
                {Array.from(new Set(detailItems.map(item => item.grupo))).filter(Boolean).sort().map(grp => (
                  <option key={grp} value={grp}>{grp}</option>
                ))}
              </select>
              
              <span style={{ fontSize: '0.78rem', color: '#64748B', marginLeft: 'auto', fontWeight: 600 }}>
                {filteredDetailItems.length} cargos mostrados
              </span>
            </div>

            {/* Modal Body / Table */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.75rem' }}>
              {detailLoading ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '5rem 0', gap: '1rem' }}>
                  <div className="spinner" style={{
                    width: '40px',
                    height: '40px',
                    border: '4px solid #F3F4F6',
                    borderTop: '4px solid #EF4444',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite'
                  }}></div>
                  <span style={{ fontSize: '0.85rem', color: '#64748B', fontWeight: 600 }}>Cargando estado de cuenta...</span>
                </div>
              ) : filteredDetailItems.length > 0 ? (
                <table className="patients-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.82rem' }}>
                  <thead>
                    <tr>
                      <th style={{ position: 'sticky', top: 0, zIndex: 10 }}>Fecha</th>
                      <th style={{ position: 'sticky', top: 0, zIndex: 10 }}>Categoría</th>
                      <th style={{ position: 'sticky', top: 0, zIndex: 10 }}>Código</th>
                      <th style={{ position: 'sticky', top: 0, zIndex: 10 }}>Concepto / Artículo</th>
                      <th style={{ position: 'sticky', top: 0, zIndex: 10, textAlign: 'right' }}>Cant.</th>
                      <th style={{ position: 'sticky', top: 0, zIndex: 10, textAlign: 'right' }}>P. Unitario</th>
                      <th style={{ position: 'sticky', top: 0, zIndex: 10, textAlign: 'right' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDetailItems.map((item, idx) => (
                      <tr key={idx}>
                        <td style={{ color: '#64748B', fontSize: '0.76rem', whiteSpace: 'nowrap' }}>{formatDateStr(item.fecha)}</td>
                        <td style={{ color: '#64748B', fontSize: '0.76rem' }}>{item.grupo}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', color: '#64748B' }}>{item.codigo}</td>
                        <td style={{ fontWeight: 600, color: '#0F172A' }}>{item.insumo}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{item.cantidad}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatCurrency(item.precio_unitario)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#0F172A' }}>{formatCurrency(item.total_cobrado)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{ textAlign: 'center', padding: '5rem 0', color: '#94A3B8', fontSize: '0.85rem' }}>
                  No se encontraron cargos para esta cuenta.
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '1.25rem 1.75rem',
              borderTop: '1px solid #F1F5F9',
              display: 'flex',
              justifyContent: 'flex-end',
              background: '#F8FAFC'
            }}>
              <button
                onClick={() => setSelectedPatientDetail(null)}
                style={{
                  background: '#EF4444',
                  color: 'white',
                  border: 'none',
                  padding: '0.55rem 1.5rem',
                  borderRadius: '10px',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  boxShadow: '0 4px 6px rgba(239, 68, 68, 0.25)',
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#DC2626'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#EF4444'}
              >
                Cerrar Detalle
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
