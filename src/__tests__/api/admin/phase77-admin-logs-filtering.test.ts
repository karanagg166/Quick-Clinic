import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/admin/logs/route';
import { prisma } from '@/lib/prisma';
import * as auth from '@/lib/auth';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    auditLog: {
      findMany: vi.fn(),
    },
    accessLog: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/auth', () => ({
  requireAdmin: vi.fn(),
}));

describe('Phase 77: Admin Audit & Access Logs Filtering Test Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('77.1 Blocks non-admin callers with 401 Unauthorized', async () => {
    vi.mocked(auth.requireAdmin).mockResolvedValueOnce(null);

    const req = new NextRequest('http://localhost:3000/api/admin/logs');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('77.2 Queries Audit Logs with tag and action filters for authenticated Admin', async () => {
    vi.mocked(auth.requireAdmin).mockResolvedValueOnce({ id: 'admin_u_1', role: 'ADMIN' } as any);
    vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce([
      {
        id: 'audit_1',
        action: 'UPDATE_DOCTOR_SCHEDULE',
        tag: 'SCHEDULE',
        userId: 'doc_u_1',
        createdAt: new Date(),
        user: { name: 'Dr. House', email: 'house@clinic.test', role: 'DOCTOR' },
      },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/admin/logs?type=audit&tag=SCHEDULE&action=UPDATE');
    const res = await GET(req);
    expect(res.status).toBe(200);

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tag: 'SCHEDULE',
          action: { contains: 'UPDATE', mode: 'insensitive' },
        }),
      })
    );

    const data = await res.json();
    expect(data.logs.length).toBe(1);
    expect(data.logs[0].action).toBe('UPDATE_DOCTOR_SCHEDULE');
  });

  it('77.3 Queries Access Logs with date filter for authenticated Admin', async () => {
    vi.mocked(auth.requireAdmin).mockResolvedValueOnce({ id: 'admin_u_1', role: 'ADMIN' } as any);
    vi.mocked(prisma.accessLog.findMany).mockResolvedValueOnce([
      {
        id: 'access_1',
        action: 'VIEW_DOCTOR_PROFILE',
        tag: 'PROFILE',
        userId: 'pat_u_1',
        createdAt: new Date('2026-10-15T14:00:00.000Z'),
        user: { name: 'Patient Alice', email: 'alice@clinic.test', role: 'PATIENT' },
      },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/admin/logs?type=access&date=2026-10-15');
    const res = await GET(req);
    expect(res.status).toBe(200);

    expect(prisma.accessLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: {
            gte: expect.any(Date),
            lt: expect.any(Date),
          },
        }),
      })
    );

    const data = await res.json();
    expect(data.logs.length).toBe(1);
    expect(data.logs[0].action).toBe('VIEW_DOCTOR_PROFILE');
  });
});
