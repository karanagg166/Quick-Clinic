import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as patientAppointmentsGET } from '@/app/api/patients/[patientId]/appointments/route';
import { GET as patientAppointmentDetailGET } from '@/app/api/patients/[patientId]/appointments/[appointmentId]/route';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 28: Patient Appointment Views, Filters & Privacy Test Suite', () => {
  let doc1UserId: string;
  let doc1Id: string;

  let doc2UserId: string;
  let doc2Id: string;

  let patient1UserId: string;
  let patient1Id: string;

  let patient2UserId: string;
  let patient2Id: string;

  let appt1Id: string;
  let appt2Id: string;
  let appt3Id: string;
  let patient2ApptId: string;

  const testDate = new Date('2029-09-10T00:00:00.000Z');

  beforeAll(async () => {
    // 1. Create Doctor 1 (Cardiologist, fees: 1100)
    const doc1Payload = buildUserPayload({
      name: 'Dr. Arun Cardio',
      email: `doc_patview1_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const doc1User = await prisma.user.create({
      data: {
        name: doc1Payload.name,
        email: doc1Payload.email,
        phoneNo: doc1Payload.phoneNo,
        password: doc1Payload.password,
        age: 51,
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
        specialty: 'CARDIOLOGIST',
        fees: 1100,
        experience: 22,
        doctorQualifications: {
          create: [{ qualification: 'MBBS' }, { qualification: 'DM' }],
        },
      },
    });
    doc1Id = d1.id;

    // 2. Create Doctor 2 (Dermatologist, fees: 750)
    const doc2Payload = buildUserPayload({
      name: 'Dr. Bhavna Derma',
      email: `doc_patview2_${Date.now()}@quickclinic.test`,
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
        fees: 750,
        experience: 11,
      },
    });
    doc2Id = d2.id;

    // 3. Create Patient 1
    const p1Payload = buildUserPayload({
      name: 'Patient MultiViews One',
      email: `pat_views1_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const p1User = await prisma.user.create({
      data: {
        name: p1Payload.name,
        email: p1Payload.email,
        phoneNo: p1Payload.phoneNo,
        password: p1Payload.password,
        age: 30,
        address: p1Payload.address,
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
    patient1UserId = p1User.id;

    const p1 = await prisma.patient.create({
      data: {
        userId: p1User.id,
        medicalHistory: 'None',
        allergies: 'None',
        currentMedications: 'None',
      },
    });
    patient1Id = p1.id;

    // 4. Create Patient 2
    const p2Payload = buildUserPayload({
      name: 'Patient MultiViews Two',
      email: `pat_views2_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const p2User = await prisma.user.create({
      data: {
        name: p2Payload.name,
        email: p2Payload.email,
        phoneNo: p2Payload.phoneNo,
        password: p2Payload.password,
        age: 25,
        address: p2Payload.address,
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
    patient2UserId = p2User.id;

    const p2 = await prisma.patient.create({
      data: {
        userId: p2User.id,
      },
    });
    patient2Id = p2.id;

    // 5. Create appointments for Patient 1
    // Appt 1: CONFIRMED with Doctor 1
    const s1 = await prisma.slot.create({
      data: {
        doctorId: doc1Id,
        date: testDate,
        startTime: new Date('2029-09-10T09:00:00.000Z'),
        endTime: new Date('2029-09-10T09:10:00.000Z'),
        status: 'BOOKED',
      },
    });
    const a1 = await prisma.appointment.create({
      data: {
        doctorId: doc1Id,
        patientId: patient1Id,
        slotId: s1.id,
        status: 'CONFIRMED',
        paymentMethod: 'OFFLINE',
        isAppointmentOffline: true,
      },
    });
    appt1Id = a1.id;

    // Appt 2: COMPLETED with Doctor 2
    const s2 = await prisma.slot.create({
      data: {
        doctorId: doc2Id,
        date: testDate,
        startTime: new Date('2029-09-10T10:00:00.000Z'),
        endTime: new Date('2029-09-10T10:10:00.000Z'),
        status: 'UNAVAILABLE',
      },
    });
    const a2 = await prisma.appointment.create({
      data: {
        doctorId: doc2Id,
        patientId: patient1Id,
        slotId: s2.id,
        status: 'COMPLETED',
        paymentMethod: 'ONLINE',
        isAppointmentOffline: false,
      },
    });
    appt2Id = a2.id;

    // Appt 3: CANCELLED with Doctor 1
    const s3 = await prisma.slot.create({
      data: {
        doctorId: doc1Id,
        date: testDate,
        startTime: new Date('2029-09-10T11:00:00.000Z'),
        endTime: new Date('2029-09-10T11:10:00.000Z'),
        status: 'AVAILABLE',
      },
    });
    const a3 = await prisma.appointment.create({
      data: {
        doctorId: doc1Id,
        patientId: patient1Id,
        slotId: s3.id,
        status: 'CANCELLED',
        paymentMethod: 'OFFLINE',
        isAppointmentOffline: true,
      },
    });
    appt3Id = a3.id;

    // Appt for Patient 2
    const s4 = await prisma.slot.create({
      data: {
        doctorId: doc1Id,
        date: testDate,
        startTime: new Date('2029-09-10T14:00:00.000Z'),
        endTime: new Date('2029-09-10T14:10:00.000Z'),
        status: 'BOOKED',
      },
    });
    const a4 = await prisma.appointment.create({
      data: {
        doctorId: doc1Id,
        patientId: patient2Id,
        slotId: s4.id,
        status: 'CONFIRMED',
        paymentMethod: 'OFFLINE',
        isAppointmentOffline: true,
      },
    });
    patient2ApptId = a4.id;
  });

  afterAll(async () => {
    try {
      await prisma.appointment.deleteMany({ where: { doctorId: { in: [doc1Id, doc2Id] } } });
      await prisma.slot.deleteMany({ where: { doctorId: { in: [doc1Id, doc2Id] } } });
      await prisma.doctorQualification.deleteMany({ where: { doctorId: doc1Id } });
      await prisma.doctor.deleteMany({ where: { id: { in: [doc1Id, doc2Id] } } });
      await prisma.patient.deleteMany({ where: { id: { in: [patient1Id, patient2Id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [doc1UserId, doc2UserId, patient1UserId, patient2UserId] } } });
    } catch (e) {
      console.warn('Phase 28 cleanup warning:', e);
    }
  });

  it('28.1 Patient 1 retrieves full list of own appointments', async () => {
    const req = new NextRequest(`http://localhost:3000/api/patients/${patient1Id}/appointments`);
    const res = await patientAppointmentsGET(req, { params: Promise.resolve({ patientId: patient1Id }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBe(3);
    const ids = body.map((a: any) => a.id);
    expect(ids).toEqual(expect.arrayContaining([appt1Id, appt2Id, appt3Id]));
    expect(ids).not.toContain(patient2ApptId);
  });

  it('28.2 Filters patient appointments by status (CONFIRMED vs COMPLETED vs CANCELLED)', async () => {
    const reqConfirmed = new NextRequest(`http://localhost:3000/api/patients/${patient1Id}/appointments?status=CONFIRMED`);
    const resConfirmed = await patientAppointmentsGET(reqConfirmed, { params: Promise.resolve({ patientId: patient1Id }) });
    const confirmedList = await resConfirmed.json();
    expect(confirmedList.length).toBe(1);
    expect(confirmedList[0].id).toBe(appt1Id);

    const reqCompleted = new NextRequest(`http://localhost:3000/api/patients/${patient1Id}/appointments?status=COMPLETED`);
    const resCompleted = await patientAppointmentsGET(reqCompleted, { params: Promise.resolve({ patientId: patient1Id }) });
    const completedList = await resCompleted.json();
    expect(completedList.length).toBe(1);
    expect(completedList[0].id).toBe(appt2Id);
  });

  it('28.3 Filters patient appointments by doctorName and specialty', async () => {
    const reqName = new NextRequest(`http://localhost:3000/api/patients/${patient1Id}/appointments?doctorName=Cardio`);
    const resName = await patientAppointmentsGET(reqName, { params: Promise.resolve({ patientId: patient1Id }) });
    const nameList = await resName.json();
    expect(nameList.length).toBe(2); // appt1 and appt3 with Dr. Arun Cardio

    const reqSpec = new NextRequest(`http://localhost:3000/api/patients/${patient1Id}/appointments?specialty=DERMATOLOGIST`);
    const resSpec = await patientAppointmentsGET(reqSpec, { params: Promise.resolve({ patientId: patient1Id }) });
    const specList = await resSpec.json();
    expect(specList.length).toBe(1);
    expect(specList[0].id).toBe(appt2Id);
  });

  it('28.4 IDOR Isolation: Patient 2 only receives Patient 2 appointments', async () => {
    const req = new NextRequest(`http://localhost:3000/api/patients/${patient2Id}/appointments`);
    const res = await patientAppointmentsGET(req, { params: Promise.resolve({ patientId: patient2Id }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBe(1);
    expect(body[0].id).toBe(patient2ApptId);
  });

  it('28.5 Patient appointment detail endpoint returns complete appointment information without leaking password secrets', async () => {
    const req = new NextRequest(`http://localhost:3000/api/patients/${patient1Id}/appointments/${appt1Id}`);
    const res = await patientAppointmentDetailGET(req, {
      params: Promise.resolve({ patientId: patient1Id, appointmentId: appt1Id }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(appt1Id);
    expect(body.doctor.specialty).toBe('CARDIOLOGIST');
    expect(body.doctor.qualifications).toEqual(expect.arrayContaining(['MBBS', 'DM']));
    expect(body.doctor.user.name).toBe('Dr. Arun Cardio');
    expect(body.doctor.user.password).toBeUndefined();
  });
});
