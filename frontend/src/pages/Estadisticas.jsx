import { userMessage } from '../utils/userMessages';

import { useState, useEffect, useRef } from 'react';
import { useAuth }  from '../context/AuthContext';
import { AREAS_LABELS } from '../utils/rbac';
import EditableKPIWrapper from '../components/shared/EditableKPIWrapper';
import PBIModal from '../components/shared/PBIModal';
import { useKPIConfig } from '../hooks/useKPIConfig';
import ModalDetalleEstadisticas from '../components/dashboard/ModalDetalleEstadisticas';
import PremiumLoader from '../components/shared/PremiumLoader';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip } from 'recharts';
import DashboardChart from '../components/dashboard/DashboardChart';
import { STATISTICS_START_DATE, statisticsDescription, statisticsDownloadError, statisticsNumber, statisticsSummary, statisticsRankingTotal, formatStatistic, formatStatisticsSummary, formatStatisticsPeriod, mexicoDate, currentStatisticsMonth, sameStatisticsPeriod, validateStatisticsPeriod } from '../utils/statisticsPresentation';

const PERIOD_LABELS = { semana: 'Últimos 7 días', mes: 'Mes actual', trimestre: 'Trimestre actual', año: 'Acumulado del año', personalizado: 'Periodo elegido' };
const savedTimestamp = value => {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? date.toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'short', timeStyle: 'short' }) : '';
};
const waitForStatistics = signal => new Promise(resolve => {
  if (signal.aborted) { resolve(); return; }
  const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
  const timer = setTimeout(finish, 10000);
  signal.addEventListener('abort', finish, { once: true });
});

const SECCIONES_ESTADISTICAS = [
  { id: '01_VIDAS SALVADAS', group: 'Atención y procedimientos', label: 'Vidas salvadas · Sala de choque' },
  { id: '02_NACIMIENTOS', group: 'Atención y procedimientos', label: 'Nacimientos con registro el mismo día' },
  { id: '03_CUENTAS HOSPITALARIAS (HOSPITALIZACIÓN)', group: 'Atención y procedimientos', label: 'Egresos de hospitalización' },
  { id: '03_CUENTAS HOSPITALARIAS DE URGENCIAS', group: 'Atención y procedimientos', label: 'Cuentas de urgencias' },
  { id: '03_CUENTAS HOSPITALARIAS DE VA - SEGURO', group: 'Atención y procedimientos', label: 'Cuentas de VaSeguro' },
  { id: '04_ADMISIÓN CONTINUA (CONSULTAS DE URGENCIAS)', group: 'Atención y procedimientos', label: 'Consultas de urgencias' },
  { id: '05_ESTANCIA', group: 'Atención y procedimientos', label: 'Servicios de estancia sin terapia' },
  { id: '06_TERAPIA INTENSIVA (SER501, SER600, SER710, SER730)', group: 'Atención y procedimientos', label: 'Terapia intensiva' },
  { id: '07_PERSONAS EN QX (USOQX1HR)', group: 'Atención y procedimientos', label: 'Personas atendidas en quirófano' },
  { id: '08_CX ENDOSCOPIA, COLONOSCOPIA, BRONCOSCOPIA, PANENDOSCOPIA', group: 'Atención y procedimientos', label: 'Procedimientos ambulatorios' },
  { id: '09_CONSULTAS DE ESPECIALIDAD', group: 'Atención y procedimientos', label: 'Consultas de especialidad' },
  { id: '13_ESTADÍSTICO DE CIRUGÍAS', group: 'Atención y procedimientos', label: 'Cirugías realizadas' },
  { id: '10_ESTADISTICO DE EST. IMAGEN', group: 'Estudios e ingresos', label: 'Estudios de imagenología' },
  { id: '10_INGRESOS_IMAGEN', group: 'Estudios e ingresos', label: 'Ingresos de imagenología' },
  { id: '11_ESTADISTICO EST. LABORA', group: 'Estudios e ingresos', label: 'Estudios de laboratorio' },
  { id: '11_INGRESOS_LABORATORIO', group: 'Estudios e ingresos', label: 'Ingresos de laboratorio' },
  { id: '14_MEDICOS_HOSPITALIZACION', group: 'Médicos por ingreso', label: 'Top 10 médicos · Hospitalización' },
  { id: '15_MEDICOS_URGENCIAS', group: 'Médicos por ingreso', label: 'Top 10 médicos · Urgencias' },
];

const GRUPOS_SECCIONES_ESTADISTICAS = [
  'Atención y procedimientos',
  'Estudios e ingresos',
  'Médicos por ingreso',
];

