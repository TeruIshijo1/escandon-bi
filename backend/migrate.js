const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, '..', 'database', 'escandon_bi.db');
const db = new Database(dbPath);

console.log('Iniciando migración en', dbPath);

const queries = [
  'ALTER TABLE KPIConfig ADD COLUMN JsonApiUrl TEXT NULL',
  'ALTER TABLE KPIConfig ADD COLUMN JsonFilePath TEXT NULL',
  'ALTER TABLE ConfiguracionBI ADD COLUMN JsonApiUrl TEXT NULL',
  'ALTER TABLE ConfiguracionBI ADD COLUMN JsonFilePath TEXT NULL'
];

for (const q of queries) {
  try {
    db.prepare(q).run();
    console.log('Query exitoso:', q);
  } catch (e) {
    if (e.message.includes('duplicate column name')) console.log('Columna ya existe.');
    else console.error(e);
  }
}

console.log('Migración completa.');
db.close();
