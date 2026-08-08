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

describe('Chat Messages Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET returns paginated chat messages', async () => {
    vi.mocked(prisma.doctorPatientRelation.findUnique).mockResolvedValueOnce({
      id: 'rel_1',
    } as any);

    vi.mocked(prisma.chatMessages.count).mockResolvedValueOnce(25);
    vi.mocked(prisma.chatMessages.findMany).mockResolvedValueOnce([
      { id: 'm1', text: 'Hello doctor', senderId: 'u_pat', createdAt: new Date() },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/doctorpatientrelations/rel_1/chats?page=1&limit=10');
    const res = await GET(req, { params: Promise.resolve({ relationId: 'rel_1' }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.chats.length).toBe(1);
    expect(data.pagination.totalMessages).toBe(25);
    expect(data.pagination.totalPages).toBe(3);
    expect(data.pagination.hasNextPage).toBe(true);
  });

  it('POST creates new chat message', async () => {
    vi.mocked(prisma.doctorPatientRelation.findUnique).mockResolvedValueOnce({
      id: 'rel_1',
    } as any);

    vi.mocked(prisma.chatMessages.create).mockResolvedValueOnce({
      id: 'm_new',
      doctorPatientRelationId: 'rel_1',
      text: 'Prescription sent',
      senderId: 'u_doc',
    } as any);

    const req = new NextRequest('http://localhost:3000/api/doctorpatientrelations/rel_1/chats', {
      method: 'POST',
      body: JSON.stringify({ message: 'Prescription sent', senderId: 'u_doc' }),
    });

    const res = await POST(req, { params: Promise.resolve({ relationId: 'rel_1' }) });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.chat.text).toBe('Prescription sent');
  });
});
