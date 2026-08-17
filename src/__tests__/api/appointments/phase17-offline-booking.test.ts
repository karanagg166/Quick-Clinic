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
import { POST as confirmPOST } from '@/app/api/appointments/confirm/route';
import { POST as deprecatedPatientBookPOST } from '@/app/api/patients/[patientId]/appointments/route';
import { prisma } from '@/lib/prisma';
import { createToken } from '@/lib/auth';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 17: Offline Appointment Booking Flow Test Suite', () => {
  let doctorUserId: string;
  let doctorId: string;

  let patient1UserId: string;
  let patient1Id: string;
  let patient1Token: string;

  let patient2UserId: string;
  let patient2Id: string;
  let patient2Token: string;

  let slotId: string;
  let holdToken: string;
  let bookedAppointmentId: string;

  const testFutureDate = new Date('2028-12-15T00:00:00.000Z');

  beforeAll(async () => {
    // 1. Create Doctor
    const docUserPayload = buildUserPayload({
      name: 'Dr. Offline Clinic Specialist',
      email: `doc_off_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });

    const docUser = await prisma.user.create({
      data: {
        name: docUserPayload.name,
        email: docUserPayload.email,
        phoneNo: docUserPayload.phoneNo,
        password: docUserPayload.password,
        age: 46,
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
        fees: 450,
        experience: 11,
      },
    });
    doctorId = doc.id;

    // 2. Create Patient 1
    const p1UserPayload = buildUserPayload({
      name: 'Patient Offline Booker',
      email: `pat_off1_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const p1User = await prisma.user.create({
      data: {
        name: p1UserPayload.name,
        email: p1UserPayload.email,
        phoneNo: p1UserPayload.phoneNo,
        password: p1UserPayload.password,
        age: 29,
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
      name: 'Patient Intruding Booker',
      email: `pat_off2_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const p2User = await prisma.user.create({
      data: {
        name: p2UserPayload.name,
        email: p2UserPayload.email,
        phoneNo: p2UserPayload.phoneNo,
        password: p2UserPayload.password,
        age: 33,
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

    // 4. Create slot
    const slot = await prisma.slot.create({
      data: {
        doctorId,
        date: testFutureDate,
        startTime: new Date('2028-12-15T14:00:00.000Z'),
        endTime: new Date('2028-12-15T14:10:00.000Z'),
        status: 'AVAILABLE',
      },
    });
    slotId = slot.id;
  });

  afterAll(async () => {
    try {
      await prisma.notification.deleteMany({ where: { userId: { in: [doctorUserId, patient1UserId, patient2UserId] } } });
      const relations = await prisma.doctorPatientRelation.findMany({
        where: { OR: [{ doctorsUserId: doctorUserId }, { patientsUserId: patient1UserId }] },
      });
      const relIds = relations.map((r) => r.id);
      if (relIds.length > 0) {
        await prisma.chatMessages.deleteMany({ where: { doctorPatientRelationId: { in: relIds } } });
        await prisma.doctorPatientRelation.deleteMany({ where: { id: { in: relIds } } });
      }
      await prisma.appointment.deleteMany({ where: { doctorId } });
      await prisma.slot.deleteMany({ where: { doctorId } });
      await prisma.auditLog.deleteMany({ where: { userId: { in: [patient1UserId, patient2UserId] } } });
      await prisma.doctor.deleteMany({ where: { id: doctorId } });
      await prisma.patient.deleteMany({ where: { id: { in: [patient1Id, patient2Id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [doctorUserId, patient1UserId, patient2UserId] } } });
    } catch (e) {
      console.warn('Phase 17 cleanup warning:', e);
    }
  });

  it('17.1 Patient 1 acquires hold and confirms OFFLINE appointment', async () => {
    // Step 1: Hold slot
    const holdReq = new NextRequest('http://localhost:3000/api/appointments/hold', {
      method: 'POST',
      headers: { authorization: `Bearer ${patient1Token}` },
      body: JSON.stringify({ slotId, doctorId }),
    });
    const holdRes = await holdPOST(holdReq);
    expect(holdRes.status).toBe(201);
    const holdData = await holdRes.json();
    holdToken = holdData.holdToken;

    // Step 2: Confirm OFFLINE booking
    const confirmReq = new NextRequest('http://localhost:3000/api/appointments/confirm', {
      method: 'POST',
      headers: { authorization: `Bearer ${patient1Token}` },
      body: JSON.stringify({
        slotId,
        doctorId,
        holdToken,
        paymentMethod: 'OFFLINE',
      }),
    });

    const confirmRes = await confirmPOST(confirmReq);
    expect(confirmRes.status).toBe(201);
    const confirmData = await confirmRes.json();

    expect(confirmData.appointment).toBeDefined();
    bookedAppointmentId = confirmData.appointment.id;
    expect(confirmData.appointment.status).toBe('CONFIRMED');
    expect(confirmData.appointment.paymentMethod).toBe('OFFLINE');
    expect(confirmData.appointment.isAppointmentOffline).toBe(true);

    // Verify slot transitioned to BOOKED
    const slot = await prisma.slot.findUnique({ where: { id: slotId } });
    expect(slot?.status).toBe('BOOKED');
  });

  it('17.2 verifies side effects: AuditLog, notifications, and chat confirmation created', async () => {
    // Audit Log verification
    const auditLogs = await prisma.auditLog.findMany({ where: { userId: patient1UserId } });
    expect(auditLogs.some((l) => l.action.includes('Booked Appointment'))).toBe(true);

    // Notification verification
    const patNotifs = await prisma.notification.findMany({ where: { userId: patient1UserId } });
    expect(patNotifs.some((n) => n.message.includes('confirmed'))).toBe(true);

    const docNotifs = await prisma.notification.findMany({ where: { userId: doctorUserId } });
    expect(docNotifs.some((n) => n.message.includes('appointment'))).toBe(true);

    // Chat Message verification
    const relation = await prisma.doctorPatientRelation.findUnique({
      where: {
        doctorsUserId_patientsUserId: {
          doctorsUserId: doctorUserId,
          patientsUserId: patient1UserId,
        },
      },
      include: { chatMessages: true },
    });
    expect(relation).toBeDefined();
    expect(relation?.chatMessages.some((m) => m.text.includes('Appointment Confirmed'))).toBe(true);
  });

  it('17.3 Patient 2 attempting to confirm with Patient 1 hold token is rejected with 409', async () => {
    const confirmReq = new NextRequest('http://localhost:3000/api/appointments/confirm', {
      method: 'POST',
      headers: { authorization: `Bearer ${patient2Token}` },
      body: JSON.stringify({
        slotId,
        doctorId,
        holdToken,
        paymentMethod: 'OFFLINE',
      }),
    });

    const res = await confirmPOST(confirmReq);
    expect(res.status).toBe(409);
  });

  it('17.4 deprecated direct POST to /api/patients/[patientId]/appointments returns 410 redirect', async () => {
    const req = new NextRequest(`http://localhost:3000/api/patients/${patient1Id}/appointments`, {
      method: 'POST',
      headers: { authorization: `Bearer ${patient1Token}` },
    });

    const res = await deprecatedPatientBookPOST(req, { params: Promise.resolve({ patientId: patient1Id }) });
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.message).toContain('/api/appointments/hold');
  });
});
