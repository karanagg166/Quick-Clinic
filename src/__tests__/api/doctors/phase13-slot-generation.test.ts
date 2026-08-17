import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as slotsGET, POST as slotsPOST } from '@/app/api/doctors/[doctorId]/slots/route';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 13: Slot Generation & Ad-Hoc Management Test Suite', () => {
  let doctorUserId: string;
  let doctorId: string;
  const testMondayDate = '2028-06-05'; // A guaranteed future Monday
  const testSundayDate = '2028-06-11'; // A guaranteed future Sunday

  beforeAll(async () => {
    const userPayload = buildUserPayload({
      name: 'Dr. Slot Generator',
      email: `doc_slotgen_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });

    const user = await prisma.user.create({
      data: {
        name: userPayload.name,
        email: userPayload.email,
        phoneNo: userPayload.phoneNo,
        password: userPayload.password,
        age: 40,
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
        specialty: 'DERMATOLOGIST',
        fees: 750,
        experience: 9,
      },
    });
    doctorId = doc.id;

    // Configure Monday schedule: 09:00 - 10:00 (yields 6 10-minute slots: 09:00, 09:10, 09:20, 09:30, 09:40, 09:50)
    await prisma.schedule.create({
      data: {
        doctorId,
        weeklySchedule: [
          {
            day: 'Monday',
            slots: [{ slotNo: 1, start: '09:00', end: '10:00' }],
          },
        ],
      },
    });
  });

  afterAll(async () => {
    try {
      await prisma.slot.deleteMany({ where: { doctorId } });
      await prisma.schedule.deleteMany({ where: { doctorId } });
      await prisma.doctor.deleteMany({ where: { id: doctorId } });
      await prisma.user.deleteMany({ where: { id: doctorUserId } });
    } catch (e) {
      console.warn('Phase 13 cleanup warning:', e);
    }
  });

  it('13.1 generates 10-minute discrete slots for scheduled day on first request', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}/slots?date=${testMondayDate}`);
    const res = await slotsGET(req, { params: Promise.resolve({ doctorId }) });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.slots).toBeDefined();
    expect(Array.isArray(body.slots)).toBe(true);
    // 09:00 to 10:00 = 6 slots of 10 min each
    expect(body.slots.length).toBe(6);

    const firstSlot = body.slots[0];
    expect(firstSlot.status).toBe('AVAILABLE');
    expect(firstSlot.doctorId).toBe(doctorId);
    expect(new Date(firstSlot.startTime).toISOString()).toContain('T09:00:00.000Z');
    expect(new Date(firstSlot.endTime).toISOString()).toContain('T09:10:00.000Z');
  });

  it('13.2 prevents duplicate slot generation on repeated requests for the same date', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}/slots?date=${testMondayDate}`);
    const res = await slotsGET(req, { params: Promise.resolve({ doctorId }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slots.length).toBe(6);

    // Verify database row count
    const dbSlots = await prisma.slot.findMany({
      where: { doctorId, date: new Date(`${testMondayDate}T00:00:00.000Z`) },
    });
    expect(dbSlots.length).toBe(6);
  });

  it('13.3 returns empty slots array when requested on a non-working day', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}/slots?date=${testSundayDate}`);
    const res = await slotsGET(req, { params: Promise.resolve({ doctorId }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slots).toEqual([]);
  });

  it('13.4 creates a custom ad-hoc slot via POST endpoint', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}/slots`, {
      method: 'POST',
      body: JSON.stringify({
        date: testSundayDate,
        startTime: '15:00',
        endTime: '15:30',
      }),
    });

    const res = await slotsPOST(req, { params: Promise.resolve({ doctorId }) });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.slot).toBeDefined();
    expect(body.slot.status).toBe('AVAILABLE');
  });

  it('13.5 rejects ad-hoc slot that overlaps with an existing slot', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}/slots`, {
      method: 'POST',
      body: JSON.stringify({
        date: testSundayDate,
        startTime: '15:15',
        endTime: '15:45', // Overlaps 15:00-15:30
      }),
    });

    const res = await slotsPOST(req, { params: Promise.resolve({ doctorId }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('New slot overlaps with an existing slot');
  });

  it('13.6 rejects requests with missing date query or invalid doctor ID', async () => {
    const missingDateReq = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}/slots`);
    const missingDateRes = await slotsGET(missingDateReq, { params: Promise.resolve({ doctorId }) });
    expect(missingDateRes.status).toBe(400);

    const nonExistentReq = new NextRequest(`http://localhost:3000/api/doctors/non_doc_id_999/slots?date=${testMondayDate}`);
    const nonExistentRes = await slotsGET(nonExistentReq, {
      params: Promise.resolve({ doctorId: 'non_doc_id_999' }),
    });
    expect(nonExistentRes.status).toBe(404);
  });
});
