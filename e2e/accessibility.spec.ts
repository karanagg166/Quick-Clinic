import { test, expect } from '@playwright/test';

test.describe('Automated Accessibility Checks', () => {
  const routes = ['/', '/auth/login', '/auth/signup', '/patient/findDoctors'];

  for (const route of routes) {
    test(`Verify basic accessibility standards on ${route}`, async ({ page }) => {
      await page.goto(route);
      await page.waitForTimeout(500);

      // Verify viewport and basic HTML elements
      const mainOrBody = page.locator('main, body, [role="main"]').first();
      await expect(mainOrBody).toBeVisible();

      // Verify images have alt tags where required
      const images = page.locator('img');
      const count = await images.count();
      for (let i = 0; i < count; i++) {
        const img = images.nth(i);
        const alt = await img.getAttribute('alt');
        const role = await img.getAttribute('role');
        const ariaHidden = await img.getAttribute('aria-hidden');
        if (ariaHidden !== 'true' && role !== 'presentation') {
          expect(alt !== null || role === 'none').toBe(true);
        }
      }
    });
  }
});
