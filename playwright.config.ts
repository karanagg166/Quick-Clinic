import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Playwright E2E configuration for Quick-Clinic
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'html' : 'list',
  use: {
    baseURL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    trace: process.env.CI ? 'retain-on-failure' : 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: process.env.CI ? 'pnpm start' : 'pnpm dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      env: {
        PLAYWRIGHT: 'true',
        RAZORPAY_MOCK_TEST_MODE: 'true',
        NEXT_PUBLIC_SOCKET_URL: 'http://localhost:4000',
      },
    },
    {
      command: 'cd socket-server && node dist/main.js',
      url: 'http://localhost:4000/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
      env: {
        PORT: '4000',
        INTERNAL_SECRET: process.env.INTERNAL_API_SECRET || process.env.INTERNAL_SECRET || 'ci_internal_secret_at_least_32_characters_long_for_security',
        JWT_SECRET: process.env.JWT_SECRET || 'ci_jwt_secret_must_be_at_least_32_characters_long_for_security',
        CLIENT_ORIGIN: 'http://localhost:3000',
        DATABASE_URL: process.env.DATABASE_URL || '',
      },
    },
  ],
});
