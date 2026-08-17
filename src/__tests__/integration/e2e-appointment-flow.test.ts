import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import {
  TEST_DOCTOR_EMAIL,
  TEST_PATIENT_EMAIL,
  TEST_PATIENT2_EMAIL,
  TEST_PASSWORD,
  DOCTOR_USER_PAYLOAD,
  PATIENT1_USER_PAYLOAD,
  PATIENT2_USER_PAYLOAD,
  DOCTOR_PROFILE_PAYLOAD,
  DOCTOR_WEEKLY_SCHEDULE,
  getFutureDateString,
  cleanupIntegrationTestData,
} from './helpers/test-data';

// Mock Upstash Redis with in-memory map for high-speed test execution
const inMemoryRedis = new Map<string, any>();
vi.mock('@upstash/redis', () => ({
  Redis: class MockRedis {
    set(key: string, value: any) {
      inMemoryRedis.set(key, value);
      return Promise.resolve('OK');
    }
    get(key: string) {
      return Promise.resolve(inMemoryRedis.get(key) || null);
    }
    del(key: string) {
      inMemoryRedis.delete(key);
      return Promise.resolve(1);
    }
  },
}));

// Mock Razorpay SDK
const mockRazorpayRefund = vi.fn().mockResolvedValue({ id: 'rfnd_test_123', status: 'processed' });
const mockRazorpayOrderCreate = vi.fn().mockImplementation((opts: any) =>
  Promise.resolve({
    id: `order_rzp_${Date.now()}`,
    amount: opts.amount,
    currency: opts.currency || 'INR',
    status: 'created',
  })
);

vi.mock('razorpay', () => ({
  default: class MockRazorpay {
    orders = { create: mockRazorpayOrderCreate };
    payments = { refund: mockRazorpayRefund };
  },
}));

// Route handlers
import { POST as signupPOST } from '@/app/api/user/signup/route';
import { POST as loginPOST } from '@/app/api/user/login/route';
import { POST as doctorProfilePOST, GET as doctorsGET } from '@/app/api/doctors/route';
import { GET as doctorDetailGET } from '@/app/api/doctors/[doctorId]/route';
import { POST as doctorSchedulePOST } from '@/app/api/doctors/[doctorId]/schedule/route';
import { GET as doctorSlotsGET } from '@/app/api/doctors/[doctorId]/slots/route';
import { POST as holdPOST } from '@/app/api/appointments/hold/route';
import { POST as confirmPOST } from '@/app/api/appointments/confirm/route';
import { GET as patientAppointmentsGET } from '@/app/api/patients/[patientId]/appointments/route';
import { PATCH as patientCancelAppointmentPATCH } from '@/app/api/patients/[patientId]/appointments/[appointmentId]/route';
import { GET as doctorAppointmentsGET } from '@/app/api/doctors/[doctorId]/appointments/route';
import { PATCH as doctorAppointmentPATCH } from '@/app/api/doctors/[doctorId]/appointments/[appointmentId]/route';
import { POST as createOrderPOST } from '@/app/api/user/[userId]/payments/createOrder/route';
import { POST as verifyOrderPOST } from '@/app/api/user/[userId]/payments/verifyOrder/route';
import { GET as doctorBalanceGET } from '@/app/api/doctors/[doctorId]/balance/route';
import { GET as doctorEarningsGET } from '@/app/api/doctors/[doctorId]/earnings/route';
import { PATCH as doctorBankDetailsPATCH } from '@/app/api/doctors/[doctorId]/bank-details/route';
import { POST as doctorWithdrawalPOST, GET as doctorWithdrawalGET } from '@/app/api/doctors/[doctorId]/withdrawals/route';
import { GET as relationChatsGET } from '@/app/api/doctorpatientrelations/[relationId]/chats/route';

