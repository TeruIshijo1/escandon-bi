/**
 * KPICard.jsx — Tarjeta de indicador clickeable con edición inline (solo Admin)
 * Hospital Escandón BI Platform v4.0
 *
 * Props:
 *   elementoId   {string}  — 'directivo.ocupacion'
 *   value        {string}  — Valor a mostrar (viene del backend/BD)
 *   subtitle     {string}  — Texto pequeño debajo del valor
 *   accentColor  {string}  — Color de la franja superior
 *   isAdmin      {boolean} — Muestra el lápiz ✏️ al hacer hover
 *   onKPIClick   {fn}      — Callback cuando el usuario hace click (para abrir PBI)
 */
import { useState, useRef, useEffect } from 'react';
import { useKPIConfig } from '../../hooks/useKPIConfig';
import { useAuth } from '../../context/AuthContext';

const ICONOS_RAPIDOS = ['📊','🏥','❤️','🔪','📅','🚪','📦','💼','⚙️','🎯','⭐','📋','👤','♀️','📉','👶','✅','⚠️','💰','🛏️','🔄'];

export default function KPICard({ elementoId, value, subtitle, accentColor = '#0088C9', isAdmin = false, onKPIClick }) {
  const { getKPI, updateKPI } = useKPIConfig();
  const kpi = getKPI(elementoId);
  const { user } = useAuth();

  const [editing, setEditing]     = useState(false);
  const [saving,  setSaving]      = useState(false);
  const [toast,   setToast]       = useState('');
  const [form, setForm] = useState({ nombreCustom: '', icono: '', pbiUrl: '' });

  const modalRef = useRef(null);

  // Al abrir el modal, inicializar con los valores actuales
  const openEdit = (e) => {
    e.stopPropagation(); // Evitar que el click llegue al card
    setForm({
      nombreCustom: kpi.nombreCustom || '',
      icono:        kpi.icono        || '📊',
      pbiUrl:       kpi.pbiUrl       || '',
    });
    setEditing(true);
  };

  // Cerrar al hacer click fuera
  useEffect(() => {
    if (!editing) return;
    const handler = (e) => {
      if (modalRef.current && !modalRef.current.contains(e.target)) setEditing(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [editing]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await updateKPI(elementoId, {
        nombreCustom: form.nombreCustom.trim() || null,
        icono:        form.icono,
        pbiUrl:       form.pbiUrl.trim() || null,
      });
      if (res.ok) {
        setEditing(false);
        showToast('✅ Guardado');
      }
    } catch (err) {
      showToast('❌ Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  };

  const isAllowed = isAdmin || (user?.permisos && user.permisos.includes(elementoId));
  const hasPBI = !!kpi.pbiUrl && isAllowed;

  const handleCardClick = () => {
    if (editing) return;
    if (hasPBI) {
      onKPIClick?.(kpi.pbiUrl, kpi.nombre, kpi.pbiUrl2, kpi.pbiUrl3, kpi.multiPagina);
    } else if (!!kpi.pbiUrl && !isAdmin) {
      showToast('🔒 No tienes permiso para ver este reporte');
    }
  };

  return (
    <>
      {/* ── Tarjeta principal ── */}
      <div
        onClick={handleCardClick}
        title={hasPBI ? `Ver reporte: ${kpi.nombre}` : (isAdmin ? 'Sin reporte configurado. Haga click en ✏️ para configurar.' : '')}
        style={{
          background:   'var(--surface-raised)',
          borderRadius:  'var(--radius-md)',
          padding:      '1.2rem 1.25rem',
          border:       `1px solid ${hasPBI ? accentColor + '20' : 'rgba(0,70,135,0.07)'}`,
          borderLeft:   `4px solid ${accentColor}`,
          boxShadow:    'var(--shadow-sm)',
          position:     'relative',
          overflow:     'hidden',
          transition:   'all var(--transition-base)',
          cursor:        hasPBI ? 'pointer' : (isAdmin ? 'pointer' : 'default'),
          userSelect:   'none',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          minHeight: value == null || value === '' ? '90px' : 'auto',
          boxSizing: 'border-box'
        }}
        onMouseEnter={e => {
          e.currentTarget.style.transform   = hasPBI ? 'translateY(-3px)' : 'translateY(-1px)';
          e.currentTarget.style.boxShadow   = hasPBI ? `0 10px 30px ${accentColor}18, var(--shadow-md)` : 'var(--shadow-md)';
          e.currentTarget.style.borderColor = hasPBI ? accentColor + '40' : 'rgba(0,70,135,0.15)';
          // Mostrar botón editar al hover (admin)
          const btn = e.currentTarget.querySelector('.kpi-edit-btn');
          if (btn) btn.style.opacity = '1';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.transform   = 'translateY(0)';
          e.currentTarget.style.boxShadow   = 'var(--shadow-sm)';
          e.currentTarget.style.borderColor = hasPBI ? accentColor + '20' : 'rgba(0,70,135,0.07)';
          const btn = e.currentTarget.querySelector('.kpi-edit-btn');
          if (btn) btn.style.opacity = '0';
        }}
      >
        {/* Ícono de fondo decorativo */}
        <div style={{
          position: 'absolute', right: 12, top: 14,
          fontSize: '1.8rem', opacity: 0.08, userSelect: 'none',
          pointerEvents: 'none',
        }}>{kpi.icono}</div>

        {/* Botón ✏️ — solo Admin, aparece en hover */}
        {isAdmin && (
          <button
            className="kpi-edit-btn"
            onClick={openEdit}
            title="Editar nombre, ícono y URL de Power BI"
            style={{
              position:  'absolute', top: 8, right: 8,
              width: 26, height: 26,
              background: 'rgba(0,70,135,0.08)',
              border:    '1px solid rgba(0,70,135,0.15)',
              borderRadius: 6,
              fontSize:  '0.75rem',
              cursor:    'pointer',
              display:   'flex', alignItems: 'center', justifyContent: 'center',
              opacity:   0,
              transition: 'all var(--transition-fast)',
              zIndex:    2,
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--color-azul-fuerte)';
              e.currentTarget.style.color = '#fff';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(0,70,135,0.08)';
              e.currentTarget.style.color = 'inherit';
            }}
          >✏️</button>
        )}

        {/* Etiqueta */}
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em',
          textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: value != null && value !== '' ? '0.4rem' : 0,
          paddingRight: isAdmin ? '1.5rem' : 0,
        }}>
          {kpi.nombre || elementoId}
        </div>

        {/* Valor */}
        {value != null && value !== '' && (
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: '1.75rem', fontWeight: 600,
            color: 'var(--text-primary)', lineHeight: 1, marginBottom: '0.35rem',
            letterSpacing: '-0.02em'
          }}>
            {value}
          </div>
        )}

        {/* Subtítulo */}
        {value != null && value !== '' && subtitle && (
          <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500 }}>
            ● {subtitle}
          </div>
        )}

        {/* Indicador PBI (solo si tiene URL) */}
        {!!kpi.pbiUrl && (
          <div style={{
            marginTop: '0.5rem',
            fontFamily: 'var(--font-body)',
            fontSize: '0.62rem', fontWeight: 700,
            color: hasPBI ? accentColor : 'var(--text-muted)',
            display: 'flex', alignItems: 'center', gap: '0.3rem',
            textTransform: 'uppercase',
            letterSpacing: '0.03em'
          }}>
            <span>{hasPBI ? '📊' : '🔒'}</span> {hasPBI ? 'Ver reporte →' : 'Sin acceso'}
          </div>
        )}
      </div>

      {/* ── Modal de edición inline ── */}
      {editing && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 20, 40, 0.45)', backdropFilter: 'blur(10px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1500,
        }}>
          <div
            ref={modalRef}
            style={{
              background: 'rgba(255, 255, 255, 0.88)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(255, 255, 255, 0.4)',
              borderRadius: 'var(--radius-lg)',
              padding: '1.75rem',
              width: '95%', maxWidth: 420,
              boxShadow: 'var(--shadow-xl)',
              animation: 'kpiSlideUp 300ms var(--ease-out-expo)',
            }}
          >
            <style>{`@keyframes kpiSlideUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }`}</style>

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Editar indicador</div>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0, marginTop: '0.15rem' }}>
                  {form.icono} {kpi.nombreDefault}
                </h3>
              </div>
              <button 
                onClick={() => setEditing(false)} 
                style={{ 
                  background: 'rgba(0,0,0,0.05)', 
                  border: 'none', 
                  width: 28, height: 28,
                  borderRadius: '50%',
                  fontSize: '0.8rem', 
                  cursor: 'pointer', 
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 200ms'
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,0.1)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(0,0,0,0.05)'}
              >✕</button>
            </div>

            {/* Campo: Nombre personalizado */}
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontFamily: 'var(--font-display)', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.4rem', letterSpacing: '0.05em' }}>
                NOMBRE PERSONALIZADO
              </label>
              <input
                type="text"
                value={form.nombreCustom}
                onChange={e => setForm(f => ({ ...f, nombreCustom: e.target.value }))}
                placeholder={kpi.nombreDefault}
                maxLength={60}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  border: '1px solid rgba(0,70,135,0.15)', borderRadius: 'var(--radius-sm)',
                  padding: '0.65rem 0.85rem', fontSize: '0.88rem',
                  fontFamily: 'var(--font-body)', outline: 'none',
                  background: 'rgba(255,255,255,0.6)',
                  transition: 'all var(--transition-fast)'
                }}
                onFocus={e => {
                  e.target.style.borderColor = accentColor;
                  e.target.style.background = '#fff';
                  e.target.style.boxShadow = `0 0 0 3px ${accentColor}20`;
                }}
                onBlur={e => {
                  e.target.style.borderColor = 'rgba(0,70,135,0.15)';
                  e.target.style.background = 'rgba(255,255,255,0.6)';
                  e.target.style.boxShadow = 'none';
                }}
              />
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.3rem', fontFamily: 'var(--font-body)' }}>
                Dejar vacío para usar el nombre por defecto: "{kpi.nombreDefault}"
              </div>
            </div>

            {/* Campo: Ícono */}
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontFamily: 'var(--font-display)', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.4rem', letterSpacing: '0.05em' }}>
                ÍCONO
              </label>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.5rem', maxHeight: 95, overflowY: 'auto', padding: '2px', border: '1px solid rgba(0,70,135,0.06)', borderRadius: 'var(--radius-sm)', background: 'rgba(255,255,255,0.4)' }}>
                {ICONOS_RAPIDOS.map(ic => (
                  <button
                    key={ic}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, icono: ic }))}
                    style={{
                      width: 32, height: 32, fontSize: '1rem',
                      borderRadius: 'var(--radius-xs)',
                      border: form.icono === ic ? `2px solid ${accentColor}` : '1px solid rgba(0,70,135,0.08)',
                      background: form.icono === ic ? `${accentColor}15` : 'white',
                      cursor: 'pointer', transition: 'all var(--transition-fast)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}
                    onMouseEnter={e => {
                      if (form.icono !== ic) e.currentTarget.style.background = 'var(--surface-1)';
                    }}
                    onMouseLeave={e => {
                      if (form.icono !== ic) e.currentTarget.style.background = 'white';
                    }}
                  >{ic}</button>
                ))}
              </div>
            </div>

            {/* Campo: URL Power BI */}
            <div style={{ marginBottom: '1.75rem' }}>
              <label style={{ display: 'block', fontFamily: 'var(--font-display)', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.4rem', letterSpacing: '0.05em' }}>
                URL DEL REPORTE POWER BI
              </label>
              <input
                type="url"
                value={form.pbiUrl}
                onChange={e => setForm(f => ({ ...f, pbiUrl: e.target.value }))}
                placeholder="https://app.powerbi.com/..."
                style={{
                  width: '100%', boxSizing: 'border-box',
                  border: '1px solid rgba(0,70,135,0.15)', borderRadius: 'var(--radius-sm)',
                  padding: '0.65rem 0.85rem', fontSize: '0.82rem',
                  fontFamily: 'var(--font-mono)', outline: 'none',
                  background: 'rgba(255,255,255,0.6)',
                  transition: 'all var(--transition-fast)'
                }}
                onFocus={e => {
                  e.target.style.borderColor = accentColor;
                  e.target.style.background = '#fff';
                  e.target.style.boxShadow = `0 0 0 3px ${accentColor}20`;
                }}
                onBlur={e => {
                  e.target.style.borderColor = 'rgba(0,70,135,0.15)';
                  e.target.style.background = 'rgba(255,255,255,0.6)';
                  e.target.style.boxShadow = 'none';
                }}
              />
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.3rem', fontFamily: 'var(--font-body)' }}>
                Al hacer click en el indicador se abrirá este reporte
              </div>
            </div>

            {/* Botones */}
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={() => setEditing(false)}
                style={{
                  flex: 1, padding: '0.65rem',
                  border: '1px solid rgba(0,70,135,0.15)', borderRadius: 'var(--radius-sm)',
                  background: 'transparent', color: 'var(--text-secondary)',
                  fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 200ms'
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(0,0,0,0.02)';
                  e.currentTarget.style.borderColor = 'rgba(0,70,135,0.3)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.borderColor = 'rgba(0,70,135,0.15)';
                }}
              >Cancelar</button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                style={{
                  flex: 2, padding: '0.65rem',
                  border: 'none', borderRadius: 'var(--radius-sm)',
                  background: `linear-gradient(135deg, ${accentColor}, ${accentColor}E0)`,
                  color: 'white',
                  fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: 700,
                  cursor: saving ? 'wait' : 'pointer',
                  opacity: saving ? 0.7 : 1,
                  boxShadow: `0 4px 12px ${accentColor}25`,
                  transition: 'all 200ms'
                }}
                onMouseEnter={e => {
                  if (!saving) e.currentTarget.style.boxShadow = `0 6px 16px ${accentColor}40`;
                }}
                onMouseLeave={e => {
                  if (!saving) e.currentTarget.style.boxShadow = `0 4px 12px ${accentColor}25`;
                }}
              >{saving ? '⏳ Guardando...' : '💾 Guardar Cambios'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast de confirmación */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(15,26,46,0.9)', 
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,255,255,0.1)',
          color: 'white',
          padding: '0.65rem 1.35rem', borderRadius: 'var(--radius-pill)',
          fontSize: '0.82rem', fontWeight: 600,
          boxShadow: 'var(--shadow-lg)',
          zIndex: 2000, animation: 'kpiSlideUp 250ms ease',
          pointerEvents: 'none',
          fontFamily: 'var(--font-body)'
        }}>{toast}</div>
      )}
    </>
  );
}
