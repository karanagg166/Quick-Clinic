import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as createDoctorPOST } from '@/app/api/doctors/route';
import { GET as getDoctorGET, PATCH as updateDoctorPATCH } from '@/app/api/doctors/[doctorId]/route';
import { prisma } from '@/lib/prisma';
import { buildUserPayload, buildDoctorProfilePayload } from '@/__tests__/helpers/factories';
import { createToken } from '@/lib/auth';

describe('Phase 8: Doctor Onboarding & Profile Lifecycle Test Suite', () => {
  let doctorUser: any;
  let doctorToken: string;

  beforeEach(async () => {
    const payload = buildUserPayload({ role: 'DOCTOR' });
    doctorUser = await prisma.user.create({
      data: {
        name: payload.name,
        email: payload.email,
        phoneNo: payload.phoneNo,
        password: payload.password,
        age: payload.age,
        address: payload.address,
        role: 'DOCTOR',
        gender: payload.gender,
        location: {
          connectOrCreate: {
            where: { pincode: payload.pinCode },
            create: {
              pincode: payload.pinCode,
              city: payload.city,
              state: payload.state,
            },
          },
        },
      },
    });
    doctorToken = await createToken({ id: doctorUser.id, email: doctorUser.email, role: 'DOCTOR', name: doctorUser.name });
  });

  afterAll(async () => {
    await prisma.doctorQualification.deleteMany({
      where: { doctor: { user: { email: { contains: '@quickclinic.test' } } } },
    });
    await prisma.doctor.deleteMany({
      where: { user: { email: { contains: '@quickclinic.test' } } },
    });
    await prisma.user.deleteMany({
      where: { email: { contains: '@quickclinic.test' } },
    });
  });

  it('8.1 creates doctor profile with specialties, qualifications, and coordinates', async () => {
    const docPayload = buildDoctorProfilePayload({
      userId: doctorUser.id,
      specialty: 'CARDIOLOGIST',
      fees: 800,
      experience: 12,
      qualifications: ['MBBS', 'MD'],
      latitude: 28.4089,
      longitude: 77.3178,
    });

    const req = new NextRequest('http://localhost:3000/api/doctors', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${doctorToken}`,
      },
      body: JSON.stringify(docPayload),
    });

    const res = await createDoctorPOST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.doctor.specialty).toBe('CARDIOLOGIST');
    expect(body.doctor.fees).toBe(800);
    expect(body.doctor.experience).toBe(12);
    expect(body.doctor.doctorQualifications).toHaveLength(2);
  });

  it('8.2 rejects creating duplicate doctor profile for the same user', async () => {
    const docPayload = buildDoctorProfilePayload({ userId: doctorUser.id });

    const req1 = new NextRequest('http://localhost:3000/api/doctors', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${doctorToken}`,
      },
      body: JSON.stringify(docPayload),
    });
    const res1 = await createDoctorPOST(req1);
    expect(res1.status).toBe(201);

    const req2 = new NextRequest('http://localhost:3000/api/doctors', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${doctorToken}`,
      },
      body: JSON.stringify(docPayload),
    });
    const res2 = await createDoctorPOST(req2);
    expect(res2.status).toBe(409);
  });

  it('8.3 rejects doctor creation with invalid coordinates', async () => {
    const docPayload = buildDoctorProfilePayload({
      userId: doctorUser.id,
      latitude: 195.0, // Invalid latitude (> 90)
      longitude: 77.3178,
    });

    const req = new NextRequest('http://localhost:3000/api/doctors', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${doctorToken}`,
      },
      body: JSON.stringify(docPayload),
    });

    const res = await createDoctorPOST(req);
    expect(res.status).toBe(400);
  });

  it('8.4 updates doctor profile and fetches updated profile by doctorId', async () => {
    const docPayload = buildDoctorProfilePayload({ userId: doctorUser.id });
    const createReq = new NextRequest('http://localhost:3000/api/doctors', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${doctorToken}`,
      },
      body: JSON.stringify(docPayload),
    });
    const createRes = await createDoctorPOST(createReq);
    const { doctor } = await createRes.json();

    const patchReq = new NextRequest(`http://localhost:3000/api/doctors/${doctor.id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${doctorToken}`,
      },
      body: JSON.stringify({ fees: 1000, experience: 15 }),
    });
    const patchRes = await updateDoctorPATCH(patchReq, { params: Promise.resolve({ doctorId: doctor.id }) });
    expect(patchRes.status).toBe(200);

    const getReq = new NextRequest(`http://localhost:3000/api/doctors/${doctor.id}`);
    const getRes = await getDoctorGET(getReq, { params: Promise.resolve({ doctorId: doctor.id }) });
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.doctor.fees).toBe(1000);
    expect(getBody.doctor.experience).toBe(15);
  });
});
