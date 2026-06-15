/**
 * add_multipagina_migration.js — Migración para añadir columna MultiPagina a tableros BI
 */
'use strict';

const path = require('path');
// Cargar dotenv desde el backend para resolver dependencias si es necesario
require('dotenv').config({ path: path.join(__dirname, '../backend/.env') });

const { connectDB, getDb } = require('../backend/config/db');

connectDB();
const db = getDb();

try {
  // Alter KPIConfig
  try {
    db.prepare('ALTER TABLE KPIConfig ADD COLUMN MultiPagina INTEGER DEFAULT 0').run();
    console.log('✅ Columna MultiPagina agregada a KPIConfig');
  } catch (e) {
    console.log('ℹ️ MultiPagina en KPIConfig ya existe o no se pudo agregar:', e.message);
  }

  // Alter ConfiguracionBI
  try {
    db.prepare('ALTER TABLE ConfiguracionBI ADD COLUMN MultiPagina INTEGER DEFAULT 0').run();
    console.log('✅ Columna MultiPagina agregada a ConfiguracionBI');
  } catch (e) {
    console.log('ℹ️ MultiPagina en ConfiguracionBI ya existe o no se pudo agregar:', e.message);
  }

  console.log('🎉 Migración de columna MultiPagina completada.');
} catch (err) {
  console.error('❌ Error general durante la migración:', err);
} finally {
  process.exit(0);
}
