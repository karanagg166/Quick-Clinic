import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as adminLogsGET } from '@/app/api/admin/logs/route';
import { createToken } from '@/lib/auth';
import { logAccess } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 52: Access Logs System & Sensitive Resource Audit Test Suite', () => {
  let adminUserId: string;
  let adminToken: string;
  let viewerUserId: string;
  let targetResourceId: string;

  beforeAll(async () => {
    // 1. Admin
    const adminPayload = buildUserPayload({
      name: 'Access Log Auditor',
      email: `access_adm_${Date.now()}@quickclinic.test`,
      role: 'ADMIN',
    });
    const adminUser = await prisma.user.create({
      data: {
        name: adminPayload.name,
        email: adminPayload.email,
        phoneNo: adminPayload.phoneNo,
        password: adminPayload.password,
        age: 36,
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

    // 2. Viewer User
    const viewerPayload = buildUserPayload({
      name: 'Resource Viewer User',
      email: `access_viewer_${Date.now()}@quickclinic.test`,
    });
    const viewerUser = await prisma.user.create({
      data: {
        name: viewerPayload.name,
        email: viewerPayload.email,
        phoneNo: viewerPayload.phoneNo,
        password: viewerPayload.password,
        age: 33,
        address: viewerPayload.address,
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
    viewerUserId = viewerUser.id;
    targetResourceId = `doc_profile_${Date.now()}`;

    // Seed access logs
    await logAccess(viewerUserId, targetResourceId, 'VIEW_DOCTOR_PROFILE', 'DOCTOR');
    await logAccess(viewerUserId, 'pat_medical_history_01', 'VIEW_MEDICAL_HISTORY', 'PATIENT');
    await logAccess(adminUserId, 'admin_financial_dashboard', 'VIEW_FINANCIAL_METRICS', 'FINANCIAL');
  });

  afterAll(async () => {
    try {
      await prisma.accessLog.deleteMany({ where: { userId: { in: [adminUserId, viewerUserId] } } });
      await prisma.admin.deleteMany({ where: { userId: adminUserId } });
      await prisma.user.deleteMany({ where: { id: { in: [adminUserId, viewerUserId] } } });
    } catch (e) {
      console.warn('Phase 52 cleanup warning:', e);
    }
  });

  it('52.1 GET /api/admin/logs?type=access retrieves access logs with user relations', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/logs?type=access', {
      headers: { Cookie: `token=${adminToken}` },
    });
    const res = await adminLogsGET(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(Array.isArray(data.logs)).toBe(true);
    expect(data.logs.length).toBeGreaterThanOrEqual(3);
    expect(data.logs[0].action).toBeDefined();
  });

  it('52.2 Filters access logs by userId', async () => {
    const req = new NextRequest(`http://localhost:3000/api/admin/logs?type=access&userId=${viewerUserId}`, {
      headers: { Cookie: `token=${adminToken}` },
    });
    const res = await adminLogsGET(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.logs.every((l: { userId: string }) => l.userId === viewerUserId)).toBe(true);
    expect(data.logs.length).toBe(2);
  });

  it('52.3 Filters access logs by tag (e.g. DOCTOR, PATIENT, FINANCIAL)', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/logs?type=access&tag=FINANCIAL', {
      headers: { Cookie: `token=${adminToken}` },
    });
    const res = await adminLogsGET(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.logs.every((l: { tag: string }) => l.tag === 'FINANCIAL')).toBe(true);
  });

  it('52.4 Filters access logs by timeRange=last5Mins', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/logs?type=access&timeRange=last5Mins', {
      headers: { Cookie: `token=${adminToken}` },
    });
    const res = await adminLogsGET(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.logs.length).toBeGreaterThanOrEqual(3);
  });
});
