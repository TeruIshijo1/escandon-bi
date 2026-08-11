require('dotenv').config();
const { connectDB } = require('./config/db');
const { runAlmacenSync } = require('./services/almacenSync.service');
const { connectRemoteDB } = require('./config/remote-db');

async function run() {
  try {
    console.log('--- Iniciando Sync Manual de Almacén General ---');
    connectDB();
    await connectRemoteDB();
    await runAlmacenSync();
    console.log('--- Sync Finalizado con Éxito ---');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

run();
