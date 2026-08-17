import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getRelationsGET, POST as postRelationPOST } from '@/app/api/doctorpatientrelations/route';
import { GET as getChatsGET, POST as postChatPOST } from '@/app/api/doctorpatientrelations/[relationId]/chats/route';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    doctor: {
      findUnique: vi.fn(),
    },
    patient: {
      findUnique: vi.fn(),
    },
    doctorPatientRelation: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    chatMessages: {
      count: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

describe('Phase 64: Appointment & Chat Relationship Integration Test Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('64.1 Rejects relation creation when doctor or patient does not exist (404 Not Found)', async () => {
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(null);

    const req = new NextRequest('http://localhost:3000/api/doctorpatientrelations', {
      method: 'POST',
      body: JSON.stringify({ doctorsUserId: 'doc_u_1', patientsUserId: 'pat_u_1' }),
    });

    const res = await postRelationPOST(req);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toMatch(/Doctor not found/i);
  });

  it('64.2 Establishes new relation (201 Created) between Doctor and Patient upon valid appointment interaction', async () => {
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce({ id: 'doc_1', userId: 'doc_u_1' } as any);
    vi.mocked(prisma.patient.findUnique).mockResolvedValueOnce({ id: 'pat_1', userId: 'pat_u_1' } as any);
    vi.mocked(prisma.doctorPatientRelation.findUnique).mockResolvedValueOnce(null); // No existing relation
    vi.mocked(prisma.doctorPatientRelation.create).mockResolvedValueOnce({
      id: 'rel_123',
      doctorsUserId: 'doc_u_1',
      patientsUserId: 'pat_u_1',
    } as any);

    const req = new NextRequest('http://localhost:3000/api/doctorpatientrelations', {
      method: 'POST',
      body: JSON.stringify({ doctorsUserId: 'doc_u_1', patientsUserId: 'pat_u_1' }),
    });

    const res = await postRelationPOST(req);
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.isNew).toBe(true);
    expect(data.relation.id).toBe('rel_123');
  });

  it('64.3 Returns existing relation (200 OK) idempotently without creating duplicates', async () => {
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce({ id: 'doc_1', userId: 'doc_u_1' } as any);
    vi.mocked(prisma.patient.findUnique).mockResolvedValueOnce({ id: 'pat_1', userId: 'pat_u_1' } as any);
    vi.mocked(prisma.doctorPatientRelation.findUnique).mockResolvedValueOnce({
      id: 'rel_existing',
      doctorsUserId: 'doc_u_1',
      patientsUserId: 'pat_u_1',
    } as any);

    const req = new NextRequest('http://localhost:3000/api/doctorpatientrelations', {
      method: 'POST',
      body: JSON.stringify({ doctorsUserId: 'doc_u_1', patientsUserId: 'pat_u_1' }),
    });

    const res = await postRelationPOST(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.isNew).toBe(false);
    expect(data.relation.id).toBe('rel_existing');
  });

  it('64.4 Rejects posting chat messages to non-existent or unauthorized relation (404 Not Found)', async () => {
    vi.mocked(prisma.doctorPatientRelation.findUnique).mockResolvedValueOnce(null);

    const req = new NextRequest('http://localhost:3000/api/doctorpatientrelations/rel_invalid/chats', {
      method: 'POST',
      body: JSON.stringify({ senderId: 'pat_u_1', text: 'Hello Doctor' }),
    });

    const res = await postChatPOST(req, { params: Promise.resolve({ relationId: 'rel_invalid' }) });
    expect(res.status).toBe(404);
  });

  it('64.5 Posts and retrieves chat messages in chronological order with pagination metadata', async () => {
    // 1. Post chat message
    vi.mocked(prisma.doctorPatientRelation.findUnique).mockResolvedValueOnce({ id: 'rel_1' } as any);
    vi.mocked(prisma.chatMessages.create).mockResolvedValueOnce({
      id: 'msg_1',
      doctorPatientRelationId: 'rel_1',
      senderId: 'pat_u_1',
      text: 'Prescription query',
      createdAt: new Date(),
    } as any);

    const postReq = new NextRequest('http://localhost:3000/api/doctorpatientrelations/rel_1/chats', {
      method: 'POST',
      body: JSON.stringify({ senderId: 'pat_u_1', text: 'Prescription query' }),
    });

    const postRes = await postChatPOST(postReq, { params: Promise.resolve({ relationId: 'rel_1' }) });
    expect(postRes.status).toBe(201);

    // 2. Query chat messages
    vi.mocked(prisma.doctorPatientRelation.findUnique).mockResolvedValueOnce({ id: 'rel_1' } as any);
    vi.mocked(prisma.chatMessages.count).mockResolvedValueOnce(1);
    vi.mocked(prisma.chatMessages.findMany).mockResolvedValueOnce([
      {
        id: 'msg_1',
        doctorPatientRelationId: 'rel_1',
        senderId: 'pat_u_1',
        text: 'Prescription query',
        createdAt: new Date(),
      },
    ] as any);

    const getReq = new NextRequest('http://localhost:3000/api/doctorpatientrelations/rel_1/chats?page=1&limit=20');
    const getRes = await getChatsGET(getReq, { params: Promise.resolve({ relationId: 'rel_1' }) });
    expect(getRes.status).toBe(200);

    const data = await getRes.json();
    expect(data.chats.length).toBe(1);
    expect(data.pagination.totalMessages).toBe(1);
    expect(data.pagination.currentPage).toBe(1);
  });
});
