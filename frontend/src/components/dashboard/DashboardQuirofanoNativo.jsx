import React, { useState, useMemo } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, ComposedChart
} from 'recharts';
import PremiumLoader from '../shared/PremiumLoader';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const COLORS = ['#10B981', '#E8853D', '#005FA9', '#EF4444', '#8B5CF6'];

export default function DashboardQuirofanoNativo({ data }) {
  const [selectedRoom, setSelectedRoom] = useState('Todos');
  const [selectedProcedure, setSelectedProcedure] = useState('Todos');
  const [selectedYear, setSelectedYear] = useState('Todas');
  const [selectedMonth, setSelectedMonth] = useState('Todos');
  const [selectedMedico, setSelectedMedico] = useState('Todos');

  const {
    filteredData,
    kpis,
    monthlyData,
    roomUsage,
    topProcedures,
    availableYears,
    availableMedicos,
    availableRooms,
    availableProcedures,
    kpisFinancieros,
    topMedicosIngresos,
    topServiciosIngresos
  } = useMemo(() => {
    if (!data || !data.lista || data.lista.length === 0) return { filteredData: [], kpis: {}, monthlyData: [], roomUsage: [], topProcedures: [], availableYears: [], availableMedicos: [], availableRooms: [], availableProcedures: [], kpisFinancieros: {}, topMedicosIngresos: [], topServiciosIngresos: [] };

    const rawData = data.lista;
    // Extraer catálogos completos
    const yearsSet = new Set();
    const medicosSetAll = new Set();
    const roomsSetAll = new Set();
    const proceduresSetAll = new Set();

    rawData.forEach(d => {
      const year = new Date(d.FechaInicio).getFullYear();
      if (!isNaN(year)) yearsSet.add(year);
      if (d.Medicos) {
        const docs = d.Medicos.split(',').map(m => m.trim()).filter(Boolean);
        docs.forEach(doc => medicosSetAll.add(doc));
      }
      if (d.Quirofano) roomsSetAll.add(d.Quirofano);
      if (d.Procedimientos) proceduresSetAll.add(d.Procedimientos);
    });
    const availableYears = Array.from(yearsSet).sort((a,b) => b - a);
    const availableMedicos = Array.from(medicosSetAll).sort();
    const availableRooms = Array.from(roomsSetAll).sort();
    const availableProcedures = Array.from(proceduresSetAll).sort();

    // Filtros de primer nivel (Año, Mes, Médico, Quirófano, Procedimiento)
    const fullyFiltered = rawData.filter(d => {
      const date = new Date(d.FechaInicio);
      if (selectedYear !== 'Todas' && date.getFullYear() !== Number(selectedYear)) return false;
      if (selectedMonth !== 'Todos' && date.getMonth() !== Number(selectedMonth)) return false;
      if (selectedMedico !== 'Todos' && (!d.Medicos || !d.Medicos.includes(selectedMedico))) return false;
      if (selectedRoom !== 'Todos' && d.Quirofano !== selectedRoom) return false;
      if (selectedProcedure !== 'Todos' && d.Procedimientos !== selectedProcedure) return false;
      return true;
    });

    // Gráficas interactivas: cuando seleccionas una, se filtra el resto (excepto ella misma para que muestre todos los totales del nivel anterior)
    // Para simplificar, todas las gráficas ahora usarán fullyFiltered y actuarán solo si el usuario no ha seleccionado nada en el dropdown. 
    // Como ahora los dropdowns controlan el estado principal, podemos reusar los mismos estados `selectedRoom` y `selectedProcedure`.
    
    // 2. KPIs based on fully filtered data
    let totalDurationMinutes = 0;
    const medicosSet = new Set();
    
    // Monthly aggregation
    const monthlyMap = {};

    fullyFiltered.forEach(d => {
      // Parse dates
      const start = new Date(d.FechaInicio);
      const end = new Date(d.FechaFin);
      let duration = 0;
      if (!isNaN(start) && !isNaN(end) && start < end) {
        duration = (end - start) / (1000 * 60);
        totalDurationMinutes += duration;
      }
      
      if (d.Medicos) medicosSet.add(d.Medicos);

      // Monthly
      if (!isNaN(start)) {
        const m = start.getMonth();
        if (!monthlyMap[m]) monthlyMap[m] = { cirugias: 0, duration: 0 };
        monthlyMap[m].cirugias += 1;
        monthlyMap[m].duration += duration;
      }
    });

    const totalCirugias = fullyFiltered.length;
    const avgDuration = totalCirugias > 0 ? (totalDurationMinutes / totalCirugias).toFixed(2) : '0.00';
    
    const kpis = {
      totalCirugias,
      avgDuration,
      medicosActivos: medicosSet.size
    };

    // Prepare Monthly Array
    const monthlyData = Object.keys(monthlyMap).map(k => Number(k)).sort((a,b) => a - b).map(m => {
      const ms = monthlyMap[m];
      return {
        Mes: MONTHS[m],
        Total_Cirugias: ms.cirugias,
        Promedio_Duracion_Cirugia: ms.cirugias > 0 ? Number((ms.duration / ms.cirugias).toFixed(2)) : 0
      };
    });

    // 3. Room Usage
    // Si selectedRoom tiene valor, la dona solo muestra esa room. Si queremos que muestre todas para poder cambiar, filtramos sin `selectedRoom`
    const dataForRooms = rawData.filter(d => {
      const date = new Date(d.FechaInicio);
      if (selectedYear !== 'Todas' && date.getFullYear() !== Number(selectedYear)) return false;
      if (selectedMonth !== 'Todos' && date.getMonth() !== Number(selectedMonth)) return false;
      if (selectedMedico !== 'Todos' && (!d.Medicos || !d.Medicos.includes(selectedMedico))) return false;
      if (selectedProcedure !== 'Todos' && d.Procedimientos !== selectedProcedure) return false;
      return true;
    });

    const roomsCount = {};
    dataForRooms.forEach(d => {
      if (!d.Quirofano) return;
      roomsCount[d.Quirofano] = (roomsCount[d.Quirofano] || 0) + 1;
    });
    const roomUsage = Object.entries(roomsCount).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value);

    // 4. Top Procedures
    // Igual para top procedures, filtramos sin `selectedProcedure` para que la lista siga visible
    const dataForProcs = rawData.filter(d => {
      const date = new Date(d.FechaInicio);
      if (selectedYear !== 'Todas' && date.getFullYear() !== Number(selectedYear)) return false;
      if (selectedMonth !== 'Todos' && date.getMonth() !== Number(selectedMonth)) return false;
      if (selectedMedico !== 'Todos' && (!d.Medicos || !d.Medicos.includes(selectedMedico))) return false;
      if (selectedRoom !== 'Todos' && d.Quirofano !== selectedRoom) return false;
      return true;
    });

    const procCount = {};
    dataForProcs.forEach(d => {
      if (!d.Procedimientos) return;
      procCount[d.Procedimientos] = (procCount[d.Procedimientos] || 0) + 1;
    });
    const topProcedures = Object.entries(procCount).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value);

    return { 
      filteredData: fullyFiltered, 
      kpis, 
      monthlyData, 
      roomUsage, 
      topProcedures, 
      availableYears, 
      availableMedicos, 
      availableRooms, 
      availableProcedures,
      kpisFinancieros: data.kpisFinancieros || {},
      topMedicosIngresos: data.topMedicosIngresos || [],
      topServiciosIngresos: data.topServiciosIngresos || []
    };
  }, [data, selectedRoom, selectedProcedure, selectedYear, selectedMonth, selectedMedico]);

  const formatCurrency = (val) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(val);

  if (!data) return <PremiumLoader text="Cargando información nativa de quirófano..." />;

  const clearFilters = () => {
    setSelectedRoom('Todos');
    setSelectedProcedure('Todos');
    setSelectedYear('Todas');
    setSelectedMonth('Todos');
    setSelectedMedico('Todos');
  };

  return (
    <div style={{ marginTop: '1rem', fontFamily: 'var(--font-body)' }} id="dashboard-quirofano-nativo">
      
      {/* Header Native Dashboard */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', color: '#004687', fontSize: '1.75rem', fontWeight: 800 }}>Analítica de Quirófanos</h2>
          <p style={{ margin: 0, color: '#64748B', fontSize: '0.9rem', fontWeight: 500 }}>Rendimiento y Ocupación</p>
        </div>
      </div>

      {/* Tarjeta de Ingreso Real Contabilizado (SAP) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.25rem', marginBottom: '1.5rem' }}>
        <div style={{ background: 'linear-gradient(135deg, #10B981, #059669)', padding: '1.25rem', borderRadius: 12, color: 'white', boxShadow: '0 4px 6px rgba(16, 185, 129, 0.2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.9 }}>Ingresos Quirófano (SAP)</div>
              <div style={{ fontSize: '2.2rem', fontFamily: 'var(--font-mono)', fontWeight: 800, marginTop: '0.5rem' }}>{formatCurrency(kpisFinancieros.ingresosSAP || 0)}</div>
              <div style={{ fontSize: '0.8rem', opacity: 0.8, marginTop: '0.5rem' }}>Contabilidad Oficial Grupo 111 (CIRUGIA QUIROFANO)</div>
            </div>
            <div style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.2)', borderRadius: 10 }}>
              <span style={{ fontSize: '1.5rem' }}>💰</span>
            </div>
          </div>
        </div>
      </div>

      {/* Top KPIs Row */}
      <div data-html2canvas-ignore="false" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.25rem', marginBottom: '1.5rem' }}>
        {/* Total Cirugías */}
        <div style={{ background: 'white', padding: '1.25rem', borderRadius: 12, boxShadow: 'var(--shadow-xs)', border: '1px solid rgba(0,0,0,0.04)', position: 'relative' }}>
          <div style={{ fontSize: '0.85rem', color: '#64748B', fontWeight: 600, marginBottom: '0.25rem' }}>Total Cirugías</div>
          <div style={{ fontSize: '2.2rem', fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#0D1B2A', lineHeight: 1 }}>
            {kpis.totalCirugias}
          </div>
          <div style={{ height: 60, marginTop: '1rem', marginLeft: '-1.25rem', marginRight: '-1.25rem', marginBottom: '-1.25rem' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyData}>
                <Line type="monotone" dataKey="Total_Cirugias" stroke="#005FA9" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Duración Promedio */}
        <div style={{ background: 'white', padding: '1.25rem', borderRadius: 12, boxShadow: 'var(--shadow-xs)', border: '1px solid rgba(0,0,0,0.04)', position: 'relative' }}>
          <div style={{ fontSize: '0.85rem', color: '#64748B', fontWeight: 600, marginBottom: '0.25rem' }}>Duración Promedio (min)</div>
          <div style={{ fontSize: '2.2rem', fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#0D1B2A', lineHeight: 1 }}>
            {kpis.avgDuration}
          </div>
          <div style={{ height: 60, marginTop: '1rem', marginLeft: '-1.25rem', marginRight: '-1.25rem', marginBottom: '-1.25rem' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyData}>
                <Line type="monotone" dataKey="Promedio_Duracion_Cirugia" stroke="#E8853D" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Médicos Activos */}
        <div style={{ background: 'white', padding: '1.25rem', borderRadius: 12, boxShadow: 'var(--shadow-xs)', border: '1px solid rgba(0,0,0,0.04)', position: 'relative' }}>
          <div style={{ fontSize: '0.85rem', color: '#64748B', fontWeight: 600, marginBottom: '0.25rem' }}>Médicos Activos</div>
          <div style={{ fontSize: '2.2rem', fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#0D1B2A', lineHeight: 1 }}>
            {kpis.medicosActivos}
          </div>
          <div style={{ height: 60, marginTop: '1rem', marginLeft: '-1.25rem', marginRight: '-1.25rem', marginBottom: '-1.25rem' }}>
            {/* Using same data just for decorative sparkline effect, ideally would use unique doctor count per month */}
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyData}>
                <Line type="step" dataKey="Total_Cirugias" stroke="#10B981" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Nuevas Gráficas de Ingresos */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', marginBottom: '1.5rem' }}>
        <div data-html2canvas-ignore="false" style={{ flex: '1 1 400px', background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid rgba(0,136,201,0.1)' }}>
          <h3 style={{ margin: '0 0 1rem 0', color: '#0D1B2A', fontSize: '1.1rem' }}>Top 10 Médicos por Ingreso (SAP)</h3>
          <div style={{ width: '100%', height: 350 }}>
            <ResponsiveContainer>
              <BarChart layout="vertical" data={topMedicosIngresos} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
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
          <h3 style={{ margin: '0 0 1rem 0', color: '#0D1B2A', fontSize: '1.1rem' }}>Top 10 Servicios Facturados (SAP)</h3>
          <div style={{ width: '100%', height: 350 }}>
            <ResponsiveContainer>
              <BarChart layout="vertical" data={topServiciosIngresos} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
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

      {/* Main Charts Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '1.25rem', alignItems: 'stretch' }}>
        
        {/* Evolución Mensual */}
        <div data-html2canvas-ignore="false" style={{ background: 'white', padding: '1.25rem', borderRadius: 12, boxShadow: 'var(--shadow-xs)', border: '1px solid rgba(0,0,0,0.04)' }}>
          <h3 style={{ margin: '0 0 1rem 0', fontSize: '0.95rem', color: '#475569', fontWeight: 600 }}>Evolución Mensual</h3>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <ComposedChart data={monthlyData} margin={{ top: 20, right: 20, bottom: 20, left: 0 }}>
                <CartesianGrid stroke="#f5f5f5" vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="Mes" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                <Tooltip 
                  contentStyle={{ borderRadius: 8, border: 'none', boxShadow: 'var(--shadow-md)' }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                <Bar yAxisId="left" dataKey="Total_Cirugias" name="Total Cirugías" barSize={30} fill="#4F8DF9" isAnimationActive={false} />
                <Line yAxisId="right" type="monotone" dataKey="Promedio_Duracion_Cirugia" name="Promedio_Duracion_Cirugia" stroke="#F17C43" strokeWidth={3} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Uso de Salas (Dona) */}
        <div data-html2canvas-ignore="false" style={{ background: 'white', padding: '1.25rem', borderRadius: 12, boxShadow: 'var(--shadow-xs)', border: '1px solid rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ margin: '0 0 1rem 0', fontSize: '0.95rem', color: '#475569', fontWeight: 600, textAlign: 'center' }}>Uso de Salas</h3>
          <div style={{ width: '100%', flex: 1, minHeight: 250 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={roomUsage}
                  cx="50%"
                  cy="50%"
                  innerRadius="50%"
                  outerRadius="70%"
                  dataKey="value"
                  isAnimationActive={false}
                  onClick={(entry) => setSelectedRoom(selectedRoom === entry.name ? 'Todos' : entry.name)}
                  style={{ cursor: 'pointer' }}
                  label={({ name, percent, value }) => {
                    if (percent < 0.05) return null;
                    return `${value} (${(percent * 100).toFixed(1)}%)`;
                  }}
                  labelLine={true}
                >
                  {roomUsage.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={COLORS[index % COLORS.length]} 
                      opacity={selectedRoom !== 'Todos' ? (selectedRoom === entry.name ? 1 : 0.3) : 1}
                    />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => [value, 'Cirugías']} />
                <Legend 
                  iconType="circle" 
                  wrapperStyle={{ fontSize: '10px' }} 
                  onClick={(e) => setSelectedRoom(selectedRoom === e.value ? 'Todos' : e.value)}
                  style={{ cursor: 'pointer' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top Procedimientos */}
        <div data-html2canvas-ignore="false" style={{ background: 'white', borderRadius: 12, boxShadow: 'var(--shadow-xs)', border: '1px solid rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '1rem', borderBottom: '1px solid #F1F5F9' }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem', color: '#475569', fontWeight: 600, textAlign: 'center' }}>Top Procedimientos</h3>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem', maxHeight: '280px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '0.5rem', color: '#94A3B8', borderBottom: '1px solid #F1F5F9', fontWeight: 600 }}>Procedimientos</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem', color: '#94A3B8', borderBottom: '1px solid #F1F5F9', fontWeight: 600 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {topProcedures.map((proc, i) => {
                  const isSelected = selectedProcedure === proc.name;
                  return (
                    <tr 
                      key={i} 
                      onClick={() => setSelectedProcedure(isSelected ? 'Todos' : proc.name)}
                      style={{ 
                        cursor: 'pointer', 
                        background: isSelected ? '#EFF6FF' : 'transparent',
                        fontWeight: isSelected ? 700 : 400
                      }}
                      onMouseEnter={(e) => !isSelected && (e.currentTarget.style.background = '#F8FAFC')}
                      onMouseLeave={(e) => !isSelected && (e.currentTarget.style.background = 'transparent')}
                    >
                      <td style={{ padding: '0.4rem 0.5rem', borderBottom: '1px solid #F8FAFC', color: isSelected ? '#1E40AF' : '#334155' }}>
                        {proc.name}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', borderBottom: '1px solid #F8FAFC', textAlign: 'right', color: isSelected ? '#1E40AF' : '#64748B' }}>
                        {proc.value}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {/* Tabla de Detalle de Cirugías */}
      <div data-html2canvas-ignore="true" style={{ background: 'white', padding: '1.5rem', borderRadius: 12, boxShadow: 'var(--shadow-xs)', border: '1px solid rgba(0,0,0,0.04)', marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, color: '#0D1B2A', fontSize: '1.1rem' }}>Detalle de Cirugías {selectedRoom !== 'Todos' ? `(${selectedRoom})` : ''}</h3>
          
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', color: '#8A97A8' }}>{filteredData.length} registros</span>
          </div>
        </div>
        
        <div style={{ overflowX: 'auto', maxHeight: '400px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead style={{ position: 'sticky', top: 0, background: 'white', zIndex: 1 }}>
              <tr style={{ borderBottom: '2px solid #E2E8F0', color: '#64748B', textAlign: 'left' }}>
                <th style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>Quirófano</th>
                <th style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>Procedimiento</th>
                <th style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>Médicos</th>
                <th style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>Inicio</th>
                <th style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>Fin</th>
                <th style={{ padding: '0.75rem 1rem', fontWeight: 600, textAlign: 'right' }}>Duración</th>
              </tr>
            </thead>
            <tbody>
              {filteredData.slice(0, 100).map((row, i) => {
                const start = new Date(row.FechaInicio);
                const end = new Date(row.FechaFin);
                let durText = '-';
                if (!isNaN(start) && !isNaN(end) && start < end) {
                  const m = Math.round((end - start) / 60000);
                  durText = `${m} min`;
                }

                const startDate = !isNaN(start) ? start.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : row.FechaInicio;
                const endDate = !isNaN(end) ? end.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : row.FechaFin;

                return (
                  <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td style={{ padding: '0.75rem 1rem', fontWeight: 500, color: '#0D1B2A' }}>{row.Quirofano}</td>
                    <td style={{ padding: '0.75rem 1rem', color: '#475569' }}>{row.Procedimientos || '-'}</td>
                    <td style={{ padding: '0.75rem 1rem', color: '#64748B', fontSize: '0.8rem' }}>{row.Medicos || '-'}</td>
                    <td style={{ padding: '0.75rem 1rem', color: '#64748B' }}>{startDate}</td>
                    <td style={{ padding: '0.75rem 1rem', color: '#64748B' }}>{endDate}</td>
                    <td style={{ padding: '0.75rem 1rem', color: '#004687', fontWeight: 600, textAlign: 'right' }}>{durText}</td>
                  </tr>
                );
              })}
              {filteredData.length === 0 && (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', padding: '2rem', color: '#94A3B8' }}>
                    No hay cirugías con los filtros seleccionados
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
