const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'database', 'escandon_bi.db');
const schemaPath = path.join(__dirname, '..', 'database', '03_data_hub.sql');

try {
    const db = new Database(dbPath);
    const schema = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schema);
    console.log('✅ Esquema Data Hub aplicado con éxito.');
    db.close();
} catch (err) {
    console.error('❌ Error al aplicar el esquema:', err.message);
    process.exit(1);
}
