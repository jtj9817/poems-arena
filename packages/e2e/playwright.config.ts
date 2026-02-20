import { defineConfig, devices } from '@playwright/test';

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
