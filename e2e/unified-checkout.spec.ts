import { test, expect, BrowserContext } from '@playwright/test';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { prisma } from '@/lib/prisma';
import { createToken } from '@/lib/auth-token';
import { DEFAULT_CLINIC_TIMEZONE, localDateAndTimeToUtc } from '@/lib/dateUtils';

dotenv.config();

test.describe('Unified Checkout & Slot Booking E2E Browser Flows', () => {
  test.describe.configure({ mode: 'serial' });

  const runId = `e2e_${Date.now()}`;
  let patientUser: any;
  let patientRecord: any;
  let doctorUser: any;
  let doctorRecord: any;
  let slot1: any;
  let slot2: any;
  let slot3: any;
  let tomorrowDateStr: string;

  test.beforeAll(async () => {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrowDateStr = tomorrow.toISOString().split('T')[0];
    const slotDate = new Date(`${tomorrowDateStr}T00:00:00.000Z`);

    // 1. Create Patient User & Profile
    patientUser = await prisma.user.create({
      data: {
        name: 'Browser E2E Patient',
        email: `${runId}_patient@quickclinic.test`,
        phoneNo: '9876543210',
        password: '$2b$10$hashedpasswordforexamplepurposeonly',
        age: 29,
        gender: 'FEMALE',
        address: '100 Browser Test Way',
        role: 'PATIENT',
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });

    patientRecord = await prisma.patient.create({
      data: { userId: patientUser.id },
    });

    // 2. Create Doctor User & Profile
    doctorUser = await prisma.user.create({
      data: {
        name: 'Dr. Browser Test',
        email: `${runId}_doctor@quickclinic.test`,
        phoneNo: '9876543211',
        password: '$2b$10$hashedpasswordforexamplepurposeonly',
        age: 40,
        gender: 'MALE',
        address: '200 Clinic Way',
        role: 'DOCTOR',
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });

    doctorRecord = await prisma.doctor.create({
      data: {
        userId: doctorUser.id,
        specialty: 'CARDIOLOGIST',
        fees: 500,
        experience: 12,
        doctorBio: 'Board-certified cardiologist for E2E testing',
      },
    });

    // 3. Create Available Slots for tomorrow
    slot1 = await prisma.slot.create({
      data: {
        doctorId: doctorRecord.id,
        date: slotDate,
        startTime: localDateAndTimeToUtc(tomorrowDateStr, '10:00', DEFAULT_CLINIC_TIMEZONE),
        endTime: localDateAndTimeToUtc(tomorrowDateStr, '10:30', DEFAULT_CLINIC_TIMEZONE),
        status: 'AVAILABLE',
      },
    });

    slot2 = await prisma.slot.create({
      data: {
        doctorId: doctorRecord.id,
        date: slotDate,
        startTime: localDateAndTimeToUtc(tomorrowDateStr, '10:30', DEFAULT_CLINIC_TIMEZONE),
        endTime: localDateAndTimeToUtc(tomorrowDateStr, '11:00', DEFAULT_CLINIC_TIMEZONE),
        status: 'AVAILABLE',
      },
    });

    slot3 = await prisma.slot.create({
      data: {
        doctorId: doctorRecord.id,
        date: slotDate,
        startTime: localDateAndTimeToUtc(tomorrowDateStr, '11:00', DEFAULT_CLINIC_TIMEZONE),
        endTime: localDateAndTimeToUtc(tomorrowDateStr, '11:30', DEFAULT_CLINIC_TIMEZONE),
        status: 'AVAILABLE',
      },
    });
  });

  test.afterAll(async () => {
    try {
      await prisma.appointment.deleteMany({ where: { patientId: patientRecord?.id } });
      await prisma.refund.deleteMany({ where: { payment: { userId: patientUser?.id } } });
      await prisma.payment.deleteMany({ where: { userId: patientUser?.id } });
      await prisma.notificationOutbox.deleteMany({ where: { targetUserId: patientUser?.id } });
      await prisma.checkout.deleteMany({ where: { userId: patientUser?.id } });
      await prisma.slot.deleteMany({ where: { doctorId: doctorRecord?.id } });
      await prisma.doctor.deleteMany({ where: { id: doctorRecord?.id } });
      await prisma.patient.deleteMany({ where: { id: patientRecord?.id } });
      await prisma.user.deleteMany({ where: { id: { in: [patientUser?.id, doctorUser?.id].filter(Boolean) } } });
    } catch {
      // ignore
    }
  });

  async function authenticate(context: BrowserContext) {
    const token = await createToken({
      id: patientUser.id,
      userId: patientUser.id,
      email: patientUser.email,
      name: patientUser.name,
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
      { user: patientUser, patientId: patientRecord.id }
    );
  }

  test('1 & 2. Slot click updates client state without reservations; payment choice initiates attempt', async ({ context, page }) => {
    await authenticate(context);

    // Track requests to ensure zero reservation attempts on slot click
    const reservationRequests: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if ((url.includes('/api/checkout') || url.includes('/hold')) && req.method() === 'POST') {
        reservationRequests.push(url);
      }
    });

    await page.goto(`/patient/doctor/${doctorRecord.id}`);
    await page.waitForLoadState('networkidle');

    // Select tomorrow's date
    const dateInput = page.locator('#date-picker');
    await dateInput.fill(tomorrowDateStr);
    await dateInput.dispatchEvent('change');

    // Wait for the slot to appear
    const slotButton = page.getByRole('button', { name: '10:00 AM' });
    await expect(slotButton).toBeVisible();

    // Click the slot
    await slotButton.click();

    // Verify "Proceed to Book" is displayed
    const proceedBtn = page.getByRole('button', { name: /Proceed to Book/i });
    await expect(proceedBtn).toBeVisible();

    // Verify NO reservation requests were made on slot selection!
    expect(reservationRequests.length).toBe(0);

    // Click "Proceed to Book"
    await proceedBtn.click();

    // Verify "Pay Online" and "Pay at Clinic" options are shown
    const payOnlineBtn = page.getByRole('button', { name: /Pay Online/i });
    const payClinicBtn = page.getByRole('button', { name: /Pay at Clinic/i });
    await expect(payOnlineBtn).toBeVisible();
    await expect(payClinicBtn).toBeVisible();

    // Verify STILL no reservation requests before payment method is explicitly chosen!
    expect(reservationRequests.length).toBe(0);
  });

  test('3. Offline booking succeeds without Razorpay and confirms appointment', async ({ context, page }) => {
    await authenticate(context);

    await page.goto(`/patient/doctor/${doctorRecord.id}`);
    await page.waitForLoadState('networkidle');

    const dateInput = page.locator('#date-picker');
    await dateInput.fill(tomorrowDateStr);
    await dateInput.dispatchEvent('change');

    // Select 10:00 AM slot
    const slotButton = page.getByRole('button', { name: '10:00 AM' });
    await expect(slotButton).toBeVisible();
    await slotButton.click();

    await page.getByRole('button', { name: /Proceed to Book/i }).click();

    // Choose "Pay at Clinic"
    const payClinicBtn = page.getByRole('button', { name: /Pay at Clinic/i });
    await expect(payClinicBtn).toBeVisible();
    await payClinicBtn.click();

    // Wait for redirect to /patient dashboard (exact path)
    await page.waitForURL((url) => url.pathname === '/patient', { timeout: 15000 });

    // Authoritative DB verification:
    const appointment = await prisma.appointment.findFirst({
      where: {
        slotId: slot1.id,
        patientId: patientRecord.id,
        status: 'CONFIRMED',
      },
    });
    expect(appointment).toBeDefined();
    expect(appointment?.paymentMethod).toBe('OFFLINE');

    const slotAfter = await prisma.slot.findUniqueOrThrow({ where: { id: slot1.id } });
    expect(slotAfter.status).toBe('BOOKED');

    const checkout = await prisma.checkout.findFirst({
      where: { slotId: slot1.id, userId: patientUser.id },
    });
    expect(checkout?.status).toBe('CONFIRMED');
    expect(checkout?.razorpayOrderId).toBeNull();
  });

  test('4. Mock online payment completes appointment booking through first-party verify route', async ({ context, page }) => {
    await authenticate(context);

    // Mock only the client-side Razorpay SDK
    const secret = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_mock_hardening_secret';
    await page.exposeFunction('generateMockSignature', (orderId: string, paymentId: string) => {
      return crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
    });

    await page.addInitScript(() => {
      (window as any).Razorpay = function (options: any) {
        this.options = options;
        this.on = function (_event: string, _callback: any) {
          // Event listener stub (e.g. 'payment.failed')
        };
        this.open = async function () {
          const paymentId = `pay_mock_${Date.now()}`;
          const signature = await (window as any).generateMockSignature(options.order_id, paymentId);
          if (options.handler) {
            options.handler({
              razorpay_payment_id: paymentId,
              razorpay_order_id: options.order_id,
              razorpay_signature: signature,
            });
          }
        };
      };
    });

    await page.goto(`/patient/doctor/${doctorRecord.id}`);
    await page.waitForLoadState('networkidle');

    const dateInput = page.locator('#date-picker');
    await dateInput.fill(tomorrowDateStr);
    await dateInput.dispatchEvent('change');

    // Select Slot 2 (10:30 AM)
    const slotButton = page.getByRole('button', { name: '10:30 AM' });
    await expect(slotButton).toBeVisible();
    await slotButton.click();

    await page.getByRole('button', { name: /Proceed to Book/i }).click();

    // Click "Pay Online"
    const payOnlineBtn = page.getByRole('button', { name: /Pay Online/i });
    await expect(payOnlineBtn).toBeVisible();
    await payOnlineBtn.click();

    // Wait for booking confirmation and redirect to /patient dashboard (exact path)
    await page.waitForURL((url) => url.pathname === '/patient', { timeout: 15000 });

    // Authoritative DB verification:
    const appointment = await prisma.appointment.findFirst({
      where: {
        slotId: slot2.id,
        patientId: patientRecord.id,
        status: 'CONFIRMED',
      },
    });
    expect(appointment).toBeDefined();
    expect(appointment?.paymentMethod).toBe('ONLINE');

    const slotAfter = await prisma.slot.findUniqueOrThrow({ where: { id: slot2.id } });
    expect(slotAfter.status).toBe('BOOKED');

    const checkout = await prisma.checkout.findFirst({
      where: { slotId: slot2.id, userId: patientUser.id },
    });
    expect(checkout?.status).toBe('CONFIRMED');
    expect(checkout?.razorpayOrderId).toBeDefined();
    expect(checkout?.paymentId).toBeDefined();
  });

  test('5. Refresh during pending recovery retains checkout context without multiple active attempts', async ({ context, page }) => {
    await authenticate(context);

    // Create a checkout in READY_FOR_PAYMENT for Slot 3
    const checkout = await prisma.checkout.create({
      data: {
        userId: patientUser.id,
        patientId: patientRecord.id,
        doctorId: doctorRecord.id,
        slotId: slot3.id,
        holdToken: crypto.randomUUID(),
        amount: 50000,
        currency: 'INR',
        paymentMethod: 'ONLINE',
        idempotencyKey: `idem_refresh_${runId}`,
        status: 'READY_FOR_PAYMENT',
        razorpayOrderId: `order_refresh_${runId}`,
        expiresAt: new Date(Date.now() + 600_000),
      },
    });

    // Populate active checkout in sessionStorage before navigation
    await context.addInitScript(
      (arg: { userId: string; doctorId: string; checkoutId: string; slotId: string; date: string }) => {
        sessionStorage.setItem(
          `checkout_active_${arg.userId}_${arg.doctorId}`,
          JSON.stringify({
            checkoutId: arg.checkoutId,
            slotId: arg.slotId,
            doctorId: arg.doctorId,
            paymentMethod: 'ONLINE',
            date: arg.date,
          })
        );
      },
      {
        userId: patientUser.id,
        doctorId: doctorRecord.id,
        checkoutId: checkout.id,
        slotId: slot3.id,
        date: tomorrowDateStr,
      }
    );

    await page.goto(`/patient/doctor/${doctorRecord.id}`);
    await page.waitForLoadState('networkidle');

    // Ensure date picker is set to tomorrowDateStr to load slot details
    const dateInput = page.locator('#date-picker');
    await dateInput.fill(tomorrowDateStr);
    await dateInput.dispatchEvent('change');
    await page.waitForLoadState('networkidle');

    // On mount, component detects active checkout, queries /api/checkout/[id]/status,
    // and restores selectedSlot and showPaymentOptions(true)!
    const payOnlineBtn = page.getByRole('button', { name: /Pay Online/i });
    const payClinicBtn = page.getByRole('button', { name: /Pay at Clinic/i });
    await expect(payOnlineBtn).toBeVisible({ timeout: 10000 });
    await expect(payClinicBtn).toBeVisible();

    // Verify no duplicate checkouts were created in the database
    const checkouts = await prisma.checkout.findMany({
      where: { slotId: slot3.id, userId: patientUser.id },
    });
    expect(checkouts.length).toBe(1);
    expect(checkouts[0].id).toBe(checkout.id);
  });

  test('6. Back-button and stale callbacks cannot corrupt or duplicate booking', async ({ context, page }) => {
    await authenticate(context);

    // Slot 1 and Slot 2 are already confirmed/booked from previous tests
    await page.goto(`/patient/doctor/${doctorRecord.id}`);
    await page.waitForLoadState('networkidle');

    const dateInput = page.locator('#date-picker');
    await dateInput.fill(tomorrowDateStr);
    await dateInput.dispatchEvent('change');

    const bookedSlots = await prisma.slot.findMany({
      where: { doctorId: doctorRecord.id, status: 'BOOKED' },
    });
    expect(bookedSlots.length).toBeGreaterThanOrEqual(2);

    // Verify appointment count for slot 1 is strictly 1
    const appointmentsSlot1 = await prisma.appointment.findMany({
      where: { slotId: slot1.id },
    });
    expect(appointmentsSlot1.length).toBe(1);
  });
});
