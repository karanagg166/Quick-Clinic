import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/doctors/[doctorId]/appointments/route';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    doctor: {
      findUnique: vi.fn().mockResolvedValue({ id: 'doc_1', userId: 'user_1' }),
    },
    appointment: {
      findMany: vi.fn(),
    },
  },
}));

describe('GET /api/doctors/[doctorId]/appointments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 if doctorId is missing', async () => {
    const req = new NextRequest('http://localhost:3000/api/doctors//appointments');
    const res = await GET(req, { params: Promise.resolve({ doctorId: '' }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('doctorId required');
  });

  it('returns mapped doctor appointments with all fields', async () => {
    const mockAppointments = [
      {
        id: 'appt_1',
        status: 'CONFIRMED',
        paymentMethod: 'ONLINE',
        patient: {
          user: {
            name: 'Alice',
            email: 'alice@example.com',
            gender: 'FEMALE',
            age: 28,
            location: { city: 'Mumbai' },
          },
        },
        slot: {
          date: new Date('2026-05-10'),
          startTime: new Date('2026-05-10T09:00:00Z'),
        },
      },
    ];

    vi.mocked(prisma.appointment.findMany).mockResolvedValueOnce(mockAppointments as any);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/appointments?status=CONFIRMED');
    const res = await GET(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(1);
    expect(data[0].patientName).toBe('Alice');
    expect(data[0].city).toBe('Mumbai');
    expect(data[0].status).toBe('CONFIRMED');
  });
});
