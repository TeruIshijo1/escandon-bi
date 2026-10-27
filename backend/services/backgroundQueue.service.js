'use strict';

const sapService = require('./sap.service');

let tail = Promise.resolve();
const pending = new Map();

function runExclusive(work) {
  if (typeof work !== 'function') throw new TypeError('La tarea de sincronización no es válida.');
  const run = tail.then(() => typeof sapService.runWithPriority === 'function'
    ? sapService.runWithPriority('low', work)
    : work());
  tail = run.catch(() => {});
  return run;
}

function enqueue(name, work, { delayMs = 0 } = {}) {
  if (typeof name !== 'string' || !name.trim()) throw new TypeError('La sincronización necesita un nombre.');
  if (pending.has(name)) return pending.get(name);
  const wait = Number.isFinite(delayMs) && delayMs > 0 ? delayMs : 0;
  const promise = (async () => {
    if (wait) await new Promise(resolve => { const timer = setTimeout(resolve, wait); timer.unref?.(); });
    return runExclusive(work);
  })().finally(() => { if (pending.get(name) === promise) pending.delete(name); });
  pending.set(name, promise);
  return promise;
}

function isPending(name) {
  return pending.has(name);
}

module.exports = { enqueue, isPending, runExclusive };
