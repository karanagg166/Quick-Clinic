import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 69: User Deactivation, Compliance & Financial Audit Retention Test Suite', () => {
  let docUserId: string;
  let docId: string;
  let patientUserId: string;
  let patientId: string;
  let slotId: string;
  let apptId: string;
  let paymentId: string;
  let auditLogId: string;

  beforeAll(async () => {
    // 1. Doctor
    const docPayload = buildUserPayload({
      name: 'Dr. Retained Doctor',
      email: `doc_retained_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const docUser = await prisma.user.create({
      data: {
        name: docPayload.name,
        email: docPayload.email,
        phoneNo: docPayload.phoneNo,
        password: docPayload.password,
        age: 48,
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
        specialty: 'RHEUMATOLOGIST',
        fees: 850,
        experience: 18,
      },
    });
    docId = d.id;

    // 2. Patient
    const patPayload = buildUserPayload({
      name: 'Patient Retained Patient',
      email: `pat_retained_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const patUser = await prisma.user.create({
      data: {
        name: patPayload.name,
        email: patPayload.email,
        phoneNo: patPayload.phoneNo,
        password: patPayload.password,
        age: 32,
        address: patPayload.address,
        role: 'PATIENT',
        location: { connect: { pincode: 121004 } },
      },
    });
    patientUserId = patUser.id;

    const p = await prisma.patient.create({ data: { userId: patientUserId } });
    patientId = p.id;

    // 3. Slot & Appointment
    const slot = await prisma.slot.create({
      data: {
        doctorId: docId,
        date: new Date('2027-02-15T00:00:00.000Z'),
        startTime: new Date('2027-02-15T11:00:00.000Z'),
        endTime: new Date('2027-02-15T11:30:00.000Z'),
        status: 'UNAVAILABLE',
      },
    });
    slotId = slot.id;

    const appt = await prisma.appointment.create({
      data: {
        doctorId: docId,
        patientId,
        slotId: slot.id,
        status: 'COMPLETED',
        paymentMethod: 'ONLINE',
      },
    });
    apptId = appt.id;

    // 4. Payment record
    const payment = await prisma.payment.create({
      data: {
        userId: patientUserId,
        doctorId: docId,
        slotId: slot.id,
        amount: 85000,
        status: 'SUCCESS',
        razorpayOrderId: `order_retained_${Date.now()}`,
        razorpayPaymentId: `pay_retained_${Date.now()}`,
      },
    });
    paymentId = payment.id;

    // 5. Audit Log record
    const audit = await prisma.auditLog.create({
      data: {
        userId: docUserId,
        action: 'DOCTOR_ONBOARDING',
        tag: 'ONBOARDING',
      },
    });
    auditLogId = audit.id;
  });

  afterAll(async () => {
    try {
      if (auditLogId) await prisma.auditLog.deleteMany({ where: { id: auditLogId } });
      if (paymentId) await prisma.payment.deleteMany({ where: { id: paymentId } });
      if (apptId) await prisma.appointment.deleteMany({ where: { id: apptId } });
      if (slotId) await prisma.slot.deleteMany({ where: { id: slotId } });
      if (patientId) await prisma.patient.deleteMany({ where: { id: patientId } });
      if (docId) await prisma.doctor.deleteMany({ where: { id: docId } });
      if (docUserId || patientUserId) {
        await prisma.user.deleteMany({ where: { id: { in: [docUserId, patientUserId].filter(Boolean) } } });
      }
    } catch (e) {
      console.warn('Phase 69 cleanup warning:', e);
    }
  });

  it('69.1 Soft-deactivating doctor account preserves appointments and historical clinical records', async () => {
    // Deactivate doctor
    await prisma.user.update({
      where: { id: docUserId },
      data: { isActive: false },
    });

    const updatedUser = await prisma.user.findUnique({ where: { id: docUserId } });
    expect(updatedUser?.isActive).toBe(false);

    // Verify appointment remains intact
    const appt = await prisma.appointment.findUnique({ where: { id: apptId } });
    expect(appt).not.toBeNull();
    expect(appt?.status).toBe('COMPLETED');
    expect(appt?.doctorId).toBe(docId);
  });

  it('69.2 Soft-deactivating patient preserves payment financial ledger for accounting compliance', async () => {
    // Deactivate patient
    await prisma.user.update({
      where: { id: patientUserId },
      data: { isActive: false },
    });

    const patUser = await prisma.user.findUnique({ where: { id: patientUserId } });
    expect(patUser?.isActive).toBe(false);

    // Verify payment record is preserved
    const pmt = await prisma.payment.findUnique({ where: { id: paymentId } });
    expect(pmt).not.toBeNull();
    expect(pmt?.amount).toBe(85000);
    expect(pmt?.status).toBe('SUCCESS');
  });

  it('69.3 Audit log entries remain permanently preserved after account deactivation', async () => {
    const audit = await prisma.auditLog.findUnique({ where: { id: auditLogId } });
    expect(audit).not.toBeNull();
    expect(audit?.userId).toBe(docUserId);
    expect(audit?.action).toBe('DOCTOR_ONBOARDING');
  });
});
