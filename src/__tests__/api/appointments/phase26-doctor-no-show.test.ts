import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH as doctorAppointmentPATCH } from '@/app/api/doctors/[doctorId]/appointments/[appointmentId]/route';
import { PATCH as patientAppointmentPATCH } from '@/app/api/patients/[patientId]/appointments/[appointmentId]/route';
import { autoExpirePastAppointments } from '@/lib/appointment-expiry';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 26: Doctor No-Show & Unfulfilled Appointment Handling Test Suite', () => {
  let docUserId: string;
  let docId: string;

  let patientUserId: string;
  let patientId: string;

  let apptDoctorCancelId: string;
  let slotDoctorCancelId: string;
  let paymentDoctorCancelId: string;

  let apptExpiredId: string;
  let slotExpiredId: string;

  beforeAll(async () => {
    // 1. Create Doctor
    const docPayload = buildUserPayload({
      name: 'Dr. Absent Subject',
      email: `doc_absent_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const docUser = await prisma.user.create({
      data: {
        name: docPayload.name,
        email: docPayload.email,
        phoneNo: docPayload.phoneNo,
        password: docPayload.password,
        age: 52,
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
        specialty: 'GENERAL_PHYSICIAN',
        fees: 600,
        experience: 18,
        balance: 0,
      },
    });
    docId = d.id;

    // 2. Create Patient
    const patPayload = buildUserPayload({
      name: 'Patient DoctorNoShow Subject',
      email: `pat_docnoshow_${Date.now()}@quickclinic.test`,
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

    const pat = await prisma.patient.create({
      data: {
        userId: patUser.id,
      },
    });
    patientId = pat.id;

    // 3. Online appointment cancelled when doctor cannot attend
    const slot1 = await prisma.slot.create({
      data: {
        doctorId: docId,
        date: new Date('2029-06-10T00:00:00.000Z'),
        startTime: new Date('2029-06-10T10:00:00.000Z'),
        endTime: new Date('2029-06-10T10:10:00.000Z'),
        status: 'BOOKED',
      },
    });
    slotDoctorCancelId = slot1.id;

    const txId = `pay_docnoshow_${Date.now()}`;
    const pmt = await prisma.payment.create({
      data: {
        userId: patientUserId,
        amount: 60000,
        currency: 'INR',
        status: 'SUCCESS',
        razorpayOrderId: `order_docnoshow_${Date.now()}`,
        razorpayPaymentId: txId,
      },
    });
    paymentDoctorCancelId = pmt.id;

    const appt1 = await prisma.appointment.create({
      data: {
        doctorId: docId,
        patientId,
        slotId: slot1.id,
        status: 'CONFIRMED',
        paymentMethod: 'ONLINE',
        transactionId: txId,
        isAppointmentOffline: false,
      },
    });
    apptDoctorCancelId = appt1.id;

    // 4. Past unfulfilled appointment (date in the past)
    const pastDate = new Date('2020-05-01T00:00:00.000Z');
    const slot2 = await prisma.slot.create({
      data: {
        doctorId: docId,
        date: pastDate,
        startTime: new Date('2020-05-01T09:00:00.000Z'),
        endTime: new Date('2020-05-01T09:10:00.000Z'),
        status: 'BOOKED',
      },
    });
    slotExpiredId = slot2.id;

    const appt2 = await prisma.appointment.create({
      data: {
        doctorId: docId,
        patientId,
        slotId: slot2.id,
        status: 'CONFIRMED',
        paymentMethod: 'OFFLINE',
        isAppointmentOffline: true,
      },
    });
    apptExpiredId = appt2.id;
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
        where: { userId: { in: [docUserId, patientUserId] } },
      });
      await prisma.appointment.deleteMany({ where: { doctorId: docId } });
      await prisma.payment.deleteMany({ where: { id: paymentDoctorCancelId } });
      await prisma.slot.deleteMany({ where: { doctorId: docId } });
      await prisma.doctor.deleteMany({ where: { id: docId } });
      await prisma.patient.deleteMany({ where: { id: patientId } });
      await prisma.user.deleteMany({ where: { id: { in: [docUserId, patientUserId] } } });
    } catch (e) {
      console.warn('Phase 26 cleanup warning:', e);
    }
  });

  it('26.1 Verifies schema modeling: appointment cancellation handles doctor absence and preserves doctor zero balance', async () => {
    const docBefore = await prisma.doctor.findUnique({ where: { id: docId } });
    expect(docBefore?.balance).toBe(0);

    // Cancel appointment on behalf of doctor
    const req = new NextRequest(
      `http://localhost:3000/api/doctors/${docId}/appointments/${apptDoctorCancelId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: 'CANCELLED' }),
      }
    );

    const res = await doctorAppointmentPATCH(req, {
      params: Promise.resolve({ doctorId: docId, appointmentId: apptDoctorCancelId }),
    });

    expect(res.status).toBe(200);

    const appt = await prisma.appointment.findUnique({ where: { id: apptDoctorCancelId } });
    expect(appt?.status).toBe('CANCELLED');

    // Doctor balance must NOT be credited
    const docAfter = await prisma.doctor.findUnique({ where: { id: docId } });
    expect(docAfter?.balance).toBe(0);
  });

  it('26.2 Unfulfilled past appointment is auto-expired by background job without doctor balance credit', async () => {
    // Run auto-expire
    const result = await autoExpirePastAppointments(true);
    expect(result.expired).toBeGreaterThanOrEqual(1);

    const appt = await prisma.appointment.findUnique({ where: { id: apptExpiredId } });
    expect(appt?.status).toBe('EXPIRED');

    // Slot is released back to AVAILABLE
    const slot = await prisma.slot.findUnique({ where: { id: slotExpiredId } });
    expect(slot?.status).toBe('AVAILABLE');

    // Doctor balance remains 0
    const doc = await prisma.doctor.findUnique({ where: { id: docId } });
    expect(doc?.balance).toBe(0);
  });
});
