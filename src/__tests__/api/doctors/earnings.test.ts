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

describe('Doctor Earnings Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when doctor does not exist', async () => {
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(null);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/earnings');
    const res = await GET(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(404);
  });

  it('calculates total earnings from completed appointments', async () => {
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce({
      fees: 800,
    } as any);

    vi.mocked(prisma.appointment.findMany).mockResolvedValueOnce([
      {
        id: 'appt_1',
        slot: { date: new Date('2026-05-10'), startTime: new Date('2026-05-10T10:00:00Z') },
        patient: { user: { name: 'Alice' } },
      },
      {
        id: 'appt_2',
        slot: { date: new Date('2026-05-11'), startTime: new Date('2026-05-11T11:00:00Z') },
        patient: { user: { name: 'Bob' } },
      },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/earnings');
    const res = await GET(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.count).toBe(2);
    expect(data.total).toBe(1600);
    expect(data.earnings[0].patientName).toBe('Alice');
    expect(data.earnings[0].earned).toBe(800);
  });
});
