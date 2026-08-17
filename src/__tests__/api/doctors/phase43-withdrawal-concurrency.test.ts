import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as withdrawalsPOST } from '@/app/api/doctors/[doctorId]/withdrawals/route';
import { prisma } from '@/lib/prisma';
import { buildUserPayload, buildBankAccountPayload } from '@/__tests__/helpers/factories';

describe('Phase 43: Doctor Withdrawal Concurrency & Double-Spend Protection Test Suite', () => {
  let docUserId: string;
  let docId: string;
  const createdWithdrawalIds: string[] = [];

  beforeAll(async () => {
    // Create Doctor with exact balance ₹300 (30,000 paise)
    const docPayload = buildUserPayload({
      name: 'Dr. Concurrency Tester',
      email: `doc_concurrent_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const docUser = await prisma.user.create({
      data: {
        name: docPayload.name,
        email: docPayload.email,
        phoneNo: docPayload.phoneNo,
        password: docPayload.password,
        age: 48,
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
        specialty: 'UROLOGIST',
        fees: 900,
        experience: 14,
        balance: 30000, // ₹300 in paise
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
      console.warn('Phase 43 cleanup warning:', e);
    }
  });

  it('43.1 Two simultaneous withdrawal requests of ₹200 each against a balance of ₹300 do not allow double spend', async () => {
    // Both requests request ₹200 (20,000 paise), total requested = ₹400 > ₹300 balance
    const req1 = new NextRequest(`http://localhost:3000/api/doctors/${docId}/withdrawals`, {
      method: 'POST',
      body: JSON.stringify({ amount: 200 }),
    });
    const req2 = new NextRequest(`http://localhost:3000/api/doctors/${docId}/withdrawals`, {
      method: 'POST',
      body: JSON.stringify({ amount: 200 }),
    });

    const [res1, res2] = await Promise.all([
      withdrawalsPOST(req1, { params: Promise.resolve({ doctorId: docId }) }),
      withdrawalsPOST(req2, { params: Promise.resolve({ doctorId: docId }) }),
    ]);

    const statuses = [res1.status, res2.status];
    const data1 = await res1.json();
    const data2 = await res2.json();

    if (data1.withdrawal?.id) createdWithdrawalIds.push(data1.withdrawal.id);
    if (data2.withdrawal?.id) createdWithdrawalIds.push(data2.withdrawal.id);

    // One should succeed (201) and one should fail (400 Insufficient balance) OR both cannot succeed
    const successCount = statuses.filter((s) => s === 201).length;
    const failCount = statuses.filter((s) => s === 400).length;

    expect(successCount).toBe(1);
    expect(failCount).toBe(1);

    // Verify DB Doctor balance >= 0
    const finalDoc = await prisma.doctor.findUnique({ where: { id: docId } });
    expect(finalDoc!.balance).toBe(10000); // 30,000 - 20,000 = 10,000 paise (₹100)
    expect(finalDoc!.balance).toBeGreaterThanOrEqual(0);
  });

  it('43.2 Subsequent withdrawal request for remaining balance succeeds', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${docId}/withdrawals`, {
      method: 'POST',
      body: JSON.stringify({ amount: 100 }), // Remaining ₹100
    });
    const res = await withdrawalsPOST(req, { params: Promise.resolve({ doctorId: docId }) });
    expect(res.status).toBe(201);
    const data = await res.json();
    if (data.withdrawal?.id) createdWithdrawalIds.push(data.withdrawal.id);

    const finalDoc = await prisma.doctor.findUnique({ where: { id: docId } });
    expect(finalDoc!.balance).toBe(0);
  });

  it('43.3 Additional withdrawal request after zero balance is strictly rejected with 400', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${docId}/withdrawals`, {
      method: 'POST',
      body: JSON.stringify({ amount: 100 }),
    });
    const res = await withdrawalsPOST(req, { params: Promise.resolve({ doctorId: docId }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Insufficient balance');
  });
});
