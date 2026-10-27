export const STATISTICS_START_DATE = '2026-01-01';

export function statisticsDescription(value = '') {
  return String(value)
    .replace(/,? como (?:los pivotes generales del archivo base|los pivotes de los Excel base|el pivote de los Excel base|el pivote base|el Excel base)/gi, '')
    .replace(/,? como Cuenta de Servicio en el pivote base/gi, '')
    .replace(/Su coincidencia con los Excel base se informa en la conciliación\.\s*/gi, '')
    .replace(/No utiliza la fórmula del archivo base que vuelve a sumar su subtotal\.\s*/gi, '')
    .replace(/Cada base se concilia por separado;\s*no/gi, 'No')
    .replace('El periodo tiene diferencias con los Excel base. Consulta las conciliaciones de indicadores, médicos y laboratorio; no se aplicaron ajustes para forzar los totales.', 'Hay diferencias pendientes de revisar en este periodo. Los resultados se muestran sin ajustes.')
    .replace('Hay indicadores sin referencia comparable para este periodo; no se consideran conciliados.', 'Hay indicadores sin una comparación disponible; su revisión sigue pendiente.')
    .replace(/de TotalOrdenVenta/g, 'del importe total de las órdenes de venta')
    .replace(/TotalOrdenVenta/g, 'importe total de las órdenes de venta')
    .replace(/cuenta de nombre de médico/g, 'recuento de órdenes')
    .replace(/\s+/g, ' ').trim();
}

export function statisticsDownloadError(status, response) {
  if (status === 202 && response?.status === 'refreshing') return 'Los datos de este periodo se están guardando. Puedes consultar otros periodos disponibles y volver a generar el archivo al terminar.';
  if (status === 404) return 'El servicio de descarga aún no está actualizado. Reinicia la aplicación BI y vuelve a intentarlo.';
  if (response?.message || response?.error) return response.message || response.error;
  if ([502, 503, 504].includes(status)) return 'El servicio no pudo completar la consulta. Espera un momento y vuelve a generar el estadístico.';
  return 'No se pudo generar el estadístico completo. Intenta de nuevo.';
}

export function statisticsNumber(value) {
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function statisticsSummary(values) {
  const known = values.map(statisticsNumber).filter(value => value !== null);
  return {
    value: known.length ? known.reduce((sum, value) => sum + value, 0) : null,
    partial: known.length > 0 && known.length < values.length,
  };
}

export function formatStatistic(value, monetary = false) {
  const number = statisticsNumber(value);
  if (number === null) return 'No disponible';
  return number.toLocaleString('es-MX', monetary
    ? { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : { maximumFractionDigits: 2 });
}

export function formatStatisticsSummary(summary, monetary = false) {
  return `${summary.partial ? 'Parcial: ' : ''}${formatStatistic(summary.value, monetary)}`;
}

export function formatStatisticsPeriod(period) {
  const dateLabel = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    const date = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
    return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
  };
  const start = dateLabel(period?.startDate);
  const end = dateLabel(period?.endDate);
  return start && end ? `${start} al ${end}` : 'Periodo no disponible';
}

export function statisticsRankingTotal(doctors) {
  return statisticsSummary(doctors.slice(0, 10).map(doctor => doctor.n));
}

export function mexicoDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = type => parts.find(value => value.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function previousStatisticsMonth(now = new Date()) {
  const [year, month] = mexicoDate(now).split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 2, 1));
  const end = new Date(Date.UTC(year, month - 1, 0));
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

export function currentStatisticsMonth(now = new Date()) {
  const endDate = mexicoDate(now);
  return { startDate: `${endDate.slice(0, 7)}-01`, endDate };
}

export function sameStatisticsPeriod(left, right) {
  return Boolean(left?.startDate && left?.endDate && left.startDate === right?.startDate && left.endDate === right?.endDate);
}

export function validateStatisticsPeriod(startDate, endDate, today = mexicoDate()) {
  const validDate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  if (!validDate(startDate) || !validDate(endDate)) return 'Selecciona una fecha inicial y una fecha final válidas.';
  if (startDate < STATISTICS_START_DATE) return 'El estadístico completo está disponible desde el 1 de enero de 2026.';
  if (endDate < startDate) return 'La fecha final debe ser igual o posterior a la fecha inicial.';
  if (endDate > today) return 'La fecha final no puede ser posterior a hoy.';
  const days = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000 + 1;
  return days > 366 ? 'Selecciona un periodo de hasta 366 días.' : '';
}
