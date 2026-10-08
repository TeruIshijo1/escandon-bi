import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const screenshots = path.resolve(root, '../tmp/dashboard-visuals');
await fs.mkdir(screenshots, { recursive: true });
const longName = 'Dra. Ana Martínez Hernández · Medicina interna y atención integral del paciente';
const months = Array.from({ length: 6 }, (_, i) => ({ month: `2026-${String(i + 4).padStart(2, '0')}`, monthStr: ['Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep'][i],
  Urgencias: 430 + i * 20, Hospitalizacion: 170 + i * 10, EgresoHoras: 20 + i, EgresoMeta: 24,
  TriajeMin: 7 + i, TriajeMeta: 10, LaboratorioMin: 38 + i, LaboratorioMeta: 45, ImagenologiaMin: 40 + i, ImagenologiaMeta: 60,
  Total: 500 + i * 30, Primeras: 250 + i * 10, Ingresos: 1500000 + i * 125000, Costos: 600000 + i * 30000, Utilidad: 900000 + i * 95000, VolumenCuentas: 450, total: 600 + i * 10 }));
const annual = [2023, 2024, 2025].map((Yr, i) => ({ Yr, volumen: 520 + i * 200, ingresos: 2600000 + i * 1000000 }));
const ranked = Array.from({ length: 10 }, (_, i) => ({ procedimiento: i === 1 ? 'Procedimiento de diagnóstico y valoración médica integral con un nombre extenso' : `Servicio de ejemplo ${i + 1}`, cantidad: 120 - i * 7 }));
const financiera = { tendenciaMensual: months,
  kpis: { ingresosAcumulados: 123456789.95, costosAcumulados: 46000000, utilidadAcumulada: 77456789.95, margenPromedio: 62.7, cobranzaRealizada: 95000000, cuentasPorCobrar: 28456789.95 },
  audit: { totalCrudo: 100, valido: 95, motivos: { noFinalizada: 3, importeCero: 1, duplicado: 1 } },
  carteraCobranza: { '0-30 días': 15000000, '31-60 días': 7000000, '61-90 días': 4000000, '90+ días': 2456789.95 }, listaCuentas: [] };
