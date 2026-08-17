/**
 * db.js — Conexión a PostgreSQL (adaptador async compatible con la API de SQLite)
 * Hospital Escandón BI Platform v2.0
 *
 * Sustituye a better-sqlite3: expone prepare().get/all/run y exec() pero
 * devuelven Promesas. Los placeholders `?` se convierten a $1..$n automáticamente.
 */
'use strict';

const { Pool, types } = require('pg');

// INT8 (bigint) → number para que COUNT(*) etc. no lleguen como strings
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

const pool = new Pool({
  user:     process.env.PGUSER     || 'postgres',
  host:     process.env.PGHOST     || 'localhost',
  database: process.env.PGDATABASE || 'escandon_bi',
  port:     parseInt(process.env.PGPORT || '5432', 10),
  ...(process.env.PGPASSWORD ? { password: process.env.PGPASSWORD } : {}),
});

// Hora local del hospital para date()/CURRENT_DATE y defaults consistentes
pool.on('connect', (client) => {
  client.query("SET TIME ZONE 'America/Mexico_City'").catch(() => {});
});

pool.on('error', (err) => {
  console.error('❌ Error inesperado en el pool de PostgreSQL (app):', err.message);
});

let connected = false;

async function connectDB() {
  try {
    await pool.query('SELECT 1');
    connected = true;
    console.log('✅  Conectado a PostgreSQL — escandon_bi');
    return true;
  } catch (err) {
    connected = false;
    console.error('❌  Error al conectar con PostgreSQL:', err.message);
    throw err;
  }
}

/* Convierte ? → $1, $2, ... en orden de aparición */
function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/* PostgreSQL entrega columnas en minúsculas (identificadores no citados);
   el código legacy accede con el case escrito en el SQL (ej. row.PasswordHash).
   Este Proxy resuelve las claves sin distinguir mayúsculas/minúsculas. */
function rowProxy(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  const lower = new Map(Object.keys(row).map((k) => [k.toLowerCase(), k]));
  return new Proxy(row, {
    get(target, prop) {
      if (typeof prop !== 'string') return target[prop];
      if (prop in target) return target[prop];
      const real = lower.get(prop.toLowerCase());
      return real !== undefined ? target[real] : undefined;
    },
  });
}

function getDb() {
  const db = {
    pool,

    /** Consulta directa estilo node-pg ($1..$n), devuelve filas */
    async query(text, params) {
      const res = await pool.query(text, params);
      return res.rows.map(rowProxy);
    },

    /** Prepara una consulta: { get, all, run } — todos async, placeholders ? */
    prepare(sql) {
      const pgSql = toPg(sql);
      return {
        async get(...params) {
          const res = await pool.query(pgSql, params);
          return rowProxy(res.rows[0] || undefined);
        },
        async all(...params) {
          const res = await pool.query(pgSql, params);
          return res.rows.map(rowProxy);
        },
        async run(...params) {
          const res = await pool.query(pgSql, params);
          let lastInsertRowid = null;
          const row = res.rows && res.rows[0];
          if (row) {
            const keys = Object.keys(row);
            if (keys.length) lastInsertRowid = row[keys[0]];
          }
          return { changes: res.rowCount || 0, lastInsertRowid };
        },
      };
    },

    /** Ejecuta múltiples sentencias separadas por ; (DDL/seeds) */
    async exec(sql) {
      const statements = sql
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const stmt of statements) {
        await pool.query(stmt);
      }
    },
  };
  return db;
}

async function closeDB() {
  if (pool) await pool.end();
}

module.exports = { connectDB, getDb, closeDB };