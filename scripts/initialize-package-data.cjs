'use strict';
// Install baseline histories/models only when absent. Never replace server data.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function initializePackageData(root = path.resolve(__dirname, '..')) {
  root = path.resolve(root);
  const manifestPath = path.join(root, 'MANIFIESTO.json');
  if (!fs.existsSync(manifestPath)) throw new Error('Falta MANIFIESTO.json. Copia el pase completo, incluida la carpeta initial-data, a la instalación.');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.files)) throw new Error('El manifiesto del pase no es válido. Copia el pase completo nuevamente.');
  const pending = [];
  for (const entry of manifest.files.filter(file => typeof file.path === 'string' && file.path.startsWith('initial-data/'))) {
    const destination = path.resolve(root, entry.path.slice('initial-data/'.length));
    if (!destination.startsWith(path.join(root, 'backend') + path.sep)) throw new Error('Destino inicial no permitido.');
    const relativeDestination = path.relative(path.join(root, 'backend'), destination).split(path.sep).join('/');
    if (!/^(?:data\/|ml\/(?:models|reports)\/)/.test(relativeDestination)) throw new Error('Destino inicial no permitido.');
    if (fs.existsSync(destination)) continue;
    const source = path.join(root, entry.path);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error(`Falta ${entry.path}. Copia el pase completo, incluida la carpeta initial-data.`);
    const content = fs.readFileSync(source);
    if (entry.sha256 && crypto.createHash('sha256').update(content).digest('hex') !== entry.sha256) {
      throw new Error(`No coincide la referencia ${entry.path} con el manifiesto. Copia el pase completo nuevamente.`);
    }
    if (path.extname(source).toLowerCase() === '.json') {
      try { JSON.parse(content.toString('utf8').replace(/^\uFEFF/, '')); }
      catch { throw new Error(`La referencia ${entry.path} no contiene JSON válido. Copia el pase completo nuevamente.`); }
    }
    pending.push({ source, destination });
  }
  let copied = 0;
  for (const { source, destination } of pending) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    try { fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL); copied++; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  for (const directory of ['uploads/pbix', 'uploads/excel', 'uploads/thumbnails', 'uploads/json', 'ml/models', 'ml/reports', 'data']) fs.mkdirSync(path.join(root, 'backend', directory), { recursive: true });
  return copied;
}

if (require.main === module) {
  try {
    const copied = initializePackageData();
    console.log(`Datos iniciales preparados: ${copied} archivos nuevos. Los existentes se conservaron.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { initializePackageData };
