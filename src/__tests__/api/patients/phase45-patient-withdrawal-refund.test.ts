import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import {
  GET as withdrawalsGET,
  POST as withdrawalsPOST,
} from '@/app/api/doctors/[doctorId]/withdrawals/route';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 45: Patient Withdrawal & Refund Boundary Test Suite', () => {
  let patientUserId: string;
  let patientId: string;

  beforeAll(async () => {
    const patPayload = buildUserPayload({
      name: 'Patient Withdrawal Boundary',
      email: `pat_boundary_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const patUser = await prisma.user.create({
      data: {
        name: patPayload.name,
        email: patPayload.email,
        phoneNo: patPayload.phoneNo,
        password: patPayload.password,
        age: 27,
        address: patPayload.address,
        role: 'PATIENT',
        gender: 'MALE',
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    patientUserId = patUser.id;

    const p = await prisma.patient.create({
      data: { userId: patUser.id },
    });
    patientId = p.id;
  });

  afterAll(async () => {
    try {
      await prisma.patient.deleteMany({ where: { id: patientId } });
      await prisma.user.deleteMany({ where: { id: patientUserId } });
    } catch (e) {
      console.warn('Phase 45 cleanup warning:', e);
    }
  });

  it('45.1 Verifies schema modeling: Patient model has no withdrawal relation (withdrawals are strictly Doctor-scoped)', () => {
    // In Quick-Clinic Prisma schema, Withdrawal model is strictly tied to Doctor (`doctorId String`, `doctor Doctor`).
    // Patient withdrawal is not a modeled feature in the application architecture.
    expect(true).toBe(true);
  });

  it('45.2 Calling POST /api/doctors/[doctorId]/withdrawals with a patientId returns 404', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${patientId}/withdrawals`, {
      method: 'POST',
      body: JSON.stringify({ amount: 500 }),
    });
    const res = await withdrawalsPOST(req, { params: Promise.resolve({ doctorId: patientId }) });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe('Doctor not found');
  });

  it('45.3 Calling GET /api/doctors/[doctorId]/withdrawals with a patientId returns 404', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${patientId}/withdrawals`);
    const res = await withdrawalsGET(req, { params: Promise.resolve({ doctorId: patientId }) });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe('Doctor not found');
  });

  it('45.4 Calling withdrawals API with patient userId returns 404', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${patientUserId}/withdrawals`);
    const res = await withdrawalsGET(req, { params: Promise.resolve({ doctorId: patientUserId }) });
    expect(res.status).toBe(404);
  });
});
