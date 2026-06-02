/**
 * DashboardMando.jsx — Panel de Mando Ejecutivo
 * Hospital Escandón BI Platform v4.0
 * Rediseño premium con identidad de marca y micro-interacciones
 */
import { useState, useEffect } from 'react';
import EmbeddedBI from '../components/dashboard/EmbeddedBI';
import ExportButton from '../components/shared/ExportButton';
import EditableKPIWrapper from '../components/shared/EditableKPIWrapper';
import PBIModal from '../components/shared/PBIModal';
import { useAuth } from '../context/AuthContext';
import { API_BASE } from '../api/config';

export default function DashboardMando() {
  const { user } = useAuth();
  const [pbiModal, setPBIModal] = useState(null);
  const [mandoStats, setMandoStats] = useState(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const token = sessionStorage.getItem('escandon_token');
        const res = await fetch(`${API_BASE}/dashboard/directivo`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const json = await res.json();
        if (json.ok && json.data.mando) {
          setMandoStats(json.data.mando);
        }
      } catch (err) {
        console.error('Error fetching mando stats:', err);
      }
    };
    fetchStats();
  }, []);

  const kpis = [
    { label:'EFICIENCIA GLOBAL',   value: mandoStats?.eficiencia != null ? `${mandoStats.eficiencia}%` : null, color:'var(--color-azul-claro)', icon:'⚙️' },
    { label:'EFICACIA CLÍNICA',    value: mandoStats?.eficacia != null ? `${mandoStats.eficacia}%` : null, color:'var(--color-verde-e)', icon:'🎯' },
    { label:'SATISFACCIÓN',        value: mandoStats?.satisfaccion != null ? `${mandoStats.satisfaccion}%` : null, color:'var(--color-verde-e)', icon:'⭐' },
    { label:'PRESUPUESTO EJEC.',   value: mandoStats?.presupuesto != null ? `${mandoStats.presupuesto}%` : null, color:'var(--color-warning)', icon:'💼' },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <style>{`
        @keyframes pulse-green {
          0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(0, 184, 163, 0.5); }
          70% { transform: scale(1); box-shadow: 0 0 0 5px rgba(0, 184, 163, 0); }
          100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(0, 184, 163, 0); }
        }
        .mando-kpi-card:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-md) !important;
        }
      `}</style>

      {pbiModal && (
        <PBIModal url={pbiModal.url} title={pbiModal.title} onClose={() => setPBIModal(null)} />
      )}

      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, var(--color-azul-fuerte) 0%, #083b66 100%)',
        borderRadius: 20, padding: '1.75rem 2.25rem', marginBottom: '2rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        boxShadow: 'var(--shadow-md)',
        position: 'relative',
        overflow: 'hidden',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        {/* ECG background pattern */}
        <div style={{
          position: 'absolute',
          inset: 0,
          opacity: 0.04,
          pointerEvents: 'none',
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 120' width='800' height='120'%3E%3Cpath d='M0 60h120l10-15 15 10 10-25 15 80 10-65 15 15h120l10-15 15 10 10-25 15 80 10-65 15 15h200' fill='none' stroke='%23ffffff' stroke-width='2'/%3E%3C/svg%3E")`,
          backgroundSize: '450px 60px',
          backgroundPosition: 'left center',
        }}/>

        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: 'var(--color-verde-e)',
              display: 'inline-block',
              animation: 'pulse-green 2s infinite',
            }}/>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.64rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.65)' }}>
              Dirección General · Datos en Vivo
            </div>
          </div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: '1.65rem', fontWeight: 800, color: 'white', margin: 0, letterSpacing: '-0.01em' }}>
            Panel de Mando Ejecutivo
          </h1>
          <p style={{ fontFamily: 'var(--font-body)', color: 'rgba(255,255,255,0.72)', fontSize: '0.85rem', margin: '0.4rem 0 0', fontWeight: 500 }}>
            Vista ejecutiva consolidada de todos los servicios hospitalarios
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', position: 'relative', zIndex: 1 }}>
          <ExportButton type="pdf" reportId="directivo-main" compact />
          <ExportButton type="excel" reportId="directivo-main" compact />
        </div>
      </div>

      {/* KPIs de alto nivel */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {kpis.map(k => (
          <EditableKPIWrapper
            key={k.label}
            elementoId={`mando.${k.label.replace(/\s+/g, '_').toLowerCase()}`}
            isAdmin={user?.role === 'ADMIN'}
            onKPIClick={(url, title) => setPBIModal({ url, title })}
            accentColor={k.color}
            style={{ height: '100%' }}
          >
            <div
              className="mando-kpi-card"
              style={{
                background: '#FFFFFF', borderRadius: '14px', padding: '1.1rem 1.25rem',
                border: '1px solid rgba(0,70,135,0.05)',
                borderLeft: `4px solid ${k.color}`,
                boxShadow: 'var(--shadow-xs)',
                position: 'relative', overflow: 'hidden', height: '100%', boxSizing: 'border-box',
                display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: k.value == null || k.value === '' ? '90px' : 'auto',
                transition: 'all var(--transition-base)',
              }}
            >
              <div style={{ position: 'absolute', right: 12, top: 12, fontSize: '1.75rem', opacity: 0.12, pointerEvents: 'none' }}>{k.icon}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.64rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: k.value != null && k.value !== '' ? '0.35rem' : 0 }}>{k.label}</div>
              {k.value != null && k.value !== '' && (
                <div style={{ fontFamily: "var(--font-mono)", fontSize: '1.65rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em', lineHeight: 1 }}>{k.value}</div>
              )}
            </div>
          </EditableKPIWrapper>
        ))}
      </div>

      {/* Tablero BI embebido */}
      <EmbeddedBI reportId="directivo-main" height="calc(100vh - 140px)" />
    </div>
  );
}
