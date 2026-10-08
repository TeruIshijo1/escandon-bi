export const STATISTICS_START_DATE = '2026-04-01';

export function statisticsDownloadError(status, response) {
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

export function validateStatisticsPeriod(startDate, endDate, today = mexicoDate()) {
  const validDate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  if (!validDate(startDate) || !validDate(endDate)) return 'Selecciona una fecha inicial y una fecha final válidas.';
  if (startDate < STATISTICS_START_DATE) return 'El estadístico completo está disponible desde el 1 de abril de 2026.';
  if (endDate < startDate) return 'La fecha final debe ser igual o posterior a la fecha inicial.';
  if (endDate > today) return 'La fecha final no puede ser posterior a hoy.';
  const days = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000 + 1;
  return days > 366 ? 'Selecciona un periodo de hasta 366 días.' : '';
}
