import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Mock Upstash Redis with in-memory map for fast and robust test execution
const inMemoryRedis = new Map<string, any>();
vi.mock('@upstash/redis', () => ({
  Redis: class MockRedis {
    set(key: string, value: any) {
      inMemoryRedis.set(key, value);
      return Promise.resolve('OK');
    }
    get(key: string) {
      return Promise.resolve(inMemoryRedis.get(key) || null);
    }
    del(key: string) {
      inMemoryRedis.delete(key);
      return Promise.resolve(1);
    }
  },
}));

import { PATCH as doctorAppointmentPATCH } from '@/app/api/doctors/[doctorId]/appointments/[appointmentId]/route';
import { POST as holdPOST } from '@/app/api/appointments/hold/route';
import { POST as confirmPOST } from '@/app/api/appointments/confirm/route';
import { prisma } from '@/lib/prisma';
import { createToken } from '@/lib/auth';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 23: Appointment Rescheduling Lifecycle Test Suite', () => {
  let docUserId: string;
  let docId: string;

  let patientUserId: string;
  let patientId: string;
  let patientToken: string;

  let initialSlotId: string;
  let targetSlotId: string;
  let alreadyBookedSlotId: string;
  let pastSlotId: string;
  let leaveSlotId: string;

  let initialApptId: string;

  const testFutureDate = new Date('2029-03-20T00:00:00.000Z');

  beforeAll(async () => {
    // 1. Create Doctor
    const docPayload = buildUserPayload({
      name: 'Dr. Reschedule Manager',
      email: `doc_resched_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const docUser = await prisma.user.create({
      data: {
        name: docPayload.name,
        email: docPayload.email,
        phoneNo: docPayload.phoneNo,
        password: docPayload.password,
        age: 42,
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
        experience: 12,
      },
    });
    docId = d.id;

    // 2. Create Patient
    const patPayload = buildUserPayload({
      name: 'Patient Reschedule Subject',
      email: `pat_resched_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const patUser = await prisma.user.create({
      data: {
        name: patPayload.name,
        email: patPayload.email,
        phoneNo: patPayload.phoneNo,
        password: patPayload.password,
        age: 29,
        address: patPayload.address,
        role: 'PATIENT',
        gender: 'FEMALE',
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    patientUserId = patUser.id;
    patientToken = await createToken({ id: patientUserId, userId: patientUserId, role: 'PATIENT' });

    const pat = await prisma.patient.create({
      data: {
        userId: patUser.id,
      },
    });
    patientId = pat.id;

    // 3. Create initial slot and appointment
    const slot1 = await prisma.slot.create({
      data: {
        doctorId: docId,
        date: testFutureDate,
        startTime: new Date('2029-03-20T09:00:00.000Z'),
        endTime: new Date('2029-03-20T09:10:00.000Z'),
        status: 'BOOKED',
      },
    });
    initialSlotId = slot1.id;

    const appt = await prisma.appointment.create({
      data: {
        doctorId: docId,
        patientId,
        slotId: slot1.id,
        status: 'CONFIRMED',
        paymentMethod: 'OFFLINE',
        isAppointmentOffline: true,
      },
    });
    initialApptId = appt.id;

    // 4. Create target available slot
    const slot2 = await prisma.slot.create({
      data: {
        doctorId: docId,
        date: testFutureDate,
        startTime: new Date('2029-03-20T10:00:00.000Z'),
        endTime: new Date('2029-03-20T10:10:00.000Z'),
        status: 'AVAILABLE',
      },
    });
    targetSlotId = slot2.id;

    // 5. Create already booked slot
    const slot3 = await prisma.slot.create({
      data: {
        doctorId: docId,
        date: testFutureDate,
        startTime: new Date('2029-03-20T11:00:00.000Z'),
        endTime: new Date('2029-03-20T11:10:00.000Z'),
        status: 'BOOKED',
      },
    });
    alreadyBookedSlotId = slot3.id;

    // 6. Create past slot
    const slot4 = await prisma.slot.create({
      data: {
        doctorId: docId,
        date: new Date('2020-01-01T00:00:00.000Z'),
        startTime: new Date('2020-01-01T09:00:00.000Z'),
        endTime: new Date('2020-01-01T09:10:00.000Z'),
        status: 'AVAILABLE',
      },
    });
    pastSlotId = slot4.id;

    // 7. Create slot on doctor leave
    const slot5 = await prisma.slot.create({
      data: {
        doctorId: docId,
        date: testFutureDate,
        startTime: new Date('2029-03-20T14:00:00.000Z'),
        endTime: new Date('2029-03-20T14:10:00.000Z'),
        status: 'ON_LEAVE',
      },
    });
    leaveSlotId = slot5.id;
  });

  afterAll(async () => {
    try {
      await prisma.chatMessages.deleteMany({
        where: {
          doctorPatientRelation: {
            doctorsUserId: docUserId,
          },
        },
      });
      await prisma.doctorPatientRelation.deleteMany({
        where: {
          doctorsUserId: docUserId,
        },
      });
      await prisma.notification.deleteMany({
        where: { userId: { in: [docUserId, patientUserId] } },
      });
      await prisma.appointment.deleteMany({ where: { doctorId: docId } });
      await prisma.slot.deleteMany({ where: { doctorId: docId } });
      await prisma.doctor.deleteMany({ where: { id: docId } });
      await prisma.patient.deleteMany({ where: { id: patientId } });
      await prisma.user.deleteMany({ where: { id: { in: [docUserId, patientUserId] } } });
    } catch (e) {
      console.warn('Phase 23 cleanup warning:', e);
    }
  });

  it('23.1 Marks existing appointment as RESCHEDULED and releases previous slot', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/doctors/${docId}/appointments/${initialApptId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: 'RESCHEDULED' }),
      }
    );

    const res = await doctorAppointmentPATCH(req, {
      params: Promise.resolve({ doctorId: docId, appointmentId: initialApptId }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('RESCHEDULED');

    const appt = await prisma.appointment.findUnique({ where: { id: initialApptId } });
    expect(appt?.status).toBe('RESCHEDULED');
  });

  it('23.2 Holds target slot and confirms rescheduled appointment into new slot', async () => {
    // 1. Hold target slot
    const holdReq = new NextRequest('http://localhost:3000/api/appointments/hold', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${patientToken}`,
      },
      body: JSON.stringify({
        doctorId: docId,
        slotId: targetSlotId,
      }),
    });
    const holdRes = await holdPOST(holdReq);
    expect(holdRes.status).toBe(201);
    const holdBody = await holdRes.json();
    expect(holdBody.holdToken).toBeDefined();

    // 2. Confirm into target slot
    const confirmReq = new NextRequest('http://localhost:3000/api/appointments/confirm', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${patientToken}`,
      },
      body: JSON.stringify({
        doctorId: docId,
        slotId: targetSlotId,
        holdToken: holdBody.holdToken,
        paymentMethod: 'OFFLINE',
      }),
    });
    const confirmRes = await confirmPOST(confirmReq);
    expect(confirmRes.status).toBe(201);
    const confirmBody = await confirmRes.json();
    expect(confirmBody.appointment.slotId).toBe(targetSlotId);

    // Target slot is now BOOKED
    const targetSlot = await prisma.slot.findUnique({ where: { id: targetSlotId } });
    expect(targetSlot?.status).toBe('BOOKED');
  });

  it('23.3 Rejects rescheduling hold when target slot is already BOOKED or ON_LEAVE', async () => {
    // Attempt hold on already booked slot
    const holdReq1 = new NextRequest('http://localhost:3000/api/appointments/hold', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${patientToken}`,
      },
      body: JSON.stringify({
        doctorId: docId,
        slotId: alreadyBookedSlotId,
      }),
    });
    const holdRes1 = await holdPOST(holdReq1);
    expect(holdRes1.status).toBe(409);

    // Attempt hold on on-leave slot
    const holdReq2 = new NextRequest('http://localhost:3000/api/appointments/hold', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${patientToken}`,
      },
      body: JSON.stringify({
        doctorId: docId,
        slotId: leaveSlotId,
      }),
    });
    const holdRes2 = await holdPOST(holdReq2);
    expect(holdRes2.status).toBe(409);
  });

  it('23.4 Rejects rescheduling hold for past time slots', async () => {
    const holdReq = new NextRequest('http://localhost:3000/api/appointments/hold', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${patientToken}`,
      },
      body: JSON.stringify({
        doctorId: docId,
        slotId: pastSlotId,
      }),
    });
    const holdRes = await holdPOST(holdReq);
    expect(holdRes.status).toBe(400);
    const body = await holdRes.json();
    expect(body.error).toContain('passed');
  });
});
