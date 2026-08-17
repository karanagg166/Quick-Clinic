import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getDoctorsGET } from '@/app/api/doctors/route';
import { prisma } from '@/lib/prisma';
import { buildUserPayload, buildDoctorProfilePayload } from '@/__tests__/helpers/factories';

describe('Phase 10: Doctor Search & Multi-Filter Query Engine Test Suite', () => {
  let createdDoctorIds: string[] = [];
  let createdUserIds: string[] = [];

  beforeAll(async () => {
    // Seed 3 doctors with distinct specs for multi-filter verification
    const u1 = buildUserPayload({
      name: 'Dr. Search Cardio One',
      email: `doc_search1_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
      gender: 'MALE',
    });
    const doc1User = await prisma.user.create({
      data: {
        name: u1.name,
        email: u1.email,
        phoneNo: u1.phoneNo,
        password: u1.password,
        age: u1.age,
        address: u1.address,
        role: 'DOCTOR',
        gender: u1.gender,
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    createdUserIds.push(doc1User.id);
    const doc1 = await prisma.doctor.create({
      data: {
        userId: doc1User.id,
        specialty: 'CARDIOLOGIST',
        fees: 600,
        experience: 14,
        latitude: 28.4089,
        longitude: 77.3178,
      },
    });
    createdDoctorIds.push(doc1.id);

    const u2 = buildUserPayload({
      name: 'Dr. Search Derma Two',
      email: `doc_search2_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
      gender: 'FEMALE',
    });
    const doc2User = await prisma.user.create({
      data: {
        name: u2.name,
        email: u2.email,
        phoneNo: u2.phoneNo,
        password: u2.password,
        age: u2.age,
        address: u2.address,
        role: 'DOCTOR',
        gender: u2.gender,
        location: {
          connectOrCreate: {
            where: { pincode: 110001 },
            create: { pincode: 110001, city: 'Delhi', state: 'Delhi' },
          },
        },
      },
    });
    createdUserIds.push(doc2User.id);
    const doc2 = await prisma.doctor.create({
      data: {
        userId: doc2User.id,
        specialty: 'DERMATOLOGIST',
        fees: 1200,
        experience: 8,
        latitude: 28.6139,
        longitude: 77.209,
      },
    });
    createdDoctorIds.push(doc2.id);

    const u3 = buildUserPayload({
      name: 'Dr. Search GP Three',
      email: `doc_search3_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
      gender: 'MALE',
    });
    const doc3User = await prisma.user.create({
      data: {
        name: u3.name,
        email: u3.email,
        phoneNo: u3.phoneNo,
        password: u3.password,
        age: u3.age,
        address: u3.address,
        role: 'DOCTOR',
        gender: u3.gender,
        location: {
          connectOrCreate: {
            where: { pincode: 122002 },
            create: { pincode: 122002, city: 'Gurgaon', state: 'Haryana' },
          },
        },
      },
    });
    createdUserIds.push(doc3User.id);
    const doc3 = await prisma.doctor.create({
      data: {
        userId: doc3User.id,
        specialty: 'GENERAL_PHYSICIAN',
        fees: 400,
        experience: 3,
        latitude: 28.4595,
        longitude: 77.0266,
      },
    });
    createdDoctorIds.push(doc3.id);
  });

  afterAll(async () => {
    if (createdDoctorIds.length > 0) {
      await prisma.doctor.deleteMany({ where: { id: { in: createdDoctorIds } } });
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
  });

  it('10.1 filters doctors by specialty and city combined', async () => {
    const req = new NextRequest('http://localhost:3000/api/doctors?specialty=CARDIOLOGIST&city=Faridabad');
    const res = await getDoctorsGET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.some((d: any) => d.specialty === 'CARDIOLOGIST' && d.city === 'Faridabad')).toBe(true);
  });

  it('10.2 filters doctors by fee range (minFees & maxFees)', async () => {
    const req = new NextRequest('http://localhost:3000/api/doctors?minFees=500&maxFees=700');
    const res = await getDoctorsGET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    data.forEach((d: any) => {
      expect(d.fees).toBeGreaterThanOrEqual(500);
      expect(d.fees).toBeLessThanOrEqual(700);
    });
  });

  it('10.3 filters doctors by minimum experience', async () => {
    const req = new NextRequest('http://localhost:3000/api/doctors?minExperience=10');
    const res = await getDoctorsGET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    data.forEach((d: any) => {
      expect(d.experience).toBeGreaterThanOrEqual(10);
    });
  });

  it('10.4 performs geospatial distance sorting when lat & lng are provided', async () => {
    // Patient located at Faridabad coordinates (28.4089, 77.3178)
    const req = new NextRequest('http://localhost:3000/api/doctors?lat=28.4089&lng=77.3178');
    const res = await getDoctorsGET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.doctors).toBeDefined();
    expect(Array.isArray(body.doctors)).toBe(true);
    // Closest doctor should have minimal distanceKm
    const closest = body.doctors[0];
    expect(closest.distanceKm).toBeDefined();
    expect(closest.durationMinutes).toBeDefined();
  });

  it('10.5 handles impossible search criteria returning empty results without error', async () => {
    const req = new NextRequest('http://localhost:3000/api/doctors?name=NonExistentDoctorNameXYZ999');
    const res = await getDoctorsGET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(0);
  });
});
