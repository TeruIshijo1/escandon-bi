require('dotenv').config();
const { querySiti } = require('./config/siti-api');

async function test() {
  const r = await querySiti(`
    SELECT "FechaTrans", "CodCaja", "NoRecibo", "CodTransCaja", "MontoTotal", "MontoPago"
    FROM "KdxCajaDet"
    WHERE "NoRecibo" = '7'
      AND "FechaTrans" ILIKE '01/01/2020%'
    ORDER BY "CodCaja", "NoRecibo"
  `);
  console.log("Ticket details:", r.data);
}
test();
