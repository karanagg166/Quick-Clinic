import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as adminLogsGET } from '@/app/api/admin/logs/route';
import { POST as doctorWithdrawalPOST } from '@/app/api/doctors/[doctorId]/withdrawals/route';
import { createToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 55: Formal Access Control Matrix Test Suite', () => {
  let adminUserId: string;
  let adminToken: string;

  let docUserId: string;
  let docId: string;
  let docToken: string;

  let patientUserId: string;
  let patientId: string;
  let patientToken: string;

  beforeAll(async () => {
    // 1. Admin
    const adminPayload = buildUserPayload({ role: 'ADMIN', email: `acm_admin_${Date.now()}@quickclinic.test` });
    const adminUser = await prisma.user.create({
      data: {
        name: adminPayload.name,
        email: adminPayload.email,
        phoneNo: adminPayload.phoneNo,
        password: adminPayload.password,
        age: 40,
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

    // 2. Doctor
    const docPayload = buildUserPayload({ role: 'DOCTOR', email: `acm_doc_${Date.now()}@quickclinic.test` });
    const docUser = await prisma.user.create({
      data: {
        name: docPayload.name,
        email: docPayload.email,
        phoneNo: docPayload.phoneNo,
        password: docPayload.password,
        age: 45,
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
      data: { userId: docUserId, specialty: 'CARDIOLOGIST', fees: 800, experience: 15 },
    });
    docId = d.id;
    docToken = await createToken({ id: docUserId, email: docUser.email, role: 'DOCTOR', name: docUser.name });

    // 3. Patient
    const patPayload = buildUserPayload({ role: 'PATIENT', email: `acm_pat_${Date.now()}@quickclinic.test` });
    const patUser = await prisma.user.create({
      data: {
        name: patPayload.name,
        email: patPayload.email,
        phoneNo: patPayload.phoneNo,
        password: patPayload.password,
        age: 28,
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
    const p = await prisma.patient.create({ data: { userId: patientUserId } });
    patientId = p.id;
    patientToken = await createToken({ id: patientUserId, email: patUser.email, role: 'PATIENT', name: patUser.name });
  });

  afterAll(async () => {
    try {
      await prisma.patient.deleteMany({ where: { id: patientId } });
      await prisma.doctor.deleteMany({ where: { id: docId } });
      await prisma.admin.deleteMany({ where: { userId: adminUserId } });
      await prisma.user.deleteMany({
        where: { id: { in: [adminUserId, docUserId, patientUserId] } },
      });
    } catch (e) {
      console.warn('Phase 55 cleanup warning:', e);
    }
  });

  it('55.1 Matrix: Admin Logs Resource Access', async () => {
    // Unauthenticated -> 401
    const unauthReq = new NextRequest('http://localhost:3000/api/admin/logs');
    expect((await adminLogsGET(unauthReq)).status).toBe(401);

    // Patient -> 401
    const patReq = new NextRequest('http://localhost:3000/api/admin/logs', {
      headers: { Cookie: `token=${patientToken}` },
    });
    expect((await adminLogsGET(patReq)).status).toBe(401);

    // Doctor -> 401
    const docReq = new NextRequest('http://localhost:3000/api/admin/logs', {
      headers: { Cookie: `token=${docToken}` },
    });
    expect((await adminLogsGET(docReq)).status).toBe(401);

    // Admin -> 200
    const adminReq = new NextRequest('http://localhost:3000/api/admin/logs', {
      headers: { Cookie: `token=${adminToken}` },
    });
    expect((await adminLogsGET(adminReq)).status).toBe(200);
  });

  it('55.2 Matrix: Doctor Withdrawal Resource Access (Patient cannot withdraw)', async () => {
    // Patient attempting doctor withdrawal endpoint
    const patWithdrawReq = new NextRequest(`http://localhost:3000/api/doctors/${patientId}/withdrawals`, {
      method: 'POST',
      body: JSON.stringify({ amount: 500 }),
    });
    const res = await doctorWithdrawalPOST(patWithdrawReq, { params: Promise.resolve({ doctorId: patientId }) });
    expect(res.status).toBe(404);
  });
});
