'use strict';

const ACTIVE_START = '2026-04-01';
const DAY = 86400000;

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  error.publicMessage = message;
  return error;
}

function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw invalid('Escribe una fecha válida con año, mes y día.');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw invalid('La fecha indicada no existe.');
  }
  return value;
}

function addDays(value, days) {
  return new Date(new Date(`${dateOnly(value)}T00:00:00.000Z`).getTime() + days * DAY).toISOString().slice(0, 10);
}

function hospitalToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const part = type => parts.find(p => p.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function dateRange(startDate, endDate, { activeOnly = true, maxDays = 366 } = {}) {
  dateOnly(startDate);
  dateOnly(endDate);
  if (startDate > endDate) throw invalid('La fecha inicial debe ser anterior o igual a la fecha final.');
  if (activeOnly && startDate < ACTIVE_START) {
    throw invalid('El detalle para generar el estadístico está disponible desde el 1 de abril de 2026. Los meses anteriores se conservan en el histórico.');
  }
  const days = (Date.parse(endDate) - Date.parse(startDate)) / DAY + 1;
  if (days > maxDays) throw invalid(`Selecciona un periodo de hasta ${maxDays} días.`);
  return { startDate, endDate, endExclusive: addDays(endDate, 1) };
}

function monthRange(year, month) {
  if (!/^\d{4}$/.test(String(year)) || !/^\d{1,2}$/.test(String(month)) || +month < 1 || +month > 12 || +year < 2016 || +year > 2100) {
    throw invalid('Selecciona un año y un mes válidos.');
  }
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const next = new Date(Date.UTC(+year, +month, 1)).toISOString().slice(0, 10);
  return dateRange(startDate, addDays(next, -1), { activeOnly: false });
}

function periodRange(period, now) {
  const endDate = hospitalToday(now);
  const [year, month] = endDate.split('-');
  let startDate;
  if (period === 'semana') startDate = addDays(endDate, -6);
  else if (period === 'trimestre') startDate = `${year}-${String(Math.floor((+month - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
  else if (period === 'año') startDate = `${year}-01-01`;
  else if (!period || period === 'mes') startDate = `${year}-${month}-01`;
  else throw invalid('Selecciona un periodo válido.');
  // No prorratear personas ni eventos de las cifras mensuales del histórico.
  return dateRange(startDate < ACTIVE_START ? ACTIVE_START : startDate, endDate);
}

function roundMoney(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }

module.exports = { ACTIVE_START, dateOnly, dateRange, monthRange, periodRange, hospitalToday, addDays, invalid, roundMoney };
