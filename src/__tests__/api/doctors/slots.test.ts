import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PATCH, DELETE, POST } from '@/app/api/doctors/[doctorId]/slots/route';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    slot: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    schedule: {
      findUnique: vi.fn(),
    },
    leave: {
      findMany: vi.fn(),
    },
  },
}));

describe('Doctor Slots Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET returns 400 if date is missing', async () => {
    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/slots');
    const res = await GET(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(400);
  });

  it('GET returns existing slots if already generated', async () => {
    const mockSlots = [
      { id: 'slot_1', status: 'AVAILABLE', startTime: new Date('2026-05-15T09:00:00Z') },
    ];
    vi.mocked(prisma.slot.findMany).mockResolvedValueOnce(mockSlots as any);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/slots?date=2026-05-15');
    const res = await GET(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.slots.length).toBe(1);
  });

  it('GET generates slots from weekly schedule and marks active leaves as ON_LEAVE', async () => {
    vi.mocked(prisma.slot.findMany).mockResolvedValueOnce([]); // No existing slots
    vi.mocked(prisma.schedule.findUnique).mockResolvedValueOnce({
      doctorId: 'doc_1',
      weeklySchedule: [
        {
          day: 'Friday', // 2026-05-15 is Friday
          slots: [{ slotNo: 1, start: '09:00', end: '09:20' }],
        },
      ],
    } as any);

    // Mock active leave covering 09:10-09:20
    vi.mocked(prisma.leave.findMany).mockResolvedValueOnce([
      {
        startDate: new Date('2026-05-15T09:10:00Z'),
        endDate: new Date('2026-05-15T12:00:00Z'),
      },
    ] as any);

    vi.mocked(prisma.slot.create).mockImplementation(({ data }: any) => Promise.resolve({ id: 's_' + data.startTime, ...data }));

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/slots?date=2026-05-15');
    const res = await GET(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.slots.length).toBe(2); // Two 10-minute slots: 09:00-09:10 and 09:10-09:20
    expect(data.slots[0].status).toBe('AVAILABLE');
    expect(data.slots[1].status).toBe('ON_LEAVE');
  });

  it('PATCH rejects invalid status', async () => {
    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/slots', {
      method: 'PATCH',
      body: JSON.stringify({ slotId: 'slot_1', status: 'INVALID_STATUS' }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(400);
  });

  it('PATCH supports bulk slot updates for a list of slotIds', async () => {
    vi.mocked(prisma.slot.updateMany).mockResolvedValueOnce({ count: 3 });

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/slots', {
      method: 'PATCH',
      body: JSON.stringify({ slotIds: ['s1', 's2', 's3'], status: 'UNAVAILABLE' }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.count).toBe(3);
  });

  it('DELETE only deletes AVAILABLE slots', async () => {
    vi.mocked(prisma.slot.findUnique).mockResolvedValueOnce({
      id: 'slot_1',
      doctorId: 'doc_1',
      status: 'BOOKED',
    } as any);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/slots', {
      method: 'DELETE',
      body: JSON.stringify({ slotId: 'slot_1' }),
    });

    const res = await DELETE(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/Only AVAILABLE slots can be deleted/i);
  });

  it('POST creates ad-hoc slot preventing overlap', async () => {
    vi.mocked(prisma.slot.findMany).mockResolvedValueOnce([
      {
        startTime: new Date('2026-05-15T09:00:00Z'),
        endTime: new Date('2026-05-15T09:30:00Z'),
      },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/slots', {
      method: 'POST',
      body: JSON.stringify({
        date: '2026-05-15',
        startTime: '09:15',
        endTime: '09:45',
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/overlaps with an existing slot/i);
  });
});
