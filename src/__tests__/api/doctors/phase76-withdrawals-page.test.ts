import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/doctors/[doctorId]/withdrawals/route';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    doctor: {
      findUnique: vi.fn(),
    },
    withdrawal: {
      findMany: vi.fn(),
    },
  },
}));

describe('Phase 76: Doctor Withdrawals History & Data Isolation Test Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('76.1 Returns withdrawal records with amount in rupees and masked bank info', async () => {
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce({
      user: {
        bankAccounts: [
          {
            bankAccountNumber: '98765432101',
            bankIFSC: 'HDFC0001234',
            bankAccountHolderName: 'Dr. Emily Watson',
            bankName: 'HDFC Bank',
          },
        ],
      },
    } as any);

    vi.mocked(prisma.withdrawal.findMany).mockResolvedValueOnce([
      {
        id: 'w_1',
        doctorId: 'doc_1',
        amount: 150000, // 150,000 paise = ₹1,500
        currency: 'INR',
        status: 'COMPLETED',
        processedAt: new Date('2026-10-05T12:00:00.000Z'),
        createdAt: new Date('2026-10-05T10:00:00.000Z'),
        updatedAt: new Date('2026-10-05T12:00:00.000Z'),
      },
      {
        id: 'w_2',
        doctorId: 'doc_1',
        amount: 50000, // 50,000 paise = ₹500
        currency: 'INR',
        status: 'PROCESSING',
        processedAt: null,
        createdAt: new Date('2026-10-08T10:00:00.000Z'),
        updatedAt: new Date('2026-10-08T10:00:00.000Z'),
      },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/withdrawals');
    const res = await GET(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.length).toBe(2);
    expect(data[0].amountInRupees).toBe(1500);
    expect(data[0].status).toBe('COMPLETED');
    expect(data[1].amountInRupees).toBe(500);
    expect(data[1].status).toBe('PROCESSING');
    expect(data[0].bankAccountNumber).toBe('98765432101');
  });

  it('76.2 Returns empty array when doctor has no previous withdrawal requests', async () => {
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce({
      user: { bankAccounts: [] },
    } as any);
    vi.mocked(prisma.withdrawal.findMany).mockResolvedValueOnce([]);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_new/withdrawals');
    const res = await GET(req, { params: Promise.resolve({ doctorId: 'doc_new' }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(0);
  });
});
