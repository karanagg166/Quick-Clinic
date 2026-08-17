import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as schedulePOST, GET as scheduleGET } from '@/app/api/doctors/[doctorId]/schedule/route';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 12: Doctor Schedule Configuration & Validation Test Suite', () => {
  let doctorUserId: string;
  let doctorId: string;

  beforeAll(async () => {
    const userPayload = buildUserPayload({
      name: 'Dr. Schedule Architect',
      email: `doc_sched_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });

    const user = await prisma.user.create({
      data: {
        name: userPayload.name,
        email: userPayload.email,
        phoneNo: userPayload.phoneNo,
        password: userPayload.password,
        age: 38,
        address: userPayload.address,
        role: 'DOCTOR',
        gender: 'MALE',
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    doctorUserId = user.id;

    const doc = await prisma.doctor.create({
      data: {
        userId: user.id,
        specialty: 'ORTHOPEDIC',
        fees: 900,
        experience: 12,
      },
    });
    doctorId = doc.id;
  });

  afterAll(async () => {
    try {
      await prisma.schedule.deleteMany({ where: { doctorId } });
      await prisma.doctor.deleteMany({ where: { id: doctorId } });
      await prisma.user.deleteMany({ where: { id: doctorUserId } });
    } catch (e) {
      console.warn('Phase 12 cleanup warning:', e);
    }
  });

  it('12.1 doctor creates a valid weekly schedule with multi-interval shifts', async () => {
    const weeklySchedule = [
      {
        day: 'Monday',
        slots: [
          { slotNo: 1, start: '09:00', end: '12:00' },
          { slotNo: 2, start: '14:00', end: '17:00' },
        ],
      },
      {
        day: 'Tuesday',
        slots: [
          { slotNo: 1, start: '10:00', end: '13:00' },
          { slotNo: 2, start: '15:00', end: '18:00' },
        ],
      },
      {
        day: 'Wednesday',
        slots: [{ slotNo: 1, start: '09:00', end: '13:00' }],
      },
    ];

    const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}/schedule`, {
      method: 'POST',
      body: JSON.stringify({ weeklySchedule }),
    });

    const res = await schedulePOST(req, { params: Promise.resolve({ doctorId }) });
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.doctorId).toBe(doctorId);
    expect(Array.isArray(body.weeklySchedule)).toBe(true);
    expect(body.weeklySchedule.length).toBe(3);
    expect(body.weeklySchedule[0].day).toBe('Monday');
    expect(body.weeklySchedule[0].slots.length).toBe(2);
  });

  it('12.2 retrieves existing schedule via GET', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}/schedule`);
    const res = await scheduleGET(req, { params: Promise.resolve({ doctorId }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.doctorId).toBe(doctorId);
    expect(body.weeklySchedule).toBeDefined();
    expect(body.weeklySchedule.length).toBe(3);
  });

  it('12.3 rejects schedule with overlapping intervals on the same day', async () => {
    const overlappingSchedule = [
      {
        day: 'Monday',
        slots: [
          { slotNo: 1, start: '09:00', end: '13:00' },
          { slotNo: 2, start: '11:00', end: '15:00' }, // Overlaps with slot 1
        ],
      },
    ];

    const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}/schedule`, {
      method: 'POST',
      body: JSON.stringify({ weeklySchedule: overlappingSchedule }),
    });

    const res = await schedulePOST(req, { params: Promise.resolve({ doctorId }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Overlapping slots detected');
  });

  it('12.4 rejects schedule where start time is at or after end time', async () => {
    const invertedSchedule = [
      {
        day: 'Thursday',
        slots: [{ slotNo: 1, start: '17:00', end: '09:00' }],
      },
    ];

    const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}/schedule`, {
      method: 'POST',
      body: JSON.stringify({ weeklySchedule: invertedSchedule }),
    });

    const res = await schedulePOST(req, { params: Promise.resolve({ doctorId }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('start time (17:00) must be before end time (09:00)');
  });

  it('12.5 rejects schedule with invalid time format or illegal values', async () => {
    const malformedSchedule = [
      {
        day: 'Friday',
        slots: [{ slotNo: 1, start: '25:00', end: '12:00' }],
      },
    ];

    const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}/schedule`, {
      method: 'POST',
      body: JSON.stringify({ weeklySchedule: malformedSchedule }),
    });

    const res = await schedulePOST(req, { params: Promise.resolve({ doctorId }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid time');
  });

  it('12.6 rejects request when weeklySchedule is missing or invalid structure', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}/schedule`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const res = await schedulePOST(req, { params: Promise.resolve({ doctorId }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Missing weeklySchedule');
  });

  it('12.7 upserts updated weekly schedule cleanly replacing previous schedule', async () => {
    const updatedSchedule = [
      {
        day: 'Saturday',
        slots: [{ slotNo: 1, start: '10:00', end: '14:00' }],
      },
    ];

    const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}/schedule`, {
      method: 'POST',
      body: JSON.stringify({ weeklySchedule: updatedSchedule }),
    });

    const res = await schedulePOST(req, { params: Promise.resolve({ doctorId }) });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.weeklySchedule.length).toBe(1);
    expect(body.weeklySchedule[0].day).toBe('Saturday');
  });
});
