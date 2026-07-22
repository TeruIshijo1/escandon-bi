const { connectDB, getDb } = require('./config/db');

async function checkSchema() {
  await connectDB();
  const db = getDb();
  
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all();
  console.log("Tables in local SQLite DB:");
  console.log(tables.map(t => t.name).join(', '));
  
  if (tables.find(t => t.name === 'Pacientes')) {
    const columns = db.prepare(`PRAGMA table_info(Pacientes)`).all();
    console.log("\nColumns for Pacientes:");
    console.log(columns.map(c => c.name).join(', '));
  }
}

checkSchema().catch(console.error);
