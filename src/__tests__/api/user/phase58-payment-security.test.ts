import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 58: Payment Data Security & Secrets Non-Exposure Test Suite', () => {
  let userId: string;
  let paymentId: string;
  const testOrderId = `order_sec_test_${Date.now()}`;

  beforeAll(async () => {
    const userPayload = buildUserPayload({
      name: 'Payment Security User',
      email: `pay_sec_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const user = await prisma.user.create({
      data: {
        name: userPayload.name,
        email: userPayload.email,
        phoneNo: userPayload.phoneNo,
        password: userPayload.password,
        age: 29,
        address: userPayload.address,
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
    userId = user.id;

    const payment = await prisma.payment.create({
      data: {
        userId,
        amount: 80000, // ₹800 in paise
        currency: 'INR',
        status: 'created',
        razorpayOrderId: testOrderId,
      },
    });
    paymentId = payment.id;
  });

  afterAll(async () => {
    try {
      await prisma.payment.deleteMany({ where: { id: paymentId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    } catch (e) {
      console.warn('Phase 58 cleanup warning:', e);
    }
  });

  it('58.1 Payment record stores amount in paise with currency INR', async () => {
    const p = await prisma.payment.findUnique({ where: { id: paymentId } });
    expect(p).toBeDefined();
    expect(p?.amount).toBe(80000);
    expect(p?.currency).toBe('INR');
    expect(p?.razorpayOrderId).toBe(testOrderId);
  });

  it('58.2 Enforces unique constraint on razorpayOrderId (rejects duplicate orderId)', async () => {
    await expect(
      prisma.payment.create({
        data: {
          userId,
          amount: 80000,
          currency: 'INR',
          status: 'created',
          razorpayOrderId: testOrderId, // Duplicate
        },
      })
    ).rejects.toThrow();
  });

  it('58.3 Ensures payment queries and records do not contain or expose server payment secrets', async () => {
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    const keys = Object.keys(payment || {});
    expect(keys).not.toContain('secret');
    expect(keys).not.toContain('keySecret');
    expect(keys).not.toContain('razorpayKeySecret');
  });
});
