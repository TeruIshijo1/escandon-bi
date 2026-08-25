'use strict';

/**
 * reorderConfig.service.js
 * Motor de "Configuración Dinámica (Farmacia)".
 * Lee el Excel de MÁXIMOS, MÍNIMOS Y PUNTOS DE REORDEN (2026) y expone la
 * calculadora de puntos de reorden basada en el consumo real histórico:
 *   CONSUMO MENSUAL = Total general / 11 meses
 *   CONSUMO DIARIO  = CONSUMO MENSUAL / 30
 *   PUNTO MIN     = ODD(CONSUMO DIARIO x 7)
 *   PUNTO REORDEN = ODD(CONSUMO DIARIO x 10.5)
 *   PUNTO MAX     = ODD(CONSUMO DIARIO x 14)
 * (misma lógica ODD() del Excel original)
 */

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { pool } = require('../config/pg-db');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'excel');
const MONTH_COUNT = 11; // meses de consumo considerados en el Excel
const DAY_MONTH = 30;

// ==== Utilidades ====

function normalizeText(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9%/.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripBrands(s) {
  return normalizeText(String(s || '').replace(/\(.*?\)/g, ' '));
}

function tokenize(s) {
  return normalizeText(s).split(' ').filter(t => t.length > 0);
}

/**
 * Réplica de la función ODD() de Excel (redondeo hacia arriba al impar más cercano).
 */
function excelOdd(x) {
  const n = Math.ceil(Math.abs(Number(x) || 0));
  const odd = n % 2 === 0 ? n + 1 : n;
  return Math.max(1, odd);
}

function computePoints(consDiario) {
  return {
    puntoMin: excelOdd(consDiario * 7),
    puntoReorden: excelOdd(consDiario * 10.5),
    puntoMax: excelOdd(consDiario * 14)
  };
}

/**
 * Similitud 0..1 entre un producto del Excel y un nombre de artículo SAP.
 * Combina solapamiento de tokens (Jaccard ponderado) con coincidencia de dosis.
 * Devuelve también el conteo de tokens alfabéticos compartidos para filtrar
 * falsos positivos que sólo coinciden en la dosis (ej. "60ML").
 */
function similarity(excelName, sapName) {
  const a = tokenize(excelName);
  const b = tokenize(sapName);
  if (a.length === 0 || b.length === 0) return { score: 0, alphaOverlap: 0 };

  const setB = new Set(b);
  let overlapWeight = 0;
  let totalWeight = 0;
  let alphaOverlap = 0;
  a.forEach(tok => {
    const isNumeric = /\d/.test(tok);
    const w = isNumeric ? 2.5 : 1; // las dosis/potencias pesan más
    totalWeight += w;
    if (setB.has(tok)) {
      overlapWeight += w;
      if (!isNumeric) alphaOverlap++;
    }
  });

  const weightedJaccard = overlapWeight / Math.max(1, totalWeight);

  // Bonificación por prefijo (nombres truncados a 30 chars en el Excel)
  const na = normalizeText(excelName);
  const nb = normalizeText(sapName);
  const prefixBonus = nb.startsWith(na) || na.startsWith(nb) ? 0.15 : 0;

  return { score: Math.min(1, weightedJaccard + prefixBonus), alphaOverlap };
}

// ==== Lectura del Excel ====

function getExcelCandidates() {
  const candidates = [];
  // 1. Variable de entorno
  if (process.env.REORDER_EXCEL_PATH) {
    candidates.push(process.env.REORDER_EXCEL_PATH);
  }
  // 2. Última versión cargada vía upload (prioridad operativa)
  try {
    const files = fs.readdirSync(UPLOAD_DIR)
      .filter(f => /\.(xlsm|xlsx)$/i.test(f) && /^reorder_config_/i.test(f))
      .map(f => ({
        name: f,
        path: path.join(UPLOAD_DIR, f),
        mtime: fs.statSync(path.join(UPLOAD_DIR, f)).mtime
      }))
      .sort((a, b) => b.mtime - a.mtime);
    if (files.length > 0) candidates.push(files[0].path);
  } catch (e) { /* carpeta aún no existe */ }
  // 3. Archivo original en la raíz del proyecto
  try {
    const rootFiles = fs.readdirSync(PROJECT_ROOT)
      .filter(f => /\.xlsm$/i.test(f) && /REORDEN/i.test(f))
      .map(f => path.join(PROJECT_ROOT, f));
    candidates.push(...rootFiles);
  } catch (e) { /* noop */ }
  return candidates;
}

function resolveExcelPath() {
  for (const p of getExcelCandidates()) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch (e) { /* noop */ }
  }
  return null;
}

