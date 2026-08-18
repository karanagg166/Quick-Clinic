import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/doctors/[doctorId]/withdrawals/route';
import { prisma } from '@/lib/prisma';
import { createToken } from '@/lib/auth';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn((cb: any) => cb({
      doctor: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      withdrawal: {
        create: vi.fn().mockResolvedValue({
          id: 'w_1',
          doctorId: 'doc_1',
          amount: 50000,
          currency: 'INR',
          status: 'PENDING',
        }),
      },
    })),
    doctor: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    withdrawal: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

describe('Doctor Withdrawals Route', () => {
  let docToken: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    docToken = await createToken({ id: 'user_doc_1', role: 'DOCTOR' });
  });

  it('GET returns withdrawals with rupees mapping and masked bank account number', async () => {
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce({
      id: 'doc_1',
      userId: 'user_doc_1',
      user: {
        bankAccounts: [
          {
            bankAccountNumber: '12345678901',
            bankIFSC: 'HDFC0001234',
            bankAccountHolderName: 'Dr John',
            bankName: 'HDFC Bank',
          },
        ],
      },
    } as any);

    vi.mocked(prisma.withdrawal.findMany).mockResolvedValueOnce([
      {
        id: 'w_1',
        amount: 50000,
        currency: 'INR',
        status: 'PENDING',
        razorpayPayoutId: null,
        failureReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        processedAt: null,
      },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/withdrawals', {
      headers: { authorization: `Bearer ${docToken}` },
    });
    const res = await GET(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].amountInRupees).toBe(500);
    expect(data[0].status).toBe('PENDING');
    expect(data[0].bankAccountNumber).toBe('********8901');
  });

  it('POST rejects when bank details are missing', async () => {
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce({
      id: 'doc_1',
      userId: 'user_doc_1',
      balance: 100000,
      user: { bankAccounts: [] },
    } as any);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/withdrawals', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${docToken}`,
      },
      body: JSON.stringify({ amount: 500 }),
    });

    const res = await POST(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/Bank details not set/i);
  });

  it('POST rejects when balance is insufficient', async () => {
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce({
      id: 'doc_1',
      userId: 'user_doc_1',
      balance: 10000, // 100 INR in paise
      user: {
        bankAccounts: [
          {
            bankAccountNumber: '12345678901',
            bankIFSC: 'HDFC0001234',
            bankAccountHolderName: 'Dr John',
            bankName: 'HDFC Bank',
          },
        ],
      },
    } as any);

    vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => {
      return cb({
        doctor: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        withdrawal: {
          create: vi.fn(),
        },
      });
    });

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/withdrawals', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${docToken}`,
      },
      body: JSON.stringify({ amount: 500 }), // 500 INR = 50000 paise
    });

    const res = await POST(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/Insufficient balance/i);
  });

  it('POST creates withdrawal in PENDING status, masks bank account and decrements balance immediately', async () => {
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce({
      id: 'doc_1',
      userId: 'user_doc_1',
      balance: 100000, // 1000 INR
      user: {
        bankAccounts: [
          {
            bankAccountNumber: '12345678901',
            bankIFSC: 'HDFC0001234',
            bankAccountHolderName: 'Dr John',
            bankName: 'HDFC Bank',
          },
        ],
      },
    } as any);

    const mockCreate = vi.fn().mockResolvedValue({
      id: 'w_1',
      doctorId: 'doc_1',
      amount: 50000,
      currency: 'INR',
      status: 'PENDING',
    });

    const mockUpdateMany = vi.fn().mockResolvedValue({ count: 1 });

    vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => {
      return cb({
        doctor: {
          updateMany: mockUpdateMany,
        },
        withdrawal: {
          create: mockCreate,
        },
      });
    });

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/withdrawals', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${docToken}`,
      },
      body: JSON.stringify({ amount: 500 }),
    });

    const res = await POST(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.withdrawal.status).toBe('PENDING');
    expect(data.withdrawal.bankAccountNumber).toBe('********8901');
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 'doc_1', balance: { gte: 50000 } },
      data: { balance: { decrement: 50000 } },
    });
  });
});
