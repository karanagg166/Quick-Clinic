import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, GET } from '@/app/api/doctors/[doctorId]/rating/route';
import { prisma } from '@/lib/prisma';
import { createToken } from '@/lib/auth';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    rating: {
      aggregate: vi.fn(),
      upsert: vi.fn(),
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

describe('Doctor Rating Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET returns average rating and total reviews count', async () => {
    vi.mocked(prisma.rating.aggregate).mockResolvedValueOnce({
      _avg: { rating: 4.5 },
      _count: { rating: 12 },
    } as any);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/rating');
    const res = await GET(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.average).toBe(4.5);
    expect(data.count).toBe(12);
  });

  it('POST rejects unauthorized requests without valid token', async () => {
    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/rating', {
      method: 'POST',
      body: JSON.stringify({ rating: 5 }),
    });

    const res = await POST(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(401);
  });

  it('POST rejects rating outside 1 to 5 range', async () => {
    const token = await createToken({ id: 'u_patient' });
    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/rating', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ rating: 10 }),
    });

    const res = await POST(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.message).toMatch(/Rating must be between 1 and 5/i);
  });

  it('POST rejects rating if patient has no completed appointment with doctor', async () => {
    const token = await createToken({ id: 'u_patient' });
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce({ id: 'doc_1' } as any);
    vi.mocked(prisma.patient.findUnique).mockResolvedValueOnce({ id: 'pat_1', userId: 'u_patient' } as any);
    vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(null);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/rating', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ rating: 5 }),
    });

    const res = await POST(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.message).toMatch(/only rate a doctor after completing an appointment/i);
  });

  it('POST upserts rating for patient with completed appointment and returns aggregate', async () => {
    const token = await createToken({ id: 'u_patient' });
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce({ id: 'doc_1' } as any);
    vi.mocked(prisma.patient.findUnique).mockResolvedValueOnce({ id: 'pat_1', userId: 'u_patient' } as any);
    vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce({ id: 'appt_1', status: 'COMPLETED' } as any);
    vi.mocked(prisma.rating.upsert).mockResolvedValueOnce({} as any);
    vi.mocked(prisma.rating.aggregate).mockResolvedValueOnce({
      _avg: { rating: 4.8 },
      _count: { rating: 5 },
    } as any);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/rating', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ rating: 5 }),
    });

    const res = await POST(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.rating.average).toBe(4.8);
    expect(data.rating.count).toBe(5);
  });
});
