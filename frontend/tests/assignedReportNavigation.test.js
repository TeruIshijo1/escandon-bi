import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canUseAssignedReportNavigation, requestAssignedReportAccess, REPORT_WORKSPACE_PATH } from '../src/utils/assignedReportAccess.js';
// Vite carga el JSON sin atributos; sustituir únicamente esa importación hace
// ejecutable en Node el mismo RBAC que utiliza la aplicación.
const permissionCatalog = JSON.parse(readFileSync(new URL('../src/utils/reportQueryPermissions.json', import.meta.url), 'utf8'));
const rbacSource = readFileSync(new URL('../src/utils/rbac.js', import.meta.url), 'utf8')
  .replace("import REPORT_QUERY_PERMISSIONS from './reportQueryPermissions.json';", `const REPORT_QUERY_PERMISSIONS = ${JSON.stringify(permissionCatalog)};`);
const { hasPermission, hasSapModulePermission } = await import(`data:text/javascript;base64,${Buffer.from(rbacSource).toString('base64')}`);

const recipient = { id: 102, username: 'DESTINATARIO_FICTICIO', role: 'USUARIO_OPERATIVO', permisos: [] };

test('a verified assignment opens only its report workspace without granting any general permission', () => {
  assert.equal(canUseAssignedReportNavigation(recipient, REPORT_WORKSPACE_PATH, true), true);
  for (const path of ['/admin/usuarios', '/dashboard/finanzas', '/mi-area/consultas-service-layer/other', '/']) {
    assert.equal(canUseAssignedReportNavigation(recipient, path, true), false);
  }
  assert.equal(hasPermission(recipient, REPORT_WORKSPACE_PATH), false);
  assert.equal(hasSapModulePermission(recipient, 'customers'), false);
  assert.equal(hasSapModulePermission(recipient, 'inventory'), false);
  assert.deepEqual(recipient.permisos, []);
});

test('revocation, pending/invalid availability and logged-out users fail closed', () => {
  for (const value of [false, undefined, null, 'true', 1]) {
    assert.equal(canUseAssignedReportNavigation(recipient, REPORT_WORKSPACE_PATH, value), false);
  }
  assert.equal(canUseAssignedReportNavigation(null, REPORT_WORKSPACE_PATH, true), false);
});

test('availability is freshly read with the current token and never stored as a permission', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ ok: true, hasAssignedReports: true }) };
  };
  try {
    assert.equal(await requestAssignedReportAccess('/api', 'TOKEN_FICTICIO'), true);
    assert.equal(calls[0].url, '/api/sap-query/saved/access');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer TOKEN_FICTICIO');
    assert.equal(calls[0].options.cache, 'no-store');
    assert.equal(await requestAssignedReportAccess('/api', null), false);
    assert.equal(calls.length, 1);
    globalThis.fetch = async () => ({ ok: false });
    assert.equal(await requestAssignedReportAccess('/api', 'EXPIRED_TOKEN'), false);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, hasAssignedReports: 'true' }) });
    assert.equal(await requestAssignedReportAccess('/api', 'TOKEN_FICTICIO'), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('a stalled request and caller cancellation return false within the access budget', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
    const rejectAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    if (signal.aborted) rejectAbort();
    else signal.addEventListener('abort', rejectAbort, { once: true });
  });
  try {
    assert.equal(await requestAssignedReportAccess('/api', 'TOKEN_FICTICIO', undefined, 15), false);
    const controller = new AbortController();
    const pending = requestAssignedReportAccess('/api', 'TOKEN_FICTICIO', controller.signal);
    controller.abort();
    assert.equal(await pending, false);
  } finally { globalThis.fetch = originalFetch; }
});
