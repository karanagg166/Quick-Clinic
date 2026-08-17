import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as chatsGET, POST as chatsPOST } from '@/app/api/doctorpatientrelations/[relationId]/chats/route';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 34: Chat History & Message Pagination Test Suite', () => {
  let docUserId: string;
  let docId: string;
  let patientUserId: string;
  let patientId: string;
  let relationId: string;

  beforeAll(async () => {
    // 1. Create Doctor
    const docPayload = buildUserPayload({
      name: 'Dr. Chat History Specialist',
      email: `doc_chat_hist_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const docUser = await prisma.user.create({
      data: {
        name: docPayload.name,
        email: docPayload.email,
        phoneNo: docPayload.phoneNo,
        password: docPayload.password,
        age: 48,
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
        fees: 600,
        experience: 12,
      },
    });
    docId = d.id;

    // 2. Create Patient
    const patPayload = buildUserPayload({
      name: 'Patient Chat History',
      email: `pat_chat_hist_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const patUser = await prisma.user.create({
      data: {
        name: patPayload.name,
        email: patPayload.email,
        phoneNo: patPayload.phoneNo,
        password: patPayload.password,
        age: 32,
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

    const p = await prisma.patient.create({
      data: {
        userId: patUser.id,
      },
    });
    patientId = p.id;

    // 3. Create DoctorPatientRelation
    const relation = await prisma.doctorPatientRelation.create({
      data: {
        doctorsUserId: docUserId,
        patientsUserId: patientUserId,
      },
    });
    relationId = relation.id;
  });

  afterAll(async () => {
    try {
      await prisma.chatMessages.deleteMany({
        where: { doctorPatientRelationId: relationId },
      });
      await prisma.doctorPatientRelation.deleteMany({
        where: { id: relationId },
      });
      await prisma.doctor.deleteMany({ where: { id: docId } });
      await prisma.patient.deleteMany({ where: { id: patientId } });
      await prisma.user.deleteMany({ where: { id: { in: [docUserId, patientUserId] } } });
    } catch (e) {
      console.warn('Phase 34 cleanup warning:', e);
    }
  });

  it('34.1 Returns 400 if relationId parameter is missing or empty', async () => {
    const req = new NextRequest('http://localhost:3000/api/doctorpatientrelations//chats');
    const res = await chatsGET(req, { params: Promise.resolve({ relationId: '' }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Missing relationId');
  });

  it('34.2 Returns 400 for invalid page or limit query parameters', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/doctorpatientrelations/${relationId}/chats?page=abc&limit=-1`
    );
    const res = await chatsGET(req, { params: Promise.resolve({ relationId }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('must be positive integers');
  });

  it('34.3 Returns 400 if limit exceeds maximum threshold (100)', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/doctorpatientrelations/${relationId}/chats?page=1&limit=150`
    );
    const res = await chatsGET(req, { params: Promise.resolve({ relationId }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('limit cannot exceed 100');
  });

  it('34.4 Returns 404 when querying chats for non-existent relationId', async () => {
    const req = new NextRequest('http://localhost:3000/api/doctorpatientrelations/non_existent_relation/chats');
    const res = await chatsGET(req, { params: Promise.resolve({ relationId: 'non_existent_relation' }) });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe('Relation not found');
  });

  it('34.5 GET returns empty chat list with pagination metadata when no messages exist', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctorpatientrelations/${relationId}/chats?page=1&limit=20`);
    const res = await chatsGET(req, { params: Promise.resolve({ relationId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.chats).toEqual([]);
    expect(data.pagination.currentPage).toBe(1);
    expect(data.pagination.totalMessages).toBe(0);
    expect(data.pagination.totalPages).toBe(1);
    expect(data.pagination.hasNextPage).toBe(false);
    expect(data.pagination.hasPreviousPage).toBe(false);
  });

  it('34.6 POST creates chat messages successfully with 201 Created', async () => {
    const postReq1 = new NextRequest(
      `http://localhost:3000/api/doctorpatientrelations/${relationId}/chats`,
      {
        method: 'POST',
        body: JSON.stringify({
          text: 'Hello Doctor, I have a question about my medication.',
          senderId: patientUserId,
        }),
      }
    );
    const res1 = await chatsPOST(postReq1, { params: Promise.resolve({ relationId }) });
    expect(res1.status).toBe(201);
    const data1 = await res1.json();
    expect(data1.chat.text).toBe('Hello Doctor, I have a question about my medication.');
    expect(data1.chat.senderId).toBe(patientUserId);

    const postReq2 = new NextRequest(
      `http://localhost:3000/api/doctorpatientrelations/${relationId}/chats`,
      {
        method: 'POST',
        body: JSON.stringify({
          text: 'Sure, please let me know what dosage you are taking.',
          senderId: docUserId,
        }),
      }
    );
    const res2 = await chatsPOST(postReq2, { params: Promise.resolve({ relationId }) });
    expect(res2.status).toBe(201);
    const data2 = await res2.json();
    expect(data2.chat.text).toBe('Sure, please let me know what dosage you are taking.');
    expect(data2.chat.senderId).toBe(docUserId);
  });

  it('34.7 POST rejects empty message or missing senderId with 400', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/doctorpatientrelations/${relationId}/chats`,
      {
        method: 'POST',
        body: JSON.stringify({
          text: '   ',
          senderId: patientUserId,
        }),
      }
    );
    const res = await chatsPOST(req, { params: Promise.resolve({ relationId }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/message and senderId are required/i);
  });

  it('34.8 POST rejects message creation for non-existent relationId with 404', async () => {
    const req = new NextRequest(
      'http://localhost:3000/api/doctorpatientrelations/non_existent_rel/chats',
      {
        method: 'POST',
        body: JSON.stringify({
          text: 'Hello',
          senderId: patientUserId,
        }),
      }
    );
    const res = await chatsPOST(req, { params: Promise.resolve({ relationId: 'non_existent_rel' }) });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe('Relation not found');
  });

  it('34.9 GET returns paginated messages with chronological ordering and pagination controls', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctorpatientrelations/${relationId}/chats?page=1&limit=1`);
    const res = await chatsGET(req, { params: Promise.resolve({ relationId }) });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.chats.length).toBe(1);
    expect(data.chats[0].text).toBe('Hello Doctor, I have a question about my medication.');
    expect(data.pagination.currentPage).toBe(1);
    expect(data.pagination.pageSize).toBe(1);
    expect(data.pagination.totalMessages).toBe(2);
    expect(data.pagination.totalPages).toBe(2);
    expect(data.pagination.hasNextPage).toBe(true);
    expect(data.pagination.hasPreviousPage).toBe(false);

    // Page 2
    const reqPage2 = new NextRequest(`http://localhost:3000/api/doctorpatientrelations/${relationId}/chats?page=2&limit=1`);
    const resPage2 = await chatsGET(reqPage2, { params: Promise.resolve({ relationId }) });
    expect(resPage2.status).toBe(200);
    const dataPage2 = await resPage2.json();

    expect(dataPage2.chats.length).toBe(1);
    expect(dataPage2.chats[0].text).toBe('Sure, please let me know what dosage you are taking.');
    expect(dataPage2.pagination.currentPage).toBe(2);
    expect(dataPage2.pagination.hasNextPage).toBe(false);
    expect(dataPage2.pagination.hasPreviousPage).toBe(true);
  });
});
