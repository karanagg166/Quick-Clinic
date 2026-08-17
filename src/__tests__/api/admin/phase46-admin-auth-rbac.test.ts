import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as adminLogsGET } from '@/app/api/admin/logs/route';
import { createToken, requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 46: Admin Authentication & RBAC Test Suite', () => {
  let adminUserId: string;
  let doctorUserId: string;
  let patientUserId: string;

  let adminToken: string;
  let doctorToken: string;
  let patientToken: string;

  beforeAll(async () => {
    // 1. Admin User
    const adminPayload = buildUserPayload({
      name: 'Super Admin User',
      email: `admin_auth_${Date.now()}@quickclinic.test`,
      role: 'ADMIN',
    });
    const adminUser = await prisma.user.create({
      data: {
        name: adminPayload.name,
        email: adminPayload.email,
        phoneNo: adminPayload.phoneNo,
        password: adminPayload.password,
        age: 39,
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

    // 2. Doctor User
    const docPayload = buildUserPayload({
      name: 'Doctor RBAC User',
      email: `doc_rbac_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const docUser = await prisma.user.create({
      data: {
        name: docPayload.name,
        email: docPayload.email,
        phoneNo: docPayload.phoneNo,
        password: docPayload.password,
        age: 42,
        address: docPayload.address,
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
    doctorToken = await createToken({ id: doctorUserId, email: docUser.email, role: 'DOCTOR', name: docUser.name });

    // 3. Patient User
    const patPayload = buildUserPayload({
      name: 'Patient RBAC User',
      email: `pat_rbac_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const patUser = await prisma.user.create({
      data: {
        name: patPayload.name,
        email: patPayload.email,
        phoneNo: patPayload.phoneNo,
        password: patPayload.password,
        age: 26,
        address: patPayload.address,
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
    patientToken = await createToken({ id: patientUserId, email: patUser.email, role: 'PATIENT', name: patUser.name });
  });

  afterAll(async () => {
    try {
      await prisma.admin.deleteMany({ where: { userId: adminUserId } });
      await prisma.user.deleteMany({ where: { id: { in: [adminUserId, doctorUserId, patientUserId] } } });
    } catch (e) {
      console.warn('Phase 46 cleanup warning:', e);
    }
  });

  it('46.1 Rejects unauthenticated request without token (401)', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/logs');
    const res = await adminLogsGET(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('Unauthorized');
  });

  it('46.2 Rejects PATIENT user attempting to access admin route (401)', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/logs', {
      headers: {
        Cookie: `token=${patientToken}`,
      },
    });
    const res = await adminLogsGET(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('Unauthorized');
  });

  it('46.3 Rejects DOCTOR user attempting to access admin route (401)', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/logs', {
      headers: {
        Cookie: `token=${doctorToken}`,
      },
    });
    const res = await adminLogsGET(req);
    expect(res.status).toBe(401);
  });

  it('46.4 Rejects forged token with invalid signature (401)', async () => {
    const forgedToken = `${adminToken.slice(0, -10)}abcdefghij`;
    const req = new NextRequest('http://localhost:3000/api/admin/logs', {
      headers: {
        Cookie: `token=${forgedToken}`,
      },
    });
    const res = await adminLogsGET(req);
    expect(res.status).toBe(401);
  });

  it('46.5 Authenticated ADMIN user succeeds with 200 OK', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/logs', {
      headers: {
        Cookie: `token=${adminToken}`,
      },
    });
    const res = await adminLogsGET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.logs).toBeDefined();
  });

  it('46.6 requireAdmin helper correctly verifies admin payload structure', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/logs', {
      headers: { Cookie: `token=${adminToken}` },
    });
    const admin = await requireAdmin(req);
    expect(admin).not.toBeNull();
    expect(admin?.role).toBe('ADMIN');
    expect(admin?.id).toBe(adminUserId);
  });
});
