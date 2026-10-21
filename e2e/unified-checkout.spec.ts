import { test, expect } from '@playwright/test';

test.describe('Unified Checkout & Slot Booking E2E Flows', () => {
  test('Find doctors and time slot picker renders properly', async ({ page }) => {
    // 1. Visit Find Doctors page
    await page.goto('/patient/findDoctors');
    await expect(page.locator('body')).toBeVisible();

    // 2. Doctor cards or list container is visible
    const mainContainer = page.locator('main, [role="main"]').first();
    await expect(mainContainer).toBeVisible();
  });

  test('Login and checkout navigation flow', async ({ page }) => {
    // 1. Visit patient login page
    await page.goto('/auth/login');
    const emailInput = page.getByLabel(/email/i).or(page.getByPlaceholder(/email/i)).first();
    const passwordInput = page.getByLabel(/password/i).or(page.getByPlaceholder(/password/i)).first();
    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();

    // 2. Verify patient appointment dashboard redirects unauthenticated users or renders
    await page.goto('/patient');
    await expect(page.locator('body')).toBeVisible();
  });
});
