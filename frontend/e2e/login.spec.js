/**
 * login.spec.js — Smoke test de autenticación y acceso a dashboards
 *
 * Requiere:
 *   - Backend corriendo en PLAYWRIGHT_BASE_URL (default http://localhost:4000)
 *   - PLAYWRIGHT_USERNAME y PLAYWRIGHT_PASSWORD con credenciales válidas
 *   - npm run build (frontend servido por el backend en producción)
 *
 * Si las credenciales no están definidas, los tests se SKIPean (no fallan CI).
 */
import { test, expect } from '@playwright/test';

const username = process.env.PLAYWRIGHT_USERNAME;
const password = process.env.PLAYWRIGHT_PASSWORD;

test.skip(!username || !password, 'PLAYWRIGHT_USERNAME/PASSWORD no definidas');

test('login y acceso al dashboard directivo', async ({ page }) => {
  await page.goto('/');

  // Login
  await page.fill('input[name="username"], input[placeholder*="usuario" i]', username);
  await page.fill('input[name="password"], input[type="password"]', password);
  await page.click('button[type="submit"], button:has-text("Ingresar"), button:has-text("Entrar")');

  // Redirección al dashboard
  await expect(page).toHaveURL(/dashboard/, { timeout: 15000 });

  // La sesión queda activa (token en sessionStorage)
  const token = await page.evaluate(() => sessionStorage.getItem('escandon_token'));
  expect(token).toBeTruthy();

  // Al menos un dashboard renderiza datos
  await expect(page.locator('#dashboard-container, .dashboard-container')).toBeVisible({ timeout: 20000 });
});

test('logout limpia el token', async ({ page }) => {
  await page.goto('/');
  await page.fill('input[name="username"], input[placeholder*="usuario" i]', username);
  await page.fill('input[name="password"], input[type="password"]', password);
  await page.click('button[type="submit"], button:has-text("Ingresar"), button:has-text("Entrar")');
  await expect(page).toHaveURL(/dashboard/, { timeout: 15000 });

  await page.click('button:has-text("Salir"), button:has-text("Cerrar sesión")');
  await expect(page).toHaveURL(/login/, { timeout: 15000 });

  const token = await page.evaluate(() => sessionStorage.getItem('escandon_token'));
  expect(token).toBeFalsy();
});