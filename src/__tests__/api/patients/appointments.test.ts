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

  it('POST rejects when slot is already BOOKED or UNAVAILABLE', async () => {
    vi.mocked(prisma.slot.findUnique).mockResolvedValueOnce({
      id: 'slot_1',
      doctorId: 'doc_1',
      status: 'BOOKED',
    } as any);

    const req = new Request('http://localhost:3000/api/patients/pat_1/appointments', {
      method: 'POST',
      body: JSON.stringify({ doctorId: 'doc_1', slotId: 'slot_1' }),
    });

    const res = await POST(req, { params: Promise.resolve({ patientId: 'pat_1' }) });
    expect(res.status).toBe(409);
  });

  it('POST creates appointment in PENDING status and marks slot BOOKED', async () => {
    vi.mocked(prisma.slot.findUnique).mockResolvedValueOnce({
      id: 'slot_1',
      doctorId: 'doc_1',
      status: 'AVAILABLE',
    } as any);

    vi.mocked(prisma.appointment.create).mockResolvedValueOnce({
      id: 'appt_1',
      patientId: 'pat_1',
      doctorId: 'doc_1',
      slotId: 'slot_1',
      status: 'PENDING',
      paymentMethod: 'OFFLINE',
    } as any);

    vi.mocked(prisma.slot.update).mockResolvedValueOnce({} as any);

    const req = new Request('http://localhost:3000/api/patients/pat_1/appointments', {
      method: 'POST',
      body: JSON.stringify({ doctorId: 'doc_1', slotId: 'slot_1', paymentMethod: 'OFFLINE' }),
    });

    const res = await POST(req, { params: Promise.resolve({ patientId: 'pat_1' }) });
    expect(res.status).toBe(201);

    expect(prisma.slot.update).toHaveBeenCalledWith({
      where: { id: 'slot_1' },
      data: { status: 'BOOKED' },
    });
  });
});
