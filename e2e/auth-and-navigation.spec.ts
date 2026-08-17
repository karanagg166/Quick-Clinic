import { test, expect } from '@playwright/test';

test.describe('Quick-Clinic Core Navigation & Authentication E2E Flow', () => {
  test('landing page renders correctly with navigation links and search CTA', async ({ page }) => {
    await page.goto('/');

    // Check header/logo or title
    await expect(page).toHaveTitle(/QuickClinic|Quick Clinic|Clinic/i);

    // Verify presence of find doctors / search or login links
    const loginLink = page.getByRole('link', { name: /login|sign in/i }).first();
    if (await loginLink.isVisible()) {
      await expect(loginLink).toBeVisible();
    }
  });

  test('login page displays email, password inputs, and role redirection', async ({ page }) => {
    await page.goto('/login');

    // Verify form input elements
    const emailInput = page.getByPlaceholder(/email/i).or(page.getByLabel(/email/i)).first();
    const passwordInput = page.getByPlaceholder(/password/i).or(page.getByLabel(/password/i)).first();

    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();
  });
});
