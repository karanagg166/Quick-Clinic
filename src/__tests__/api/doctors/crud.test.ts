import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/doctors/route';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    doctor: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

describe('Doctors API CRUD & Filters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET filters doctors by specialty, city, and min/max fees', async () => {
    vi.mocked(prisma.doctor.findMany).mockResolvedValueOnce([
      {
        id: 'doc_1',
        specialty: 'CARDIOLOGIST',
        fees: 1000,
        experience: 12,
        doctorBio: 'Senior Cardiologist',
        doctorQualifications: [{ qualification: 'MBBS' }, { qualification: 'MD' }],
        user: {
          name: 'Dr. Mehta',
          gender: 'MALE',
          age: 45,
          profileImageUrl: null,
          location: { city: 'Mumbai', state: 'Maharashtra' },
        },
      },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/doctors?specialty=CARDIOLOGIST&city=Mumbai&minFees=500&maxFees=1500');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].specialty).toBe('CARDIOLOGIST');
    expect(data[0].city).toBe('Mumbai');
    expect(data[0].qualifications).toEqual(['MBBS', 'MD']);
  });

  it('POST creates doctor profile with qualifications', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: 'u_1' } as any);
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.doctor.create).mockResolvedValueOnce({
      id: 'doc_new',
      userId: 'u_1',
      specialty: 'NEUROLOGIST',
      fees: 1200,
      experience: 8,
      doctorQualifications: [{ qualification: 'MBBS' }, { qualification: 'DM' }],
    } as any);

    const req = new NextRequest('http://localhost:3000/api/doctors', {
      method: 'POST',
      body: JSON.stringify({
        userId: 'u_1',
        specialty: 'NEUROLOGIST',
        fees: 1200,
        experience: 8,
        qualifications: ['MBBS', 'DM'],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.doctor.id).toBe('doc_new');
  });
});
