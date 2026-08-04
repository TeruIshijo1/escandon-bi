/**
 * AdminUsuarios.jsx — Gestión de Usuarios (solo ADMIN)
 * Hospital Escandón BI Platform v4.0
 * Rediseño premium con identidad de marca
 */
import { useState, useEffect, useMemo } from 'react';
import { getPermissionSections } from '../utils/rbac';

const API_BASE = '/api';

/**
 * PLATFORM_SECTIONS se genera dinámicamente desde rbac.js.
 * Así, al agregar una nueva sección en rbac.js (getNavItems + ROUTE_TO_PERMISSION),
 * automáticamente aparecerá en el modal de permisos sin necesidad de tocar este archivo.
 */

const ROL_COLORS = {
  ADMIN:            { bg:'rgba(0,70,135,0.08)',   text:'var(--color-azul-fuerte)'   },
  DIRECTOR:         { bg:'rgba(232,133,61,0.08)',  text:'var(--color-accent-warm)'   },
  // Use green for jefe de area in v4.0
  JEFE_AREA:        { bg:'rgba(0,151,74,0.08)',   text:'var(--color-verde-e)'   },
  USUARIO_OPERATIVO:{ bg:'rgba(90,107,124,0.08)', text:'#5A6B7C'  },
};

const ROL_DISPLAY = {
  ADMIN: 'Administrador',
  DIRECTOR: 'Directivo',
  JEFE_AREA: 'Jefatura',
  USUARIO_OPERATIVO: 'Usuario Operativo',
};

const AREAS_LIST = ['QUIROFANO', 'UCI', 'URGENCIAS', 'CUNEROS', 'IMAGENOLOGIA', 'LABORATORIO', 'CONSULTA_EXTERNA', 'HOSPITALIZACION'];

