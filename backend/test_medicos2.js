require('dotenv').config();
const { querySiti } = require('./config/siti-api.js');

async function testAll() {
  try {
    const medicosCuentas = await querySiti(`
      SELECT 
        COALESCE(M."Nombre" || ' ' || M."ApePat" || ' ' || M."ApeMat", H."MedicoTratante") as "medico",
        COUNT(H."NoCtaH") as "volumen",
        SUM(CAST(H."MontoCargos" AS FLOAT)) as "ingresos"
      FROM "CtaH" H
      LEFT JOIN "Medico" M ON TRIM(H."MedicoTratante") = TRIM(M."CodMedico")
      WHERE H."MedicoTratante" != '' 
        AND EXTRACT(YEAR FROM TO_DATE(H."FechaIng", 'DD/MM/YYYY')) = 2026
        AND H."Estatus" != 'C'
      GROUP BY M."Nombre", M."ApePat", M."ApeMat", H."MedicoTratante"
      ORDER BY 3 DESC
      LIMIT 10
    `);

    console.log("=== Top Medicos por Cuentas 2026 ===", medicosCuentas);
  } catch(e) { console.error(e); }
}
testAll();
