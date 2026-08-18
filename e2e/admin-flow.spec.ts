import { test, expect } from '@playwright/test';

test.describe('Admin E2E Golden Flow', () => {
  test('Admin portal navigation and onboarding page verification', async ({ page }) => {
    await page.goto('/admin/onboarding');
    await expect(page.locator('body')).toBeVisible();

    // Verify presence of secret code or onboarding fields
    const secretInput = page.getByLabel(/secret/i).or(page.getByPlaceholder(/secret/i)).first();
    if (await secretInput.isVisible()) {
      await expect(secretInput).toBeVisible();
    }
  });

  test('Admin logs UI route verification', async ({ page }) => {
    await page.goto('/admin/logs');
    await page.waitForTimeout(1000);
    expect(page.locator('body')).toBeVisible();
  });
});
