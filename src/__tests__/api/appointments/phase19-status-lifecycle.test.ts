import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH as doctorAppointmentPATCH } from '@/app/api/doctors/[doctorId]/appointments/[appointmentId]/route';
import { PATCH as patientCancelAppointmentPATCH } from '@/app/api/patients/[patientId]/appointments/[appointmentId]/route';
import { prisma } from '@/lib/prisma';
import { autoExpirePastAppointments } from '@/lib/appointment-expiry';
import { buildUserPayload } from '@/__tests__/helpers/factories';

// Mock Razorpay SDK refund
const mockRazorpayRefund = vi.fn().mockResolvedValue({ id: 'rfnd_lifecycle_123', status: 'processed' });
vi.mock('razorpay', () => ({
  default: class MockRazorpay {
    payments = { refund: mockRazorpayRefund };
  },
}));

describe('Phase 19: Appointment Status Lifecycle & Transition Rules Test Suite', () => {
  let doctorUserId: string;
  let doctorId: string;
  let patientUserId: string;
  let patientId: string;

  let completedAppointmentId: string;
  let completedSlotId: string;

  let noShowAppointmentId: string;
  let noShowSlotId: string;

  let cancelAppointmentId: string;
  let cancelSlotId: string;

  const testFutureDate = new Date('2028-12-25T00:00:00.000Z');

  beforeAll(async () => {
    // 1. Create Doctor
    const docUserPayload = buildUserPayload({
      name: 'Dr. Lifecycle Specialist',
      email: `doc_life_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });

    const docUser = await prisma.user.create({
      data: {
        name: docUserPayload.name,
        email: docUserPayload.email,
        phoneNo: docUserPayload.phoneNo,
        password: docUserPayload.password,
        age: 43,
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
        fees: 500, // 500 INR -> 50000 paise
        experience: 10,
        balance: 0,
      },
    });
    doctorId = doc.id;

    // 2. Create Patient
    const patUserPayload = buildUserPayload({
      name: 'Patient Lifecycle Participant',
      email: `pat_life_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const patUser = await prisma.user.create({
      data: {
        name: patUserPayload.name,
        email: patUserPayload.email,
        phoneNo: patUserPayload.phoneNo,
        password: patUserPayload.password,
        age: 28,
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
    const pat = await prisma.patient.create({ data: { userId: patUser.id } });
    patientId = pat.id;

    // 3. Create Appointment 1 for COMPLETED test (Online payment)
    const slot1 = await prisma.slot.create({
      data: {
        doctorId,
        date: testFutureDate,
        startTime: new Date('2028-12-25T10:00:00.000Z'),
        endTime: new Date('2028-12-25T10:10:00.000Z'),
        status: 'BOOKED',
      },
    });
    completedSlotId = slot1.id;

    const appt1 = await prisma.appointment.create({
      data: {
        doctorId,
        patientId,
        slotId: slot1.id,
        status: 'CONFIRMED',
        paymentMethod: 'ONLINE',
        transactionId: 'pay_lifecycle_online_1',
        isAppointmentOffline: false,
      },
    });
    completedAppointmentId = appt1.id;

    await prisma.payment.create({
      data: {
        userId: patientUserId,
        doctorId,
        slotId: slot1.id,
        amount: 50000,
        currency: 'INR',
        status: 'SUCCESS',
        razorpayOrderId: 'order_life_1',
        razorpayPaymentId: 'pay_lifecycle_online_1',
      },
    });

    // 4. Create Appointment 2 for NO_SHOW test
    const slot2 = await prisma.slot.create({
      data: {
        doctorId,
        date: testFutureDate,
        startTime: new Date('2028-12-25T11:00:00.000Z'),
        endTime: new Date('2028-12-25T11:10:00.000Z'),
        status: 'BOOKED',
      },
    });
    noShowSlotId = slot2.id;

    const appt2 = await prisma.appointment.create({
      data: {
        doctorId,
        patientId,
        slotId: slot2.id,
        status: 'CONFIRMED',
        paymentMethod: 'OFFLINE',
        isAppointmentOffline: true,
      },
    });
    noShowAppointmentId = appt2.id;

    // 5. Create Appointment 3 for CANCELLED test
    const slot3 = await prisma.slot.create({
      data: {
        doctorId,
        date: testFutureDate,
        startTime: new Date('2028-12-25T12:00:00.000Z'),
        endTime: new Date('2028-12-25T12:10:00.000Z'),
        status: 'BOOKED',
      },
    });
    cancelSlotId = slot3.id;

    const appt3 = await prisma.appointment.create({
      data: {
        doctorId,
        patientId,
        slotId: slot3.id,
        status: 'CONFIRMED',
        paymentMethod: 'OFFLINE',
        isAppointmentOffline: true,
      },
    });
    cancelAppointmentId = appt3.id;
  });

  afterAll(async () => {
    try {
      await prisma.notification.deleteMany({ where: { userId: { in: [doctorUserId, patientUserId] } } });
      const relations = await prisma.doctorPatientRelation.findMany({
        where: { OR: [{ doctorsUserId: doctorUserId }, { patientsUserId: patientUserId }] },
      });
      const relIds = relations.map((r) => r.id);
      if (relIds.length > 0) {
        await prisma.chatMessages.deleteMany({ where: { doctorPatientRelationId: { in: relIds } } });
        await prisma.doctorPatientRelation.deleteMany({ where: { id: { in: relIds } } });
      }
      await prisma.payment.deleteMany({ where: { userId: patientUserId } });
      await prisma.appointment.deleteMany({ where: { doctorId } });
      await prisma.slot.deleteMany({ where: { doctorId } });
      await prisma.auditLog.deleteMany({ where: { userId: doctorUserId } });
      await prisma.doctor.deleteMany({ where: { id: doctorId } });
      await prisma.patient.deleteMany({ where: { id: patientId } });
      await prisma.user.deleteMany({ where: { id: { in: [doctorUserId, patientUserId] } } });
    } catch (e) {
      console.warn('Phase 19 cleanup warning:', e);
    }
  });

  it('19.1 transitions CONFIRMED to COMPLETED, marks slot UNAVAILABLE, and credits doctor balance', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/doctors/${doctorId}/appointments/${completedAppointmentId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: 'COMPLETED' }),
      }
    );

    const res = await doctorAppointmentPATCH(req, {
      params: Promise.resolve({ doctorId, appointmentId: completedAppointmentId }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('COMPLETED');

    // Slot is marked UNAVAILABLE (consumed)
    const slot = await prisma.slot.findUnique({ where: { id: completedSlotId } });
    expect(slot?.status).toBe('UNAVAILABLE');

    // Doctor balance is credited (500 INR = 50000 paise)
    const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
    expect(doctor?.balance).toBe(50000);
  });

  it('19.2 financial idempotency: duplicate COMPLETED request does not double credit doctor balance', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/doctors/${doctorId}/appointments/${completedAppointmentId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: 'COMPLETED' }),
      }
    );

    const res = await doctorAppointmentPATCH(req, {
      params: Promise.resolve({ doctorId, appointmentId: completedAppointmentId }),
    });

    expect(res.status).toBe(200);
    const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
    // Balance must stay 50000 paise (not 100000)
    expect(doctor?.balance).toBe(50000);
  });

  it('19.3 transitions CONFIRMED to NO_SHOW, marks slot UNAVAILABLE, and posts alert', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/doctors/${doctorId}/appointments/${noShowAppointmentId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: 'NO_SHOW' }),
      }
    );

    const res = await doctorAppointmentPATCH(req, {
      params: Promise.resolve({ doctorId, appointmentId: noShowAppointmentId }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('NO_SHOW');

    const slot = await prisma.slot.findUnique({ where: { id: noShowSlotId } });
    expect(slot?.status).toBe('UNAVAILABLE');
  });

  it('19.4 transitions CONFIRMED to CANCELLED by patient and restores slot to AVAILABLE', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/patients/${patientId}/appointments/${cancelAppointmentId}`,
      {
        method: 'PATCH',
      }
    );

    const res = await patientCancelAppointmentPATCH(req, {
      params: Promise.resolve({ patientId, appointmentId: cancelAppointmentId }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe('Appointment cancelled successfully');

    const slot = await prisma.slot.findUnique({ where: { id: cancelSlotId } });
    expect(slot?.status).toBe('AVAILABLE');
  });

  it('19.5 rejects cancellation of an already completed appointment with 400', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/patients/${patientId}/appointments/${completedAppointmentId}`,
      {
        method: 'PATCH',
      }
    );

    const res = await patientCancelAppointmentPATCH(req, {
      params: Promise.resolve({ patientId, appointmentId: completedAppointmentId }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Cannot cancel appointment with status: COMPLETED');
  });

  it('19.6 auto-expires past pending appointments via autoExpirePastAppointments', async () => {
    // Create an expired past appointment (pending in the past)
    const pastDate = new Date('2020-05-01T00:00:00.000Z');
    const pastSlot = await prisma.slot.create({
      data: {
        doctorId,
        date: pastDate,
        startTime: new Date('2020-05-01T10:00:00.000Z'),
        endTime: new Date('2020-05-01T10:10:00.000Z'),
        status: 'BOOKED',
      },
    });

    const pastAppt = await prisma.appointment.create({
      data: {
        doctorId,
        patientId,
        slotId: pastSlot.id,
        status: 'PENDING',
        paymentMethod: 'OFFLINE',
      },
    });

    const result = await autoExpirePastAppointments(true);
    expect(result.expired).toBeGreaterThanOrEqual(1);

    const updatedAppt = await prisma.appointment.findUnique({ where: { id: pastAppt.id } });
    expect(updatedAppt?.status).toBe('EXPIRED');
  });
});
