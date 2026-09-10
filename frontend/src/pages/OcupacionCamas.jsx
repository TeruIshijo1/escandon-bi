import { useState, useEffect, useMemo } from 'react';
import { API_BASE } from '../api/config';
import PremiumLoader from '../components/shared/PremiumLoader';
import './OcupacionCamas.css';

export default function OcupacionCamas() {
  const [bedsData, setBedsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [filtro, setFiltro] = useState('todas'); // todas | libres | ocupadas

  const handleChipClick = (next) => {
    setFiltro((prev) => (prev === next ? 'todas' : next));
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => {
      fetchData();
    }, 30000); // 30 seconds
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const token = sessionStorage.getItem('escandon_token');
      const res = await fetch(`${API_BASE}/dashboard/censo-camas`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json();
      
      if (json.ok) {
        setBedsData(json.data);
        setLastUpdate(new Date());
      } else {
        setError(json.error || 'Error al cargar datos');
      }
    } catch (err) {
      setError('Error de conexión con el servidor.');
    } finally {
      setLoading(false);
    }
  };

  const categorizedBeds = useMemo(() => {
    if (!bedsData) return {};
    
    const groups = {
      'PPA (Planta Alta)': [],
      'PPB (Planta Baja)': [],
      'Urgencias 1': [],
      'Urgencias 2': [],
      'Terapia Intensiva': [],
      'Otras Áreas': [],
      'Camas Virtuales': []
    };

    bedsData.camas.forEach(cama => {
      const isOcupada = cama.Estado === 'OCUPADA';
      if (filtro === 'libres' && isOcupada) return;
      if (filtro === 'ocupadas' && !isOcupada) return;
      const name = (cama.RoomName || '').toUpperCase();
      let category = 'Otras Áreas';
      
      if (name.includes('VIRTUAL')) {
        category = 'Camas Virtuales';
      } else if (name.match(/CAMA\s*1\d{2}/)) {
        category = 'PPB (Planta Baja)';
      } else if (name.match(/CAMA\s*2\d{2}/)) {
        category = 'PPA (Planta Alta)';
      } else if (name.includes('URGENCIAS 1')) {
        category = 'Urgencias 1';
      } else if (name.includes('URGENCIAS 2')) {
        category = 'Urgencias 2';
      } else if (cama.RoomCode.includes('CUBUTI') || name.includes('TERAPIA INTENSIVA')) {
        category = 'Terapia Intensiva';
      }

      groups[category].push(cama);
    });

    // Remove empty groups
    Object.keys(groups).forEach(key => {
      if (groups[key].length === 0) delete groups[key];
    });

    return groups;
  }, [bedsData, filtro]);

  if (loading) {
    return <PremiumLoader text="Cargando Censo de Camas..." style={{ height: '300px' }} />;
  }

  if (error) {
    return <div style={{ padding: 20, color: '#EF4444', background: '#FEE2E2', borderRadius: 8 }}>{error}</div>;
  }

  const { resumen } = bedsData;
  const pctLibres = resumen.total > 0 ? Math.round((resumen.libres / resumen.total) * 100) : 0;
  const pctOcupadas = resumen.total > 0 ? Math.round((resumen.ocupadas / resumen.total) * 100) : 0;

  // Render order for categories
  const categoryOrder = [
    'PPB (Planta Baja)', 
    'PPA (Planta Alta)', 
    'Urgencias 1', 
    'Urgencias 2', 
    'Terapia Intensiva', 
    'Otras Áreas', 
    'Camas Virtuales'
  ];

  return (
    <div className="censo-page-container">
      
      <div className="censo-header">
        <div className="censo-hero">
          <div className="censo-live-badge">
            <span className="live-dot" />
            <span>Monitoreo en vivo</span>
          </div>
          <h1 className="censo-title">Ocupación <span className="title-accent">de Camas</span></h1>
          <div className="censo-meta">
            <span className="meta-pill meta-live">
              <svg className="spin-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
              Auto-refresh 30s
            </span>
            {lastUpdate && (
              <>
                <span className="meta-divider" />
                <span className="meta-pill meta-time">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
                  {lastUpdate.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </>
            )}
          </div>
        </div>
        
        <div className="censo-badges-group" role="group" aria-label="Filtrar camas por estado">
          <KpiChip 
            label="Total" 
            sublabel="camas registradas"
            value={resumen.total} 
            variant="total"
            filterKey="todas"
            active={filtro === 'todas'}
            onClick={() => handleChipClick('todas')}
            hint="Ver todas"
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9" />
              </svg>
            }
          />
          <KpiChip 
            label="Libres" 
            sublabel="disponibles · clic para filtrar"
            value={resumen.libres} 
            percentage={pctLibres}
            variant="libres"
            barValue={pctLibres}
            filterKey="libres"
            active={filtro === 'libres'}
            onClick={() => handleChipClick('libres')}
            hint="Ver libres"
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            }
          />
          <KpiChip 
            label="Ocupadas" 
            sublabel="en uso · clic para filtrar"
            value={resumen.ocupadas} 
            percentage={pctOcupadas}
            variant="ocupadas"
            barValue={pctOcupadas}
            filterKey="ocupadas"
            active={filtro === 'ocupadas'}
            onClick={() => handleChipClick('ocupadas')}
            hint="Ver ocupadas"
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            }
          />
        </div>

        {filtro !== 'todas' && (
          <div className={`censo-filter-bar filter-${filtro}`}>
            <span className="filter-text">
              Mostrando <strong>{Object.values(categorizedBeds).flat().length}</strong>{' '}
              {filtro === 'libres' ? 'camas libres' : 'camas ocupadas'}
            </span>
            <button type="button" className="filter-clear" onClick={() => setFiltro('todas')}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
              Ver todas
            </button>
          </div>
        )}

        <div className="censo-occupancy-bar">
          <div className="occ-labels">
            <span>Ocupación general</span>
            <strong>{pctOcupadas}%</strong>
          </div>
          <div className="occ-track">
            <div className="occ-fill" style={{ width: `${pctOcupadas}%` }} />
          </div>
          <div className="occ-legend">
            <span><i className="dot dot-free" /> {resumen.libres} libres</span>
            <span><i className="dot dot-busy" /> {resumen.ocupadas} ocupadas</span>
          </div>
        </div>
      </div>

      {categoryOrder.map(cat => {
        const beds = categorizedBeds[cat];
        if (!beds) return null;

        return (
          <div key={cat} className="censo-category-section">
            <h2 className="censo-category-title">
              {cat} <span className="cat-count">({beds.length})</span>
            </h2>
            <div className="censo-beds-grid">
              {beds.map(cama => (
                <BedCard key={cama.RoomCode} cama={cama} />
              ))}
            </div>
          </div>
        );
      })}

      {Object.keys(categorizedBeds).length === 0 && (
        <div className="censo-empty">
          <span className="empty-icon">{filtro === 'libres' ? '🎉' : '🛏️'}</span>
          <p>
            {filtro === 'libres'
              ? 'No hay camas libres en este momento.'
              : filtro === 'ocupadas'
                ? 'No hay camas ocupadas en este momento.'
                : 'No hay camas para mostrar.'}
          </p>
          {filtro !== 'todas' && (
            <button type="button" className="filter-clear" onClick={() => setFiltro('todas')}>
              Ver todas las camas
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function KpiChip({ label, sublabel, value, percentage, icon, variant, barValue, active, onClick, hint }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={hint || `Filtrar: ${label}`}
      className={`censo-kpi-chip chip-${variant}${active ? ' chip-active' : ''}`}
    >
      <span className="chip-glow" aria-hidden="true" />
      {active && (
        <span className="chip-check" aria-hidden="true">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
        </span>
      )}
      <div className="chip-icon-box">
        {icon}
      </div>
      <div className="chip-data">
        <span className="chip-label">{label}</span>
        <span className="chip-row">
          <span className="chip-value">{value}</span>
          {percentage !== undefined && (
            <span className="chip-percent">{percentage}%</span>
          )}
        </span>
        {sublabel && <span className="chip-sub">{sublabel}</span>}
      </div>
      {barValue !== undefined && (
        <span className="chip-track"><span className="chip-fill" style={{ width: `${barValue}%` }} /></span>
      )}
    </button>
  );
}

function BedCard({ cama }) {
  const isOcupada = cama.Estado === 'OCUPADA';
  return (
    <div className={`bed-card ${isOcupada ? 'card-ocupada' : 'card-libre'}`}>
      <div className="bed-header">
        <span className="bed-name">{cama.RoomName}</span>
        <span className={`bed-pill ${isOcupada ? 'pill-ocupada' : 'pill-libre'}`}>
          {cama.Estado}
        </span>
      </div>
      
      {isOcupada ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: 'auto' }}>
          <div className="bed-info-row">
            <span>👤</span>
            <span className="text-truncate" title={cama.Paciente}>{cama.Paciente}</span>
          </div>
          {cama.Medico && (
            <div className="bed-info-sub">
              <span>⚕️</span>
              <span className="text-truncate" title={cama.Medico}>{cama.Medico}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="bed-available-text">
          <span>✅</span> Disponible para ingreso
        </div>
      )}
    </div>
  );
}
