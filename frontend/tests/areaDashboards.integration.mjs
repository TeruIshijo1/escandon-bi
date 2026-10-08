import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const screenshotDir = path.resolve(root, '../tmp/area-dashboards');
await fs.mkdir(screenshotDir, { recursive: true });
const server = await createServer({ configFile: false, root, cacheDir: path.join(screenshotDir, 'vite-cache'), appType: 'custom', plugins: [react(), {
  name: 'area-dashboards-preview', configureServer(server) {
    server.middlewares.use('/__areas', async (_req, res) => {
      const html = await server.transformIndexHtml('/__areas', `<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module">
        import React from 'react'; import { createRoot } from 'react-dom/client';
        import { MemoryRouter } from 'react-router-dom';
        import { AuthProvider, useAuth } from '/src/context/AuthContext.jsx';
        import DashboardArea from '/src/pages/DashboardArea.jsx';
        import '/src/styles/globals.css';
        function App() { const { loading } = useAuth(); return loading ? null : React.createElement('main', { style: { padding: '24px', maxWidth: '1440px', margin: '0 auto' } }, React.createElement(DashboardArea)); }
        createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter, null, React.createElement(AuthProvider, null, React.createElement(App))));
      </script></body></html>`);
      res.setHeader('Content-Type', 'text/html'); res.end(html);
    });
  },
}], server: { host: '127.0.0.1', port: 0, hmr: false } });

const trend = Array.from({ length: 7 }, (_, i) => ({ nombre: `${i + 1} oct`, valor: 40 + i * 6 }));
const financial = [{ nombre: 'Dra. Ana Martínez', ingresos: 85000 }, { nombre: 'Dr. José Hernández', ingresos: 64000 }, { nombre: 'Dra. Laura González', ingresos: 42000 }];
const studyNames = ['Tele de tórax', 'Radiografía bilateral de extremidades inferiores y tomografía de cráneo, tórax, abdomen y pelvis', 'Radiografía de tórax', 'Tomografía simple de abdomen', 'Radiografía de tórax en proyección frontal y lateral', 'Radiografía de tobillo derecho en dos proyecciones', 'Tomografía simple de cráneo', 'Ultrasonido de hígado y vías biliares', 'Resonancia magnética de columna lumbar', 'Valoración de diagnóstico por imagen'];
const studies = studyNames.map((procedimiento, index) => ({ procedimiento, cantidad: 27 - index * 2 }));
const monthlyStudies = [420, 535, 710, 520, 375, 395].map((volumen, index) => ({ Yr: 2026, Mes: index + 4, volumen, ingresosSAP: [690000, 1150000, 780000, 1030000, 1780000, 1500000][index] }));
const bed = { Estado: 'OCUPADA', RoomCode: 'C01', RoomName: 'Cubículo 1', Paciente: 'Paciente de ejemplo', PCNum: 'TEST-001', Medico: 'Dra. Ana Martínez', FechaIngreso: '2026-10-01T08:00:00', totalCargos: 15600 };
const inpatient = { kpis: { totalFacturado: 12345678.9, totalPacientes: 32, ocupacionPct: 75, camasOcupadas: 3, totalCamas: 4, estanciaPromedio: 2.4, tasaMortalidad: 0 },
  censoCamas: [bed, { ...bed, RoomCode: 'C02', RoomName: 'Cubículo 2', Estado: 'LIBRE' }],
  ingresosPorGrupo: [{ grupo: 'Medicamentos', total: 15000 }, { grupo: 'Servicios médicos', total: 28000 }],
  topInsumos: [{ nombre: 'Solución para infusión', total: 3200, cantidad: 12 }],
  listaPacientes: [{ folio: 'TEST-001', paciente: 'Paciente de ejemplo', room: 'Cubículo 1', medico: 'Dra. Ana Martínez', entrydate: '2026-10-01', status: 'OP', total_cargos_uci: 15600, total_cargos_hos: 15600 }] };
