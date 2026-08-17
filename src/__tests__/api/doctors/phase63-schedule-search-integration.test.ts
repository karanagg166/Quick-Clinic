import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getSlotsGET } from '@/app/api/doctors/[doctorId]/slots/route';
import { prisma } from '@/lib/prisma';
import * as booking from '@/lib/booking';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    slot: {
      findMany: vi.fn(),
      createMany: vi.fn(),
    },
    schedule: {
      findUnique: vi.fn(),
    },
    leave: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/booking', () => ({
  expireDoctorHolds: vi.fn().mockResolvedValue(0),
}));

describe('Phase 63: Doctor Schedule, Slots & Availability Search Integration Test Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('63.1 Generates 10-minute available slots based on doctor weekly schedule when no existing slots', async () => {
    vi.mocked(prisma.slot.findMany)
      .mockResolvedValueOnce([]) // First call: no existing slots
      .mockResolvedValueOnce([
        {
          id: 'slot_1',
          doctorId: 'doc_1',
          date: new Date('2026-10-12T00:00:00.000Z'), // Monday
          startTime: new Date('2026-10-12T09:00:00.000Z'),
          endTime: new Date('2026-10-12T09:10:00.000Z'),
          status: 'AVAILABLE',
          appointment: null,
        },
      ] as any);

    vi.mocked(prisma.schedule.findUnique).mockResolvedValueOnce({
      doctorId: 'doc_1',
      weeklySchedule: [
        {
          day: 'Monday',
          slots: [{ slotNo: 1, start: '09:00', end: '10:00' }],
        },
      ],
    } as any);

    vi.mocked(prisma.leave.findMany).mockResolvedValueOnce([]); // No leave
    vi.mocked(prisma.slot.createMany).mockResolvedValueOnce({ count: 6 });

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/slots?date=2026-10-12');
    const res = await getSlotsGET(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(201);

    expect(booking.expireDoctorHolds).toHaveBeenCalledWith('doc_1');
    expect(prisma.slot.createMany).toHaveBeenCalled();

    const data = await res.json();
    expect(data.slots).toBeDefined();
    expect(data.slots.length).toBeGreaterThan(0);
    expect(data.slots[0].status).toBe('AVAILABLE');
  });

  it('63.2 Marks generated slots as ON_LEAVE when date overlaps with doctor approved leave', async () => {
    vi.mocked(prisma.slot.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'slot_leave_1',
          doctorId: 'doc_1',
          date: new Date('2026-10-12T00:00:00.000Z'),
          startTime: new Date('2026-10-12T09:00:00.000Z'),
          endTime: new Date('2026-10-12T09:10:00.000Z'),
          status: 'ON_LEAVE',
          appointment: null,
        },
      ] as any);

    vi.mocked(prisma.schedule.findUnique).mockResolvedValueOnce({
      doctorId: 'doc_1',
      weeklySchedule: [
        {
          day: 'Monday',
          slots: [{ slotNo: 1, start: '09:00', end: '10:00' }],
        },
      ],
    } as any);

    // Active leave on this date
    vi.mocked(prisma.leave.findMany).mockResolvedValueOnce([
      {
        id: 'leave_1',
        doctorId: 'doc_1',
        startDate: new Date('2026-10-10T00:00:00.000Z'),
        endDate: new Date('2026-10-15T23:59:59.999Z'),
      },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/slots?date=2026-10-12');
    const res = await getSlotsGET(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.slots[0].status).toBe('ON_LEAVE');
  });

  it('63.3 Accurately reflects existing appointment statuses (BOOKED for CONFIRMED, UNAVAILABLE for COMPLETED)', async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 5);

    vi.mocked(prisma.slot.findMany).mockResolvedValueOnce([
      {
        id: 'slot_conf',
        doctorId: 'doc_1',
        date: futureDate,
        startTime: futureDate,
        endTime: futureDate,
        status: 'AVAILABLE',
        appointment: { id: 'appt_1', status: 'CONFIRMED' },
      },
      {
        id: 'slot_comp',
        doctorId: 'doc_1',
        date: futureDate,
        startTime: futureDate,
        endTime: futureDate,
        status: 'AVAILABLE',
        appointment: { id: 'appt_2', status: 'COMPLETED' },
      },
      {
        id: 'slot_canc',
        doctorId: 'doc_1',
        date: futureDate,
        startTime: futureDate,
        endTime: futureDate,
        status: 'AVAILABLE',
        appointment: { id: 'appt_3', status: 'CANCELLED' },
      },
    ] as any);

    const dateStr = futureDate.toISOString().split('T')[0];
    const req = new NextRequest(`http://localhost:3000/api/doctors/doc_1/slots?date=${dateStr}`);
    const res = await getSlotsGET(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.slots[0].status).toBe('BOOKED');
    expect(data.slots[1].status).toBe('UNAVAILABLE');
    expect(data.slots[2].status).toBe('AVAILABLE');
  });

  it('63.4 Returns empty slots array for day with no configured working schedule', async () => {
    vi.mocked(prisma.slot.findMany).mockResolvedValueOnce([]); // No existing slots
    vi.mocked(prisma.schedule.findUnique).mockResolvedValueOnce({
      doctorId: 'doc_1',
      weeklySchedule: [
        {
          day: 'Monday',
          slots: [{ slotNo: 1, start: '09:00', end: '12:00' }],
        },
      ],
    } as any);

    // 2026-10-18 is Sunday
    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/slots?date=2026-10-18');
    const res = await getSlotsGET(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.slots).toEqual([]);
  });

  it('63.5 Returns 404 when doctor schedule does not exist in the database', async () => {
    vi.mocked(prisma.slot.findMany).mockResolvedValueOnce([]);
    vi.mocked(prisma.schedule.findUnique).mockResolvedValueOnce(null);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_no_sched/slots?date=2026-10-12');
    const res = await getSlotsGET(req, { params: Promise.resolve({ doctorId: 'doc_no_sched' }) });
    expect(res.status).toBe(404);

    const data = await res.json();
    expect(data.error).toMatch(/Doctor schedule does not exist/i);
  });
});
