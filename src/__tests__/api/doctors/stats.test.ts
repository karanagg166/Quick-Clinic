import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/doctors/[doctorId]/stats/route';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    appointment: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    doctorPatientRelation: {
      count: vi.fn(),
    },
    doctor: {
      findUnique: vi.fn(),
    },
  },
}));

describe('Doctor Stats Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET returns today appointments, active patients, pending consults and monthly earnings', async () => {
    vi.mocked(prisma.appointment.count)
      .mockResolvedValueOnce(3) // todayAppointments
      .mockResolvedValueOnce(2); // pendingConsults

    vi.mocked(prisma.doctorPatientRelation.count).mockResolvedValueOnce(15); // activePatients
    vi.mocked(prisma.appointment.findMany).mockResolvedValueOnce([{ id: 'a1' }, { id: 'a2' }] as any); // 2 completed appts this month
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce({ fees: 600 } as any);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/stats');
    const res = await GET(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.todayAppointments).toBe(3);
    expect(data.activePatients).toBe(15);
    expect(data.pendingConsults).toBe(2);
    expect(data.monthlyEarnings).toBe(1200); // 600 * 2
  });
});
