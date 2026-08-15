import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, GET } from '@/app/api/doctors/[doctorId]/comments/route';
import { prisma } from '@/lib/prisma';
import { createToken } from '@/lib/auth';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    comment: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    doctor: {
      findUnique: vi.fn(),
    },
    patient: {
      findUnique: vi.fn(),
    },
    appointment: {
      findFirst: vi.fn(),
    },
  },
}));

describe('Doctor Comments Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET returns comments for doctor', async () => {
    vi.mocked(prisma.comment.findMany).mockResolvedValueOnce([
      {
        id: 'c_1',
        text: 'Great consultation',
        patient: {
          user: { id: 'u_1', name: 'Alice', profileImageUrl: null },
        },
      },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/comments');
    const res = await GET(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.comments.length).toBe(1);
    expect(data.comments[0].text).toBe('Great consultation');
  });

  it('POST rejects comment if patient has no completed appointment with doctor', async () => {
    const token = await createToken({ id: 'u_patient' });
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce({ id: 'doc_1' } as any);
    vi.mocked(prisma.patient.findUnique).mockResolvedValueOnce({ id: 'pat_1', userId: 'u_patient' } as any);
    vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(null);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/comments', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ text: 'Very helpful doctor' }),
    });

    const res = await POST(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.message).toMatch(/only review a doctor after completing an appointment/i);
  });

  it('POST creates comment for patient with completed appointment', async () => {
    const token = await createToken({ id: 'u_patient' });
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce({ id: 'doc_1' } as any);
    vi.mocked(prisma.patient.findUnique).mockResolvedValueOnce({ id: 'pat_1', userId: 'u_patient' } as any);
    vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce({ id: 'appt_1', status: 'COMPLETED' } as any);
    vi.mocked(prisma.comment.create).mockResolvedValueOnce({
      id: 'c_1',
      text: 'Very helpful doctor',
      doctorId: 'doc_1',
      patientId: 'pat_1',
    } as any);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/comments', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ text: 'Very helpful doctor' }),
    });

    const res = await POST(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.comment.text).toBe('Very helpful doctor');
  });
});