const fixtures = {
  '/dashboard/eficiencia-nativo': { ok: true, data: { tendenciaMensual: months, kpis: { camasOcupadas: 48, quirofanosActivos: 4, urgencias: 2880, hospitalizacion: 1160 } } },
  '/dashboard/eficacia-nativo': { ok: true, data: { tendenciaMensual: months,
    kpis: { totalConsultas: 4200, topEspecialidad: 'Medicina interna y atención integral del paciente', primeras: 2100, subsecuentes: 2100 },
    topEspecialidades: [{ Especialidad: 'Medicina interna', Total: 420 }, { Especialidad: 'Cirugía general y atención del paciente', Total: 340 }],
    topMedicos: [{ Medico: longName, Total: 320 }, { Medico: 'Dr. José Hernández', Total: 280 }],
    estatusConsultas: [{ nombre: 'Llegó', valor: 120 }, { nombre: 'Programada', valor: 30 }], listaConsultas: [] } },
  '/dashboard/filtros-eficacia': { ok: true, data: { medicos: [], especialidades: [] } },
  '/dashboard/financiero-nativo': { ok: true, data: financiera },
  '/dashboard/finanzas-nativo': { success: true, data: { kpis: { totalIngresos: 123456789.95, totalEfectivo: 25460000, totalEgresos: 46200000, totalTransacciones: 3420 },
    metodosData: [{ metodo: 'Tarjeta de crédito', monto: 1500000, transacciones: 420 }, { metodo: 'Efectivo', monto: 900000, transacciones: 210 }], transacciones: [] } },
  '/finanzas/ml-forecast': { ok: true, data: [] },
  '/siti/cirugias': { success: true, tendenciaAnual: annual, topCirugias: ranked, topMedicos: ranked },
  '/siti/auxiliares/laboratorio': { success: true, tendenciaAnual: annual, topEstudios: ranked },
  '/siti/medicos': { success: true, resumen: { total_medicos: 420, promedio_ingreso_medico: 12345678.9 }, topMedicos: [{ medico: longName, ingresos_generados: 5200000, pacientes_ingresados: 120 }, { medico: 'Dr. José Hernández', ingresos_generados: 3500000, pacientes_ingresados: 90 }] },
  '/siti/pacientes-demografia': { success: true, resumen: { pacientes_unicos: 12500, total_admisiones: 18400 }, retencion: { pacientes_nuevos: 7400, pacientes_recurrentes: 5100 },
    genero: [{ genero: 'Femenino', cantidad: 6200 }, { genero: 'Masculino', cantidad: 6300 }], topMotivos: ranked.map(d => ({ motivo: d.procedimiento, cantidad: d.cantidad })) },
  '/siti/financiero': { success: true, tendenciaMensual: months },
  '/siti/pacientes': { success: true, tendenciaPacientes: months },
  '/data-quality/stats': { success: true, data: { cleanliness_score: 97.5, pending_issues: 23, high_severity_pending: 4, resolved_issues: 156, total_issues: 179 } },
  '/data-quality/issues': { success: true, data: [] },
  '/dashboard/stats': { ok: true, data: { general: { TotalEgresos: 420, PromedioEdad: 45, pctFemenino: 52, Defunciones: 2, Nacimientos: 23, EstanciaPromedio: 2.4, VidasSalvadas: 18 }, diagnosticos: [{ dx: 'Facturación de servicios de atención integral y valoración especializada', n: 5200000, pct: 65 }, { dx: 'Servicios de urgencias', n: 2800000, pct: 35 }], servicios: [{ area: longName, n: 950000 }, { area: 'Dr. José Hernández', n: 760000 }] } },
  '/dashboard/stats-historico': { ok: true, data: { 2026: { 4: 120, 5: 150, 6: 170 } } },
};
const modules = ['DashboardEficienciaNativo', 'DashboardEficaciaNativo', 'DashboardFinancieroNativo', 'DashboardFinanzasNativo', 'DashboardSiti', 'DashboardSitiCirugias', 'DashboardSitiAuxiliares', 'DashboardSitiPacientes', 'DashboardSitiMedicos', 'DashboardComparativo'];
const views = [...modules, 'DataQualityDashboard', 'Estadisticas'];
const server = await createServer({ configFile: false, root, cacheDir: path.join(screenshots, 'vite-cache'), appType: 'custom', plugins: [react(), {
  name: 'dashboard-visuals-test', configureServer(server) {
    server.middlewares.use('/__visuals', async (_req, res) => {
      const html = await server.transformIndexHtml('/__visuals', `<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module">
        import React from 'react'; import { createRoot } from 'react-dom/client'; import { MemoryRouter } from 'react-router-dom';
        import { AuthProvider, useAuth } from '/src/context/AuthContext.jsx'; import '/src/styles/globals.css';
        ${modules.map(name => `import ${name} from '/src/components/dashboard/${name}.jsx';`).join('\n')}
        import DataQualityDashboard from '/src/pages/DataQualityDashboard.jsx';
        import Estadisticas from '/src/pages/Estadisticas.jsx';
        const views = { ${views.join(',')} }; const View = views[new URL(location.href).searchParams.get('view')];
        function App() { const { loading } = useAuth(); return loading ? null : React.createElement('main', { style: { padding: '24px', maxWidth: '1400px', margin: '0 auto' } }, React.createElement(View, { type: 'laboratorio', globalFilters: {}, globalTrigger: 0 })); }
        createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter, null, React.createElement(AuthProvider, null, React.createElement(App))));
      </script></body></html>`);
      res.setHeader('Content-Type', 'text/html'); res.end(html);
    });
  },
}], server: { host: '127.0.0.1', port: 0 } });

