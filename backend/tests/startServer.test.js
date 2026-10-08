'use strict';

const path = require('node:path');
const { EventEmitter } = require('node:events');
const { validateVersion, resolveRuntime, startServer } = require('../scripts/start-server');

test('Windows refuses affected Node 24 releases while accepting corrected and other supported lines', () => {
  for (const version of ['v24.0.0', 'v24.14.1', 'v24.15.0']) {
    expect(() => validateVersion(version, 'win32')).toThrow('prepare-node-runtime.ps1');
  }
  for (const version of ['v20.20.0', 'v22.22.0', 'v24.16.0', 'v24.21.0']) {
    expect(validateVersion(version, 'win32')).toBe(version);
  }
  expect(validateVersion('v24.15.0', 'linux')).toBe('v24.15.0');
  expect(() => validateVersion('v18.0.0', 'win32')).toThrow('Node 20');
});

test('portable selection ignores working directory and never falls back after a broken portable', () => {
  const options = { backendDir: path.resolve('project with spaces', 'backend'), platform: 'win32',
    hostPath: 'host-node', hostVersion: 'v24.15.0', exists: () => true, probe: jest.fn(() => ({ status: 0, stdout: 'v24.21.0\n' })) };
  const runtime = resolveRuntime(options);
  expect(runtime.executable).toBe(path.resolve(options.backendDir, '..', '.runtime', 'node.exe'));
  expect(options.probe).toHaveBeenCalledWith(runtime.executable, ['--version'], expect.objectContaining({ timeout: 10000 }));
  expect(() => resolveRuntime({ ...options, probe: () => ({ error: new Error('ENOENT') }) })).toThrow('portable');
  expect(() => resolveRuntime({ ...options, probe: () => ({ status: 0, stdout: 'v24.15.0' }) })).toThrow('cierres');
  expect(() => resolveRuntime({ ...options, exists: () => false })).toThrow('cierres');
  expect(resolveRuntime({ ...options, platform: 'linux' }).executable).toBe('host-node');
});

function fixture(argv = []) {
  const parent = new EventEmitter();
  const child = new EventEmitter(); child.kill = jest.fn();
  const launch = jest.fn(() => child);
  const logger = { log: jest.fn(), error: jest.fn() };
  const backendDir = path.resolve('project with spaces', 'backend');
  startServer({ backendDir, argv, parent, launch, logger,
    runtimeOptions: { platform: 'win32', hostPath: 'corrected-node', hostVersion: 'v24.21.0', exists: () => false } });
  return { parent, child, launch, logger, backendDir };
}

test('launch preserves the backend cwd, paths with spaces and exit codes', () => {
  const { parent, child, launch, backendDir } = fixture();
  expect(launch).toHaveBeenCalledWith('corrected-node', [path.join(backendDir, 'server.js')],
    { cwd: backendDir, stdio: 'inherit', windowsHide: true });
  child.emit('exit', 7, null);
  expect(parent.exitCode).toBe(7);
  expect(parent.listenerCount('SIGTERM')).toBe(0);
});

test.each(['SIGINT', 'SIGTERM'])('propagates %s to the server and cleans up listeners', signal => {
  const { parent, child } = fixture();
  parent.emit(signal);
  expect(child.kill).toHaveBeenCalledWith(signal);
  child.emit('exit', null, signal);
  expect(parent.exitCode).toBe(signal === 'SIGINT' ? 130 : 143);
  expect(parent.listenerCount(signal)).toBe(0);
});

test('check mode does not start services; watch mode uses the corrected runtime', () => {
  expect(fixture(['--check']).launch).not.toHaveBeenCalled();
  expect(fixture(['--watch']).launch.mock.calls[0][1][0]).toBe('--watch');
  const unknown = fixture(['--unknown']);
  expect(unknown.launch).not.toHaveBeenCalled();
  expect(unknown.parent.exitCode).toBe(1);
  const failed = fixture(); failed.child.emit('error', new Error('ENOENT'));
  expect(failed.parent.exitCode).toBe(1);
});

test('Windows watch shutdown targets only the launched watcher process tree', () => {
  const watched = fixture(['--watch']);
  watched.child.pid = 12345;
  watched.parent.emit('SIGTERM');
  expect(watched.launch.mock.calls[1][1]).toEqual(['/PID', '12345', '/T', '/F']);
  expect(watched.child.kill).not.toHaveBeenCalled();
});

test('portable relaunch passes CLI flags after the script instead of watching the launcher', () => {
  const parent = new EventEmitter();
  const child = new EventEmitter(); child.kill = jest.fn();
  const launch = jest.fn(() => child);
  startServer({ backendDir: path.resolve('backend'), argv: ['--watch'], relaunch: true, parent, launch,
    logger: { log: jest.fn(), error: jest.fn() },
    runtimeOptions: { platform: 'win32', hostPath: 'corrected-node', hostVersion: 'v24.21.0', exists: () => false } });
  expect(launch.mock.calls[0][1]).toEqual([path.resolve(__dirname, '../scripts/start-server.js'), '--watch']);
});
