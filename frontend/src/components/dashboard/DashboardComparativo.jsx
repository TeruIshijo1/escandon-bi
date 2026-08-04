import React, { useState, useEffect } from 'react';
import { ComposedChart, Area, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { API_BASE } from '../../api/config';
import PremiumLoader from '../shared/PremiumLoader';

export default function DashboardComparativo() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchCombinedData() {
      try {
        const token = sessionStorage.getItem('escandon_token');
        const headers = { Authorization: `Bearer ${token}` };

        // Obtenemos SITI y Vertical
        const [sitiResRaw, cirrusResRaw] = await Promise.all([
          fetch(`${API_BASE}/siti/financiero`, { headers }),
          fetch(`${API_BASE}/dashboard/financiero-nativo`, { headers })
        ]);
        
        const sitiRes = await sitiResRaw.json();
        const cirrusRes = await cirrusResRaw.json();

        let combined = [];

        // Insertar SITI (Legado)
        if (sitiRes.success && sitiRes.tendenciaMensual) {
          const sitiData = sitiRes.tendenciaMensual.map(d => ({
            month: d.month,
            'SITI - Ingresos': d.Ingresos,
            'Vertical - Ingresos': 0
          }));
          combined = [...combined, ...sitiData];
        }

        // Insertar Vertical (Actual)
        if ((cirrusRes.ok || cirrusRes.success) && cirrusRes.data && cirrusRes.data.tendenciaMensual) {
          const cirrusData = cirrusRes.data.tendenciaMensual.map(d => ({
            month: d.month,
            'SITI - Ingresos': 0,
            'Vertical - Ingresos': d.Ingresos
          }));
          
          // Podría haber empalme (2026), los agrupamos si existen
          cirrusData.forEach(cd => {
            const existing = combined.find(c => c.month === cd.month);
            if (existing) {
              existing['Vertical - Ingresos'] = cd['Vertical - Ingresos'];
            } else {
              combined.push(cd);
            }
          });
        }

        // Ordenar cronológicamente
        combined.sort((a,b) => a.month.localeCompare(b.month));

        // Para evitar ceros feos que bajan a 0 la gráfica, ponemos null donde no hay operacion
        const cleaned = combined.map(d => ({
          ...d,
          'SITI - Ingresos': d['SITI - Ingresos'] === 0 ? null : d['SITI - Ingresos'],
          'Vertical - Ingresos': d['Vertical - Ingresos'] === 0 ? null : d['Vertical - Ingresos']
        }));

        setData(cleaned);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    fetchCombinedData();
  }, []);

  const formatMoney = (val) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(val);

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <PremiumLoader text="Sincronizando Eras de Datos..." />
    </div>
  );

  return (
    <div className="dashboard-container fade-in">
      <header className="dashboard-header" style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', color: '#111827' }}>
          Análisis Comparativo <span style={{ color: '#6B7280', fontSize: '1.2rem', fontWeight: 400 }}>SITI vs Vertical</span>
        </h1>
        <p style={{ color: '#6B7280', fontFamily: 'var(--font-body)' }}>Transición de ingresos y operación entre el sistema legado y la plataforma actual.</p>
      </header>

      <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 10px 25px rgba(0,0,0,0.05)', marginBottom: '2rem' }}>
        <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: '1.5rem', fontSize: '1.2rem' }}>Transición de Ingresos (Línea de Tiempo Completa)</h3>
        <div style={{ height: 450 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
              <XAxis dataKey="month" tick={{fontSize: 10}} tickMargin={10} minTickGap={30} />
              <YAxis tickFormatter={(val) => `$${(val/1000000).toFixed(1)}M`} tick={{fontSize: 10}} width={70} />
              <Tooltip formatter={(value) => formatMoney(value)} />
              <Legend />
              
              <Bar dataKey="SITI - Ingresos" name="SITI (Legado)" fill="#8B5CF6" barSize={20} radius={[4, 4, 0, 0]} opacity={0.8} />
              <Area type="monotone" dataKey="Vertical - Ingresos" name="Vertical (Actual)" stroke="#2563EB" strokeWidth={3} fill="#2563EB" fillOpacity={0.2} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      
      {/* Explicación de transición */}
      <div style={{ background: 'rgba(59, 130, 246, 0.05)', borderRadius: '12px', padding: '1.5rem', border: '1px solid rgba(59, 130, 246, 0.1)' }}>
        <h4 style={{ fontFamily: 'var(--font-display)', color: '#1E3A8A', marginBottom: '0.5rem' }}>Evolución del Hospital</h4>
        <p style={{ color: '#3B82F6', fontSize: '0.9rem', lineHeight: '1.5' }}>
          La gráfica superior demuestra la continuidad financiera del Hospital Escandón al migrar de la antigua arquitectura monolítica (SITI) hacia la plataforma integral moderna (Vertical/Cirrus) que culminó en el primer trimestre de 2026. Los datos históricos hasta marzo de 2026 provienen de SITI, mientras que a partir de abril de 2026 se integran exclusivamente de Vertical.
        </p>
      </div>

    </div>
  );
}
