/**
 * export.routes.js — Exportación de reportes PDF y Excel
 * Hospital Escandón BI Platform v1.0
 */
'use strict';

const express = require('express');
const router  = express.Router();
const PDFDocument = require('pdfkit');
const ExcelJS     = require('exceljs');
const fs          = require('fs');
const path        = require('path');
const { getDb }   = require('../config/db');
const { authenticate, authorize, authorizeCapability } = require('../middleware/auth.middleware');
const { getInventariosVsCargos, getDevolucionesFarmacia, getCargosFarmaciaSAP } = require('../services/etl.service');

/* ══════════════════════════════════════════════════════════════
   ESTILO INSTITUCIONAL — Formato Excel Hospital Escandón
   Se aplica a TODOS los reportes generados por la plataforma.
══════════════════════════════════════════════════════════════ */
const BRAND = {
  azulOscuro:   'FF004687',
  azulClaro:    'FF0088C9',
  blanco:       'FFFFFFFF',
  grisFila:     'FFF4F6F9',
  grisTexto:    'FF475569',
  azulTotales:  'FFE0EAF4',
  verdeMoneda:  'FF15803D',
  ambarLote:    'FFB45309',
  rojoCrit:     'FF991B1B',
  rojoFondo:    'FFFEE2E2',
  amarilloFondo:'FFFEF3C7',
  amarilloTxt:  'FF92400E',
  verdeFondo:   'FFD1FAE5',
  verdeTxt:     'FF065F46',
};

/**
 * Aplica el formato institucional completo a un workbook de ExcelJS.
 * @param {ExcelJS.Workbook} workbook
 * @param {ExcelJS.Worksheet} sheet
 * @param {object} opts
 * @param {string} opts.titulo - Título del reporte
 * @param {object} opts.resumen - Objeto clave-valor con métricas de resumen (opcional)
 * @param {Array}  opts.columnas - Array de {header, key, width}
 * @param {Array}  opts.filas - Array de objetos con los datos
 * @param {object} opts.totales - Objeto con fila de totales (opcional)
 * @param {object} opts.meta - Info del usuario {nombre, role} (opcional)
 * @param {string} opts.periodo - Texto descriptivo del período (opcional)
 */
