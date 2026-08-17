import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import {
  GET as relationsGET,
  POST as relationsPOST,
} from '@/app/api/doctorpatientrelations/route';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 31: Doctor-Patient Relationship & Room Binding Test Suite', () => {
  let doc1UserId: string;
  let doc1Id: string;

  let doc2UserId: string;
  let doc2Id: string;

  let patient1UserId: string;
  let patient1Id: string;

  let patient2UserId: string;
  let patient2Id: string;

  let createdRelationId: string;

  beforeAll(async () => {
    // 1. Create Doctor 1
    const doc1Payload = buildUserPayload({
      name: 'Dr. Relationship Lead',
      email: `doc_rel1_${Date.now()}@quickclinic.test`,
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
        specialty: 'CARDIOLOGIST',
        fees: 900,
        experience: 16,
      },
    });
    doc1Id = d1.id;

    // 2. Create Doctor 2
    const doc2Payload = buildUserPayload({
      name: 'Dr. Secondary Specialist',
      email: `doc_rel2_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const doc2User = await prisma.user.create({
      data: {
        name: doc2Payload.name,
        email: doc2Payload.email,
        phoneNo: doc2Payload.phoneNo,
        password: doc2Payload.password,
        age: 41,
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
        experience: 10,
      },
    });
    doc2Id = d2.id;

    // 3. Create Patient 1
    const pat1Payload = buildUserPayload({
      name: 'Patient Rel One',
      email: `pat_rel1_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const pat1User = await prisma.user.create({
      data: {
        name: pat1Payload.name,
        email: pat1Payload.email,
        phoneNo: pat1Payload.phoneNo,
        password: pat1Payload.password,
        age: 29,
        address: pat1Payload.address,
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
    patient1UserId = pat1User.id;

    const p1 = await prisma.patient.create({
      data: {
        userId: pat1User.id,
      },
    });
    patient1Id = p1.id;

    // 4. Create Patient 2
    const pat2Payload = buildUserPayload({
      name: 'Patient Rel Two',
      email: `pat_rel2_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const pat2User = await prisma.user.create({
      data: {
        name: pat2Payload.name,
        email: pat2Payload.email,
        phoneNo: pat2Payload.phoneNo,
        password: pat2Payload.password,
        age: 34,
        address: pat2Payload.address,
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
    patient2UserId = pat2User.id;

    const p2 = await prisma.patient.create({
      data: {
        userId: pat2User.id,
      },
    });
    patient2Id = p2.id;
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
      await prisma.doctor.deleteMany({ where: { id: { in: [doc1Id, doc2Id] } } });
      await prisma.patient.deleteMany({ where: { id: { in: [patient1Id, patient2Id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [doc1UserId, doc2UserId, patient1UserId, patient2UserId] } } });
    } catch (e) {
      console.warn('Phase 31 cleanup warning:', e);
    }
  });

  it('31.1 Creates a new DoctorPatientRelation for Doctor 1 and Patient 1', async () => {
    const req = new NextRequest('http://localhost:3000/api/doctorpatientrelations', {
      method: 'POST',
      body: JSON.stringify({
        doctorsUserId: doc1UserId,
        patientsUserId: patient1UserId,
      }),
    });

    const res = await relationsPOST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.isNew).toBe(true);
    expect(body.relation.doctorsUserId).toBe(doc1UserId);
    expect(body.relation.patientsUserId).toBe(patient1UserId);
    createdRelationId = body.relation.id;
  });

  it('31.2 Idempotency & Duplicate prevention: Repeated POST returns existing relation without creating duplicate', async () => {
    const req = new NextRequest('http://localhost:3000/api/doctorpatientrelations', {
      method: 'POST',
      body: JSON.stringify({
        doctorsUserId: doc1UserId,
        patientsUserId: patient1UserId,
      }),
    });

    const res = await relationsPOST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isNew).toBe(false);
    expect(body.relation.id).toBe(createdRelationId);

    // Verify DB count is exactly 1
    const count = await prisma.doctorPatientRelation.count({
      where: {
        doctorsUserId: doc1UserId,
        patientsUserId: patient1UserId,
      },
    });
    expect(count).toBe(1);
  });

  it('31.3 GET relations for PATIENT lists Doctor 1 and latest message metadata', async () => {
    // Add a chat message
    await prisma.chatMessages.create({
      data: {
        doctorPatientRelationId: createdRelationId,
        senderId: patient1UserId,
        text: 'Hello Dr. Relationship Lead!',
      },
    });

    const req = new NextRequest(
      `http://localhost:3000/api/doctorpatientrelations?userId=${patient1UserId}&role=PATIENT`
    );
    const res = await relationsGET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.relations.length).toBe(1);
    expect(body.relations[0].doctorName).toBe('Dr. Relationship Lead');
    expect(body.relations[0].lastMessage).toBe('Hello Dr. Relationship Lead!');
  });

  it('31.4 GET relations for DOCTOR lists Patient 1 and latest message metadata', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/doctorpatientrelations?userId=${doc1UserId}&role=DOCTOR`
    );
    const res = await relationsGET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.relations.length).toBe(1);
    expect(body.relations[0].patientName).toBe('Patient Rel One');
    expect(body.relations[0].lastMessage).toBe('Hello Dr. Relationship Lead!');
  });

  it('31.5 Rejects creation with non-existent doctor or patient with 404', async () => {
    const req = new NextRequest('http://localhost:3000/api/doctorpatientrelations', {
      method: 'POST',
      body: JSON.stringify({
        doctorsUserId: 'non_existent_doctor_user_id',
        patientsUserId: patient1UserId,
      }),
    });

    const res = await relationsPOST(req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Doctor not found');
  });

  it('31.6 GET rejects requests with missing userId or role with 400', async () => {
    const req = new NextRequest('http://localhost:3000/api/doctorpatientrelations?userId=');
    const res = await relationsGET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/userId and role are required/i);
  });

  it('31.7 GET rejects requests with invalid role with 400', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/doctorpatientrelations?userId=${patient1UserId}&role=UNKNOWN`
    );
    const res = await relationsGET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/role must be PATIENT or DOCTOR/i);
  });

  it('31.8 POST rejects creation with missing doctorsUserId or patientsUserId with 400', async () => {
    const req = new NextRequest('http://localhost:3000/api/doctorpatientrelations', {
      method: 'POST',
      body: JSON.stringify({
        doctorsUserId: '',
        patientsUserId: patient1UserId,
      }),
    });

    const res = await relationsPOST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/doctorsUserId and patientsUserId are required/i);
  });
});
