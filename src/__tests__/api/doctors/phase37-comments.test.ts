import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as commentsGET, POST as commentsPOST } from '@/app/api/doctors/[doctorId]/comments/route';
import { prisma } from '@/lib/prisma';
import { createToken } from '@/lib/auth';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 37: Doctor Comments & Reviews Test Suite', () => {
  let docUserId: string;
  let docId: string;

  let patient1UserId: string;
  let patient1Id: string;
  let patient1Token: string;

  let patientNoVisitUserId: string;
  let patientNoVisitId: string;
  let patientNoVisitToken: string;

  let slotId: string;
  let apptId: string;

  beforeAll(async () => {
    // 1. Create Doctor
    const docPayload = buildUserPayload({
      name: 'Dr. Comments Specialist',
      email: `doc_comm_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const docUser = await prisma.user.create({
      data: {
        name: docPayload.name,
        email: docPayload.email,
        phoneNo: docPayload.phoneNo,
        password: docPayload.password,
        age: 52,
        address: docPayload.address,
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
    docUserId = docUser.id;

    const d = await prisma.doctor.create({
      data: {
        userId: docUser.id,
        specialty: 'DERMATOLOGIST',
        fees: 850,
        experience: 18,
      },
    });
    docId = d.id;

    // 2. Create Patient 1 (with completed appointment)
    const p1Payload = buildUserPayload({
      name: 'Patient Reviewer One',
      email: `pat_rev1_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const p1User = await prisma.user.create({
      data: {
        name: p1Payload.name,
        email: p1Payload.email,
        phoneNo: p1Payload.phoneNo,
        password: p1Payload.password,
        age: 31,
        address: p1Payload.address,
        role: 'PATIENT',
        gender: 'FEMALE',
        profileImageUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2',
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

    // 3. Create Patient 2 (never visited / no completed appointment)
    const p2Payload = buildUserPayload({
      name: 'Patient Never Visited',
      email: `pat_novisit2_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const p2User = await prisma.user.create({
      data: {
        name: p2Payload.name,
        email: p2Payload.email,
        phoneNo: p2Payload.phoneNo,
        password: p2Payload.password,
        age: 24,
        address: p2Payload.address,
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
    patientNoVisitUserId = p2User.id;
    const p2 = await prisma.patient.create({ data: { userId: p2User.id } });
    patientNoVisitId = p2.id;
    patientNoVisitToken = await createToken({ id: patientNoVisitUserId, role: 'PATIENT' });

    // 4. Create Slot and COMPLETED Appointment for Patient 1
    const slot = await prisma.slot.create({
      data: {
        doctorId: docId,
        date: new Date('2026-07-15T00:00:00Z'),
        startTime: new Date('2026-07-15T11:00:00Z'),
        endTime: new Date('2026-07-15T11:30:00Z'),
        status: 'UNAVAILABLE',
      },
    });
    slotId = slot.id;

    const appt = await prisma.appointment.create({
      data: {
        doctorId: docId,
        patientId: patient1Id,
        slotId: slot.id,
        status: 'COMPLETED',
        paymentMethod: 'ONLINE',
      },
    });
    apptId = appt.id;
  });

  afterAll(async () => {
    try {
      await prisma.comment.deleteMany({ where: { doctorId: docId } });
      await prisma.appointment.deleteMany({ where: { id: apptId } });
      await prisma.slot.deleteMany({ where: { id: slotId } });
      await prisma.patient.deleteMany({ where: { id: { in: [patient1Id, patientNoVisitId] } } });
      await prisma.doctor.deleteMany({ where: { id: docId } });
      await prisma.user.deleteMany({
        where: { id: { in: [docUserId, patient1UserId, patientNoVisitUserId] } },
      });
    } catch (e) {
      console.warn('Phase 37 cleanup warning:', e);
    }
  });

  it('37.1 GET returns empty list when doctor has no comments', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${docId}/comments`);
    const res = await commentsGET(req, { params: Promise.resolve({ doctorId: docId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.comments).toEqual([]);
  });

  it('37.2 POST rejects unauthenticated requests with 401', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${docId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ text: 'Great consultation!' }),
    });
    const res = await commentsPOST(req, { params: Promise.resolve({ doctorId: docId }) });
    expect(res.status).toBe(401);
  });

  it('37.3 POST rejects empty or whitespace-only comment text with 400', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${docId}/comments`, {
      method: 'POST',
      headers: { authorization: `Bearer ${patient1Token}` },
      body: JSON.stringify({ text: '    ' }),
    });
    const res = await commentsPOST(req, { params: Promise.resolve({ doctorId: docId }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.message).toBe('Comment text is required');
  });

  it('37.4 POST rejects comment for non-existent doctor with 404', async () => {
    const req = new NextRequest('http://localhost:3000/api/doctors/non_existent_doc/comments', {
      method: 'POST',
      headers: { authorization: `Bearer ${patient1Token}` },
      body: JSON.stringify({ text: 'Doctor was friendly.' }),
    });
    const res = await commentsPOST(req, { params: Promise.resolve({ doctorId: 'non_existent_doc' }) });
    expect(res.status).toBe(404);
  });

  it('37.5 POST rejects comment if patient has NO completed appointment with doctor (403)', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${docId}/comments`, {
      method: 'POST',
      headers: { authorization: `Bearer ${patientNoVisitToken}` },
      body: JSON.stringify({ text: 'I never visited but want to review.' }),
    });
    const res = await commentsPOST(req, { params: Promise.resolve({ doctorId: docId }) });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.message).toMatch(/only review a doctor after completing an appointment/i);
  });

  it('37.6 POST creates comment successfully with 201 Created for verified patient', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${docId}/comments`, {
      method: 'POST',
      headers: { authorization: `Bearer ${patient1Token}` },
      body: JSON.stringify({ text: 'Dr. Specialist provided an accurate diagnosis and treatment plan.' }),
    });
    const res = await commentsPOST(req, { params: Promise.resolve({ doctorId: docId }) });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.comment.text).toBe('Dr. Specialist provided an accurate diagnosis and treatment plan.');
    expect(data.comment.patient.user.name).toBe('Patient Reviewer One');
  });

  it('37.7 GET returns created comments in descending order with sanitized avatar URL', async () => {
    // Add second follow-up comment
    const req2 = new NextRequest(`http://localhost:3000/api/doctors/${docId}/comments`, {
      method: 'POST',
      headers: { authorization: `Bearer ${patient1Token}` },
      body: JSON.stringify({ text: 'Follow-up consultation went very well!' }),
    });
    await commentsPOST(req2, { params: Promise.resolve({ doctorId: docId }) });

    const getReq = new NextRequest(`http://localhost:3000/api/doctors/${docId}/comments`);
    const getRes = await commentsGET(getReq, { params: Promise.resolve({ doctorId: docId }) });
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();

    expect(getData.comments.length).toBe(2);
    expect(getData.comments[0].text).toBe('Follow-up consultation went very well!');
    expect(getData.comments[1].text).toBe('Dr. Specialist provided an accurate diagnosis and treatment plan.');
    expect(getData.comments[0].patient.user.profileImageUrl).toBe('https://images.unsplash.com/photo-1544005313-94ddf0286df2');
  });
});
