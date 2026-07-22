require('dotenv').config();
const { querySiti } = require('./config/siti-api.js');

async function testAll() {
  try {
    const medicosRes = await querySiti(`
      SELECT 
        COALESCE(M."Nombre" || ' ' || M."ApePat" || ' ' || M."ApeMat", H."CodMedico") as "medico",
        COUNT(H."Secuencia") as "volumen",
        SUM(CAST(H."MtoHm" AS FLOAT)) as "honorarios"
      FROM "HonMed" H
      LEFT JOIN "Medico" M ON TRIM(H."CodMedico") = TRIM(M."CodMedico")
      WHERE H."CodMedico" != ''
      GROUP BY M."Nombre", M."ApePat", M."ApeMat", H."CodMedico"
      ORDER BY 3 DESC
      LIMIT 10
    `);

    console.log("=== Top Medicos (All time) ===", medicosRes.data);

    const medicos2026 = await querySiti(`
      SELECT 
        COALESCE(M."Nombre" || ' ' || M."ApePat" || ' ' || M."ApeMat", H."CodMedico") as "medico",
        COUNT(H."Secuencia") as "volumen",
        SUM(CAST(H."MtoHm" AS FLOAT)) as "honorarios"
      FROM "HonMed" H
      LEFT JOIN "Medico" M ON TRIM(H."CodMedico") = TRIM(M."CodMedico")
      WHERE H."CodMedico" != '' AND H."FechaReg" LIKE '%2026%'
      GROUP BY M."Nombre", M."ApePat", M."ApeMat", H."CodMedico"
      ORDER BY 3 DESC
      LIMIT 10
    `);
    
    console.log("=== Top Medicos 2026 ===", medicos2026.data);
  } catch(e) { console.error(e); }
}
testAll();
