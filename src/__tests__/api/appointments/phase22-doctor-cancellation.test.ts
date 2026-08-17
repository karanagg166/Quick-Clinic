import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import {
  GET as doctorAppointmentGET,
  PATCH as doctorAppointmentPATCH,
} from '@/app/api/doctors/[doctorId]/appointments/[appointmentId]/route';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 22: Appointment Cancellation by Doctor Test Suite', () => {
  let doc1UserId: string;
  let doc1Id: string;

  let doc2UserId: string;
  let doc2Id: string;

  let patientUserId: string;
  let patientId: string;

  let apptOfflineId: string;
  let slotOfflineId: string;

  let apptOnlineId: string;
  let slotOnlineId: string;
  let paymentId: string;

  const testDate = new Date('2029-02-10T00:00:00.000Z');

  beforeAll(async () => {
    // 1. Create Doctor 1
    const doc1Payload = buildUserPayload({
      name: 'Dr. Primary Canceller',
      email: `doc_canceller1_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const doc1User = await prisma.user.create({
      data: {
        name: doc1Payload.name,
        email: doc1Payload.email,
        phoneNo: doc1Payload.phoneNo,
        password: doc1Payload.password,
        age: 48,
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
        specialty: 'NEUROLOGIST',
        fees: 1200,
        experience: 20,
      },
    });
    doc1Id = d1.id;

    // 2. Create Doctor 2 (for isolation check)
    const doc2Payload = buildUserPayload({
      name: 'Dr. Unrelated Bystander',
      email: `doc_canceller2_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const doc2User = await prisma.user.create({
      data: {
        name: doc2Payload.name,
        email: doc2Payload.email,
        phoneNo: doc2Payload.phoneNo,
        password: doc2Payload.password,
        age: 38,
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
        specialty: 'DERMATOLOGIST',
        fees: 600,
        experience: 7,
      },
    });
    doc2Id = d2.id;

    // 3. Create Patient
    const patPayload = buildUserPayload({
      name: 'Patient DoctorCancellation Subject',
      email: `pat_doccancel_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const patUser = await prisma.user.create({
      data: {
        name: patPayload.name,
        email: patPayload.email,
        phoneNo: patPayload.phoneNo,
        password: patPayload.password,
        age: 26,
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

    const pat = await prisma.patient.create({
      data: {
        userId: patUser.id,
      },
    });
    patientId = pat.id;

    // 4. Create offline appointment
    const slot1 = await prisma.slot.create({
      data: {
        doctorId: doc1Id,
        date: testDate,
        startTime: new Date('2029-02-10T14:00:00.000Z'),
        endTime: new Date('2029-02-10T14:10:00.000Z'),
        status: 'BOOKED',
      },
    });
    slotOfflineId = slot1.id;

    const appt1 = await prisma.appointment.create({
      data: {
        doctorId: doc1Id,
        patientId,
        slotId: slot1.id,
        status: 'CONFIRMED',
        paymentMethod: 'OFFLINE',
        isAppointmentOffline: true,
      },
    });
    apptOfflineId = appt1.id;

    // 5. Create online appointment with payment
    const slot2 = await prisma.slot.create({
      data: {
        doctorId: doc1Id,
        date: testDate,
        startTime: new Date('2029-02-10T15:00:00.000Z'),
        endTime: new Date('2029-02-10T15:10:00.000Z'),
        status: 'BOOKED',
      },
    });
    slotOnlineId = slot2.id;

    const txId = `pay_doccancel_${Date.now()}`;
    const pmt = await prisma.payment.create({
      data: {
        userId: patientUserId,
        amount: 120000,
        currency: 'INR',
        status: 'SUCCESS',
        razorpayOrderId: `order_doccancel_${Date.now()}`,
        razorpayPaymentId: txId,
      },
    });
    paymentId = pmt.id;

    const appt2 = await prisma.appointment.create({
      data: {
        doctorId: doc1Id,
        patientId,
        slotId: slot2.id,
        status: 'CONFIRMED',
        paymentMethod: 'ONLINE',
        transactionId: txId,
        isAppointmentOffline: false,
      },
    });
    apptOnlineId = appt2.id;
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
      console.warn('Phase 22 cleanup warning:', e);
    }
  });

  it('22.1 Doctor 1 cancels own appointment and releases slot back to AVAILABLE', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/doctors/${doc1Id}/appointments/${apptOfflineId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: 'CANCELLED' }),
      }
    );

    const res = await doctorAppointmentPATCH(req, {
      params: Promise.resolve({ doctorId: doc1Id, appointmentId: apptOfflineId }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('CANCELLED');

    // Slot is AVAILABLE again
    const slot = await prisma.slot.findUnique({ where: { id: slotOfflineId } });
    expect(slot?.status).toBe('AVAILABLE');

    // Patient received cancellation notification
    const patientNotifs = await prisma.notification.findMany({ where: { userId: patientUserId } });
    expect(patientNotifs.some((n: any) => n.message.includes('cancelled'))).toBe(true);

    // Audit log was recorded
    const logs = await prisma.auditLog.findMany({ where: { userId: doc1UserId } });
    expect(logs.some((l: any) => l.action === 'Updated Appointment Status')).toBe(true);
  });

  it('22.2 Doctor 1 cancels ONLINE appointment and releases slot with refund handling', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/doctors/${doc1Id}/appointments/${apptOnlineId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: 'CANCELLED' }),
      }
    );

    const res = await doctorAppointmentPATCH(req, {
      params: Promise.resolve({ doctorId: doc1Id, appointmentId: apptOnlineId }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('CANCELLED');

    const slot = await prisma.slot.findUnique({ where: { id: slotOnlineId } });
    expect(slot?.status).toBe('AVAILABLE');
  });

  it('22.3 Doctor 2 cannot cancel Doctor 1 appointment (404 isolation)', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/doctors/${doc2Id}/appointments/${apptOfflineId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: 'CANCELLED' }),
      }
    );

    const res = await doctorAppointmentPATCH(req, {
      params: Promise.resolve({ doctorId: doc2Id, appointmentId: apptOfflineId }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Appointment not found');
  });
});
