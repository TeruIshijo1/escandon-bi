import React, { useState, useEffect } from 'react';
import cexService from '../services/cex.service';
import PremiumLoader from '../components/shared/PremiumLoader';
import ExportButton from '../components/shared/ExportButton';

export default function ConsultaExternaPage() {
  const [citas, setCitas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedEspecialidad, setSelectedEspecialidad] = useState('');
  
  const todayStr = () => new Date().toISOString().split('T')[0];
  
  const [fechaDesde, setFechaDesde] = useState(todayStr());
  const [fechaHasta, setFechaHasta] = useState(todayStr());
  
  // Modals state
  const [openNotas, setOpenNotas] = useState(false);
  const [selectedCita, setSelectedCita] = useState(null);
  const [toast, setToast] = useState('');
  
  // Form state
  const [notasData, setNotasData] = useState({
    Notas: '', Diagnostico: ''
  });
  const [filterEstado, setFilterEstado] = useState(null);

  useEffect(() => {
    fetchAgenda();
  }, [fechaDesde, fechaHasta]);

  const fetchAgenda = async () => {
    setLoading(true);
    try {
      const data = await cexService.getAgenda({ start: fechaDesde, end: fechaHasta });
      setCitas(data.data || []);
    } catch (error) {
      console.error("Error fetching agenda:", error);
    } finally {
      setLoading(false);
    }
  };

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const handleSync = async () => {
    setLoading(true);
    try {
      await cexService.syncAgenda();
      await fetchAgenda();
      showToast("Agenda sincronizada con VERTICAL");
    } catch (error) {
      console.error("Error syncing agenda:", error);
      setLoading(false);
    }
  };

  const handleCambiarEstado = async (id, estado) => {
    try {
      await cexService.updateCitaEstado(id, estado);
      fetchAgenda();
      showToast(`Cita marcada como ${estado}`);
    } catch (error) {
      console.error("Error updating status:", error);
    }
  };

  const handleGuardarNotas = async () => {
    try {
      await cexService.updateNotas(selectedCita.citaid, notasData);
      setOpenNotas(false);
      fetchAgenda();
      showToast("Notas actualizadas exitosamente");
    } catch (error) {
      console.error("Error updating notes:", error);
    }
  };

  const filteredCitas = citas.filter(c => {
    const matchesSearch = 
      c.nombrepaciente?.toLowerCase().includes(search.toLowerCase()) || 
      c.medico?.toLowerCase().includes(search.toLowerCase()) ||
      c.noexpediente?.toLowerCase().includes(search.toLowerCase());
      
    const matchesEspecialidad = selectedEspecialidad === '' || c.especialidad === selectedEspecialidad;
    
    return matchesSearch && matchesEspecialidad;
  });

  const especialidades = [...new Set(citas.map(c => c.especialidad))].filter(Boolean).sort();

  const isPagada = (c) => {
    const text = ((c.notas || '') + ' ' + (c.diagnostico || '') + ' ' + (c.estado || '')).toLowerCase();
    return text.includes('confirmad') || text.includes('pago procesado');
  };

  const stats = {
    total: filteredCitas.length,
    asistencias: filteredCitas.filter(c => c.estado === 'ASISTIDA').length,
    pagadas: filteredCitas.filter(isPagada).length,
    noAsistio: filteredCitas.filter(c => c.estado === 'NO_ASISTIO').length,
    tasaAsistencia: filteredCitas.length > 0
      ? Math.round((filteredCitas.filter(c => c.estado === 'ASISTIDA').length / filteredCitas.length) * 100)
      : 0,
  };

  const displayCitas = filterEstado === 'PAGADA' 
    ? filteredCitas.filter(isPagada)
    : filterEstado 
      ? filteredCitas.filter(c => c.estado === filterEstado) 
      : filteredCitas;

  if (loading && citas.length === 0) return <PremiumLoader text="Cargando Agenda..." />;

  return (
    <div style={{ maxWidth:'var(--content-max, 1200px)', width:'100%', margin:'0 auto' }}>
      <style>{`
        .search-input-field:focus,
        .edit-form-input:focus {
          border-color: var(--color-azul-claro) !important;
          box-shadow: 0 0 0 4px rgba(0, 136, 201, 0.12) !important;
          background: #FFFFFF !important;
        }
        .users-table tr:nth-child(even) {
          background-color: #FAFBFD;
        }
        .users-table tr:hover {
          background-color: rgba(0, 70, 135, 0.02) !important;
        }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, var(--color-azul-fuerte) 0%, #083b66 100%)',
        borderRadius: 20, padding: '1.75rem 2.25rem', marginBottom: '2rem',
        boxShadow: 'var(--shadow-md)',
        position: 'relative',
        overflow: 'hidden',
        display:'flex',
        alignItems:'center',
        justifyContent:'space-between',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        {/* ECG Pattern */}
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
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: '1.65rem', fontWeight: 800, color: 'white', margin: 0, letterSpacing: '-0.01em' }}>Agenda de Consulta Externa</h1>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', position: 'relative', zIndex: 1, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', background: 'rgba(255,255,255,0.1)', padding: '0.4rem 0.8rem', borderRadius: 10, backdropFilter: 'var(--glass-blur)', border: '1px solid rgba(255,255,255,0.2)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              <label style={{ fontSize: '0.65rem', fontWeight: 700, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase' }}>Desde</label>
              <input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)} style={{ padding: '0.3rem', borderRadius: '6px', border: 'none', fontSize: '0.75rem', outline: 'none', background: 'rgba(255,255,255,0.9)', color: 'var(--color-azul-fuerte)', fontFamily: 'var(--font-mono)' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              <label style={{ fontSize: '0.65rem', fontWeight: 700, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase' }}>Hasta</label>
              <input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)} style={{ padding: '0.3rem', borderRadius: '6px', border: 'none', fontSize: '0.75rem', outline: 'none', background: 'rgba(255,255,255,0.9)', color: 'var(--color-azul-fuerte)', fontFamily: 'var(--font-mono)' }} />
            </div>
          </div>
          <button 
            onClick={handleSync} 
            disabled={loading}
            style={{
              padding:'0.6rem 1.25rem', 
              background:'rgba(255,255,255,0.1)',
              border:'1.5px solid rgba(255,255,255,0.25)', 
              borderRadius:10,
              color:'white', 
              fontFamily:"var(--font-display)", 
              fontSize:'0.82rem', 
              fontWeight:700, 
              cursor: loading ? 'wait' : 'pointer',
              backdropFilter:'var(--glass-blur)', 
              transition:'all var(--transition-fast)'
            }} 
            onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,0.2)'} 
            onMouseLeave={e => e.currentTarget.style.background='rgba(255,255,255,0.1)'}
          >🔄 Sincronizar VERTICAL</button>
          
          <ExportButton 
            type="excel" 
            variant="solid" 
            reportId="consulta-externa" 
            queryParams={{ fechaDesde, fechaHasta, especialidad: selectedEspecialidad }} 
          />
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
        <div 
          onClick={() => setFilterEstado(null)}
          style={{ flex: 1, background: '#F8FAFC', borderRadius: 14, padding: '1.25rem', border: filterEstado === null ? '2px solid var(--color-azul-fuerte)' : '1px solid rgba(0,70,135,0.06)', cursor: 'pointer', transition: 'all 0.2s' }}>
          <div style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Total Citas</div>
          <div style={{ fontSize: '2rem', fontFamily: 'var(--font-display)', fontWeight: 800, color: 'var(--color-azul-fuerte)' }}>{stats.total}</div>
        </div>
        <div 
          onClick={() => setFilterEstado(filterEstado === 'ASISTIDA' ? null : 'ASISTIDA')}
          style={{ flex: 1, background: 'rgba(0,151,74,0.04)', borderRadius: 14, padding: '1.25rem', border: filterEstado === 'ASISTIDA' ? '2px solid var(--color-verde-e)' : '1px solid rgba(0,151,74,0.1)', cursor: 'pointer', transition: 'all 0.2s' }}>
          <div style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--color-verde-e)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Asistencias</div>
          <div style={{ fontSize: '2rem', fontFamily: 'var(--font-display)', fontWeight: 800, color: 'var(--color-verde-e)' }}>{stats.asistencias}</div>
        </div>
        <div 
          onClick={() => setFilterEstado(filterEstado === 'PAGADA' ? null : 'PAGADA')}
          style={{ background: 'rgba(0,151,74,0.05)', padding: '1.25rem', borderRadius: '12px', border: filterEstado === 'PAGADA' ? '2px solid var(--color-verde-e)' : '1px solid rgba(0,151,74,0.1)', cursor: 'pointer', transition: 'all 0.2s' }}>
          <div style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--color-verde-e)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Pagadas</div>
          <div style={{ fontSize: '2rem', fontFamily: 'var(--font-display)', fontWeight: 800, color: 'var(--color-verde-e)' }}>{stats.pagadas}</div>
        </div>
        <div 
          onClick={() => setFilterEstado(filterEstado === 'NO_ASISTIO' ? null : 'NO_ASISTIO')}
          style={{ flex: 1, background: 'rgba(232,133,61,0.04)', borderRadius: 14, padding: '1.25rem', border: filterEstado === 'NO_ASISTIO' ? '2px solid var(--color-accent-warm)' : '1px solid rgba(232,133,61,0.1)', cursor: 'pointer', transition: 'all 0.2s' }}>
          <div style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--color-accent-warm)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>No Asistió</div>
          <div style={{ fontSize: '2rem', fontFamily: 'var(--font-display)', fontWeight: 800, color: 'var(--color-accent-warm)' }}>{stats.noAsistio}</div>
        </div>
        <div style={{ flex: 1, background: 'rgba(0,136,201,0.04)', borderRadius: 14, padding: '1.25rem', border: '1px solid rgba(0,136,201,0.1)' }}>
          <div style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--color-azul-claro)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Tasa Asistencia</div>
          <div style={{ fontSize: '2rem', fontFamily: 'var(--font-display)', fontWeight: 800, color: 'var(--color-azul-claro)' }}>{stats.tasaAsistencia}%</div>
        </div>
      </div>

      {/* Búsqueda y Filtros */}
      <div style={{ 
        background:'#FFFFFF', 
        borderRadius: 14, 
        padding:'0.875rem 1.25rem', 
        marginBottom:'1.5rem', 
        border:'1px solid rgba(0,70,135,0.05)', 
        boxShadow: 'var(--shadow-xs)',
        display: 'flex',
        gap: '1rem',
        alignItems: 'center'
      }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: 2 }}>
          <span style={{ position: 'absolute', left: '0.875rem', color: 'var(--text-muted)' }}>🔍</span>
          <input
            placeholder="Buscar por nombre, expediente o médico..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="search-input-field"
            style={{ 
              border:'1px solid #E2E8F0', 
              borderRadius:10, 
              padding:'0.55rem 1rem 0.55rem 2.5rem', 
              fontFamily:"var(--font-body)", 
              fontSize:'0.85rem', 
              outline:'none', 
              width:'100%', 
              background: '#F8FAFC',
              transition: 'all var(--transition-fast)'
            }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <select
            value={selectedEspecialidad}
            onChange={e => setSelectedEspecialidad(e.target.value)}
            style={{
              width: '100%',
              border: '1px solid #E2E8F0',
              borderRadius: 10,
              padding: '0.55rem 1rem',
              fontFamily: "var(--font-body)",
              fontSize: '0.85rem',
              outline: 'none',
              background: '#F8FAFC',
              color: selectedEspecialidad ? 'var(--text-primary)' : 'var(--text-muted)',
              transition: 'all var(--transition-fast)',
              cursor: 'pointer'
            }}
          >
            <option value="">Todas las Especialidades</option>
            {especialidades.map(esp => (
              <option key={esp} value={esp}>{esp}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabla de Citas */}
      <div style={{ 
        background:'#FFFFFF', 
        borderRadius: '16px', 
        border:'1px solid rgba(0,70,135,0.05)', 
        overflow:'hidden', 
        boxShadow:'var(--shadow-xs)' 
      }}>
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 400px)' }}>
          <table className="users-table" style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
              <tr style={{ borderBottom: '2px solid rgba(0,70,135,0.06)' }}>
                {['Hora','Paciente / Perfil','Médico','Especialidad','Convenio','Tipo','Estado','Diagnóstico / Notas','Acciones'].map(h => (
                  <th key={h} style={{ 
                    background:'#FAFBFD', 
                    color:'var(--text-primary)', 
                    padding:'0.85rem 1rem', 
                    textAlign:'left', 
                    fontFamily:"var(--font-display)", 
                    fontSize:'0.72rem', 
                    fontWeight:800, 
                    letterSpacing:'0.06em', 
                    textTransform:'uppercase', 
                    whiteSpace:'nowrap' 
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayCitas.length === 0 && !loading && (
                <tr>
                  <td colSpan="9" style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
                    No se encontraron citas con los filtros actuales.
                  </td>
                </tr>
              )}
              {displayCitas.map((cita) => {
                const isProgramada = cita.estado === 'PROGRAMADA';
                return (
                  <tr key={cita.citaid} style={{ borderBottom: '1px solid rgba(0,70,135,0.04)', transition: 'background-color 150ms' }}>
                    <td style={{ padding:'0.75rem 1rem', fontFamily:'var(--font-mono)', fontWeight:600, color:'var(--color-azul-fuerte)' }}>
                      {new Date(cita.fechahoracita).toLocaleString('es-MX', { hour:'2-digit', minute:'2-digit', day:'2-digit', month:'short' })}
                    </td>
                    <td style={{ padding:'0.75rem 1rem', fontWeight:600, color: 'var(--text-primary)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span>{cita.nombrepaciente || 'S/N'}</span>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.15rem' }}>
                        <span style={{ fontSize:'0.65rem', color:'var(--text-muted)', fontFamily:'var(--font-mono)' }}>Exp: {cita.noexpediente}</span>
                        {(cita.edad_anios || cita.edad_mes || cita.genero) && (
                          <span style={{ fontSize:'0.65rem', color:'var(--color-azul-fuerte)', background: 'rgba(0,70,135,0.05)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                            {cita.edad_anios ? cita.edad_anios.replace('año(s)', 'a') : ''} {cita.edad_mes ? cita.edad_mes.replace('mes(es)', 'm') : ''} {cita.genero ? `- ${cita.genero}` : ''}
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding:'0.75rem 1rem', color:'var(--text-secondary)' }}>{cita.medico}</td>
                    <td style={{ padding:'0.75rem 1rem', color:'var(--text-secondary)' }}>{cita.especialidad}</td>
                    <td style={{ padding:'0.75rem 1rem', color:'var(--text-secondary)', fontSize: '0.75rem' }}>
                      {cita.convenio ? (
                        <span style={{ background: 'rgba(128,128,128,0.1)', padding: '0.2rem 0.5rem', borderRadius: '6px', whiteSpace: 'nowrap', display: 'inline-block', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis' }} title={cita.convenio}>
                          {cita.convenio}
                        </span>
                      ) : '-'}
                    </td>
                    <td style={{ padding:'0.75rem 1rem', fontFamily:'var(--font-mono)', fontWeight:800, color:'var(--color-azul-fuerte)' }}>
                      {cita.tipoconsulta || '-'}
                    </td>
                    <td style={{ padding:'0.75rem 1rem' }}>
                      <span style={{
                        background: isProgramada ? 'rgba(0,136,201,0.08)' : (cita.estado === 'ASISTIDA' || cita.estado === 'PAGADA') ? 'rgba(0,151,74,0.08)' : 'rgba(239,68,68,0.08)',
                        color: isProgramada ? 'var(--color-azul-claro)' : (cita.estado === 'ASISTIDA' || cita.estado === 'PAGADA') ? 'var(--color-verde-e)' : 'var(--color-danger)',
                        border: `1px solid ${isProgramada ? 'rgba(0,136,201,0.2)' : (cita.estado === 'ASISTIDA' || cita.estado === 'PAGADA') ? 'rgba(0,151,74,0.2)' : 'rgba(239,68,68,0.2)'}`,
                        borderRadius:'100px', padding:'0.2rem 0.6rem', fontSize:'0.65rem', fontWeight:800, fontFamily: 'var(--font-mono)', textTransform: 'uppercase'
                      }}>{cita.estado}</span>
                      {isPagada(cita) && (
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.65rem', fontWeight: 800, color: 'var(--color-verde-e)', background: 'rgba(0,151,74,0.08)', padding: '0.2rem 0.4rem', borderRadius: '4px' }}>💳 PAGADA</span>
                      )}
                    </td>
                    <td style={{ padding:'0.75rem 1rem', color:'var(--text-secondary)', fontSize:'0.75rem', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={cita.notas || cita.diagnostico ? `Notas: ${cita.notas}\nDiag: ${cita.diagnostico}` : 'Sin notas'}>
                      {cita.diagnostico ? `🩺 ${cita.diagnostico}` : cita.notas ? `📝 ${cita.notas}` : '-'}
                    </td>
                    <td style={{ padding:'0.75rem 1rem' }}>
                      <div style={{ display:'flex', gap:'0.45rem' }}>
                        <button onClick={() => { setSelectedCita(cita); setNotasData({ Notas: cita.notas || '', Diagnostico: cita.diagnostico || '' }); setOpenNotas(true); }} style={{ padding:'0.35rem 0.75rem', background:'rgba(0,70,135,0.05)', border:'1.5px solid rgba(0,70,135,0.15)', borderRadius:8, fontSize:'0.72rem', color:'var(--color-azul-fuerte)', fontWeight: 700, cursor:'pointer', fontFamily:"var(--font-display)" }}>📝 Notas</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Añadir Notas/Diagnóstico */}
      {openNotas && (
        <div style={{ position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(15, 26, 46, 0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:999, backdropFilter:'var(--glass-blur)' }}>
          <div style={{ background:'white', borderRadius:20, width:'95%', maxWidth:600, padding:'2.25rem', boxShadow:'var(--shadow-xl)', animation:'fadeUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)', maxHeight:'90vh', overflowY:'auto' }}>
            <h2 style={{ fontFamily:"var(--font-display)", fontWeight: 800, margin:'0 0 0.5rem', fontSize:'1.35rem', color:'var(--color-azul-fuerte)' }}>Notas de Cita</h2>
            <div style={{ fontSize:'0.85rem', color:'var(--text-secondary)', marginBottom:'1.5rem', fontFamily:'var(--font-body)' }}>
              Paciente: <strong style={{ color:'var(--text-primary)' }}>{selectedCita?.nombrepaciente}</strong> ({selectedCita?.noexpediente})
            </div>
            
            <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>
              <div>
                <label style={{ display:'block', fontSize:'0.75rem', fontWeight:700, color:'var(--color-azul-fuerte)', marginBottom:'0.45rem', fontFamily: 'var(--font-display)', textTransform: 'uppercase' }}>Notas Iniciales / Observaciones</label>
                <textarea rows={3} value={notasData.Notas} onChange={e => setNotasData({...notasData, Notas:e.target.value})} className="edit-form-input" style={{ width:'100%', border:'1px solid #E2E8F0', borderRadius:10, padding:'0.65rem', boxSizing:'border-box', background: '#F8FAFC', resize: 'vertical' }} placeholder="Opcional. Información administrativa..." />
              </div>
              <div>
                <label style={{ display:'block', fontSize:'0.75rem', fontWeight:700, color:'var(--color-azul-fuerte)', marginBottom:'0.45rem', fontFamily: 'var(--font-display)', textTransform: 'uppercase' }}>Diagnóstico / Motivo</label>
                <textarea rows={3} value={notasData.Diagnostico} onChange={e => setNotasData({...notasData, Diagnostico:e.target.value})} className="edit-form-input" style={{ width:'100%', border:'1px solid #E2E8F0', borderRadius:10, padding:'0.65rem', boxSizing:'border-box', background: '#F8FAFC', resize: 'vertical' }} placeholder="Opcional. Diagnóstico principal..." />
              </div>
            </div>

            <div style={{ display:'flex', justifyContent:'flex-end', gap:'0.75rem', marginTop:'2rem', paddingTop:'1.25rem', borderTop:'1px solid rgba(0,70,135,0.06)' }}>
              <button onClick={() => setOpenNotas(false)} style={{ padding:'0.6rem 1.25rem', border:'1px solid #E2E8F0', borderRadius:10, background:'transparent', color:'var(--text-secondary)', fontWeight:700, cursor:'pointer' }}>Cancelar</button>
              <button onClick={handleGuardarNotas} style={{ padding:'0.6rem 1.25rem', border:'none', borderRadius:10, background:'var(--color-azul-fuerte)', color:'white', fontWeight:700, cursor:'pointer', boxShadow:'0 4px 12px rgba(0,70,135,0.2)' }}>Guardar Notas</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: '2rem', right: '2rem',
          background: 'var(--text-primary)', color: 'white', padding: '0.85rem 1.5rem',
          borderRadius: '100px', boxShadow: 'var(--shadow-lg)',
          display: 'flex', alignItems: 'center', gap: '0.6rem', zIndex: 1000,
          animation: 'fadeUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)', fontFamily: "var(--font-body)", fontSize: '0.85rem', fontWeight: 600
        }}>
          <span style={{ fontSize: '1rem', color: 'var(--color-success)' }}>✓</span>
          {toast}
        </div>
      )}
    </div>
  );
}
