require('dotenv').config();
const { querySiti } = require('./config/siti-api.js');

async function testAll() {
  try {
    const endoRes = await querySiti(`
      SELECT EXTRACT(MONTH FROM TO_DATE(H."FechaIng", 'DD/MM/YYYY')) AS "Prd", COUNT(DISTINCT H."NoAno" || '-' || H."NoCtaH") as "volumen"
      FROM "CtaHLn" L JOIN "CtaH" H ON L."NoAno" = H."NoAno" AND L."NoCtaH" = H."NoCtaH"
      LEFT JOIN "Producto" P ON L."NoProd" = P."NoProd"
      WHERE (P."Descripcion" ILIKE '%ENDOSCOP%' OR P."Descripcion" ILIKE '%COLONOSCOP%' OR P."Descripcion" ILIKE '%BRONCOSCOP%')
        AND EXTRACT(YEAR FROM TO_DATE(H."FechaIng", 'DD/MM/YYYY')) = 2016 AND H."Estatus" != 'C' GROUP BY 1 ORDER BY 1
    `);

    const consultasRes = await querySiti(`
      SELECT EXTRACT(MONTH FROM TO_DATE(H."FechaIng", 'DD/MM/YYYY')) AS "Prd", COUNT(L."NoLinea") as "volumen"
      FROM "CtaHLn" L JOIN "CtaH" H ON L."NoAno" = H."NoAno" AND L."NoCtaH" = H."NoCtaH"
      LEFT JOIN "Producto" P ON L."NoProd" = P."NoProd"
      WHERE (P."CodTipo" = 'CONESP' OR P."CodTipo" ILIKE '%CONS%') 
        AND EXTRACT(YEAR FROM TO_DATE(H."FechaIng", 'DD/MM/YYYY')) = 2016 AND H."Estatus" != 'C' GROUP BY 1 ORDER BY 1
    `);

    const imagenRes = await querySiti(`
      SELECT EXTRACT(MONTH FROM TO_DATE(H."FechaIng", 'DD/MM/YYYY')) AS "Prd", COUNT(L."NoLinea") as "volumen"
      FROM "CtaHLn" L JOIN "CtaH" H ON L."NoAno" = H."NoAno" AND L."NoCtaH" = H."NoCtaH"
      LEFT JOIN "Producto" P ON L."NoProd" = P."NoProd"
      WHERE (P."CodTipo" = 'ESTIMA' OR L."CodAlm" ILIKE '%IMA%' OR L."CodAlm" ILIKE '%RAYO%')
        AND EXTRACT(YEAR FROM TO_DATE(H."FechaIng", 'DD/MM/YYYY')) = 2016 AND H."Estatus" != 'C' GROUP BY 1 ORDER BY 1
    `);
    
    console.log("=== Endoscopia UCAMB ===", endoRes.data);
    console.log("=== Consultas Especialidad ===", consultasRes.data);
    console.log("=== Imagenologia ===", imagenRes.data);

  } catch(e) { console.error(e); }
}
testAll();
