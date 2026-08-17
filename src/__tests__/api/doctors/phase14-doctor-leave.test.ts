import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import {
  POST as leavePOST,
  GET as leaveGET,
  PATCH as leavePATCH,
  DELETE as leaveDELETE,
} from '@/app/api/doctors/[doctorId]/leave/route';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 14: Doctor Leave & Slot/Appointment Side Effects Test Suite', () => {
  let doctorUserId: string;
  let doctorId: string;
  let patientUserId: string;
  let patientId: string;
  let createdLeaveId: string;

  const testLeaveStartDate = '2028-09-10T00:00:00.000Z';
  const testLeaveEndDate = '2028-09-12T23:59:59.999Z';
  const testSlotDate = new Date('2028-09-11T00:00:00.000Z');

  beforeAll(async () => {
    // 1. Create Doctor
    const docUserPayload = buildUserPayload({
      name: 'Dr. Leave Tester',
      email: `doc_leave_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });

    const docUser = await prisma.user.create({
      data: {
        name: docUserPayload.name,
        email: docUserPayload.email,
        phoneNo: docUserPayload.phoneNo,
        password: docUserPayload.password,
        age: 45,
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
        specialty: 'PSYCHIATRIST',
        fees: 1100,
        experience: 15,
      },
    });
    doctorId = doc.id;

    // 2. Create Patient
    const patUserPayload = buildUserPayload({
      name: 'Patient Under Leave',
      email: `pat_leave_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });

    const patUser = await prisma.user.create({
      data: {
        name: patUserPayload.name,
        email: patUserPayload.email,
        phoneNo: patUserPayload.phoneNo,
        password: patUserPayload.password,
        age: 30,
        address: patUserPayload.address,
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

    const pat = await prisma.patient.create({
      data: {
        userId: patUser.id,
        medicalHistory: 'None',
      },
    });
    patientId = pat.id;

    // 3. Create an AVAILABLE slot and a BOOKED slot on test date
    const slot1 = await prisma.slot.create({
      data: {
        doctorId,
        date: testSlotDate,
        startTime: new Date('2028-09-11T09:00:00.000Z'),
        endTime: new Date('2028-09-11T09:10:00.000Z'),
        status: 'AVAILABLE',
      },
    });

    const slot2 = await prisma.slot.create({
      data: {
        doctorId,
        date: testSlotDate,
        startTime: new Date('2028-09-11T10:00:00.000Z'),
        endTime: new Date('2028-09-11T10:10:00.000Z'),
        status: 'BOOKED',
      },
    });

    await prisma.appointment.create({
      data: {
        doctorId,
        patientId,
        slotId: slot2.id,
        status: 'CONFIRMED',
        paymentMethod: 'OFFLINE',
        isAppointmentOffline: true,
      },
    });
  });

  afterAll(async () => {
    try {
      await prisma.notification.deleteMany({ where: { userId: { in: [doctorUserId, patientUserId] } } });
      await prisma.appointment.deleteMany({ where: { doctorId } });
      await prisma.slot.deleteMany({ where: { doctorId } });
      await prisma.leave.deleteMany({ where: { doctorId } });
      await prisma.doctor.deleteMany({ where: { id: doctorId } });
      await prisma.patient.deleteMany({ where: { id: patientId } });
      await prisma.user.deleteMany({ where: { id: { in: [doctorUserId, patientUserId] } } });
    } catch (e) {
      console.warn('Phase 14 cleanup warning:', e);
    }
  });

  it('14.1 creates doctor leave, marks slots ON_LEAVE, and auto-cancels overlapping appointments', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}/leave`, {
      method: 'POST',
      body: JSON.stringify({
        startDate: testLeaveStartDate,
        endDate: testLeaveEndDate,
        reason: 'Attending International Psychiatric Summit',
        userId: doctorUserId,
      }),
    });

    const res = await leavePOST(req, { params: Promise.resolve({ doctorId }) });
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.id).toBeDefined();
    createdLeaveId = body.id;
    expect(body.doctorId).toBe(doctorId);
    expect(body.reason).toBe('Attending International Psychiatric Summit');
    expect(body.cancelledAppointments).toBe(1);

    // Verify slot status transitions
    const slots = await prisma.slot.findMany({ where: { doctorId, date: testSlotDate } });
    slots.forEach((s) => {
      expect(s.status).toBe('ON_LEAVE');
    });

    // Verify appointment cancellation and notification
    const appt = await prisma.appointment.findFirst({ where: { doctorId, patientId } });
    expect(appt?.status).toBe('CANCELLED');

    const patientNotifs = await prisma.notification.findMany({ where: { userId: patientUserId } });
    expect(patientNotifs.some((n) => n.message.includes('cancelled') && n.message.includes('leave'))).toBe(true);
  });

  it('14.2 rejects overlapping leave creation with 409 Conflict', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}/leave`, {
      method: 'POST',
      body: JSON.stringify({
        startDate: '2028-09-11T00:00:00.000Z',
        endDate: '2028-09-15T00:00:00.000Z',
        reason: 'Overlapping Leave',
      }),
    });

    const res = await leavePOST(req, { params: Promise.resolve({ doctorId }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('conflicts with existing leave');
  });

  it('14.3 rejects invalid date range where end date is before start date', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}/leave`, {
      method: 'POST',
      body: JSON.stringify({
        startDate: '2028-10-15T00:00:00.000Z',
        endDate: '2028-10-10T00:00:00.000Z',
        reason: 'Invalid Dates',
      }),
    });

    const res = await leavePOST(req, { params: Promise.resolve({ doctorId }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('End date cannot be before start date');
  });

  it('14.4 queries leaves with filters via GET endpoint', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}/leave?reason=Psychiatric`);
    const res = await leaveGET(req, { params: Promise.resolve({ doctorId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.leaves).toBeDefined();
    expect(body.leaves.length).toBe(1);
    expect(body.leaves[0].reason).toContain('Psychiatric');
  });

  it('14.5 modifies leave date range via PATCH', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}/leave`, {
      method: 'PATCH',
      body: JSON.stringify({
        leaveId: createdLeaveId,
        newStartDate: '2028-09-10T00:00:00.000Z',
        newEndDate: '2028-09-13T23:59:59.999Z',
      }),
    });

    const res = await leavePATCH(req, { params: Promise.resolve({ doctorId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.leave).toBeDefined();
  });

  it('14.6 cancels leave and restores ON_LEAVE slots back to AVAILABLE via DELETE', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}/leave?leaveId=${createdLeaveId}`, {
      method: 'DELETE',
    });

    const res = await leaveDELETE(req, { params: Promise.resolve({ doctorId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Verify slots restored to AVAILABLE
    const restoredSlots = await prisma.slot.findMany({ where: { doctorId, date: testSlotDate } });
    restoredSlots.forEach((s) => {
      expect(s.status).toBe('AVAILABLE');
    });
  });
});
