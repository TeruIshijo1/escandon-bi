'use strict';

require('dotenv').config();
const { syncCexFromDW } = require('../services/cexSync.service');
const { pool } = require('../config/pg-db');

async function migrateCex() {
  console.log('🚀 Iniciando migración inicial de Consulta Externa (CEX)...');
  
  try {
    const { upsertsCitas, insertadosPacientes } = await syncCexFromDW();
    
    console.log(`✅ Migración completada exitosamente.`);
    console.log(`   ➜ Pacientes insertados: ${insertadosPacientes}`);
    console.log(`   ➜ Citas migradas: ${upsertsCitas}`);
    
  } catch (error) {
    console.error('❌ Error en la migración de CEX:', error);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

migrateCex();
