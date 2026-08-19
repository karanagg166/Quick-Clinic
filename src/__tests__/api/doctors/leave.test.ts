import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, GET, DELETE, PATCH } from '@/app/api/doctors/[doctorId]/leave/route';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    doctor: {
      findUnique: vi.fn().mockResolvedValue({ id: 'doc_1', userId: 'user_1' }),
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
      create: vi.fn(),
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

  it('POST creates leave, marks slots ON_LEAVE and auto-cancels overlapping appointments', async () => {
    vi.mocked(prisma.leave.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.leave.create).mockResolvedValueOnce({
      id: 'leave_1',
      doctorId: 'doc_1',
      startDate: new Date('2026-11-10'),
      endDate: new Date('2026-11-15'),
      reason: 'Vacation',
    } as any);

    // Mock overlapping appointments
    vi.mocked(prisma.appointment.findMany).mockResolvedValueOnce([
      {
        id: 'appt_1',
        status: 'CONFIRMED',
        slotId: 'slot_1',
        slot: { date: new Date('2026-11-11') },
        patient: { user: { id: 'patient_u1' } },
        doctor: { user: { name: 'Dr. John' } },
      },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/leave', {
      method: 'POST',
      body: JSON.stringify({
        startDate: '2026-11-10',
        endDate: '2026-11-15',
        reason: 'Vacation',
        userId: 'u_doc',
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.cancelledAppointments).toBe(1);
    expect(prisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'appt_1' },
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
