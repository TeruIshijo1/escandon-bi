/**
 * init-db.js — Inicializa la base de datos SQLite
 * Ejecuta el schema y los seeds automáticamente
 * Hospital Escandón BI Platform v1.0
 *
 * Uso: node init-db.js
 */
'use strict';

const path     = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const bcrypt   = require('bcryptjs');
const Database = require('better-sqlite3');
const fs       = require('fs');

const DB_PATH     = process.env.DB_PATH || path.join(__dirname, '..', '..', 'database', 'escandon_bi.db');
const DB_DIR      = path.dirname(DB_PATH);
const SQL_DIR     = path.join(__dirname, '..', '..', 'database');

// Crear directorio si no existe
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

console.log('🏥  Hospital Escandón BI — Inicialización de Base de Datos');
console.log(`📁  Ruta de BD: ${DB_PATH}\n`);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const sqlFiles = [
  '01_schema.sql',
  '02_seed_roles.sql',
  '03_views_etl.sql',
  '03_data_hub.sql',
  '04_kpi_config.sql',
  '05_quality_and_interop.sql',
];

for (const file of sqlFiles) {
  const filePath = path.join(SQL_DIR, file);
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  Archivo no encontrado: ${file}`);
    continue;
  }

  console.log(`📄  Ejecutando ${file}...`);
  const sql = fs.readFileSync(filePath, 'utf-8');

  try {
    db.exec(sql);
    console.log(`   ✅  ${file} ejecutado correctamente.`);
  } catch (err) {
    console.error(`   ❌  Error en ${file}:`, err.message);
  }
}

const seedPassword = process.env.SEED_ADMIN_PASSWORD;
if (seedPassword) {
  if (seedPassword.length < 12) {
    db.close();
    throw new Error('SEED_ADMIN_PASSWORD debe tener al menos 12 caracteres.');
  }

  const seedAdmin = {
    username: process.env.SEED_ADMIN_USERNAME || 'admin',
    nombre:   process.env.SEED_ADMIN_NAME     || 'Administrador Inicial',
    email:    process.env.SEED_ADMIN_EMAIL    || 'admin@example.invalid',
  };

  const passwordHash = bcrypt.hashSync(seedPassword, 12);
  db.prepare(`
    INSERT OR IGNORE INTO Usuarios
      (Username, NombreCompleto, Email, PasswordHash, RolId, AreaAsignada)
    SELECT ?, ?, ?, ?, RolId, NULL
    FROM Roles
    WHERE NombreRol = 'ADMIN'
  `).run(seedAdmin.username, seedAdmin.nombre, seedAdmin.email, passwordHash);

  console.log(`👤  Administrador inicial verificado: ${seedAdmin.username}`);
} else {
  console.warn('⚠️  No se creó un administrador inicial. Configure SEED_ADMIN_PASSWORD en backend/.env y vuelva a ejecutar db:init.');
}

db.close();
console.log('\n✅  Base de datos inicializada correctamente.');
