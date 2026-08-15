import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, PATCH } from '@/app/api/doctors/[doctorId]/appointments/[appointmentId]/route';
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
    doctor: {
      update: vi.fn(),
    },
    doctorPatientRelation: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    chatMessages: {
      create: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

describe('Doctor Appointment Detail Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET returns 404 when appointment does not exist', async () => {
    vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(null);

    const req = new Request('http://localhost:3000/api/doctors/doc_1/appointments/appt_999');
    const res = await GET(req, { params: Promise.resolve({ doctorId: 'doc_1', appointmentId: 'appt_999' }) });
    expect(res.status).toBe(404);
  });

  it('GET returns complete appointment detail when found', async () => {
    const mockAppt = {
      id: 'appt_1',
      doctorId: 'doc_1',
      patientId: 'pat_1',
      slotId: 'slot_1',
      status: 'CONFIRMED',
      paymentMethod: 'ONLINE',
      transactionId: 'txn_1',
      notes: 'Checkup',
      bookedAt: new Date('2026-05-01'),
      updatedAt: new Date('2026-05-01'),
      isAppointmentOffline: false,
      doctor: {
        id: 'doc_1',
        userId: 'u_doc',
        specialty: 'CARDIOLOGIST',
        experience: 10,
        fees: 1000,
        doctorQualifications: [{ qualification: 'MBBS' }, { qualification: 'MD' }],
        user: {
          id: 'u_doc',
          email: 'doc@clinic.com',
          phoneNo: '1234567890',
          name: 'Dr. John',
          age: 40,
          gender: 'MALE',
          role: 'DOCTOR',
          address: 'Main Clinic',
          emailVerified: true,
          location: { city: 'Delhi', state: 'Delhi', pincode: 110001 },
        },
      },
      patient: {
        id: 'pat_1',
        userId: 'u_pat',
        medicalHistory: 'None',
        allergies: 'Peanuts',
        currentMedications: 'None',
        user: {
          id: 'u_pat',
          email: 'pat@clinic.com',
          phoneNo: '0987654321',
          name: 'Jane',
          age: 25,
          gender: 'FEMALE',
          role: 'PATIENT',
          address: 'Street 1',
          emailVerified: true,
          location: { city: 'Delhi', state: 'Delhi', pincode: 110001 },
        },
      },
      slot: {
        id: 'slot_1',
        doctorId: 'doc_1',
        date: new Date('2026-05-15'),
        startTime: new Date('2026-05-15T10:00:00Z'),
        endTime: new Date('2026-05-15T10:10:00Z'),
        status: 'BOOKED',
      },
    };

    vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(mockAppt as any);

    const req = new Request('http://localhost:3000/api/doctors/doc_1/appointments/appt_1');
    const res = await GET(req, { params: Promise.resolve({ doctorId: 'doc_1', appointmentId: 'appt_1' }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.id).toBe('appt_1');
    expect(data.doctor.qualifications).toEqual(['MBBS', 'MD']);
    expect(data.patient.user.name).toBe('Jane');
  });

  it('PATCH updates status and handles COMPLETED balance increment for online payments', async () => {
    const existing = {
      id: 'appt_1',
      doctorId: 'doc_1',
      status: 'CONFIRMED',
      paymentMethod: 'ONLINE',
      transactionId: 'txn_123',
      slotId: 'slot_1',
      doctor: { fees: 500, user: { id: 'u_doc', name: 'Dr. John' } },
      patient: { user: { id: 'u_pat', name: 'Jane' } },
      slot: { date: new Date('2026-05-15'), startTime: new Date('2026-05-15T10:00:00Z') },
    };

    vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(existing as any);
    vi.mocked(prisma.appointment.update).mockResolvedValueOnce({ ...existing, status: 'COMPLETED' } as any);
    vi.mocked(prisma.doctor.update).mockResolvedValueOnce({} as any);
    vi.mocked(prisma.doctorPatientRelation.findUnique).mockResolvedValueOnce({ id: 'rel_1' } as any);
    vi.mocked(prisma.chatMessages.create).mockResolvedValueOnce({} as any);

    const req = new Request('http://localhost:3000/api/doctors/doc_1/appointments/appt_1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'COMPLETED' }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ doctorId: 'doc_1', appointmentId: 'appt_1' }) });
    expect(res.status).toBe(200);

    // Verify balance was incremented by 500 * 100 = 50000 paise
    expect(prisma.doctor.update).toHaveBeenCalledWith({
      where: { id: 'doc_1' },
      data: { balance: { increment: 50000 } },
    });
  });

  it('PATCH CANCELLED releases slot back to AVAILABLE', async () => {
    const existing = {
      id: 'appt_1',
      doctorId: 'doc_1',
      status: 'PENDING',
      paymentMethod: 'OFFLINE',
      slotId: 'slot_1',
      doctor: { fees: 500, user: { id: 'u_doc', name: 'Dr. John' } },
      patient: { user: { id: 'u_pat', name: 'Jane' } },
      slot: { date: new Date('2026-05-15'), startTime: new Date('2026-05-15T10:00:00Z') },
    };

    vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(existing as any);
    vi.mocked(prisma.appointment.update).mockResolvedValueOnce({ ...existing, status: 'CANCELLED' } as any);
    vi.mocked(prisma.slot.update).mockResolvedValueOnce({} as any);
    vi.mocked(prisma.doctorPatientRelation.findUnique).mockResolvedValueOnce({ id: 'rel_1' } as any);
    vi.mocked(prisma.chatMessages.create).mockResolvedValueOnce({} as any);

    const req = new Request('http://localhost:3000/api/doctors/doc_1/appointments/appt_1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'CANCELLED' }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ doctorId: 'doc_1', appointmentId: 'appt_1' }) });
    expect(res.status).toBe(200);

    expect(prisma.slot.update).toHaveBeenCalledWith({
      where: { id: 'slot_1' },
      data: { status: 'AVAILABLE' },
    });
  });
});