let browser, page;
const requests = [];
const errors = [];
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => sessionStorage.setItem('escandon_token', 'visual-test-token'));
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const key = url.pathname.slice(4);
    requests.push(key + url.search);
    if (key === '/auth/me') return route.fulfill({ json: { user: { role: 'ADMIN', area: null, permisos: [] } } });
    return route.fulfill({ json: fixtures[key] || { ok: true, data: {} } });
  });
  for (const theme of ['light', 'dark']) {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const view of views) {
        await page.goto(`${server.resolvedUrls.local[0]}__visuals?view=${view}`);
        await page.locator('.dashboard-metric-card, .dashboard-chart').first().waitFor();
        await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
        await page.waitForTimeout(450);
        await page.evaluate(() => document.fonts.ready);
        const issues = await page.evaluate(() => {
          const elements = [...document.querySelectorAll('.dashboard-metric-value, .dashboard-ranking__label, .dashboard-ranking__value, .dashboard-panel, .dashboard-export-toolbar button, .dashboard-html-chart-label, .dashboard-html-chart-value')];
          return elements.filter(n => n.getBoundingClientRect().width && (n.scrollWidth > n.clientWidth + 1 || n.getBoundingClientRect().right > innerWidth + 1)).map(n => n.textContent.slice(0, 80));
        });
        assert.deepEqual(issues, [], `${view}, ${theme}, ${width}px: values and charts must fit without clipping`);
        const smallText = await page.locator('.dashboard-ranking__label, .dashboard-metric-label').evaluateAll(nodes => nodes.filter(n => parseFloat(getComputedStyle(n).fontSize) < 13).map(n => n.textContent));
        assert.deepEqual(smallText, [], 'Metric and ranking names must be readable');
        if (theme === 'dark') {
          assert.equal(await page.locator('.dashboard-metric-card, .dashboard-panel').first().evaluate(n => getComputedStyle(n).backgroundColor), 'rgb(20, 33, 53)');
        }
        if (view === 'DashboardEficaciaNativo') {
          const doctor = page.locator('.dashboard-ranking__row').filter({ hasText: longName });
          const filteredRequest = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/eficacia-nativo') && new URL(request.url()).searchParams.get('search') === longName);
          await doctor.focus(); await page.keyboard.press('Enter');
          await filteredRequest;
          await page.waitForFunction(() => document.querySelector('.dashboard-ranking__row'));
          assert.ok((await page.locator('.recharts-legend-item-text').allTextContents()).includes('Programada'), 'Pie legends show the actual appointment status');
        }
        if (view === 'DashboardSitiPacientes') {
          await page.waitForFunction(() => document.querySelectorAll('.recharts-sector').length === 4);
          const clippedSectors = await page.locator('.recharts-sector').evaluateAll(nodes => nodes.filter(node => {
            const sector = node.getBoundingClientRect(); const chart = node.closest('svg').getBoundingClientRect();
            return sector.width < 20 || sector.height < 20 || sector.left < chart.left - 1 || sector.right > chart.right + 1 || sector.top < chart.top - 1 || sector.bottom > chart.bottom + 1;
          }).length);
          assert.equal(clippedSectors, 0, 'Demographic pie sectors render inside the chart at every screen size');
        }
        if (['DashboardFinancieroNativo', 'DashboardEficaciaNativo', 'DashboardSitiPacientes', 'DashboardSitiMedicos'].includes(view)) {
          await page.waitForTimeout(1700);
          if (view === 'DashboardFinancieroNativo') {
            const clippedLabels = await page.locator('.recharts-pie-label-text').evaluateAll(nodes => nodes.filter(node => {
              const label = node.getBoundingClientRect(); const chart = node.closest('svg').getBoundingClientRect();
              return label.left < chart.left - 1 || label.right > chart.right + 1 || label.top < chart.top - 1 || label.bottom > chart.bottom + 1;
            }).map(node => node.textContent));
            assert.deepEqual(clippedLabels, [], 'Receivable pie labels remain fully visible on narrow screens');
          }
          await page.screenshot({ path: path.join(screenshots, `${view}-${theme}-${width}.png`), fullPage: true });
        }
      }
      console.log(`PASS: 12 tableros de dirección, históricos, estadísticas y calidad; tema ${theme}, ${width}px; cifras completas, etiquetas legibles y filtros conservados.`);
    }
  }
  assert.deepEqual(errors, []);
  fixtures['/dashboard/financiero-nativo'].data = { ...financiera, kpis: { ...financiera.kpis, costosAcumulados: financiera.kpis.ingresosAcumulados + 24500.5, utilidadAcumulada: -24500.5, margenPromedio: -.02 } };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${server.resolvedUrls.local[0]}__visuals?view=DashboardFinancieroNativo`);
  const loss = page.locator('.dashboard-metric-value--negative').first();
  await loss.waitFor();
  assert.equal(await loss.textContent(), '-$24,500.50');
  assert.equal(await loss.evaluate(n => getComputedStyle(n).color), 'rgb(201, 53, 70)');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.dashboard-metric-value--negative')).color === 'rgb(253, 164, 175)');
  assert.equal(await loss.evaluate(n => getComputedStyle(n).color), 'rgb(253, 164, 175)');
  console.log('PASS: pérdidas en rojo legible, sin cambiar el importe.');
} catch (error) {
  if (page) { await page.screenshot({ path: path.join(screenshots, 'failure.png'), fullPage: true }); console.error(await page.locator('body').innerText()); }
  throw error;
} finally { await browser?.close(); await server.close(); }
