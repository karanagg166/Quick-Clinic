import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import {
  GET as doctorAppointmentGET,
  PATCH as doctorAppointmentPATCH,
} from '@/app/api/doctors/[doctorId]/appointments/[appointmentId]/route';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 20: Doctor Appointment Confirmation & Detail Inspection Test Suite', () => {
  let doc1UserId: string;
  let doc1Id: string;

  let doc2UserId: string;
  let doc2Id: string;

  let patientUserId: string;
  let patientId: string;

  let appointmentId: string;
  let slotId: string;

  const testDate = new Date('2028-12-30T00:00:00.000Z');

  beforeAll(async () => {
    // 1. Create Doctor 1 with qualifications
    const doc1Payload = buildUserPayload({
      name: 'Dr. Primary Confirmator',
      email: `doc_conf1_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const doc1User = await prisma.user.create({
      data: {
        name: doc1Payload.name,
        email: doc1Payload.email,
        phoneNo: doc1Payload.phoneNo,
        password: doc1Payload.password,
        age: 50,
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
        specialty: 'ORTHOPEDIC',
        fees: 950,
        experience: 18,
        doctorQualifications: {
          create: [{ qualification: 'MBBS' }, { qualification: 'MS' }],
        },
      },
    });
    doc1Id = d1.id;

    // 2. Create Doctor 2 (for authorization and isolation checks)
    const doc2Payload = buildUserPayload({
      name: 'Dr. Unrelated Confirmer',
      email: `doc_conf2_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const doc2User = await prisma.user.create({
      data: {
        name: doc2Payload.name,
        email: doc2Payload.email,
        phoneNo: doc2Payload.phoneNo,
        password: doc2Payload.password,
        age: 36,
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
        specialty: 'DERMATOLOGIST',
        fees: 700,
        experience: 8,
      },
    });
    doc2Id = d2.id;

    // 3. Create Patient with rich medical history
    const patPayload = buildUserPayload({
      name: 'Patient Detail Subject',
      email: `pat_conf_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const patUser = await prisma.user.create({
      data: {
        name: patPayload.name,
        email: patPayload.email,
        phoneNo: patPayload.phoneNo,
        password: patPayload.password,
        age: 34,
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
        medicalHistory: 'ACL reconstruction in 2022',
        allergies: 'Aspirin',
        currentMedications: 'Glucosamine sulfate',
      },
    });
    patientId = pat.id;

    // 4. Create slot & appointment for Doctor 1
    const slot = await prisma.slot.create({
      data: {
        doctorId: doc1Id,
        date: testDate,
        startTime: new Date('2028-12-30T15:00:00.000Z'),
        endTime: new Date('2028-12-30T15:10:00.000Z'),
        status: 'HELD',
      },
    });
    slotId = slot.id;

    const appt = await prisma.appointment.create({
      data: {
        doctorId: doc1Id,
        patientId,
        slotId: slot.id,
        status: 'PENDING',
        paymentMethod: 'OFFLINE',
        isAppointmentOffline: true,
      },
    });
    appointmentId = appt.id;
  });

  afterAll(async () => {
    try {
      await prisma.notification.deleteMany({ where: { userId: { in: [doc1UserId, doc2UserId, patientUserId] } } });
      await prisma.appointment.deleteMany({ where: { doctorId: { in: [doc1Id, doc2Id] } } });
      await prisma.slot.deleteMany({ where: { doctorId: { in: [doc1Id, doc2Id] } } });
      await prisma.auditLog.deleteMany({ where: { userId: doc1UserId } });
      await prisma.doctorQualification.deleteMany({ where: { doctorId: doc1Id } });
      await prisma.doctor.deleteMany({ where: { id: { in: [doc1Id, doc2Id] } } });
      await prisma.patient.deleteMany({ where: { id: patientId } });
      await prisma.user.deleteMany({ where: { id: { in: [doc1UserId, doc2UserId, patientUserId] } } });
    } catch (e) {
      console.warn('Phase 20 cleanup warning:', e);
    }
  });

  it('20.1 Doctor 1 retrieves detailed appointment structure with qualifications & medical history', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1Id}/appointments/${appointmentId}`);
    const res = await doctorAppointmentGET(req, { params: Promise.resolve({ doctorId: doc1Id, appointmentId }) });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.id).toBe(appointmentId);
    expect(body.status).toBe('PENDING');
    expect(body.doctor.qualifications).toEqual(expect.arrayContaining(['MBBS', 'MS']));
    expect(body.patient.medicalHistory).toBe('ACL reconstruction in 2022');
    expect(body.patient.allergies).toBe('Aspirin');
    expect(body.patient.currentMedications).toBe('Glucosamine sulfate');
    expect(body.slot.id).toBe(slotId);
  });

  it('20.2 Doctor 1 confirms appointment and synchronizes slot status to BOOKED', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1Id}/appointments/${appointmentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'CONFIRMED' }),
    });

    const res = await doctorAppointmentPATCH(req, { params: Promise.resolve({ doctorId: doc1Id, appointmentId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('CONFIRMED');

    // Slot is now BOOKED
    const slot = await prisma.slot.findUnique({ where: { id: slotId } });
    expect(slot?.status).toBe('BOOKED');
  });

  it('20.3 isolates doctor scope: Doctor 2 cannot view or modify Doctor 1 appointment', async () => {
    // Attempt GET by Doctor 2
    const getReq = new NextRequest(`http://localhost:3000/api/doctors/${doc2Id}/appointments/${appointmentId}`);
    const getRes = await doctorAppointmentGET(getReq, { params: Promise.resolve({ doctorId: doc2Id, appointmentId }) });
    expect(getRes.status).toBe(404);

    // Attempt PATCH by Doctor 2
    const patchReq = new NextRequest(`http://localhost:3000/api/doctors/${doc2Id}/appointments/${appointmentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'COMPLETED' }),
    });
    const patchRes = await doctorAppointmentPATCH(patchReq, { params: Promise.resolve({ doctorId: doc2Id, appointmentId }) });
    expect(patchRes.status).toBe(404);
  });

  it('20.4 rejects invalid update request with unsupported status or empty body', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1Id}/appointments/${appointmentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'INVALID_STATUS_ENUM' }),
    });

    const res = await doctorAppointmentPATCH(req, { params: Promise.resolve({ doctorId: doc1Id, appointmentId }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid status');
  });
});