function cellValue(cell) {
  if (!cell) return null;
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if (v.result !== undefined && v.result !== null) return v.result;
    if (v.richText) return v.richText.map(t => t.text).join('');
    if (v.text) return v.text;
    if (v.formula) return v.result !== undefined ? v.result : null;
    return null;
  }
  return v;
}

/**
 * Parsea el Excel de puntos de reorden y devuelve las filas calculadas.
 */
async function parseReorderExcel(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const ws = wb.getWorksheet('Puntos de Reorden (TRABAJ)') || wb.worksheets[0];
  if (!ws) throw new Error('El Excel no contiene hojas de cálculo');

  // Detectar fila de encabezados (busca "PRODUCTO" en col B y "CONSUMO DIARIO")
  let headerRow = null;
  let monthCols = [];
  for (let r = 1; r <= Math.min(15, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const bVal = String(cellValue(row.getCell(2)) || '').trim().toUpperCase();
    if (bVal === 'PRODUCTO') {
      headerRow = r;
      // Los meses están en las columnas C.. hasta "Total general"
      for (let c = 3; c <= 20; c++) {
        const h = String(cellValue(row.getCell(c)) || '').trim().toUpperCase();
        if (h.includes('TOTAL GENERAL')) break;
        if (h !== '') monthCols.push({ col: c, name: h });
      }
      break;
    }
  }
  if (!headerRow) throw new Error('No se encontró la fila de encabezados (PRODUCTO) en el Excel');

  const rows = [];
  let totalRow = null;
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const producto = String(cellValue(row.getCell(2)) || '').trim();
    if (!producto) continue;
    if (producto.toUpperCase() === 'TOTAL GENERAL') { totalRow = r; continue; }

    const total = Number(cellValue(row.getCell(14)) || 0);
    const consMensual = Number(cellValue(row.getCell(16)) || 0) || (total / MONTH_COUNT);
    const consDiario = Number(cellValue(row.getCell(17)) || 0) || (consMensual / DAY_MONTH);
    let min7 = Number(cellValue(row.getCell(20)));
    let reo105 = Number(cellValue(row.getCell(19)));
    let max14 = Number(cellValue(row.getCell(18)));
    if (!Number.isFinite(min7) || min7 <= 0) min7 = excelOdd(consDiario * 7);
    if (!Number.isFinite(reo105) || reo105 <= 0) reo105 = excelOdd(consDiario * 10.5);
    if (!Number.isFinite(max14) || max14 <= 0) max14 = excelOdd(consDiario * 14);

    // Consumo por mes (para gráfico/detalle)
    const consumoMensual = {};
    monthCols.forEach(mc => {
      consumoMensual[mc.name] = Number(cellValue(row.getCell(mc.col)) || 0);
    });

    rows.push({
      producto,
      consumoTotal: total,
      consumoMensual,
      consumoMensualPromedio: Math.round(consMensual * 100) / 100,
      consumoDiario: Math.round(consDiario * 1000) / 1000,
      puntoMin: min7,
      puntoReorden: reo105,
      puntoMax: max14
    });
  }

  const stat = fs.statSync(filePath);
  return {
    sheetName: ws.name,
    fileName: path.basename(filePath),
    filePath,
    fileModified: stat.mtime,
    months: monthCols.map(mc => mc.name),
    totalRows: rows.length,
    totalGeneralRow: totalRow || null,
    rows
  };
}

// ==== Universo SAP para matching ====

async function getSapCatalog() {
  const catalog = new Map(); // itemcode -> { itemcode, description }

  try {
    const res = await pool.query(`
      SELECT itemcode, itemdescription FROM dw_sap_reorder_settings
      WHERE itemdescription IS NOT NULL AND itemdescription <> ''
    `);
    res.rows.forEach(r => catalog.set(r.itemcode, { itemcode: r.itemcode, description: r.itemdescription }));
  } catch (e) { /* noop */ }

  try {
    const res = await pool.query(`
      SELECT itemcode AS "ItemCode", itemname AS "ItemName" FROM dw_sap_inventory_cache
      WHERE itemname IS NOT NULL AND itemname <> ''
    `);
    res.rows.forEach(r => {
      if (!catalog.has(r.ItemCode)) catalog.set(r.ItemCode, { itemcode: r.ItemCode, description: r.ItemName });
    });
  } catch (e) { /* tabla puede no existir aún */ }

  try {
    const res = await pool.query(`
      SELECT DISTINCT codigo, descripcion FROM dw_sap_kardex
      WHERE codigo NOT IN ('ENTRADA','TRASLADO') AND codigo IS NOT NULL AND codigo <> ''
        AND descripcion IS NOT NULL AND descripcion <> ''
    `);
    res.rows.forEach(r => {
      if (!catalog.has(r.codigo)) catalog.set(r.codigo, { itemcode: r.codigo, description: r.descripcion });
    });
  } catch (e) { /* noop */ }

  return Array.from(catalog.values());
}

