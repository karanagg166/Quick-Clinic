import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';

function makeSyntheticLabPdf(): Buffer {
  const script = [
    'import sys, pymupdf',
    'doc = pymupdf.open()',
    'p = doc.new_page()',
    'p.insert_text((72, 72), "COMPREHENSIVE METABOLIC PANEL\\nSerum Glucose: 94 mg/dL (Reference 70-99)\\nSerum Creatinine: 0.92 mg/dL", fontsize=11)',
    'sys.stdout.buffer.write(doc.tobytes())',
  ].join('; ');
  return execFileSync('uv', ['run', '--directory', 'backend', 'python', '-c', script]);
}

async function loginAs(page: Page, email: string, expectedPath: RegExp) {
  await page.goto('/auth/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('browser-test-password');
  const res = page.waitForResponse(r => r.url().endsWith('/api/user/login') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  expect((await res).status()).toBe(200);
  await expect(page).toHaveURL(expectedPath);
}

test('full PDF upload -> READY -> Patient RAG -> Doctor RAG -> HITL approval -> delete invalidation', async ({ page, context }) => {
  // 1. Log in as patient and upload synthetic medical PDF
  await loginAs(page, 'browser@example.test', /\/patient$/);
  await page.goto('/patient/medical-documents/upload', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('medical-document-file-input').setInputFiles({
    name: 'metabolic-panel.pdf',
    mimeType: 'application/pdf',
    buffer: makeSyntheticLabPdf(),
  });
  const docTitle = `Metabolic Panel E2E ${Date.now()}`;
  await page.locator('#doc-title').fill(docTitle);
  await page.locator('#doc-type').click();
  await page.getByRole('option', { name: 'Lab Report', exact: true }).click();
  await page.locator('#doc-report-date').fill('2026-11-15');

  const uploadPromise = page.waitForResponse(
    r => r.url().endsWith('/api/patients/me/medical-documents') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Upload Document', exact: true }).click();
  const uploadRes = await uploadPromise;
  expect(uploadRes.status()).toBe(201);
  const docId = (await uploadRes.json()).document.id;

  // 2. Wait until ingestion reaches READY
  await expect.poll(async () => {
    const r = await context.request.get('/api/patients/me/medical-documents');
    const body = await r.json();
    const found = (body.documents || []).find((d: { id: string }) => d.id === docId);
    return found?.processingStatus;
  }, { timeout: 30_000 }).toBe('READY');

  // 3. Patient Agent RAG query with citation
  await page.goto('/patient/assistant', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Message AI assistant').fill('What was my serum glucose in my lab report?');
  await page.getByLabel('Send message').click();
  await expect(page.getByText(/Serum Glucose:\s*94/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(new RegExp(docTitle)).first()).toBeVisible();

  // 4. Switch to authorized Doctor and verify Doctor Agent RAG + HITL approval
  await context.clearCookies();
  await loginAs(page, 'doctor@example.test', /\/doctor$/);
  await page.goto('/doctor/assistant', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Message AI assistant').fill('What was Browser Patient serum glucose in the lab report?');
  await page.getByLabel('Send message').click();
  await expect(page.getByText(/Serum Glucose:\s*94/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(new RegExp(docTitle)).first()).toBeVisible();

  // 5. Verify 10-minute HITL approval persists across reload and rejects cleanly
  await page.getByLabel('Message AI assistant').fill('Apply leave from 2026-12-20 to 2026-12-21 for Conference');
  await page.getByLabel('Send message').click();
  await expect(page.getByText(/Expires in (9|10)m/)).toBeVisible({ timeout: 30_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/Expires in (8|9|10)m/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Reject/i }).click();
  await expect(page.getByText(/Rejected/i).first()).toBeVisible({ timeout: 20_000 });

  // 6. Switch back to patient, delete document, and verify retrieval no longer finds it
  await context.clearCookies();
  await loginAs(page, 'browser@example.test', /\/patient$/);
  await page.goto('/patient/medical-documents', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: `Actions for ${docTitle}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Delete Document', exact: true }).click();
  await expect(page.getByText(docTitle, { exact: true })).toHaveCount(0);

  await page.goto('/patient/assistant', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Message AI assistant').fill('What was my serum glucose in my lab report?');
  await page.getByLabel('Send message').click();
  await expect(page.getByText(/No matching extracted evidence/i)).toBeVisible({ timeout: 30_000 });
});