function DoctorsRanking({ title, doctors, loading, scope, criterion, period }) {
  const maximum = Math.max(...doctors.map(doctor => statisticsNumber(doctor.n) ?? 0), 1);
  return (
    <section className="dashboard-panel" style={{ background: '#fff', borderRadius: 16, padding: '1.5rem', border: '1px solid #E2E8F0', boxShadow: 'var(--shadow-xs)', display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
        <div style={{ width: 4, height: 18, background: 'var(--color-azul-fuerte)', borderRadius: 2 }}/>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>{title}</h2>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>{scope} Órdenes de venta con IVA cuando aplica.</p>
        {period && <p style={{ margin: 0, fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-azul-fuerte)', whiteSpace: 'nowrap' }}>{formatStatisticsPeriod(period)}</p>}
      </div>
      {criterion && <details style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.85rem' }}><summary style={{ cursor: 'pointer' }}>Ver alcance del ranking</summary><p style={{ margin: '0.4rem 0 0' }}>{statisticsDescription(criterion)}</p></details>}
      {doctors.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', paddingBottom: '0.5rem', marginBottom: '0.85rem', borderBottom: '1px solid #E2E8F0', fontFamily: 'var(--font-display)', fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
          <span>Médico / órdenes de venta</span><span>Ingreso total (MXN)</span>
        </div>
      )}
      {doctors.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', flex: 1 }}>
          {doctors.slice(0, 10).map((doctor, index) => (
            <div key={`${doctor.area}-${index}`}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', fontSize: '0.8rem' }}>
                <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', color: 'var(--text-primary)' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, marginRight: 6, borderRadius: 6, background: index < 3 ? 'var(--color-azul-fuerte)' : '#EFF6FF', color: index < 3 ? '#fff' : 'var(--color-azul-fuerte)', fontFamily: 'var(--font-mono)', fontSize: '0.64rem', fontWeight: 700, verticalAlign: 'text-bottom' }}>{index + 1}</span>
                  <b>{doctor.area}</b>
                  <small style={{ display: 'block', color: 'var(--text-muted)', marginTop: 3, paddingLeft: 24 }}>{statisticsNumber(doctor.ordenes) !== null ? `${formatStatistic(doctor.ordenes)} órdenes de venta${statisticsNumber(doctor.cuentas) !== null ? ` · ${formatStatistic(doctor.cuentas)} atenciones distintas` : ''}` : doctor.especialidad || 'Recuento de órdenes no disponible'}</small>
                </span>
                <b style={{ whiteSpace: 'nowrap', color: 'var(--color-azul-fuerte)', fontFamily: 'var(--font-mono)' }}>{formatStatistic(doctor.n, true)}</b>
              </div>
              <div style={{ height: 5, marginTop: 6, background: '#EFF6FF', borderRadius: 5 }}><div style={{ height: '100%', width: `${Math.max(0, (statisticsNumber(doctor.n) ?? 0) / maximum * 100)}%`, background: 'linear-gradient(90deg, var(--color-azul-fuerte), var(--color-azul-claro))', borderRadius: 5 }} /></div>
            </div>
          ))}
        </div>
      ) : <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{loading ? 'Consultando médicos…' : 'No hay un ranking disponible para este periodo.'}</p>}
      {doctors.length > 0 && <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: '0.85rem', marginTop: '1rem', display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', fontSize: '0.82rem', fontWeight: 700 }}><span>Total mostrado · {Math.min(doctors.length, 10)} {doctors.length === 1 ? 'médico' : 'médicos'}</span><span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-azul-fuerte)' }}>{formatStatisticsSummary(statisticsRankingTotal(doctors), true)}</span></div>}
    </section>
  );
}

export default function Estadisticas() {
  const { user }              = useAuth();
  const { getKPI }            = useKPIConfig();
  const [periodo, setPeriodo] = useState('mes');
  const [customPeriod, setCustomPeriod] = useState(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast]     = useState(null);
  const [data, setData]       = useState({ stats: [], dx: [], generalDoctors: [], hospitalDoctors: [], emergencyDoctors: [], warnings: [], maxDx: 1 });
  const [statsError, setStatsError] = useState('');
  const [statsMeta, setStatsMeta] = useState({ status: 'idle', storage: null });
  const [historyError, setHistoryError] = useState('');
  const [historyMeta, setHistoryMeta] = useState({ warnings: [], unit: '', criterion: '', status: 'idle', storage: null });
  const [reportOpen, setReportOpen] = useState(false);
  const [reportDates, setReportDates] = useState(currentStatisticsMonth);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportSlow, setReportSlow] = useState(false);
  const [reportError, setReportError] = useState('');
  const [tableExportBusy, setTableExportBusy] = useState(false);
  const requests = useRef({ stats: null, history: null, detail: null, report: null });
  const reportLifecycle = useRef(null);
  const historyCache = useRef(new Map());
  const refreshHistory = useRef(false);
  const toastTimer = useRef(null);
  const [pbiModal, setPBIModal] = useState(null);

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
  }, [periodo, customPeriod]);

  useEffect(() => {
    if (!historyRequest) return;
    const controller = new AbortController();
    requests.current.history = controller;
    const refresh = refreshHistory.current;
    refreshHistory.current = false;
    fetchSeccionHistorica(controller, refresh);
    return () => controller.abort();
  }, [selectedSeccion, historyRequest]);

  useEffect(() => () => {
    const report = reportLifecycle.current;
    reportLifecycle.current = null;
    requests.current.report = null;
    report?.clearTimers();
    report?.controller.abort();
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
    setStatsMeta({ status: 'loading', storage: null });
    setData({ stats: [], dx: [], generalDoctors: [], hospitalDoctors: [], emergencyDoctors: [], warnings: [], maxDx: 1 });
    try {
      const query = new URLSearchParams(customPeriod || { periodo });
      let json;
      while (!controller.signal.aborted) {
        const response = await fetch(`/api/dashboard/stats?${query}`, { headers: authHeaders(), signal: controller.signal });
        json = await readResponse(response, 'No se pudieron consultar las estadísticas. Intenta de nuevo.');
        if (controller.signal.aborted) return;
        const storage = json.storage || json.data?.storage || null;
        setStatsMeta({ status: json.status || (storage?.pendingMonths?.length ? 'refreshing' : storage?.failedMonths?.length ? 'failed' : 'complete'), storage });
        if (json.data) break;
        if (json.status !== 'refreshing') throw new Error('No hay resultados guardados para este periodo.');
        setLoading(false);
        await waitForStatistics(controller.signal);
      }
      if (controller.signal.aborted) return;
      const { general, diagnosticos = [], medicosGeneral = [], medicosHospitalizacion = [], medicosUrgencias = [], warnings = [], criteria = {}, period, reconciliationSummary, pendingIndicators = [] } = json.data;
      const display = (key, suffix = '') => statisticsNumber(general?.[key]) === null ? 'No disponible' : `${formatStatistic(general[key])}${suffix}`;
      const stats = [
        { id: 'stats.egresos_total', label: 'Egresos del periodo', value: display('TotalEgresos'), pct: PERIOD_LABELS[periodo], up: null },
        { id: 'stats.promedio_edad', label: 'Promedio de edad', value: display('PromedioEdad', ' a'), pct: 'Pacientes con edad registrada', up: null },
        { id: 'stats.genero_femenino', label: '% Género femenino', value: display('pctFemenino', '%'), pct: 'Distribución de pacientes', up: null },
        { id: 'stats.defunciones', label: 'Defunciones', value: display('Defunciones'), pct: 'Egresos por defunción', up: null },
        { id: 'stats.nacimientos', label: 'Nacimientos con registro el mismo día', value: display('Nacimientos'), pct: 'Expediente creado en la fecha del nacimiento', up: null },
        { id: 'stats.estancia_global', label: 'Estancia promedio', value: display('EstanciaPromedio', ' d'), pct: 'Duración de hospitalización', up: null },
        { id: 'stats.vidas_salvadas', label: 'Vidas salvadas', value: display('VidasSalvadas'), pct: 'Atenciones con sala de choque', up: null },
      ];
      setData({ stats, dx: Array.isArray(diagnosticos) ? diagnosticos : [],
        generalDoctors: Array.isArray(medicosGeneral) ? medicosGeneral : [],
        hospitalDoctors: Array.isArray(medicosHospitalizacion) ? medicosHospitalizacion : [],
        emergencyDoctors: Array.isArray(medicosUrgencias) ? medicosUrgencias : [],
        warnings, criteria, period, reconciliationSummary, pendingIndicators, maxDx: Math.max(...(diagnosticos || []).map(row => Number(row.n) || 0), 1) });
    } catch (error) {
      if (!controller.signal.aborted) { setStatsMeta(previous => ({ ...previous, status: 'failed' })); setStatsError(userMessage(error.message || 'No se pudieron consultar las estadísticas. Intenta de nuevo.')); }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  const fetchSeccionHistorica = async (controller, refresh = false) => {
    setLoadingHist(true);
    setHistoryError('');
    const cached = historyCache.current.get(selectedSeccion);
    setSeccionData(cached?.data || null);
    setHistoryMeta(cached?.meta || { warnings: [], unit: '', criterion: '', status: 'loading', storage: null });
    let hasSnapshot = Boolean(cached);
    try {
      let retry = refresh;
      while (!controller.signal.aborted) {
        const query = new URLSearchParams({ seccion: selectedSeccion, retry: retry ? '1' : '0' });
        const response = await fetch(`/api/dashboard/stats-historico?${query}`, {
          headers: authHeaders(), signal: controller.signal,
        });
        const json = await readResponse(response, 'No se pudo consultar el histórico. Intenta de nuevo.');
        if (controller.signal.aborted) return;
        hasSnapshot = Boolean(json.data);
        const meta = { warnings: json.warnings || [], unit: json.unit || '', criterion: json.criterion || '', status: json.status || 'complete', storage: json.storage || null };
        historyCache.current.set(selectedSeccion, { data: json.data, meta });
        setSeccionData(json.data);
        setHistoryMeta(meta);
        setLoadingHist(false);
        retry = false;
        if (json.status !== 'refreshing') break;
        await waitForStatistics(controller.signal);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        if (hasSnapshot) setHistoryMeta(previous => ({ ...previous, status: 'failed' }));
        setHistoryError(userMessage(error.message || 'No se pudo consultar el histórico. Intenta de nuevo.'));
      }
    } finally {
      if (!controller.signal.aborted) setLoadingHist(false);
    }
  };

  const closeDetail = () => {
    requests.current.detail?.abort();
    setDetailModal(previous => ({ ...previous, isOpen: false }));
  };

  const handleOpenDetail = async (seccionId, year, mes, mesNombre, period = null) => {
    requests.current.detail?.abort();
    const controller = new AbortController();
    requests.current.detail = controller;
    const seccionLabel = SECCIONES_ESTADISTICAS.find(section => section.id === seccionId)?.label || 'Detalle del estadístico';
    setDetailModal({ isOpen: true, seccionId, seccionLabel, year, mes, mesNombre, period, data: [], loading: true, error: '', warnings: [], quantity: null, unit: '', criterion: '' });
    try {
      const params = new URLSearchParams({ seccion: seccionId, ...(period ? { startDate: period.startDate, endDate: period.endDate } : { year, mes }) });
      const response = await fetch(`/api/dashboard/stats-detalle?${params}`, {
        headers: authHeaders(), signal: controller.signal,
      });
      const json = await readResponse(response, 'No se pudo consultar el detalle. Intenta de nuevo.');
      if (controller.signal.aborted) return;
      if (json.status === 'refreshing' && !Array.isArray(json.data)) throw new Error('Los datos de este mes se están preparando. Vuelve a abrir el detalle cuando termine la actualización.');
      setDetailModal(previous => ({ ...previous, data: Array.isArray(json.data) ? json.data : [], period: json.period || previous.period, loading: false,
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
    const isCurrent = () => requests.current.report === controller;
    let slowTimer;
    let timeoutTimer;
    const clearTimers = () => { clearTimeout(slowTimer); clearTimeout(timeoutTimer); };
    const finish = () => {
      clearTimers();
      if (!isCurrent()) return false;
      requests.current.report = null;
      reportLifecycle.current = null;
      setReportBusy(false);
      setReportSlow(false);
      return true;
    };
    const cancel = message => {
      if (!finish()) return;
      controller.abort();
      setReportError(message);
    };
    reportLifecycle.current = { controller, clearTimers, cancel };
    setReportBusy(true);
    setReportSlow(false);
    setReportError('');
    setToast(null);
    slowTimer = setTimeout(() => { if (isCurrent()) setReportSlow(true); }, 20000);
    timeoutTimer = setTimeout(() => cancel('El archivo tardó más de lo esperado. Vuelve a intentarlo; si continúa, solicita revisión a Sistemas.'), 120000);
    try {
      const params = new URLSearchParams(reportDates);
      const response = await fetch(`/api/dashboard/stats-export?${params}`, { headers: authHeaders(), signal: controller.signal });
      if (!isCurrent() || controller.signal.aborted) return;
      if (!response.ok || !(response.headers.get('Content-Type') || '').includes('spreadsheetml')) {
        const json = await response.json().catch(() => null);
        throw new Error(userMessage(statisticsDownloadError(response.status, json)));
      }
      const blob = await response.blob();
      if (!isCurrent() || controller.signal.aborted) return;
      if (!blob.size) throw new Error('El archivo no contiene datos. Intenta generarlo de nuevo.');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Estadistico_${reportDates.startDate}_${reportDates.endDate}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('Estadístico generado. La descarga está lista.');
    } catch (error) {
      if (isCurrent() && !controller.signal.aborted) setReportError(userMessage(error.message || 'No se pudo generar el estadístico. Intenta de nuevo.'));
    } finally {
      finish();
    }
  };

  const applyReportPeriod = () => {
    const validation = validateStatisticsPeriod(reportDates.startDate, reportDates.endDate);
    setReportError(validation);
    if (validation) return;
    setCustomPeriod({ ...reportDates });
    setPeriodo('personalizado');
  };

  const reportMatchesDashboard = sameStatisticsPeriod(reportDates, data.period);
  const shortenedYear = periodo === 'año' && data.period && data.period.startDate !== `${data.period.endDate.slice(0, 4)}-01-01`;

  const añosList = Array.from({ length: Math.max(currentYear - 2016 + 1, 1) }, (_, index) => 2016 + index);
  const mesesNombres = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const monetary = selectedSeccion.includes('INGRESOS') || selectedSeccion.startsWith('14_') || selectedSeccion.startsWith('15_');
  const isDoctorHistory = selectedSeccion.startsWith('14_') || selectedSeccion.startsWith('15_');
  const historyTotalLabel = isDoctorHistory ? 'Suma de Top 10 mensuales' : 'Total anual';
  const historyAggregationNote = isDoctorHistory ? 'La suma de los Top 10 mensuales no equivale al Top 10 del año. Para un ranking anual, genera el estadístico con las fechas del año.' : '';
  const historySavedAt = savedTimestamp(historyMeta.storage?.updatedAt);
  const historyPendingMonths = [...new Set([...(historyMeta.storage?.missingMonths || []), ...(historyMeta.storage?.pendingMonths || []), ...(historyMeta.storage?.failedMonths || [])])];
  const savedMonthCount = (historyMeta.storage?.months || []).filter(month => month.available).length;
  const historyStorageNote = historyMeta.storage ? `Datos guardados en el hospital.${historySavedAt ? ` Última actualización: ${historySavedAt}.` : ` Aún no hay una actualización guardada para ${currentYear}.`}${historyMeta.storage.months?.length ? ` Meses guardados: ${savedMonthCount} de ${historyMeta.storage.months.length}.` : ''}${historyPendingMonths.length ? ` Meses pendientes de actualizar: ${historyPendingMonths.join(', ')}.` : ''}` : '';
  const requestHistory = (refresh = false) => { refreshHistory.current = refresh; setHistoryRequest(value => value + 1); };
  const totalAnual = Object.fromEntries(añosList.map(year => [year, statisticsSummary(mesesNombres.map((_, index) => seccionData?.[year]?.[index + 1]))]));
  const totalMensual = Object.fromEntries(mesesNombres.map((_, index) => [index + 1, statisticsSummary(añosList.map(year => seccionData?.[year]?.[index + 1]))]));
  const granTotal = statisticsSummary(añosList.flatMap(year => mesesNombres.map((_, index) => seccionData?.[year]?.[index + 1])));
  const dataGrafAnual = añosList.map(year => ({ name: String(year), Total: totalAnual[year].value, partial: totalAnual[year].partial }));
  const dataGrafMensual = mesesNombres.map((name, index) => ({ name, Cantidad: statisticsNumber(seccionData?.[selectedYearGraf]?.[index + 1]) }));

  const exportCurrentTable = async () => {
    if (tableExportBusy || !seccionData) return;
    setTableExportBusy(true);
    try {
      const { downloadStatisticsWorkbook } = await import('../utils/statisticsWorkbook');
      const summaryCell = summary => summary.partial || summary.value === null ? formatStatisticsSummary(summary, monetary) : summary.value;
      const sectionLabel = SECCIONES_ESTADISTICAS.find(section => section.id === selectedSeccion)?.label || 'Estadístico';
      await downloadStatisticsWorkbook({
        filename: `Estadisticas_${selectedSeccion.slice(0, 2)}_${currentYear}.xlsx`, sheetName: 'Histórico', title: sectionLabel, period: `2016 a ${currentYear}`,
        columns: [{ key: 'month', header: 'Mes', width: 20 }, ...añosList.map(year => ({ key: String(year), header: String(year), width: 22, type: monetary ? 'currency' : 'number' })), { key: 'total', header: 'Total', width: 24, type: monetary ? 'currency' : 'number' }],
        rows: mesesNombres.map((name, index) => ({ month: name, ...Object.fromEntries(añosList.map(year => [year, statisticsNumber(seccionData?.[year]?.[index + 1]) ?? 'No disponible'])), total: summaryCell(totalMensual[index + 1]) })),
        totals: { month: historyTotalLabel, ...Object.fromEntries(añosList.map(year => [year, summaryCell(totalAnual[year])])), total: summaryCell(granTotal) },
        unit: historyMeta.unit, scope: 'Resultados mensuales',
        footnotes: [historyStorageNote, historyMeta.status === 'refreshing' ? 'La actualización continúa. Este archivo conserva los datos guardados disponibles al descargarlo.' : historyMeta.status === 'failed' ? 'La última actualización no se completó; se conservan los datos guardados disponibles.' : '', granTotal.partial || granTotal.value === null ? 'Los totales parciales incluyen solo los meses disponibles. No disponible indica una cifra sin confirmar; no se sustituye por cero.' : '', historyAggregationNote, ...historyMeta.warnings.map(warning => statisticsDescription(userMessage(warning)))],
      });
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

      {/* Encabezado */}
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
        {/* Fondo del encabezado */}
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

        <button type="button" onClick={() => { if (!reportOpen && data.period) setReportDates({ startDate: data.period.startDate, endDate: data.period.endDate }); setReportOpen(open => !open); setReportError(''); }} disabled={reportBusy}
          aria-expanded={reportOpen} aria-controls="statistics-report-form"
          style={{ position: 'relative', padding: '0.65rem 1rem', borderRadius: 10, border: '1px solid #fff', color: '#083b66', background: '#fff', fontWeight: 700, cursor: reportBusy ? 'wait' : 'pointer' }}>
          {reportOpen ? 'Cerrar formulario' : 'Generar estadístico'}
        </button>

        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          maxWidth: '100%',
          background: 'rgba(255, 255, 255, 0.12)',
          padding: '3px',
          borderRadius: '12px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          position: 'relative',
          zIndex: 1
        }}>
          {Object.keys(PERIOD_LABELS).filter(p => p !== 'personalizado').map(p => {
            const isSelected = periodo === p;
            return (
              <button key={p} type="button" aria-pressed={isSelected} onClick={() => { setCustomPeriod(null); setPeriodo(p); }} style={{
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
              }}>{PERIOD_LABELS[p]}</button>
            );
          })}
        </div>
      </div>

      {reportOpen && (
        <form id="statistics-report-form" onSubmit={handleGenerateReport} aria-busy={reportBusy}
          style={{ background: '#fff', border: '1px solid #CBD5E1', borderRadius: 16, padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.5rem' }}>Generar estadístico completo</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0 0 1rem' }}>Descarga los apartados del estadístico institucional, el Top 10 general del periodo y el récord anual de 20 médicos. Incluye los desgloses de hospitalización y urgencias. Las dos fechas se incluyen.</p>
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
            {reportBusy && <button type="button" onClick={() => reportLifecycle.current?.cancel('Generación cancelada. Puedes volver a intentarlo.')} style={{ padding: '0.65rem 0.85rem', border: '1px solid #CBD5E1', borderRadius: 8, background: '#fff', color: 'var(--text-primary)', cursor: 'pointer' }}>Cancelar generación</button>}
            {data.period?.startDate && data.period?.endDate && <button type="button" disabled={reportBusy} onClick={() => { setReportDates({ startDate: data.period.startDate, endDate: data.period.endDate }); setReportError(''); }} style={{ padding: '0.65rem 0.85rem', border: '1px solid #CBD5E1', borderRadius: 8, background: '#fff', color: 'var(--text-primary)', cursor: 'pointer' }}>Usar fechas del tablero</button>}
            <button type="button" disabled={reportBusy || loading || reportMatchesDashboard} onClick={applyReportPeriod} style={{ padding: '0.65rem 0.85rem', border: '1px solid #CBD5E1', borderRadius: 8, background: '#fff', color: 'var(--text-primary)', cursor: reportBusy || loading || reportMatchesDashboard ? 'default' : 'pointer' }}>Ver estas fechas en el tablero</button>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: 0 }}>Periodo del Excel: <strong>{formatStatisticsPeriod(reportDates)}</strong>. {loading ? 'Consultando el periodo del tablero…' : !data.period ? 'El tablero no tiene un periodo confirmado.' : reportMatchesDashboard ? 'El tablero y la descarga usan las mismas fechas.' : 'Estas fechas son distintas a las del tablero.'}</p>
          {reportBusy && <p role="status" style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{reportSlow ? 'La preparación está tardando más de lo habitual. Puedes esperar o cancelar e intentarlo de nuevo.' : 'Estamos preparando el archivo con los datos guardados del periodo. La descarga comenzará al terminar.'}</p>}
          {reportError && <p role="alert" style={{ color: '#B91C1C', marginBottom: 0 }}>{reportError}</p>}
        </form>
      )}
      {!loading && !statsError && data.period && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0 0 1rem' }}>{shortenedYear ? 'Acumulado disponible' : PERIOD_LABELS[periodo]} · Periodo del tablero y los Top 10: <strong>{formatStatisticsPeriod(data.period)}</strong>. {shortenedYear && 'El acumulado comienza en esa fecha y no incluye los meses anteriores. '}Los importes corresponden a órdenes de venta.</p>}
      {!loading && !statsError && data.reconciliationSummary && <div role="status" style={{ padding: '0.85rem 1rem', border: '1px solid #CBD5E1', background: '#F8FAFC', borderRadius: 10, marginBottom: '1rem', fontSize: '0.82rem' }}><strong>Revisión de cifras:</strong> {data.reconciliationSummary.compared === 0 ? 'No hay comprobaciones disponibles para este periodo. Los resultados están pendientes de verificación.' : `${formatStatistic(data.reconciliationSummary.matching)} comprobaciones coinciden · ${formatStatistic(data.reconciliationSummary.different)} con diferencias · ${formatStatistic(data.reconciliationSummary.notComparable)} sin comparación disponible.`} {data.reconciliationSummary.different > 0 && 'Las diferencias requieren revisión antes de dar las cifras por confirmadas.'}</div>}
      {!loading && !statsError && data.pendingIndicators?.length > 0 && <p role="status" style={{ padding: '0.85rem 1rem', border: '1px solid #F3D092', background: '#FFFBF3', borderRadius: 10, marginBottom: '1rem', fontSize: '0.82rem' }}><strong>Indicadores pendientes:</strong> {data.pendingIndicators.map(indicator => indicator.label).join(', ')}. El Excel los identifica como «No disponible»; el motivo se consulta en Criterios.</p>}
      {statsError && <p role="alert" style={{ padding: '1rem', color: '#991B1B', background: '#FEF2F2', borderRadius: 10 }}>{statsError}</p>}
      {statsMeta.status === 'refreshing' && !data.period && <p role="status" style={{ padding: '1rem', color: 'var(--text-primary)', background: 'var(--surface-raised)', border: '1px solid var(--navbar-border)', borderRadius: 10 }}>Se están preparando los datos guardados de este periodo. El tablero aparecerá al terminar; puedes consultar otros periodos disponibles mientras tanto.</p>}
      {statsMeta.storage?.updatedAt && <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Datos guardados · Última actualización: {savedTimestamp(statsMeta.storage.updatedAt)}.{statsMeta.status === 'refreshing' && ' Se están incorporando datos nuevos; se conserva el último corte disponible.'}</p>}

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
              role={s.id === 'stats.vidas_salvadas' && data.period ? 'button' : undefined}
              tabIndex={s.id === 'stats.vidas_salvadas' && data.period ? 0 : undefined}
              aria-label={s.id === 'stats.vidas_salvadas' && data.period ? 'Ver detalle de vidas salvadas del periodo' : undefined}
              onKeyDown={event => { if (s.id === 'stats.vidas_salvadas' && data.period && ['Enter', ' '].includes(event.key)) { event.preventDefault(); handleOpenDetail('01_VIDAS SALVADAS', null, null, '', data.period); } }}
              className={"dashboard-metric-card " + (`est-kpi-card ${s.id === 'stats.vidas_salvadas' ? 'kpi-clickable' : ''}`)}
              onClick={() => {
                if (s.id === 'stats.vidas_salvadas') {
                  if (data.period) handleOpenDetail('01_VIDAS SALVADAS', null, null, '', data.period);
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
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 1rem' }}>Órdenes de venta: importes netos sin IVA y después de descuentos. No representan cobros.</p>
            {data.dx.length > 0 ? data.dx.map((d, i) => (
              <div key={d.dx} style={{ marginBottom:'0.875rem' }}>
                <div className="dashboard-html-chart-summary" style={{ display:'flex', justifyContent:'space-between', marginBottom:'0.3rem', alignItems: 'center' }}>
                  <span className="dashboard-html-chart-label" style={{ fontFamily: 'var(--font-body)', fontSize:'0.82rem', color:'var(--text-primary)', fontWeight:600, maxWidth:'65%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', color:'var(--text-muted)', marginRight:'0.5rem', fontSize: '0.78rem' }}>#{i+1}</span>{d.dx}
                  </span>
                  <span className="dashboard-html-chart-value" style={{ fontFamily: 'var(--font-mono)', fontSize:'0.8rem', fontWeight:700, color:'var(--color-azul-fuerte)', flexShrink:0 }}>
                    {formatStatistic(d.n, true)}
                    {statisticsNumber(d.pct) !== null && <span style={{ color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.72rem', marginLeft:'4px' }}>({formatStatistic(d.pct)}%)</span>}
                  </span>
                </div>
                <div className="dashboard-html-chart-track" style={{ height:6, background:'rgba(0,70,135,0.04)', borderRadius:100, overflow:'hidden' }}>
                  <div className="dashboard-html-chart-bar" style={{
                    height:'100%',
                    width:`${Math.max(0, (statisticsNumber(d.n) ?? 0) / data.maxDx * 100)}%`,
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

        <DoctorsRanking title="Top 10 médicos por ingreso general" doctors={data.generalDoctors} loading={loading} period={data.period} scope="Hospitalización y urgencias juntas." criterion={data.criteria?.medicosGeneral} />
        <DoctorsRanking title="Top 10 médicos por ingreso en hospitalización" doctors={data.hospitalDoctors} loading={loading} period={data.period} criterion={data.criteria?.medicosHospitalizacion} />
        <DoctorsRanking title="Top 10 médicos por ingreso en urgencias" doctors={data.emergencyDoctors} loading={loading} period={data.period} criterion={data.criteria?.medicosUrgencias} />
      </div>
      </>
      )}

      {/* Explorador de Estadísticas Históricas */}
      <div style={{ background: '#FFFFFF', borderRadius: '16px', padding: '2rem', border: '1px solid rgba(0,70,135,0.05)', boxShadow: 'var(--shadow-sm)', marginBottom: '2rem' }}>
        <div style={{ marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
            <div style={{ width: 4, height: 20, background: 'var(--color-azul-fuerte)', borderRadius: 2 }}/>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              Explorador de Estadísticas Institucionales
            </h2>
          </div>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
            Elige un estadístico para consultar sus resultados por mes y año.
          </p>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem',
          background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '14px', padding: '0.85rem 1rem', marginBottom: '1.5rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', flex: '1 1 24rem', minWidth: 0 }}>
            <select
              className="statistics-history-select"
              aria-label="Estadístico a consultar"
              value={selectedSeccion}
              disabled={reportBusy}
              onChange={(e) => { setSelectedSeccion(e.target.value); requestHistory(); }}
            >
              {GRUPOS_SECCIONES_ESTADISTICAS.map(group => (
                <optgroup key={group} label={group}>
                  {SECCIONES_ESTADISTICAS.filter(section => section.group === group).map(section => (
                    <option key={section.id} value={section.id}>{section.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>

            <button type="button" onClick={() => requestHistory()} disabled={loadingHist || reportBusy}
              style={{ padding: '0.62rem 1.1rem', border: 0, borderRadius: 10, background: 'var(--color-azul-fuerte)', color: '#fff', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.82rem', cursor: loadingHist || reportBusy ? 'wait' : 'pointer', boxShadow: '0 2px 8px rgba(0,70,135,0.28)' }}>
              {loadingHist ? 'Consultando…' : 'Consultar histórico'}
            </button>
            {historyRequest > 0 && <button type="button" onClick={() => requestHistory(true)} disabled={loadingHist || reportBusy || historyMeta.status === 'refreshing'}
              style={{ padding: '0.62rem 1rem', border: '1px solid var(--navbar-border)', borderRadius: 10, background: 'var(--surface-raised)', color: 'var(--text-primary)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.82rem', cursor: loadingHist || historyMeta.status === 'refreshing' ? 'wait' : 'pointer' }}>
              Actualizar datos nuevos
            </button>}
          </div>

          <div style={{ display: 'flex', background: '#E2E8F0', padding: '3px', borderRadius: '10px' }}>
            <button
              type="button"
              aria-pressed={activeTab === 'tabla'}
              onClick={() => setActiveTab('tabla')}
              style={{
                padding: '0.42rem 1rem',
                border: 'none',
                background: activeTab === 'tabla' ? '#FFFFFF' : 'transparent',
                borderRadius: '7px',
                fontFamily: 'var(--font-display)',
                fontSize: '0.78rem',
                fontWeight: activeTab === 'tabla' ? 700 : 500,
                color: activeTab === 'tabla' ? 'var(--color-azul-fuerte)' : 'var(--text-muted)',
                cursor: 'pointer',
                boxShadow: activeTab === 'tabla' ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
                transition: 'all 0.2s'
              }}
            >
              Tabla
            </button>
            <button
              type="button"
              aria-pressed={activeTab === 'grafico'}
              onClick={() => setActiveTab('grafico')}
              style={{
                padding: '0.42rem 1rem',
                border: 'none',
                background: activeTab === 'grafico' ? '#FFFFFF' : 'transparent',
                borderRadius: '7px',
                fontFamily: 'var(--font-display)',
                fontSize: '0.78rem',
                fontWeight: activeTab === 'grafico' ? 700 : 500,
                color: activeTab === 'grafico' ? 'var(--color-azul-fuerte)' : 'var(--text-muted)',
                cursor: 'pointer',
                boxShadow: activeTab === 'grafico' ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
                transition: 'all 0.2s'
              }}
            >
              Gráfico
            </button>
          </div>
        </div>

        {historyError && <p role="alert" style={{ color: '#B91C1C' }}>{historyError}</p>}
        {historyRequest > 0 && historyMeta.status === 'refreshing' && <p role="status" style={{ color: 'var(--text-primary)', background: 'var(--surface-raised)', border: '1px solid var(--navbar-border)', borderRadius: 8, padding: '0.65rem 0.85rem', fontSize: '0.82rem' }}>Mostrando el historial guardado mientras se actualizan los periodos nuevos o pendientes. Puedes ver el detalle de los meses guardados y exportar la tabla disponible.</p>}
        {historyRequest > 0 && historyMeta.status === 'failed' && <p role="status" style={{ color: 'var(--text-primary)', background: 'var(--surface-raised)', border: '1px solid var(--navbar-border)', borderRadius: 8, padding: '0.65rem 0.85rem', fontSize: '0.82rem' }}>La última actualización no se completó. Los datos guardados siguen disponibles; los periodos pendientes no se sustituyen por cero. Usa Actualizar datos nuevos para volver a intentar.</p>}
        {historyRequest > 0 && historyPendingMonths.length > 0 && <p role="status" style={{ fontSize: '0.82rem', color: 'var(--text-primary)' }}>Meses pendientes de actualizar: {historyPendingMonths.join(', ')}.</p>}
        {historyMeta.warnings.length > 0 && <details style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
          <summary style={{ cursor: 'pointer' }}>Avisos de esta consulta ({historyMeta.warnings.length})</summary>
          {historyMeta.warnings.map((warning, index) => <p role="status" key={index}>{statisticsDescription(userMessage(warning))}</p>)}
        </details>}
        {!historyRequest ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', textAlign: 'center', padding: '3rem 1.5rem', border: '1px dashed #CBD5E1', borderRadius: '14px', background: '#F8FAFC' }}>
            <span style={{ fontSize: '2rem' }} aria-hidden="true">📊</span>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              Aún no has consultado un estadístico
            </p>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0, maxWidth: '32rem' }}>
              Elige un estadístico en el selector y carga sus resultados mensuales por año.
            </p>
            <button type="button" onClick={() => requestHistory()} disabled={loadingHist || reportBusy}
              style={{ marginTop: '0.25rem', padding: '0.55rem 1.1rem', border: 0, borderRadius: 10, background: 'var(--color-azul-fuerte)', color: '#fff', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.82rem', cursor: loadingHist || reportBusy ? 'wait' : 'pointer' }}>
              Cargar resultados históricos
            </button>
          </div>
        ) : loadingHist && !seccionData ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem 0' }}>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Cargando datos históricos...</span>
          </div>
        ) : (
          activeTab === 'tabla' ? (
            <div style={{ border: '1px solid #E2E8F0', borderRadius: '12px', background: '#FFFFFF', overflow: 'hidden' }}>
              <div style={{ padding: '0.85rem 1rem', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', background: '#F8FAFC' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {SECCIONES_ESTADISTICAS.find(section => section.id === selectedSeccion)?.label || 'Estadístico'}
                  </div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    Resultados mensuales por año · toca una cifra sombreada para ver su detalle
                  </div>
                </div>
                <button
                  onClick={exportCurrentTable}
                  disabled={tableExportBusy || !seccionData}
                  style={{
                    padding: '0.5rem 1rem', background: '#10B981', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: '0.8rem',
                    cursor: tableExportBusy || !seccionData ? 'not-allowed' : 'pointer',
                    opacity: tableExportBusy || !seccionData ? 0.6 : 1
                  }}
                >
                  {tableExportBusy ? 'Exportando…' : 'Exportar tabla actual'}
                </button>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.76rem' }}>
                  <thead>
                    <tr>
                      <th style={{ position: 'sticky', left: 0, zIndex: 3, background: '#F1F5F9', padding: '0.7rem 1rem', textAlign: 'left', fontFamily: 'var(--font-display)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', fontWeight: 700, borderBottom: '2px solid #E2E8F0', whiteSpace: 'nowrap' }}>Mes</th>
                      {añosList.map(año => (
                        <th key={año} style={{ padding: '0.7rem 0.6rem', fontFamily: 'var(--font-display)', fontSize: '0.72rem', color: año === currentYear ? 'var(--color-azul-fuerte)' : 'var(--text-primary)', background: año === currentYear ? 'rgba(0,70,135,0.08)' : '#F1F5F9', fontWeight: 700, borderBottom: '2px solid #E2E8F0' }}>{año}</th>
                      ))}
                      <th style={{ position: 'sticky', right: 0, zIndex: 3, padding: '0.7rem 1rem', fontFamily: 'var(--font-display)', fontSize: '0.72rem', color: 'var(--color-azul-fuerte)', background: '#F1F5F9', fontWeight: 700, borderBottom: '2px solid #E2E8F0', boxShadow: '-6px 0 8px -6px rgba(15,23,42,0.18)' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mesesNombres.map((mesNombre, mIdx) => {
                      const m = mIdx + 1;
                      const rowBg = mIdx % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
                      return (
                        <tr key={m} className="table-row-hover" style={{ borderBottom: '1px solid #E2E8F0' }}>
                          <td style={{ position: 'sticky', left: 0, zIndex: 1, background: rowBg, padding: '0.6rem 1rem', textAlign: 'left', fontFamily: 'var(--font-display)', color: 'var(--text-primary)', fontWeight: 600, whiteSpace: 'nowrap' }}>{mesNombre}</td>
                          {añosList.map(año => {
                            const val = statisticsNumber(seccionData?.[año]?.[m]);
                            const monthKey = `${año}-${String(m).padStart(2, '0')}`;
                            const savedMonth = historyMeta.storage?.months?.find(month => month.month === monthKey);
                            const isClickable = val !== null && monthKey >= STATISTICS_START_DATE.slice(0, 7) && monthKey <= mexicoDate().slice(0, 7) && Boolean(seccionData) && (historyMeta.storage ? savedMonth?.available === true : historyMeta.status === 'complete');
                            return (
                              <td key={año} style={{ padding: '0.4rem 0.5rem', textAlign: 'right', whiteSpace: 'nowrap', background: año === currentYear ? 'rgba(0,70,135,0.04)' : undefined }}>
                                {isClickable ? (
                                  <button
                                    onClick={() => handleOpenDetail(selectedSeccion, año, m, mesNombre)}
                                    title={`Ver detalle de ${mesNombre} ${año}${savedMonth?.updatedAt ? ` · Guardado: ${savedTimestamp(savedMonth.updatedAt)}` : ''}`}
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
                          <td style={{ position: 'sticky', right: 0, zIndex: 1, background: rowBg, padding: '0.6rem 1rem', fontWeight: 700, color: 'var(--color-azul-fuerte)', whiteSpace: 'nowrap', boxShadow: '-6px 0 8px -6px rgba(15,23,42,0.12)' }}>
                            {formatStatisticsSummary(totalMensual[m], monetary)}
                          </td>
                        </tr>
                      );
                    })}
                    <tr style={{ fontWeight: 700 }}>
                      <td style={{ position: 'sticky', left: 0, zIndex: 1, background: '#EFF6FF', padding: '0.7rem 1rem', textAlign: 'left', fontFamily: 'var(--font-display)', color: 'var(--color-azul-fuerte)', borderTop: '2px solid #E2E8F0', whiteSpace: 'nowrap' }}>{historyTotalLabel}</td>
                      {añosList.map(año => (
                        <td key={año} style={{ padding: '0.7rem 0.6rem', color: 'var(--color-azul-fuerte)', background: año === currentYear ? 'rgba(0,70,135,0.09)' : '#EFF6FF', borderTop: '2px solid #E2E8F0', whiteSpace: 'nowrap' }}>
                          {formatStatisticsSummary(totalAnual[año], monetary)}
                        </td>
                      ))}
                      <td style={{ position: 'sticky', right: 0, zIndex: 1, padding: '0.7rem 1rem', color: 'var(--color-accent-warm)', fontSize: '0.8rem', background: '#EFF6FF', borderTop: '2px solid #E2E8F0', whiteSpace: 'nowrap', boxShadow: '-6px 0 8px -6px rgba(15,23,42,0.18)' }}>
                        {formatStatisticsSummary(granTotal, monetary)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="dashboard-chart-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '1.5rem' }}>
              <div className="dashboard-panel" style={{ background: '#F8FAFC', borderRadius: '12px', padding: '1.25rem', border: '1px solid #E2E8F0' }}>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 1rem 0' }}>
                  {isDoctorHistory ? 'Suma de Top 10 mensuales por año' : 'Tendencia histórica anual'} (2016 – {currentYear})
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

      {/* Modal Desglose Granular & Exportación Excel */}
      <ModalDetalleEstadisticas
        {...detailModal}
        onClose={closeDetail}
      />

      {/* Avisos */}
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
