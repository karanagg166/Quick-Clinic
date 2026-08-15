import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/patients/[patientId]/appointments/route';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    appointment: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    slot: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

describe('Patient Appointments Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET returns patient appointments mapped to PatientAppointment interface', async () => {
    vi.mocked(prisma.appointment.findMany).mockResolvedValueOnce([
      {
        id: 'appt_1',
        status: 'CONFIRMED',
        doctor: {
          fees: 750,
          specialty: 'DERMATOLOGIST',
          user: {
            name: 'Dr. Jane',
            email: 'jane@clinic.com',
            location: { city: 'Bengaluru', state: 'Karnataka' },
          },
        },
        slot: {
          date: new Date('2026-06-01'),
          startTime: new Date('2026-06-01T11:00:00Z'),
        },
      },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/patients/pat_1/appointments');
    const res = await GET(req, { params: Promise.resolve({ patientId: 'pat_1' }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].doctorName).toBe('Dr. Jane');
    expect(data[0].fees).toBe(750);
  });

  it('POST rejects the retired non-atomic booking flow without an authenticated patient', async () => {
    const req = new NextRequest('http://localhost:3000/api/patients/pat_1/appointments', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ patientId: 'pat_1' }) });
    expect(res.status).toBe(401);
  });
});
