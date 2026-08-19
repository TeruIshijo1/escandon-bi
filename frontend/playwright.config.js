/**
 * playwright.config.js — Smoke tests E2E
 * Hospital Escandón BI Platform
 *
 * Ejecución:
 *   npx playwright install chromium        (una sola vez)
 *   PLAYWRIGHT_BASE_URL=http://localhost:4000 PLAYWRIGHT_USERNAME=admin PLAYWRIGHT_PASSWORD=xxx npx playwright test
 *
 * Los tests requieren el backend corriendo y credenciales válidas
 * (se pasan por variables de entorno, nunca hardcodeadas).
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  retries: 0,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:4000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});