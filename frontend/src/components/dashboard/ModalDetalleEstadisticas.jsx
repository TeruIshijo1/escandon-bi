/**
 * ModalDetalleEstadisticas.jsx
 * Modal para desglose interactivo (drill-down) y exportación a Excel de estadísticas 2026
 * Hospital Escandón BI Platform v4.0
 */
import React, { useState, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { formatStatistic } from '../../utils/statisticsPresentation';
import { userMessage } from '../../utils/userMessages';

const COLUMN_LABELS = {
  FolioAtencion: 'Folio Atención',
  FolioCuenta: 'Folio Cuenta',
  FolioEstancia: 'Folio de estancia',
  NumeroCargo: 'Número de cargo',
  FolioSolicitud: 'Folio Solicitud',
  NoCita: 'No. Cita',
  NoPaciente: 'No. Paciente',
  Paciente: 'Paciente',
  PacienteBebe: 'Paciente (Bebé)',
  Genero: 'Género',
  Edad: 'Edad',
  Especialidad: 'Especialidad',
  MedicoEspecialista: 'Médico Especialista',
  MedicoSolicitante: 'Médico Solicitante',
  MedicoTratante: 'Médico Tratante',
  CirujanosMedicos: 'Cirujano(s) / Médicos',
  Anestesiologo: 'Anestesiólogo',
  EstudioImagenologia: 'Estudio Imagenología',
  EstudioLaboratorio: 'Estudio Laboratorio',
  EstudioProcedimiento: 'Procedimiento / Estudio',
  Procedimientos: 'Procedimiento Quirúrgico',
  Servicio: 'Servicio',
  Codigo: 'Código',
  CodigoServicio: 'Código Servicio',
  Fecha: 'Fecha',
  FechaConsulta: 'Fecha Consulta',
  FechaSolicitud: 'Fecha Solicitud',
  FechaCargo: 'Fecha Cargo',
  FechaAtencion: 'Fecha Atención',
  FechaNacimiento: 'Fecha Nacimiento',
  FechaIngreso: 'Fecha Ingreso',
  FechaInicio: 'Fecha/Hora Inicio',
  FechaEgreso: 'Fecha Egreso',
  FechaAlta: 'Fecha Alta',
  FechaFin: 'Fecha/Hora Fin',
  Hora: 'Hora',
  DuracionMinutos: 'Duración (Min)',
  DiasEstancia: 'Días Estancia',
  Quirofano: 'Quirófano',
  Habitacion: 'Habitación / Cama',
  HabitacionCunero: 'Cunero',
  HabitacionPiso: 'Habitación / Piso',
  AreaUrgencias: 'Área Urgencias',
  UbicacionUrgencias: 'Ubicación Urgencias',
  UnidadServicio: 'Unidad de Servicio',
  AseguradoraConvenio: 'Aseguradora / Convenio',
  TipoAtencion: 'Tipo de Atención',
  Estado: 'Estado',
  EstadoCuenta: 'Estado Cuenta',
  TipoEgreso: 'Tipo Egreso',
  Estatus: 'Estatus',
  Cantidad: 'Cantidad neta',
  CantidadOriginal: 'Cantidad original',
  Devuelto: 'Cantidad devuelta',
  GrupoCodigo: 'Código de grupo',
  ClasificacionesCatalogo: 'Clasificaciones del servicio',
  IngresoTotal: 'Importe de órdenes de venta',
  IngresoNeto: 'Importe sin IVA',
  Cuentas: 'Atenciones',
  Ordenes: 'Órdenes de venta',
  HorasSalaChoque: 'Horas Sala Choque',
  OrdenesDeVenta: 'Órdenes de Venta',
  TotalCobrado: 'Total Cobrado',
  TotalCargosServicio: 'Total Cargos / Eventos',
  TotalCuenta: 'Total Cuenta',
  TotalMonto: 'Total Importe',
  Saldo: 'Saldo',
  Telefono: 'Teléfono'
};

const MONEY_COLUMNS = new Set(['TotalCobrado', 'TotalCuenta', 'TotalMonto', 'Saldo', 'Monto', 'Importe', 'Ingreso', 'ImporteNeto', 'ImporteVenta', 'TotalOrdenVenta', 'TotalLinea', 'PrecioUnitario']);
const isMoneyColumn = key => MONEY_COLUMNS.has(key) || /^(Importe|Monto|Ingreso)/.test(key);
const readableValue = (key, value) => {
  if (key === 'TipoAtencion') return ({ IP: 'Hospitalización', ER: 'Urgencias', OP: 'Consulta externa' })[value] || value;
  if (key === 'EstadoCuenta') return ({ OP: 'Abierta', CL: 'Cerrada', PD: 'Pendiente', CA: 'Cancelada' })[value] || value;
  return value;
};
const columnLabel = key => COLUMN_LABELS[key] || key.replace(/([a-záéíóúñ])([A-ZÁÉÍÓÚÑ])/g, '$1 $2').replace(/_/g, ' ');

export default function ModalDetalleEstadisticas({
  isOpen,
  onClose,
  seccionLabel,
  seccionId,
  year,
  mesNombre,
  data = [],
  loading = false,
  error = '',
  warnings = [],
  quantity = null,
  unit = '',
  criterion = '',
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [exportError, setExportError] = useState('');

  useEffect(() => { setSearchTerm(''); setExportError(''); }, [isOpen, seccionId, year, mesNombre]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Filtrado en vivo por texto de búsqueda
  const filteredData = useMemo(() => {
    if (!searchTerm.trim()) return data;
    const term = searchTerm.toLowerCase();
    return data.filter(row =>
      Object.values(row).some(val =>
        val !== null && val !== undefined && String(val).toLowerCase().includes(term)
      )
    );
  }, [data, searchTerm]);

  // Columnas dinámicas presentes en el dataset
  const columns = useMemo(() => {
    if (!data || data.length === 0) return [];
    return [...new Set(data.flatMap(row => Object.keys(row)))];
  }, [data]);

  if (!isOpen) return null;

  // Función para formatear valores en la tabla
  const formatCellValue = (key, val) => {
    if (val === null || val === undefined || val === '') return 'No disponible';

    // Formatear montos
    if (isMoneyColumn(key)) {
      const num = parseFloat(val);
      if (!isNaN(num)) {
        return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      }
    }

    // Formatear fechas
    if (key.startsWith('Fecha')) {
      if (typeof val === 'string' && val.length === 8 && /^\d{8}$/.test(val)) {
        return `${val.substring(6, 8)}/${val.substring(4, 6)}/${val.substring(0, 4)}`;
      }
      if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
        return `${val.slice(8, 10)}/${val.slice(5, 7)}/${val.slice(0, 4)}`;
      }
      const d = new Date(val);
      if (!isNaN(d.getTime())) {
        if (key.includes('Inicio') || key.includes('Fin') || key.includes('Cargo') || key.includes('Solicitud') || key.includes('Atencion')) {
          return d.toLocaleString('es-MX', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        }
        return d.toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' });
      }
    }

    if (key === 'Hora' && typeof val === 'string' && val.includes('T')) {
      const d = new Date(val);
      if (!isNaN(d.getTime())) {
        return d.toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit' });
      }
    }

    return String(readableValue(key, val));
  };

  // Exportar a Excel
  const handleExportExcel = () => {
    setExportError('');
    try {
      if (!filteredData.length || error) return;

      const excelRows = filteredData.map((row, idx) => {
        const item = { '#': idx + 1 };
        columns.forEach(col => {
          const header = columnLabel(col);
          let val = readableValue(col, row[col]);

          // Formateo para Excel
          if (val instanceof Date) {
            val = val.toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
          } else if (col.startsWith('Fecha') && typeof val === 'string' && val.length === 8 && /^\d{8}$/.test(val)) {
            val = `${val.substring(6, 8)}/${val.substring(4, 6)}/${val.substring(0, 4)}`;
          } else if (col.startsWith('Fecha') && typeof val === 'string' && val.includes('T') && !isNaN(new Date(val).getTime())) {
            val = new Date(val).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
          }
          item[header] = val !== null && val !== undefined ? val : 'No disponible';
        });
        return item;
      });

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(excelRows);
      XLSX.utils.sheet_add_aoa(ws, [[], ['Criterio', criterion], ['Total del periodo', quantity ?? 'No disponible', unit],
        ['Registros exportados', filteredData.length], ...warnings.map(warning => ['Observación', userMessage(warning)])], { origin: excelRows.length + 2 });

      // Auto-ancho de columnas
      const colWidths = Object.keys(excelRows[0] || {}).map(key => {
        const maxLen = excelRows.reduce((maximum, row) => Math.max(maximum, String(row[key] ?? '').length), key.length);
        return { wch: Math.min(Math.max(maxLen + 3, 10), 45) };
      });
      ws['!cols'] = colWidths;

      const safeName = (seccionLabel || seccionId || 'Detalle')
        .replace(/[^a-zA-Z0-9_\u00C0-\u017F\s-]/g, '')
        .trim()
        .replace(/\s+/g, '_');

      XLSX.utils.book_append_sheet(wb, ws, 'Detalle');
      XLSX.writeFile(wb, `${safeName}_${mesNombre}_${year}.xlsx`);
    } catch (err) {
      setExportError('No se pudo exportar el detalle. Intenta de nuevo.');
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(13, 27, 42, 0.72)',
      backdropFilter: 'blur(5px)',
      zIndex: 99999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1.5rem',
      animation: 'fadeIn 0.2s ease-out'
    }}>
      <div role="dialog" aria-modal="true" aria-label={`${seccionLabel}, ${mesNombre} ${year}`} style={{
        background: '#FFFFFF',
        borderRadius: '20px',
        width: '95%',
        maxWidth: '1280px',
        height: '88vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.35)',
        overflow: 'hidden',
        position: 'relative',
        animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
      }}>
        {/* Header Modal */}
        <div style={{
          padding: '1.25rem 2rem',
          borderBottom: '1px solid #E2E8F0',
          background: 'linear-gradient(135deg, #0A2540 0%, #1E3A5F 100%)',
          color: '#FFFFFF',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem'
        }}>
          <div>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.7rem',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.7)',
              marginBottom: '0.2rem'
            }}>
              Detalle del estadístico &middot; {mesNombre} {year}
            </div>
            <h2 style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.35rem',
              fontWeight: 800,
              margin: 0,
              color: '#FFFFFF'
            }}>
              {seccionLabel}
            </h2>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button
              onClick={handleExportExcel}
              disabled={loading || Boolean(error) || filteredData.length === 0}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.55rem 1.15rem',
                background: '#10B981',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '10px',
                fontFamily: 'var(--font-display)',
                fontSize: '0.82rem',
                fontWeight: 700,
                cursor: loading || data.length === 0 ? 'not-allowed' : 'pointer',
                opacity: loading || data.length === 0 ? 0.6 : 1,
                boxShadow: '0 2px 8px rgba(16, 185, 129, 0.35)',
                transition: 'all 0.2s'
              }}
            >
              <span>📥</span> Exportar a Excel ({filteredData.length})
            </button>

            <button
              onClick={onClose}
              aria-label="Cerrar detalle"
              style={{
                width: 38,
                height: 38,
                borderRadius: '50%',
                background: 'rgba(255, 255, 255, 0.15)',
                border: 'none',
                color: '#FFFFFF',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.2rem',
                fontWeight: 700,
                transition: 'all 0.2s'
              }}
              onMouseOver={e => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.85)'; }}
              onMouseOut={e => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)'; }}
            >
              ✕
            </button>
          </div>
        </div>

        <div style={{ padding: '0.75rem 2rem', borderBottom: '1px solid #E2E8F0', fontSize: '0.82rem' }}>
          {!loading && !error && <p style={{ margin: '0 0 0.4rem', fontWeight: 700 }}>Total del periodo: {formatStatistic(quantity, unit === 'MXN')} {unit === 'MXN' ? '' : unit}</p>}
          {!loading && !error && quantity == null && data.length > 0 && <p style={{ margin: '0.4rem 0', color: '#92400E' }}>Estas filas se muestran para revisión. Aún no hay un total confirmado para este estadístico.</p>}
          {criterion && <p style={{ margin: '0.4rem 0', color: '#475569' }}>{criterion}</p>}
          {warnings.map((warning, index) => <p key={index} role="status" style={{ margin: '0.4rem 0', color: '#92400E' }}>{userMessage(warning)}</p>)}
          {(error || exportError) && <p role="alert" style={{ margin: '0.4rem 0', color: '#B91C1C' }}>{error || exportError}</p>}
        </div>

        {/* Toolbar & Search Filter */}
        <div style={{
          padding: '0.85rem 2rem',
          borderBottom: '1px solid #F1F5F9',
          background: '#F8FAFC',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{
              fontFamily: 'var(--font-display)',
              fontSize: '0.82rem',
              fontWeight: 700,
              color: 'var(--text-primary)'
            }}>
              Filas de detalle:
            </span>
            <span style={{
              background: '#E2E8F0',
              padding: '0.2rem 0.6rem',
              borderRadius: '8px',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.78rem',
              fontWeight: 700,
              color: '#0A2540'
            }}>
              {filteredData.length} de {data.length}
            </span>
          </div>

          <div style={{ position: 'relative', width: '320px', maxWidth: '100%' }}>
            <input
              type="text"
              aria-label="Buscar en el detalle"
              placeholder="Buscar por paciente, médico, folio, etc..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '0.45rem 1rem 0.45rem 2.2rem',
                borderRadius: '10px',
                border: '1px solid #CBD5E1',
                fontSize: '0.82rem',
                outline: 'none',
                fontFamily: 'var(--font-body)',
                background: '#FFFFFF'
              }}
            />
            <span style={{
              position: 'absolute',
              left: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#94A3B8',
              fontSize: '0.85rem',
              pointerEvents: 'none'
            }}>
              🔍
            </span>
          </div>
        </div>

        {/* Body Table Container */}
        <div style={{ flex: 1, overflow: 'auto', padding: '1rem 2rem' }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '1rem' }}>
              <div style={{
                width: 42,
                height: 42,
                border: '3px solid #E2E8F0',
                borderTop: '3px solid var(--color-azul-fuerte)',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }}/>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                Consultando registros en vivo...
              </span>
            </div>
          ) : error ? (
            <p style={{ color: '#64748B' }}>Cierra el detalle y vuelve a consultarlo.</p>
          ) : filteredData.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '0.5rem', color: '#64748B' }}>
              <span style={{ fontSize: '2.5rem' }}>📋</span>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem', fontWeight: 600, margin: 0 }}>
                {searchTerm ? 'No hay registros que coincidan con la búsqueda.' : 'Sin registros detallados para este periodo.'}
              </p>
            </div>
          ) : (
            <table style={{
              width: '100%',
              borderCollapse: 'separate',
              borderSpacing: 0,
              fontSize: '0.78rem',
              fontFamily: 'var(--font-body)'
            }}>
              <thead>
                <tr style={{ position: 'sticky', top: 0, zIndex: 10, background: '#F1F5F9' }}>
                  <th style={{ padding: '0.75rem 0.6rem', textAlign: 'center', borderBottom: '2px solid #CBD5E1', color: '#334155', fontWeight: 700, width: 40 }}>
                    #
                  </th>
                  {columns.map(col => (
                    <th
                      key={col}
                      style={{
                        padding: '0.75rem 0.85rem',
                        textAlign: col.includes('Total') || col.includes('Saldo') || col.includes('Monto') || col.includes('Cantidad') || col.includes('Dias') ? 'right' : 'left',
                        borderBottom: '2px solid #CBD5E1',
                        color: '#1E293B',
                        fontFamily: 'var(--font-display)',
                        fontWeight: 700,
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {columnLabel(col)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredData.map((row, idx) => (
                  <tr
                    key={idx}
                    style={{
                      background: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC',
                      borderBottom: '1px solid #E2E8F0',
                      transition: 'background 150ms'
                    }}
                    onMouseOver={e => { e.currentTarget.style.background = '#EFF6FF'; }}
                    onMouseOut={e => { e.currentTarget.style.background = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC'; }}
                  >
                    <td style={{ padding: '0.65rem 0.6rem', textAlign: 'center', color: '#94A3B8', fontFamily: 'var(--font-mono)', borderBottom: '1px solid #E2E8F0' }}>
                      {idx + 1}
                    </td>
                    {columns.map(col => {
                      const isNumeric = col.includes('Total') || col.includes('Saldo') || col.includes('Monto') || col.includes('Cantidad') || col.includes('Dias');
                      const isMono = isNumeric || col.startsWith('Fecha') || col.startsWith('Folio') || col.startsWith('No');
                      return (
                        <td
                          key={col}
                          style={{
                            padding: '0.65rem 0.85rem',
                            textAlign: isNumeric ? 'right' : 'left',
                            color: col.includes('Total') || col.includes('Monto') ? 'var(--color-azul-fuerte)' : '#334155',
                            fontFamily: isMono ? 'var(--font-mono)' : 'var(--font-body)',
                            fontWeight: col === 'Paciente' || col === 'PacienteBebe' || col.includes('Total') ? 600 : 400,
                            borderBottom: '1px solid #E2E8F0',
                            whiteSpace: col.length > 25 ? 'normal' : 'nowrap'
                          }}
                        >
                          {formatCellValue(col, row[col])}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '0.75rem 2rem',
          background: '#F8FAFC',
          borderTop: '1px solid #E2E8F0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.75rem',
          color: '#64748B',
          fontFamily: 'var(--font-body)'
        }}>
          <span>Los registros mostrados corresponden al criterio y periodo indicados.</span>
          <button
            onClick={onClose}
            style={{
              padding: '0.4rem 1.25rem',
              background: '#E2E8F0',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 600,
              color: '#334155',
              cursor: 'pointer'
            }}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
