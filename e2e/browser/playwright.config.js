// @ts-check
import { defineConfig, devices } from '@playwright/test';

// One worker: every test shares the mock Beacon's request log. The app (4100) and Beacon (4200) are different
// origins, so every request is a real cross-origin request with Beacon's CORS rules.
export default defineConfig({
  testDir: 'tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://127.0.0.1:4100', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command:
      'node ../mock-beacon/src/cli.js --port 4200 --origin http://127.0.0.1:4100 --static pages --static-port 4100 --mount /sdk/=../../packages/browser/dist/delivery',
    url: 'http://127.0.0.1:4200/__stats',
    reuseExistingServer: false,
    stdout: 'pipe',
  },
});
