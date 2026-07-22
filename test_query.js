require('dotenv').config({ path: './backend/.env' });
const { querySiti } = require('./backend/config/siti-api.js');

async function run() {
  try {
    const query = `
      SELECT 
        EXTRACT(MONTH FROM TO_DATE(H."FechaIng", 'DD/MM/YYYY')) AS "Mes",
        COUNT(DISTINCT H."NoAno" || '-' || H."NoCtaH") as "Volumen",
        COUNT(*) as "LineasTotales"
      FROM "CtaHLn" L
      JOIN "CtaH" H ON L."NoAno" = H."NoAno" AND L."NoCtaH" = H."NoCtaH"
      WHERE L."NoProd" = 'USOQX1HR'
        AND EXTRACT(YEAR FROM TO_DATE(H."FechaIng", 'DD/MM/YYYY')) = 2016
      GROUP BY 1 ORDER BY 1
    `;
    const res = await querySiti(query);
    console.log(JSON.stringify(res, null, 2));
  } catch(e){ 
    console.error(e); 
  }
}
run();
