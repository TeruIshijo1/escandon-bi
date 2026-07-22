require('dotenv').config();
const { querySiti } = require('./config/db');

async function test() {
  try {
    const summary = await querySiti(`
      SELECT 
        COUNT(DISTINCT "MedicoTratante") as total_medicos,
        SUM(CAST(COALESCE("MontoCargos", '0') AS FLOAT)) as total_ingresos,
        SUM(CAST(COALESCE("MontoCargos", '0') AS FLOAT)) / COUNT(DISTINCT "MedicoTratante") as promedio_ingreso_medico
      FROM "CtaH"
      WHERE "MedicoTratante" != '' AND "MedicoTratante" IS NOT NULL
      AND "FechaIng" != '' AND "FechaIng" IS NOT NULL
    `);
    console.log('Summary:', summary.data);
    
    const top = await querySiti(`
      SELECT 
        COALESCE("MedicoTratante", 'No Especificado') as medico,
        COUNT(DISTINCT "NoAno" || '-' || "NoCtaH") as pacientes_ingresados,
        SUM(CAST(COALESCE("MontoCargos", '0') AS FLOAT)) as ingresos_generados
      FROM "CtaH"
      WHERE "FechaIng" != '' AND "FechaIng" IS NOT NULL
      AND "MedicoTratante" != '' AND "MedicoTratante" IS NOT NULL
      GROUP BY 1
      ORDER BY 3 DESC
      LIMIT 5
    `);
    console.log('Top:', top.data);
    process.exit(0);
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
}
test();
