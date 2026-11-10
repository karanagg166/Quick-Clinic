import { defineConfig, devices } from '@playwright/test';

// Deliberately does not load .env or reuse application servers. This suite owns
// local ports and requires a separately named disposable PostgreSQL database.
if (!process.env.QC_BROWSER_TEST_DATABASE_URL) {
  throw new Error('Set QC_BROWSER_TEST_DATABASE_URL to local quickclinic_e2e_test');
}

export default defineConfig({
  testDir: './e2e/integration',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['html', { outputFolder: '/tmp/quick-clinic-playwright-report', open: 'never' }]],
  outputDir: '/tmp/quick-clinic-playwright-results',
  use: { baseURL: 'http://localhost:3100', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'uv run --directory backend python -m scripts.testing.browser_server',
      url: 'http://localhost:4100/health', reuseExistingServer: false, timeout: 90_000,
    },
    {
      command: 'pnpm exec next start --hostname 127.0.0.1 --port 3100',
      url: 'http://localhost:3100/auth/login', reuseExistingServer: false, timeout: 180_000,
      env: { JWT_SECRET: 'browser-isolated-signing-secret-at-least-32-characters', BACKEND_URL: 'http://localhost:4100', NEXT_PUBLIC_SOCKET_URL: 'http://localhost:4100', NEXT_PUBLIC_APP_URL: 'http://localhost:3100' },
    },
  ],
});
