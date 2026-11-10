import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function login(page: Page) {
  await page.goto('/auth/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email', { exact: true }).fill('browser@example.test');
  await page.getByLabel('Password', { exact: true }).fill('browser-test-password');
  const response = page.waitForResponse(r => r.url().endsWith('/api/user/login') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page).toHaveURL(/\/patient$/);
}

test('unauthenticated browser cannot read patient documents through the frontend proxy', async ({ request }) => {
  const response = await request.get('/api/patients/me/medical-documents');
  expect(response.status()).toBe(401);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(await response.json()).not.toHaveProperty('documents');
});

test('invalid credentials display a failure without creating a session', async ({ page, context }) => {
  await page.goto('/auth/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email', { exact: true }).fill('browser@example.test');
  await page.getByLabel('Password', { exact: true }).fill('wrong-password');
  const response = page.waitForResponse(r => r.url().endsWith('/api/user/login') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  expect((await response).status()).toBe(400);
  await expect(page).toHaveURL(/\/auth\/login$/);
  expect((await context.cookies()).some(cookie => cookie.name === 'token')).toBe(false);
});

test('login form meets WCAG A accessibility rules and supports password visibility', async ({ page }) => {
  await page.goto('/auth/login', { waitUntil: 'domcontentloaded' });
  const password = page.getByLabel('Password', { exact: true });
  await expect(password).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show password', exact: true }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password', exact: true }).click();
  const results = await new AxeBuilder({ page }).include('form').withTags(['wcag2a', 'wcag21a']).analyze();
  expect(results.violations).toEqual([]);
});

test('patient logs in and uploads, downloads, filters and deletes a private document', async ({ page, context }) => {
  await login(page);
  const token = (await context.cookies()).find(cookie => cookie.name === 'token');
  expect(token?.httpOnly).toBe(true);
  await page.goto('/patient/medical-documents/upload', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Upload Medical Document', exact: true })).toBeVisible();
  // Valid tiny PNG; no real medical information or provider requests.
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAE0lEQVR4nGP8//8/AwMDEwMYAAAkBgMBXaJOiAAAAABJRU5ErkJggg==', 'base64');
  await page.getByTestId('medical-document-file-input').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: image });
  const title = `Synthetic browser record ${Date.now()}`;
  await page.locator('#doc-title').fill(title);
  await page.locator('#doc-type').click();
  await page.getByRole('option', { name: 'Lab Report', exact: true }).click();
  await page.locator('#doc-report-date').fill('2026-01-01');
  const uploadResponse = page.waitForResponse(r => r.url().endsWith('/api/patients/me/medical-documents') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Upload Document', exact: true }).click();
  const upload = await uploadResponse;
  expect(upload.status()).toBe(201);
  const document = (await upload.json()).document;
  expect(document).not.toHaveProperty('storagePath');
  await expect(page).toHaveURL(/\/patient\/medical-documents$/);
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await page.getByPlaceholder('Search documents...', { exact: true }).fill(title);
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  const download = await context.request.get(`/api/patients/me/medical-documents/${document.id}/file?action=download`);
  expect(download.status()).toBe(200);
  expect(download.headers()['content-type']).toContain('image/png');
  expect(await download.body()).toEqual(image);
  await page.getByRole('button', { name: `Actions for ${title}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Delete Document', exact: true }).click();
  await expect(page.getByText(title, { exact: true })).toHaveCount(0);
  expect((await context.request.get(`/api/patients/me/medical-documents/${document.id}/file`)).status()).toBe(404);
});
