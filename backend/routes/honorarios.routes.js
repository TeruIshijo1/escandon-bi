/**
 * honorarios.routes.js — Reporte Unificado de Liquidación y Auditoría de Honorarios Médicos
 * Hospital Escandón BI Platform
 *
 * Unifica las dos vistas del motor de honorarios de Vertical (Cirrus):
 * 1. UDR_HON_PAGO_Audit: Universo total de atenciones, cargos y diagnóstico de reglas de negocio
 * 2. UDR_HON_PAGO: Motor de liquidación con tabulador, impuestos, retenciones ISR y neto a pagar
 */
'use strict';

const express = require('express');
const router = express.Router();
const { getRemoteDb, connectRemoteDB } = require('../config/remote-db');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { reconcileHonorariosWithSap } = require('../services/honorariosSapReconciliation.service');
const { recoverHonorariosCoverage, getClinicalProviderDirectory } = require('../services/honorariosCoverage.service');
const { readReviews, saveReview, canReview } = require('../services/honorariosReview.service');

const ALLOWED_ROLES = [
  'ADMIN',
  'DIRECTOR',
  'JEFE_AREA',
  'USUARIO_OPERATIVO',
  'CONSULTA_EXTERNA',
  'ALMACEN_GENERAL'
];

router.use(authenticate, (req, res, next) => canReview(req.user) ? next()
  : res.status(403).json({ error: 'No tienes acceso al módulo Honorarios Médicos.' }));

router.get('/reviews', authenticate, authorize(ALLOWED_ROLES), async (req, res) => {
  const { startDate, endDate } = req.query;
  if (![startDate, endDate].every(value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value))) || startDate > endDate) {
    return res.status(400).json({ error: 'Periodo de revisión inválido.' });
  }
  try { return res.json({ ok: true, reviews: await readReviews(startDate, endDate), canReview: canReview(req.user) }); }
  catch (error) { console.error('[Honorarios] Revisiones BI:', error.message); return res.status(503).json({ error: 'No se pudieron leer las decisiones guardadas en BI. Intenta actualizar el reporte.' }); }
});

router.put('/reviews', authenticate, authorize(ALLOWED_ROLES), async (req, res) => {
  try { return res.json({ ok: true, review: await saveReview(req.body, req.user) }); }
  catch (error) { return res.status(error.status || 503).json({ error: error.status ? error.message : 'No se pudo guardar la decisión en BI. El registro conserva su estado anterior.' }); }
});

/**
 * POST /api/honorarios/sap-reconciliation
 * Lee documentos y aplicaciones de pago de SAP sin modificar datos de SAP.
 * Los nombres recibidos son solo candidatos para localizar proveedores; no validan identidad.
 */
router.post('/sap-reconciliation', authenticate, authorize(ALLOWED_ROLES), async (req, res) => {
  const { startDate, endDate, doctors } = req.body || {};
  if (!Array.isArray(doctors) || doctors.length > 500) {
    return res.status(400).json({ ok: false, error: 'La lista de médicos no es válida.' });
  }

  try {
    const pool = await connectRemoteDB();
    const clinicalDirectory = await getClinicalProviderDirectory(pool);
    const result = await reconcileHonorariosWithSap({ startDate, endDate, doctors, clinicalDirectory, includeAdditional: true });
    return res.json(result);
  } catch (err) {
    console.error('[Honorarios] Error en conciliación SAP (solo lectura):', err);
    const clientInputError = /periodo|período|fecha|lista|médicos|medicos|nombre|máximo/i.test(err.message || '');
    return res.status(clientInputError ? 400 : 502).json({
      ok: false,
      error: clientInputError ? err.message : 'No se pudo completar la consulta de SAP. El reporte de honorarios permanece disponible.'
    });
  }
});

/**
 * GET /api/honorarios/audit
 * Consulta unificada de honorarios médicos con cálculo de liquidación y diagnóstico de exclusiones
 * Parámetros de consulta:
 *  - startDate (YYYY-MM-DD)
 *  - endDate (YYYY-MM-DD)
 *  - status ('elegibles' | 'exclusiones' | 'todos')
 *  - grupoServicio (opcional)
 *  - medico (opcional)
 */
