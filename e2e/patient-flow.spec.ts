import { test, expect, BrowserContext } from '@playwright/test';
import dotenv from 'dotenv';
import { prisma } from '@/lib/prisma';
import { createToken } from '@/lib/auth-token';

dotenv.config();

test.describe('Patient E2E Golden Flow — Doctor Discovery & Slot Selection', () => {
  let seededDoctor: any;
  let seededPatientUser: any;
  let seededPatientRecord: any;

  test.beforeAll(async () => {
    // 1. Fetch real seeded doctor from database (do not create fake doctor)
    seededDoctor = await prisma.doctor.findFirst({
      include: {
        user: true,
        schedule: true,
      },
    });

    if (!seededDoctor) {
      throw new Error('Fatal: Seeded doctor record missing in database');
    }

    // 2. Fetch or create a dedicated test patient for browser session
    let patient = await prisma.patient.findFirst({
      include: { user: true },
    });

    if (!patient) {
      const user = await prisma.user.create({
        data: {
          name: 'Playwright E2E Patient',
          email: `e2e.patient.${Date.now()}@quickclinic.test`,
          phoneNo: '9876543210',
          password: '$2b$10$hashedpasswordforexamplepurposeonly',
          age: 28,
          gender: 'FEMALE',
          role: 'PATIENT',
          address: 'E2E Testing Avenue',
          location: {
            connectOrCreate: {
              where: { pincode: 560001 },
              create: { pincode: 560001, city: 'Bangalore', state: 'Karnataka' },
            },
          },
        },
      });

      patient = await prisma.patient.create({
        data: {
          userId: user.id,
          medicalHistory: 'None',
          allergies: 'None',
          currentMedications: 'None',
        },
        include: { user: true },
      });
    }

    seededPatientRecord = patient;
    seededPatientUser = patient.user;
  });

  async function authenticatePatient(context: BrowserContext) {
    const token = await createToken({
      id: seededPatientUser.id,
      userId: seededPatientUser.id,
      email: seededPatientUser.email,
      name: seededPatientUser.name,
      role: 'PATIENT',
    });

    await context.addCookies([
      {
        name: 'token',
        value: token,
        domain: 'localhost',
        path: '/',
      },
    ]);

    await context.addInitScript(
      (arg: { user: any; patientId: string }) => {
        const storeData = {
          state: {
            user: arg.user,
            patientId: arg.patientId,
            doctorId: null,
            isLoading: false,
            hasHydrated: true,
          },
          version: 1,
        };
        window.localStorage.setItem('user-store', JSON.stringify(storeData));
      },
      { user: seededPatientUser, patientId: seededPatientRecord.id }
    );
  }

  test('Patient navigates landing, search, and auth pages', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/QuickClinic|Quick Clinic|Clinic/i);

    await page.goto('/auth/login');
    await expect(page.getByLabel(/email/i).or(page.getByPlaceholder(/email/i)).first()).toBeVisible();
    await expect(page.getByLabel(/password/i).or(page.getByPlaceholder(/password/i)).first()).toBeVisible();

    await page.goto('/auth/signup');
    await expect(page.getByLabel(/email/i).or(page.getByPlaceholder(/email/i)).first()).toBeVisible();
  });

  test('Signed-in patient discovers eligible seeded doctors, filters, opens profile, and selects slot', async ({
    context,
    page,
  }) => {
    // 1. Authenticate patient
    await authenticatePatient(context);

    // 2. Set up listener to verify /api/doctors response
    const doctorsApiPromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/doctors') && resp.request().method() === 'GET'
    );

    // 3. Navigate to Find Doctors page
    await page.goto('/patient/findDoctors');
    const doctorsResponse = await doctorsApiPromise;
    expect(doctorsResponse.status()).toBe(200);

    const doctorsData = await doctorsResponse.json();
    const doctorsList = Array.isArray(doctorsData) ? doctorsData : doctorsData.doctors ?? [];

    // Fails strictly if doctor discovery returns empty list
    expect(doctorsList.length).toBeGreaterThan(0);

    // 4. Verify doctor card is rendered in the DOM
    const doctorCard = page.locator(`text=${seededDoctor.user.name}`).first();
    await expect(doctorCard).toBeVisible({ timeout: 15_000 });

    // 5. Test search filter by doctor name
    const searchInput = page.getByPlaceholder(/Search by doctor name/i).or(page.getByLabel(/name/i)).first();
    if (await searchInput.isVisible()) {
      await searchInput.fill(seededDoctor.user.name.split(' ')[1] || seededDoctor.user.name);
      await page.waitForTimeout(500);
      await expect(page.locator(`text=${seededDoctor.user.name}`).first()).toBeVisible();
    }

    // 6. Click 'View Profile' to navigate to doctor details page
    const profileLink = page.locator(`a[href*="/patient/doctor/${seededDoctor.id}"]`).first();
    await expect(profileLink).toBeVisible();
    await profileLink.click();

    // 7. Verify doctor profile page loaded with verified attributes
    await page.waitForURL(`**/patient/doctor/${seededDoctor.id}*`);
    await expect(page.locator(`text=${seededDoctor.user.name}`).first()).toBeVisible();
    await expect(page.locator(`text=${seededDoctor.specialty}`).first()).toBeVisible();

    // 8. Book an Appointment section and slot selection
    await expect(page.getByText(/Book an Appointment/i)).toBeVisible();

    // Set date to upcoming Monday 2026-10-26 (confirmed working day)
    const dateInput = page.locator('input[type="date"]').first();
    if (await dateInput.isVisible()) {
      const slotsApiPromise = page.waitForResponse(
        (resp) => resp.url().includes(`/api/doctors/${seededDoctor.id}/slots`) && resp.status() === 200
      );
      await dateInput.fill('2026-10-26');
      await slotsApiPromise;
    }

    // Verify slots rendered and select an available slot
    const slotButtons = page.locator('button:has-text("AM"), button:has-text("PM")');
    const slotCount = await slotButtons.count();
    expect(slotCount).toBeGreaterThan(0);

    // Click the first available slot button
    const firstSlot = slotButtons.first();
    await expect(firstSlot).toBeVisible();
    await firstSlot.click();

    // Verify slot is selected (button reflects selection or payment options become visible)
    const paymentOrSelected = page.getByText(/Pay Online|Pay at Clinic|Selected Slot|Reservation/i).first();
    await expect(paymentOrSelected).toBeVisible({ timeout: 10_000 });
  });
});
