require('dotenv').config();
const { querySiti } = require('./config/siti-api.js');

async function testAll() {
  try {
    const imagen2017 = await querySiti(`
      SELECT EXTRACT(MONTH FROM TO_DATE(H."FechaIng", 'DD/MM/YYYY')) AS "Prd", COUNT(L."NoLinea") as "volumen"
      FROM "CtaHLn" L JOIN "CtaH" H ON L."NoAno" = H."NoAno" AND L."NoCtaH" = H."NoCtaH"
      LEFT JOIN "Producto" P ON L."NoProd" = P."NoProd"
      WHERE (P."CodTipo" = 'ESTIMA' OR L."CodAlm" ILIKE '%IMA%' OR L."CodAlm" ILIKE '%RAYO%')
        AND EXTRACT(YEAR FROM TO_DATE(H."FechaIng", 'DD/MM/YYYY')) = 2017 AND H."Estatus" != 'C' GROUP BY 1 ORDER BY 1
    `);
    console.log("=== Imagenologia 2017 (Lineas) ===", imagen2017.data);
  } catch(e) { console.error(e); }
}
testAll();
