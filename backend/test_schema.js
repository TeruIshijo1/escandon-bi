const { getSitiTables } = require('./config/siti-api.js');
async function run() {
  const t = await getSitiTables();
  console.log(JSON.stringify(t, null, 2));
}
run();
