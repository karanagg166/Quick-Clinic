import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as cronExpireGET } from '@/app/api/cron/expire-appointments/route';
import { autoExpirePastAppointments } from '@/lib/appointment-expiry';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 27: Appointment Expiration & Cron Service Test Suite', () => {
  let docUserId: string;
  let docId: string;

  let patientUserId: string;
  let patientId: string;

  let pastPendingApptId: string;
  let pastPendingSlotId: string;

  let pastConfirmedApptId: string;
  let pastConfirmedSlotId: string;

  let futureApptId: string;
  let futureSlotId: string;

  const pastDate = new Date('2021-06-01T00:00:00.000Z');
  const futureDate = new Date('2029-08-01T00:00:00.000Z');

  beforeAll(async () => {
    process.env.CRON_SECRET = 'test_cron_secret_quickclinic_123';

    // 1. Create Doctor
    const docPayload = buildUserPayload({
      name: 'Dr. Expiration Supervisor',
      email: `doc_expire_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const docUser = await prisma.user.create({
      data: {
        name: docPayload.name,
        email: docPayload.email,
        phoneNo: docPayload.phoneNo,
        password: docPayload.password,
        age: 49,
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
        specialty: 'CARDIOLOGIST',
        fees: 1000,
        experience: 19,
      },
    });
    docId = d.id;

    // 2. Create Patient
    const patPayload = buildUserPayload({
      name: 'Patient Expiry Subject',
      email: `pat_expire_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const patUser = await prisma.user.create({
      data: {
        name: patPayload.name,
        email: patPayload.email,
        phoneNo: patPayload.phoneNo,
        password: patPayload.password,
        age: 33,
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

    // 3. Create past PENDING appointment
    const slot1 = await prisma.slot.create({
      data: {
        doctorId: docId,
        date: pastDate,
        startTime: new Date('2021-06-01T09:00:00.000Z'),
        endTime: new Date('2021-06-01T09:10:00.000Z'),
        status: 'HELD',
      },
    });
    pastPendingSlotId = slot1.id;

    const appt1 = await prisma.appointment.create({
      data: {
        doctorId: docId,
        patientId,
        slotId: slot1.id,
        status: 'PENDING',
        paymentMethod: 'OFFLINE',
        isAppointmentOffline: true,
      },
    });
    pastPendingApptId = appt1.id;

    // 4. Create past CONFIRMED appointment
    const slot2 = await prisma.slot.create({
      data: {
        doctorId: docId,
        date: pastDate,
        startTime: new Date('2021-06-01T10:00:00.000Z'),
        endTime: new Date('2021-06-01T10:10:00.000Z'),
        status: 'BOOKED',
      },
    });
    pastConfirmedSlotId = slot2.id;

    const appt2 = await prisma.appointment.create({
      data: {
        doctorId: docId,
        patientId,
        slotId: slot2.id,
        status: 'CONFIRMED',
        paymentMethod: 'OFFLINE',
        isAppointmentOffline: true,
      },
    });
    pastConfirmedApptId = appt2.id;

    // 5. Create future CONFIRMED appointment (must NOT expire)
    const slot3 = await prisma.slot.create({
      data: {
        doctorId: docId,
        date: futureDate,
        startTime: new Date('2029-08-01T10:00:00.000Z'),
        endTime: new Date('2029-08-01T10:10:00.000Z'),
        status: 'BOOKED',
      },
    });
    futureSlotId = slot3.id;

    const appt3 = await prisma.appointment.create({
      data: {
        doctorId: docId,
        patientId,
        slotId: slot3.id,
        status: 'CONFIRMED',
        paymentMethod: 'OFFLINE',
        isAppointmentOffline: true,
      },
    });
    futureApptId = appt3.id;
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
      console.warn('Phase 27 cleanup warning:', e);
    }
  });

  it('27.1 Rejects unauthorized invocation of cron expire route without CRON_SECRET header', async () => {
    const req = new NextRequest('http://localhost:3000/api/cron/expire-appointments');
    const res = await cronExpireGET(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('27.2 Processes expired past appointments via cron route with valid CRON_SECRET', async () => {
    const req = new NextRequest('http://localhost:3000/api/cron/expire-appointments', {
      headers: {
        authorization: 'Bearer test_cron_secret_quickclinic_123',
      },
    });

    const res = await cronExpireGET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.expired).toBeGreaterThanOrEqual(2);

    // Verify past appointments are now EXPIRED
    const pPending = await prisma.appointment.findUnique({ where: { id: pastPendingApptId } });
    expect(pPending?.status).toBe('EXPIRED');

    const pConfirmed = await prisma.appointment.findUnique({ where: { id: pastConfirmedApptId } });
    expect(pConfirmed?.status).toBe('EXPIRED');

    // Verify slots are released to AVAILABLE
    const s1 = await prisma.slot.findUnique({ where: { id: pastPendingSlotId } });
    expect(s1?.status).toBe('AVAILABLE');

    const s2 = await prisma.slot.findUnique({ where: { id: pastConfirmedSlotId } });
    expect(s2?.status).toBe('AVAILABLE');

    // Verify future appointment remains unaffected
    const futureAppt = await prisma.appointment.findUnique({ where: { id: futureApptId } });
    expect(futureAppt?.status).toBe('CONFIRMED');

    const futureSlot = await prisma.slot.findUnique({ where: { id: futureSlotId } });
    expect(futureSlot?.status).toBe('BOOKED');
  });
});
