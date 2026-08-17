import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getRatingGET, POST as postRatingPOST } from '@/app/api/doctors/[doctorId]/rating/route';
import { GET as getDoctorGET } from '@/app/api/doctors/[doctorId]/route';
import { prisma } from '@/lib/prisma';
import * as auth from '@/lib/auth';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    doctor: {
      findUnique: vi.fn(),
    },
    patient: {
      findUnique: vi.fn(),
    },
    appointment: {
      findFirst: vi.fn(),
    },
    rating: {
      aggregate: vi.fn(),
      upsert: vi.fn(),
    },
    comment: {
      findMany: vi.fn(),
    },
    accessLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/auth', () => ({
  getUserId: vi.fn(),
  verifyToken: vi.fn(),
}));

describe('Phase 62: Doctor Rating and Search Integration Test Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('62.1 Returns average: 0 and count: 0 for an unrated doctor', async () => {
    vi.mocked(prisma.rating.aggregate).mockResolvedValueOnce({
      _avg: { rating: null },
      _count: { rating: 0 },
    } as any);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_unrated/rating');
    const res = await getRatingGET(req, { params: Promise.resolve({ doctorId: 'doc_unrated' }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.average).toBe(0);
    expect(data.count).toBe(0);
  });

  it('62.2 Computes average rating to 1 decimal place with total count accurately', async () => {
    vi.mocked(prisma.rating.aggregate).mockResolvedValueOnce({
      _avg: { rating: 4.66666666 },
      _count: { rating: 15 },
    } as any);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_top_rated/rating');
    const res = await getRatingGET(req, { params: Promise.resolve({ doctorId: 'doc_top_rated' }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.average).toBe(4.7);
    expect(data.count).toBe(15);
  });

  it('62.3 Rejects rating submission when rating value is out of 1-5 range', async () => {
    vi.mocked(auth.getUserId).mockResolvedValueOnce({ valid: true, userId: 'user_pat_1' });

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/rating', {
      method: 'POST',
      headers: { authorization: 'Bearer valid_token' },
      body: JSON.stringify({ rating: 6 }),
    });

    const res = await postRatingPOST(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.message).toMatch(/Rating must be between 1 and 5/i);
  });

  it('62.4 Rejects rating submission when patient has no completed appointment with doctor (403 Forbidden)', async () => {
    vi.mocked(auth.getUserId).mockResolvedValueOnce({ valid: true, userId: 'user_pat_1' });
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce({ id: 'doc_1' } as any);
    vi.mocked(prisma.patient.findUnique).mockResolvedValueOnce({ id: 'pat_1', userId: 'user_pat_1' } as any);
    vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(null); // No completed appointment

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/rating', {
      method: 'POST',
      headers: { authorization: 'Bearer valid_token' },
      body: JSON.stringify({ rating: 5 }),
    });

    const res = await postRatingPOST(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(403);

    const data = await res.json();
    expect(data.message).toMatch(/only rate a doctor after completing an appointment/i);
  });

  it('62.5 Upserts rating when patient has completed appointment and returns updated aggregate', async () => {
    vi.mocked(auth.getUserId).mockResolvedValueOnce({ valid: true, userId: 'user_pat_1' });
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce({ id: 'doc_1' } as any);
    vi.mocked(prisma.patient.findUnique).mockResolvedValueOnce({ id: 'pat_1', userId: 'user_pat_1' } as any);
    vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce({ id: 'appt_1', status: 'COMPLETED' } as any);
    vi.mocked(prisma.rating.upsert).mockResolvedValueOnce({} as any);
    vi.mocked(prisma.rating.aggregate).mockResolvedValueOnce({
      _avg: { rating: 5.0 },
      _count: { rating: 1 },
    } as any);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/rating', {
      method: 'POST',
      headers: { authorization: 'Bearer valid_token' },
      body: JSON.stringify({ rating: 5 }),
    });

    const res = await postRatingPOST(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(200);

    expect(prisma.rating.upsert).toHaveBeenCalledWith({
      where: {
        doctorId_patientId: {
          doctorId: 'doc_1',
          patientId: 'pat_1',
        },
      },
      update: { rating: 5 },
      create: {
        doctorId: 'doc_1',
        patientId: 'pat_1',
        rating: 5,
      },
    });

    const data = await res.json();
    expect(data.rating.average).toBe(5.0);
    expect(data.rating.count).toBe(1);
  });
});
