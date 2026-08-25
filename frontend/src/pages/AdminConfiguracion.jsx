/**
 * AdminConfiguracion.jsx — Configuración del sistema
 * Hospital Escandón BI Platform v4.0
 * Rediseño premium con identidad de marca y consistencia visual
 */
import { useState, useEffect } from 'react';

const API_BASE = '/api';

const SECCION_LABELS = {
  directivo: '💼 Directivo',
  mando:     '🎯 Mando',
  area:      '🏥 Tablero de Área',
  stats:     '📈 Estadísticas',
  audit:     '📋 Auditoría',
  home:      '🏠 Inicio'
};

const getSeccionBadge = (sec) => {
  if (!sec) return 'General';
  const label = SECCION_LABELS[sec.toLowerCase()] || sec;
  const parts = label.split(' ');
  return parts.length > 1 ? parts.slice(1).join(' ') : label;
};

const ICONOS_RAPIDOS = ['📊','🏥','❤️','🔪','📅','🚪','📦','💼','⚙️','🎯','⭐','📋','👤','♀️','📉','👶','✅','⚠️','💰','🛏️','🔄'];

function JsonUploader({ label, onUpload }) {
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
}

function FileUploader({ label, value, onUpload, accept }) {
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
    <div style={{ marginBottom: '0.85rem' }}>
      <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.35rem', fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
      <div 
        onClick={() => document.getElementById(`upload-${label}`).click()}
        style={{ 
          border: '1.5px dashed #CBD5E0', borderRadius: 10, padding: '0.65rem', 
          background: uploading ? 'rgba(0,136,201,0.06)' : 'white', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontSize: '0.75rem', transition: 'all var(--transition-fast)',
          fontFamily: 'var(--font-body)',
        }}
        onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--color-azul-claro)'}
        onMouseLeave={e => e.currentTarget.style.borderColor = '#CBD5E0'}
      >
        <span style={{ color: value ? 'var(--text-primary)' : '#A0AEC0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '80%', fontWeight: value ? 600 : 400 }}>
          {uploading ? '⏳ Subiendo...' : (value || 'Seleccionar archivo local...')}
        </span>
        <span style={{ fontSize: '0.9rem' }}>{uploading ? '◌' : '📤'}</span>
        <input 
          id={`upload-${label}`} 
          type="file" 
          accept={accept} 
          onChange={handleFile} 
          style={{ display: 'none' }} 
        />
      </div>
    </div>
  );
}

