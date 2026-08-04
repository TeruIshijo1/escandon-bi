const { Pool } = require('pg');

// Configuración del Pool de PostgreSQL para el Data Warehouse
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'escandon_bi',
  port: 5432,
  // Agrega password: 'tu_password' si es necesario en producción
});

pool.on('error', (err) => {
  console.error('❌ Error inesperado en el pool de PostgreSQL:', err);
});

async function initPostgresDW() {
  try {
    console.log('⏳ Inicializando tablas del Data Warehouse en PostgreSQL...');
    
    // Tabla para Ingresos (ORCT)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sap_incoming_payments (
        DocEntry INT PRIMARY KEY,
        DocNum INT NOT NULL,
        DocDate DATE NOT NULL,
        CardCode VARCHAR(50),
        CardName VARCHAR(255),
        CashSum DECIMAL(18,2) DEFAULT 0,
        CreditSum DECIMAL(18,2) DEFAULT 0,
        CheckSum DECIMAL(18,2) DEFAULT 0,
        TrsfrSum DECIMAL(18,2) DEFAULT 0,
        DocTotal DECIMAL(18,2) DEFAULT 0,
        U_NumCta VARCHAR(50),
        CounterReference VARCHAR(50),
        Canceled VARCHAR(1) DEFAULT 'N',
        SyncDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Tabla para Egresos (OPCH)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sap_purchase_invoices (
        DocEntry INT PRIMARY KEY,
        DocNum INT NOT NULL,
        DocDate DATE NOT NULL,
        CardCode VARCHAR(50),
        CardName VARCHAR(255),
        DocTotal DECIMAL(18,2) DEFAULT 0,
        Canceled VARCHAR(1) DEFAULT 'N',
        SyncDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Índices para optimizar las consultas de fechas
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sap_in_date ON sap_incoming_payments (DocDate);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sap_out_date ON sap_purchase_invoices (DocDate);`);

    console.log('✅ Data Warehouse en PostgreSQL inicializado correctamente.');
  } catch (err) {
    console.error('❌ Error al inicializar PostgreSQL:', err.message);
  }
}

module.exports = {
  pool,
  initPostgresDW
};
