const { querySiti } = require('./config/siti-api.js');

async function run() {
  console.log('Running large query with COUNT DISTINCT...');
  const start = Date.now();
  try {
    const q = await querySiti(`
      SELECT 
        EXTRACT(YEAR FROM TO_DATE(H."FechaIng", 'DD/MM/YYYY')) AS Yr, 
        EXTRACT(MONTH FROM TO_DATE(H."FechaIng", 'DD/MM/YYYY')) AS Prd,
        SUM(CAST(L."PrecioFinal" AS FLOAT)) as ingresos,
        SUM(CAST(L."Costo" AS FLOAT)) as costos,
        COUNT(DISTINCT H."NoAno" || '-' || H."NoCtaH") as volumen
      FROM "CtaH" H
      JOIN "CtaHLn" L ON H."NoAno" = L."NoAno" AND H."NoCtaH" = L."NoCtaH"
      WHERE H."FechaIng" != '' AND H."FechaIng" IS NOT NULL
        AND EXTRACT(YEAR FROM TO_DATE(H."FechaIng", 'DD/MM/YYYY')) <= 2017
      GROUP BY 1, 2
      ORDER BY 1, 2
    `);
    console.log(`Finished in ${Date.now() - start}ms`);
    console.log(q.data ? q.data.length : q);
  } catch(e) {
    console.error(e.message);
  }
}
run();
