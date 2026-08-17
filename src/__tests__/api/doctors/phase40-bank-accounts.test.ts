import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import {
  GET as doctorBankGET,
  PATCH as doctorBankPATCH,
} from '@/app/api/doctors/[doctorId]/bank-details/route';
import {
  GET as userBankGET,
  PATCH as userBankPATCH,
} from '@/app/api/user/[userId]/bank-details/route';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 40: Bank Accounts Management & IFSC Validation Test Suite', () => {
  let docUserId: string;
  let docId: string;
  let patientUserId: string;

  beforeAll(async () => {
    // 1. Create Doctor
    const docPayload = buildUserPayload({
      name: 'Dr. Bank Account Holder',
      email: `doc_bank_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const docUser = await prisma.user.create({
      data: {
        name: docPayload.name,
        email: docPayload.email,
        phoneNo: docPayload.phoneNo,
        password: docPayload.password,
        age: 51,
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
        specialty: 'GENERAL_SURGEON',
        fees: 1100,
        experience: 20,
      },
    });
    docId = d.id;

    // 2. Create Patient (for isolation)
    const patPayload = buildUserPayload({
      name: 'Patient Non Doctor',
      email: `pat_bank_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const patUser = await prisma.user.create({
      data: {
        name: patPayload.name,
        email: patPayload.email,
        phoneNo: patPayload.phoneNo,
        password: patPayload.password,
        age: 29,
        address: patPayload.address,
        role: 'PATIENT',
        gender: 'FEMALE',
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    patientUserId = patUser.id;
  });

  afterAll(async () => {
    try {
      await prisma.bankAccount.deleteMany({
        where: { userId: { in: [docUserId, patientUserId] } },
      });
      await prisma.doctor.deleteMany({ where: { id: docId } });
      await prisma.user.deleteMany({
        where: { id: { in: [docUserId, patientUserId] } },
      });
    } catch (e) {
      console.warn('Phase 40 cleanup warning:', e);
    }
  });

  it('40.1 GET doctor bank details returns null fields when no account is configured', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${docId}/bank-details`);
    const res = await doctorBankGET(req, { params: Promise.resolve({ doctorId: docId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.bankAccountNumber).toBeNull();
    expect(data.bankIFSC).toBeNull();
    expect(data.bankAccountHolderName).toBeNull();
    expect(data.bankName).toBeNull();
  });

  it('40.2 PATCH doctor bank details rejects missing required fields with 400', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${docId}/bank-details`, {
      method: 'PATCH',
      body: JSON.stringify({
        bankAccountNumber: '1234567890',
        bankIFSC: 'HDFC0001234',
        // missing bankAccountHolderName and bankName
      }),
    });
    const res = await doctorBankPATCH(req, { params: Promise.resolve({ doctorId: docId }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('All bank details are required');
  });

  it('40.3 PATCH rejects invalid IFSC code format with 400', async () => {
    const invalidIFSCs = ['HDFC1234', '12340001234', 'HDFC00012', 'HDFC000123456'];
    for (const ifsc of invalidIFSCs) {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${docId}/bank-details`, {
        method: 'PATCH',
        body: JSON.stringify({
          bankAccountNumber: '987654321012',
          bankIFSC: ifsc,
          bankAccountHolderName: 'Dr. Bank Account Holder',
          bankName: 'HDFC Bank',
        }),
      });
      const res = await doctorBankPATCH(req, { params: Promise.resolve({ doctorId: docId }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Invalid IFSC code format');
    }
  });

  it('40.4 PATCH rejects invalid account number format with 400 (under 9 digits or non-numeric)', async () => {
    const invalidAccs = ['12345', 'abcd12345678', ''];
    for (const acc of invalidAccs) {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${docId}/bank-details`, {
        method: 'PATCH',
        body: JSON.stringify({
          bankAccountNumber: acc,
          bankIFSC: 'HDFC0001234',
          bankAccountHolderName: 'Dr. Bank Account Holder',
          bankName: 'HDFC Bank',
        }),
      });
      const res = await doctorBankPATCH(req, { params: Promise.resolve({ doctorId: docId }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe(acc === '' ? 'All bank details are required' : 'Invalid account number');
    }
  });

  it('40.5 PATCH creates new bank details successfully (200 OK)', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${docId}/bank-details`, {
      method: 'PATCH',
      body: JSON.stringify({
        bankAccountNumber: '98765432101234',
        bankIFSC: 'HDFC0001234',
        bankAccountHolderName: 'Dr. Bank Account Holder',
        bankName: 'HDFC Bank',
      }),
    });
    const res = await doctorBankPATCH(req, { params: Promise.resolve({ doctorId: docId }) });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.message).toBe('Bank details updated successfully');
    expect(data.bankDetails.bankAccountNumber).toBe('98765432101234');
    expect(data.bankDetails.bankIFSC).toBe('HDFC0001234');
    expect(data.bankDetails.bankAccountHolderName).toBe('Dr. Bank Account Holder');
    expect(data.bankDetails.bankName).toBe('HDFC Bank');
  });

  it('40.6 Idempotency: PATCH updates existing bank account without creating duplicate records', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${docId}/bank-details`, {
      method: 'PATCH',
      body: JSON.stringify({
        bankAccountNumber: '98765432109999',
        bankIFSC: 'SBIN0004567',
        bankAccountHolderName: 'Dr. Bank Account Holder',
        bankName: 'State Bank of India',
      }),
    });
    const res = await doctorBankPATCH(req, { params: Promise.resolve({ doctorId: docId }) });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.bankDetails.bankAccountNumber).toBe('98765432109999');
    expect(data.bankDetails.bankIFSC).toBe('SBIN0004567');
    expect(data.bankDetails.bankName).toBe('State Bank of India');

    // Verify DB count is exactly 1 for this user
    const count = await prisma.bankAccount.count({ where: { userId: docUserId } });
    expect(count).toBe(1);
  });

  it('40.7 GET retrieves the updated bank details', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${docId}/bank-details`);
    const res = await doctorBankGET(req, { params: Promise.resolve({ doctorId: docId }) });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.bankAccountNumber).toBe('98765432109999');
    expect(data.bankIFSC).toBe('SBIN0004567');
    expect(data.bankAccountHolderName).toBe('Dr. Bank Account Holder');
    expect(data.bankName).toBe('State Bank of India');
  });

  it('40.8 User-level bank-details API works consistently for any user', async () => {
    const patchReq = new NextRequest(`http://localhost:3000/api/user/${patientUserId}/bank-details`, {
      method: 'PATCH',
      body: JSON.stringify({
        bankAccountNumber: '112233445566',
        bankIFSC: 'ICIC0001234',
        bankAccountHolderName: 'Patient Non Doctor',
        bankName: 'ICICI Bank',
      }),
    });
    const patchRes = await userBankPATCH(patchReq, { params: Promise.resolve({ userId: patientUserId }) });
    expect(patchRes.status).toBe(200);

    const getReq = new NextRequest(`http://localhost:3000/api/user/${patientUserId}/bank-details`);
    const getRes = await userBankGET(getReq, { params: Promise.resolve({ userId: patientUserId }) });
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.bankAccountNumber).toBe('112233445566');
    expect(getData.bankName).toBe('ICICI Bank');
  });

  it('40.9 Rejects operations for non-existent doctor with 404', async () => {
    const req = new NextRequest('http://localhost:3000/api/doctors/non_existent_doc/bank-details');
    const res = await doctorBankGET(req, { params: Promise.resolve({ doctorId: 'non_existent_doc' }) });
    expect(res.status).toBe(404);
  });
});
