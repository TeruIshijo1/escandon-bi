import React from 'react';

export default function GlobalFilterBar({ filters, setFilters, onApply }) {
  const handleInputChange = (e) => {
    setFilters({ ...filters, [e.target.name]: e.target.value });
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      onApply();
    }
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
      gap: '1rem',
      alignItems: 'flex-end',
      flexWrap: 'wrap'
    }}>
      
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
            setFilters({ search: '', startDate: '', endDate: '' });
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
  );
}
