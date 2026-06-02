/**
 * db.js — Conexión a SQLite con better-sqlite3
 * Hospital Escandón BI Platform v1.0
 */
'use strict';

const Database = require('better-sqlite3');
const path     = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'database', 'escandon_bi.db');

let db = null;

function connectDB() {
  try {
    db = new Database(DB_PATH);

    // Habilitar WAL para mejor rendimiento concurrente
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');

    console.log('✅  Conectado a SQLite —', DB_PATH);
    return db;
  } catch (err) {
    console.error('❌  Error al conectar con SQLite:', err.message);
    throw err;
  }
}

function getDb() {
  if (!db) throw new Error('Base de datos no inicializada. Llame a connectDB() primero.');
  return db;
}

function closeDB() {
  if (db) { db.close(); db = null; }
}

module.exports = { connectDB, getDb, closeDB };