const fixtures = {
  'urgencias-nativo': { ok: true, data: { kpis: { atenciones: 431, egresos: 371, estanciaHoras: 11.1, rotacion: 13.9 }, tendencia: trend, estatus: [{ nombre: 'Alta (Cerrada)', valor: 371 }, { nombre: 'En Piso (Abierta)', valor: 60 }], kpisFinancieros: { ingresosSAP: 2537890 }, topMedicos: financial, topServicios: financial.map(d => ({ ...d, nombre: 'Atención de urgencias' })), censoCamas: [bed], lista: [{ PCNum: 'TEST-001', Paciente: 'Paciente de ejemplo', Estatus: 'OP', FechaIngreso: '2026-10-01' }] } },
  'quirofano-nativo': { ok: true, data: { lista: [{ FechaInicio: '2026-10-01T09:00:00', FechaFin: '2026-10-01T11:00:00', Medicos: 'Dra. Ana Martínez', Quirofano: 'Quirófano 1', Procedimientos: 'Cirugía general', Notas: 'Cirugía Registrada' }, { FechaInicio: '2026-09-22T08:00:00', FechaFin: '2026-09-22T09:00:00', Medicos: 'Dr. José Hernández', Quirofano: 'Quirófano 2', Procedimientos: 'Endoscopía', Notas: 'Programada' }], kpisFinancieros: { ingresosSAP: 350000 }, topMedicosIngresos: financial, topServiciosIngresos: financial } },
  'consulta-externa-nativo': { ok: true, data: { kpis: { total: 150, asistencias: 120, cancelaciones: 8, tasaAsistencia: 80 }, tendencia: trend, especialidades: [{ nombre: 'Medicina general', valor: 50 }, { nombre: 'Pediatría', valor: 30 }], topMedicos: financial.map(d => ({ ...d, valor: 35 })), lista: [{ Paciente: 'Paciente de ejemplo', Medico: 'Dra. Ana Martínez', Especialidad: 'Medicina general', DesdeFecha: '2026-10-01', PCAP_ST_Descripcion: 'Llegó' }] } },
  'uci-nativo': { ok: true, data: inpatient },
  'hospitalizacion-nativo': { ok: true, data: inpatient },
  'cuneros-nativo': { success: true, data: { totalRN: 23, totalIngresos: 70000, totalFormulas: 90, ingresosSAP: 230000, topInsumos: [{ item: 'Fórmula infantil', cantidad: 80 }], topServicios: [{ servicio: 'Cuidados neonatales', cantidad: 20 }, { servicio: 'Valoración médica', cantidad: 15 }] } },
  'aseguradoras-nativo': { success: true, data: { kpis: { totalPacientes: 150, montoTotal: 12345678.9, saldoPendiente: 2345678.9, cuentaPromedio: 82304.5 }, topAseguradoras: [{ bp: 'A1', nombre: 'Aseguradora de ejemplo', count: 30, totalFacturado: 12345678.9 }], listaPacientes: [{ PCNum: 'TEST-001', Paciente: 'Paciente de ejemplo', AseguradoraNombre: 'Aseguradora de ejemplo', BPCode: 'A1', Total: 15600, Balance: 3000, FechaApertura: '2026-10-01' }] } },
};
const areas = ['Urgencias', 'Quirófano', 'Imagenología', 'Cuneros', 'UCI', 'Consulta Externa', 'Laboratorio', 'Hospitalización', 'Aseguradoras'];
const themes = process.argv.includes('--dark-only') ? ['dark'] : process.argv.includes('--light-only') ? ['light'] : ['light', 'dark'];
const widths = process.argv.includes('--desktop-only') ? [1440] : [1440, 1024, 768, 390];

