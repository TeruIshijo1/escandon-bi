'use strict';

const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

test('a lost port binding exits before connecting to PostgreSQL or initializing ETLs', async () => {
  const sockets = new Set();
  let databaseConnections = 0;
  const occupied = net.createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  const databaseTrap = net.createServer(socket => {
    databaseConnections += 1;
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.destroy();
  });
  const listen = (server, host) => new Promise(resolve => server.listen(0, host, resolve));
  // Match server.js: Windows may permit an overlapping loopback/wildcard bind.
  await listen(occupied, '0.0.0.0'); await listen(databaseTrap, '127.0.0.1');
  let child;
  try {
    const port = occupied.address().port;
    child = spawn(process.execPath, [path.resolve(__dirname, '../server.js')], {
      cwd: path.resolve(__dirname, '..'), windowsHide: true,
      env: { ...process.env, NODE_ENV: 'development', PORT: String(port),
        PGHOST: '127.0.0.1', PGPORT: String(databaseTrap.address().port),
        PGUSER: 'isolated_test', PGPASSWORD: 'isolated_test', PGDATABASE: 'isolated_test',
        SAP_BASE_URL: `https://127.0.0.1:${databaseTrap.address().port}`,
        SAP_COMPANY_DB: 'isolated_test', SAP_USERNAME: 'isolated_test', SAP_PASSWORD: 'isolated_test',
        REMOTE_DB_SERVER: '127.0.0.1', REMOTE_DB_PORT: String(databaseTrap.address().port),
        REMOTE_DB_USER: 'isolated_test', REMOTE_DB_PASS: 'isolated_test', REMOTE_DB_NAME: 'isolated_test' }
    });
    let output = '';
    child.stdout.on('data', data => output += data);
    child.stderr.on('data', data => output += data);
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill(); reject(new Error('Port conflict did not terminate the server.')); }, 10000);
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', code => { clearTimeout(timeout); resolve(code); });
    });
    expect(result).toBe(1);
    expect(output).toContain(`El puerto ${port} ya está ocupado`);
    expect(output).not.toContain('taskkill /F /IM');
    expect(databaseConnections).toBe(0);
    expect(output).not.toContain('Inicializando tablas');
  } finally {
    if (child && child.exitCode === null) child.kill();
    for (const socket of sockets) socket.destroy();
    await Promise.all([occupied, databaseTrap].map(server => new Promise(resolve => server.close(resolve))));
  }
}, 15000);