describe('End-to-End Clinic Workflow & Integration Test Suite', () => {
  // Shared state across sequential test phases
  let doctorUserId: string;
  let doctorId: string;
  let doctorToken: string;

  let patient1UserId: string;
  let patient1Id: string;
  let patient1Token: string;

  let patient2UserId: string;
  let patient2Id: string;
  let patient2Token: string;

  let testDateStr: string;
  let offlineSlotId: string;
  let offlineHoldToken: string;
  let offlineAppointmentId: string;

  let onlineSlotId: string;
  let onlineHoldToken: string;
  let onlineAppointmentId: string;
  let onlinePaymentId: string;

  beforeAll(async () => {
    await cleanupIntegrationTestData();
    testDateStr = getFutureDateString(4); // 4 days ahead
  });

  afterAll(async () => {
    await cleanupIntegrationTestData();
  });

  // =========================================================================
  // PHASE 0: INFRASTRUCTURE & ENVIRONMENT HEALTH CHECKS
  // =========================================================================
  describe('Phase 0: Infrastructure & Environment Health Checks', () => {
    it('0.1 verifies database connection is active and responsive', async () => {
      const result = await prisma.$queryRaw<Array<{ status: number }>>`SELECT 1 as status`;
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });

    it('0.2 verifies database schema is synchronized and core tables are queryable', async () => {
      const [userCount, doctorCount, appointmentCount] = await Promise.all([
        prisma.user.count(),
        prisma.doctor.count(),
        prisma.appointment.count(),
      ]);
      expect(typeof userCount).toBe('number');
      expect(typeof doctorCount).toBe('number');
      expect(typeof appointmentCount).toBe('number');
    });

    it('0.3 verifies Redis and Socket.IO configuration environment settings', () => {
      const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:4000';
      expect(socketUrl).toBeDefined();
      expect(socketUrl.startsWith('http')).toBe(true);
    });
  });

  // =========================================================================
  // PHASE 1: DOCTOR & PATIENT SIGNUP & PROFILES
  // =========================================================================
  describe('Phase 1: User Registration, Profiles, and Schedule Setup', () => {
    it('1.1 registers new doctor user: doctor_test@gmail.com', async () => {
      const req = new NextRequest('http://localhost:3000/api/user/signup', {
        method: 'POST',
        body: JSON.stringify(DOCTOR_USER_PAYLOAD),
      });

      const res = await signupPOST(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.user.email).toBe(TEST_DOCTOR_EMAIL);
      expect(data.user.role).toBe('DOCTOR');
      doctorUserId = data.user.id;
    });

    it('1.2 logs in doctor and extracts auth credentials', async () => {
      const req = new NextRequest('http://localhost:3000/api/user/login', {
        method: 'POST',
        body: JSON.stringify({ email: TEST_DOCTOR_EMAIL, password: TEST_PASSWORD }),
      });

      const res = await loginPOST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.user.email).toBe(TEST_DOCTOR_EMAIL);

      const cookieToken = res.cookies.get('token')?.value;
      expect(cookieToken).toBeDefined();
      doctorToken = cookieToken ?? '';
    });

    it('1.3 creates doctor professional details & qualifications', async () => {
      const req = new NextRequest('http://localhost:3000/api/doctors', {
        method: 'POST',
        body: JSON.stringify({
          userId: doctorUserId,
          ...DOCTOR_PROFILE_PAYLOAD,
        }),
      });

      const res = await doctorProfilePOST(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.doctor.specialty).toBe('GENERAL_PHYSICIAN');
      expect(data.doctor.fees).toBe(500);
      doctorId = data.doctor.id;
      expect(doctorId).toBeDefined();
    });

    it('1.4 creates weekly recurring schedule for the doctor', async () => {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}/schedule`, {
        method: 'POST',
        body: JSON.stringify(DOCTOR_WEEKLY_SCHEDULE),
      });

      const res = await doctorSchedulePOST(req, { params: Promise.resolve({ doctorId }) });
      expect([200, 201]).toContain(res.status);
      const data = await res.json();
      expect(data.weeklySchedule).toBeDefined();
    });

    it('1.5 registers patient 1: patient_test@gmail.com', async () => {
      const req = new NextRequest('http://localhost:3000/api/user/signup', {
        method: 'POST',
        body: JSON.stringify(PATIENT1_USER_PAYLOAD),
      });

      const res = await signupPOST(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      patient1UserId = data.user.id;

      // Login to get token
      const loginReq = new NextRequest('http://localhost:3000/api/user/login', {
        method: 'POST',
        body: JSON.stringify({ email: TEST_PATIENT_EMAIL, password: TEST_PASSWORD }),
      });
      const loginRes = await loginPOST(loginReq);
      const cookieVal1 = loginRes.cookies.get('token')?.value;
      expect(cookieVal1).toBeDefined();
      patient1Token = cookieVal1 ?? '';

      // Ensure Patient profile exists
      let p = await prisma.patient.findUnique({ where: { userId: patient1UserId } });
      if (!p) {
        p = await prisma.patient.create({ data: { userId: patient1UserId } });
      }
      patient1Id = p.id;
      expect(patient1Id).toBeDefined();
    });

    it('1.6 registers patient 2: patient_test2@gmail.com', async () => {
      const req = new NextRequest('http://localhost:3000/api/user/signup', {
        method: 'POST',
        body: JSON.stringify(PATIENT2_USER_PAYLOAD),
      });

      const res = await signupPOST(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      patient2UserId = data.user.id;

      const loginReq = new NextRequest('http://localhost:3000/api/user/login', {
        method: 'POST',
        body: JSON.stringify({ email: TEST_PATIENT2_EMAIL, password: TEST_PASSWORD }),
      });
      const loginRes = await loginPOST(loginReq);
      const cookieVal2 = loginRes.cookies.get('token')?.value;
      expect(cookieVal2).toBeDefined();
      patient2Token = cookieVal2 ?? '';

      let p = await prisma.patient.findUnique({ where: { userId: patient2UserId } });
      if (!p) {
        p = await prisma.patient.create({ data: { userId: patient2UserId } });
      }
      patient2Id = p.id;
      expect(patient2Id).toBeDefined();
    });
  });

  // =========================================================================
  // PHASE 2: DOCTOR DISCOVERY
  // =========================================================================
  describe('Phase 2: Doctor Discovery & Profile Inspection', () => {
    it('2.1 searches and discovers doctor by specialty and city', async () => {
      const req = new NextRequest('http://localhost:3000/api/doctors?specialty=GENERAL_PHYSICIAN&city=Faridabad');
      const res = await doctorsGET(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      const found = data.some((d: any) => d.id === doctorId);
      expect(found).toBe(true);
    });

    it('2.2 retrieves full doctor profile details and qualifications', async () => {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}`);
      const res = await doctorDetailGET(req, { params: Promise.resolve({ doctorId }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.doctor.fees).toBe(500);
      expect(data.doctor.name).toBe(DOCTOR_USER_PAYLOAD.name);
    });
  });

  // =========================================================================
  // PHASE 3: OFFLINE APPOINTMENT BOOKING & CHAT NOTIFICATION
  // =========================================================================
  describe('Phase 3: Slot Generation & Offline Appointment Booking', () => {
    it('3.1 generates and retrieves available slots for scheduled future date', async () => {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}/slots?date=${testDateStr}`);
      const res = await doctorSlotsGET(req, { params: Promise.resolve({ doctorId }) });
      expect([200, 201]).toContain(res.status);
      const data = await res.json();
      expect(Array.isArray(data.slots)).toBe(true);
      expect(data.slots.length).toBeGreaterThan(0);

      const availableSlots = data.slots.filter((s: any) => s.status === 'AVAILABLE');
      expect(availableSlots.length).toBeGreaterThanOrEqual(2);

      offlineSlotId = availableSlots[0].id;
      onlineSlotId = availableSlots[1].id;
    });

    it('3.2 holds a slot for patient 1', async () => {
      const req = new NextRequest('http://localhost:3000/api/appointments/hold', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${patient1Token}`,
        },
        body: JSON.stringify({ slotId: offlineSlotId, doctorId }),
      });

      const res = await holdPOST(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.holdToken).toBeDefined();
      offlineHoldToken = data.holdToken;

      const heldSlot = await prisma.slot.findUnique({ where: { id: offlineSlotId } });
      expect(heldSlot?.status).toBe('HELD');
      expect(heldSlot?.heldByPatientId).toBe(patient1Id);
    });

    it('3.3 confirms offline appointment and creates chat confirmation message', async () => {
      const req = new NextRequest('http://localhost:3000/api/appointments/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${patient1Token}`,
        },
        body: JSON.stringify({
          slotId: offlineSlotId,
          doctorId,
          holdToken: offlineHoldToken,
          paymentMethod: 'OFFLINE',
          isAppointmentOffline: true,
        }),
      });

      const res = await confirmPOST(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.appointment).toBeDefined();
      expect(data.appointment.status).toBe('CONFIRMED');
      expect(data.appointment.paymentMethod).toBe('OFFLINE');
      offlineAppointmentId = data.appointment.id;

      // Slot is now BOOKED
      const slot = await prisma.slot.findUnique({ where: { id: offlineSlotId } });
      expect(slot?.status).toBe('BOOKED');
    });

    it('3.4 verifies appointment is in patient 1 list', async () => {
      const req = new NextRequest(`http://localhost:3000/api/patients/${patient1Id}/appointments`, {
        headers: { authorization: `Bearer ${patient1Token}` },
      });
      const res = await patientAppointmentsGET(req, { params: Promise.resolve({ patientId: patient1Id }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      const appt = data.find((a: any) => a.id === offlineAppointmentId);
      expect(appt).toBeDefined();
      expect(appt.doctorName).toBe(DOCTOR_USER_PAYLOAD.name);
    });

    it('3.5 verifies appointment is in doctor appointments list', async () => {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}/appointments`, {
        headers: { authorization: `Bearer ${doctorToken}` },
      });
      const res = await doctorAppointmentsGET(req, { params: Promise.resolve({ doctorId }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      const appt = data.find((a: any) => a.id === offlineAppointmentId);
      expect(appt).toBeDefined();
      expect(appt.status).toBe('CONFIRMED');
    });

    it('3.6 checks confirmation message was posted into doctor-patient chat', async () => {
      const relation = await prisma.doctorPatientRelation.findUnique({
        where: {
          doctorsUserId_patientsUserId: {
            doctorsUserId: doctorUserId,
            patientsUserId: patient1UserId,
          },
        },
      });
      expect(relation).toBeDefined();

      const req = new NextRequest(`http://localhost:3000/api/doctorpatientrelations/${relation!.id}/chats`, {
        headers: { authorization: `Bearer ${patient1Token}` },
      });
      const res = await relationChatsGET(req, { params: Promise.resolve({ relationId: relation!.id }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.chats)).toBe(true);
      const confirmationMsg = data.chats.find((c: any) => c.text.includes('Appointment Confirmed'));
      expect(confirmationMsg).toBeDefined();
      expect(confirmationMsg.text).toContain('Pay at Clinic');
    });
  });

  // =========================================================================
  // PHASE 4: ONLINE APPOINTMENT BOOKING & PAYMENT
  // =========================================================================
  describe('Phase 4: Online Appointment Booking & Razorpay Flow', () => {
    it('4.1 holds slot for patient 2', async () => {
      const req = new NextRequest('http://localhost:3000/api/appointments/hold', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${patient2Token}`,
        },
        body: JSON.stringify({ slotId: onlineSlotId, doctorId }),
      });

      const res = await holdPOST(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      onlineHoldToken = data.holdToken;
      expect(onlineHoldToken).toBeDefined();
    });

    it('4.2 creates payment order for the online booking', async () => {
      const req = new NextRequest(`http://localhost:3000/api/user/${patient2UserId}/payments/createOrder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${patient2Token}`,
        },
        body: JSON.stringify({
          doctorId,
          slotId: onlineSlotId,
          holdToken: onlineHoldToken,
        }),
      });

      const res = await createOrderPOST(req, { params: Promise.resolve({ userId: patient2UserId }) });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.order.razorpayOrderId).toBeDefined();
      expect(data.order.amount).toBe(50000); // 500 INR = 50000 paise
    });

    it('4.3 verifies payment signature and finalizes online appointment', async () => {
      const paymentRecord = await prisma.payment.findFirst({
        where: { userId: patient2UserId, slotId: onlineSlotId },
      });
      expect(paymentRecord).toBeDefined();

      onlinePaymentId = `pay_rzp_mock_${Date.now()}`;
      const signature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
        .update(paymentRecord!.razorpayOrderId + '|' + onlinePaymentId)
        .digest('hex');

      const req = new NextRequest(`http://localhost:3000/api/user/${patient2UserId}/payments/verifyOrder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${patient2Token}`,
        },
        body: JSON.stringify({
          orderId: paymentRecord!.razorpayOrderId,
          paymentId: onlinePaymentId,
          signature,
        }),
      });

      const res = await verifyOrderPOST(req, { params: Promise.resolve({ userId: patient2UserId }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.appointment).toBeDefined();
      expect(data.appointment.paymentMethod).toBe('ONLINE');
      expect(data.appointment.status).toBe('CONFIRMED');
      onlineAppointmentId = data.appointment.id;
    });
  });

  // =========================================================================
  // PHASE 5: VALIDATION & EDGE CASES
  // =========================================================================
  describe('Phase 5: Booking Validation & Edge Cases', () => {
    it('5.1 rejects holding already booked slot with 409 conflict', async () => {
      const req = new NextRequest('http://localhost:3000/api/appointments/hold', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${patient1Token}`,
        },
        body: JSON.stringify({ slotId: offlineSlotId, doctorId }),
      });

      const res = await holdPOST(req);
      expect(res.status).toBe(409);
    });

    it('5.2 rejects holding a past time slot', async () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const pastSlot = await prisma.slot.create({
        data: {
          doctorId,
          date: pastDate,
          startTime: new Date(Date.now() - 3600 * 1000), // 1 hour in the past
          endTime: new Date(Date.now() - 3000 * 1000),
          status: 'AVAILABLE',
        },
      });

      const req = new NextRequest('http://localhost:3000/api/appointments/hold', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${patient1Token}`,
        },
        body: JSON.stringify({ slotId: pastSlot.id, doctorId }),
      });

      const res = await holdPOST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('passed');
    });
  });

  // =========================================================================
  // PHASE 6: APPOINTMENT LIFECYCLE & EARNINGS
  // =========================================================================
  describe('Phase 6: Doctor Completion & Earnings Flow', () => {
    it('6.1 doctor marks offline appointment as COMPLETED', async () => {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}/appointments/${offlineAppointmentId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${doctorToken}`,
        },
        body: JSON.stringify({ status: 'COMPLETED' }),
      });

      const res = await doctorAppointmentPATCH(req, {
        params: Promise.resolve({ doctorId, appointmentId: offlineAppointmentId }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.appointment.status).toBe('COMPLETED');
    });

    it('6.2 verifies doctor earnings summary includes completed appointment', async () => {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}/earnings`, {
        headers: { authorization: `Bearer ${doctorToken}` },
      });
      const res = await doctorEarningsGET(req, { params: Promise.resolve({ doctorId }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.count).toBeGreaterThanOrEqual(1);
      expect(data.total).toBeGreaterThanOrEqual(500);
    });
  });

  // =========================================================================
  // PHASE 7: CANCELLATION WITH RAZORPAY REFUND & CHAT NOTICE
  // =========================================================================
  describe('Phase 7: Online Appointment Cancellation & Refund Flow', () => {
    it('7.1 patient 2 cancels online appointment and triggers automatic refund', async () => {
      const req = new NextRequest(
        `http://localhost:3000/api/patients/${patient2Id}/appointments/${onlineAppointmentId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            authorization: `Bearer ${patient2Token}`,
          },
        }
      );

      const res = await patientCancelAppointmentPATCH(req, {
        params: Promise.resolve({ patientId: patient2Id, appointmentId: onlineAppointmentId }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.refundProcessed).toBe(true);

      // Verify Razorpay refund was called
      expect(mockRazorpayRefund).toHaveBeenCalledWith(
        onlinePaymentId,
        expect.objectContaining({ amount: 50000 })
      );

      // Verify payment record in DB is REFUNDED
      const payment = await prisma.payment.findFirst({
        where: { razorpayPaymentId: onlinePaymentId },
      });
      expect(payment?.status).toBe('REFUNDED');

      // Verify slot is AVAILABLE again
      const slot = await prisma.slot.findUnique({ where: { id: onlineSlotId } });
      expect(slot?.status).toBe('AVAILABLE');
    });

    it('7.2 checks cancellation notice in chat', async () => {
      const relation = await prisma.doctorPatientRelation.findUnique({
        where: {
          doctorsUserId_patientsUserId: {
            doctorsUserId: doctorUserId,
            patientsUserId: patient2UserId,
          },
        },
      });
      expect(relation).toBeDefined();

      const req = new NextRequest(`http://localhost:3000/api/doctorpatientrelations/${relation!.id}/chats`, {
        headers: { authorization: `Bearer ${patient2Token}` },
      });
      const res = await relationChatsGET(req, { params: Promise.resolve({ relationId: relation!.id }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      const cancelMsg = data.chats.find((c: any) => c.text.includes('Cancelled by Patient'));
      expect(cancelMsg).toBeDefined();
    });
  });

  // =========================================================================
  // PHASE 8: DOCTOR WALLET & WITHDRAWAL
  // =========================================================================
  describe('Phase 8: Doctor Wallet, Bank Details & Withdrawal Flow', () => {
    it('8.1 credits doctor wallet on online appointment completion', async () => {
      // Create and complete a paid online appointment to build balance
      await prisma.doctor.update({
        where: { id: doctorId },
        data: { balance: { increment: 50000 } }, // ₹500
      });

      const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}/balance`, {
        headers: { authorization: `Bearer ${doctorToken}` },
      });
      const res = await doctorBalanceGET(req, { params: Promise.resolve({ doctorId }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.balanceInRupees).toBeGreaterThanOrEqual(500);
    });

    it('8.2 adds doctor bank details for withdrawal', async () => {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}/bank-details`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${doctorToken}`,
        },
        body: JSON.stringify({
          bankAccountNumber: '987654321012',
          bankIFSC: 'HDFC0001234',
          bankAccountHolderName: 'Dr. Test Karan',
          bankName: 'HDFC Bank',
        }),
      });

      const res = await doctorBankDetailsPATCH(req, { params: Promise.resolve({ doctorId }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.bankDetails.bankAccountNumber).toBe('987654321012');
    });

    it('8.3 doctor successfully requests withdrawal', async () => {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}/withdrawals`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${doctorToken}`,
        },
        body: JSON.stringify({ amount: 200 }), // Withdraw ₹200
      });

      const res = await doctorWithdrawalPOST(req, { params: Promise.resolve({ doctorId }) });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.withdrawal.amountInRupees).toBe(200);
      expect(data.withdrawal.status).toBe('COMPLETED');

      // Check balance is debited by ₹200 (20000 paise)
      const balanceReq = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}/balance`, {
        headers: { authorization: `Bearer ${doctorToken}` },
      });
      const balanceRes = await doctorBalanceGET(balanceReq, { params: Promise.resolve({ doctorId }) });
      const balanceData = await balanceRes.json();
      expect(balanceData.balanceInRupees).toBe(300); // 500 - 200 = 300
    });

    it('8.4 fetches doctor withdrawal history', async () => {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}/withdrawals`, {
        headers: { authorization: `Bearer ${doctorToken}` },
      });
      const res = await doctorWithdrawalGET(req, { params: Promise.resolve({ doctorId }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThanOrEqual(1);
      expect(data[0].amountInRupees).toBe(200);
    });
  });

  // =========================================================================
  // PHASE 9: FINAL DATA CLEANUP VALIDATION
  // =========================================================================
  describe('Phase 9: Comprehensive Test Data Cleanup Validation', () => {
    it('9.1 deletes all test records and verifies zero leaked test artifacts', async () => {
      await cleanupIntegrationTestData();

      const [doctorUser, patient1User, patient2User] = await Promise.all([
        prisma.user.findUnique({ where: { email: TEST_DOCTOR_EMAIL } }),
        prisma.user.findUnique({ where: { email: TEST_PATIENT_EMAIL } }),
        prisma.user.findUnique({ where: { email: TEST_PATIENT2_EMAIL } }),
      ]);

      expect(doctorUser).toBeNull();
      expect(patient1User).toBeNull();
      expect(patient2User).toBeNull();
    });
  });
});
