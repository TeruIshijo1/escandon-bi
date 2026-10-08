'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const http = require('node:http');

const SERVICE_NAME = 'hospital-escandon-bi-backend';

function instanceId(backendDir) {
  const canonical = fs.realpathSync(backendDir);
  return crypto.createHash('sha256').update(process.platform === 'win32' ? canonical.toLowerCase() : canonical)
    .digest('hex').slice(0, 16);
}

function probeExistingBackend({ port, environment, installationId, timeoutMs = 2000 }) {
  if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) {
    return Promise.reject(new Error('PORT debe ser un puerto válido entre 1 y 65535.'));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (message, code = 'BACKEND_PORT_OCCUPIED') => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      const error = new Error(message); error.code = code; reject(error);
    };
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(result);
    };
    const deadline = setTimeout(() => {
      fail(`El puerto ${port} no respondió a la comprobación de salud. No se inició otro servidor.`);
      request.destroy();
    }, timeoutMs);
    const request = http.get({ host: '127.0.0.1', port, path: '/health', agent: false }, response => {
      let length = 0;
      const chunks = [];
      response.on('data', chunk => {
        length += chunk.length;
        if (length > 4096) {
          fail(`El puerto ${port} devolvió una respuesta de salud no reconocida.`);
          response.destroy(); request.destroy();
        } else chunks.push(chunk);
      });
      response.on('error', () => fail(`El puerto ${port} interrumpió la comprobación de salud.`));
      response.on('end', () => {
        if (settled) return;
        let health;
        try { health = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* Foreign response. */ }
        if (response.statusCode !== 200 || health?.service !== SERVICE_NAME || health?.installationId !== installationId) {
          fail(`El puerto ${port} está ocupado por otra aplicación o instalación. Revisa ese proceso antes de iniciar BI.`);
        } else if (health.environment !== environment) {
          fail(`El backend del puerto ${port} utiliza otro entorno. Cierra esa instancia si deseas cambiar de entorno.`);
        } else if (health.status !== 'ok' || health.db !== 'ok') {
          fail(`El backend del puerto ${port} ya está activo, pero PostgreSQL aún no está disponible. Espera a su inicialización o revisa su conexión.`,
            health.db === 'pendiente' ? 'BACKEND_STARTING' : 'BACKEND_NOT_READY');
        } else finish({ state: 'reuse', health });
      });
    });
    request.on('error', error => {
      if (error.code === 'ECONNREFUSED') finish({ state: 'free' });
      else fail(`No se pudo comprobar el puerto ${port}. No se inició otro servidor.`);
    });
  });
}

module.exports = { SERVICE_NAME, instanceId, probeExistingBackend };
