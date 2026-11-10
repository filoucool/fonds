import { existsSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const repoRoot = path.resolve(__dirname, '..');
const apiEntry = path.join(repoRoot, 'apps/api/dist/main.js');
const webDist = path.join(repoRoot, 'apps/web/dist/index.html');
const port = process.env.E2E_PORT ?? '18080';
const baseURL = `http://127.0.0.1:${port}`;
const dataDir =
  process.env.E2E_DATA_DIR ?? mkdtempSync(path.join(os.tmpdir(), 'archiver-e2e-'));

const serverReady = existsSync(apiEntry) && existsSync(webDist);

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  outputDir: './test-results',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: serverReady
    ? {
        command: `node ${apiEntry}`,
        cwd: repoRoot,
        env: {
          ...process.env,
          DATA_DIR: dataDir,
          HOST: '127.0.0.1',
          PORT: port,
          WEB_DIST: path.join(repoRoot, 'apps/web/dist'),
          WORKER_ENABLED: 'false',
        },
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
});
