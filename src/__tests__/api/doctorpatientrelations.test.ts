import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/doctorpatientrelations/route';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    doctorPatientRelation: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    doctor: {
      findUnique: vi.fn(),
    },
    patient: {
      findUnique: vi.fn(),
    },
  },
}));

describe('Doctor-Patient Relations Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET returns 400 if userId or role is missing', async () => {
    const req = new NextRequest('http://localhost:3000/api/doctorpatientrelations');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('GET lists relations for PATIENT with last message', async () => {
    vi.mocked(prisma.doctorPatientRelation.findMany).mockResolvedValueOnce([
      {
        id: 'rel_1',
        doctorsUserId: 'u_doc',
        patientsUserId: 'u_pat',
        doctor: { user: { name: 'Dr. John' } },
        patient: { user: { name: 'Alice' } },
        chatMessages: [{ text: 'See you tomorrow', createdAt: new Date() }],
        updatedAt: new Date(),
      },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/doctorpatientrelations?userId=u_pat&role=PATIENT');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.relations.length).toBe(1);
    expect(data.relations[0].doctorName).toBe('Dr. John');
    expect(data.relations[0].lastMessage).toBe('See you tomorrow');
  });

  it('POST creates or returns existing relation', async () => {
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce({ id: 'doc_1' } as any);
    vi.mocked(prisma.patient.findUnique).mockResolvedValueOnce({ id: 'pat_1' } as any);
    vi.mocked(prisma.doctorPatientRelation.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.doctorPatientRelation.create).mockResolvedValueOnce({
      id: 'rel_new',
      doctorsUserId: 'u_doc',
      patientsUserId: 'u_pat',
    } as any);

    const req = new NextRequest('http://localhost:3000/api/doctorpatientrelations', {
      method: 'POST',
      body: JSON.stringify({ doctorsUserId: 'u_doc', patientsUserId: 'u_pat' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.isNew).toBe(true);
  });
});
