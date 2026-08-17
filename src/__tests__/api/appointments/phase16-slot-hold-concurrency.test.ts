import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Mock Upstash Redis with in-memory map for fast and robust test execution
const inMemoryRedis = new Map<string, any>();
vi.mock('@upstash/redis', () => ({
  Redis: class MockRedis {
    set(key: string, value: any) {
      inMemoryRedis.set(key, value);
      return Promise.resolve('OK');
    }
    get(key: string) {
      return Promise.resolve(inMemoryRedis.get(key) || null);
    }
    del(key: string) {
      inMemoryRedis.delete(key);
      return Promise.resolve(1);
    }
  },
}));

import { POST as holdPOST } from '@/app/api/appointments/hold/route';
import { POST as cancelHoldPOST } from '@/app/api/appointments/cancel-hold/route';
import { prisma } from '@/lib/prisma';
import { createToken } from '@/lib/auth';
import { expireDoctorHolds } from '@/lib/booking';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 16: Slot Hold, Expiration & Concurrency Engine Test Suite', () => {
  let doctorUserId: string;
  let doctorId: string;

  let patient1UserId: string;
  let patient1Id: string;
  let patient1Token: string;

  let patient2UserId: string;
  let patient2Id: string;
  let patient2Token: string;

  let slotId1: string;
  let slotId2: string;
  let pastSlotId: string;
  let holdToken1: string;

  const testFutureDate = new Date('2028-12-01T00:00:00.000Z');
  const testPastDate = new Date('2020-01-01T00:00:00.000Z');

  beforeAll(async () => {
    // 1. Create Doctor
    const docUserPayload = buildUserPayload({
      name: 'Dr. Concurrency Specialist',
      email: `doc_conc_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });

    const docUser = await prisma.user.create({
      data: {
        name: docUserPayload.name,
        email: docUserPayload.email,
        phoneNo: docUserPayload.phoneNo,
        password: docUserPayload.password,
        age: 39,
        address: docUserPayload.address,
        role: 'DOCTOR',
        gender: 'MALE',
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    doctorUserId = docUser.id;

    const doc = await prisma.doctor.create({
      data: {
        userId: docUser.id,
        specialty: 'GENERAL_PHYSICIAN',
        fees: 500,
        experience: 8,
      },
    });
    doctorId = doc.id;

    // 2. Create Patient 1
    const p1UserPayload = buildUserPayload({
      name: 'Patient Concurrent One',
      email: `pat_conc1_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const p1User = await prisma.user.create({
      data: {
        name: p1UserPayload.name,
        email: p1UserPayload.email,
        phoneNo: p1UserPayload.phoneNo,
        password: p1UserPayload.password,
        age: 24,
        address: p1UserPayload.address,
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
    patient1UserId = p1User.id;
    const p1 = await prisma.patient.create({ data: { userId: p1User.id } });
    patient1Id = p1.id;
    patient1Token = await createToken({ id: patient1UserId, role: 'PATIENT', email: p1User.email });

    // 3. Create Patient 2
    const p2UserPayload = buildUserPayload({
      name: 'Patient Concurrent Two',
      email: `pat_conc2_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const p2User = await prisma.user.create({
      data: {
        name: p2UserPayload.name,
        email: p2UserPayload.email,
        phoneNo: p2UserPayload.phoneNo,
        password: p2UserPayload.password,
        age: 27,
        address: p2UserPayload.address,
        role: 'PATIENT',
        gender: 'FEMALE',
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    patient2UserId = p2User.id;
    const p2 = await prisma.patient.create({ data: { userId: p2User.id } });
    patient2Id = p2.id;
    patient2Token = await createToken({ id: patient2UserId, role: 'PATIENT', email: p2User.email });

    // 4. Create Slots
    const s1 = await prisma.slot.create({
      data: {
        doctorId,
        date: testFutureDate,
        startTime: new Date('2028-12-01T10:00:00.000Z'),
        endTime: new Date('2028-12-01T10:10:00.000Z'),
        status: 'AVAILABLE',
      },
    });
    slotId1 = s1.id;

    const s2 = await prisma.slot.create({
      data: {
        doctorId,
        date: testFutureDate,
        startTime: new Date('2028-12-01T11:00:00.000Z'),
        endTime: new Date('2028-12-01T11:10:00.000Z'),
        status: 'AVAILABLE',
      },
    });
    slotId2 = s2.id;

    const pastSlot = await prisma.slot.create({
      data: {
        doctorId,
        date: testPastDate,
        startTime: new Date('2020-01-01T08:00:00.000Z'),
        endTime: new Date('2020-01-01T08:10:00.000Z'),
        status: 'AVAILABLE',
      },
    });
    pastSlotId = pastSlot.id;
  });

  afterAll(async () => {
    try {
      await prisma.slot.deleteMany({ where: { doctorId } });
      await prisma.doctor.deleteMany({ where: { id: doctorId } });
      await prisma.patient.deleteMany({ where: { id: { in: [patient1Id, patient2Id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [doctorUserId, patient1UserId, patient2UserId] } } });
    } catch (e) {
      console.warn('Phase 16 cleanup warning:', e);
    }
  });

  it('16.1 Patient 1 successfully holds an available slot', async () => {
    const req = new NextRequest('http://localhost:3000/api/appointments/hold', {
      method: 'POST',
      headers: { authorization: `Bearer ${patient1Token}` },
      body: JSON.stringify({ slotId: slotId1, doctorId }),
    });

    const res = await holdPOST(req);
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.holdToken).toBeDefined();
    expect(body.expiresAt).toBeDefined();
    holdToken1 = body.holdToken;

    const slot = await prisma.slot.findUnique({ where: { id: slotId1 } });
    expect(slot?.status).toBe('HELD');
    expect(slot?.heldByPatientId).toBe(patient1Id);
  });

  it('16.2 Patient 2 is rejected with 409 Conflict when attempting to hold the same held slot', async () => {
    const req = new NextRequest('http://localhost:3000/api/appointments/hold', {
      method: 'POST',
      headers: { authorization: `Bearer ${patient2Token}` },
      body: JSON.stringify({ slotId: slotId1, doctorId }),
    });

    const res = await holdPOST(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('This slot is no longer available');
  });

  it('16.3 rejects hold request for past time slots with 400', async () => {
    const req = new NextRequest('http://localhost:3000/api/appointments/hold', {
      method: 'POST',
      headers: { authorization: `Bearer ${patient1Token}` },
      body: JSON.stringify({ slotId: pastSlotId, doctorId }),
    });

    const res = await holdPOST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('This time slot has already passed');
  });

  it('16.4 handles concurrent simultaneous hold requests: exactly 1 wins', async () => {
    const p1Req = new NextRequest('http://localhost:3000/api/appointments/hold', {
      method: 'POST',
      headers: { authorization: `Bearer ${patient1Token}` },
      body: JSON.stringify({ slotId: slotId2, doctorId }),
    });

    const p2Req = new NextRequest('http://localhost:3000/api/appointments/hold', {
      method: 'POST',
      headers: { authorization: `Bearer ${patient2Token}` },
      body: JSON.stringify({ slotId: slotId2, doctorId }),
    });

    const [res1, res2] = await Promise.all([holdPOST(p1Req), holdPOST(p2Req)]);
    const statuses = [res1.status, res2.status];

    expect(statuses).toContain(201);
    expect(statuses).toContain(409);
  });

  it('16.5 Patient 1 cancels slot hold and reverts slot to AVAILABLE', async () => {
    const req = new NextRequest('http://localhost:3000/api/appointments/cancel-hold', {
      method: 'POST',
      headers: { authorization: `Bearer ${patient1Token}` },
      body: JSON.stringify({ slotId: slotId1, holdToken: holdToken1 }),
    });

    const res = await cancelHoldPOST(req);
    expect(res.status).toBe(200);

    const slot = await prisma.slot.findUnique({ where: { id: slotId1 } });
    expect(slot?.status).toBe('AVAILABLE');
    expect(slot?.heldByPatientId).toBeNull();
  });

  it('16.6 expires stale holds automatically when hold TTL is exceeded', async () => {
    // Manually simulate stale hold held 20 minutes ago
    const twentyMinAgo = new Date(Date.now() - 20 * 60 * 1000);
    await prisma.slot.update({
      where: { id: slotId1 },
      data: { status: 'HELD', heldByPatientId: patient1Id, heldAt: twentyMinAgo },
    });

    // Run expiration cleanup
    await expireDoctorHolds(doctorId);

    const slot = await prisma.slot.findUnique({ where: { id: slotId1 } });
    expect(slot?.status).toBe('AVAILABLE');
    expect(slot?.heldByPatientId).toBeNull();
  });
});
