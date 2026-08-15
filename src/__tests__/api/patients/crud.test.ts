import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST, PATCH } from '@/app/api/patients/route';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    patient: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    appointment: {
      findMany: vi.fn(),
    },
  },
}));

describe('Patients API CRUD & Filters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST creates patient medical profile', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: 'u_1' } as any);
    vi.mocked(prisma.patient.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.patient.create).mockResolvedValueOnce({
      id: 'pat_1',
      userId: 'u_1',
      medicalHistory: 'Asthma',
      allergies: 'Dust',
      currentMedications: 'Inhaler',
    } as any);

    const req = new NextRequest('http://localhost:3000/api/patients', {
      method: 'POST',
      body: JSON.stringify({
        userId: 'u_1',
        medicalHistory: 'Asthma',
        allergies: 'Dust',
        currentMedications: 'Inhaler',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.patient.id).toBe('pat_1');
  });

  it('GET lists unique patients for a doctor with medical details', async () => {
    vi.mocked(prisma.appointment.findMany).mockResolvedValueOnce([
      { patientId: 'pat_1' },
      { patientId: 'pat_1' }, // duplicate check
    ] as any);

    vi.mocked(prisma.patient.findMany).mockResolvedValueOnce([
      {
        id: 'pat_1',
        medicalHistory: 'Asthma',
        allergies: 'Dust',
        currentMedications: 'Inhaler',
        user: {
          id: 'u_1',
          name: 'Bob',
          email: 'bob@example.com',
          age: 30,
          gender: 'MALE',
          phoneNo: '9876543210',
          location: { city: 'Pune', state: 'Maharashtra' },
        },
      },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/patients?doctorId=doc_1');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].name).toBe('Bob');
    expect(data[0].medicalHistory).toBe('Asthma');
  });

  it('GET filters patients by minAge and maxAge range', async () => {
    vi.mocked(prisma.appointment.findMany).mockResolvedValueOnce([
      { patientId: 'pat_1' },
    ] as any);

    vi.mocked(prisma.patient.findMany).mockResolvedValueOnce([
      {
        id: 'pat_1',
        user: {
          id: 'u_1',
          name: 'Alice',
          email: 'alice@example.com',
          age: 28,
          gender: 'FEMALE',
          phoneNo: '9876543210',
          location: { city: 'Delhi', state: 'Delhi' },
        },
      },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/patients?doctorId=doc_1&minAge=20&maxAge=35');
    const res = await GET(req);
    expect(res.status).toBe(200);

    expect(prisma.patient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user: expect.objectContaining({
            age: { gte: 20, lte: 35 },
          }),
        }),
      })
    );
  });

  it('GET filters patients by minAge only', async () => {
    vi.mocked(prisma.appointment.findMany).mockResolvedValueOnce([
      { patientId: 'pat_1' },
    ] as any);

    vi.mocked(prisma.patient.findMany).mockResolvedValueOnce([
      {
        id: 'pat_1',
        user: {
          id: 'u_1',
          name: 'Charlie',
          email: 'charlie@example.com',
          age: 45,
          gender: 'MALE',
        },
      },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/patients?doctorId=doc_1&minAge=40');
    const res = await GET(req);
    expect(res.status).toBe(200);

    expect(prisma.patient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user: expect.objectContaining({
            age: { gte: 40 },
          }),
        }),
      })
    );
  });

  it('GET filters patients by maxAge only', async () => {
    vi.mocked(prisma.appointment.findMany).mockResolvedValueOnce([
      { patientId: 'pat_1' },
    ] as any);

    vi.mocked(prisma.patient.findMany).mockResolvedValueOnce([]);

    const req = new NextRequest('http://localhost:3000/api/patients?doctorId=doc_1&maxAge=60');
    const res = await GET(req);
    expect(res.status).toBe(200);

    expect(prisma.patient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user: expect.objectContaining({
            age: { lte: 60 },
          }),
        }),
      })
    );
  });

  it('PATCH updates patient medical history', async () => {
    vi.mocked(prisma.patient.findUnique).mockResolvedValueOnce({
      id: 'pat_1',
      medicalHistory: 'Asthma',
      allergies: 'Dust',
      currentMedications: 'Inhaler',
    } as any);

    vi.mocked(prisma.patient.update).mockResolvedValueOnce({
      id: 'pat_1',
      medicalHistory: 'Asthma, Hypertension',
      allergies: 'Dust',
      currentMedications: 'Inhaler, Amlodipine',
    } as any);

    const req = new NextRequest('http://localhost:3000/api/patients', {
      method: 'PATCH',
      body: JSON.stringify({
        patientId: 'pat_1',
        medicalHistory: 'Asthma, Hypertension',
        currentMedications: 'Inhaler, Amlodipine',
      }),
    });

    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.patient.medicalHistory).toBe('Asthma, Hypertension');
  });
});
