const { querySiti } = require('./config/siti-api.js');

async function run() {
  console.log('Running pacientes query...');
  const start = Date.now();
  try {
    const q = await querySiti(`
      SELECT 
        EXTRACT(YEAR FROM TO_DATE("FechaRegistro", 'DD/MM/YYYY')) AS "Yr", 
        EXTRACT(MONTH FROM TO_DATE("FechaRegistro", 'DD/MM/YYYY')) AS "Prd",
        "Sexo",
        COUNT(*) as conteo
      FROM "Paciente"
      WHERE "FechaRegistro" != '' AND "FechaRegistro" IS NOT NULL
      GROUP BY 1, 2, 3
      ORDER BY 1, 2
    `);
    console.log(`Finished in ${Date.now() - start}ms`);
    console.log(q.data ? q.data.length : q);
  } catch(e) {
    console.error(e.message);
  }
}
run();
