import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, GET, DELETE, PATCH } from '@/app/api/doctors/[doctorId]/leave/route';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    doctor: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'doc_1',
        userId: 'user_1',
        user: { id: 'user_1', name: 'Dr. John' },
      }),
    },
    leave: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    slot: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    appointment: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    notification: {
      create: vi.fn().mockResolvedValue({
        id: 'notif_1',
        message: 'notification message',
        actionHref: '/patient/appointments/appt_1',
        actionLabel: 'View appointment',
        createdAt: new Date(),
        isRead: false,
      }),
    },
    doctorPatientRelation: {
      findUnique: vi.fn().mockResolvedValue({ id: 'rel_1' }),
      create: vi.fn().mockResolvedValue({ id: 'rel_1' }),
    },
    chatMessages: {
      create: vi.fn().mockResolvedValue({ id: 'chat_1' }),
    },
    payment: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

describe('Doctor Leave Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST rejects when missing required fields', async () => {
    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/leave', {
      method: 'POST',
      body: JSON.stringify({ reason: 'Vacation' }),
    });

    const res = await POST(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(400);
  });

  it('POST rejects when endDate is before startDate', async () => {
    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/leave', {
      method: 'POST',
      body: JSON.stringify({
        startDate: '2026-07-20',
        endDate: '2026-07-10',
        reason: 'Conference',
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/End date cannot be before start date/i);
  });

  it('POST rejects when conflicting leave already exists', async () => {
    vi.mocked(prisma.leave.findFirst).mockResolvedValueOnce({ id: 'leave_existing' } as any);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/leave', {
      method: 'POST',
      body: JSON.stringify({
        startDate: '2026-11-10',
        endDate: '2026-11-15',
        reason: 'Conference',
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toMatch(/conflicts with existing leave/i);
  });

  it('POST creates leave, marks slots ON_LEAVE and auto-cancels overlapping appointments with chat & notifications', async () => {
    vi.mocked(prisma.leave.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.leave.create).mockResolvedValueOnce({
      id: 'leave_1',
      doctorId: 'doc_1',
      startDate: new Date('2026-11-10T00:00:00.000Z'),
      endDate: new Date('2026-11-15T23:59:59.000Z'),
      reason: 'Vacation',
    } as any);

    // Mock overlapping appointments
    vi.mocked(prisma.appointment.findMany).mockResolvedValueOnce([
      {
        id: 'appt_1',
        status: 'CONFIRMED',
        slotId: 'slot_1',
        paymentMethod: 'OFFLINE',
        slot: {
          date: new Date('2026-11-11'),
          startTime: new Date('2026-11-11T10:00:00.000Z'),
          endTime: new Date('2026-11-11T10:30:00.000Z'),
        },
        patient: { user: { id: 'patient_u1', name: 'Patient Jane' } },
        doctor: { user: { id: 'user_1', name: 'Dr. John' } },
      },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/leave', {
      method: 'POST',
      body: JSON.stringify({
        startDate: '2026-11-10T00:00:00.000Z',
        endDate: '2026-11-15T23:59:59.000Z',
        reason: 'Vacation',
        userId: 'user_1',
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.cancelledAppointments).toBe(1);

    // Verify appointment status updated to CANCELLED
    expect(prisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'appt_1' },
        data: expect.objectContaining({ status: 'CANCELLED' }),
      })
    );

    // Verify slot status updated to ON_LEAVE
    expect(prisma.slot.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'slot_1' },
        data: expect.objectContaining({ status: 'ON_LEAVE' }),
      })
    );

    // Verify chat message created
    expect(prisma.chatMessages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          senderId: 'user_1',
          text: expect.stringContaining('Appointment Cancelled'),
        }),
      })
    );

    // Verify notifications sent to both patient and doctor
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'patient_u1',
          message: expect.stringContaining('cancelled'),
        }),
      })
    );

    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user_1',
        }),
      })
    );
  });

  it('POST cancels appointment when appointment start time or end time overlaps leave window', async () => {
    vi.mocked(prisma.leave.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.leave.create).mockResolvedValueOnce({
      id: 'leave_2',
      doctorId: 'doc_1',
      startDate: new Date('2026-12-01T10:00:00.000Z'),
      endDate: new Date('2026-12-01T12:00:00.000Z'),
      reason: 'Dental Surgery',
    } as any);

    vi.mocked(prisma.appointment.findMany).mockResolvedValueOnce([
      {
        id: 'appt_start_overlap',
        status: 'PENDING',
        slotId: 'slot_2',
        paymentMethod: 'ONLINE',
        transactionId: 'pay_txn_123',
        slot: {
          date: new Date('2026-12-01'),
          startTime: new Date('2026-12-01T11:45:00.000Z'), // starts between 10:00 and 12:00
          endTime: new Date('2026-12-01T12:15:00.000Z'),
        },
        patient: { user: { id: 'patient_u2', name: 'Bob Patient' } },
        doctor: { user: { id: 'user_1', name: 'Dr. John' } },
      },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/leave', {
      method: 'POST',
      body: JSON.stringify({
        startDate: '2026-12-01T10:00:00.000Z',
        endDate: '2026-12-01T12:00:00.000Z',
        reason: 'Dental Surgery',
        userId: 'user_1',
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.cancelledAppointments).toBe(1);

    expect(prisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'appt_start_overlap' },
        data: expect.objectContaining({ status: 'CANCELLED' }),
      })
    );
  });

  it('DELETE restores slots and deletes leave record', async () => {
    vi.mocked(prisma.leave.findUnique).mockResolvedValueOnce({
      id: 'leave_1',
      doctorId: 'doc_1',
      startDate: new Date('2026-11-10'),
      endDate: new Date('2026-11-15'),
    } as any);
    vi.mocked(prisma.slot.findMany).mockResolvedValueOnce([
      { id: 'slot_1', startTime: new Date('2026-11-11T10:00:00Z'), endTime: new Date('2026-11-11T10:10:00Z') },
    ] as any);
    vi.mocked(prisma.leave.findFirst).mockResolvedValueOnce(null); // No other leaves
    vi.mocked(prisma.leave.delete).mockResolvedValueOnce({} as any);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/leave?leaveId=leave_1', {
      method: 'DELETE',
    });

    const res = await DELETE(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(200);
    expect(prisma.slot.update).toHaveBeenCalledWith({
      where: { id: 'slot_1' },
      data: { status: 'AVAILABLE' },
    });
  });
});
