/**
 * init-db.js — Inicializa la base de datos PostgreSQL
 * Ejecuta el schema y los seeds automáticamente
 * Hospital Escandón BI Platform v2.0
 *
 * Uso: node config/init-db.js
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const bcrypt = require('bcryptjs');
const fs     = require('fs');

const SQL_DIR = path.join(__dirname, '..', '..', 'database');

console.log('🏥  Hospital Escandón BI — Inicialización de Base de Datos (PostgreSQL)');

const { pool } = require('./pg-db');

const sqlFiles = [
  '01_schema.sql',
  '02_seed_roles.sql',
  '03_views_etl.sql',
  '03_data_hub.sql',
  '04_kpi_config.sql',
  '05_quality_and_interop.sql',
];

function splitStatements(sql) {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

(async () => {
  try {
    for (const file of sqlFiles) {
      const filePath = path.join(SQL_DIR, file);
      if (!fs.existsSync(filePath)) {
        console.warn(`⚠️  Archivo no encontrado: ${file}`);
        continue;
      }

      console.log(`📄  Ejecutando ${file}...`);
      const sql = fs.readFileSync(filePath, 'utf-8');

      for (const stmt of splitStatements(sql)) {
        try {
          await pool.query(stmt);
        } catch (err) {
          // Saltar errores de "ya existe" en vistas/índices
          if (err.code === '42P07' || err.code === '42710') {
            console.log(`   ↪ ya existe: ${stmt.slice(0, 60)}...`);
          } else {
            console.error(`   ❌  Error en ${file}:`, err.message);
          }
        }
      }
      console.log(`   ✅  ${file} ejecutado correctamente.`);
    }

    const seedPassword = process.env.SEED_ADMIN_PASSWORD;
    if (seedPassword) {
      if (seedPassword.length < 12) {
        throw new Error('SEED_ADMIN_PASSWORD debe tener al menos 12 caracteres.');
      }

      const seedAdmin = {
        username: process.env.SEED_ADMIN_USERNAME || 'admin',
        nombre:   process.env.SEED_ADMIN_NAME     || 'Administrador Inicial',
        email:    process.env.SEED_ADMIN_EMAIL    || 'admin@example.invalid',
      };

      const passwordHash = bcrypt.hashSync(seedPassword, 12);
      await pool.query(`
        INSERT INTO Usuarios
          (Username, NombreCompleto, Email, PasswordHash, RolId, AreaAsignada)
        SELECT $1, $2, $3, $4, RolId, NULL
        FROM Roles
        WHERE NombreRol = 'ADMIN'
        ON CONFLICT (Username) DO NOTHING
      `, [seedAdmin.username, seedAdmin.nombre, seedAdmin.email, passwordHash]);

      console.log(`👤  Administrador inicial verificado: ${seedAdmin.username}`);
    } else {
      console.warn('⚠️  No se creó un administrador inicial. Configure SEED_ADMIN_PASSWORD en backend/.env y vuelva a ejecutar db:init.');
    }

    console.log('\n✅  Base de datos inicializada correctamente.');
  } catch (err) {
    console.error('❌ Error en la inicialización:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();