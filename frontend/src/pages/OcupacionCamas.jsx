import { useState, useEffect, useMemo } from 'react';
import { API_BASE } from '../api/config';
import PremiumLoader from '../components/shared/PremiumLoader';

export default function OcupacionCamas() {
  const [bedsData, setBedsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);

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

    // Remove empty groups (except maybe we want them anyway? We'll remove empty to be clean)
    Object.keys(groups).forEach(key => {
      if (groups[key].length === 0) delete groups[key];
    });

    return groups;
  }, [bedsData]);

  if (loading) {
    return <PremiumLoader text="Cargando Censo de Camas..." style={{ height: '300px' }} />;
  }

  if (error) {
    return <div style={{ padding: 20, color: '#EF4444', background: '#FEE2E2', borderRadius: 8 }}>{error}</div>;
  }

  const { resumen } = bedsData;

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
    <div style={{ padding: 'max(1rem, 5vw)' }}>
      
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: 'clamp(1.25rem, 4vw, 1.75rem)', color: '#0D1B2A', margin: '0 0 0.5rem 0' }}>Ocupación de Camas</h1>
          <p style={{ color: '#64748B', margin: 0, fontSize: '0.9rem' }}>
            Fuente: V_MRPT & PC &nbsp;•&nbsp;
            <span style={{ color: '#166534', fontWeight: 600 }}>● Auto-refresh 30s</span>
            {lastUpdate && (
              <span style={{ marginLeft: 8, color: '#94A3B8' }}>
                · Actualizado: {lastUpdate.toLocaleTimeString('es-MX')}
              </span>
            )}
          </p>
        </div>
        
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          <Badge label="Total" value={resumen.total} bg="#E2E8F0" color="#334155" />
          <Badge label="Libres" value={resumen.libres} bg="#DCFCE7" color="#166534" />
          <Badge label="Ocupadas" value={resumen.ocupadas} bg="#FEE2E2" color="#991B1B" />
        </div>
      </div>

      {categoryOrder.map(cat => {
        const beds = categorizedBeds[cat];
        if (!beds) return null;

        return (
          <div key={cat} style={{ marginBottom: '2.5rem' }}>
            <h2 style={{ 
              fontSize: '1.25rem', color: '#0F172A', marginBottom: '1rem', 
              paddingBottom: '0.5rem', borderBottom: '2px solid #E2E8F0' 
            }}>
              {cat} ({beds.length})
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
              {beds.map(cama => (
                <BedCard key={cama.RoomCode} cama={cama} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Badge({ label, value, bg, color }) {
  return (
    <div style={{ background: bg, color: color, padding: '0.5rem 1rem', borderRadius: 24, fontWeight: 700, fontSize: '0.9rem', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
      {label}: {value}
    </div>
  );
}

function BedCard({ cama }) {
  const isOcupada = cama.Estado === 'OCUPADA';
  return (
    <div style={{ 
      background: 'white', 
      border: `1px solid ${isOcupada ? '#FECACA' : '#BBF7D0'}`, 
      borderTop: `5px solid ${isOcupada ? '#EF4444' : '#22C55E'}`,
      borderRadius: 10, 
      padding: '1.25rem', 
      boxShadow: '0 4px 6px rgba(0,0,0,0.02)',
      display: 'flex',
      flexDirection: 'column',
      minHeight: '130px'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <strong style={{ color: '#0F172A', fontSize: '1.05rem' }}>{cama.RoomName}</strong>
        <span style={{ 
          background: isOcupada ? '#FEE2E2' : '#DCFCE7', 
          color: isOcupada ? '#991B1B' : '#166534',
          fontSize: '0.75rem', fontWeight: 800, padding: '4px 8px', borderRadius: 6
        }}>
          {cama.Estado}
        </span>
      </div>
      
      {isOcupada ? (
        <div style={{ marginTop: 'auto', fontSize: '0.9rem' }}>
          <div style={{ color: '#334155', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>👤</span> <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cama.Paciente}</span>
          </div>
          {cama.Medico && (
            <div style={{ color: '#64748B', marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
              <span>⚕️</span> <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cama.Medico}</span>
            </div>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 'auto', color: '#166534', fontSize: '0.9rem', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>✅</span> Disponible para ingreso
        </div>
      )}
    </div>
  );
}
