// Only canonical decimal values are eligible for a numeric report format.
// Conditions, formulas and locale-specific text retain their original value.
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const nonFinite = /^[+-]?(?:nan|infinity)$/i;

export function reportNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !decimal.test(value.trim())) return null;
  const number = Number(value.trim());
  return Number.isFinite(number) ? number : null;
}

export function formatReportNumeric(value, type, empty = '-') {
  if (value == null || typeof value === 'string' && !value.trim()) return empty;
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  const number = reportNumber(value);
  if (number === null) {
    if (typeof value === 'number' || typeof value === 'string' && (nonFinite.test(value.trim()) || decimal.test(value.trim()))) return empty;
    return String(value);
  }
  if (type === 'money') return `$${number.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (type === 'percent') return `${number.toFixed(1)}%`;
  return number.toLocaleString('es-MX');
}

export const escapeReportHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
