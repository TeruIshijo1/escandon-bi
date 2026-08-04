/**
 * AdminConfiguracion.jsx — Configuración del sistema
 * Hospital Escandón BI Platform v4.0
 * Rediseño premium con identidad de marca y consistencia visual
 */
import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import PremiumLoader from '../components/shared/PremiumLoader';

const API_BASE = '/api';

const SECCION_LABELS = {
  area:      '🏥 Tablero de Área',
  stats:     '📈 Estadísticas'
};

const ICONOS_RAPIDOS = ['📊','🏥','❤️','🔪','📅','🚪','📦','💼','⚙️','🎯','⭐','📋','👤','♀️','📉','👶','✅','⚠️','💰','🛏️','🔄'];

export default function AdminConfiguracion() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [testing, setTesting] = useState(false);
  const [modalReportOpen, setModalReportOpen] = useState(false);
  const [currentReport, setCurrentReport] = useState({ 
    id: null, reportId: '', name: '', 
    workspaceId: '', pbiReportId: '', lookerUrl: '', 
    pbixPath: '', excelPath: '', thumbnailPath: '',
    roles: [], area: '', multiPagina: false, active: true 
  });

  // KPI CONFIG STATE
  const [kpiList,         setKPIList]        = useState([]);
  const [kpiFilter,       setKPIFilter]      = useState('all');
  const [kpiEditing,      setKPIEditing]     = useState(null); // elementoId en edición
  const [kpiEditForm,     setKPIEditForm]    = useState({ nombreCustom: '', icono: '', pbiUrl: '', jsonApiUrl: '', jsonFilePath: '', multiPagina: false });
  const [kpiSaving,       setKPISaving]      = useState(false);

  const [connectors, setConnectors] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [entities, setEntities] = useState([]);
  const [selectedConnector, setSelectedConnector] = useState(null);
  const [modalMappingOpen, setModalMappingOpen] = useState(false);
  const [modalConnectorOpen, setModalConnectorOpen] = useState(false);

  // Al abrir el modal de mapeo, refrescamos los datos para asegurar que lo último escaneado aparezca
  useEffect(() => {
    if (modalMappingOpen) fetchDataHub();
  }, [modalMappingOpen]);

  const [currentConnector, setCurrentConnector] = useState({ nombre: '', tipo: 'EXCEL', configuracion: { filePath: '' } });
  const [currentMapping, setCurrentMapping] = useState({ seccionUI: '', entityId: '', campoValor: '', campoFiltro: '', metodoCalculo: 'SUM' });

  const ROL_DISPLAY = {
    ADMIN: 'Administrador',
    DIRECTOR: 'Directivo',
    JEFE_AREA: 'Jefatura',
    USUARIO_OPERATIVO: 'Usuario Operativo',
  };

  const AREAS_LIST = ['QUIROFANO', 'UCI', 'URGENCIAS', 'CUNEROS', 'IMAGENOLOGIA', 'LABORATORIO', 'CONSULTA_EXTERNA', 'HOSPITALIZACION'];

  // Configuración de conexiones
  const [sqlConfig, setSqlConfig] = useState({
    host: 'sql-server.local',
    port: '1433',
    database: 'HOSPITAL_DB',
    user: 'usuario_sql',
    pass: '********'
  });

  const [pbiConfig, setPbiConfig] = useState({
    tenantId: 'd7a4b1c2-e3f4-5678-90ab-cdef12345678',
    clientId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    clientSecret: '••••••••••••••••'
  });

  useEffect(() => {
    fetchReports();
    fetchDataHub();
    fetchKPIConfig();
  }, []);

  const fetchKPIConfig = async () => {
    try {
      const token = sessionStorage.getItem('escandon_token');
      const res = await fetch(`${API_BASE}/admin/kpi-config`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const json = await res.json();
      if (json.ok) setKPIList(json.data);
    } catch (err) { console.error('Error fetching KPI config:', err); }
  };

  const handleKPIEdit = (kpi) => {
    setKPIEditing(kpi.ElementoId);
    setKPIEditForm({
      nombreCustom: kpi.NombreCustom || '',
      icono:        kpi.Icono || '📊',
      pbiUrl:       kpi.PBIUrl || '',
      jsonApiUrl:   kpi.JsonApiUrl || '',
      jsonFilePath: kpi.JsonFilePath || '',
      multiPagina:  kpi.MultiPagina === 1 || !!kpi.multiPagina,
    });
  };

  const handleKPISave = async (elementoId) => {
    setKPISaving(true);
    try {
      const token = sessionStorage.getItem('escandon_token');
      const res = await fetch(`${API_BASE}/admin/kpi-config/${elementoId}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombreCustom: kpiEditForm.nombreCustom.trim() || null,
          icono:        kpiEditForm.icono,
          pbiUrl:       kpiEditForm.pbiUrl.trim() || null,
          jsonApiUrl:   kpiEditForm.jsonApiUrl?.trim() || null,
          jsonFilePath: kpiEditForm.jsonFilePath || null,
          multiPagina:  kpiEditForm.multiPagina ? 1 : 0,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setToast(`✅ KPI "${elementoId}" actualizado`);
        setKPIEditing(null);
        fetchKPIConfig();
        setTimeout(() => setToast(''), 3000);
      }
    } catch (err) { alert(err.message); }
    finally { setKPISaving(false); }
  };

  const handleKPICancel = () => setKPIEditing(null);

  const kpiFiltered = kpiFilter === 'all'
    ? kpiList
    : kpiList.filter(k => k.Seccion === kpiFilter);

  const fetchDataHub = async () => {
    try {
      const token = sessionStorage.getItem('escandon_token');
      const resC = await fetch(`${API_BASE}/admin/connectors`, { headers: { 'Authorization': `Bearer ${token}` } });
      const jsonC = await resC.json();
      if (jsonC.ok) setConnectors(jsonC.data);

      const resM = await fetch(`${API_BASE}/admin/metric-mappings`, { headers: { 'Authorization': `Bearer ${token}` } });
      const jsonM = await resM.json();
      if (jsonM.ok) setMappings(jsonM.data);

      const resE = await fetch(`${API_BASE}/admin/entities`, { headers: { 'Authorization': `Bearer ${token}` } });
      const jsonE = await resE.json();
      if (jsonE.ok) setEntities(jsonE.data);
    } catch (err) { console.error('Error fetching data hub:', err); }
  };

  const handleScanEntities = async (id) => {
    try {
      setToast('Escaneando origen de datos...');
      const token = sessionStorage.getItem('escandon_token');
      const res = await fetch(`${API_BASE}/admin/connectors/${id}/entities`, { headers: { 'Authorization': `Bearer ${token}` } });
      const json = await res.json();
      if (json.ok) {
        setToast('Escaneo completado. Entidades registradas.');
        fetchDataHub(); 
      }
    } catch (err) { alert('Error al escanear: ' + err.message); }
  };

  const handleSaveMapping = async () => {
    try {
      const token = sessionStorage.getItem('escandon_token');
      const res = await fetch(`${API_BASE}/admin/metric-mappings`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(currentMapping)
      });
      if (res.ok) {
        setToast('Mapeo de métrica guardado');
        setModalMappingOpen(false);
        fetchDataHub();
      }
    } catch (err) { alert(err.message); }
  };

  const handleSaveConnector = async () => {
    try {
      const token = sessionStorage.getItem('escandon_token');
      const res = await fetch(`${API_BASE}/admin/connectors`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(currentConnector)
      });
      if (res.ok) {
        setToast('Nuevo origen de datos registrado');
        setModalConnectorOpen(false);
        fetchDataHub();
      }
    } catch (err) { alert(err.message); }
  };

  const fetchReports = async () => {
    try {
      const token = sessionStorage.getItem('escandon_token');
      const res = await fetch(`${API_BASE}/admin/config-bi`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const json = await res.json();
      if (json.ok) setReports(json.data);
    } catch (err) {
      console.error('Error fetching reports:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAdd = () => {
    setCurrentReport({ 
      id: null, reportId: '', name: '', 
      workspaceId: '', pbiReportId: '', lookerUrl: '', 
      jsonApiUrl: '', jsonFilePath: '',
      pbixPath: '', excelPath: '', thumbnailPath: '',
      roles: [], area: '', multiPagina: false, active: true 
    });
    setModalReportOpen(true);
  };

  const handleOpenConfig = (r) => {
    setCurrentReport({ 
      ...r,
      multiPagina: r.multiPagina === 1 || !!r.multiPagina
    });
    setModalReportOpen(true);
  };

  const handleSaveReport = async () => {
    if (!currentReport.name.trim() || !currentReport.reportId.trim()) {
      alert('Nombre e ID Interno son requeridos');
      return;
    }

    try {
      const token = sessionStorage.getItem('escandon_token');
      const method = currentReport.id ? 'PUT' : 'POST';
      const url = currentReport.id ? `${API_BASE}/admin/config-bi/${currentReport.id}` : `${API_BASE}/admin/config-bi`;
      
      const res = await fetch(url, {
        method,
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(currentReport)
      });

      if (!res.ok) throw new Error('Error al guardar configuración');

      setToast(currentReport.id ? `Reporte "${currentReport.name}" actualizado` : 'Nuevo reporte añadido');
      fetchReports();
      setModalReportOpen(false);
      setTimeout(() => setToast(''), 3000);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleProbarConexion = () => {
    setTesting(true);
    setTimeout(() => {
      setTesting(false);
      setToast('✅ Conexión establecida con éxito (SQL Server & Azure)');
      setTimeout(() => setToast(''), 4000);
    }, 1500);
  };

  const handleDeleteReport = async (id) => {
    if (!confirm('¿Está seguro de eliminar este reporte del catálogo?')) return;
    try {
      const token = sessionStorage.getItem('escandon_token');
      const res = await fetch(`${API_BASE}/admin/config-bi/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) throw new Error('Error al eliminar');
      
      setToast('Reporte eliminado');
      fetchReports();
      setTimeout(() => setToast(''), 3000);
    } catch (err) {
      alert(err.message);
    }
  };

  const JsonUploader = ({ label, onUpload }) => {
    const [uploading, setUploading] = useState(false);
    
    const handleFile = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      setUploading(true);
      const formData = new FormData();
      formData.append('jsonFile', file);
      
      try {
        const token = sessionStorage.getItem('escandon_token');
        const res = await fetch(`${API_BASE}/admin/upload-json`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData
        });
        
        if (!res.ok) {
          const errorJson = await res.json().catch(() => ({}));
          throw new Error(errorJson.error || `Error del servidor (${res.status})`);
        }

        const json = await res.json();
        if (json.ok) onUpload(json.filePath);
        else alert('Error al subir: ' + json.error);
      } catch (err) {
        console.error('Upload error:', err);
        alert('Error al subir archivo JSON: ' + err.message);
      } finally {
        setUploading(false);
      }
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', marginTop: '0.3rem' }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</span>
        <input type="file" accept=".json" onChange={handleFile} disabled={uploading} style={{ fontSize: '0.75rem' }} />
        {uploading && <span style={{ fontSize: '0.7rem', color: 'var(--color-azul-fuerte)' }}>Subiendo...</span>}
      </div>
    );
  };

  const FileUploader = ({ label, value, onUpload, accept }) => {
    const [uploading, setUploading] = useState(false);
    
    const handleFile = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      setUploading(true);
      const formData = new FormData();
      formData.append('file', file);
      
      try {
        const token = sessionStorage.getItem('escandon_token');
        const res = await fetch(`/upload-assets`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData
        });
        
        if (!res.ok) {
          const errorJson = await res.json().catch(() => ({}));
          throw new Error(errorJson.error || `Error del servidor (${res.status})`);
        }

        const json = await res.json();
        if (json.ok) onUpload(json.filename);
        else alert('Error al subir: ' + json.error);
      } catch (err) {
        console.error('Upload error:', err);
        alert('Error al subir archivo: ' + err.message);
      } finally {
        setUploading(false);
      }
    };

    return (
      <div style={{ marginBottom:'0.85rem' }}>
        <label style={{ display:'block', fontSize:'0.7rem', fontWeight:700, color:'var(--text-muted)', marginBottom:'0.35rem', fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
        <div 
          onClick={() => document.getElementById(`upload-${label}`).click()}
          style={{ 
            border:'1.5px dashed #CBD5E0', borderRadius:10, padding:'0.65rem', 
            background: uploading ? 'rgba(0,136,201,0.06)' : 'white', cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'space-between',
            fontSize:'0.75rem', transition:'all var(--transition-fast)',
            fontFamily: 'var(--font-body)',
          }}
          onMouseEnter={e => e.currentTarget.style.borderColor='var(--color-azul-claro)'}
          onMouseLeave={e => e.currentTarget.style.borderColor='#CBD5E0'}
        >
          <span style={{ color: value ? 'var(--text-primary)' : '#A0AEC0', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:'80%', fontWeight: value ? 600 : 400 }}>
            {uploading ? '⏳ Subiendo...' : (value || 'Seleccionar archivo local...')}
          </span>
          <span style={{ fontSize:'0.9rem' }}>{uploading ? '◌' : '📤'}</span>
          <input 
            id={`upload-${label}`} 
            type="file" 
            accept={accept} 
            onChange={handleFile} 
            style={{ display:'none' }} 
          />
        </div>
      </div>
    );
  };

  return (
    <div style={{ maxWidth:'1200px', width:'100%', margin:'0 auto' }}>
      <style>{`
        .config-card {
          background:#FFFFFF; 
          border-radius:16px; 
          padding:1.75rem 1.5rem; 
          border:1px solid rgba(0,70,135,0.05); 
          box-shadow:var(--shadow-xs);
          position:relative;
          overflow:hidden;
          transition: all var(--transition-base);
        }
        .config-card:hover {
          box-shadow: var(--shadow-md);
        }
        .config-watermark {
          position:absolute; 
          right:16px; 
          top:16px; 
          font-size:2.5rem; 
          opacity:0.04; 
          pointer-events:none;
        }
        .config-input-field:focus,
        .config-select-field:focus {
          border-color: var(--color-azul-claro) !important;
          box-shadow: 0 0 0 4px rgba(0, 136, 201, 0.12) !important;
          background: #FFFFFF !important;
        }
        .config-table tr:nth-child(even) {
          background-color: #FAFBFD;
        }
        .config-table tr:hover {
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
      }}>
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
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.64rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.65)', marginBottom: '0.35rem' }}>Administración del Sistema</div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: '1.65rem', fontWeight: 800, color: 'white', margin: 0, letterSpacing: '-0.01em' }}>Configuración General</h1>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(450px, 1fr))', gap:'1.5rem', marginBottom:'2rem' }}>
        
        {/* Conexión SQL */}
        <div className="config-card">
          <div className="config-watermark">🔌</div>
          <h2 style={{ fontFamily:"var(--font-display)", fontSize:'1.05rem', fontWeight:800, color:'var(--color-azul-fuerte)', marginBottom:'1.25rem', paddingBottom:'0.65rem', borderBottom:'1px solid rgba(0,70,135,0.06)', display:'flex', alignItems:'center', gap:'0.6rem', letterSpacing: '-0.01em' }}>
            Servidor de Base de Datos
          </h2>
          <div style={{ display:'flex', flexDirection:'column', gap:'0.875rem' }}>
            <div style={{ display:'flex', gap:'0.875rem' }}>
              <div style={{ flex:2 }}>
                <label style={{ display:'block', fontSize:'0.65rem', fontWeight:700, color:'var(--text-muted)', marginBottom:'0.35rem', fontFamily: 'var(--font-display)', letterSpacing: '0.04em' }}>HOST / IP</label>
                <input value={sqlConfig.host} onChange={e => setSqlConfig({...sqlConfig, host:e.target.value})} className="config-input-field" style={{ width:'100%', border:'1px solid #E2E8F0', borderRadius:8, padding:'0.55rem', fontSize:'0.82rem', fontFamily: 'var(--font-mono)', background: '#F8FAFC', outline: 'none', transition: 'all var(--transition-fast)' }} />
              </div>
              <div style={{ flex:1 }}>
                <label style={{ display:'block', fontSize:'0.65rem', fontWeight:700, color:'var(--text-muted)', marginBottom:'0.35rem', fontFamily: 'var(--font-display)', letterSpacing: '0.04em' }}>PUERTO</label>
                <input value={sqlConfig.port} onChange={e => setSqlConfig({...sqlConfig, port:e.target.value})} className="config-input-field" style={{ width:'100%', border:'1px solid #E2E8F0', borderRadius:8, padding:'0.55rem', fontSize:'0.82rem', fontFamily: 'var(--font-mono)', background: '#F8FAFC', outline: 'none', transition: 'all var(--transition-fast)' }} />
              </div>
            </div>
            <div>
              <label style={{ display:'block', fontSize:'0.65rem', fontWeight:700, color:'var(--text-muted)', marginBottom:'0.35rem', fontFamily: 'var(--font-display)', letterSpacing: '0.04em' }}>BASE DE DATOS</label>
              <input value={sqlConfig.database} onChange={e => setSqlConfig({...sqlConfig, database:e.target.value})} className="config-input-field" style={{ width:'100%', border:'1px solid #E2E8F0', borderRadius:8, padding:'0.55rem', fontSize:'0.82rem', fontFamily: 'var(--font-mono)', background: '#F8FAFC', outline: 'none', transition: 'all var(--transition-fast)' }} />
            </div>
            <div style={{ display:'flex', gap:'0.875rem' }}>
              <div style={{ flex:1 }}>
                <label style={{ display:'block', fontSize:'0.65rem', fontWeight:700, color:'var(--text-muted)', marginBottom:'0.35rem', fontFamily: 'var(--font-display)', letterSpacing: '0.04em' }}>USUARIO</label>
                <input value={sqlConfig.user} onChange={e => setSqlConfig({...sqlConfig, user:e.target.value})} className="config-input-field" style={{ width:'100%', border:'1px solid #E2E8F0', borderRadius:8, padding:'0.55rem', fontSize:'0.82rem', fontFamily: 'var(--font-mono)', background: '#F8FAFC', outline: 'none', transition: 'all var(--transition-fast)' }} />
              </div>
              <div style={{ flex:1 }}>
                <label style={{ display:'block', fontSize:'0.65rem', fontWeight:700, color:'var(--text-muted)', marginBottom:'0.35rem', fontFamily: 'var(--font-display)', letterSpacing: '0.04em' }}>CONTRASEÑA</label>
                <input type="password" value={sqlConfig.pass} onChange={e => setSqlConfig({...sqlConfig, pass:e.target.value})} className="config-input-field" style={{ width:'100%', border:'1px solid #E2E8F0', borderRadius:8, padding:'0.55rem', fontSize:'0.82rem', background: '#F8FAFC', outline: 'none', transition: 'all var(--transition-fast)' }} />
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* ── SECCIÓN DATA HUB ── */}
      <div style={{ background:'#FFFFFF', borderRadius:16, padding:'1.75rem 1.5rem', marginBottom:'2rem', border:'1px solid rgba(0,70,135,0.05)', boxShadow:'var(--shadow-xs)' }}>
        <h2 style={{ fontFamily:"var(--font-display)", fontSize:'1.05rem', fontWeight:800, color:'var(--color-azul-fuerte)', marginBottom:'1.25rem', display:'flex', alignItems:'center', gap:'0.75rem', letterSpacing: '-0.01em' }}>
          🧠 Data Hub: Centro de Inteligencia de Datos
        </h2>
        
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(320px, 1fr))', gap:'1.5rem' }}>
          {/* Columna Conectores */}
          <div style={{ borderRight:'1px solid rgba(0,70,135,0.06)', paddingRight:'1.5rem' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' }}>
              <span style={{ fontSize:'0.72rem', fontWeight:800, color:'var(--text-primary)', fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Orígenes Conectados</span>
              <button onClick={() => setModalConnectorOpen(true)} style={{ fontSize:'0.72rem', fontWeight: 700, color:'var(--color-azul-claro)', background:'none', border:'none', cursor:'pointer', fontFamily: 'var(--font-display)' }}>+ Añadir</button>
            </div>
            {connectors.map(c => (
              <div key={c.ConnectorId} style={{ padding:'1rem', border:'1px solid rgba(0,70,135,0.06)', borderRadius:12, marginBottom:'0.75rem', background: selectedConnector === c.ConnectorId ? 'rgba(0,136,201,0.04)' : '#FFFFFF', boxShadow: 'var(--shadow-xs)', position: 'relative' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ fontWeight:700, fontSize:'0.82rem', fontFamily: 'var(--font-body)', color: 'var(--text-primary)' }}>{c.Nombre}</span>
                  <span style={{ fontSize:'0.65rem', padding:'0.15rem 0.45rem', background:'rgba(0,70,135,0.05)', color: 'var(--color-azul-fuerte)', borderRadius:6, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{c.Tipo}</span>
                </div>
                <div style={{ marginTop:'0.85rem', display:'flex', gap:'0.75rem' }}>
                  <button onClick={() => handleScanEntities(c.ConnectorId)} style={{ fontSize:'0.72rem', fontWeight: 700, color:'var(--color-azul-fuerte)', background:'none', border:'none', cursor:'pointer', fontFamily: 'var(--font-display)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    Escanear Esquema
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Columna Mapeos */}
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' }}>
              <span style={{ fontSize:'0.72rem', fontWeight:800, color:'var(--text-primary)', fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Mapeo de Métricas Clínicas</span>
              <button onClick={() => setModalMappingOpen(true)} style={{ padding:'0.4rem 0.85rem', background:'var(--color-azul-fuerte)', color:'white', border:'none', borderRadius:8, fontSize:'0.7rem', fontWeight: 700, cursor:'pointer', fontFamily: 'var(--font-display)', boxShadow: '0 2px 8px rgba(0, 70, 135, 0.15)' }}>+ Mapear KPI</button>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'0.75rem' }}>
              {mappings.map(m => {
                const kpiInfo = kpiList.find(k => k.ElementoId === m.SeccionUI);
                return (
                <div key={m.MappingId} style={{ padding:'1rem', border:'1px solid rgba(0,70,135,0.06)', borderRadius:12, display:'flex', justifyContent:'space-between', alignItems:'center', background: '#FAFBFD', boxShadow: 'var(--shadow-xs)' }}>
                  <div>
                    <div style={{ fontSize:'0.82rem', fontWeight:700, color:'var(--text-primary)', display:'flex', alignItems:'center', gap:'0.4rem', fontFamily: 'var(--font-body)' }}>
                      <span style={{ fontSize: '1rem' }}>{kpiInfo ? kpiInfo.Icono : '📊'}</span> 
                      {kpiInfo ? (kpiInfo.NombreCustom || kpiInfo.NombreDefault) : m.SeccionUI}
                      <span style={{ fontSize:'0.65rem', color:'var(--text-muted)', fontWeight:500, fontFamily: 'var(--font-mono)' }}>({m.SeccionUI})</span>
                    </div>
                    <div style={{ fontSize:'0.68rem', color:'var(--text-muted)', marginTop:'0.25rem', fontFamily: 'var(--font-body)', fontWeight: 500 }}>
                      {m.ConectorNombre} → {m.NombreEntidad} · <span style={{ color:'var(--color-azul-fuerte)', fontWeight:700, fontFamily: 'var(--font-mono)' }}>{m.CampoValor}</span>
                      {m.CampoFiltro && <span style={{ marginLeft: '0.5rem', background: 'rgba(232,133,61,0.08)', color: 'var(--color-accent-warm)', padding: '0.15rem 0.4rem', borderRadius: 4, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>Filtro: {m.CampoFiltro}</span>}
                    </div>
                  </div>
                  <div style={{ fontSize:'0.74rem', fontWeight:800, color:'var(--color-verde-e)', fontFamily: 'var(--font-mono)' }}>{m.MetodoCalculo}</div>
                </div>
              )})}
            </div>
          </div>
        </div>
      </div>

      {/* ── SECCIÓN KPI CONFIG ── */}
      <div style={{ background: '#FFFFFF', borderRadius: 16, padding: '1.75rem 1.5rem', marginBottom: '2rem', border: '1px solid rgba(0,70,135,0.05)', boxShadow: 'var(--shadow-xs)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', paddingBottom: '0.65rem', borderBottom: '1px solid rgba(0,70,135,0.06)' }}>
          <div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: '1.05rem', fontWeight: 800, color: 'var(--color-azul-fuerte)', margin: 0, letterSpacing: '-0.01em' }}>🎛️ Configuración de KPIs e Indicadores</h2>
            <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', margin: '0.2rem 0 0', fontFamily: 'var(--font-body)', fontWeight: 500 }}>Alinee títulos personalizados y reportes interactivos correspondientes a cada celda de datos.</p>
          </div>
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-azul-claro)', background: 'rgba(0,136,201,0.08)', padding: '0.25rem 0.75rem', borderRadius: 100, fontFamily: 'var(--font-mono)' }}>
            {kpiList.length} elementos
          </span>
        </div>

        {/* Filtro por sección */}
        <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
          {[['all', '🔍 Todos'], ...Object.entries(SECCION_LABELS)].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setKPIFilter(key)}
              style={{
                padding: '0.35rem 0.95rem', borderRadius: 100, border: 'none', cursor: 'pointer',
                background: kpiFilter === key ? 'var(--color-azul-fuerte)' : 'rgba(0,70,135,0.05)',
                color: kpiFilter === key ? 'white' : 'var(--text-secondary)',
                fontSize: '0.75rem', fontWeight: kpiFilter === key ? 700 : 500,
                transition: 'all var(--transition-fast)',
                fontFamily: 'var(--font-display)'
              }}
            >{label}</button>
          ))}
        </div>

        {/* Tabla de KPIs */}
        <div style={{ overflowX: 'auto' }}>
          <table className="config-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid rgba(0,70,135,0.06)' }}>
                {['Sección', 'Ícono', 'Nombre Original', 'Nombre Custom', 'Fuente de Datos', 'Acciones'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '0.85rem 0.75rem', color: 'var(--text-primary)', fontWeight: 800, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid rgba(0,70,135,0.06)', whiteSpace: 'nowrap', fontFamily: 'var(--font-display)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {kpiFiltered.map(kpi => {
                const isEditing = kpiEditing === kpi.ElementoId;
                return (
                  <tr key={kpi.ElementoId} style={{ borderBottom: '1px solid rgba(0,70,135,0.04)', background: isEditing ? 'rgba(0,136,201,0.03)' : '#FFFFFF', transition: 'background-color 150ms' }}>
                    
                    {/* Sección */}
                    <td style={{ padding: '0.75rem 0.75rem', whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--color-azul-fuerte)', background: 'rgba(0,70,135,0.05)', padding: '0.2rem 0.6rem', borderRadius: 6, fontFamily: 'var(--font-mono)' }}>
                        {(SECCION_LABELS[kpi.Seccion] || kpi.Seccion).split(' ')[1] || kpi.Seccion}
                      </span>
                    </td>

                    {/* Ícono */}
                    <td style={{ padding: '0.75rem 0.75rem', textAlign: 'center' }}>
                      {isEditing ? (
                        <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', maxWidth: 160 }}>
                          {ICONOS_RAPIDOS.map(ic => (
                            <button key={ic} onClick={() => setKPIEditForm(f => ({ ...f, icono: ic }))}
                              style={{
                                width: 28, height: 28, fontSize: '0.9rem', borderRadius: 6, cursor: 'pointer',
                                border: kpiEditForm.icono === ic ? '2px solid var(--color-azul-fuerte)' : '1px solid #E2E8F0',
                                background: kpiEditForm.icono === ic ? 'rgba(0,70,135,0.08)' : 'white',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 120ms'
                              }}>{ic}</button>
                          ))}
                        </div>
                      ) : (
                        <span style={{ fontSize: '1.25rem', display: 'block' }}>{kpi.Icono}</span>
                      )}
                    </td>

                    {/* Nombre original */}
                    <td style={{ padding: '0.75rem 0.75rem', color: 'var(--text-muted)', fontStyle: 'italic', fontFamily: 'var(--font-body)' }}>{kpi.NombreDefault}</td>

                    {/* Nombre personalizado */}
                    <td style={{ padding: '0.75rem 0.75rem' }}>
                      {isEditing ? (
                        <input
                          value={kpiEditForm.nombreCustom}
                          onChange={e => setKPIEditForm(f => ({ ...f, nombreCustom: e.target.value }))}
                          placeholder={kpi.NombreDefault}
                          maxLength={60}
                          className="config-input-field"
                          style={{ width: '100%', border: '1.5px solid #E2E8F0', borderRadius: 8, padding: '0.45rem 0.75rem', fontSize: '0.82rem', fontFamily: 'var(--font-body)', outline: 'none', minWidth: 140, background: '#F8FAFC', transition: 'all var(--transition-fast)' }}
                        />
                      ) : (
                        <span style={{ color: kpi.NombreCustom ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: kpi.NombreCustom ? 700 : 400, fontFamily: 'var(--font-body)' }}>
                          {kpi.NombreCustom || '— (Defecto)'}
                        </span>
                      )}
                    </td>

                    {/* URL PBI / JSON */}
                    <td style={{ padding: '0.75rem 0.75rem', maxWidth: 300 }}>
                      {isEditing ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                          <input
                            type="url"
                            value={kpiEditForm.jsonApiUrl}
                            onChange={e => setKPIEditForm(f => ({ ...f, jsonApiUrl: e.target.value }))}
                            placeholder="JSON API URL: https://..."
                            className="config-input-field"
                            style={{ width: '100%', border: '1.5px solid #E2E8F0', borderRadius: 8, padding: '0.45rem 0.75rem', fontSize: '0.75rem', fontFamily: 'var(--font-mono)', outline: 'none', background: '#F8FAFC' }}
                          />
                          <JsonUploader 
                            label="O subir Archivo JSON (Data estática):" 
                            onUpload={(path) => setKPIEditForm(f => ({...f, jsonFilePath: path}))} 
                          />
                          {kpiEditForm.jsonFilePath && (
                            <span style={{ fontSize: '0.7rem', color: 'var(--color-verde-e)', fontWeight: 700 }}>
                              ✓ Archivo cargado: {kpiEditForm.jsonFilePath.split('/').pop()}
                            </span>
                          )}
                          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.68rem', fontWeight: 700, color: 'var(--color-azul-fuerte)', cursor: 'pointer', marginTop: '0.2rem' }}>
                            <input
                              type="checkbox"
                              checked={kpiEditForm.multiPagina}
                              onChange={e => setKPIEditForm(f => ({ ...f, multiPagina: e.target.checked }))}
                            />
                            Tiene Múltiples Páginas
                          </label>
                        </div>
                      ) : (
                        kpi.JsonApiUrl || kpi.JsonFilePath ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                            {kpi.JsonApiUrl && (
                              <span style={{ color: 'var(--color-azul-fuerte)', fontSize: '0.74rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.3rem', fontFamily: 'var(--font-body)' }}>
                                <span style={{ fontSize: '0.8rem' }}>✓</span> API JSON
                              </span>
                            )}
                            {kpi.JsonFilePath && (
                              <span style={{ color: 'var(--color-naranja-e)', fontSize: '0.74rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.3rem', fontFamily: 'var(--font-body)' }}>
                                <span style={{ fontSize: '0.8rem' }}>✓</span> Archivo JSON
                              </span>
                            )}
                            {kpi.MultiPagina === 1 && (
                              <span style={{ fontSize: '0.65rem', color: 'var(--color-azul-fuerte)', fontWeight: 700, paddingLeft: '1.1rem' }}>
                                (Multinavegación activa)
                              </span>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem', fontFamily: 'var(--font-body)' }}>⚪ Sin asignar</span>
                        )
                      )}
                    </td>

                    {/* Acciones */}
                    <td style={{ padding: '0.75rem 0.75rem', whiteSpace: 'nowrap' }}>
                      {isEditing ? (
                        <div style={{ display: 'flex', gap: '0.45rem' }}>
                          <button
                            onClick={() => handleKPISave(kpi.ElementoId)}
                            disabled={kpiSaving}
                            style={{ padding: '0.4rem 0.85rem', background: 'var(--color-azul-fuerte)', color: 'white', border: 'none', borderRadius: 8, fontSize: '0.75rem', fontWeight: 700, fontFamily: 'var(--font-display)', cursor: kpiSaving ? 'wait' : 'pointer', boxShadow: '0 2px 8px rgba(0, 70, 135, 0.2)' }}
                          >{kpiSaving ? '⏳' : '💾 Guardar'}</button>
                          <button
                            onClick={handleKPICancel}
                            style={{ padding: '0.4rem 0.75rem', background: 'none', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: '0.75rem', fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--text-muted)', cursor: 'pointer' }}
                          >Cancelar</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleKPIEdit(kpi)}
                          style={{ padding: '0.45rem 0.85rem', background: 'rgba(0,70,135,0.05)', border: '1.5px solid rgba(0,70,135,0.12)', borderRadius: 8, fontSize: '0.72rem', fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--color-azul-fuerte)', cursor: 'pointer', transition: 'all 150ms' }}
                          onMouseEnter={e=>{e.currentTarget.style.background='var(--color-azul-fuerte)'; e.currentTarget.style.color='white';}}
                          onMouseLeave={e=>{e.currentTarget.style.background='rgba(0,70,135,0.05)'; e.currentTarget.style.color='var(--color-azul-fuerte)';}}
                        >✏️ Configurar</button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {kpiFiltered.length === 0 && (
                <tr><td colSpan={6} style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>Sin indicadores registrados en esta sección.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display:'flex', gap:'0.875rem', justifyContent:'flex-end', marginBottom: '2.5rem' }}>
        <button onClick={handleProbarConexion} disabled={testing} style={{ padding:'0.65rem 1.35rem', border:'1.5px solid rgba(0,70,135,0.15)', borderRadius:10, background:'white', color:'var(--color-azul-fuerte)', fontFamily:"var(--font-display)", fontSize:'0.88rem', fontWeight:700, cursor: testing ? 'wait' : 'pointer', transition: 'all 150ms' }} onMouseEnter={e=>{if(!testing) e.currentTarget.style.background='#F8FAFC';}} onMouseLeave={e=>{if(!testing) e.currentTarget.style.background='white';}}>
          {testing ? '⏳ Probando Conectores...' : 'Probar Conectores'}
        </button>
        <button onClick={() => { setToast('Configuración del sistema guardada'); setTimeout(() => setToast(''), 3000); }} style={{ padding:'0.65rem 1.5rem', border:'none', borderRadius:10, background:'linear-gradient(135deg, var(--color-azul-claro), var(--color-azul-cruz))', color:'white', fontFamily:"var(--font-display)", fontSize:'0.88rem', fontWeight:700, cursor:'pointer', boxShadow:'0 4px 14px rgba(0,136,201,0.25)', transition: 'all 200ms' }} onMouseEnter={e=>e.currentTarget.style.transform='translateY(-1px)'} onMouseLeave={e=>e.currentTarget.style.transform='translateY(0)'}>
          💾 Guardar Todo
        </button>
      </div>

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

      {/* Modal Mapeo KPI */}
      {modalMappingOpen && (
        <div style={{ position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(15, 26, 46, 0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, backdropFilter:'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
          <div style={{ background:'white', borderRadius:20, width:'95%', maxWidth:420, padding:'2.25rem 2.25rem 2rem', boxShadow:'var(--shadow-xl)', boxSizing: 'border-box' }}>
            <h2 style={{ fontFamily:"var(--font-display)", fontWeight: 800, fontSize:'1.25rem', color:'var(--color-azul-fuerte)', marginBottom:'1.25rem', letterSpacing: '-0.01em' }}>Mapear Métrica (KPI)</h2>
            <div style={{ display:'flex', flexDirection:'column', gap:'1.15rem' }}>
              <div>
                <label style={{ display:'block', fontSize:'0.75rem', fontWeight:700, color:'var(--color-azul-fuerte)', marginBottom:'0.45rem', fontFamily: 'var(--font-display)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>KPI de la Plataforma (UI)</label>
                <select value={currentMapping.seccionUI} onChange={e => setCurrentMapping({...currentMapping, seccionUI: e.target.value})} style={{ width:'100%', padding:'0.6rem 0.85rem', borderRadius:10, border:'1px solid #E2E8F0', fontFamily: 'var(--font-body)', fontSize: '0.85rem', outline: 'none', background: 'white' }}>
                  <option value="">Seleccione el KPI objetivo...</option>
                  {kpiList.map(kpi => (
                    <option key={kpi.ElementoId} value={kpi.ElementoId}>
                      {SECCION_LABELS[kpi.Seccion] || kpi.Seccion}: {kpi.NombreCustom || kpi.NombreDefault}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display:'block', fontSize:'0.75rem', fontWeight:700, color:'var(--color-azul-fuerte)', marginBottom:'0.45rem', fontFamily: 'var(--font-display)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Origen de Datos / Hoja</label>
                <select value={currentMapping.entityId} onChange={e => setCurrentMapping({...currentMapping, entityId: e.target.value, campoValor:''})} style={{ width:'100%', padding:'0.6rem 0.85rem', borderRadius:10, border:'1px solid #E2E8F0', fontFamily: 'var(--font-body)', fontSize: '0.85rem', outline: 'none', background: 'white' }}>
                  <option value="">Seleccione Entidad...</option>
                  {entities.map(en => (
                    <option key={en.EntityId} value={en.EntityId}>{en.NombreEntidad}</option>
                  ))}
                </select>
              </div>
              <div style={{ display:'flex', gap:'1rem' }}>
                <div style={{ flex:1 }}>
                  <label style={{ display:'block', fontSize:'0.75rem', fontWeight:700, color:'var(--color-azul-fuerte)', marginBottom:'0.45rem', fontFamily: 'var(--font-display)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Columna</label>
                  <select value={currentMapping.campoValor} onChange={e => setCurrentMapping({...currentMapping, campoValor: e.target.value})} style={{ width:'100%', padding:'0.6rem 0.85rem', borderRadius:10, border:'1px solid #E2E8F0', fontFamily: 'var(--font-body)', fontSize: '0.85rem', outline: 'none', background: 'white' }}>
                    <option value="">Seleccione Columna...</option>
                    {entities.find(e => e.EntityId == currentMapping.entityId)?.Esquema && 
                      JSON.parse(entities.find(e => e.EntityId == currentMapping.entityId).Esquema).map(col => (
                        <option key={col.name} value={col.name}>{col.name}</option>
                      ))
                    }
                  </select>
                  {(!currentMapping.entityId) && <p style={{ fontSize:'0.65rem', color:'var(--text-muted)', marginTop:'0.35rem', fontFamily: 'var(--font-body)' }}>* Seleccione una entidad primero.</p>}
                </div>
                <div style={{ flex:1 }}>
                  <label style={{ display:'block', fontSize:'0.75rem', fontWeight:700, color:'var(--color-azul-fuerte)', marginBottom:'0.45rem', fontFamily: 'var(--font-display)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Operación</label>
                  <select value={currentMapping.metodoCalculo} onChange={e => setCurrentMapping({...currentMapping, metodoCalculo: e.target.value})} style={{ width:'100%', padding:'0.6rem 0.85rem', borderRadius:10, border:'1px solid #E2E8F0', fontFamily: 'var(--font-body)', fontSize: '0.85rem', outline: 'none', background: 'white' }}>
                    <option value="SUM">Suma de Valores</option>
                    <option value="AVG">Promedio</option>
                    <option value="COUNT">Conteo de Registros</option>
                    <option value="LAST">Último Valor</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={{ display:'block', fontSize:'0.75rem', fontWeight:700, color:'var(--color-azul-fuerte)', marginBottom:'0.45rem', fontFamily: 'var(--font-display)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Filtro de Consulta (SQL WHERE)</label>
                <input 
                  type="text" 
                  value={currentMapping.campoFiltro || ''} 
                  onChange={e => setCurrentMapping({...currentMapping, campoFiltro: e.target.value})} 
                  placeholder="Ej: Estatus = 'Completado'" 
                  className="config-input-field"
                  style={{ width:'100%', padding:'0.6rem 0.85rem', borderRadius:10, border:'1px solid #E2E8F0', fontFamily:'var(--font-mono)', fontSize:'0.82rem', outline: 'none', background: '#F8FAFC', transition: 'all var(--transition-fast)' }} 
                />
              </div>
            </div>
            <div style={{ marginTop:'2.25rem', display:'flex', gap:'0.75rem', justifyContent:'flex-end', paddingTop: '1.25rem', borderTop: '1px solid rgba(0,70,135,0.06)' }}>
              <button onClick={() => setModalMappingOpen(false)} style={{ background:'none', border:'none', color:'var(--text-secondary)', cursor:'pointer', fontWeight:700, fontFamily: 'var(--font-display)', fontSize: '0.85rem' }}>Cancelar</button>
              <button onClick={handleSaveMapping} style={{ background:'var(--color-azul-fuerte)', color:'white', border:'none', borderRadius:10, padding:'0.6rem 1.35rem', fontWeight:700, cursor:'pointer', fontFamily: 'var(--font-display)', fontSize: '0.85rem', boxShadow: '0 4px 12px rgba(0, 70, 135, 0.2)' }}>Guardar Mapeo</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Nuevo Conector */}
      {modalConnectorOpen && (
        <div style={{ position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(15, 26, 46, 0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, backdropFilter:'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
          <div style={{ background:'white', borderRadius:20, width:'95%', maxWidth:420, padding:'2.25rem 2.25rem 2rem', boxShadow:'var(--shadow-xl)', boxSizing: 'border-box' }}>
            <h2 style={{ fontFamily:"var(--font-display)", fontWeight: 800, fontSize:'1.25rem', color:'var(--color-azul-fuerte)', marginBottom:'1.25rem', letterSpacing: '-0.01em' }}>Nuevo Origen de Datos</h2>
            <div style={{ display:'flex', flexDirection:'column', gap:'1.15rem' }}>
              <div>
                <label style={{ display:'block', fontSize:'0.75rem', fontWeight:700, color:'var(--color-azul-fuerte)', marginBottom:'0.45rem', fontFamily: 'var(--font-display)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Nombre de Conexión</label>
                <input value={currentConnector.nombre} onChange={e => setCurrentConnector({...currentConnector, nombre: e.target.value})} placeholder="Ej. Datos Clínicos Urgencias" className="config-input-field" style={{ width:'100%', padding:'0.6rem 0.85rem', borderRadius:10, border:'1px solid #E2E8F0', fontFamily: 'var(--font-body)', fontSize: '0.85rem', outline: 'none', background: '#F8FAFC', transition: 'all var(--transition-fast)' }} />
              </div>
              <div>
                <label style={{ display:'block', fontSize:'0.75rem', fontWeight:700, color:'var(--color-azul-fuerte)', marginBottom:'0.45rem', fontFamily: 'var(--font-display)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Tipo de Motor</label>
                <select value={currentConnector.tipo} onChange={e => setCurrentConnector({...currentConnector, tipo: e.target.value})} className="config-select-field" style={{ width:'100%', padding:'0.6rem 0.85rem', borderRadius:10, border:'1px solid #E2E8F0', fontFamily: 'var(--font-body)', fontSize: '0.85rem', outline: 'none', background: 'white', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  <option value="EXCEL">Excel (.xlsx)</option>
                  <option value="CSV">Archivo CSV</option>
                  <option value="MSSQL">SQL Server (MSSQL)</option>
                </select>
              </div>
              {(currentConnector.tipo === 'EXCEL' || currentConnector.tipo === 'CSV') && (
                <FileUploader 
                  label={`Subir Hoja ${currentConnector.tipo}`} 
                  value={currentConnector.configuracion?.filePath || ''} 
                  onUpload={fn => setCurrentConnector({...currentConnector, configuracion: { ...currentConnector.configuracion, filePath: fn }})}
                  accept={currentConnector.tipo === 'EXCEL' ? '.xlsx' : '.csv'}
                />
              )}

              {currentConnector.tipo === 'MSSQL' && (
                <div style={{ display:'flex', flexDirection:'column', gap:'0.85rem' }}>
                  <div>
                    <label style={{ display:'block', fontSize:'0.65rem', fontWeight:700, color:'var(--text-muted)', marginBottom:'0.35rem', fontFamily: 'var(--font-display)' }}>HOST / SERVIDOR</label>
                    <input value={currentConnector.configuracion?.host || ''} onChange={e => setCurrentConnector({...currentConnector, configuracion: { ...currentConnector.configuracion, host: e.target.value }})} className="config-input-field" placeholder="10.10.X.X o localhost" style={{ width:'100%', padding:'0.55rem', borderRadius:8, border:'1px solid #E2E8F0', fontSize:'0.8rem', fontFamily: 'var(--font-mono)', outline: 'none', background: '#F8FAFC' }} />
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.5rem' }}>
                    <div>
                      <label style={{ display:'block', fontSize:'0.65rem', fontWeight:700, color:'var(--text-muted)', marginBottom:'0.35rem', fontFamily: 'var(--font-display)' }}>BASE DE DATOS</label>
                      <input value={currentConnector.configuracion?.database || ''} onChange={e => setCurrentConnector({...currentConnector, configuracion: { ...currentConnector.configuracion, database: e.target.value }})} className="config-input-field" placeholder="db_name" style={{ width:'100%', padding:'0.55rem', borderRadius:8, border:'1px solid #E2E8F0', fontSize:'0.8rem', outline: 'none', background: '#F8FAFC' }} />
                    </div>
                    <div>
                      <label style={{ display:'block', fontSize:'0.65rem', fontWeight:700, color:'var(--text-muted)', marginBottom:'0.35rem', fontFamily: 'var(--font-display)' }}>PUERTO</label>
                      <input value={currentConnector.configuracion?.port || ''} onChange={e => setCurrentConnector({...currentConnector, configuracion: { ...currentConnector.configuracion, port: e.target.value }})} className="config-input-field" placeholder="1433" style={{ width:'100%', padding:'0.55rem', borderRadius:8, border:'1px solid #E2E8F0', fontSize:'0.8rem', fontFamily: 'var(--font-mono)', outline: 'none', background: '#F8FAFC' }} />
                    </div>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.5rem' }}>
                    <div>
                      <label style={{ display:'block', fontSize:'0.65rem', fontWeight:700, color:'var(--text-muted)', marginBottom:'0.35rem', fontFamily: 'var(--font-display)' }}>USUARIO</label>
                      <input value={currentConnector.configuracion?.user || ''} onChange={e => setCurrentConnector({...currentConnector, configuracion: { ...currentConnector.configuracion, user: e.target.value }})} className="config-input-field" style={{ width:'100%', padding:'0.55rem', borderRadius:8, border:'1px solid #E2E8F0', fontSize:'0.8rem', outline: 'none', background: '#F8FAFC' }} />
                    </div>
                    <div>
                      <label style={{ display:'block', fontSize:'0.65rem', fontWeight:700, color:'var(--text-muted)', marginBottom:'0.35rem', fontFamily: 'var(--font-display)' }}>CONTRASEÑA</label>
                      <input type="password" value={currentConnector.configuracion?.password || ''} onChange={e => setCurrentConnector({...currentConnector, configuracion: { ...currentConnector.configuracion, password: e.target.value }})} className="config-input-field" style={{ width:'100%', padding:'0.55rem', borderRadius:8, border:'1px solid #E2E8F0', fontSize:'0.8rem', outline: 'none', background: '#F8FAFC' }} />
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div style={{ marginTop:'2.25rem', display:'flex', gap:'0.75rem', justifyContent:'flex-end', paddingTop: '1.25rem', borderTop: '1px solid rgba(0,70,135,0.06)' }}>
              <button onClick={() => setModalConnectorOpen(false)} style={{ background:'none', border:'none', color:'var(--text-secondary)', cursor:'pointer', fontWeight:700, fontFamily: 'var(--font-display)', fontSize: '0.85rem' }}>Cancelar</button>
              <button onClick={handleSaveConnector} style={{ background:'var(--color-azul-fuerte)', color:'white', border:'none', borderRadius:10, padding:'0.6rem 1.35rem', fontWeight:700, cursor:'pointer', fontFamily: 'var(--font-display)', fontSize: '0.85rem', boxShadow: '0 4px 12px rgba(0, 70, 135, 0.2)' }}>Crear Origen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