// ==== Matching ====

async function buildMatches(rows) {
  const catalog = await getSapCatalog();
  // Cada artículo se compara contra su nombre completo Y su versión sin marcas en paréntesis
  // (el Excel mezcla nombres genéricos y marcas comerciales)
  const normalizedCatalog = catalog.map((c, idx) => {
    const normFull = normalizeText(c.description);
    const normStripped = stripBrands(c.description);
    return { ...c, idx, normFull, normStripped };
  });

  // Índice invertido token -> índices de catálogo (acelera el matching ~1000x)
  const tokenIndex = new Map();
  const indexTokens = (tokens, idx) => {
    tokens.forEach(t => {
      if (t.length < 3 && !/\d/.test(t)) return; // tokens muy cortos sin dígito no indexan
      if (!tokenIndex.has(t)) tokenIndex.set(t, new Set());
      tokenIndex.get(t).add(idx);
    });
  };
  normalizedCatalog.forEach(c => {
    indexTokens(c.normFull.split(' '), c.idx);
    indexTokens(c.normStripped.split(' '), c.idx);
  });

  // Vínculos manuales guardados por el usuario
  let manualMap = new Map();
  try {
    const res = await pool.query('SELECT producto, itemcode FROM dw_reorder_excel_map');
    manualMap = new Map(res.rows.map(r => [r.producto, r.itemcode]));
  } catch (e) { /* tabla puede no existir aún */ }

  return rows.map(row => {
    let itemcode = null;
    let matchScore = 0;
    let matchType = null;

    if (manualMap.has(row.producto)) {
      itemcode = manualMap.get(row.producto);
      matchType = 'MANUAL';
      matchScore = 1;
    } else {
      // Candidatos que comparten al menos un token con el producto del Excel
      const candidateSet = new Set();
      tokenize(row.producto).forEach(t => {
        const hits = tokenIndex.get(t);
        if (hits) hits.forEach(idx => candidateSet.add(idx));
      });

      let best = null;
      for (const idx of candidateSet) {
        const cand = normalizedCatalog[idx];
        const full = similarity(row.producto, cand.normFull);
        const stripped = similarity(row.producto, cand.normStripped);
        const bestVar = stripped.score > full.score ? stripped : full;
        // Exigir al menos 1 token alfabético compartido (evita matches sólo por dosis "60ML")
        const viable = (bestVar.score >= 0.85 && bestVar.alphaOverlap >= 1) ||
                       (bestVar.score >= 0.6 && bestVar.alphaOverlap >= 2);
        if (!viable) continue;
        if (!best || bestVar.score > best.score) best = { itemcode: cand.itemcode, score: bestVar.score };
      }
      if (best) {
        itemcode = best.itemcode;
        matchScore = Math.round(best.score * 100) / 100;
        matchType = best.score >= 0.85 ? 'AUTO_ALTA' : 'AUTO_MEDIA';
      }
    }

    return { ...row, itemcode, matchScore, matchType };
  });
}

// ==== Persistencia / Aplicación ====

async function saveManualLinks(links) {
  for (const l of links) {
    if (!l.producto) continue;
    await pool.query(`
      INSERT INTO dw_reorder_excel_map (producto, itemcode, updated_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (producto) DO UPDATE SET itemcode = EXCLUDED.itemcode, updated_at = CURRENT_TIMESTAMP
    `, [String(l.producto).trim(), l.itemcode ? String(l.itemcode).trim() : null]);
  }
  invalidateCache();
}

/**
 * Aplica los puntos calculados a la matriz dw_sap_reorder_settings.
 * @param {Array} matchedRows filas con itemcode resuelto
 * @param {Object} opts { onlyLinked: boolean } aplica sólo filas con itemcode
 */
