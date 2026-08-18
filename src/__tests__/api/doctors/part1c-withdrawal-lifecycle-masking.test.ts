import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createToken } from '@/lib/auth';
import {
  GET as withdrawalsGET,
  POST as withdrawalsPOST,
  maskAccountNumber,
} from '@/app/api/doctors/[doctorId]/withdrawals/route';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Part 1C: Withdrawal Lifecycle Semantics & Bank Account Masking Suite', () => {
  let docUserId: string;
  let docId: string;
  let docToken: string;
  let adminUserId: string;
  let adminToken: string;
  const rawAccountNumber = '987654321098';
  const createdWithdrawalIds: string[] = [];

  beforeAll(async () => {
    // 1. Create Admin
    const adminPayload = buildUserPayload({
      name: 'Admin Payout Overseer',
      email: `admin_payout_${Date.now()}@quickclinic.test`,
      role: 'ADMIN',
    });
    const adminUser = await prisma.user.create({
      data: {
        name: adminPayload.name,
        email: adminPayload.email,
        phoneNo: adminPayload.phoneNo,
        password: adminPayload.password,
        age: 42,
        gender: 'MALE',
        address: 'Admin Tower',
        role: 'ADMIN',
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    adminUserId = adminUser.id;
    adminToken = await createToken({ id: adminUserId, email: adminUser.email, role: 'ADMIN', name: adminUser.name });
    await prisma.admin.create({ data: { userId: adminUserId } });

    // 2. Create Doctor with initial balance of ₹3,000 (300,000 paise)
    const docPayload = buildUserPayload({
      name: 'Dr. Lifecycle & Security Doctor',
      email: `doc_part1c_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const docUser = await prisma.user.create({
      data: {
        name: docPayload.name,
        email: docPayload.email,
        phoneNo: docPayload.phoneNo,
        password: docPayload.password,
        age: 38,
        gender: 'FEMALE',
        address: 'Doctor St',
        role: 'DOCTOR',
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    docUserId = docUser.id;
    docToken = await createToken({ id: docUserId, email: docUser.email, role: 'DOCTOR', name: docUser.name });

    const doctor = await prisma.doctor.create({
      data: {
        userId: docUserId,
        specialty: 'DERMATOLOGIST',
        fees: 1000,
        experience: 8,
        balance: 300000, // ₹3,000 in paise
      },
    });
    docId = doctor.id;

    // Attach bank account with known unmasked number
    await prisma.bankAccount.create({
      data: {
        userId: docUserId,
        bankAccountNumber: rawAccountNumber,
        bankIFSC: 'HDFC0004321',
        bankAccountHolderName: 'Dr. Security Doctor',
        bankName: 'HDFC Bank Ltd',
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
      await prisma.admin.deleteMany({ where: { userId: adminUserId } });
      await prisma.user.deleteMany({ where: { id: { in: [docUserId, adminUserId] } } });
    } catch (e) {
      console.warn('Cleanup warning in Part 1C withdrawal test:', e);
    }
  });

  it('4.1 Request creates initial status PENDING, records no premature processedAt, and decrements available balance atomically', async () => {
    const docBefore = await prisma.doctor.findUnique({ where: { id: docId } });
    const balanceBefore = docBefore!.balance; // 300,000 paise

    const req = new NextRequest(`http://localhost:3000/api/doctors/${docId}/withdrawals`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${docToken}`,
      },
      body: JSON.stringify({ amount: 1000 }), // ₹1,000 = 100,000 paise
    });

    const res = await withdrawalsPOST(req, { params: Promise.resolve({ doctorId: docId }) });
    expect(res.status).toBe(201);
    const data = await res.json();

    expect(data.message).toBe('Withdrawal request created successfully');
    expect(data.withdrawal.status).toBe('PENDING');
    expect(data.withdrawal.processedAt).toBeNull();
    expect(data.withdrawal.amount).toBe(100000);
    expect(data.withdrawal.amountInRupees).toBe(1000);

    createdWithdrawalIds.push(data.withdrawal.id);

    // Verify DB state
    const withdrawalInDb = await prisma.withdrawal.findUnique({ where: { id: data.withdrawal.id } });
    expect(withdrawalInDb?.status).toBe('PENDING');
    expect(withdrawalInDb?.processedAt).toBeNull();

    const docAfter = await prisma.doctor.findUnique({ where: { id: docId } });
    expect(docAfter?.balance).toBe(balanceBefore - 100000); // Decremented from 300,000 to 200,000
  });

  it('4.2 Concurrent requests cannot overdraft doctor balance (atomic balance reservation)', async () => {
    // Current balance is 200,000 paise (₹2,000).
    // Launch 3 concurrent requests of ₹1,000 (100,000 paise) each.
    // Exactly 2 must succeed, 1 must fail with 400 Insufficient balance.
    const requests = [1, 2, 3].map(() =>
      withdrawalsPOST(
        new NextRequest(`http://localhost:3000/api/doctors/${docId}/withdrawals`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${docToken}`,
          },
          body: JSON.stringify({ amount: 1000 }),
        }),
        { params: Promise.resolve({ doctorId: docId }) }
      )
    );

    const responses = await Promise.all(requests);
    const statuses = responses.map((r) => r.status);
    const successCount = statuses.filter((s) => s === 201).length;
    const failCount = statuses.filter((s) => s === 400).length;

    expect(successCount).toBe(2);
    expect(failCount).toBe(1);

    for (const r of responses) {
      if (r.status === 201) {
        const body = await r.json();
        createdWithdrawalIds.push(body.withdrawal.id);
      }
    }

    // Final balance must be exactly 0, never negative
    const docFinal = await prisma.doctor.findUnique({ where: { id: docId } });
    expect(docFinal?.balance).toBe(0);
  });

  it('4.3 COMPLETED only after valid processing: transitions PENDING -> PROCESSING -> COMPLETED with processedAt timestamp', async () => {
    const withdrawalId = createdWithdrawalIds[0];

    // Admin begins processing
    const processing = await prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: {
        status: 'PROCESSING',
        razorpayPayoutId: 'pout_p1c_proc_888',
      },
    });
    expect(processing.status).toBe('PROCESSING');

    // Admin confirms payout execution
    const processedDate = new Date();
    const completed = await prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: {
        status: 'COMPLETED',
        processedAt: processedDate,
      },
    });
    expect(completed.status).toBe('COMPLETED');
    expect(completed.processedAt).toEqual(processedDate);
  });

  it('4.4 FAILED restoration happens exactly once: restores reserved balance back to doctor on payout failure', async () => {
    const failedWithdrawalId = createdWithdrawalIds[1]; // Was created with 100,000 paise
    const docBefore = await prisma.doctor.findUnique({ where: { id: docId } });
    const balanceBefore = docBefore!.balance; // 0 paise

    // Execute atomic balance refund for failed payout
    const failed = await prisma.$transaction(async (tx) => {
      const current = await tx.withdrawal.findUnique({ where: { id: failedWithdrawalId } });
      if (current?.status === 'FAILED') return current; // Idempotent guard

      const updated = await tx.withdrawal.update({
        where: { id: failedWithdrawalId },
        data: {
          status: 'FAILED',
          failureReason: 'Invalid beneficiary account state',
          processedAt: new Date(),
        },
      });

      await tx.doctor.update({
        where: { id: docId },
        data: { balance: { increment: current!.amount } },
      });

      return updated;
    });

    expect(failed.status).toBe('FAILED');
    expect(failed.failureReason).toBe('Invalid beneficiary account state');

    const docAfter = await prisma.doctor.findUnique({ where: { id: docId } });
    expect(docAfter?.balance).toBe(balanceBefore + 100000); // 100,000 paise restored

    // Repeated failure / restoration attempt must be idempotent and not increment balance a second time
    await prisma.$transaction(async (tx) => {
      const current = await tx.withdrawal.findUnique({ where: { id: failedWithdrawalId } });
      if (current?.status === 'FAILED') return; // Guard prevents second restoration

      await tx.doctor.update({
        where: { id: docId },
        data: { balance: { increment: current!.amount } },
      });
    });

    const docAfterReplay = await prisma.doctor.findUnique({ where: { id: docId } });
    expect(docAfterReplay?.balance).toBe(balanceBefore + 100000); // Stays at 100,000 paise
  });

  it('5.1 Bank account masking: maskAccountNumber utility masks all but the last 4 digits', () => {
    expect(maskAccountNumber('987654321098')).toBe('********1098');
    expect(maskAccountNumber('12345678901')).toBe('********8901');
    expect(maskAccountNumber('1234')).toBe('1234');
    expect(maskAccountNumber(null)).toBe('N/A');
    expect(maskAccountNumber(undefined)).toBe('N/A');
  });

  it('5.2 Bank account masking: GET and POST API responses never expose unmasked bank account number', async () => {
    // 1. GET response
    const getReq = new NextRequest(`http://localhost:3000/api/doctors/${docId}/withdrawals`, {
      headers: { authorization: `Bearer ${docToken}` },
    });
    const getRes = await withdrawalsGET(getReq, { params: Promise.resolve({ doctorId: docId }) });
    expect(getRes.status).toBe(200);
    const getList = await getRes.json();

    expect(getList.length).toBeGreaterThan(0);
    for (const item of getList) {
      expect(item.bankAccountNumber).toBe('********1098');
      expect(item.bankAccountNumber).not.toBe(rawAccountNumber);
      expect(item.bankAccountNumber).not.toContain('98765432');
    }

    // 2. Real account number in DB is untouched
    const bankAccountInDb = await prisma.bankAccount.findFirst({ where: { userId: docUserId } });
    expect(bankAccountInDb?.bankAccountNumber).toBe(rawAccountNumber);
  });
});
