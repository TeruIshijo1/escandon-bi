/**
 * add_pages_migration.js — Migración para añadir soporte de múltiples páginas a tableros BI
 */
'use strict';

const { connectDB, getDb } = require('../backend/config/db');

connectDB();
const db = getDb();

try {
  // Alter KPIConfig
  try {
    db.prepare('ALTER TABLE KPIConfig ADD COLUMN PBIUrl2 TEXT NULL').run();
    console.log('✅ Columna PBIUrl2 agregada a KPIConfig');
  } catch (e) {
    console.log('ℹ️ PBIUrl2 en KPIConfig ya existe o no se pudo agregar:', e.message);
  }

  try {
    db.prepare('ALTER TABLE KPIConfig ADD COLUMN PBIUrl3 TEXT NULL').run();
    console.log('✅ Columna PBIUrl3 agregada a KPIConfig');
  } catch (e) {
    console.log('ℹ️ PBIUrl3 en KPIConfig ya existe o no se pudo agregar:', e.message);
  }

  // Alter ConfiguracionBI
  try {
    db.prepare('ALTER TABLE ConfiguracionBI ADD COLUMN LookerDashboard2 TEXT NULL').run();
    console.log('✅ Columna LookerDashboard2 agregada a ConfiguracionBI');
  } catch (e) {
    console.log('ℹ️ LookerDashboard2 en ConfiguracionBI ya existe o no se pudo agregar:', e.message);
  }

  try {
    db.prepare('ALTER TABLE ConfiguracionBI ADD COLUMN LookerDashboard3 TEXT NULL').run();
    console.log('✅ Columna LookerDashboard3 agregada a ConfiguracionBI');
  } catch (e) {
    console.log('ℹ️ LookerDashboard3 en ConfiguracionBI ya existe o no se pudo agregar:', e.message);
  }

  console.log('🎉 Migración de múltiples páginas completada con éxito.');
} catch (err) {
  console.error('❌ Error general durante la migración:', err);
} finally {
  process.exit(0);
}
