import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/patients/[patientId]/stats/route';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    appointment: {
      count: vi.fn(),
    },
    doctorPatientRelation: {
      count: vi.fn(),
    },
  },
}));

describe('Patient Stats Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET returns upcoming appointments, assigned doctors, pending approvals and wellness score', async () => {
    vi.mocked(prisma.appointment.count)
      .mockResolvedValueOnce(2) // upcomingAppointments
      .mockResolvedValueOnce(1) // pendingApprovals
      .mockResolvedValueOnce(5); // completedAppointments -> wellnessScore 50

    vi.mocked(prisma.doctorPatientRelation.count).mockResolvedValueOnce(3); // assignedDoctors

    const req = new NextRequest('http://localhost:3000/api/patients/pat_1/stats');
    const res = await GET(req, { params: Promise.resolve({ patientId: 'pat_1' }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.upcomingAppointments).toBe(2);
    expect(data.assignedDoctors).toBe(3);
    expect(data.pendingApprovals).toBe(1);
    expect(data.wellnessScore).toBe(50);
  });
});
