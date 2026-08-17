import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/doctors/[doctorId]/earnings/route';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    doctor: {
      findUnique: vi.fn(),
    },
    appointment: {
      findMany: vi.fn(),
    },
  },
}));

describe('Phase 75: Doctor Earnings Filtering & Calculation Test Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('75.1 Calculates total earnings accurately across multiple completed appointments', async () => {
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce({
      fees: 750,
    } as any);

    vi.mocked(prisma.appointment.findMany).mockResolvedValueOnce([
      {
        id: 'appt_1',
        slot: {
          date: new Date('2026-10-01'),
          startTime: new Date('2026-10-01T09:00:00.000Z'),
        },
        patient: { user: { name: 'Patient Alice' } },
      },
      {
        id: 'appt_2',
        slot: {
          date: new Date('2026-10-02'),
          startTime: new Date('2026-10-02T10:00:00.000Z'),
        },
        patient: { user: { name: 'Patient Bob' } },
      },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/earnings');
    const res = await GET(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.count).toBe(2);
    expect(data.total).toBe(1500); // 2 * 750
    expect(data.earnings[0].earned).toBe(750);
    expect(data.earnings[0].patientName).toBe('Patient Alice');
  });

  it('75.2 Filters earnings by custom date range (startDate & endDate)', async () => {
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce({
      fees: 600,
    } as any);

    vi.mocked(prisma.appointment.findMany).mockResolvedValueOnce([
      {
        id: 'appt_range_1',
        slot: {
          date: new Date('2026-10-15'),
          startTime: new Date('2026-10-15T11:00:00.000Z'),
        },
        patient: { user: { name: 'Patient Charlie' } },
      },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/earnings?startDate=2026-10-10&endDate=2026-10-20');
    const res = await GET(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(200);

    expect(prisma.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          doctorId: 'doc_1',
          status: 'COMPLETED',
          slot: expect.objectContaining({
            startTime: expect.objectContaining({
              gte: expect.any(Date),
              lte: expect.any(Date),
            }),
          }),
        }),
      })
    );

    const data = await res.json();
    expect(data.count).toBe(1);
    expect(data.total).toBe(600);
  });

  it('75.3 Returns total: 0 and count: 0 when doctor has no completed appointments', async () => {
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce({
      fees: 500,
    } as any);

    vi.mocked(prisma.appointment.findMany).mockResolvedValueOnce([]);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/earnings');
    const res = await GET(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.total).toBe(0);
    expect(data.count).toBe(0);
    expect(data.earnings).toEqual([]);
  });

  it('75.4 Returns 404 when doctor does not exist', async () => {
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(null);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_missing/earnings');
    const res = await GET(req, { params: Promise.resolve({ doctorId: 'doc_missing' }) });
    expect(res.status).toBe(404);
  });
});
