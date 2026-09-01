import React, { useState, useEffect, useMemo } from 'react';
import { API_BASE } from '../../api/config';
import { authHeaders } from '../../api/auth';
import useEscapeKey from '../../hooks/useEscapeKey';

function formatTimeAgo(totalMins) {
  if (!totalMins || isNaN(totalMins) || totalMins <= 0) return '0 min';

  const days = Math.floor(totalMins / 1440);
  const hours = Math.floor((totalMins % 1440) / 60);
  const mins = totalMins % 60;

  const parts = [];

  if (days > 0) {
    parts.push(`${days} ${days === 1 ? 'día' : 'días'}`);
  }
  if (hours > 0) {
    parts.push(`${hours} ${hours === 1 ? 'hora' : 'horas'}`);
  }
  if (mins > 0 || parts.length === 0) {
    parts.push(`${mins} min`);
  }

  return parts.join(' ');
}

/**
 * Clasificador garantizado de medicamentos que requieren receta médica (Grupo IV, Antibióticos y Controlados)
 */
function classifyRxItem(row) {
  if (row.RxCategory && row.RxBadge) {
    return {
      category: row.RxCategory,
      badge: row.RxBadge,
      isRx: true
    };
  }

  const name = String(row.Medicamento || '').toUpperCase().trim();
  const code = String(row.Codigo || '').toUpperCase().trim();
  const clasi = String(row.Clasificacion || '').toUpperCase().trim();
  const secClasi = String(row.ClasificacionSecundaria || '').toUpperCase().trim();

  // Exclusiones explícitas de no-medicamentos (materiales, insumos, suplementos, bebidas)
  const nonMedPatterns = [
    /\bMEDIAS\b/, /\bANTIEMB[OÓ]LIC/, /\bJERINGA\b/, /\bGUANTE\b/, /\bGASA\b/, /\bCATETER\b/, /\bCAT[EÉ]TER\b/,
    /\bVENOCLISIS\b/, /\bEQUIPO\b/, /\bAGUJA\b/, /\bSONDA\b/, /\bCINTA\b/, /\bAPOSITO\b/, /\bAP[OÓ]SITO\b/,
    /\bALGODON\b/, /\bALGOD[OÓ]N\b/, /\bTORUNDA\b/, /\bTIRAS\b/, /\bBOMBA\b/, /\bTERMOMETRO\b/, /\bTERM[OÓ]METRO\b/,
    /\bBOLSA\b/, /\bCIRCUITO\b/, /\bELECTRODO\b/, /\bTUBULADURA\b/, /\bMASCARILLA\b/, /\bCANULA\b/, /\bC[AÁ]NULA\b/,
    /\bJABON\b/, /\bJAB[OÓ]N\b/, /\bCEPILLO\b/, /\bBISTURI\b/, /\bBISTUR[IÍ]\b/, /\bHOJA\b/, /\bSUTURA\b/,
    /\bCUBREBOCA\b/, /\bBATA\b/, /\bPA[NÑ]AL\b/, /\bBRACETE\b/, /\bLANCETA\b/, /\bFRASCO\b/, /\bTUBO\b/,
    /\bLLAVE\b/, /\bTORNIQUETE\b/, /\bPUNZOCAT\b/, /\bTEGADERM\b/, /\bVENOPACK\b/, /\bMICROGOTERO\b/,
    /\bNORMOGOTERO\b/, /\bAGUA\b/, /\bLEVITE\b/, /\bELECTROLIT\b/, /\bGATORADE\b/, /\bJUGO\b/, /\bREFRESCO\b/,
    /\bSUPLEMENTO\b/, /\bALIMENTO\b/, /\bFRESUBIN\b/, /\bENSURE\b/, /\bPEDIASURE\b/, /\bFORMULA\b/, /\bF[OÓ]RMULA\b/
  ];

  if (nonMedPatterns.some(p => p.test(name))) {
    return { isRx: false };
  }

  if (!name || name === 'MATERIAL/MEDICAMENTO' || name === 'UNDEFINED') {
    if (code === 'FAR0124' || code === 'FAR0126' || code === 'FAR0965') {
      return { category: 'CONTROLADO', badge: { label: '💊 CONTROLADO', color: '#7C3AED', bg: '#F5F3FF', border: '#DDD6FE' }, isRx: true };
    }
    if (code === 'FAR0980' || code === 'FAR0260' || code === 'FAR0243' || code === 'FAR0266' || code === 'FAR0239') {
      return { category: 'ANTIBIOTICO', badge: { label: '💉 ANTIBIÓTICO', color: '#2563EB', bg: '#EFF6FF', border: '#BFDBFE' }, isRx: true };
    }
    return { isRx: false };
  }

  // 1. Controlados (Grupo I, II, III)
  const controlledKeywords = [
    'DIAZEPAM', 'BUPRENORFINA', 'FENTANILO', 'FENTANYL', 'MORFINA', 'CLONAZEPAM', 'ALPRAZOLAM',
    'MIDAZOLAM', 'LORAZEPAM', 'TRAMADOL', 'METADONA', 'METILFENIDATO', 'KETAMINA', 'EFEDRINA',
    'NALBUFINA', 'FENOBARBITAL', 'BROSPINA', 'RELAZEPAM', 'VALIUM', 'RIVOTRIL', 'DORMICUM', 'TEMGESIC'
  ];
  if (clasi === 'CON' || secClasi === 'CON' || row.EsControlado || controlledKeywords.some(k => name.includes(k))) {
    return {
      category: 'CONTROLADO',
      badge: { label: '💊 CONTROLADO', color: '#7C3AED', bg: '#F5F3FF', border: '#DDD6FE' },
      isRx: true
    };
  }

  // 2. Antibióticos
  const antibioticKeywords = [
    'MEROPENEM', 'AMIKACINA', 'CEFTRIAXONA', 'CIPROFLOXACINO', 'LEVOFLOXACINO', 'VANCOMICINA',
    'CLARITROMICINA', 'AMPICILINA', 'METRONIDAZOL', 'CEFALOTINA', 'CEFOTAXIMA', 'CEFTAZIDIMA',
    'ERTAPENEM', 'IMIPENEM', 'LINEZOLID', 'PIPERACILINA', 'TAZOBACTAM', 'GENTAMICINA', 'AMOXICILINA',
    'CLAVULANATO', 'AZITROMICINA', 'CLINDAMICINA', 'CEFUROXIMA', 'ACICLOVIR', 'CEFTREX', 'AMK', 'XONATIL'
  ];
  if (clasi === 'ANTI' || secClasi === 'ANTI' || row.EsAntibiotico || antibioticKeywords.some(k => name.includes(k))) {
    return {
      category: 'ANTIBIOTICO',
      badge: { label: '💉 ANTIBIÓTICO', color: '#2563EB', bg: '#EFF6FF', border: '#BFDBFE' },
      isRx: true
    };
  }

  // 3. Grupo IV (Resto de medicamentos que requieren prescripción)
  return {
    category: 'GRUPO_IV',
    badge: { label: '📋 GRUPO IV', color: '#0D9488', bg: '#F0FDFA', border: '#99F6E4' },
    isRx: true
  };
}

