'use strict';
// Install baseline histories/models only when absent. Never replace server data.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'MANIFIESTO.json'), 'utf8'));
let copied = 0;
for (const entry of manifest.files.filter(file => file.path.startsWith('initial-data/'))) {
  const destination = path.resolve(root, entry.path.slice('initial-data/'.length));
  if (!destination.startsWith(path.join(root, 'backend') + path.sep)) throw new Error('Destino inicial no permitido.');
  if (fs.existsSync(destination)) continue;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(root, entry.path), destination, fs.constants.COPYFILE_EXCL);
  copied++;
}
for (const directory of ['uploads/pbix', 'uploads/excel', 'uploads/thumbnails', 'uploads/json', 'ml/models', 'ml/reports', 'data']) fs.mkdirSync(path.join(root, 'backend', directory), { recursive: true });
console.log(`Datos iniciales preparados: ${copied} archivos nuevos. Los existentes se conservaron.`);
