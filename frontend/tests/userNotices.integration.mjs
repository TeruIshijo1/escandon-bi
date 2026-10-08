import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ configFile: false, root, appType: 'custom', plugins: [react(), {
  name: 'user-notices-test', configureServer(server) {
    server.middlewares.use('/__notices', async (_req, res) => {
      const html = await server.transformIndexHtml('/__notices', `<!doctype html><html lang="es"><body><div id="root"></div><script type="module">
        import React from 'react'; import { createRoot } from 'react-dom/client';
        import { ErrorBoundary } from '/src/components/shared/ErrorBoundary.jsx';
        import Catalog from '/src/components/honorarios/HonorariosCatalogPanel.jsx';
        import { apiFetch } from '/src/api/client.js';
        window.noticeRequest = async () => { try { await apiFetch('/test-notice'); } catch(error) { return error.message; } };
        window.cancelNoticeRequest = async () => {
          const controller = new AbortController();
          controller.abort();
          try { await apiFetch('/test-notice', { signal: controller.signal }); }
          catch(error) { return error.name; }
        };
        function Broken() { throw new Error('TypeError: UT_Honorarios private component details'); }
        function App() { const [broken, setBroken] = React.useState(false); return React.createElement(ErrorBoundary, null, broken ? React.createElement(Broken) : React.createElement(React.Fragment, null, React.createElement('button', { onClick: () => setBroken(true) }, 'Probar fallo de pantalla'), React.createElement(Catalog, { canManage: true }))); }
        createRoot(document.getElementById('root')).render(React.createElement(App));
      </script></body></html>`);
      res.setHeader('Content-Type', 'text/html'); res.end(html);
    });
  },
}], server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.route('**/api/honorarios/**', route => {
    const endpoint = new URL(route.request().url()).pathname;
    const result = endpoint.endsWith('/providers') ? { providers: [] }
      : endpoint.endsWith('/history') ? { history: [] }
        : endpoint.endsWith('/tariffs') ? { tariffs: [] }
          : { items: [{ itemCode: 'SER1471', description: 'Sesión de psicología', status: 'PENDIENTE',
            referencePrices: [{ id: 1, amount: 250 }], referenceWarnings: ['Sin referencia en UT_Honorarios'] }],
            sync: { lastError: 'relation "bi_honorarios_catalog" does not exist' } };
    return route.fulfill({ json: result });
  });
  await page.goto(`${server.resolvedUrls.local[0]}__notices`);
  await page.getByRole('button', { name: 'Configurar SER1471' }).click();
  await page.getByText('Precios de referencia (1)', { exact: true }).click();
  await page.getByText('Aún no hay un precio de referencia para este servicio.', { exact: true }).waitFor();
  assert.doesNotMatch(await page.locator('body').innerText(), /UT_Honorarios|bi_honorarios|relation|does not exist/);

  let status = 500;
  await page.route('**/api/test-notice', route => route.fulfill({ status, json: { error: 'relation "bi_honorarios_tariffs" does not exist' } }));
  assert.match(await page.evaluate(() => window.noticeRequest()), /Intenta de nuevo/);
  status = 401;
  assert.match(await page.evaluate(() => window.noticeRequest()), /Inicia sesión de nuevo/);
  await page.unroute('**/api/test-notice');
  await page.route('**/api/test-notice', route => route.abort('failed'));
  assert.match(await page.evaluate(() => window.noticeRequest()), /Revisa tu conexión/);
  assert.equal(await page.evaluate(() => window.cancelNoticeRequest()), 'AbortError', 'Cancelled requests preserve their lifecycle signal instead of showing a connection failure');

  await page.getByRole('button', { name: 'Probar fallo de pantalla' }).click();
  await page.getByRole('heading', { name: 'No se pudo mostrar esta página.' }).waitFor();
  await page.getByRole('button', { name: 'Volver a cargar' }).waitFor();
  assert.doesNotMatch(await page.locator('body').innerText(), /TypeError|UT_Honorarios|component|stack/i);
  console.log('PASS: avisos del catálogo, errores de consulta, sesión terminada, conexión y fallo de pantalla usan lenguaje claro sin detalles internos.');
} finally { await browser?.close(); await server.close(); }
