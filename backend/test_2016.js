require('dotenv').config();
const { querySiti } = require('./config/siti-api');

async function check2016() {
  const typeFilter = "(P.\\\"CodTipo\\\" = 'ESTIMA' OR L.\\\"CodAlm\\\" ILIKE '%IMA%' OR L.\\\"CodAlm\\\" ILIKE '%RAYO%')";
  
  // Try CtaHLn (Hospital / Mostrador)
  const ctaH = await querySiti(`
          SELECT 
            EXTRACT(YEAR FROM TO_DATE(SUBSTRING("FechaTrans" FROM 1 FOR 10), 'DD/MM/YYYY')) AS Yr,
            EXTRACT(MONTH FROM TO_DATE(SUBSTRING("FechaTrans" FROM 1 FOR 10), 'DD/MM/YYYY')) AS Prd,
            SUM(CAST(NULLIF("MontoTotal", '') AS NUMERIC)) as ingresos,
            COUNT(*) as volumen
          FROM "KdxCajaDet"
          WHERE ("NumCta" LIKE 'IMA%' OR "NumCta" LIKE 'RAYO%')
            AND "FechaTrans" LIKE '%/2018%'
          GROUP BY 1, 2
          ORDER BY 1, 2
  `);
  
  if (ctaH.error) console.error("CtaH Error:", ctaH.error);
  console.log("KdxCajaDet (2018):", ctaH.data);
  
  // Try OsMedEst just in case
  const osMed = await querySiti(`
    SELECT 
        EXTRACT(YEAR FROM TO_DATE(SUBSTRING(o."FechaCita" FROM 1 FOR 10), 'DD/MM/YYYY')) AS Yr,
        EXTRACT(MONTH FROM TO_DATE(SUBSTRING(o."FechaCita" FROM 1 FOR 10), 'DD/MM/YYYY')) AS Prd,
        SUM(NULLIF(l."Qty", '')::numeric) AS volumen,
        SUM(SPLIT_PART(p."Precio", ';', 1)::numeric * NULLIF(l."Qty", '')::numeric) AS ingresos
    FROM "OsMedEst" o
    JOIN "EstuMed" e ON o."CodEstudio" = e."CodEstudio"
    JOIN "EstuMedLn" el ON e."CodEstudio" = el."CodEstudio" AND el."NoLinea" = '1'
    JOIN "ProdAlmPrecio" p ON el."NoProd" = p."NoProd"
    JOIN "OsMedLn" l ON o."NoOsMed" = l."NoOsMed" AND o."NoLinea" = l."NoLinea"
    JOIN "OsMed" om ON o."NoOsMed" = om."NoOsMed"
    WHERE e."CodEstudio" LIKE 'IMA%'
      AND om."Pagado" != 'N'
      AND o."FechaCita" LIKE '%/2016%'
    GROUP BY 1, 2
    ORDER BY 1, 2
  `);
  console.log("OsMedEst (2016):", osMed.data);

}

check2016();
