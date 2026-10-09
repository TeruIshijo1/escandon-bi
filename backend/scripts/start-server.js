'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

function validateVersion(version, platform) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(version).trim());
  if (!match || Number(match[1]) < 20) throw new Error('El backend requiere Node 20 o superior.');
  if (platform === 'win32' && Number(match[1]) === 24 && Number(match[2]) < 16) {
    throw new Error('Node 24.0–24.15 tiene reportes de cierres nativos en Windows. Ejecuta desde la raíz: powershell -ExecutionPolicy Bypass -File scripts/prepare-node-runtime.ps1');
  }
  return String(version).trim();
}

function resolveRuntime({ backendDir, platform = process.platform, hostPath = process.execPath,
  hostVersion = process.version, exists = fs.existsSync, probe = spawnSync }) {
  const portable = path.resolve(backendDir, '..', '.runtime', 'node.exe');
  if (platform !== 'win32' || !exists(portable)) {
    return { executable: hostPath, version: validateVersion(hostVersion, platform) };
  }
  const result = probe(portable, ['--version'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  if (result.error || result.status !== 0) {
    throw new Error('No se pudo ejecutar el Node portable. Vuelve a ejecutar scripts/prepare-node-runtime.ps1.');
  }
  return { executable: portable, version: validateVersion(result.stdout, platform) };
}

function startServer({ backendDir = path.resolve(__dirname, '..'), argv = process.argv.slice(2),
  runtimeOptions = {}, launch = spawn, parent = process, logger = console, relaunch = false } = {}) {
  if (argv.some(argument => !['--watch', '--check'].includes(argument))) {
    logger.error('[Backend] Opciones permitidas: --watch, --check.');
    parent.exitCode = 1;
    return null;
  }
  let runtime;
  try { runtime = resolveRuntime({ ...runtimeOptions, backendDir }); }
  catch (error) { logger.error('[Backend] ' + error.message); parent.exitCode = 1; return null; }
  if (!relaunch) logger.log('[Backend] Runtime: ' + runtime.version + ' (' + runtime.executable + ')');
  if (argv.includes('--check')) return null;
  const args = relaunch ? [__filename, ...argv]
    : [...(argv.includes('--watch') ? ['--watch'] : []), path.join(backendDir, 'server.js')];
  const child = launch(runtime.executable, args, { cwd: backendDir, stdio: 'inherit', windowsHide: true });
  let stoppingSignal;
  const stopChild = signal => {
    stoppingSignal = signal;
    if (argv.includes('--watch') && (runtimeOptions.platform || process.platform) === 'win32' && child.pid) {
      // Windows kill() terminates the watcher without notifying its server child.
      // Stop only the process tree created by this launcher.
      const taskkill = path.join(parent.env?.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
      const stopper = launch(taskkill, ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      stopper.once('error', error => { logger.error('[Backend] No se pudo detener el watcher: ' + error.message); child.kill(signal); });
    } else child.kill(signal);
  };
  const onInterrupt = () => stopChild('SIGINT');
  const onTerminate = () => stopChild('SIGTERM');
  parent.on('SIGINT', onInterrupt);
  parent.on('SIGTERM', onTerminate);
  const cleanup = () => {
    parent.removeListener('SIGINT', onInterrupt);
    parent.removeListener('SIGTERM', onTerminate);
  };
  child.once('error', error => {
    cleanup();
    logger.error('[Backend] No se pudo iniciar el servidor: ' + error.message);
    parent.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    cleanup();
    const interrupted = stoppingSignal || signal;
    parent.exitCode = code === 0 ? 0 : interrupted === 'SIGINT' ? 130 : interrupted === 'SIGTERM' ? 143 : (code ?? 1);
    if (code && !stoppingSignal) logger.error('[Backend] El servidor terminó con código ' + code + '.');
  });
  return child;
}

function prepareProductionData({ backendDir, environment, logger = console }) {
  if (environment !== 'production') return;
  const requiredFiles = ['excel_stats_history.json', 'statistics_manual_controls.json'];
  const missing = requiredFiles.filter(file => !fs.existsSync(path.join(backendDir, 'data', file)));
  if (!missing.length) return;
  const root = path.resolve(backendDir, '..');
  const initializer = path.join(root, 'scripts', 'initialize-package-data.cjs');
  if (!fs.existsSync(initializer)) throw new Error('Falta el preparador de referencias. Copia el pase completo, incluidas las carpetas scripts e initial-data.');
  const copied = require('../../scripts/initialize-package-data.cjs').initializePackageData(root);
  const remaining = requiredFiles.filter(file => !fs.existsSync(path.join(backendDir, 'data', file)));
  if (remaining.length) throw new Error(`Faltan las referencias ${remaining.join(', ')}. Copia el pase completo y ejecuta instalar.bat.`);
  logger.log(`[Backend] Referencias iniciales preparadas: ${copied} archivos nuevos. Los existentes se conservaron.`);
}

async function runCli() {
  const backendDir = path.resolve(__dirname, '..');
  const argv = process.argv.slice(2);
  if (argv.includes('--check') || argv.some(argument => !['--watch'].includes(argument))) {
    return startServer({ backendDir, argv });
  }
  try {
    const runtime = resolveRuntime({ backendDir });
    // Do not open sockets in a host runtime affected by the Windows native crash.
    if (fs.realpathSync(runtime.executable) !== fs.realpathSync(process.execPath)) {
      return startServer({ backendDir, argv, relaunch: true });
    }
    require('dotenv').config({ path: path.join(backendDir, '.env') });
    const { instanceId, probeExistingBackend } = require('../utils/backendInstance');
    const port = process.env.PORT || 4000;
    const environment = process.env.NODE_ENV || 'development';
    const installationId = instanceId(backendDir);
    const deadline = Date.now() + 5000;
    let existing;
    while (true) {
      try { existing = await probeExistingBackend({ port, environment, installationId }); break; }
      catch (error) {
        if (error.code !== 'BACKEND_STARTING' || Date.now() >= deadline) throw error;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
    if (existing.state === 'reuse') {
      if (argv.includes('--watch')) {
        throw new Error(`El backend ya está activo en el puerto ${port}. Cierra su instancia antes de iniciar la recarga automática.`);
      }
      console.log(`[Backend] Ya está activo y disponible en http://localhost:${port}. Se utilizará esa instancia.`);
      return null;
    }
    prepareProductionData({ backendDir, environment });
    return startServer({ backendDir, argv });
  } catch (error) {
    console.error('[Backend] ' + error.message);
    process.exitCode = 1;
    return null;
  }
}

if (require.main === module) runCli();
module.exports = { validateVersion, resolveRuntime, startServer, prepareProductionData, runCli };
