import React, { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend
} from 'recharts';
import EstadoCuentaModal from '../shared/EstadoCuentaModal';
import PremiumLoader from '../shared/PremiumLoader';

const COLORS = ['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#EF4444', '#EC4899', '#6366F1', '#14B8A6'];

export default function DashboardAseguradorasNativo({ globalFilters, globalTrigger }) {
  const [data, setData] = useState({
    kpis: {
      totalPacientes: 0,
      montoTotal: 0,
      saldoPendiente: 0,
      cuentaPromedio: 0
    },
    topAseguradoras: [],
    listaPacientes: []
  });
  const [loading, setLoading] = useState(true);
  const [selectedAseguradora, setSelectedAseguradora] = useState(null);
  const [selectedPCNum, setSelectedPCNum] = useState(null);

  const handleOpenModal = (pcNum) => {
    setSelectedPCNum(pcNum);
  };

  const fetchAccountDetails = (pcNum) => {
    setSelectedPCNum(pcNum);
  };

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const token = sessionStorage.getItem('escandon_token');
        const headers = { Authorization: `Bearer ${token}` };

        let url = `/api/dashboard/aseguradoras-nativo?`;
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
  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: '2-digit' });
  };

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <PremiumLoader text="Cargando Datos de Aseguradoras..." />
    </div>
  );

  return (
    <div style={{ padding: '1rem', background: '#F8FAFC', borderRadius: '16px' }}>
      
      {/* KPIs Principales */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        
        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)', borderLeft: `6px solid #3B82F6` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <span style={{ color: '#64748b', fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pacientes (Vertical)</span>
            <span style={{ fontSize: '24px' }}>👥</span>
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#0f172a', fontFamily: 'var(--font-display)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {formatNumber(data.kpis.totalPacientes)}
          </div>
          <div style={{ fontSize: '0.85rem', color: '#3B82F6', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            Cuentas con convenio activo
          </div>
        </div>

        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)', borderLeft: `6px solid #10B981` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <span style={{ color: '#64748b', fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Facturado</span>
            <span style={{ fontSize: '24px' }}>💰</span>
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#0f172a', fontFamily: 'var(--font-display)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={formatCurrency(data.kpis.montoTotal)}>
            {formatCurrency(data.kpis.montoTotal)}
          </div>
          <div style={{ fontSize: '0.85rem', color: '#10B981', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            Montos de las cuentas
          </div>
        </div>

        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)', borderLeft: `6px solid #F59E0B` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <span style={{ color: '#64748b', fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Saldo Pendiente</span>
            <span style={{ fontSize: '24px' }}>⏳</span>
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#0f172a', fontFamily: 'var(--font-display)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={formatCurrency(data.kpis.saldoPendiente)}>
            {formatCurrency(data.kpis.saldoPendiente)}
          </div>
          <div style={{ fontSize: '0.85rem', color: '#F59E0B', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            Por cobrar en sistema Vertical
          </div>
        </div>

        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)', borderLeft: `6px solid #8B5CF6` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <span style={{ color: '#64748b', fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cuenta Promedio</span>
            <span style={{ fontSize: '24px' }}>🧾</span>
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#0f172a', fontFamily: 'var(--font-display)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={formatCurrency(data.kpis.cuentaPromedio)}>
            {formatCurrency(data.kpis.cuentaPromedio)}
          </div>
          <div style={{ fontSize: '0.85rem', color: '#8B5CF6', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            Por paciente asegurado
          </div>
        </div>

      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginBottom: '2rem' }}>
        
        {/* Top Aseguradoras por Pacientes */}
        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 10px 25px rgba(0,0,0,0.05)' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: '1.5rem', fontSize: '1.2rem' }}>Top 10 Aseguradoras (Por Volumen)</h3>
          <div style={{ height: 350 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.topAseguradoras} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.3} />
                <XAxis type="number" />
                <YAxis dataKey="nombre" type="category" width={150} tick={{fontSize: 10}} />
                <RechartsTooltip 
                  formatter={(value, name) => [name === 'totalFacturado' ? formatCurrency(value) : formatNumber(value), name === 'totalFacturado' ? 'Facturado' : 'Pacientes']}
                  cursor={{fill: '#f1f5f9'}} 
                />
                <Bar dataKey="count" fill="#10B981" radius={[0, 4, 4, 0]} onClick={(e) => setSelectedAseguradora(selectedAseguradora === e.bp ? null : e.bp)}>
                  {data.topAseguradoras.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={COLORS[index % COLORS.length]} 
                      style={{ cursor: 'pointer', opacity: selectedAseguradora && selectedAseguradora !== entry.bp ? 0.3 : 1 }}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Facturación por Aseguradora */}
        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 10px 25px rgba(0,0,0,0.05)' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: '1.5rem', fontSize: '1.2rem' }}>Top 10 Aseguradoras (Por Monto)</h3>
          <div style={{ height: 350 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[...data.topAseguradoras].sort((a,b) => b.totalFacturado - a.totalFacturado).slice(0, 5)}
                  cx="50%"
                  cy="50%"
                  nameKey="nombre"
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="totalFacturado"
                  onClick={(e) => setSelectedAseguradora(selectedAseguradora === e.bp ? null : e.bp)}
                >
                  {[...data.topAseguradoras].sort((a,b) => b.totalFacturado - a.totalFacturado).slice(0, 5).map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={COLORS[index % COLORS.length]} 
                      style={{ cursor: 'pointer', opacity: selectedAseguradora && selectedAseguradora !== entry.bp ? 0.3 : 1 }}
                    />
                  ))}
                </Pie>
                <RechartsTooltip formatter={(value) => [formatCurrency(value), 'Facturado']} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* Tabla Detallada de Pacientes */}
      <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 10px 25px rgba(0,0,0,0.05)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', margin: 0, fontSize: '1.2rem' }}>
            Listado de Cuentas Recientes {selectedAseguradora && <span style={{ color: '#3B82F6', fontSize: '1rem' }}>(Filtrado)</span>}
          </h3>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <select 
              value={selectedAseguradora || ''}
              onChange={(e) => setSelectedAseguradora(e.target.value || null)}
              style={{ padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid #CBD5E1', outline: 'none', fontFamily: 'var(--font-sans)', color: '#334155', minWidth: '200px' }}
            >
              <option value="">Todas las Aseguradoras</option>
              {data.topAseguradoras.map(a => (
                <option key={a.bp} value={a.bp}>{a.nombre} ({a.count})</option>
              ))}
            </select>
            {selectedAseguradora && (
              <button 
                onClick={() => setSelectedAseguradora(null)}
                style={{ background: '#F1F5F9', color: '#64748B', border: 'none', padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}
              >
                Borrar Filtro
              </button>
            )}
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#64748b', fontSize: '0.85rem', textTransform: 'uppercase' }}>
                <th style={{ padding: '1rem' }}>No. Cuenta</th>
                <th style={{ padding: '1rem' }}>Paciente</th>
                <th style={{ padding: '1rem' }}>Aseguradora</th>
                <th style={{ padding: '1rem' }}>Fecha</th>
                <th style={{ padding: '1rem' }}>Total</th>
                <th style={{ padding: '1rem' }}>Saldo Pendiente</th>
                <th style={{ padding: '1rem', textAlign: 'center' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {(selectedAseguradora ? data.listaPacientes.filter(p => p.BPCode === selectedAseguradora).slice(0, 500) : data.listaPacientes.slice(0, 100)).map((p, idx) => (
                <tr 
                  key={idx} 
                  style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.2s', cursor: 'pointer' }}
                  onClick={() => handleOpenModal(p.PCNum)}
                  title="Ver Estado de Cuenta"
                  onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ padding: '1rem', fontWeight: 600, color: '#0f172a' }}>{p.PCNum}</td>
                  <td style={{ padding: '1rem' }}>{p.Paciente || 'Desconocido'}</td>
                  <td style={{ padding: '1rem' }}>
                    <span style={{ 
                      background: '#DBEAFE', color: '#1E40AF', 
                      padding: '0.25rem 0.75rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 
                    }}>
                      {p.AseguradoraNombre}
                    </span>
                  </td>
                  <td style={{ padding: '1rem', color: '#64748b' }}>{formatDate(p.FechaApertura)}</td>
                  <td style={{ padding: '1rem', fontWeight: 600 }}>{formatCurrency(p.Total)}</td>
                  <td style={{ padding: '1rem', color: p.Balance > 0 ? '#EF4444' : '#10B981', fontWeight: 600 }}>
                    {formatCurrency(p.Balance)}
                  </td>
                  <td style={{ padding: '1rem', textAlign: 'center' }}>
                    <button 
                      onClick={(e) => { e.stopPropagation(); fetchAccountDetails(p.PCNum); }}
                      style={{ background: '#E0F2FE', color: '#0369A1', border: 'none', padding: '0.4rem 0.8rem', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.75rem' }}
                    >
                      📄 Ver Estado
                    </button>
                  </td>
                </tr>
              ))}
              {(selectedAseguradora ? data.listaPacientes.filter(p => p.BPCode === selectedAseguradora) : data.listaPacientes).length === 0 && (
                <tr>
                  <td colSpan="7" style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                    No hay registros en el periodo seleccionado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de Estado de Cuenta */}
      {selectedPCNum && (
        <EstadoCuentaModal 
          pcNum={selectedPCNum} 
          onClose={() => setSelectedPCNum(null)} 
        />
      )}
    </div>
  );
}
