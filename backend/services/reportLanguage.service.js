'use strict';

const { normalizeWords, naturalText } = require('./reportVocabulary.service');

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MONTH_ALIASES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTH_PATTERN = `${MONTHS.join('|')}|setiembre|sept|${MONTH_ALIASES.join('|')}`;
const DAY_WORDS = { primero: 1, primer: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30 };
const YEAR = '(?:\\s+(?:de(?:l)?\\s+)?((?:19|20|21)\\d{2}))?';
const FOLLOWUP = /\b(agrega|incluye|quita|elimina|tambien|cambia|usa|mejor|solo|unicamente|pon|ponlo|ponle|ponme|mete|metele|anade|sumale|sacale|borra|hazlo|dejalo|dejame|nomas|solamente|mismo)\b/;

function monthNumber(name) {
  const value = name.replace(/\.$/, '');
  if (['setiembre', 'sept'].includes(value)) return 8;
  return MONTHS.includes(value) ? MONTHS.indexOf(value) : MONTH_ALIASES.indexOf(value);
}

function isoDate(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function validDate(value) {
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function interpretDates(message, today, context = {}) {
  const original = normalize(normalizeWords(message))
    .replace(/(?:busca|buscar|contenga|contengan|coincida con)\s+["“][^"”]+["”]/g, '')
    .replace(/\b(?:cambia|sustituye)\s+[«“"][^»”"]+[»”"]\s+por\s+[«“"][^»”"]+[»”"]/g, ' ')
    .replace(/\bme refiero a\s+[«“"][^»”"]+[»”"]/g, ' ');
  const text = original.replace(/\btreinta y uno\b/g, '31').replace(new RegExp(`\\b(${Object.keys(DAY_WORDS).join('|')})\\b`, 'g'), word => DAY_WORDS[word]).replace(/\b1(?:ro|ero)\b/g, '1');
  const current = new Date(`${today}T12:00:00Z`);
  const contextDate = validDate(context.fechaDesde || '') ? context.fechaDesde : today;
  const year = Number(contextDate.slice(0, 4));
  const sameMonth = context.fechaDesde && context.fechaHasta && context.fechaDesde.slice(0, 7) === context.fechaHasta.slice(0, 7);
  const dateColumn = /\bfecha(?:s)?\s+(?:de\s+)?(?:alta|cierre|ingreso|nacimiento|caducidad|vencimiento|cargo|creacion|emision|atencion|solicitud|registro|proceso|devolucion|salida|contabilizacion|documento|entrega|inicio|fin|programada|consulta|estudio|orden|ticket|estancia|tratamiento|modificacion|pago|cobro|factura)\b/g;
  const periodText = text.replace(dateColumn, ' ');
  const requested = new RegExp(`\\b(${MONTH_PATTERN}|hoy|ayer|anteayer|mes|semana|quincena|navidad)\\b`).test(periodText) || /\b\d{1,4}[/-]\d{1,2}\b|\b(?:del?|entre|desde)\s+(?:el\s+)?\d+\s+(?:al|hasta|y)\s+(?:el\s+)?\d+/.test(periodText) || /\b(cambia|cambiar|mejor|pon|usa|ajusta)\b(?![^.;]*\bpor\b).*\b(fecha|fechas|periodo)\b/.test(periodText);
  const clarification = '¿Qué período quieres usar? Puedes decir «del 1 al 15 de septiembre» o indicar las fechas de inicio y fin.';
  const finish = (range, error = '') => {
    if (range && (!validDate(range.fechaDesde) || !validDate(range.fechaHasta))) return { range: null, requested: true, error: 'Alguna fecha no existe en el calendario. ¿Qué días y mes quieres consultar?' };
    if (range && range.fechaDesde > range.fechaHasta) return { range: null, requested: true, error: 'La fecha de inicio queda después de la fecha de fin. ¿Qué período quieres consultar?' };
    return { range, requested: requested || Boolean(range), error };
  };
  const range = (startYear, startMonth, startDay, endYear, endMonth, endDay) => finish({ fechaDesde: isoDate(startYear, startMonth, startDay), fechaHasta: isoDate(endYear, endMonth, endDay) });
  const fullMonth = (selectedYear, selectedMonth) => range(selectedYear, selectedMonth, 1, selectedYear, selectedMonth, new Date(Date.UTC(selectedYear, selectedMonth + 1, 0)).getUTCDate());
  const daysAgo = count => { const date = new Date(current); date.setUTCDate(date.getUTCDate() - count); return date.toISOString().slice(0, 10); };

  const endpoints = text.match(new RegExp(`\\b(?:(?:del?|desde|entre)\\s+)?(?:el\\s+)?(\\d{1,2})\\s+(?:de\\s+)?(${MONTH_PATTERN})\\.?${YEAR}\\s*(?:al|a|hasta|y|-)\\s*(?:el\\s+)?(\\d{1,2})\\s+(?:de\\s+)?(${MONTH_PATTERN})\\.?${YEAR}\\b`));
  if (endpoints) {
    const startMonth = monthNumber(endpoints[2]), endMonth = monthNumber(endpoints[5]);
    const startYear = Number(endpoints[3] || (endpoints[6] ? Number(endpoints[6]) - (startMonth > endMonth ? 1 : 0) : year));
    const endYear = Number(endpoints[6] || startYear + (startMonth > endMonth ? 1 : 0));
    return range(startYear, startMonth, Number(endpoints[1]), endYear, endMonth, Number(endpoints[4]));
  }
  const shared = text.match(new RegExp(`\\b(?:(?:del?|desde|entre)\\s+)?(?:el\\s+)?(\\d{1,2})\\s*(?:al|a|hasta|y|-)\\s*(?:el\\s+)?(\\d{1,2})\\s+(?:de\\s+)?(${MONTH_PATTERN})\\.?${YEAR}\\b`));
  if (shared) return range(Number(shared[4] || year), monthNumber(shared[3]), Number(shared[1]), Number(shared[4] || year), monthNumber(shared[3]), Number(shared[2]));
  const monthFirst = text.match(new RegExp(`\\b(${MONTH_PATTERN})\\.?${YEAR}\\s*,?\\s+(?:del?|entre)\\s+(?:el\\s+)?(\\d{1,2})\\s+(?:al|hasta|y)\\s+(?:el\\s+)?(\\d{1,2})\\b`));
  if (monthFirst) return range(Number(monthFirst[2] || year), monthNumber(monthFirst[1]), Number(monthFirst[3]), Number(monthFirst[2] || year), monthNumber(monthFirst[1]), Number(monthFirst[4]));

  const literals = [...text.matchAll(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{4})?)\b/g)].map(([value]) => {
    if (!value.includes('/')) return value;
    const [day, month, explicitYear] = value.split('/');
    return isoDate(Number(explicitYear || year), Number(month) - 1, Number(day));
  });
  if (literals.length > 2) return finish(null, 'Mencionaste más de dos fechas. ¿Cuál es la fecha de inicio y cuál es la de fin?');
  if (literals.length === 2) return finish({ fechaDesde: literals[0], fechaHasta: literals[1] });
  if (literals.length === 1) {
    if (/\b(del?|desde|hasta|entre|antes|despues)\b/.test(text)) return finish(null, 'Necesito las dos fechas para aplicar ese período. ¿Desde qué día y hasta qué día?');
    return finish({ fechaDesde: literals[0], fechaHasta: literals[0] });
  }

  const partial = text.match(/\b(?:(?:del?|desde|entre)\s+)?(?:el\s+)?(\d{1,2})\s*(?:al|a|hasta|y|-)\s*(?:el\s+)?(\d{1,2})(?:\s+(?:de\s+)?(?:este mes|el mes pasado))?\b/);
  if (partial) {
    if (new RegExp(`\\b(${MONTH_PATTERN})\\b`).test(text)) return finish(null, clarification);
    const remainder = text.slice(partial.index + partial[0].length).trim();
    if (/^(de|del|en)\b/.test(remainder) && !/^(?:(?:de|del|en)\s+)?(?:este mes|el mes pasado|mes pasado)\b/.test(remainder)) return finish(null, '¿De qué mes y año necesitas esos días?');
    let anchor = null;
    if (/este mes/.test(text)) anchor = current;
    else if (/mes pasado/.test(text)) anchor = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, 1, 12));
    else if (sameMonth) anchor = new Date(`${context.fechaDesde}T12:00:00Z`);
    if (!anchor) return finish(null, '¿De qué mes y año necesitas esos días?');
    return range(anchor.getUTCFullYear(), anchor.getUTCMonth(), Number(partial[1]), anchor.getUTCFullYear(), anchor.getUTCMonth(), Number(partial[2]));
  }

  const half = original.match(new RegExp(`\\b(primera|segunda|1ra|2da) quincena(?:\\s+de)?(?:\\s+(${MONTH_PATTERN})\\.?${YEAR})?`));
  if (half) {
    const selectedMonth = half[2] ? monthNumber(half[2]) : /mes pasado/.test(original) ? (current.getUTCMonth() + 11) % 12 : /este mes/.test(original) ? current.getUTCMonth() : sameMonth ? Number(context.fechaDesde.slice(5, 7)) - 1 : null;
    if (selectedMonth == null) return finish(null, '¿De qué mes necesitas la quincena?');
    const selectedYear = Number(half[3] || (/mes pasado/.test(original) && current.getUTCMonth() === 0 ? current.getUTCFullYear() - 1 : /este mes|mes pasado/.test(original) ? current.getUTCFullYear() : year));
    return range(selectedYear, selectedMonth, /primera|1ra/.test(half[1]) ? 1 : 16, selectedYear, selectedMonth, /primera|1ra/.test(half[1]) ? 15 : new Date(Date.UTC(selectedYear, selectedMonth + 1, 0)).getUTCDate());
  }
  if (/esta quincena|quincena actual/.test(text)) return finish({ fechaDesde: isoDate(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate() < 16 ? 1 : 16), fechaHasta: today });
  if (/quincena (pasada|anterior)/.test(text)) {
    if (current.getUTCDate() >= 16) return range(current.getUTCFullYear(), current.getUTCMonth(), 1, current.getUTCFullYear(), current.getUTCMonth(), 15);
    const previousMonth = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, 1));
    return range(previousMonth.getUTCFullYear(), previousMonth.getUTCMonth(), 16, previousMonth.getUTCFullYear(), previousMonth.getUTCMonth(), new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 0)).getUTCDate());
  }
  const single = text.match(new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${MONTH_PATTERN})\\.?${YEAR}\\b`));
  if (single) {
    if (/\b(antes|despues|hasta|desde|entre|alrededor|aproximadamente)\b|a partir/.test(text)) return finish(null, '¿Desde qué día y hasta qué día necesitas el reporte?');
    return range(Number(single[3] || year), monthNumber(single[2]), Number(single[1]), Number(single[3] || year), monthNumber(single[2]), Number(single[1]));
  }

  const named = [...text.matchAll(new RegExp(`\\b(${MONTH_PATTERN})\\.?${YEAR}\\b`, 'g'))];
  if (named.length) {
    if (named.length > 1 || /\b\d{1,2}\b|\b(antes|despues|hasta|desde|entre|alrededor|aproximadamente)\b/.test(text.replace(/\b(?:19|20|21)\d{2}\b/g, ''))) return finish(null, clarification);
    return fullMonth(Number(named[0][2] || year), monthNumber(named[0][1]));
  }
  if (/mes (pasado|anterior)|mes que paso/.test(text)) {
    const previousMonth = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, 1));
    return fullMonth(previousMonth.getUTCFullYear(), previousMonth.getUTCMonth());
  }
  if (/este mes|mes actual/.test(text)) return finish({ fechaDesde: isoDate(current.getUTCFullYear(), current.getUTCMonth(), 1), fechaHasta: today });
  if (/este ano|ano actual/.test(text)) return finish({ fechaDesde: `${current.getUTCFullYear()}-01-01`, fechaHasta: today });
  if (/\banteayer\b/.test(text)) return finish({ fechaDesde: daysAgo(2), fechaHasta: daysAgo(2) });
  if (/\bayer\b/.test(text)) return finish({ fechaDesde: daysAgo(1), fechaHasta: daysAgo(1) });
  if (/\bhoy\b/.test(text)) return finish({ fechaDesde: today, fechaHasta: today });
  const lastDays = text.match(/ultimos? (\d{1,3}) dias?/);
  if (lastDays && Number(lastDays[1]) > 0) return finish({ fechaDesde: daysAgo(Number(lastDays[1]) - 1), fechaHasta: today });
  if (/esta semana|semana (pasada|anterior)/.test(text)) {
    const monday = new Date(current); monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7 - (/semana (pasada|anterior)/.test(text) ? 7 : 0));
    const end = new Date(monday); end.setUTCDate(end.getUTCDate() + 6);
    return finish({ fechaDesde: monday.toISOString().slice(0, 10), fechaHasta: /semana (pasada|anterior)/.test(text) ? end.toISOString().slice(0, 10) : today });
  }
  return finish(null);
}

function colloquialText(message) {
  return naturalText(message);
}

module.exports = { interpretDates, dateRange: (message, today, context) => interpretDates(message, today, context).range, colloquialText, isFollowup: message => FOLLOWUP.test(colloquialText(message)) };
