import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { buildUserPayload, buildBankAccountPayload } from '@/__tests__/helpers/factories';
import type { WithdrawalStatus } from '@/generated/prisma';

describe('Phase 42: Withdrawal State Lifecycle & Transitions Test Suite', () => {
  let docUserId: string;
  let docId: string;
  const createdWithdrawalIds: string[] = [];

  beforeAll(async () => {
    const docPayload = buildUserPayload({
      name: 'Dr. Lifecycle Tester',
      email: `doc_lifecycle_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const docUser = await prisma.user.create({
      data: {
        name: docPayload.name,
        email: docPayload.email,
        phoneNo: docPayload.phoneNo,
        password: docPayload.password,
        age: 46,
        address: docPayload.address,
        role: 'DOCTOR',
        gender: 'MALE',
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    docUserId = docUser.id;

    const d = await prisma.doctor.create({
      data: {
        userId: docUser.id,
        specialty: 'NEPHROLOGIST',
        fees: 1200,
        experience: 18,
        balance: 600000, // ₹6000 in paise
      },
    });
    docId = d.id;

    const bankPayload = buildBankAccountPayload();
    await prisma.bankAccount.create({
      data: {
        userId: docUserId,
        bankAccountNumber: bankPayload.bankAccountNumber,
        bankIFSC: bankPayload.bankIFSC,
        bankAccountHolderName: bankPayload.bankAccountHolderName,
        bankName: bankPayload.bankName,
      },
    });
  });

  afterAll(async () => {
    try {
      if (createdWithdrawalIds.length > 0) {
        await prisma.withdrawal.deleteMany({ where: { id: { in: createdWithdrawalIds } } });
      }
      await prisma.bankAccount.deleteMany({ where: { userId: docUserId } });
      await prisma.doctor.deleteMany({ where: { id: docId } });
      await prisma.user.deleteMany({ where: { id: docUserId } });
    } catch (e) {
      console.warn('Phase 42 cleanup warning:', e);
    }
  });

  it('42.1 Creates a withdrawal record with initial PENDING status', async () => {
    const w = await prisma.withdrawal.create({
      data: {
        doctorId: docId,
        amount: 100000, // ₹1000 in paise
        currency: 'INR',
        status: 'PENDING',
      },
    });
    createdWithdrawalIds.push(w.id);

    expect(w.status).toBe('PENDING');
    expect(w.processedAt).toBeNull();
    expect(w.failureReason).toBeNull();
    expect(w.razorpayPayoutId).toBeNull();
  });

  it('42.2 Transitions status from PENDING to PROCESSING with provider payout reference', async () => {
    const w = createdWithdrawalIds[0];
    const updated = await prisma.withdrawal.update({
      where: { id: w },
      data: {
        status: 'PROCESSING',
        razorpayPayoutId: 'pout_test_123456789',
      },
    });

    expect(updated.status).toBe('PROCESSING');
    expect(updated.razorpayPayoutId).toBe('pout_test_123456789');
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(updated.createdAt.getTime());
  });

  it('42.3 Transitions status from PROCESSING to COMPLETED with timestamp recorded', async () => {
    const w = createdWithdrawalIds[0];
    const processedTime = new Date();
    const completed = await prisma.withdrawal.update({
      where: { id: w },
      data: {
        status: 'COMPLETED',
        processedAt: processedTime,
      },
    });

    expect(completed.status).toBe('COMPLETED');
    expect(completed.processedAt).toEqual(processedTime);
  });

  it('42.4 Transitions status from PROCESSING to FAILED with failureReason recorded', async () => {
    const wFailed = await prisma.withdrawal.create({
      data: {
        doctorId: docId,
        amount: 50000, // ₹500
        currency: 'INR',
        status: 'PROCESSING',
        razorpayPayoutId: 'pout_fail_987654',
      },
    });
    createdWithdrawalIds.push(wFailed.id);

    const updated = await prisma.withdrawal.update({
      where: { id: wFailed.id },
      data: {
        status: 'FAILED',
        failureReason: 'Beneficiary bank account inactive or invalid IFSC',
        processedAt: new Date(),
      },
    });

    expect(updated.status).toBe('FAILED');
    expect(updated.failureReason).toBe('Beneficiary bank account inactive or invalid IFSC');
  });

  it('42.5 Transitions status from PENDING to CANCELLED', async () => {
    const wCancelled = await prisma.withdrawal.create({
      data: {
        doctorId: docId,
        amount: 80000,
        currency: 'INR',
        status: 'PENDING',
      },
    });
    createdWithdrawalIds.push(wCancelled.id);

    const updated = await prisma.withdrawal.update({
      where: { id: wCancelled.id },
      data: {
        status: 'CANCELLED',
      },
    });

    expect(updated.status).toBe('CANCELLED');
  });

  it('42.6 Queries withdrawals filtered by specific status accurately', async () => {
    const completedList = await prisma.withdrawal.findMany({
      where: { doctorId: docId, status: 'COMPLETED' },
    });
    expect(completedList.length).toBeGreaterThanOrEqual(1);
    expect(completedList.every((w: { status: WithdrawalStatus }) => w.status === 'COMPLETED')).toBe(true);

    const failedList = await prisma.withdrawal.findMany({
      where: { doctorId: docId, status: 'FAILED' },
    });
    expect(failedList.length).toBe(1);
    expect(failedList[0].failureReason).toBeDefined();
  });
});
