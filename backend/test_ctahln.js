require('dotenv').config();
const { querySiti } = require('./config/siti-api.js');

async function testAll() {
  try {
    const res = await querySiti(`SELECT * FROM "CtaHLn" LIMIT 1`);
    console.log(Object.keys(res.data[0]));
  } catch(e) { console.error(e); }
}
testAll();
