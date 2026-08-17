import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, PATCH } from '@/app/api/patients/[patientId]/appointments/[appointmentId]/route';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    appointment: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    slot: {
      update: vi.fn(),
    },
    payment: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
    doctorPatientRelation: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    chatMessages: {
      create: vi.fn(),
    },
  },
}));

describe('Patient Appointment Detail & Cancellation Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('PATCH rejects cancellation if appointment is already COMPLETED or CANCELLED', async () => {
    vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce({
      id: 'appt_1',
      status: 'COMPLETED',
      patient: { user: { id: 'u_1' } },
      doctor: { user: { name: 'Dr. John' } },
      slot: { date: new Date(), startTime: new Date() },
    } as any);

    const req = new Request('http://localhost:3000/api/patients/pat_1/appointments/appt_1', {
      method: 'PATCH',
    });

    const res = await PATCH(req, { params: Promise.resolve({ patientId: 'pat_1', appointmentId: 'appt_1' }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/Cannot cancel appointment with status: COMPLETED/i);
  });

  it('PATCH cancels PENDING appointment, releases slot to AVAILABLE', async () => {
    vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce({
      id: 'appt_1',
      patientId: 'pat_1',
      status: 'PENDING',
      slotId: 'slot_1',
      paymentMethod: 'OFFLINE',
      patient: { user: { id: 'u_1' } },
      doctor: { user: { id: 'u_doc', name: 'Dr. John' } },
      slot: { date: new Date('2026-06-01'), startTime: new Date('2026-06-01T10:00:00Z') },
    } as any);

    vi.mocked(prisma.appointment.update).mockResolvedValueOnce({} as any);
    vi.mocked(prisma.slot.update).mockResolvedValueOnce({} as any);

    const req = new Request('http://localhost:3000/api/patients/pat_1/appointments/appt_1', {
      method: 'PATCH',
    });

    const res = await PATCH(req, { params: Promise.resolve({ patientId: 'pat_1', appointmentId: 'appt_1' }) });
    expect(res.status).toBe(200);

    expect(prisma.appointment.update).toHaveBeenCalledWith({
      where: { id: 'appt_1' },
      data: { status: 'CANCELLED' },
    });

    expect(prisma.slot.update).toHaveBeenCalledWith({
      where: { id: 'slot_1' },
      data: { status: 'AVAILABLE' },
    });
  });
});
