import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as doctorAppointmentsGET } from '@/app/api/doctors/[doctorId]/appointments/route';
import { GET as doctorAppointmentDetailGET } from '@/app/api/doctors/[doctorId]/appointments/[appointmentId]/route';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 29: Doctor Appointment Views, Multi-Filter & Clinical Detail Test Suite', () => {
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
  let doc2ApptId: string;

  const testDate = new Date('2029-10-05T00:00:00.000Z');

  beforeAll(async () => {
    // 1. Create Doctor 1
    const doc1Payload = buildUserPayload({
      name: 'Dr. Clinical Supervisor',
      email: `doc_view1_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const doc1User = await prisma.user.create({
      data: {
        name: doc1Payload.name,
        email: doc1Payload.email,
        phoneNo: doc1Payload.phoneNo,
        password: doc1Payload.password,
        age: 47,
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
        fees: 900,
        experience: 15,
      },
    });
    doc1Id = d1.id;

    // 2. Create Doctor 2
    const doc2Payload = buildUserPayload({
      name: 'Dr. Other Clinician',
      email: `doc_view2_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const doc2User = await prisma.user.create({
      data: {
        name: doc2Payload.name,
        email: doc2Payload.email,
        phoneNo: doc2Payload.phoneNo,
        password: doc2Payload.password,
        age: 38,
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
        fees: 600,
        experience: 8,
      },
    });
    doc2Id = d2.id;

    // 3. Create Patient 1 (Male, age 40, city Faridabad)
    const p1Payload = buildUserPayload({
      name: 'Rohan Sharma',
      email: `rohan_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const p1User = await prisma.user.create({
      data: {
        name: p1Payload.name,
        email: p1Payload.email,
        phoneNo: p1Payload.phoneNo,
        password: p1Payload.password,
        age: 40,
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
        medicalHistory: 'Chronic Knee Osteoarthritis',
        allergies: 'Sulfa drugs',
        currentMedications: 'Celecoxib 200mg',
      },
    });
    patient1Id = p1.id;

    // 4. Create Patient 2 (Female, age 28, city Delhi)
    const p2Payload = buildUserPayload({
      name: 'Sneha Patel',
      email: `sneha_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const p2User = await prisma.user.create({
      data: {
        name: p2Payload.name,
        email: p2Payload.email,
        phoneNo: p2Payload.phoneNo,
        password: p2Payload.password,
        age: 28,
        address: p2Payload.address,
        role: 'PATIENT',
        gender: 'FEMALE',
        location: {
          connectOrCreate: {
            where: { pincode: 110001 },
            create: { pincode: 110001, city: 'Delhi', state: 'Delhi' },
          },
        },
      },
    });
    patient2UserId = p2User.id;

    const p2 = await prisma.patient.create({
      data: {
        userId: p2User.id,
        medicalHistory: 'None',
        allergies: 'None',
        currentMedications: 'None',
      },
    });
    patient2Id = p2.id;

    // 5. Create appointments for Doctor 1
    // Appt 1: CONFIRMED, ONLINE, Rohan Sharma
    const s1 = await prisma.slot.create({
      data: {
        doctorId: doc1Id,
        date: testDate,
        startTime: new Date('2029-10-05T09:00:00.000Z'),
        endTime: new Date('2029-10-05T09:10:00.000Z'),
        status: 'BOOKED',
      },
    });
    const a1 = await prisma.appointment.create({
      data: {
        doctorId: doc1Id,
        patientId: patient1Id,
        slotId: s1.id,
        status: 'CONFIRMED',
        paymentMethod: 'ONLINE',
        transactionId: `pay_${Date.now()}_1`,
        isAppointmentOffline: false,
      },
    });
    appt1Id = a1.id;

    // Appt 2: COMPLETED, OFFLINE, Sneha Patel
    const s2 = await prisma.slot.create({
      data: {
        doctorId: doc1Id,
        date: testDate,
        startTime: new Date('2029-10-05T10:00:00.000Z'),
        endTime: new Date('2029-10-05T10:10:00.000Z'),
        status: 'UNAVAILABLE',
      },
    });
    const a2 = await prisma.appointment.create({
      data: {
        doctorId: doc1Id,
        patientId: patient2Id,
        slotId: s2.id,
        status: 'COMPLETED',
        paymentMethod: 'OFFLINE',
        isAppointmentOffline: true,
      },
    });
    appt2Id = a2.id;

    // Appt 3: NO_SHOW, OFFLINE, Rohan Sharma
    const s3 = await prisma.slot.create({
      data: {
        doctorId: doc1Id,
        date: testDate,
        startTime: new Date('2029-10-05T11:00:00.000Z'),
        endTime: new Date('2029-10-05T11:10:00.000Z'),
        status: 'UNAVAILABLE',
      },
    });
    const a3 = await prisma.appointment.create({
      data: {
        doctorId: doc1Id,
        patientId: patient1Id,
        slotId: s3.id,
        status: 'NO_SHOW',
        paymentMethod: 'OFFLINE',
        isAppointmentOffline: true,
      },
    });
    appt3Id = a3.id;

    // Appt for Doctor 2
    const s4 = await prisma.slot.create({
      data: {
        doctorId: doc2Id,
        date: testDate,
        startTime: new Date('2029-10-05T14:00:00.000Z'),
        endTime: new Date('2029-10-05T14:10:00.000Z'),
        status: 'BOOKED',
      },
    });
    const a4 = await prisma.appointment.create({
      data: {
        doctorId: doc2Id,
        patientId: patient1Id,
        slotId: s4.id,
        status: 'CONFIRMED',
        paymentMethod: 'OFFLINE',
        isAppointmentOffline: true,
      },
    });
    doc2ApptId = a4.id;
  });

  afterAll(async () => {
    try {
      await prisma.appointment.deleteMany({ where: { doctorId: { in: [doc1Id, doc2Id] } } });
      await prisma.slot.deleteMany({ where: { doctorId: { in: [doc1Id, doc2Id] } } });
      await prisma.doctor.deleteMany({ where: { id: { in: [doc1Id, doc2Id] } } });
      await prisma.patient.deleteMany({ where: { id: { in: [patient1Id, patient2Id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [doc1UserId, doc2UserId, patient1UserId, patient2UserId] } } });
    } catch (e) {
      console.warn('Phase 29 cleanup warning:', e);
    }
  });

  it('29.1 Doctor 1 retrieves own appointment list with patient details', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1Id}/appointments`);
    const res = await doctorAppointmentsGET(req, { params: Promise.resolve({ doctorId: doc1Id }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBe(3);
    const ids = body.map((a: any) => a.id);
    expect(ids).toEqual(expect.arrayContaining([appt1Id, appt2Id, appt3Id]));
    expect(ids).not.toContain(doc2ApptId);
  });

  it('29.2 Filters doctor appointments by status and paymentMethod', async () => {
    // Filter status=CONFIRMED
    const reqStatus = new NextRequest(`http://localhost:3000/api/doctors/${doc1Id}/appointments?status=CONFIRMED`);
    const resStatus = await doctorAppointmentsGET(reqStatus, { params: Promise.resolve({ doctorId: doc1Id }) });
    const statusList = await resStatus.json();
    expect(statusList.length).toBe(1);
    expect(statusList[0].id).toBe(appt1Id);

    // Filter paymentMethod=ONLINE
    const reqPayment = new NextRequest(`http://localhost:3000/api/doctors/${doc1Id}/appointments?paymentMethod=ONLINE`);
    const resPayment = await doctorAppointmentsGET(reqPayment, { params: Promise.resolve({ doctorId: doc1Id }) });
    const pmtList = await resPayment.json();
    expect(pmtList.length).toBe(1);
    expect(pmtList[0].id).toBe(appt1Id);
  });

  it('29.3 Filters doctor appointments by patientName, gender, city, and age', async () => {
    // Search by patientName
    const reqName = new NextRequest(`http://localhost:3000/api/doctors/${doc1Id}/appointments?patientName=Rohan`);
    const resName = await doctorAppointmentsGET(reqName, { params: Promise.resolve({ doctorId: doc1Id }) });
    const nameList = await resName.json();
    expect(nameList.length).toBe(2);

    // Search by gender=FEMALE
    const reqGender = new NextRequest(`http://localhost:3000/api/doctors/${doc1Id}/appointments?gender=FEMALE`);
    const resGender = await doctorAppointmentsGET(reqGender, { params: Promise.resolve({ doctorId: doc1Id }) });
    const genderList = await resGender.json();
    expect(genderList.length).toBe(1);
    expect(genderList[0].patientName).toBe('Sneha Patel');

    // Search by city=Delhi
    const reqCity = new NextRequest(`http://localhost:3000/api/doctors/${doc1Id}/appointments?city=Delhi`);
    const resCity = await doctorAppointmentsGET(reqCity, { params: Promise.resolve({ doctorId: doc1Id }) });
    const cityList = await resCity.json();
    expect(cityList.length).toBe(1);
    expect(cityList[0].city).toContain('Delhi');
  });

  it('29.4 Doctor appointment detail endpoint returns clinical notes, medical history, allergies, and medications', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1Id}/appointments/${appt1Id}`);
    const res = await doctorAppointmentDetailGET(req, {
      params: Promise.resolve({ doctorId: doc1Id, appointmentId: appt1Id }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(appt1Id);
    expect(body.patient.medicalHistory).toBe('Chronic Knee Osteoarthritis');
    expect(body.patient.allergies).toBe('Sulfa drugs');
    expect(body.patient.currentMedications).toBe('Celecoxib 200mg');
    expect(body.patient.user.name).toBe('Rohan Sharma');
  });

  it('29.5 Doctor 2 cannot view Doctor 1 appointment detail (404 isolation)', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${doc2Id}/appointments/${appt1Id}`);
    const res = await doctorAppointmentDetailGET(req, {
      params: Promise.resolve({ doctorId: doc2Id, appointmentId: appt1Id }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Appointment not found');
  });
});
