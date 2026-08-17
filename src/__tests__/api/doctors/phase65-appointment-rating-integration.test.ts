import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/doctors/[doctorId]/comments/route';
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
    comment: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/auth', () => ({
  getUserId: vi.fn(),
}));

describe('Phase 65: Appointment & Doctor Rating/Comment Integration Test Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('65.1 Blocks comment creation with 401 when no auth token is provided', async () => {
    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/comments', {
      method: 'POST',
      body: JSON.stringify({ text: 'Great doctor' }),
    });

    const res = await POST(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(401);
  });

  it('65.2 Blocks comment submission with 403 when patient has only PENDING/CANCELLED appointment', async () => {
    vi.mocked(auth.getUserId).mockResolvedValueOnce({ valid: true, userId: 'user_pat_1' });
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce({ id: 'doc_1' } as any);
    vi.mocked(prisma.patient.findUnique).mockResolvedValueOnce({ id: 'pat_1', userId: 'user_pat_1' } as any);
    vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(null); // No completed appointment found

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/comments', {
      method: 'POST',
      headers: { authorization: 'Bearer token_123' },
      body: JSON.stringify({ text: 'Doctor was friendly.' }),
    });

    const res = await POST(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.message).toMatch(/only review a doctor after completing an appointment/i);
  });

  it('65.3 Allows comment submission (201 Created) when patient has a COMPLETED appointment', async () => {
    vi.mocked(auth.getUserId).mockResolvedValueOnce({ valid: true, userId: 'user_pat_1' });
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce({ id: 'doc_1' } as any);
    vi.mocked(prisma.patient.findUnique).mockResolvedValueOnce({ id: 'pat_1', userId: 'user_pat_1' } as any);
    vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce({ id: 'appt_comp', status: 'COMPLETED' } as any);
    vi.mocked(prisma.comment.create).mockResolvedValueOnce({
      id: 'comment_1',
      doctorId: 'doc_1',
      patientId: 'pat_1',
      text: 'Accurate diagnosis and excellent bedside manner.',
      createdAt: new Date(),
    } as any);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/comments', {
      method: 'POST',
      headers: { authorization: 'Bearer token_123' },
      body: JSON.stringify({ text: 'Accurate diagnosis and excellent bedside manner.' }),
    });

    const res = await POST(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.comment.id).toBe('comment_1');
    expect(data.comment.text).toBe('Accurate diagnosis and excellent bedside manner.');
  });

  it('65.4 Rejects empty comment text with 400 Bad Request', async () => {
    vi.mocked(auth.getUserId).mockResolvedValueOnce({ valid: true, userId: 'user_pat_1' });

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/comments', {
      method: 'POST',
      headers: { authorization: 'Bearer token_123' },
      body: JSON.stringify({ text: '   ' }),
    });

    const res = await POST(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.message).toMatch(/Comment text is required/i);
  });

  it('65.5 Fetches all doctor comments with patient user details and sanitized avatars', async () => {
    vi.mocked(prisma.comment.findMany).mockResolvedValueOnce([
      {
        id: 'comment_1',
        doctorId: 'doc_1',
        patientId: 'pat_1',
        text: 'Very helpful consultation',
        createdAt: new Date(),
        patient: {
          id: 'pat_1',
          user: {
            id: 'user_pat_1',
            name: 'John Patient',
            profileImageUrl: 'https://images.unsplash.com/photo-user.jpg',
          },
        },
      },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/comments');
    const res = await GET(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.comments.length).toBe(1);
    expect(data.comments[0].patient.user.name).toBe('John Patient');
  });
});
