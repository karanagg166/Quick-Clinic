import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as ratingGET, POST as ratingPOST } from '@/app/api/doctors/[doctorId]/rating/route';
import { prisma } from '@/lib/prisma';
import { createToken } from '@/lib/auth';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 36: Doctor Ratings & Aggregate Calculation Test Suite', () => {
  let docUserId: string;
  let docId: string;

  let patient1UserId: string;
  let patient1Id: string;
  let patient1Token: string;

  let patient2UserId: string;
  let patient2Id: string;
  let patient2Token: string;

  let patientNoVisitUserId: string;
  let patientNoVisitId: string;
  let patientNoVisitToken: string;

  let slot1Id: string;
  let slot2Id: string;
  let appt1Id: string;
  let appt2Id: string;

  beforeAll(async () => {
    // 1. Create Doctor
    const docPayload = buildUserPayload({
      name: 'Dr. Rating Specialist',
      email: `doc_rate_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const docUser = await prisma.user.create({
      data: {
        name: docPayload.name,
        email: docPayload.email,
        phoneNo: docPayload.phoneNo,
        password: docPayload.password,
        age: 44,
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
        experience: 15,
      },
    });
    docId = d.id;

    // 2. Create Patient 1 (with completed appointment)
    const p1Payload = buildUserPayload({
      name: 'Patient Rating One',
      email: `pat_rate1_${Date.now()}@quickclinic.test`,
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
    const p1 = await prisma.patient.create({ data: { userId: p1User.id } });
    patient1Id = p1.id;
    patient1Token = await createToken({ id: patient1UserId, role: 'PATIENT' });

    // 3. Create Patient 2 (with completed appointment)
    const p2Payload = buildUserPayload({
      name: 'Patient Rating Two',
      email: `pat_rate2_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const p2User = await prisma.user.create({
      data: {
        name: p2Payload.name,
        email: p2Payload.email,
        phoneNo: p2Payload.phoneNo,
        password: p2Payload.password,
        age: 36,
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
    const p2 = await prisma.patient.create({ data: { userId: p2User.id } });
    patient2Id = p2.id;
    patient2Token = await createToken({ id: patient2UserId, role: 'PATIENT' });

    // 4. Create Patient 3 (never visited / no completed appointment)
    const p3Payload = buildUserPayload({
      name: 'Patient No Visit',
      email: `pat_novisit_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const p3User = await prisma.user.create({
      data: {
        name: p3Payload.name,
        email: p3Payload.email,
        phoneNo: p3Payload.phoneNo,
        password: p3Payload.password,
        age: 26,
        address: p3Payload.address,
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
    patientNoVisitUserId = p3User.id;
    const p3 = await prisma.patient.create({ data: { userId: p3User.id } });
    patientNoVisitId = p3.id;
    patientNoVisitToken = await createToken({ id: patientNoVisitUserId, role: 'PATIENT' });

    // 5. Create Slots and COMPLETED Appointments for Patient 1 and Patient 2
    const slot1 = await prisma.slot.create({
      data: {
        doctorId: docId,
        date: new Date('2026-07-10T00:00:00Z'),
        startTime: new Date('2026-07-10T09:00:00Z'),
        endTime: new Date('2026-07-10T09:30:00Z'),
        status: 'UNAVAILABLE',
      },
    });
    slot1Id = slot1.id;

    const appt1 = await prisma.appointment.create({
      data: {
        doctorId: docId,
        patientId: patient1Id,
        slotId: slot1.id,
        status: 'COMPLETED',
        paymentMethod: 'ONLINE',
      },
    });
    appt1Id = appt1.id;

    const slot2 = await prisma.slot.create({
      data: {
        doctorId: docId,
        date: new Date('2026-07-11T00:00:00Z'),
        startTime: new Date('2026-07-11T10:00:00Z'),
        endTime: new Date('2026-07-11T10:30:00Z'),
        status: 'UNAVAILABLE',
      },
    });
    slot2Id = slot2.id;

    const appt2 = await prisma.appointment.create({
      data: {
        doctorId: docId,
        patientId: patient2Id,
        slotId: slot2.id,
        status: 'COMPLETED',
        paymentMethod: 'OFFLINE',
      },
    });
    appt2Id = appt2.id;
  });

  afterAll(async () => {
    try {
      await prisma.rating.deleteMany({ where: { doctorId: docId } });
      await prisma.appointment.deleteMany({ where: { id: { in: [appt1Id, appt2Id] } } });
      await prisma.slot.deleteMany({ where: { id: { in: [slot1Id, slot2Id] } } });
      await prisma.patient.deleteMany({ where: { id: { in: [patient1Id, patient2Id, patientNoVisitId] } } });
      await prisma.doctor.deleteMany({ where: { id: docId } });
      await prisma.user.deleteMany({
        where: { id: { in: [docUserId, patient1UserId, patient2UserId, patientNoVisitUserId] } },
      });
    } catch (e) {
      console.warn('Phase 36 cleanup warning:', e);
    }
  });

  it('36.1 GET returns average 0 and count 0 when doctor has no ratings', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${docId}/rating`);
    const res = await ratingGET(req, { params: Promise.resolve({ doctorId: docId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.average).toBe(0);
    expect(data.count).toBe(0);
  });

  it('36.2 POST rejects unauthenticated requests with 401', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${docId}/rating`, {
      method: 'POST',
      body: JSON.stringify({ rating: 5 }),
    });
    const res = await ratingPOST(req, { params: Promise.resolve({ doctorId: docId }) });
    expect(res.status).toBe(401);
  });

  it('36.3 POST rejects invalid rating values (0, 6, -1, NaN) with 400', async () => {
    // Rating 0
    const reqZero = new NextRequest(`http://localhost:3000/api/doctors/${docId}/rating`, {
      method: 'POST',
      headers: { authorization: `Bearer ${patient1Token}` },
      body: JSON.stringify({ rating: 0 }),
    });
    const resZero = await ratingPOST(reqZero, { params: Promise.resolve({ doctorId: docId }) });
    expect(resZero.status).toBe(400);

    // Rating 6
    const reqSix = new NextRequest(`http://localhost:3000/api/doctors/${docId}/rating`, {
      method: 'POST',
      headers: { authorization: `Bearer ${patient1Token}` },
      body: JSON.stringify({ rating: 6 }),
    });
    const resSix = await ratingPOST(reqSix, { params: Promise.resolve({ doctorId: docId }) });
    expect(resSix.status).toBe(400);
  });

  it('36.4 POST rejects rating for non-existent doctor with 404', async () => {
    const req = new NextRequest('http://localhost:3000/api/doctors/non_existent_doc/rating', {
      method: 'POST',
      headers: { authorization: `Bearer ${patient1Token}` },
      body: JSON.stringify({ rating: 5 }),
    });
    const res = await ratingPOST(req, { params: Promise.resolve({ doctorId: 'non_existent_doc' }) });
    expect(res.status).toBe(404);
  });

  it('36.5 POST rejects rating if patient has NO completed appointment with doctor (403)', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${docId}/rating`, {
      method: 'POST',
      headers: { authorization: `Bearer ${patientNoVisitToken}` },
      body: JSON.stringify({ rating: 5 }),
    });
    const res = await ratingPOST(req, { params: Promise.resolve({ doctorId: docId }) });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.message).toMatch(/only rate a doctor after completing an appointment/i);
  });

  it('36.6 POST succeeds for patient with completed appointment (5 stars) and returns aggregate', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${docId}/rating`, {
      method: 'POST',
      headers: { authorization: `Bearer ${patient1Token}` },
      body: JSON.stringify({ rating: 5 }),
    });
    const res = await ratingPOST(req, { params: Promise.resolve({ doctorId: docId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.rating.average).toBe(5);
    expect(data.rating.count).toBe(1);
  });

  it('36.7 Idempotency & Rating Update: Patient 1 updates rating to 4 stars without duplicate row', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${docId}/rating`, {
      method: 'POST',
      headers: { authorization: `Bearer ${patient1Token}` },
      body: JSON.stringify({ rating: 4 }),
    });
    const res = await ratingPOST(req, { params: Promise.resolve({ doctorId: docId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.rating.average).toBe(4);
    expect(data.rating.count).toBe(1);

    // Verify DB count is exactly 1
    const count = await prisma.rating.count({ where: { doctorId: docId } });
    expect(count).toBe(1);
  });

  it('36.8 Aggregation: Patient 2 rates 2 stars, aggregate average becomes (4 + 2) / 2 = 3.0', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${docId}/rating`, {
      method: 'POST',
      headers: { authorization: `Bearer ${patient2Token}` },
      body: JSON.stringify({ rating: 2 }),
    });
    const res = await ratingPOST(req, { params: Promise.resolve({ doctorId: docId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.rating.average).toBe(3);
    expect(data.rating.count).toBe(2);

    // Verify GET endpoint reflects the updated aggregate
    const getReq = new NextRequest(`http://localhost:3000/api/doctors/${docId}/rating`);
    const getRes = await ratingGET(getReq, { params: Promise.resolve({ doctorId: docId }) });
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.average).toBe(3);
    expect(getData.count).toBe(2);
  });
});
