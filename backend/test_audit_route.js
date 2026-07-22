const request = require('supertest');
const app = require('./server'); // Asumiendo que exportas 'app'

async function run() {
  try {
    console.log('Testing /api/audit/inventarios-vs-cargos ...');
    const res = await request(app).get('/api/audit/inventarios-vs-cargos');
    console.log('Status:', res.statusCode);
    if (res.error) console.error(res.error.text);
    else console.log(res.body);
  } catch (err) {
    console.error('Test error:', err.message);
  } finally {
    process.exit(0);
  }
}

run();
