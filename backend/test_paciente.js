const { querySiti } = require('./config/siti-api.js');

async function run() {
  try {
    const res = await querySiti(`SELECT * FROM "Paciente" LIMIT 1`);
    console.log(res.data[0]);
  } catch(e) {
    console.error(e.message);
  }
}
run();
