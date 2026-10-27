

'use strict';

const sql = require('mssql');

const dbConfig = {
  user: process.env.REMOTE_DB_USER,
  password: process.env.REMOTE_DB_PASS,
  server: process.env.REMOTE_DB_SERVER,
  database: process.env.REMOTE_DB_NAME,
  port: parseInt(process.env.REMOTE_DB_PORT) || 1433,
  connectionTimeout: 30000,  
  requestTimeout: 90000,     
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  },
  options: {
    encrypt: false,  
    trustServerCertificate: true,  
    useUTC: false  
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

async function resetRemoteDB() {
  const pending = poolPromise;
  poolPromise = null;
  if (!pending) return;
  try {
    const pool = await pending;
    await pool.close();
    console.log('SQL Server Remoto reiniciado.');
  } catch {
    // La conexión anterior ya no es utilizable.
  }
}

module.exports = { connectRemoteDB, getRemoteDb, closeRemoteDB, resetRemoteDB, sql };
