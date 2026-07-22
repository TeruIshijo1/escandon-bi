const { querySiti } = require('./config/siti-api');

async function testDemografia() {
  try {
    const res = await querySiti(`
        SELECT 
          "DomCodEstado" as estado,
          COUNT(*) as cantidad
        FROM "Paciente"
        WHERE "DomCodEstado" IS NOT NULL AND "DomCodEstado" != ''
        GROUP BY "DomCodEstado"
        ORDER BY cantidad DESC
        LIMIT 10
    `);
    console.log(res.data);
  } catch (e) {
    console.error(e);
  }
}

testDemografia();
