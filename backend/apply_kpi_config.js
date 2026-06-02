/**
 * apply_kpi_config.js — Aplica la migración KPIConfig a la BD existente
 * Hospital Escandón BI Platform v4.0
 * Ejecutar: node backend/apply_kpi_config.js
 */
'use strict';

const path     = require('path');
const fs       = require('fs');
const Database = require('better-sqlite3');

const DB_PATH  = path.join(__dirname, '..', 'database', 'escandon_bi.db');
const SQL_PATH = path.join(__dirname, '..', 'database', '04_kpi_config.sql');

if (!fs.existsSync(DB_PATH)) {
  console.error('❌ No se encontró la base de datos en:', DB_PATH);
  process.exit(1);
}

const db  = new Database(DB_PATH);
const sql = fs.readFileSync(SQL_PATH, 'utf8');

try {
  // better-sqlite3 soporta exec() para múltiples sentencias SQL
  db.exec(sql);
  const total = db.prepare('SELECT COUNT(*) AS n FROM KPIConfig').get();
  console.log('✅ Migración aplicada correctamente:');
  console.log(`   → Tabla KPIConfig creada/verificada`);
  console.log(`   → Total de KPIs en catálogo: ${total.n}`);
} catch (err) {
  console.error('❌ Error en migración:', err.message);
  process.exit(1);
} finally {
  db.close();
}