function applyInstitutionalStyle(workbook, sheet, opts) {
  const { titulo, resumen, columnas, filas, totales, meta, periodo } = opts;
  const numCols = columnas.length;

  // ── Fila 1: Barra de título ──
  const titleRow = sheet.addRow([titulo || 'HOSPITAL ESCANDÓN']);
  sheet.mergeCells(titleRow.number, 1, titleRow.number, numCols);
  titleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.azulOscuro } };
  titleRow.getCell(1).font = { color: { argb: BRAND.blanco }, bold: true, size: 14, name: 'Calibri' };
  titleRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  titleRow.height = 32;

  // ── Fila 2: Subtítulo ──
  const subtitleText = 'Hospital Escandón — Plataforma BI';
  const subRow = sheet.addRow([subtitleText]);
  sheet.mergeCells(subRow.number, 1, subRow.number, numCols);
  subRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.azulClaro } };
  subRow.getCell(1).font = { color: { argb: BRAND.blanco }, size: 10, name: 'Calibri' };
  subRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  subRow.height = 22;

  // ── Fila 3: Metadatos ──
  const infoFragments = [];
  if (periodo) infoFragments.push(`Período: ${periodo}`);
  if (meta?.nombre) infoFragments.push(`Generado por: ${meta.nombre}`);
  infoFragments.push(`Fecha: ${new Date().toLocaleString('es-MX')}`);
  infoFragments.push(`Total registros: ${filas.length}`);
  const infoRow = sheet.addRow([infoFragments.join('   |   ')]);
  sheet.mergeCells(infoRow.number, 1, infoRow.number, numCols);
  infoRow.getCell(1).font = { color: { argb: BRAND.grisTexto }, size: 9, name: 'Calibri', italic: true };
  infoRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  infoRow.height = 20;

  // ── Fila 4: Resumen (si hay) ──
  if (resumen && Object.keys(resumen).length > 0) {
    const resumenText = Object.entries(resumen).map(([k, v]) => `${k}: ${v}`).join('   |   ');
    const resRow = sheet.addRow([resumenText]);
    sheet.mergeCells(resRow.number, 1, resRow.number, numCols);
    resRow.getCell(1).font = { color: { argb: BRAND.azulOscuro }, size: 10, name: 'Calibri', bold: true };
    resRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    resRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.azulTotales } };
    resRow.height = 22;
  }

  // ── Fila separadora ──
  const sepRow = sheet.addRow([]);
  sepRow.height = 6;

  // ── Fila de encabezados de columna ──
  const headerValues = columnas.map(c => c.header);
  const headerRow = sheet.addRow(headerValues);
  const headerRowNum = headerRow.number;
  headerRow.height = 30;
  headerRow.eachCell((cell, colNumber) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.azulOscuro } };
    cell.font = { color: { argb: BRAND.blanco }, bold: true, size: 10, name: 'Calibri' };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top:    { style: 'thin', color: { argb: 'FF003366' } },
      bottom: { style: 'thin', color: { argb: 'FF003366' } },
      left:   { style: 'thin', color: { argb: 'FF003366' } },
      right:  { style: 'thin', color: { argb: 'FF003366' } },
    };
  });

  // ── Configurar anchos de columna ──
  columnas.forEach((c, i) => {
    sheet.getColumn(i + 1).width = c.width || 18;
    sheet.getColumn(i + 1).key = c.key;
  });

  // ── Datos con formato ──
  const thinBorder = {
    top:    { style: 'hair', color: { argb: 'FFD1D5DB' } },
    bottom: { style: 'hair', color: { argb: 'FFD1D5DB' } },
    left:   { style: 'hair', color: { argb: 'FFD1D5DB' } },
    right:  { style: 'hair', color: { argb: 'FFD1D5DB' } },
  };

  filas.forEach((row, idx) => {
    const rowValues = columnas.map(c => row[c.key] ?? '');
    const excelRow = sheet.addRow(rowValues);

    excelRow.eachCell((cell, colNumber) => {
      cell.font = { size: 9, name: 'Calibri', color: { argb: 'FF1E293B' } };
      cell.border = thinBorder;
      cell.alignment = { vertical: 'middle' };

      // Fondo alternado
      if (idx % 2 === 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.grisFila } };
      }
    });

    // Colorear columnas especiales por nombre de key
    columnas.forEach((c, ci) => {
      const cell = excelRow.getCell(ci + 1);
      const val = row[c.key];

      // Montos en verde
      if (c.key && (c.key.toLowerCase().includes('monto') || c.key.toLowerCase().includes('precio') || c.key.toLowerCase().includes('total'))) {
        if (val != null && val !== '') {
          cell.font = { ...cell.font, color: { argb: BRAND.verdeMoneda }, bold: true };
        }
      }
      // Lotes en ámbar
      if (c.key && c.key.toLowerCase().includes('lote')) {
        if (val != null && val !== '') {
          cell.font = { ...cell.font, color: { argb: BRAND.ambarLote }, bold: true };
        }
      }
    });

    // Colorear celdas de estado (auditoría)
    if (row.estado) {
      const estadoIdx = columnas.findIndex(c => c.key === 'estado');
      if (estadoIdx >= 0) {
        const estadoCell = excelRow.getCell(estadoIdx + 1);
        const estadoColors = {
          'COINCIDE':                { bg: BRAND.verdeFondo, font: BRAND.verdeTxt },
          'FALTANTE / NO COBRADO':   { bg: BRAND.rojoFondo, font: BRAND.rojoCrit },
          'SOBRECARGO / NO SURTIDO': { bg: BRAND.amarilloFondo, font: BRAND.amarilloTxt },
          'DIFERENCIA':              { bg: BRAND.amarilloFondo, font: BRAND.amarilloTxt },
          'EXCEDENTE':               { bg: BRAND.amarilloFondo, font: BRAND.amarilloTxt },
        };
        const ec = estadoColors[row.estado] || null;
        if (ec) {
          estadoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ec.bg } };
          estadoCell.font = { color: { argb: ec.font }, bold: true, size: 9, name: 'Calibri' };
        }
      }
    }
  });

  // ── Fila de totales ──
  if (totales) {
    const totalRow = sheet.addRow(columnas.map(c => totales[c.key] ?? ''));
    totalRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: BRAND.azulOscuro }, size: 10, name: 'Calibri' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.azulTotales } };
      cell.border = {
        top: { style: 'medium', color: { argb: BRAND.azulOscuro } },
        bottom: { style: 'medium', color: { argb: BRAND.azulOscuro } },
      };
    });
    totalRow.height = 26;
  }

  // ── Autofilter en la fila de encabezados ──
  sheet.autoFilter = {
    from: { row: headerRowNum, column: 1 },
    to:   { row: headerRowNum, column: numCols },
  };

  // ── Hoja de Información ──
  const metaSheet = workbook.addWorksheet('Información');
  const metaData = [
    ['HOSPITAL ESCANDÓN'],
    ['Plataforma BI — Reporte Generado Automáticamente'],
    [''],
    ['Reporte:', titulo],
    ['Fecha generación:', new Date().toLocaleString('es-MX')],
    ['Total registros:', filas.length],
  ];
  if (periodo) metaData.push(['Período:', periodo]);
  if (meta?.nombre) metaData.push(['Generado por:', meta.nombre]);
  if (meta?.role)   metaData.push(['Rol:', meta.role]);
  metaData.forEach(row => metaSheet.addRow(row));
  metaSheet.getRow(1).font = { bold: true, size: 14, color: { argb: BRAND.azulOscuro } };
  metaSheet.getRow(2).font = { size: 10, color: { argb: BRAND.azulClaro } };
  metaSheet.getColumn(1).width = 22;
  metaSheet.getColumn(2).width = 40;
}

