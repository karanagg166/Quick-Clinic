import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createToken } from '@/lib/auth';
import { createSlotHold, ownsHold, confirmSlotHold, cancelSlotHold } from '@/lib/booking';
import { GET as adminLogsGET } from '@/app/api/admin/logs/route';
import { GET as doctorBankGET, PATCH as doctorBankPATCH } from '@/app/api/doctors/[doctorId]/bank-details/route';
import { GET as userBankGET, POST as userBankPOST } from '@/app/api/user/[userId]/bank-details/route';
import { POST as doctorWithdrawalPOST } from '@/app/api/doctors/[doctorId]/withdrawals/route';
import { POST as verifyOrderPOST } from '@/app/api/user/[userId]/payments/verifyOrder/route';

import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Part 1B: Security & Robustness Verification Test Suite', () => {
  let adminUserId: string;
  let adminToken: string;

  let doc1UserId: string;
  let doc1Id: string;
  let doc1Token: string;

  let doc2UserId: string;
  let doc2Id: string;
  let doc2Token: string;

  let patient1UserId: string;
  let patient1Id: string;
  let patient1Token: string;

  let patient2UserId: string;
  let patient2Id: string;
  let patient2Token: string;

  let testSlotId: string;

  beforeAll(async () => {
    const locationConnect = {
      connectOrCreate: {
        where: { pincode: 121004 },
        create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
      },
    };

    // 1. Create Admin User
    const adminPayload = buildUserPayload({ name: 'Super Admin Test', role: 'ADMIN' });
    const adminUser = await prisma.user.create({
      data: {
        name: adminPayload.name,
        email: adminPayload.email,
        phoneNo: adminPayload.phoneNo,
        password: adminPayload.password,
        role: 'ADMIN',
        age: 35,
        gender: 'MALE',
        address: '100 Admin HQ',
        location: locationConnect,
      },
    });
    adminUserId = adminUser.id;
    adminToken = await createToken({ id: adminUserId, userId: adminUserId, role: 'ADMIN' });

    // 2. Create Doctor 1
    const doc1Payload = buildUserPayload({ name: 'Dr. Hardened One', role: 'DOCTOR' });
    const doc1User = await prisma.user.create({
      data: {
        name: doc1Payload.name,
        email: doc1Payload.email,
        phoneNo: doc1Payload.phoneNo,
        password: doc1Payload.password,
        role: 'DOCTOR',
        age: 42,
        gender: 'MALE',
        address: '101 Clinic Road',
        location: locationConnect,
      },
    });
    doc1UserId = doc1User.id;
    doc1Token = await createToken({ id: doc1UserId, userId: doc1UserId, role: 'DOCTOR' });

    const doc1 = await prisma.doctor.create({
      data: {
        userId: doc1UserId,
        specialty: 'GENERAL_PHYSICIAN',
        fees: 500,
        balance: 100000, // 1000 INR
      },
    });
    doc1Id = doc1.id;

    // 3. Create Doctor 2
    const doc2Payload = buildUserPayload({ name: 'Dr. Hardened Two', role: 'DOCTOR' });
    const doc2User = await prisma.user.create({
      data: {
        name: doc2Payload.name,
        email: doc2Payload.email,
        phoneNo: doc2Payload.phoneNo,
        password: doc2Payload.password,
        role: 'DOCTOR',
        age: 38,
        gender: 'FEMALE',
        address: '102 Hospital Blvd',
        location: locationConnect,
      },
    });
    doc2UserId = doc2User.id;
    doc2Token = await createToken({ id: doc2UserId, userId: doc2UserId, role: 'DOCTOR' });

    const doc2 = await prisma.doctor.create({
      data: {
        userId: doc2UserId,
        specialty: 'DERMATOLOGIST',
        fees: 800,
        balance: 50000,
      },
    });
    doc2Id = doc2.id;

    // 4. Create Patient 1
    const pat1Payload = buildUserPayload({ name: 'Patient Hardened One', role: 'PATIENT' });
    const pat1User = await prisma.user.create({
      data: {
        name: pat1Payload.name,
        email: pat1Payload.email,
        phoneNo: pat1Payload.phoneNo,
        password: pat1Payload.password,
        role: 'PATIENT',
        age: 28,
        gender: 'FEMALE',
        address: '201 Patient Ave',
        location: locationConnect,
      },
    });
    patient1UserId = pat1User.id;
    patient1Token = await createToken({ id: patient1UserId, userId: patient1UserId, role: 'PATIENT' });

    const pat1 = await prisma.patient.create({
      data: {
        userId: patient1UserId,
      },
    });
    patient1Id = pat1.id;

    // 5. Create Patient 2
    const pat2Payload = buildUserPayload({ name: 'Patient Hardened Two', role: 'PATIENT' });
    const pat2User = await prisma.user.create({
      data: {
        name: pat2Payload.name,
        email: pat2Payload.email,
        phoneNo: pat2Payload.phoneNo,
        password: pat2Payload.password,
        role: 'PATIENT',
        age: 31,
        gender: 'MALE',
        address: '202 Patient Lane',
        location: locationConnect,
      },
    });
    patient2UserId = pat2User.id;
    patient2Token = await createToken({ id: patient2UserId, userId: patient2UserId, role: 'PATIENT' });

    const pat2 = await prisma.patient.create({
      data: {
        userId: patient2UserId,
      },
    });
    patient2Id = pat2.id;

    // Create a slot for Doctor 1
    const slot = await prisma.slot.create({
      data: {
        doctorId: doc1Id,
        date: new Date('2029-08-01T00:00:00.000Z'),
        startTime: new Date('2029-08-01T10:00:00.000Z'),
        endTime: new Date('2029-08-01T10:15:00.000Z'),
        status: 'AVAILABLE',
      },
    });
    testSlotId = slot.id;
  }, 60000);

  afterAll(async () => {
    try {
      const docIds = [doc1Id, doc2Id].filter(Boolean);
      const userIds = [adminUserId, doc1UserId, doc2UserId, patient1UserId, patient2UserId].filter(Boolean);
      const patientIds = [patient1Id, patient2Id].filter(Boolean);

      if (docIds.length > 0) {
        await prisma.appointment.deleteMany({ where: { doctorId: { in: docIds } } });
        await prisma.withdrawal.deleteMany({ where: { doctorId: { in: docIds } } });
        await prisma.slot.deleteMany({ where: { doctorId: { in: docIds } } });
        await prisma.doctor.deleteMany({ where: { id: { in: docIds } } });
      }
      if (userIds.length > 0) {
        await prisma.bankAccount.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
      }
      if (patientIds.length > 0) {
        await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
      }
      if (userIds.length > 0) {
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
    } catch (e) {
      console.warn('Part 1B test cleanup warning:', e);
    }
  }, 60000);

  describe('1. Slot Hold Security & DB Durability', () => {
    let holdToken1: string;

    it('1.1 creates a slot hold and persists holdToken & holdExpiresAt in the database', async () => {
      const hold = await createSlotHold(testSlotId, doc1Id, patient1Id);

      expect(hold).not.toBeNull();
      expect(hold?.token).toBeDefined();
      holdToken1 = hold!.token;

      // Verify directly in DB
      const dbSlot = await prisma.slot.findUnique({ where: { id: testSlotId } });
      expect(dbSlot?.status).toBe('HELD');
      expect(dbSlot?.heldByPatientId).toBe(patient1Id);
      expect(dbSlot?.holdToken).toBe(holdToken1);
      expect(dbSlot?.holdExpiresAt).toBeDefined();
      expect(new Date(dbSlot!.holdExpiresAt!).getTime()).toBeGreaterThan(Date.now());
    });

    it('1.2 ownsHold validates proof of token possession (rejects wrong token even with correct patientId)', async () => {
      // Correct token -> true
      const isOwner = await ownsHold(testSlotId, patient1Id, holdToken1);
      expect(isOwner).toBe(true);

      // Wrong token -> false
      const isImposterOwner = await ownsHold(testSlotId, patient1Id, 'forged_fake_token_12345');
      expect(isImposterOwner).toBe(false);
    });

    it('1.3 confirmSlotHold rejects confirmation without the correct hold token', async () => {
      const failedConfirm = await confirmSlotHold({
        slotId: testSlotId,
        patientId: patient1Id,
        token: 'wrong_token',
        doctorId: doc1Id,
        paymentMethod: 'OFFLINE',
        isAppointmentOffline: true,
      });

      expect(failedConfirm).toBeNull();

      // Slot must still be HELD
      const slot = await prisma.slot.findUnique({ where: { id: testSlotId } });
      expect(slot?.status).toBe('HELD');
    });

    it('1.4 cancelSlotHold releases slot back to AVAILABLE when valid token is provided', async () => {
      const cancelled = await cancelSlotHold(testSlotId, patient1Id, holdToken1);

      expect(cancelled).toBe(true);

      const slot = await prisma.slot.findUnique({ where: { id: testSlotId } });
      expect(slot?.status).toBe('AVAILABLE');
      expect(slot?.holdToken).toBeNull();
      expect(slot?.heldByPatientId).toBeNull();
    });
  });

  describe('2. IDOR Protections across Routes', () => {
    it('2.1 Doctor 2 cannot view or edit Doctor 1 bank details (403 Forbidden)', async () => {
      // Doctor 2 attempts to GET Doctor 1's bank details
      const reqGet = new NextRequest(`http://localhost:3000/api/doctors/${doc1Id}/bank-details`, {
        method: 'GET',
        headers: { authorization: `Bearer ${doc2Token}` },
      });
      const resGet = await doctorBankGET(reqGet, {
        params: Promise.resolve({ doctorId: doc1Id }),
      });
      expect(resGet.status).toBe(403);

      // Doctor 2 attempts to PATCH Doctor 1's bank details
      const reqPost = new NextRequest(`http://localhost:3000/api/doctors/${doc1Id}/bank-details`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${doc2Token}` },
        body: JSON.stringify({
          bankAccountNumber: '123456789012',
          bankIFSC: 'HDFC0001234',
          bankAccountHolderName: 'Hacker',
          bankName: 'HDFC Bank',
        }),
      });
      const resPost = await doctorBankPATCH(reqPost, {
        params: Promise.resolve({ doctorId: doc1Id }),
      });
      expect(resPost.status).toBe(403);
    });

    it('2.2 Doctor 2 cannot initiate a withdrawal from Doctor 1 balance (403 Forbidden)', async () => {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1Id}/withdrawals`, {
        method: 'POST',
        headers: { authorization: `Bearer ${doc2Token}` },
        body: JSON.stringify({
          amount: 50000,
          currency: 'INR',
        }),
      });

      const res = await doctorWithdrawalPOST(req, {
        params: Promise.resolve({ doctorId: doc1Id }),
      });
      expect(res.status).toBe(403);
    });

    it('2.3 Patient 2 cannot access Patient 1 bank details (403 Forbidden)', async () => {
      const reqGet = new NextRequest(`http://localhost:3000/api/user/${patient1UserId}/bank-details`, {
        method: 'GET',
        headers: { authorization: `Bearer ${patient2Token}` },
      });
      const resGet = await userBankGET(reqGet, {
        params: Promise.resolve({ userId: patient1UserId }),
      });
      expect(resGet.status).toBe(403);
    });
  });

  describe('3. Admin Logs Hardening & Cursor Pagination', () => {
    beforeAll(async () => {
      // Create some audit logs
      await prisma.auditLog.createMany({
        data: [
          { userId: doc1UserId, action: 'Test Action 1', tag: 'SECURITY' },
          { userId: doc1UserId, action: 'Test Action 2', tag: 'SECURITY' },
          { userId: adminUserId, action: 'Admin Action 1', tag: 'ADMIN' },
        ],
      });
    });

    it('3.1 non-admin request to admin logs is rejected (401 Unauthorized)', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/logs', {
        headers: { authorization: `Bearer ${doc1Token}` },
      });
      const res = await adminLogsGET(req);
      expect(res.status).toBe(401);
    });

    it('3.2 admin request succeeds and returns paginated logs with nextCursor support', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/logs?limit=2', {
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const res = await adminLogsGET(req);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(Array.isArray(body.logs)).toBe(true);
      expect(body.logs.length).toBeLessThanOrEqual(2);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.limit).toBe(2);
    });

    it('3.3 scope=my restricts results to the authenticated admin identity', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/logs?scope=my', {
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const res = await adminLogsGET(req);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.logs.every((log: any) => log.userId === adminUserId)).toBe(true);
    });
  });
});
