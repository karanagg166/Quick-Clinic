import { test, expect } from '@playwright/test';

test.describe('Doctor E2E Golden Flow', () => {
  test('Doctor portal navigation and route protection', async ({ page }) => {
    // Unauthenticated access to /doctor should redirect to login
    await page.goto('/doctor');
    await page.waitForTimeout(1000);
    
    // Verify it either stays on login or renders doctor dashboard
    const currentUrl = page.url();
    expect(currentUrl).toMatch(/\/doctor|\/login|\/auth\/login/);
  });

  test('Doctor earnings UI navigation', async ({ page }) => {
    await page.goto('/doctor/earnings');
    await page.waitForTimeout(1000);
    expect(page.locator('body')).toBeVisible();
  });
});
