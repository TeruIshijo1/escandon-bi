require('dotenv').config();
const { querySiti } = require('./config/siti-api.js');

async function testAll() {
  try {
    const cirugiasDistinct = await querySiti(`
      SELECT EXTRACT(MONTH FROM TO_DATE(H."FechaIng", 'DD/MM/YYYY')) AS "Prd", COUNT(DISTINCT H."NoAno" || '-' || H."NoCtaH") as "volumen"
      FROM "CtaHLn" L JOIN "CtaH" H ON L."NoAno" = H."NoAno" AND L."NoCtaH" = H."NoCtaH"
      JOIN "Producto" P ON L."NoProd" = P."NoProd"
      WHERE P."CodTipo" LIKE 'CX%'
        AND EXTRACT(YEAR FROM TO_DATE(H."FechaIng", 'DD/MM/YYYY')) = 2016 AND H."Estatus" != 'C' GROUP BY 1 ORDER BY 1
    `);

    const cirugiasLineas = await querySiti(`
      SELECT EXTRACT(MONTH FROM TO_DATE(H."FechaIng", 'DD/MM/YYYY')) AS "Prd", COUNT(L."NoLinea") as "volumen"
      FROM "CtaHLn" L JOIN "CtaH" H ON L."NoAno" = H."NoAno" AND L."NoCtaH" = H."NoCtaH"
      JOIN "Producto" P ON L."NoProd" = P."NoProd"
      WHERE P."CodTipo" LIKE 'CX%'
        AND EXTRACT(YEAR FROM TO_DATE(H."FechaIng", 'DD/MM/YYYY')) = 2016 AND H."Estatus" != 'C' GROUP BY 1 ORDER BY 1
    `);

    console.log("=== Cirugias (Distinct Cuentas) ===", cirugiasDistinct.data);
    console.log("=== Cirugias (Lineas) ===", cirugiasLineas.data);

    const laboratoriosLineas = await querySiti(`
      SELECT EXTRACT(MONTH FROM TO_DATE(H."FechaIng", 'DD/MM/YYYY')) AS "Prd", COUNT(L."NoLinea") as "volumen"
      FROM "CtaHLn" L JOIN "CtaH" H ON L."NoAno" = H."NoAno" AND L."NoCtaH" = H."NoCtaH"
      LEFT JOIN "Producto" P ON L."NoProd" = P."NoProd"
      WHERE (P."CodTipo" = 'ESTLAB' OR L."CodAlm" ILIKE '%LAB%')
        AND EXTRACT(YEAR FROM TO_DATE(H."FechaIng", 'DD/MM/YYYY')) = 2017 AND H."Estatus" != 'C' GROUP BY 1 ORDER BY 1
    `);

    console.log("=== Laboratorios 2017 (Lineas) ===", laboratoriosLineas.data);

  } catch(e) { console.error(e); }
}
testAll();
