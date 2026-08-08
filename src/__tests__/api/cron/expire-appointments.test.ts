import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/cron/expire-appointments/route';
import { prisma } from '@/lib/prisma';

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    appointment: {
      findMany: vi.fn(),
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
  },
}));

describe('Cron: expire-appointments route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects request without valid CRON_SECRET authorization header', async () => {
    const req = new Request('http://localhost:3000/api/cron/expire-appointments', {
      headers: { authorization: 'Bearer wrong_secret' },
    });

    const res = await GET(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('Unauthorized');
  });

  it('returns zero when no expired appointments found', async () => {
    vi.mocked(prisma.appointment.findMany).mockResolvedValueOnce([]);

    const req = new Request('http://localhost:3000/api/cron/expire-appointments', {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });

    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.expired).toBe(0);
  });

  it('expires both PENDING and CONFIRMED appointments and releases their slots', async () => {
    const mockAppointments = [
      {
        id: 'appt_1',
        status: 'PENDING',
        paymentMethod: 'OFFLINE',
        slotId: 'slot_1',
        slot: { date: new Date('2026-01-01'), startTime: new Date('2026-01-01T10:00:00Z') },
        patient: { user: { id: 'patient_user_1', name: 'John Doe' } },
        doctor: { user: { id: 'doc_user_1', name: 'Dr. Smith' } },
      },
      {
        id: 'appt_2',
        status: 'CONFIRMED',
        paymentMethod: 'ONLINE',
        transactionId: 'txn_123',
        slotId: 'slot_2',
        slot: { date: new Date('2026-01-02'), startTime: new Date('2026-01-02T11:00:00Z') },
        patient: { user: { id: 'patient_user_2', name: 'Jane Doe' } },
        doctor: { user: { id: 'doc_user_1', name: 'Dr. Smith' } },
      },
    ];

    vi.mocked(prisma.appointment.findMany).mockResolvedValueOnce(mockAppointments as any);
    vi.mocked(prisma.appointment.update).mockResolvedValue({} as any);
    vi.mocked(prisma.slot.update).mockResolvedValue({} as any);
    vi.mocked(prisma.notification.create).mockResolvedValue({} as any);

    const req = new Request('http://localhost:3000/api/cron/expire-appointments', {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });

    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.expired).toBe(2);

    expect(prisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'appt_1' },
        data: expect.objectContaining({ status: 'EXPIRED' }),
      })
    );
    expect(prisma.slot.update).toHaveBeenCalledWith({
      where: { id: 'slot_1' },
      data: { status: 'AVAILABLE' },
    });
  });
});
