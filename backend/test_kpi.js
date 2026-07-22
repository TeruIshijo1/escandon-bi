require('dotenv').config();
const { querySiti } = require('./config/db'); // assuming querySiti is exported from here or similar. 

// Actually, I'll just write a raw SQLite script to check escandon_siti.db
const Database = require('better-sqlite3');
const db = new Database('../database/escandon_siti.db');

const rows = db.prepare(`
    SELECT 
        COALESCE("MedicoTratante", 'No Especificado') as medico,
        COUNT(DISTINCT "NoAno" || '-' || "NoCtaH") as pacientes_ingresados,
        SUM(CAST(COALESCE("MontoCargos", '0') AS FLOAT)) as ingresos_generados
    FROM "CtaH"
    WHERE "FechaIng" != '' AND "FechaIng" IS NOT NULL
    AND "MedicoTratante" != '' AND "MedicoTratante" IS NOT NULL
    GROUP BY 1
    ORDER BY 3 DESC
    LIMIT 20
`).all();

const summary = db.prepare(`
    SELECT 
        COUNT(DISTINCT "MedicoTratante") as total_medicos,
        SUM(CAST(COALESCE("MontoCargos", '0') AS FLOAT)) as total_ingresos,
        SUM(CAST(COALESCE("MontoCargos", '0') AS FLOAT)) / COUNT(DISTINCT "MedicoTratante") as promedio_ingreso_medico
    FROM "CtaH"
    WHERE "MedicoTratante" != '' AND "MedicoTratante" IS NOT NULL
    AND "FechaIng" != '' AND "FechaIng" IS NOT NULL
`).get();

console.log("Summary:", summary);
console.log("Top 5:", rows.slice(0, 5));
