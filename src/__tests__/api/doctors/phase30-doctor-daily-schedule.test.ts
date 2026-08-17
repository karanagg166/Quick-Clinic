import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as scheduleOverviewGET } from '@/app/api/doctors/[doctorId]/schedule/overview/route';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 30: Doctor Schedule Overview & Multi-View Engine Test Suite', () => {
  let docUserId: string;
  let docId: string;

  let patientUserId: string;
  let patientId: string;

  const fixedDateStr = '2029-11-05'; // Monday
  const fixedDate = new Date(`${fixedDateStr}T00:00:00.000Z`);

  beforeAll(async () => {
    // 1. Create Doctor
    const docPayload = buildUserPayload({
      name: 'Dr. Schedule Architect',
      email: `doc_sched30_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const docUser = await prisma.user.create({
      data: {
        name: docPayload.name,
        email: docPayload.email,
        phoneNo: docPayload.phoneNo,
        password: docPayload.password,
        age: 43,
        address: docPayload.address,
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
    docUserId = docUser.id;

    const d = await prisma.doctor.create({
      data: {
        userId: docUser.id,
        specialty: 'GENERAL_PHYSICIAN',
        fees: 500,
        experience: 10,
      },
    });
    docId = d.id;

    // 2. Create Doctor weekly schedule
    await prisma.schedule.create({
      data: {
        doctorId: docId,
        weeklySchedule: [
          {
            day: 'Monday',
            slots: [
              { slotNo: 1, start: '09:00', end: '10:00' }, // 6 slots of 10 min
            ],
          },
        ],
      },
    });

    // 3. Create Patient
    const patPayload = buildUserPayload({
      name: 'Patient Sched Viewer',
      email: `pat_sched30_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const patUser = await prisma.user.create({
      data: {
        name: patPayload.name,
        email: patPayload.email,
        phoneNo: patPayload.phoneNo,
        password: patPayload.password,
        age: 30,
        address: patPayload.address,
        role: 'PATIENT',
        gender: 'MALE',
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    patientUserId = patUser.id;

    const pat = await prisma.patient.create({
      data: {
        userId: patUser.id,
      },
    });
    patientId = pat.id;

    // 4. Create an existing leave on 2029-11-15
    await prisma.leave.create({
      data: {
        doctorId: docId,
        startDate: new Date('2029-11-15T00:00:00.000Z'),
        endDate: new Date('2029-11-15T23:59:59.999Z'),
        reason: 'Family event',
      },
    });
  });

  afterAll(async () => {
    try {
      await prisma.appointment.deleteMany({ where: { doctorId: docId } });
      await prisma.slot.deleteMany({ where: { doctorId: docId } });
      await prisma.leave.deleteMany({ where: { doctorId: docId } });
      await prisma.schedule.deleteMany({ where: { doctorId: docId } });
      await prisma.doctor.deleteMany({ where: { id: docId } });
      await prisma.patient.deleteMany({ where: { id: patientId } });
      await prisma.user.deleteMany({ where: { id: { in: [docUserId, patientUserId] } } });
    } catch (e) {
      console.warn('Phase 30 cleanup warning:', e);
    }
  });

  it('30.1 Day view triggers auto-generation of slots from weekly schedule when day is unpopulated', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/doctors/${docId}/schedule/overview?view=day&date=${fixedDateStr}`
    );
    const res = await scheduleOverviewGET(req, { params: Promise.resolve({ doctorId: docId }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.view).toBe('day');
    expect(body.date).toBe(fixedDateStr);
    expect(body.slots.length).toBe(6); // 09:00 to 10:00 in 10-min slots = 6 slots
    expect(body.metrics.totalSlots).toBe(6);
    expect(body.metrics.availableCount).toBe(6);
    expect(body.timelineBlocks).toBeDefined();
  });

  it('30.2 Week view aggregates 7-day schedule metrics and occupancy rate', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/doctors/${docId}/schedule/overview?view=week&startDate=${fixedDateStr}`
    );
    const res = await scheduleOverviewGET(req, { params: Promise.resolve({ doctorId: docId }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.view).toBe('week');
    expect(body.days.length).toBe(7);
    expect(body.weekMetrics).toBeDefined();
    expect(body.weekMetrics.totalSlots).toBeGreaterThanOrEqual(6);
  });

  it('30.3 Month view returns full month day calendar with leave indicator', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/doctors/${docId}/schedule/overview?view=month&year=2029&month=11`
    );
    const res = await scheduleOverviewGET(req, { params: Promise.resolve({ doctorId: docId }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.view).toBe('month');
    expect(body.year).toBe(2029);
    expect(body.month).toBe(11);
    expect(body.daysInMonth).toBe(30);

    // Verify day 15 is marked as ON_LEAVE
    const day15 = body.days.find((d: any) => d.dayNumber === 15);
    expect(day15).toBeDefined();
    expect(day15.isLeave).toBe(true);
    expect(day15.statusSummary).toBe('ON_LEAVE');
  });

  it('30.4 Rejects invalid view parameter or invalid date format with 400', async () => {
    // Invalid view
    const reqBadView = new NextRequest(
      `http://localhost:3000/api/doctors/${docId}/schedule/overview?view=invalid_view`
    );
    const resBadView = await scheduleOverviewGET(reqBadView, { params: Promise.resolve({ doctorId: docId }) });
    expect(resBadView.status).toBe(400);

    // Invalid date
    const reqBadDate = new NextRequest(
      `http://localhost:3000/api/doctors/${docId}/schedule/overview?view=day&date=not-a-valid-date`
    );
    const resBadDate = await scheduleOverviewGET(reqBadDate, { params: Promise.resolve({ doctorId: docId }) });
    expect(resBadDate.status).toBe(400);
  });
});
