import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/logger';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 47: Admin User Management & Moderation Test Suite', () => {
  let adminUserId: string;
  let testPatientUserId: string;
  let testDoctorUserId: string;
  let testDoctorId: string;

  beforeAll(async () => {
    // 1. Admin
    const adminPayload = buildUserPayload({
      name: 'Admin User Manager',
      email: `admin_mgr_${Date.now()}@quickclinic.test`,
      role: 'ADMIN',
    });
    const adminUser = await prisma.user.create({
      data: {
        name: adminPayload.name,
        email: adminPayload.email,
        phoneNo: adminPayload.phoneNo,
        password: adminPayload.password,
        age: 43,
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

    // 2. Patient
    const patPayload = buildUserPayload({
      name: 'Patient To Moderate',
      email: `pat_mod_${Date.now()}@quickclinic.test`,
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
        gender: 'FEMALE',
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    testPatientUserId = patUser.id;
    await prisma.patient.create({ data: { userId: testPatientUserId } });

    // 3. Doctor
    const docPayload = buildUserPayload({
      name: 'Dr. To Moderate',
      email: `doc_mod_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const docUser = await prisma.user.create({
      data: {
        name: docPayload.name,
        email: docPayload.email,
        phoneNo: docPayload.phoneNo,
        password: docPayload.password,
        age: 50,
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
    testDoctorUserId = docUser.id;

    const d = await prisma.doctor.create({
      data: {
        userId: testDoctorUserId,
        specialty: 'PSYCHOLOGIST',
        fees: 900,
        experience: 12,
      },
    });
    testDoctorId = d.id;
  });

  afterAll(async () => {
    try {
      await prisma.auditLog.deleteMany({ where: { userId: adminUserId } });
      await prisma.doctor.deleteMany({ where: { id: testDoctorId } });
      await prisma.patient.deleteMany({ where: { userId: testPatientUserId } });
      await prisma.admin.deleteMany({ where: { userId: adminUserId } });
      await prisma.user.deleteMany({
        where: { id: { in: [adminUserId, testPatientUserId, testDoctorUserId] } },
      });
    } catch (e) {
      console.warn('Phase 47 cleanup warning:', e);
    }
  });

  it('47.1 Lists users filtered by role accurately', async () => {
    const doctors = await prisma.user.findMany({
      where: { role: 'DOCTOR', id: testDoctorUserId },
      include: { doctor: true },
    });
    expect(doctors.length).toBe(1);
    expect(doctors[0].role).toBe('DOCTOR');
    expect(doctors[0].doctor).toBeDefined();

    const patients = await prisma.user.findMany({
      where: { role: 'PATIENT', id: testPatientUserId },
      include: { patient: true },
    });
    expect(patients.length).toBe(1);
    expect(patients[0].role).toBe('PATIENT');
  });

  it('47.2 Admin deactivates a user account (sets isActive = false) and creates audit log', async () => {
    const updated = await prisma.user.update({
      where: { id: testPatientUserId },
      data: { isActive: false },
    });
    expect(updated.isActive).toBe(false);

    await logAudit(adminUserId, 'USER_DEACTIVATED', {
      targetUserId: testPatientUserId,
      reason: 'Administrative moderation action',
    }, 'ADMIN');

    const logs = await prisma.auditLog.findMany({
      where: { userId: adminUserId, action: 'USER_DEACTIVATED' },
    });
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });

  it('47.3 Admin reactivates a user account (sets isActive = true)', async () => {
    const updated = await prisma.user.update({
      where: { id: testPatientUserId },
      data: { isActive: true },
    });
    expect(updated.isActive).toBe(true);

    await logAudit(adminUserId, 'USER_REACTIVATED', {
      targetUserId: testPatientUserId,
    }, 'ADMIN');
  });

  it('47.4 Querying user records for admin views securely selects only non-sensitive fields', async () => {
    const userSafeView = await prisma.user.findUnique({
      where: { id: testDoctorUserId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        doctor: {
          select: {
            id: true,
            specialty: true,
            fees: true,
            experience: true,
          },
        },
      },
    });

    expect(userSafeView).toBeDefined();
    expect(userSafeView?.id).toBe(testDoctorUserId);
    expect((userSafeView as any).password).toBeUndefined();
  });
});
