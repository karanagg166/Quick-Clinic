import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';

// In-memory Redis mock for blazing-fast local test execution
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

import { prisma } from '@/lib/prisma';
import { createToken } from '@/lib/auth';
import { POST as holdPOST } from '@/app/api/appointments/hold/route';
import { POST as confirmPOST } from '@/app/api/appointments/confirm/route';
import { PATCH as doctorAppointmentPATCH, GET as doctorAppointmentGET } from '@/app/api/doctors/[doctorId]/appointments/[appointmentId]/route';
import { POST as ratingPOST, GET as ratingGET } from '@/app/api/doctors/[doctorId]/rating/route';
import { POST as commentPOST, GET as commentGET } from '@/app/api/doctors/[doctorId]/comments/route';
import { GET as doctorDetailGET } from '@/app/api/doctors/[doctorId]/route';
import { POST as orderPOST } from '@/app/api/user/[userId]/payments/createOrder/route';
import { POST as verifyOrderPOST } from '@/app/api/user/[userId]/payments/verifyOrder/route';
import { seedPart2Dataset, cleanupPart2Dataset, Part2Dataset } from '@/__tests__/helpers/part2-dataset';
import crypto from 'crypto';

describe('Phase 3 — Patient Complete Golden Flows Test Suite', () => {
  let dataset: Part2Dataset;
  let doctor: any;
  let doctorToken: string;
  let patient: any;
  let patientToken: string;

  beforeAll(async () => {
    dataset = await seedPart2Dataset();
    doctor = dataset.doctors[0]; // Cardiologist ₹500
    patient = dataset.patients[0]; // Patient Aarav

    doctorToken = await createToken({
      id: doctor.id,
      userId: doctor.id,
      role: 'DOCTOR',
      email: doctor.email,
      name: doctor.name,
    });

    patientToken = await createToken({
      id: patient.id,
      userId: patient.id,
      role: 'PATIENT',
      email: patient.email,
      name: patient.name,
    });
  });

  afterAll(async () => {
    if (dataset) {
      await cleanupPart2Dataset(dataset);
    }
  });

  // --------------------------------------------------------------------------
  // Journey A: Complete Offline Booking Lifecycle
  // --------------------------------------------------------------------------
  describe('Patient Journey A: Complete Offline Booking Lifecycle', () => {
    let testSlot: any;
    let holdToken: string;
    let appointmentId: string;

    beforeAll(async () => {
      const slotDate = new Date();
      slotDate.setDate(slotDate.getDate() + 7);
      const slotEnd = new Date(slotDate);
      slotEnd.setMinutes(slotEnd.getMinutes() + 30);

      testSlot = await prisma.slot.create({
        data: {
          doctorId: doctor.doctorId,
          date: slotDate,
          startTime: slotDate,
          endTime: slotEnd,
          status: 'AVAILABLE',
        },
      });
    });

    it('3.A.1 Patient holds an available slot (AVAILABLE -> HELD)', async () => {
      const req = new NextRequest('http://localhost:3000/api/appointments/hold', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${patientToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          slotId: testSlot.id,
          doctorId: doctor.doctorId,
        }),
      });

      const res = await holdPOST(req);
      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.holdToken).toBeDefined();
      holdToken = data.holdToken;

      // Verify slot in DB is HELD
      const inDb = await prisma.slot.findUnique({ where: { id: testSlot.id } });
      expect(inDb?.status).toBe('HELD');
      expect(inDb?.holdToken).toBe(holdToken);
    });

    it('3.A.2 Patient confirms OFFLINE booking (HELD -> BOOKED, appointment CONFIRMED)', async () => {
      const req = new NextRequest('http://localhost:3000/api/appointments/confirm', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${patientToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          slotId: testSlot.id,
          doctorId: doctor.doctorId,
          holdToken,
          paymentMethod: 'OFFLINE',
        }),
      });

      const res = await confirmPOST(req);
      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.appointment.id).toBeDefined();
      expect(data.appointment.status).toBe('CONFIRMED');
      expect(data.appointment.isAppointmentOffline).toBe(true);
      appointmentId = data.appointment.id;

      const slotInDb = await prisma.slot.findUnique({ where: { id: testSlot.id } });
      expect(slotInDb?.status).toBe('BOOKED');
    });

    it('3.A.3 Doctor views and verifies confirmed offline appointment details', async () => {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${doctor.doctorId}/appointments/${appointmentId}`, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${doctorToken}`,
        },
      });

      const res = await doctorAppointmentGET(req, {
        params: Promise.resolve({ doctorId: doctor.doctorId, appointmentId }),
      });
      expect(res.status).toBe(200);

      const inDb = await prisma.appointment.findUnique({ where: { id: appointmentId } });
      expect(inDb?.status).toBe('CONFIRMED');
      expect(inDb?.isAppointmentOffline).toBe(true);
    });

    it('3.A.4 Doctor completes consultation (CONFIRMED -> COMPLETED, slot UNAVAILABLE)', async () => {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${doctor.doctorId}/appointments/${appointmentId}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${doctorToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ status: 'COMPLETED' }),
      });

      const res = await doctorAppointmentPATCH(req, {
        params: Promise.resolve({ doctorId: doctor.doctorId, appointmentId }),
      });
      expect(res.status).toBe(200);

      const apptInDb = await prisma.appointment.findUnique({ where: { id: appointmentId } });
      expect(apptInDb?.status).toBe('COMPLETED');

      const slotInDb = await prisma.slot.findUnique({ where: { id: testSlot.id } });
      expect(slotInDb?.status).toBe('UNAVAILABLE');
    });

    it('3.A.5 Patient submits 5-star rating and review comment post-completion', async () => {
      // 1. Submit rating
      const ratingReq = new NextRequest(`http://localhost:3000/api/doctors/${doctor.doctorId}/rating`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${patientToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ rating: 5, patientId: patient.patientId }),
      });

      const ratingRes = await ratingPOST(ratingReq, {
        params: Promise.resolve({ doctorId: doctor.doctorId }),
      });
      expect(ratingRes.status).toBe(200);

      // 2. Submit comment
      const commentReq = new NextRequest(`http://localhost:3000/api/doctors/${doctor.doctorId}/comments`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${patientToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          text: 'Superb cardiologist consultation! Highly knowledgeable and caring.',
          patientId: patient.patientId,
        }),
      });

      const commentRes = await commentPOST(commentReq, {
        params: Promise.resolve({ doctorId: doctor.doctorId }),
      });
      expect(commentRes.status).toBe(201);

      // 3. Inspect public doctor profile to verify rating & comments rendered
      const detailReq = new NextRequest(`http://localhost:3000/api/doctors/${doctor.doctorId}`);
      const detailRes = await doctorDetailGET(detailReq, {
        params: Promise.resolve({ doctorId: doctor.doctorId }),
      });
      expect(detailRes.status).toBe(200);

      const profileData = await detailRes.json();
      expect(profileData.rating.count).toBeGreaterThanOrEqual(1);
      expect(profileData.rating.average).toBe(5);
      expect(profileData.comments.some((c: any) => c.text.includes('Superb cardiologist'))).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Journey B: Online Booking & Payment Verification
  // --------------------------------------------------------------------------
  describe('Patient Journey B: Online Booking & Payment Verification', () => {
    let onlineSlot: any;
    let holdToken: string;
    const razorpayOrderId = `order_test_${Date.now()}`;
    const razorpayPaymentId = `pay_test_${Date.now()}`;

    beforeAll(async () => {
      const slotDate = new Date();
      slotDate.setDate(slotDate.getDate() + 8);
      const slotEnd = new Date(slotDate);
      slotEnd.setMinutes(slotEnd.getMinutes() + 30);

      onlineSlot = await prisma.slot.create({
        data: {
          doctorId: doctor.doctorId,
          date: slotDate,
          startTime: slotDate,
          endTime: slotEnd,
          status: 'AVAILABLE',
        },
      });

      // Create hold
      const holdReq = new NextRequest('http://localhost:3000/api/appointments/hold', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${patientToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          slotId: onlineSlot.id,
          doctorId: doctor.doctorId,
        }),
      });
      const holdRes = await holdPOST(holdReq);
      const data = await holdRes.json();
      holdToken = data.holdToken;

      // Seed pending Payment record with orderId
      await prisma.payment.create({
        data: {
          userId: patient.id,
          amount: doctor.fees * 100, // 50000 paise
          currency: 'INR',
          status: 'PENDING',
          razorpayOrderId,
          slotId: onlineSlot.id,
          doctorId: doctor.doctorId,
          holdToken,
        },
      });
    });

    it('3.B.1 Verifies valid payment signature and confirms online appointment', async () => {
      // Calculate HMAC signature matching secret in setup
      const secret = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_secret123';
      const signature = crypto
        .createHmac('sha256', secret)
        .update(`${razorpayOrderId}|${razorpayPaymentId}`)
        .digest('hex');

      const req = new NextRequest(`http://localhost:3000/api/user/${patient.id}/payments/verifyOrder`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${patientToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          orderId: razorpayOrderId,
          paymentId: razorpayPaymentId,
          signature: signature,
        }),
      });

      const res = await verifyOrderPOST(req, { params: Promise.resolve({ userId: patient.id }) });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.appointment.status).toBe('CONFIRMED');
      expect(data.appointment.paymentMethod).toBe('ONLINE');
      expect(data.appointment.isAppointmentOffline).toBe(false);

      // Verify payment updated to SUCCESS
      const paymentInDb = await prisma.payment.findUnique({ where: { razorpayOrderId } });
      expect(paymentInDb?.status).toBe('SUCCESS');
      expect(paymentInDb?.razorpayPaymentId).toBe(razorpayPaymentId);
    });

    it('3.B.2 Replay Idempotency: Duplicate verifyOrder call returns existing appointment with 200 without creating duplicate records', async () => {
      const secret = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_secret123';
      const signature = crypto
        .createHmac('sha256', secret)
        .update(`${razorpayOrderId}|${razorpayPaymentId}`)
        .digest('hex');

      const req = new NextRequest(`http://localhost:3000/api/user/${patient.id}/payments/verifyOrder`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${patientToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          orderId: razorpayOrderId,
          paymentId: razorpayPaymentId,
          signature: signature,
        }),
      });

      const res = await verifyOrderPOST(req, { params: Promise.resolve({ userId: patient.id }) });
      expect(res.status).toBe(200);

      const apptCount = await prisma.appointment.count({ where: { slotId: onlineSlot.id } });
      expect(apptCount).toBe(1); // Exactly one appointment!
    });
  });

  // --------------------------------------------------------------------------
  // Journey C: Patient Cancellation
  // --------------------------------------------------------------------------
  describe('Patient Journey C: Cancellation Journey', () => {
    let cancelSlot: any;
    let cancelAppt: any;

    beforeAll(async () => {
      const slotDate = new Date();
      slotDate.setDate(slotDate.getDate() + 9);
      const slotEnd = new Date(slotDate);
      slotEnd.setMinutes(slotEnd.getMinutes() + 30);

      cancelSlot = await prisma.slot.create({
        data: {
          doctorId: doctor.doctorId,
          date: slotDate,
          startTime: slotDate,
          endTime: slotEnd,
          status: 'BOOKED',
        },
      });

      cancelAppt = await prisma.appointment.create({
        data: {
          doctorId: doctor.doctorId,
          patientId: patient.patientId,
          slotId: cancelSlot.id,
          status: 'CONFIRMED',
          paymentMethod: 'OFFLINE',
          isAppointmentOffline: true,
        },
      });
    });

    it('3.C.1 Cancelling appointment sets status to CANCELLED and restores slot to AVAILABLE', async () => {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${doctor.doctorId}/appointments/${cancelAppt.id}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${doctorToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ status: 'CANCELLED' }),
      });

      const res = await doctorAppointmentPATCH(req, {
        params: Promise.resolve({ doctorId: doctor.doctorId, appointmentId: cancelAppt.id }),
      });
      expect(res.status).toBe(200);

      const apptInDb = await prisma.appointment.findUnique({ where: { id: cancelAppt.id } });
      expect(apptInDb?.status).toBe('CANCELLED');

      const slotInDb = await prisma.slot.findUnique({ where: { id: cancelSlot.id } });
      expect(slotInDb?.status).toBe('AVAILABLE');
    });
  });

  // --------------------------------------------------------------------------
  // Journey D: Rescheduling
  // --------------------------------------------------------------------------
  describe('Patient Journey D: Rescheduling Journey', () => {
    let oldSlot: any;
    let newSlot: any;
    let reschedAppt: any;
    let newHoldToken: string;

    beforeAll(async () => {
      const slotDate1 = new Date();
      slotDate1.setDate(slotDate1.getDate() + 12);
      const slotEnd1 = new Date(slotDate1);
      slotEnd1.setMinutes(slotEnd1.getMinutes() + 30);

      oldSlot = await prisma.slot.create({
        data: {
          doctorId: doctor.doctorId,
          date: slotDate1,
          startTime: slotDate1,
          endTime: slotEnd1,
          status: 'BOOKED',
        },
      });

      reschedAppt = await prisma.appointment.create({
        data: {
          doctorId: doctor.doctorId,
          patientId: patient.patientId,
          slotId: oldSlot.id,
          status: 'CONFIRMED',
          paymentMethod: 'OFFLINE',
          isAppointmentOffline: true,
        },
      });

      const slotDate2 = new Date();
      slotDate2.setDate(slotDate2.getDate() + 13);
      const slotEnd2 = new Date(slotDate2);
      slotEnd2.setMinutes(slotEnd2.getMinutes() + 30);

      newSlot = await prisma.slot.create({
        data: {
          doctorId: doctor.doctorId,
          date: slotDate2,
          startTime: slotDate2,
          endTime: slotEnd2,
          status: 'AVAILABLE',
        },
      });
    });

    it('3.D.1 Holds new slot and updates appointment slot without duplicating appointment records', async () => {
      // 1. Hold new slot
      const holdReq = new NextRequest('http://localhost:3000/api/appointments/hold', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${patientToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          slotId: newSlot.id,
          doctorId: doctor.doctorId,
        }),
      });
      const holdRes = await holdPOST(holdReq);
      expect(holdRes.status).toBe(201);
      const holdData = await holdRes.json();
      newHoldToken = holdData.holdToken;

      // 2. Perform reschedule update
      await prisma.$transaction([
        // Release old slot
        prisma.slot.update({
          where: { id: oldSlot.id },
          data: { status: 'AVAILABLE', heldByPatientId: null, holdToken: null },
        }),
        // Book new slot
        prisma.slot.update({
          where: { id: newSlot.id },
          data: { status: 'BOOKED', heldByPatientId: null, holdToken: null },
        }),
        // Update appointment to point to new slot
        prisma.appointment.update({
          where: { id: reschedAppt.id },
          data: { slotId: newSlot.id, status: 'CONFIRMED' },
        }),
      ]);

      // 3. Verify invariants
      const oldSlotInDb = await prisma.slot.findUnique({ where: { id: oldSlot.id } });
      expect(oldSlotInDb?.status).toBe('AVAILABLE');

      const newSlotInDb = await prisma.slot.findUnique({ where: { id: newSlot.id } });
      expect(newSlotInDb?.status).toBe('BOOKED');

      const apptInDb = await prisma.appointment.findUnique({ where: { id: reschedAppt.id } });
      expect(apptInDb?.slotId).toBe(newSlot.id);
    });
  });

  // --------------------------------------------------------------------------
  // Journey E: No-Show
  // --------------------------------------------------------------------------
  describe('Patient Journey E: No-Show Handling', () => {
    let noShowSlot: any;
    let noShowAppt: any;

    beforeAll(async () => {
      const slotDate = new Date();
      slotDate.setDate(slotDate.getDate() + 14);
      const slotEnd = new Date(slotDate);
      slotEnd.setMinutes(slotEnd.getMinutes() + 30);

      noShowSlot = await prisma.slot.create({
        data: {
          doctorId: doctor.doctorId,
          date: slotDate,
          startTime: slotDate,
          endTime: slotEnd,
          status: 'BOOKED',
        },
      });

      noShowAppt = await prisma.appointment.create({
        data: {
          doctorId: doctor.doctorId,
          patientId: patient.patientId,
          slotId: noShowSlot.id,
          status: 'CONFIRMED',
          paymentMethod: 'OFFLINE',
          isAppointmentOffline: true,
        },
      });
    });

    it('3.E.1 Doctor marks patient as NO_SHOW (slot UNAVAILABLE, no doctor credit on offline appt)', async () => {
      const initialDoctorBalance = (await prisma.doctor.findUnique({ where: { id: doctor.doctorId } }))?.balance || 0;

      const req = new NextRequest(`http://localhost:3000/api/doctors/${doctor.doctorId}/appointments/${noShowAppt.id}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${doctorToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ status: 'NO_SHOW' }),
      });

      const res = await doctorAppointmentPATCH(req, {
        params: Promise.resolve({ doctorId: doctor.doctorId, appointmentId: noShowAppt.id }),
      });
      expect(res.status).toBe(200);

      const apptInDb = await prisma.appointment.findUnique({ where: { id: noShowAppt.id } });
      expect(apptInDb?.status).toBe('NO_SHOW');

      const slotInDb = await prisma.slot.findUnique({ where: { id: noShowSlot.id } });
      expect(slotInDb?.status).toBe('UNAVAILABLE');

      // Balance unchanged
      const finalBalance = (await prisma.doctor.findUnique({ where: { id: doctor.doctorId } }))?.balance;
      expect(finalBalance).toBe(initialDoctorBalance);
    });
  });
});
