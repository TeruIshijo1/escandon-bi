'use strict';

const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const { getHospitalSales } = require('../services/hospitalSales.service');
const REPORT_TIMEOUT = 10 * 60 * 1000;

function requireSales(req, res, next) {
  const user = req.user;
  if (user && (String(user.username || '').toLowerCase() === 'amendoza' ||
    (Array.isArray(user.permisos) && user.permisos.includes('auditoria-ventas-hospitalarias')))) return next();
  return res.status(403).json({ success: false, error: 'No tienes permiso para consultar las ventas hospitalarias.' });
}

router.get('/', authenticate, requireSales, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  const timer = setTimeout(() => { timedOut = true; cancel(); }, REPORT_TIMEOUT);
  timer.unref?.();
  res.once('close', cancel);
  res.once('finish', cancel);
  try {
    const data = await getHospitalSales({ startDate: req.query.startDate, endDate: req.query.endDate }, { signal: controller.signal });
    if (timedOut) throw new Error('Tiempo máximo agotado.');
    if (!res.destroyed) res.json({ success: true, data });
  } catch (error) {
    if (res.destroyed) return;
    const status = error.status === 400 ? 400 : 502;
    res.status(status).json({ success: false, error: status === 400 ? error.publicMessage || error.message :
      timedOut || error.code === 'SAP_READ_TIMEOUT'
        ? 'La consulta tardó más de lo esperado. Selecciona un periodo menor o intenta nuevamente.'
        : 'No se pudo completar el reporte de ventas. Intenta nuevamente; si continúa, solicita revisión a Sistemas.' });
  } finally {
    clearTimeout(timer);
    res.removeListener('close', cancel);
    res.removeListener('finish', cancel);
    cancel();
  }
});

module.exports = router;