export default function AdminConfiguracion() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
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

  useEffect(() => {
    fetchReports();
    fetchKPIConfig();
  }, []);

  const fetchKPIConfig = async () => {
    try {
      const token = sessionStorage.getItem('escandon_token');
      const res = await fetch(`${API_BASE}/admin/kpi-config`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const json = await res.json();
      if (json.ok && Array.isArray(json.data)) {
        setKPIList(json.data);
      }
    } catch (err) {
      console.error('Error fetching KPI config:', err);
    }
  };

  const handleKPIEdit = (kpi) => {
    const elId = kpi.ElementoId || kpi.elementoid || kpi.id;
    setKPIEditing(elId);
    setKPIEditForm({
      nombreCustom: kpi.NombreCustom || kpi.nombrecustom || '',
      icono:        kpi.Icono || kpi.icono || '📊',
      pbiUrl:       kpi.PBIUrl || kpi.pbiurl || '',
      jsonApiUrl:   kpi.JsonApiUrl || kpi.jsonapiurl || '',
      jsonFilePath: kpi.JsonFilePath || kpi.jsonfilepath || '',
      multiPagina:  kpi.MultiPagina === 1 || kpi.multipagina === 1 || !!kpi.MultiPagina || !!kpi.multipagina,
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
    } catch (err) {
      alert(err.message);
    } finally {
      setKPISaving(false);
    }
  };

  const handleKPICancel = () => setKPIEditing(null);

  const kpiFiltered = kpiFilter === 'all'
    ? kpiList
    : kpiList.filter(k => (k.Seccion || k.seccion || '').toLowerCase() === kpiFilter.toLowerCase());

  const fetchReports = async () => {
    try {
      const token = sessionStorage.getItem('escandon_token');
      const res = await fetch(`${API_BASE}/admin/config-bi`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const json = await res.json();
      if (json.ok && Array.isArray(json.data)) {
        setReports(json.data);
      }
    } catch (err) {
      console.error('Error fetching reports:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 'var(--content-max, 1200px)', width: '100%', margin: '0 auto' }}>
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
                background: kpiFilter.toLowerCase() === key.toLowerCase() ? 'var(--color-azul-fuerte)' : 'rgba(0,70,135,0.05)',
                color: kpiFilter.toLowerCase() === key.toLowerCase() ? 'white' : 'var(--text-secondary)',
                fontSize: '0.75rem', fontWeight: kpiFilter.toLowerCase() === key.toLowerCase() ? 700 : 500,
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
                const elementoId = kpi.ElementoId || kpi.elementoid || kpi.id;
                const seccion = kpi.Seccion || kpi.seccion || '';
                const nombreDefault = kpi.NombreDefault || kpi.nombredefault || '';
                const nombreCustom = kpi.NombreCustom || kpi.nombrecustom || '';
                const icono = kpi.Icono || kpi.icono || '📊';
                const jsonApiUrl = kpi.JsonApiUrl || kpi.jsonapiurl || '';
                const jsonFilePath = kpi.JsonFilePath || kpi.jsonfilepath || '';
                const multiPagina = kpi.MultiPagina === 1 || kpi.multipagina === 1;
                const isEditing = kpiEditing === elementoId;

                return (
                  <tr key={elementoId} style={{ borderBottom: '1px solid rgba(0,70,135,0.04)', background: isEditing ? 'rgba(0,136,201,0.03)' : '#FFFFFF', transition: 'background-color 150ms' }}>
                    
                    {/* Sección */}
                    <td style={{ padding: '0.75rem 0.75rem', whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--color-azul-fuerte)', background: 'rgba(0,70,135,0.05)', padding: '0.2rem 0.6rem', borderRadius: 6, fontFamily: 'var(--font-mono)' }}>
                        {getSeccionBadge(seccion)}
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
                        <span style={{ fontSize: '1.25rem', display: 'block' }}>{icono}</span>
                      )}
                    </td>

                    {/* Nombre original */}
                    <td style={{ padding: '0.75rem 0.75rem', color: 'var(--text-muted)', fontStyle: 'italic', fontFamily: 'var(--font-body)' }}>{nombreDefault}</td>

                    {/* Nombre personalizado */}
                    <td style={{ padding: '0.75rem 0.75rem' }}>
                      {isEditing ? (
                        <input
                          value={kpiEditForm.nombreCustom}
                          onChange={e => setKPIEditForm(f => ({ ...f, nombreCustom: e.target.value }))}
                          placeholder={nombreDefault}
                          maxLength={60}
                          className="config-input-field"
                          style={{ width: '100%', border: '1.5px solid #E2E8F0', borderRadius: 8, padding: '0.45rem 0.75rem', fontSize: '0.82rem', fontFamily: 'var(--font-body)', outline: 'none', minWidth: 140, background: '#F8FAFC', transition: 'all var(--transition-fast)' }}
                        />
                      ) : (
                        <span style={{ color: nombreCustom ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: nombreCustom ? 700 : 400, fontFamily: 'var(--font-body)' }}>
                          {nombreCustom || '— (Defecto)'}
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
                              ✓ Archivo cargado: {String(kpiEditForm.jsonFilePath).split('/').pop()}
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
                        jsonApiUrl || jsonFilePath ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                            {jsonApiUrl && (
                              <span style={{ color: 'var(--color-azul-fuerte)', fontSize: '0.74rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.3rem', fontFamily: 'var(--font-body)' }}>
                                <span style={{ fontSize: '0.8rem' }}>✓</span> API JSON
                              </span>
                            )}
                            {jsonFilePath && (
                              <span style={{ color: 'var(--color-naranja-e)', fontSize: '0.74rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.3rem', fontFamily: 'var(--font-body)' }}>
                                <span style={{ fontSize: '0.8rem' }}>✓</span> Archivo JSON
                              </span>
                            )}
                            {multiPagina && (
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
                            onClick={() => handleKPISave(elementoId)}
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
                          onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-azul-fuerte)'; e.currentTarget.style.color = 'white'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,70,135,0.05)'; e.currentTarget.style.color = 'var(--color-azul-fuerte)'; }}
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

      <div style={{ display: 'flex', gap: '0.875rem', justifyContent: 'flex-end', marginBottom: '2.5rem' }}>
        <button onClick={() => { setToast('Configuración del sistema guardada'); setTimeout(() => setToast(''), 3000); }} style={{ padding: '0.65rem 1.5rem', border: 'none', borderRadius: 10, background: 'linear-gradient(135deg, var(--color-azul-claro), var(--color-azul-cruz))', color: 'white', fontFamily: "var(--font-display)", fontSize: '0.88rem', fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(0,136,201,0.25)', transition: 'all 200ms' }} onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'} onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}>
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

    </div>
  );
}
