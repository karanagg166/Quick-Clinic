import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { createToken } from '@/lib/auth';
import { POST as verifyOrderPOST } from '@/app/api/user/[userId]/payments/verifyOrder/route';

describe('Part 1C: Payment Verification & Refund State Machine Idempotency Suite', () => {
  const secretKey = 'test_razorpay_secret_key_123456789';
  let patientUserId: string;
  let patientId: string;
  let patientToken: string;
  let doctorUserId: string;
  let doctorId: string;
  let slotId1: string;
  let slotId2: string;
  let slotId3: string;
  let slotId4: string;

  const testOrderIds: string[] = [];

  function generateValidSignature(orderId: string, paymentId: string, secret = secretKey): string {
    return crypto
      .createHmac('sha256', secret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
  }

  beforeAll(async () => {
    process.env.RAZORPAY_KEY_SECRET = secretKey;
    process.env.RAZORPAY_KEY_ID = 'rzp_test_mock_key_id';

    // 1. Create Patient User & Patient record
    const patientUser = await prisma.user.create({
      data: {
        name: 'Part1C Patient',
        email: `part1c_patient_${Date.now()}@quickclinic.test`,
        phoneNo: '9876543210',
        password: '$2b$10$hashedpasswordforexamplepurposeonly',
        age: 28,
        gender: 'FEMALE',
        address: '123 Test St',
        role: 'PATIENT',
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    patientUserId = patientUser.id;
    patientToken = await createToken({ id: patientUserId, role: 'PATIENT' });

    const patient = await prisma.patient.create({
      data: {
        userId: patientUserId,
        medicalHistory: 'None',
      },
    });
    patientId = patient.id;

    // 2. Create Doctor User & Doctor record
    const docUser = await prisma.user.create({
      data: {
        name: 'Dr. Part1C Specialist',
        email: `part1c_doc_${Date.now()}@quickclinic.test`,
        phoneNo: '9876543211',
        password: '$2b$10$hashedpasswordforexamplepurposeonly',
        age: 45,
        gender: 'MALE',
        address: '456 Clinic Ave',
        role: 'DOCTOR',
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    doctorUserId = docUser.id;

    const doctor = await prisma.doctor.create({
      data: {
        userId: doctorUserId,
        specialty: 'CARDIOLOGIST',
        fees: 1500,
        experience: 12,
      },
    });
    doctorId = doctor.id;

    // 3. Create test slots
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const slot1 = await prisma.slot.create({
      data: {
        doctorId,
        date: today,
        startTime: new Date(today.getTime() + 10 * 3600 * 1000),
        endTime: new Date(today.getTime() + 10.5 * 3600 * 1000),
        status: 'HELD',
        heldByPatientId: patientId,
        holdToken: 'ht_token_part1c_1',
        holdExpiresAt: new Date(Date.now() + 600 * 1000),
      },
    });
    slotId1 = slot1.id;

    const slot2 = await prisma.slot.create({
      data: {
        doctorId,
        date: today,
        startTime: new Date(today.getTime() + 11 * 3600 * 1000),
        endTime: new Date(today.getTime() + 11.5 * 3600 * 1000),
        status: 'HELD',
        heldByPatientId: patientId,
        holdToken: 'ht_token_part1c_2',
        holdExpiresAt: new Date(Date.now() + 600 * 1000),
      },
    });
    slotId2 = slot2.id;

    const slot3 = await prisma.slot.create({
      data: {
        doctorId,
        date: today,
        startTime: new Date(today.getTime() + 12 * 3600 * 1000),
        endTime: new Date(today.getTime() + 12.5 * 3600 * 1000),
        status: 'BOOKED', // Slot was booked by someone else / unavailable
      },
    });
    slotId3 = slot3.id;

    const slot4 = await prisma.slot.create({
      data: {
        doctorId,
        date: today,
        startTime: new Date(today.getTime() + 13 * 3600 * 1000),
        endTime: new Date(today.getTime() + 13.5 * 3600 * 1000),
        status: 'HELD',
        heldByPatientId: patientId,
        holdToken: 'ht_token_part1c_4',
        holdExpiresAt: new Date(Date.now() + 600 * 1000),
      },
    });
    slotId4 = slot4.id;
  });

  afterAll(async () => {
    try {
      if (testOrderIds.length > 0) {
        await prisma.payment.deleteMany({ where: { razorpayOrderId: { in: testOrderIds } } });
      }
      await prisma.appointment.deleteMany({ where: { patientId } });
      await prisma.slot.deleteMany({ where: { id: { in: [slotId1, slotId2, slotId3, slotId4] } } });
      await prisma.doctorPatientRelation.deleteMany({ where: { doctorsUserId: doctorUserId, patientsUserId: patientUserId } });
      await prisma.notification.deleteMany({ where: { userId: { in: [patientUserId, doctorUserId] } } });
      await prisma.doctor.deleteMany({ where: { id: doctorId } });
      await prisma.patient.deleteMany({ where: { id: patientId } });
      await prisma.user.deleteMany({ where: { id: { in: [patientUserId, doctorUserId] } } });
    } catch (e) {
      console.warn('Cleanup warning in Part 1C payment test:', e);
    }
  });

  it('2.1 First valid verification: transitions PENDING -> SUCCESS and confirms appointment', async () => {
    const orderId = `order_part1c_succ_${Date.now()}`;
    const paymentId = `pay_part1c_succ_${Date.now()}`;
    testOrderIds.push(orderId);

    await prisma.payment.create({
      data: {
        userId: patientUserId,
        doctorId,
        slotId: slotId1,
        holdToken: 'ht_token_part1c_1',
        amount: 150000,
        currency: 'INR',
        status: 'PENDING',
        razorpayOrderId: orderId,
      },
    });

    const signature = generateValidSignature(orderId, paymentId);
    const req = new NextRequest(`http://localhost:3000/api/user/${patientUserId}/payments/verifyOrder`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${patientToken}`,
      },
      body: JSON.stringify({ orderId, signature, paymentId }),
    });

    const res = await verifyOrderPOST(req, { params: Promise.resolve({ userId: patientUserId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message).toBe('Payment verified and appointment confirmed');
    expect(data.appointment.slotId).toBe(slotId1);

    const updatedPayment = await prisma.payment.findUnique({ where: { razorpayOrderId: orderId } });
    expect(updatedPayment?.status).toBe('SUCCESS');
    expect(updatedPayment?.razorpayPaymentId).toBe(paymentId);
  });

  it('2.2 Duplicate verification after successful appointment: returns existing result idempotently without creating another appointment', async () => {
    const orderId = testOrderIds[0];
    const paymentId = (await prisma.payment.findUnique({ where: { razorpayOrderId: orderId } }))!.razorpayPaymentId!;
    const signature = generateValidSignature(orderId, paymentId);

    const appointmentCountBefore = await prisma.appointment.count({ where: { slotId: slotId1 } });
    expect(appointmentCountBefore).toBe(1);

    const req = new NextRequest(`http://localhost:3000/api/user/${patientUserId}/payments/verifyOrder`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${patientToken}`,
      },
      body: JSON.stringify({ orderId, signature, paymentId }),
    });

    const res = await verifyOrderPOST(req, { params: Promise.resolve({ userId: patientUserId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message).toBe('Payment verified and appointment confirmed');
    expect(data.appointment.slotId).toBe(slotId1);

    const appointmentCountAfter = await prisma.appointment.count({ where: { slotId: slotId1 } });
    expect(appointmentCountAfter).toBe(1); // Exactly 1, no duplicate created
  });

  it('2.3 Verification replay after REFUNDED: must NOT transition back to SUCCESS, must NOT create appointment, must return refund state', async () => {
    const orderId = `order_part1c_ref_${Date.now()}`;
    const paymentId = `pay_part1c_ref_${Date.now()}`;
    testOrderIds.push(orderId);

    await prisma.payment.create({
      data: {
        userId: patientUserId,
        doctorId,
        slotId: slotId2,
        holdToken: 'ht_token_part1c_2',
        amount: 150000,
        currency: 'INR',
        status: 'REFUNDED',
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
      },
    });

    const signature = generateValidSignature(orderId, paymentId);
    const req = new NextRequest(`http://localhost:3000/api/user/${patientUserId}/payments/verifyOrder`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${patientToken}`,
      },
      body: JSON.stringify({ orderId, signature, paymentId }),
    });

    const res = await verifyOrderPOST(req, { params: Promise.resolve({ userId: patientUserId }) });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe('PAYMENT_ALREADY_REFUNDED');
    expect(data.refundStatus).toBe('REFUNDED');

    // Verify DB was NOT changed back to SUCCESS
    const paymentInDb = await prisma.payment.findUnique({ where: { razorpayOrderId: orderId } });
    expect(paymentInDb?.status).toBe('REFUNDED');

    // Verify no appointment created
    const appt = await prisma.appointment.findFirst({ where: { slotId: slotId2 } });
    expect(appt).toBeNull();
  });

  it('2.4 Verification replay while REFUND_PENDING: must NOT transition back to SUCCESS, must return deterministic REFUND_PENDING state', async () => {
    const orderId = `order_part1c_pendref_${Date.now()}`;
    const paymentId = `pay_part1c_pendref_${Date.now()}`;
    testOrderIds.push(orderId);

    await prisma.payment.create({
      data: {
        userId: patientUserId,
        doctorId,
        slotId: slotId4,
        holdToken: 'ht_token_part1c_4',
        amount: 150000,
        currency: 'INR',
        status: 'REFUND_PENDING',
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
      },
    });

    const signature = generateValidSignature(orderId, paymentId);
    const req = new NextRequest(`http://localhost:3000/api/user/${patientUserId}/payments/verifyOrder`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${patientToken}`,
      },
      body: JSON.stringify({ orderId, signature, paymentId }),
    });

    const res = await verifyOrderPOST(req, { params: Promise.resolve({ userId: patientUserId }) });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe('REFUND_PENDING');
    expect(data.refundStatus).toBe('REFUND_PENDING');

    // Verify DB was NOT changed back to SUCCESS
    const paymentInDb = await prisma.payment.findUnique({ where: { razorpayOrderId: orderId } });
    expect(paymentInDb?.status).toBe('REFUND_PENDING');
  });

  it('2.5 Slot lost after payment: executes compensation, persists refund state, never allows transition to SUCCESS', async () => {
    const orderId = `order_part1c_lostslot_${Date.now()}`;
    const paymentId = `pay_part1c_lostslot_${Date.now()}`;
    testOrderIds.push(orderId);

    // Slot 3 has status AVAILABLE and no matching hold token
    await prisma.payment.create({
      data: {
        userId: patientUserId,
        doctorId,
        slotId: slotId3,
        holdToken: 'wrong_invalid_or_expired_hold_token',
        amount: 150000,
        currency: 'INR',
        status: 'PENDING',
        razorpayOrderId: orderId,
      },
    });

    const signature = generateValidSignature(orderId, paymentId);
    const req = new NextRequest(`http://localhost:3000/api/user/${patientUserId}/payments/verifyOrder`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${patientToken}`,
      },
      body: JSON.stringify({ orderId, signature, paymentId }),
    });

    const res = await verifyOrderPOST(req, { params: Promise.resolve({ userId: patientUserId }) });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe('SLOT_UNAVAILABLE_REFUNDED');
    expect(['REFUNDED', 'REFUND_PENDING']).toContain(data.refundStatus);

    // Verify DB payment status is REFUNDED / REFUND_PENDING and never SUCCESS
    const paymentInDb = await prisma.payment.findUnique({ where: { razorpayOrderId: orderId } });
    expect(['REFUNDED', 'REFUND_PENDING']).toContain(paymentInDb?.status);

    // Replay of this request should be cleanly rejected as already refunded/refund pending
    const replayReq = new NextRequest(`http://localhost:3000/api/user/${patientUserId}/payments/verifyOrder`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${patientToken}`,
      },
      body: JSON.stringify({ orderId, signature, paymentId }),
    });

    const replayRes = await verifyOrderPOST(replayReq, { params: Promise.resolve({ userId: patientUserId }) });
    expect(replayRes.status).toBe(409);
    const replayData = await replayRes.json();
    expect(['PAYMENT_ALREADY_REFUNDED', 'REFUND_PENDING']).toContain(replayData.error);
  });
});
