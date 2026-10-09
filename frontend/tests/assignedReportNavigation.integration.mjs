import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '../tmp/assigned-report-navigation');
await fs.mkdir(output, { recursive: true });
const server = await createServer({ configFile: false, root, cacheDir: path.join(output, 'vite-cache'), appType: 'custom',
  plugins: [react(), { name: 'assigned-navigation-preview', configureServer(server) {
    server.middlewares.use('/__assigned_navigation', async (_req, res) => {
      const html = await server.transformIndexHtml('/__assigned_navigation', `<!doctype html><html lang="es"><body><div id="root"></div><script type="module">
        import React from 'react'; import { createRoot } from 'react-dom/client';
        import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
        import { AuthProvider, useAuth } from '/src/context/AuthContext.jsx';
        import ProtectedRoute from '/src/components/layout/ProtectedRoute.jsx';
        import Sidebar from '/src/components/layout/Sidebar.jsx';
        import { hasSapModulePermission } from '/src/utils/rbac.js';
        function Harness() {
          const auth=useAuth(); const navigate=useNavigate();
          return React.createElement(React.Fragment,null,
            React.createElement('div',{'data-testid':'identity'},auth.user?.username||'Sin sesión'),
            React.createElement('div',{'data-testid':'permissions'},JSON.stringify(auth.user?.permisos||[])),
            React.createElement('div',{'data-testid':'source-grant'},String(hasSapModulePermission(auth.user,'customers'))),
            React.createElement('div',{'data-testid':'assignment'},String(auth.hasAssignedReports)),
            React.createElement('button',{onClick:()=>auth.refreshAssignedReportAccess()},'Actualizar acceso'),
            React.createElement('button',{onClick:auth.logout},'Salir de prueba'),
            React.createElement('button',{onClick:()=>auth.login('OTRO_FICTICIO','CONTRASEÑA_FICTICIA')},'Entrar como otro'),
            React.createElement('button',{onClick:()=>navigate('/mi-area/consultas-service-layer')},'Abrir reportes de prueba'),
            React.createElement(Sidebar),
            React.createElement(Routes,null,
              React.createElement(Route,{path:'/mi-area/consultas-service-layer',element:React.createElement(ProtectedRoute,{allowedRoles:['USUARIO_OPERATIVO']},React.createElement('div',{'data-testid':'report'},'Reporte visible'))}),
              React.createElement(Route,{path:'/sin-acceso',element:React.createElement('div',{'data-testid':'denied'},'Sin acceso')}),
              React.createElement(Route,{path:'/login',element:React.createElement('div',null,'Inicio de sesión')}),
              React.createElement(Route,{path:'/',element:React.createElement('div',null,'Inicio')})
            ));
        }
        createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,{initialEntries:['/mi-area/consultas-service-layer']},React.createElement(AuthProvider,null,React.createElement(Harness))));
      </script></body></html>`);
      res.setHeader('Content-Type', 'text/html'); res.end(html);
    });
  }}], server: { host: '127.0.0.1', port: 0, hmr: false } });
let browser;
let assigned = true;
let releaseInitial;
const initialGate = new Promise(resolve => { releaseInitial = resolve; });
let initialHeld = true;
let holdNext = false;
let latePending = false;
let releaseLate;
const lateGate = new Promise(resolve => { releaseLate = resolve; });
const users = {
  FIRST: { id: 102, username: 'DESTINATARIO_FICTICIO', role: 'USUARIO_OPERATIVO', permisos: [] },
  OTHER: { id: 103, username: 'OTRO_FICTICIO', role: 'USUARIO_OPERATIVO', permisos: [] }
};
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', err => { errors.push(err.message); console.error('Navigation browser error:', err.message); });
  page.on('console', message => { if (message.type() === 'error') console.error('Navigation browser console:', message.text()); });
  await page.addInitScript(() => sessionStorage.setItem('escandon_token', 'TOKEN_FIRST_FICTICIO'));
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (!pathname.startsWith('/api/')) return route.continue();
    if (pathname.endsWith('/auth/me')) return route.fulfill({ json: { user: users.FIRST } });
    if (pathname.endsWith('/auth/login')) return route.fulfill({ json: { token: 'TOKEN_OTHER_FICTICIO', user: users.OTHER } });
    if (pathname.endsWith('/sap-query/saved/access')) {
      const first = route.request().headers().authorization === 'Bearer TOKEN_FIRST_FICTICIO';
      if (first && initialHeld) await initialGate;
      if (first && holdNext) {
        holdNext = false; latePending = true;
        await lateGate;
        return route.fulfill({ json: { ok: true, hasAssignedReports: true } });
      }
      return route.fulfill({ json: { ok: true, hasAssignedReports: first && assigned } });
    }
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto(`${server.resolvedUrls.local[0]}__assigned_navigation`);
  await page.getByTestId('identity').filter({ hasText: users.FIRST.username }).waitFor();
  assert.equal(await page.getByTestId('denied').count(), 0, 'La ruta espera la verificación inicial de asignaciones.');
  initialHeld = false; releaseInitial();
  await page.getByTestId('report').waitFor();
  assert.equal(await page.locator('button[title="Mis reportes"]').count(), 1);
  assert.equal(await page.getByTestId('permissions').textContent(), '[]');
  assert.equal(await page.getByTestId('source-grant').textContent(), 'false');

  assigned = false;
  await page.getByRole('button', { name: 'Actualizar acceso', exact: true }).click();
  await page.getByTestId('denied').waitFor();
  assert.equal(await page.locator('button[title="Mis reportes"]').count(), 0);
  assigned = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('button[title="Mis reportes"]').waitFor();
  await page.getByRole('button', { name: 'Abrir reportes de prueba', exact: true }).click();
  await page.getByTestId('report').waitFor();

  holdNext = true;
  await page.getByRole('button', { name: 'Actualizar acceso', exact: true }).click();
  for (let attempt = 0; attempt < 30 && !latePending; attempt++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(latePending, true);
  await page.getByRole('button', { name: 'Salir de prueba', exact: true }).click();
  await page.getByTestId('identity').filter({ hasText: 'Sin sesión' }).waitFor();
  await page.getByRole('button', { name: 'Entrar como otro', exact: true }).click();
  await page.getByTestId('identity').filter({ hasText: users.OTHER.username }).waitFor();
  await page.getByTestId('assignment').filter({ hasText: 'false' }).waitFor();
  releaseLate();
  await page.getByRole('button', { name: 'Abrir reportes de prueba', exact: true }).click();
  await page.getByTestId('denied').waitFor();
  assert.equal(await page.getByTestId('assignment').textContent(), 'false');
  assert.equal(await page.locator('button[title="Mis reportes"]').count(), 0);
  assert.equal(await page.getByTestId('permissions').textContent(), '[]');
  assert.deepEqual(errors, []);
  console.log('PASS: acceso inicial sin permiso general, menú exclusivo, revocación, refresco al foco y cambio de sesión sin reutilizar respuestas pendientes.');
} finally {
  releaseInitial(); releaseLate();
  await browser?.close();
  await server.close();
}
