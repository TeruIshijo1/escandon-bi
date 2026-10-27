'use strict';

const router = require('express').Router();
const { authenticate, authorizeCapability } = require('../middleware/auth.middleware');
const { getReport, getHistoryForDisplay, dashboardData } = require('../services/statistics.service');
const { createStatisticsWorkbook } = require('../services/statisticsWorkbook.service');
const { BY_ID } = require('../services/statisticsCatalog');
const { ACTIVE_START, dateRange, monthRange, periodRange, hospitalToday, invalid } = require('../services/statisticsCommon');

function reportRange(startDate, endDate) {
  const range = dateRange(startDate, endDate);
  if (range.endDate > hospitalToday()) throw invalid('La fecha final no puede ser posterior a hoy.');
  return range;
}

function requireStatistics(req, res, next) {
  const user = req.user;
  if (String(user?.username || '').toLowerCase() === 'amendoza' || user?.permisos?.includes('estadisticas')) return next();
  return res.status(403).json({ ok: false, error: 'No tienes acceso a los estadísticos institucionales. Solicita el permiso a tu administrador.' });
}

const access = [authenticate, requireStatistics];
const handle = action => async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try { await action(req, res); }
  catch (error) {
    if (error.code === 'STATISTICS_PENDING') {
      if (!res.headersSent && !res.destroyed) res.status(202).json({ ok: true, status: 'refreshing', data: null, storage: error.storage });
      return;
    }
     
    const status = error.status === 400 ? 400 : 503;
    const timedOut = error.code === 'SAP_READ_TIMEOUT';
    const databaseTimedOut = error.code === 'STATISTICS_DB_TIMEOUT';
    if (status === 503) console.error('[statistics] Consulta incompleta', {
      route: req.route.path,
      code: timedOut ? 'SAP_READ_TIMEOUT' : databaseTimedOut ? 'STATISTICS_DB_TIMEOUT' : 'STATISTICS_SOURCE_FAILED',
      ...(databaseTimedOut ? { phase: error.phase } : {})
    });
    const message = status === 400 ? error.publicMessage || error.message : timedOut
      ? 'La consulta de SAP tardó más de lo esperado. Espera un momento y vuelve a generar el estadístico.'
      : databaseTimedOut ? 'La consulta de la información guardada tardó demasiado. Vuelve a intentar; si continúa, solicita revisión a Sistemas.'
      : 'No se pudo completar la consulta de los estadísticos. Intenta nuevamente; si continúa, solicita revisión a Sistemas.';
    if (!res.headersSent && !res.destroyed) res.status(status).json({ ok: false, error: message });
  }
};

router.get('/stats', ...access, handle(async (req, res) => {
  const range = req.query.startDate || req.query.endDate ? reportRange(req.query.startDate, req.query.endDate) : periodRange(req.query.periodo);
  const report = await getReport(range.startDate, range.endDate);
  res.json({ ok: true, data: dashboardData(report) });
}));

router.get('/stats-historico', ...access, handle(async (req, res) => {
  const result = await getHistoryForDisplay(req.query.seccion, { retryFailed: req.query.retry === '1' });
  res.json({ ok: true, seccion: req.query.seccion, ...result });
}));

router.get('/stats-detalle', ...access, handle(async (req, res) => {
  const definition = BY_ID[req.query.seccion];
  if (!definition) throw invalid('Selecciona un estadístico válido.');
  const explicitDates = Boolean(req.query.startDate || req.query.endDate);
  const range = explicitDates ? reportRange(req.query.startDate, req.query.endDate) : monthRange(req.query.year, req.query.mes);
  if (range.startDate < ACTIVE_START) throw invalid('El histórico de este mes contiene totales agregados. No hay detalle verificable para mostrar.');
  const today = hospitalToday();
  if (range.startDate > today) throw invalid('Este mes aún no ha comenzado. No hay un resultado verificable.');
  const cutoff = range.endDate > today ? today : range.endDate;
  const report = await getReport(range.startDate, cutoff);
  const section = report.sections[definition.key];
  res.json({ ok: true, seccion: definition.id, year: explicitDates ? null : Number(req.query.year), mes: explicitDates ? null : Number(req.query.mes),
    total: section.rows.length, data: section.rows, quantity: section.quantity, unit: section.unit, criterion: section.criterion,
    period: { startDate: range.startDate, endDate: cutoff }, storage: report.storage,
    warnings: [...(section.warnings || []), ...(report.warnings || []), ...(cutoff !== range.endDate ? [`Mes en curso: información consultada hasta ${cutoff}.`] : [])] });
}));

router.get('/stats-export', ...access, authorizeCapability('exportarExcel'), handle(async (req, res) => {
  const range = reportRange(req.query.startDate, req.query.endDate);
  const requestId = require('node:crypto').randomUUID();
  const startedAt = Date.now();
  const log = (phase, extra = {}) => console.info('[statistics] Exportación', { requestId, phase, ...range, durationMs: Date.now() - startedAt, ...extra });
  log('reading');
  const report = await getReport(range.startDate, range.endDate, { includeAnnual: true });
  if (res.destroyed) { log('disconnected'); return; }
  log('workbook', { annualStatus: report.annualDoctorRanking?.status || 'unavailable' });
  const buffer = await createStatisticsWorkbook(report);
  if (res.destroyed) { log('disconnected'); return; }
  log('ready', { bytes: buffer.byteLength });
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="Estadistico_${range.startDate}_${range.endDate}.xlsx"`);
  res.send(Buffer.from(buffer));
}));

module.exports = router;
