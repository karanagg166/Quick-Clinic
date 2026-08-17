import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import {
  GET as doctorAppointmentGET,
  PATCH as doctorAppointmentPATCH,
} from '@/app/api/doctors/[doctorId]/appointments/[appointmentId]/route';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 24: Appointment Completion & Doctor Earnings Settlement Test Suite', () => {
  let doc1UserId: string;
  let doc1Id: string;

  let doc2UserId: string;
  let doc2Id: string;

  let patientUserId: string;
  let patientId: string;

  let apptOnlineId: string;
  let slotOnlineId: string;
  let paymentId: string;

  let apptOfflineId: string;
  let slotOfflineId: string;

  const testDate = new Date('2029-04-12T00:00:00.000Z');

  beforeAll(async () => {
    // 1. Create Doctor 1 (initial balance: 0)
    const doc1Payload = buildUserPayload({
      name: 'Dr. Completion Specialist',
      email: `doc_comp1_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const doc1User = await prisma.user.create({
      data: {
        name: doc1Payload.name,
        email: doc1Payload.email,
        phoneNo: doc1Payload.phoneNo,
        password: doc1Payload.password,
        age: 46,
        address: doc1Payload.address,
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
    doc1UserId = doc1User.id;

    const d1 = await prisma.doctor.create({
      data: {
        userId: doc1User.id,
        specialty: 'ORTHOPEDIC',
        fees: 1500, // 1500 INR = 150,000 paise
        experience: 16,
        balance: 0,
      },
    });
    doc1Id = d1.id;

    // 2. Create Doctor 2 (for isolation check)
    const doc2Payload = buildUserPayload({
      name: 'Dr. Unrelated Complete',
      email: `doc_comp2_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const doc2User = await prisma.user.create({
      data: {
        name: doc2Payload.name,
        email: doc2Payload.email,
        phoneNo: doc2Payload.phoneNo,
        password: doc2Payload.password,
        age: 39,
        address: doc2Payload.address,
        role: 'DOCTOR',
        gender: 'FEMALE',
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    doc2UserId = doc2User.id;

    const d2 = await prisma.doctor.create({
      data: {
        userId: doc2User.id,
        specialty: 'PEDIATRICIAN',
        fees: 800,
        experience: 9,
        balance: 0,
      },
    });
    doc2Id = d2.id;

    // 3. Create Patient
    const patPayload = buildUserPayload({
      name: 'Patient Completion Test',
      email: `pat_comp_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const patUser = await prisma.user.create({
      data: {
        name: patPayload.name,
        email: patPayload.email,
        phoneNo: patPayload.phoneNo,
        password: patPayload.password,
        age: 31,
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

    const pat = await prisma.patient.create({
      data: {
        userId: patUser.id,
      },
    });
    patientId = pat.id;

    // 4. Create online appointment with payment record
    const slot1 = await prisma.slot.create({
      data: {
        doctorId: doc1Id,
        date: testDate,
        startTime: new Date('2029-04-12T10:00:00.000Z'),
        endTime: new Date('2029-04-12T10:10:00.000Z'),
        status: 'BOOKED',
      },
    });
    slotOnlineId = slot1.id;

    const txId = `pay_comp_${Date.now()}`;
    const pmt = await prisma.payment.create({
      data: {
        userId: patientUserId,
        amount: 150000,
        currency: 'INR',
        status: 'SUCCESS',
        razorpayOrderId: `order_comp_${Date.now()}`,
        razorpayPaymentId: txId,
      },
    });
    paymentId = pmt.id;

    const appt1 = await prisma.appointment.create({
      data: {
        doctorId: doc1Id,
        patientId,
        slotId: slot1.id,
        status: 'CONFIRMED',
        paymentMethod: 'ONLINE',
        transactionId: txId,
        isAppointmentOffline: false,
      },
    });
    apptOnlineId = appt1.id;

    // 5. Create offline appointment
    const slot2 = await prisma.slot.create({
      data: {
        doctorId: doc1Id,
        date: testDate,
        startTime: new Date('2029-04-12T11:00:00.000Z'),
        endTime: new Date('2029-04-12T11:10:00.000Z'),
        status: 'BOOKED',
      },
    });
    slotOfflineId = slot2.id;

    const appt2 = await prisma.appointment.create({
      data: {
        doctorId: doc1Id,
        patientId,
        slotId: slot2.id,
        status: 'CONFIRMED',
        paymentMethod: 'OFFLINE',
        isAppointmentOffline: true,
      },
    });
    apptOfflineId = appt2.id;
  });

  afterAll(async () => {
    try {
      await prisma.chatMessages.deleteMany({
        where: {
          doctorPatientRelation: {
            doctorsUserId: { in: [doc1UserId, doc2UserId] },
          },
        },
      });
      await prisma.doctorPatientRelation.deleteMany({
        where: {
          doctorsUserId: { in: [doc1UserId, doc2UserId] },
        },
      });
      await prisma.notification.deleteMany({
        where: { userId: { in: [doc1UserId, doc2UserId, patientUserId] } },
      });
      await prisma.auditLog.deleteMany({
        where: { userId: { in: [doc1UserId, doc2UserId] } },
      });
      await prisma.appointment.deleteMany({ where: { doctorId: { in: [doc1Id, doc2Id] } } });
      await prisma.payment.deleteMany({ where: { id: paymentId } });
      await prisma.slot.deleteMany({ where: { doctorId: { in: [doc1Id, doc2Id] } } });
      await prisma.doctor.deleteMany({ where: { id: { in: [doc1Id, doc2Id] } } });
      await prisma.patient.deleteMany({ where: { id: patientId } });
      await prisma.user.deleteMany({ where: { id: { in: [doc1UserId, doc2UserId, patientUserId] } } });
    } catch (e) {
      console.warn('Phase 24 cleanup warning:', e);
    }
  });

  it('24.1 Completing ONLINE appointment updates status to COMPLETED, slot to UNAVAILABLE, and credits doctor balance in paise', async () => {
    const docBefore = await prisma.doctor.findUnique({ where: { id: doc1Id } });
    const initialBalance = docBefore?.balance ?? 0;

    const req = new NextRequest(
      `http://localhost:3000/api/doctors/${doc1Id}/appointments/${apptOnlineId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: 'COMPLETED' }),
      }
    );

    const res = await doctorAppointmentPATCH(req, {
      params: Promise.resolve({ doctorId: doc1Id, appointmentId: apptOnlineId }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('COMPLETED');

    // Appointment status is COMPLETED
    const appt = await prisma.appointment.findUnique({ where: { id: apptOnlineId } });
    expect(appt?.status).toBe('COMPLETED');

    // Slot is UNAVAILABLE (consumed)
    const slot = await prisma.slot.findUnique({ where: { id: slotOnlineId } });
    expect(slot?.status).toBe('UNAVAILABLE');

    // Doctor balance is incremented by 1500 * 100 = 150000 paise
    const docAfter = await prisma.doctor.findUnique({ where: { id: doc1Id } });
    expect(docAfter?.balance).toBe(initialBalance + 150000);

    // Patient received Rate & Review notification
    const patientNotifs = await prisma.notification.findMany({ where: { userId: patientUserId } });
    expect(patientNotifs.some((n: any) => n.actionLabel === 'Rate and review')).toBe(true);
  });

  it('24.2 Financial Idempotency: Duplicate completion request does NOT credit doctor balance a second time', async () => {
    const docBefore = await prisma.doctor.findUnique({ where: { id: doc1Id } });
    const currentBalance = docBefore?.balance ?? 0;

    // Call completion again
    const req = new NextRequest(
      `http://localhost:3000/api/doctors/${doc1Id}/appointments/${apptOnlineId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: 'COMPLETED' }),
      }
    );

    const res = await doctorAppointmentPATCH(req, {
      params: Promise.resolve({ doctorId: doc1Id, appointmentId: apptOnlineId }),
    });

    expect(res.status).toBe(200);

    // Doctor balance remains identical (no double credit)
    const docAfter = await prisma.doctor.findUnique({ where: { id: doc1Id } });
    expect(docAfter?.balance).toBe(currentBalance);
  });

  it('24.3 Completing OFFLINE appointment marks status COMPLETED and slot UNAVAILABLE without modifying online balance', async () => {
    const docBefore = await prisma.doctor.findUnique({ where: { id: doc1Id } });
    const balanceBefore = docBefore?.balance ?? 0;

    const req = new NextRequest(
      `http://localhost:3000/api/doctors/${doc1Id}/appointments/${apptOfflineId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: 'COMPLETED' }),
      }
    );

    const res = await doctorAppointmentPATCH(req, {
      params: Promise.resolve({ doctorId: doc1Id, appointmentId: apptOfflineId }),
    });

    expect(res.status).toBe(200);

    const slot = await prisma.slot.findUnique({ where: { id: slotOfflineId } });
    expect(slot?.status).toBe('UNAVAILABLE');

    // Offline payments are collected directly at clinic; doctor online balance is not incremented
    const docAfter = await prisma.doctor.findUnique({ where: { id: doc1Id } });
    expect(docAfter?.balance).toBe(balanceBefore);
  });

  it('24.4 Doctor 2 cannot complete Doctor 1 appointment (404 isolation)', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/doctors/${doc2Id}/appointments/${apptOnlineId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: 'COMPLETED' }),
      }
    );

    const res = await doctorAppointmentPATCH(req, {
      params: Promise.resolve({ doctorId: doc2Id, appointmentId: apptOnlineId }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Appointment not found');
  });
});
