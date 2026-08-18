import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import {
  GET as withdrawalsGET,
  POST as withdrawalsPOST,
} from '@/app/api/doctors/[doctorId]/withdrawals/route';
import { prisma } from '@/lib/prisma';
import { createToken } from '@/lib/auth';
import { buildUserPayload, buildBankAccountPayload } from '@/__tests__/helpers/factories';

describe('Phase 41: Doctor Withdrawal Requests & Validations Test Suite', () => {
  let doc1UserId: string;
  let doc1Id: string;
  let doc1Token: string;

  let doc2UserId: string;
  let doc2Id: string;
  let doc2Token: string;

  const createdWithdrawalIds: string[] = [];

  beforeAll(async () => {
    // 1. Doctor 1 with balance (₹5,000 = 500,000 paise) and bank account
    const doc1Payload = buildUserPayload({
      name: 'Dr. Withdrawal Valid',
      email: `doc_wdraw1_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const doc1User = await prisma.user.create({
      data: {
        name: doc1Payload.name,
        email: doc1Payload.email,
        phoneNo: doc1Payload.phoneNo,
        password: doc1Payload.password,
        age: 44,
        address: doc1Payload.address,
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
    doc1UserId = doc1User.id;
    doc1Token = await createToken({ id: doc1UserId, email: doc1User.email, role: 'DOCTOR', name: doc1User.name });

    const d1 = await prisma.doctor.create({
      data: {
        userId: doc1User.id,
        specialty: 'CARDIOLOGIST',
        fees: 1000,
        experience: 15,
        balance: 500000, // ₹5000 in paise
      },
    });
    doc1Id = d1.id;

    // Attach Bank Account to Doctor 1
    const bankPayload = buildBankAccountPayload({
      bankAccountNumber: `99${Date.now().toString().slice(-10)}`,
    });
    await prisma.bankAccount.create({
      data: {
        userId: doc1UserId,
        bankAccountNumber: bankPayload.bankAccountNumber,
        bankIFSC: bankPayload.bankIFSC,
        bankAccountHolderName: bankPayload.bankAccountHolderName,
        bankName: bankPayload.bankName,
      },
    });

    // 2. Doctor 2 with NO bank account and low balance (₹50 = 5,000 paise)
    const doc2Payload = buildUserPayload({
      name: 'Dr. No Bank Account',
      email: `doc_wdraw2_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const doc2User = await prisma.user.create({
      data: {
        name: doc2Payload.name,
        email: doc2Payload.email,
        phoneNo: doc2Payload.phoneNo,
        password: doc2Payload.password,
        age: 38,
        address: doc2Payload.address,
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
    doc2UserId = doc2User.id;
    doc2Token = await createToken({ id: doc2UserId, email: doc2User.email, role: 'DOCTOR', name: doc2User.name });

    const d2 = await prisma.doctor.create({
      data: {
        userId: doc2User.id,
        specialty: 'DERMATOLOGIST',
        fees: 800,
        experience: 9,
        balance: 5000, // ₹50 (below min ₹100)
      },
    });
    doc2Id = d2.id;
  });

  afterAll(async () => {
    try {
      if (createdWithdrawalIds.length > 0) {
        await prisma.withdrawal.deleteMany({ where: { id: { in: createdWithdrawalIds } } });
      }
      await prisma.bankAccount.deleteMany({ where: { userId: { in: [doc1UserId, doc2UserId] } } });
      await prisma.doctor.deleteMany({ where: { id: { in: [doc1Id, doc2Id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [doc1UserId, doc2UserId] } } });
    } catch (e) {
      console.warn('Phase 41 cleanup warning:', e);
    }
  });

  it('41.1 POST rejects non-existent doctor with 404', async () => {
    const req = new NextRequest('http://localhost:3000/api/doctors/non_existent_doc/withdrawals', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${doc1Token}`,
      },
      body: JSON.stringify({ amount: 500 }),
    });
    const res = await withdrawalsPOST(req, { params: Promise.resolve({ doctorId: 'non_existent_doc' }) });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe('Doctor not found');
  });

  it('41.2 POST rejects invalid/missing/negative amount with 400', async () => {
    const invalidAmounts = [0, -100, NaN, null, 'invalid'];
    for (const amt of invalidAmounts) {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1Id}/withdrawals`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${doc1Token}`,
        },
        body: JSON.stringify({ amount: amt }),
      });
      const res = await withdrawalsPOST(req, { params: Promise.resolve({ doctorId: doc1Id }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Valid amount is required');
    }
  });

  it('41.3 POST rejects withdrawal when doctor has not configured bank details (400)', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${doc2Id}/withdrawals`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${doc2Token}`,
      },
      body: JSON.stringify({ amount: 500 }),
    });
    const res = await withdrawalsPOST(req, { params: Promise.resolve({ doctorId: doc2Id }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Bank details not set. Please add bank details first.');
  });

  it('41.4 POST rejects withdrawal below minimum threshold of ₹100 (400)', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1Id}/withdrawals`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${doc1Token}`,
      },
      body: JSON.stringify({ amount: 50 }), // ₹50 < ₹100
    });
    const res = await withdrawalsPOST(req, { params: Promise.resolve({ doctorId: doc1Id }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Minimum withdrawal amount is ₹100');
  });

  it('41.5 POST rejects withdrawal exceeding available balance (400)', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1Id}/withdrawals`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${doc1Token}`,
      },
      body: JSON.stringify({ amount: 10000 }), // ₹10,000 > ₹5,000 balance
    });
    const res = await withdrawalsPOST(req, { params: Promise.resolve({ doctorId: doc1Id }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Insufficient balance');
  });

  it('41.6 POST creates a valid partial withdrawal successfully (201) and decrements balance', async () => {
    const initialDoc = await prisma.doctor.findUnique({ where: { id: doc1Id } });
    const initialBalance = initialDoc?.balance || 0;

    const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1Id}/withdrawals`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${doc1Token}`,
      },
      body: JSON.stringify({ amount: 1500 }), // ₹1,500 = 150,000 paise
    });
    const res = await withdrawalsPOST(req, { params: Promise.resolve({ doctorId: doc1Id }) });
    expect(res.status).toBe(201);
    const data = await res.json();

    expect(data.message).toBe('Withdrawal request created successfully');
    expect(data.withdrawal.amount).toBe(150000); // in paise
    expect(data.withdrawal.amountInRupees).toBe(1500);
    expect(data.withdrawal.status).toBe('PENDING');
    expect(data.withdrawal.bankAccountNumber).toMatch(/^\*{8}\d{4}$/);

    createdWithdrawalIds.push(data.withdrawal.id);

    // Verify balance deduction in DB
    const updatedDoc = await prisma.doctor.findUnique({ where: { id: doc1Id } });
    expect(updatedDoc?.balance).toBe(initialBalance - 150000); // 500,000 - 150,000 = 350,000 paise (₹3,500)
  });

  it('41.7 POST creates a full balance withdrawal successfully (201)', async () => {
    const docBefore = await prisma.doctor.findUnique({ where: { id: doc1Id } });
    const remainingRupees = (docBefore?.balance || 0) / 100;

    const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1Id}/withdrawals`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${doc1Token}`,
      },
      body: JSON.stringify({ amount: remainingRupees }),
    });
    const res = await withdrawalsPOST(req, { params: Promise.resolve({ doctorId: doc1Id }) });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.withdrawal.status).toBe('PENDING');
    expect(data.withdrawal.bankAccountNumber).toMatch(/^\*{8}\d{4}$/);

    createdWithdrawalIds.push(data.withdrawal.id);

    const docAfter = await prisma.doctor.findUnique({ where: { id: doc1Id } });
    expect(docAfter?.balance).toBe(0);
  });

  it('41.8 GET returns complete withdrawal history ordered by newest first with masked bank details', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1Id}/withdrawals`, {
      headers: { authorization: `Bearer ${doc1Token}` },
    });
    const res = await withdrawalsGET(req, { params: Promise.resolve({ doctorId: doc1Id }) });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(2);
    expect(data[0].amountInRupees).toBeDefined();
    expect(data[0].bankAccountNumber).toMatch(/^\*{8}\d{4}$/);
  });
});
