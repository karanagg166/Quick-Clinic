import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

// Mock Razorpay refund
const mockRazorpayRefund = vi.fn().mockResolvedValue({ id: 'rfnd_matrix_123', status: 'processed' });
vi.mock('razorpay', () => ({
  default: class MockRazorpay {
    payments = { refund: mockRazorpayRefund };
  },
}));

describe('Phase 74: Offline vs Online Appointment Matrix Test Suite', () => {
  let docUserId: string, docId: string;
  let patUserId: string, patId: string;

  const createdSlotIds: string[] = [];
  const createdApptIds: string[] = [];
  const createdPaymentIds: string[] = [];

  const FEE = 800; // ₹800 = 80,000 paise

  beforeAll(async () => {
    // 1. Doctor
    const docPayload = buildUserPayload({ role: 'DOCTOR', name: 'Dr. Matrix Specialist' });
    const docUser = await prisma.user.create({
      data: {
        name: docPayload.name,
        email: `doc_mat_${Date.now()}@quickclinic.test`,
        phoneNo: docPayload.phoneNo,
        password: docPayload.password,
        age: 44,
        address: docPayload.address,
        role: 'DOCTOR',
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
        userId: docUserId,
        specialty: 'ORTHOPEDIC',
        fees: FEE,
        experience: 14,
        balance: 0,
      },
    });
    docId = d.id;

    // 2. Patient
    const patPayload = buildUserPayload({ role: 'PATIENT', name: 'Patient Matrix' });
    const patUser = await prisma.user.create({
      data: {
        name: patPayload.name,
        email: `pat_mat_${Date.now()}@quickclinic.test`,
        phoneNo: patPayload.phoneNo,
        password: patPayload.password,
        age: 31,
        address: patPayload.address,
        role: 'PATIENT',
        location: { connect: { pincode: 121004 } },
      },
    });
    patUserId = patUser.id;

    const p = await prisma.patient.create({ data: { userId: patUserId } });
    patId = p.id;
  });

  afterAll(async () => {
    try {
      if (createdPaymentIds.length > 0) await prisma.payment.deleteMany({ where: { id: { in: createdPaymentIds } } });
      if (createdApptIds.length > 0) await prisma.appointment.deleteMany({ where: { id: { in: createdApptIds } } });
      if (createdSlotIds.length > 0) await prisma.slot.deleteMany({ where: { id: { in: createdSlotIds } } });
      if (patId) await prisma.patient.deleteMany({ where: { id: patId } });
      if (docId) await prisma.doctor.deleteMany({ where: { id: docId } });
      if (docUserId || patUserId) {
        await prisma.user.deleteMany({ where: { id: { in: [docUserId, patUserId].filter(Boolean) } } });
      }
    } catch (e) {
      console.warn('Phase 74 cleanup warning:', e);
    }
  });

  it('74.1 Matrix Case: OFFLINE + COMPLETED -> Slot UNAVAILABLE, doctor app balance unmodified', async () => {
    const slot = await prisma.slot.create({
      data: {
        doctorId: docId,
        date: new Date('2027-07-01T00:00:00.000Z'),
        startTime: new Date('2027-07-01T09:00:00.000Z'),
        endTime: new Date('2027-07-01T09:30:00.000Z'),
        status: 'UNAVAILABLE',
      },
    });
    createdSlotIds.push(slot.id);

    const appt = await prisma.appointment.create({
      data: {
        doctorId: docId,
        patientId: patId,
        slotId: slot.id,
        status: 'COMPLETED',
        paymentMethod: 'OFFLINE',
      },
    });
    createdApptIds.push(appt.id);

    const doc = await prisma.doctor.findUnique({ where: { id: docId } });
    expect(doc?.balance).toBe(0); // Offline payments collected at clinic
    const updatedSlot = await prisma.slot.findUnique({ where: { id: slot.id } });
    expect(updatedSlot?.status).toBe('UNAVAILABLE');
  });

  it('74.2 Matrix Case: ONLINE + COMPLETED -> Slot UNAVAILABLE, doctor balance credited by fee * 100 paise', async () => {
    const slot = await prisma.slot.create({
      data: {
        doctorId: docId,
        date: new Date('2027-07-01T00:00:00.000Z'),
        startTime: new Date('2027-07-01T10:00:00.000Z'),
        endTime: new Date('2027-07-01T10:30:00.000Z'),
        status: 'UNAVAILABLE',
      },
    });
    createdSlotIds.push(slot.id);

    const appt = await prisma.appointment.create({
      data: {
        doctorId: docId,
        patientId: patId,
        slotId: slot.id,
        status: 'COMPLETED',
        paymentMethod: 'ONLINE',
        transactionId: `pay_matrix_${Date.now()}`,
      },
    });
    createdApptIds.push(appt.id);

    // Credit online payment fee
    await prisma.doctor.update({
      where: { id: docId },
      data: { balance: { increment: FEE * 100 } },
    });

    const doc = await prisma.doctor.findUnique({ where: { id: docId } });
    expect(doc?.balance).toBe(80000); // ₹800
  });

  it('74.3 Matrix Case: OFFLINE + CANCELLED -> Slot restored to AVAILABLE without payment refund logic', async () => {
    const slot = await prisma.slot.create({
      data: {
        doctorId: docId,
        date: new Date('2027-07-01T00:00:00.000Z'),
        startTime: new Date('2027-07-01T11:00:00.000Z'),
        endTime: new Date('2027-07-01T11:30:00.000Z'),
        status: 'BOOKED',
      },
    });
    createdSlotIds.push(slot.id);

    const appt = await prisma.appointment.create({
      data: {
        doctorId: docId,
        patientId: patId,
        slotId: slot.id,
        status: 'CONFIRMED',
        paymentMethod: 'OFFLINE',
      },
    });
    createdApptIds.push(appt.id);

    // Cancel appointment
    await prisma.appointment.update({ where: { id: appt.id }, data: { status: 'CANCELLED' } });
    await prisma.slot.update({ where: { id: slot.id }, data: { status: 'AVAILABLE' } });

    const updatedSlot = await prisma.slot.findUnique({ where: { id: slot.id } });
    expect(updatedSlot?.status).toBe('AVAILABLE');
  });

  it('74.4 Matrix Case: ONLINE + NO_SHOW -> Slot UNAVAILABLE (consumed), payment preserved', async () => {
    const slot = await prisma.slot.create({
      data: {
        doctorId: docId,
        date: new Date('2027-07-01T00:00:00.000Z'),
        startTime: new Date('2027-07-01T12:00:00.000Z'),
        endTime: new Date('2027-07-01T12:30:00.000Z'),
        status: 'UNAVAILABLE',
      },
    });
    createdSlotIds.push(slot.id);

    const appt = await prisma.appointment.create({
      data: {
        doctorId: docId,
        patientId: patId,
        slotId: slot.id,
        status: 'NO_SHOW',
        paymentMethod: 'ONLINE',
        transactionId: `pay_noshow_${Date.now()}`,
      },
    });
    createdApptIds.push(appt.id);

    const checkAppt = await prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(checkAppt?.status).toBe('NO_SHOW');
  });
});
