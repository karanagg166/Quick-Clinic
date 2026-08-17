import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/doctors/route';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    doctor: {
      findMany: vi.fn(),
    },
  },
}));

describe('Phase 61: Doctor Search Edge Cases & Robustness Test Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('61.1 Searches doctor by name with case-insensitivity and whitespace trimming', async () => {
    vi.mocked(prisma.doctor.findMany).mockResolvedValueOnce([
      {
        id: 'doc_1',
        specialty: 'CARDIOLOGIST',
        experience: 12,
        fees: 800,
        doctorBio: 'Expert cardiologist',
        user: {
          name: 'Dr. Sarah Smith',
          gender: 'FEMALE',
          age: 42,
          profileImageUrl: null,
          location: { city: 'Faridabad', state: 'Haryana' },
        },
        doctorQualifications: [{ qualification: 'MBBS' }, { qualification: 'MD' }],
      },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/doctors?name=%20%20sArAh%20%20');
    const res = await GET(req);
    expect(res.status).toBe(200);

    expect(prisma.doctor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user: expect.objectContaining({
            name: {
              contains: 'sArAh',
              mode: 'insensitive',
            },
          }),
        }),
      })
    );

    const data = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].name).toBe('Dr. Sarah Smith');
    expect(data[0].qualifications).toEqual(['MBBS', 'MD']);
  });

  it('61.2 Searches doctor with partial name containing hyphens or dots', async () => {
    vi.mocked(prisma.doctor.findMany).mockResolvedValueOnce([
      {
        id: 'doc_2',
        specialty: 'DERMATOLOGIST',
        experience: 8,
        fees: 600,
        doctorBio: 'Skin specialist',
        user: {
          name: 'Dr. Anne-Marie O\'Connor',
          gender: 'FEMALE',
          age: 38,
          profileImageUrl: null,
          location: { city: 'Gurgaon', state: 'Haryana' },
        },
        doctorQualifications: [{ qualification: 'MBBS' }],
      },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/doctors?name=Anne-Marie');
    const res = await GET(req);
    expect(res.status).toBe(200);

    expect(prisma.doctor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user: expect.objectContaining({
            name: {
              contains: 'Anne-Marie',
              mode: 'insensitive',
            },
          }),
        }),
      })
    );
  });

  it('61.3 Returns empty array with 200 OK when no doctors match the search criteria', async () => {
    vi.mocked(prisma.doctor.findMany).mockResolvedValueOnce([]);

    const req = new NextRequest('http://localhost:3000/api/doctors?name=NonExistentDoctorXYZ&specialty=CARDIOLOGIST');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(0);
  });

  it('61.4 Handles city and state search with leading/trailing spaces and case-insensitivity', async () => {
    vi.mocked(prisma.doctor.findMany).mockResolvedValueOnce([]);

    const req = new NextRequest('http://localhost:3000/api/doctors?city=%20%20DeLhI%20%20&state=%20NCR%20');
    const res = await GET(req);
    expect(res.status).toBe(200);

    expect(prisma.doctor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user: expect.objectContaining({
            location: {
              city: { contains: 'DeLhI', mode: 'insensitive' },
              state: { contains: 'NCR', mode: 'insensitive' },
            },
          }),
        }),
      })
    );
  });

  it('61.5 Rejects invalid coordinate boundaries with 400 Bad Request', async () => {
    const invalidLatReq = new NextRequest('http://localhost:3000/api/doctors?lat=95.0&lng=77.0');
    const res1 = await GET(invalidLatReq);
    expect(res1.status).toBe(400);

    const invalidLngReq = new NextRequest('http://localhost:3000/api/doctors?lat=28.0&lng=190.0');
    const res2 = await GET(invalidLngReq);
    expect(res2.status).toBe(400);
  });

  it('61.6 Parses numeric range filters (fees and experience) correctly', async () => {
    vi.mocked(prisma.doctor.findMany).mockResolvedValueOnce([]);

    const req = new NextRequest('http://localhost:3000/api/doctors?minFees=400&maxFees=1500&minExperience=5&maxExperience=20');
    const res = await GET(req);
    expect(res.status).toBe(200);

    expect(prisma.doctor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          fees: { gte: 400, lte: 1500 },
          experience: { gte: 5, lte: 20 },
        }),
      })
    );
  });
});
