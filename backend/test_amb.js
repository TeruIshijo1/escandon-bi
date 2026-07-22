const { Client } = require('pg');
const c = new Client('postgresql://postgres:postgres@localhost:5432/siti');

async function test() {
  await c.connect();
  const res = await c.query(`
    SELECT 
        EXTRACT(YEAR FROM TO_DATE(SUBSTRING(o."FechaCita" FROM 1 FOR 10), 'DD/MM/YYYY')) AS Yr,
        EXTRACT(MONTH FROM TO_DATE(SUBSTRING(o."FechaCita" FROM 1 FOR 10), 'DD/MM/YYYY')) AS Prd,
        SUM(NULLIF(l."Qty", '')::numeric) as cantidad,
        SUM(NULLIF(l."MontoLinea", '')::numeric) as mtoventas,
        SUM(SPLIT_PART(p."Precio", ';', 1)::numeric * NULLIF(l."Qty", '')::numeric) as mtototal
    FROM "OsMedEst" o
    JOIN "EstuMed" e ON o."CodEstudio" = e."CodEstudio"
    JOIN "EstuMedLn" el ON e."CodEstudio" = el."CodEstudio" AND el."NoLinea" = '1'
    JOIN "ProdAlmPrecio" p ON el."NoProd" = p."NoProd"
    JOIN "OsMedLn" l ON o."NoOsMed" = l."NoOsMed" AND o."NoLinea" = l."NoLinea"
    JOIN "OsMed" om ON o."NoOsMed" = om."NoOsMed"
    WHERE e."CodEstudio" LIKE 'IMA%'
      AND om."Pagado" != 'N'
      AND o."FechaCita" LIKE '%/2020%'
    GROUP BY 1, 2
    ORDER BY 1, 2
  `);
  console.log(res.rows);
  await c.end();
}
test();
