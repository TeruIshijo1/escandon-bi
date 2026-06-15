/**
 * bi.routes.js — PowerBI Embedded Token Generation
 * Hospital Escandón BI Platform v1.0
 *
 * En producción usa: @azure/msal-node + PowerBI REST API
 * Aquí se simula el flujo para V1.0
 */
'use strict';

const express = require('express');
const router  = express.Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');

const { getDb } = require('../config/db');


/**
 * GET /api/bi/available-reports
 * Retorna todos los reportes activos
 */
router.get('/available-reports', authenticate, (req, res, next) => {
  try {
    const db = getDb();
    let reports = db.prepare('SELECT * FROM ConfiguracionBI WHERE Activo = 1').all();
    
    // Si no es ADMIN, filtrar por los permisos del usuario
    if (req.user.role !== 'ADMIN') {
      const allowedIds = req.user.permisos || [];
      reports = reports.filter(r => allowedIds.includes(r.ReporteId));
    }
    
    res.json({ ok: true, data: reports });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/bi/token/:reportId
 * Genera un EmbedToken de PowerBI para el reporte solicitado.
 */
router.get(
  '/token/:reportId',
  authenticate,
  authorize(['ADMIN', 'DIRECTOR', 'JEFE_AREA', 'USUARIO_OPERATIVO']),
  async (req, res, next) => {
    try {
      const { reportId } = req.params;
      const db = getDb();
      
      // Buscar en la BD primero
      const config = db.prepare('SELECT * FROM ConfiguracionBI WHERE ReporteId = ? OR ConfigId = ?').get(reportId, reportId);
      
      let embedUrl, pbiReportId, workspaceId;

      if (config && (config.LookerDashboard || config.PowerBIReportId)) {
        embedUrl    = config.LookerDashboard || `https://app.powerbi.com/reportEmbed?reportId=${config.PowerBIReportId}`;
        pbiReportId = config.PowerBIReportId;
        workspaceId = config.PowerBIWorkspace;

      } else {
        return res.status(404).json({ error: `Reporte '${reportId}' no encontrado.` });
      }

      // Simulación V1.0 de Embed Token
      const embedToken = Buffer.from(
        JSON.stringify({ reportId, userId: req.user.id, exp: Date.now() + 3600000 })
      ).toString('base64');

      res.json({
        embedToken,
        embedUrl,
        embedUrl2:   (config && config.LookerDashboard2) || null,
        embedUrl3:   (config && config.LookerDashboard3) || null,
        multiPagina: (config && config.MultiPagina === 1) || false,
        reportId:    pbiReportId,
        workspaceId: workspaceId,
        expiresIn:   3600,
        tokenType:   'Embed',
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
