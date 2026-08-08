import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PATCH } from '@/app/api/doctors/[doctorId]/bank-details/route';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    doctor: {
      findUnique: vi.fn(),
    },
    bankAccount: {
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  },
}));

describe('Doctor Bank Details Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET returns 404 if doctor not found', async () => {
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(null);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/bank-details');
    const res = await GET(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(404);
  });

  it('PATCH validates IFSC code and account number format', async () => {
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce({ userId: 'u_doc' } as any);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/bank-details', {
      method: 'PATCH',
      body: JSON.stringify({
        bankAccountNumber: '123456789',
        bankIFSC: 'INVALID_IFSC',
        bankAccountHolderName: 'Dr John',
        bankName: 'HDFC Bank',
      }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/Invalid IFSC/i);
  });

  it('PATCH creates or updates bank details successfully', async () => {
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce({ userId: 'u_doc' } as any);
    vi.mocked(prisma.bankAccount.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.bankAccount.create).mockResolvedValueOnce({
      id: 'ba_1',
      userId: 'u_doc',
      bankAccountNumber: '12345678901',
      bankIFSC: 'HDFC0001234',
      bankAccountHolderName: 'Dr John',
      bankName: 'HDFC Bank',
    } as any);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/bank-details', {
      method: 'PATCH',
      body: JSON.stringify({
        bankAccountNumber: '12345678901',
        bankIFSC: 'HDFC0001234',
        bankAccountHolderName: 'Dr John',
        bankName: 'HDFC Bank',
      }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.bankDetails.bankIFSC).toBe('HDFC0001234');
  });
});
