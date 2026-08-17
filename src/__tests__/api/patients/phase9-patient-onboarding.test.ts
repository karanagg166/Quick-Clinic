import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as createPatientPOST } from '@/app/api/patients/route';
import { GET as getPatientGET, PATCH as updatePatientPATCH } from '@/app/api/patients/[patientId]/route';
import { prisma } from '@/lib/prisma';
import { buildUserPayload, buildPatientProfilePayload } from '@/__tests__/helpers/factories';

describe('Phase 9: Patient Onboarding & Profile Lifecycle Test Suite', () => {
  let patientUser: any;

  beforeEach(async () => {
    const payload = buildUserPayload({ role: 'PATIENT' });
    patientUser = await prisma.user.create({
      data: {
        name: payload.name,
        email: payload.email,
        phoneNo: payload.phoneNo,
        password: payload.password,
        age: payload.age,
        address: payload.address,
        role: 'PATIENT',
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
  });

  afterAll(async () => {
    await prisma.accessLog.deleteMany({
      where: { user: { email: { contains: '@quickclinic.test' } } },
    });
    await prisma.patient.deleteMany({
      where: { user: { email: { contains: '@quickclinic.test' } } },
    });
    await prisma.user.deleteMany({
      where: { email: { contains: '@quickclinic.test' } },
    });
  });

  it('9.1 creates patient profile with medical history, allergies, and medications', async () => {
    const profilePayload = buildPatientProfilePayload({
      userId: patientUser.id,
      medicalHistory: 'Asthma diagnosed in childhood',
      allergies: 'Peanuts, Shellfish',
      currentMedications: 'Albuterol Inhaler',
    });

    const req = new NextRequest('http://localhost:3000/api/patients', {
      method: 'POST',
      body: JSON.stringify(profilePayload),
    });

    const res = await createPatientPOST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.patient.medicalHistory).toBe('Asthma diagnosed in childhood');
    expect(body.patient.allergies).toBe('Peanuts, Shellfish');
    expect(body.patient.currentMedications).toBe('Albuterol Inhaler');
  });

  it('9.2 rejects duplicate patient profile creation for the same user', async () => {
    const profilePayload = buildPatientProfilePayload({ userId: patientUser.id });

    const req1 = new NextRequest('http://localhost:3000/api/patients', {
      method: 'POST',
      body: JSON.stringify(profilePayload),
    });
    const res1 = await createPatientPOST(req1);
    expect(res1.status).toBe(201);

    const req2 = new NextRequest('http://localhost:3000/api/patients', {
      method: 'POST',
      body: JSON.stringify(profilePayload),
    });
    const res2 = await createPatientPOST(req2);
    expect(res2.status).toBe(409);
  });

  it('9.3 updates patient profile fields and fetches updated patient details', async () => {
    const profilePayload = buildPatientProfilePayload({ userId: patientUser.id });
    const createReq = new NextRequest('http://localhost:3000/api/patients', {
      method: 'POST',
      body: JSON.stringify(profilePayload),
    });
    const createRes = await createPatientPOST(createReq);
    const { patient } = await createRes.json();

    const patchReq = new NextRequest(`http://localhost:3000/api/patients/${patient.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ allergies: 'No known drug allergies' }),
    });
    const patchRes = await updatePatientPATCH(patchReq, { params: Promise.resolve({ patientId: patient.id }) });
    expect(patchRes.status).toBe(200);

    const getReq = new NextRequest(`http://localhost:3000/api/patients/${patient.id}`);
    const getRes = await getPatientGET(getReq, { params: Promise.resolve({ patientId: patient.id }) });
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.patient.allergies).toBe('No known drug allergies');
  });
});