router.get('/audit', authenticate, authorize(ALLOWED_ROLES), async (req, res) => {
  try {
    const { startDate, endDate, status, grupoServicio, medico } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        ok: false,
        error: 'Los parámetros startDate y endDate son obligatorios (formato YYYY-MM-DD).'
      });
    }

    let pool;
    try {
      pool = await getRemoteDb();
    } catch {
      pool = await connectRemoteDB();
    }

    let query = `
      ;WITH AuditSource AS (
        SELECT a.*,
          COUNT(*) OVER (PARTITION BY a.UDRKey, a.ItemCode) AS AuditRowsForPaymentKey,
          SUM(CASE WHEN a.IMPORTE IS NOT NULL THEN a.IMPORTE ELSE 0 END)
            OVER (PARTITION BY a.UDRKey, a.ItemCode) AS AuditImporteKeyTotal,
          ROW_NUMBER() OVER (
            PARTITION BY a.UDRKey, a.ItemCode
            ORDER BY a.PCDate, a.PCNum, a.Medico, a.OrigenRenglon
          ) AS AuditRowNumber
        FROM UDR_HON_PAGO_Audit a
      ), AuditPayment AS (
        SELECT a.*,
          p.SONum AS PaymentSONum,
          p.BPName AS PaymentBPName,
          p.PTName AS PaymentPTName,
          p.Medico AS PaymentMedico,
          p.Especialidad AS PaymentEspecialidad,
          p.UDF_TIPO_MEDICO AS PaymentTipoMedico,
          p.Quantity AS PaymentQuantity,
          p.BaseImporte AS PaymentBaseImporte,
          p.IvaLinea AS PaymentIvaLinea,
          p.ISRRateNorm AS PaymentISRRateNorm,
          p.SinTabulador AS PaymentSinTabulador,
          p.Tiene_SO AS PaymentTieneSO,
          p.Tiene_Cita AS PaymentTieneCita,
          p.MatchPaciente AS PaymentMatchPaciente,
          p.MatchMedico AS PaymentMatchMedico,
          p.AuditMsg AS PaymentAuditMsg
        FROM AuditSource a
        LEFT JOIN UDR_HON_PAGO p ON a.UDRKey = p.UDRKey AND a.ItemCode = p.ItemCode
      ), AuditComputed AS (
        SELECT a.*,
          CASE
            WHEN a.PaymentBaseImporte IS NOT NULL AND a.PaymentBaseImporte > 0 AND a.AuditRowsForPaymentKey = 1 THEN a.PaymentBaseImporte
            WHEN a.PaymentBaseImporte IS NOT NULL AND a.PaymentBaseImporte > 0 AND a.AuditRowsForPaymentKey > 1
                 AND ABS(a.PaymentBaseImporte - a.AuditImporteKeyTotal) <= 0.01 THEN COALESCE(a.IMPORTE, 0)
            ELSE 0
          END AS CalculatedBaseImporte,
          CASE
            WHEN a.PaymentBaseImporte IS NOT NULL AND a.PaymentBaseImporte > 0 AND a.AuditRowsForPaymentKey = 1 THEN 1
            WHEN a.PaymentBaseImporte IS NOT NULL AND a.PaymentBaseImporte > 0 AND a.AuditRowsForPaymentKey > 1
                 AND a.AuditImporteKeyTotal IS NOT NULL AND ABS(a.PaymentBaseImporte - a.AuditImporteKeyTotal) <= 0.01 THEN 1
            ELSE 0
          END AS BaseIntegrityValid,
          CASE
            WHEN a.PaymentBaseImporte IS NOT NULL AND a.PaymentBaseImporte > 0
                 AND a.AuditRowsForPaymentKey > 1 AND ABS(a.PaymentBaseImporte - a.AuditImporteKeyTotal) <= 0.01
                 AND a.PaymentIvaLinea IS NOT NULL AND a.PaymentIvaLinea <> 0 AND a.AuditImporteKeyTotal > 0
            THEN CASE
              WHEN a.AuditRowNumber < a.AuditRowsForPaymentKey
              THEN ROUND(a.PaymentIvaLinea * COALESCE(a.IMPORTE, 0) / NULLIF(a.AuditImporteKeyTotal, 0), 2)
              ELSE ROUND(a.PaymentIvaLinea - (
                SUM(ROUND(a.PaymentIvaLinea * COALESCE(a.IMPORTE, 0) / NULLIF(a.AuditImporteKeyTotal, 0), 2))
                  OVER (PARTITION BY a.UDRKey, a.ItemCode)
                - ROUND(a.PaymentIvaLinea * COALESCE(a.IMPORTE, 0) / NULLIF(a.AuditImporteKeyTotal, 0), 2)
              ), 2)
            END
            WHEN a.PaymentBaseImporte IS NOT NULL AND a.PaymentBaseImporte > 0 AND a.AuditRowsForPaymentKey = 1
            THEN a.PaymentIvaLinea
            WHEN a.PaymentBaseImporte > 0 AND a.AuditRowsForPaymentKey > 1
                 AND ABS(a.PaymentBaseImporte - a.AuditImporteKeyTotal) <= 0.01
                 AND a.PaymentIvaLinea = 0 THEN 0
            ELSE NULL
          END AS CalculatedIvaLinea
        FROM AuditPayment a
      )
      SELECT 
        -- Identificadores de Atención y Documento
        a.PCNum AS "FolioAtencion",
        a.PCDate AS "FechaAtencion",
        a.UDRKey AS "UDRKey",
        a.AuditRowNumber AS "RenglonAuditoria",
        COALESCE(a.PaymentSONum, a.SONum) AS "FolioOrdenVenta",
        a.OrigenRenglon AS "OrigenRenglon",
        
        -- Paciente y Cliente / Aseguradora
        COALESCE(a.BPName, a.PaymentBPName, 'VENTA GENERAL') AS "Cliente",
        COALESCE(a.PTName, a.PaymentPTName, 'PACIENTE NO ESPECIFICADO') AS "Paciente",
        
        -- Datos del Médico Tratante
        COALESCE(a.Medico, a.PaymentMedico) AS "Medico",
        COALESCE(a.Especialidad, a.PaymentEspecialidad, 'MEDICINA GENERAL') AS "Especialidad",
        COALESCE(a.UDF_TIPO_MEDICO, a.PaymentTipoMedico, 'HN') AS "TipoMedico",
        
        -- Detalle del Servicio
        a.ItemGroupName AS "GrupoServicio",
        a.ItemCode AS "CodigoServicio",
        a.ItemDescription AS "Servicio",
        COALESCE(a.Quantity, a.PaymentQuantity, 1) AS "Cantidad",
        COALESCE(a.UnitPrice, 0) AS "PrecioCobradoPaciente",
        
        -- Importe Base del Tabulador de Honorarios
        a.CalculatedBaseImporte AS "BaseImporte",
        a.IMPORTE AS "BasePropuesta",
        a.BaseIntegrityValid AS "IntegridadBaseValida",

        -- Impuestos de Línea
        a.CalculatedIvaLinea AS "IvaLinea",
        
        -- Tasa ISR Normalizada (ej. 0.10 para 10%, 0.0125 para 1.25%, 0.0 si exento)
        CASE
          WHEN a.PaymentISRRateNorm IS NOT NULL AND a.PaymentISRRateNorm > 0 AND a.PaymentISRRateNorm <= 1 THEN a.PaymentISRRateNorm
          WHEN a.ISRRateRaw IS NOT NULL AND a.ISRRateRaw > 1 THEN a.ISRRateRaw / 100.0
          WHEN a.ISRRateRaw IS NOT NULL AND a.ISRRateRaw > 0 THEN a.ISRRateRaw
          ELSE 0.0
        END AS "TasaISR",

        -- Estado actual en Vertical; BI lo usa como estado inicial de la revisión.
        CASE
          WHEN a.Elegible_V_HON_PAGO = 1
               AND (a.MotivoExclusion IS NULL OR a.MotivoExclusion = '' OR a.MotivoExclusion NOT LIKE 'No entra%')
          THEN 'APROBADO'
          WHEN a.Elegible_V_HON_PAGO = 0 OR a.MotivoExclusion LIKE 'No entra%'
          THEN 'RECHAZADO'
          ELSE NULL
        END AS "EstadoVertical",
        -- Elegibilidad para cálculo: requiere además médico e importe íntegros.
        CASE 
          WHEN a.Elegible_V_HON_PAGO = 1 
               AND (a.MotivoExclusion IS NULL OR a.MotivoExclusion = '' OR a.MotivoExclusion NOT LIKE 'No entra%')
               AND a.Medico IS NOT NULL AND a.Medico <> ''
               AND a.BaseIntegrityValid = 1 AND a.CalculatedBaseImporte > 0
          THEN 1
          ELSE 0
        END AS "ElegiblePago",

        -- Campos de Diagnóstico y Auditoría de Cita/Orden
        CASE WHEN a.PaymentBaseImporte IS NULL OR a.PaymentBaseImporte <= 0
          THEN 1 ELSE COALESCE(a.PaymentSinTabulador, 0) END AS "SinTabulador",
        a.PaymentTieneSO AS "TieneSO",
        a.PaymentTieneCita AS "TieneCita",
        a.PaymentMatchPaciente AS "MatchPaciente",
        a.PaymentMatchMedico AS "MatchMedico",
        CASE 
          WHEN a.Elegible_V_HON_PAGO = 1
               AND (a.MotivoExclusion IS NULL OR a.MotivoExclusion = '' OR a.MotivoExclusion NOT LIKE 'No entra%')
               AND a.Medico IS NOT NULL AND a.Medico <> '' AND (a.PaymentBaseImporte IS NULL OR a.PaymentBaseImporte <= 0)
          THEN 'No existe una base positiva en la liquidación clínica; no se usa el precio al paciente como honorario. Requiere revisar tabulador y vínculo.'
          WHEN a.Elegible_V_HON_PAGO = 1
               AND (a.MotivoExclusion IS NULL OR a.MotivoExclusion = '' OR a.MotivoExclusion NOT LIKE 'No entra%')
               AND a.Medico IS NOT NULL AND a.Medico <> '' AND a.BaseIntegrityValid = 0
          THEN 'Base agregada de liquidación no conciliada con el detalle de auditoría; requiere revisión antes de incluirla.'
          WHEN a.Elegible_V_HON_PAGO = 1
               AND (a.MotivoExclusion IS NULL OR a.MotivoExclusion = '' OR a.MotivoExclusion NOT LIKE 'No entra%')
               AND a.Medico IS NOT NULL AND a.Medico <> '' AND a.CalculatedBaseImporte <= 0
          THEN 'No hay base positiva de honorario en la fuente; requiere revisión antes de incluirla.'
          WHEN a.Elegible_V_HON_PAGO = 1 
               AND (a.MotivoExclusion IS NULL OR a.MotivoExclusion = '' OR a.MotivoExclusion NOT LIKE 'No entra%')
               AND a.Medico IS NOT NULL AND a.Medico <> ''
          THEN COALESCE(a.PaymentAuditMsg, 'Cumple con todas las reglas de liquidación')
          ELSE COALESCE(a.MotivoExclusion, a.PaymentAuditMsg, 'Excluido por reglas de negocio')
        END AS "MensajeAuditoria",
        
        -- Banderas de Reglas de Negocio
        a.Pasa_PC_ST AS "PasaAtencionCerrada",
        a.Pasa_ItemType AS "PasaTipoServicio",
        a.Pasa_UT_Honorarios AS "PasaCatalogoHonorarios",
        a.Pasa_Incluido_Honorarios AS "PasaIncluidoHonorarios",
        a.MotivoExclusion AS "MotivoExclusionOriginal"
      FROM AuditComputed a
      WHERE a.PCDate >= CAST(@startDate AS DATETIME) 
        AND a.PCDate < DATEADD(day, 1, CAST(@endDate AS DATETIME))
        AND (a.ItemGroupName IS NULL OR a.ItemGroupName NOT IN ('ALMACEN GENERAL', 'FARMACIA'))
    `;

    const request = pool.request();
    request.input('startDate', startDate);
    request.input('endDate', endDate);

    /* Los filtros se aplican después de recuperar citas para que el mismo
       universo se use en Todos, Incluidos y Exclusiones. */
    query += ` ORDER BY a.PCDate DESC, a.Medico ASC, a.PCNum DESC`;

    const result = await request.query(query);

    const recovered = await recoverHonorariosCoverage(pool, result.recordset, startDate, endDate);
    const data = recovered.rows.filter(row => {
      if (status === 'elegibles' && !row.ElegiblePago) return false;
      if (status === 'exclusiones' && row.ElegiblePago) return false;
      if (grupoServicio && grupoServicio !== 'TODOS' && String(row.GrupoServicio || '').trim() !== grupoServicio.trim()) return false;
      return !medico || String(row.Medico || '').trim() === medico.trim();
    }).sort((a,b) => new Date(b.FechaAtencion) - new Date(a.FechaAtencion) || String(a.Medico).localeCompare(String(b.Medico)));

    return res.json({
      ok: true,
      data,
      total: data.length,
      coverage: recovered.coverage
    });

  } catch (err) {
    console.error('[Honorarios] Error al consultar reporte unificado en Vertical:', err);
    return res.status(500).json({
      ok: false,
      error: 'No se pudo consultar el reporte clínico de honorarios. Intenta nuevamente o solicita revisión a Sistemas.'
    });
  }
});

module.exports = router;