async function applyToSettings(matchedRows, opts = {}) {
  let applied = 0;
  const errors = [];
  for (const row of matchedRows) {
    if (!row.itemcode) {
      if (opts.onlyLinked !== false) continue;
    }
    const code = row.itemcode;
    if (!code) continue;
    try {
      const descRes = await pool.query('SELECT itemdescription FROM dw_sap_reorder_settings WHERE itemcode = $1', [code]);
      const desc = descRes.rows[0]?.itemdescription || row.producto;
      await pool.query(`
        INSERT INTO dw_sap_reorder_settings (itemcode, itemdescription, minstock, maxstock, note, customsolicitud, lastupdated)
        VALUES ($1, $2, $3, $4, '', NULL, CURRENT_TIMESTAMP)
        ON CONFLICT (itemcode) DO UPDATE SET
          minstock = EXCLUDED.minstock,
          maxstock = EXCLUDED.maxstock,
          lastupdated = CURRENT_TIMESTAMP
      `, [code, desc, Number(row.puntoMin) || 0, Number(row.puntoMax) || 0]);
      applied++;
    } catch (e) {
      errors.push({ itemcode: code, error: e.message });
    }
  }
  invalidateCache();
  return { applied, errors };
}

// ==== Cache en memoria ====
let configCache = null;
let configCacheTime = null;
const CONFIG_CACHE_TTL = 10 * 60 * 1000; // 10 minutos

function invalidateCache() {
  configCache = null;
  configCacheTime = null;
}

/**
 * Orquestador: obtiene la configuración dinámica completa para el frontend.
 */
async function getDynamicConfig(force = false) {
  if (!force && configCache && configCacheTime && (Date.now() - configCacheTime) < CONFIG_CACHE_TTL) {
    return configCache;
  }

  const excelPath = resolveExcelPath();
  if (!excelPath) {
    return {
      ok: true,
      available: false,
      message: 'No se encontró el Excel de MÁXIMOS, MÍNIMOS Y PUNTOS DE REORDEN. Cárguelo desde la pestaña.',
      months: [],
      rows: [],
      stats: { total: 0, linked: 0, autoHigh: 0, autoMedium: 0, unmatched: 0 }
    };
  }

  const parsed = await parseReorderExcel(excelPath);
  const matched = await buildMatches(parsed.rows);

  // Estado actual de la matriz para los códigos vinculados
  const settingsRes = await pool.query(`
    SELECT itemcode AS "ItemCode", minstock AS "MinStock", maxstock AS "MaxStock", lastupdated AS "LastUpdated"
    FROM dw_sap_reorder_settings
  `);
  const settingsMap = new Map(settingsRes.rows.map(r => [r.ItemCode, r]));

  const rows = matched.map(m => {
    const setting = m.itemcode ? settingsMap.get(m.itemcode) : null;
    const inSync = setting && Number(setting.MinStock) === Number(m.puntoMin) && Number(setting.MaxStock) === Number(m.puntoMax);
    return {
      ...m,
      appliedMin: setting ? Number(setting.MinStock) : null,
      appliedMax: setting ? Number(setting.MaxStock) : null,
      inSync: !!inSync
    };
  });

  const stats = {
    total: rows.length,
    linked: rows.filter(r => r.matchType === 'MANUAL').length,
    autoHigh: rows.filter(r => r.matchType === 'AUTO_ALTA').length,
    autoMedium: rows.filter(r => r.matchType === 'AUTO_MEDIA').length,
    unmatched: rows.filter(r => !r.itemcode).length,
    inSync: rows.filter(r => r.inSync).length
  };

  const result = {
    ok: true,
    available: true,
    fileName: parsed.fileName,
    sheetName: parsed.sheetName,
    fileModified: parsed.fileModified,
    months: parsed.months,
    stats,
    rows
  };

  configCache = result;
  configCacheTime = Date.now();
  return result;
}

/**
 * Busca artículos SAP por código o descripción (para vinculación manual).
 */
async function searchSapCatalog(query, limit = 20) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const catalog = await getSapCatalog();
  const nq = normalizeText(q);
  const results = [];
  for (const c of catalog) {
    const norm = normalizeText(c.description);
    const code = String(c.itemcode || '').toUpperCase();
    if (code.includes(nq) || norm.includes(nq)) {
      results.push(c);
      if (results.length >= limit) break;
    }
  }
  return results;
}

async function initTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dw_reorder_excel_map (
      producto VARCHAR(255) PRIMARY KEY,
      itemcode VARCHAR(100),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `).catch(() => {});
}

initTables().catch(() => {});

module.exports = {
  parseReorderExcel,
  resolveExcelPath,
  getDynamicConfig,
  buildMatches,
  saveManualLinks,
  applyToSettings,
  invalidateCache,
  searchSapCatalog,
  computePoints,
  excelOdd,
  similarity
};
