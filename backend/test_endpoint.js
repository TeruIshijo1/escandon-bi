require('dotenv').config();
const express = require('express');
const sitiRoutes = require('./routes/siti.routes');

const app = express();
app.use('/siti', sitiRoutes);

const server = app.listen(0, async () => {
  try {
    const port = server.address().port;
    const res = await fetch(`http://localhost:${port}/siti/auxiliares/farmacia`);
    const json = await res.json();
    console.log('Farmacia Top 5 Estudios:', json.topEstudios?.slice(0, 5));
    
    const res2 = await fetch(`http://localhost:${port}/siti/auxiliares/urgencias`);
    const json2 = await res2.json();
    console.log('Urgencias Top 5 Estudios:', json2.topEstudios?.slice(0, 5));
  } catch (err) {
    console.error(err);
  } finally {
    server.close();
    process.exit(0);
  }
});
