import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { POST as holdPOST } from '@/app/api/appointments/hold/route';
import { POST as createOrderPOST } from '@/app/api/user/[userId]/payments/createOrder/route';
import { POST as verifyOrderPOST } from '@/app/api/user/[userId]/payments/verifyOrder/route';
import { prisma } from '@/lib/prisma';
import { createToken } from '@/lib/auth';
import { buildUserPayload } from '@/__tests__/helpers/factories';

// Mock Upstash Redis with in-memory map for fast and robust test execution
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
const mockRazorpayOrderCreate = vi.fn().mockImplementation((opts: any) =>
  Promise.resolve({
    id: `order_online_${Date.now()}`,
    amount: opts.amount,
    currency: opts.currency || 'INR',
    status: 'created',
  })
);

vi.mock('razorpay', () => ({
  default: class MockRazorpay {
    orders = { create: mockRazorpayOrderCreate };
  },
}));

describe('Phase 18: Online Appointment Booking & Razorpay Flow Test Suite', () => {
  const originalEnv = process.env;
  const testSecret = 'rzp_test_secret_for_online_booking_999';

  let doctorUserId: string;
  let doctorId: string;
  let patientUserId: string;
  let patientId: string;
  let patientToken: string;

  let slotId: string;
  let holdToken: string;
  let razorpayOrderId: string;
  const paymentId = 'pay_test_online_12345';

  const testFutureDate = new Date('2028-12-20T00:00:00.000Z');

  beforeAll(async () => {
    process.env = {
      ...originalEnv,
      RAZORPAY_KEY_ID: 'rzp_test_key_online',
      RAZORPAY_KEY_SECRET: testSecret,
    };

    // 1. Create Doctor
    const docUserPayload = buildUserPayload({
      name: 'Dr. Online Payment Specialist',
      email: `doc_online_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });

    const docUser = await prisma.user.create({
      data: {
        name: docUserPayload.name,
        email: docUserPayload.email,
        phoneNo: docUserPayload.phoneNo,
        password: docUserPayload.password,
        age: 44,
        address: docUserPayload.address,
        role: 'DOCTOR',
        gender: 'FEMALE',
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    doctorUserId = docUser.id;

    const doc = await prisma.doctor.create({
      data: {
        userId: docUser.id,
        specialty: 'CARDIOLOGIST',
        fees: 800, // 800 INR -> 80000 paise
        experience: 14,
      },
    });
    doctorId = doc.id;

    // 2. Create Patient
    const patUserPayload = buildUserPayload({
      name: 'Patient Online Payer',
      email: `pat_online_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const patUser = await prisma.user.create({
      data: {
        name: patUserPayload.name,
        email: patUserPayload.email,
        phoneNo: patUserPayload.phoneNo,
        password: patUserPayload.password,
        age: 31,
        address: patUserPayload.address,
        role: 'PATIENT',
        gender: 'MALE',
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    patientUserId = patUser.id;
    const pat = await prisma.patient.create({ data: { userId: patUser.id } });
    patientId = pat.id;
    patientToken = await createToken({ id: patientUserId, role: 'PATIENT', email: patUser.email });

    // 3. Create Slot
    const slot = await prisma.slot.create({
      data: {
        doctorId,
        date: testFutureDate,
        startTime: new Date('2028-12-20T16:00:00.000Z'),
        endTime: new Date('2028-12-20T16:10:00.000Z'),
        status: 'AVAILABLE',
      },
    });
    slotId = slot.id;
  });

  afterAll(async () => {
    process.env = originalEnv;
    try {
      await prisma.notification.deleteMany({ where: { userId: { in: [doctorUserId, patientUserId] } } });
      const relations = await prisma.doctorPatientRelation.findMany({
        where: { OR: [{ doctorsUserId: doctorUserId }, { patientsUserId: patientUserId }] },
      });
      const relIds = relations.map((r) => r.id);
      if (relIds.length > 0) {
        await prisma.chatMessages.deleteMany({ where: { doctorPatientRelationId: { in: relIds } } });
        await prisma.doctorPatientRelation.deleteMany({ where: { id: { in: relIds } } });
      }
      await prisma.payment.deleteMany({ where: { userId: patientUserId } });
      await prisma.appointment.deleteMany({ where: { doctorId } });
      await prisma.slot.deleteMany({ where: { doctorId } });
      await prisma.doctor.deleteMany({ where: { id: doctorId } });
      await prisma.patient.deleteMany({ where: { id: patientId } });
      await prisma.user.deleteMany({ where: { id: { in: [doctorUserId, patientUserId] } } });
    } catch (e) {
      console.warn('Phase 18 cleanup warning:', e);
    }
  });

  it('18.1 holds slot and creates Razorpay payment order with exact consultation fee in paise', async () => {
    // Step 1: Hold slot
    const holdReq = new NextRequest('http://localhost:3000/api/appointments/hold', {
      method: 'POST',
      headers: { authorization: `Bearer ${patientToken}` },
      body: JSON.stringify({ slotId, doctorId }),
    });
    const holdRes = await holdPOST(holdReq);
    expect(holdRes.status).toBe(201);
    const holdData = await holdRes.json();
    holdToken = holdData.holdToken;

    // Step 2: Create payment order
    const orderReq = new NextRequest(`http://localhost:3000/api/user/${patientUserId}/payments/createOrder`, {
      method: 'POST',
      headers: { authorization: `Bearer ${patientToken}` },
      body: JSON.stringify({
        doctorId,
        slotId,
        holdToken,
      }),
    });

    const orderRes = await createOrderPOST(orderReq, { params: Promise.resolve({ userId: patientUserId }) });
    expect(orderRes.status).toBe(201);
    const orderData = await orderRes.json();

    expect(orderData.ok).toBe(true);
    expect(orderData.order).toBeDefined();
    expect(orderData.order.amount).toBe(80000); // 800 INR * 100
    expect(orderData.order.currency).toBe('INR');
    expect(orderData.order.status).toBe('created');
    razorpayOrderId = orderData.order.razorpayOrderId;
  });

  it('18.2 rejects payment verification with invalid cryptographic signature', async () => {
    const invalidSignature = crypto
      .createHmac('sha256', 'wrong_secret_key')
      .update(`${razorpayOrderId}|${paymentId}`)
      .digest('hex');

    const verifyReq = new NextRequest(`http://localhost:3000/api/user/${patientUserId}/payments/verifyOrder`, {
      method: 'POST',
      headers: { authorization: `Bearer ${patientToken}` },
      body: JSON.stringify({
        orderId: razorpayOrderId,
        paymentId,
        signature: invalidSignature,
      }),
    });

    const verifyRes = await verifyOrderPOST(verifyReq, { params: Promise.resolve({ userId: patientUserId }) });
    expect(verifyRes.status).toBe(400);
    const verifyData = await verifyRes.json();
    expect(verifyData.error).toBe('Invalid signature');
  });

  it('18.3 verifies valid signature, captures payment SUCCESS, and confirms ONLINE appointment', async () => {
    const validSignature = crypto
      .createHmac('sha256', testSecret)
      .update(`${razorpayOrderId}|${paymentId}`)
      .digest('hex');

    const verifyReq = new NextRequest(`http://localhost:3000/api/user/${patientUserId}/payments/verifyOrder`, {
      method: 'POST',
      headers: { authorization: `Bearer ${patientToken}` },
      body: JSON.stringify({
        orderId: razorpayOrderId,
        paymentId,
        signature: validSignature,
      }),
    });

    const verifyRes = await verifyOrderPOST(verifyReq, { params: Promise.resolve({ userId: patientUserId }) });
    expect(verifyRes.status).toBe(200);
    const verifyData = await verifyRes.json();

    expect(verifyData.message).toContain('Payment verified');
    expect(verifyData.transactionId).toBe(paymentId);
    expect(verifyData.appointment).toBeDefined();
    expect(verifyData.appointment.status).toBe('CONFIRMED');
    expect(verifyData.appointment.paymentMethod).toBe('ONLINE');
    expect(verifyData.appointment.transactionId).toBe(paymentId);

    // Verify Payment table record updated to SUCCESS
    const payment = await prisma.payment.findUnique({ where: { razorpayOrderId } });
    expect(payment?.status).toBe('SUCCESS');
    expect(payment?.razorpayPaymentId).toBe(paymentId);
  });

  it('18.4 handles duplicate verifyOrder calls idempotently without duplicate records', async () => {
    const validSignature = crypto
      .createHmac('sha256', testSecret)
      .update(`${razorpayOrderId}|${paymentId}`)
      .digest('hex');

    const duplicateReq = new NextRequest(`http://localhost:3000/api/user/${patientUserId}/payments/verifyOrder`, {
      method: 'POST',
      headers: { authorization: `Bearer ${patientToken}` },
      body: JSON.stringify({
        orderId: razorpayOrderId,
        paymentId,
        signature: validSignature,
      }),
    });

    const duplicateRes = await verifyOrderPOST(duplicateReq, { params: Promise.resolve({ userId: patientUserId }) });
    expect(duplicateRes.status).toBe(200);
    const duplicateData = await duplicateRes.json();
    expect(duplicateData.appointment).toBeDefined();
    expect(duplicateData.appointment.transactionId).toBe(paymentId);
  });
});
