/**
 * add_kpi_json_columns.js — Migración: Agregar columnas JSON a KPIConfig
 * Hospital Escandón BI Platform
 * 
 * Agrega las columnas MultiPagina, JsonApiUrl, JsonFilePath a KPIConfig
 * que el código del backend ya referencia pero faltaban en la BD.
 */
'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'escandon_bi.db');
const db = new Database(DB_PATH);

const migrations = [
  { col: 'MultiPagina',  sql: 'ALTER TABLE KPIConfig ADD COLUMN MultiPagina INTEGER DEFAULT 0' },
  { col: 'JsonApiUrl',   sql: 'ALTER TABLE KPIConfig ADD COLUMN JsonApiUrl TEXT DEFAULT NULL' },
  { col: 'JsonFilePath', sql: 'ALTER TABLE KPIConfig ADD COLUMN JsonFilePath TEXT DEFAULT NULL' },
];

for (const m of migrations) {
  try {
    db.exec(m.sql);
    console.log(`✅ Columna '${m.col}' agregada a KPIConfig`);
  } catch (err) {
    if (err.message.includes('duplicate column')) {
      console.log(`⏭️  Columna '${m.col}' ya existe, omitiendo`);
    } else {
      console.error(`❌ Error agregando '${m.col}':`, err.message);
    }
  }
}

// Verificar
const cols = db.pragma('table_info(KPIConfig)').map(c => c.name);
console.log('\\n📋 Columnas finales de KPIConfig:', cols.join(', '));

db.close();
console.log('\\n✅ Migración completada');