async function exportJsonToExcel(res, type, id) {
  try {
    const db = getDb();
    let config = null;

    if (type === 'kpi') {
      config = await db.prepare('SELECT COALESCE(NombreCustom, NombreDefault) AS nombre, JsonApiUrl, JsonFilePath FROM KPIConfig WHERE ElementoId = ? OR CAST(KPIId AS TEXT) = ?').get(id, id);
    } else if (type === 'bi') {
      config = await db.prepare('SELECT Titulo AS nombre, JsonApiUrl, JsonFilePath FROM ConfiguracionBI WHERE ReporteId = ? OR CAST(ConfigId AS TEXT) = ?').get(id, id);
    }

    if (!config || (!config.JsonApiUrl && !config.JsonFilePath)) {
      return res.status(404).json({ error: 'Configuración JSON no encontrada para este elemento.' });
    }

    let jsonData = null;

    // 1. Obtener los datos JSON
    if (config.JsonFilePath) {
      const fullPath = path.join(__dirname, '..', config.JsonFilePath);
      if (fs.existsSync(fullPath)) {
        const raw = fs.readFileSync(fullPath, 'utf8');
        jsonData = JSON.parse(raw);
      } else {
        return res.status(404).json({ error: 'El archivo JSON configurado ya no existe.' });
      }
    } else if (config.JsonApiUrl) {
      const response = await fetch(config.JsonApiUrl);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      jsonData = await response.json();
    }

    let rows = [];
    if (Array.isArray(jsonData)) {
      rows = jsonData;
    } else if (typeof jsonData === 'object' && jsonData !== null) {
      const key = Object.keys(jsonData).find(k => Array.isArray(jsonData[k]));
      if (key) rows = jsonData[key];
      else rows = [jsonData]; // Fallback to single row
    }

    if (rows.length === 0) {
      return res.status(400).json({ error: 'El JSON no es un array válido o está vacío.' });
    }

    // 2. Generar Excel con estilo institucional
    const workbook  = new ExcelJS.Workbook();
    workbook.creator = 'Hospital Escandón — Plataforma BI';
    workbook.created = new Date();

    let sheetName = (config.nombre || 'Exportación').substring(0, 31).replace(/[/\\?*\[\]]/g, '');
    const sheet = workbook.addWorksheet(sheetName, {
      pageSetup: { paperSize: 9, orientation: 'landscape' },
    });

    const keys = Object.keys(rows[0] || {});
    const columnas = keys.map(key => ({
      header: key.toUpperCase(),
      key: key,
      width: Math.max(15, key.length + 5)
    }));

    applyInstitutionalStyle(workbook, sheet, {
      titulo: config.nombre || 'Exportación de Datos',
      columnas,
      filas: rows,
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Exportacion_${sheetName}.xlsx"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[Export JSON error]', err);
    res.status(500).json({ error: 'Error al exportar JSON a Excel.' });
  }
}

/**
 * GET /api/export/json-to-excel/:type/:id
 * Exporta un JSON (de API o archivo local) a Excel
 * :type puede ser 'kpi' o 'bi'
 */
router.get(
  '/json-to-excel/:type/:id',
  authenticate,
  authorizeCapability('exportarExcel'),
  async (req, res, next) => {
    const { type, id } = req.params;
    await exportJsonToExcel(res, type, id);
  }
);


/**
 * GET /api/export/excel/:reportId
 * Descarga Data Explorer en formato XLSX
 */
router.get(
  '/excel/:reportId',
  authenticate,
  authorizeCapability('exportarExcel'),
  async (req, res, next) => {
    try {
      const { reportId } = req.params;
      const { area, estado, fechaDesde, fechaHasta } = req.query;
      const hasFilters = Boolean(area || estado || fechaDesde || fechaHasta);

      // Si NO hay filtros seleccionados en auditoría, generar CSV con TODOS los registros sin tope (23,000+)
      if (!hasFilters && (reportId === 'auditoria-inventarios' || reportId === 'directivo-main' || reportId === 'devoluciones-farmacia')) {
        const reporte = await resolveReportData(reportId, { limit: 100000 });
        const escapeCsv = (str) => `"${String(str ?? '').replace(/"/g, '""')}"`;
        const headers = reporte.columnas.map(c => escapeCsv(c.header)).join(',');
        const rows = reporte.filas.map(row =>
          reporte.columnas.map(c => escapeCsv(row[c.key])).join(',')
        );

        const csvContent = '\uFEFF' + [headers, ...rows].join('\r\n');
        
        let filenamePrefix = 'Auditoria_Inventarios_TODOS';
        if (reportId === 'devoluciones-farmacia') {
          filenamePrefix = 'Devoluciones_Farmacia_TODAS';
        }
        const filename = `${filenamePrefix}_${Date.now()}.csv`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(csvContent);
      }

      // Ignorar ConfigJSON para reportes que tienen lógica dedicada de exportación en resolveReportData
      const customReports = ['consulta-externa', 'auditoria-inventarios', 'directivo-main', 'devoluciones-farmacia'];
      if (!customReports.includes(reportId)) {
        // Verificar si el reporte tiene un JSON asignado (override)
        const db = require('../config/db').getDb();
        const configJson = await db.prepare('SELECT JsonApiUrl, JsonFilePath FROM ConfiguracionBI WHERE ReporteId = ? OR CAST(ConfigId AS TEXT) = ?').get(reportId, reportId);
        if (configJson && (configJson.JsonApiUrl || configJson.JsonFilePath)) {
          return await exportJsonToExcel(res, 'bi', reportId);
        }

        // Verificar si el reporte corresponde a un KPI que tiene JSON asignado
        const kpiJson = await db.prepare('SELECT JsonApiUrl, JsonFilePath FROM KPIConfig WHERE ElementoId = ? OR CAST(KPIId AS TEXT) = ?').get(reportId, reportId);
        if (kpiJson && (kpiJson.JsonApiUrl || kpiJson.JsonFilePath)) {
          return await exportJsonToExcel(res, 'kpi', reportId);
        }
      }

      // Obtener datos (fuente dinámica según reportId)
      const reporte = await resolveReportData(reportId, { 
        ...req.query, 
        userRole: req.user.role, 
        userArea: req.user.area 
      });

      const workbook  = new ExcelJS.Workbook();
      workbook.creator = 'Hospital Escandón — Plataforma BI';
      workbook.created = new Date();

      const sheet = workbook.addWorksheet(reporte.titulo, {
        pageSetup: { paperSize: 9, orientation: 'landscape' },
      });

      // Construir texto de período
      const periodoFragments = [];
      if (fechaDesde) periodoFragments.push(`Desde: ${fechaDesde}`);
      if (fechaHasta) periodoFragments.push(`Hasta: ${fechaHasta}`);
      if (area)       periodoFragments.push(`Área: ${area}`);

      applyInstitutionalStyle(workbook, sheet, {
        titulo: reporte.titulo,
        resumen: reporte.resumen,
        columnas: reporte.columnas,
        filas: reporte.filas,
        totales: reporte.totales,
        meta: { nombre: req.user.nombre, role: req.user.role },
        periodo: periodoFragments.join('   |   ') || null,
      });

      // ── Respuesta HTTP ──
      const filename = `escandon_${reportId}_${Date.now()}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      await workbook.xlsx.write(res);
      res.end();
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/export/pdf/:reportId
 * Descarga Reporte Ejecutivo en formato PDF
 */
router.get(
  '/pdf/:reportId',
  authenticate,
  authorizeCapability('exportarPDF'),
  async (req, res, next) => {
    try {
      const { reportId } = req.params;
      const { area, estado, fechaDesde, fechaHasta } = req.query;
      const reporte = await resolveReportData(reportId, { area, estado, fechaDesde, fechaHasta, userRole: req.user.role, userArea: req.user.area });

      const doc      = new PDFDocument({ size: 'LETTER', margin: 50 });
      const filename = `escandon_ejecutivo_${reportId}_${Date.now()}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      doc.pipe(res);

      // ── Portada ──
      doc.rect(0, 0, doc.page.width, 100).fill('#004687');
      doc.fillColor('white')
         .font('Helvetica-Bold').fontSize(20)
         .text('HOSPITAL ESCANDÓN', 50, 30, { align: 'center' })
         .fontSize(12).font('Helvetica')
         .text('Reporte Ejecutivo — Plataforma BI v1.0', 50, 58, { align: 'center' });

      doc.moveDown(4);
      doc.fillColor('#004687').font('Helvetica-Bold').fontSize(16)
         .text(reporte.titulo, { align: 'left' });

      doc.moveDown(0.5);
      doc.fillColor('#4A5568').font('Helvetica').fontSize(10)
         .text(`Generado: ${new Date().toLocaleString('es-MX')}   |   Usuario: ${req.user.nombre} (${req.user.role})`);

      // ── Línea decorativa ──
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(562, doc.y).strokeColor('#0088C9').lineWidth(2).stroke();
      doc.moveDown(1);

      // ── Resumen KPIs ──
      if (reporte.resumen) {
        doc.fillColor('#004687').font('Helvetica-Bold').fontSize(13).text('Resumen Ejecutivo');
        doc.moveDown(0.5);
        Object.entries(reporte.resumen).forEach(([key, val]) => {
          doc.fillColor('#0D1B2A').font('Helvetica-Bold').fontSize(10).text(`${key}: `, { continued: true })
             .font('Helvetica').fillColor('#4A5568').text(String(val));
        });
        doc.moveDown(1);
      }

      // ── Tabla de datos (primeros 50 registros) ──
      if (reporte.filas.length > 0) {
        doc.fillColor('#004687').font('Helvetica-Bold').fontSize(13).text('Detalle de Registros');
        doc.moveDown(0.5);

        const cols    = reporte.columnas.slice(0, 6); // Máx 6 columnas en PDF
        const colW    = (562 - 50) / cols.length;
        const startX  = 50;
        let   y       = doc.y;

        // Header de tabla
        doc.rect(startX, y, 512, 20).fill('#004687');
        cols.forEach((col, i) => {
          doc.fillColor('white').font('Helvetica-Bold').fontSize(8)
             .text(col.header, startX + i * colW + 4, y + 6, { width: colW - 8, ellipsis: true });
        });
        y += 20;

        // Filas
        reporte.filas.slice(0, 50).forEach((row, idx) => {
          // Calcular la altura máxima necesaria para esta fila
          let rowHeight = 18;
          doc.font('Helvetica').fontSize(7.5); // Asegurar fuente para cálculo correcto
          cols.forEach((col, i) => {
            const val = String(row[col.key] ?? '');
            const h = doc.heightOfString(val, { width: colW - 8 });
            if (h + 10 > rowHeight) {
              rowHeight = h + 10;
            }
          });

          if (y + rowHeight > 680) { doc.addPage(); y = 50; }
          const bg = idx % 2 === 0 ? '#F4F6F9' : '#FFFFFF';
          doc.rect(startX, y, 512, rowHeight).fill(bg);
          cols.forEach((col, i) => {
            const val = String(row[col.key] ?? '');
            doc.fillColor('#0D1B2A').font('Helvetica').fontSize(7.5)
               .text(val, startX + i * colW + 4, y + 5, { width: colW - 8 });
          });
          y += rowHeight;
        });

        if (reporte.filas.length > 50) {
          doc.moveDown(0.5).fillColor('#8A97A8').font('Helvetica').fontSize(9)
             .text(`... y ${reporte.filas.length - 50} registros adicionales. Descargue Excel para el dataset completo.`);
        }
      }

      // ── Pie de página ──
      doc.on('pageAdded', () => {
        doc.page.margins.bottom = 30;
        doc.fillColor('#8A97A8').font('Helvetica').fontSize(8)
           .text('Hospital Escandón — Documento confidencial. Uso interno.', 50, doc.page.height - 40, { align: 'center', width: 512 });
      });

      doc.end();
    } catch (err) {
      next(err);
    }
  }
);

/* ── Resolver datos según reportId ────────────────────────── */
async function resolveReportData(reportId, filters) {
  switch (reportId) {
    case 'auditoria-inventarios':
    case 'directivo-main':
    case 'directivo': {
      const raw = await getInventariosVsCargos(filters);
      return {
        titulo:  'Auditoría — Inventarios vs. Cargos de Enfermería',
        resumen: {
          'Total Partidas':      raw.resumen?.totalPartidas,
          'Coincidencias':       raw.resumen?.coincidencias,
          'Con Diferencia':      raw.resumen?.diferencias,
          'Monto en Disputa':   `$${raw.resumen?.montoDisputa?.toLocaleString('es-MX')}`,
          '% Conciliado':       `${raw.resumen?.porcentajeConciliado}%`,
        },
        columnas: [
          { header:'# Orden',    key:'orden',       width:14 },
          { header:'Folio Atención', key:'folio',   width:16 },
          { header:'Paciente',   key:'paciente',    width:24 },
          { header:'Área',       key:'area',        width:16 },
          { header:'Categoría', key:'categoria',   width:20 },
          { header:'Código / SKU', key:'codigo',    width:14 },
          { header:'Insumo / Medicamento', key:'insumo', width:30 },
          { header:'Precio Unitario ($)', key:'precioUnitario', width:16 },
          { header:'Cant. Almacén', key:'cantAlmacen', width:14 },
          { header:'Cant. Cargo',   key:'cantCargo',   width:14 },
          { header:'Cant. Devuelta', key:'devuelto',   width:14 },
          { header:'Diferencia', key:'diferencia',  width:12 },
          { header:'Monto ($)',  key:'monto',       width:14 },
          { header:'Descuento ($)', key:'descuento', width:14 },
          { header:'Estado',     key:'estado',      width:14 },
          { header:'Estatus Devolución', key:'estatusDevolucion', width:18 },
          { header:'Fecha Devolución', key:'fechaDevolucion', width:16 },
          { header:'Médico Tratante', key:'medicoTratante', width:22 },
          { header:'Responsable Cargo', key:'enfermera', width:20 },
          { header:'Fecha Cargo', key:'fecha',       width:14 },
        ],
        filas: raw.partidas || [],
      };
    }
    case 'devoluciones-farmacia': {
      const { fechaDesde, fechaHasta } = filters;
      const raw = await getDevolucionesFarmacia(fechaDesde, fechaHasta);
      const data = raw?.data || [];
      return {
        titulo: 'Devoluciones de Farmacia',
        resumen: {
          'Total Registros': data.length,
        },
        columnas: [
          { header: 'Folio Ticket', key: 'Cuenta', width: 14 },
          { header: 'No. Requisición', key: 'Orden', width: 16 },
          { header: 'Fecha Devolución', key: 'FechaDevolucion', width: 22 },
          { header: 'Estado', key: 'EstadoLinea', width: 18 },
          { header: 'Solicita', key: 'UAbierto', width: 18 },
          { header: 'Acepta', key: 'UConfirma', width: 18 },
          { header: 'Paciente', key: 'Paciente', width: 30 },
          { header: 'Cama', key: 'Cama', width: 14 },
          { header: 'Código', key: 'Codigo', width: 14 },
          { header: 'Insumo', key: 'Insumo', width: 35 },
          { header: 'Cant. Devuelta', key: 'CantidadDevuelta', width: 15 },
          { header: 'P. Unitario ($)', key: 'PrecioUnitario', width: 15 },
          { header: 'Monto ($)', key: 'Monto', width: 15 },
        ],
        filas: data,
      };
    }
    case 'cargos-sap': {
      const { fechaDesde, fechaHasta, area, token, userRole, userArea, ...extraFilters } = filters;
      const dataRaw = await getCargosFarmaciaSAP({ fechaDesde, fechaHasta, area });
      let data = dataRaw || [];

      if (Object.keys(extraFilters).length > 0) {
        data = data.filter(row => {
          return Object.entries(extraFilters).every(([key, val]) => {
            if (!val) return true;
            return String(row[key] ?? '') == String(val);
          });
        });
      }

      return {
        titulo: 'Cargos a Pacientes (SAP)',
        resumen: {
          'Total Registros': data.length,
        },
        columnas: [
          { header: 'Folio/Orden', key: 'OrdenId', width: 14 },
          { header: 'Paciente', key: 'NombrePaciente', width: 30 },
          { header: 'Área / Cama', key: 'AreaHospitalaria', width: 20 },
          { header: 'Código', key: 'Codigo', width: 14 },
          { header: 'Insumo', key: 'Insumo', width: 35 },
          { header: 'Cantidad', key: 'CantidadCargada', width: 14 },
          { header: 'Lote', key: 'Lote', width: 15 },
          { header: 'Caducidad', key: 'Caducidad', width: 15 },
          { header: 'Total ($)', key: 'MontoCobrado', width: 15 },
          { header: 'Fecha Cargo', key: 'FechaCargo', width: 22 },
          { header: 'Médico', key: 'MedicoTratante', width: 25 },
        ],
        filas: data,
      };
    }
    case 'consulta-externa': {
      const { fechaDesde, fechaHasta, especialidad } = filters;
      const { pool } = require('../config/pg-db');
      const start = fechaDesde || new Date().toISOString().split('T')[0];
      const end = (fechaHasta || start) + ' 23:59:59';
      
      let query = `
        SELECT c.*, p.NombreCompleto as NombrePaciente, 
               c.Consultorio as ConsultorioFinal,
               dw.articulo,
               COALESCE(NULLIF(TRIM(cons.Diagnostico), ''), dw.dx_description_es) as DiagnosticoFinal,
               COALESCE(NULLIF(TRIM(c.Notas), ''), dw.comentarios) as NotasFinal,
               COALESCE(NULLIF(TRIM(p.Telefonos), ''), CONCAT_WS(' ', NULLIF(TRIM(dw.telefono_1), ''), NULLIF(TRIM(dw.celular_2), ''))) as TelefonosFinal,
               c.TipoConsulta,
               dw.edad_anios,
               dw.edad_mes,
               dw.genero,
               dw.consultas_previas,
               dw.convenio
        FROM cex_citas c
        LEFT JOIN dw_vertical_consultas_prog dw ON c.CitaOrigenId = dw.no_cita::VARCHAR
        LEFT JOIN cex_pacientes p ON c.NoExpediente = p.NoExpediente
        LEFT JOIN cex_consultas cons ON c.CitaId = cons.CitaId
        WHERE c.FechaHoraCita >= $1 AND c.FechaHoraCita <= $2
      `;
      const queryParams = [start, end];

      if (especialidad && especialidad.trim() !== '') {
        queryParams.push(especialidad);
        query += ` AND c.Especialidad = $3`;
      }
      
      query += ` ORDER BY c.FechaHoraCita ASC`;
      
      const result = await pool.query(query, queryParams);
      const data = result.rows.map(r => ({
        ...r,
        consultorio: r.consultoriofinal || r.consultorio,
        diagnostico: r.diagnosticofinal || r.diagnostico,
        notas: r.notasfinal || r.notas,
        telefonos: r.telefonosfinal || r.telefonos,
        fechahoracita: new Date(r.fechahoracita).toLocaleString('es-MX', { hour12: false }),
        edad_anios: r.edad_anios,
        edad_mes: r.edad_mes,
        genero: r.genero,
        articulo: r.articulo,
        consultas_previas: r.consultas_previas,
        convenio: r.convenio
      }));
      const isPagada = (c) => {
        const text = ((c.notas || '') + ' ' + (c.diagnostico || '')).toLowerCase();
        return text.includes('confirmad') || text.includes('pago procesado');
      };

      return {
        titulo: 'Agenda de Consulta Externa',
        resumen: {
          'Total Citas': data.length,
          'Asistencias': data.filter(c => c.estado === 'ASISTIDA').length,
          'Pagadas': data.filter(isPagada).length,
          'No Asistió': data.filter(c => c.estado === 'NO_ASISTIO').length,
          'Canceladas': data.filter(c => c.estado === 'CANCELADA').length,
        },
        columnas: [
          { header: 'Expediente', key: 'noexpediente', width: 14 },
          { header: 'Paciente', key: 'nombrepaciente', width: 35 },
          { header: 'Edad (Años)', key: 'edad_anios', width: 12 },
          { header: 'Edad (Meses)', key: 'edad_mes', width: 12 },
          { header: 'Género', key: 'genero', width: 10 },
          { header: 'Convenio', key: 'convenio', width: 25 },
          { header: 'Artículo', key: 'articulo', width: 35 },
          { header: 'Consultas Previas Ejecutadas', key: 'consultas_previas', width: 20 },
          { header: 'Fecha y Hora', key: 'fechahoracita', width: 22 },
          { header: 'Estado', key: 'estado', width: 15 },
          { header: 'S/P', key: 'tipoconsulta', width: 8 },
          { header: 'Especialidad', key: 'especialidad', width: 22 },
          { header: 'Médico', key: 'medico', width: 35 },
          { header: 'Consultorio', key: 'consultorio', width: 14 },
          { header: 'Diagnóstico', key: 'diagnostico', width: 40 },
          { header: 'Notas / Observaciones', key: 'notas', width: 50 },
          { header: 'Teléfonos', key: 'telefonos', width: 20 },
        ],
        filas: data,
      };
    }
    default:
      return {
        titulo:   reportId,
        resumen:  {},
        columnas: [{ header:'ID', key:'id', width:10 }, { header:'Valor', key:'valor', width:20 }],
        filas:    [],
      };
}
}

/**
 * POST /api/export/convert-json
 * Extrae JSON de una URL (API) y lo convierte a Excel (.xlsx)
 */
router.post(
  '/convert-json',
  authenticate,
  async (req, res, next) => {
    try {
      const { url } = req.body;
      if (!url) return res.status(400).json({ error: 'URL es requerida' });

      // Hacer fetch de la API externa
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`La API externa respondió con estado ${response.status}`);
      }
      const data = await response.json();

      // Encontrar el arreglo principal de datos
      let rows = [];
      if (Array.isArray(data)) {
        rows = data;
      } else if (typeof data === 'object') {
        // Buscar la primera propiedad que sea un arreglo
        const key = Object.keys(data).find(k => Array.isArray(data[k]));
        if (key) rows = data[key];
        else rows = [data]; // Si no hay arreglos, exportamos el objeto único
      }

      if (rows.length === 0) {
        return res.status(400).json({ error: 'El JSON devuelto por la API está vacío o no contiene una lista de datos.' });
      }

      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Hospital Escandón — Herramienta de Conversión API';
      const sheet = workbook.addWorksheet('Datos Exportados');

      // Extraer columnas únicas
      const colSet = new Set();
      rows.forEach(row => {
        if (typeof row === 'object' && row !== null) {
          Object.keys(row).forEach(k => colSet.add(k));
        }
      });
      const colArray = Array.from(colSet);

      if (colArray.length === 0) {
        sheet.columns = [{ header: 'Valor', key: 'valor', width: 30 }];
        rows.forEach(val => sheet.addRow({ valor: String(val) }));
      } else {
        // Aplanar objetos anidados
        const flatRows = rows.map(row => {
          const flatRow = {};
          colArray.forEach(k => {
            let val = row[k];
            if (typeof val === 'object' && val !== null) val = JSON.stringify(val);
            flatRow[k] = val;
          });
          return flatRow;
        });

        const columnas = colArray.map(key => ({
          header: key.toUpperCase(),
          key: key,
          width: 20
        }));

        applyInstitutionalStyle(workbook, sheet, {
          titulo: 'Extracción de Datos API',
          columnas,
          filas: flatRows,
        });
      }

      const filename = `api_extract_${Date.now()}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      await workbook.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error('Error convirtiendo JSON a Excel:', err);
      res.status(500).json({ error: 'Error conectando con la API: ' + err.message });
    }
  }
);

module.exports = router;
