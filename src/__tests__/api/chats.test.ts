import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/doctorpatientrelations/[relationId]/chats/route';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    doctorPatientRelation: {
      findUnique: vi.fn(),
    },
    chatMessages: {
      count: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

describe('Chat Messages Route API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/doctorpatientrelations/[relationId]/chats', () => {
    it('returns 400 if relationId is missing', async () => {
      const req = new NextRequest('http://localhost:3000/api/doctorpatientrelations//chats');
      const res = await GET(req, { params: Promise.resolve({ relationId: '' }) });
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid page or limit query parameters', async () => {
      const req = new NextRequest('http://localhost:3000/api/doctorpatientrelations/rel_1/chats?page=invalid&limit=-5');
      const res = await GET(req, { params: Promise.resolve({ relationId: 'rel_1' }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('must be positive integers');
    });

    it('returns 400 if limit exceeds 100', async () => {
      const req = new NextRequest('http://localhost:3000/api/doctorpatientrelations/rel_1/chats?page=1&limit=200');
      const res = await GET(req, { params: Promise.resolve({ relationId: 'rel_1' }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('limit cannot exceed 100');
    });

    it('returns 404 when doctor-patient relation is not found', async () => {
      vi.mocked(prisma.doctorPatientRelation.findUnique).mockResolvedValueOnce(null);

      const req = new NextRequest('http://localhost:3000/api/doctorpatientrelations/non_existent/chats');
      const res = await GET(req, { params: Promise.resolve({ relationId: 'non_existent' }) });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('Relation not found');
    });

    it('returns paginated chat messages for valid relation', async () => {
      vi.mocked(prisma.doctorPatientRelation.findUnique).mockResolvedValueOnce({
        id: 'rel_1',
      } as any);

      vi.mocked(prisma.chatMessages.count).mockResolvedValueOnce(25);
      vi.mocked(prisma.chatMessages.findMany).mockResolvedValueOnce([
        { id: 'm1', text: 'Hello doctor', senderId: 'u_pat', createdAt: new Date() },
        { id: 'm2', text: 'Hello, how can I help?', senderId: 'u_doc', createdAt: new Date() },
      ] as any);

      const req = new NextRequest('http://localhost:3000/api/doctorpatientrelations/rel_1/chats?page=1&limit=10');
      const res = await GET(req, { params: Promise.resolve({ relationId: 'rel_1' }) });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.chats.length).toBe(2);
      expect(data.pagination.totalMessages).toBe(25);
      expect(data.pagination.totalPages).toBe(3);
      expect(data.pagination.hasNextPage).toBe(true);
      expect(data.pagination.hasPreviousPage).toBe(false);
    });
  });

  describe('POST /api/doctorpatientrelations/[relationId]/chats', () => {
    it('returns 400 when text or senderId is missing', async () => {
      const req = new NextRequest('http://localhost:3000/api/doctorpatientrelations/rel_1/chats', {
        method: 'POST',
        body: JSON.stringify({ message: '' }),
      });

      const res = await POST(req, { params: Promise.resolve({ relationId: 'rel_1' }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('message and senderId are required');
    });

    it('returns 404 when relation does not exist', async () => {
      vi.mocked(prisma.doctorPatientRelation.findUnique).mockResolvedValueOnce(null);

      const req = new NextRequest('http://localhost:3000/api/doctorpatientrelations/rel_missing/chats', {
        method: 'POST',
        body: JSON.stringify({ text: 'Hello', senderId: 'u_1' }),
      });

      const res = await POST(req, { params: Promise.resolve({ relationId: 'rel_missing' }) });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('Relation not found');
    });

    it('creates and returns new chat message', async () => {
      vi.mocked(prisma.doctorPatientRelation.findUnique).mockResolvedValueOnce({
        id: 'rel_1',
      } as any);

      vi.mocked(prisma.chatMessages.create).mockResolvedValueOnce({
        id: 'm_new',
        doctorPatientRelationId: 'rel_1',
        text: 'Prescription sent',
        senderId: 'u_doc',
        createdAt: new Date(),
      } as any);

      const req = new NextRequest('http://localhost:3000/api/doctorpatientrelations/rel_1/chats', {
        method: 'POST',
        body: JSON.stringify({ text: 'Prescription sent', senderId: 'u_doc' }),
      });

      const res = await POST(req, { params: Promise.resolve({ relationId: 'rel_1' }) });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.chat.text).toBe('Prescription sent');
      expect(data.chat.id).toBe('m_new');
    });
  });
});