// Measure the rendered colors, including inherited/transparent backgrounds. This catches
// theme regressions that a layout-only test cannot detect.
async function checkDarkContrast(page, label) {
  const failures = await page.evaluate(() => {
    const rgb = value => (value.match(/[\d.]+/g) || []).map(Number);
    const blend = (front, back) => front.slice(0, 3).map((v, i) => v * (front[3] ?? 1) + back[i] * (1 - (front[3] ?? 1)));
    const background = element => {
      const ancestors = [];
      for (let n = element; n; n = n.parentElement) ancestors.unshift(n);
      return ancestors.reduce((color, n) => blend(rgb(getComputedStyle(n).backgroundColor), color), [255, 255, 255]);
    };
    const luminance = color => color.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((total, v, i) => total + v * [.2126, .7152, .0722][i], 0);
    const contrast = (front, back) => {
      const a = luminance(front), b = luminance(back);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    };
    const selector = '.area-dashboard h1, .area-dashboard h2, .area-dashboard h3, .area-dashboard p, .area-dashboard div, .area-dashboard span, .area-dashboard label, .area-dashboard button, .area-dashboard td, .area-dashboard th, .area-dashboard a, .area-dashboard svg text, .area-dashboard svg tspan';
    return [...document.querySelectorAll(selector)].filter(n => n.getClientRects().length && [...n.childNodes].some(child => child.nodeType === Node.TEXT_NODE && /[\p{L}\p{N}]/u.test(child.textContent))).flatMap(n => {
      const style = getComputedStyle(n);
      const color = n instanceof SVGElement ? style.fill : style.color;
      const ratio = contrast(rgb(color), background(n));
      return ratio < 4.5 ? [{ text: n.textContent.trim().slice(0, 80), color, background: background(n), contrast: +ratio.toFixed(2) }] : [];
    });
  });
  assert.deepEqual(failures, [], `${label}: text must have at least 4.5:1 contrast in dark mode`);
  const headerColor = await page.locator('.area-dashboard__header').evaluate(n => getComputedStyle(n).backgroundColor);
  assert.equal(headerColor, 'rgb(20, 33, 53)', `${label}: the header must use the dark surface`);
  const contentColor = await page.locator('.area-native-dashboard').evaluate(n => getComputedStyle(n).backgroundColor);
  assert.equal(contentColor, 'rgba(0, 0, 0, 0)', `${label}: the content must keep the page background`);
}
let browser;
let previewPage;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  previewPage = page;
  const errors = [];
  const requests = [];
  let user = { role: 'ADMIN', area: null, permisos: [] };
  await page.addInitScript(theme => {
    sessionStorage.setItem('escandon_token', 'local-layout-test');
    const applyTheme = () => document.documentElement.setAttribute('data-theme', theme);
    if (document.documentElement) applyTheme();
    else document.addEventListener('DOMContentLoaded', applyTheme, { once: true });
  }, themes[0]);
  page.on('pageerror', error => { errors.push(error.message); console.error('Browser error:', error.message); });
  page.on('console', msg => { if (msg.type() === 'error') console.error('Browser console:', msg.text()); });
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    requests.push(url.pathname + url.search);
    if (url.pathname.endsWith('/auth/me')) return route.fulfill({ json: { user } });
    if (url.pathname.endsWith('/kpi-config')) return route.fulfill({ json: { ok: true, data: { 'area.urgencias.egresos': { nombre: 'Altas registradas', nombreCustom: 'Altas registradas' } } } });
    if (url.pathname.endsWith('/available-reports')) return route.fulfill({ json: { ok: true, data: [] } });
    if (url.pathname.includes('/auxiliares-nativo/')) return route.fulfill({ json: { success: true, tendenciaAnual: monthlyStudies, topEstudios: studies } });
    if (url.pathname.includes('/export-excel')) return route.fulfill({ body: 'archivo de prueba', headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } });
    return route.fulfill({ json: fixtures[url.pathname.split('/').at(-1)] || { ok: true, data: { camas: {}, egresos: {} } } });
  });
  await page.goto(`${server.resolvedUrls.local[0]}__areas`);
  const switcher = page.getByRole('button', { name: /^Área del hospital/ });
  await page.getByText('Atenciones Médicas', { exact: true }).waitFor();
  await page.getByText('Altas registradas', { exact: true }).waitFor();
  assert.doesNotMatch(await page.locator('.area-kpi-card').allTextContents().then(x => x.join(' ')), /area\.|_/);
  // Keyboard selection, Escape, outside click and accessible selected state.
  await switcher.focus(); await page.keyboard.press('ArrowDown');
  assert.equal(await page.getByRole('option').count(), 9);
  await page.keyboard.press('Home'); await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Quirófano', exact: true }).waitFor();
  await switcher.click(); await page.keyboard.press('Escape');
  assert.equal(await switcher.getAttribute('aria-expanded'), 'false');
  await switcher.click(); await page.getByRole('heading', { name: 'Filtrar información' }).click();
  assert.equal(await switcher.getAttribute('aria-expanded'), 'false');

  for (const theme of themes) {
    await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
    for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    for (const label of areas) {
      await switcher.click();
      const option = page.getByRole('option', { name: label, exact: true });
      const areaColor = await option.locator('.area-switcher__dot').evaluate(n => getComputedStyle(n).backgroundColor);
      await option.click();
      await page.getByRole('heading', { name: label, exact: true }).waitFor();
      await page.locator('.area-native-dashboard .area-panel').first().waitFor();
      await page.waitForFunction(() => !document.querySelector('.premium-loader'));
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(350); // Wait for the color transition after changing themes.
      assert.equal(await switcher.locator('.area-switcher__dot').evaluate(n => getComputedStyle(n).backgroundColor), areaColor, 'The selected area keeps its color in the closed selector');
      const mismatchedCards = await page.locator('.dashboard-metric-card:not(.area-metric-card--highlight):not(.dashboard-metric-card--negative)').evaluateAll((nodes, color) => nodes.filter(n => getComputedStyle(n).borderLeftColor !== color).length, areaColor);
      assert.equal(mismatchedCards, 0, `${label}: the KPI accent must match the area selector`);
      assert.equal(await page.locator('.area-dashboard__icon svg').count(), 1, 'Every area has a consistent vector icon');
      assert.notEqual(await page.locator('.area-dashboard__header').evaluate(n => getComputedStyle(n).backgroundImage), 'none', 'The header carries the area identity in both themes');
      if (theme === 'dark') await checkDarkContrast(page, label);
      const bounds = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(bounds.scroll <= bounds.width + 1, `${label} at ${width}px overflows: ${JSON.stringify(bounds)}`);
      const overlaps = await page.locator('.area-chart-grid').evaluateAll(grids => grids.flatMap(grid => {
        const children = [...grid.children].map(n => n.getBoundingClientRect());
        return children.flatMap((a, i) => children.slice(i + 1).filter(b => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1));
      }).length);
      assert.equal(overlaps, 0, `${label} charts overlap at ${width}px`);
      const clippedMetrics = await page.locator('.dashboard-metric-value').evaluateAll(values => values.filter(n => n.scrollWidth > n.clientWidth + 1).map(n => n.textContent));
      assert.deepEqual(clippedMetrics, [], `${label}: KPI values must remain fully visible at ${width}px`);
      for (const card of await page.locator('.area-metric-card--highlight').all()) {
        const colors = await card.evaluate(n => ({ background: getComputedStyle(n).backgroundImage, value: getComputedStyle(n.querySelector('.area-metric-value')).color }));
        assert.ok(colors.background.includes(theme === 'dark' ? 'rgb(22, 69, 107)' : 'rgb(0, 70, 135)'), 'Highlighted income cards use institutional blue');
        assert.equal(colors.value, 'rgb(255, 255, 255)', 'Income figures remain readable on the blue background');
      }
      if (label === 'Imagenología' || label === 'Laboratorio') {
        assert.equal(await page.locator('.dashboard-ranking__label').count(), 10);
        assert.equal(await page.locator('.dashboard-ranking__label').nth(1).textContent(), studyNames[1]);
        assert.equal(await page.locator('.dashboard-ranking__value').first().textContent(), '27');
        const rankStyle = await page.locator('.dashboard-ranking__label').nth(1).evaluate(n => ({ size: parseFloat(getComputedStyle(n).fontSize), scroll: n.scrollWidth, width: n.clientWidth }));
        assert.ok(rankStyle.size >= 14 && rankStyle.scroll <= rankStyle.width + 1, 'Long study names are readable without truncation');
      }
      if (width === 1440 || width === 390) {
        await page.waitForTimeout(1600); // Let Recharts finish its entry animations before visual review.
        const suffix = theme === 'dark' ? '-dark' : '';
        await page.screenshot({ path: path.join(screenshotDir, `${label.replaceAll(' ', '-')}${suffix}-${width}.png`), fullPage: true });
        if (width === 1440 && ['Imagenología', 'Laboratorio', 'Urgencias'].includes(label)) {
          await page.screenshot({ path: path.join(screenshotDir, `${label}${suffix}-vista.png`) });
        }
      }
    }
    console.log(`PASS: 9 áreas en tema ${theme}, sin desbordes ni paneles superpuestos a ${width}px${theme === 'dark' ? ', con contraste legible' : ''}.`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await switcher.click(); await page.getByRole('option', { name: 'Urgencias', exact: true }).click();
  await page.getByText('Atenciones Médicas', { exact: true }).waitFor();
  // The actual content width, including room for a sidebar, controls the layout.
  await page.locator('main').evaluate(n => { n.style.maxWidth = '960px'; });
  const contentColumns = await page.locator('.area-metric-grid').first().evaluate(n => getComputedStyle(n).gridTemplateColumns.split(' ').length);
  assert.equal(contentColumns, 2, 'Four indicators stay balanced in a narrow content pane, even on a wide screen');
  const headerStacks = await page.locator('.area-dashboard__header').evaluate(n => n.querySelector('.area-dashboard__actions').getBoundingClientRect().top >= n.querySelector('.area-dashboard__identity').getBoundingClientRect().bottom);
  assert.ok(headerStacks, 'Header actions adapt to the content width');
  await page.locator('main').evaluate(n => { n.style.maxWidth = '1440px'; });
  await page.getByLabel('Buscar (Paciente o Médico)').fill('Ejemplo');
  await page.getByRole('button', { name: 'Aplicar Filtros', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.area-kpi-card')].length === 4);
  assert.ok(requests.some(r => r.includes('search=Ejemplo')), 'Search reaches the API');
  await page.getByRole('button', { name: 'Hoy', exact: true }).click();
  await page.waitForTimeout(150);
  assert.ok(requests.some(r => r.includes('startDate=') && r.includes('endDate=')), 'Quick dates reach the API');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar Excel', exact: true }).click();
  await download;
  await page.getByRole('button', { name: 'Limpiar', exact: true }).click();
  assert.equal(await page.getByLabel('Buscar (Paciente o Médico)').inputValue(), '');
  await switcher.click(); await page.getByRole('option', { name: 'Imagenología', exact: true }).click();
  await page.locator('.dashboard-ranking__label').first().waitFor();
  const pdfDownload = page.waitForEvent('download', { timeout: 30000 });
  await page.getByRole('button', { name: 'Exportar Resumen (PDF)', exact: true }).click();
  const pdf = await pdfDownload;
  assert.match(pdf.suggestedFilename(), /\.pdf$/i);
  assert.equal(await pdf.failure(), null, 'PDF exports support the area colors and backgrounds');
  await switcher.click(); await page.getByRole('option', { name: 'Urgencias', exact: true }).click();
  await page.getByText('Atenciones Médicas', { exact: true }).waitFor();
  await switcher.click();
  await page.screenshot({ path: path.join(screenshotDir, `selector-areas${themes.at(-1) === 'dark' ? '-dark' : ''}.png`) });
  if (themes.at(-1) === 'dark') {
    const colors = await page.getByRole('listbox').evaluate(n => ({ background: getComputedStyle(n).backgroundColor, color: getComputedStyle(n.querySelector('[aria-selected="true"]')).color }));
    assert.equal(colors.background, 'rgb(20, 33, 53)');
    assert.equal(colors.color, 'rgb(227, 242, 255)');
  }
  // A fixed-area account keeps its existing restriction.
  user = { role: 'JEFE_AREA', area: 'URGENCIAS', permisos: [] };
  await page.reload();
  await page.getByText('Atenciones Médicas', { exact: true }).waitFor();
  assert.equal(await switcher.isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log('PASS: selector accesible, nombres de indicadores, permisos, filtros y exportaciones de Excel y PDF.');
} catch (error) {
  if (previewPage) {
    await previewPage.screenshot({ path: path.join(screenshotDir, 'failure.png'), fullPage: true });
    console.error(await previewPage.locator('body').innerText());
  }
  throw error;
} finally { await browser?.close(); await server.close(); }
