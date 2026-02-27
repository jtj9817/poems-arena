import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

// Load root .env so the API webServer subprocess inherits it.
// Bun resolves .env relative to the package root (apps/api/), not the monorepo
// root, so without this the API process never sees LIBSQL_URL.
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const raw = readFileSync(resolve(__dirname, '../../.env'), 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  }
} catch {
  // No .env file found — rely on env vars being set externally (e.g. CI).
}

const API_PORT = Number(process.env.API_PORT ?? 4000);
const WEB_PORT = Number(process.env.WEB_PORT ?? 3000);

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  globalTimeout: 120_000,
  retries: 0,
  reporter: process.env.CI ? 'list' : 'html',

  use: {
    headless: true,
    trace: 'on-first-retry',
    // Collapse CSS animations to their end state for reliable assertions
    reducedMotion: 'reduce',
  },

  projects: [
    {
      name: 'cdp',
      testDir: './tests/cdp',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    {
      name: 'api',
      testDir: './tests/api',
      use: {
        baseURL: `http://localhost:${API_PORT}`,
      },
    },
    {
      name: 'ui',
      testDir: './tests/ui',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${WEB_PORT}`,
      },
    },
  ],

  webServer: [
    {
      command: `pnpm --filter @sanctuary/api dev`,
      port: API_PORT,
      reuseExistingServer: !process.env.CI,
      cwd: '../..',
      timeout: 15_000,
    },
    {
      command: `pnpm --filter @sanctuary/web dev`,
      port: WEB_PORT,
      reuseExistingServer: !process.env.CI,
      cwd: '../..',
      timeout: 15_000,
    },
  ],
});
