import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { buildUserPayload, buildBankAccountPayload } from '@/__tests__/helpers/factories';

describe('Phase 68: Database Schema Integrity & Relational Invariants Test Suite', () => {
  let createdUserIds: string[] = [];
  let createdDocIds: string[] = [];
  let createdPatientIds: string[] = [];
  let createdSlotIds: string[] = [];
  let createdApptIds: string[] = [];

  afterAll(async () => {
    try {
      if (createdApptIds.length > 0) {
        await prisma.appointment.deleteMany({ where: { id: { in: createdApptIds } } });
      }
      if (createdSlotIds.length > 0) {
        await prisma.slot.deleteMany({ where: { id: { in: createdSlotIds } } });
      }
      if (createdPatientIds.length > 0) {
        await prisma.patient.deleteMany({ where: { id: { in: createdPatientIds } } });
      }
      if (createdDocIds.length > 0) {
        await prisma.doctor.deleteMany({ where: { id: { in: createdDocIds } } });
      }
      if (createdUserIds.length > 0) {
        await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      }
    } catch (e) {
      console.warn('Phase 68 cleanup warning:', e);
    }
  });

  it('68.1 Enforces User email uniqueness constraint at database level', async () => {
    const payload = buildUserPayload({ email: `unique_email_${Date.now()}@quickclinic.test` });
    const user1 = await prisma.user.create({
      data: {
        name: payload.name,
        email: payload.email,
        phoneNo: payload.phoneNo,
        password: payload.password,
        age: 35,
        address: payload.address,
        role: 'PATIENT',
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    createdUserIds.push(user1.id);

    // Attempt duplicate email creation
    await expect(
      prisma.user.create({
        data: {
          name: 'Duplicate User',
          email: payload.email, // duplicate
          phoneNo: '9999988888',
          password: 'Password123!',
          age: 40,
          address: 'Duplicate Address',
          role: 'PATIENT',
          location: { connect: { pincode: 121004 } },
        },
      })
    ).rejects.toThrow();
  });

  it('68.2 Enforces 1:1 Doctor-to-User relationship (userId uniqueness)', async () => {
    const docUserPayload = buildUserPayload({ role: 'DOCTOR' });
    const docUser = await prisma.user.create({
      data: {
        name: docUserPayload.name,
        email: docUserPayload.email,
        phoneNo: docUserPayload.phoneNo,
        password: docUserPayload.password,
        age: 45,
        address: docUserPayload.address,
        role: 'DOCTOR',
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    createdUserIds.push(docUser.id);

    const doc1 = await prisma.doctor.create({
      data: {
        userId: docUser.id,
        specialty: 'NEPHROLOGIST',
        fees: 700,
        experience: 12,
      },
    });
    createdDocIds.push(doc1.id);

    // Attempt second Doctor record for same userId
    await expect(
      prisma.doctor.create({
        data: {
          userId: docUser.id, // Duplicate doctor record for same user
          specialty: 'CARDIOLOGIST',
          fees: 900,
        },
      })
    ).rejects.toThrow();
  });

  it('68.3 Enforces DoctorQualification composite uniqueness ([doctorId, qualification])', async () => {
    const docId = createdDocIds[0];
    await prisma.doctorQualification.create({
      data: {
        doctorId: docId,
        qualification: 'MBBS',
      },
    });

    // Attempt duplicate MBBS qualification for same doctor
    await expect(
      prisma.doctorQualification.create({
        data: {
          doctorId: docId,
          qualification: 'MBBS',
        },
      })
    ).rejects.toThrow();
  });

  it('68.4 Enforces Slot uniqueness per Doctor at specific date & startTime ([doctorId, date, startTime])', async () => {
    const docId = createdDocIds[0];
    const slotDate = new Date('2027-05-10T00:00:00.000Z');
    const slotStartTime = new Date('2027-05-10T10:00:00.000Z');
    const slotEndTime = new Date('2027-05-10T10:30:00.000Z');

    const slot1 = await prisma.slot.create({
      data: {
        doctorId: docId,
        date: slotDate,
        startTime: slotStartTime,
        endTime: slotEndTime,
        status: 'AVAILABLE',
      },
    });
    createdSlotIds.push(slot1.id);

    // Attempt creating identical slot (same doctor, same date, same start time)
    await expect(
      prisma.slot.create({
        data: {
          doctorId: docId,
          date: slotDate,
          startTime: slotStartTime,
          endTime: slotEndTime,
          status: 'AVAILABLE',
        },
      })
    ).rejects.toThrow();
  });

  it('68.5 Enforces 1:1 Appointment-to-Slot relationship (slotId uniqueness)', async () => {
    const docId = createdDocIds[0];
    const slotId = createdSlotIds[0];

    // Create a test patient
    const patPayload = buildUserPayload({ role: 'PATIENT' });
    const patUser = await prisma.user.create({
      data: {
        name: patPayload.name,
        email: patPayload.email,
        phoneNo: patPayload.phoneNo,
        password: patPayload.password,
        age: 28,
        address: patPayload.address,
        role: 'PATIENT',
        location: { connect: { pincode: 121004 } },
      },
    });
    createdUserIds.push(patUser.id);

    const pat = await prisma.patient.create({ data: { userId: patUser.id } });
    createdPatientIds.push(pat.id);

    const appt1 = await prisma.appointment.create({
      data: {
        doctorId: docId,
        patientId: pat.id,
        slotId: slotId,
        status: 'CONFIRMED',
      },
    });
    createdApptIds.push(appt1.id);

    // Attempt second appointment referencing the same slotId
    await expect(
      prisma.appointment.create({
        data: {
          doctorId: docId,
          patientId: pat.id,
          slotId: slotId, // duplicate slot
          status: 'PENDING',
        },
      })
    ).rejects.toThrow();
  });

  it('68.6 Enforces BankAccount unique constraint per account number', async () => {
    const userId = createdUserIds[0];
    const bankPayload = buildBankAccountPayload();

    await prisma.bankAccount.create({
      data: {
        userId,
        bankAccountNumber: bankPayload.bankAccountNumber,
        bankIFSC: bankPayload.bankIFSC,
        bankAccountHolderName: bankPayload.bankAccountHolderName,
        bankName: bankPayload.bankName,
      },
    });

    // Attempt duplicate bank account number
    await expect(
      prisma.bankAccount.create({
        data: {
          userId,
          bankAccountNumber: bankPayload.bankAccountNumber, // duplicate
          bankIFSC: 'SBIN0001234',
          bankAccountHolderName: 'Other Name',
          bankName: 'SBI',
        },
      })
    ).rejects.toThrow();
  });
});
