require('dotenv').config();
const sapService = require('./services/sap.service.js');

async function test() {
  try {
    await sapService._ensureSession();

    console.log("Fetching sq_quirofano_top_servicios definition...");
    const res = await sapService.get(`/SQLQueries('sq_quirofano_top_servicios')`);
    console.log(res.data);

    console.log("Fetching sq_quirofano_ingresos_totales definition...");
    const res2 = await sapService.get(`/SQLQueries('sq_quirofano_ingresos_totales')`);
    console.log(res2.data);

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

test();
