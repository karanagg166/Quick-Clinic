import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH as doctorAppointmentPATCH } from '@/app/api/doctors/[doctorId]/appointments/[appointmentId]/route';
import { prisma } from '@/lib/prisma';
import { buildUserPayload, createAuthHeaders } from '@/__tests__/helpers/factories';

describe('Phase 39: Financial Idempotency & Balance Credit Determinism Test Suite', () => {
  let docUserId: string;
  let docId: string;
  let patientUserId: string;
  let patientId: string;

  let slotOnline1Id: string;
  let apptOnline1Id: string;

  let slotOfflineId: string;
  let apptOfflineId: string;

  let slotCancelledId: string;
  let apptCancelledId: string;

  beforeAll(async () => {
    // 1. Create Doctor with initial balance 0 (fees: 1200 INR)
    const docPayload = buildUserPayload({
      name: 'Dr. Idempotency Specialist',
      email: `doc_idem_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const docUser = await prisma.user.create({
      data: {
        name: docPayload.name,
        email: docPayload.email,
        phoneNo: docPayload.phoneNo,
        password: docPayload.password,
        age: 45,
        address: docPayload.address,
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
    docUserId = docUser.id;

    const d = await prisma.doctor.create({
      data: {
        userId: docUser.id,
        specialty: 'CARDIOLOGIST',
        fees: 1200, // 1200 INR = 120,000 paise
        experience: 14,
        balance: 0,
      },
    });
    docId = d.id;

    // 2. Create Patient
    const patPayload = buildUserPayload({
      name: 'Patient Financial Test',
      email: `pat_idem_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const patUser = await prisma.user.create({
      data: {
        name: patPayload.name,
        email: patPayload.email,
        phoneNo: patPayload.phoneNo,
        password: patPayload.password,
        age: 35,
        address: patPayload.address,
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
    patientUserId = patUser.id;

    const p = await prisma.patient.create({ data: { userId: patUser.id } });
    patientId = p.id;

    // 3. Create Slot and Confirmed Online Appointment
    const s1 = await prisma.slot.create({
      data: {
        doctorId: docId,
        date: new Date('2026-09-01T00:00:00Z'),
        startTime: new Date('2026-09-01T09:00:00Z'),
        endTime: new Date('2026-09-01T09:30:00Z'),
        status: 'BOOKED',
      },
    });
    slotOnline1Id = s1.id;

    const a1 = await prisma.appointment.create({
      data: {
        doctorId: docId,
        patientId,
        slotId: s1.id,
        status: 'CONFIRMED',
        paymentMethod: 'ONLINE',
        transactionId: 'pay_idem_online_1',
        isAppointmentOffline: false,
      },
    });
    apptOnline1Id = a1.id;

    // 4. Create Slot and Confirmed Offline Appointment
    const s2 = await prisma.slot.create({
      data: {
        doctorId: docId,
        date: new Date('2026-09-01T00:00:00Z'),
        startTime: new Date('2026-09-01T10:00:00Z'),
        endTime: new Date('2026-09-01T10:30:00Z'),
        status: 'BOOKED',
      },
    });
    slotOfflineId = s2.id;

    const a2 = await prisma.appointment.create({
      data: {
        doctorId: docId,
        patientId,
        slotId: s2.id,
        status: 'CONFIRMED',
        paymentMethod: 'OFFLINE',
        isAppointmentOffline: true,
      },
    });
    apptOfflineId = a2.id;

    // 5. Create Slot and Confirmed Appointment for cancellation
    const s3 = await prisma.slot.create({
      data: {
        doctorId: docId,
        date: new Date('2026-09-01T00:00:00Z'),
        startTime: new Date('2026-09-01T11:00:00Z'),
        endTime: new Date('2026-09-01T11:30:00Z'),
        status: 'BOOKED',
      },
    });
    slotCancelledId = s3.id;

    const a3 = await prisma.appointment.create({
      data: {
        doctorId: docId,
        patientId,
        slotId: s3.id,
        status: 'CONFIRMED',
        paymentMethod: 'ONLINE',
        isAppointmentOffline: false,
      },
    });
    apptCancelledId = a3.id;
  });

  afterAll(async () => {
    try {
      await prisma.appointment.deleteMany({
        where: { id: { in: [apptOnline1Id, apptOfflineId, apptCancelledId] } },
      });
      await prisma.slot.deleteMany({
        where: { id: { in: [slotOnline1Id, slotOfflineId, slotCancelledId] } },
      });
      await prisma.patient.deleteMany({ where: { id: patientId } });
      await prisma.doctor.deleteMany({ where: { id: docId } });
      await prisma.user.deleteMany({ where: { id: { in: [docUserId, patientUserId] } } });
    } catch (e) {
      console.warn('Phase 39 cleanup warning:', e);
    }
  });

  it('39.1 Initial completion of ONLINE appointment credits doctor balance exactly once (120,000 paise)', async () => {
    const docBefore = await prisma.doctor.findUnique({ where: { id: docId } });
    expect(docBefore?.balance).toBe(0);

    const authHeaders = await createAuthHeaders({ id: docUserId, role: 'DOCTOR' });
    const req = new NextRequest(
      `http://localhost:3000/api/doctors/${docId}/appointments/${apptOnline1Id}`,
      {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ status: 'COMPLETED' }),
      }
    );
    const res = await doctorAppointmentPATCH(req, {
      params: Promise.resolve({ doctorId: docId, appointmentId: apptOnline1Id }),
    });
    expect(res.status).toBe(200);

    const docAfter = await prisma.doctor.findUnique({ where: { id: docId } });
    // 1200 INR * 100 = 120000 paise
    expect(docAfter?.balance).toBe(120000);
  });

  it('39.2 Idempotency: Duplicate PATCH request to mark already-COMPLETED appointment does NOT double credit balance', async () => {
    const docBefore = await prisma.doctor.findUnique({ where: { id: docId } });
    expect(docBefore?.balance).toBe(120000);

    const authHeaders = await createAuthHeaders({ id: docUserId, role: 'DOCTOR' });
    const req = new NextRequest(
      `http://localhost:3000/api/doctors/${docId}/appointments/${apptOnline1Id}`,
      {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ status: 'COMPLETED' }),
      }
    );
    const res = await doctorAppointmentPATCH(req, {
      params: Promise.resolve({ doctorId: docId, appointmentId: apptOnline1Id }),
    });
    expect(res.status).toBe(200);

    const docAfter = await prisma.doctor.findUnique({ where: { id: docId } });
    // Balance remains exactly 120,000 paise (no double credit)
    expect(docAfter?.balance).toBe(120000);
  });

  it('39.3 Completing OFFLINE appointment marks COMPLETED without crediting digital wallet balance', async () => {
    const docBefore = await prisma.doctor.findUnique({ where: { id: docId } });
    const balanceBefore = docBefore?.balance ?? 0;

    const authHeaders = await createAuthHeaders({ id: docUserId, role: 'DOCTOR' });
    const req = new NextRequest(
      `http://localhost:3000/api/doctors/${docId}/appointments/${apptOfflineId}`,
      {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ status: 'COMPLETED' }),
      }
    );
    const res = await doctorAppointmentPATCH(req, {
      params: Promise.resolve({ doctorId: docId, appointmentId: apptOfflineId }),
    });
    expect(res.status).toBe(200);

    const docAfter = await prisma.doctor.findUnique({ where: { id: docId } });
    // Offline payments are collected directly at clinic; online balance is untouched
    expect(docAfter?.balance).toBe(balanceBefore);
  });

  it('39.4 Status transition to CANCELLED does NOT credit doctor balance', async () => {
    const docBefore = await prisma.doctor.findUnique({ where: { id: docId } });
    const balanceBefore = docBefore?.balance ?? 0;

    const authHeaders = await createAuthHeaders({ id: docUserId, role: 'DOCTOR' });
    const req = new NextRequest(
      `http://localhost:3000/api/doctors/${docId}/appointments/${apptCancelledId}`,
      {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ status: 'CANCELLED' }),
      }
    );
    const res = await doctorAppointmentPATCH(req, {
      params: Promise.resolve({ doctorId: docId, appointmentId: apptCancelledId }),
    });
    expect(res.status).toBe(200);

    const docAfter = await prisma.doctor.findUnique({ where: { id: docId } });
    expect(docAfter?.balance).toBe(balanceBefore);
  });
});
