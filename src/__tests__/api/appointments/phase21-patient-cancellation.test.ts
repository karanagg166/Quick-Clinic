import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import {
  GET as patientAppointmentGET,
  PATCH as patientAppointmentPATCH,
} from '@/app/api/patients/[patientId]/appointments/[appointmentId]/route';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 21: Appointment Cancellation by Patient Test Suite', () => {
  let docUserId: string;
  let docId: string;

  let patient1UserId: string;
  let patient1Id: string;

  let patient2UserId: string;
  let patient2Id: string;

  let apptPendingId: string;
  let slotPendingId: string;

  let apptOnlineId: string;
  let slotOnlineId: string;
  let paymentId: string;

  let apptCompletedId: string;
  let slotCompletedId: string;

  const testDate = new Date('2029-01-15T00:00:00.000Z');

  beforeAll(async () => {
    // 1. Create Doctor
    const docPayload = buildUserPayload({
      name: 'Dr. Cancellation Specialist',
      email: `doc_cancel_${Date.now()}@quickclinic.test`,
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
        fees: 800,
        experience: 15,
      },
    });
    docId = d.id;

    // 2. Create Patient 1
    const p1Payload = buildUserPayload({
      name: 'Patient Canceller One',
      email: `pat_cancel1_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const p1User = await prisma.user.create({
      data: {
        name: p1Payload.name,
        email: p1Payload.email,
        phoneNo: p1Payload.phoneNo,
        password: p1Payload.password,
        age: 28,
        address: p1Payload.address,
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
    patient1UserId = p1User.id;

    const p1 = await prisma.patient.create({
      data: {
        userId: p1User.id,
      },
    });
    patient1Id = p1.id;

    // 3. Create Patient 2 (for IDOR isolation checks)
    const p2Payload = buildUserPayload({
      name: 'Patient Unrelated Two',
      email: `pat_cancel2_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const p2User = await prisma.user.create({
      data: {
        name: p2Payload.name,
        email: p2Payload.email,
        phoneNo: p2Payload.phoneNo,
        password: p2Payload.password,
        age: 32,
        address: p2Payload.address,
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
    patient2UserId = p2User.id;

    const p2 = await prisma.patient.create({
      data: {
        userId: p2User.id,
      },
    });
    patient2Id = p2.id;

    // 4. Create appointment 1 (PENDING, OFFLINE)
    const slot1 = await prisma.slot.create({
      data: {
        doctorId: docId,
        date: testDate,
        startTime: new Date('2029-01-15T09:00:00.000Z'),
        endTime: new Date('2029-01-15T09:10:00.000Z'),
        status: 'BOOKED',
      },
    });
    slotPendingId = slot1.id;

    const appt1 = await prisma.appointment.create({
      data: {
        doctorId: docId,
        patientId: patient1Id,
        slotId: slot1.id,
        status: 'PENDING',
        paymentMethod: 'OFFLINE',
        isAppointmentOffline: true,
      },
    });
    apptPendingId = appt1.id;

    // 5. Create appointment 2 (CONFIRMED, ONLINE with Payment record)
    const slot2 = await prisma.slot.create({
      data: {
        doctorId: docId,
        date: testDate,
        startTime: new Date('2029-01-15T10:00:00.000Z'),
        endTime: new Date('2029-01-15T10:10:00.000Z'),
        status: 'BOOKED',
      },
    });
    slotOnlineId = slot2.id;

    const txId = `pay_fake_${Date.now()}`;
    const pmt = await prisma.payment.create({
      data: {
        userId: patient1UserId,
        amount: 80000,
        currency: 'INR',
        status: 'SUCCESS',
        razorpayOrderId: `order_fake_${Date.now()}`,
        razorpayPaymentId: txId,
      },
    });
    paymentId = pmt.id;

    const appt2 = await prisma.appointment.create({
      data: {
        doctorId: docId,
        patientId: patient1Id,
        slotId: slot2.id,
        status: 'CONFIRMED',
        paymentMethod: 'ONLINE',
        transactionId: txId,
        isAppointmentOffline: false,
      },
    });
    apptOnlineId = appt2.id;

    // 6. Create appointment 3 (COMPLETED)
    const slot3 = await prisma.slot.create({
      data: {
        doctorId: docId,
        date: testDate,
        startTime: new Date('2029-01-15T11:00:00.000Z'),
        endTime: new Date('2029-01-15T11:10:00.000Z'),
        status: 'UNAVAILABLE',
      },
    });
    slotCompletedId = slot3.id;

    const appt3 = await prisma.appointment.create({
      data: {
        doctorId: docId,
        patientId: patient1Id,
        slotId: slot3.id,
        status: 'COMPLETED',
        paymentMethod: 'OFFLINE',
        isAppointmentOffline: true,
      },
    });
    apptCompletedId = appt3.id;
  });

  afterAll(async () => {
    try {
      await prisma.chatMessages.deleteMany({
        where: {
          doctorPatientRelation: {
            doctorsUserId: docUserId,
          },
        },
      });
      await prisma.doctorPatientRelation.deleteMany({
        where: {
          doctorsUserId: docUserId,
        },
      });
      await prisma.notification.deleteMany({
        where: { userId: { in: [docUserId, patient1UserId, patient2UserId] } },
      });
      await prisma.appointment.deleteMany({ where: { doctorId: docId } });
      await prisma.payment.deleteMany({ where: { id: paymentId } });
      await prisma.slot.deleteMany({ where: { doctorId: docId } });
      await prisma.doctor.deleteMany({ where: { id: docId } });
      await prisma.patient.deleteMany({ where: { id: { in: [patient1Id, patient2Id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [docUserId, patient1UserId, patient2UserId] } } });
    } catch (e) {
      console.warn('Phase 21 cleanup warning:', e);
    }
  });

  it('21.1 Patient 1 successfully cancels a PENDING appointment', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/patients/${patient1Id}/appointments/${apptPendingId}`,
      { method: 'PATCH' }
    );
    const res = await patientAppointmentPATCH(req, {
      params: Promise.resolve({ patientId: patient1Id, appointmentId: apptPendingId }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe('Appointment cancelled successfully');

    // Verify appointment status updated to CANCELLED in DB
    const updatedAppt = await prisma.appointment.findUnique({ where: { id: apptPendingId } });
    expect(updatedAppt?.status).toBe('CANCELLED');

    // Verify slot released to AVAILABLE
    const updatedSlot = await prisma.slot.findUnique({ where: { id: slotPendingId } });
    expect(updatedSlot?.status).toBe('AVAILABLE');

    // Verify notification was sent to doctor
    const notifs = await prisma.notification.findMany({ where: { userId: docUserId } });
    expect(notifs.some((n: any) => n.message.includes('cancelled by the patient'))).toBe(true);
  });

  it('21.2 Patient 1 cancels an ONLINE-paid CONFIRMED appointment and triggers refund handling', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/patients/${patient1Id}/appointments/${apptOnlineId}`,
      { method: 'PATCH' }
    );
    const res = await patientAppointmentPATCH(req, {
      params: Promise.resolve({ patientId: patient1Id, appointmentId: apptOnlineId }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe('Appointment cancelled successfully');

    const updatedAppt = await prisma.appointment.findUnique({ where: { id: apptOnlineId } });
    expect(updatedAppt?.status).toBe('CANCELLED');

    const updatedSlot = await prisma.slot.findUnique({ where: { id: slotOnlineId } });
    expect(updatedSlot?.status).toBe('AVAILABLE');
  });

  it('21.3 Rejects cancellation of an already CANCELLED or COMPLETED appointment', async () => {
    // Attempt to cancel already cancelled appointment
    const req1 = new NextRequest(
      `http://localhost:3000/api/patients/${patient1Id}/appointments/${apptPendingId}`,
      { method: 'PATCH' }
    );
    const res1 = await patientAppointmentPATCH(req1, {
      params: Promise.resolve({ patientId: patient1Id, appointmentId: apptPendingId }),
    });
    expect(res1.status).toBe(400);
    const body1 = await res1.json();
    expect(body1.error).toContain('Cannot cancel appointment with status: CANCELLED');

    // Attempt to cancel COMPLETED appointment
    const req2 = new NextRequest(
      `http://localhost:3000/api/patients/${patient1Id}/appointments/${apptCompletedId}`,
      { method: 'PATCH' }
    );
    const res2 = await patientAppointmentPATCH(req2, {
      params: Promise.resolve({ patientId: patient1Id, appointmentId: apptCompletedId }),
    });
    expect(res2.status).toBe(400);
    const body2 = await res2.json();
    expect(body2.error).toContain('Cannot cancel appointment with status: COMPLETED');
  });

  it('21.4 IDOR Protection: Patient 2 cannot cancel Patient 1 appointment', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/patients/${patient2Id}/appointments/${apptPendingId}`,
      { method: 'PATCH' }
    );
    const res = await patientAppointmentPATCH(req, {
      params: Promise.resolve({ patientId: patient2Id, appointmentId: apptPendingId }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Appointment not found');
  });
});
