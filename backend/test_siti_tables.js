const { querySiti } = require('./config/siti-api.js');

async function test() {
  const tables = await querySiti(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
  `);
  console.log('Tables:', tables.data?.map(t => t.table_name).join(', '));
}
test();
