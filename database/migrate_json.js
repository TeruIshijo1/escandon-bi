const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, 'escandon_bi.db');
const db = new Database(dbPath);

console.log('Iniciando migración en', dbPath);

try {
  db.prepare('ALTER TABLE KPIConfig ADD COLUMN JsonApiUrl TEXT NULL').run();
  console.log('Columna JsonApiUrl agregada a KPIConfig');
} catch (e) {
  if (e.message.includes('duplicate column name')) console.log('JsonApiUrl ya existe en KPIConfig');
  else console.error(e);
}

try {
  db.prepare('ALTER TABLE KPIConfig ADD COLUMN JsonFilePath TEXT NULL').run();
  console.log('Columna JsonFilePath agregada a KPIConfig');
} catch (e) {
  if (e.message.includes('duplicate column name')) console.log('JsonFilePath ya existe en KPIConfig');
  else console.error(e);
}

try {
  db.prepare('ALTER TABLE ConfiguracionBI ADD COLUMN JsonApiUrl TEXT NULL').run();
  console.log('Columna JsonApiUrl agregada a ConfiguracionBI');
} catch (e) {
  if (e.message.includes('duplicate column name')) console.log('JsonApiUrl ya existe en ConfiguracionBI');
  else console.error(e);
}

try {
  db.prepare('ALTER TABLE ConfiguracionBI ADD COLUMN JsonFilePath TEXT NULL').run();
  console.log('Columna JsonFilePath agregada a ConfiguracionBI');
} catch (e) {
  if (e.message.includes('duplicate column name')) console.log('JsonFilePath ya existe en ConfiguracionBI');
  else console.error(e);
}

console.log('Migración completa.');
db.close();
