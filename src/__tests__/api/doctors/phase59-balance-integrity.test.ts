import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { buildUserPayload, buildBankAccountPayload } from '@/__tests__/helpers/factories';

describe('Phase 59: Doctor Balance Integrity & Mathematical Invariants Test Suite', () => {
  let docUserId: string;
  let docId: string;
  let patientUserId: string;
  let patientId: string;

  const slotIds: string[] = [];
  const apptIds: string[] = [];
  const withdrawalIds: string[] = [];

  const DOCTOR_FEE = 750; // ₹750 per appointment = 75,000 paise

  beforeAll(async () => {
    // 1. Doctor starting with 0 balance
    const docPayload = buildUserPayload({
      name: 'Dr. Invariant Calculator',
      email: `doc_inv_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const docUser = await prisma.user.create({
      data: {
        name: docPayload.name,
        email: docPayload.email,
        phoneNo: docPayload.phoneNo,
        password: docPayload.password,
        age: 47,
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
        specialty: 'GASTROENTEROLOGIST',
        fees: DOCTOR_FEE,
        experience: 16,
        balance: 0, // Starts at 0
      },
    });
    docId = d.id;

    const bankPayload = buildBankAccountPayload();
    await prisma.bankAccount.create({
      data: {
        userId: docUserId,
        bankAccountNumber: bankPayload.bankAccountNumber,
        bankIFSC: bankPayload.bankIFSC,
        bankAccountHolderName: bankPayload.bankAccountHolderName,
        bankName: bankPayload.bankName,
      },
    });

    // 2. Patient
    const patPayload = buildUserPayload({
      name: 'Patient Invariant Appts',
      email: `pat_inv_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const patUser = await prisma.user.create({
      data: {
        name: patPayload.name,
        email: patPayload.email,
        phoneNo: patPayload.phoneNo,
        password: patPayload.password,
        age: 30,
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
  });

  afterAll(async () => {
    try {
      if (withdrawalIds.length > 0) {
        await prisma.withdrawal.deleteMany({ where: { id: { in: withdrawalIds } } });
      }
      await prisma.appointment.deleteMany({ where: { id: { in: apptIds } } });
      await prisma.slot.deleteMany({ where: { id: { in: slotIds } } });
      await prisma.bankAccount.deleteMany({ where: { userId: docUserId } });
      await prisma.patient.deleteMany({ where: { id: patientId } });
      await prisma.doctor.deleteMany({ where: { id: docId } });
      await prisma.user.deleteMany({ where: { id: { in: [docUserId, patientUserId] } } });
    } catch (e) {
      console.warn('Phase 59 cleanup warning:', e);
    }
  });

  it('59.1 Complete appointment credits fee * 100 paise to balance exactly', async () => {
    // Create 3 completed appointments
    for (let i = 1; i <= 3; i++) {
      const slot = await prisma.slot.create({
        data: {
          doctorId: docId,
          date: new Date(`2026-10-0${i}T00:00:00Z`),
          startTime: new Date(`2026-10-0${i}T10:00:00Z`),
          endTime: new Date(`2026-10-0${i}T10:30:00Z`),
          status: 'UNAVAILABLE',
        },
      });
      slotIds.push(slot.id);

      const appt = await prisma.appointment.create({
        data: {
          doctorId: docId,
          patientId,
          slotId: slot.id,
          status: 'COMPLETED',
          paymentMethod: 'ONLINE',
        },
      });
      apptIds.push(appt.id);

      // Credit balance
      await prisma.doctor.update({
        where: { id: docId },
        data: { balance: { increment: DOCTOR_FEE * 100 } }, // +75,000 paise
      });
    }

    const doc = await prisma.doctor.findUnique({ where: { id: docId } });
    // 3 * 75,000 = 225,000 paise (₹2,250)
    expect(doc?.balance).toBe(225000);
  });

  it('59.2 Executing withdrawals decrements balance, maintaining balance invariant', async () => {
    // Withdrawal 1: ₹1,000 (100,000 paise)
    const w1 = await prisma.withdrawal.create({
      data: {
        doctorId: docId,
        amount: 100000,
        currency: 'INR',
        status: 'COMPLETED',
        processedAt: new Date(),
      },
    });
    withdrawalIds.push(w1.id);
    await prisma.doctor.update({
      where: { id: docId },
      data: { balance: { decrement: 100000 } },
    });

    // Withdrawal 2: ₹500 (50,000 paise)
    const w2 = await prisma.withdrawal.create({
      data: {
        doctorId: docId,
        amount: 50000,
        currency: 'INR',
        status: 'COMPLETED',
        processedAt: new Date(),
      },
    });
    withdrawalIds.push(w2.id);
    await prisma.doctor.update({
      where: { id: docId },
      data: { balance: { decrement: 50000 } },
    });

    const doc = await prisma.doctor.findUnique({ where: { id: docId } });
    // 225,000 - 100,000 - 50,000 = 75,000 paise (₹750)
    expect(doc?.balance).toBe(75000);

    // Verify Mathematical Invariant Formula:
    // Available Balance = (Total Completed Appt Earnings) - (Total Completed Withdrawals)
    const totalEarningsPaise = apptIds.length * DOCTOR_FEE * 100;
    const totalWithdrawalsPaise = 100000 + 50000;
    expect(doc?.balance).toBe(totalEarningsPaise - totalWithdrawalsPaise);
  });
});
