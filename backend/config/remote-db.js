/**
 * remote-db.js — Conexión a SQL Server Remoto (KH_HE)
 * Utiliza mssql para crear un pool de conexiones optimizado.
 */
'use strict';

const sql = require('mssql');

const dbConfig = {
  user: process.env.REMOTE_DB_USER,
  password: process.env.REMOTE_DB_PASS,
  server: process.env.REMOTE_DB_SERVER,
  database: process.env.REMOTE_DB_NAME,
  port: parseInt(process.env.REMOTE_DB_PORT) || 1433,
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  },
  options: {
    encrypt: false, // Desactivado para EC2 sin certificado SSL oficial configurado
    trustServerCertificate: true // Confiar en el certificado autofirmado si existiera
  }
};

let poolPromise = null;

function connectRemoteDB() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(dbConfig)
      .connect()
      .then(pool => {
        console.log(`✅  Conectado a SQL Server Remoto — ${dbConfig.server} [${dbConfig.database}]`);
        return pool;
      })
      .catch(err => {
        console.error('❌  Error al conectar con SQL Server Remoto:', err.message);
        poolPromise = null;
        throw err;
      });
  }
  return poolPromise;
}

/**
 * Retorna el pool activo o lanza un error si no se ha inicializado.
 */
async function getRemoteDb() {
  if (!poolPromise) {
    throw new Error('Pool de base de datos remota no inicializado. Llame a connectRemoteDB() primero.');
  }
  return await poolPromise;
}

function closeRemoteDB() {
  if (poolPromise) {
    poolPromise.then(pool => {
      pool.close();
      poolPromise = null;
      console.log('SQL Server Remoto desconectado.');
    });
  }
}

module.exports = { connectRemoteDB, getRemoteDb, closeRemoteDB, sql };
