import React, { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts';
import { API_BASE } from '../../api/config';
import PremiumLoader from '../shared/PremiumLoader';
import DashboardSitiCirugias from './DashboardSitiCirugias';
import DashboardSitiAuxiliares from './DashboardSitiAuxiliares';
import DashboardSitiPacientes from './DashboardSitiPacientes';
import DashboardSitiMedicos from './DashboardSitiMedicos';
import DashboardSitiMapa from './DashboardSitiMapa';
import ExportToolbar from '../shared/ExportToolbar';

export default function DashboardSiti() {
  const [activeTab, setActiveTab] = useState('general');
  const [data, setData] = useState([]);
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const token = sessionStorage.getItem('escandon_token');
        const headers = { Authorization: `Bearer ${token}` };

        const [finResRaw, pacResRaw] = await Promise.all([
          fetch(`${API_BASE}/siti/financiero`, { headers }),
          fetch(`${API_BASE}/siti/pacientes`, { headers })
        ]);
        
        const finData = await finResRaw.json();
        const pacData = await pacResRaw.json();

        if (finData.success) {
          setData(finData.tendenciaMensual);
        }
        if (pacData.success) {
          setPatients(pacData.tendenciaPacientes);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const totalIngresos = data.reduce((acc, curr) => acc + curr.Ingresos, 0);
  const totalCostos = data.reduce((acc, curr) => acc + curr.Costos, 0);
  const totalUtilidad = data.reduce((acc, curr) => acc + curr.Utilidad, 0);
  const totalPacientes = patients.reduce((acc, curr) => acc + curr.total, 0);

  const formatMoney = (val) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(val);

  const aggregatedAnualFinanzas = React.useMemo(() => {
    const acc = {};
    data.forEach(row => {
      if (!row.month) return;
      const yr = String(row.month).substring(0, 4);
      if (!acc[yr]) acc[yr] = { Yr: yr, Ingresos: 0, Costos: 0, Utilidad: 0, VolumenCuentas: 0 };
      acc[yr].Ingresos += row.Ingresos;
      acc[yr].Costos += row.Costos;
      acc[yr].Utilidad += row.Utilidad;
      acc[yr].VolumenCuentas += row.VolumenCuentas;
    });
    return Object.values(acc).sort((a, b) => a.Yr.localeCompare(b.Yr));
  }, [data]);

  const aggregatedAnualPacientes = React.useMemo(() => {
    const acc = {};
    patients.forEach(row => {
      if (!row.month) return;
      const yr = String(row.month).substring(0, 4);
      if (!acc[yr]) acc[yr] = { Yr: yr, hombres: 0, mujeres: 0, total: 0 };
      acc[yr].hombres += row.hombres;
      acc[yr].mujeres += row.mujeres;
      acc[yr].total += row.total;
    });
    return Object.values(acc).sort((a, b) => a.Yr.localeCompare(b.Yr));
  }, [patients]);

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <PremiumLoader text="Cargando Históricos SITI..." />
    </div>
  );

  return (
    <div className="dashboard-container fade-in">
      <header className="dashboard-header" style={{ marginBottom: '2rem' }}>
        <h1 className="text-4xl font-bold" style={{ color: '#09152b' }}>
          Legado SITI <span className="text-xl font-normal text-slate-500">(2010 - 2025)</span>
        </h1>
        <p style={{ color: '#6B7280', fontFamily: 'var(--font-body)' }}>Archivo histórico de desempeño extraído de las bases de datos originales.</p>
      </header>

      {/* Tabs */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '2rem', borderBottom: '1px solid #E5E7EB', paddingBottom: '1rem' }}>
        <button
          onClick={() => setActiveTab('general')}
          style={{
            padding: '0.75rem 1.5rem',
            borderRadius: '8px',
            fontWeight: 600,
            transition: 'all 0.2s',
            background: activeTab === 'general' ? '#2563EB' : 'transparent',
            color: activeTab === 'general' ? '#fff' : '#4B5563',
            border: 'none',
            cursor: 'pointer',
            whiteSpace: 'nowrap'
          }}
        >
          General (Finanzas)
        </button>
        <button
          onClick={() => setActiveTab('quirofanos')}
          style={{
            padding: '0.75rem 1.5rem',
            borderRadius: '8px',
            fontWeight: 600,
            transition: 'all 0.2s',
            background: activeTab === 'quirofanos' ? '#2563EB' : 'transparent',
            color: activeTab === 'quirofanos' ? '#fff' : '#4B5563',
            border: 'none',
            cursor: 'pointer',
            whiteSpace: 'nowrap'
          }}
        >
          Quirófanos
        </button>
        <button
          onClick={() => setActiveTab('laboratorio')}
          style={{
            padding: '0.75rem 1.5rem',
            borderRadius: '8px',
            fontWeight: 600,
            transition: 'all 0.2s',
            background: activeTab === 'laboratorio' ? '#2563EB' : 'transparent',
            color: activeTab === 'laboratorio' ? '#fff' : '#4B5563',
            border: 'none',
            cursor: 'pointer',
            whiteSpace: 'nowrap'
          }}
        >
          Laboratorio
        </button>
        <button
          onClick={() => setActiveTab('imagenologia')}
          style={{
            padding: '0.75rem 1.5rem',
            borderRadius: '8px',
            fontWeight: 600,
            transition: 'all 0.2s',
            background: activeTab === 'imagenologia' ? '#2563EB' : 'transparent',
            color: activeTab === 'imagenologia' ? '#fff' : '#4B5563',
            border: 'none',
            cursor: 'pointer',
            whiteSpace: 'nowrap'
          }}
        >
          Imagenología
        </button>
        <button
          onClick={() => setActiveTab('farmacia')}
          style={{
            padding: '0.75rem 1.5rem',
            borderRadius: '8px',
            fontWeight: 600,
            transition: 'all 0.2s',
            background: activeTab === 'farmacia' ? '#2563EB' : 'transparent',
            color: activeTab === 'farmacia' ? '#fff' : '#4B5563',
            border: 'none',
            cursor: 'pointer',
            whiteSpace: 'nowrap'
          }}
        >
          Farmacia
        </button>
        <button
          onClick={() => setActiveTab('urgencias')}
          style={{
            padding: '0.75rem 1.5rem',
            borderRadius: '8px',
            fontWeight: 600,
            transition: 'all 0.2s',
            background: activeTab === 'urgencias' ? '#2563EB' : 'transparent',
            color: activeTab === 'urgencias' ? '#fff' : '#4B5563',
            border: 'none',
            cursor: 'pointer',
            whiteSpace: 'nowrap'
          }}
        >
          Consultas/Urgencias
        </button>
        <button
          onClick={() => setActiveTab('hospitalizacion')}
          style={{
            padding: '0.75rem 1.5rem',
            borderRadius: '8px',
            fontWeight: 600,
            transition: 'all 0.2s',
            background: activeTab === 'hospitalizacion' ? '#2563EB' : 'transparent',
            color: activeTab === 'hospitalizacion' ? '#fff' : '#4B5563',
            border: 'none',
            cursor: 'pointer',
            whiteSpace: 'nowrap'
          }}
        >
          Pisos/Hospitalización
        </button>
        <button
          onClick={() => setActiveTab('terapia')}
          style={{
            padding: '0.75rem 1.5rem',
            borderRadius: '8px',
            fontWeight: 600,
            transition: 'all 0.2s',
            background: activeTab === 'terapia' ? '#2563EB' : 'transparent',
            color: activeTab === 'terapia' ? '#fff' : '#4B5563',
            border: 'none',
            cursor: 'pointer',
            whiteSpace: 'nowrap'
          }}
        >
          Terapia Intensiva
        </button>
        <button
          onClick={() => setActiveTab('pacientes')}
          style={{
            padding: '0.75rem 1.5rem',
            borderRadius: '8px',
            fontWeight: 600,
            transition: 'all 0.2s',
            background: activeTab === 'pacientes' ? '#2563EB' : 'transparent',
            color: activeTab === 'pacientes' ? '#fff' : '#4B5563',
            border: 'none',
            cursor: 'pointer',
            whiteSpace: 'nowrap'
          }}
        >
          👥 Demografía Pacientes
        </button>
        <button
          onClick={() => setActiveTab('medicos')}
          style={{
            padding: '0.75rem 1.5rem',
            borderRadius: '8px',
            fontWeight: 600,
            transition: 'all 0.2s',
            background: activeTab === 'medicos' ? '#2563EB' : 'transparent',
            color: activeTab === 'medicos' ? '#fff' : '#4B5563',
            border: 'none',
            cursor: 'pointer',
            whiteSpace: 'nowrap'
          }}
        >
          👨‍⚕️ Productividad Médica
        </button>
        <button
          onClick={() => setActiveTab('mapa')}
          style={{
            padding: '0.75rem 1.5rem',
            borderRadius: '8px',
            fontWeight: 600,
            transition: 'all 0.2s',
            background: activeTab === 'mapa' ? '#2563EB' : 'transparent',
            color: activeTab === 'mapa' ? '#fff' : '#4B5563',
            border: 'none',
            cursor: 'pointer',
            whiteSpace: 'nowrap'
          }}
        >
          📍 Mapa Geográfico
        </button>
      </div>

      {activeTab === 'general' ? (
        <div id="dashboard-general-siti">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <ExportToolbar 
              targetId="dashboard-general-siti" 
              fileNamePrefix="SITI_General" 
              excelData={{
                'Tendencia Mensual': data,
                'Pacientes': patients
              }}
            />
          </div>
          {/* KPIs Rápidos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        
        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 10px 25px rgba(0,0,0,0.05)', borderLeft: '5px solid #2563EB' }}>
          <h3 style={{ fontSize: '0.8rem', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ingresos Históricos</h3>
          <p style={{ fontSize: '1.8rem', fontWeight: 700, color: '#111827', marginTop: '0.5rem' }}>{formatMoney(totalIngresos)}</p>
        </div>

        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 10px 25px rgba(0,0,0,0.05)', borderLeft: '5px solid #10B981' }}>
          <h3 style={{ fontSize: '0.8rem', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Utilidad Operativa (Real)</h3>
          <p style={{ fontSize: '1.8rem', fontWeight: 700, color: '#111827', marginTop: '0.5rem' }}>{formatMoney(totalUtilidad)}</p>
          <p style={{ fontSize: '0.85rem', color: '#10B981', marginTop: '0.2rem' }}>
            {((totalUtilidad / totalIngresos) * 100).toFixed(1)}% Margen Promedio
          </p>
        </div>

        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 10px 25px rgba(0,0,0,0.05)', borderLeft: '5px solid #8B5CF6' }}>
          <h3 style={{ fontSize: '0.8rem', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pacientes Atendidos</h3>
          <p style={{ fontSize: '1.8rem', fontWeight: 700, color: '#111827', marginTop: '0.5rem' }}>{new Intl.NumberFormat().format(totalPacientes)}</p>
        </div>

      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
        {/* Gráfica Financiera SITI */}
        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 10px 25px rgba(0,0,0,0.05)' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: '1.5rem', fontSize: '1.2rem' }}>Crecimiento Financiero (SITI)</h3>
          <div style={{ height: 350 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={aggregatedAnualFinanzas}>
                <defs>
                  <linearGradient id="colorIngresos" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563EB" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#2563EB" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorUtilidad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                <XAxis dataKey="Yr" tick={{fontSize: 10}} tickMargin={10} minTickGap={30} />
                <YAxis tickFormatter={(val) => `$${(val/1000000).toFixed(1)}M`} tick={{fontSize: 10}} width={70} />
                <Tooltip formatter={(value) => formatMoney(value)} />
                <Legend />
                <Area type="monotone" dataKey="Ingresos" stroke="#2563EB" strokeWidth={3} fillOpacity={1} fill="url(#colorIngresos)" />
                <Area type="monotone" dataKey="Utilidad" stroke="#10B981" strokeWidth={3} fillOpacity={1} fill="url(#colorUtilidad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Gráfica de Pacientes SITI */}
        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 10px 25px rgba(0,0,0,0.05)' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: '1.5rem', fontSize: '1.2rem' }}>Volumen de Pacientes por Género</h3>
          <div style={{ height: 350 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={aggregatedAnualPacientes}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                <XAxis dataKey="Yr" tick={{fontSize: 10}} tickMargin={10} minTickGap={30} />
                <YAxis tick={{fontSize: 10}} />
                <Tooltip />
                <Legend />
                <Bar dataKey="mujeres" name="Mujeres" stackId="a" fill="#EC4899" radius={[0, 0, 4, 4]} />
                <Bar dataKey="hombres" name="Hombres" stackId="a" fill="#3B82F6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
        </div>
      ) : activeTab === 'quirofanos' ? (
        <DashboardSitiCirugias />
      ) : activeTab === 'pacientes' ? (
        <DashboardSitiPacientes />
      ) : activeTab === 'medicos' ? (
        <DashboardSitiMedicos />
      ) : activeTab === 'mapa' ? (
        <DashboardSitiMapa />
      ) : (
        <DashboardSitiAuxiliares type={activeTab} />
      )}

    </div>
  );
}
