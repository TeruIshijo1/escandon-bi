const fs = require('fs');

const data = JSON.parse(fs.readFileSync('d:/Escritorio/escandon-bi/frontend/public/mx-all.topo.json', 'utf8'));

// The topojson usually has an objects field
const objKey = Object.keys(data.objects)[0];
const geometries = data.objects[objKey].geometries;

geometries.forEach(geo => {
  console.log(geo.properties.name, '|', geo.properties['hc-a2'], '|', geo.properties['hc-key']);
});
