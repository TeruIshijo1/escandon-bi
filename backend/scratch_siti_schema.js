const { querySiti } = require('./config/siti-api');

async function checkSiti() {
  try {
    const res = await querySiti(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'Paciente'
    `);
    console.log("SITI Paciente Columns:");
    console.log(res.data.map(c => c.column_name).join(', '));
  } catch (e) {
    console.error(e);
  }
}

checkSiti().catch(console.error);
