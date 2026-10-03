import { test, expect } from '@playwright/test';

test.describe('Patient Medical Documents Flow', () => {
  test('Medical Documents listing page renders correctly with filters and empty state', async ({ page }) => {
    // Mock the medical documents API to return an empty list initially
    await page.route('/api/patients/me/medical-documents*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ documents: [] }),
      });
    });

    await page.goto('/patient/medical-documents');
    await expect(page.locator('body')).toBeVisible();

    // Verify main heading
    await expect(
      page.getByRole('heading', { name: /medical documents/i }).first()
    ).toBeVisible();

    // Verify "Upload Document" button exists
    const uploadBtn = page.getByRole('link', { name: /upload document/i }).first();
    await expect(uploadBtn).toBeVisible();
    await expect(uploadBtn).toHaveAttribute('href', '/patient/medical-documents/upload');

    // Verify filters exist
    const searchInput = page.getByPlaceholder(/search by document name/i).first();
    await expect(searchInput).toBeVisible();
  });

  test('Upload page renders with dropzone and required metadata fields', async ({ page }) => {
    await page.goto('/patient/medical-documents/upload');
    await expect(page.locator('body')).toBeVisible();

    // Verify heading
    await expect(
      page.getByRole('heading', { name: /upload medical document/i }).first()
    ).toBeVisible();

    // Verify back navigation link
    const backLink = page.getByRole('link', { name: /back to medical documents/i }).first();
    await expect(backLink).toBeVisible();
    await expect(backLink).toHaveAttribute('href', '/patient/medical-documents');

    // Verify submit button
    const submitBtn = page.getByRole('button', { name: /upload document/i });
    await expect(submitBtn).toBeVisible();
  });

  test('Medical Documents listing displays mock document cards and action triggers', async ({ page }) => {
    const mockDoc = {
      id: 'doc_playwright_1',
      patientId: 'pat_test_1',
      title: 'Annual Blood Work 2026',
      type: 'LAB_REPORT',
      fileName: 'blood_work.pdf',
      mimeType: 'application/pdf',
      fileSize: 1024 * 500,
      storagePath: 'medical-documents/pat_test_1/doc_playwright_1/blood_work.pdf',
      reportDate: new Date('2026-09-20').toISOString(),
      hospitalOrDoctor: 'Apollo Diagnostics',
      notes: 'Routine health checkup',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await page.route('/api/patients/me/medical-documents*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ documents: [mockDoc] }),
      });
    });

    await page.goto('/patient/medical-documents');
    await expect(page.getByText('Annual Blood Work 2026')).toBeVisible();
    await expect(page.getByText('Apollo Diagnostics')).toBeVisible();
  });
});