export default function AdminUsuarios() {
  // Genera dinámicamente la lista de secciones desde rbac.js
  const PLATFORM_SECTIONS = useMemo(() => getPermissionSections(), []);
  // Extraer las categorías únicas, en orden de aparición
  const categories = useMemo(() => {
    const cats = [];
    for (const s of PLATFORM_SECTIONS) {
      if (!cats.includes(s.category)) cats.push(s.category);
    }
    return cats;
  }, [PLATFORM_SECTIONS]);

  const [users,   setUsers]   = useState([]);
  const [roles,   setRoles]   = useState([
    { id: 1, nombre: 'ADMIN' },
    { id: 2, nombre: 'DIRECTOR' },
    { id: 3, nombre: 'JEFE_AREA' },
    { id: 4, nombre: 'USUARIO_OPERATIVO' }
  ]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [rolFilter, setRolF]  = useState('');
  const [modalTableros, setModalTableros] = useState(null);
  const [selectedReports, setSelectedReports] = useState(new Set());
  const [toast, setToast] = useState('');
  const [modalEdit, setModalEdit] = useState(null);
  const [editForm, setEditForm] = useState({ username:'', nombre:'', email:'', password:'', roleId:4, area:'' });

  useEffect(() => {
    fetchUsers();
    fetchRoles();
  }, []);



  const fetchUsers = async () => {
    try {
      const token = sessionStorage.getItem('escandon_token');
      const res = await fetch(`${API_BASE}/admin/usuarios`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const json = await res.json();
      if (json.ok) setUsers(json.data);
    } catch (err) {
      console.error('Error fetching users:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchRoles = async () => {
    try {
      const token = sessionStorage.getItem('escandon_token');
      const res = await fetch(`${API_BASE}/admin/roles`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const json = await res.json();
      if (json.ok) setRoles(json.data);
    } catch (err) {
      console.error('Error fetching roles:', err);
    }
  };

  const handleOpenAdd = () => {
    setModalEdit({ isNew: true });
    setEditForm({ username:'', nombre:'', email:'', password:'', roleId:4, area:'' });
  };

  const handleOpenEdit = (u) => {
    setModalEdit(u);
    const rolObj = roles.find(r => r.nombre === u.rol);
    setEditForm({ 
      username: u.username, 
      nombre: u.nombre, 
      email: u.email || '', 
      roleId: rolObj ? rolObj.id : 4, 
      area: u.area || '',
      password: '' 
    });
  };

  const handleSaveEdit = async () => {
    if (!editForm.username || !editForm.nombre || !editForm.email || (modalEdit.isNew && !editForm.password)) {
      alert('Todos los campos son requeridos');
      return;
    }

    try {
      const token = sessionStorage.getItem('escandon_token');
      const method = modalEdit.isNew ? 'POST' : 'PUT';
      const url = modalEdit.isNew ? `${API_BASE}/admin/usuarios` : `${API_BASE}/admin/usuarios/${modalEdit.id}`;
      
      const res = await fetch(url, {
        method,
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: editForm.username,
          nombre:   editForm.nombre,
          email:    editForm.email,
          password: editForm.password,
          rolId:    editForm.roleId,
          area:     editForm.area || null
        })
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error al guardar usuario');

      setToast(modalEdit.isNew ? `Usuario ${editForm.nombre} creado` : `Usuario ${editForm.nombre} actualizado`);
      fetchUsers();
      setModalEdit(null);
      setTimeout(() => setToast(''), 3000);
    } catch (err) {
      alert(err.message);
    }
  };

  const toggleActivo = async (u) => {
    try {
      const token = sessionStorage.getItem('escandon_token');
      const res = await fetch(`${API_BASE}/admin/usuarios/${u.id}`, {
        method: 'PUT',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ activo: !u.activo })
      });

      if (!res.ok) throw new Error('Error al cambiar estado');
      
      setToast(`Usuario ${u.nombre} ${!u.activo ? 'activado' : 'desactivado'}`);
      fetchUsers();
      setTimeout(() => setToast(''), 3000);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleOpenModalTableros = (u) => {
    setModalTableros(u);
    setSelectedReports(new Set(u.permisos || [])); 
  };

  const handleSavePermisos = async () => {
    try {
      const token = sessionStorage.getItem('escandon_token');
      const res = await fetch(`${API_BASE}/admin/usuarios/${modalTableros.id}/permisos`, {
        method: 'PUT',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ permisos: Array.from(selectedReports) })
      });

      if (!res.ok) throw new Error('Error al guardar permisos');

      setToast(`Permisos actualizados para ${modalTableros.nombre}`);
      fetchUsers();
      setModalTableros(null);
      setTimeout(() => setToast(''), 3000);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleToggleReport = (id) => {
    setSelectedReports(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = (select) => {
    if (select) {
      const all = new Set();
      PLATFORM_SECTIONS.forEach(s => all.add(s.id));
      setSelectedReports(all);
    } else {
      setSelectedReports(new Set());
    }
  };

  const filtered = users.filter(u =>
    ((u.nombre || '').toLowerCase().includes(search.toLowerCase()) || (u.username || '').includes(search.toLowerCase())) &&
    (!rolFilter || u.rol === rolFilter)
  );

  return (
    <div style={{ maxWidth:'1200px', width:'100%', margin:'0 auto' }}>
      <style>{`
        .search-input-field:focus,
        .custom-select-perfil:focus,
        .edit-form-input:focus,
        .edit-form-select:focus {
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
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.64rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.65)', marginBottom: '0.35rem' }}>Administración</div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: '1.65rem', fontWeight: 800, color: 'white', margin: 0, letterSpacing: '-0.01em' }}>Gestión de Usuarios</h1>
        </div>
        <button 
          onClick={handleOpenAdd} 
          style={{
            padding:'0.6rem 1.25rem', 
            background:'rgba(255,255,255,0.15)',
            border:'1.5px solid rgba(255,255,255,0.25)', 
            borderRadius:10,
            color:'white', 
            fontFamily:"var(--font-display)", 
            fontSize:'0.82rem', 
            fontWeight:700, 
            cursor:'pointer',
            backdropFilter:'var(--glass-blur)', 
            transition:'all var(--transition-fast)',
            position: 'relative',
            zIndex: 1,
            boxShadow: 'var(--shadow-xs)'
          }} 
          onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,0.28)'} 
          onMouseLeave={e => e.currentTarget.style.background='rgba(255,255,255,0.15)'}
        >+ Nuevo Usuario</button>
      </div>

      {/* Filtros */}
      <div style={{ 
        background:'#FFFFFF', 
        borderRadius: 14, 
        padding:'0.875rem 1.25rem', 
        marginBottom:'1.5rem', 
        border:'1px solid rgba(0,70,135,0.05)', 
        boxShadow: 'var(--shadow-xs)',
        display:'flex', 
        gap:'0.75rem', 
        alignItems:'center', 
        flexWrap:'wrap' 
      }}>
        <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center', minWidth: 200 }}>
          <span style={{ position: 'absolute', left: '0.875rem', color: 'var(--text-muted)', fontSize: '0.9rem', display: 'flex', alignItems: 'center' }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </span>
          <input
            placeholder="Buscar por nombre o usuario..."
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
              flex:'1', 
              background: '#F8FAFC',
              transition: 'all var(--transition-fast)'
            }}
          />
        </div>
        <select 
          value={rolFilter} 
          onChange={e => setRolF(e.target.value)} 
          className="custom-select-perfil"
          style={{ 
            border:'1px solid #E2E8F0', 
            borderRadius:10, 
            padding:'0.55rem 1rem', 
            fontFamily:"var(--font-body)", 
            fontSize:'0.85rem', 
            outline:'none', 
            background:'white',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            transition: 'all var(--transition-fast)'
          }}
        >
          <option value="">Todos los perfiles</option>
          {roles.map(r => <option key={r.id} value={r.nombre}>{ROL_DISPLAY[r.nombre] || r.nombre}</option>)}
        </select>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize:'0.72rem', color:'var(--text-muted)', fontWeight: 600, marginLeft:'auto' }}>
          {loading ? 'Consultando...' : `${filtered.length} usuarios`}
        </span>
      </div>

      {/* Tabla */}
      <div style={{ 
        background:'#FFFFFF', 
        borderRadius: '16px', 
        border:'1px solid rgba(0,70,135,0.05)', 
        overflow:'hidden', 
        boxShadow:'var(--shadow-xs)' 
      }}>
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 250px)' }}>
          <table className="users-table" style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
              <tr style={{ borderBottom: '2px solid rgba(0,70,135,0.06)' }}>
                {['Usuario','Nombre Completo','Perfil','Área','Último Acceso','Estado','Acciones'].map(h => (
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
              {filtered.length === 0 && !loading && (
                <tr>
                  <td colSpan="7" style={{ padding: '3rem 2rem', textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>No se encontraron usuarios registrados.</td>
                </tr>
              )}
              {filtered.map((u, i) => {
                const rolC = ROL_COLORS[u.rol] || ROL_COLORS.USUARIO_OPERATIVO;
                return (
                  <tr key={u.id} style={{ borderBottom: '1px solid rgba(0,70,135,0.04)', transition: 'background-color 150ms' }}>
                    <td style={{ padding:'0.75rem 1rem' }}>
                      <code style={{ fontSize:'0.76rem', color:'var(--color-azul-fuerte)', fontFamily:'var(--font-mono)', fontWeight: 600 }}>{u.username}</code>
                    </td>
                    <td style={{ padding:'0.75rem 1rem', fontWeight:600, color: 'var(--text-primary)' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:'0.65rem' }}>
                        <div style={{ 
                          width:30, height:30, borderRadius:'50%', 
                          background:`linear-gradient(135deg, ${rolC.text}20, ${rolC.text}08)`, 
                          border: `1.5px solid ${rolC.text}25`,
                          display:'flex', alignItems:'center', justifyContent:'center', 
                          fontSize:'0.68rem', fontWeight:800, color:rolC.text, flexShrink:0,
                          fontFamily: 'var(--font-display)'
                        }}>
                          {(u.nombre || 'U').split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}
                        </div>
                        {u.nombre}
                      </div>
                    </td>
                    <td style={{ padding:'0.75rem 1rem' }}>
                      <span style={{ 
                        background:rolC.bg, 
                        color:rolC.text, 
                        borderRadius:'100px', 
                        padding:'0.2rem 0.75rem', 
                        fontSize:'0.68rem', 
                        fontWeight:700,
                        fontFamily: 'var(--font-mono)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.02em',
                        border: `1px solid ${rolC.text}18`
                      }}>{ROL_DISPLAY[u.rol] || u.rol}</span>
                    </td>
                    <td style={{ padding:'0.75rem 1rem', fontSize:'0.82rem', color:'var(--text-secondary)', fontFamily: 'var(--font-body)', fontWeight: 500 }}>
                      {u.area || <span style={{ color:'var(--text-muted)' }}>Global</span>}
                    </td>
                    <td style={{ padding:'0.75rem 1rem', fontSize:'0.76rem', color:'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{u.ultimoAcceso || 'Nunca'}</td>
                    <td style={{ padding:'0.75rem 1rem' }}>
                      <span style={{
                        background: u.activo ? 'rgba(0,151,74,0.06)' : 'rgba(239,68,68,0.06)',
                        border: `1px solid ${u.activo ? 'rgba(0,151,74,0.18)' : 'rgba(239,68,68,0.18)'}`,
                        color:       u.activo ? 'var(--color-verde-e)' : 'var(--color-danger)',
                        borderRadius:'100px', padding:'0.2rem 0.75rem', fontSize:'0.68rem', fontWeight:700,
                        fontFamily: 'var(--font-mono)'
                      }}>{u.activo ? '● Activo' : '○ Inactivo'}</span>
                    </td>
                    <td style={{ padding:'0.75rem 1rem' }}>
                      <div style={{ display:'flex', gap:'0.45rem' }}>
                        <button onClick={() => handleOpenEdit(u)} style={{ padding:'0.35rem 0.75rem', background:'rgba(0,70,135,0.05)', border:'1.5px solid rgba(0,70,135,0.12)', borderRadius:8, fontSize:'0.72rem', color:'var(--color-azul-fuerte)', fontWeight: 700, cursor:'pointer', fontFamily:"var(--font-display)", transition: 'all 150ms' }} onMouseEnter={e=>{e.currentTarget.style.background='var(--color-azul-fuerte)'; e.currentTarget.style.color='white';}} onMouseLeave={e=>{e.currentTarget.style.background='rgba(0,70,135,0.05)'; e.currentTarget.style.color='var(--color-azul-fuerte)';}}>✏️ Editar</button>
                        <button onClick={() => handleOpenModalTableros(u)} style={{ padding:'0.35rem 0.75rem', background:'rgba(0,136,201,0.05)', border:'1.5px solid rgba(0,136,201,0.12)', borderRadius:8, fontSize:'0.72rem', color:'var(--color-azul-claro)', fontWeight: 700, cursor:'pointer', fontFamily:"var(--font-display)", transition: 'all 150ms' }} onMouseEnter={e=>{e.currentTarget.style.background='var(--color-azul-claro)'; e.currentTarget.style.color='white';}} onMouseLeave={e=>{e.currentTarget.style.background='rgba(0,136,201,0.05)'; e.currentTarget.style.color='var(--color-azul-claro)';}}>📊 Permisos</button>
                        <button onClick={() => toggleActivo(u)} style={{ padding:'0.35rem 0.6rem', background: u.activo ? 'rgba(239,68,68,0.05)' : 'rgba(0,151,74,0.05)', border:`1.5px solid ${u.activo ? 'rgba(239,68,68,0.15)' : 'rgba(0,151,74,0.15)'}`, borderRadius:8, fontSize:'0.72rem', color: u.activo ? 'var(--color-danger)' : 'var(--color-verde-e)', cursor:'pointer', transition: 'all 150ms' }} onMouseEnter={e=>{e.currentTarget.style.background=u.activo ? 'var(--color-danger)' : 'var(--color-verde-e)'; e.currentTarget.style.color='white';}} onMouseLeave={e=>{e.currentTarget.style.background=u.activo ? 'rgba(239,68,68,0.05)' : 'rgba(0,151,74,0.05)'; e.currentTarget.style.color=u.activo ? 'var(--color-danger)' : 'var(--color-verde-e)';}}>
                          {u.activo ? '🚫' : '✅'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de Asignación de Tableros Dinámico */}
      {modalTableros && (
        <div style={{ position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(15, 26, 46, 0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:999, backdropFilter:'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
          <style>{`@keyframes fadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }`}</style>
          <div style={{ background:'white', borderRadius:20, width:'90%', maxWidth:680, padding:'2.25rem', boxShadow:'var(--shadow-xl)', animation:'fadeUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)', maxHeight:'90vh', overflowY:'auto', boxSizing:'border-box' }}>
            <h2 style={{ fontFamily:"var(--font-display)", fontWeight: 800, margin:'0 0 0.4rem', fontSize:'1.4rem', color:'var(--color-azul-fuerte)', letterSpacing: '-0.01em' }}>Configuración de Permisos BI</h2>
            <p style={{ fontFamily: 'var(--font-body)', fontSize:'0.82rem', color:'var(--text-muted)', marginBottom:'1.5rem', fontWeight: 500 }}>Gestiona los niveles de acceso y reportes específicos para <strong style={{ color: 'var(--text-primary)' }}>{modalTableros.nombre}</strong>.</p>
            
            <div style={{ display:'flex', gap:'0.75rem', marginBottom:'1.5rem' }}>
              <button onClick={() => handleSelectAll(true)} style={{ padding:'0.5rem 1rem', background:'rgba(0,136,201,0.06)', color:'var(--color-azul-claro)', border:'1.5px solid rgba(0,136,201,0.18)', borderRadius:10, fontSize:'0.76rem', fontWeight:700, cursor:'pointer', fontFamily: 'var(--font-display)' }}>Marcar Todos</button>
              <button onClick={() => handleSelectAll(false)} style={{ padding:'0.5rem 1rem', background:'#F7FAFC', color:'var(--text-muted)', border:'1.5px solid #E2E8F0', borderRadius:10, fontSize:'0.76rem', fontWeight:700, cursor:'pointer', fontFamily: 'var(--font-display)' }}>Desmarcar Todos</button>
            </div>

            <div style={{ maxHeight:'420px', overflowY:'auto', paddingRight:'0.5rem' }}>
              {/* Agrupación por Categoría de la Plataforma */}
              {categories.map(category => {
                const sectionsInCategory = PLATFORM_SECTIONS.filter(s => s.category === category);
                if (sectionsInCategory.length === 0) return null;
                
                // Tomar el ícono del primer item de la categoría
                const categoryIcon = sectionsInCategory[0]?.icon || '📌';

                return (
                  <div key={category} style={{ marginBottom:'1.5rem' }}>
                    <h4 style={{ fontFamily: 'var(--font-mono)', fontSize:'0.7rem', fontWeight:800, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--color-azul-fuerte)', borderBottom:'1px solid rgba(0,70,135,0.06)', paddingBottom:'0.45rem', marginBottom:'0.85rem' }}>
                      {categoryIcon} {category}
                    </h4>
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:'0.75rem' }}>
                      {sectionsInCategory.map(s => (
                        <div 
                          key={s.id} 
                          onClick={() => handleToggleReport(s.id)}
                          style={{ 
                            padding:'0.85rem 1rem', 
                            borderRadius:12, 
                            border:`1.5px solid ${selectedReports.has(s.id) ? 'var(--color-azul-claro)' : 'rgba(0,70,135,0.08)'}`,
                            background: selectedReports.has(s.id) ? 'rgba(0,136,201,0.04)' : '#FFFFFF', 
                            cursor:'pointer',
                            display:'flex', 
                            alignItems:'center', 
                            gap:'0.75rem', 
                            transition:'all 150ms ease'
                          }}
                        >
                          <input type="checkbox" checked={selectedReports.has(s.id)} readOnly style={{ cursor:'pointer' }} />
                          <div style={{ overflow:'hidden', flex: 1 }}>
                            <div style={{ fontFamily: 'var(--font-body)', fontSize:'0.82rem', fontWeight:700, color: selectedReports.has(s.id) ? 'var(--color-azul-fuerte)' : 'var(--text-primary)', whiteSpace:'nowrap', textOverflow:'ellipsis', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span>{s.icon}</span>
                              {s.name}
                            </div>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize:'0.65rem', color:'var(--text-muted)', marginTop: '2px' }}>ID: {s.id}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display:'flex', justifyContent:'flex-end', gap:'0.75rem', marginTop:'2rem', paddingTop:'1.25rem', borderTop:'1px solid rgba(0,70,135,0.06)' }}>
              <button onClick={() => setModalTableros(null)} style={{ padding:'0.6rem 1.25rem', border:'1px solid #E2E8F0', borderRadius:10, background:'white', color:'var(--text-secondary)', fontSize:'0.85rem', fontWeight:700, cursor:'pointer', fontFamily: 'var(--font-display)' }}>Cancelar</button>
              <button onClick={handleSavePermisos} style={{ padding:'0.6rem 1.25rem', border:'none', borderRadius:10, background:'linear-gradient(135deg, var(--color-azul-claro), var(--color-azul-cruz))', color:'white', fontSize:'0.85rem', fontWeight:700, cursor:'pointer', fontFamily: 'var(--font-display)', boxShadow:'0 4px 12px rgba(0,136,201,0.25)' }}>
                Guardar {selectedReports.size} Permisos
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Edición de Usuario */}
      {modalEdit && (
        <div style={{ position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(15, 26, 46, 0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:999, backdropFilter:'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
          <div style={{ background:'white', borderRadius:20, width:'95%', maxWidth:460, padding:'2.25rem', boxShadow:'var(--shadow-xl)', animation:'fadeUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)', boxSizing:'border-box', maxHeight:'90vh', overflowY:'auto' }}>
            <h2 style={{ fontFamily:"var(--font-display)", fontWeight: 800, margin:'0 0 1.25rem', fontSize:'1.35rem', color:'var(--color-azul-fuerte)', letterSpacing: '-0.01em' }}>{modalEdit.isNew ? 'Añadir Nuevo Usuario' : 'Editar Usuario'}</h2>
            
            <div style={{ display:'flex', flexDirection:'column', gap:'1.25rem' }}>
              <div>
                <label style={{ display:'block', fontSize:'0.75rem', fontWeight:700, color:'var(--color-azul-fuerte)', marginBottom:'0.45rem', fontFamily: 'var(--font-display)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Nombre Completo</label>
                <input value={editForm.nombre} onChange={e => setEditForm({...editForm, nombre:e.target.value})} className="edit-form-input" style={{ width:'100%', border:'1px solid #E2E8F0', borderRadius:10, padding:'0.65rem 0.85rem', fontSize:'0.88rem', fontFamily:"var(--font-body)", outline:'none', boxSizing:'border-box', background: '#F8FAFC', transition: 'all var(--transition-fast)' }} />
              </div>
              <div>
                <label style={{ display:'block', fontSize:'0.75rem', fontWeight:700, color:'var(--color-azul-fuerte)', marginBottom:'0.45rem', fontFamily: 'var(--font-display)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Email</label>
                <input value={editForm.email} onChange={e => setEditForm({...editForm, email:e.target.value})} className="edit-form-input" style={{ width:'100%', border:'1px solid #E2E8F0', borderRadius:10, padding:'0.65rem 0.85rem', fontSize:'0.88rem', fontFamily:"var(--font-body)", outline:'none', boxSizing:'border-box', background: '#F8FAFC', transition: 'all var(--transition-fast)' }} />
              </div>
              <div>
                <label style={{ display:'block', fontSize:'0.75rem', fontWeight:700, color:'var(--color-azul-fuerte)', marginBottom:'0.45rem', fontFamily: 'var(--font-display)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Username</label>
                <input value={editForm.username} onChange={e => setEditForm({...editForm, username:e.target.value})} className="edit-form-input" style={{ width:'100%', border:'1px solid #E2E8F0', borderRadius:10, padding:'0.65rem 0.85rem', fontSize:'0.88rem', fontFamily:"var(--font-body)", outline:'none', background: modalEdit.isNew ? '#F8FAFC' : '#EDF2F7', color: modalEdit.isNew ? 'var(--text-primary)' : 'var(--text-muted)', boxSizing:'border-box', cursor: modalEdit.isNew ? 'text' : 'not-allowed', transition: 'all var(--transition-fast)' }} disabled={!modalEdit.isNew} />
              </div>
              <div>
                <label style={{ display:'block', fontSize:'0.75rem', fontWeight:700, color:'var(--color-azul-fuerte)', marginBottom:'0.45rem', fontFamily: 'var(--font-display)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  {modalEdit.isNew ? 'Contraseña' : 'Nueva Contraseña (dejar vacío para no cambiar)'}
                </label>
                <input 
                  type="password" 
                  value={editForm.password || ''} 
                  onChange={e => setEditForm({...editForm, password:e.target.value})} 
                  placeholder={modalEdit.isNew ? 'Mínimo 8 caracteres' : 'Dejar vacío si no desea modificar'}
                  className="edit-form-input"
                  style={{ width:'100%', border:'1px solid #E2E8F0', borderRadius:10, padding:'0.65rem 0.85rem', fontSize:'0.88rem', fontFamily:"var(--font-body)", outline:'none', boxSizing:'border-box', background: '#F8FAFC', transition: 'all var(--transition-fast)' }} 
                />
              </div>
              <div style={{ display:'flex', gap:'1rem' }}>
                <div style={{ flex:1 }}>
                  <label style={{ display:'block', fontSize:'0.75rem', fontWeight:700, color:'var(--color-azul-fuerte)', marginBottom:'0.45rem', fontFamily: 'var(--font-display)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Tipo de Perfil</label>
                  <select value={editForm.roleId} onChange={e => setEditForm({...editForm, roleId:parseInt(e.target.value)})} className="edit-form-select" style={{ width:'100%', border:'1px solid #E2E8F0', borderRadius:10, padding:'0.65rem 0.85rem', fontSize:'0.88rem', fontFamily:"var(--font-body)", outline:'none', boxSizing:'border-box', background: 'white', fontWeight: 600, color: 'var(--text-secondary)', transition: 'all var(--transition-fast)' }}>
                    {roles.map(r => <option key={r.id} value={r.id}>{ROL_DISPLAY[r.nombre] || r.nombre}</option>)}
                  </select>
                </div>
                <div style={{ flex:1 }}>
                  <label style={{ display:'block', fontSize:'0.75rem', fontWeight:700, color:'var(--color-azul-fuerte)', marginBottom:'0.45rem', fontFamily: 'var(--font-display)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Área Asignada</label>
                  <input 
                    list="areas-list"
                    value={editForm.area} 
                    onChange={e => setEditForm({...editForm, area:e.target.value.toUpperCase()})} 
                    placeholder="Global"
                    className="edit-form-input"
                    style={{ width:'100%', border:'1px solid #E2E8F0', borderRadius:10, padding:'0.65rem 0.85rem', fontSize:'0.88rem', fontFamily:"var(--font-body)", outline:'none', boxSizing:'border-box', textTransform:'uppercase', background: '#F8FAFC', transition: 'all var(--transition-fast)' }} 
                  />
                  <datalist id="areas-list">
                    <option value="QUIROFANO" />
                    <option value="UCI" />
                    <option value="URGENCIAS" />
                    <option value="CUNEROS" />
                    <option value="IMAGENOLOGIA" />
                    <option value="LABORATORIO" />
                    <option value="CONSULTA_EXTERNA" />
                    <option value="HOSPITALIZACION" />
                  </datalist>
                </div>
              </div>
            </div>

            <div style={{ display:'flex', justifyContent:'flex-end', gap:'0.75rem', marginTop:'2.25rem', paddingTop:'1.25rem', borderTop:'1px solid rgba(0,70,135,0.06)' }}>
              <button onClick={() => setModalEdit(null)} style={{ padding:'0.6rem 1.25rem', border:'1px solid #E2E8F0', borderRadius:10, background:'transparent', color:'var(--text-secondary)', fontSize:'0.85rem', fontWeight:700, cursor:'pointer', fontFamily:"var(--font-display)" }}>Cancelar</button>
              <button onClick={handleSaveEdit} style={{ padding:'0.6rem 1.25rem', border:'none', borderRadius:10, background:'linear-gradient(135deg, var(--color-azul-claro), var(--color-azul-cruz))', color:'white', fontSize:'0.85rem', fontWeight:700, cursor:'pointer', fontFamily:"var(--font-display)", boxShadow:'0 4px 12px rgba(0,136,201,0.2)' }}>Guardar Cambios</button>
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
          animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)', fontFamily: "var(--font-body)", fontSize: '0.85rem', fontWeight: 600
        }}>
          <span style={{ fontSize: '1rem', color: 'var(--color-success)' }}>✓</span>
          {toast}
        </div>
      )}
    </div>
  );
}
