/**
 * export.routes.js — Exportación de reportes PDF y Excel
 * Hospital Escandón BI Platform v1.0
 */
'use strict';

const express = require('express');
const router  = express.Router();
const PDFDocument = require('pdfkit');
const ExcelJS     = require('exceljs');
const { authenticate, authorize, authorizeCapability } = require('../middleware/auth.middleware');
const { getInventariosVsCargos } = require('../services/etl.service');


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

      // Obtener datos (fuente dinámica según reportId)
      const reporte = await resolveReportData(reportId, { area, estado, fechaDesde, fechaHasta, userRole: req.user.role, userArea: req.user.area });

      const workbook  = new ExcelJS.Workbook();
      workbook.creator = 'Hospital Escandón — Plataforma BI';
      workbook.created = new Date();

      const sheet = workbook.addWorksheet(reporte.titulo, {
        pageSetup: { paperSize: 9, orientation: 'landscape' },
      });

      // ── Estilo de encabezado ──
      const headerFill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: 'FF004687' }, // Azul Fuerte
      };
      const headerFont = { color: { argb: 'FFFFFFFF' }, bold: true, size: 11, name: 'Calibri' };

      // ── Columnas ──
      sheet.columns = reporte.columnas.map(c => ({
        header:  c.header,
        key:     c.key,
        width:   c.width || 18,
      }));

      // Aplicar estilo a encabezados
      sheet.getRow(1).eachCell(cell => {
        cell.fill = headerFill;
        cell.font = headerFont;
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
          bottom: { style: 'thin', color: { argb: 'FF0088C9' } },
        };
      });
      sheet.getRow(1).height = 28;

      // ── Datos ──
      reporte.filas.forEach((row, idx) => {
        const excelRow = sheet.addRow(row);
        // Alternar fondo
        if (idx % 2 === 0) {
          excelRow.eachCell(cell => {
            cell.fill = { type:'pattern', pattern:'solid', fgColor: { argb: 'FFF4F6F9' } };
          });
        }
        // Colorear celdas de estado
        if (row.estado) {
          const estadoCell = excelRow.getCell('estado');
          const colors = {
            COINCIDE:   { bg: 'FFD1FAE5', font: 'FF065F46' },
            DIFERENCIA: { bg: 'FFFEF3C7', font: 'FF92400E' },
            FALTANTE:   { bg: 'FFFEE2E2', font: 'FF991B1B' },
            EXCEDENTE:  { bg: 'FFFEF3C7', font: 'FF92400E' },
          };
          const c = colors[row.estado];
          if (c) {
            estadoCell.fill = { type:'pattern', pattern:'solid', fgColor: { argb: c.bg } };
            estadoCell.font = { color: { argb: c.font }, bold: true };
          }
        }
      });

      // ── Fila de totales ──
      if (reporte.totales) {
        const totalRow = sheet.addRow(reporte.totales);
        totalRow.eachCell(cell => {
          cell.font = { bold: true, color: { argb: 'FF004687' } };
          cell.fill = { type:'pattern', pattern:'solid', fgColor: { argb: 'FFE0EAF4' } };
        });
      }

      // ── Autofilter ──
      sheet.autoFilter = { from: 'A1', to: { row: 1, column: reporte.columnas.length } };

      // ── Metadatos en hoja separada ──
      const metaSheet = workbook.addWorksheet('Información del Reporte');
      [
        ['Hospital Escandón — Plataforma BI v1.0'],
        [''],
        ['Reporte:',       reporte.titulo],
        ['Generado por:',  req.user.nombre],
        ['Rol:',           req.user.role],
        ['Fecha:',         new Date().toLocaleString('es-MX')],
        ['Total registros:', reporte.filas.length],
      ].forEach(row => metaSheet.addRow(row));

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
      const reporte = await resolveReportData(reportId, { userRole: req.user.role, userArea: req.user.area });

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
          if (y > 680) { doc.addPage(); y = 50; }
          const bg = idx % 2 === 0 ? '#F4F6F9' : '#FFFFFF';
          doc.rect(startX, y, 512, 18).fill(bg);
          cols.forEach((col, i) => {
            const val = String(row[col.key] ?? '');
            doc.fillColor('#0D1B2A').font('Helvetica').fontSize(7.5)
               .text(val, startX + i * colW + 4, y + 5, { width: colW - 8, ellipsis: true });
          });
          y += 18;
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
          { header:'Paciente',   key:'paciente',    width:24 },
          { header:'Área',       key:'area',        width:16 },
          { header:'Insumo',     key:'insumo',      width:28 },
          { header:'Cant. Almacén', key:'cantAlmacen', width:14 },
          { header:'Cant. Cargo',   key:'cantCargo',   width:14 },
          { header:'Diferencia', key:'diferencia',  width:12 },
          { header:'Monto ($)',  key:'monto',       width:14 },
          { header:'Estado',     key:'estado',      width:14 },
          { header:'Enfermera',  key:'enfermera',   width:20 },
          { header:'Fecha',      key:'fecha',       width:14 },
        ],
        filas: raw.partidas || [],
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
        sheet.columns = colArray.map(key => ({
          header: key.toUpperCase(),
          key: key,
          width: 20
        }));

        sheet.getRow(1).eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF004687' } };
          cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
        });

        rows.forEach(row => {
          const flatRow = {};
          colArray.forEach(k => {
            let val = row[k];
            if (typeof val === 'object' && val !== null) val = JSON.stringify(val);
            flatRow[k] = val;
          });
          sheet.addRow(flatRow);
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
