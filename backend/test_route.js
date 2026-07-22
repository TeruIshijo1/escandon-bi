const { querySiti } = require('./services/sitiService');

async function testRoute() {
  const kdxFilter = "\"CodTransCaja\" = 'LAB100'";
  const ingresosAmbulatoriosRes = await querySiti(`
    SELECT 
      EXTRACT(YEAR FROM TO_DATE(SUBSTRING("FechaTrans" FROM 1 FOR 10), 'DD/MM/YYYY')) AS "Yr",
      EXTRACT(MONTH FROM TO_DATE(SUBSTRING("FechaTrans" FROM 1 FOR 10), 'DD/MM/YYYY')) AS "Prd",
      SUM(CAST(NULLIF("MontoTotal", '') AS NUMERIC)) as "ingresos"
    FROM "KdxCajaDet"
    WHERE ${kdxFilter}
      AND "FechaTrans" != '' AND "FechaTrans" IS NOT NULL
    GROUP BY 1, 2
  `);
  console.log("Ambulatorio Res:", ingresosAmbulatoriosRes.data?.slice(0, 2));
  if (ingresosAmbulatoriosRes.error) {
    console.error("Error:", ingresosAmbulatoriosRes.error);
  }
}

testRoute();
