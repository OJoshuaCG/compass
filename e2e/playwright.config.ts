import { defineConfig } from '@playwright/test';

const ORIGIN = 'http://127.0.0.1:3100';

export default defineConfig({
  testDir: 'tests',
  // Una sola organización compartida: las pruebas de un archivo se ejecutan en orden.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: ORIGIN,
    // Se usa el Chrome instalado en el equipo o en el runner (sin descargar navegadores).
    channel: 'chrome',
    headless: true,
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm exec tsx scripts/stack.ts',
    url: `${ORIGIN}/api/v1/health/live`,
    timeout: 240_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
