import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/doctors/[doctorId]/balance/route';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    doctor: {
      findUnique: vi.fn(),
    },
  },
}));

describe('Doctor Balance Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns zero balance gracefully if doctor not found', async () => {
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(null);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/balance');
    const res = await GET(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.balance).toBe(0);
    expect(data.balanceInRupees).toBe(0);
  });

  it('returns balance in paise and rupees when doctor exists', async () => {
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce({
      balance: 150000, // 1500 INR in paise
      fees: 500,
    } as any);

    const req = new NextRequest('http://localhost:3000/api/doctors/doc_1/balance');
    const res = await GET(req, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.balance).toBe(150000);
    expect(data.balanceInRupees).toBe(1500);
    expect(data.fees).toBe(500);
  });
});
