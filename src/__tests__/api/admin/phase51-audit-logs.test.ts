import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as adminLogsGET } from '@/app/api/admin/logs/route';
import { createToken } from '@/lib/auth';
import { logAudit } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 51: Audit Logs System & Query Filters Test Suite', () => {
  let adminUserId: string;
  let adminToken: string;
  let sampleUserId: string;

  beforeAll(async () => {
    // 1. Admin
    const adminPayload = buildUserPayload({
      name: 'Audit Inspector Admin',
      email: `audit_adm_${Date.now()}@quickclinic.test`,
      role: 'ADMIN',
    });
    const adminUser = await prisma.user.create({
      data: {
        name: adminPayload.name,
        email: adminPayload.email,
        phoneNo: adminPayload.phoneNo,
        password: adminPayload.password,
        age: 37,
        address: adminPayload.address,
        role: 'ADMIN',
        gender: 'FEMALE',
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

    // 2. Sample User for creating audit events
    const samplePayload = buildUserPayload({
      name: 'Sample Audited User',
      email: `audit_sample_${Date.now()}@quickclinic.test`,
    });
    const sampleUser = await prisma.user.create({
      data: {
        name: samplePayload.name,
        email: samplePayload.email,
        phoneNo: samplePayload.phoneNo,
        password: samplePayload.password,
        age: 28,
        address: samplePayload.address,
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
    sampleUserId = sampleUser.id;

    // Seed audit logs
    await logAudit(sampleUserId, 'PASSWORD_CHANGED', { ip: '127.0.0.1' }, 'SECURITY');
    await logAudit(sampleUserId, 'PROFILE_UPDATED', { updatedFields: ['address'] }, 'PROFILE');
    await logAudit(adminUserId, 'DOCTOR_VERIFIED', { doctorId: 'doc_123' }, 'ADMIN');
  });

  afterAll(async () => {
    try {
      await prisma.auditLog.deleteMany({ where: { userId: { in: [adminUserId, sampleUserId] } } });
      await prisma.admin.deleteMany({ where: { userId: adminUserId } });
      await prisma.user.deleteMany({ where: { id: { in: [adminUserId, sampleUserId] } } });
    } catch (e) {
      console.warn('Phase 51 cleanup warning:', e);
    }
  });

  it('51.1 GET /api/admin/logs?type=audit retrieves audit logs with user information', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/logs?type=audit', {
      headers: { Cookie: `token=${adminToken}` },
    });
    const res = await adminLogsGET(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(Array.isArray(data.logs)).toBe(true);
    expect(data.logs.length).toBeGreaterThanOrEqual(3);
    expect(data.logs[0].action).toBeDefined();
  });

  it('51.2 Filters audit logs by userId accurately', async () => {
    const req = new NextRequest(`http://localhost:3000/api/admin/logs?type=audit&userId=${sampleUserId}`, {
      headers: { Cookie: `token=${adminToken}` },
    });
    const res = await adminLogsGET(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.logs.every((l: { userId: string }) => l.userId === sampleUserId)).toBe(true);
    expect(data.logs.length).toBe(2);
  });

  it('51.3 Filters audit logs by action substring (case-insensitive)', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/logs?type=audit&action=password', {
      headers: { Cookie: `token=${adminToken}` },
    });
    const res = await adminLogsGET(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.logs.some((l: { action: string }) => l.action.includes('PASSWORD'))).toBe(true);
  });

  it('51.4 Filters audit logs by tag (e.g. SECURITY, PROFILE, ADMIN)', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/logs?type=audit&tag=SECURITY', {
      headers: { Cookie: `token=${adminToken}` },
    });
    const res = await adminLogsGET(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.logs.every((l: { tag: string }) => l.tag === 'SECURITY')).toBe(true);
  });

  it('51.5 Verifies secret safety: sensitive tokens and passwords are never logged', async () => {
    const logs = await prisma.auditLog.findMany({
      where: { userId: { in: [adminUserId, sampleUserId] } },
    });

    for (const log of logs) {
      if (log.metadata) {
        const metaStr = typeof log.metadata === 'string' ? log.metadata : JSON.stringify(log.metadata);
        expect(metaStr).not.toContain('password');
        expect(metaStr).not.toContain('razorpay_secret');
        expect(metaStr).not.toContain('jwt_secret');
      }
    }
  });
});
