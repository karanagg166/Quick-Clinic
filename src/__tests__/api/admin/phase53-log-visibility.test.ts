import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as adminLogsGET } from '@/app/api/admin/logs/route';
import { createToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 53: Log Visibility & Scope Access Control Test Suite', () => {
  let adminUserId: string;
  let adminToken: string;

  let doctorUserId: string;
  let doctorToken: string;

  let patientUserId: string;
  let patientToken: string;

  beforeAll(async () => {
    // 1. Admin User
    const adminPayload = buildUserPayload({
      name: 'Log Scope Admin',
      email: `log_adm_${Date.now()}@quickclinic.test`,
      role: 'ADMIN',
    });
    const adminUser = await prisma.user.create({
      data: {
        name: adminPayload.name,
        email: adminPayload.email,
        phoneNo: adminPayload.phoneNo,
        password: adminPayload.password,
        age: 44,
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
      name: 'Doctor Inquiring Logs',
      email: `doc_log_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const docUser = await prisma.user.create({
      data: {
        name: docPayload.name,
        email: docPayload.email,
        phoneNo: docPayload.phoneNo,
        password: docPayload.password,
        age: 38,
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
      name: 'Patient Inquiring Logs',
      email: `pat_log_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const patUser = await prisma.user.create({
      data: {
        name: patPayload.name,
        email: patPayload.email,
        phoneNo: patPayload.phoneNo,
        password: patPayload.password,
        age: 25,
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
      await prisma.user.deleteMany({
        where: { id: { in: [adminUserId, doctorUserId, patientUserId] } },
      });
    } catch (e) {
      console.warn('Phase 53 cleanup warning:', e);
    }
  });

  it('53.1 Direct request from unauthenticated client is rejected with 401', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/logs');
    const res = await adminLogsGET(req);
    expect(res.status).toBe(401);
  });

  it('53.2 Direct request from DOCTOR client is rejected with 401', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/logs', {
      headers: { Cookie: `token=${doctorToken}` },
    });
    const res = await adminLogsGET(req);
    expect(res.status).toBe(401);
  });

  it('53.3 Direct request from PATIENT client is rejected with 401', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/logs', {
      headers: { Cookie: `token=${patientToken}` },
    });
    const res = await adminLogsGET(req);
    expect(res.status).toBe(401);
  });

  it('53.4 Authorized ADMIN can query logs with scope=all', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/logs?scope=all', {
      headers: { Cookie: `token=${adminToken}` },
    });
    const res = await adminLogsGET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.logs).toBeDefined();
  });

  it('53.5 Authorized ADMIN can query logs with scope=my and userId', async () => {
    const req = new NextRequest(`http://localhost:3000/api/admin/logs?scope=my&userId=${adminUserId}`, {
      headers: { Cookie: `token=${adminToken}` },
    });
    const res = await adminLogsGET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.logs).toBeDefined();
  });
});
