import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/logger';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 48: Admin Doctor Management & Moderation Test Suite', () => {
  let adminUserId: string;
  let docUserId: string;
  let docId: string;
  let patientUserId: string;
  let patientId: string;
  let slotId: string;
  let apptId: string;

  beforeAll(async () => {
    // 1. Admin
    const adminPayload = buildUserPayload({
      name: 'Admin Doc Manager',
      email: `admin_doc_${Date.now()}@quickclinic.test`,
      role: 'ADMIN',
    });
    const adminUser = await prisma.user.create({
      data: {
        name: adminPayload.name,
        email: adminPayload.email,
        phoneNo: adminPayload.phoneNo,
        password: adminPayload.password,
        age: 46,
        address: adminPayload.address,
        role: 'ADMIN',
        gender: 'MALE',
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    adminUserId = adminUser.id;
    await prisma.admin.create({ data: { userId: adminUserId } });

    // 2. Doctor
    const docPayload = buildUserPayload({
      name: 'Dr. Moderated Physician',
      email: `doc_moderate_${Date.now()}@quickclinic.test`,
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
        userId: docUserId,
        specialty: 'RHEUMATOLOGIST',
        fees: 1400,
        experience: 22,
        doctorBio: 'Expert in clinical rheumatology and joint disorders.',
        doctorQualifications: {
          create: [{ qualification: 'MBBS' }, { qualification: 'MD' }],
        },
      },
    });
    docId = d.id;

    // 3. Patient with an existing booked appointment
    const patPayload = buildUserPayload({
      name: 'Patient Under Mod Doc',
      email: `pat_moddoc_${Date.now()}@quickclinic.test`,
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

    const p = await prisma.patient.create({ data: { userId: patientUserId } });
    patientId = p.id;

    const slot = await prisma.slot.create({
      data: {
        doctorId: docId,
        date: new Date('2026-09-01T00:00:00Z'),
        startTime: new Date('2026-09-01T10:00:00Z'),
        endTime: new Date('2026-09-01T10:30:00Z'),
        status: 'BOOKED',
      },
    });
    slotId = slot.id;

    const appt = await prisma.appointment.create({
      data: {
        doctorId: docId,
        patientId,
        slotId: slot.id,
        status: 'CONFIRMED',
        paymentMethod: 'ONLINE',
      },
    });
    apptId = appt.id;
  });

  afterAll(async () => {
    try {
      await prisma.appointment.deleteMany({ where: { id: apptId } });
      await prisma.slot.deleteMany({ where: { id: slotId } });
      await prisma.patient.deleteMany({ where: { id: patientId } });
      await prisma.doctorQualification.deleteMany({ where: { doctorId: docId } });
      await prisma.doctor.deleteMany({ where: { id: docId } });
      await prisma.admin.deleteMany({ where: { userId: adminUserId } });
      await prisma.auditLog.deleteMany({ where: { userId: adminUserId } });
      await prisma.user.deleteMany({
        where: { id: { in: [adminUserId, docUserId, patientUserId] } },
      });
    } catch (e) {
      console.warn('Phase 48 cleanup warning:', e);
    }
  });

  it('48.1 Admin views doctor complete profile with qualifications and practice details', async () => {
    const doctorData = await prisma.doctor.findUnique({
      where: { id: docId },
      include: {
        user: {
          select: { name: true, email: true, phoneNo: true, isActive: true },
        },
        doctorQualifications: true,
      },
    });

    expect(doctorData).toBeDefined();
    expect(doctorData?.specialty).toBe('RHEUMATOLOGIST');
    expect(doctorData?.fees).toBe(1400);
    expect(doctorData?.doctorQualifications.length).toBe(2);
    expect(doctorData?.user.isActive).toBe(true);
  });

  it('48.2 Admin disables doctor (isActive = false) and creates audit trail', async () => {
    await prisma.user.update({
      where: { id: docUserId },
      data: { isActive: false },
    });

    await logAudit(adminUserId, 'DOCTOR_SUSPENDED', {
      doctorId: docId,
      docUserId,
      reason: 'License verification check pending',
    }, 'ADMIN');

    const updatedUser = await prisma.user.findUnique({ where: { id: docUserId } });
    expect(updatedUser?.isActive).toBe(false);

    const auditLog = await prisma.auditLog.findFirst({
      where: { userId: adminUserId, action: 'DOCTOR_SUSPENDED' },
    });
    expect(auditLog).toBeDefined();
    expect(auditLog?.tag).toBe('ADMIN');
  });

  it('48.3 Disabling doctor preserves existing booked appointments intact without loss of integrity', async () => {
    const existingAppt = await prisma.appointment.findUnique({
      where: { id: apptId },
      include: { slot: true },
    });

    expect(existingAppt).toBeDefined();
    expect(existingAppt?.status).toBe('CONFIRMED');
    expect(existingAppt?.slot.status).toBe('BOOKED');
  });

  it('48.4 Admin re-enables doctor account (isActive = true)', async () => {
    await prisma.user.update({
      where: { id: docUserId },
      data: { isActive: true },
    });

    await logAudit(adminUserId, 'DOCTOR_REINSTATED', { doctorId: docId }, 'ADMIN');

    const user = await prisma.user.findUnique({ where: { id: docUserId } });
    expect(user?.isActive).toBe(true);
  });
});
