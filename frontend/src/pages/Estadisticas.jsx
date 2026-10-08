import { userMessage } from '../utils/userMessages';
/**
 * Estadisticas.jsx — Estadísticas Demográficas y por Proceso
 * Hospital Escandón BI Platform v4.0
 * DATOS REALES DESDE BD - Rediseño premium
 */
import { useState, useEffect, useRef } from 'react';
import { useAuth }  from '../context/AuthContext';
import { AREAS_LABELS } from '../utils/rbac';
import EditableKPIWrapper from '../components/shared/EditableKPIWrapper';
import PBIModal from '../components/shared/PBIModal';
import { useKPIConfig } from '../hooks/useKPIConfig';
import DashboardVidasSalvadas from '../components/dashboard/DashboardVidasSalvadas';
import ModalDetalleEstadisticas from '../components/dashboard/ModalDetalleEstadisticas';
import PremiumLoader from '../components/shared/PremiumLoader';
import useEscapeKey from '../hooks/useEscapeKey';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend } from 'recharts';
import DashboardChart from '../components/dashboard/DashboardChart';
import { STATISTICS_START_DATE, statisticsDownloadError, statisticsNumber, statisticsSummary, formatStatistic, formatStatisticsSummary, mexicoDate, previousStatisticsMonth, validateStatisticsPeriod } from '../utils/statisticsPresentation';

const SECCIONES_ESTADISTICAS = [
  { id: '01_VIDAS SALVADAS', label: '❤️ Vidas Salvadas (Sala de Choque)' },
  { id: '02_NACIMIENTOS', label: '02. Recién nacidos en el hospital' },
  { id: '03_CUENTAS HOSPITALARIAS (HOSPITALIZACIÓN)', label: '🏥 Egresos de Hospitalización' },
  { id: '03_CUENTAS HOSPITALARIAS DE URGENCIAS', label: '🚨 Cuentas de Urgencias' },
  { id: '03_CUENTAS HOSPITALARIAS DE VA - SEGURO', label: '03. Cuentas de VaSeguro' },
  { id: '04_ADMISIÓN CONTINUA (CONSULTAS DE URGENCIAS)', label: '04. Servicios de consulta de urgencias' },
  { id: '05_ESTANCIA', label: '05. Servicios de estancia' },
  { id: '06_TERAPIA INTENSIVA (SER501, SER600, SER710, SER730)', label: '06. Servicios de terapia' },
  { id: '07_PERSONAS EN QX (USOQX1HR)', label: '✂️ Personas que pasaron por Quirófano' },
  { id: '08_CX ENDOSCOPIA, COLONOSCOPIA, BRONCOSCOPIA, PANENDOSCOPIA', label: '08. Procedimientos ambulatorios' },
  { id: '09_CONSULTAS DE ESPECIALIDAD', label: '👩‍⚕️ Consultas de Especialidad' },
  { id: '10_ESTADISTICO DE EST. IMAGEN', label: '🖼️ Estudios de Imagenología' },
  { id: '10_INGRESOS_IMAGEN', label: '10. Ingresos de imagenología' },
  { id: '11_ESTADISTICO EST. LABORA', label: '🧪 Estudios de Laboratorio' },
  { id: '11_INGRESOS_LABORATORIO', label: '11. Ingresos de laboratorio' },
  { id: '13_ESTADÍSTICO DE CIRUGÍAS', label: '🔪 Cirugías Realizadas' },
  { id: '14_MEDICOS_HOSPITALIZACION', label: '14. Top 10 médicos por ingreso en hospitalización' },
  { id: '15_MEDICOS_URGENCIAS', label: '15. Top 10 médicos por ingreso en urgencias' },
];

function DoctorsRanking({ title, doctors, loading }) {
  const maximum = Math.max(...doctors.map(doctor => statisticsNumber(doctor.n) ?? 0), 1);
  return (
    <section className="dashboard-panel" style={{ background: '#fff', borderRadius: 16, padding: '1.5rem', border: '1px solid #E2E8F0' }}>
      <h2 style={{ fontSize: '0.95rem', margin: '0 0 0.5rem', color: 'var(--text-primary)' }}>{title}</h2>
      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>Importe total de las órdenes de venta asociadas a cada médico.</p>
      {doctors.length ? doctors.slice(0, 10).map((doctor, index) => (
        <div key={`${doctor.area}-${index}`} style={{ marginBottom: '0.9rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.8rem' }}>
            <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}><b>{index + 1}.</b> {doctor.area}<small style={{ display: 'block', color: 'var(--text-muted)' }}>{doctor.especialidad || 'Especialidad no registrada'}</small></span>
            <b style={{ whiteSpace: 'nowrap', color: 'var(--color-azul-fuerte)' }}>{formatStatistic(doctor.n, true)}</b>
          </div>
          <div style={{ height: 5, marginTop: 6, background: '#EFF6FF', borderRadius: 5 }}><div style={{ height: '100%', width: `${Math.max(0, (statisticsNumber(doctor.n) ?? 0) / maximum * 100)}%`, background: 'var(--color-azul-fuerte)', borderRadius: 5 }} /></div>
        </div>
      )) : <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{loading ? 'Consultando médicos…' : 'No hay un ranking disponible para este periodo.'}</p>}
    </section>
  );
}

