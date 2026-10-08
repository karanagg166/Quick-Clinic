import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from "next/server";
import { authenticatedRequestClass, businessTestAdmin } from "@/__tests__/helpers/authenticated-request";
let AuthenticatedRequest: typeof NextRequest;
import { GET } from '@/app/api/patients/[patientId]/stats/route';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    patient: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    appointment: {
      count: vi.fn(),
    },
    doctorPatientRelation: {
      count: vi.fn(),
    },
  },
}));

describe('Patient Stats Route', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    AuthenticatedRequest = await authenticatedRequestClass();
    vi.mocked(prisma.user.findUnique).mockResolvedValue(businessTestAdmin as never);
    vi.mocked(prisma.patient.findUnique).mockResolvedValue({ userId: businessTestAdmin.id, fees: 600 } as never);
  });

  it('GET returns upcoming appointments, assigned doctors, pending approvals and wellness score', async () => {
    vi.mocked(prisma.appointment.count)
      .mockResolvedValueOnce(2) // upcomingAppointments
      .mockResolvedValueOnce(1) // pendingApprovals
      .mockResolvedValueOnce(5); // completedAppointments -> wellnessScore 50

    vi.mocked(prisma.doctorPatientRelation.count).mockResolvedValueOnce(3); // assignedDoctors

    const req = new AuthenticatedRequest('http://localhost:3000/api/patients/pat_1/stats');
    const res = await GET(req, { params: Promise.resolve({ patientId: 'pat_1' }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.upcomingAppointments).toBe(2);
    expect(data.assignedDoctors).toBe(3);
    expect(data.pendingApprovals).toBe(1);
    expect(data.wellnessScore).toBe(50);
  });
});
