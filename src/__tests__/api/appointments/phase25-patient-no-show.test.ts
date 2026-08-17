import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import {
  GET as doctorAppointmentGET,
  PATCH as doctorAppointmentPATCH,
} from '@/app/api/doctors/[doctorId]/appointments/[appointmentId]/route';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 25: Patient No-Show Handling & Slot Consumption Test Suite', () => {
  let doc1UserId: string;
  let doc1Id: string;

  let doc2UserId: string;
  let doc2Id: string;

  let patientUserId: string;
  let patientId: string;

  let apptId: string;
  let slotId: string;

  const testDate = new Date('2029-05-18T00:00:00.000Z');

  beforeAll(async () => {
    // 1. Create Doctor 1
    const doc1Payload = buildUserPayload({
      name: 'Dr. Attendance Tracker',
      email: `doc_noshow1_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const doc1User = await prisma.user.create({
      data: {
        name: doc1Payload.name,
        email: doc1Payload.email,
        phoneNo: doc1Payload.phoneNo,
        password: doc1Payload.password,
        age: 44,
        address: doc1Payload.address,
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
    doc1UserId = doc1User.id;

    const d1 = await prisma.doctor.create({
      data: {
        userId: doc1User.id,
        specialty: 'PSYCHIATRIST',
        fees: 900,
        experience: 14,
      },
    });
    doc1Id = d1.id;

    // 2. Create Doctor 2
    const doc2Payload = buildUserPayload({
      name: 'Dr. Bystander NoShow',
      email: `doc_noshow2_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const doc2User = await prisma.user.create({
      data: {
        name: doc2Payload.name,
        email: doc2Payload.email,
        phoneNo: doc2Payload.phoneNo,
        password: doc2Payload.password,
        age: 37,
        address: doc2Payload.address,
        role: 'DOCTOR',
        gender: 'FEMALE',
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    doc2UserId = doc2User.id;

    const d2 = await prisma.doctor.create({
      data: {
        userId: doc2User.id,
        specialty: 'GENERAL_PHYSICIAN',
        fees: 400,
        experience: 6,
      },
    });
    doc2Id = d2.id;

    // 3. Create Patient
    const patPayload = buildUserPayload({
      name: 'Patient Absent Subject',
      email: `pat_noshow_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const patUser = await prisma.user.create({
      data: {
        name: patPayload.name,
        email: patPayload.email,
        phoneNo: patPayload.phoneNo,
        password: patPayload.password,
        age: 27,
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

    // 4. Create slot and appointment
    const slot = await prisma.slot.create({
      data: {
        doctorId: doc1Id,
        date: testDate,
        startTime: new Date('2029-05-18T16:00:00.000Z'),
        endTime: new Date('2029-05-18T16:10:00.000Z'),
        status: 'BOOKED',
      },
    });
    slotId = slot.id;

    const appt = await prisma.appointment.create({
      data: {
        doctorId: doc1Id,
        patientId,
        slotId: slot.id,
        status: 'CONFIRMED',
        paymentMethod: 'OFFLINE',
        isAppointmentOffline: true,
      },
    });
    apptId = appt.id;
  });

  afterAll(async () => {
    try {
      await prisma.chatMessages.deleteMany({
        where: {
          doctorPatientRelation: {
            doctorsUserId: { in: [doc1UserId, doc2UserId] },
          },
        },
      });
      await prisma.doctorPatientRelation.deleteMany({
        where: {
          doctorsUserId: { in: [doc1UserId, doc2UserId] },
        },
      });
      await prisma.notification.deleteMany({
        where: { userId: { in: [doc1UserId, doc2UserId, patientUserId] } },
      });
      await prisma.auditLog.deleteMany({
        where: { userId: { in: [doc1UserId, doc2UserId] } },
      });
      await prisma.appointment.deleteMany({ where: { doctorId: { in: [doc1Id, doc2Id] } } });
      await prisma.slot.deleteMany({ where: { doctorId: { in: [doc1Id, doc2Id] } } });
      await prisma.doctor.deleteMany({ where: { id: { in: [doc1Id, doc2Id] } } });
      await prisma.patient.deleteMany({ where: { id: patientId } });
      await prisma.user.deleteMany({ where: { id: { in: [doc1UserId, doc2UserId, patientUserId] } } });
    } catch (e) {
      console.warn('Phase 25 cleanup warning:', e);
    }
  });

  it('25.1 Doctor 1 marks appointment as NO_SHOW, consumes slot, notifies patient, and logs audit', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/doctors/${doc1Id}/appointments/${apptId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: 'NO_SHOW' }),
      }
    );

    const res = await doctorAppointmentPATCH(req, {
      params: Promise.resolve({ doctorId: doc1Id, appointmentId: apptId }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('NO_SHOW');

    // Appointment is NO_SHOW
    const appt = await prisma.appointment.findUnique({ where: { id: apptId } });
    expect(appt?.status).toBe('NO_SHOW');

    // Slot is UNAVAILABLE
    const slot = await prisma.slot.findUnique({ where: { id: slotId } });
    expect(slot?.status).toBe('UNAVAILABLE');

    // Patient receives no-show notification
    const patientNotifs = await prisma.notification.findMany({ where: { userId: patientUserId } });
    expect(patientNotifs.some((n: any) => n.message.includes('marked as no-show'))).toBe(true);

    // Audit log recorded
    const logs = await prisma.auditLog.findMany({ where: { userId: doc1UserId } });
    expect(logs.some((l: any) => l.action === 'Updated Appointment Status')).toBe(true);
  });

  it('25.2 Doctor 2 cannot mark NO_SHOW on Doctor 1 appointment (404 isolation)', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/doctors/${doc2Id}/appointments/${apptId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: 'NO_SHOW' }),
      }
    );

    const res = await doctorAppointmentPATCH(req, {
      params: Promise.resolve({ doctorId: doc2Id, appointmentId: apptId }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Appointment not found');
  });
});
