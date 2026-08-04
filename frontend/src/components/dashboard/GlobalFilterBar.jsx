import React, { useState, useEffect } from 'react';
import { API_BASE } from '../../api/config';

export default function GlobalFilterBar({ filters, setFilters, onApply, showSearch = true, activeTab = '' }) {
  const [options, setOptions] = useState({ medicos: [], especialidades: [] });

  useEffect(() => {
    if (activeTab === 'eficacia') {
      const fetchOptions = async () => {
        try {
          const token = sessionStorage.getItem('escandon_token');
          const res = await fetch(`${API_BASE}/dashboard/filtros-eficacia`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          const json = await res.json();
          if (json.ok) {
            setOptions(json.data);
          }
        } catch (err) {
          console.error('Error fetching options', err);
        }
      };
      fetchOptions();
    }
  }, [activeTab]);

  const handleInputChange = (e) => {
    const { name, value, type } = e.target;
    setFilters(prev => ({ ...prev, [name]: value }));
    
    // Auto-aplicar si es un cambio de fecha
    if (type === 'date') {
      setTimeout(onApply, 50);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      onApply();
    }
  };

  const setQuickDate = (type) => {
    const today = new Date();
    let start = '';
    let end = '';

    const formatDate = (d) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    if (type === 'hoy') {
      start = formatDate(today);
      end = formatDate(today);
    } else if (type === 'semana') {
      // Lunes a Domingo
      const d = new Date();
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const startD = new Date(d.setDate(diff));
      start = formatDate(startD);
      const endD = new Date(startD);
      endD.setDate(startD.getDate() + 6);
      end = formatDate(endD);
    } else if (type === 'mes') {
      const startD = new Date(today.getFullYear(), today.getMonth(), 1);
      const endD = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      start = formatDate(startD);
      end = formatDate(endD);
    } else if (type === 'mes_pasado') {
      const startD = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const endD = new Date(today.getFullYear(), today.getMonth(), 0);
      start = formatDate(startD);
      end = formatDate(endD);
    } else if (type === 'anio') {
      const startD = new Date(today.getFullYear(), 0, 1);
      start = formatDate(startD);
      end = formatDate(new Date()); // Hasta hoy
    }

    setFilters({ ...filters, startDate: start, endDate: end });
    setTimeout(onApply, 50);
  };

  return (
    <div style={{
      background: 'white',
      borderRadius: 12,
      padding: '1rem 1.5rem',
      marginBottom: '1.5rem',
      boxShadow: '0 2px 10px rgba(0,0,0,0.03)',
      border: '1px solid rgba(0,70,135,0.1)',
      display: 'flex',
      flexDirection: 'column',
      gap: '1rem'
    }}>
      
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
      
      {showSearch && (
        <div style={{ flex: '1 1 200px' }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748B', marginBottom: '0.3rem', textTransform: 'uppercase' }}>
            Buscar (Paciente o Médico)
          </label>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: 10, color: '#94A3B8' }}>🔍</span>
            <input
              type="text"
              name="search"
              value={filters.search}
              onChange={handleInputChange}
              onKeyPress={handleKeyPress}
              placeholder="Ej: Juan Perez, Neonatología..."
              style={{
                width: '100%',
                padding: '0.6rem 1rem 0.6rem 2.2rem',
                borderRadius: 6,
                border: '1px solid #CBD5E1',
                fontSize: '0.9rem',
                color: '#0D1B2A',
                outline: 'none',
                transition: 'border-color 0.2s'
              }}
              onFocus={e => e.target.style.borderColor = '#0088C9'}
              onBlur={e => e.target.style.borderColor = '#CBD5E1'}
            />
          </div>
        </div>
      )}

      {activeTab === 'eficacia' && (
        <>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748B', marginBottom: '0.3rem', textTransform: 'uppercase' }}>
              Médico
            </label>
            <input
              list="medicos-list"
              name="medico"
              value={filters.medico || ''}
              onChange={handleInputChange}
              placeholder="Seleccionar o buscar..."
              style={{ width: '100%', padding: '0.6rem', borderRadius: 6, border: '1px solid #CBD5E1', outline: 'none', fontSize: '0.9rem', color: '#0D1B2A' }}
            />
            <datalist id="medicos-list">
              {options.medicos?.map((m, i) => <option key={i} value={m} />)}
            </datalist>
          </div>

          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748B', marginBottom: '0.3rem', textTransform: 'uppercase' }}>
              Especialidad
            </label>
            <input
              list="esp-list"
              name="especialidad"
              value={filters.especialidad || ''}
              onChange={handleInputChange}
              placeholder="Seleccionar o buscar..."
              style={{ width: '100%', padding: '0.6rem', borderRadius: 6, border: '1px solid #CBD5E1', outline: 'none', fontSize: '0.9rem', color: '#0D1B2A' }}
            />
            <datalist id="esp-list">
              {options.especialidades?.map((e, i) => <option key={i} value={e} />)}
            </datalist>
          </div>
        </>
      )}

      <div style={{ flex: '1 1 150px' }}>
        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748B', marginBottom: '0.3rem', textTransform: 'uppercase' }}>
          Fecha Inicio
        </label>
        <input
          type="date"
          name="startDate"
          value={filters.startDate}
          onChange={handleInputChange}
          style={{
            width: '100%',
            padding: '0.6rem',
            borderRadius: 6,
            border: '1px solid #CBD5E1',
            fontSize: '0.9rem',
            color: '#0D1B2A',
            outline: 'none',
            fontFamily: 'inherit'
          }}
        />
      </div>

      <div style={{ flex: '1 1 150px' }}>
        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748B', marginBottom: '0.3rem', textTransform: 'uppercase' }}>
          Fecha Fin
        </label>
        <input
          type="date"
          name="endDate"
          value={filters.endDate}
          onChange={handleInputChange}
          style={{
            width: '100%',
            padding: '0.6rem',
            borderRadius: 6,
            border: '1px solid #CBD5E1',
            fontSize: '0.9rem',
            color: '#0D1B2A',
            outline: 'none',
            fontFamily: 'inherit'
          }}
        />
      </div>

      <div style={{ flex: '0 0 auto' }}>
        <button
          onClick={onApply}
          style={{
            background: '#005FA9',
            color: 'white',
            border: 'none',
            padding: '0.65rem 1.5rem',
            borderRadius: 6,
            fontSize: '0.9rem',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'background 0.2s',
            height: '42px'
          }}
          onMouseOver={e => e.target.style.background = '#004687'}
          onMouseOut={e => e.target.style.background = '#005FA9'}
        >
          Aplicar Filtros
        </button>
      </div>

      <div style={{ flex: '0 0 auto' }}>
        <button
          onClick={() => {
            setFilters({ search: '', startDate: '', endDate: '', medico: '', especialidad: '' });
            setTimeout(onApply, 50); // Small delay to let state update
          }}
          style={{
            background: 'transparent',
            color: '#64748B',
            border: '1px solid #CBD5E1',
            padding: '0.65rem 1rem',
            borderRadius: 6,
            fontSize: '0.9rem',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s',
            height: '42px'
          }}
          onMouseOver={e => { e.target.style.background = '#F1F5F9'; e.target.style.color = '#0D1B2A'; }}
          onMouseOut={e => { e.target.style.background = 'transparent'; e.target.style.color = '#64748B'; }}
        >
          Limpiar
        </button>
      </div>

    </div>
      
      {/* Botones de fechas rápidas */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', paddingTop: '0.5rem', borderTop: '1px solid #E2E8F0' }}>
        <span style={{ fontSize: '0.8rem', color: '#64748B', fontWeight: 600, display: 'flex', alignItems: 'center', marginRight: '0.5rem' }}>
          Rápido:
        </span>
        <button onClick={() => setQuickDate('hoy')} style={quickBtnStyle}>Hoy</button>
        <button onClick={() => setQuickDate('semana')} style={quickBtnStyle}>Esta Semana</button>
        <button onClick={() => setQuickDate('mes')} style={quickBtnStyle}>Este Mes</button>
        <button onClick={() => setQuickDate('mes_pasado')} style={quickBtnStyle}>Mes Pasado</button>
        <button onClick={() => setQuickDate('anio')} style={quickBtnStyle}>Este Año</button>
      </div>

    </div>
  );
}

const quickBtnStyle = {
  background: '#F1F5F9',
  color: '#0D1B2A',
  border: '1px solid #CBD5E1',
  padding: '0.4rem 0.8rem',
  borderRadius: 20,
  fontSize: '0.75rem',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 0.2s'
};
