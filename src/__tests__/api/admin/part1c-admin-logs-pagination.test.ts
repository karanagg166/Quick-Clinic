import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createToken } from '@/lib/auth';
import { GET as adminLogsGET } from '@/app/api/admin/logs/route';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Part 1C: Admin Logs Deterministic Cursor Pagination Suite', () => {
  let adminUserId: string;
  let adminToken: string;
  const createdAuditLogIds: string[] = [];

  beforeAll(async () => {
    // 1. Create Admin User & Admin record
    const adminPayload = buildUserPayload({
      name: 'Admin Pagination Tester',
      email: `admin_pag_${Date.now()}@quickclinic.test`,
      role: 'ADMIN',
    });
    const adminUser = await prisma.user.create({
      data: {
        name: adminPayload.name,
        email: adminPayload.email,
        phoneNo: adminPayload.phoneNo,
        password: adminPayload.password,
        age: 40,
        gender: 'MALE',
        address: '789 Admin HQ',
        role: 'ADMIN',
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    adminUserId = adminUser.id;
    adminToken = await createToken({ id: adminUserId, email: adminUser.email, role: 'ADMIN', name: adminUser.name });
    await prisma.admin.create({ data: { userId: adminUserId } });

    // 2. Create 5 audit logs with distinct tag and controlled timestamps
    // Log 1, 2, 3 have the exact same createdAt timestamp to test deterministic tiebreaker
    const fixedTimestamp = new Date('2026-08-18T10:00:00.000Z');
    const earlierTimestamp = new Date('2026-08-18T09:00:00.000Z');
    const earliestTimestamp = new Date('2026-08-18T08:00:00.000Z');

    const log1 = await prisma.auditLog.create({
      data: {
        userId: adminUserId,
        action: 'PART1C_ACTION_1',
        tag: 'PART1C_TEST_TAG',
        createdAt: fixedTimestamp,
      },
    });
    createdAuditLogIds.push(log1.id);

    const log2 = await prisma.auditLog.create({
      data: {
        userId: adminUserId,
        action: 'PART1C_ACTION_2',
        tag: 'PART1C_TEST_TAG',
        createdAt: fixedTimestamp,
      },
    });
    createdAuditLogIds.push(log2.id);

    const log3 = await prisma.auditLog.create({
      data: {
        userId: adminUserId,
        action: 'PART1C_ACTION_3',
        tag: 'PART1C_TEST_TAG',
        createdAt: fixedTimestamp,
      },
    });
    createdAuditLogIds.push(log3.id);

    const log4 = await prisma.auditLog.create({
      data: {
        userId: adminUserId,
        action: 'PART1C_ACTION_4',
        tag: 'PART1C_TEST_TAG',
        createdAt: earlierTimestamp,
      },
    });
    createdAuditLogIds.push(log4.id);

    const log5 = await prisma.auditLog.create({
      data: {
        userId: adminUserId,
        action: 'PART1C_ACTION_5',
        tag: 'PART1C_TEST_TAG',
        createdAt: earliestTimestamp,
      },
    });
    createdAuditLogIds.push(log5.id);
  });

  afterAll(async () => {
    try {
      if (createdAuditLogIds.length > 0) {
        await prisma.auditLog.deleteMany({ where: { id: { in: createdAuditLogIds } } });
      }
      await prisma.admin.deleteMany({ where: { userId: adminUserId } });
      await prisma.user.deleteMany({ where: { id: adminUserId } });
    } catch (e) {
      console.warn('Cleanup warning in Part 1C admin pagination test:', e);
    }
  });

  it('3.1 Standard pagination: page 1 and page 2 contain no duplicates and skip no rows (limit = 2)', async () => {
    // Page 1
    const req1 = new NextRequest('http://localhost:3000/api/admin/logs?tag=PART1C_TEST_TAG&limit=2', {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const res1 = await adminLogsGET(req1);
    expect(res1.status).toBe(200);
    const data1 = await res1.json();

    expect(data1.logs.length).toBe(2);
    expect(data1.pagination.hasMore).toBe(true);
    expect(data1.pagination.nextCursor).toBe(data1.logs[1].id);

    // Page 2
    const req2 = new NextRequest(`http://localhost:3000/api/admin/logs?tag=PART1C_TEST_TAG&limit=2&cursor=${data1.pagination.nextCursor}`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const res2 = await adminLogsGET(req2);
    expect(res2.status).toBe(200);
    const data2 = await res2.json();

    expect(data2.logs.length).toBe(2);
    expect(data2.pagination.hasMore).toBe(true);
    expect(data2.pagination.nextCursor).toBe(data2.logs[1].id);

    // Page 3 (final page)
    const req3 = new NextRequest(`http://localhost:3000/api/admin/logs?tag=PART1C_TEST_TAG&limit=2&cursor=${data2.pagination.nextCursor}`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const res3 = await adminLogsGET(req3);
    expect(res3.status).toBe(200);
    const data3 = await res3.json();

    expect(data3.logs.length).toBe(1);
    expect(data3.pagination.hasMore).toBe(false);
    expect(data3.pagination.nextCursor).toBeNull();

    // Verify all 5 items were returned in order without duplicates or skipping
    const allReturnedIds = [
      ...data1.logs.map((l: any) => l.id),
      ...data2.logs.map((l: any) => l.id),
      ...data3.logs.map((l: any) => l.id),
    ];

    expect(allReturnedIds.length).toBe(5);
    const uniqueIds = new Set(allReturnedIds);
    expect(uniqueIds.size).toBe(5);
    for (const expectedId of createdAuditLogIds) {
      expect(uniqueIds.has(expectedId)).toBe(true);
    }
  });

  it('3.2 Single-item limit pagination (limit = 1): correctly retrieves every record one by one until nextCursor is null', async () => {
    let currentCursor: string | null = null;
    const collectedIds: string[] = [];

    for (let i = 0; i < 5; i++) {
      const url = currentCursor
        ? `http://localhost:3000/api/admin/logs?tag=PART1C_TEST_TAG&limit=1&cursor=${currentCursor}`
        : 'http://localhost:3000/api/admin/logs?tag=PART1C_TEST_TAG&limit=1';

      const req = new NextRequest(url, {
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const res = await adminLogsGET(req);
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.logs.length).toBe(1);
      collectedIds.push(data.logs[0].id);

      if (i < 4) {
        expect(data.pagination.hasMore).toBe(true);
        expect(data.pagination.nextCursor).toBe(data.logs[0].id);
        currentCursor = data.pagination.nextCursor;
      } else {
        expect(data.pagination.hasMore).toBe(false);
        expect(data.pagination.nextCursor).toBeNull();
      }
    }

    expect(collectedIds.length).toBe(5);
    expect(new Set(collectedIds).size).toBe(5);
    for (const expectedId of createdAuditLogIds) {
      expect(collectedIds).toContain(expectedId);
    }
  });

  it('3.3 Identical timestamps do not lose rows due to deterministic id tiebreaker', async () => {
    // 3 logs have the exact same createdAt timestamp
    const req = new NextRequest('http://localhost:3000/api/admin/logs?tag=PART1C_TEST_TAG&limit=3', {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const res = await adminLogsGET(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.logs.length).toBe(3);
    const returnedIds = data.logs.map((l: any) => l.id);
    expect(new Set(returnedIds).size).toBe(3);
  });
});
