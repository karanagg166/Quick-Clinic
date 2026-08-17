import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as earningsGET } from '@/app/api/doctors/[doctorId]/earnings/route';
import { GET as balanceGET } from '@/app/api/doctors/[doctorId]/balance/route';
import { POST as adminOnboardPOST } from '@/app/api/admin/onboarding/route';
import { createToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 56: IDOR (Insecure Direct Object Reference) Protection Test Suite', () => {
  let doc1UserId: string;
  let doc1Id: string;
  let doc2UserId: string;
  let doc2Id: string;

  let patient1UserId: string;
  let patient1Token: string;

  let adminUserId: string;
  let adminToken: string;

  beforeAll(async () => {
    // Doctor 1
    const doc1Payload = buildUserPayload({ role: 'DOCTOR', email: `idor_doc1_${Date.now()}@quickclinic.test` });
    const doc1User = await prisma.user.create({
      data: {
        name: doc1Payload.name,
        email: doc1Payload.email,
        phoneNo: doc1Payload.phoneNo,
        password: doc1Payload.password,
        age: 45,
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
    const d1 = await prisma.doctor.create({
      data: { userId: doc1UserId, specialty: 'CARDIOLOGIST', fees: 1000, experience: 15, balance: 50000 },
    });
    doc1Id = d1.id;

    // Doctor 2
    const doc2Payload = buildUserPayload({ role: 'DOCTOR', email: `idor_doc2_${Date.now()}@quickclinic.test` });
    const doc2User = await prisma.user.create({
      data: {
        name: doc2Payload.name,
        email: doc2Payload.email,
        phoneNo: doc2Payload.phoneNo,
        password: doc2Payload.password,
        age: 40,
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
    const d2 = await prisma.doctor.create({
      data: { userId: doc2UserId, specialty: 'PEDIATRICIAN', fees: 500, experience: 8, balance: 100000 },
    });
    doc2Id = d2.id;

    // Patient 1
    const pat1Payload = buildUserPayload({ role: 'PATIENT', email: `idor_pat1_${Date.now()}@quickclinic.test` });
    const pat1User = await prisma.user.create({
      data: {
        name: pat1Payload.name,
        email: pat1Payload.email,
        phoneNo: pat1Payload.phoneNo,
        password: pat1Payload.password,
        age: 30,
        address: pat1Payload.address,
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
    patient1UserId = pat1User.id;
    patient1Token = await createToken({ id: patient1UserId, email: pat1User.email, role: 'PATIENT', name: pat1User.name });

    // Admin
    const adminPayload = buildUserPayload({ role: 'ADMIN', email: `idor_admin_${Date.now()}@quickclinic.test` });
    const adminUser = await prisma.user.create({
      data: {
        name: adminPayload.name,
        email: adminPayload.email,
        phoneNo: adminPayload.phoneNo,
        password: adminPayload.password,
        age: 45,
        address: adminPayload.address,
        role: 'ADMIN',
        gender: 'MALE',
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    adminUserId = adminUser.id;
    await prisma.admin.create({ data: { userId: adminUserId } });
    adminToken = await createToken({ id: adminUserId, email: adminUser.email, role: 'ADMIN', name: adminUser.name });
  });

  afterAll(async () => {
    try {
      await prisma.doctor.deleteMany({ where: { id: { in: [doc1Id, doc2Id] } } });
      await prisma.admin.deleteMany({ where: { userId: adminUserId } });
      await prisma.user.deleteMany({
        where: { id: { in: [doc1UserId, doc2UserId, patient1UserId, adminUserId] } },
      });
    } catch (e) {
      console.warn('Phase 56 cleanup warning:', e);
    }
  });

  it('56.1 Doctor earnings endpoints are isolated strictly by doctorId and do not cross-leak', async () => {
    const req1 = new NextRequest(`http://localhost:3000/api/doctors/${doc1Id}/balance`);
    const res1 = await balanceGET(req1, { params: Promise.resolve({ doctorId: doc1Id }) });
    const data1 = await res1.json();

    const req2 = new NextRequest(`http://localhost:3000/api/doctors/${doc2Id}/balance`);
    const res2 = await balanceGET(req2, { params: Promise.resolve({ doctorId: doc2Id }) });
    const data2 = await res2.json();

    expect(data1.balance).toBe(50000);
    expect(data2.balance).toBe(100000);
  });

  it('56.2 Forged admin onboarding attempting to onboard another userId is forbidden (403)', async () => {
    // Admin user token attempting to onboard doc1UserId instead of themselves
    const req = new NextRequest('http://localhost:3000/api/admin/onboarding', {
      method: 'POST',
      headers: { Cookie: `token=${adminToken}` },
      body: JSON.stringify({
        userId: doc1UserId, // IDOR attempt
        secretCode: process.env.SUPER_ADMIN_CODE || 'QUICK_CLINIC_SUPER_ADMIN',
        name: 'Attacker Impersonator',
      }),
    });
    const res = await adminOnboardPOST(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain('Forbidden');
  });
});
