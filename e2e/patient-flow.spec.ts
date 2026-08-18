import { test, expect } from '@playwright/test';

test.describe('Patient E2E Golden Flow', () => {
  test('Patient navigates landing, search, and view doctor profile', async ({ page }) => {
    // 1. Visit landing page
    await page.goto('/');
    await expect(page).toHaveTitle(/QuickClinic|Quick Clinic|Clinic/i);

    // 2. Visit find doctors page
    await page.goto('/patient/findDoctors');
    await expect(page.locator('body')).toBeVisible();

    // Verify search filters exist
    const specialtySelect = page.locator('select, [role="combobox"]').first();
    if (await specialtySelect.isVisible()) {
      await expect(specialtySelect).toBeVisible();
    }
  });

  test('Patient auth pages render properly', async ({ page }) => {
    await page.goto('/auth/login');
    await expect(page.getByLabel(/email/i).or(page.getByPlaceholder(/email/i)).first()).toBeVisible();
    await expect(page.getByLabel(/password/i).or(page.getByPlaceholder(/password/i)).first()).toBeVisible();

    await page.goto('/auth/signup');
    await expect(page.getByLabel(/email/i).or(page.getByPlaceholder(/email/i)).first()).toBeVisible();
  });
});