export default function Estadisticas() {
  const { user }              = useAuth();
  const { getKPI }            = useKPIConfig();
  const [periodo, setPeriodo] = useState('mes');
  const [loading, setLoading] = useState(false);
  const [toast, setToast]     = useState(null);
  const [data, setData]       = useState({ stats: [], dx: [], hospitalDoctors: [], emergencyDoctors: [], warnings: [], maxDx: 1 });
  const [statsError, setStatsError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [historyMeta, setHistoryMeta] = useState({ warnings: [], unit: '', criterion: '' });
  const [reportOpen, setReportOpen] = useState(false);
  const [reportDates, setReportDates] = useState(previousStatisticsMonth);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState('');
  const [tableExportBusy, setTableExportBusy] = useState(false);
  const requests = useRef({ stats: null, history: null, detail: null, report: null });
  const toastTimer = useRef(null);
  const [pbiModal, setPBIModal] = useState(null);
  const [showVidasSalvadasModal, setShowVidasSalvadasModal] = useState(false);

  useEscapeKey(() => setShowVidasSalvadasModal(false), showVidasSalvadasModal);

  // Estados para el explorador histórico de Excel
  const [selectedSeccion, setSelectedSeccion] = useState('01_VIDAS SALVADAS');
  const [historyRequest, setHistoryRequest] = useState(0);
  const [seccionData, setSeccionData] = useState(null);
  const [loadingHist, setLoadingHist] = useState(false);
  const [activeTab, setActiveTab] = useState('tabla');
  const currentYear = Number(mexicoDate().slice(0, 4));
  const [selectedYearGraf, setSelectedYearGraf] = useState(currentYear);

  // Estado para el modal de desglose interactivo (drill-down)
  const [detailModal, setDetailModal] = useState({
    isOpen: false,
    seccionId: '',
    seccionLabel: '',
    year: currentYear,
    mes: 1,
    mesNombre: '',
    data: [],
    loading: false,
    error: '', warnings: [], quantity: null, unit: '', criterion: '',
  });

  const handleKPIClick = (url, title, url2, url3, multiPagina) => setPBIModal({ url, title, url2, url3, multiPagina });

  const isRestricted = user?.role === 'JEFE_AREA';
  const areaLabel    = user?.area ? AREAS_LABELS[user.area] : '';

  const showToast = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  };

  useEffect(() => {
    const controller = new AbortController();
    requests.current.stats = controller;
    fetchRealStats(controller);
    return () => controller.abort();
  }, [periodo]);

  useEffect(() => {
    if (!historyRequest) return;
    const controller = new AbortController();
    requests.current.history = controller;
    fetchSeccionHistorica(controller);
    return () => controller.abort();
  }, [selectedSeccion, historyRequest]);

  useEffect(() => () => {
    Object.values(requests.current).forEach(controller => controller?.abort());
    clearTimeout(toastTimer.current);
  }, []);

  const authHeaders = () => ({ Authorization: `Bearer ${sessionStorage.getItem('escandon_token')}` });
  const readResponse = async (response, fallback) => {
    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.ok) throw new Error(userMessage(json?.message || json?.error || fallback));
    return json;
  };

  const fetchRealStats = async (controller) => {
    setLoading(true);
    setStatsError('');
    setData({ stats: [], dx: [], hospitalDoctors: [], emergencyDoctors: [], warnings: [], maxDx: 1 });
    try {
      const response = await fetch(`/api/dashboard/stats?periodo=${encodeURIComponent(periodo)}`, {
        headers: authHeaders(), signal: controller.signal,
      });
      const json = await readResponse(response, 'No se pudieron consultar las estadísticas. Intenta de nuevo.');
      if (controller.signal.aborted) return;
      const { general, diagnosticos = [], medicosHospitalizacion = [], medicosUrgencias = [], warnings = [], criteria = {} } = json.data;
      const display = (key, suffix = '') => statisticsNumber(general?.[key]) === null ? 'No disponible' : `${formatStatistic(general[key])}${suffix}`;
      const stats = [
        { id: 'stats.egresos_total', label: `Egresos (${periodo})`, value: display('TotalEgresos'), pct: 'Egresos del periodo', up: null },
        { id: 'stats.promedio_edad', label: 'Promedio de edad', value: display('PromedioEdad', ' a'), pct: 'Pacientes con edad registrada', up: null },
        { id: 'stats.genero_femenino', label: '% Género femenino', value: display('pctFemenino', '%'), pct: 'Distribución de pacientes', up: null },
        { id: 'stats.defunciones', label: 'Defunciones', value: display('Defunciones'), pct: 'Egresos por defunción', up: null },
        { id: 'stats.nacimientos', label: 'Nacimientos en el hospital', value: display('Nacimientos'), pct: 'Nacimiento hospitalario registrado', up: null },
        { id: 'stats.estancia_global', label: 'Estancia promedio', value: display('EstanciaPromedio', ' d'), pct: 'Duración de hospitalización', up: null },
        { id: 'stats.vidas_salvadas', label: 'Vidas salvadas', value: display('VidasSalvadas'), pct: 'Atenciones con sala de choque', up: null },
      ];
      setData({ stats, dx: Array.isArray(diagnosticos) ? diagnosticos : [],
        hospitalDoctors: Array.isArray(medicosHospitalizacion) ? medicosHospitalizacion : [],
        emergencyDoctors: Array.isArray(medicosUrgencias) ? medicosUrgencias : [],
        warnings, criteria, maxDx: Math.max(...(diagnosticos || []).map(row => Number(row.n) || 0), 1) });
    } catch (error) {
      if (!controller.signal.aborted) setStatsError(userMessage(error.message || 'No se pudieron consultar las estadísticas. Intenta de nuevo.'));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  const fetchSeccionHistorica = async (controller) => {
    setLoadingHist(true);
    setHistoryError('');
    setSeccionData(null);
    setHistoryMeta({ warnings: [], unit: '', criterion: '' });
    try {
      const response = await fetch(`/api/dashboard/stats-historico?seccion=${encodeURIComponent(selectedSeccion)}`, {
        headers: authHeaders(), signal: controller.signal,
      });
      const json = await readResponse(response, 'No se pudo consultar el histórico. Intenta de nuevo.');
      if (controller.signal.aborted) return;
      setSeccionData(json.data);
      setHistoryMeta({ warnings: json.warnings || [], unit: json.unit || '', criterion: json.criterion || '' });
    } catch (error) {
      if (!controller.signal.aborted) setHistoryError(userMessage(error.message || 'No se pudo consultar el histórico. Intenta de nuevo.'));
    } finally {
      if (!controller.signal.aborted) setLoadingHist(false);
    }
  };

  const closeDetail = () => {
    requests.current.detail?.abort();
    setDetailModal(previous => ({ ...previous, isOpen: false }));
  };

  const handleOpenDetail = async (seccionId, year, mes, mesNombre) => {
    requests.current.detail?.abort();
    const controller = new AbortController();
    requests.current.detail = controller;
    const seccionLabel = SECCIONES_ESTADISTICAS.find(section => section.id === seccionId)?.label || 'Detalle del estadístico';
    setDetailModal({ isOpen: true, seccionId, seccionLabel, year, mes, mesNombre, data: [], loading: true, error: '', warnings: [], quantity: null, unit: '', criterion: '' });
    try {
      const response = await fetch(`/api/dashboard/stats-detalle?seccion=${encodeURIComponent(seccionId)}&year=${year}&mes=${mes}`, {
        headers: authHeaders(), signal: controller.signal,
      });
      const json = await readResponse(response, 'No se pudo consultar el detalle. Intenta de nuevo.');
      if (controller.signal.aborted) return;
      setDetailModal(previous => ({ ...previous, data: Array.isArray(json.data) ? json.data : [], loading: false,
        warnings: json.warnings || [], quantity: json.quantity ?? null, unit: json.unit || '', criterion: json.criterion || '' }));
    } catch (error) {
      if (!controller.signal.aborted) setDetailModal(previous => ({ ...previous, loading: false, error: userMessage(error.message || 'No se pudo consultar el detalle. Intenta de nuevo.') }));
    }
  };

  const handleGenerateReport = async event => {
    event.preventDefault();
    if (requests.current.report) return;
    const validation = validateStatisticsPeriod(reportDates.startDate, reportDates.endDate);
    if (validation) { setReportError(validation); return; }
    const controller = new AbortController();
    requests.current.report = controller;
    setReportBusy(true);
    setReportError('');
    setToast(null);
    try {
      const params = new URLSearchParams(reportDates);
      const response = await fetch(`/api/dashboard/stats-export?${params}`, { headers: authHeaders(), signal: controller.signal });
      if (!response.ok || !(response.headers.get('Content-Type') || '').includes('spreadsheetml')) {
        const json = await response.json().catch(() => null);
        throw new Error(userMessage(statisticsDownloadError(response.status, json)));
      }
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      if (!blob.size) throw new Error('El archivo no contiene datos. Intenta generarlo de nuevo.');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Estadistico_${reportDates.startDate}_${reportDates.endDate}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('Estadístico generado. Revisa el resumen y las observaciones del archivo.');
    } catch (error) {
      if (!controller.signal.aborted) setReportError(userMessage(error.message || 'No se pudo generar el estadístico. Intenta de nuevo.'));
    } finally {
      if (!controller.signal.aborted) setReportBusy(false);
      if (requests.current.report === controller) requests.current.report = null;
    }
  };

  const añosList = Array.from({ length: Math.max(currentYear - 2016 + 1, 1) }, (_, index) => 2016 + index);
  const mesesNombres = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const monetary = selectedSeccion.includes('INGRESOS') || selectedSeccion.startsWith('14_') || selectedSeccion.startsWith('15_');
  const totalAnual = Object.fromEntries(añosList.map(year => [year, statisticsSummary(mesesNombres.map((_, index) => seccionData?.[year]?.[index + 1]))]));
  const totalMensual = Object.fromEntries(mesesNombres.map((_, index) => [index + 1, statisticsSummary(añosList.map(year => seccionData?.[year]?.[index + 1]))]));
  const granTotal = statisticsSummary(añosList.flatMap(year => mesesNombres.map((_, index) => seccionData?.[year]?.[index + 1])));
  const dataGrafAnual = añosList.map(year => ({ name: String(year), Total: totalAnual[year].value, partial: totalAnual[year].partial }));
  const dataGrafMensual = mesesNombres.map((name, index) => ({ name, Cantidad: statisticsNumber(seccionData?.[selectedYearGraf]?.[index + 1]) }));

  const exportCurrentTable = async () => {
    if (tableExportBusy || !seccionData) return;
    setTableExportBusy(true);
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.utils.book_new();
      const summaryCell = summary => summary.partial || summary.value === null ? formatStatisticsSummary(summary, monetary) : summary.value;
      const sectionLabel = SECCIONES_ESTADISTICAS.find(section => section.id === selectedSeccion)?.label || 'Estadístico';
      const rows = [[sectionLabel], [historyMeta.criterion], ['Unidad', historyMeta.unit],
        ['Mes', ...añosList, 'Total'], ...mesesNombres.map((name, index) => [name,
          ...añosList.map(year => statisticsNumber(seccionData?.[year]?.[index + 1]) ?? 'No disponible'), summaryCell(totalMensual[index + 1])]),
        ['Total anual', ...añosList.map(year => summaryCell(totalAnual[year])), summaryCell(granTotal)],
        ['Los totales parciales suman únicamente los periodos disponibles.'],
        ...historyMeta.warnings.map(warning => [userMessage(warning)]),
      ];
      const sheet = XLSX.utils.aoa_to_sheet(rows);
      sheet['!cols'] = [{ wch: 24 }, ...añosList.map(() => ({ wch: 20 })), { wch: 24 }];
      XLSX.utils.book_append_sheet(workbook, sheet, 'Histórico');
      XLSX.writeFile(workbook, `Estadisticas_${selectedSeccion.slice(0, 2)}.xlsx`);
    } catch {
      showToast('No se pudo exportar la tabla. Intenta de nuevo.');
    } finally { setTableExportBusy(false); }
  };

  return (
    <div className="dashboard-view" style={{ maxWidth:'var(--content-max, 1200px)', margin:'0 auto' }}>
      <style>{`
        .est-kpi-card:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-md) !important;
        }
        .table-row-hover:hover {
          background: rgba(0,70,135,0.02) !important;
        }
      `}</style>

      {pbiModal && (
        <PBIModal {...pbiModal} onClose={() => setPBIModal(null)} />
      )}

      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, var(--color-azul-fuerte) 0%, #083b66 100%)',
        borderRadius: 20, padding: '1.5rem 2.25rem', marginBottom: '2rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        boxShadow: 'var(--shadow-md)',
        position: 'relative',
        overflow: 'hidden',
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
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.64rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.65)', marginBottom: '0.35rem' }}>
            {isRestricted ? `Estadísticas — ${areaLabel}` : 'Estadísticas Globales'}
          </div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: '1.65rem', fontWeight: 800, color: 'white', margin: 0, letterSpacing: '-0.01em' }}>
            Análisis Demográfico y por Proceso
          </h1>
        </div>

        <button type="button" onClick={() => { setReportOpen(open => !open); setReportError(''); }} disabled={reportBusy}
          aria-expanded={reportOpen} aria-controls="statistics-report-form"
          style={{ position: 'relative', padding: '0.65rem 1rem', borderRadius: 10, border: '1px solid #fff', color: '#083b66', background: '#fff', fontWeight: 700, cursor: reportBusy ? 'wait' : 'pointer' }}>
          {reportOpen ? 'Cerrar formulario' : 'Generar estadístico'}
        </button>

        {/* Filtro de período capsule style */}
        <div style={{
          display: 'flex',
          background: 'rgba(255, 255, 255, 0.12)',
          padding: '3px',
          borderRadius: '12px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          position: 'relative',
          zIndex: 1
        }}>
          {['semana','mes','trimestre','año'].map(p => {
            const isSelected = periodo === p;
            return (
              <button key={p} onClick={() => setPeriodo(p)} style={{
                padding:'0.45rem 1rem',
                background: isSelected ? '#FFFFFF' : 'transparent',
                border:'none',
                borderRadius: 9,
                color: isSelected ? 'var(--color-azul-fuerte)' : '#FFFFFF',
                fontFamily: "var(--font-display)",
                fontSize: '0.78rem',
                fontWeight: isSelected ? 700 : 500,
                cursor: 'pointer',
                transition: 'all 200ms ease',
                textTransform: 'capitalize',
                boxShadow: isSelected ? '0 2px 8px rgba(0,0,0,0.15)' : 'none',
              }}>{p}</button>
            );
          })}
        </div>
      </div>

      {reportOpen && (
        <form id="statistics-report-form" onSubmit={handleGenerateReport} aria-busy={reportBusy}
          style={{ background: '#fff', border: '1px solid #CBD5E1', borderRadius: 16, padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.5rem' }}>Generar estadístico completo</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0 0 1rem' }}>Elige las fechas para descargar el resumen, los detalles y las observaciones en un solo Excel. Ambas fechas se incluyen.</p>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ display: 'grid', gap: 5, fontSize: '0.85rem' }}>Desde
              <input type="date" required min={STATISTICS_START_DATE} max={mexicoDate()} value={reportDates.startDate} disabled={reportBusy}
                onChange={event => { setReportDates(dates => ({ ...dates, startDate: event.target.value })); setReportError(''); }} style={{ padding: '0.6rem', border: '1px solid #CBD5E1', borderRadius: 8 }} />
            </label>
            <label style={{ display: 'grid', gap: 5, fontSize: '0.85rem' }}>Hasta
              <input type="date" required min={reportDates.startDate || STATISTICS_START_DATE} max={mexicoDate()} value={reportDates.endDate} disabled={reportBusy}
                onChange={event => { setReportDates(dates => ({ ...dates, endDate: event.target.value })); setReportError(''); }} style={{ padding: '0.6rem', border: '1px solid #CBD5E1', borderRadius: 8 }} />
            </label>
            <button type="submit" disabled={reportBusy} style={{ padding: '0.7rem 1rem', background: 'var(--color-azul-fuerte)', color: '#fff', border: 0, borderRadius: 8, fontWeight: 700, cursor: reportBusy ? 'wait' : 'pointer' }}>
              {reportBusy ? 'Generando estadístico…' : 'Descargar Excel completo'}
            </button>
          </div>
          {reportBusy && <p role="status" style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Estamos consultando y reuniendo la información del periodo. Puede tardar varios minutos. Mantén esta página abierta; la descarga comenzará al terminar.</p>}
          {reportError && <p role="alert" style={{ color: '#B91C1C', marginBottom: 0 }}>{reportError}</p>}
        </form>
      )}
      {statsError && <p role="alert" style={{ padding: '1rem', color: '#991B1B', background: '#FEF2F2', borderRadius: 10 }}>{statsError}</p>}
      {data.warnings?.length > 0 && <div role="status" style={{ padding: '1rem', background: '#FFFBEB', color: '#92400E', borderRadius: 10, marginBottom: '1rem' }}>{data.warnings.map((warning, index) => <p key={index} style={{ margin: '0.3rem 0' }}>{userMessage(warning)}</p>)}</div>}

      {/* KPIs demográficos */}
      {loading && data.stats.length === 0 ? (
        <div style={{ padding: '4rem', display: 'flex', justifyContent: 'center' }}>
          <PremiumLoader />
        </div>
      ) : (
        <>
          <div className="dashboard-metric-grid" style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:'1rem', marginBottom:'2rem', opacity: loading ? 0.55 : 1, transition: 'opacity 0.3s ease' }}>
        {data.stats.map(s => {
          const kpiConfig = getKPI(s.id, s.label);
          const displayName = s.id === 'stats.nacimientos' ? s.label : (kpiConfig?.nombre || s.label);
          const displayIcon = kpiConfig?.icono;
          const accentColor = s.up === true ? 'var(--color-verde-e)' : s.up === false ? 'var(--color-danger)' : 'var(--color-azul-fuerte)';
          return (
            <div
              key={s.id}
              className={"dashboard-metric-card " + (`est-kpi-card ${s.id === 'stats.vidas_salvadas' ? 'kpi-clickable' : ''}`)}
              onClick={() => {
                if (s.id === 'stats.vidas_salvadas') {
                  setShowVidasSalvadasModal(true);
                }
              }}
              style={{
                background:'#FFFFFF', borderRadius:'14px', padding:'1.1rem 1.25rem',
                border:'1px solid rgba(0,70,135,0.05)',
                borderLeft: `4px solid ${accentColor}`,
                boxShadow:'var(--shadow-xs)',
                height: '100%', boxSizing: 'border-box',
                display: 'flex', flexDirection: 'column', justifyContent: 'center',
                transition: 'all var(--transition-base)',
                position: 'relative',
                cursor: s.id === 'stats.vidas_salvadas' ? 'pointer' : 'default',
              }}
            >
              {displayIcon && (
                <div style={{ position: 'absolute', right: 12, top: 12, fontSize: '1.2rem', opacity: 0.1, pointerEvents: 'none' }}>{displayIcon}</div>
              )}
              <div className="dashboard-metric-label" style={{ fontFamily: 'var(--font-display)', fontSize:'0.64rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--text-muted)', marginBottom:'0.35rem' }}>{displayName}</div>
              <div className="dashboard-metric-value" style={{ fontFamily:"var(--font-mono)", fontSize:'1.65rem', fontWeight:700, color:'var(--text-primary)', lineHeight:1, marginBottom:'0.25rem', letterSpacing: '-0.02em' }}>{s.value}</div>
              <div className="dashboard-metric-note" style={{ fontFamily: 'var(--font-body)', fontSize:'0.72rem', fontWeight:600, color: s.up===true ? 'var(--color-verde-e)' : s.up===false ? 'var(--color-danger)' : 'var(--text-muted)' }}>
                {s.up===true ? '▲ ' : s.up===false ? '▼ ' : '● '}{s.pct}
              </div>
            </div>
          );
        })}
          </div>

          {/* Diagnósticos top & Distribución */}
          <div className="dashboard-chart-grid" style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 350px), 1fr))', gap:'1.5rem', opacity: loading ? 0.55 : 1, transition: 'opacity 0.3s ease', marginBottom: '2rem' }}>
        
        {/* Facturación por Área */}
        <EditableKPIWrapper elementoId="stats.top_diagnosticos" isAdmin={user?.role === 'ADMIN'} onKPIClick={handleKPIClick} accentColor="var(--color-azul-fuerte)">
          <div className="dashboard-panel" style={{ background:'#FFFFFF', borderRadius:'16px', padding:'1.5rem', border:'1px solid rgba(0,70,135,0.05)', boxShadow:'var(--shadow-xs)', height: '100%', boxSizing: 'border-box' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'1.25rem' }}>
              <div style={{ width:4, height:18, background:'var(--color-azul-fuerte)', borderRadius:2 }}/>
              <span style={{ fontFamily:"var(--font-display)", fontSize:'0.95rem', fontWeight:700, color: 'var(--text-primary)' }}>Ingresos por órdenes de venta</span>
            </div>
            {data.criteria?.ingresos && <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 1rem' }}>{data.criteria.ingresos}</p>}
            {data.dx.length > 0 ? data.dx.map((d, i) => (
              <div key={d.dx} style={{ marginBottom:'0.875rem' }}>
                <div className="dashboard-html-chart-summary" style={{ display:'flex', justifyContent:'space-between', marginBottom:'0.3rem', alignItems: 'center' }}>
                  <span className="dashboard-html-chart-label" style={{ fontFamily: 'var(--font-body)', fontSize:'0.82rem', color:'var(--text-primary)', fontWeight:600, maxWidth:'65%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', color:'var(--text-muted)', marginRight:'0.5rem', fontSize: '0.78rem' }}>#{i+1}</span>{d.dx}
                  </span>
                  <span className="dashboard-html-chart-value" style={{ fontFamily: 'var(--font-mono)', fontSize:'0.8rem', fontWeight:700, color:'var(--color-azul-fuerte)', flexShrink:0 }}>
                    ${d.n?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 
                    <span style={{ color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.72rem', marginLeft:'4px' }}>({d.pct}%)</span>
                  </span>
                </div>
                <div className="dashboard-html-chart-track" style={{ height:6, background:'rgba(0,70,135,0.04)', borderRadius:100, overflow:'hidden' }}>
                  <div className="dashboard-html-chart-bar" style={{
                    height:'100%',
                    width:`${(d.n/data.maxDx)*100}%`,
                    background:`linear-gradient(90deg, var(--color-azul-fuerte), var(--color-azul-claro))`,
                    borderRadius:100,
                    transition:'width 0.8s ease',
                  }}/>
                </div>
              </div>
            )) : loading ? (
              <p style={{ textAlign:'center', color:'var(--text-muted)', fontSize:'0.85rem', padding:'2.5rem 0', fontFamily: 'var(--font-body)' }}>Consultando ingresos...</p>
            ) : (
              <p style={{ textAlign:'center', color:'var(--text-muted)', fontSize:'0.85rem', padding:'2.5rem 0', fontFamily: 'var(--font-body)' }}>No hay ingresos disponibles para este periodo.</p>
            )}
          </div>
        </EditableKPIWrapper>

        <DoctorsRanking title="Top 10 médicos por ingreso en hospitalización" doctors={data.hospitalDoctors} loading={loading} />
        <DoctorsRanking title="Top 10 médicos por ingreso en urgencias" doctors={data.emergencyDoctors} loading={loading} />
      </div>
      </>
      )}

      {/* Explorador de Estadísticas Históricas */}
      <div style={{ background: '#FFFFFF', borderRadius: '16px', padding: '2rem', border: '1px solid rgba(0,70,135,0.05)', boxShadow: 'var(--shadow-sm)', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid #F1F5F9', paddingBottom: '1rem', marginBottom: '1.5rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
              <div style={{ width: 4, height: 20, background: 'var(--color-azul-fuerte)', borderRadius: 2 }}/>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                Explorador de Estadísticas Institucionales
              </h2>
            </div>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
              Consulta los criterios y la unidad de cada estadístico. Los periodos sin información comprobable se muestran como no disponibles.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', maxWidth: '100%', minWidth: 0 }}>
            <select
              aria-label="Estadístico a consultar"
              value={selectedSeccion}
              disabled={reportBusy}
              onChange={(e) => { setSelectedSeccion(e.target.value); setHistoryRequest(value => value + 1); }}
              style={{
                maxWidth: '100%',
                padding: '0.45rem 1rem',
                borderRadius: '10px',
                border: '1px solid #CBD5E1',
                fontFamily: 'var(--font-body)',
                fontSize: '0.82rem',
                color: 'var(--text-primary)',
                fontWeight: 600,
                outline: 'none',
                cursor: 'pointer',
                boxShadow: 'var(--shadow-xs)',
                background: '#FFFFFF'
              }}
            >
              {SECCIONES_ESTADISTICAS.map(sec => (
                <option key={sec.id} value={sec.id}>{sec.label}</option>
              ))}
            </select>

            <button type="button" onClick={() => setHistoryRequest(value => value + 1)} disabled={loadingHist || reportBusy}
              style={{ padding: '0.5rem 0.85rem', border: 0, borderRadius: 8, background: 'var(--color-azul-fuerte)', color: '#fff', fontWeight: 600, cursor: loadingHist || reportBusy ? 'wait' : 'pointer' }}>
              Consultar histórico
            </button>

            <div style={{ display: 'flex', background: '#F1F5F9', padding: '3px', borderRadius: '10px' }}>
              <button
                onClick={() => setActiveTab('tabla')}
                style={{
                  padding: '0.4rem 0.85rem',
                  border: 'none',
                  background: activeTab === 'tabla' ? '#FFFFFF' : 'transparent',
                  borderRadius: '7px',
                  fontFamily: 'var(--font-display)',
                  fontSize: '0.78rem',
                  fontWeight: activeTab === 'tabla' ? 700 : 500,
                  color: activeTab === 'tabla' ? 'var(--color-azul-fuerte)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  boxShadow: activeTab === 'tabla' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.2s'
                }}
              >
                Tabla
              </button>
              <button
                onClick={() => setActiveTab('grafico')}
                style={{
                  padding: '0.4rem 0.85rem',
                  border: 'none',
                  background: activeTab === 'grafico' ? '#FFFFFF' : 'transparent',
                  borderRadius: '7px',
                  fontFamily: 'var(--font-display)',
                  fontSize: '0.78rem',
                  fontWeight: activeTab === 'grafico' ? 700 : 500,
                  color: activeTab === 'grafico' ? 'var(--color-azul-fuerte)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  boxShadow: activeTab === 'grafico' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.2s'
                }}
              >
                Gráfico
              </button>
            </div>
          </div>
        </div>

        {historyError && <p role="alert" style={{ color: '#B91C1C' }}>{historyError}</p>}
        {!loadingHist && historyMeta.criterion && <p style={{ fontSize: '0.83rem', color: 'var(--text-muted)' }}>{historyMeta.criterion}</p>}
        {!loadingHist && historyMeta.unit && <p style={{ fontSize: '0.8rem', fontWeight: 600 }}>Unidad: {historyMeta.unit}</p>}
        {!loadingHist && historyMeta.warnings.map((warning, index) => <p role="status" key={index} style={{ fontSize: '0.82rem', color: '#92400E' }}>{userMessage(warning)}</p>)}
        {historyRequest > 0 && !loadingHist && <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Los totales marcados como parciales solo suman los periodos disponibles.</p>}
        {!historyRequest ? <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Elige un estadístico o pulsa Consultar histórico para cargar sus resultados mensuales.</p> : loadingHist ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem 0' }}>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Cargando datos históricos...</span>
          </div>
        ) : (
          activeTab === 'tabla' ? (
            <div style={{ overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: '12px', background: '#FFFFFF' }}>
              <div style={{ padding: '1rem', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'flex-end' }}>
                <button 
                  onClick={exportCurrentTable}
                  disabled={tableExportBusy || !seccionData || Boolean(historyError)}
                  style={{
                    padding: '0.4rem 1rem', background: '#10B981', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem'
                  }}
                >
                  {tableExportBusy ? 'Exportando…' : 'Exportar tabla actual'}
                </button>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.76rem' }}>
                <thead>
                  <tr style={{ background: '#F8FAFC', borderBottom: '2px solid #E2E8F0' }}>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontFamily: 'var(--font-display)', color: 'var(--text-primary)', fontWeight: 700 }}>Mes</th>
                    {añosList.map(año => (
                      <th key={año} style={{ padding: '0.75rem 0.6rem', color: 'var(--text-primary)', fontWeight: 700 }}>{año}</th>
                    ))}
                    <th style={{ padding: '0.75rem 1rem', fontFamily: 'var(--font-display)', color: 'var(--color-azul-fuerte)', fontWeight: 700 }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {mesesNombres.map((mesNombre, mIdx) => {
                    const m = mIdx + 1;
                    return (
                      <tr key={m} style={{ borderBottom: '1px solid #E2E8F0', transition: 'background 100ms' }} className="table-row-hover">
                        <td style={{ padding: '0.65rem 1rem', textAlign: 'left', fontFamily: 'var(--font-display)', color: 'var(--text-primary)', fontWeight: 600 }}>{mesNombre}</td>
                        {añosList.map(año => {
                          const val = statisticsNumber(seccionData?.[año]?.[m]);
                          const isClickable = (año > 2026 || (año === 2026 && m >= 4)) && `${año}-${String(m).padStart(2, '0')}` <= mexicoDate().slice(0, 7) && Boolean(seccionData) && !historyError;
                          return (
                            <td key={año} style={{ padding: '0.45rem 0.5rem', textAlign: 'right' }}>
                              {isClickable ? (
                                <button
                                  onClick={() => handleOpenDetail(selectedSeccion, año, m, mesNombre)}
                                  title={`Ver detalle de ${mesNombre} ${año}`}
                                  style={{
                                    background: 'rgba(0, 70, 135, 0.07)',
                                    color: 'var(--color-azul-fuerte)',
                                    border: '1px solid rgba(0, 70, 135, 0.22)',
                                    borderRadius: '7px',
                                    padding: '0.25rem 0.55rem',
                                    fontFamily: 'var(--font-mono)',
                                    fontSize: '0.76rem',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                  }}
                                  onMouseOver={e => {
                                    e.currentTarget.style.background = 'var(--color-azul-fuerte)';
                                    e.currentTarget.style.color = '#FFFFFF';
                                    e.currentTarget.style.transform = 'translateY(-1px)';
                                    e.currentTarget.style.boxShadow = '0 3px 8px rgba(0,70,135,0.28)';
                                  }}
                                  onMouseOut={e => {
                                    e.currentTarget.style.background = 'rgba(0, 70, 135, 0.07)';
                                    e.currentTarget.style.color = 'var(--color-azul-fuerte)';
                                    e.currentTarget.style.transform = 'none';
                                    e.currentTarget.style.boxShadow = 'none';
                                  }}
                                >
                                  <span>{formatStatistic(val, monetary)}</span>
                                  <span style={{ fontSize: '0.62rem', opacity: 0.8 }}>🔍</span>
                                </button>
                              ) : (
                                <span style={{ color: año === currentYear ? 'var(--color-azul-claro)' : 'var(--text-primary)', fontWeight: año === currentYear ? 700 : 400 }}>
                                  {formatStatistic(val, monetary)}
                                </span>
                              )}
                            </td>
                          );
                        })}
                        <td style={{ padding: '0.65rem 1rem', fontWeight: 700, color: 'var(--color-azul-fuerte)' }}>
                          {formatStatisticsSummary(totalMensual[m], monetary)}
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={{ background: '#F8FAFC', borderTop: '2px solid #E2E8F0', fontWeight: 700 }}>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'left', fontFamily: 'var(--font-display)', color: 'var(--color-azul-fuerte)' }}>Total Anual</td>
                    {añosList.map(año => (
                      <td key={año} style={{ padding: '0.75rem 0.6rem', color: 'var(--color-azul-fuerte)' }}>
                        {formatStatisticsSummary(totalAnual[año], monetary)}
                      </td>
                    ))}
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--color-accent-warm)', fontSize: '0.8rem' }}>
                      {formatStatisticsSummary(granTotal, monetary)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div className="dashboard-chart-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '1.5rem' }}>
              <div className="dashboard-panel" style={{ background: '#F8FAFC', borderRadius: '12px', padding: '1.25rem', border: '1px solid #E2E8F0' }}>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 1rem 0' }}>
                  Tendencia histórica anual (2016 – {currentYear})
                </h3>
                <div className="dashboard-chart-host" style={{ height: 260 }}>
                  <DashboardChart width="100%" height="100%">
                    <BarChart data={dataGrafAnual} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                      <XAxis dataKey="name" stroke="#64748B" fontSize={10} tickLine={false} />
                      <YAxis stroke="#64748B" fontSize={10} tickLine={false} />
                      <RechartsTooltip formatter={(value, _name, item) => [formatStatistic(value, monetary), item.payload.partial ? 'Total parcial' : 'Total']} />
                      <Bar dataKey="Total" fill="var(--color-azul-fuerte)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </DashboardChart>
                </div>
              </div>

              <div style={{ background: '#F8FAFC', borderRadius: '12px', padding: '1.25rem', border: '1px solid #E2E8F0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                    Distribución Mensual del Año
                  </h3>
                  <select
                    value={selectedYearGraf}
                    onChange={(e) => setSelectedYearGraf(parseInt(e.target.value))}
                    style={{
                      padding: '0.25rem 0.6rem',
                      borderRadius: '6px',
                      border: '1px solid #CBD5E1',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      outline: 'none',
                      cursor: 'pointer',
                      background: '#FFFFFF'
                    }}
                  >
                    {añosList.map(a => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </div>
                <div className="dashboard-chart-host" style={{ height: 260 }}>
                  <DashboardChart width="100%" height="100%">
                    <LineChart data={dataGrafMensual} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                      <XAxis dataKey="name" stroke="#64748B" fontSize={9} tickLine={false} />
                      <YAxis stroke="#64748B" fontSize={10} tickLine={false} />
                      <RechartsTooltip formatter={value => [formatStatistic(value, monetary), historyMeta.unit || 'Cantidad']} />
                      <Line type="monotone" dataKey="Cantidad" stroke="var(--color-accent-warm)" strokeWidth={3} dot={{ r: 3, strokeWidth: 2 }} activeDot={{ r: 5 }} />
                    </LineChart>
                  </DashboardChart>
                </div>
              </div>
            </div>
          )
        )}
      </div>

      {/* Vidas Salvadas Modal Overlay */}
      {showVidasSalvadasModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(13, 27, 42, 0.7)', backdropFilter: 'blur(4px)',
          zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <div style={{
            background: 'white', borderRadius: 20, width: '90%', maxWidth: 1000,
            maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            position: 'relative', animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
          }}>
            {/* Header Modal */}
            <div style={{
              padding: '1.5rem 2rem', borderBottom: '1px solid #E2E8F0',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              background: '#F8FAFC'
            }}>
              <div>
                <h2 style={{ margin: 0, color: '#0D1B2A', fontSize: '1.4rem', fontFamily: "'DM Sans', sans-serif" }}>
                  ❤️ Detalle de Vidas Salvadas (SAP B1)
                </h2>
                <p style={{ margin: '0.25rem 0 0 0', color: '#64748B', fontSize: '0.9rem' }}>
                  Mostrando detalle del periodo seleccionado: <b>{periodo}</b>
                </p>
              </div>
              <button 
                onClick={() => setShowVidasSalvadasModal(false)}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  width: 40, height: 40, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#64748B', transition: 'all 0.2s'
                }}
                onMouseOver={e => { e.currentTarget.style.background = '#E2E8F0'; e.currentTarget.style.color = '#EF4444'; }}
                onMouseOut={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#64748B'; }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            
            {/* Body Modal */}
            <div style={{ padding: '0 1rem 1rem 1rem', overflowY: 'auto' }}>
              <DashboardVidasSalvadas periodo={periodo} />
            </div>
          </div>
        </div>
      )}

      {/* Modal Desglose Granular & Exportación Excel */}
      <ModalDetalleEstadisticas
        {...detailModal}
        onClose={closeDetail}
      />

      {/* Toast Notification */}
      {toast && (
        <div style={{
          position:'fixed', bottom:30, left:'50%', transform:'translateX(-50%)',
          background:'var(--text-primary)', color:'white', padding:'0.75rem 1.5rem',
          borderRadius:100, fontSize:'0.82rem', fontWeight:600, boxShadow:'var(--shadow-lg)',
          zIndex:2000, display:'flex', alignItems:'center', gap:'0.5rem',
          fontFamily: 'var(--font-body)',
          animation: 'slideUpToast 300ms cubic-bezier(0.16, 1, 0.3, 1)'
        }}>
          <span style={{ color: 'var(--color-success)' }}>✓</span> {toast}
        </div>
      )}
      
    </div>
  );
}