export default function PendingMonitor() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedPrescription, setSelectedPrescription] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  useEscapeKey(() => setSelectedPrescription(null), !!selectedPrescription);

  const fetchData = () => {
    fetch(`${API_BASE}/pharmacy/pending-prescriptions`, {
      headers: authHeaders()
    })
      .then(res => {
        if (!res.ok) throw new Error('Error al conectar con el servidor');
        return res.json();
      })
      .then(json => {
        if (json.ok) {
           setData(json.data || []);
           setError(null);
        } else {
           setError(json.error || 'Error al cargar recetas');
        }
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setError('Error de red al cargar recetas');
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // Auto refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const rxData = useMemo(() => {
    return data
      .map(item => {
        const info = classifyRxItem(item);
        return {
          ...item,
          isRx: info.isRx,
          RxCategory: item.RxCategory || info.category,
          RxBadge: item.RxBadge || info.badge
        };
      })
      .filter(item => item.isRx);
  }, [data]);

  const countControlados = useMemo(() => rxData.filter(d => d.RxCategory === 'CONTROLADO').length, [rxData]);
  const countAntibioticos = useMemo(() => rxData.filter(d => d.RxCategory === 'ANTIBIOTICO').length, [rxData]);
  const countGrupoIV = useMemo(() => rxData.filter(d => d.RxCategory === 'GRUPO_IV').length, [rxData]);

  const filteredData = useMemo(() => {
    return rxData.filter(item => {
      if (categoryFilter !== 'ALL' && item.RxCategory !== categoryFilter) {
        return false;
      }
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase().trim();
        const match = (item.Paciente && item.Paciente.toLowerCase().includes(term)) ||
                      (item.Medicamento && item.Medicamento.toLowerCase().includes(term)) ||
                      (item.Codigo && item.Codigo.toLowerCase().includes(term)) ||
                      (item.CamaCuarto && item.CamaCuarto.toLowerCase().includes(term)) ||
                      (item.Medico && item.Medico.toLowerCase().includes(term));
        if (!match) return false;
      }
      return true;
    });
  }, [rxData, categoryFilter, searchTerm]);

  const handleHide = async (id) => {
    if (window.confirm('¿Seguro que deseas descartar esta receta de la plataforma? (No afectará Vertical)')) {
      try {
        await fetch(`${API_BASE}/pharmacy/pending-prescriptions/hide/${id}`, { 
          method: 'POST',
          headers: authHeaders()
        });
        setData(prev => prev.filter(r => r.Id !== id));
        setSelectedPrescription(null);
      } catch (err) {
        console.error(err);
        alert('Error al descartar receta');
      }
    }
  };

  return (
    <div style={{ background: '#fff', borderRadius: '16px', padding: '2rem', boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid #e2e8f0' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '2px solid #e2e8f0', paddingBottom: '0.75rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.6rem', fontWeight: 'bold', color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            🛎️ Monitor de Recetas Pendientes
          </h2>
          <p style={{ color: '#64748b', margin: '0.35rem 0 0 0', fontSize: '0.9rem' }}>
            Cola de surtido exclusiva para medicamentos de prescripción médica (<strong>Grupo IV</strong>, <strong>Antibióticos</strong> y <strong>Controlados</strong>) sin lote asignado.
          </p>
        </div>
        {!loading && (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <div style={{ background: '#ef4444', color: 'white', padding: '0.45rem 1.1rem', borderRadius: '999px', fontWeight: 'bold', fontSize: '0.9rem', boxShadow: '0 2px 6px rgba(239, 68, 68, 0.3)' }}>
              {rxData.length} En Cola
            </div>
          </div>
        )}
      </div>

      {/* Control Bar: Categories & Search */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem', background: '#f8fafc', padding: '0.75rem 1rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            onClick={() => setCategoryFilter('ALL')}
            style={{
              padding: '0.45rem 0.9rem',
              borderRadius: '8px',
              border: categoryFilter === 'ALL' ? '2px solid #004687' : '1px solid #cbd5e1',
              background: categoryFilter === 'ALL' ? '#004687' : '#ffffff',
              color: categoryFilter === 'ALL' ? '#ffffff' : '#475569',
              fontWeight: '700',
              fontSize: '0.82rem',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            Todos ({rxData.length})
          </button>
          <button
            onClick={() => setCategoryFilter('CONTROLADO')}
            style={{
              padding: '0.45rem 0.9rem',
              borderRadius: '8px',
              border: categoryFilter === 'CONTROLADO' ? '2px solid #7c3aed' : '1px solid #ddd6fe',
              background: categoryFilter === 'CONTROLADO' ? '#f5f3ff' : '#ffffff',
              color: '#7c3aed',
              fontWeight: '700',
              fontSize: '0.82rem',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            💊 Controlados ({countControlados})
          </button>
          <button
            onClick={() => setCategoryFilter('ANTIBIOTICO')}
            style={{
              padding: '0.45rem 0.9rem',
              borderRadius: '8px',
              border: categoryFilter === 'ANTIBIOTICO' ? '2px solid #2563eb' : '1px solid #bfdbfe',
              background: categoryFilter === 'ANTIBIOTICO' ? '#eff6ff' : '#ffffff',
              color: '#2563eb',
              fontWeight: '700',
              fontSize: '0.82rem',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            💉 Antibióticos ({countAntibioticos})
          </button>
          <button
            onClick={() => setCategoryFilter('GRUPO_IV')}
            style={{
              padding: '0.45rem 0.9rem',
              borderRadius: '8px',
              border: categoryFilter === 'GRUPO_IV' ? '2px solid #0d9488' : '1px solid #99f6e4',
              background: categoryFilter === 'GRUPO_IV' ? '#f0fdfa' : '#ffffff',
              color: '#0d9488',
              fontWeight: '700',
              fontSize: '0.82rem',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            📋 Grupo IV ({countGrupoIV})
          </button>
        </div>

        <div style={{ position: 'relative', minWidth: '260px', flex: '1', maxWidth: '380px' }}>
          <input
            type="text"
            placeholder="🔍 Filtrar por paciente, medicamento..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: '100%',
              padding: '0.45rem 1.8rem 0.45rem 0.8rem',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              fontSize: '0.85rem',
              outline: 'none',
              background: '#ffffff'
            }}
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              style={{
                position: 'absolute',
                right: '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: '#e2e8f0',
                border: 'none',
                borderRadius: '50%',
                width: '18px',
                height: '18px',
                fontSize: '0.7rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#64748b'
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>
      
      {loading && data.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>Cargando recetas pendientes...</div>
      ) : error && data.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#dc2626', fontWeight: 'bold' }}>{error}</div>
      ) : filteredData.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', background: '#f8fafc', borderRadius: '12px', color: '#94a3b8', border: '1px dashed #cbd5e1' }}>
          <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🎉</div>
          <div style={{ fontWeight: 'bold', fontSize: '1.05rem', color: '#475569', marginBottom: '0.25rem' }}>No hay recetas pendientes</div>
          <div style={{ fontSize: '0.85rem' }}>
            {searchTerm || categoryFilter !== 'ALL' 
              ? 'No hay recetas que coincidan con los filtros seleccionados.' 
              : 'No hay medicamentos de prescripción (Grupo IV, Antibióticos o Controlados) pendientes de surtir en farmacia.'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: '1rem' }}>
          {filteredData.map((row, idx) => {
            const minsWaiting = Math.floor((new Date() - new Date(row.FechaSolicitud)) / 60000);
            const isUrgent = minsWaiting > 60;
            const badge = row.RxBadge || { label: '📋 GRUPO IV', color: '#0D9488', bg: '#F0FDFA', border: '#99F6E4' };
            return (
              <div 
                key={idx} 
                onClick={() => setSelectedPrescription({ ...row, minsWaiting })}
                style={{ 
                  background: isUrgent ? '#fef2f2' : '#ffffff', 
                  border: `1px solid ${isUrgent ? '#f87171' : '#e2e8f0'}`, 
                  borderRadius: '12px', 
                  padding: '1.2rem',
                  borderLeft: `5px solid ${row.RxCategory === 'CONTROLADO' ? '#7c3aed' : row.RxCategory === 'ANTIBIOTICO' ? '#2563eb' : isUrgent ? '#ef4444' : '#0d9488'}`,
                  cursor: 'pointer',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.03)',
                  transition: 'transform 0.2s, boxShadow 0.2s'
                }}
                onMouseOver={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 12px rgba(0,0,0,0.08)'; }}
                onMouseOut={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.03)'; }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                  <span style={{ fontWeight: '800', color: '#0f172a', fontSize: '0.88rem' }}>{row.CamaCuarto || 'Ambulatorio'}</span>
                  <span style={{ color: isUrgent ? '#ef4444' : '#64748b', fontSize: '0.78rem', fontWeight: 'bold' }}>
                    Hace {formatTimeAgo(minsWaiting)}
                  </span>
                </div>

                <div style={{ marginBottom: '0.6rem' }}>
                  <span style={{ 
                    background: badge.bg, 
                    color: badge.color, 
                    border: `1px solid ${badge.border}`, 
                    fontSize: '0.68rem', 
                    fontWeight: 800, 
                    padding: '2px 8px', 
                    borderRadius: '6px',
                    display: 'inline-block'
                  }}>
                    {badge.label}
                  </span>
                </div>

                <div style={{ color: '#334155', fontSize: '0.88rem', fontWeight: 600, marginBottom: '0.8rem', textTransform: 'uppercase', minHeight: '38px', lineHeight: '1.25' }}>
                  {row.Paciente}
                </div>
                
                <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '0.65rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ maxWidth: '80%' }}>
                    <div style={{ fontSize: '0.72rem', color: '#0284c7', fontFamily: 'monospace', fontWeight: 700 }}>{row.Codigo}</div>
                    <div style={{ fontWeight: '600', color: '#0f172a', fontSize: '0.82rem', lineHeight: '1.2' }}>{row.Medicamento}</div>
                  </div>
                  <div style={{ background: '#004687', color: 'white', padding: '0.2rem 0.65rem', borderRadius: '999px', fontWeight: '800', fontSize: '0.85rem' }}>
                    {row.Solicitado}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedPrescription && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'white', padding: '2rem', borderRadius: '16px', width: '90%', maxWidth: '580px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)' }}>
            
            {/* Header Modal */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '1rem' }}>
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Solicitud de Farmacia</span>
                <h3 style={{ margin: '0.25rem 0 0 0', color: '#0f172a', fontSize: '1.35rem', fontWeight: 'bold' }}>
                  Detalle de Receta #{selectedPrescription.Requisicion || selectedPrescription.Id}
                </h3>
                <p style={{ margin: '0.25rem 0 0 0', color: '#ef4444', fontSize: '0.9rem', fontWeight: 'bold' }}>
                  ⏱️ Esperando surtido desde hace {formatTimeAgo(selectedPrescription.minsWaiting)}
                </p>
              </div>
              <button onClick={() => setSelectedPrescription(null)} style={{ background: '#f1f5f9', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: '#64748b', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>
            
            {/* Referencias Documentales Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '1.25rem', background: '#f8fafc', padding: '0.85rem', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              <div>
                <span style={{ display: 'block', fontSize: '0.7rem', color: '#64748b', fontWeight: 'bold', textTransform: 'uppercase' }}>No. Requisición</span>
                <strong style={{ fontSize: '0.95rem', color: '#0f172a', fontFamily: 'var(--font-mono)' }}>#{selectedPrescription.Requisicion || 'N/A'}</strong>
              </div>
              <div>
                <span style={{ display: 'block', fontSize: '0.7rem', color: '#64748b', fontWeight: 'bold', textTransform: 'uppercase' }}>Cuenta Paciente</span>
                <strong style={{ fontSize: '0.95rem', color: '#0284c7', fontFamily: 'var(--font-mono)' }}>#{selectedPrescription.Cuenta || 'N/A'}</strong>
              </div>
              <div>
                <span style={{ display: 'block', fontSize: '0.7rem', color: '#64748b', fontWeight: 'bold', textTransform: 'uppercase' }}>Capturó Solicitud</span>
                <strong style={{ fontSize: '0.9rem', color: '#334155' }}>{selectedPrescription.UsuarioSolicito || 'Cirrus'}</strong>
              </div>
            </div>

            {/* Ficha Paciente y Médico */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <div style={{ borderLeft: '4px solid #3b82f6', paddingLeft: '0.75rem' }}>
                <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>Paciente</span>
                <div style={{ fontSize: '1.05rem', color: '#0f172a', fontWeight: 'bold' }}>🛌 {selectedPrescription.Paciente}</div>
                <span style={{ fontSize: '0.85rem', color: '#475569' }}>Habitación / Ubicación: <strong>{selectedPrescription.CamaCuarto || 'Ambulatorio'}</strong></span>
              </div>
              
              <div style={{ borderLeft: '4px solid #10b981', paddingLeft: '0.75rem' }}>
                <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>Médico Tratante</span>
                <div style={{ fontSize: '1rem', color: '#0f172a', fontWeight: '600' }}>👨‍⚕️ {selectedPrescription.Medico}</div>
                {selectedPrescription.FechaSolicitud && (
                  <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                    Solicitado el: {new Date(selectedPrescription.FechaSolicitud).toLocaleDateString('es-MX')} a las {new Date(selectedPrescription.FechaSolicitud).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
            </div>
            
            {/* Artículo y Disponibilidad en SAP */}
            <div style={{ background: '#f0f9ff', padding: '1.25rem', borderRadius: '12px', border: '1px solid #bae6fd', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.75rem', color: '#0369a1', textTransform: 'uppercase', fontWeight: 'bold' }}>Artículo Solicitado</span>
                {selectedPrescription.RxBadge && (
                  <span style={{
                    background: selectedPrescription.RxBadge.bg,
                    color: selectedPrescription.RxBadge.color,
                    border: `1px solid ${selectedPrescription.RxBadge.border}`,
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    padding: '2px 8px',
                    borderRadius: '6px'
                  }}>
                    {selectedPrescription.RxBadge.label}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', marginBottom: '0.75rem' }}>
                <div>
                  <div style={{ color: '#0c4a6e', fontWeight: 'bold', fontSize: '1.05rem' }}>{selectedPrescription.Medicamento}</div>
                  <div style={{ fontSize: '0.85rem', color: '#0284c7', fontWeight: 'bold', fontFamily: 'var(--font-mono)' }}>{selectedPrescription.Codigo}</div>
                </div>
                <div style={{ fontSize: '1.75rem', fontWeight: '800', color: '#0284c7', background: 'white', padding: '0.2rem 0.8rem', borderRadius: '8px', border: '1px solid #7dd3fc' }}>
                  x{selectedPrescription.Solicitado}
                </div>
              </div>

              {/* Indicador de Stock en SAP */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.75rem', borderTop: '1px border #e0f2fe', fontSize: '0.85rem' }}>
                <span style={{ color: '#0369a1' }}>Disponibilidad en Farmacia (SAP):</span>
                <span style={{ fontWeight: 'bold', color: selectedPrescription.StockActual >= selectedPrescription.Solicitado ? '#16a34a' : '#dc2626' }}>
                  {selectedPrescription.StockActual >= selectedPrescription.Solicitado ? '🟢 Stock Suficiente' : '🔴 Stock Insuficiente'} ({selectedPrescription.StockActual || 0} disponibles)
                </span>
              </div>
            </div>

            {/* Lotes Disponibles en SAP */}
            {selectedPrescription.LotesDisponibles && selectedPrescription.LotesDisponibles.length > 0 && (
              <div style={{ marginBottom: '1.25rem' }}>
                <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold', display: 'block', marginBottom: '0.5rem' }}>
                  📦 Lotes Disponibles en Farmacia ({selectedPrescription.LotesDisponibles.length})
                </span>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {selectedPrescription.LotesDisponibles.map((b, i) => (
                    <span key={i} style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '0.3rem 0.6rem', borderRadius: '6px', fontSize: '0.8rem', color: '#334155' }}>
                      Lote: <strong>{b.lote}</strong> ({b.cant} pzas)
                    </span>
                  ))}
                </div>
              </div>
            )}
            
            {/* Acciones */}
            <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
              <button onClick={() => handleHide(selectedPrescription.Id)} style={{ padding: '0.75rem 1.25rem', background: '#fee2e2', color: '#ef4444', border: '1px solid #fca5a5', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.9rem' }}>
                🗑️ Descartar Receta
              </button>
              <button onClick={() => setSelectedPrescription(null)} style={{ padding: '0.75rem 1.5rem', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.9rem' }}>
                Cerrar Detalle
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
