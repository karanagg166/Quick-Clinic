import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, GET } from '@/app/api/doctors/[doctorId]/schedule/route';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    schedule: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

describe('Doctor Schedule Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST rejects when weeklySchedule is missing', async () => {
    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/schedule', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const res = await POST(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(400);
  });

  it('POST creates or updates schedule (upsert) for valid slots', async () => {
    const mockSchedule = [
      {
        day: 'Monday',
        slots: [
          { slotNo: 1, start: '09:00', end: '12:00' },
          { slotNo: 2, start: '12:00', end: '17:00' },
        ],
      },
    ];

    vi.mocked(prisma.schedule.upsert).mockResolvedValueOnce({
      id: 'sched_1',
      doctorId: 'doc_1',
      weeklySchedule: mockSchedule,
    } as any);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/schedule', {
      method: 'POST',
      body: JSON.stringify({ weeklySchedule: mockSchedule }),
    });

    const res = await POST(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBe('sched_1');
  });

  it('POST rejects overlapping slots on Monday (e.g., 02:00 to 15:00 and 03:00 to 04:00)', async () => {
    const overlappingSchedule = [
      {
        day: 'Monday',
        slots: [
          { slotNo: 1, start: '02:00', end: '15:00' },
          { slotNo: 2, start: '03:00', end: '04:00' },
        ],
      },
    ];

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/schedule', {
      method: 'POST',
      body: JSON.stringify({ weeklySchedule: overlappingSchedule }),
    });

    const res = await POST(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Overlapping slots detected on Monday');
    expect(prisma.schedule.upsert).not.toHaveBeenCalled();
  });

  it('POST rejects invalid slot time when start is after end', async () => {
    const invalidSchedule = [
      {
        day: 'Monday',
        slots: [{ slotNo: 1, start: '15:00', end: '02:00' }],
      },
    ];

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/schedule', {
      method: 'POST',
      body: JSON.stringify({ weeklySchedule: invalidSchedule }),
    });

    const res = await POST(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('start time (15:00) must be before end time (02:00)');
    expect(prisma.schedule.upsert).not.toHaveBeenCalled();
  });

  it('GET returns 404 when schedule not found', async () => {
    vi.mocked(prisma.schedule.findUnique).mockResolvedValueOnce(null);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/schedule');
    const res = await GET(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(404);
  });

  it('GET returns existing schedule', async () => {
    vi.mocked(prisma.schedule.findUnique).mockResolvedValueOnce({
      id: 'sched_1',
      doctorId: 'doc_1',
      weeklySchedule: [],
    } as any);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/schedule');
    const res = await GET(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(200);
  });
});
