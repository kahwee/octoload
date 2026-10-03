import { randomUUID } from 'node:crypto';
import { defineConfig } from '@playwright/test';
if (process.env.OCTOLOAD_E2E_ENV_FILE)
  process.loadEnvFile(process.env.OCTOLOAD_E2E_ENV_FILE);
process.env.OCTOLOAD_E2E_TOKEN ??= randomUUID();
const port = Number(process.env.OCTOLOAD_E2E_PORT || 4317);
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.js',
  workers: 1,
  retries: 0,
  timeout: 45000,
  reporter: 'list',
  outputDir: 'tmp/e2e-results',
  use: {
    baseURL: `http://localhost:${port}`,
    browserName: 'chromium',
    trace: 'off',
  },
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: `http://localhost:${port}`,
    timeout: 90000,
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 15000 },
  },
});
